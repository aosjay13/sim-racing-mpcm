/* Drive the Immersive Crew Chief & Mechanic system (js/srmpc-crew.js):
   Crew.calculateMechanicBuff paradigms (direct vs AI-difficulty offset),
   crew event registration (crewSignups, lock-in rules), the Crew Chief
   Pre-Race Pit Wall dashboard writing races.crewChiefNotes, the driver's
   pit-wall briefing in the race modal, the mechanic upgrades panel, and
   race-day settlement freezing crewLog + modifier-justified ledger rows. */
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

    const gmSignIn = async () => {
        await page.waitForSelector('#auth-gate:not(.hidden), #app-shell:not(.hidden)');
        await page.evaluate(() => window.Modal && Modal.close());
        if (await page.locator('#app-shell:not(.hidden)').count()) await page.click('#signout-btn');
        await page.waitForSelector('#auth-gate:not(.hidden)');
        await page.click('.gate-tab[data-pane="admin"]');
        await page.fill('#gate-passcode', 'phoenix13!');
        await page.click('#gate-admin-submit');
        await page.waitForSelector('#app-shell:not(.hidden)');
    };
    const actAs = (uid, extra = {}) => page.evaluate(async ({ uid, extra }) => {
        Auth.state.profile = { ...(await DB.get('users', uid, { force: true })), ...extra };
        Auth.state.user = { uid, isAnonymous: false };
        Auth.state.mode = 'player';
    }, { uid, extra });

    await page.goto('http://localhost:8317/sim-racing-career/app.html');
    await gmSignIn();

    /* ---- 1. calculateMechanicBuff: both paradigms, all inputs ---- */
    const buffs = await page.evaluate(() => ({
        ir3: Crew.calculateMechanicBuff(3, 'iRacing'),
        nr2: Crew.calculateMechanicBuff(2, 'NASCAR Racing 2003 Season'),
        wf5: Crew.calculateMechanicBuff(5, 'Wreckfest'),
        gt1: Crew.calculateMechanicBuff(1, 'Gran Turismo 7'),
        ams: Crew.calculateMechanicBuff(4, 'Automobilista 2'),
        beam: Crew.calculateMechanicBuff(2, 'BeamNG.drive'),
        unknown: Crew.calculateMechanicBuff(9, 'Some Future Title'), // level clamps to 5
        none: Crew.calculateMechanicBuff(0, null)                    // clamps to 1, default paradigm
    }));
    log(buffs.ir3.paradigm === 'difficulty' && buffs.ir3.aiDifficultyOffsetPct === -3
        && buffs.nr2.paradigm === 'difficulty' && buffs.nr2.aiDifficultyOffsetPct === -2 ? '✅' : '❌',
        `Sim paradigm: iRacing L3 → ${buffs.ir3.aiDifficultyOffsetPct}% AI, NR2003 L2 → ${buffs.nr2.aiDifficultyOffsetPct}% AI (legal local offset)`);
    log(buffs.wf5.paradigm === 'direct' && buffs.wf5.performanceBuffPct === 5 && buffs.wf5.repairEfficiencyPct === 20
        && buffs.gt1.performanceBuffPct === 1 && buffs.ams.paradigm === 'direct' && buffs.beam.paradigm === 'direct' ? '✅' : '❌',
        `Direct paradigm: Wreckfest L5 → +5%/+20%, GT7 L1 → +1%/+4%, AMS2 & BeamNG direct`);
    log(buffs.unknown.paradigm === 'direct' && buffs.unknown.level === 5
        && buffs.none.level === 1 && buffs.none.paradigm === 'direct' ? '✅' : '❌',
        `Robustness: level clamps 1–5, unknown/missing titles default to direct`);

    /* ---- 2. Seed a two-paradigm world ---- */
    await page.evaluate(async () => {
        const db = SRMPC.db;
        await db.collection('games').doc('g-gt').set({ name: 'Gran Turismo 7' });
        await db.collection('games').doc('g-ir').set({ name: 'iRacing' });
        await db.collection('series').doc('s-gt').set({ name: 'GT Cup', gameId: 'g-gt', status: 'active', pointsSystem: 'f1' });
        await db.collection('series').doc('s-ir').set({ name: 'Sim Masters', gameId: 'g-ir', status: 'active', pointsSystem: 'f1' });
        await db.collection('races').doc('r-gt').set({ seriesId: 's-gt', gameId: 'g-gt', name: 'GT Cup — Round 1', track: 'Monza', date: '2030-01-01', status: 'scheduled', results: [] });
        await db.collection('races').doc('r-ir').set({ seriesId: 's-ir', gameId: 'g-ir', name: 'Sim Masters — Round 1', track: 'Daytona', date: '2030-01-02', status: 'scheduled', results: [] });
        await db.collection('teams').doc('t-apex').set({ name: 'Apex Racing', ownerUid: 'u-owner', budget: 50000, seriesId: 's-gt' });
        await db.collection('users').doc('u-owner').set({ displayName: 'Olive Owner', balance: 10000, walletInitialized: true });
        // Two drivers on the team, one independent client driver.
        await db.collection('users').doc('u-dan').set({ displayName: 'Dan', balance: 1000, walletInitialized: true, driverId: 'd-dan', activeRole: 'driver' });
        await db.collection('drivers').doc('d-dan').set({ name: 'Dan Apex', ownerUid: 'u-dan', teamId: 't-apex' });
        await db.collection('drivers').doc('d-ai').set({ name: 'AI Teammate', teamId: 't-apex', isNPC: true });
        // Chloe: crew chief with Dan in her book (3★ Front Runner).
        await db.collection('users').doc('u-chloe').set({ displayName: 'Chloe', balance: 500, walletInitialized: true, activeRole: 'crew-chief' });
        await db.collection('roleProfiles').doc('rp-chloe').set({ uid: 'u-chloe', role: 'crew-chief', name: 'Chloe Callbox', prestige: 3, clientDriverIds: ['d-dan'] });
        // Max: mechanic wrenching for Apex (3★). Nia: unattached mechanic.
        await db.collection('users').doc('u-max').set({ displayName: 'Max', balance: 500, walletInitialized: true, activeRole: 'mechanic' });
        await db.collection('roleProfiles').doc('rp-max').set({ uid: 'u-max', role: 'mechanic', name: 'Max Torque', prestige: 3, teamId: 't-apex' });
        await db.collection('users').doc('u-nia').set({ displayName: 'Nia', balance: 500, walletInitialized: true, activeRole: 'mechanic' });
        await db.collection('roleProfiles').doc('rp-nia').set({ uid: 'u-nia', role: 'mechanic', name: 'Nia Nofit', prestige: 2, teamId: null });
        // Dan is entered in the GT race.
        await db.collection('raceSignups').doc('su-dan').set({ raceId: 'r-gt', uid: 'u-dan', driverId: 'd-dan' });
        DB.invalidate();
    });
    log('✅', 'Seeded: GT7 + iRacing worlds, team, drivers, crew chief (3★), mechanics (attached + unattached)');

    /* ---- 3. Lock-in: unattached mechanic can't register ---- */
    await actAs('u-nia');
    await page.evaluate(() => Crew.toggleCrewSignup('r-gt', 'mechanic'));
    await page.waitForFunction(() => /join a team first/i.test(document.getElementById('toast-holder')?.innerText || ''));
    const niaSignups = await page.evaluate(async () => (await Crew.signups('r-gt')).length);
    log(niaSignups === 0 ? '✅' : '❌', 'Lock-in: unattached mechanic is refused registration ("join a team first")');
    await page.evaluate(() => { document.getElementById('toast-holder').innerHTML = ''; });

    /* ---- 4. Mechanic registers via the race modal (direct-paradigm game) ---- */
    await actAs('u-max');
    await page.evaluate(() => Views.showRace('r-gt'));
    await page.waitForSelector('.modal-card');
    const joinBtn = page.locator('.modal-card button', { hasText: /join as mechanic/i });
    log(await joinBtn.count() === 1 ? '✅' : '❌', 'Race modal offers "Join as Mechanic" to the mechanic role');
    await joinBtn.click();
    await page.waitForFunction(() => /prestige buff is locked in/i.test(document.getElementById('toast-holder')?.innerText || ''));
    const maxSignup = await page.evaluate(async () => (await Crew.signups('r-gt')).find(s => s.uid === 'u-max'));
    log(maxSignup && maxSignup.role === 'mechanic' && maxSignup.teamId === 't-apex'
        && maxSignup.buff?.paradigm === 'direct' && maxSignup.buff.performanceBuffPct === 3 && maxSignup.buff.repairEfficiencyPct === 12 ? '✅' : '❌',
        `Mechanic signup doc carries the frozen buff: ${maxSignup?.buff?.summary}`);
    await page.evaluate(() => { document.getElementById('toast-holder').innerHTML = ''; Modal.close(); });

    /* ---- 4b. Same mechanic on the iRacing race → difficulty paradigm ---- */
    const irBuff = await page.evaluate(async () => {
        await Crew.toggleCrewSignup('r-ir', 'mechanic');
        await new Promise(r => setTimeout(r, 150));
        Modal.close();
        return (await Crew.signups('r-ir')).find(s => s.uid === 'u-max')?.buff;
    });
    log(irBuff?.paradigm === 'difficulty' && irBuff.aiDifficultyOffsetPct === -3 ? '✅' : '❌',
        `Same 3★ mechanic on the iRacing event locks a ${irBuff?.aiDifficultyOffsetPct}% AI-difficulty offset instead`);
    await page.evaluate(() => { document.getElementById('toast-holder').innerHTML = ''; });

    /* ---- 5. Mechanic workspace: upgrades panel, tier ladder, flag bullets ---- */
    const mechPanel = await page.evaluate(async () => {
        const el = document.createElement('div');
        await Career.genericWorkspace(el, 'mechanic');
        return el.innerHTML;
    });
    log(/Mechanic Upgrades/.test(mechPanel) && /crew-flag-list/.test(mechPanel)
        && /Your locked-in buff/.test(mechPanel) && /\+3% car performance/.test(mechPanel)
        && (mechPanel.match(/crew-tiers/g) || []).length === 1 && /Legend/.test(mechPanel) ? '✅' : '❌',
        'Mechanic workspace renders the flat Upgrades panel: 5-tier 🏁 ladder + current locked-in buff');

    /* ---- 6. Crew chief registers + Pre-Race Pit Wall dashboard ---- */
    await actAs('u-chloe');
    await page.evaluate(() => Crew.toggleCrewSignup('r-gt', 'crew-chief'));
    await page.waitForFunction(() => /pit wall/i.test(document.getElementById('toast-holder')?.innerText || ''));
    await page.evaluate(() => { document.getElementById('toast-holder').innerHTML = ''; Modal.close(); });
    await page.evaluate(() => Crew.chiefDashboard('r-gt'));
    await page.waitForSelector('.crew-card');
    const dashInfo = await page.evaluate(() => ({
        drivers: [...document.querySelectorAll('.crew-card')].map(c => c.dataset.driver),
        checks: document.querySelectorAll('.crew-card [data-check]').length,
        flags: document.querySelectorAll('.modal-card .crew-flag').length
    }));
    log(JSON.stringify(dashInfo.drivers) === JSON.stringify(['d-dan']) && dashInfo.checks === 4 && dashInfo.flags >= 1 ? '✅' : '❌',
        `Pit Wall dashboard: one briefing card per ENTERED client (d-dan), 4-item 🏁 strategy checklist`);

    await page.fill('.crew-card [data-note="setup"]', 'Low wing, soft fronts, 27psi');
    await page.fill('.crew-card [data-note="strategy"]', 'One-stop, box lap 14, undercut the leader');
    await page.fill('.crew-card [data-note="telemetry"]', 'Brake 10m later into T1; you lose 0.2s in S2');
    await page.check('.crew-card [data-check="0"]');
    await page.check('.crew-card [data-check="1"]');
    await page.click('#crew-transmit');
    await page.waitForFunction(() => /strategy transmitted/i.test(document.getElementById('toast-holder')?.innerText || ''));
    const notes = await page.evaluate(async () => (await DB.get('races', 'r-gt', { force: true })).crewChiefNotes);
    log(notes?.['d-dan']?.chiefUid === 'u-chloe' && /box lap 14/.test(notes['d-dan'].strategy)
        && notes['d-dan'].checklist.filter(c => c.done).length === 2 ? '✅' : '❌',
        'Transmit writes races.crewChiefNotes keyed to the driver entry (setup/strategy/telemetry + checklist)');
    await page.evaluate(() => { document.getElementById('toast-holder').innerHTML = ''; });

    /* ---- 7. Driver sees the briefing on their race screen ---- */
    await actAs('u-dan', { driverId: 'd-dan' });
    await page.evaluate(() => Views.showRace('r-gt'));
    await page.waitForSelector('.crew-pitwall');
    const pitwall = await page.evaluate(() => document.querySelector('.modal-card').innerText);
    log(/Chloe Callbox/.test(pitwall) && /box lap 14/i.test(pitwall) && /brake 10m later/i.test(pitwall)
        && /2\/4 checks/.test(pitwall) && /Pit Lane \(2\)/i.test(pitwall) ? '✅' : '❌',
        'Driver race modal shows the Pit Wall briefing (chief, strategy, telemetry, checks) + pit-lane entries');
    await page.evaluate(() => Modal.close());

    /* ---- 8. Race completes → settlement freezes crewLog + pays crew ---- */
    const settle = await page.evaluate(async () => {
        const results = [
            { driverId: 'd-dan', position: 1, dnf: false, pole: true, fastestLap: false, incidents: 0, lapsLed: 10, lapsCompleted: 20 },
            { driverId: 'd-ai', position: 2, dnf: false, pole: false, fastestLap: true, incidents: 1, lapsLed: 0, lapsCompleted: 20 }
        ];
        await DB.update('races', 'r-gt', { status: 'completed', results });
        const world = await DB.loadWorld(true);
        const race = world.races.find(r => r.id === 'r-gt');
        await Sim.payoutRace(race, world);
        const after = await DB.get('races', 'r-gt', { force: true });
        const ledger = await DB.list('ledger', { force: true });
        return {
            crewLog: after.crewLog,
            team: await DB.get('teams', 't-apex', { force: true }),
            maxRows: ledger.filter(l => l.uid === 'u-max'),
            chloeRows: ledger.filter(l => l.uid === 'u-chloe'),
            niaRows: ledger.filter(l => l.uid === 'u-nia')
        };
    });
    const mechLog = settle.crewLog?.find(l => l.role === 'mechanic');
    const chiefLog = settle.crewLog?.find(l => l.role === 'crew-chief');
    log(settle.crewLog?.length === 2 && mechLog?.modifier?.performanceBuffPct === 3
        && chiefLog?.notes?.['d-dan'] && /briefing transmitted to 1 driver/.test(chiefLog.applied) ? '✅' : '❌',
        'Post-race crewLog frozen on the race doc: mechanic modifier payload + crew chief inputs');
    log(settle.team?.mechanicBuff?.raceId === 'r-gt' && settle.team.mechanicBuff.repairEfficiencyPct === 12 ? '✅' : '❌',
        'Direct-paradigm buff persisted onto the car-owning team doc (teams.mechanicBuff)');
    const maxPay = settle.maxRows.find(r => /mechanic race-day payout/i.test(r.label));
    const chloePay = settle.chloeRows.find(r => /crew chief race-day payout/i.test(r.label));
    log(maxPay?.amount === 175 && /\+3% car performance/.test(maxPay.label)
        && chloePay?.amount === 175 && /briefing transmitted/.test(chloePay.label)
        && settle.niaRows.length === 0 ? '✅' : '❌',
        `Ledger justifies pay with the applied modifier: Max +${maxPay?.amount} "${(maxPay?.label || '').slice(0, 60)}…", Chloe +${chloePay?.amount}; unregistered Nia gets nothing`);

    /* ---- 9. Completed race modal shows the Crew Contributions log ---- */
    const doneModal = await page.evaluate(async () => {
        await Views.showRace('r-gt');
        await new Promise(r => setTimeout(r, 120));
        const t = document.querySelector('.modal-card').innerText;
        Modal.close();
        return t;
    });
    log(/crew contributions/i.test(doneModal) && /Max Torque/.test(doneModal) && /Chloe Callbox/.test(doneModal) ? '✅' : '❌',
        'Completed-race modal shows the frozen Crew Contributions log');

    /* ---- 10. Crew chief workspace: Pit Wall panel with dashboard shortcut ---- */
    await actAs('u-chloe');
    const chiefPanel = await page.evaluate(async () => {
        const el = document.createElement('div');
        await Career.genericWorkspace(el, 'crew-chief');
        return el.innerHTML;
    });
    log(/Pre-Race Pit Wall/.test(chiefPanel) && /crew-flag-list/.test(chiefPanel)
        && /Sim Masters — Round 1/.test(chiefPanel) ? '✅' : '❌',
        'Crew Chief workspace renders the Pit Wall panel (🏁 checklist + upcoming-event registration)');

    /* ---- 11. Withdraw crew entry ---- */
    await page.evaluate(() => Crew.toggleCrewSignup('r-ir', 'crew-chief'));
    await page.waitForFunction(() => /pit wall|contracted/i.test(document.getElementById('toast-holder')?.innerText || ''));
    await page.evaluate(() => { document.getElementById('toast-holder').innerHTML = ''; Modal.close(); });
    const withdrawn = await page.evaluate(async () => {
        await Crew.toggleCrewSignup('r-ir', 'crew-chief');
        await new Promise(r => setTimeout(r, 150));
        Modal.close();
        return (await Crew.signups('r-ir')).filter(s => s.uid === 'u-chloe').length;
    });
    log(withdrawn === 0 ? '✅' : '❌', 'Crew entries can be withdrawn (register → withdraw leaves no signup doc)');

    await page.screenshot({ path: '32-crew-system.png', fullPage: false });
    await browser.close();
    const fails = steps.filter(s => s.startsWith('❌')).length;
    console.log(`\n${steps.length - fails}/${steps.length} steps passed`);
    process.exit(fails ? 1 : 0);
})().catch(e => { console.error('DRIVE CRASHED:', e); process.exit(1); });
