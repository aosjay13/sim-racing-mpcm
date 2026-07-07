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
    await page.addInitScript(() => { window.confirm = () => true; window.prompt = () => 'Test'; });
    page.on('pageerror', e => log('❌', 'pageerror: ' + e.message));
    const toast = async (re, timeout = 30000) => {
        await page.waitForFunction(s => new RegExp(s).test(document.getElementById('toast-holder')?.innerText || ''), re.source, { timeout });
        await page.evaluate(() => document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove()));
    };
    const shot = n => page.screenshot({ path: path.join(__dirname, n + '.png') });

    await page.goto('http://localhost:8317/sim-racing-career/app.html');
    // GM: seed world + simulate a season for data richness.
    await page.click('.gate-tab[data-pane="admin"]');
    await page.fill('#gate-passcode', 'phoenix13!');
    await page.click('#gate-admin-submit');
    await page.waitForSelector('#app-shell:not(.hidden)');
    await toast(/Welcome back/);
    await page.evaluate(async () => { await installRealWorldPack(); });
    log('✅', 'World seeded (pack)');

    // Player: register through the gate, pick difficulty, become a DRIVER.
    await page.click('#signout-btn');
    await page.waitForSelector('#auth-gate:not(.hidden)');
    await page.click('.gate-tab[data-pane="player"]');
    await page.click('#gate-mode-toggle');
    await page.fill('#gate-name', 'Justin May');
    await page.fill('#gate-email', 'justin@example.com');
    await page.fill('#gate-password', 'secret1');
    await page.click('#gate-player-submit');
    await page.waitForSelector('#app-shell:not(.hidden)');
    await page.waitForSelector('.modal-card .role-card');
    await page.click('.modal-card .role-card:has-text("Semi-Pro")');
    await toast(/starting budget/);
    await page.waitForSelector('.role-grid .role-card');
    await page.click('.role-card:has-text("Driver")');
    await toast(/now playing as/);
    await page.click('.onboard-card:has-text("Start from scratch")');
    await page.fill('#ob-name', 'J. May');
    await page.fill('#ob-number', '13');
    await page.click('#ob-driver-form button[type=submit]');
    await toast(/Welcome to the grid/);
    log('✅', 'Player driver "J. May" created');

    // Race them: sign up for a Formula race + simulate it (as elevated GM).
    const raced = await page.evaluate(async () => {
        const world = await DB.loadWorld(true);
        const me = world.drivers.find(d => d.name === 'J. May');
        const race = world.races.filter(r => r.status === 'scheduled' && world.seriesById[r.seriesId])
            .sort((a, b) => (a.round || 9) - (b.round || 9))[0];
        await DB.create('raceSignups', { raceId: race.id, uid: Auth.uid(), driverId: me.id });
        await Sim.simulateRace(race.id, { quiet: true });
        const done = await DB.get('races', race.id);
        const res = done.results.find(r => r.driverId === me.id);
        return { race: done.name, pos: res ? (res.dnf ? 'DNF' : 'P' + res.position) : 'MISSING' };
    });
    log(raced.pos !== 'MISSING' ? '✅' : '❌', `Signed-up player included in simulated ${raced.race}: ${raced.pos}`);

    // Header username → own profile page.
    await page.click('#header-username');
    await page.waitForSelector('.profile-avatar');
    const profileText = await page.evaluate(() => document.getElementById('view-root').innerText);
    const checks = [
        ['identity hero', /Justin May/], ['Player badge', /Player/], ['prestige stars', /★/],
        ['member since', /Member since/], ['stat strip starts', /starts/i],
        ['achievements', /achievements/i], ['driver identities', /driver identities/i],
        ['race history', /full race history \(1\)/i], ['contracts', /driving contracts/i],
        ['challenge record', /challenge record/i], ['press clippings', /press clippings/i],
        ['teams owned', /teams owned/i]
    ];
    for (const [label, re] of checks) log(re.test(profileText) ? '✅' : '❌', `Profile section: ${label}`);
    const firstStart = /First Start/.test(profileText);
    log(firstStart ? '✅' : '❌', 'Achievement "First Start" earned from the 1 simulated race');
    await shot('10-player-profile');

    // Wallet privacy probe: own profile shows balance; does the OTHER-player view hide it?
    // (Register a 2nd player and view Justin's profile.)
    await page.click('#signout-btn');
    await page.waitForSelector('#auth-gate:not(.hidden)');
    await page.click('.gate-tab[data-pane="player"]');
    if (await page.locator('#gate-name-field.hidden').count()) await page.click('#gate-mode-toggle');
    await page.fill('#gate-name', 'Rival Guy');
    await page.fill('#gate-email', 'rival@example.com');
    await page.fill('#gate-password', 'secret1');
    await page.click('#gate-player-submit');
    await page.waitForSelector('#app-shell:not(.hidden)');
    await page.waitForSelector('.modal-card .role-card');
    await page.click('.modal-card .role-card:has-text("Semi-Pro")');
    await toast(/starting budget/);
    // Hub → Players directory → open Justin's profile from the card.
    await page.evaluate(() => App.go('hub', 'players'));
    await page.waitForSelector('#hub-body .race-row');
    const dirText = await page.evaluate(() => document.getElementById('hub-body').innerText);
    log(/Justin May/.test(dirText) && /Rival Guy/.test(dirText) ? '✅' : '❌', 'Hub Players directory lists real players only');
    log(!/Nash|Vettori|Kowalski/.test(dirText) ? '🔍' : '❌', 'Directory contains no AI drivers');
    await shot('11-players-directory');
    await page.click('#hub-body .race-row:has-text("Justin May")');
    await page.waitForSelector('.profile-avatar');
    const otherView = await page.evaluate(() => document.getElementById('view-root').innerText);
    log(/Justin May/.test(otherView) ? '✅' : '❌', "Another player can open Justin's profile from the directory");
    log(!/💵/.test(otherView.split('\n').slice(0, 12).join('\n')) ? '🔍' : '⚠️', "Wallet balance hidden on someone else's profile");

    // Driver modal split: player driver shows profile button; AI does not + trimmed.
    await page.evaluate(async () => {
        const world = await DB.loadWorld(true);
        Views.showDriver(world.drivers.find(d => d.name === 'J. May').id);
    });
    await page.waitForSelector('.modal-card');
    const pModal = await page.evaluate(() => document.querySelector('.modal-card').innerText);
    log(/full player profile/i.test(pModal) ? '✅' : '❌', 'Player driver modal has "Full Player Profile" button');
    await page.evaluate(() => Modal.close());
    await page.evaluate(async () => {
        const world = await DB.loadWorld(true);
        Views.showDriver(world.drivers.find(d => d.isNPC).id);
    });
    await page.waitForSelector('.modal-card');
    const aiModal = await page.evaluate(() => document.querySelector('.modal-card').innerText);
    log(!/full player profile/i.test(aiModal) && /worth/.test(aiModal) ? '🔍' : '❌',
        'AI driver modal: no profile button, keeps prestige/worth/rating for hire decisions');
    log(/recent form \(last 5\)|no races completed/i.test(aiModal) ? '🔍' : '❌', 'AI history trimmed to last 5');
    await shot('12-ai-modal');

    console.log('\n=== STEPS ===\n' + steps.join('\n'));
    await browser.close();
    process.exit(steps.some(s => s.startsWith('❌')) ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
