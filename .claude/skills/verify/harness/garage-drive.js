/* Drive the Garage & Vehicle Ownership system + Series Registration gate:
   carChoices on series/races (GM Schedule Builder payload), the
   validateSeriesEligibility gatekeeper (personal garage / team garage /
   staff-of-independent-driver paths), the race-modal eligibility UI +
   disabled signup button, signup docs carrying carId/teamId, the Team
   Garage (budget-funded buy/sell with garageCarIds mirror), and the
   carId nomenclature shared between Dealership stock and GM input. */
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

    const gmSignIn = async () => {
        await page.waitForSelector('#auth-gate:not(.hidden), #app-shell:not(.hidden)');
        await page.evaluate(() => window.Modal && Modal.close());
        if (await page.locator('#app-shell:not(.hidden)').count()) await page.click('#signout-btn');
        await page.waitForSelector('#auth-gate:not(.hidden)');
        await page.click('.gate-tab[data-pane="admin"]');
        await page.fill('#gate-passcode', 'phoenix13!');
        await page.click('#gate-admin-submit');
        await page.waitForSelector('#app-shell:not(.hidden)');
    };

    await page.goto('http://localhost:8317/sim-racing-career/app.html');
    await gmSignIn();

    /* ---- 0. Nomenclature: dealership names ↔ GM tokens ---- */
    const nom = await page.evaluate(() => ({
        slug: Garage.carId('Phoenix GT-R Street Spec'),
        parsed: Garage.parseChoices('  Phoenix-GT-R-Street-Spec  FALCON-RS-COUPE\n vulcan-v8-interceptor '),
        empty: Garage.parseChoices('   ')
    }));
    log(nom.slug === 'phoenix-gt-r-street-spec'
        && JSON.stringify(nom.parsed) === JSON.stringify(['phoenix-gt-r-street-spec', 'falcon-rs-coupe', 'vulcan-v8-interceptor'])
        && nom.empty.length === 0 ? '✅' : '❌',
        `carId nomenclature: "${nom.slug}", GM space-delimited input parses/normalizes (${nom.parsed.join(' ')})`);

    /* ---- Seed a world: series with carChoices, races, players, team ---- */
    const seeded = await page.evaluate(async () => {
        const db = SRMPC.db;
        await db.collection('games').doc('g1').set({ name: 'Gran Turismo 7' });
        await db.collection('series').doc('s-gt').set({
            name: 'Phoenix GT Cup', gameId: 'g1', status: 'active', pointsSystem: 'f1',
            carChoices: ['phoenix-gt-r-street-spec', 'falcon-rs-coupe']
        });
        await db.collection('series').doc('s-open').set({ name: 'Open Trophy', gameId: 'g1', status: 'active', pointsSystem: 'f1' });
        // r1 inherits the SERIES carChoices (no list of its own); r2 overrides
        // with its own; r-open has none anywhere = open entry.
        await db.collection('races').doc('r1').set({ seriesId: 's-gt', gameId: 'g1', name: 'GT Cup — Round 1', track: 'Monza', date: '2030-01-01', status: 'scheduled', results: [] });
        await db.collection('races').doc('r2').set({ seriesId: 's-gt', gameId: 'g1', name: 'GT Cup — Round 2', track: 'Spa', date: '2030-01-08', status: 'scheduled', results: [], carChoices: ['vulcan-v8-interceptor'] });
        await db.collection('races').doc('r-open').set({ seriesId: 's-open', gameId: 'g1', name: 'Open Trophy — R1', track: 'Suzuka', date: '2030-02-01', status: 'scheduled', results: [] });
        // Val: independent player driver, funded, empty garage.
        await db.collection('users').doc('u-val').set({ displayName: 'Val', balance: 100000, walletInitialized: true, driverId: 'd-val' });
        await db.collection('drivers').doc('d-val').set({ name: 'Val Quick', ownerUid: 'u-val', teamId: null });
        // Ben: player driver contracted to Garage Kings (team owns no car yet).
        await db.collection('users').doc('u-ben').set({ displayName: 'Ben', balance: 500, walletInitialized: true, driverId: 'd-ben', teamId: 't-kings' });
        await db.collection('drivers').doc('d-ben').set({ name: 'Ben Wheels', ownerUid: 'u-ben', teamId: 't-kings' });
        await db.collection('teams').doc('t-kings').set({ name: 'Garage Kings', ownerUid: 'u-owner', budget: 90000, recruiting: true });
        await db.collection('users').doc('u-owner').set({ displayName: 'Olive Owner', balance: 20000, walletInitialized: true });
        await db.collection('contracts').doc('c-ben').set({ personId: 'd-ben', personKind: 'driver', personUid: 'u-ben', teamId: 't-kings', ownerUid: 'u-owner', status: 'active', salary: 200 });
        // Sam: crew chief hired DIRECTLY by independent driver Val (no team).
        await db.collection('users').doc('u-sam').set({ displayName: 'Sam Spanner', balance: 100, walletInitialized: true });
        await db.collection('contracts').doc('c-sam').set({ personId: 'st-sam', personKind: 'crew-chief', role: 'crew-chief', personUid: 'u-sam', teamId: null, ownerUid: 'u-val', status: 'active', salary: 50 });
        // GM-curated dealership inventory (js/srmpc-dealership.js).
        await db.collection('dealershipInventory').doc('inv-phoenix').set({ name: 'Phoenix GT-R Street Spec', carId: 'phoenix-gt-r-street-spec', emoji: '🏎️', gameId: 'g1', seriesIds: ['s-gt'], condition: 'new', price: 42000, stats: { performance: 7, durability: 8 }, available: true });
        await db.collection('dealershipInventory').doc('inv-falcon').set({ name: 'Falcon RS Coupe', carId: 'falcon-rs-coupe', emoji: '🚗', gameId: 'g1', seriesIds: ['s-gt'], condition: 'new', price: 38500, stats: { performance: 6, durability: 8 }, available: true });
        DB.invalidate();
        return true;
    });
    log(seeded ? '✅' : '❌', 'Seeded: series s-gt (carChoices), race-level override, open series, 3 players, team');

    const actAs = (uid) => page.evaluate(async (uid) => {
        Auth.state.profile = await DB.get('users', uid, { force: true });
        Auth.state.user = { uid, isAnonymous: false };
        Auth.state.mode = 'player';
    }, uid);

    /* ---- 1. Gatekeeper: no car anywhere → ineligible ---- */
    await actAs('u-val');
    const block = await page.evaluate(() => Garage.validateSeriesEligibility('u-val', 's-gt', { raceId: 'r1' }));
    log(block.eligible === false && /missing a required vehicle/i.test(block.reason)
        && JSON.stringify(block.choices) === JSON.stringify(['phoenix-gt-r-street-spec', 'falcon-rs-coupe']) ? '✅' : '❌',
        `Val with empty garage is INELIGIBLE for r1 (series carChoices inherited): "${block.reason.slice(0, 70)}…"`);

    /* ---- 1b. UI: race modal shows the blocked state ---- */
    const blockedUi = await page.evaluate(async () => {
        await Views.showRace('r1');
        await new Promise(r => setTimeout(r, 100));
        const btn = [...document.querySelectorAll('.modal-card button')].find(b => /sign me up/i.test(b.innerText));
        const text = document.querySelector('.modal-card')?.innerText || '';
        Modal.close();
        return { disabled: btn?.disabled === true, msg: /Ineligible — missing a required vehicle/i.test(text), dealerLink: /Visit the Dealership/i.test(text) };
    });
    log(blockedUi.disabled && blockedUi.msg && blockedUi.dealerLink ? '✅' : '❌',
        'Race modal: signup button DISABLED + ineligibility reason + Dealership shortcut shown');

    /* ---- 1c. toggleSignup refuses even if forced ---- */
    const forced = await page.evaluate(async () => {
        await Views.toggleSignup('r1');
        const s = (await DB.signups({ force: true })).filter(x => x.uid === 'u-val');
        const toast = document.getElementById('toast-holder')?.innerText || '';
        document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove());
        return { count: s.length, toast };
    });
    log(forced.count === 0 && /Ineligible/i.test(forced.toast) ? '✅' : '❌',
        'Calling toggleSignup directly is still blocked (validation re-runs at write time)');

    /* ---- 2. Buy the car at the Dealership → eligible via PERSONAL garage ---- */
    const bought = await page.evaluate(async () => {
        await Dealership.buy('inv-phoenix'); // Phoenix GT-R Street Spec, $42,000
        const me = await DB.get('users', 'u-val', { force: true });
        const elig = await Garage.validateSeriesEligibility('u-val', 's-gt', { raceId: 'r1' });
        document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove());
        return {
            balance: Number(me.balance), carId: me.garage?.[0]?.carId, mirror: me.garageCarIds,
            eligible: elig.eligible, via: elig.via, reason: elig.reason
        };
    });
    log(bought.balance === 58000 && bought.carId === 'phoenix-gt-r-street-spec'
        && (bought.mirror || []).includes('phoenix-gt-r-street-spec')
        && bought.eligible && bought.via === 'personal' ? '✅' : '❌',
        `Val bought the GT-R ($42k → $${bought.balance}); garageCarIds mirror synced; now ELIGIBLE via personal ("${bought.reason}")`);

    /* ---- 2b. Signup succeeds and records the qualifying car ---- */
    const signed = await page.evaluate(async () => {
        await Views.toggleSignup('r1');
        const s = (await DB.signups({ force: true })).find(x => x.uid === 'u-val' && x.raceId === 'r1');
        document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove());
        return s || null;
    });
    log(signed && signed.carId === 'phoenix-gt-r-street-spec' && signed.via === 'personal' && !signed.teamId ? '✅' : '❌',
        `Signup doc created with carId=${signed?.carId}, via=${signed?.via}`);

    /* ---- 2c. Race-level carChoices OVERRIDE the series list ---- */
    const override = await page.evaluate(() => Garage.validateSeriesEligibility('u-val', 's-gt', { raceId: 'r2' }));
    log(override.eligible === false && JSON.stringify(override.choices) === JSON.stringify(['vulcan-v8-interceptor']) ? '✅' : '❌',
        'r2 (race-level carChoices: vulcan only) rejects Val\'s GT-R — race list overrides series list');

    /* ---- 3. Team Garage: owner buys a car from the TEAM budget ---- */
    await actAs('u-owner');
    const teamBuy = await page.evaluate(async () => {
        await Dealership.buy('inv-falcon', 't-kings'); // Falcon RS Coupe, $38,500 from the TEAM budget
        const t = await DB.get('teams', 't-kings', { force: true });
        const owner = await DB.get('users', 'u-owner', { force: true });
        const rows = (await DB.list('ledger', { force: true })).filter(l => l.walletType === 'team' && l.walletId === 't-kings');
        document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove());
        return {
            budget: Number(t.budget), carId: t.garage?.[0]?.carId, mirror: t.garageCarIds,
            ownerBalance: Number(owner.balance), ledger: rows.length
        };
    });
    log(teamBuy.budget === 51500 && teamBuy.carId === 'falcon-rs-coupe'
        && (teamBuy.mirror || []).includes('falcon-rs-coupe')
        && teamBuy.ownerBalance === 20000 && teamBuy.ledger >= 1 ? '✅' : '❌',
        `Team bought the Falcon from the TEAM budget ($90k → $${teamBuy.budget}); owner's personal wallet untouched; team ledger row written`);

    /* ---- 3b. Contracted driver Ben is eligible via the TEAM garage ---- */
    await actAs('u-ben');
    const teamElig = await page.evaluate(async () => {
        const elig = await Garage.validateSeriesEligibility('u-ben', 's-gt', { raceId: 'r1' });
        if (elig.eligible) await Views.toggleSignup('r1');
        const s = (await DB.signups({ force: true })).find(x => x.uid === 'u-ben' && x.raceId === 'r1');
        document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove());
        return { ...elig, signup: s || null };
    });
    log(teamElig.eligible && teamElig.via === 'team' && teamElig.teamId === 't-kings'
        && teamElig.signup?.carId === 'falcon-rs-coupe' && teamElig.signup?.teamId === 't-kings' ? '✅' : '❌',
        `Ben (no personal car) ELIGIBLE via Team Entry: "${teamElig.reason}" — signup records teamId + carId`);

    /* ---- 3c. Non-owner cannot buy/sell team cars ---- */
    const guarded = await page.evaluate(async () => {
        await Dealership.buy('inv-phoenix', 't-kings');
        const toast = document.getElementById('toast-holder')?.innerText || '';
        document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove());
        const t = await DB.get('teams', 't-kings', { force: true });
        return { blocked: /Only the team owner/i.test(toast), cars: (t.garage || []).length };
    });
    log(guarded.blocked && guarded.cars === 1 ? '✅' : '❌', 'Non-owner blocked from buying cars on the team budget');

    /* ---- 4. Support staff of an INDEPENDENT driver: driver's garage counts ---- */
    await actAs('u-sam');
    const staffElig = await page.evaluate(() => Garage.validateSeriesEligibility('u-sam', 's-gt', { raceId: 'r1', role: 'crew-chief' }));
    const staffAsDriver = await page.evaluate(() => Garage.validateSeriesEligibility('u-sam', 's-gt', { raceId: 'r1', role: 'driver' }));
    log(staffElig.eligible && staffElig.via === 'staff-driver' && staffAsDriver.eligible === false ? '✅' : '❌',
        `Sam (crew chief for independent Val) ELIGIBLE via supported driver's garage ("${staffElig.reason}"); same person as a DRIVER stays ineligible`);

    /* ---- 5. Open entry: no carChoices anywhere ---- */
    const open = await page.evaluate(() => Garage.validateSeriesEligibility('u-sam', 's-open', { raceId: 'r-open' }));
    log(open.eligible && open.via === 'open' ? '✅' : '❌', `No carChoices on race or series → open entry ("${open.reason}")`);

    /* ---- 6. Schedule generator stamps carChoices on every race ---- */
    const gen = await page.evaluate(() => {
        const explicit = generateScheduleRaces({
            series: { id: 's-gt', name: 'Phoenix GT Cup', gameId: 'g1', carChoices: ['falcon-rs-coupe'] },
            cadence: 'weekly', startDate: '2030-03-01', time: '20:00',
            tracks: ['Monza', 'Spa'], laps: 20, carChoices: ['phoenix-gt-r-street-spec']
        });
        const inherited = generateScheduleRaces({
            series: { id: 's-gt', name: 'Phoenix GT Cup', gameId: 'g1', carChoices: ['falcon-rs-coupe'] },
            cadence: 'weekly', startDate: '2030-03-01', time: '20:00', tracks: ['Monza'], laps: 20
        });
        return { a: explicit.map(r => r.carChoices), b: inherited[0].carChoices };
    });
    log(gen.a.every(c => JSON.stringify(c) === JSON.stringify(['phoenix-gt-r-street-spec']))
        && JSON.stringify(gen.b) === JSON.stringify(['falcon-rs-coupe']) ? '✅' : '❌',
        'generateScheduleRaces stamps builder carChoices on every round (falls back to series.carChoices)');

    /* ---- 6b. GM forms: series form + schedule builder expose the field ---- */
    await gmSignIn();
    const forms = await page.evaluate(async () => {
        await Admin.seriesForm('s-gt');
        await new Promise(r => setTimeout(r, 100));
        const sf = document.getElementById('sf-cars');
        const sfVal = sf?.value || '';
        Modal.close();
        await Admin.scheduleBuilder('s-gt');
        await new Promise(r => setTimeout(r, 100));
        const sb = document.getElementById('sb-cars');
        const sbVal = sb?.value || '';
        Modal.close();
        return { sf: !!sf, sfVal, sb: !!sb, sbVal };
    });
    log(forms.sf && forms.sfVal === 'phoenix-gt-r-street-spec falcon-rs-coupe'
        && forms.sb && forms.sbVal === 'phoenix-gt-r-street-spec falcon-rs-coupe' ? '✅' : '❌',
        `GM forms expose space-delimited Eligible cars, prefilled from the series ("${forms.sbVal}")`);

    /* ---- 7. Team sell: car leaves garage, 60% back to TEAM budget ---- */
    await actAs('u-owner');
    const teamSell = await page.evaluate(async () => {
        const t0 = await DB.get('teams', 't-kings', { force: true });
        await Garage.sellTeamCar('t-kings', t0.garage[0].id);
        const t = await DB.get('teams', 't-kings', { force: true });
        document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove());
        return { budget: Number(t.budget), cars: (t.garage || []).length, mirror: t.garageCarIds };
    });
    log(teamSell.budget === 51500 + 23100 && teamSell.cars === 0 && (teamSell.mirror || []).length === 0 ? '✅' : '❌',
        `Team sold the Falcon back at 60% → budget $${teamSell.budget}, garage + garageCarIds mirror emptied`);

    /* ---- 7b. …and Ben immediately loses eligibility again ---- */
    const revoked = await page.evaluate(() => Garage.validateSeriesEligibility('u-ben', 's-gt', { raceId: 'r1' }));
    log(revoked.eligible === false ? '✅' : '❌', 'With the team car sold, Ben is ineligible again — ownership is checked live');

    await browser.close();
    const fails = steps.filter(s => s.startsWith('❌'));
    console.log(`\n${steps.length - fails.length}/${steps.length} steps passed`);
    if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
})().catch(e => { console.error('❌ DRIVE CRASHED:', e); process.exit(1); });
