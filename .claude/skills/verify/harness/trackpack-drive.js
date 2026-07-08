/* Drive the game-based Track Pack flows through the real UI on the shim:
   load packs per game, cross-game duplicates, game filter, custom track with
   logo, game-filtered track library in the schedule builder & race form,
   and the Real-World Pack's game choice. */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = __dirname;
const TRACKPACK_COUNTS = { gt7: 29 }; // expected pack sizes
const steps = [];
const log = (mark, msg) => { steps.push(`${mark} ${msg}`); console.log(`${mark} ${msg}`); };

// 1x1 red PNG for the custom-track logo upload.
const LOGO_PNG = path.join(__dirname, 'logo-test.png');
fs.writeFileSync(LOGO_PNG, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    await page.route('**/*', r => {
        const url = r.request().url();
        if (url.startsWith('http://localhost:8317')) return r.continue();
        const type = url.endsWith('.css') || url.includes('fonts.googleapis') ? 'text/css' : 'application/javascript';
        return r.fulfill({ contentType: type, body: '/* blocked by test */' });
    });
    await page.addInitScript({ path: path.join(__dirname, 'firebase-shim.js') });
    await page.addInitScript(() => {
        window.__dialogs = [];
        window.confirm = () => true;
        window.prompt = () => 'Test Season';
        window.alert = () => {};
    });
    page.on('pageerror', e => log('❌', 'pageerror: ' + e.message));

    const toast = async (re = /./, timeout = 30000) => {
        await page.waitForFunction((s) => new RegExp(s).test(document.getElementById('toast-holder')?.innerText || ''), re.source, { timeout });
        const text = await page.evaluate(() => document.getElementById('toast-holder').innerText.replace(/\n+/g, ' · '));
        await page.evaluate(() => document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove()));
        return text.trim();
    };
    const shot = async (name) => {
        await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(SHOT_DIR, name + '.png'), fullPage: false });
    };

    await page.goto('http://localhost:8317/sim-racing-career/app.html');
    await page.waitForSelector('#auth-gate:not(.hidden)');

    /* ---- 1. GM unlock ---- */
    await page.click('.gate-tab[data-pane="admin"]');
    await page.fill('#gate-passcode', 'phoenix13!');
    await page.click('#gate-admin-submit');
    await page.waitForSelector('#app-shell:not(.hidden)');
    log('✅', 'GM unlock: ' + (await toast(/Welcome back/)));

    /* ---- 2. Load the GT7 pack — game auto-created, tracks tagged ---- */
    await page.evaluate(() => App.go('admin', 'world'));
    await page.waitForSelector('#admin-body .panel');
    await page.click('#admin-body button:has-text("Load Track Pack")');
    await page.waitForSelector('#track-pack-form');
    const packOptions = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#tp-pack option')).map(o => o.textContent));
    log(packOptions.length >= 6 ? '✅' : '❌', `Pack picker offers ${packOptions.length} games: ${packOptions.join(' | ')}`);
    await page.selectOption('#tp-pack', 'gt7');
    await page.click('#track-pack-form button[type=submit]');
    log('✅', 'GT7 pack: ' + (await toast(/track pack loaded/)));
    const gt7 = await page.evaluate(async () => {
        const game = (await DB.games({ force: true })).find(g => g.name === 'Gran Turismo 7');
        const tracks = (await DB.tracks({ force: true })).filter(t => t.gameId === game?.id);
        return { game: !!game, platform: game?.platform, count: tracks.length, gameId: game?.id };
    });
    log(gt7.game && gt7.count === TRACKPACK_COUNTS.gt7 ? '✅' : '❌',
        `Game "Gran Turismo 7" (${gt7.platform}) auto-created with ${gt7.count} tagged tracks`);

    /* ---- 3. Re-run GT7 pack → idempotent ---- */
    await page.click('#admin-body button:has-text("Load Track Pack")');
    await page.waitForSelector('#track-pack-form');
    await page.selectOption('#tp-pack', 'gt7');
    await page.click('#track-pack-form button[type=submit]');
    const rerun = await toast(/track pack loaded/);
    const gt7After = await page.evaluate(async (gid) =>
        (await DB.tracks({ force: true })).filter(t => t.gameId === gid).length, gt7.gameId);
    log(gt7After === gt7.count && /0 tracks added/.test(rerun) ? '✅' : '❌',
        `Pack re-run is idempotent: still ${gt7After} GT7 tracks (${rerun})`);

    /* ---- 4. Load iRacing pack — same circuit can live under two games ---- */
    await page.click('#admin-body button:has-text("Load Track Pack")');
    await page.waitForSelector('#track-pack-form');
    await page.selectOption('#tp-pack', 'iracing');
    await page.click('#track-pack-form button[type=submit]');
    log('✅', 'iRacing pack: ' + (await toast(/track pack loaded/)));
    const dupes = await page.evaluate(async () => {
        const tracks = await DB.tracks({ force: true });
        const suzukas = tracks.filter(t => t.name === 'Suzuka Circuit');
        return { suzukas: suzukas.length, games: new Set(suzukas.map(t => t.gameId)).size };
    });
    log(dupes.suzukas === 2 && dupes.games === 2 ? '✅' : '❌',
        `Suzuka exists once per game (${dupes.suzukas} entries across ${dupes.games} games) — cross-game duplicates by design`);

    /* ---- 5. Game filter on the tracks table ---- */
    await page.waitForSelector('#track-game-filter');
    await page.selectOption('#track-game-filter', gt7.gameId);
    await page.waitForSelector('#admin-body .panel table');
    const filtered = await page.evaluate(() => ({
        rows: document.querySelectorAll('#admin-body .panel:first-of-type tbody tr').length,
        head: document.querySelector('#admin-body .panel:first-of-type .panel-head h2').textContent.trim()
    }));
    log(filtered.rows === gt7After ? '✅' : '❌',
        `Game filter: "${filtered.head}" shows ${filtered.rows} GT7 rows only`);

    /* ---- 6. Custom track with its own logo ---- */
    await page.click('#admin-body button:has-text("＋ Add Track")');
    await page.waitForSelector('#track-form');
    await page.fill('#tk-name', 'Phoenix Custom Speedway');
    await page.selectOption('#tk-game', gt7.gameId);
    await page.selectOption('#tk-type', 'Oval');
    await page.setInputFiles('#tk-logo', LOGO_PNG);
    await page.click('#track-form button[type=submit]');
    log('✅', 'Custom track: ' + (await toast(/Track added/)));
    const custom = await page.evaluate(async (gid) => {
        const t = (await DB.tracks({ force: true })).find(x => x.name === 'Phoenix Custom Speedway');
        const img = Array.from(document.querySelectorAll('#admin-body .logo-box img'))
            .some(i => i.src.startsWith('data:image'));
        return { gameId: t?.gameId === gid, logo: (t?.logo || '').startsWith('data:image'), imgShown: img };
    }, gt7.gameId);
    log(custom.gameId && custom.logo && custom.imgShown ? '✅' : '❌',
        `Custom track saved with gameId + logo data URI, logo renders in the table (${JSON.stringify(custom)})`);
    await shot('13-trackpacks-world');

    /* ---- 7. Schedule builder: track library follows the series' game ---- */
    const seriesIds = await page.evaluate(async (gid) => {
        const iracing = (await DB.games({ force: true })).find(g => g.name === 'iRacing');
        const a = await DB.create('series', { name: 'GT7 Cup', gameId: gid, season: 2026, pointsSystem: 'f1', status: 'active' });
        const b = await DB.create('series', { name: 'iRacing Cup', gameId: iracing.id, season: 2026, pointsSystem: 'f1', status: 'active' });
        return { a, b };
    }, gt7.gameId);
    await page.evaluate((sid) => Admin.scheduleBuilder(sid), seriesIds.a);
    await page.waitForSelector('#sb-lib .chip-btn');
    const lib1 = await page.evaluate(() => ({
        label: document.getElementById('sb-lib-label').textContent,
        chips: document.querySelectorAll('#sb-lib .chip-btn').length
    }));
    log(/Gran Turismo 7/.test(lib1.label) && lib1.chips === gt7After + 1 ? '✅' : '❌',
        `Builder library: "${lib1.label}" with ${lib1.chips} chips (GT7 tracks + custom)`);

    // Click two chips → they land in the textarea and the preview updates.
    await page.click('#sb-lib .chip-btn:has-text("Suzuka Circuit")');
    await page.click('#sb-lib .chip-btn:has-text("Trial Mountain Circuit")');
    const taState = await page.evaluate(() => ({
        value: document.getElementById('sb-tracks').value,
        preview: document.getElementById('sb-preview').textContent
    }));
    log(taState.value === 'Suzuka Circuit\nTrial Mountain Circuit' && /2 races/.test(taState.preview) ? '✅' : '❌',
        `Chip clicks fill the schedule (${JSON.stringify(taState.value)}; preview: ${taState.preview})`);
    await shot('14-builder-library');

    // Switch series → library swaps to the iRacing pool.
    await page.selectOption('#sb-series', seriesIds.b);
    const lib2 = await page.evaluate(() => ({
        label: document.getElementById('sb-lib-label').textContent,
        chips: document.querySelectorAll('#sb-lib .chip-btn').length
    }));
    log(/iRacing/.test(lib2.label) && lib2.chips !== lib1.chips ? '✅' : '❌',
        `Switching series swaps the library: "${lib2.label}" with ${lib2.chips} chips`);
    await page.evaluate(() => Modal.close());

    /* ---- 8. Race form: track datalist follows the game ---- */
    await page.evaluate(() => Admin.raceForm(null));
    await page.waitForSelector('#race-form');
    const dlAll = await page.evaluate(() => document.querySelectorAll('#rf-track-dl option').length);
    await page.selectOption('#rf-series', seriesIds.a);
    const dlGt7 = await page.evaluate(() => document.querySelectorAll('#rf-track-dl option').length);
    log(dlGt7 === gt7After + 1 && dlAll > dlGt7 ? '✅' : '❌',
        `Race form suggestions: ${dlAll} tracks for all games → ${dlGt7} once a GT7 series is picked`);
    await page.evaluate(() => Modal.close());

    /* ---- 9. Real-World Pack modal offers a game choice and tags content ---- */
    await page.evaluate(() => App.go('admin', 'world'));
    await page.waitForSelector('#admin-body .panel');
    await page.click('#admin-body button:has-text("Install Real-World Pack")');
    await page.waitForSelector('#rwp-form');
    await page.selectOption('#rwp-game', gt7.gameId);
    await page.click('#rwp-form button[type=submit]');
    const rwp = await toast(/Pack installed|failed/);
    log(/Pack installed: 3 series/.test(rwp) ? '✅' : '❌', 'Real-World Pack with game choice: ' + rwp);
    const tagged = await page.evaluate(async (gid) => {
        const series = (await DB.series({ force: true })).filter(s => s.isNPC);
        const races = (await DB.races({ force: true })).filter(r => series.some(s => s.id === r.seriesId));
        const tracks = await DB.tracks({ force: true });
        const gt7Suzukas = tracks.filter(t => t.name === 'Suzuka Circuit' && t.gameId === gid).length;
        return {
            series: series.length,
            seriesTagged: series.every(s => s.gameId === gid),
            racesTagged: races.length && races.every(r => r.gameId === gid),
            gt7Suzukas
        };
    }, gt7.gameId);
    log(tagged.seriesTagged && tagged.racesTagged && tagged.gt7Suzukas === 1 ? '✅' : '❌',
        `Pack content tagged with GT7: ${tagged.series} series + all races carry the gameId; Suzuka not duplicated within GT7 (${tagged.gt7Suzukas} entry)`);

    console.log('\n=== STEPS ===\n' + steps.join('\n'));
    await browser.close();
    process.exit(steps.some(s => s.startsWith('❌')) ? 1 : 0);
})().catch(e => { console.error('DRIVER CRASH:', e); process.exit(2); });
