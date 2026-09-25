/* Drive the Solo Career UI (career.html) headlessly — every screen, all
   three roles, custom games, import/export, undo, a full 40-season run to
   retirement + Hall of Fame, and a mobile pass. Hermetic: only localhost.
   Needs `python3 -m http.server 8317` from the repo root. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:8317/sim-racing-career/career.html';
const SHOTS = path.join(__dirname, 'solo-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const steps = [];
const log = (ok, msg) => { const line = `${ok ? '✅' : '❌'} ${msg}`; steps.push(line); console.log(line); };

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    await page.route('**/*', r => r.request().url().startsWith('http://localhost:8317') ? r.continue() : r.fulfill({ contentType: 'text/css', body: '' }));
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    const settle = (ms = 700) => page.waitForTimeout(ms);
    const shot = async (name, full = false) => { await settle(650); await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: full }); };
    const toast = async (re, timeout = 8000) => {
        await page.waitForFunction(s => new RegExp(s, 'i').test(document.getElementById('toast-holder')?.innerText || ''), re.source, { timeout });
        const t = await page.evaluate(() => document.getElementById('toast-holder').innerText.replace(/\n+/g, ' · '));
        await page.evaluate(() => document.querySelectorAll('#toast-holder .toast').forEach(x => x.remove()));
        return t;
    };
    const state = () => page.evaluate(() => { const S = SC.App.S; return S && { phase: S.phase, round: S.season.round, season: S.seasonNo, events: S.season.events.length, money: S.player.money, role: S.player.role, teamBudget: S.teams[S.player.teamId]?.budget, dr: S.player.dr }; });
    const go = async (view, param) => { await page.evaluate(([v, p]) => SC.App.go(v, p), [view, param || null]); await page.waitForSelector('#sc-view .view-head, #sc-view .sc-profile, #sc-view .sc-retired', { timeout: 8000 }); await settle(300); };

    // Wizard helper
    async function newCareer({ game, series, role, first, last, owner = {}, season = 'mini', custom = null }) {
        await page.goto(BASE + '#/new');
        await page.waitForSelector('.sc-game-card');
        if (custom) {
            await page.click('[data-game="custom"]');
            await page.waitForSelector('#cg-name');
            await custom();
        } else {
            await page.click(`[data-game="${game}"]`);
            await page.waitForSelector(`[data-series="${series}"]`);
            await page.click(`[data-series="${series}"]`);
        }
        await page.waitForSelector(`[data-role="${role}"]`);
        await page.click(`[data-role="${role}"]`);
        await page.waitForSelector('#ch-first');
        await page.fill('#ch-first', first); await page.fill('#ch-last', last);
        if (owner.name) await page.fill('#ow-name', owner.name);
        if (owner.cars) await page.selectOption('#ow-cars', String(owner.cars));
        await page.click('#wz-next');
        await page.waitForSelector('#op-season');
        await page.selectOption('#op-season', season);
        await page.selectOption('#op-len', '0.25');
        await page.click('#wz-next');
        await page.waitForSelector('.sc-review');
        await page.click('#wz-next');
        await page.waitForSelector('.sc-statusbar', { timeout: 20000 });
        await settle();
    }

    /* ---------------- 1. Launcher ---------------- */
    await page.goto(BASE);
    await page.waitForSelector('.sc-hero');
    log(true, 'Launcher renders (no saves yet)');
    await shot('01-launcher');

    /* ---------------- 2. Driver career via wizard ---------------- */
    await page.goto(BASE + '#/new');
    await page.waitForSelector('.sc-game-card');
    const gameCount = await page.$$eval('.sc-game-card', els => els.length);
    log(gameCount >= 25, `Wizard lists ${gameCount} game cards (24 games + custom)`);
    await page.fill('#wz-filter', 'nascar');
    await settle(200);
    const filtered = await page.$$eval('.sc-game-card', els => els.map(e => e.innerText.split('\n')[1]));
    log(filtered.length >= 3 && filtered.every(n => /nascar/i.test(n) || /custom/i.test(n)), `Search filters games: ${filtered.join(', ')}`);
    await shot('02-wizard-games');
    await newCareer({ game: 'nr2003', series: 'lms', role: 'driver', first: 'Jamie', last: 'Racer' });
    let s = await state();
    log(s && s.phase === 'preseason' && s.season === 1, `Career created in pre-season (season ${s.season}, ${s.events} rounds on a mini calendar)`);
    const header = await page.innerText('.sc-statusbar');
    log(/Jamie Racer/.test(header) && /Season 1\/40/.test(header), 'Status bar shows the driver and Season 1/40');
    await shot('03-home-driver', true);

    /* ---------------- 3. Pre-season calendar editing ---------------- */
    await go('race');
    await page.waitForSelector('#ps-cal');
    const before = await page.$$eval('#ps-cal tbody tr', r => r.length);
    await page.click('[data-down="0"]');
    await page.selectOption('#ps-add-track', 'Martinsville Speedway');
    await page.click('#ps-add');
    const firstBefore = await page.evaluate(() => SC.App.S.season.events[0].t);
    await page.click('text=Add a mod / custom track');
    await page.fill('#ps-ct-name', 'Motordrome Test Oval');
    await page.selectOption('#ps-ct-type', 'so');
    await page.click('#ps-ct-add');
    await toast(/added to the track list/);
    const rowsNow = await page.$$eval('#ps-cal tbody tr', r => r.length);
    log(rowsNow === before + 2, `Unsaved edits survive adding a mod track (${before} → ${rowsNow} rows)`);
    await page.click('#ps-save');
    await toast(/Calendar saved/);
    const cal = await page.evaluate(() => SC.App.S.season.events.map(e => e.t));
    log(cal.length === before + 2 && cal.includes('Motordrome Test Oval') && cal.includes('Martinsville Speedway') && cal[1] === firstBefore,
        `Calendar edited: reordered, +Martinsville, +custom mod track → ${cal.length} rounds`);
    await shot('04-preseason', true);
    await page.click('#ps-start');
    await toast(/season underway/);
    await page.waitForSelector('#rs-form');
    s = await state();
    log(s.phase === 'season', 'Season started from the pre-season checklist');

    /* ---------------- 4. Race weekend + manual result ---------------- */
    const ai = await page.innerText('.sc-setup-ai');
    log(/Opponent Strength/i.test(ai) && /\d+%/.test(ai), 'Setup card recommends NR2003 Opponent Strength: ' + ai.replace(/\n/g, ' '));
    await page.click('text=Why this AI level?');
    await shot('05-weekend', true);
    const moneyBefore = s.money;
    await page.fill('#rs-start', '8'); await page.fill('#rs-pos', '3'); await page.fill('#rs-led', '12');
    await page.selectOption('#rs-dmg', 'light');
    await page.click('#rs-form button[type=submit]');
    await page.waitForSelector('.sc-report-hero');
    const rep = await page.innerText('.sc-report-hero');
    log(/P3 from P8/.test(rep), 'Post-race report: ' + rep.replace(/\n/g, ' '));
    await shot('06-report');
    await page.click('#sc-modal [data-close]');
    s = await state();
    log(s.round === 1 && s.money > moneyBefore, `Round logged, salary/prize paid (money ${moneyBefore} → ${s.money})`);

    /* ---------------- 5. Undo ---------------- */
    await page.click('#rw-undo');
    await page.click('#sc-modal [data-yes]');
    await toast(/Restored/);
    s = await state();
    log(s.round === 0 && s.money === moneyBefore, 'Undo restores the pre-race state (round 0, money back)');

    /* ---------------- 6. DNF + teammate ---------------- */
    await page.waitForSelector('#rs-form');
    await page.fill('#rs-start', '5');
    await page.check('#rs-dnf');
    await page.selectOption('#rs-reason', 'mech');
    await page.fill('#rs-laps', '40');
    const mate = await page.$('[data-mate]');
    if (mate) { await page.click('text=Teammate result'); await mate.fill('2'); }
    await page.click('#rs-form button[type=submit]');
    await page.waitForSelector('.sc-report-hero');
    const dnfRep = await page.innerText('.sc-report-hero');
    const r1 = await page.evaluate(() => { const ev = SC.App.S.season.events[0]; const mateId = SC.App.S.teams[SC.App.S.player.teamId].drivers.find(x => x !== 'P'); return { dnf: ev.res.dnf.P, matePos: mateId ? ev.res.order.indexOf(mateId) + 1 : null }; });
    log(/Retired \(mechanical\)/.test(dnfRep) && r1.dnf === 'mech', 'Mechanical DNF logged: ' + dnfRep.replace(/\n/g, ' '));
    if (mate) log(r1.matePos === 2, `Teammate result honoured (P${r1.matePos})`);
    await page.click('#sc-modal [data-close]');

    /* ---------------- 7. Import a pasted result ---------------- */
    await page.waitForSelector('[data-rtab="import"]');
    await page.click('[data-rtab="import"]');
    const names = await page.evaluate(() => { const S = SC.App.S; return SC.Engine.driversIn(S, S.season.sid).filter(x => x !== 'P').slice(0, 3).map(id => `${S.drivers[id].first} ${S.drivers[id].last}`); });
    await page.fill('#im-text', `1. ${names[0]}\n2. Jamie Racer\n3. ${names[1]}\n4. ${names[2]} - DNF`);
    await page.click('#im-parse');
    await page.waitForSelector('#im-go');
    const mapText = await page.innerText('#im-map');
    log(/YOU/.test(await page.$eval('#im-map tr.sc-me select', s2 => s2.selectedOptions[0].textContent)) && /name match/.test(mapText), 'Import mapping matched names and found YOU');
    await shot('07-import-map', true);
    await page.click('#im-go');
    await page.waitForSelector('.sc-report-hero');
    const impRep = await page.innerText('.sc-report-hero');
    log(/^P2|P2 from/.test(impRep.replace(/\n/g, ' ').trim()) || /P2/.test(impRep), 'Imported result recorded: ' + impRep.replace(/\n/g, ' '));
    await page.click('#sc-modal [data-close]');

    /* ---------------- 8. Simulate the rest of the season ---------------- */
    let guard = 0;
    while ((await state()).phase === 'season' && guard++ < 30) {
        await page.waitForSelector('[data-rtab="sim"]');
        await page.click('[data-rtab="sim"]');
        await page.click('#rs-sim');
        await page.waitForSelector('.sc-report-hero');
        await page.click('#sc-modal [data-close]');
        await settle(250);
    }
    s = await state();
    log(s.phase === 'postseason', `Season 1 simulated to the end → ${s.phase}`);
    await page.waitForSelector('.sc-awards');
    await shot('08-season-review', true);
    const offers = await page.$$('.sc-offer');
    log(offers.length >= 1, `Season review shows ${offers.length} contract offer(s) + awards`);

    /* ---------------- 9. Contracts / sponsors / training ---------------- */
    await go('market', 'contracts');
    await page.check('#mk-agent');
    await toast(/Agent hired/);
    const counterBtn = await page.$('[data-counter]');
    if (counterBtn) { await counterBtn.click(); const t = await toast(/agreed|walked|refused/); log(true, 'Counter-offer answered: ' + t); }
    await go('market', 'contracts');
    const acc = await page.$('[data-accept]');
    if (acc) { await acc.click(); await toast(/Contract signed/); }
    const nc = await page.evaluate(() => SC.App.S.player.nextContract);
    log(!!nc || !acc, `Next-season contract ${nc ? 'signed with ' + nc.teamId : '(kept current deal)'}`);
    await go('market', 'sponsors');
    const psign = await page.$('[data-psign]');
    if (psign) { await psign.click(); await toast(/Personal sponsor signed/); }
    const nSp = await page.evaluate(() => SC.App.S.player.sponsors.length);
    log(nSp >= 1 || !psign, `Personal sponsors: ${nSp}`);
    await go('market', 'training');
    const tr = await page.$('[data-train="feedback"]');
    await tr.click();
    const trToast = await toast(/booked|Not enough/);
    log(true, 'Training: ' + trToast);
    await shot('09-market', true);
    await go('market', 'buy');
    log(await page.$$eval('[data-buy]', b => b.length) > 0, 'Buy-a-team list renders in the off-season');

    /* ---------------- 10. Other screens ---------------- */
    await go('standings');
    const rows = await page.$$eval('#sc-view table tbody tr', r => r.length);
    log(rows > 10, `Standings table has ${rows} rows`);
    const other = await page.evaluate(() => SC.Engine.gameOf(SC.App.S).series.find(x => x.id !== SC.App.S.season.sid).id);
    await page.selectOption('#st-series', other);
    await settle(400);
    log(/simulated/i.test(await page.innerText('#sc-view')), 'Other championships have their own (simulated) standings');
    await page.click('[data-stab="teams"]'); await settle(300);
    await page.click('[data-stab="history"]'); await settle(300);
    log(/\d{4}/.test(await page.innerText('#sc-view table')), 'Past champions table lists the finished season');
    await go('calendar');
    await page.click('#sc-view tr[data-ev]');
    await page.waitForSelector('#sc-modal table');
    log(true, 'Calendar → round results modal');
    await page.click('#sc-modal [data-close]');
    await go('team');
    log(/Team faith in you/i.test(await page.innerText('#sc-view')), 'Team screen (driver view) shows contract + team faith');
    await go('team', 'car');
    log(/Engine/i.test(await page.innerText('#sc-view')), 'Car tab shows ratings vs field');
    await go('finances');
    const ledgerRows = await page.$$eval('.sc-ledger tbody tr', r => r.length);
    log(ledgerRows > 5, `Finances ledger has ${ledgerRows} entries`);
    await shot('10-finances', true);
    await go('inbox');
    const unreadBefore = await page.evaluate(() => SC.Engine.unread(SC.App.S));
    await page.click('.sc-msg summary');
    await settle(300);
    const unreadAfter = await page.evaluate(() => SC.Engine.unread(SC.App.S));
    log(unreadAfter === unreadBefore - 1, `Opening a message marks it read (${unreadBefore} → ${unreadAfter})`);
    await page.click('#ib-read'); await toast(/caught up/);
    await go('career');
    log(/Season by season/i.test(await page.innerText('#sc-view')), 'Career profile renders stats + history');
    await go('world');
    await page.click('[data-wtab="drivers"]'); await settle(300);
    await page.click('[data-wtab="records"]'); await settle(300);
    log(/Most titles/i.test(await page.innerText('#sc-view')), 'World: records tab');
    await go('settings');
    await page.fill('#se-ai', '101');
    await page.click('#se-form button[type=submit]');
    await toast(/Settings saved/);
    log(await page.evaluate(() => SC.App.S.settings.aiBase) === 101, 'AI calibration saved in Settings');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#se-export')]);
    const exportPath = path.join(SHOTS, 'export.json');
    await download.saveAs(exportPath);
    const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
    log(exported.format === 'srmpc-solo-career' && exported.save.player.last === 'Racer', `Export save → ${(fs.statSync(exportPath).size / 1024).toFixed(0)} KB JSON`);

    /* ---------------- 11. Next season + fast-forward to 40 ---------------- */
    await go('race');
    await page.click('#po-next');
    await toast(/Welcome to/);
    s = await state();
    log(s.season === 2 && s.phase === 'preseason', 'Advanced to season 2 (pre-season)');
    const ff = await page.evaluate(async () => {
        const S = SC.App.S, E = SC.Engine;
        for (let n = 0; n < 60; n++) {
            if (S.phase === 'preseason') E.beginSeason(S);
            while (S.phase === 'season') E.completeRound(S, { mode: 'sim' });
            if (S.postseason?.mustRetire) break;
            if (S.player.contract.seasons <= 0 && S.offers.length && !S.player.nextContract) E.acceptOffer(S, S.offers[0].id);
            E.advanceSeason(S);
        }
        await SC.Store.save(S);
        return { season: S.seasonNo, must: !!S.postseason?.mustRetire, hist: S.history.length };
    });
    log(ff.must && ff.season === 40 && ff.hist === 40, `Fast-forwarded to season ${ff.season}: retirement required after ${ff.hist} seasons`);
    await go('race');
    await page.waitForSelector('#po-retire-forced');
    log(!(await page.$('#po-next')), 'Season 40 review offers only the retirement ceremony (no next season)');
    await page.click('#po-retire-forced');
    await page.waitForSelector('.sc-retired');
    await toast(/Hall of Fame/);
    await shot('11-retired', true);
    await page.goto(BASE + '#/hof');
    await page.waitForSelector('#sc-view table');
    log(/Jamie Racer/.test(await page.innerText('#sc-view')), 'Hall of Fame lists the retired character');
    await shot('12-hof', true);
    await page.goto(BASE + '#/');
    await page.waitForSelector('.sc-slot');
    log(/Retired/i.test(await page.innerText('#sc-view')), 'Launcher shows the career as Retired');

    /* ---------------- 12. Owner-driver career (F1 / F2) ---------------- */
    await newCareer({ game: 'f1', series: 'f2', role: 'owner', first: 'Olivia', last: 'Owner', owner: { name: 'Owner Racing GP', cars: 2 } });
    s = await state();
    log(s.role === 'owner' && s.teamBudget > 0, `Owner-driver career: team budget ${s.teamBudget}`);
    await go('team', 'sponsors');
    let signBtns = await page.$$('[data-sign]');
    for (let i = 0; i < Math.min(2, signBtns.length); i++) { const b = await page.$('[data-sign]'); if (!b) break; await b.click(); await toast(/Sponsor signed|No free/); }
    log(await page.evaluate(() => SC.App.S.teams[SC.App.S.player.teamId].sponsors.length) >= 1, 'Signed team sponsors');
    await go('team', 'car');
    await page.selectOption('#rd-area', 'aero');
    await page.click('[data-rd="minor"]');
    await toast(/R&D program started/);
    log(await page.evaluate(() => SC.App.S.teams[SC.App.S.player.teamId].rd.length) === 1, 'R&D project started (aero, minor)');
    await shot('13-owner-rd', true);
    await go('team', 'facilities');
    await page.click('[data-fac="windtunnel"]');
    const facToast = await toast(/Construction started|Not enough/);
    log(/Construction/.test(facToast), 'Facility upgrade: ' + facToast);
    await go('team', 'staff');
    await page.click('[data-hire-staff]');
    const stToast = await toast(/hired|Not enough/);
    log(true, 'Staff market: ' + stToast);
    await go('market', 'drivers');
    await page.click('[data-hire]');
    await page.waitForSelector('#hire-form');
    await page.click('#hire-form button[type=submit]');
    const hToast = await toast(/signed|wants at least|Need|budget/);
    log(/signed/.test(hToast), 'Driver market: ' + hToast);
    await go('race');
    await page.click('#ps-start');
    await toast(/underway/);
    const b0 = (await state()).teamBudget;
    await page.waitForSelector('#rs-form');
    await page.fill('#rs-pos', '6'); await page.fill('#rs-start', '9');
    await page.click('#rs-form button[type=submit]');
    await page.waitForSelector('.sc-report-hero');
    const ownerRep = await page.innerText('.sc-report-stats');
    log(/Team money/i.test(ownerRep), 'Owner race report shows team money: ' + ownerRep.replace(/\n/g, ' '));
    await page.click('#sc-modal [data-close]');
    const b1 = (await state()).teamBudget;
    log(b1 !== b0, `Team budget moved after the round (${b0} → ${b1})`);
    await go('finances');
    log(/Race operations/.test(await page.innerText('#sc-view')), 'Team ledger shows race operations costs');

    /* ---------------- 13. Principal career (AMS2) ---------------- */
    await newCareer({ game: 'ams2', series: 'gt3', role: 'principal', first: 'Paula', last: 'Principal' });
    await go('race');
    await page.click('#ps-start');
    await toast(/underway/);
    await page.waitForSelector('#st-go');
    await page.selectOption('[data-strat]', 'push');
    await shot('14-principal', true);
    await page.click('#st-go');
    await page.waitForSelector('.sc-report-hero');
    log(/P\d+|DNF/.test(await page.innerText('.sc-report-hero')), 'Principal: strategy → simulated round report');
    await page.click('#sc-modal [data-close]');

    /* ---------------- 14. Custom game ---------------- */
    await newCareer({
        role: 'driver', first: 'Casey', last: 'Custom', custom: async () => {
            await page.fill('#cg-name', 'Grand Prix Legends');
            await page.fill('#cg-short', 'GPL');
            await page.fill('#cg-tracks', 'Monza | rd | 5.75\nSpa-Francorchamps | rd | 14.1\nNürburgring Nordschleife | rd | 22.8\nRouen-les-Essarts | rd | 6.5');
            await page.fill('.sc-cg-row [data-f="name"]', 'F1 1967');
            await page.fill('.sc-cg-row [data-f="ladder"]', 'grand prix');
            await page.click('#cg-add');
            const rowsCg = await page.$$('.sc-cg-row');
            await (await rowsCg[1].$('[data-f="name"]')).fill('F2 1967');
            await (await rowsCg[1].$('[data-f="ladder"]')).fill('grand prix');
            await (await rowsCg[1].$('[data-f="tier"]')).fill('2');
            await page.click('#wz-next');
            await page.waitForSelector('[data-series]');
            await page.click('[data-series]:has-text("F2 1967")');
        }
    });
    s = await state();
    log(s && s.phase === 'preseason', 'Custom game career created (Grand Prix Legends, 2-rung ladder)');
    await go('race');
    await page.click('#ps-start');
    await toast(/underway/);
    const customAi = await page.innerText('.sc-setup-ai');
    log(/AI Difficulty/i.test(customAi), 'Custom game setup card: ' + customAi.replace(/\n/g, ' '));

    /* ---------------- 14b. Derby + rally formats, modal vs navigation ---------------- */
    await newCareer({ game: 'wreckfest', series: 'derbyleague', role: 'driver', first: 'Dana', last: 'Derby' });
    await go('race'); await page.click('#ps-start'); await toast(/underway/);
    await page.waitForSelector('#rs-form');
    log(!(await page.$('#rs-dnf')) && !!(await page.$('#rs-wrecks')), 'Derby round: survival position + wrecks, no DNF box');
    await page.fill('#rs-pos', '2'); await page.fill('#rs-wrecks', '4');
    await page.click('#rs-form button[type=submit]');
    await page.waitForSelector('.sc-report-hero');
    const dz = await page.evaluate(() => { const e = SC.App.S.season.events[0]; return { w: e.res.wrecks.P, pts: e.res.pts.P }; });
    log(dz.w === 4 && dz.pts === 12, `Derby scoring: P2 (8) + 4 wrecks = ${dz.pts} pts`);
    await page.evaluate(() => SC.App.go('standings'));
    await settle(500);
    log(!(await page.$('#sc-modal')), 'Navigating away closes an open report dialog');
    await newCareer({ game: 'eawrc', series: 'wrc2', role: 'driver', first: 'Riley', last: 'Rally' });
    await go('race'); await page.click('#ps-start'); await toast(/underway/);
    await page.waitForSelector('#rs-form');
    log(/stages/.test(await page.innerText('.sc-dl')), 'Rally round lists stages, not laps');
    await page.fill('#rs-pos', '5');
    await page.click('#rs-form button[type=submit]');
    await page.waitForSelector('.sc-report-hero');
    log(/P5 overall/.test(await page.innerText('.sc-report-hero')), 'Rally report: overall classification');
    await page.click('#sc-modal [data-close]');

    /* ---------------- 15. Import a save file ---------------- */
    await page.goto(BASE + '#/');
    await page.waitForSelector('#sc-import-save', { state: 'attached' });
    const slotsBefore = await page.$$eval('.sc-slot', x => x.length);
    await page.setInputFiles('#sc-import-save', exportPath);
    await page.waitForSelector('.sc-statusbar', { timeout: 10000 });
    await page.goto(BASE + '#/');
    await page.waitForSelector('.sc-slot');
    const slotsAfter = await page.$$eval('.sc-slot', x => x.length);
    log(slotsAfter === slotsBefore + 1, `Imported save appears as a new slot (${slotsBefore} → ${slotsAfter})`);
    await shot('15-launcher-slots', true);

    /* ---------------- 16. Mobile + light theme ---------------- */
    await page.setViewportSize({ width: 390, height: 844 });
    const firstOpen = await page.$('[data-open]');
    await firstOpen.click();
    await page.waitForSelector('.sc-statusbar');
    await page.click('#nav-toggle');
    await settle(300);
    const navOpen = await page.$eval('#main-nav', n => n.classList.contains('open'));
    log(navOpen, 'Mobile: hamburger opens the nav');
    await page.click('[data-go="standings"]');
    await settle(700);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    log(overflow <= 1, `Mobile: no horizontal page scroll on Standings (overflow ${overflow}px)`);
    await page.click('#theme-toggle');
    await shot('16-mobile-light', true);
    await page.setViewportSize({ width: 1280, height: 900 });

    log(errors.length === 0, `No page/console errors${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);
    const failed = steps.filter(x => x.startsWith('❌')).length;
    console.log(`\n${steps.length - failed}/${steps.length} steps passed`);
    await browser.close();
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('DRIVE CRASHED', e); process.exit(2); });
