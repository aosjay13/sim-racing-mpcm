/* Drive the Global GM Override through the real UI on the shim:
   GM uid registration for the firestore.rules isGM() gate, wallet override
   with ledger audit, cascading team/driver renames, contract term overrides
   + forced status changes with team-link repair, buyout waivers, and the raw
   any-collection document editor (edit + delete). */
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

    /* ---- 1. Seed: Kara owns Omega Racing, Jack drives for it on contract ---- */
    await registerPlayer('Kara', 'kara@example.com', 'Team Owner');
    await page.click('.onboard-card:has-text("Found a new team")');
    await page.fill('#tf-name', 'Omega Racing');
    await page.click('#team-form button[type=submit]');
    await toast(/Team founded/);
    await registerPlayer('Jack', 'jack@example.com', 'Driver');
    await page.click('.onboard-card:has-text("Start from scratch")');
    await page.fill('#ob-name', 'Jack Speed');
    await page.click('#ob-driver-form button[type=submit]');
    await toast(/Welcome to the grid/);
    const seed = await page.evaluate(async () => {
        const team = (await DB.teams({ force: true })).find(t => t.name === 'Omega Racing');
        const jack = (await DB.drivers({ force: true })).find(d => d.name === 'Jack Speed');
        return { teamId: team.id, jackId: jack.id };
    });
    await signIn('kara@example.com');
    await page.evaluate(({ jackId, teamId }) => Hub.offerForm(jackId, teamId), seed);
    await page.waitForSelector('#hub-offer-form');
    await page.fill('#ho-salary', '300');
    await page.click('#hub-offer-form button[type=submit]');
    await toast(/Negotiation opened/);
    await signIn('jack@example.com');
    const negId = await page.evaluate(async () => (await DB.list('negotiations', { force: true })).find(n => n.status === 'open').id);
    await page.evaluate((id) => Deals.room(id), negId);
    await page.waitForSelector('#deal-accept');
    await page.click('#deal-accept');
    await toast(/Contract signed/);
    log('✅', 'Seeded: Omega Racing (Kara) with Jack Speed on a $300/race contract');

    /* ---- 2. GM unlock registers the uid for the firestore.rules isGM() gate ---- */
    await gmSignIn();
    const gmReg = await page.evaluate(async () => {
        const uid = Auth.uid();
        const snap = await SRMPC.db.collection('config').doc('admin').get();
        return { uid, listed: snap.exists && (snap.data().gmUids || []).includes(uid) };
    });
    log(gmReg.listed ? '✅' : '❌', 'GM unlock wrote this uid into config/admin.gmUids (rules isGM() registry)');

    /* ---- 3. GM Override tab: wallet with ledger audit ---- */
    await page.evaluate(() => App.go('admin'));
    await page.waitForSelector('[data-admin-tab="override"]');
    await page.click('[data-admin-tab="override"]');
    await page.waitForSelector('#ov-wallet-user');
    const jackUid = await page.evaluate(async () => (await DB.users({ force: true })).find(u => u.displayName === 'Jack').id);
    await page.selectOption('#ov-wallet-user', jackUid);
    await page.selectOption('#ov-wallet-op', 'set');
    await page.fill('#ov-wallet-amt', '123450');
    await page.fill('#ov-wallet-why', 'stewards compensation');
    await page.click('#ov-wallet-go');
    await toast(/Wallet updated/);
    const wallet = await page.evaluate(async (uid) => {
        const u = await DB.get('users', uid, { force: true });
        const row = (await DB.list('ledger', { force: true })).find(t => t.uid === uid && t.icon === '🔧');
        return { balance: Number(u.balance), ledger: row?.label || '' };
    }, jackUid);
    log(wallet.balance === 123450 && /stewards compensation/.test(wallet.ledger) ? '✅' : '❌',
        `Wallet set to exactly $${wallet.balance} with an audited 🔧 ledger row`);

    /* ---- 4. Cascading renames: team + driver, denormalized names follow ---- */
    await page.selectOption('#ov-team', seed.teamId);
    await page.fill('#ov-team-name', 'Omega GP');
    await page.click('#ov-team-go');
    await toast(/cascaded to contracts/);
    await page.waitForSelector('#ov-driver');
    await page.selectOption('#ov-driver', seed.jackId);
    await page.fill('#ov-driver-name', 'Jack Swift');
    await page.click('#ov-driver-go');
    await toast(/cascaded everywhere/);
    const renamed = await page.evaluate(async ({ teamId, jackId }) => {
        const team = await DB.get('teams', teamId, { force: true });
        const driver = await DB.get('drivers', jackId, { force: true });
        const c = (await DB.contracts({ force: true })).find(x => x.teamId === teamId && x.status === 'active');
        return { team: team.name, driver: driver.name, cTeam: c.teamName, cPerson: c.personName };
    }, seed);
    log(renamed.team === 'Omega GP' && renamed.cTeam === 'Omega GP'
        && renamed.driver === 'Jack Swift' && renamed.cPerson === 'Jack Swift' ? '✅' : '❌',
        `Renames cascaded into the contract (${renamed.cPerson} ⇄ ${renamed.cTeam})`);
    await shot('27-gm-override');

    /* ---- 5. Contract override: edit terms, then force a status change ---- */
    await page.waitForSelector('#ov-contract');
    await page.fill('#ov-c-salary', '999');
    await page.click('#ov-c-save');
    await toast(/Contract updated/);
    let c = await page.evaluate(async (teamId) =>
        (await DB.contracts({ force: true })).find(x => x.teamId === teamId && x.status === 'active'), seed.teamId);
    log(c.salary === 999 ? '✅' : '❌', `GM rewrote the salary to $${c.salary}/race — no negotiation, no cap`);
    await page.waitForSelector('#ov-contract');
    await page.selectOption('#ov-c-status', 'terminated');
    await page.click('#ov-c-save');
    await toast(/Contract updated/);
    const after = await page.evaluate(async ({ teamId, jackId }) => {
        const c = (await DB.contracts({ force: true })).find(x => x.teamId === teamId);
        const d = await DB.get('drivers', jackId, { force: true });
        return { status: c.status, teamId: d.teamId };
    }, seed);
    log(after.status === 'terminated' && after.teamId === null ? '✅' : '❌',
        `Forced status → ${after.status}, and the driver's team links were repaired (free agent)`);

    /* ---- 6. Raw document editor: edit any field in any collection, delete docs ---- */
    await page.selectOption('#ov-coll', 'teams');
    await page.click('#ov-coll-load');
    await page.waitForFunction(() => document.querySelector('#ov-doc')?.options.length > 0);
    await page.selectOption('#ov-doc', seed.teamId);
    const json = await page.evaluate(() => JSON.parse(document.getElementById('ov-json').value));
    json.description = 'Rewritten by the league office.';
    json.color = '#ff00ff';
    await page.fill('#ov-json', JSON.stringify(json, null, 2));
    await page.click('#ov-doc-save');
    await toast(/Document saved/);
    const team = await page.evaluate(async (id) => DB.get('teams', id, { force: true }), seed.teamId);
    log(team.description === 'Rewritten by the league office.' && team.color === '#ff00ff' ? '✅' : '❌',
        'Raw editor rewrote arbitrary fields on a team document');

    const junkId = await page.evaluate(async () => DB.create('news', { icon: '🧪', message: 'junk to delete', date: Util.todayISO() }));
    await page.selectOption('#ov-coll', 'news');
    await page.click('#ov-coll-load');
    await page.waitForFunction(() => document.querySelector('#ov-doc')?.options.length > 0);
    await page.selectOption('#ov-doc', junkId);
    await page.click('#ov-doc-del');
    await toast(/Document deleted/);
    const gone = await page.evaluate(async (id) => (await DB.get('news', id, { force: true })) === null, junkId);
    log(gone ? '✅' : '❌', 'Raw editor deleted a document outright');

    await browser.close();
    const fails = steps.filter(s => s.startsWith('❌'));
    console.log(`\n${steps.length - fails.length}/${steps.length} steps passed`);
    if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
})().catch(e => { console.error('❌ DRIVE CRASHED:', e); process.exit(1); });
