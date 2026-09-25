/* Whole-app sweep: builds a populated league on the in-memory shim, then
   visits every screen as a guest, as a player in each career role, and as
   the Game Master (every admin tab), opening the common modals on the way.
   Flags page errors, console errors, leaked values (NaN / undefined /
   [object …]) and horizontal overflow on a phone-width screen.
   Needs `python3 -m http.server 8317` from the repo root. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SHOTS = path.join(__dirname, 'sweep-shots');
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
        window.confirm = () => true;
        window.prompt = (m, d) => d || 'Test';
        window.alert = () => {};
    });
    let errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/blocked by test|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text().slice(0, 240)); });
    const settle = (ms = 350) => page.waitForTimeout(ms);
    const toast = async (re, timeout = 30000) => {
        await page.waitForFunction(s => new RegExp(s, 'i').test(document.getElementById('toast-holder')?.innerText || ''), re.source, { timeout });
        await page.evaluate(() => document.querySelectorAll('#toast-holder .toast').forEach(x => x.remove()));
    };
    const BAD = /\bNaN\b|\bundefined\b|\[object |\bInfinity\b|\bnull\b/;
    const problems = [];
    // Visit a route (or run a modal opener) and check what's on screen.
    const check = async (label, fn, { modal = false, shot = false } = {}) => {
        errors = [];
        try { await fn(); } catch (e) { errors.push('threw: ' + e.message); }
        await settle(modal ? 500 : 700);
        const txt = await page.evaluate((m) => (m ? document.querySelector('.modal-card')?.innerText : document.getElementById('view-root')?.innerText) || '', modal);
        const bad = txt.split('\n').filter(l => BAD.test(l)).map(l => l.trim().slice(0, 90));
        const broken = /Something went wrong loading this page/.test(txt);
        const ok = !errors.length && !bad.length && !broken;
        if (!ok) problems.push(label);
        log(ok, `${label}${errors.length ? ' — ' + errors.slice(0, 2).join(' | ') : ''}${bad.length ? ' — text: ' + bad.slice(0, 3).join(' | ') : ''}${broken ? ' — error page shown' : ''}`);
        if (shot || !ok) await page.screenshot({ path: path.join(SHOTS, label.replace(/[^\w]+/g, '-').slice(0, 60) + '.png'), fullPage: false });
        if (modal) await page.evaluate(() => Modal.close(true, true));
    };
    const go = (view, param) => () => page.evaluate(([v, p]) => App.go(v, p), [view, param || null]);
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

    /* ---------------- Brand-new league: GM setup checklist ---------------- */
    await gmUnlock();
    await page.evaluate(() => App.go('admin', 'overview'));
    await page.waitForSelector('.setup-steps');
    const setup = await page.innerText('.setup-panel');
    log(/Get your league racing/i.test(setup) && /0\/5/.test(setup) && /Add a game/.test(setup) && /Invite your drivers/.test(setup), 'Empty league: GM sees the 5-step setup checklist');
    await settle(900);
    await page.screenshot({ path: path.join(SHOTS, 'first-run-gm-checklist.png') });

    /* ---------------- Build a populated league (as GM) ---------------- */
    const built = await page.evaluate(async () => {
        await installRealWorldPack();
        await Library.install('iracing', ['mx5', 'gt3'].filter(id => SC.seriesOf(SC.game('iracing'), id)).length ? ['mx5', 'gt3'] : null, { tracks: true, aiField: 6 });
        await generateNPCWorld({ freeDrivers: 6, freeCrew: 6, rivalTeams: 2 });
        await generatePersonaWorld({ agents: 2, seriesOwners: 1, trackOwners: 1, sponsors: 2, brands: 2 });
        const series = await DB.series({ force: true });
        const s = series[0];
        await Sim.simulateSeason(s.id, { onlyNext: false }).catch(() => {});
        const ch = generateChallenges({ cadence: 'weekly', count: 4, tracks: ['Monza'], games: [] });
        await DB.batchCreate('challenges', ch);
        try { await Dealership.installStarterPack(); } catch (e) { /* optional */ }
        const w = await DB.loadWorld(true);
        return { games: w.games.length, series: w.series.length, races: w.races.length, done: w.races.filter(r => r.status === 'completed').length, teams: w.teams.length, drivers: w.drivers.length };
    });
    await page.evaluate(() => document.querySelectorAll('#toast-holder .toast').forEach(x => x.remove()));
    log(built.done > 3 && built.drivers > 20, `League built: ${JSON.stringify(built)}`);
    const ids = await page.evaluate(async () => {
        const w = await DB.loadWorld(true);
        return {
            series: w.series.map(s => s.id), done: w.races.find(r => r.status === 'completed')?.id,
            next: w.races.find(r => r.status !== 'completed')?.id, driver: w.drivers[0]?.id, team: w.teams[0]?.id
        };
    });

    /* ---------------- GM: every admin tab + views ---------------- */
    for (const tab of ['overview', 'games', 'series', 'races', 'dealership', 'teams', 'drivers', 'world', 'players', 'challenges', 'numbers', 'parity', 'override', 'settings']) {
        await check(`GM admin → ${tab}`, go('admin', tab), { shot: true });
    }
    for (const v of ['dashboard', 'series', 'races', 'standings', 'stats', 'challenges', 'hub', 'dealership', 'career']) await check(`GM view → ${v}`, go(v));
    for (const sid of ids.series) await check(`GM series page ${sid}`, go('series-detail', sid));
    await check('GM race modal (completed)', () => page.evaluate(id => Views.showRace(id), ids.done), { modal: true });
    await check('GM race modal (upcoming)', () => page.evaluate(id => Views.showRace(id), ids.next), { modal: true, shot: true });
    await check('GM results form', () => page.evaluate(id => Admin.resultsForm(id), ids.next), { modal: true });
    await check('GM driver modal', () => page.evaluate(id => Views.showDriver(id), ids.driver), { modal: true });
    await check('GM team modal', () => page.evaluate(id => Views.showTeam(id), ids.team), { modal: true });
    await check('GM schedule builder', () => page.evaluate(() => Admin.scheduleBuilder()), { modal: true });
    await check('GM game library', () => page.evaluate(() => Library.installForm()), { modal: true });
    await check('GM series form', () => page.evaluate(id => Admin.seriesForm(id), ids.series[0]), { modal: true });

    /* ---------------- Guest ---------------- */
    await signOut();
    const guest = await page.evaluate(() => ({ gate: !document.getElementById('auth-gate').classList.contains('hidden'), text: document.getElementById('auth-gate').innerText.slice(0, 400) }));
    log(guest.gate && /Solo Career/i.test(guest.text), 'Signed out: sign-in screen with the Solo Career link');
    await page.screenshot({ path: path.join(SHOTS, 'gate.png') });

    /* ---------------- Player in every role ---------------- */
    await page.click('.gate-tab[data-pane="player"]');
    if (await page.locator('#gate-name-field.hidden').count()) await page.click('#gate-mode-toggle');
    await page.fill('#gate-name', 'Sweep Player');
    await page.fill('#gate-email', 'sweep@example.com');
    await page.fill('#gate-password', 'secret1');
    await page.click('#gate-player-submit');
    await page.waitForSelector('#app-shell:not(.hidden)');
    await page.waitForSelector('.modal-card .role-card', { timeout: 10000 });
    await page.click('.modal-card .role-card >> nth=1');
    await toast(/starting budget/);
    const nextStep = async () => { await page.evaluate(() => App.go('dashboard')); await settle(700); return page.evaluate(() => document.querySelector('.next-step')?.innerText || ''); };
    log(/Choose a role/i.test(await nextStep()), 'New player dashboard: next step is choosing a role');
    await page.evaluate(() => Auth.updateProfile({ activeRole: 'driver' }));
    log(/create your driver/i.test(await nextStep()), 'Driver without a profile: next step is creating the driver');
    await page.evaluate(() => Auth.updateProfile({ activeRole: null }));
    for (const v of ['dashboard', 'series', 'races', 'standings', 'stats', 'challenges', 'dealership']) await check(`Player view → ${v}`, go(v));
    for (const tab of ['news', 'achievements', 'players', 'recruitment']) await check(`Player hub → ${tab}`, go('hub', tab));
    await check('Player profile', go('profile'));
    const roles = await page.evaluate(() => ROLES.map(r => r.id));
    for (const role of roles) {
        await page.evaluate(r => Auth.updateProfile({ activeRole: r }), role);
        await check(`Player workspace → ${role}`, go('career'), { shot: true });
        // Role-specific difficulty pickers float up the first time — close them.
        await page.evaluate(() => Modal.close(true, true));
    }
    // Driver with a profile: onboarding + workspace + race modal.
    await page.evaluate(() => Auth.updateProfile({ activeRole: 'driver' }));
    await page.evaluate(() => App.go('career'));
    await page.waitForSelector('.onboard-card', { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => Career.driverOnboarding('scratch'));
    await page.waitForSelector('#ob-driver-form');
    await page.fill('#ob-name', 'Sweep Player');
    await page.selectOption('#ob-country', 'GBR');
    await page.click('#ob-driver-form button[type=submit]');
    await toast(/Welcome to the grid/);
    await check('Player driver workspace (with profile)', go('career'), { shot: true });
    const ns = await nextStep();
    log(/Next race|entered|No league races/i.test(ns), `Driver with a profile: next step points at a race ("${ns.split('\n')[0].slice(0, 60)}")`);
    await page.screenshot({ path: path.join(SHOTS, 'first-run-player-next-step.png') });
    await check('Player race modal (upcoming)', () => page.evaluate(id => Views.showRace(id), ids.next), { modal: true });
    await check('Player race modal (completed)', () => page.evaluate(id => Views.showRace(id), ids.done), { modal: true });
    await check('Player edit driver', () => page.evaluate(() => Career.editDriverModal()), { modal: true });
    await check('Player join team', () => page.evaluate(() => Career.joinTeamModal()), { modal: true });

    /* ---------------- Phone width ---------------- */
    await page.setViewportSize({ width: 390, height: 844 });
    for (const v of ['dashboard', 'races', 'standings', 'stats', 'career', 'hub', 'dealership']) {
        await page.evaluate(v => App.go(v), v);
        await settle(700);
        const ov = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - window.innerWidth,
            Math.ceil(document.getElementById('signout-btn').getBoundingClientRect().right - window.innerWidth)));
        if (ov > 2) problems.push('mobile ' + v);
        log(ov <= 2, `Phone width → ${v}: no sideways scroll, Sign out on screen (${ov}px)`);
        if (ov > 2) await page.screenshot({ path: path.join(SHOTS, 'mobile-' + v + '.png'), fullPage: true });
    }

    /* ---------------- Landing pages on a phone ---------------- */
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await phone.route('**/*', r => r.request().url().startsWith('http://localhost:8317') ? r.continue() : r.fulfill({ contentType: 'text/css', body: '' }));
    for (const u of ['index.html', 'sim-racing-career/index.html', 'sim-racing-career/career.html']) {
        await phone.goto('http://localhost:8317/' + u);
        await phone.waitForTimeout(900);
        const ov = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        log(ov <= 2, `Phone width → /${u}: no sideways scroll (${ov}px)`);
    }

    /* ---------------- Firebase blocked: helpful error, Solo fallback ---------------- */
    // No shim here, and the Firebase CDN is blocked — like an ad-blocker or a locked-down network.
    await phone.goto('http://localhost:8317/sim-racing-career/app.html');
    await phone.waitForSelector('#boot-error:not(.hidden)', { timeout: 10000 });
    const boot = await phone.innerText('#boot-error');
    log(/Can't reach the league server/i.test(boot) && /Solo Career/i.test(boot) && /blocker/i.test(boot), 'Firebase unavailable: explains why and offers the offline Solo Career');
    await phone.screenshot({ path: path.join(SHOTS, 'boot-error-phone.png') });
    await phone.close();

    const failed = steps.filter(s => s.startsWith('❌')).length;
    console.log(`\n${steps.length - failed}/${steps.length} steps passed${problems.length ? ' — problems: ' + problems.join(', ') : ''}`);
    await browser.close();
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
