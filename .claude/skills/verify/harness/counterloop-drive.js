/* Drive the symmetric, bi-directional counter-offer loop (v3.27.0):
   explicit state machine (PENDING_OWNER_RESPONSE ⇄ PENDING_PLAYER_RESPONSE →
   ACCEPTED/REJECTED/WITHDRAWN), append-only negotiationHistory term-sheet log,
   full-form workspace reset on BOTH sides of a hire negotiation, negotiable
   car-number preference in counters, full-terms stale-accept guard, and the
   same loop applied to sponsorship deal rooms. */
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
        await page.click('.modal-card .role-card:has-text("Semi-Pro")');
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
    await page.click('.gate-tab[data-pane="admin"]');
    await page.click('.gate-tab[data-pane="player"]');

    /* ---- 1. Cast: Greta (Team Owner, numbered team), Henry (Driver, personal number) ---- */
    await registerPlayer('Greta', 'greta@example.com', 'Team Owner');
    await page.click('.role-card:has-text("Grassroots Underdog")');
    await toast(/Team Owner difficulty set/);
    await page.waitForSelector('.team-market-card-found');
    await page.click('.team-market-card-found');
    await page.fill('#tf-name', 'Loop Racing');
    await page.click('#team-form button[type=submit]');
    await toast(/Team founded/);
    const ids = await page.evaluate(async () => {
        const team = (await DB.teams({ force: true })).find(t => t.name === 'Loop Racing');
        await DB.update('teams', team.id, { number: 7 }); // team runs #7
        return { teamId: team.id, gretaUid: team.ownerUid };
    });

    await registerPlayer('Henry', 'henry@example.com', 'Driver');
    await page.click('.onboard-card:has-text("Start from scratch")');
    await page.fill('#ob-name', 'Henry Loop');
    await page.click('#ob-driver-form button[type=submit]');
    await toast(/Welcome to the grid/);
    const henry = await page.evaluate(async () => {
        const d = (await DB.drivers({ force: true })).find(x => x.name === 'Henry Loop');
        await DB.update('drivers', d.id, { number: 44 }); // personal #44
        return { id: d.id, uid: d.ownerUid };
    });

    /* ---- 2. Initial offer seeds the machine + the term-sheet log ---- */
    await signIn('greta@example.com');
    await page.evaluate(({ henryId, teamId }) => Hub.offerForm(henryId, teamId), { henryId: henry.id, teamId: ids.teamId });
    await page.waitForSelector('#hub-offer-form');
    await page.click('.clause-sheet summary');
    await page.fill('#ho-salary', '300');
    await page.fill('#cl-signon', '200');
    await page.fill('#cl-win', '150');
    await page.click('#hub-offer-form button[type=submit]');
    await toast(/Negotiation opened/);
    let neg = await page.evaluate(async () => (await DB.list('negotiations', { force: true })).find(n => n.status === 'open'));
    const negId = neg.id;
    log(neg.state === 'PENDING_PLAYER_RESPONSE' ? '✅' : '❌',
        `Fresh offer stamps the state machine: ${neg.state} (waiting on the talent side)`);
    log(neg.negotiationHistory?.length === 1 && neg.negotiationHistory[0].turn === 0
        && neg.negotiationHistory[0].action === 'offer'
        && neg.negotiationHistory[0].terms.salary === 300 && neg.negotiationHistory[0].terms.signOnBonus === 200
        && neg.negotiationHistory[0].terms.clauses?.winBonus === 150
        && neg.negotiationHistory[0].terms.numberPreference === 'team' ? '✅' : '❌',
        `negotiationHistory seeded with the full offer payload (turn 0: $300, sign-on $200, win $150, team number)`);

    /* ---- 3. Player counters → workspace resets for MANAGEMENT ---- */
    await signIn('henry@example.com');
    await page.evaluate((id) => Deals.room(id), negId);
    await page.waitForSelector('#deal-accept');
    let roomText = await page.evaluate(() => document.querySelector('.modal-card').innerText);
    log(/Pending player response/i.test(roomText) && /turn 1/i.test(roomText) ? '✅' : '❌',
        'Room shows the machine state front and center (Pending player response · turn 1)');
    log(await page.locator('#deal-driver-number').count() === 1 ? '✅' : '❌',
        'Counter form now carries the car-number preference toggle (was frozen after the initial offer)');
    // Henry counters: salary up, keeps his personal #44, adds a pole bonus.
    await page.fill('#deal-salary', '400');
    await page.check('#deal-driver-number');
    await page.fill('#cl-pole', '100');
    await page.click('#deal-act button[type=submit]');
    const counterToast = await toast(/Counter sent/);
    log(/number/i.test(counterToast) ? '✅' : '❌', 'Counter toast spells out the number-preference change: ' + counterToast.slice(0, 100));

    neg = await page.evaluate((id) => DB.get('negotiations', id), negId);
    log(neg.state === 'PENDING_OWNER_RESPONSE' ? '✅' : '❌',
        `Player counter flips the machine: ${neg.state} (document now pending the owner)`);
    log(neg.negotiationHistory?.length === 2 && neg.negotiationHistory[1].turn === 1
        && neg.negotiationHistory[1].terms.salary === 400 && neg.negotiationHistory[1].terms.numberPreference === 'driver'
        && neg.negotiationHistory[1].terms.clauses?.poleBonus === 100 && neg.negotiationHistory[1].terms.clauses?.winBonus === 150
        && neg.negotiationHistory[0].terms.salary === 300 && neg.negotiationHistory[0].terms.numberPreference === 'team' ? '✅' : '❌',
        'History is append-only: turn 0 payload untouched, turn 1 carries the countered sheet ($400, driver #, pole $100, win kept)');
    log(neg.salary === 400 && neg.numberPreference === 'driver' && neg.clauses?.poleBonus === 100 ? '✅' : '❌',
        'Doc top-level terms mirror the LATEST history entry (double-opt-in readers stay correct)');

    /* ---- 4. Management reopens → same comprehensive form, pre-populated, fully editable ---- */
    await signIn('greta@example.com');
    await page.evaluate((id) => Deals.room(id), negId);
    await page.waitForSelector('#deal-accept');
    const ownerForm = await page.evaluate(() => ({
        salary: document.getElementById('deal-salary')?.value,
        exclusive: document.getElementById('deal-exclusive')?.checked,
        driverNum: document.getElementById('deal-driver-number')?.checked,
        pole: document.getElementById('cl-pole')?.value, win: document.getElementById('cl-win')?.value,
        signon: document.getElementById('cl-signon')?.value,
        agreement: document.getElementById('cl-agreement')?.value,
        state: /Pending management response/i.test(document.querySelector('.modal-card').innerText)
    }));
    log(ownerForm.salary === '400' && ownerForm.driverNum === true && ownerForm.pole === '100'
        && ownerForm.win === '150' && ownerForm.signon === '200' && ownerForm.state ? '✅' : '❌',
        `Owner's workspace re-initialized from the latest counter — every field editable and pre-populated ($${ownerForm.salary}, pole $${ownerForm.pole}, win $${ownerForm.win}, sign-on $${ownerForm.signon}, driver# ${ownerForm.driverNum})`);
    await shot('33-counterloop-owner-reset');

    // Greta counters back: meets in the middle, revokes the number concession.
    await page.fill('#deal-salary', '350');
    await page.uncheck('#deal-driver-number');
    await page.click('#deal-act button[type=submit]');
    await toast(/Counter sent/);
    neg = await page.evaluate((id) => DB.get('negotiations', id), negId);
    log(neg.state === 'PENDING_PLAYER_RESPONSE' && neg.negotiationHistory.length === 3
        && neg.negotiationHistory[2].terms.salary === 350 && neg.negotiationHistory[2].terms.numberPreference === 'team'
        && neg.negotiationHistory[2].terms.clauses?.poleBonus === 100 ? '✅' : '❌',
        'Management counter flips back to PENDING_PLAYER_RESPONSE — turn 2 logged ($350, team #, pole bonus kept)');

    /* ---- 5. Full-terms stale-accept guard (not just salary) ---- */
    await signIn('henry@example.com');
    let msg = await page.evaluate(async (id) => {
        try { await Deals.accept(id, 350, 2); return 'SIGNED'; } catch (e) { return e.message; }
    }, negId);
    log(/terms changed since you last looked/.test(msg) ? '✅' : '❌',
        'Accept from a stale turn is refused even when the salary matches: ' + msg.slice(0, 80));

    /* ---- 6. Player accepts the live sheet → terminal ACCEPTED, contract mirrors it ---- */
    await page.evaluate((id) => Deals.room(id), negId);
    await page.waitForSelector('#deal-accept');
    await page.click('#deal-accept');
    await toast(/Contract signed/);
    neg = await page.evaluate((id) => DB.get('negotiations', id), negId);
    log(neg.state === 'ACCEPTED' && neg.status === 'accepted' && neg.negotiationHistory.length === 3 ? '✅' : '❌',
        `Terminal commit: state ${neg.state}, history intact at ${neg.negotiationHistory.length} turns`);
    const c = await page.evaluate(async () => (await DB.contracts({ force: true })).find(x => x.personName === 'Henry Loop'));
    log(c.salary === 350 && c.numberPreference === 'team' && c.clauses?.poleBonus === 100
        && c.clauses?.winBonus === 150 && c.signOnBonus === 200 ? '✅' : '❌',
        `Contract executed from the FINAL sheet ($${c.salary}/race, team #, pole $${c.clauses?.poleBonus}, win $${c.clauses?.winBonus}, sign-on $${c.signOnBonus})`);
    await shot('34-counterloop-signed');

    /* ---- 7. Sponsorship room runs the SAME machine ---- */
    await registerPlayer('Sam', 'sam@example.com', 'Sponsor');
    const spId = await page.evaluate(async () => {
        const uid = Auth.uid();
        return DB.create('roleProfiles', { uid, role: 'sponsor', name: 'Samco Energy', prestige: 3, status: 'approved' });
    });
    await page.evaluate(async ({ spId, teamId, gretaUid }) => Deals.start({
        kind: 'sponsorship', sponsorProfileId: spId, sponsorName: 'Samco Energy', sponsorUid: Auth.uid(),
        teamId, teamName: 'Loop Racing', ownerUid: gretaUid, salary: 200, note: 'Logo on the sidepod?'
    }), { spId, teamId: ids.teamId, gretaUid: ids.gretaUid });
    let sneg = await page.evaluate(async () => (await DB.list('negotiations', { force: true })).find(n => n.kind === 'sponsorship'));
    log(sneg.state === 'PENDING_PLAYER_RESPONSE' && sneg.negotiationHistory?.length === 1 ? '✅' : '❌',
        `Sponsorship offer enters the same machine: ${sneg.state}, term sheet logged`);

    await signIn('greta@example.com');
    await page.evaluate((id) => Deals.room(id), sneg.id);
    await page.waitForSelector('#deal-salary');
    await page.fill('#deal-salary', '260');
    await page.click('#deal-act button[type=submit]');
    await toast(/Counter sent/);
    sneg = await page.evaluate((id) => DB.get('negotiations', id), sneg.id);
    log(sneg.state === 'PENDING_OWNER_RESPONSE' && sneg.negotiationHistory.length === 2
        && sneg.negotiationHistory[1].terms.salary === 260 ? '✅' : '❌',
        'Team counter flips the sponsorship to PENDING_OWNER_RESPONSE with the payload appended ($260/race)');

    await signIn('sam@example.com');
    await page.evaluate((id) => Deals.room(id), sneg.id);
    await page.waitForSelector('#deal-accept');
    roomText = await page.evaluate(() => document.querySelector('.modal-card').innerText);
    log(/Pending management response/i.test(roomText) && /turn 2/i.test(roomText) ? '✅' : '❌',
        'Sponsor sees the countered sheet with state + turn count in the room');
    await page.click('#deal-accept');
    await toast(/Sponsorship live/);
    sneg = await page.evaluate((id) => DB.get('negotiations', id), sneg.id);
    log(sneg.state === 'ACCEPTED' ? '✅' : '❌', `Sponsorship loop terminates: ${sneg.state}`);

    /* ---- 8. Decline lands in REJECTED ---- */
    // Fresh driver — Henry already holds an active contract with this team.
    await registerPlayer('Ivy', 'ivy@example.com', 'Driver');
    await page.click('.onboard-card:has-text("Start from scratch")');
    await page.fill('#ob-name', 'Ivy Decline');
    await page.click('#ob-driver-form button[type=submit]');
    await toast(/Welcome to the grid/);
    const ivyId = await page.evaluate(async () => (await DB.drivers({ force: true })).find(d => d.name === 'Ivy Decline').id);
    await signIn('greta@example.com');
    await page.evaluate(({ henryId, teamId }) => Hub.offerForm(henryId, teamId), { henryId: ivyId, teamId: ids.teamId });
    await page.waitForSelector('#hub-offer-form');
    await page.fill('#ho-salary', '100');
    await page.click('#hub-offer-form button[type=submit]');
    await toast(/Negotiation opened|already open/).catch(() => {});
    const neg2Id = await page.evaluate(async () =>
        (await DB.list('negotiations', { force: true })).filter(n => n.status === 'open').pop()?.id);
    if (neg2Id) {
        await signIn('ivy@example.com');
        await page.evaluate((id) => Deals.room(id), neg2Id);
        await page.waitForSelector('#deal-decline');
        await page.click('#deal-decline');
        await toast(/Negotiation declined/);
        const declined = await page.evaluate((id) => DB.get('negotiations', id), neg2Id);
        log(declined.state === 'REJECTED' && declined.status === 'declined' ? '✅' : '❌',
            `Decline commits the terminal state: ${declined.state}`);
    } else {
        log('❌', 'Could not open a second negotiation for the decline path');
    }

    await browser.close();
    const fails = steps.filter(s => s.startsWith('❌'));
    console.log(`\n${steps.length - fails.length}/${steps.length} steps passed`);
    if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
})().catch(e => { console.error('❌ DRIVE CRASHED:', e); process.exit(1); });
