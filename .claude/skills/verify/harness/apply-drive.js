/* Drive the application-gated joining + GM/AI-principal flow through the
   real UI on the shim:
   1) onboarding with a team picked → FREE AGENT + pending application (no
      auto contract, no teamId),
   2) career "Apply to a team" → application, never an instant signing,
   3) applications to UNOWNED teams land in the Game Master's inbox with
      "Negotiate as GM" + "AI Principal" actions,
   4) AI Principal opens a deal room with a market-rate offer + generated
      dialogue; the player counters, the principal counters back, the player
      accepts → contract signs, teamId set, league-owned contract (no ownerUid),
   5) GM can instead negotiate personally (proxy side A, wallet untouched). */
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

    const signOut = async () => {
        await page.evaluate(() => Modal.close());
        if (await page.locator('#app-shell:not(.hidden)').count()) await page.click('#signout-btn');
        await page.waitForSelector('#auth-gate:not(.hidden)');
    };
    const gmSignIn = async () => {
        await signOut();
        await page.click('.gate-tab[data-pane="admin"]');
        await page.fill('#gate-passcode', 'phoenix13!');
        await page.click('#gate-admin-submit');
        await page.waitForSelector('#app-shell:not(.hidden)');
        await toast(/Welcome back/).catch(() => {});
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

    await page.goto('http://localhost:8317/sim-racing-career/app.html');

    /* ---- 1. GM seeds two UNOWNED recruiting teams ---- */
    await page.click('.gate-tab[data-pane="admin"]');
    await page.fill('#gate-passcode', 'phoenix13!');
    await page.click('#gate-admin-submit');
    await page.waitForSelector('#app-shell:not(.hidden)');
    await toast(/Welcome back/).catch(() => {});
    const teamIds = await page.evaluate(async () => {
        const ghost = await DB.create('teams', { name: 'Ghost Racing', color: '#8888ff', ownerUid: null, recruiting: true });
        const specter = await DB.create('teams', { name: 'Specter GP', color: '#88ff88', ownerUid: null, recruiting: true });
        return { ghost, specter };
    });
    log('✅', 'GM seeded two unowned recruiting teams (Ghost Racing, Specter GP)');

    /* ---- 2. Carol onboards INTO an established team → free agent + application ---- */
    await registerPlayer('Carol', 'carol@example.com', 'Driver');
    await page.click('.onboard-card:has-text("Join an established team")');
    await page.waitForSelector('#ob-driver-form');
    const obLabel = await page.evaluate(() => document.querySelector('#ob-team').closest('label').innerText);
    log(/no automatic signing/i.test(obLabel) ? '✅' : '❌', 'Onboarding team picker says there is no automatic signing');
    await page.fill('#ob-name', 'Carol Swift');
    await page.selectOption('#ob-team', teamIds.ghost);
    await page.click('#ob-driver-form button[type=submit]');
    log('✅', 'Rookie onboarding: ' + (await toast(/application is with Ghost Racing/i)));
    let state = await page.evaluate(async () => {
        const d = (await DB.drivers({ force: true })).find(x => x.name === 'Carol Swift');
        const contracts = (await DB.contracts({ force: true })).filter(c => c.personId === d.id);
        const apps = (await DB.recruitment({ force: true })).filter(r => r.kind === 'application' && r.driverId === d.id);
        const user = (await DB.users({ force: true })).find(u => u.displayName === 'Carol');
        return { teamId: d.teamId, contracts: contracts.length, apps: apps.map(a => ({ team: a.teamName, status: a.status, ownerUid: a.ownerUid })), userTeamId: user.teamId || null };
    });
    log(state.teamId === null && state.userTeamId === null ? '✅' : '❌', `Rookie starts as a FREE AGENT (driver.teamId=${state.teamId}, user.teamId=${state.userTeamId})`);
    log(state.contracts === 0 ? '✅' : '❌', `No contract auto-created at onboarding (${state.contracts} contracts)`);
    log(state.apps.length === 1 && state.apps[0].status === 'pending' ? '✅' : '❌', `Application pending with ${state.apps[0]?.team} (unowned → ownerUid ${state.apps[0]?.ownerUid})`);

    /* ---- 3. Career page: "Apply to a team" (no instant join anywhere) ---- */
    await page.evaluate(() => App.go('career'));
    await page.waitForSelector('#view-root .driver-hero');
    const heroText = await page.evaluate(() => document.querySelector('#view-root .driver-hero').innerText);
    log(/free agent/i.test(heroText) && /apply to a team/i.test(heroText) && !/join a team/i.test(heroText) ? '✅' : '❌',
        'Career hero shows Free agent + "Apply to a team" (no "Join a team" button)');
    log(await page.evaluate(() => typeof Career.joinTeam === 'undefined') ? '✅' : '❌', 'Instant-join Career.joinTeam() is gone');
    await page.click('#view-root button:has-text("Apply to a team")');
    await page.waitForSelector('.modal-card .race-row');
    const modalText = await page.evaluate(() => document.querySelector('.modal-card').innerText);
    log(/no instant signings/i.test(modalText) && /negotiated contract/i.test(modalText) ? '✅' : '❌', 'Apply modal explains: no instant signings, everything is negotiated');
    log(/applied/i.test(await page.evaluate(t => document.querySelector(`.modal-card .race-row:has(.race-title)`)?.closest('.modal-card').innerText, 0)) ? '✅' : '❌',
        'Ghost Racing (already applied) shows the Applied badge');
    await page.click('.modal-card .race-row:has-text("Specter GP")');
    log('✅', 'Apply via modal: ' + (await toast(/league office|Application sent/i)));
    state = await page.evaluate(async () => {
        const d = (await DB.drivers({ force: true })).find(x => x.name === 'Carol Swift');
        const contracts = (await DB.contracts({ force: true })).filter(c => c.personId === d.id);
        const apps = (await DB.recruitment({ force: true })).filter(r => r.kind === 'application' && r.driverId === d.id && r.status === 'pending');
        return { teamId: d.teamId, contracts: contracts.length, apps: apps.length };
    });
    log(state.teamId === null && state.contracts === 0 && state.apps === 2 ? '✅' : '❌',
        `Applying signs NOTHING: still a free agent, 0 contracts, ${state.apps} pending applications`);

    /* ---- 4. GM inbox: unowned-team applications need the GM's decision ---- */
    await gmSignIn();
    await page.evaluate(() => App.go('hub', 'recruitment'));
    await page.waitForSelector('#hub-body .panel');
    const inboxText = await page.evaluate(() => document.getElementById('hub-body').innerText);
    log(/Carol Swift wants to drive for Ghost Racing/i.test(inboxText) && /Carol Swift wants to drive for Specter GP/i.test(inboxText) ? '✅' : '❌',
        "GM inbox lists both of Carol's unowned-team applications");
    log(/no player owner/i.test(inboxText) ? '✅' : '❌', 'Inbox explains: team has no player owner → GM decides');
    const ghostRow = page.locator('#hub-body .race-row', { hasText: 'Ghost Racing' }).first();
    log(await ghostRow.locator('button:has-text("Negotiate as GM")').count() === 1 &&
        await ghostRow.locator('button:has-text("AI Principal")').count() === 1 ? '✅' : '❌',
        'Application row offers "✍️ Negotiate as GM" and "🤖 AI Principal"');
    await shot('20-gm-inbox');

    /* ---- 5. AI Principal: generated opening offer at market rate ---- */
    await ghostRow.locator('button:has-text("AI Principal")').click();
    log('✅', 'AI principal engaged: ' + (await toast(/principal sent Carol Swift an offer/i)));
    const neg = await page.evaluate(async () => {
        const n = (await DB.list('negotiations', { force: true })).find(x => x.status === 'open' && x.teamName === 'Ghost Racing');
        return n && { id: n.id, salary: n.salary, sideAUid: n.sideAUid, ownerUid: n.ownerUid, turnUid: n.turnUid, byName: n.history[0].byName, note: n.history[0].note, exclusive: n.exclusive };
    });
    log(neg && neg.salary === 900 && neg.sideAUid === null && neg.ownerUid === null ? '✅' : '❌',
        `AI principal opened at market rate $${neg?.salary}/race for the league-owned team (sideA AI, no ownerUid)`);
    log(neg && /Team Principal/.test(neg.byName) && neg.note.length > 10 ? '✅' : '❌',
        `Opening offer has generated dialogue from "${neg?.byName}": “${(neg?.note || '').slice(0, 60)}…”`);
    const recStatus = await page.evaluate(async () =>
        (await DB.recruitment({ force: true })).find(r => r.teamName === 'Ghost Racing' && r.kind === 'application').status);
    log(recStatus === 'accepted' ? '✅' : '❌', `Application marked ${recStatus} once talks open`);

    /* ---- 6. Carol: counter high → AI counters back with dialogue → accept ---- */
    await signIn('carol@example.com');
    await page.evaluate(() => App.go('career'));
    await page.waitForSelector('#view-root .panel');
    log(/your move/i.test(await page.evaluate(() => document.getElementById('view-root').innerText)) ? '✅' : '❌',
        "Carol's Deals panel shows the principal's offer — Your move");
    await page.evaluate((id) => Deals.room(id), neg.id);
    await page.waitForSelector('#deal-act');
    const roomText = await page.evaluate(() => document.querySelector('.modal-card').innerText);
    log(/Team Principal/i.test(roomText) && /AI/i.test(roomText) ? '✅' : '❌', 'Deal room shows the AI principal with the 🤖 AI chip');
    await page.fill('#deal-salary', '1500');
    await page.fill('#deal-note', 'I want more than scale.');
    await page.click('#deal-act button[type=submit]');
    await toast(/Counter sent/);
    await page.waitForSelector('#deal-accept');
    const afterCounter = await page.evaluate(async (id) => {
        const n = await DB.get('negotiations', id);
        const last = n.history[n.history.length - 1];
        return { salary: n.salary, turnUid: n.turnUid, action: last.action, byName: last.byName, note: last.note };
    }, neg.id);
    log(afterCounter.salary === 900 && afterCounter.action === 'counter' && /Team Principal/.test(afterCounter.byName) ? '✅' : '❌',
        `Principal counters a greedy $1,500 ask back to $${afterCounter.salary}: “${(afterCounter.note || '').slice(0, 60)}…”`);
    await page.click('#deal-accept');
    log('✅', 'Carol accepts: ' + (await toast(/Contract signed/i)));
    await shot('21-ai-principal-room');
    state = await page.evaluate(async () => {
        const d = (await DB.drivers({ force: true })).find(x => x.name === 'Carol Swift');
        const c = (await DB.contracts({ force: true })).find(x => x.personId === d.id && x.status === 'active');
        const user = (await DB.users({ force: true })).find(u => u.displayName === 'Carol');
        return { teamId: d.teamId, contract: c && { teamName: c.teamName, salary: c.salary, ownerUid: c.ownerUid, exclusive: c.exclusive }, userTeamId: user.teamId, balance: Number(user.balance) };
    });
    log(state.teamId === teamIds.ghost && state.userTeamId === teamIds.ghost ? '✅' : '❌', 'Signing sets Carol\'s team to Ghost Racing (driver + user doc)');
    log(state.contract && state.contract.salary === 900 && state.contract.ownerUid === null ? '✅' : '❌',
        `Active contract: ${state.contract?.teamName} $${state.contract?.salary}/race, league-owned (ownerUid null)`);
    log(state.balance === 75900 ? '✅' : '❌', `Carol pocketed the $900 signing bonus (balance $${state.balance})`);

    /* ---- 7. GM negotiates the OTHER application personally (proxy, wallet-safe) ---- */
    await gmSignIn();
    await page.evaluate(() => App.go('hub', 'recruitment'));
    await page.waitForSelector('#hub-body .panel');
    await page.locator('#hub-body .race-row', { hasText: 'Specter GP' }).first().locator('button:has-text("Negotiate as GM")').click();
    await page.waitForSelector('#hub-sign-form');
    const gmModal = await page.evaluate(() => document.querySelector('.modal-card').innerText);
    log(/unowned team — you negotiate as the GM/i.test(gmModal) ? '✅' : '❌', 'GM terms form flags the unowned-team proxy role');
    await page.fill('#hs-salary', '300');
    await page.uncheck('#hs-exclusive'); // Carol already drives for Ghost (non-exclusive)
    await page.fill('#hs-note', 'The league office likes your style. Second seat, no strings.');
    await page.click('#hub-sign-form button[type=submit]');
    log('✅', 'GM proposal: ' + (await toast(/Terms sent to Carol Swift/i)));
    const negGm = await page.evaluate(async () => {
        const n = (await DB.list('negotiations', { force: true })).find(x => x.status === 'open' && x.teamName === 'Specter GP');
        return n && { id: n.id, sideAUid: n.sideAUid, ownerUid: n.ownerUid };
    });
    log(negGm && negGm.sideAUid && negGm.ownerUid === null ? '✅' : '❌', 'GM drives side A as proxy, contract stays league-owned (no ownerUid)');

    /* ---- 8. Carol accepts the GM's terms → second (non-exclusive) contract ---- */
    await signIn('carol@example.com');
    await page.evaluate((id) => Deals.room(id), negGm.id);
    await page.waitForSelector('#deal-accept');
    log(/league office likes your style/i.test(await page.evaluate(() => document.querySelector('.modal-card').innerText)) ? '✅' : '❌',
        "GM's message reached Carol's deal room");
    await page.click('#deal-accept');
    log('✅', 'Carol accepts the GM deal: ' + (await toast(/Contract signed/i)));
    state = await page.evaluate(async () => {
        const d = (await DB.drivers({ force: true })).find(x => x.name === 'Carol Swift');
        const cs = (await DB.contracts({ force: true })).filter(x => x.personId === d.id && x.status === 'active');
        const user = (await DB.users({ force: true })).find(u => u.displayName === 'Carol');
        return { teamId: d.teamId, contracts: cs.map(c => `${c.teamName} $${c.salary} owner:${c.ownerUid}`), balance: Number(user.balance) };
    });
    log(state.contracts.length === 2 && state.teamId === teamIds.ghost ? '✅' : '❌',
        `Two active contracts (${state.contracts.join(' · ')}), Ghost Racing stays primary`);
    log(state.balance === 76200 ? '✅' : '❌', `Second signing bonus landed, GM wallet never touched (Carol $${state.balance})`);

    await browser.close();
    const fails = steps.filter(s => s.startsWith('❌'));
    console.log(`\n${steps.length - fails.length}/${steps.length} steps passed`);
    if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
})().catch(e => { console.error('❌ DRIVE CRASHED:', e); process.exit(1); });
