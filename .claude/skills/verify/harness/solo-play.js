/* Play the Solo Career like a person would: build your own driver in the
   wizard, run the first race weekend by hand with a full result (grid slot,
   finish, laps led, incidents, damage, teammate), then simulate the next
   round, and look at every screen for broken values (NaN, undefined…).
   Screenshots land in harness/solo-play-shots/.
   Needs `python3 -m http.server 8317` from the repo root. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:8317/sim-racing-career/career.html';
const SHOTS = path.join(__dirname, 'solo-play-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const steps = [];
const log = (ok, msg) => { const line = `${ok ? '✅' : '❌'} ${msg}`; steps.push(line); console.log(line); };
const GAME = process.argv[2] || 'nr2003';
const ROLE = process.argv[3] || 'driver';

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.route('**/*', r => r.request().url().startsWith('http://localhost:8317') ? r.continue() : r.fulfill({ contentType: 'text/css', body: '' }));
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    const settle = (ms = 600) => page.waitForTimeout(ms);
    const shot = async (name, full = true) => { await settle(500); await page.screenshot({ path: path.join(SHOTS, `${GAME}-${ROLE}-${name}.png`), fullPage: full }); };
    const toast = async (re, timeout = 8000) => {
        await page.waitForFunction(s => new RegExp(s, 'i').test(document.getElementById('toast-holder')?.innerText || ''), re.source, { timeout });
        const t = await page.evaluate(() => document.getElementById('toast-holder').innerText.replace(/\n+/g, ' · '));
        await page.evaluate(() => document.querySelectorAll('#toast-holder .toast').forEach(x => x.remove()));
        return t;
    };
    // Anything that looks like a leaked JS value in visible text.
    const BAD = /\bNaN\b|\bundefined\b|\[object |\bInfinity\b|\bnull\b/;
    const scan = async (where, sel = '#sc-app') => {
        const txt = await page.evaluate(s => [document.querySelector(s)?.innerText || '', document.getElementById('sc-modal')?.innerText || ''].join('\n'), sel);
        const hits = txt.split('\n').filter(l => BAD.test(l));
        log(!hits.length, `${where}: no broken values${hits.length ? ' → ' + hits.slice(0, 4).join(' | ') : ''}`);
        return txt;
    };
    const go = async (view, param) => { await page.evaluate(([v, p]) => SC.App.go(v, p), [view, param || null]); await page.waitForSelector('#sc-view .view-head, #sc-view .sc-profile', { timeout: 8000 }); await settle(300); };
    const S = () => page.evaluate(() => { const S = SC.App.S; const P = S.player; return { phase: S.phase, round: S.season.round, events: S.season.events.length, money: P.money, dr: P.dr, rep: P.rep, teamId: P.teamId, pts: S.season.tables?.[S.season.sid]?.P?.pts }; });

    /* 1 · Launcher → wizard */
    await page.goto(BASE);
    await page.waitForSelector('.sc-hero');
    await scan('Launcher');
    await page.click('a[href="#/new"], [data-new], .sc-hero .btn-primary');
    await page.waitForSelector('.sc-game-card');
    log(true, 'Opened the new-career wizard from the launcher');
    await page.fill('#wz-filter', GAME === 'nr2003' ? '2003' : GAME);
    await settle(200);
    await shot('01-games', false);
    await page.click(`[data-game="${GAME}"]`);
    await page.waitForSelector('[data-series]');
    const series = await page.$$eval('[data-series]', els => els.map(e => ({ id: e.dataset.series, name: e.querySelector('strong').innerText, entry: /entry/i.test(e.innerText) })));
    const pick = series.find(s => s.entry) || series[0];
    log(series.length > 0, `Series step lists ${series.length} series; picking the entry rung: ${pick.name}`);
    await scan('Series step');
    await shot('02-series', false);
    await page.click(`[data-series="${pick.id}"]`);
    await page.waitForSelector(`[data-role="${ROLE}"]`);
    await shot('03-role', false);
    await page.click(`[data-role="${ROLE}"]`);

    /* 2 · My own character */
    await page.waitForSelector('#ch-first');
    // Validation: empty names are refused.
    await page.fill('#ch-first', ''); await page.fill('#ch-last', '');
    await page.click('#wz-next');
    await toast(/first and last name/);
    log(true, 'Wizard refuses a character without a name');
    await page.fill('#ch-first', 'Jay');
    await page.fill('#ch-last', 'Phoenix');
    await page.fill('#ch-nick', 'The Firebird');
    await page.selectOption('#ch-nat', 'USA');
    await page.fill('#ch-age', '19');
    if (ROLE !== 'principal') { await page.fill('#ch-num', '13'); }
    if (ROLE === 'owner') { await page.fill('#ow-name', 'Phoenix Rising Racing'); }
    await shot('04-character', false);
    await page.click('#wz-next');
    await page.waitForSelector('#op-season');
    await page.click('[data-diff="normal"]');
    await page.waitForSelector('#op-season');
    await page.selectOption('#op-season', 'short');
    await page.selectOption('#op-len', '0.25');
    await scan('Options step');
    await shot('05-options', false);
    await page.click('#wz-next');
    await page.waitForSelector('.sc-review');
    const review = await scan('Review step');
    log(/Jay Phoenix/.test(review) && /The Firebird/.test(review) && (ROLE === 'principal' || /#13/.test(review)), 'Review shows my name, nickname and number');
    await shot('06-review', false);
    await page.click('#wz-next');
    await page.waitForSelector('.sc-statusbar', { timeout: 20000 });
    await settle();
    const me = await page.evaluate(() => { const P = SC.App.S.player; return { name: P.first + ' ' + P.last, nick: P.nick, nat: P.nat, age: P.age, num: P.num, team: SC.App.S.teams[P.teamId]?.name, role: P.role }; });
    log(me.name === 'Jay Phoenix' && me.nat === 'USA' && me.age === 19 && (ROLE === 'principal' || me.num === 13), `Career created: ${JSON.stringify(me)}`);

    /* 3 · Home + pre-season */
    await scan('Home (pre-season)');
    await shot('07-home-preseason');
    await go('race');
    await scan('Race (pre-season)');
    await shot('08-preseason');
    // Sign any sponsor offer before the season (driver: personal, owner: team).
    await go('market', ROLE === 'owner' ? 'personal' : 'sponsors');
    await scan('Market (pre-season)');
    await go('race');
    await page.click('#ps-start');
    await page.waitForSelector('#rs-form, #st-go, .sc-weekend', { timeout: 8000 });
    await settle();
    log((await S()).phase === 'season', 'Season started from the Race screen');

    /* 4 · Race weekend 1: run it "in the game" and log the full result */
    const wk = await scan('Race weekend briefing');
    log(/AI|Opponent|Strength/i.test(wk) && /laps|minutes|km|stages/i.test(wk), 'Briefing tells me the AI level and race distance to set');
    await shot('09-weekend-1');
    const before = await S();
    let derby = false, rally = false, ledWant = 0;
    if (ROLE !== 'principal') {
        const N = await page.evaluate(() => SC.Engine.driversIn(SC.App.S, SC.App.S.season.sid).length);
        await page.fill('#rs-start', String(Math.min(12, N)));
        await page.fill('#rs-pos', String(Math.min(4, N)));
        if (await page.$('#rs-dnf') && await page.isChecked('#rs-dnf')) { log(true, 'Team gave a reliability order (DNF pre-ticked); racing to the flag anyway'); await page.uncheck('#rs-dnf'); }
        const laps = await page.evaluate(() => SC.App.S.season.events[0].laps || 99);
        ledWant = Math.min(7, laps);
        log(laps >= 5 || laps === 99, `Round 1 distance is a real race (${laps === 99 ? 'timed/stages' : laps + ' laps'})`);
        derby = !(await page.$('#rs-led')) && !!(await page.$('#rs-wrecks'));
        rally = await page.evaluate(() => SC.App.S.season.events[0].format === 'rally');
        if (rally) log(!(await page.$('#rs-led')) && /stage/i.test(await page.innerText('#rs-form')), 'Rally form drops laps led and talks about stages');
        else if (derby) { await page.fill('#rs-wrecks', '3'); log(true, 'Derby round: logging wrecks instead of laps led'); }
        else await page.fill('#rs-led', String(ledWant));
        if (await page.$('#rs-inc')) await page.fill('#rs-inc', '2');
        if (await page.$('#rs-dmg')) await page.selectOption('#rs-dmg', 'light');
        const mate = await page.$('[data-mate]');
        if (mate) { await page.click('#rs-form .sc-details summary'); await mate.fill(String(Math.min(9, N))); }
        await shot('10-result-form');
        await page.click('#rs-form button[type="submit"], #rs-form .btn-primary');
    } else {
        await page.click('#st-go');
    }
    await page.waitForSelector('#sc-modal', { timeout: 10000 });
    await settle();
    const rep1 = await scan('Round 1 report');
    await shot('11-report-1', false);
    const after = await S();
    log(after.round === 1, `Round 1 logged (round ${before.round} → ${after.round})`);
    if (ROLE !== 'principal') {
        const res = await page.evaluate(() => { const ev = SC.App.S.season.events[0]; return { pos: ev.res.player.pos, start: ev.res.player.start, led: ev.res.led?.P, wrecks: ev.res.wrecks?.P, damage: ev.res.player.damage, order0: ev.res.order[3] }; });
        log(res.pos === 4 && res.start === 12 && (derby ? res.wrecks === 3 : rally ? true : res.led === ledWant), `Result stored as entered: ${JSON.stringify(res)}`);
        log(/P4|4th/i.test(rep1), 'Report shows my P4');
    }
    log(Number.isFinite(after.money) && Number.isFinite(after.dr), `Money ${before.money} → ${after.money}, DR ${before.dr?.toFixed?.(1)} → ${after.dr?.toFixed?.(1)}`);
    await page.click('#sc-modal [data-close], #sc-modal .btn-primary');
    await settle();

    /* 5 · Round 2: simulate it */
    await go('race');
    await scan('Race weekend 2');
    await shot('12-weekend-2');
    if (ROLE !== 'principal') {
        const simBtn = await page.$('#rs-sim');
        log(!!simBtn, 'Simulate button is offered for my own race');
        await page.click('[data-rtab="sim"]');
        await settle(200);
        await shot('12b-sim-tab', false);
        await page.click('#rs-sim');
    } else {
        await page.click('#st-go');
    }
    await page.waitForFunction(() => SC.App.S.season.round === 2, null, { timeout: 10000 });
    await page.waitForSelector('#sc-modal', { timeout: 10000 });
    await settle();
    await scan('Round 2 (simulated) report');
    await shot('13-report-2', false);
    const r2 = await page.evaluate(() => { const ev = SC.App.S.season.events[1]; return { mode: ev.res.mode, pos: ev.res.player?.pos, dnf: ev.res.player?.dnf, n: ev.res.order.length }; });
    log(r2.n > 0, `Round 2 simulated: ${JSON.stringify(r2)}`);
    await page.click('#sc-modal [data-close], #sc-modal .btn-primary');
    await settle();

    /* 6 · Every screen after two rounds */
    for (const v of ['home', 'race', 'calendar', 'standings', 'team', 'market', 'finances', 'inbox', 'career', 'world', 'settings']) {
        await go(v);
        await scan(`Screen: ${v}`);
        await shot(`20-${v}`);
    }
    // Standings: my points equal round 1 + round 2 points.
    const pts = await page.evaluate(() => { const S = SC.App.S; const sid = S.season.sid; const E = SC.Engine; const row = E.standings(S, sid).find(r => r.id === 'P'); return { table: row?.pts, sum: S.season.events.filter(e => e.done).reduce((s, e) => s + (e.res.pts?.P || 0), 0) }; });
    if (ROLE !== 'principal') log(pts.table === pts.sum, `Standings points match the two results: ${JSON.stringify(pts)}`);
    // Undo the simulated round, then run it again.
    await go('race');
    const undo = await page.$('#rw-undo');
    if (undo) {
        await undo.click();
        await page.waitForSelector('#sc-modal');
        await page.click('#sc-modal [data-ok], #sc-modal .btn-primary');
        await toast(/Restored/);
        await page.waitForFunction(() => SC.App.S.season.round === 1, null, { timeout: 8000 });
        log(true, 'Undo rolled the simulated round back');
    }
    // Reload the page: the save survives.
    await page.reload();
    await page.waitForSelector('.sc-statusbar');
    const persisted = await S();
    log(persisted.round === 1 && persisted.phase === 'season', `Career reloads from the browser save (round ${persisted.round})`);

    log(!errors.length, `No page/console errors${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);
    const failed = steps.filter(s => s.startsWith('❌')).length;
    console.log(`\n${steps.length - failed}/${steps.length} steps passed`);
    await browser.close();
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
