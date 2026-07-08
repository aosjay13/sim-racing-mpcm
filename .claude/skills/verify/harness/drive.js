/* Drive the real SRMPC UI headlessly against the in-memory Firebase shim. */
const { chromium } = require('playwright');
const path = require('path');

const SHOT_DIR = __dirname;
const steps = [];
const log = (mark, msg) => { steps.push(`${mark} ${msg}`); console.log(`${mark} ${msg}`); };

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    // Hermetic: ONLY localhost is allowed — the real Firebase CDN and any
    // other remote host get an empty stub, so production is untouchable.
    await page.route('**/*', r => {
        const url = r.request().url();
        if (url.startsWith('http://localhost:8317')) return r.continue();
        const type = url.endsWith('.css') || url.includes('fonts.googleapis') ? 'text/css' : 'application/javascript';
        return r.fulfill({ contentType: type, body: '/* blocked by test */' });
    });
    await page.addInitScript({ path: path.join(__dirname, 'firebase-shim.js') });
    // Auto-accept native dialogs deterministically (native dialogs block JS
    // and are flaky under CDP).
    await page.addInitScript(() => {
        window.__dialogs = [];
        window.confirm = (m) => { window.__dialogs.push('confirm: ' + String(m).split('\n')[0]); return true; };
        window.prompt = (m) => { window.__dialogs.push('prompt: ' + String(m).split('\n')[0]); return 'Test Season'; };
        window.alert = (m) => { window.__dialogs.push('alert: ' + String(m).split('\n')[0]); };
    });
    const dialogs = { async list() { return page.evaluate(() => window.__dialogs); } };
    page.on('pageerror', e => log('❌', 'pageerror: ' + e.message));

    // Wait for a toast matching `re` (all toasts can land in one tick).
    const toast = async (re = /./, timeout = 30000) => {
        await page.waitForFunction((s) => new RegExp(s).test(document.getElementById('toast-holder')?.innerText || ''), re.source, { timeout });
        const text = await page.evaluate(() => document.getElementById('toast-holder').innerText.replace(/\n+/g, ' · '));
        await page.evaluate(() => document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove()));
        return text.trim();
    };
    const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, name + '.png'), fullPage: false });

    await page.goto('http://localhost:8317/sim-racing-career/app.html');
    await page.waitForSelector('#auth-gate:not(.hidden)');
    log('✅', 'App boots on the shim; auth gate shown');

    /* ---- 1. Game Master unlock ---- */
    await page.click('.gate-tab[data-pane="admin"]');
    await page.fill('#gate-passcode', 'phoenix13!');
    await page.click('#gate-admin-submit');
    await page.waitForSelector('#app-shell:not(.hidden)');
    log('✅', 'GM unlock: ' + (await toast(/Welcome back/)));

    /* ---- 2. Role badge overflow check ---- */
    const badge = await page.evaluate(() => {
        const b = document.getElementById('role-badge');
        const s = getComputedStyle(b);
        return { text: b.textContent, scrollW: b.scrollWidth, clientW: b.clientWidth, overflow: s.overflow, display: s.display };
    });
    if (badge.overflow === 'hidden' && badge.scrollW <= badge.clientW + 1) {
        log('✅', `Role badge "${badge.text}" fits pill (${badge.scrollW}px content in ${badge.clientW}px, overflow:${badge.overflow})`);
    } else {
        log('❌', `Role badge overflow: ${JSON.stringify(badge)}`);
    }
    // Probe: force a narrow viewport + long identity name
    await page.setViewportSize({ width: 400, height: 900 });
    const badgeNarrow = await page.evaluate(() => {
        const b = document.getElementById('role-badge');
        const h = document.querySelector('.header-inner');
        return { badgeRight: b.getBoundingClientRect().right, headerRight: h.getBoundingClientRect().right, scrollW: b.scrollWidth, clientW: b.clientWidth };
    });
    log(badgeNarrow.badgeRight <= badgeNarrow.headerRight ? '🔍' : '❌',
        `400px viewport: badge stays inside header (badge right ${Math.round(badgeNarrow.badgeRight)} ≤ header right ${Math.round(badgeNarrow.headerRight)})`);
    await page.setViewportSize({ width: 1280, height: 900 });

    /* ---- 3. Install Real-World Pack from Admin → World ---- */
    await page.evaluate(() => App.go('admin', 'world'));
    await page.waitForSelector('#admin-body .panel');
    await page.click('#admin-body button:has-text("Install Real-World Pack")');
    await page.waitForSelector('#rwp-form'); // install is now a modal with a game choice
    await page.click('#rwp-form button[type=submit]');
    const packToast = await toast(/Pack installed|failed/);
    log(/Pack installed: 3 series/.test(packToast) ? '✅' : '❌', 'Real-World Pack: ' + packToast);

    await page.evaluate(() => App.go('admin', 'world'));
    await page.waitForSelector('#admin-body .panel');
    const worldCounts = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#admin-body .panel-head h2')).map(h => h.textContent.trim()));
    log('✅', 'World tab sections: ' + worldCounts.join(' | '));
    await shot('01-admin-world');

    // Probe: re-run the installer — must skip existing, not duplicate.
    await page.click('#admin-body button:has-text("Install Real-World Pack")');
    await page.waitForSelector('#rwp-form');
    await page.click('#rwp-form button[type=submit]');
    const rerun = await toast(/Pack installed|failed/);
    const seriesCount = await page.evaluate(async () => (await DB.series({ force: true })).length);
    log(seriesCount === 3 ? '🔍' : '❌', `Pack re-run is idempotent: still ${seriesCount} series (${rerun})`);

    /* ---- 4. Simulate one race from Admin → Races ---- */
    await page.evaluate(() => App.go('admin', 'races'));
    await page.waitForSelector('#admin-body table');
    await page.click('#admin-body button:has-text("▶ Simulate")');
    const simToast = await toast(/wins|No AI grid|error/i);
    log(/wins/.test(simToast) ? '✅' : '❌', 'Single race sim: ' + simToast);

    /* ---- 5. Simulate a whole season from the series page ---- */
    const seriesId = await page.evaluate(async () => (await DB.series())[0].id);
    await page.evaluate((id) => App.go('series-detail', id), seriesId);
    await page.waitForSelector('.series-hero');
    await page.click('button:has-text("⏩ Simulate Season")');
    const seasonToast = await toast(/Season simulated|Simulated/);
    log(/Season simulated/.test(seasonToast) ? '✅' : '❌', 'Season sim: ' + seasonToast);
    await page.evaluate((id) => App.go('series-detail', id), seriesId);
    await page.waitForSelector('.series-hero');
    const rows = await page.evaluate(() => document.querySelectorAll('.panel table tbody tr').length);
    log(rows > 10 ? '✅' : '❌', `Series page shows schedule with winners + live standings (${rows} table rows)`);
    await shot('02-series-simulated');

    /* ---- 6. Standings: prestige star column ---- */
    await page.evaluate(() => App.go('standings'));
    await page.waitForSelector('.prestige-cell', { timeout: 10000 });
    const starSample = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.prestige-cell')).slice(0, 5).map(c => c.textContent));
    log('✅', 'Standings ★ column live: ' + JSON.stringify(starSample));
    await shot('03-standings-prestige');

    /* ---- 6b. Prestige leveling: stars spread (nobody at 5★ after one season),
       staff/sponsors/promoters bank prestigeXP from the simulated races ---- */
    const lvl = await page.evaluate(async () => {
        const world = await DB.loadWorld(true);
        const rows = Stats.driverTable(world.races, world);
        const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        rows.forEach(r => { dist[Prestige.driverStars(r.driverId, world, rows)]++; });
        const staff = await DB.staff({ force: true });
        const sponsors = await DB.sponsors({ force: true });
        const personas = await DB.roleProfiles({ force: true });
        const withXP = (list) => list.filter(x => (Number(x.prestigeXP) || 0) > 0).length;
        return {
            dist, drivers: rows.length,
            staffXP: withXP(staff), staffTot: staff.length,
            sponsorXP: withXP(sponsors), sponsorTot: sponsors.length,
            promoterXP: withXP(personas.filter(p => p.role === 'series-owner')),
            maxStaffStars: Math.max(...staff.map(s => Prestige.stored(s)), 1)
        };
    });
    log(lvl.dist[5] < lvl.drivers && lvl.dist[1] + lvl.dist[2] > 0 ? '✅' : '❌',
        `Driver stars spread after one season (not everyone 5★): ${JSON.stringify(lvl.dist)} of ${lvl.drivers} drivers`);
    log(lvl.staffXP > 0 && lvl.sponsorXP > 0 ? '✅' : '❌',
        `Race XP banked: staff ${lvl.staffXP}/${lvl.staffTot}, sponsors ${lvl.sponsorXP}/${lvl.sponsorTot} have prestigeXP (top staff level ${lvl.maxStaffStars}★)`);
    log(lvl.promoterXP > 0 ? '✅' : '❌', `Series promoters earned hosting XP (${lvl.promoterXP} personas)`);

    /* ---- 7. Driver modal: prestige ladder + worth ---- */
    await page.click('.panel table tbody tr');
    await page.waitForSelector('.modal-card .prestige-progress');
    const modalChips = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.modal-card .chip-row')[0].querySelectorAll('.chip,.badge')).map(c => c.textContent.trim()));
    const modalLadder = await page.evaluate(() =>
        document.querySelector('.modal-card .prestige-progress').innerText.replace(/\s*\n\s*/g, ' · '));
    log('✅', 'Driver modal chips: ' + modalChips.join(' | '));
    log(/XP/.test(modalLadder) ? '✅' : '❌', 'Driver modal prestige ladder: ' + modalLadder);
    await shot('04-driver-modal');
    await page.evaluate(() => Modal.close());

    /* ---- 8. Free agency: release an AI driver, then player tries to sign ---- */
    // Force a shakeup so a star hits the market.
    const released = await page.evaluate(async () => {
        const world = await DB.loadWorld(true);
        const rows = Stats.driverTable(world.races, world);
        rows.sort((a, b) => b.points - a.points);
        const star = world.driversById[rows[0].driverId];
        await DB.update('drivers', star.id, { teamId: null });
        // Back-fill a title-laden past: one season no longer mints a high
        // star (that's the point of the ladder — Elite ≈ 10 seasons), so
        // crown them champion of seven closed legacy seasons to push them
        // past the 2,000 XP Front Runner floor.
        for (const y of [2019, 2020, 2021, 2022, 2023, 2024, 2025]) {
            await DB.create('seasons', {
                seriesId: star.seriesId || null, name: `Legacy Championship ${y}`, year: y,
                status: 'completed', championDriverId: star.id, championTeamId: null
            });
        }
        const w2 = await DB.loadWorld(true);
        return { name: star.name, stars: Prestige.driverStars(star.id, w2) };
    });
    const releasedName = released.name;
    log(released.stars >= 3 ? '✅' : '❌',
        `Champion-tier AI driver (${released.stars}★ after 7 legacy titles) released to free agency: ${releasedName}`);

    /* ---- 9. Player career: register, 1★ rookie onboarding, found team, prestige-gated hiring ---- */
    await page.click('#signout-btn');
    await page.waitForSelector('#auth-gate:not(.hidden)');
    await page.click('.gate-tab[data-pane="player"]');
    await page.click('#gate-mode-toggle');
    await page.fill('#gate-name', 'Phoenix Tester');
    await page.fill('#gate-email', 'tester@example.com');
    await page.fill('#gate-password', 'secret1');
    await page.click('#gate-player-submit');
    await page.waitForSelector('#app-shell:not(.hidden)');
    // Difficulty picker should float up on the career view.
    await page.waitForSelector('.modal-card .role-card', { timeout: 10000 });
    await page.click('.modal-card .role-card:has-text("Semi-Pro")');
    log('✅', 'New player: ' + (await toast(/starting budget/)));
    // Pick Team Owner role.
    await page.waitForSelector('.role-grid .role-card');
    await page.click('.role-card:has-text("Team Owner")');
    await toast(/now playing as/);
    // Check the driver onboarding note exists for driver role too (probe the modal text via Career).
    await page.evaluate(() => Career.driverOnboarding('scratch'));
    const rookieNote = await page.evaluate(() => document.querySelector('.modal-card .muted.small')?.textContent || '');
    log(/1 ★ Rookie/.test(rookieNote) && /Legend/.test(rookieNote) ? '🔍' : '❌',
        'Driver onboarding shows the 1★ Rookie start + level ladder note');
    await shot('05-rookie-onboarding');
    await page.evaluate(() => Modal.close());

    // Found a team.
    await page.waitForSelector('.onboard-card');
    await page.click('.onboard-card:has-text("Found a new team")');
    await page.fill('#tf-name', 'Tester Racing');
    await page.click('#team-form button[type=submit]');
    log('✅', 'Team founded: ' + (await toast(/founded/i)));

    // New team's workspace shows the 1★ Rookie prestige ladder at 0 XP.
    await page.waitForSelector('.prestige-progress');
    const teamLadder = await page.evaluate(() =>
        document.querySelector('.prestige-progress').innerText.replace(/\s*\n\s*/g, ' · '));
    log(/Rookie/.test(teamLadder) && /0 XP/.test(teamLadder) ? '✅' : '❌',
        'New team starts as 1★ Rookie with 0 XP: ' + teamLadder);

    // Open the hire market — the released 5★-tier driver should be locked.
    await page.waitForSelector('button:has-text("🤝 Hire")');
    await page.click('button:has-text("🤝 Hire")');
    await page.waitForSelector('.modal-card .race-row');
    const marketHtml = await page.evaluate(() => document.querySelector('.modal-card').innerText);
    const hasPrestigeLine = /team's prestige/.test(marketHtml);
    const lockShown = /needs a more prestigious team/.test(marketHtml);
    log(hasPrestigeLine ? '✅' : '❌', 'Hire market shows team prestige line');
    log(lockShown ? '✅' : '⚠️', 'High-star free agent flagged 🔒 out of reach for a 1★ team');
    await shot('06-hire-market');

    // Probe: actually click Hire on the star — must get the prestige-gap modal, no signing.
    const starRow = await page.locator(`.modal-card .race-row:has-text("${releasedName}")`).first();
    await starRow.locator('button:has-text("Hire")').click();
    await page.waitForSelector('.modal-card:has-text("interested")', { timeout: 8000 }).catch(() => {});
    const gateText = await page.evaluate(() => document.querySelector('.modal-card')?.innerText || '');
    log(/Prestige gap|isn't interested/.test(gateText) ? '🔍' : '❌', 'Prestige gate blocks signing the star: modal says "' + gateText.split('\n')[1]?.slice(0, 80) + '…"');
    await shot('07-prestige-gate');
    await page.evaluate(() => Modal.close());

    // Probe: hire a 1★ crew member — should succeed and charge the wallet.
    const balBefore = await page.evaluate(() => Economy.balance());
    await page.evaluate(async () => {
        let free = (await DB.staff({ force: true })).find(s => !s.teamId);
        if (!free) { // pack staff are all signed — put a rookie on the market
            const id = await DB.create('staff', makeNpcStaff('mechanic', new Set()));
            free = await DB.get('staff', id);
        }
        const teams = await DB.teams({ force: true });
        const mine = teams.find(t => t.name === 'Tester Racing');
        Market.negotiate('staff', free.id, mine.id);
    });
    await page.waitForSelector('#offer-form');
    await page.click('#offer-form button[type=submit]');
    const hireToast = await toast(/signed for|error|✕/);
    const balAfter = await page.evaluate(() => Economy.balance());
    log(/signed for/.test(hireToast) && balAfter < balBefore ? '🔍' : '❌',
        `1★ crew hire succeeds & wallet charged: ${hireToast} (balance ${balBefore} → ${balAfter})`);

    /* ---- 10. Prize money: player driver in a simulated race ---- */
    // Enter the player's team in series 1, give it a driver, sim a race, check wallet grows.
    const payout = await page.evaluate(async (sid) => {
        const teams = await DB.teams({ force: true });
        const mine = teams.find(t => t.name === 'Tester Racing');
        await DB.update('teams', mine.id, { seriesId: sid });
        const driverId = await DB.create('drivers', { name: 'Tester Driver', teamId: mine.id, ownerUid: Auth.uid(), rating: 90, status: 'approved', prestige: 1 });
        // fresh scheduled race in that series
        const raceId = await DB.create('races', { seriesId: sid, name: 'Payout GP', track: 'Silverstone Circuit', date: '2026-07-07', status: 'scheduled', results: [] });
        const before = Number((await DB.get('users', Auth.uid())).balance) || 0;
        await Sim.simulateRace(raceId, { quiet: true });
        const after = Number((await DB.get('users', Auth.uid())).balance) || 0;
        const race = await DB.get('races', raceId);
        const mine2 = race.results.find(r => r.driverId === driverId);
        return { before, after, pos: mine2?.dnf ? 'DNF' : 'P' + mine2?.position };
    }, seriesId);
    log(payout.after > payout.before ? '✅' : '❌',
        `Prize money flows to player wallet: finished ${payout.pos}, balance ${payout.before} → ${payout.after}`);

    /* ---- 10b. Profile: one career card per role, each with prestige + stats ---- */
    await page.evaluate(async () => {
        // Give the tester a second role with data: agent with one client.
        const drivers = await DB.drivers({ force: true });
        const client = drivers.find(d => d.name === 'Tester Driver');
        await DB.create('roleProfiles', {
            name: 'Phoenix Tester', uid: Auth.uid(), role: 'agent', prestige: 1,
            clientDriverIds: client ? [client.id] : []
        });
        App.go('profile', Auth.uid());
    });
    await page.waitForSelector('.role-stat-card');
    const roleCards = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.role-stat-card')).map(c => ({
            role: c.querySelector('h3').textContent,
            active: c.classList.contains('role-active'),
            ladder: !!c.querySelector('.prestige-progress'),
            stats: Array.from(c.querySelectorAll('.mini-stat')).map(m => m.innerText.replace(/\s*\n\s*/g, ' '))
        })));
    log(roleCards.length >= 3 && roleCards.every(c => c.ladder && c.stats.length) ? '✅' : '❌',
        'Profile role cards: ' + roleCards.map(c => `${c.role}${c.active ? ' (active)' : ''} [${c.stats.join(', ')}]`).join(' | '));
    await page.waitForTimeout(800); // let the view entrance animation finish
    await shot('09-profile-roles');

    /* ---- 11. GM elevation from player + header identity ---- */
    await page.evaluate(() => App.go('dashboard'));
    await page.click('#gm-elevate-btn');
    await page.fill('#gm-pass', 'phoenix13!');
    await page.click('#gm-form button[type=submit]');
    await toast(/Game Master unlocked/);
    const badge2 = await page.evaluate(() => {
        const b = document.getElementById('role-badge');
        return { text: b.textContent, fits: b.scrollWidth <= b.clientW + 1 || b.scrollWidth <= b.clientWidth + 1 };
    });
    log(badge2.fits ? '✅' : '❌', `Elevated GM badge "${badge2.text}" still fits its pill`);
    await shot('08-gm-elevated');

    console.log('\nDIALOGS SEEN:\n' + (await dialogs.list()).map(d => '  ' + d).join('\n'));
    console.log('\n=== STEPS ===\n' + steps.join('\n'));
    await browser.close();
    process.exit(steps.some(s => s.startsWith('❌')) ? 1 : 0);
})().catch(e => { console.error('DRIVER CRASH:', e); process.exit(2); });
