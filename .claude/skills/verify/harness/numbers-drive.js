/* Drive the Car Number Acquisition & Bidding system on the shim:
   series-scoped registry, blind sealed-bid auction with charge-the-winner-at-
   close (+ cascade when the top bidder can't pay), 5★ driver gate, team charter,
   race-signup validation via holdsNumber, use-it-or-lose-it season revocation,
   first-right-of-refusal renewal, and the bankruptcy surrender hook. */
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
    const toast = async (re) => {
        await page.waitForFunction(s => new RegExp(s).test(document.getElementById('toast-holder')?.innerText || ''), re.source, { timeout: 30000 });
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

    /* ---- Seed: a series + two teams (with budgets) + a low-star driver ---- */
    await page.evaluate(async () => {
        const db = SRMPC.db;
        await db.collection('series').doc('s-cup').set({ name: 'Cup Series', numberMax: 99, status: 'active', pointsSystem: 'f1' });
        await db.collection('teams').doc('t-omega').set({ name: 'Omega', ownerUid: 'u-a', budget: 40000 });
        await db.collection('teams').doc('t-delta').set({ name: 'Delta', ownerUid: 'u-b', budget: 3000 });
        await db.collection('drivers').doc('d-rook').set({ name: 'Rookie', ownerUid: 'u-c', teamId: 't-omega' });
        DB.invalidate();
    });

    /* ---- 1. Series-scoped registry: #24 in two series are separate assets ---- */
    const scoped = await page.evaluate(async () => {
        await Numbers.openAuction('s-cup', 24, 'season1');
        const a = await DB.get('numberRegistry', Numbers.regId('s-cup', 24), { force: true });
        const other = await DB.get('numberRegistry', Numbers.regId('s-feeder', 24), { force: true });
        return { cupStatus: a?.status, otherExists: !!other };
    });
    log(scoped.cupStatus === 'auction' && !scoped.otherExists ? '✅' : '❌',
        '#24 auction opened in Cup Series only — a different series\' #24 is untouched (series-scoped)');

    /* ---- 2. Blind sealed-bid + charge-winner-at-close with cascade ---- */
    const auction = await page.evaluate(async () => {
        await DB.loadWorld(true); await DB.users({ force: true });
        // Omega (40k) outbids Delta, but a THIRD phantom bid of 999999 from a
        // broke wallet should cascade past to the real top payable bid.
        await Numbers.placeBid('s-cup', 24, { bidderType: 'team', bidderId: 't-delta', bidderUid: 'u-b', amount: 2000 });
        await Numbers.placeBid('s-cup', 24, { bidderType: 'team', bidderId: 't-omega', bidderUid: 'u-a', amount: 8000 });
        await DB.create('numberBids', { auctionId: (await DB.get('numberRegistry', Numbers.regId('s-cup', 24), { force: true })).auctionId,
            seriesId: 's-cup', number: 24, bidderType: 'team', bidderId: 't-broke', bidderUid: 'u-z', amount: 999999, status: 'pending' });
        const win = await Numbers.resolveAuction('s-cup', 24);
        const reg = await DB.get('numberRegistry', Numbers.regId('s-cup', 24), { force: true });
        const omega = await DB.get('teams', 't-omega', { force: true });
        const ledger = (await DB.list('ledger', { force: true })).some(l => l.walletId === 't-omega' && /Won #24/.test(l.label || ''));
        return { winId: win?.bidderId, winAmt: win?.amount, status: reg.status, owner: reg.ownerId, teamNumber: omega.number, budget: Number(omega.budget), ledger };
    });
    log(auction.winId === 't-omega' && auction.winAmt === 8000 && auction.status === 'owned' && auction.teamNumber === 24 ? '✅' : '❌',
        `Blind auction: broke $999999 bid cascaded, Omega won at $8000 → owns #24 (team.number=${auction.teamNumber})`);
    log(auction.budget === 32000 && auction.ledger ? '✅' : '❌',
        `Winner charged at close: Omega budget 40000→${auction.budget} with a paired 🔢 ledger row`);

    /* ---- 3. 5★ gate: a low-prestige driver can't hold a personal number ---- */
    const gate = await page.evaluate(async () => {
        await Numbers.openAuction('s-cup', 7, 'season1');
        try { await Numbers.placeBid('s-cup', 7, { bidderType: 'driver', bidderId: 'd-rook', bidderUid: 'u-c', amount: 500 }); return 'allowed'; }
        catch (e) { return e.message; }
    });
    log(/5★/.test(gate) ? '✅' : '❌', 'A sub-5★ driver is blocked from bidding on a personal number');

    /* ---- 4. Race-signup validation: holdsNumber ---- */
    const holds = await page.evaluate(async () => ({
        omega24: await Numbers.holdsNumber('team', 't-omega', 's-cup', 24),
        delta24: await Numbers.holdsNumber('team', 't-delta', 's-cup', 24)
    }));
    log(holds.omega24 === true && holds.delta24 === false ? '✅' : '❌',
        'holdsNumber validates the active lease: Omega holds #24, Delta does not');

    /* ---- 5. Use-it-or-lose-it: fielded once survives rollover; never-fielded is revoked ---- */
    const rollover = await page.evaluate(async () => {
        await DB.loadWorld(true); await DB.users({ force: true });
        // #24 (Omega) gets fielded via a completed race; #30 (Delta) never does.
        await Numbers.openAuction('s-cup', 30, 'season1');
        await Numbers.placeBid('s-cup', 30, { bidderType: 'team', bidderId: 't-delta', bidderUid: 'u-b', amount: 1000 });
        await Numbers.resolveAuction('s-cup', 30);
        const race = { id: 'r1', seriesId: 's-cup', status: 'completed', results: [{ driverId: 'd-rook' }] };
        await Numbers.recordFielded(race, await DB.loadWorld(true));   // Rookie drives for Omega → #24 fielded
        const roll = await Numbers.processSeasonRollover('s-cup', 'season2');
        const reg24 = await DB.get('numberRegistry', Numbers.regId('s-cup', 24), { force: true });
        const reg30 = await DB.get('numberRegistry', Numbers.regId('s-cup', 30), { force: true });
        return { revoked: roll.revoked, renewals: roll.renewals, n24: reg24.status, n30: reg30.status, n30owner: reg30.ownerId };
    });
    log(rollover.n24 === 'renewal' && rollover.n30 === 'available' && rollover.n30owner === null ? '✅' : '❌',
        `Season rollover: fielded #24 → renewal window; never-fielded #30 revoked (revoked=${rollover.revoked})`);

    /* ---- 6. First right of refusal: owner renews #24 ---- */
    const renew = await page.evaluate(async () => {
        await DB.loadWorld(true); await DB.users({ force: true });
        const before = Number((await DB.get('teams', 't-omega', { force: true })).budget);
        await Numbers.renew('s-cup', 24);
        const reg = await DB.get('numberRegistry', Numbers.regId('s-cup', 24), { force: true });
        const after = Number((await DB.get('teams', 't-omega', { force: true })).budget);
        return { status: reg.status, paid: before - after };
    });
    log(renew.status === 'owned' && renew.paid === 2000 ? '✅' : '❌',
        `Renewal (first right of refusal): #24 back to owned, lease fee $${renew.paid} charged`);

    /* ---- 7. Bankruptcy surrender hook lights up + refunds the team ---- */
    const surrender = await page.evaluate(async () => {
        await DB.loadWorld(true); await DB.users({ force: true });
        const available = Insolvency.numbersAvailable();
        const before = Number((await DB.get('teams', 't-omega', { force: true })).budget);
        const refunded = await Numbers.surrenderForTeam('t-omega');
        const reg = await DB.get('numberRegistry', Numbers.regId('s-cup', 24), { force: true });
        const after = Number((await DB.get('teams', 't-omega', { force: true })).budget);
        return { available, refunded, status: reg.status, gained: after - before };
    });
    log(surrender.available && surrender.status === 'available' && surrender.refunded > 0 && surrender.gained === surrender.refunded ? '✅' : '❌',
        `Insolvency.numbersAvailable()=true; surrender returned #24 to the pool, refunded ${surrender.refunded} to the team`);

    await browser.close();
    const fails = steps.filter(s => s.startsWith('❌'));
    console.log(`\n${steps.length - fails.length}/${steps.length} steps passed`);
    if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
})().catch(e => { console.error('❌ DRIVE CRASHED:', e); process.exit(1); });
