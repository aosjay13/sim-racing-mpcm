/* Drive the isolated Team/Player wallet system through the real UI on the
   shim: per-role difficulty (Driver vs Team Owner tracked separately), the
   team marketplace (founding a custom team vs buying an established one,
   both difficulty-gated and priced), and the core isolation guarantee —
   a team owner hiring/paying their OWN driver persona genuinely moves two
   different numbers (teams/{id}.budget vs users/{uid}.balance), never a
   same-uid no-op, with a fully tagged ledger trail (walletType/walletId). */
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
    await page.addInitScript(() => { window.confirm = () => true; window.prompt = () => 'Test'; window.alert = () => {}; });
    page.on('pageerror', e => log('❌', 'pageerror: ' + e.message));
    const toast = async (re, timeout = 30000) => {
        await page.waitForFunction(s => new RegExp(s).test(document.getElementById('toast-holder')?.innerText || ''), re.source, { timeout });
        const t = await page.evaluate(() => document.getElementById('toast-holder').innerText.replace(/\n+/g, ' · '));
        await page.evaluate(() => document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove()));
        return t.trim();
    };
    const shot = async (n) => { await page.waitForTimeout(700); await page.screenshot({ path: path.join(__dirname, n + '.png') }); };
    const signOut = async () => {
        await page.evaluate(() => Modal.close());
        if (await page.locator('#app-shell:not(.hidden)').count()) await page.click('#signout-btn');
        await page.waitForSelector('#auth-gate:not(.hidden)');
    };
    const registerPlayer = async (name, email, role, roleCard = 'Semi-Pro') => {
        await signOut();
        await page.click('.gate-tab[data-pane="player"]');
        if (await page.locator('#gate-name-field.hidden').count()) await page.click('#gate-mode-toggle');
        await page.fill('#gate-name', name);
        await page.fill('#gate-email', email);
        await page.fill('#gate-password', 'secret1');
        await page.click('#gate-player-submit');
        await page.waitForSelector('#app-shell:not(.hidden)');
        await page.waitForSelector('.modal-card .role-card');
        await page.click(`.modal-card .role-card:has-text("${roleCard}")`);
        await toast(/starting budget/);
        await page.waitForSelector('.role-grid .role-card');
        await page.click(`.role-card:has(.role-name:text-is("${role}"))`);
        await toast(/now playing as/);
    };
    const signIn = async (email) => {
        await signOut();
        await page.click('.gate-tab[data-pane="player"]');
        if (!(await page.locator('#gate-name-field.hidden').count())) await page.click('#gate-mode-toggle');
        await page.fill('#gate-email', email);
        await page.fill('#gate-password', 'secret1');
        await page.click('#gate-player-submit');
        await page.waitForSelector('#app-shell:not(.hidden)');
    };
    const gmSignIn = async () => {
        await signOut();
        await page.click('.gate-tab[data-pane="admin"]');
        await page.fill('#gate-passcode', 'phoenix13!');
        await page.click('#gate-admin-submit');
        await page.waitForSelector('#app-shell:not(.hidden)');
    };

    await page.goto('http://localhost:8317/sim-racing-career/app.html');
    await page.click('.gate-tab[data-pane="admin"]');
    await page.click('.gate-tab[data-pane="player"]');

    /* ---- 1. Owen: Driver difficulty (Semi-Pro) AND separate Team Owner difficulty (Hard) ---- */
    await registerPlayer('Owen', 'owen@example.com', 'Team Owner');
    let roleDiff = await page.evaluate(async () => (await DB.users({ force: true })).find(u => u.displayName === 'Owen').roleDifficulty);
    log(roleDiff?.driver === 'medium' ? '✅' : '❌', `Driver difficulty mirrored into roleDifficulty.driver (${roleDiff?.driver})`);
    await page.waitForSelector('.modal-card .role-card');
    const pickerHeader = await page.evaluate(() => document.querySelector('.modal-card h2, .modal-card .modal-title')?.textContent || document.querySelector('.modal-card').innerText.slice(0, 60));
    log(/team owner difficulty/i.test(pickerHeader) ? '✅' : '❌', 'Entering Team Owner role with no team prompts a SEPARATE difficulty picker: ' + pickerHeader.slice(0, 50));
    await page.click('.role-card:has-text("Grassroots Underdog")');
    await toast(/Team Owner difficulty set/);
    roleDiff = await page.evaluate(async () => (await DB.users({ force: true })).find(u => u.displayName === 'Owen').roleDifficulty);
    log(roleDiff?.driver === 'medium' && roleDiff?.['team-owner'] === 'hard' ? '✅' : '❌',
        `Independent per-role difficulty (driver=${roleDiff?.driver}, team-owner=${roleDiff?.['team-owner']})`);

    /* ---- 2. Marketplace: filtered to the chosen tier, checkered-flag stat lists ---- */
    await page.waitForSelector('.team-market-grid');
    const marketText = await page.evaluate(() => document.querySelector('.view-root, #view-root').innerText);
    log(/Grassroots Underdog Marketplace/.test(marketText) && /Personal wallet: \$75,000/.test(marketText) ? '✅' : '❌',
        'Marketplace shows the chosen tier + personal wallet (never team money — no team exists yet)');
    log(await page.evaluate(() => document.querySelectorAll('.checkered-list li').length) >= 3 ? '✅' : '❌',
        'Found-team card lists stats with checkered-flag bullets');
    await shot('28-team-marketplace');

    /* ---- 3. Found a custom team: entry fee from PERSONAL wallet, team wallet seeded separately ---- */
    await page.click('.team-market-card-found');
    await page.waitForSelector('#team-form');
    await page.fill('#tf-name', 'Owen Racing');
    await page.click('#team-form button[type=submit]');
    await toast(/Team founded/);
    let state = await page.evaluate(async () => {
        const user = (await DB.users({ force: true })).find(u => u.displayName === 'Owen');
        const team = (await DB.teams({ force: true })).find(t => t.name === 'Owen Racing');
        return { personal: user.balance, teamBudget: team.budget, marketValue: team.marketValue, tier: team.tier, teamId: team.id };
    });
    log(state.personal === 74000 && state.teamBudget === 20000 && state.marketValue === 1000 && state.tier === 'hard' ? '✅' : '❌',
        `Founding debited the $1,000 entry fee from PERSONAL wallet ($${state.personal}) and seeded a SEPARATE $20,000 team wallet ($${state.teamBudget})`);

    /* ---- 4. The core isolation guarantee: Owen hires/pays HIMSELF as a driver ---- */
    const ids = await page.evaluate(async ({ teamId }) => {
        const user = (await DB.users({ force: true })).find(u => u.displayName === 'Owen');
        const driverId = await DB.create('drivers', { name: 'Owen Driver', ownerUid: user.id, teamId, isNPC: false, rating: 70 });
        await DB.create('contracts', {
            teamId, teamName: 'Owen Racing', ownerUid: user.id,
            personId: driverId, personKind: 'driver', personName: 'Owen Driver', personUid: user.id,
            role: 'driver', salary: 500, exclusive: true, agreement: 'contracted', buyout: 5000,
            seasonYear: new Date().getFullYear(), status: 'active', signedAt: '2026-01-01'
        });
        const gameId = await DB.create('games', { name: 'Self-Hire Test' });
        const seriesId = await DB.create('series', { name: 'Self Cup', gameId, pointsSystem: 'f1', status: 'active' });
        const seasonId = await DB.create('seasons', { name: 'Self Cup S1', seriesId, status: 'active' });
        const raceId = await DB.create('races', { seriesId, seasonId, gameId, name: 'Self GP', round: 1, track: 'Test Ring', date: '2026-07-01', laps: 20, status: 'scheduled', results: [] });
        return { driverId, raceId, uid: user.id };
    }, { teamId: state.teamId });

    await gmSignIn();
    await page.evaluate((id) => Admin.resultsForm(id), ids.raceId);
    await page.waitForSelector('#results-form');
    await page.fill(`tr[data-driver="${ids.driverId}"] .input-pos`, '1');
    await page.click('#results-form button[type=submit]');
    await toast(/Results saved/);

    const after = await page.evaluate(async ({ uid, teamId }) => {
        const user = await DB.get('users', uid, { force: true });
        const team = await DB.get('teams', teamId, { force: true });
        const rows = (await DB.list('ledger', { force: true })).filter(t => t.refId);
        return {
            personal: user.balance, teamBudget: team.budget,
            teamRows: rows.filter(l => l.walletType === 'team' && l.walletId === teamId),
            playerRows: rows.filter(l => l.walletType === 'player' && l.walletId === uid)
        };
    }, { uid: ids.uid, teamId: state.teamId });
    log(after.teamBudget === state.teamBudget - 500 + 2500 ? '✅' : '❌',
        `Team wallet genuinely moved (payroll -$500, team share +$2500): $${state.teamBudget} → $${after.teamBudget}`);
    log(after.personal === state.personal + 5000 + 500 ? '✅' : '❌',
        `PERSONAL wallet genuinely moved (prize +$5000, salary +$500) — same human, different wallets: $${state.personal} → $${after.personal}`);
    log(after.teamRows.some(r => r.amount === -500 && /Payroll/.test(r.label)) && after.playerRows.some(r => r.amount === 500 && /Salary/.test(r.label)) ? '✅' : '❌',
        'Ledger has BOTH a team-tagged payroll debit AND a player-tagged salary credit — never netted to zero, always paired');

    /* ---- 5. Buying an established (unowned AI) team ---- */
    const seedId = await page.evaluate(async () => DB.create('teams', { name: 'Vector Motorsport', ownerUid: null, isEstablished: true, status: 'approved', description: 'A solid midfield AI outfit.' }));
    await registerPlayer('Nora', 'nora@example.com', 'Team Owner', 'Sponsored Start');
    await page.click('.role-card:has-text("Grassroots Underdog")'); // fresh AI team = 1★ = hard tier
    await toast(/Team Owner difficulty set/);
    await page.waitForSelector('.team-market-grid');
    const listingText = await page.evaluate(() => document.querySelector('.team-market-card:not(.team-market-card-found)')?.innerText || '');
    log(/Vector Motorsport/.test(listingText) && /★/.test(listingText) ? '✅' : '❌', 'Marketplace lists the unowned AI team with a prestige chip: ' + listingText.slice(0, 40));
    await shot('29-buy-established-team');
    await page.click('.team-market-card:not(.team-market-card-found)');
    const buyToast = await toast(/is yours/);
    log(/\$5,000|starting budget/.test(buyToast) ? '✅' : '❌', 'Buy confirmation: ' + buyToast.slice(0, 90));
    const boughtState = await page.evaluate(async ({ seedId }) => {
        const user = (await DB.users({ force: true })).find(u => u.displayName === 'Nora');
        const team = await DB.get('teams', seedId, { force: true });
        return { personal: user.balance, teamBudget: team.budget, marketValue: team.marketValue, ownerUid: team.ownerUid };
    }, { seedId });
    log(boughtState.personal === 250000 - boughtState.marketValue && boughtState.teamBudget === 20000 && boughtState.ownerUid ? '✅' : '❌',
        `Purchase debited PERSONAL wallet by the $${boughtState.marketValue} price tag, seeded a fresh $20,000 team wallet (personal now $${boughtState.personal})`);

    /* ---- 6. GM Override: Team wallet vs Player wallet are separately adjustable ---- */
    await gmSignIn();
    await page.evaluate(() => App.go('admin', 'override'));
    await page.waitForSelector('#ov-wallet-kind');
    await page.selectOption('#ov-wallet-kind', 'team');
    await page.waitForSelector('#ov-wallet-team-field:not(.hidden)');
    log(await page.locator('#ov-wallet-user-field.hidden').count() === 1 ? '✅' : '❌', 'GM override wallet panel toggles Player field away when Team is selected');
    await page.selectOption('#ov-wallet-team', state.teamId);
    await page.fill('#ov-wallet-amt', '1000');
    await page.fill('#ov-wallet-why', 'Sponsor windfall');
    await page.click('#ov-wallet-go');
    const ovToast = await toast(/Team budget updated/);
    log(/\+\$1,000/.test(ovToast) ? '✅' : '❌', 'GM adjusted the TEAM wallet specifically: ' + ovToast.slice(0, 60));
    const afterOv = await page.evaluate(async ({ teamId }) => (await DB.get('teams', teamId, { force: true })).budget, { teamId: state.teamId });
    log(afterOv === after.teamBudget + 1000 ? '✅' : '❌', `Team budget reflects the GM adjustment exactly ($${afterOv})`);

    console.log(`\n${steps.filter(s => s.startsWith('✅')).length}/${steps.length} steps passed`);
})().catch(e => { console.error('❌ DRIVE CRASHED:', e); process.exit(1); });
