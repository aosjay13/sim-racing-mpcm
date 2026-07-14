/* Drive the per-race carChoices override in the Add/Edit Race form:
   GM types space-delimited eligible cars on a single race → stored as a
   parsed array; blank input = no override (inherits series list); the
   registration gate (Garage.choicesFor / validateSeriesEligibility)
   honors the race-level list over the series list. */
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

    await page.goto('http://localhost:8317/sim-racing-career/app.html');
    await page.waitForSelector('#auth-gate:not(.hidden), #app-shell:not(.hidden)');
    await page.click('.gate-tab[data-pane="admin"]');
    await page.fill('#gate-passcode', 'phoenix13!');
    await page.click('#gate-admin-submit');
    await page.waitForSelector('#app-shell:not(.hidden)');

    /* ---- Seed: game + series with a series-level carChoices list ---- */
    const seeded = await page.evaluate(async () => {
        const db = SRMPC.db;
        await db.collection('games').doc('g1').set({ name: 'Gran Turismo 7' });
        await db.collection('series').doc('s-gt').set({
            name: 'Phoenix GT Cup', gameId: 'g1', status: 'active', pointsSystem: 'f1',
            carChoices: ['phoenix-gt-r-street-spec', 'falcon-rs-coupe']
        });
        return true;
    });
    log(seeded ? '✅' : '❌', 'Seeded: series s-gt with series-level carChoices');

    /* ---- 1. Add Race form exposes the per-race Eligible cars input ---- */
    await page.evaluate(() => Admin.raceForm(null, 's-gt'));
    await page.waitForSelector('#rf-cars');
    log('✅', 'Add Race form shows the #rf-cars per-race Eligible cars input');

    /* ---- 2. Space-delimited input → parsed carChoices array on the doc ---- */
    await page.fill('#rf-track', 'Monza');
    await page.fill('#rf-cars', '  Vulcan-V8-Interceptor   Phoenix-GT-R-Street-Spec ');
    await page.click('#race-form button[type=submit]');
    await page.waitForFunction(() => /race added/i.test(document.querySelector('#toast-holder')?.innerText || ''));
    const created = await page.evaluate(async () => {
        const races = await DB.races({ force: true });
        return races.find(r => r.track === 'Monza');
    });
    log(created && JSON.stringify(created.carChoices) === JSON.stringify(['vulcan-v8-interceptor', 'phoenix-gt-r-street-spec']) ? '✅' : '❌',
        `Saved race stores parsed per-race carChoices array (${(created?.carChoices || []).join(' ')})`);

    /* ---- 3. Gate honors the race-level override over the series list ---- */
    const gate = await page.evaluate(async () => {
        const races = await DB.races({ force: true });
        const race = races.find(r => r.track === 'Monza');
        const series = (await DB.series({ force: true })).find(s => s.id === 's-gt');
        return {
            eff: Garage.choicesFor(race, series),
            falconOk: Garage.choicesFor(race, series).includes('falcon-rs-coupe')
        };
    });
    log(JSON.stringify(gate.eff) === JSON.stringify(['vulcan-v8-interceptor', 'phoenix-gt-r-street-spec']) && !gate.falconOk ? '✅' : '❌',
        `Garage.choicesFor uses the race override — falcon-rs-coupe (series-only) is NOT eligible (${gate.eff.join(' ')})`);

    /* ---- 4. Edit form prefills the override; blanking it = inherit series ---- */
    const raceId = created.id;
    await page.evaluate((id) => Admin.raceForm(id), raceId);
    await page.waitForSelector('#rf-cars');
    const prefill = await page.inputValue('#rf-cars');
    log(prefill === 'vulcan-v8-interceptor phoenix-gt-r-street-spec' ? '✅' : '❌',
        `Edit Race prefills the stored override ("${prefill}")`);
    await page.fill('#rf-cars', '   ');
    await page.click('#race-form button[type=submit]');
    await page.waitForFunction(() => /race updated/i.test(document.querySelector('#toast-holder')?.innerText || ''));
    const inherited = await page.evaluate(async () => {
        const races = await DB.races({ force: true });
        const race = races.find(r => r.track === 'Monza');
        const series = (await DB.series({ force: true })).find(s => s.id === 's-gt');
        return { stored: race.carChoices, eff: Garage.choicesFor(race, series) };
    });
    log((inherited.stored || []).length === 0
        && JSON.stringify(inherited.eff) === JSON.stringify(['phoenix-gt-r-street-spec', 'falcon-rs-coupe']) ? '✅' : '❌',
        `Blank input clears the override → race inherits series list (${inherited.eff.join(' ')})`);

    await browser.close();
    const fails = steps.filter(s => s.startsWith('❌'));
    console.log(`\n${steps.length - fails.length}/${steps.length} steps passed`);
    process.exit(fails.length ? 1 : 0);
})();
