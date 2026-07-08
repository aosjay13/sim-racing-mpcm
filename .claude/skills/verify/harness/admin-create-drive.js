/* Drive the GM/Admin creation flows through the real UI on the shim:
   game → series → season (schedule builder) → drivers → standalone race →
   manual results entry → live stats/standings → close season & crown. */
const { chromium } = require('playwright');
const path = require('path');

const SHOT_DIR = __dirname;
const steps = [];
const log = (mark, msg) => { steps.push(`${mark} ${msg}`); console.log(`${mark} ${msg}`); };

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    // Hermetic: only localhost — Firebase CDN and everything else is stubbed.
    await page.route('**/*', r => {
        const url = r.request().url();
        if (url.startsWith('http://localhost:8317')) return r.continue();
        const type = url.endsWith('.css') || url.includes('fonts.googleapis') ? 'text/css' : 'application/javascript';
        return r.fulfill({ contentType: type, body: '/* blocked by test */' });
    });
    await page.addInitScript({ path: path.join(__dirname, 'firebase-shim.js') });
    await page.addInitScript(() => {
        window.__dialogs = [];
        window.confirm = (m) => { window.__dialogs.push('confirm: ' + String(m).split('\n')[0]); return true; };
        window.prompt = (m) => { window.__dialogs.push('prompt: ' + String(m).split('\n')[0]); return 'Test Season 2026'; };
        window.alert = (m) => { window.__dialogs.push('alert: ' + String(m).split('\n')[0]); };
    });
    page.on('pageerror', e => log('❌', 'pageerror: ' + e.message));

    const toast = async (re = /./, timeout = 30000) => {
        await page.waitForFunction((s) => new RegExp(s).test(document.getElementById('toast-holder')?.innerText || ''), re.source, { timeout });
        const text = await page.evaluate(() => document.getElementById('toast-holder').innerText.replace(/\n+/g, ' · '));
        await page.evaluate(() => document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove()));
        return text.trim();
    };
    // Let the view entrance animation finish before shooting, or frames are half-faded.
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

    /* ---- 2. Overview quick actions all present ---- */
    await page.evaluate(() => App.go('admin', 'overview'));
    await page.waitForSelector('#admin-body .quick-grid');
    const quick = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#admin-body .quick-grid button')).map(b => b.textContent.trim()));
    const wanted = ['Add Game', 'New Series', 'Schedule Builder', 'Add Race', 'Add Team', 'Add Driver'];
    const missing = wanted.filter(w => !quick.some(q => q.includes(w)));
    log(missing.length === 0 ? '✅' : '❌',
        `Overview quick actions (${quick.length}): ${quick.join(' | ')}${missing.length ? ' — MISSING: ' + missing : ''}`);

    /* ---- 3. Add Game (via quick action) ---- */
    await page.click('#admin-body .quick-grid button:has-text("Add Game")');
    await page.waitForSelector('#game-form');
    await page.fill('#gf-name', 'Gran Turismo 7');
    await page.fill('#gf-platform', 'PS5');
    await page.click('#game-form button[type=submit]');
    log('✅', 'Add Game: ' + (await toast(/Game added/)));

    /* ---- 4. New Series → auto-chains into Schedule Builder ---- */
    await page.waitForSelector('#admin-body .quick-grid');
    await page.click('#admin-body .quick-grid button:has-text("New Series")');
    await page.waitForSelector('#series-form');
    await page.fill('#sf-name', 'Phoenix GT Cup');
    await page.selectOption('#sf-game', { label: 'Gran Turismo 7' });
    await page.click('#series-form button[type=submit]');
    log('✅', 'Create Series: ' + (await toast(/Series created/)));
    // The app should open the Schedule Builder automatically for the new series.
    await page.waitForSelector('#sched-form', { timeout: 10000 });
    log('✅', 'Schedule Builder auto-opens after series creation');

    /* ---- 5. Schedule Builder: new season + 5 tracks, weekly ---- */
    await page.selectOption('#sb-season', '__new__'); // prompt() supplies "Test Season 2026"
    await page.fill('#sb-tracks', ['Silverstone', 'Spa-Francorchamps', 'Monza', 'Suzuka', 'Interlagos'].join('\n'));
    const preview = await page.evaluate(() => document.getElementById('sb-preview').textContent);
    log(/5 races/.test(preview) ? '✅' : '❌', 'Builder live preview: ' + preview);
    await page.click('#sched-form button[type=submit]');
    log('✅', 'Generate schedule: ' + (await toast(/Schedule created — 5 races/)));

    // Season really exists and owns the 5 races.
    const seasonCheck = await page.evaluate(async () => {
        const seasons = await DB.seasons({ force: true });
        const se = seasons.find(s => s.name === 'Test Season 2026');
        const races = await DB.races({ force: true });
        return { found: !!se, races: races.filter(r => r.seasonId === se?.id).length, status: se?.status };
    });
    log(seasonCheck.found && seasonCheck.races === 5 ? '✅' : '❌',
        `Season "Test Season 2026" created (${seasonCheck.status}) with ${seasonCheck.races}/5 races assigned`);

    /* ---- 6. Add a driver via the form, seed 3 more + a team ---- */
    await page.evaluate(() => App.go('admin', 'drivers'));
    await page.waitForSelector('#admin-body .panel');
    await page.click('#admin-body button:has-text("＋ Add Driver")');
    await page.waitForSelector('#admin-driver-form');
    await page.fill('#adf-name', 'Ayrton Tester');
    await page.fill('#adf-number', '13');
    await page.click('#admin-driver-form button[type=submit]');
    log('✅', 'Add Driver: ' + (await toast(/Driver added/)));

    // Add a team through the UI too, then seed the rest of the grid directly.
    await page.evaluate(() => App.go('admin', 'teams'));
    await page.waitForSelector('#admin-body .panel');
    await page.click('#admin-body button:has-text("＋ Add Team")');
    await page.waitForSelector('#admin-team-form');
    await page.fill('#atf-name', 'Phoenix Works');
    await page.click('#admin-team-form button[type=submit]');
    log('✅', 'Add Team: ' + (await toast(/Team created/)));

    const ids = await page.evaluate(async () => {
        const teams = await DB.teams({ force: true });
        const team = teams.find(t => t.name === 'Phoenix Works');
        const d1 = (await DB.drivers({ force: true })).find(d => d.name === 'Ayrton Tester');
        await DB.update('drivers', d1.id, { teamId: team.id });
        const mk = (name, teamId) => DB.create('drivers', { name, teamId, ownerUid: null, status: 'approved' });
        const d2 = await mk('Nikki Probe', team.id);
        const d3 = await mk('Louis Hammer', null);
        const d4 = await mk('Max Verify', null);
        return { team: team.id, d1: d1.id, d2, d3, d4 };
    });
    log('✅', 'Grid seeded: 4 drivers, 2 on Phoenix Works');

    /* ---- 7. Add a single standalone race (dated yesterday) ---- */
    const yesterday = await page.evaluate(() => {
        const d = new Date(); d.setDate(d.getDate() - 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    await page.evaluate(() => App.go('admin', 'races'));
    await page.waitForSelector('#admin-body .panel');
    await page.click('#admin-body button:has-text("＋ Add Race")');
    await page.waitForSelector('#race-form');
    await page.fill('#rf-track', 'Watkins Glen');
    await page.fill('#rf-date', yesterday);
    await page.click('#race-form button[type=submit]');
    log('✅', 'Add standalone race: ' + (await toast(/Race added/)));

    /* ---- 8. Overview "Needs Your Attention" flags the unresulted past race ---- */
    await page.evaluate(() => App.go('admin', 'overview'));
    await page.waitForSelector('#admin-body .stat-strip');
    const chips = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#admin-body .stat-strip > *')).map(c => c.innerText.replace(/\s*\n\s*/g, ' ')));
    log(/1 Games/i.test(chips.join()) && /6 Races/i.test(chips.join()) ? '✅' : '❌',
        'Overview stat chips: ' + chips.join(' | '));
    const nudge = await page.evaluate(() => document.querySelector('#admin-body')?.innerText.includes('Enter results: Watkins Glen'));
    log(nudge ? '✅' : '❌', 'Overview nudges GM to enter results for the past unresulted race');
    await shot('10-admin-overview');

    /* ---- 9. Enter results for the standalone race from the overview nudge ---- */
    await page.click('#admin-body .race-row:has-text("Watkins Glen") button:has-text("Enter results")');
    await page.waitForSelector('#results-form');
    await page.evaluate(({ d2, d1 }) => {
        const pos = (driverId, p) => {
            document.querySelector(`#results-form tr[data-driver="${driverId}"] .input-pos`).value = p;
        };
        pos(d2, 1); pos(d1, 2);
        document.getElementById('res-pole').value = d2;
        document.getElementById('res-fl').value = d2;
    }, ids);
    await page.click('#results-form button[type=submit]');
    log('✅', 'Standalone results saved: ' + (await toast(/Results saved/)));

    /* ---- 10. Enter results for Round 1 of the series from the Races tab ---- */
    const r1 = await page.evaluate(async () => {
        const races = await DB.races({ force: true });
        return races.find(r => r.round === 1 && r.name?.includes('Phoenix GT Cup'))?.id;
    });
    await page.evaluate((id) => Admin.resultsForm(id), r1);
    await page.waitForSelector('#results-form');
    await page.evaluate(({ d1, d2, d3, d4 }) => {
        const row = (driverId) => document.querySelector(`#results-form tr[data-driver="${driverId}"]`);
        row(d1).querySelector('.input-pos').value = 1;
        row(d2).querySelector('.input-pos').value = 2;
        row(d3).querySelector('.input-pos').value = 3;
        row(d4).querySelector('.chk-dnf').checked = true; // DNF, no position
        document.getElementById('res-pole').value = d2;
        document.getElementById('res-fl').value = d1;
    }, ids);
    await page.click('#results-form button[type=submit]');
    log('✅', 'Round 1 results saved: ' + (await toast(/Results saved/)));

    /* ---- 11. Stats engine: points, wins, DNFs, teams, tracks, history ---- */
    const stats = await page.evaluate(async ({ d1, d2, d4, team }) => {
        const world = await DB.loadWorld(true);
        const seriesId = world.series.find(s => s.name === 'Phoenix GT Cup')?.id;
        const rows = Stats.driverTable(world.races, world, { seriesId });
        const career = Stats.driverTable(world.races, world);
        const teams = Stats.teamTable(world.races, world, { seriesId });
        const tracks = Stats.trackTable(world.races, world);
        const glen = tracks.find(t => t.track === 'Watkins Glen');
        const recs = Stats.records(world.races, world);
        const r1 = rows.find(r => r.driverId === d1);
        const c2 = career.find(r => r.driverId === d2);
        return {
            seriesLeader: { name: r1?.driver.name, rank: r1?.rank, pts: r1?.points, wins: r1?.wins, fl: r1?.fastestLaps },
            dnfCounted: rows.find(r => r.driverId === d4)?.dnfs === 1,
            careerD2: { pts: c2?.points, wins: c2?.wins, poles: c2?.poles, starts: c2?.starts },
            teamRow: teams.find(t => t.teamId === team) ? { rank: teams.find(t => t.teamId === team).rank, pts: teams.find(t => t.teamId === team).points } : null,
            glenKing: glen?.kingOfTrack?.name,
            recordWins: recs.mostWins?.driver?.name,
            historyD1: Stats.driverHistory(d1, world.races, world).length,
            seriesId
        };
    }, ids);
    // Round 1 (F1 points): d1 P1+FL = 26. Career d2: standalone win 25+1FL + P2 18 = 44, 1 pole.
    log(stats.seriesLeader.rank === 1 && stats.seriesLeader.pts === 26 && stats.seriesLeader.wins === 1 ? '✅' : '❌',
        `Series standings live: ${stats.seriesLeader.name} P${stats.seriesLeader.rank} with ${stats.seriesLeader.pts} pts (25 win + 1 FL), ${stats.seriesLeader.wins} win`);
    log(stats.dnfCounted ? '✅' : '❌', 'DNF tracked as a start + DNF (no points)');
    // d2 took pole in both races (standalone + Round 1) → 2 career poles.
    log(stats.careerD2.pts === 44 && stats.careerD2.poles === 2 && stats.careerD2.starts === 2 ? '✅' : '❌',
        `Career stats aggregate across series + standalone races: Nikki Probe ${stats.careerD2.pts} pts, ${stats.careerD2.wins} win, ${stats.careerD2.poles} pole, ${stats.careerD2.starts} starts`);
    log(stats.teamRow && stats.teamRow.rank === 1 && stats.teamRow.pts === 44 ? '✅' : '❌',
        `Team standings: Phoenix Works P${stats.teamRow?.rank} with ${stats.teamRow?.pts} pts (26 + 18)`);
    log(stats.glenKing === 'Nikki Probe' ? '✅' : '❌', `Track stats: King of Watkins Glen = ${stats.glenKing}`);
    log(stats.recordWins ? '✅' : '❌', `League records computed (most wins: ${stats.recordWins})`);
    log(stats.historyD1 === 2 ? '✅' : '❌', `Driver race-by-race history: ${stats.historyD1} entries for Ayrton Tester`);

    /* ---- 12. Standings + series pages render the numbers ---- */
    await page.evaluate(() => App.go('standings'));
    await page.waitForSelector('#view-root table tbody tr', { timeout: 10000 });
    const standingsText = await page.evaluate(() => document.querySelector('#view-root').innerText);
    log(/Ayrton Tester/.test(standingsText) && /Phoenix Works/i.test(standingsText) ? '✅' : '❌',
        'Standings view shows drivers + teams from the entered results');
    await shot('11-standings-manual');

    await page.evaluate((sid) => App.go('series-detail', sid), stats.seriesId);
    await page.waitForSelector('.series-hero');
    const seriesPage = await page.evaluate(() => document.querySelector('#view-root').innerText);
    log(/Ayrton Tester/.test(seriesPage) ? '✅' : '❌', 'Series page shows live standings after Round 1');

    /* ---- 13. Close the season → champion crowned + archived ---- */
    await page.evaluate((sid) => Admin.seasonsModal(sid), stats.seriesId);
    await page.waitForSelector('.modal-card .race-row:has-text("Test Season 2026")');
    await page.click('.modal-card button:has-text("Close & crown")');
    log('✅', 'Close season: ' + (await toast(/Season closed/)));
    const crowned = await page.evaluate(async ({ d1 }) => {
        const se = (await DB.seasons({ force: true })).find(s => s.name === 'Test Season 2026');
        return { champ: se.championDriverId === d1, status: se.status, archived: (se.standingsArchive || []).length, teamArchived: (se.teamArchive || []).length };
    }, ids);
    log(crowned.champ && crowned.status === 'completed' && crowned.archived >= 4 ? '✅' : '❌',
        `Season doc: champion = Ayrton Tester, status ${crowned.status}, ${crowned.archived} drivers + ${crowned.teamArchived} teams archived`);
    await shot('12-season-closed');

    console.log('\nDIALOGS SEEN:\n' + (await page.evaluate(() => window.__dialogs)).map(d => '  ' + d).join('\n'));
    console.log('\n=== STEPS ===\n' + steps.join('\n'));
    await browser.close();
    process.exit(steps.some(s => s.startsWith('❌')) ? 1 : 0);
})().catch(e => { console.error('DRIVER CRASH:', e); process.exit(2); });
