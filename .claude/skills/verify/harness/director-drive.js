/* League Director (Game Master autopilot) end to end on the in-memory shim.
   The only thing the GM does by hand here is enter one race result — the
   Director schedules the season, simulates races nobody entered, races the
   AI field around the GM's result, answers a player's application to an AI
   team on the spot, refills an AI seat, approves a series proposal, closes a
   number auction, verifies a challenge from results, crowns the champion
   and schedules the next season.
   Needs `python3 -m http.server 8317` from the repo root. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SHOTS = path.join(__dirname, 'director-shots');
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
    await page.addInitScript(() => { window.__directorOn = true; });  // this drive tests the Director
    await page.addInitScript({ path: path.join(__dirname, 'firebase-shim.js') });
    await page.addInitScript(() => { window.confirm = () => true; window.prompt = (m, d) => d || 'Test'; window.alert = () => {}; });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/blocked by test|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
    const settle = (ms = 500) => page.waitForTimeout(ms);
    const shot = async (name, fullPage = false) => { await settle(500); await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage }); };
    const toast = async (re, timeout = 30000) => {
        await page.waitForFunction(s => new RegExp(s, 'i').test(document.getElementById('toast-holder')?.innerText || ''), re.source, { timeout });
        const t = await page.evaluate(() => document.getElementById('toast-holder').innerText.replace(/\n+/g, ' · '));
        await page.evaluate(() => document.querySelectorAll('#toast-holder .toast').forEach(x => x.remove()));
        return t;
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
    // "Run now" from Admin → Overview, returning what the Director did.
    const runDirector = async () => {
        await page.evaluate(() => App.go('admin', 'overview'));
        await page.waitForSelector('#dir-run');
        const before = await page.evaluate(async () => (await Director.config(true)).log?.length || 0);
        await page.click('#dir-run');
        await toast(/Director|up to date/);
        return page.evaluate(async (n) => { const l = (await Director.config(true)).log || []; return l.slice(0, Math.max(0, l.length - n)).map(x => x.text); }, before);
    };
    const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

    await page.goto('http://localhost:8317/sim-racing-career/app.html');
    await page.waitForSelector('#auth-gate:not(.hidden)');

    /* ---------------- 1. GM installs a game; the Director does the rest ---------------- */
    await gmUnlock();
    const cfg0 = await page.evaluate(async () => { const c = await Director.config(true); return { enabled: c.enabled, simAiRaces: c.simAiRaces, autoConfirm: c.autoConfirm }; });
    log(cfg0.enabled && cfg0.simAiRaces && !cfg0.autoConfirm, `Director is on by default (auto-confirm off): ${JSON.stringify(cfg0)}`);
    await page.evaluate(() => Library.install('nr2003', ['lms'], { tracks: true, aiField: 8 }));
    // A podium challenge running this week, so verification is always exercised.
    await page.evaluate(async () => {
        const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
        await DB.create('challenges', { title: 'Podium Push', check: 'podium', description: 'Finish on the podium', mode: 'solo', cadence: 'weekly', points: 3, reward: '3 pts', startDate: iso(-1), endDate: iso(6), status: 'active' });
    });
    const ran1 = await runDirector();
    const sched = await page.evaluate(async () => {
        const w = await DB.loadWorld(true);
        const s = w.series.find(x => x.libraryId === 'lms');
        const races = w.races.filter(r => r.seriesId === s.id).sort((a, b) => a.round - b.round);
        return { seriesId: s.id, n: races.length, seasons: w.seasons.filter(se => se.seriesId === s.id).map(se => se.name), day: new Date(races[0].date + 'T12:00').getDay(), laps: races[0].laps, ids: races.map(r => r.id) };
    });
    log(sched.n >= 10 && sched.seasons.length === 1 && sched.day === 6, `Director scheduled ${sched.seasons[0]}: ${sched.n} rounds on Saturdays (R1 ${sched.laps} laps) — ${ran1.find(t => /Scheduled/.test(t))}`);
    log(await page.evaluate(async () => (await DB.challenges({ force: true })).length >= 1), 'Challenges are running');
    await shot('01-director-panel', true);

    /* ---------------- 2. A player applies to an AI team: instant offer ---------------- */
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
    await page.click('.role-card:has-text("Driver")');
    await toast(/now playing as/);
    await page.waitForSelector('.onboard-card');
    await page.click('.onboard-card:has-text("Start from scratch")');
    await page.waitForSelector('#ob-driver-form');
    await page.fill('#ob-name', 'Jay Phoenix');
    await page.selectOption('#ob-country', 'USA');
    await page.click('#ob-driver-form button[type=submit]');
    await toast(/Welcome to the grid/);
    const teamId = await page.evaluate(async (sid) => (await DB.teams({ force: true })).find(t => t.seriesId === sid && !t.ownerUid).id, sched.seriesId);
    await page.evaluate((id) => Hub.apply(id), teamId);
    const applyMsg = await toast(/replied with an offer|league office/);
    const neg = await page.evaluate(async () => (await DB.list('negotiations', { force: true })).find(n => n.personUid === Auth.uid() && n.status === 'open'));
    log(/replied with an offer/.test(applyMsg) && neg && neg.turnUid === await page.evaluate(() => Auth.uid()), `Applying to an AI team gets an instant principal offer (${neg ? '$' + neg.salary + '/race' : 'none'}) — no Game Master needed`);
    await page.evaluate(async (id) => Deals.accept(id), neg.id);
    await settle(800);
    const signed = await page.evaluate(async () => { const d = (await DB.drivers({ force: true })).find(x => x.ownerUid === Auth.uid()); return { teamId: d.teamId, contract: (await DB.contracts({ force: true })).some(c => c.personId === d.id && c.status === 'active') }; });
    log(signed.teamId === teamId && signed.contract, 'Player accepts: contract signed, driver joins the AI team');

    // Sign up for round 2 (raced today) and report a P3.
    await page.evaluate(async (ids) => { await DB.update('races', ids[1], { date: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })() }); }, sched.ids);
    await page.evaluate((id) => Views.showRace(id), sched.ids[1]);
    await page.click('.modal-card button:has-text("Sign me up")');
    await toast(/on the grid/);
    await page.waitForSelector('#lib-rep-form');
    await page.fill('#rep-pos', '3');
    await page.fill('#rep-start', '9');
    await page.click('#lib-rep-form button[type=submit]');
    await toast(/reported/);
    const myDriverId = await page.evaluate(() => Auth.state.profile.driverId);

    /* ---------------- 3. Time passes: the Director catches up ---------------- */
    // Round 1 happened 3 days ago with nobody entered; round 2 is today's human race.
    await page.evaluate(async ([ids, d3]) => { await DB.update('races', ids[0], { date: d3 }); }, [sched.ids, daysAgo(3)]);
    // Things the Director should also tidy up:
    const extra = await page.evaluate(async (sid) => {
        const w = await DB.loadWorld(true);
        // An AI team with no human in it (the player joined one of the others).
        const t = w.teams.find(x => x.seriesId === sid && !x.ownerUid && !w.drivers.some(d => d.teamId === x.id && d.ownerUid) && w.drivers.filter(d => d.teamId === x.id).length === 2);
        const leaving = w.drivers.find(d => d.teamId === t.id && !d.ownerUid);
        await DB.update('drivers', leaving.id, { teamId: null });           // an AI seat opens
        await DB.create('series', { name: 'Proposed Dirt Cup', status: 'proposed', pointsSystem: 'arca' }); // a proposal waits
        await Numbers.openAuction(sid, 7, null);                              // an auction runs out
        await DB.set('numberRegistry', `${sid}__7`, { closesAt: '2000-01-01' });
        return { teamId: t.id };
    }, sched.seriesId);
    await signOut();
    if (process.env.DEBUG_DIR) {
        page.on('console', m => { if (/^DIR/.test(m.text())) console.log(new Date().toISOString().slice(11, 23), m.text()); });
        await page.evaluate(() => { const t = Director.tick.bind(Director); Director.tick = (o) => { console.log('DIR tick start ' + JSON.stringify(o) + ' running=' + Director._running + ' admin=' + Auth.isAdmin()); return t(o).then(a => { console.log('DIR tick end ' + JSON.stringify(a.map(x => x.text))); return a; }, e => { console.log('DIR tick threw ' + e.message); throw e; }); }; });
    }
    await gmUnlock();   // signing in runs the Director; Run now shows exactly what it did
    // Wait for the sign-in run to finish (it starts 1.5 s after sign-in).
    for (let i = 0; i < 60; i++) {
        const done = await page.evaluate(async () => !Director._running && ((await Director.config(true)).log || []).some(l => /Simulated/.test(l.text)));
        if (done) break;
        await settle(500);
    }
    const log2 = await page.evaluate(async () => ((await Director.config(true)).log || []).map(l => l.text));
    if (process.env.DEBUG_DIR) console.log('DEBUG due:', JSON.stringify(await page.evaluate(async (ids) => { const w = await DB.loadWorld(true); const r = w.races.find(x => x.id === ids[0]); return { status: r.status, date: r.date, since: Director._daysSince(r.date), grid: Director.aiGridFor(r.seriesId, w).length, today: Util.todayISO() }; }, sched.ids)));
    if (process.env.DEBUG_DIR) console.log('DEBUG log2:', JSON.stringify(log2.slice(0, 12)), 'running:', await page.evaluate(() => Director._running), 'cfg:', JSON.stringify(await page.evaluate(async () => { const c = await Director.config(true); return { lease: c.lease, lastRun: c.lastRun, now: Date.now(), admin: Auth.isAdmin() }; })));
    const r1 = await page.evaluate(async (id) => (await DB.get('races', id, { force: true })), sched.ids[0]);
    const r2 = await page.evaluate(async (id) => (await DB.get('races', id, { force: true })), sched.ids[1]);
    log(r1.status === 'completed' && r1.simulated && r1.results.length >= 7 && !r1.results.some(x => x.driverId === myDriverId), `On GM sign-in the Director simulated round 1, which nobody entered (${r1.results.length} AI cars; the player, who didn't enter, isn't in it)`);
    log(r2.status !== 'completed', 'Round 2 (a human raced it) waits for the Game Master');
    const tidy = await page.evaluate(async ({ teamId }) => {
        const w = await DB.loadWorld(true);
        const reg = (await DB.list('numberRegistry', { force: true })).find(r => r.number === 7);
        return { seats: w.drivers.filter(d => d.teamId === teamId).length, proposal: w.series.find(s => s.name === 'Proposed Dirt Cup')?.status, num7: reg?.status };
    }, extra);
    log(tidy.seats === 2, `AI team refilled its empty seat (${log2.find(t => /signed free agent|promoted rookie/.test(t)) || 'no log line'})`);
    log(tidy.proposal === 'active', 'Series proposal approved automatically');
    log(tidy.num7 === 'available', 'Expired number auction closed automatically (no bids → back in the pool)');
    await page.evaluate(() => App.go('admin', 'overview'));
    await page.waitForSelector('.director-panel');
    const attention = await page.innerText('#admin-body');
    log(/Enter results: .*Round 2/i.test(attention) && /1 entered, 1 reported/.test(attention) && !/Enter results: .*Round 1\b/i.test(attention), `Needs your attention lists only round 2 (1 entered, 1 reported)${/1 entered/.test(attention) ? '' : ' — got: ' + attention.split('\n').filter(l => /Enter results|entered/i.test(l)).join(' | ')}`);
    await shot('02-overview-after-catchup', true);

    /* ---------------- 4. The GM's one job: enter the result ---------------- */
    await page.evaluate((id) => Admin.resultsForm(id), sched.ids[1]);
    await page.waitForSelector('#res-aifill');
    const aiBox = await page.evaluate(() => ({ checked: document.getElementById('res-aifill').checked, text: document.querySelector('.lib-aifill').innerText }));
    log(aiBox.checked && /8 AI cars|7 AI cars/.test(aiBox.text), `Results form offers the AI field (${aiBox.text.match(/\d+ AI cars?/)?.[0]}), ticked`);
    await shot('03-results-form');
    await page.click('#results-form button[type=submit]');
    const saved = await toast(/Results saved/);
    const r2done = await page.evaluate(async ([id, me]) => { const r = await DB.get('races', id, { force: true }); return { n: r.results.length, me: r.results.find(x => x.driverId === me), ai: r.results.filter(x => x.aiFilled).length, pole: r.results.filter(x => x.pole).length, fl: r.results.filter(x => x.fastestLap).length }; }, [sched.ids[1], myDriverId]);
    log(r2done.me?.position === 3 && r2done.me?.start === 9 && r2done.ai >= 7 && r2done.pole === 1 && r2done.fl === 1, `Saved: player kept P3 from P9, ${r2done.ai} AI cars raced around them, pole and fastest lap filled (${saved.split(' · ')[0]})`);

    /* ---------------- 5. Challenge verified from the results ---------------- */
    await settle(1500);
    const claimed = await page.evaluate(async () => {
        const [chs, claims] = await Promise.all([DB.challenges({ force: true }), DB.claims({ force: true })]);
        const podium = chs.find(c => c.check === 'podium');
        return { hasPodium: !!podium, auto: claims.filter(c => c.auto && c.status === 'approved').map(c => (chs.find(x => x.id === c.challengeId) || {}).title) };
    });
    log(claimed.hasPodium && claimed.auto.includes('Podium Push'), `Podium Push verified from the results and approved without a claim: ${JSON.stringify(claimed.auto)}`);

    /* ---------------- 6. Season end: champion + next season, hands-off ---------------- */
    await page.evaluate(async ([ids, d]) => { for (const id of ids.slice(2)) await DB.update('races', id, { date: d }); }, [sched.ids, daysAgo(3)]);
    const ran3 = await runDirector();
    const end = await page.evaluate(async (sid) => {
        const w = await DB.loadWorld(true);
        const seasons = w.seasons.filter(se => se.seriesId === sid).sort((a, b) => a.year - b.year);
        const upcoming = w.races.filter(r => r.seriesId === sid && r.status === 'scheduled');
        return { seasons: seasons.map(se => ({ name: se.name, status: se.status, champ: w.driversById[se.championDriverId]?.name || null })), upcoming: upcoming.length, next: upcoming.map(r => r.date).sort()[0] };
    }, sched.seriesId);
    log(end.seasons.length === 2 && end.seasons[0].status === 'completed' && end.seasons[0].champ && end.seasons[1].status === 'active', `Season crowned (${end.seasons[0].champ}) and ${end.seasons[1]?.name} scheduled`);
    log(end.upcoming >= 10 && end.next > daysAgo(0), `Next season has ${end.upcoming} upcoming rounds from ${end.next}`);
    log(ran3.some(t => /is over/.test(t)) && ran3.some(t => /Simulated/.test(t)), `Director log: ${ran3.filter(t => /is over|Scheduled/.test(t)).join(' · ')}`);
    const news = await page.evaluate(async () => (await DB.news({ force: true })).map(n => n.message).join('\n'));
    log(/champion!/.test(news) && /schedule is out/.test(news), 'League news announces the champion and the new schedule');
    await shot('04-overview-season-rolled', true);

    /* ---------------- 7. Switching it off stops it ---------------- */
    await page.evaluate(() => App.go('admin', 'overview'));
    await page.waitForSelector('#dir-enabled');
    await page.uncheck('#dir-enabled');
    await page.click('#dir-save');
    await toast(/Director settings saved/);
    const off = await page.evaluate(async () => { const c = await Director.config(true); const done = await Director.tick({ reason: 'manual', quiet: true }); return { enabled: c.enabled, done: done.length }; });
    log(!off.enabled && off.done === 0, 'Turning the Director off stops it');

    log(!errors.length, `No page errors${errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''}`);
    const failed = steps.filter(s => s.startsWith('❌')).length;
    console.log(`\n${steps.length - failed}/${steps.length} steps passed`);
    await browser.close();
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
