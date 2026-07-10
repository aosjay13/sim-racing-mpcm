/* Drive the advanced-contract system through the real UI on the shim:
   prestige-gated clause validation, sign-on bonuses, per-race clause
   settlement (win / finish tiers / pole / laps led / clean / full distance),
   telemetry inputs on the results form, championship bonuses + mandatory-win
   termination at season close, open agreements (no buyout), and negotiated
   buyouts through a deal room. */
const { chromium } = require('playwright');
const path = require('path');
const steps = [];
const log = (m, s) => { steps.push(`${m} ${s}`); console.log(m, s); };

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.route('**/*', r => r.request().url().startsWith('http://localhost:8317')
        ? r.continue() : r.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.addInitScript({ path: path.join(__dirname, 'firebase-shim.js') });
    await page.addInitScript(() => { window.confirm = () => true; window.prompt = () => 'Test'; window.alert = () => {}; });
    page.on('pageerror', e => log('❌', 'pageerror: ' + e.message));
    const toast = async (re, timeout = 30000) => {
        await page.waitForFunction(s => new RegExp(s).test(document.getElementById('toast-holder')?.innerText || ''), re.source, { timeout });
        const t = await page.evaluate(() => document.getElementById('toast-holder').innerText.replace(/\n+/g, ' · '));
        await page.evaluate(() => document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove()));
        return t.trim();
    };
    const shot = async (n) => { await page.waitForTimeout(800); await page.screenshot({ path: path.join(__dirname, n + '.png') }); };
    const balances = () => page.evaluate(async () => Object.fromEntries(
        (await DB.users({ force: true })).map(u => [u.displayName, Number(u.balance)])));
    const ledger = (name, icon) => page.evaluate(async ({ name, icon }) => {
        const uid = (await DB.users({ force: true })).find(u => u.displayName === name)?.id;
        const rows = (await DB.list('ledger', { force: true })).filter(t => t.uid === uid && t.icon === icon);
        return { count: rows.length, sum: rows.reduce((s, t) => s + t.amount, 0) };
    }, { name, icon });

    const signOut = async () => {
        await page.evaluate(() => Modal.close());
        if (await page.locator('#app-shell:not(.hidden)').count()) await page.click('#signout-btn');
        await page.waitForSelector('#auth-gate:not(.hidden)');
    };
    const registerPlayer = async (name, email, role) => {
        await signOut();
        await page.click('.gate-tab[data-pane="player"]');
        if (await page.locator('#gate-name-field.hidden').count()) await page.click('#gate-mode-toggle');
        await page.fill('#gate-name', name);
        await page.fill('#gate-email', email);
        await page.fill('#gate-password', 'secret1');
        await page.click('#gate-player-submit');
        await page.waitForSelector('#app-shell:not(.hidden)');
        await page.waitForSelector('.modal-card .role-card');
        await page.click('.modal-card .role-card:has-text("Semi-Pro")'); // $75,000
        await toast(/starting budget/);
        await page.waitForSelector('.role-grid .role-card');
        await page.click(`.role-card:has(.role-name:text-is("${role}"))`);
        await toast(/now playing as/);
    };
    const signIn = async (email) => {
        await signOut();
        await page.click('.gate-tab[data-pane="player"]');
        if (!(await page.locator('#gate-name-field.hidden').count())) await page.click('#gate-mode-toggle');
        await page.fill('#gate-email', email);
        await page.fill('#gate-password', 'secret1');
        await page.click('#gate-player-submit');
        await page.waitForSelector('#app-shell:not(.hidden)');
    };
    const gmSignIn = async () => {
        await signOut();
        await page.click('.gate-tab[data-pane="admin"]');
        await page.fill('#gate-passcode', 'phoenix13!');
        await page.click('#gate-admin-submit');
        await page.waitForSelector('#app-shell:not(.hidden)');
        await toast(/Welcome back/).catch(() => {});
    };

    await page.goto('http://localhost:8317/sim-racing-career/app.html');
    await page.click('.gate-tab[data-pane="admin"]');
    await page.click('.gate-tab[data-pane="player"]');

    /* ---- 1. Greta founds Vortex Racing (1★ rookie team) ---- */
    await registerPlayer('Greta', 'greta@example.com', 'Team Owner');
    await page.click('.onboard-card:has-text("Found a new team")');
    await page.fill('#tf-name', 'Vortex Racing');
    await page.click('#team-form button[type=submit]');
    await toast(/Team founded/);
    const ids = await page.evaluate(async () => {
        const team = (await DB.teams({ force: true })).find(t => t.name === 'Vortex Racing');
        const npcId = await DB.create('drivers', { name: 'Npc Rival', rating: 80, isNPC: true, teamId: null, ownerUid: null, status: 'approved' });
        return { teamId: team.id, gretaUid: team.ownerUid, npcId };
    });

    /* ---- 2. Prestige gating & anti-laundering: rejected at the engine ---- */
    const tryStart = (extra) => page.evaluate(async ({ teamId, extra }) => {
        try {
            await Deals.start({ kind: 'team-driver', teamId, teamName: 'Vortex Racing', ownerUid: Auth.uid(),
                personId: 'nobody', personKind: 'driver', personName: 'Test', personUid: null, salary: 500, ...extra });
            return 'ACCEPTED';
        } catch (e) { return e.message; }
    }, { teamId: ids.teamId, extra });
    let msg = await tryStart({ clauses: { minWins: { count: 1 } } });
    log(/4★\+ teams may demand mandatory wins/.test(msg) ? '✅' : '❌', '1★ team demanding wins is rejected: ' + msg.slice(0, 80));
    msg = await tryStart({ clauses: { finishBonus: [{ atOrBetter: 3, amount: 5000 }] } });
    log(/no single bonus may exceed 2× salary/.test(msg) ? '✅' : '❌', 'Anti-laundering cap rejects a $5,000 top-3 on a $500 salary: ' + msg.slice(0, 80));

    // A trophy cabinet: 27 championship titles ⇒ 6,750 XP ⇒ 4★ Elite team.
    await page.evaluate(async (teamId) => {
        await DB.batchCreate('seasons', Array.from({ length: 27 }, (_, i) =>
            ({ name: `Legacy ${i + 1}`, status: 'completed', championTeamId: teamId })));
    }, ids.teamId);
    const stars = await page.evaluate(async (teamId) => Prestige.teamStars(teamId, await DB.loadWorld(true)), ids.teamId);
    log(stars === 4 ? '✅' : '❌', `Vortex Racing is now ${stars}★ (titles bank prestige XP)`);
    msg = await tryStart({ agreement: 'open', clauses: { minWins: { count: 2 } } });
    log(/open agreement is a handshake/.test(msg) ? '✅' : '❌', 'Open agreements cannot carry termination clauses: ' + msg.slice(0, 80));

    /* ---- 3. Henry signs a clause-laden contract with a custom sign-on bonus ---- */
    await registerPlayer('Henry', 'henry@example.com', 'Driver');
    await page.click('.onboard-card:has-text("Start from scratch")');
    await page.fill('#ob-name', 'Henry Flash');
    await page.click('#ob-driver-form button[type=submit]');
    await toast(/Welcome to the grid/);
    const henryId = await page.evaluate(async () => (await DB.drivers({ force: true })).find(d => d.name === 'Henry Flash').id);

    await signIn('greta@example.com');
    await page.evaluate(({ henryId, teamId }) => Hub.offerForm(henryId, teamId), { henryId, teamId: ids.teamId });
    await page.waitForSelector('#hub-offer-form');
    log(await page.locator('#cl-minwins').count() === 1 ? '✅' : '❌', '4★ offer form unlocks the mandatory-wins stipulation');
    await page.click('.clause-sheet summary'); // expand the advanced-terms sheet
    await page.fill('#ho-salary', '500');
    await page.fill('#cl-signon', '250');
    await page.fill('#cl-win', '400'); await page.fill('#cl-top3', '200');
    await page.fill('#cl-pole', '150'); await page.fill('#cl-led', '200');
    await page.fill('#cl-clean', '100'); await page.fill('#cl-fulldist', '100');
    await page.fill('#cl-champ3', '800');
    await page.fill('#cl-minwins', '2');
    await page.click('#hub-offer-form button[type=submit]');
    await toast(/Negotiation opened/);
    const negId = await page.evaluate(async () => (await DB.list('negotiations', { force: true })).find(n => n.status === 'open').id);

    await signIn('henry@example.com');
    await page.evaluate((id) => Deals.room(id), negId);
    await page.waitForSelector('#deal-accept');
    const roomText = await page.evaluate(() => document.querySelector('.modal-card').innerText);
    log(/Sign-on \$250/.test(roomText) && /2\+ wins required/.test(roomText) && /win \$400/.test(roomText) ? '✅' : '❌',
        'Deal room shows the full term sheet: sign-on bonus + 📜 clause summary + ⚠️ stipulation');

    // The counter form must offer the SAME menu the initial offer did (not just
    // a bare salary box), pre-filled with Greta's numbers so an untouched field
    // doesn't silently get wiped out on submit.
    const counterMenu = await page.evaluate(() => ({
        hasWin: !!document.getElementById('cl-win'), hasSignon: !!document.getElementById('cl-signon'),
        hasExclusive: !!document.getElementById('deal-exclusive'),
        signon: document.getElementById('cl-signon').value, win: document.getElementById('cl-win').value,
        minwins: document.getElementById('cl-minwins').value, exclusive: document.getElementById('deal-exclusive').checked
    }));
    log(counterMenu.hasWin && counterMenu.hasSignon && counterMenu.hasExclusive ? '✅' : '❌',
        'Counter form offers the full advanced-terms menu (clauses, sign-on bonus, exclusivity) — not just salary');
    log(counterMenu.signon === '250' && counterMenu.win === '400' && counterMenu.minwins === '2' && counterMenu.exclusive === true ? '✅' : '❌',
        `Counter form pre-fills Greta's sheet (sign-on $${counterMenu.signon}, win $${counterMenu.win}, minWins ${counterMenu.minwins}, exclusive ${counterMenu.exclusive})`);

    // Henry counters: revises one clause (fastest-lap bonus, untouched by
    // Greta's offer) and drops exclusivity, while leaving the pre-filled
    // salary/sign-on/win-bonus/minWins figures exactly as offered.
    await page.fill('#cl-flap', '80');
    await page.uncheck('#deal-exclusive');
    await page.click('#deal-act button[type=submit]');
    await toast(/Counter sent/);
    log('✅', "Henry countered: added an $80 fastest-lap bonus, dropped exclusivity, kept the rest of Greta's sheet");

    let negAfterCounter = await page.evaluate((id) => DB.get('negotiations', id), negId);
    log(negAfterCounter.exclusive === false && negAfterCounter.clauses?.fastestLapBonus === 80
        && negAfterCounter.clauses?.winBonus === 400 && negAfterCounter.signOnBonus === 250 && negAfterCounter.clauses?.minWins?.count === 2
        ? '✅' : '❌',
        `Counter persisted the edit AND the untouched terms (exclusive ${negAfterCounter.exclusive}, fastest-lap $${negAfterCounter.clauses?.fastestLapBonus}, win $${negAfterCounter.clauses?.winBonus}, sign-on $${negAfterCounter.signOnBonus}, minWins ${negAfterCounter.clauses?.minWins?.count})`);

    await signIn('greta@example.com');
    await page.evaluate((id) => Deals.room(id), negId);
    await page.waitForSelector('#deal-accept');
    await page.click('#deal-accept');
    await toast(/Contract signed/);
    await shot('25-clause-contract');
    let c = await page.evaluate(async () => (await DB.contracts({ force: true })).find(x => x.personName === 'Henry Flash'));
    log(c.agreement === 'contracted' && c.signOnBonus === 250 && c.buyout === 5000 && c.exclusive === false
        && c.clauses?.minWins?.count === 2 && c.clauses?.winBonus === 400 && c.clauses?.fastestLapBonus === 80 ? '✅' : '❌',
        `Contract stores the countered sheet (sign-on $${c.signOnBonus}, buyout $${c.buyout}, exclusive ${c.exclusive}, minWins ${c.clauses?.minWins?.count}, flap $${c.clauses?.fastestLapBonus})`);
    let bal = await balances();
    log(bal.Henry === 75250 && bal.Greta === 74750 ? '✅' : '❌',
        `Sign-on bonus (and ONLY it) moved upfront: Henry $${bal.Henry}, Greta $${bal.Greta}`);

    /* ---- 4. Race 1: dominant Henry — clauses settle per race via ledger ---- */
    await gmSignIn();
    const raceIds = await page.evaluate(async () => {
        const gameId = await DB.create('games', { name: 'GT Clause' });
        const seriesId = await DB.create('series', { name: 'Clause Cup', gameId, pointsSystem: 'f1', status: 'active' });
        const seasonId = await DB.create('seasons', { name: 'Clause Cup S1', seriesId, status: 'active' });
        const r1 = await DB.create('races', { seriesId, seasonId, gameId, name: 'Clause GP R1', round: 1, track: 'Vortex Ring', date: '2026-07-01', laps: 20, status: 'scheduled', results: [] });
        const r2 = await DB.create('races', { seriesId, seasonId, gameId, name: 'Clause GP R2', round: 2, track: 'Vortex Ring', date: '2026-07-08', laps: 20, status: 'scheduled', results: [] });
        return { seriesId, seasonId, r1, r2 };
    });
    await page.evaluate((id) => Admin.resultsForm(id), raceIds.r1);
    await page.waitForSelector('#results-form');
    log(/inc[\s\S]*led[\s\S]*laps/i.test(await page.evaluate(() => document.querySelector('#results-form thead').innerText)) ? '✅' : '❌',
        'Results form carries the clause telemetry columns (Inc / Led / Laps)');
    await page.selectOption('#res-pole', henryId);
    await page.fill(`tr[data-driver="${henryId}"] .input-pos`, '1');
    await page.fill(`tr[data-driver="${henryId}"] .input-inc`, '0');
    await page.fill(`tr[data-driver="${henryId}"] .input-led`, '15');
    await page.fill(`tr[data-driver="${henryId}"] .input-laps`, '20');
    await page.fill(`tr[data-driver="${ids.npcId}"] .input-pos`, '2');
    await page.click('#results-form button[type=submit]');
    await toast(/Results saved/);
    let led = await ledger('Henry', '📜');
    // win 400 + top3 200 + pole 150 + most laps led 200 + clean 100 + full distance 100 = $1,150
    log(led.count === 6 && led.sum === 1150 ? '✅' : '❌',
        `Perfect race pays all six per-race clauses via the ledger (${led.count} rows, $${led.sum})`);
    led = await ledger('Greta', '📜');
    log(led.count === 6 && led.sum === -1150 ? '✅' : '❌', `Owner debited symmetrically for every clause ($${led.sum})`);

    /* ---- 5. Race 2: no telemetry entered — those clauses silently skip ---- */
    await page.evaluate((id) => Admin.resultsForm(id), raceIds.r2);
    await page.waitForSelector('#results-form');
    await page.fill(`tr[data-driver="${ids.npcId}"] .input-pos`, '1');
    await page.check(`tr[data-driver="${henryId}"] .chk-dnf`);
    await page.click('#results-form button[type=submit]');
    await toast(/Results saved/);
    led = await ledger('Henry', '📜');
    log(led.count === 6 && led.sum === 1150 ? '✅' : '❌',
        'A DNF with blank telemetry pays NO clauses — missing data never fires bonuses');

    /* ---- 6. Season close: championship bonus + mandatory-wins termination ---- */
    await page.evaluate(({ seasonId, seriesId }) => Admin.closeSeason(seasonId, seriesId), raceIds);
    await toast(/Season closed/);
    led = await page.evaluate(async () => { // 🏆 icon is shared with prize money — match the label
        const uid = (await DB.users({ force: true })).find(u => u.displayName === 'Henry').id;
        const rows = (await DB.list('ledger', { force: true })).filter(t => t.uid === uid && /Championship P\d/.test(t.label) && t.amount > 0);
        return { count: rows.length, sum: rows.reduce((s, t) => s + t.amount, 0) };
    });
    log(led.count === 1 && led.sum === 800 ? '✅' : '❌',
        `Championship bonus paid from the crowned standings (P2 → champ-top-3 tier, $${led.sum})`);
    c = await page.evaluate(async () => (await DB.contracts({ force: true })).find(x => x.personName === 'Henry Flash'));
    const henryDoc = await page.evaluate(async (id) => DB.get('drivers', id, { force: true }), henryId);
    log(c.status === 'terminated' && /required wins/.test(c.terminationReason || '') && henryDoc.teamId === null ? '✅' : '❌',
        `Mandatory-wins breach terminates for cause (1 of 2 wins): status ${c.status}, freed from the team`);

    /* ---- 7. Open agreement: handshake deal, frictionless exit ---- */
    await registerPlayer('Ivy', 'ivy@example.com', 'Driver');
    await page.click('.onboard-card:has-text("Start from scratch")');
    await page.fill('#ob-name', 'Ivy Drift');
    await page.click('#ob-driver-form button[type=submit]');
    await toast(/Welcome to the grid/);
    const ivyId = await page.evaluate(async () => (await DB.drivers({ force: true })).find(d => d.name === 'Ivy Drift').id);
    await signIn('greta@example.com');
    await page.evaluate(({ ivyId, teamId }) => Hub.offerForm(ivyId, teamId), { ivyId, teamId: ids.teamId });
    await page.waitForSelector('#hub-offer-form');
    await page.fill('#ho-salary', '200');
    await page.click('.clause-sheet summary');
    await page.selectOption('#cl-agreement', 'open');
    await page.fill('#cl-signon', '0');
    await page.click('#hub-offer-form button[type=submit]');
    await toast(/Negotiation opened/);
    await signIn('ivy@example.com');
    const negIvy = await page.evaluate(async () => (await DB.list('negotiations', { force: true })).find(n => n.status === 'open' && n.personName === 'Ivy Drift').id);
    await page.evaluate((id) => Deals.room(id), negIvy);
    await page.waitForSelector('#deal-accept');
    log(/Open agreement — leave anytime/.test(await page.evaluate(() => document.querySelector('.modal-card').innerText)) ? '✅' : '❌',
        'Deal room flags the open agreement');
    await page.click('#deal-accept');
    await toast(/Contract signed/);
    c = await page.evaluate(async () => (await DB.contracts({ force: true })).find(x => x.personName === 'Ivy Drift' && x.status === 'active'));
    log(c.agreement === 'open' && c.buyout === 0 && c.signOnBonus === 0 ? '✅' : '❌',
        `Open agreement stored: buyout $${c.buyout}, sign-on $${c.signOnBonus}`);
    const balBefore = await balances();
    await page.evaluate(() => App.go('career'));
    await page.waitForSelector('#view-root .driver-hero');
    await page.click('#view-root button:has-text("Leave team")');
    await toast(/You left/);
    bal = await balances();
    c = await page.evaluate(async () => (await DB.contracts({ force: true })).find(x => x.personName === 'Ivy Drift' && x.agreement === 'open'));
    log(c.status !== 'active' && bal.Ivy === balBefore.Ivy && bal.Greta === balBefore.Greta ? '✅' : '❌',
        'Leaving an open agreement is free — no buyout modal, no money moved');

    /* ---- 8. Negotiated buyout: propose low, counter, accept, settle ---- */
    await signIn('greta@example.com');
    await page.evaluate(({ ivyId, teamId }) => Hub.offerForm(ivyId, teamId), { ivyId, teamId: ids.teamId });
    await page.waitForSelector('#hub-offer-form');
    await page.fill('#ho-salary', '200');
    await page.click('.clause-sheet summary');
    await page.fill('#cl-signon', '0');
    await page.click('#hub-offer-form button[type=submit]');
    await toast(/Negotiation opened/);
    await signIn('ivy@example.com');
    const negIvy2 = await page.evaluate(async () => (await DB.list('negotiations', { force: true })).find(n => n.status === 'open' && n.personName === 'Ivy Drift').id);
    await page.evaluate((id) => Deals.room(id), negIvy2);
    await page.waitForSelector('#deal-accept');
    await page.click('#deal-accept');
    await toast(/Contract signed/);
    await page.evaluate(() => App.go('career'));
    await page.waitForSelector('#view-root .driver-hero');
    await page.click('#view-root button:has-text("Leave team")');
    await page.waitForSelector('#lv-figure');
    log(/buyout \$2,000/i.test(await page.evaluate(() => document.querySelector('.modal-card').innerText)) ? '✅' : '❌',
        'Contracted exit shows the $2,000 buyout clause (10× salary)');
    await page.fill('#lv-figure', '800');
    await page.click('#lv-negotiate');
    await toast(/Buyout talks opened/);
    log(/one-time/.test(await page.evaluate(() => document.querySelector('.modal-card').innerText)) ? '✅' : '❌',
        'Buyout deal room prices a ONE-TIME figure, not a per-race salary');
    await signIn('greta@example.com');
    const negBuy = await page.evaluate(async () => (await DB.list('negotiations', { force: true })).find(n => n.status === 'open' && n.kind === 'buyout').id);
    await page.evaluate((id) => Deals.room(id), negBuy);
    await page.waitForSelector('#deal-salary');
    await page.fill('#deal-salary', '1200');
    await page.click('#deal-act button[type=submit]');
    await toast(/Counter sent/);
    await signIn('ivy@example.com');
    const preBuy = await balances();
    await page.evaluate((id) => Deals.room(id), negBuy);
    await page.waitForSelector('#deal-accept');
    await page.click('#deal-accept');
    await toast(/Buyout agreed at \$1,200/);
    await shot('26-buyout-room');
    bal = await balances();
    c = await page.evaluate(async () => (await DB.contracts({ force: true })).filter(x => x.personName === 'Ivy Drift').map(x => x.status));
    log(bal.Ivy === preBuy.Ivy - 1200 && bal.Greta === preBuy.Greta + 1200 && c.includes('bought-out') ? '✅' : '❌',
        `Negotiated $1,200 buyout settled (clause was $2,000): Ivy -$1,200, Greta +$1,200, contract bought-out`);

    await browser.close();
    const fails = steps.filter(s => s.startsWith('❌'));
    console.log(`\n${steps.length - fails.length}/${steps.length} steps passed`);
    if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
})().catch(e => { console.error('❌ DRIVE CRASHED:', e); process.exit(1); });
