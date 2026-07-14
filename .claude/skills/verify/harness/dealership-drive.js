/* Drive the Dealership & GM Vehicle Creation system:
   the dealershipInventory collection, GM create/edit/unlist/delete via the
   Admin → Dealership tab, the realistic starter pack (idempotent, creates
   game docs), the public storefront with game/series/condition/price
   filters, purchase execution for BOTH wallets (exact price + ledger row +
   garage copy with stats), insufficient-funds rejection, and the flat-2D
   / checkered-icon formatting rules. */
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
    const clearToasts = () => page.evaluate(() => document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove()));

    await page.goto('http://localhost:8317/sim-racing-career/app.html');
    await page.waitForSelector('#auth-gate:not(.hidden), #app-shell:not(.hidden)');
    await page.click('.gate-tab[data-pane="admin"]');
    await page.fill('#gate-passcode', 'phoenix13!');
    await page.click('#gate-admin-submit');
    await page.waitForSelector('#app-shell:not(.hidden)');

    /* ---- Seed a series + buyers ---- */
    await page.evaluate(async () => {
        const db = SRMPC.db;
        await db.collection('series').doc('s-cup').set({ name: 'Phoenix Cup', status: 'active', pointsSystem: 'nascar' });
        await db.collection('users').doc('u-rich').set({ displayName: 'Rich', balance: 60000, walletInitialized: true, driverId: 'd-rich' });
        await db.collection('users').doc('u-poor').set({ displayName: 'Poor', balance: 100, walletInitialized: true, driverId: 'd-poor' });
        await db.collection('users').doc('u-boss').set({ displayName: 'Boss', balance: 5000, walletInitialized: true });
        await db.collection('teams').doc('t-fast').set({ name: 'Fast Co', ownerUid: 'u-boss', budget: 50000 });
        DB.invalidate();
    });

    /* ---- 1. Starter pack: realistic cars per sim, idempotent ---- */
    const pack = await page.evaluate(async () => {
        await Dealership.installStarterPack();
        const inv1 = await Dealership.inventory({ force: true });
        await Dealership.installStarterPack(); // second run must add nothing
        const inv2 = await Dealership.inventory({ force: true });
        const games = await DB.games({ force: true });
        document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove());
        const byGame = (name) => inv1.filter(c => c.gameId === games.find(g => g.name === name)?.id).length;
        return {
            n1: inv1.length, n2: inv2.length,
            games: games.map(g => g.name).sort(),
            wreckfest: byGame('Wreckfest'), gt7: byGame('Gran Turismo 7'), nr2003: byGame('NASCAR Racing 2003 Season'),
            sample: inv1.find(c => c.carId === 'porsche-911-gt3-rs'),
            allHaveStats: inv1.every(c => c.stats && c.stats.performance >= 1 && c.stats.durability >= 1 && c.available === true)
        };
    });
    log(pack.n1 === 20 && pack.n2 === 20 && pack.wreckfest === 3 && pack.gt7 === 4 && pack.nr2003 === 3
        && pack.sample?.price === 115000 && pack.allHaveStats
        && ['Automobilista 2', 'BeamNG.drive', 'Forza Motorsport', 'Gran Turismo 7', 'NASCAR Racing 2003 Season', 'Wreckfest', 'iRacing'].every(g => pack.games.includes(g)) ? '✅' : '❌',
        `Starter pack: ${pack.n1} realistic cars across 7 sims (idempotent re-run stayed ${pack.n2}); game docs auto-created; all carry stats + available`);

    /* ---- 2. GM Creation form: full modal → new inventory doc ---- */
    const created = await page.evaluate(async () => {
        App.go('admin'); Admin._tab = 'dealership';
        await Admin.render(document.getElementById('view-root'));
        await new Promise(r => setTimeout(r, 80));
        const tabPresent = !!document.querySelector('[data-admin-tab="dealership"]');
        await Dealership.gmForm();
        await new Promise(r => setTimeout(r, 80));
        document.getElementById('df-name').value = 'Chevrolet Silverado Truck';
        document.getElementById('df-name').dispatchEvent(new Event('input'));
        const liveId = document.getElementById('df-carid').textContent;
        const games = await DB.games({ force: true });
        document.getElementById('df-game').value = games.find(g => g.name === 'iRacing')?.id || '';
        document.getElementById('df-cond').value = 'used';
        document.getElementById('df-price').value = '31000';
        document.getElementById('df-perf').value = '6';
        document.getElementById('df-durab').value = '9';
        [...document.getElementById('df-series').options].find(o => o.text === 'Phoenix Cup').selected = true;
        document.getElementById('deal-form').dispatchEvent(new Event('submit'));
        await new Promise(r => setTimeout(r, 200));
        const doc = (await Dealership.inventory({ force: true })).find(c => c.carId === 'chevrolet-silverado-truck');
        document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove());
        return { tabPresent, liveId, doc };
    });
    log(created.tabPresent && created.liveId === 'chevrolet-silverado-truck'
        && created.doc && created.doc.condition === 'used' && created.doc.price === 31000
        && created.doc.stats.performance === 6 && created.doc.stats.durability === 9
        && created.doc.seriesIds.length === 1 && created.doc.available === true ? '✅' : '❌',
        `GM created a vehicle via the form (live ID preview "${created.liveId}", used, $31k, 6/9 stats, series-linked)`);

    /* ---- 2b. GM edit: reprice + restat ---- */
    const edited = await page.evaluate(async () => {
        const doc = (await Dealership.inventory({ force: true })).find(c => c.carId === 'chevrolet-silverado-truck');
        await Dealership.gmForm(doc.id);
        await new Promise(r => setTimeout(r, 80));
        document.getElementById('df-price').value = '28500';
        document.getElementById('df-perf').value = '7';
        document.getElementById('deal-form').dispatchEvent(new Event('submit'));
        await new Promise(r => setTimeout(r, 200));
        const after = await DB.get('dealershipInventory', doc.id, { force: true });
        document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove());
        return { price: after.price, perf: after.stats.performance };
    });
    log(edited.price === 28500 && edited.perf === 7 ? '✅' : '❌',
        `GM edited the vehicle: price → $${edited.price}, performance → ${edited.perf}/10`);

    /* ---- 2c. GM unlist: hidden from storefront, kept in catalog ---- */
    const toggled = await page.evaluate(async () => {
        const doc = (await Dealership.inventory({ force: true })).find(c => c.carId === 'chevrolet-silverado-truck');
        await Dealership.gmToggle(doc.id);
        const avail = await Dealership.availableInventory();
        const all = await Dealership.inventory({ force: true });
        await Dealership.gmToggle(doc.id); // relist for later steps
        document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove());
        return { inCatalog: all.some(c => c.id === doc.id), inStore: avail.some(c => c.id === doc.id) };
    });
    log(toggled.inCatalog && !toggled.inStore ? '✅' : '❌',
        'GM unlist pulls the car from the storefront but keeps it in the catalog (relist restores it)');

    /* ---- 3. Storefront: renders with filters, flat 2D + checkered markers ---- */
    const store = await page.evaluate(async () => {
        Auth.state.profile = await DB.get('users', 'u-rich', { force: true });
        Auth.state.user = { uid: 'u-rich', isAnonymous: false };
        Auth.state.mode = 'player';
        Dealership._filters = { gameId: '', seriesId: '', condition: '', sort: 'price-desc' };
        App.go('dealership');
        await new Promise(r => setTimeout(r, 250));
        const el = document.getElementById('view-root');
        const rows = [...el.querySelectorAll('.car-grid .car-card')]; // v3.28.0: storefront is a flat card grid
        const html = el.innerHTML;
        const prices = [...html.matchAll(/market-price">\$?([\d,]+)/g)].map(m => Number(m[1].replace(/,/g, '')));
        return {
            hasFilters: ['deal-f-game', 'deal-f-series', 'deal-f-cond', 'deal-f-sort'].every(id => !!document.getElementById(id)),
            rowCount: rows.length,
            checkered: (html.match(/🏁/g) || []).length > 20,
            flat2d: !/rotate3d|perspective|translateZ|drop-shadow/i.test(html)
                && getComputedStyle(el.querySelector('.car-card')).boxShadow === 'none',
            sortedDesc: prices.every((p, i) => i === 0 || prices[i - 1] >= p)
        };
    });
    log(store.hasFilters && store.rowCount >= 20 && store.checkered && store.flat2d && store.sortedDesc ? '✅' : '❌',
        `Storefront: ${store.rowCount} flat 2D cards, 4 filters, checkered 🏁 markers everywhere, price high→low default (no shadows/3D)`);

    /* ---- 3b. Filters: game + condition + series + sort ---- */
    const filtered = await page.evaluate(async () => {
        const el = document.getElementById('view-root');
        const games = await DB.games({ force: true });
        const gt7 = games.find(g => g.name === 'Gran Turismo 7').id;
        document.getElementById('deal-f-game').value = gt7;
        document.getElementById('deal-f-game').dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 200));
        const gt7Rows = el.querySelectorAll('.car-grid .car-card').length;
        document.getElementById('deal-f-cond').value = 'used';
        document.getElementById('deal-f-cond').dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 200));
        const usedGt7 = [...el.querySelectorAll('.car-grid .car-card')];
        const usedName = usedGt7[0]?.innerText || '';
        // Series filter: reset game/cond, pick Phoenix Cup (only the Silverado).
        document.getElementById('deal-f-game').value = ''; document.getElementById('deal-f-game').dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 200));
        document.getElementById('deal-f-cond').value = ''; document.getElementById('deal-f-cond').dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 200));
        const seriesSel = document.getElementById('deal-f-series');
        seriesSel.value = [...seriesSel.options].find(o => o.text.includes('Phoenix Cup'))?.value || '';
        seriesSel.dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 200));
        const cupRows = [...el.querySelectorAll('.car-grid .car-card')];
        // Sort ascending sanity.
        document.getElementById('deal-f-series').value = ''; document.getElementById('deal-f-series').dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 200));
        document.getElementById('deal-f-sort').value = 'price-asc';
        document.getElementById('deal-f-sort').dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 200));
        const prices = [...document.getElementById('view-root').innerHTML.matchAll(/market-price">\$?([\d,]+)/g)].map(m => Number(m[1].replace(/,/g, '')));
        return { gt7Rows, usedGt7: usedGt7.length, usedName, cupRows: cupRows.length, cupName: cupRows[0]?.innerText || '', ascOk: prices.slice(0, 5).every((p, i, a) => i === 0 || a[i - 1] <= p) };
    });
    log(filtered.gt7Rows === 4 && filtered.usedGt7 === 1 && /MX-5/.test(filtered.usedName)
        && filtered.cupRows === 1 && /Silverado/.test(filtered.cupName) && filtered.ascOk ? '✅' : '❌',
        `Filters work: GT7 → 4 cars; +used → 1 (MX-5); series "Phoenix Cup" → 1 (Silverado); price low→high sort ok`);

    /* ---- 4. Purchase: personal wallet — exact price, ledger row, garage copy ---- */
    const personal = await page.evaluate(async () => {
        const inv = await Dealership.availableInventory();
        const supra = inv.find(c => c.carId === 'toyota-gr-supra-rz'); // $54,000
        await Dealership.buy(supra.id);
        const me = await DB.get('users', 'u-rich', { force: true });
        const rows = (await DB.list('ledger', { force: true })).filter(l => l.uid === 'u-rich');
        const entry = (me.garage || [])[0];
        document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove());
        return { balance: Number(me.balance), entry, mirror: me.garageCarIds, ledger: rows.find(r => /Supra/.test(r.label)) };
    });
    log(personal.balance === 6000 && personal.entry?.carId === 'toyota-gr-supra-rz'
        && personal.entry?.sourceId && personal.entry?.stats?.performance === 7 && personal.entry?.condition === 'new'
        && (personal.mirror || []).includes('toyota-gr-supra-rz')
        && personal.ledger && personal.ledger.amount === -54000 ? '✅' : '❌',
        `Personal buy: exact $54k debited (bal $${personal.balance}), immutable ledger row (−54000), garage copy keeps sourceId + stats, mirror synced`);

    /* ---- 4b. Insufficient personal funds → rejected, nothing changes ---- */
    const broke = await page.evaluate(async () => {
        Auth.state.profile = await DB.get('users', 'u-poor', { force: true });
        Auth.state.user = { uid: 'u-poor', isAnonymous: false };
        const inv = await Dealership.availableInventory();
        await Dealership.buy(inv.find(c => c.carId === 'toyota-gr-supra-rz').id);
        const me = await DB.get('users', 'u-poor', { force: true });
        const toast = document.getElementById('toast-holder')?.innerText || '';
        document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove());
        return { balance: Number(me.balance), cars: (me.garage || []).length, blocked: /Not enough/i.test(toast) };
    });
    log(broke.blocked && broke.balance === 100 && broke.cars === 0 ? '✅' : '❌',
        'Insufficient personal funds: purchase rejected, wallet and garage untouched');

    /* ---- 4c. Team purchase: team budget + team ledger + team garage ---- */
    const teamBuy = await page.evaluate(async () => {
        Auth.state.profile = await DB.get('users', 'u-boss', { force: true });
        Auth.state.user = { uid: 'u-boss', isAnonymous: false };
        const inv = await Dealership.availableInventory();
        const arca = inv.find(c => c.carId === 'arca-menards-chevrolet'); // $26,000 used
        await Dealership.buy(arca.id, 't-fast');
        const t = await DB.get('teams', 't-fast', { force: true });
        const boss = await DB.get('users', 'u-boss', { force: true });
        const row = (await DB.list('ledger', { force: true })).find(l => l.walletType === 'team' && l.walletId === 't-fast' && /ARCA/.test(l.label));
        // And: a too-expensive team buy is rejected.
        let blocked = false;
        try { await Wallet.teamSpend('t-fast', 999999, 'x'); } catch (e) { blocked = true; }
        document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove());
        return { budget: Number(t.budget), entry: (t.garage || [])[0], mirror: t.garageCarIds, bossBal: Number(boss.balance), ledger: row, blocked };
    });
    log(teamBuy.budget === 24000 && teamBuy.entry?.carId === 'arca-menards-chevrolet' && teamBuy.entry?.condition === 'used'
        && (teamBuy.mirror || []).includes('arca-menards-chevrolet') && teamBuy.bossBal === 5000
        && teamBuy.ledger && teamBuy.ledger.amount === -26000 && teamBuy.blocked ? '✅' : '❌',
        `Team buy: exact $26k from TEAM budget ($50k → $${teamBuy.budget}), owner's personal wallet untouched, team ledger row (−26000); overdraft rejected`);

    /* ---- 4d. Only the owner can buy on the team budget ---- */
    const guard = await page.evaluate(async () => {
        Auth.state.profile = await DB.get('users', 'u-rich', { force: true });
        Auth.state.user = { uid: 'u-rich', isAnonymous: false };
        const inv = await Dealership.availableInventory();
        await Dealership.buy(inv[0].id, 't-fast');
        const toast = document.getElementById('toast-holder')?.innerText || '';
        document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove());
        const t = await DB.get('teams', 't-fast', { force: true });
        return { blocked: /Only the team owner/i.test(toast), cars: (t.garage || []).length };
    });
    log(guard.blocked && guard.cars === 1 ? '✅' : '❌', 'Non-owner cannot spend the team budget at the Dealership');

    /* ---- 5. Unlisted car cannot be bought; GM delete removes it ---- */
    const gone = await page.evaluate(async () => {
        const doc = (await Dealership.inventory({ force: true })).find(c => c.carId === 'chevrolet-silverado-truck');
        Auth.state.mode = 'player'; // buyer first…
        await DB.update('dealershipInventory', doc.id, { available: false });
        await Dealership.buy(doc.id);
        const toast = document.getElementById('toast-holder')?.innerText || '';
        document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove());
        Auth.state.mode = 'admin'; // …then back to the GM for curation
        await Dealership.gmDelete(doc.id);
        const left = (await Dealership.inventory({ force: true })).some(c => c.id === doc.id);
        document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove());
        return { blocked: /no longer on the market/i.test(toast), left };
    });
    log(gone.blocked && !gone.left ? '✅' : '❌',
        'Unlisted car refuses purchase ("no longer on the market"); GM delete removes it from the catalog');

    /* ---- 6. GM catalog IDs feed the Schedule Builder hint + eligibility gate end-to-end ---- */
    const e2e = await page.evaluate(async () => {
        await Admin.seriesForm((await DB.series({ force: true })).find(s => s.name === 'Phoenix Cup').id);
        await new Promise(r => setTimeout(r, 100));
        const hint = document.querySelector('#deal-form') ? '' : (document.querySelector('.modal-card')?.innerHTML || '');
        Modal.close();
        // Gate: require the ARCA car for the series; Rich (Supra only) is out,
        // the Fast Co roster would be in via the team garage.
        const sid = (await DB.series({ force: true })).find(s => s.name === 'Phoenix Cup').id;
        await DB.update('series', sid, { carChoices: ['arca-menards-chevrolet'] });
        await SRMPC.db.collection('races').doc('r-cup').set({ seriesId: sid, name: 'Cup R1', track: 'Daytona', date: '2030-05-01', status: 'scheduled', results: [] });
        DB.invalidate();
        const rich = await Garage.validateSeriesEligibility('u-rich', sid, { raceId: 'r-cup' });
        await DB.update('users', 'u-boss', { teamId: 't-fast' });
        const boss = await Garage.validateSeriesEligibility('u-boss', sid, { raceId: 'r-cup' });
        return { hintOk: /toyota-gr-supra-rz/.test(hint), rich: rich.eligible, boss, via: boss.via };
    });
    log(e2e.hintOk && e2e.rich === false && e2e.boss.eligible && e2e.via === 'team' ? '✅' : '❌',
        'End-to-end: catalog IDs appear in the GM series form hint; GM-created carChoices gate entry (Supra owner blocked, ARCA-owning team eligible)');

    await browser.close();
    const fails = steps.filter(s => s.startsWith('❌'));
    console.log(`\n${steps.length - fails.length}/${steps.length} steps passed`);
    if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
})().catch(e => { console.error('❌ DRIVE CRASHED:', e); process.exit(1); });
