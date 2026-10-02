/* Drive series rules, race sheets and result proof (js/race-rules.js,
   js/srmpc-racesheet.js) on the in-memory Firebase shim:
   library-suggested formats (spec MX-5 / BoP GT3 / open Wreckfest), the
   GM's ⚖️ Rules form (success ballast, a Wreckfest class preset, a BoP
   table, proof defaults) and 📋 Race sheet form (online, wet, pit rule,
   allowed cars), the race window (race code, session name, host settings,
   briefing from the sheet), tech inspection blocking a spec signup until a
   shop removes the engine build and dyno tune, a BoP car pick turning into
   ACC ballast + restrictor, team efficiency moving simulated pace, the
   driver's results file (wrong track → rejected; right file → verified and
   auto-filled) and screenshot (OCR stubbed: wrong track → rejected; right
   one → verified, image kept), the GM's proof badges, a wrong-race import
   blocked until an override reason is given (logged on the race), entry
   adjustments + entrylist.json, and the Director only auto-confirming
   verified reports. Ends with a leak scan and a 390px check.
   Run: node rules-drive.js   (serve the repo root on :8317 first) */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
let pass = 0, fail = 0;
const log = (ok, m) => { if (ok === true || ok === '✅') pass++; else fail++; console.log(ok === true || ok === '✅' ? '✅' : '❌', m); };
const shots = path.join(__dirname, 'rules-shots');
fs.mkdirSync(shots, { recursive: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
    await page.route('**/*', r => r.request().url().startsWith('http://localhost:8317')
        ? r.continue() : r.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.addInitScript({ path: path.join(__dirname, 'firebase-shim.js') });
    await page.addInitScript(() => {
        window.confirm = () => true; window.prompt = () => ''; window.alert = () => {};
        // OCR stand-in: the drive decides what the "screenshot" says.
        window.Tesseract = { recognize: async () => ({ data: { text: window.__ocrText || '' } }) };
    });
    page.on('pageerror', e => log(false, 'pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource|\[SRMPC\]/.test(m.text())) log(false, 'console error: ' + m.text().slice(0, 200)); });

    await page.goto('http://localhost:8317/sim-racing-career/app.html');
    await page.waitForSelector('#auth-gate:not(.hidden), #app-shell:not(.hidden)');
    await page.click('.gate-tab[data-pane="admin"]');
    await page.fill('#gate-passcode', 'phoenix13!');
    await page.click('#gate-admin-submit');
    await page.waitForSelector('#app-shell:not(.hidden)');

    const wait = (ms = 150) => page.waitForTimeout(ms);
    const clearToasts = () => page.evaluate(() => document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove()));
    const toast = async (re, ms = 6000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
            const t = await page.evaluate(() => document.getElementById('toast-holder')?.innerText || '');
            if (re.test(t)) { await clearToasts(); return t.replace(/\s+/g, ' ').trim(); }
            await wait(100);
        }
        const t = await page.evaluate(() => document.getElementById('toast-holder')?.innerText || '');
        await clearToasts();
        return 'NO MATCH: ' + t.replace(/\s+/g, ' ').trim();
    };
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
    const modalText = () => page.evaluate(() => document.querySelector('.modal-card')?.innerText || '');
    const leaks = (txt) => (txt.match(/NaN|undefined|\[object [A-Z]/g) || []);
    const showRace = async (id, sel = '.modal-card') => { await page.evaluate((id) => Views.showRace(id), id); await page.waitForSelector(sel); await wait(250); };

    /* ---------------- seed ---------------- */
    const seed = await page.evaluate(async () => {
        const db = SRMPC.db;
        const today = Util.todayISO();
        const d = new Date(); d.setDate(d.getDate() - 1);
        const yesterday = d.toISOString().slice(0, 10);
        await db.collection('games').doc('g-acc').set({ name: 'Assetto Corsa Competizione', libraryId: 'acc' });
        await db.collection('games').doc('g-ir').set({ name: 'iRacing', libraryId: 'iracing' });
        await db.collection('games').doc('g-wf').set({ name: 'Wreckfest', libraryId: 'wreckfest' });
        await db.collection('series').doc('s-gt3').set({ name: 'GT3 Sprint Cup', short: 'GT3', gameId: 'g-acc', libraryId: 'sprint', libraryGame: 'acc', status: 'active', pointsSystem: 'f1' });
        await db.collection('series').doc('s-mx5').set({ name: 'MX-5 Cup', short: 'MX5', gameId: 'g-ir', libraryId: 'mx5', libraryGame: 'iracing', status: 'active', pointsSystem: 'f1' });
        await db.collection('series').doc('s-stock').set({ name: 'Street Stock Bash', gameId: 'g-wf', libraryId: 'amateur', libraryGame: 'wreckfest', status: 'active', pointsSystem: 'f1' });
        await db.collection('teams').doc('t-works').set({ name: 'Works Mazda', seriesId: 's-mx5', ownerUid: null, isNPC: true, budget: 500000 });
        await db.collection('teams').doc('t-garage').set({ name: 'Garage Heroes', seriesId: 's-mx5', ownerUid: null, isNPC: true, budget: -5000 });
        const staff = [['crew-chief', 92], ['race-engineer', 90], ['mechanic', 88], ['spotter', 85]];
        for (const [role, rating] of staff) await db.collection('staff').doc('st-' + role).set({ name: 'Works ' + role, role, rating, teamId: 't-works', isNPC: true });
        for (const [id, team] of [['d-w1', 't-works'], ['d-w2', 't-works'], ['d-g1', 't-garage'], ['d-g2', 't-garage']]) await db.collection('drivers').doc(id).set({ name: id.toUpperCase() + ' Racer', teamId: team, rating: 75, isNPC: true, seriesId: 's-mx5' });
        const car = { id: 'car1', name: 'Mazda MX-5 Cup', carId: 'mazda-mx5-cup', stats: { performance: 6, durability: 6 }, price: 60000, races: 0,
            cond: { engine: 100, gearbox: 100, suspension: 100, brakes: 100, tyres: 100, body: 100 }, parts: { engine: { tier: 2, eff: 1 } }, tune: 1, history: [] };
        await db.collection('users').doc('u-ann').set({ displayName: 'Ann', balance: 200000, walletInitialized: true, difficulty: 'easy', activeRole: 'driver', driverId: 'd-ann', garage: [car], garageCarIds: ['mazda-mx5-cup'], paddock: { raceCar: 'car1', seen: true } });
        await db.collection('drivers').doc('d-ann').set({ name: 'Ann Apex', ownerUid: 'u-ann', teamId: null, status: 'approved', number: 7 });
        await db.collection('users').doc('u-bob').set({ displayName: 'Bob', balance: 50000, walletInitialized: true, difficulty: 'easy', activeRole: 'driver', driverId: 'd-bob' });
        await db.collection('drivers').doc('d-bob').set({ name: 'Bob Brake', ownerUid: 'u-bob', teamId: null, status: 'approved', number: 9 });
        await db.collection('races').doc('r-gt3').set({ seriesId: 's-gt3', gameId: 'g-acc', name: 'GT3 Sprint — Monza', track: 'Monza', laps: 20, date: today, time: '20:00', status: 'scheduled', round: 1, results: [] });
        await db.collection('races').doc('r-mx5').set({ seriesId: 's-mx5', gameId: 'g-ir', name: 'MX-5 Cup — Road America', track: 'Road America', laps: 20, date: today, time: '20:00', status: 'scheduled', round: 1, results: [] });
        await db.collection('races').doc('r-stock').set({ seriesId: 's-stock', gameId: 'g-wf', name: 'Bash — Big Valley', track: 'Big Valley Speedway', laps: 10, date: '2030-01-01', status: 'scheduled', round: 1, results: [] });
        await db.collection('races').doc('r-auto').set({ seriesId: 's-gt3', gameId: 'g-acc', name: 'GT3 Sprint — Monza II', track: 'Monza', laps: 20, date: yesterday, status: 'scheduled', round: 2, results: [] });
        DB.invalidate();
        return { today, yesterday };
    });
    const yymmdd = seed.today.slice(2).replace(/-/g, '');
    const accFile = ({ track, server, session = 'R', annPos = 2 }) => {
        const names = ['Rival One', 'Rival Two', 'Rival Three'];
        names.splice(annPos - 1, 0, 'Ann Apex');
        return JSON.stringify({
            sessionType: session, trackName: track, serverName: server, sessionIndex: 1,
            sessionResult: { isWetSession: 1, leaderBoardLines: names.map((n, i) => ({
                car: { raceNumber: 10 + i, carModel: 34, teamName: '', drivers: [{ firstName: n.split(' ')[0], lastName: n.split(' ')[1] }] },
                currentDriver: { firstName: n.split(' ')[0], lastName: n.split(' ')[1] },
                timing: { lapCount: 20, bestLap: 100000 + i * 37, totalTime: 2000000 + i * 1000 }
            })) }
        });
    };

    /* ---------------- 1. Library-suggested formats ---------------- */
    const fmts = await page.evaluate(async () => {
        const world = await DB.loadWorld(true);
        const f = (id) => RaceSheet.rulesFor(world.races.find(r => r.id === id), world).format;
        App.go('series-detail', 's-mx5');
        await new Promise(r => setTimeout(r, 400));
        return { gt3: f('r-gt3'), mx5: f('r-mx5'), stock: f('r-stock'), chip: /Spec/.test(document.getElementById('view-root').innerText), btn: /Rules & race sheets/i.test(document.getElementById('view-root').innerText) };
    });
    log(fmts.gt3 === 'bop' && fmts.mx5 === 'spec' && fmts.stock === 'open' && fmts.chip && fmts.btn,
        `Suggested formats: GT3 ${fmts.gt3}, MX-5 Cup ${fmts.mx5}, Wreckfest ${fmts.stock}; the series page shows the format chip + ⚖️ button`);

    /* ---------------- 2. GM: ⚖️ Rules forms ---------------- */
    await page.evaluate(() => RaceSheet.seriesRulesForm('s-mx5'));
    await page.waitForSelector('#rs-rules-form');
    const mxDefault = await page.$eval('#rs-format', s => s.value);
    await page.selectOption('#rs-sb-mode', 'standings');
    await page.fill('#rs-sb-steps', '30, 20, 10');
    await page.screenshot({ path: path.join(shots, '01-series-rules.png') });
    await page.click('#rs-rules-form button[type=submit]');
    const t2 = await toast(/Rules saved/);
    const mx = await page.evaluate(async () => (await DB.get('series', 's-mx5', { force: true })).rules);
    log(mxDefault === 'spec' && mx?.format === 'spec' && mx.ballast.mode === 'standings' && mx.ballast.steps.join() === '30,20,10', `MX-5 rules saved (spec + success ballast 30/20/10): ${t2}`);

    await page.evaluate(() => RaceSheet.seriesRulesForm('s-stock'));
    await page.waitForSelector('#rs-class');
    await page.selectOption('#rs-class', 'C');
    const preset = await page.evaluate(() => [document.getElementById('rs-cap-min').value, document.getElementById('rs-cap-max').value]);
    await page.fill('#rs-cap-pi', '70');
    await page.click('#rs-rules-form button[type=submit]');
    await toast(/Rules saved/);
    const st = await page.evaluate(async () => (await DB.get('series', 's-stock', { force: true })).rules);
    log(preset.join() === '120,164' && st.format === 'open' && st.cap.label === 'C' && st.cap.gameMax === 164 && st.cap.pi === 70, `Wreckfest class C preset fills 120–164 PP; paddock PI limit 70 saved`);

    await page.evaluate(() => RaceSheet.seriesRulesForm('s-gt3'));
    await page.waitForSelector('#rs-bop');
    await page.fill('#rs-bop', 'Porsche 992 GT3 R | 15 | 98\nFerrari 296 GT3 | 0 | 100');
    await page.selectOption('#rs-d-proof', 'file-or-shot');
    await page.click('#rs-rules-form button[type=submit]');
    await toast(/Rules saved/);
    const g3 = await page.evaluate(async () => DB.get('series', 's-gt3', { force: true }));
    log(g3.rules.format === 'bop' && g3.rules.bop.length === 2 && g3.rules.bop[0].powerPct === 98 && g3.sheet.proof === 'file-or-shot', 'GT3 BoP table + "results file or screenshot" proof saved');

    /* ---------------- 3. GM: 📋 race sheet ---------------- */
    await page.evaluate(() => RaceSheet.raceSheetForm('r-gt3'));
    await page.waitForSelector('#rs-sheet-form');
    await page.selectOption('#rs-mode', 'online');
    await page.selectOption('#rs-weather', 'wet');
    await page.fill('#rs-pit', 'One mandatory stop, 4 tyres');
    await page.fill('#rs-cars', 'Porsche 992 GT3 R, Ferrari 296 GT3');
    await page.screenshot({ path: path.join(shots, '02-race-sheet.png') });
    await page.click('#rs-sheet-form button[type=submit]');
    await toast(/Race sheet saved/);
    await page.waitForSelector('.modal-card .rs-rules');
    await wait(300);
    const gm = await page.evaluate(async () => {
        const r = await DB.get('races', 'r-gt3', { force: true });
        return { d: r.details, text: document.querySelector('.modal-card').innerText, host: document.querySelector('.rs-host')?.textContent || '', entry: !!document.querySelector('.rs-gm') };
    });
    const code = gm.d?.code;
    log(/^PX1-[A-Z0-9]{4}$/.test(code || '') && gm.d.mode === 'online' && gm.d.proof === 'file-or-shot' && gm.d.weather === 'wet'
        && new RegExp(code).test(gm.text) && /Phoenix GT3/.test(gm.text) && /Wet/.test(gm.text) && /One mandatory stop/.test(gm.text) && /entrylist\.json/.test(gm.host) && !/\(Wet\)/.test(gm.text) && /Proof needed/i.test(gm.text) && gm.entry,
        `Race sheet saved (code ${code}); the race window shows it: session name, wet weather, pit rule, ACC host settings, proof`);
    await page.screenshot({ path: path.join(shots, '03-race-window-gm.png'), fullPage: true });

    /* ---------------- 4. Tech inspection blocks a spec signup ---------------- */
    await actAs('u-ann');
    await showRace('r-mx5', '.modal-card .rs-rules');
    const blocked = await page.evaluate(() => ({
        illegal: !!document.querySelector('.rs-illegal'), text: document.querySelector('.rs-illegal')?.innerText || '',
        disabled: document.querySelector('.modal-card button.btn-primary[onclick*="toggleSignup"]')?.disabled
    }));
    await page.evaluate(() => Views.toggleSignup('r-mx5'));
    const t4 = await toast(/Tech inspection failed|grid/);
    const noSignup = await page.evaluate(async () => !(await DB.signups({ force: true })).some(s => s.raceId === 'r-mx5'));
    log(blocked.illegal && /Engine build/.test(blocked.text) && /Dyno tune/.test(blocked.text) && blocked.disabled && /Tech inspection failed/.test(t4) && noSignup,
        `Spec MX-5 Cup: the engine build + dyno tune fail tech inspection, sign-up refused ("${t4.slice(0, 80)}…")`);
    await page.locator('.modal-card .rs-rules').screenshot({ path: path.join(shots, '04-tech-fail.png') });

    // A shop takes them off (🪛 Remove a part); parts go on the shelf.
    for (const part of ['engine', 'tune']) {
        await page.evaluate(() => Paddock.bookModal('user__u-ann', 'car1', null, null));
        await page.waitForSelector('#pd-book');
        await page.selectOption('#pd-b-svc', 'remove');
        await wait(100);
        const opts = await page.$$eval('#pd-b-part option', o => o.map(x => x.value));
        await page.selectOption('#pd-b-part', part);
        await wait(100);
        const q = await page.$eval('#pd-b-quote', e => e.innerText);
        if (part === 'engine') log(opts.join() === 'engine,tune' && /kept on your shelf/.test(q) && /PI \d+ → \d+/.test(q), `Remove a part lists only what's fitted (${opts.join(', ')}); quote: ${q.split('\n')[0]}`);
        await page.click('#pd-book button[type=submit]');
        await toast(/Removed|stock engine map/);
        await actAs('u-ann');
    }
    const carNow = await page.evaluate(async () => (await DB.get('users', 'u-ann', { force: true })).garage[0]);
    log(!carNow.parts.engine && carNow.tune === 0 && carNow.shelf?.engine?.tier === 2, 'Engine build + tune removed; the engine build waits on the shelf');

    await showRace('r-mx5', '.modal-card .rs-rules');
    await page.click('.modal-card button:has-text("Sign me up")');
    const t5 = await toast(/on the grid|failed/);
    await page.waitForSelector('.modal-card .rs-mine');
    await wait(250);
    const mine = await page.evaluate(() => document.querySelector('.rs-mine').innerText);
    log(/on the grid/.test(t5) && /Tech inspection: legal/i.test(mine) && /Team efficiency \d+/.test(mine) && /Racing offline vs AI/.test(mine),
        `Now legal: signed up; Your entry shows inspection, team efficiency and the offline AI tip`);
    await page.locator('.modal-card .rs-rules').screenshot({ path: path.join(shots, '05-your-entry.png') });

    /* ---------------- 5. Team efficiency in simulated races ---------------- */
    const pace = await page.evaluate(async () => {
        const world = await DB.loadWorld(true);
        const race = world.races.find(r => r.id === 'r-mx5');
        const grid = await Sim.gridFor(race, world);
        const b = await RaceSheet.simPaceMap(race, world, grid);
        const data = await RaceSheet.effData(race);
        const works = RaceSheet.efficiencyFor(world.driversById['d-w1'], race, world, data, { teamId: 't-works' }).score;
        const garage = RaceSheet.efficiencyFor(world.driversById['d-g1'], race, world, data, { teamId: 't-garage' }).score;
        return { w: b['d-w1'], g: b['d-g1'], ann: b['d-ann'], n: grid.length, works, garage };
    });
    log(pace.n === 5 && pace.w - pace.g > 2 && Math.abs(pace.w) < 6 && Math.abs(pace.g) < 6 && typeof pace.ann === 'number',
        `Spec series: identical cars, but Works Mazda (efficiency ${pace.works}) gets ${pace.w.toFixed(2)} pace vs Garage Heroes (${pace.garage}, broke) ${pace.g.toFixed(2)}`);

    /* ---------------- 6. BoP pick → ACC ballast + restrictor ---------------- */
    await showRace('r-gt3', '.modal-card .rs-rules');
    await page.click('.modal-card button:has-text("Sign me up")');
    await toast(/on the grid/);
    await page.waitForSelector('#rs-gamecar');
    await page.selectOption('#rs-gamecar', 'Porsche 992 GT3 R');
    const t6 = await toast(/Car model saved/);
    await page.waitForSelector('.modal-card .rs-mine');
    await wait(300);
    const bopTxt = await page.evaluate(() => document.querySelector('.rs-mine').innerText);
    const sg = await page.evaluate(async () => (await DB.signups({ force: true })).find(s => s.raceId === 'r-gt3' && s.uid === 'u-ann'));
    log(sg?.gameCar === 'Porsche 992 GT3 R' && /15 kg ballast/.test(bopTxt) && /2% restrictor/.test(bopTxt) && /BoP for the Porsche 992 GT3 R/.test(bopTxt),
        `BoP: picking the Porsche 992 GT3 R puts 15 kg + 2% restrictor (98% power) on Ann's ACC entry (${t6.slice(0, 40)})`);

    /* ---------------- 7. Results file proof ---------------- */
    await page.waitForSelector('#rep-proof-file');
    await page.setInputFiles('#rep-proof-file', { name: `${yymmdd}_201500_R.json`, mimeType: 'application/json', buffer: Buffer.from(accFile({ track: 'spa', server: `Phoenix GT3 ${code}` })) });
    await page.waitForSelector('#rep-proof-out .rs-check-invalid');
    const badCheck = await page.$eval('#rep-proof-out', e => e.innerText);
    await page.click('#lib-rep-form button[type=submit]');
    const t7 = await toast(/Proof rejected|reported/);
    const noRep = await page.evaluate(async () => !(await DB.signups({ force: true })).find(s => s.raceId === 'r-gt3' && s.uid === 'u-ann')?.report);
    log(/spa — this race is at Monza/.test(badCheck) && /Proof rejected/.test(t7) && noRep, `A results file from Spa is rejected for the Monza race: "${t7.slice(0, 90)}"`);

    await page.fill('#rep-pos', '');
    await page.setInputFiles('#rep-proof-file', { name: `${yymmdd}_201510_R.json`, mimeType: 'application/json', buffer: Buffer.from(accFile({ track: 'monza', server: `Phoenix GT3 ${code}` })) });
    await page.waitForSelector('#rep-proof-out .rs-check-valid');
    const filled = await page.$eval('#rep-pos', e => e.value);
    await page.locator('.modal-card .lib-report').screenshot({ path: path.join(shots, '06-file-proof.png') });
    await page.click('#lib-rep-form button[type=submit]');
    const t8 = await toast(/verified proof|reported|rejected/);
    const rep = await page.evaluate(async () => (await DB.signups({ force: true })).find(s => s.raceId === 'r-gt3' && s.uid === 'u-ann')?.report);
    log(filled === '2' && /verified proof/.test(t8) && rep?.position === 2 && rep.proof?.status === 'valid' && rep.proof.kind === 'file' && rep.proof.checks.some(c => c.key === 'code' && c.ok),
        `The right file (Monza, race session, 20 laps, server name with ${code}) fills P2 from Ann's row and is verified`);

    // Changing the claim without new proof drops the old proof (and this race needs some).
    await showRace('r-gt3', '#lib-rep-form');
    await page.fill('#rep-pos', '1');
    await page.click('#lib-rep-form button[type=submit]');
    const t9 = await toast(/needs proof|reported/);
    const still = await page.evaluate(async () => (await DB.signups({ force: true })).find(s => s.raceId === 'r-gt3' && s.uid === 'u-ann')?.report?.position);
    log(/needs proof/.test(t9) && still === 2, 'Upgrading the claim to P1 without new proof is refused — the verified P2 stands');

    /* ---------------- 8. Screenshot proof (OCR stubbed) ---------------- */
    await showRace('r-mx5', '#rep-proof-shot');
    await page.evaluate(() => { window.__ocrText = 'DAYTONA INTERNATIONAL SPEEDWAY  RACE RESULTS  LAP 20/20  3  Ann Apex'; });
    await page.setInputFiles('#rep-proof-shot', { name: 'results.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForSelector('#rep-proof-out .rs-check-invalid');
    await page.fill('#rep-pos', '3');
    await page.click('#lib-rep-form button[type=submit]');
    const t10 = await toast(/Proof rejected|reported/);
    log(/Proof rejected/.test(t10) && /Daytona/.test(t10), `A screenshot that reads "Daytona" is rejected for Road America: "${t10.slice(0, 90)}"`);
    await page.evaluate(() => { window.__ocrText = 'ROAD AMERICA  RACE RESULTS  LAP 20/20\n1 D-W1 Racer\n2 D-G1 Racer\n3 Ann Apex'; });
    await page.setInputFiles('#rep-proof-shot', { name: 'results2.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForSelector('#rep-proof-out .rs-check-valid');
    await page.click('#lib-rep-form button[type=submit]');
    const t11 = await toast(/reported|rejected/);
    const shot = await page.evaluate(async () => (await DB.signups({ force: true })).find(s => s.raceId === 'r-mx5' && s.uid === 'u-ann')?.report);
    log(/verified proof/.test(t11) && shot?.position === 3 && shot.proof?.kind === 'shot' && shot.proof.status === 'valid' && /^data:image\/jpeg/.test(shot.proof.image || ''),
        `A screenshot reading Road America, LAP 20/20 and Ann's name is verified; the image is kept for the GM`);

    /* ---------------- 9. GM: entry adjustments + entrylist.json ---------------- */
    await asGM();
    await page.evaluate(() => RaceSheet.entryTable('r-gt3'));
    await page.waitForSelector('.modal-card table');
    const et = await modalText();
    const [dl, text] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => RaceSheet.downloadEntryList('r-gt3'))]);
    const downloaded = fs.readFileSync(await dl.path(), 'utf8');
    const el = JSON.parse(downloaded);
    log(/Ann Apex/.test(et) && /15 kg/.test(et) && dl.suggestedFilename() === 'entrylist.json' && el.forceEntryList === 1 && el.entries[0].ballastKg === 15 && el.entries[0].restrictor === 2 && text === downloaded,
        `Entry adjustments list Ann at 15 kg; entrylist.json downloads with ballastKg 15 / restrictor 2`);
    await clearToasts();

    /* ---------------- 10. GM: proof badges, wrong-race import + override ---------------- */
    await page.evaluate(() => Admin.resultsForm('r-gt3'));
    await page.waitForSelector('#results-form');
    const badge = await page.evaluate(() => document.querySelector('#results-form tr[data-driver="d-ann"]')?.innerText || '');
    await page.click('.lib-import summary');
    await page.setInputFiles('#lib-im-file', { name: `${yymmdd}_211500_R.json`, mimeType: 'application/json', buffer: Buffer.from(accFile({ track: 'spa', server: 'Some Other Server', annPos: 1 })) });
    await page.click('#lib-im-read');
    await page.waitForSelector('#lib-im-map .rs-check-invalid');
    const applyDisabled = await page.$eval('#lib-im-apply', b => b.disabled);
    await page.check('#lib-im-override');
    await page.fill('#lib-im-reason', 'Server crashed, rerun at Spa by agreement');
    const enabled = await page.$eval('#lib-im-apply', b => !b.disabled);
    await page.screenshot({ path: path.join(shots, '07-import-override.png'), fullPage: true });
    await page.click('#lib-im-apply');
    const t12 = await toast(/Applied/);
    await page.click('#results-form button[type=submit]');
    const t13 = await toast(/Results saved/);
    const saved = await page.evaluate(async () => (await DB.get('races', 'r-gt3', { force: true })));
    log(/file verified/.test(badge) && applyDisabled && enabled && /override logged/.test(t12) && /Results saved/.test(t13) && saved.status === 'completed'
        && saved.resultsCheck?.status === 'invalid' && /Server crashed/.test(saved.resultsCheck?.override?.reason || ''),
        `GM sees Ann's "file verified" badge; a Spa file is blocked until the override + reason, which is logged on the race`);

    await page.evaluate(() => Admin.resultsForm('r-mx5'));
    await page.waitForSelector('#results-form');
    const thumb = await page.evaluate(() => !!document.querySelector('#results-form tr[data-driver="d-ann"] .rs-shot img') && /screenshot verified/.test(document.querySelector('#results-form tr[data-driver="d-ann"]').innerText));
    log(thumb, "The MX-5 results form shows Ann's verified screenshot inline");
    await page.evaluate(() => Modal.close(true, true));

    /* ---------------- 11. Director: auto-confirm only verified reports ---------------- */
    const dir = await page.evaluate(async () => {
        const db = SRMPC.db;
        const good = { status: 'valid', kind: 'file', checks: [], name: 'x.json' };
        await db.collection('raceSignups').doc('sg-a').set({ raceId: 'r-auto', uid: 'u-ann', driverId: 'd-ann', via: 'open', report: { position: 1, dnf: false, proof: good } });
        await db.collection('raceSignups').doc('sg-b').set({ raceId: 'r-auto', uid: 'u-bob', driverId: 'd-bob', via: 'open', report: { position: 2, dnf: false } });
        DB.invalidate();
        const acts = [];
        const act = (i, m) => acts.push(i + ' ' + m);
        await Director._races({ autoConfirm: true, aiFill: false, graceDays: 1 }, act);
        const first = (await DB.get('races', 'r-auto', { force: true })).status;
        await db.collection('raceSignups').doc('sg-b').set({ raceId: 'r-auto', uid: 'u-bob', driverId: 'd-bob', via: 'open', report: { position: 2, dnf: false, proof: good } });
        DB.invalidate();
        await Director._races({ autoConfirm: true, aiFill: false, graceDays: 1 }, act);
        const r = await DB.get('races', 'r-auto', { force: true });
        return { first, second: r.status, acts, n: (r.results || []).length };
    });
    log(dir.first !== 'completed' && dir.acts.some(a => /without verified proof/.test(a)) && dir.second === 'completed' && dir.n === 2,
        `Director waits while Bob's report has no proof ("${dir.acts[0]}"), then confirms once both are verified`);

    /* ---------------- 12. Leak scan + phone width ---------------- */
    await actAs('u-ann');
    await page.setViewportSize({ width: 390, height: 900 });
    await showRace('r-stock', '.modal-card .rs-rules');
    const phone = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, text: document.querySelector('.modal-card').innerText }));
    await page.screenshot({ path: path.join(shots, '08-phone.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await showRace('r-mx5', '.modal-card .rs-rules');
    const mxText = await modalText();
    const allLeaks = leaks(phone.text).concat(leaks(mxText), leaks(gm.text));
    log(phone.w <= 392 && /Open \(build to the class\)/.test(phone.text) && /C · ≤ 164 PP · paddock PI ≤ 70/.test(phone.text) && /Build your in-game car to/.test(phone.text) && !allLeaks.length,
        `Wreckfest race at 390px: no sideways scroll (${phone.w}px), class C limit + Ann's PP build allowance; no leaked values${allLeaks.length ? ' — ' + allLeaks.join(',') : ''}`);

    console.log(`\n${pass}/${pass + fail} steps passed`);
    await browser.close();
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
