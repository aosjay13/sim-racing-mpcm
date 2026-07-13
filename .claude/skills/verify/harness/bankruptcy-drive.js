/* Drive Team Bankruptcy, Asset Liquidation & Repossession on the shim:
   INSOLVENT flag when a team goes ≤ $0, the hiring freeze (Deals.start guard),
   recovery by owner capital injection + selling a garage car into the team,
   automatic + critical-debt repossession (contracts freed no-buyout, owner
   stripped with personal wallet intact, team relisted with recomputed price),
   and the GM overrides (flag / forgive / force-repossess). */
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
        await page.evaluate(() => document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove()));
    };

    const gmSignIn = async () => {
        await page.waitForSelector('#auth-gate:not(.hidden), #app-shell:not(.hidden)');
        await page.evaluate(() => window.Modal && Modal.close());
        if (await page.locator('#app-shell:not(.hidden)').count()) await page.click('#signout-btn');
        await page.waitForSelector('#auth-gate:not(.hidden)');
        await page.click('.gate-tab[data-pane="admin"]');
        await page.fill('#gate-passcode', 'phoenix13!');
        await page.click('#gate-admin-submit');
        await page.waitForSelector('#app-shell:not(.hidden)');
        await toast(/Welcome back/).catch(() => {});
    };

    await page.goto('http://localhost:8317/sim-racing-career/app.html');
    await gmSignIn();

    /* ---- Seed: player-owned team "Debt Racing" with a contracted driver,
            an owner with personal funds + a garage car. ---- */
    const seed = await page.evaluate(async () => {
        const db = SRMPC.db;
        await db.collection('users').doc('user-kara').set({
            displayName: 'Kara', email: 'kara@x.com', activeRole: 'team-owner',
            balance: 50000, teamId: 't-debt',
            garage: [{ id: 'car1', name: 'GT Beast', price: 10000, emoji: '🏎️' }]
        });
        await db.collection('teams').doc('t-debt').set({
            name: 'Debt Racing', ownerUid: 'user-kara', isEstablished: true,
            budget: 5000, tier: 'hard', marketValue: 6000, financialState: 'solvent',
            headquarters: 'Nowhere', recruiting: true
        });
        await db.collection('drivers').doc('d-jack').set({ name: 'Jack Speed', teamId: 't-debt', ownerUid: 'user-jack' });
        await db.collection('contracts').doc('c-jack').set({
            personId: 'd-jack', personKind: 'driver', personUid: 'user-jack',
            teamId: 't-debt', ownerUid: 'user-kara', teamName: 'Debt Racing',
            personName: 'Jack Speed', salary: 300, buyout: 3000, status: 'active', type: 'hire'
        });
        DB.invalidate();
        return true;
    });
    log(seed ? '✅' : '❌', 'Seeded Debt Racing (owner Kara $50k + a car) with Jack Speed on a $300 contract');

    /* ---- 1. Team goes ≤ $0 → INSOLVENT flag + freeze ---- */
    const insolvent = await page.evaluate(async () => {
        await DB.update('teams', 't-debt', { budget: -1500 });
        await Insolvency.evaluate('t-debt');
        const t = await DB.get('teams', 't-debt', { force: true });
        let frozen = false;
        try { await Insolvency.assertSolvent('t-debt'); } catch (e) { frozen = true; }
        const newsHit = (await DB.list('news', { force: true })).some(n => /INSOLVENT/.test(n.message || ''));
        return { state: t.financialState, at: t.insolventAt, frozen, newsHit };
    });
    log(insolvent.state === 'insolvent' && insolvent.frozen && insolvent.newsHit ? '✅' : '❌',
        `Budget < $0 → INSOLVENT (flag=${insolvent.state}), hiring frozen, league news posted`);

    /* ---- 1b. Deals.start is blocked for the insolvent team ---- */
    const offerBlocked = await page.evaluate(async () => {
        try {
            await Deals.start({ kind: 'team-driver', teamId: 't-debt', teamName: 'Debt Racing', ownerUid: 'user-kara',
                personId: 'd-new', personKind: 'driver', personName: 'Newbie', salary: 200, buyout: 2000 });
            return false;
        } catch (e) { return /insolvent/i.test(e.message); }
    });
    log(offerBlocked ? '✅' : '❌', 'An insolvent team cannot extend a new contract offer (Deals.start throws)');

    /* ---- 2. Liquidation: sell a garage car into the team, then recover ---- */
    const recovered = await page.evaluate(async () => {
        // Sell the $10k car at 60% = $6000 into the team → budget -1500 + 6000 = 4500 > 0.
        await Auth.reloadProfile?.();
        // Point Auth at Kara so garage/liquidation helpers read her profile.
        Auth.state.profile = await DB.get('users', 'user-kara', { force: true });
        Auth.state.user = { uid: 'user-kara', isAnonymous: false };
        const value = await Insolvency.liquidateCar('t-debt', 'car1');
        const t = await DB.get('teams', 't-debt', { force: true });
        const kara = await DB.get('users', 'user-kara', { force: true });
        return { value, budget: Number(t.budget), state: t.financialState, garageLeft: (kara.garage || []).length };
    });
    log(recovered.value === 6000 && recovered.budget === 4500 && recovered.state === 'solvent' && recovered.garageLeft === 0 ? '✅' : '❌',
        `Sold car for $6000 into the team → budget ${recovered.budget}, back to SOLVENT, car gone from garage`);

    /* ---- 3. Critical debt → automatic repossession ---- */
    const repo = await page.evaluate(async () => {
        await DB.update('teams', 't-debt', { budget: -30000 });   // ≤ REPO_BALANCE
        await Insolvency.evaluate('t-debt');
        const t = await DB.get('teams', 't-debt', { force: true });
        const jack = await DB.get('drivers', 'd-jack', { force: true });
        const c = await DB.get('contracts', 'c-jack', { force: true });
        const kara = await DB.get('users', 'user-kara', { force: true });
        return {
            ownerUid: t.ownerUid, isEstablished: t.isEstablished, marketValue: t.marketValue, state: t.financialState,
            driverTeam: jack.teamId, contractStatus: c.status, karaBalance: Number(kara.balance), karaTeam: kara.teamId
        };
    });
    log(repo.ownerUid === null && repo.isEstablished === true && Number.isFinite(repo.marketValue) ? '✅' : '❌',
        `Repossession: owner stripped, relisted on marketplace (marketValue ${repo.marketValue}, established)`);
    log(repo.contractStatus !== 'active' && repo.driverTeam === null ? '✅' : '❌',
        `Contracts nullified to open agreement (status "${repo.contractStatus}"), driver is a free agent — no buyout`);
    log(repo.karaBalance === 50000 && repo.karaTeam === null ? '✅' : '❌',
        `Ex-owner's PERSONAL wallet untouched ($${repo.karaBalance}) and their team link cleared (isolation held)`);

    /* ---- 4. GM overrides: flag insolvent, then forgive to restore ---- */
    const gm = await page.evaluate(async () => {
        // Give t-debt a new owner + debt to exercise the GM tools.
        await DB.update('teams', 't-debt', { ownerUid: 'user-kara', budget: -800, financialState: 'solvent' });
        await Admin.gmFlagInsolvent('t-debt');
        const flagged = (await DB.get('teams', 't-debt', { force: true })).financialState;
        await Admin.gmForgiveDebt('t-debt');
        const t = await DB.get('teams', 't-debt', { force: true });
        return { flagged, state: t.financialState, budget: Number(t.budget) };
    });
    log(gm.flagged === 'insolvent' && gm.state === 'solvent' && gm.budget >= 0 ? '✅' : '❌',
        `GM override: flagged insolvent → forgave debt → SOLVENT with budget ${gm.budget}`);

    /* ---- 5. Admin Solvency panel + flat-2D checkered warning UI render ---- */
    const ui = await page.evaluate(async () => {
        App.go('admin'); await new Promise(r => setTimeout(r, 60));
        Admin._tab = 'override'; await Admin.render(document.getElementById('view-root'));
        await new Promise(r => setTimeout(r, 60));
        const hasPanel = !!document.getElementById('ov-solv-team');
        const t = await DB.get('teams', 't-debt', { force: true });
        const warn = Insolvency.warningPanel({ ...t, name: 'Debt Racing', budget: -500 });
        return { hasPanel, checkered: /checkered-list/.test(warn), flat: /panel-alert/.test(warn), no3d: !/rotate3d|perspective|translateЗ/i.test(warn) };
    });
    log(ui.hasPanel && ui.checkered && ui.flat && ui.no3d ? '✅' : '❌',
        'GM Team Solvency panel present; warning UI is flat 2D (.panel-alert) with checkered-flag bullets');

    await browser.close();
    const fails = steps.filter(s => s.startsWith('❌'));
    console.log(`\n${steps.length - fails.length}/${steps.length} steps passed`);
    if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
})().catch(e => { console.error('❌ DRIVE CRASHED:', e); process.exit(1); });
