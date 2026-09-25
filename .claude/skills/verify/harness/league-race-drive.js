/* League (multiplayer) end to end, with the features shared with the Solo
   Career: the GM installs a game from the library (series, points, tracks,
   AI field), builds a season from the real calendar, a player creates a
   character (nationality, nickname, age, helmet), signs up, reads the
   race briefing, reports their own result; the GM sees the report
   pre-filled, imports the results file, saves; standings, prize money,
   history and achievements update; the next round is simulated.
   Hermetic: in-memory Firebase shim, only localhost is reachable.
   Needs `python3 -m http.server 8317` from the repo root. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SHOTS = path.join(__dirname, 'league-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const steps = [];
const log = (ok, msg) => { const line = `${ok ? '✅' : '❌'} ${msg}`; steps.push(line); console.log(line); };

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route('**/*', r => {
        const url = r.request().url();
        if (url.startsWith('http://localhost:8317')) return r.continue();
        return r.fulfill({ contentType: url.endsWith('.css') ? 'text/css' : 'application/javascript', body: '/* blocked by test */' });
    });
    await page.addInitScript({ path: path.join(__dirname, 'firebase-shim.js') });
    await page.addInitScript(() => {
        window.__dialogs = [];
        window.confirm = (m) => { window.__dialogs.push('confirm: ' + m); return true; };
        window.prompt = (m, d) => { window.__dialogs.push('prompt: ' + m); return d || 'Test Season'; };
        window.alert = (m) => { window.__dialogs.push('alert: ' + m); };
    });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/blocked by test|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    const settle = (ms = 400) => page.waitForTimeout(ms);
    const shot = async (name, fullPage = false) => { await settle(450); await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage }); };
    const toast = async (re, timeout = 30000) => {
        await page.waitForFunction(s => new RegExp(s, 'i').test(document.getElementById('toast-holder')?.innerText || ''), re.source, { timeout });
        const t = await page.evaluate(() => document.getElementById('toast-holder').innerText.replace(/\n+/g, ' · '));
        await page.evaluate(() => document.querySelectorAll('#toast-holder .toast').forEach(x => x.remove()));
        return t;
    };
    const BAD = /\bNaN\b|\bundefined\b|\[object |\bInfinity\b/;
    const scanModal = async (where) => {
        const txt = await page.evaluate(() => document.querySelector('.modal-card')?.innerText || '');
        const bad = txt.split('\n').filter(l => BAD.test(l));
        log(!bad.length, `${where}: no broken values${bad.length ? ' → ' + bad.slice(0, 3).join(' | ') : ''}`);
        return txt;
    };
    const gmUnlock = async () => {
        await page.click('.gate-tab[data-pane="admin"]');
        await page.fill('#gate-passcode', 'phoenix13!');
        await page.click('#gate-admin-submit');
        await page.waitForSelector('#app-shell:not(.hidden)');
        await toast(/Welcome back/);
    };
    const signOut = async () => {
        await page.evaluate(() => Modal.close(true, true));
        await page.click('#signout-btn');
        await page.waitForSelector('#auth-gate:not(.hidden)');
    };

    await page.goto('http://localhost:8317/sim-racing-career/app.html');
    await page.waitForSelector('#auth-gate:not(.hidden)');
    log(await page.evaluate(() => !!(window.Library?.ok() && SC.GAMES.length >= 24 && SC.Import)), 'League app loads the shared Solo Career library (games, tracks, importer)');

    /* ---------------- 1. GM installs NR2003 from the game library ---------------- */
    await gmUnlock();
    await page.evaluate(() => App.go('admin', 'games'));
    await page.waitForSelector('#admin-body .panel');
    await page.click('#admin-body button:has-text("Add from library")');
    await page.waitForSelector('#lib-grid');
    log(await page.$$eval('#lib-grid .lib-game', els => els.length) >= 24, 'Game Library lists every Solo Career game');
    await page.fill('#lib-filter', '2003');
    await settle(150);
    await shot('01-library');
    await page.click('[data-lib="nr2003"]');
    await page.waitForSelector('#lib-install');
    // Keep it to two series so the drive stays quick.
    await page.$$eval('#lib-install [data-sd]', els => els.forEach(c => { c.checked = ['lms', 'cup'].includes(c.dataset.sd); }));
    await page.fill('#lib-ai', '8');
    await shot('02-library-install');
    await page.click('#lib-install button[type=submit]');
    log(true, 'Install: ' + await toast(/installed/));
    const lib = await page.evaluate(async () => {
        const [games, series, tracks, teams, drivers] = await Promise.all([DB.games({ force: true }), DB.series({ force: true }), DB.tracks({ force: true }), DB.teams({ force: true }), DB.drivers({ force: true })]);
        const g = games.find(x => x.libraryId === 'nr2003');
        const lms = series.find(s => s.libraryId === 'lms');
        return {
            game: g && { name: g.name, icon: g.icon }, series: series.map(s => `${s.name}:${s.pointsSystem}`),
            tracks: tracks.filter(t => t.gameId === g?.id).length, typed: tracks.filter(t => t.gameId === g?.id && t.libType).length,
            lmsTeams: teams.filter(t => t.seriesId === lms?.id).length, lmsDrivers: drivers.filter(d => d.seriesId === lms?.id).length,
            nat: drivers.filter(d => d.nat).length, lmsId: lms?.id
        };
    });
    log(lib.game && lib.series.length === 2 && lib.series.some(s => /Late Model Stock Tour:arca/.test(s)) && lib.series.some(s => /nascar_classic/.test(s)),
        `Game + series installed with Solo points systems: ${lib.series.join(', ')}`);
    log(lib.tracks >= 50 && lib.typed === lib.tracks, `${lib.tracks} NR2003 tracks added with track types`);
    log(lib.lmsTeams === 4 && lib.lmsDrivers === 8 && lib.nat >= 16, `AI field: ${lib.lmsTeams} teams / ${lib.lmsDrivers} drivers in the LMS Tour, ${lib.nat} AI drivers with nationalities`);
    // Re-install is idempotent.
    await page.evaluate(() => Library.installGameForm('nr2003'));
    await page.waitForSelector('#lib-install');
    const disabled = await page.$$eval('#lib-install [data-sd]:disabled', els => els.map(e => e.dataset.sd));
    log(disabled.includes('lms') && disabled.includes('cup'), `Re-opening the game marks installed series (${disabled.join(', ')})`);
    await page.evaluate(() => Modal.close(true, true));

    /* ---------------- 2. Season from the real calendar ---------------- */
    await page.evaluate((id) => Admin.scheduleBuilder(id), lib.lmsId);
    await page.waitForSelector('#sb-libload');
    await page.selectOption('#sb-libpct', '0.25');
    await page.click('#sb-libload');
    const cal = await page.inputValue('#sb-tracks');
    const lines = cal.split('\n').filter(Boolean);
    log(lines.length >= 10 && lines.every(l => /\|\s*\d+$/.test(l)), `Real calendar loaded: ${lines.length} rounds, e.g. "${lines[0]}"`);
    await page.fill('#sb-start', await page.evaluate(() => Util.todayISO()));
    await shot('03-schedule-builder');
    await page.click('#sched-form button[type=submit]');
    log(true, 'Schedule: ' + await toast(/Schedule created/));
    const races = await page.evaluate(async (sid) => (await DB.races({ force: true })).filter(r => r.seriesId === sid).sort((a, b) => a.round - b.round).map(r => ({ id: r.id, track: r.track, laps: r.laps, date: r.date })), lib.lmsId);
    log(races.length === lines.length && races[0].laps === 50 && races.every(r => r.laps >= 5), `Races carry per-round laps: R1 ${races[0].track} ${races[0].laps} laps, R2 ${races[1].track} ${races[1].laps} laps`);
    const R1 = races[0], R2 = races[1];

    /* ---------------- 3. A player creates their character ---------------- */
    await signOut();
    await page.click('.gate-tab[data-pane="player"]');
    if (await page.locator('#gate-name-field.hidden').count()) await page.click('#gate-mode-toggle');
    await page.fill('#gate-name', 'Jay Phoenix');
    await page.fill('#gate-email', 'jay@example.com');
    await page.fill('#gate-password', 'secret1');
    await page.click('#gate-player-submit');
    await page.waitForSelector('#app-shell:not(.hidden)');
    await page.waitForSelector('.modal-card .role-card', { timeout: 10000 });
    await page.click('.modal-card .role-card:has-text("Semi-Pro")');
    await toast(/starting budget/);
    await page.waitForSelector('.role-grid .role-card');
    await page.click('.role-card:has-text("Driver")');
    await toast(/now playing as/);
    await page.waitForSelector('.onboard-card');
    await page.click('.onboard-card:has-text("Start from scratch")');
    await page.waitForSelector('#ob-driver-form');
    await page.fill('#ob-name', 'Jay Phoenix');
    await page.fill('#ob-nick', 'The Firebird');
    await page.selectOption('#ob-country', 'USA');
    await page.fill('#ob-age', '19');
    await page.fill('#ob-helmet', '#ff6a00');
    await shot('04-character');
    await page.click('#ob-driver-form button[type=submit]');
    log(true, 'Character: ' + await toast(/Welcome to the grid/));
    const me = await page.evaluate(async () => { const d = (await DB.drivers({ force: true })).find(x => x.ownerUid === Auth.uid()); return d && { id: d.id, name: d.name, nat: d.nat, country: d.country, nick: d.nick, age: d.age, helmet: d.helmetColor }; });
    log(me && me.nat === 'USA' && me.country === 'United States' && me.nick === 'The Firebird' && me.age === 19 && me.helmet === '#ff6a00', `Driver saved like a Solo character: ${JSON.stringify(me)}`);
    await page.waitForSelector('.driver-hero');
    await settle(900);
    const hero = await page.innerText('.driver-hero');
    log(/🇺🇸/.test(hero) && /The Firebird/.test(hero) && /age 19/.test(hero), 'My Career hero shows flag, nickname and age');
    await shot('05-my-career');

    /* ---------------- 4. Sign up, briefing, report my result ---------------- */
    await page.evaluate((id) => Views.showRace(id), R1.id);
    await page.waitForSelector('.modal-card .lib-brief');
    const brief = await scanModal('Race briefing');
    log(/Set this up in NR2003/i.test(brief) && /Short oval/.test(brief) && /50 laps/.test(brief) && /°C/.test(brief) && /Late Model Stock/.test(brief),
        'Briefing: game, car, track type, distance and weather');
    await page.click('.modal-card button:has-text("Sign me up")');
    await toast(/on the grid/);
    await page.waitForSelector('#lib-rep-form');
    log(true, 'Signed up; "Report my result" opens on race day');
    await shot('06-race-briefing', true);
    await page.fill('#rep-pos', '2');
    await page.fill('#rep-start', '7');
    await page.fill('#rep-led', '12');
    await page.fill('#rep-inc', '1');
    await page.click('#lib-rep-form button[type=submit]');
    log(true, 'Report: ' + await toast(/reported/));
    const rep = await page.evaluate(async (rid) => (await DB.signups({ force: true })).find(s => s.raceId === rid && s.uid === Auth.uid())?.report, R1.id);
    log(rep && rep.position === 2 && rep.start === 7 && rep.lapsLed === 12, `Report stored on my entry: ${JSON.stringify(rep)}`);
    const balBefore = await page.evaluate(async () => (await DB.get('users', Auth.uid(), { force: true }))?.balance);

    /* ---------------- 5. GM: report pre-filled, import file, save ---------------- */
    await signOut();
    await gmUnlock();
    await page.evaluate((id) => Admin.resultsForm(id), R1.id);
    await page.waitForSelector('#results-form');
    const pre = await page.evaluate((did) => { const row = document.querySelector(`#results-form tr[data-driver="${did}"]`); return row && { pos: row.querySelector('.input-pos').value, grid: row.querySelector('.input-grid').value, led: row.querySelector('.input-led').value, badge: /reported/.test(row.innerText) }; }, me.id);
    log(pre && pre.pos === '2' && pre.grid === '7' && pre.led === '12' && pre.badge, `Results form pre-filled from the driver's report: ${JSON.stringify(pre)}`);
    // The sim wrote an NR2003 results page: build one from the real field.
    const field = await page.evaluate(async (sid) => (await DB.drivers({ force: true })).filter(d => d.seriesId === sid).map(d => d.name), lib.lmsId);
    const order = [field[0], 'Jay Phoenix', ...field.slice(1, 7), 'Guest Driver', field[7]];
    const html = `<html><body><table><tr><th>Fin</th><th>St</th><th>#</th><th>Driver</th><th>Laps</th><th>Led</th><th>Status</th></tr>
        ${order.map((n, i) => `<tr><td>${i + 1}</td><td>${n === 'Jay Phoenix' ? 7 : i === 0 ? 1 : i + 2}</td><td>${n === 'Guest Driver' ? 777 : 10 + i}</td><td>${n}</td><td>${i === order.length - 1 ? 31 : 50}</td><td>${n === 'Jay Phoenix' ? 12 : i === 0 ? 30 : i === 2 ? 8 : 0}</td><td>${i === order.length - 1 ? 'Engine' : 'Running'}</td></tr>`).join('')}
        </table></body></html>`;
    await page.click('.lib-import summary');
    await page.setInputFiles('#lib-im-file', { name: 'race.html', mimeType: 'text/html', buffer: Buffer.from(html) });
    await page.click('#lib-im-read');
    await page.waitForSelector('#lib-im-apply');
    const mapped = await page.evaluate(() => Array.from(document.querySelectorAll('[data-im-row]')).map(s => s.value));
    log(mapped.filter(Boolean).length === 9 && mapped[8] === '', `Import matched ${mapped.filter(Boolean).length}/10 rows by name; the guest stays unmatched`);
    await shot('07-import-mapping', true);
    await page.click('#lib-im-apply');
    const applied = await toast(/Applied|twice|error|not/, 4000).catch(async () => 'no toast; errors: ' + errors.join(' | ') + ' dom: ' + (await page.evaluate(() => document.getElementById('toast-holder')?.innerText)));
    if (!/Applied/.test(applied)) log(false, 'Apply said: ' + applied + ' / errors: ' + errors.join(' | '));
    const filled = await page.evaluate((did) => { const r = document.querySelector(`#results-form tr[data-driver="${did}"]`); return { pos: r.querySelector('.input-pos').value, pole: document.getElementById('res-pole').selectedOptions[0]?.text, dnfs: Array.from(document.querySelectorAll('.chk-dnf')).filter(c => c.checked).length }; }, me.id);
    log(filled.pos === '2' && filled.pole === field[0] && filled.dnfs === 1, `Applied: me P${filled.pos}, pole ${filled.pole}, ${filled.dnfs} DNF`);
    await page.click('#results-form button[type=submit]');
    log(true, 'Save: ' + await toast(/Results saved/));
    const done = await page.evaluate(async ({ rid, did }) => {
        const world = await DB.loadWorld(true);
        const race = world.races.find(r => r.id === rid);
        const mine = race.results.find(r => r.driverId === did);
        const table = Stats.driverTable(world.races, world, { seriesId: race.seriesId });
        const row = table.find(r => r.driverId === did);
        const winner = table.find(r => r.wins === 1);
        return { status: race.status, n: race.results.length, mine, pts: row?.points, rank: row?.rank, winnerPts: winner?.points };
    }, { rid: R1.id, did: me.id });
    // ARCA table: P1 50, P2 45 — no bonuses in that system.
    log(done.status === 'completed' && done.n === 9 && done.mine.position === 2 && done.mine.start === 7 && done.mine.lapsLed === 12,
        `Race completed: ${done.n} classified, me P${done.mine.position} from P${done.mine.start}, ${done.mine.lapsLed} laps led`);
    log(done.pts === 45 && done.rank === 2 && done.winnerPts === 50, `Standings: me ${done.pts} pts (P${done.rank}), winner ${done.winnerPts} pts — ARCA points from the library`);
    await page.evaluate((id) => Views.showRace(id), R1.id);
    await page.waitForSelector('.modal-card table');
    const resTxt = await scanModal('Race results modal');
    log(/from P7 \(\+5\)/.test(resTxt) && /12 led/.test(resTxt), 'Results show grid gain and laps led');
    await shot('08-results', true);
    await page.evaluate(() => Modal.close(true, true));

    /* ---------------- 6. Simulate round 2 ---------------- */
    await page.evaluate((id) => Admin.simRace(id), R2.id);
    log(true, 'Round 2: ' + await toast(/wins|Simulated/i));
    const r2 = await page.evaluate(async (id) => { const r = (await DB.races({ force: true })).find(x => x.id === id); return { status: r.status, n: r.results.length, simulated: r.simulated }; }, R2.id);
    log(r2.status === 'completed' && r2.n >= 8 && r2.simulated, `Round 2 simulated with the AI field (${r2.n} cars)`);

    /* ---------------- 7. Player sees it all ---------------- */
    await signOut();
    await page.click('.gate-tab[data-pane="player"]');
    if (!(await page.locator('#gate-name-field.hidden').count())) await page.click('#gate-mode-toggle');
    await page.fill('#gate-email', 'jay@example.com');
    await page.fill('#gate-password', 'secret1');
    await page.click('#gate-player-submit');
    await page.waitForSelector('#app-shell:not(.hidden)');
    await page.evaluate(() => App.go('career'));
    await page.waitForSelector('.driver-hero');
    await settle(900);
    const career = await page.innerText('main');
    log(/45/.test(career) && new RegExp(R1.track.split(' ')[0]).test(career), 'My Career: race history shows the round and my 45 points');
    const balAfter = await page.evaluate(async () => (await DB.get('users', Auth.uid(), { force: true }))?.balance);
    log(balAfter - balBefore === 3500, `Prize money paid to my wallet: +${balAfter - balBefore}`);
    await shot('09-career-after', true);
    await page.evaluate(() => App.go('hub', 'achievements'));
    await page.waitForSelector('#view-root .panel, main .panel');
    await settle(600);
    const ach = await page.innerText('main');
    log(/Jay Phoenix/.test(ach) && /On the Board/.test(ach) && /First Start/.test(ach) && /On the Box/.test(ach), 'Achievements: First Start, On the Board, On the Box');
    await page.evaluate(() => App.go('standings'));
    await settle(800);
    const flags = await page.evaluate(() => Array.from(document.querySelectorAll('main table tbody tr td:nth-child(2)')).filter(td => /\p{Regional_Indicator}/u.test(td.textContent)).length);
    log(flags >= 8, `Standings show nationality flags (${flags} rows)`);
    await shot('10-standings', true);
    await page.evaluate(() => App.go('dashboard'));
    await settle(800);
    const next = await page.evaluate(() => document.querySelector('main .race-row .race-sub')?.textContent || '');
    log(/°C/.test(next), `Dashboard race rows show track type and forecast: "${next.trim()}"`);
    await shot('11-dashboard', true);

    log(!errors.length, `No page errors${errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''}`);
    const failed = steps.filter(s => s.startsWith('❌')).length;
    console.log(`\n${steps.length - failed}/${steps.length} steps passed`);
    await browser.close();
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
