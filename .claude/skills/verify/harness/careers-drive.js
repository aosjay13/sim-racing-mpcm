/* Drive multiple isolated Career Modes through the real UI on the shim:
   create a 2nd career in GM Settings, switch between careers, prove data
   isolation (each career's collections are namespaced c__{id}__*), reset a
   career (wipe world, keep shell), and delete a career entirely. */
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
    const shot = async (n) => { await page.waitForTimeout(600); await page.screenshot({ path: path.join(__dirname, n + '.png') }); };

    const signOut = async () => {
        await page.waitForSelector('#auth-gate:not(.hidden), #app-shell:not(.hidden)');
        await page.evaluate(() => window.Modal && Modal.close());
        if (await page.locator('#app-shell:not(.hidden)').count()) await page.click('#signout-btn');
        await page.waitForSelector('#auth-gate:not(.hidden)');
    };
    const gmSignIn = async () => {
        await signOut();
        // Always unlock the default career (owner) — select it if the picker is up.
        if (await page.locator('#gate-career-field:not(.hidden)').count()) await page.selectOption('#gate-career', 'main');
        await page.click('.gate-tab[data-pane="admin"]');
        await page.fill('#gate-passcode', 'phoenix13!');
        await page.click('#gate-admin-submit');
        await page.waitForSelector('#app-shell:not(.hidden)');
        await toast(/Welcome back/).catch(() => {});
    };
    const gmSignInCareer = async (careerId, passcode) => {
        await signOut();
        await page.waitForSelector('#gate-career-field:not(.hidden)');
        await page.selectOption('#gate-career', careerId);
        await page.click('.gate-tab[data-pane="admin"]');
        await page.fill('#gate-passcode', passcode);
        await page.click('#gate-admin-submit');
        await page.waitForSelector('#app-shell:not(.hidden)');
        await toast(/Welcome back/).catch(() => {});
    };

    await page.goto('http://localhost:8317/sim-racing-career/app.html');

    /* ---- 1. Seed a driver in the default ("main") career ---- */
    await gmSignIn();
    await page.evaluate(async () => {
        await DB.create('drivers', { name: 'Main Career Driver', teamId: null });
    });
    const mainSeed = await page.evaluate(async () => (await DB.drivers({ force: true })).map(d => d.name));
    log(mainSeed.includes('Main Career Driver') ? '✅' : '❌',
        `Default career "${await page.evaluate(() => Careers.nameFor('main'))}" seeded with a driver`);

    /* ---- 2. Create a 2nd career through the GM Settings UI ---- */
    await page.evaluate(() => App.go('admin'));
    await page.waitForSelector('[data-admin-tab="settings"]');
    await page.click('[data-admin-tab="settings"]');
    await page.waitForSelector('#career-create-form');
    await page.fill('#cc-name', 'Test League');
    await page.fill('#cc-pass', 'league1');
    await page.fill('#cc-pass2', 'league1');
    await page.click('#career-create-form button[type=submit]');
    await toast(/created/);
    const registered = await page.evaluate(async () => {
        const list = await Careers.list({ force: true });
        const c = list.find(x => x.name === 'Test League');
        return { exists: !!c, id: c?.id, hasHash: !!c?.passcodeHash };
    });
    log(registered.exists && registered.hasHash && registered.id !== 'main' ? '✅' : '❌',
        `"Test League" written to the careers registry with its own passcode (id ${registered.id})`);
    await shot('30-career-settings');
    const newId = registered.id;

    /* ---- 3. Switch to the new career — it starts EMPTY (isolation) ---- */
    await page.evaluate((id) => App.switchCareer(id), newId);
    await toast(/Now in/);
    await page.waitForSelector('#app-shell:not(.hidden)');
    const emptyWorld = await page.evaluate(async () => ({
        drivers: (await DB.drivers({ force: true })).length,
        active: Careers.activeId,
        switcher: document.querySelector('#career-switch-btn .career-switch-name')?.textContent
    }));
    log(emptyWorld.drivers === 0 && emptyWorld.active === newId && emptyWorld.switcher === 'Test League' ? '✅' : '❌',
        `Test League starts with 0 drivers; header switcher reads "${emptyWorld.switcher}"`);

    /* ---- 4. Write data in Test League — lands in a namespaced collection ---- */
    await page.evaluate(async () => { await DB.create('drivers', { name: 'Test League Driver', teamId: null }); });
    const namespaced = await page.evaluate((id) => ({
        count: window.__shimStore.get(`c__${id}__drivers`)?.size || 0,
        leakedToMain: Array.from(window.__shimStore.get('drivers')?.values() || []).some(d => d.name === 'Test League Driver')
    }), newId);
    log(namespaced.count === 1 && !namespaced.leakedToMain ? '✅' : '❌',
        `Test League's driver stored under c__${newId}__drivers, invisible to the default career`);

    /* ---- 5. Switch back to main — its world is intact, Test League's hidden ---- */
    await page.evaluate(() => App.switchCareer('main'));
    await toast(/Now in/);
    const backInMain = await page.evaluate(async () => {
        const names = (await DB.drivers({ force: true })).map(d => d.name);
        return { hasMain: names.includes('Main Career Driver'), hasTest: names.includes('Test League Driver'), active: Careers.activeId };
    });
    log(backInMain.hasMain && !backInMain.hasTest && backInMain.active === 'main' ? '✅' : '❌',
        'Back in the default career: its driver is intact and Test League\'s is invisible');

    /* ---- 6. The sign-in gate lists both careers ---- */
    await signOut();
    await page.waitForSelector('#gate-career-field:not(.hidden)');
    const gateOptions = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#gate-career option')).map(o => o.textContent));
    log(gateOptions.includes('Phoenix SRMPC') && gateOptions.includes('Test League') ? '✅' : '❌',
        `Sign-in career picker offers both: ${gateOptions.join(', ')}`);
    await shot('31-gate-career-picker');

    /* ---- 7. Reset Test League: wipe world, keep the shell ---- */
    await gmSignIn();
    await page.evaluate((id) => App.switchCareer(id), newId);
    await toast(/Now in/);
    await page.evaluate(async () => { await DB.create('teams', { name: 'Doomed Team' }); });
    const wiped = await page.evaluate(async (id) => {
        await DB.wipeCareer(id);
        const drivers = (await DB.drivers({ force: true })).length;
        const teams = (await DB.teams({ force: true })).length;
        const stillRegistered = (await Careers.list({ force: true })).some(c => c.id === id);
        return { drivers, teams, stillRegistered };
    }, newId);
    log(wiped.drivers === 0 && wiped.teams === 0 && wiped.stillRegistered ? '✅' : '❌',
        'Reset cleared Test League\'s world but kept the career shell in the registry');

    /* ---- 8. Delete Test League entirely ---- */
    const deleted = await page.evaluate(async (id) => {
        Careers.setActive('main', 'Phoenix SRMPC');
        await DB.wipeCareer(id);
        await Careers.deleteCareer(id);
        const gone = !(await Careers.list({ force: true })).some(c => c.id === id);
        const mainSafe = (await DB.drivers({ force: true })).some(d => d.name === 'Main Career Driver');
        return { gone, mainSafe };
    }, newId);
    log(deleted.gone && deleted.mainSafe ? '✅' : '❌',
        'Deleting Test League removed its registry doc; the default career is untouched');

    /* ---- 9. Owner flag: main-career GM is the owner ---- */
    await gmSignIn();
    const ownerFlag = await page.evaluate(() => Auth.isOwner());
    log(ownerFlag ? '✅' : '❌', 'Unlocking the default career makes this GM the league owner (Auth.isOwner)');

    /* ---- 10. Owner creates a sub-career; its GM is NOT the owner ---- */
    const subId = await page.evaluate(async () => Careers.create('Sub League', 'league9'));
    await gmSignInCareer(subId, 'league9');
    const subOwner = await page.evaluate(() => ({ isOwner: Auth.isOwner(), isAdmin: Auth.isAdmin() }));
    log(!subOwner.isOwner && subOwner.isAdmin ? '✅' : '❌', 'A sub-career GM is a Game Master but NOT the owner');

    /* ---- 11. Sub-GM Settings shows the REQUEST form, not a direct create ---- */
    await page.evaluate(() => App.go('admin'));
    await page.waitForSelector('[data-admin-tab="settings"]');
    await page.click('[data-admin-tab="settings"]');
    await page.waitForSelector('#career-create-form');
    const formMode = await page.evaluate(() => document.getElementById('career-create-form').dataset.mode);
    log(formMode === 'request' ? '✅' : '❌', 'Sub-GM sees "Request a new career mode" (approval-gated), not a direct create');

    /* ---- 12. Sub-GM submits a request — no career is created yet ---- */
    await page.fill('#cc-name', 'Requested League');
    await page.fill('#cc-pass', 'req1234');
    await page.fill('#cc-pass2', 'req1234');
    await page.click('#career-create-form button[type=submit]');
    await toast(/owner will review/);
    const afterRequest = await page.evaluate(async () => {
        const reqs = await Careers.listRequests();
        const list = await Careers.list({ force: true });
        return {
            pending: reqs.filter(r => r.status === 'pending' && r.name === 'Requested League').length,
            careerExists: list.some(c => c.name === 'Requested League')
        };
    });
    log(afterRequest.pending === 1 && !afterRequest.careerExists ? '✅' : '❌',
        'Request is pending and the career does NOT exist until the owner approves');

    /* ---- 13. Owner approves — the career now exists ---- */
    await gmSignIn();
    const approved = await page.evaluate(async () => {
        const req = (await Careers.listRequests()).find(r => r.name === 'Requested League' && r.status === 'pending');
        const id = await Careers.approveRequest(req.id);
        const list = await Careers.list({ force: true });
        const reqs = await Careers.listRequests();
        return {
            careerExists: list.some(c => c.id === id && c.name === 'Requested League'),
            reqApproved: reqs.find(r => r.id === req.id)?.status === 'approved'
        };
    });
    log(approved.careerExists && approved.reqApproved ? '✅' : '❌',
        'Owner approval creates the career and marks the request approved');

    /* ---- 14. Owner denies a request — no career is created ---- */
    const denied = await page.evaluate(async () => {
        await Careers.requestCreate('Rejected League', 'nope123');
        const req = (await Careers.listRequests()).find(r => r.name === 'Rejected League' && r.status === 'pending');
        await Careers.denyRequest(req.id);
        const list = await Careers.list({ force: true });
        const status = (await Careers.listRequests()).find(r => r.id === req.id)?.status;
        return { created: list.some(c => c.name === 'Rejected League'), status };
    });
    log(!denied.created && denied.status === 'denied' ? '✅' : '❌',
        'Denying a request creates no career and marks it denied');

    await browser.close();
    const fails = steps.filter(s => s.startsWith('❌'));
    console.log(`\n${steps.length - fails.length}/${steps.length} steps passed`);
    if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
})().catch(e => { console.error('❌ DRIVE CRASHED:', e); process.exit(1); });
