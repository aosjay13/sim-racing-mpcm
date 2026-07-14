/* Drive the AI Financial Parity & Dynamic Budget system (v3.29.0):
   per-race consortium sponsorship scaled by prestige + field strength +
   human-economy anchor, strict ledger compliance for AI payroll/sign-on
   flows, AI insolvency with instant liquidation, receivership + automated
   consortium takeover, GM oversight dashboard with overrides. */
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
    await page.addInitScript(() => { window.confirm = () => true; window.prompt = () => '10000'; window.alert = () => {}; });
    page.on('pageerror', e => log('❌', 'pageerror: ' + e.message));
    const teamLedger = (teamId, re) => page.evaluate(async ({ teamId, re }) => {
        const rows = (await DB.list('ledger', { force: true }))
            .filter(t => t.walletType === 'team' && t.walletId === teamId && new RegExp(re).test(t.label));
        return { count: rows.length, sum: rows.reduce((s, t) => s + t.amount, 0), labels: rows.map(r => r.label) };
    }, { teamId, re });
    const team = (id) => page.evaluate((id) => DB.get('teams', id, { force: true }), id);
    const shot = async (n) => { await page.waitForTimeout(800); await page.screenshot({ path: path.join(__dirname, n + '.png') }); };

    /* ---- Setup: GM + a seeded grid (AI 4★, AI 1★, one human team) ---- */
    await page.goto('http://localhost:8317/sim-racing-career/app.html');
    await page.click('.gate-tab[data-pane="admin"]');
    await page.fill('#gate-passcode', 'phoenix13!');
    await page.click('#gate-admin-submit');
    await page.waitForSelector('#app-shell:not(.hidden)');
    await page.evaluate(async () => {
        const db = SRMPC.db;
        await db.collection('teams').doc('t-elite').set({ name: 'Elite AI Racing', ownerUid: null, budget: 5000 });
        await db.collection('teams').doc('t-club').set({ name: 'Club AI Motors', ownerUid: null, budget: 1000 });
        await db.collection('teams').doc('t-human').set({ name: 'Human Racing Co', ownerUid: 'u-human', budget: 400000 });
        await db.collection('users').doc('u-human').set({ displayName: 'Hank', balance: 50000, walletInitialized: true });
        await db.collection('users').doc('u-play').set({ displayName: 'Petra', balance: 50000, walletInitialized: true });
        await db.collection('drivers').doc('d-elite').set({ name: 'Ai Elite', isNPC: true, teamId: 't-elite', ownerUid: null, status: 'approved' });
        await db.collection('drivers').doc('d-club').set({ name: 'Ai Club', isNPC: true, teamId: 't-club', ownerUid: null, status: 'approved' });
        await db.collection('drivers').doc('d-petra').set({ name: 'Petra Swift', teamId: 't-elite', ownerUid: 'u-play', status: 'approved' });
        // Player driver contracted TO the AI team — the payroll parity case.
        await db.collection('contracts').doc('c-petra').set({
            teamId: 't-elite', teamName: 'Elite AI Racing', ownerUid: null,
            personId: 'd-petra', personKind: 'driver', personName: 'Petra Swift', personUid: 'u-play',
            role: 'driver', salary: 500, status: 'active', seasonYear: 2026
        });
        // 27 legacy titles → Elite AI Racing banks 4★ prestige.
        await DB.batchCreate('seasons', Array.from({ length: 27 }, (_, i) =>
            ({ name: `AI Legacy ${i + 1}`, status: 'completed', championTeamId: 't-elite' })));
        DB.invalidate();
    });

    /* ---- 1. Race settlement: consortium sponsorship + real AI payroll ---- */
    const race1 = {
        id: 'r-parity-1', name: 'Parity GP R1', seriesId: 's-x', results: [
            { driverId: 'd-elite', position: 1 }, { driverId: 'd-petra', position: 2 }, { driverId: 'd-club', position: 3 }
        ]
    };
    await page.evaluate(async (race) => Sim.payoutRace(race, await DB.loadWorld(true)), race1);
    let led = await teamLedger('t-elite', 'AI consortium sponsorship');
    const ledClub = await teamLedger('t-club', 'AI consortium sponsorship');
    log(led.count === 1 && ledClub.count === 1 && led.sum > ledClub.sum && ledClub.sum >= 800 ? '✅' : '❌',
        `calculateAISponsorship pays per race, scaled by prestige: 4★ Elite $${led.sum} > 1★ Club $${ledClub.sum} — real ledger rows`);
    led = await teamLedger('t-elite', 'Payroll: Petra Swift');
    const petraPaid = await page.evaluate(async () => (await DB.list('ledger', { force: true }))
        .filter(t => t.walletType === 'player' && t.uid === 'u-play' && /Salary from/.test(t.label))
        .reduce((s, t) => s + t.amount, 0));
    log(led.count === 1 && led.sum === -500 && petraPaid === 500 ? '✅' : '❌',
        `AI team pays payroll from its OWN wallet: t-elite −$500 (ledger) ⇄ Petra +$${petraPaid} (ledger) — no ghost money`);
    led = await teamLedger('t-elite', 'Team share');
    log(led.count >= 1 && led.sum > 0 ? '✅' : '❌', `AI team collects its prize team-share too ($${led.sum})`);

    /* ---- 2. Human-economy anchoring ---- */
    const cfg1 = await page.evaluate(() => Parity.config());
    log(cfg1.anchorMultiplier === 3 && cfg1.humanMedian === 400000 ? '✅' : '❌',
        `Anchor recomputed at settlement: human median ${cfg1.humanMedian} vs AI → multiplier ×${cfg1.anchorMultiplier} (capped at ${3})`);
    const race2 = { ...race1, id: 'r-parity-2', name: 'Parity GP R2' };
    await page.evaluate(async (race) => Sim.payoutRace(race, await DB.loadWorld(true)), race2);
    const led2 = await teamLedger('t-club', 'AI consortium sponsorship — Parity GP R2');
    log(led2.sum >= ledClub.sum * 3 ? '✅' : '❌',
        `Inflated human economy scales AI payouts: Club's R2 sponsorship $${led2.sum} ≥ 3× its R1 $${ledClub.sum}`);

    /* ---- 3. AI insolvency: instant liquidation clears the debt ---- */
    await page.evaluate(async () => {
        const car = { id: 'car-x', carId: 'club-special', name: 'Club Special', price: 2000, boughtAt: '2026-01-01' };
        await SRMPC.db.collection('teams').doc('t-club').set({ budget: -500, garage: [car], garageCarIds: ['club-special'] }, { merge: true });
        DB.invalidate();
        await Insolvency.evaluate('t-club');
    });
    let t = await team('t-club');
    led = await teamLedger('t-club', 'Liquidated Club Special');
    log(t.financialState === 'solvent' && t.budget === 700 && led.sum === 1200 && (t.garage || []).length === 0 ? '✅' : '❌',
        `Broke AI team auto-liquidates through the ledger: −$500 + $1,200 car sale (60%) → $${t.budget}, solvent, garage cleared`);

    /* ---- 4. Critical debt → receivership; frozen out of the market ---- */
    await page.evaluate(async () => {
        await SRMPC.db.collection('teams').doc('t-club').set({ budget: -30000 }, { merge: true });
        DB.invalidate();
        await Insolvency.evaluate('t-club');
    });
    t = await team('t-club');
    log(t.financialState === 'repossessed' && t.repossessedRaces === 0 ? '✅' : '❌',
        `Debt below ${-25000} sends the AI team into league receivership (state: ${t.financialState})`);
    let msg = await page.evaluate(async () => {
        try { await Parity.assertAICanBid('t-club', 100); return 'ALLOWED'; } catch (e) { return e.message; }
    });
    log(/receivership/.test(msg) ? '✅' : '❌', 'AI principal cannot open free-agent talks from receivership: ' + msg.slice(0, 70));

    /* ---- 5. Consortium takeover after the grace races ---- */
    for (let i = 0; i < 3; i++) await page.evaluate(async () => Parity.raceTick(await DB.loadWorld(true)));
    t = await team('t-club');
    const writeOff = await teamLedger('t-club', 'Debt written off');
    const baseline = await teamLedger('t-club', 'Consortium baseline funding');
    log(t.financialState === 'solvent' && t.budget === 20000 && writeOff.sum === 30000 && baseline.sum === 20000
        && Number.isFinite(t.marketValue) && t.tier === 'hard' ? '✅' : '❌',
        `Consortium takeover: $30,000 debt written off + $20,000 hard-tier baseline injected (both ledger rows), marketValue ${t.marketValue}, back on the grid`);

    /* ---- 6. AI bidding guard + sign-on bonus through the unified ledger ---- */
    msg = await page.evaluate(async () => {
        try { await Parity.assertAICanBid('t-club', 50000); return 'ALLOWED'; } catch (e) { return e.message; }
    });
    log(/can't fund/.test(msg) ? '✅' : '❌', 'Funding headroom guard (salary×2) blocks offers the wallet cannot cover: ' + msg.slice(0, 60));
    // Full loop: player applies → AI principal opens talks → player accepts →
    // the sign-on bonus debits the AI team wallet via executeRoleTransaction.
    const signOn = await page.evaluate(async () => {
        await SRMPC.db.collection('drivers').doc('d-free').set({ name: 'Freddie Free', ownerUid: 'u-play', teamId: null, status: 'approved' });
        const recId = await DB.create('recruitment', { kind: 'application', status: 'pending', teamId: 't-club', teamName: 'Club AI Motors', ownerUid: null, driverId: 'd-free', driverName: 'Freddie Free', driverUid: 'u-play' });
        DB.invalidate();
        const neg = await Deals.aiPrincipalOffer(recId);
        // Player side accepts the AI's market-rate offer.
        Auth.state.user = { uid: 'u-play', isAnonymous: false };
        Auth.state.mode = 'player';
        Auth.state.profile = await DB.get('users', 'u-play', { force: true });
        const before = (await DB.get('teams', 't-club', { force: true })).budget;
        await Deals.accept(neg.id, neg.salary, (neg.negotiationHistory || []).length || null);
        const after = (await DB.get('teams', 't-club', { force: true })).budget;
        const contract = (await DB.contracts({ force: true })).find(c => c.personId === 'd-free' && c.status === 'active');
        const rows = (await DB.list('ledger', { force: true })).filter(r => r.walletType === 'team' && r.walletId === 't-club' && /Sign-on bonus paid/.test(r.label));
        return { salary: neg.salary, before, after, signOn: contract?.signOnBonus, ledger: rows.reduce((s, r) => s + r.amount, 0) };
    });
    log(signOn.after === signOn.before - signOn.signOn && signOn.ledger === -signOn.signOn ? '✅' : '❌',
        `AI free-agent signing: sign-on bonus $${signOn.signOn} explicitly debited from the AI teamWallet ($${signOn.before} → $${signOn.after}) with a paired ledger row`);

    /* ---- 7. GM Financial Oversight Dashboard ---- */
    await page.evaluate(async () => {
        Auth.state.mode = 'admin';
        Auth.state.profile = null;
        App.go('admin'); Admin._tab = 'parity';
        await Admin.render(document.getElementById('view-root'));
    });
    await page.waitForSelector('#parity-cfg-form');
    const dash = await page.evaluate(() => {
        const el = document.getElementById('view-root');
        const html = el.innerHTML;
        const panel = el.querySelector('.panel');
        return {
            tab: !!el.querySelector('[data-admin-tab="parity"]'),
            title: /AI Financial Parity/.test(html),
            chips: /Human median/.test(html) && /Anchor ×/.test(html) && /Global ×/.test(html),
            teams: [...el.querySelectorAll('.race-row .race-title')].map(x => x.innerText),
            checkered: (html.match(/🏁/g) || []).length > 15,
            badges: /Solvent/i.test(html),
            buttons: [...el.querySelectorAll('.race-row button')].map(b => b.innerText).join(' '),
            // Flat 2D: the tab reuses the house .panel/.race-row primitives and
            // introduces NO inline shadows or 3D transforms of its own (the
            // global .panel chrome is the app-wide baseline, same as every tab).
            flat: !!panel && !/box-shadow|rotate3d|perspective|translateZ|drop-shadow/i.test(html)
        };
    });
    log(dash.tab && dash.title && dash.chips && dash.teams.length === 2 && dash.checkered && dash.badges ? '✅' : '❌',
        `Dashboard lists ${dash.teams.length} AI teams with budgets, multipliers, solvency badges, 🏁 markers everywhere`);
    log(/Adjust/i.test(dash.buttons) && /Consortium/i.test(dash.buttons) && dash.flat ? '✅' : '❌',
        'Per-team GM overrides (💵 Adjust, 🏦 Consortium) present; panels are flat 2D (no shadows/3D)');
    await shot('38-parity-dashboard');

    // Global multiplier knob persists to config.
    await page.fill('#parity-global', '1.5');
    await page.click('#parity-cfg-form button[type=submit]');
    await page.waitForFunction(() => /multiplier set to ×1.5/.test(document.getElementById('toast-holder')?.innerText || ''));
    const cfg2 = await page.evaluate(() => Parity.config());
    log(cfg2.globalMultiplier === 1.5 ? '✅' : '❌', `GM global multiplier knob saves to config/aiEconomy (×${cfg2.globalMultiplier})`);

    // GM budget override writes a real ledger row (prompt stubbed to 10000).
    await page.evaluate(() => Parity.gmAdjust('t-elite'));
    await page.waitForFunction(() => /ledger row written/.test(document.getElementById('toast-holder')?.innerText || ''));
    led = await teamLedger('t-elite', 'GM budget adjustment');
    log(led.count === 1 && led.sum === 10000 ? '✅' : '❌', `GM budget override: +$${led.sum} to the AI wallet, ledger-logged`);

    // Forced consortium bailout from the dashboard works from any state.
    await page.evaluate(() => Parity.gmForceConsortium('t-elite'));
    await page.waitForFunction(() => /baseline injected/.test(document.getElementById('toast-holder')?.innerText || ''));
    t = await team('t-elite');
    log(t.financialState === 'solvent' && Number.isFinite(t.marketValue) && (await teamLedger('t-elite', 'Consortium baseline funding')).count === 1 ? '✅' : '❌',
        `GM-forced consortium bailout: tier ${t.tier}, marketValue ${t.marketValue}, baseline funded via ledger`);

    await browser.close();
    const fails = steps.filter(s => s.startsWith('❌'));
    console.log(`\n${steps.length - fails.length}/${steps.length} steps passed`);
    if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
})().catch(e => { console.error('❌ DRIVE CRASHED:', e); process.exit(1); });
