/* Drive the Paddock — the between-race RPG layer of the league app
   (js/paddock-core.js, js/srmpc-paddock.js, js/srmpc-paddock-trade.js):
   paddock time + decision cards, the garage (condition, race car, nickname,
   garage upgrade), NPC shop work, DIY, part installs, training + rating,
   side events, personal sponsors (sign / push / objectives), loans, Phoenix
   Motors finance + trade-in, the used lots (inspect, haggle, buy, the
   one-buyer reservation), the Player Market (private sale between players),
   race-day settlement (wear, sponsor pay, loan + finance installments,
   merch, XP, fans, paddock-time refill), the race-window car card with a
   mechanical gremlin, the Mechanic shop (bookings + walk-in diagnosis),
   the Car Dealer role (trade-price stock, AI walk-in buyer, sale to a
   player), team sponsors + the team workshop, Admin → Paddock, and a
   leak / phone-width sweep over every paddock screen.
   Run: node paddock-drive.js   (serve the repo root on :8317 first) */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const steps = [];
const log = (m, s) => { steps.push(`${m} ${s}`); console.log(m, s); };
const shots = path.join(__dirname, 'paddock-shots');
fs.mkdirSync(shots, { recursive: true });

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.route('**/*', r => r.request().url().startsWith('http://localhost:8317')
        ? r.continue() : r.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.addInitScript({ path: path.join(__dirname, 'firebase-shim.js') });
    await page.addInitScript(() => { window.confirm = () => true; window.prompt = () => ''; window.alert = () => {}; });
    page.on('pageerror', e => log('❌', 'pageerror: ' + e.message));
    // Util.notify mirrors error toasts to console.error with an [SRMPC] prefix —
    // those are expected (e.g. the refused second buyer); anything else isn't.
    page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource|\[SRMPC\]/.test(m.text())) log('❌', 'console error: ' + m.text().slice(0, 200)); });

    await page.goto('http://localhost:8317/sim-racing-career/app.html');
    await page.waitForSelector('#auth-gate:not(.hidden), #app-shell:not(.hidden)');
    await page.click('.gate-tab[data-pane="admin"]');
    await page.fill('#gate-passcode', 'phoenix13!');
    await page.click('#gate-admin-submit');
    await page.waitForSelector('#app-shell:not(.hidden)');

    const wait = (ms = 120) => page.waitForTimeout(ms);
    const clearToasts = () => page.evaluate(() => document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove()));
    const toasts = () => page.evaluate(() => document.getElementById('toast-holder')?.innerText || '');
    const actAs = (uid) => page.evaluate(async (uid) => {
        Modal.close(true, true);
        Auth.state.profile = await DB.get('users', uid, { force: true });
        Auth.state.user = { uid, isAnonymous: false };
        Auth.state.mode = 'player';
        DB.invalidate();
    }, uid);
    const asGM = () => page.evaluate(() => {
        Modal.close(true, true);
        Auth.state.profile = null;
        Auth.state.user = { uid: 'anon-gm', isAnonymous: true };
        Auth.state.mode = 'admin';
        DB.invalidate();
    });
    const user = (uid) => page.evaluate((uid) => DB.get('users', uid, { force: true }), uid);
    const leakCheck = (sel = '#view-root') => page.evaluate((sel) => {
        const t = document.querySelector(sel)?.innerText || '';
        return (t.match(/NaN|undefined|\[object [A-Z]|\bnull\b(?! *%)/g) || []);
    }, sel);
    const go = async (view, param) => { await page.evaluate(([v, p]) => App.go(v, p), [view, param || null]); await wait(250); };

    /* ---- Seed: game, series, races, players, team, catalog ---- */
    await page.evaluate(async () => {
        const db = SRMPC.db;
        await db.collection('games').doc('g1').set({ name: 'Assetto Corsa Competizione' });
        await db.collection('series').doc('s1').set({ name: 'Paddock Cup', gameId: 'g1', status: 'active', pointsSystem: 'f1' });
        await db.collection('teams').doc('t-ai').set({ name: 'Rival Racing', seriesId: 's1', ownerUid: null, isNPC: true, budget: 50000 });
        await db.collection('teams').doc('t-own').set({ name: 'Olive Motorsport', seriesId: 's1', ownerUid: 'u-olive', budget: 120000, recruiting: true });
        for (let i = 1; i <= 4; i++) await db.collection('drivers').doc('d-ai' + i).set({ name: 'AI Driver ' + i, teamId: i <= 2 ? 't-ai' : 't-own', rating: 70 + i, isNPC: true });
        await db.collection('races').doc('r1').set({ seriesId: 's1', gameId: 'g1', name: 'Paddock Cup — Monza', track: 'Monza', laps: 20, date: '2030-03-01', status: 'scheduled', round: 1, results: [] });
        await db.collection('races').doc('r2').set({ seriesId: 's1', gameId: 'g1', name: 'Paddock Cup — Spa', track: 'Spa-Francorchamps', laps: 15, date: '2030-03-08', status: 'scheduled', round: 2, results: [] });
        await db.collection('races').doc('r3').set({ seriesId: 's1', gameId: 'g1', name: 'Paddock Cup — Suzuka', track: 'Suzuka', laps: 18, date: '2030-03-15', status: 'scheduled', round: 3, results: [] });
        await db.collection('users').doc('u-ann').set({ displayName: 'Ann', balance: 150000, walletInitialized: true, difficulty: 'easy', activeRole: 'driver', driverId: 'd-ann' });
        await db.collection('drivers').doc('d-ann').set({ name: 'Ann Apex', ownerUid: 'u-ann', teamId: null, status: 'approved' });
        await db.collection('users').doc('u-bob').set({ displayName: 'Bob', balance: 90000, walletInitialized: true, difficulty: 'medium', activeRole: 'driver', driverId: 'd-bob' });
        await db.collection('drivers').doc('d-bob').set({ name: 'Bob Brake', ownerUid: 'u-bob', teamId: null, status: 'approved' });
        await db.collection('users').doc('u-mia').set({ displayName: 'Mia', balance: 2000, walletInitialized: true, difficulty: 'medium', activeRole: 'mechanic' });
        await db.collection('roleProfiles').doc('rp-mia').set({ name: 'Mia Spanner', role: 'mechanic', uid: 'u-mia', prestige: 3, teamId: 't-own' });
        await db.collection('users').doc('u-dave').set({ displayName: 'Dave', balance: 80000, walletInitialized: true, difficulty: 'medium', activeRole: 'car-dealer' });
        await db.collection('roleProfiles').doc('rp-dave').set({ name: 'Dave Deals', role: 'car-dealer', uid: 'u-dave', prestige: 1 });
        await db.collection('users').doc('u-olive').set({ displayName: 'Olive', balance: 30000, walletInitialized: true, difficulty: 'medium', activeRole: 'team-owner', roleDifficulty: { 'team-owner': 'medium' } });
        DB.invalidate();
        await Dealership.installStarterPack();
        document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove());
    });

    /* ---- 1. Admin → Paddock renders; settings save ---- */
    const admin = await page.evaluate(async () => {
        App.go('admin', 'paddock');
        await new Promise(r => setTimeout(r, 300));
        const has = !!document.getElementById('pd-admin');
        document.getElementById('pda-econ').value = '1.5';
        document.getElementById('pd-admin').dispatchEvent(new Event('submit'));
        await new Promise(r => setTimeout(r, 300));
        const cfg = await Paddock.config(true);
        await Paddock.saveConfig({ econ: 1 });
        return { has, econ: cfg.econ, tab: !!document.querySelector('[data-admin-tab="paddock"]') };
    });
    log(admin.has && admin.tab && admin.econ === 1.5 ? '✅' : '❌', `Admin → 🅿️ Paddock renders and saves settings (money ×${admin.econ})`);
    await clearToasts();

    /* ---- 2. Player enters the paddock: card drawn, offers, paddock time ---- */
    await actAs('u-ann');
    await go('paddock', 'overview');
    const ov = await page.evaluate(() => {
        const t = document.getElementById('view-root').innerText;
        const p = Auth.state.profile.paddock;
        return { nav: !!document.querySelector('.nav-btn[data-view="paddock"]'), card: !!p?.card, offers: p?.offers?.length || 0, ap: /⏱ 10\/10/.test(t), choices: document.querySelectorAll('.pd-choice').length, tabs: document.querySelectorAll('[data-pd-tab]').length };
    });
    const ovLeaks = await leakCheck();
    log(ov.nav && ov.card && ov.offers >= 3 && ov.ap && ov.choices >= 2 && ov.tabs === 7 && !ovLeaks.length ? '✅' : '❌',
        `Paddock overview: 7 tabs, a decision card with ${ov.choices} choices, ${ov.offers} sponsor offers, ⏱ 10/10${ovLeaks.length ? ' — leaks: ' + ovLeaks.join(',') : ''}`);
    await page.screenshot({ path: path.join(shots, '01-overview.png'), fullPage: true });

    /* ---- 3. Phoenix Motors: finance a new car (20% down, 12 installments, warranty) ---- */
    const fin = await page.evaluate(async () => {
        const inv = await Dealership.inventory({ force: true });
        const car = inv.find(c => c.carId === 'porsche-992-gt3-cup');
        const before = Economy.balance();
        await PaddockTrade.dealModal(car.id);
        await new Promise(r => setTimeout(r, 150));
        document.getElementById('pd-dl-pay').value = 'finance';
        document.getElementById('pd-dl-pay').dispatchEvent(new Event('change'));
        const summary = document.getElementById('pd-dl-sum').innerText;
        document.getElementById('pd-deal').dispatchEvent(new Event('submit'));
        await new Promise(r => setTimeout(r, 400));
        const u = await DB.get('users', 'u-ann', { force: true });
        const entry = (u.garage || []).find(c => c.carId === 'porsche-992-gt3-cup');
        return { before, after: u.balance, entry, raceCar: u.paddock?.raceCar, summary };
    });
    log(fin.entry && fin.entry.finance && fin.entry.finance.perRace > 0 && fin.entry.warranty === 5 && fin.before - fin.after === 19600
        && fin.raceCar === fin.entry.id && fin.entry.cond?.engine === 100 && /Due today/.test(fin.summary) ? '✅' : '❌',
        `Financed a $98k Porsche: $${fin.before - fin.after} down, ${fin.entry?.finance?.racesLeft} × $${fin.entry?.finance?.perRace}, 5-race warranty, set as race car`);
    await clearToasts();

    /* ---- 4. Trade-in: a cheap car traded toward another ---- */
    const trade = await page.evaluate(async () => {
        const inv = await Dealership.inventory({ force: true });
        await Dealership.buy(inv.find(c => c.carId === 'mazda-mx-5-nd').id);
        const mx5 = Market.myGarage().find(c => c.carId === 'mazda-mx-5-nd');
        const tradeVal = PaddockCore.tradeInValue(mx5);
        const before = Economy.balance();
        await PaddockTrade.dealModal(inv.find(c => c.carId === 'bmw-m4-competition').id);
        await new Promise(r => setTimeout(r, 150));
        const sel = document.getElementById('pd-dl-trade');
        sel.value = mx5.id; sel.dispatchEvent(new Event('change'));
        document.getElementById('pd-deal').dispatchEvent(new Event('submit'));
        await new Promise(r => setTimeout(r, 400));
        const g = Market.myGarage();
        return { tradeVal, paid: before - Economy.balance(), hasMx5: g.some(c => c.carId === 'mazda-mx-5-nd'), hasM4: g.some(c => c.carId === 'bmw-m4-competition'), n: g.length };
    });
    log(trade.tradeVal === Math.round(14000 * 0.72) && trade.paid === 33000 - trade.tradeVal && !trade.hasMx5 && trade.hasM4 ? '✅' : '❌',
        `Trade-in: MX-5 credited $${trade.tradeVal} against a $33k M4 (paid $${trade.paid}); garage now ${trade.n} cars`);
    await clearToasts();

    /* ---- 5. Garage tab: condition grid, nickname, garage upgrade ---- */
    await go('paddock', 'garage');
    const gar = await page.evaluate(async () => {
        const cards = document.querySelectorAll('.pd-car').length;
        const grids = document.querySelectorAll('.pd-cond-grid').length;
        const m4 = Market.myGarage().find(c => c.carId === 'bmw-m4-competition');
        await Paddock.carMenu('user__u-ann', m4.id);
        await new Promise(r => setTimeout(r, 120));
        document.getElementById('pd-nick').value = 'Blue Thunder';
        document.getElementById('pd-save-meta').click();
        await new Promise(r => setTimeout(r, 300));
        const before = Economy.balance();
        await Paddock.upgradeGarage('user__u-ann');
        await new Promise(r => setTimeout(r, 300));
        const u = await DB.get('users', 'u-ann', { force: true });
        return { cards, grids, nick: u.garage.find(c => c.id === m4.id)?.nick, level: u.paddock.garageLevel, cost: before - u.balance };
    });
    log(gar.cards === 2 && gar.grids === 2 && gar.nick === 'Blue Thunder' && gar.level === 2 && gar.cost === 6000 ? '✅' : '❌',
        `Garage: ${gar.cards} cars with condition grids, nicknamed "${gar.nick}", upgraded to a Lock-up Garage for $${gar.cost}`);
    await page.screenshot({ path: path.join(shots, '02-garage.png'), fullPage: true });
    await clearToasts();

    /* ---- 6. Wear the M4, then NPC shop service + DIY tyres + an Apex install ---- */
    const shop = await page.evaluate(async () => {
        const g = Market.myGarage();
        const m4 = g.find(c => c.carId === 'bmw-m4-competition');
        const worn = { ...m4, cond: { engine: 70, gearbox: 60, suspension: 55, brakes: 40, tyres: 20, body: 80 }, races: 6 };
        await Paddock.saveCars({ type: 'user', id: 'u-ann' }, g.map(c => c.id === m4.id ? worn : c));
        const before = Economy.balance();
        const ok = await Paddock.bookJob('user__u-ann', m4.id, PaddockCore.SHOPS.mainst, { service: 'service' });
        await new Promise(r => setTimeout(r, 300));
        const afterSvc = Market.myGarage().find(c => c.id === m4.id);
        const spent = before - Economy.balance();
        // DIY tyres after another heavy wear.
        await Paddock.saveCars({ type: 'user', id: 'u-ann' }, Market.myGarage().map(c => c.id === m4.id ? { ...c, cond: { ...c.cond, tyres: 10 } } : c));
        const apBefore = Paddock.stateOf(Auth.state.profile).ap;
        await Paddock.diyModal('user__u-ann', m4.id);
        await new Promise(r => setTimeout(r, 120));
        document.getElementById('pd-d-svc').value = 'tyres';
        document.getElementById('pd-d-svc').dispatchEvent(new Event('change'));
        document.getElementById('pd-diy').dispatchEvent(new Event('submit'));
        await new Promise(r => setTimeout(r, 400));
        const afterDiy = Market.myGarage().find(c => c.id === m4.id);
        const p = Paddock.stateOf(Auth.state.profile);
        // Part install at Apex.
        const piBefore = PaddockCore.pi(afterDiy);
        await Paddock.bookJob('user__u-ann', m4.id, PaddockCore.SHOPS.apex, { service: 'install', part: 'intake', tier: 2 });
        await new Promise(r => setTimeout(r, 300));
        const afterUp = Market.myGarage().find(c => c.id === m4.id);
        return { ok, spent, svc: afterSvc.cond, hist: afterSvc.history?.[0]?.text || '', diyTyres: afterDiy.cond.tyres, apUsed: apBefore - p.ap, mechXP: p.skills.mechanical.xp + p.skills.mechanical.lvl * 100,
            piBefore, piAfter: PaddockCore.pi(afterUp), part: afterUp.parts?.intake };
    });
    log(shop.ok && shop.spent > 0 && shop.svc.tyres >= 80 && shop.svc.brakes >= 80 && shop.svc.engine === 70 && /Main Street/.test(shop.hist) ? '✅' : '❌',
        `Main Street full service: $${shop.spent}, tyres ${shop.svc.tyres}%, brakes ${shop.svc.brakes}% (engine left at ${shop.svc.engine}%), logged in the car's history`);
    log(shop.diyTyres >= 60 && shop.apUsed >= 1 ? '✅' : '❌', `DIY tyre change on the driveway: tyres → ${shop.diyTyres}%, ${shop.apUsed} ⏱ spent, mechanical XP earned`);
    log(shop.part?.tier === 2 && shop.piAfter > shop.piBefore ? '✅' : '❌', `Apex fitted a Sport intake: PI ${shop.piBefore} → ${shop.piAfter}`);
    await clearToasts();

    /* ---- 7. Training raises skills and the driver rating ---- */
    const tr = await page.evaluate(async () => {
        const p0 = Paddock.stateOf(Auth.state.profile);
        const bal = Economy.balance();
        await Paddock.train('coach');
        await new Promise(r => setTimeout(r, 300));
        const p1 = Paddock.stateOf(Auth.state.profile);
        const d = await DB.get('drivers', 'd-ann', { force: true });
        return { ap: p0.ap - p1.ap, cost: bal - Economy.balance(), pace0: p0.skills.pace.lvl * 1000 + p0.skills.pace.xp, pace1: p1.skills.pace.lvl * 1000 + p1.skills.pace.xp, rating: d.rating, expect: PaddockCore.ratingFromSkills(p1.skills) };
    });
    log(tr.ap === 4 && tr.cost === 2500 && tr.pace1 > tr.pace0 && tr.rating === tr.expect ? '✅' : '❌',
        `Private coach: 4 ⏱ + $${tr.cost}, pace XP up, driver rating synced to ${tr.rating}`);
    await clearToasts();

    /* ---- 8. Side events: a stream (no car) and a track day (wears the car) ---- */
    const ev = await page.evaluate(async () => {
        const p0 = Paddock.stateOf(Auth.state.profile);
        const fans0 = p0.fans;
        await Paddock.runEvent('stream');
        await new Promise(r => setTimeout(r, 300));
        const p1 = Paddock.stateOf(Auth.state.profile);
        // Refill time for the track day.
        p1.ap = 10;
        await Paddock.save(p1);
        App.go('paddock', 'events');
        await new Promise(r => setTimeout(r, 300));
        const m4 = Market.myGarage().find(c => c.carId === 'bmw-m4-competition');
        const sel = document.getElementById('pd-ev-car'); sel.value = m4.id;
        await Paddock.runEvent('trackday');
        await new Promise(r => setTimeout(r, 300));
        const after = Market.myGarage().find(c => c.id === m4.id);
        const p2 = Paddock.stateOf(Auth.state.profile);
        return { fansUp: p1.fans - fans0, events: p2.stats.sideEvents, tyresBefore: m4.cond.tyres, tyresAfter: after.cond.tyres, races: after.races, km: after.km - (m4.km || 0) };
    });
    log(ev.fansUp > 0 && ev.events === 2 && ev.tyresAfter < ev.tyresBefore && ev.km > 0 ? '✅' : '❌',
        `Side events: sim stream +${ev.fansUp} fans; track day wore tyres ${ev.tyresBefore}% → ${ev.tyresAfter}% (+${ev.km} km, still ${ev.races} race starts)`);
    await clearToasts();

    /* ---- 9. Decision card: resolve a choice ---- */
    const card = await page.evaluate(async () => {
        const p = Paddock.stateOf(Auth.state.profile);
        const c = PaddockCore.cardById(p.card);
        const choice = c.choices[c.choices.length - 1]; // the cheapest / safest choice
        await Paddock.playCard(c.id, choice.id);
        await new Promise(r => setTimeout(r, 300));
        const p2 = Paddock.stateOf(Auth.state.profile);
        return { id: c.id, cleared: !p2.card, played: p2.stats.cardsPlayed, logged: p2.log.some(l => l.text.includes(c.title)) };
    });
    log(card.cleared && card.played === 1 && card.logged ? '✅' : '❌', `Decision card "${card.id}" resolved and logged`);
    await clearToasts();

    /* ---- 10. Sponsors: sign one, push another ---- */
    await go('paddock', 'sponsors');
    const sp = await page.evaluate(async () => {
        const p = Paddock.stateOf(Auth.state.profile);
        const offer = p.offers[0];
        const bal = Economy.balance();
        await Paddock.signOffer('me', offer.id);
        await new Promise(r => setTimeout(r, 300));
        const p2 = Paddock.stateOf(Auth.state.profile);
        const other = p2.offers.find(o => o.industry !== offer.industry);
        if (other) { await Paddock.pushOffer('me', other.id); await new Promise(r => setTimeout(r, 300)); }
        const p3 = Paddock.stateOf(Auth.state.profile);
        return { brand: offer.brand, signed: p3.sponsors.some(s => s.brand === offer.brand), fee: Economy.balance() - bal, signing: offer.signing, pushed: other ? (p3.offers.find(o => o.id === other.id)?.pushed || !p3.offers.some(o => o.id === other.id)) : true };
    });
    log(sp.signed && sp.fee === sp.signing && sp.pushed ? '✅' : '❌', `Signed ${sp.brand} (+$${sp.fee} signing fee); pushed another offer for more`);
    await page.screenshot({ path: path.join(shots, '03-sponsors.png'), fullPage: true });
    await clearToasts();

    /* ---- 11. Bank: take a loan ---- */
    const bank = await page.evaluate(async () => {
        const bal = Economy.balance();
        await Paddock.takeLoan('micro');
        await new Promise(r => setTimeout(r, 300));
        const p = Paddock.stateOf(Auth.state.profile);
        return { got: Economy.balance() - bal, loan: p.loans[0] };
    });
    log(bank.got === 5000 && bank.loan?.perRace > 0 && bank.loan.racesLeft === 6 ? '✅' : '❌', `Quick cash loan: +$${bank.got}, ${bank.loan?.racesLeft} × $${bank.loan?.perRace}`);
    await clearToasts();

    /* ---- 12. Used lots: inspect, haggle, buy; a second buyer is refused ---- */
    await page.evaluate(() => { Dealership._tab = 'used'; PaddockTrade._dealer = 'lucky'; });
    await go('dealership');
    const used = await page.evaluate(async () => {
        const cards = document.querySelectorAll('.pd-listing').length;
        const lot = await PaddockTrade.lot('lucky');
        const l = lot[0];
        let p = Paddock.stateOf(Auth.state.profile); p.ap = 10; await Paddock.save(p);
        await PaddockTrade.inspect(l.id);
        await new Promise(r => setTimeout(r, 300));
        p = Paddock.stateOf(Auth.state.profile);
        const inspected = !!p.inspected[l.id];
        await PaddockTrade.haggleModal(l.id);
        await new Promise(r => setTimeout(r, 120));
        document.getElementById('pd-h-offer').value = String(Math.round(l.floor * 0.9));
        document.getElementById('pd-haggle').dispatchEvent(new Event('submit'));
        await new Promise(r => setTimeout(r, 400));
        const line = document.getElementById('pd-h-line')?.innerText || '';
        Modal.close(true, true);
        p = Paddock.stateOf(Auth.state.profile);
        const st = p.haggle[l.id];
        const price = st?.deal || st?.lastCounter || l.asking;
        const bal = Economy.balance();
        const ok = await PaddockTrade.buyUsed(l.id, 'user__u-ann', price);
        await new Promise(r => setTimeout(r, 300));
        const g = Market.myGarage();
        const bought = g.find(c => c.history?.[0]?.text?.includes("Lucky Lou"));
        const cfg = await Paddock.config(true);
        return { cards, inspected, line, haggled: !!st, price, asking: l.asking, paid: bal - Economy.balance(), ok, bought: !!bought, hidden: bought?.hidden?.length || 0, reserved: cfg.usedSold?.[l.id] === 'u-ann', id: l.id };
    });
    log(used.cards === 6 && used.inspected && used.haggled && used.line.length > 3 ? '✅' : '❌', `Lucky Lou's lot: ${used.cards} listings; inspected one; haggled ("${used.line.slice(0, 60)}")`);
    log(used.ok && used.bought && used.paid === used.price && used.price <= used.asking && used.reserved && used.hidden === 0 ? '✅' : '❌',
        `Bought the inspected car for $${used.paid} (sticker $${used.asking}); listing reserved in config/paddock; faults already known (${used.hidden} hidden)`);
    await clearToasts();
    await actAs('u-bob');
    const dup = await page.evaluate(async (id) => {
        const ok = await PaddockTrade.buyUsed(id, 'user__u-bob', 1000);
        return { ok, toast: document.getElementById('toast-holder')?.innerText || '', bobCars: Market.myGarage().length };
    }, used.id);
    log(!dup.ok && /just bought/i.test(dup.toast) && dup.bobCars === 0 ? '✅' : '❌', 'A second buyer for the same used car is refused ("Someone just bought that car")');
    await clearToasts();

    /* ---- 13. Player Market: Ann lists the Lucky Lou car, Bob buys it ---- */
    await actAs('u-ann');
    const pm = await page.evaluate(async () => {
        const g = Market.myGarage();
        const car = g.find(c => c.history?.[0]?.text?.includes("Lucky Lou")) || g.find(c => c.carId !== 'porsche-992-gt3-cup');
        window.prompt = () => '12000';
        await Paddock.listForSale('user__u-ann', car.id);
        window.prompt = () => '';
        await new Promise(r => setTimeout(r, 200));
        return { carId: car.id, name: car.name, listed: Market.myGarage().find(c => c.id === car.id)?.forSale?.price };
    });
    await actAs('u-bob');
    await page.evaluate(() => { Dealership._tab = 'market'; });
    await go('dealership');
    const pm2 = await page.evaluate(async (carId) => {
        const listed = /private sales/i.test(document.getElementById('view-root').innerText);
        const annBefore = (await DB.get('users', 'u-ann', { force: true })).balance;
        const bobBefore = Economy.balance();
        const ok = await PaddockTrade.buyPrivate('user__u-ann', carId, 'user__u-bob');
        await new Promise(r => setTimeout(r, 300));
        const ann = await DB.get('users', 'u-ann', { force: true });
        const bobCar = Market.myGarage()[0];
        return { listed, ok, annGot: ann.balance - annBefore, bobPaid: bobBefore - Economy.balance(), annStill: ann.garage.some(c => c.id === carId), bobCar: bobCar?.name, forSale: bobCar?.forSale };
    }, pm.carId);
    log(pm.listed === 12000 && pm2.listed && pm2.ok && pm2.annGot === 12000 && pm2.bobPaid === 12000 && !pm2.annStill && pm2.bobCar === pm.name && !pm2.forSale ? '✅' : '❌',
        `Player Market: Ann listed her ${pm.name} at $12,000; Bob bought it — $${pm2.bobPaid} moved wallet to wallet, car moved garages`);
    await page.screenshot({ path: path.join(shots, '04-player-market.png'), fullPage: true });
    await clearToasts();

    /* ---- 14. Mechanic shop: Mia opens up, Ann books, Mia does a careful job; walk-in diagnosis ---- */
    await actAs('u-mia');
    await go('career');
    const mia1 = await page.evaluate(async () => {
        const form = document.getElementById('pd-shop-form');
        document.getElementById('pd-sh-name').value = "Mia's Speed Shop";
        document.getElementById('pd-sh-open').checked = true;
        document.getElementById('pd-sh-spec').value = 'brakes';
        form.dispatchEvent(new Event('submit'));
        await new Promise(r => setTimeout(r, 400));
        const rp = await DB.get('roleProfiles', 'rp-mia', { force: true });
        return { form: !!form, open: rp.shop?.open, name: rp.shop?.name, walkins: document.querySelectorAll('.pd-walkin').length };
    });
    log(mia1.form && mia1.open && mia1.name === "Mia's Speed Shop" && mia1.walkins === 3 ? '✅' : '❌', `Mechanic workspace: "${mia1.name}" opened, ${mia1.walkins} walk-in customers waiting`);
    await clearToasts();
    await actAs('u-ann');
    const book = await page.evaluate(async () => {
        const shops = await Paddock.allShops();
        const mia = shops.find(s => s.player);
        const m4 = Market.myGarage().find(c => c.carId === 'bmw-m4-competition');
        await Paddock.saveCars({ type: 'user', id: 'u-ann' }, Market.myGarage().map(c => c.id === m4.id ? { ...c, cond: { ...c.cond, brakes: 30 } } : c));
        const miaBefore = (await DB.get('users', 'u-mia', { force: true })).balance;
        const q = PaddockCore.quote(Market.myGarage().find(c => c.id === m4.id), { service: 'brakes' }, mia);
        const ok = await Paddock.bookJob('user__u-ann', m4.id, mia, { service: 'brakes' });
        await new Promise(r => setTimeout(r, 300));
        const car = Market.myGarage().find(c => c.id === m4.id);
        const miaAfter = (await DB.get('users', 'u-mia', { force: true })).balance;
        return { found: !!mia, ok, queued: car.job?.status !== 'done' && !!car.job, labor: q.labor, miaGot: miaAfter - miaBefore, m4: m4.id };
    });
    log(book.found && book.ok && book.queued && book.miaGot === book.labor && book.labor > 0 ? '✅' : '❌', `Ann booked brakes at Mia's (player) shop: job queued, $${book.miaGot} labour paid to Mia`);
    await actAs('u-mia');
    await go('career');
    const done = await page.evaluate(async (m4) => {
        const queue = /bookings \(1\)/i.test(document.getElementById('view-root').innerText);
        const xp0 = (await DB.get('roleProfiles', 'rp-mia', { force: true })).prestigeXP || 0;
        await PaddockTrade.completeJob('user__u-ann', m4, true);
        await new Promise(r => setTimeout(r, 400));
        const ann = await DB.get('users', 'u-ann', { force: true });
        const car = ann.garage.find(c => c.id === m4);
        const rp = await DB.get('roleProfiles', 'rp-mia', { force: true });
        // Walk-in: answer correctly.
        const stars = Prestige.stored(rp);
        const job = PaddockCore.walkInJobs(`u-mia|${Util.todayISO()}`, { stars, econ: 1 })[0];
        const bal = Economy.balance();
        await PaddockTrade.diagnose(job.id, job.answer);
        await new Promise(r => setTimeout(r, 400));
        const rp2 = await DB.get('roleProfiles', 'rp-mia', { force: true });
        return { queue, brakes: car.cond.brakes, job: car.job, xp: (rp.prestigeXP || 0) - xp0, jobsDone: rp.shop.jobsDone, walkPay: Economy.balance() - bal, walkPayExp: job.pay, walkIns: rp2.shop.walkIns };
    }, book.m4);
    log(done.queue && done.brakes >= 85 && !done.job && done.xp === 30 && done.jobsDone === 1 ? '✅' : '❌', `Mia's careful job: Ann's brakes → ${done.brakes}%, job cleared, +${done.xp} prestige XP`);
    log(done.walkPay === done.walkPayExp && done.walkIns === 1 ? '✅' : '❌', `Walk-in diagnosis right first time: +$${done.walkPay}`);
    await page.screenshot({ path: path.join(shots, '05-mechanic-shop.png'), fullPage: true });
    await clearToasts();

    /* ---- 15. Car Dealer: trade-price stock, an AI walk-in buyer, a sale to a player ---- */
    await actAs('u-dave');
    const dealer = await page.evaluate(async () => {
        const lot = await PaddockTrade.lot('secondgear');
        const [a, b] = lot;
        const priceA = Math.round(a.asking * (1 - PaddockCore.TRADE_DISCOUNT.used) / 50) * 50;
        const bal = Economy.balance();
        const okA = await PaddockTrade.buyUsed(a.id, 'lot__rp-dave', priceA);
        const okB = await PaddockTrade.buyUsed(b.id, 'lot__rp-dave', Math.round(b.asking * (1 - PaddockCore.TRADE_DISCOUNT.used) / 50) * 50);
        await new Promise(r => setTimeout(r, 300));
        let rp = await DB.get('roleProfiles', 'rp-dave', { force: true });
        const spent = bal - Economy.balance();
        // Price car A cheaply and pretend it's sat on the lot for a week.
        const carA = rp.lot[0], carB = rp.lot[1];
        const week = new Date(Date.now() - 7 * 86400000);
        const ago = `${week.getFullYear()}-${String(week.getMonth() + 1).padStart(2, '0')}-${String(week.getDate()).padStart(2, '0')}`;
        await DB.update('roleProfiles', 'rp-dave', { lot: [
            { ...carA, retail: Math.round(PaddockCore.marketValue(carA) * 0.7), listedOn: ago, aiCheckedOn: ago },
            { ...carB, retail: Math.round(PaddockCore.marketValue(carB) * 1.05), listedOn: Util.todayISO(), aiCheckedOn: Util.todayISO() }
        ] });
        const bal2 = Economy.balance();
        App.go('career');
        await new Promise(r => setTimeout(r, 500));
        rp = await DB.get('roleProfiles', 'rp-dave', { force: true });
        return { okA, okB, spent, priceA, lot: rp.lot.length, sales: rp.dealer?.sales || 0, earned: Economy.balance() - bal2, ui: document.getElementById('view-root').innerText.includes('AI customer bought'), carB: rp.lot[0]?.id };
    });
    log(dealer.okA && dealer.okB && dealer.spent > 0 && dealer.lot === 1 && dealer.sales === 1 && dealer.earned > 0 && dealer.ui ? '✅' : '❌',
        `Car Dealer: stocked 2 cars at trade price ($${dealer.spent}); an AI walk-in bought the bargain (+$${dealer.earned}); 1 left on the lot`);
    await actAs('u-bob');
    const dsale = await page.evaluate(async (carId) => {
        const listings = await PaddockTrade.marketListings();
        const x = listings.find(l => l.kind === 'dealer' && l.car.id === carId);
        const daveBefore = (await DB.get('users', 'u-dave', { force: true })).balance;
        const ok = await PaddockTrade.buyPrivate('lot__rp-dave', carId, 'user__u-bob');
        await new Promise(r => setTimeout(r, 300));
        const rp = await DB.get('roleProfiles', 'rp-dave', { force: true });
        const dave = await DB.get('users', 'u-dave', { force: true });
        return { listed: !!x, ok, daveGot: dave.balance - daveBefore, price: x?.price, lot: rp.lot.length, sales: rp.dealer.sales };
    }, dealer.carB);
    log(dsale.listed && dsale.ok && dsale.daveGot === dsale.price && dsale.lot === 0 && dsale.sales === 2 ? '✅' : '❌',
        `Bob bought from Dave's dealership on the Player Market ($${dsale.price} → Dave); sale logged`);
    await clearToasts();

    /* ---- 16. Team owner: team sponsors + workshop ---- */
    await actAs('u-olive');
    const team = await page.evaluate(async () => {
        let p = Paddock.stateOf(Auth.state.profile); p.ap = 10; await Paddock.save(p);
        await Paddock.refreshTeamOffers();
        await new Promise(r => setTimeout(r, 300));
        let t = await DB.get('teams', 't-own', { force: true });
        const offer = t.paddock.offers[0];
        const budget0 = t.budget;
        await Paddock.signOffer('team', offer.id);
        await new Promise(r => setTimeout(r, 300));
        t = await DB.get('teams', 't-own', { force: true });
        await Paddock.upgradeGarage('team__t-own');
        await new Promise(r => setTimeout(r, 300));
        const t2 = await DB.get('teams', 't-own', { force: true });
        return { offers: offer ? 1 : 0, signed: t.paddock.sponsors.length, fee: t.budget - budget0, signing: offer.signing, level: t2.paddock.garageLevel, cost: t.budget - t2.budget };
    });
    log(team.signed === 1 && team.fee === team.signing && team.level === 2 && team.cost === 12000 ? '✅' : '❌',
        `Team owner: signed a team sponsor (+$${team.fee} to the team budget) and upgraded the team workshop ($${team.cost})`);
    await clearToasts();

    /* ---- 17. Race day: sign up (entry recorded), car card, gremlin, results → settlement ---- */
    await actAs('u-ann');
    const pre = await page.evaluate(async () => {
        await Views.toggleSignup('r1');
        await new Promise(r => setTimeout(r, 200));
        const s = (await DB.signups({ force: true })).find(x => x.raceId === 'r1' && x.uid === 'u-ann');
        await Views.showRace('r1');
        await new Promise(r => setTimeout(r, 250));
        const t = document.querySelector('.modal-card')?.innerText || '';
        Modal.close(true, true);
        return { entry: s?.garageEntryId, raceCar: Paddock.stateOf(Auth.state.profile).raceCar, card: /Your car/i.test(t), inspection: /inspection passed|gremlin/i.test(t), ai: /AI|Strength|level/i.test(t) };
    });
    log(pre.entry && pre.entry === pre.raceCar && pre.card && pre.inspection ? '✅' : '❌', 'Signup records the race car; the race window shows its condition, an AI-level tip and the pre-race inspection');
    const settle = await page.evaluate(async () => {
        const u0 = await DB.get('users', 'u-ann', { force: true });
        const p0 = PaddockCore.ensurePaddock(u0.paddock, 'u-ann');
        const car0 = u0.garage.find(c => c.id === p0.raceCar);
        // Spend some time so the refill is visible, and give Ann a fan base big
        // enough to open the merch stand (1,000 fans).
        const pz = Paddock.stateOf(u0); pz.ap = 1; pz.fans = 1500; await DB.update('users', 'u-ann', { paddock: Paddock._clean(pz) });
        const world = await DB.loadWorld(true);
        const race = world.races.find(r => r.id === 'r1');
        const results = [
            { driverId: 'd-ann', position: 2, start: 5, dnf: false, incidents: 0, pole: false, fastestLap: false },
            { driverId: 'd-ai1', position: 1, start: 1, dnf: false, pole: true },
            { driverId: 'd-ai2', position: 3, start: 2, dnf: false },
            { driverId: 'd-ai3', position: 4, start: 3, dnf: false },
            { driverId: 'd-ai4', position: null, start: 4, dnf: true }
        ];
        await Director.saveResults(race, results, world);
        await new Promise(r => setTimeout(r, 300));
        const u1 = await DB.get('users', 'u-ann', { force: true });
        const p1 = PaddockCore.ensurePaddock(u1.paddock, 'u-ann');
        const car1 = u1.garage.find(c => c.id === p0.raceCar);
        const ledger = (await DB.list('ledger', { force: true })).filter(l => l.uid === 'u-ann' && l.refId === 'r1');
        const d = await DB.get('drivers', 'd-ann', { force: true });
        const t = await DB.get('teams', 't-own', { force: true });
        const tLedger = (await DB.list('ledger', { force: true })).filter(l => l.walletId === 't-own' && /Team sponsor/.test(l.label));
        return {
            races: car1.races, tyres0: car0.cond.tyres, tyres1: car1.cond.tyres, warranty: car1.warranty,
            finance0: car0.finance.balance, finance1: car1.finance.balance, finLedger: ledger.some(l => /Finance:/.test(l.label)),
            sponsorPaid: ledger.some(l => /^Sponsor:/.test(l.label)), merch: ledger.some(l => /Merch/.test(l.label)), loan: ledger.some(l => /Loan repayment/.test(l.label)),
            loanLeft: p1.loans[0]?.racesLeft, ap: p1.ap, fans: p1.fans - p0.fans, cardReady: p1.cardReady, offersAt: p1.offersAt,
            dealLeft: p1.sponsors[0]?.racesLeft, dealTotal: p1.sponsors[0]?.races, rating: d.rating, hist: car1.history[0]?.text || '',
            teamDeal: t.paddock.sponsors[0]?.racesLeft < t.paddock.sponsors[0]?.races, teamPaid: tLedger.length
        };
    });
    log(settle.races === 1 && settle.tyres1 < settle.tyres0 && settle.warranty === 4 && /P2/.test(settle.hist) ? '✅' : '❌',
        `Race day wear: race car now 1 race on the clock, tyres ${settle.tyres0}% → ${settle.tyres1}%, warranty ${settle.warranty} races left ("${settle.hist.slice(0, 50)}")`);
    log(settle.sponsorPaid && settle.merch && settle.loan && settle.finLedger && settle.finance1 < settle.finance0 && settle.loanLeft === 5 && settle.dealLeft === settle.dealTotal - 1 ? '✅' : '❌',
        `Race day money: sponsor paid, merch sold, loan installment (${settle.loanLeft} left), finance $${settle.finance0} → $${settle.finance1}`);
    log(settle.ap >= 10 && settle.fans > 0 && settle.cardReady && settle.offersAt === 0 && settle.rating > 50 ? '✅' : '❌',
        `Race day paddock: ⏱ refilled to ${settle.ap}, +${settle.fans} fans, new card + offers queued, rating ${settle.rating}`);
    log(settle.teamDeal && settle.teamPaid === 1 ? '✅' : '❌', 'Team sponsor paid the team budget and counted the race');

    /* ---- 18. Gremlin: a wrecked race car gets a "retire on lap N" order ---- */
    const grem = await page.evaluate(async () => {
        await Auth.reloadProfile();
        const p = Paddock.stateOf(Auth.state.profile);
        const g = Market.myGarage();
        await Paddock.saveCars({ type: 'user', id: 'u-ann' }, g.map(c => c.id === p.raceCar ? { ...c, cond: { engine: 3, gearbox: 4, suspension: 5, brakes: 3, tyres: 2, body: 10 } } : c));
        await Views.toggleSignup('r2');
        await new Promise(r => setTimeout(r, 200));
        // Find a race id whose seeded roll fails for this car (most do at this condition).
        await Views.showRace('r2');
        await new Promise(r => setTimeout(r, 250));
        const t = document.querySelector('.modal-card')?.innerText || '';
        Modal.close(true, true);
        const car = Market.myGarage().find(c => c.id === p.raceCar);
        const check = PaddockCore.gremlinCheck(car, { seed: `r2|${car.id}`, laps: 15 });
        return { fails: check.fails, lap: check.lap, warn: /Mechanical gremlin/i.test(t), lapShown: check.lap ? t.includes(`lap ${check.lap}`) : true, reliability: PaddockCore.reliability(car) };
    });
    log(grem.fails ? (grem.warn && grem.lapShown ? '✅' : '❌') : (grem.reliability < 50 ? '✅' : '❌'),
        grem.fails ? `Wrecked race car: race window orders a retirement on lap ${grem.lap}` : `Wrecked race car (reliability ${grem.reliability}%) passed this race's seeded roll`);
    await clearToasts();

    /* ---- 19. Simulated race with a human signed up uses the car/skill pace map ---- */
    const sim = await page.evaluate(async () => {
        await Paddock.saveCars({ type: 'user', id: 'u-ann' }, Market.myGarage().map(c => ({ ...c, cond: PaddockCore.fullCond(100) })));
        const world = await DB.loadWorld(true);
        const race = world.races.find(r => r.id === 'r2');
        const grid = await Sim.gridFor(race, world);
        const map = await Paddock.simPaceMap(race, world, grid);
        await Sim.simulateRace('r2', { quiet: true });
        const r2 = await DB.get('races', 'r2', { force: true });
        const u = await DB.get('users', 'u-ann', { force: true });
        const car = u.garage.find(c => c.id === u.paddock.raceCar);
        return { bonus: map['d-ann'], status: r2.status, ann: r2.results.some(x => x.driverId === 'd-ann'), races: car.races };
    });
    log(typeof sim.bonus === 'number' && sim.status === 'completed' && sim.ann && sim.races === 2 ? '✅' : '❌',
        `Simulated round: Ann's car + skills add ${sim.bonus?.toFixed?.(1)} pace; settlement wore her car again (${sim.races} races)`);
    await clearToasts();

    /* ---- 20. Every paddock screen: no leaks; phone width has no sideways scroll ---- */
    const allLeaks = [];
    for (const tab of ['overview', 'garage', 'shops', 'sponsors', 'training', 'events', 'bank']) {
        await go('paddock', tab);
        const l = await leakCheck();
        if (l.length) allLeaks.push(`${tab}: ${l.join(',')}`);
        await page.screenshot({ path: path.join(shots, `10-${tab}.png`), fullPage: true });
    }
    for (const t of ['showroom', 'used', 'market']) {
        await page.evaluate((t) => { Dealership._tab = t; }, t);
        await go('dealership');
        const l = await leakCheck();
        if (l.length) allLeaks.push(`dealership/${t}: ${l.join(',')}`);
    }
    await page.evaluate(() => { Dealership._tab = 'showroom'; });
    log(!allLeaks.length ? '✅' : '❌', `All 7 paddock tabs + 3 dealership tabs render without NaN/undefined/null${allLeaks.length ? ' — ' + allLeaks.join(' | ') : ''}`);
    await page.setViewportSize({ width: 390, height: 844 });
    const narrow = [];
    for (const tab of ['overview', 'garage', 'shops', 'sponsors', 'training', 'events', 'bank']) {
        await go('paddock', tab);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (over > 2) narrow.push(`${tab} +${over}px`);
    }
    await page.screenshot({ path: path.join(shots, '20-phone-bank.png'), fullPage: true });
    log(!narrow.length ? '✅' : '❌', `Phone width (390px): no sideways scroll on any paddock tab${narrow.length ? ' — ' + narrow.join(', ') : ''}`);

    await browser.close();
    const fails = steps.filter(s => s.startsWith('❌'));
    console.log(`\n${steps.length - fails.length}/${steps.length} steps passed`);
    if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
})().catch(e => { console.error('❌ DRIVE CRASHED:', e); process.exit(1); });
