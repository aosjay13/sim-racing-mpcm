/* Drive the contract-negotiation economy through the real UI on the shim:
   NPC hire with counter-offers + prestige pay caps, player-vs-player
   negotiation with messages (team owner ⇄ driver), signing bonus + ledger,
   multi-team non-exclusive contracts + exclusivity blocking, sponsor player
   deals, race-day settlement (salaries, sponsorships, commission, venue fee),
   Team Management tab, driver garage buy/sell. */
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
    const shot = async (n) => { await page.waitForTimeout(800); await page.screenshot({ path: path.join(__dirname, n + '.png') }); };

    const registerPlayer = async (name, email, role) => {
        await page.evaluate(() => Modal.close());
        if (await page.locator('#app-shell:not(.hidden)').count()) await page.click('#signout-btn');
        await page.waitForSelector('#auth-gate:not(.hidden)');
        await page.click('.gate-tab[data-pane="player"]');
        if (await page.locator('#gate-name-field.hidden').count()) await page.click('#gate-mode-toggle');
        await page.fill('#gate-name', name);
        await page.fill('#gate-email', email);
        await page.fill('#gate-password', 'secret1');
        await page.click('#gate-player-submit');
        await page.waitForSelector('#app-shell:not(.hidden)');
        await page.waitForSelector('.modal-card .role-card');
        await page.click('.modal-card .role-card:has-text("Semi-Pro")'); // $75,000
        await toast(/starting budget/);
        await page.waitForSelector('.role-grid .role-card');
        await page.click(`.role-card:has(.role-name:text-is("${role}"))`);
        await toast(/now playing as/);
    };
    const signIn = async (email) => {
        await page.evaluate(() => Modal.close());
        await page.click('#signout-btn');
        await page.waitForSelector('#auth-gate:not(.hidden)');
        await page.click('.gate-tab[data-pane="player"]');
        if (!(await page.locator('#gate-name-field.hidden').count())) await page.click('#gate-mode-toggle');
        await page.fill('#gate-email', email);
        await page.fill('#gate-password', 'secret1');
        await page.click('#gate-player-submit');
        await page.waitForSelector('#app-shell:not(.hidden)');
    };
    const balances = () => page.evaluate(async () => {
        const users = await DB.users({ force: true });
        return Object.fromEntries(users.map(u => [u.displayName, Number(u.balance)]));
    });

    await page.goto('http://localhost:8317/sim-racing-career/app.html');

    /* ---- 1. Bob: player DRIVER ---- */
    await page.click('.gate-tab[data-pane="admin"]'); // land the gate in a known state
    await page.click('.gate-tab[data-pane="player"]');
    await registerPlayer('Bob', 'bob@example.com', 'Driver');
    await page.click('.onboard-card:has-text("Start from scratch")');
    await page.fill('#ob-name', 'Bob Racer');
    await page.fill('#ob-number', '7');
    await page.click('#ob-driver-form button[type=submit]');
    await toast(/Welcome to the grid/);
    log('✅', 'Bob registered as driver "Bob Racer" ($75,000)');

    /* ---- 2. Alice: TEAM OWNER founds Alpha Racing, hires an NPC with counters + cap ---- */
    await registerPlayer('Alice', 'alice@example.com', 'Team Owner');
    await page.click('.onboard-card:has-text("Found a new team")');
    await page.fill('#tf-name', 'Alpha Racing');
    await page.click('#team-form button[type=submit]');
    await toast(/Team founded/);
    const ids = await page.evaluate(async () => {
        const team = (await DB.teams({ force: true })).find(t => t.name === 'Alpha Racing');
        const npcId = await DB.create('drivers', {
            name: 'Npc Speed', rating: 70, isNPC: true, teamId: null, ownerUid: null,
            status: 'approved', askingSalary: driverAskingSalary(70)
        });
        const bob = (await DB.drivers({ force: true })).find(d => d.name === 'Bob Racer');
        return { teamA: team.id, npcId, bobId: bob.id, bobUid: bob.ownerUid };
    });
    // NPC negotiation: asking $900, min-accept 85% = $770, 1★ cap $2,000.
    await page.evaluate(({ npcId, teamA }) => Market.negotiate('driver', npcId, teamA), ids);
    await page.waitForSelector('#offer-form');
    const capAttr = await page.evaluate(() => document.getElementById('offer-salary').max);
    log(capAttr === '2000' ? '✅' : '❌', `Hire form enforces 1★ prestige cap via max attr ($${capAttr})`);
    await page.fill('#offer-salary', '700'); // lowball
    await page.click('#offer-form button[type=submit]');
    const counterMsg = await page.evaluate(() => document.getElementById('offer-error').textContent);
    log(/counters/.test(counterMsg) && /770/.test(counterMsg) ? '✅' : '❌', 'NPC counters a lowball: ' + counterMsg.slice(0, 80));
    await page.click('#offer-form button[type=submit]'); // accept the counter (input was set to 770)
    log('✅', 'NPC counter accepted: ' + (await toast(/signed for/)));
    let bal = await balances();
    log(bal.Alice === 75000 - 770 ? '✅' : '❌', `Alice paid the $770 signing bonus (balance ${bal.Alice})`);

    /* ---- 3. Alice opens a P2P negotiation with Bob (non-exclusive + note) ---- */
    await page.evaluate(() => App.go('hub', 'recruitment'));
    await page.waitForSelector('#hub-body .panel');
    const hubText = await page.evaluate(() => document.getElementById('hub-body').innerText);
    log(/Bob Racer/.test(hubText) && /Prestige pay cap/i.test(hubText) ? '✅' : '❌', 'Hub lists Bob as signable + shows pay-cap contract rules');
    await page.click('#hub-body .race-row:has-text("Bob Racer") button:has-text("Negotiate")');
    await page.waitForSelector('#hub-offer-form');
    await page.fill('#ho-salary', '800');
    await page.uncheck('#ho-exclusive');
    await page.fill('#ho-note', 'Come drive our second car — podium bonuses next season.');
    await page.click('#hub-offer-form button[type=submit]');
    log('✅', 'Offer → negotiation: ' + (await toast(/Negotiation opened/)));

    /* ---- 4. Bob: sees the deal, cap blocks $5,000, counters $1,200 with a message ---- */
    await signIn('bob@example.com');
    await page.evaluate(() => App.go('career'));
    await page.waitForSelector('#view-root .panel');
    const wsText = await page.evaluate(() => document.getElementById('view-root').innerText);
    log(/My Deals/i.test(wsText) && /Your move/i.test(wsText) ? '✅' : '❌', 'Driver workspace Deals panel shows the negotiation, "Your move"');
    log(/My Garage/i.test(wsText) && /My Contracts/i.test(wsText) && /Earnings/i.test(wsText) ? '✅' : '❌', 'Driver workspace has Garage + Contracts + Earnings panels');
    const negId = await page.evaluate(async () =>
        (await DB.list('negotiations', { force: true })).find(n => n.status === 'open').id);
    await page.evaluate((id) => Deals.room(id), negId);
    await page.waitForSelector('#deal-act');
    const roomText = await page.evaluate(() => document.querySelector('.modal-card').innerText);
    log(/podium bonuses next season/.test(roomText) ? '✅' : '❌', "Alice's message visible in the deal room thread");
    log(/Non-exclusive/i.test(roomText) ? '✅' : '❌', 'Deal room shows the non-exclusive clause');
    await page.fill('#deal-salary', '5000'); // above Bob's 1★ cap
    await page.fill('#deal-note', 'I want superstar money.');
    await page.click('#deal-act button[type=submit]');
    const capErr = await page.evaluate(() => document.getElementById('deal-error').textContent);
    log(/capped at \$2,000/.test(capErr) ? '✅' : '❌', 'Prestige cap blocks a $5,000 counter: ' + capErr.slice(0, 90));
    await page.fill('#deal-salary', '1200');
    await page.fill('#deal-note', 'Meet me at $1,200 and I sign today.');
    await page.click('#deal-act button[type=submit]');
    await toast(/Counter sent/);
    log('✅', 'Bob countered $1,200 with a message');
    await shot('17-deal-room');

    /* ---- 5. Alice accepts → contract + signing bonus both ways ---- */
    await signIn('alice@example.com');
    await page.evaluate((id) => Deals.room(id), negId);
    await page.waitForSelector('#deal-accept');
    const roomAlice = await page.evaluate(() => document.querySelector('.modal-card').innerText);
    log(/Meet me at \$1,200/.test(roomAlice) ? '✅' : '❌', "Bob's counter-message visible on Alice's side");
    await page.click('#deal-accept');
    await toast(/Contract signed/);
    const signed = await page.evaluate(async ({ bobId, teamA }) => {
        const c = (await DB.contracts({ force: true })).find(c => c.personId === bobId && c.status === 'active');
        const d = await DB.get('drivers', bobId);
        return { salary: c?.salary, exclusive: c?.exclusive, teamOk: d.teamId === teamA };
    }, ids);
    log(signed.salary === 1200 && signed.exclusive === false && signed.teamOk ? '✅' : '❌',
        `Contract executed: $${signed.salary}/race, non-exclusive, Bob's primary team = Alpha`);
    bal = await balances();
    log(bal.Alice === 74230 - 1200 && bal.Bob === 75000 + 1200 ? '✅' : '❌',
        `Signing bonus moved between players (Alice ${bal.Alice}, Bob ${bal.Bob})`);

    /* ---- 6. Carol founds Bravo Motors → multi-team second contract for Bob ---- */
    await registerPlayer('Carol', 'carol@example.com', 'Team Owner');
    await page.click('.onboard-card:has-text("Found a new team")');
    await page.fill('#tf-name', 'Bravo Motors');
    await page.click('#team-form button[type=submit]');
    await toast(/Team founded/);
    const teamB = await page.evaluate(async () => (await DB.teams({ force: true })).find(t => t.name === 'Bravo Motors').id);
    // Exclusive offer must be blocked (Bob already has a team contract).
    const exclusiveErr = await page.evaluate(async ({ bobId, bobUid, teamB }) => {
        try {
            await Deals.start({ kind: 'team-driver', teamId: teamB, teamName: 'Bravo Motors', ownerUid: Auth.uid(),
                personId: bobId, personKind: 'driver', personName: 'Bob Racer', personUid: bobUid, salary: 600, exclusive: true });
            return 'NOT BLOCKED';
        } catch (e) { return e.message; }
    }, { ...ids, teamB });
    log(/exclusive contract requires no other/i.test(exclusiveErr) ? '✅' : '❌', 'Exclusive offer blocked by existing contract: ' + exclusiveErr.slice(0, 80));
    await page.evaluate(({ bobId, teamB }) => Hub.offerForm(bobId, teamB), { bobId: ids.bobId, teamB });
    await page.waitForSelector('#hub-offer-form');
    await page.fill('#ho-salary', '600');
    await page.uncheck('#ho-exclusive');
    await page.click('#hub-offer-form button[type=submit]');
    await toast(/Negotiation opened/);
    const negId2 = await page.evaluate(async () =>
        (await DB.list('negotiations', { force: true })).find(n => n.status === 'open' && n.teamName === 'Bravo Motors').id);
    // Bob accepts the second seat.
    await signIn('bob@example.com');
    await page.evaluate((id) => Deals.room(id), negId2);
    await page.waitForSelector('#deal-accept');
    await page.click('#deal-accept');
    await toast(/Contract signed/);
    const multi = await page.evaluate(async ({ bobId, teamA }) => {
        const cs = (await DB.contracts({ force: true })).filter(c => c.personId === bobId && c.status === 'active');
        const d = await DB.get('drivers', bobId);
        return { count: cs.length, primaryStillAlpha: d.teamId === teamA };
    }, ids);
    log(multi.count === 2 && multi.primaryStillAlpha ? '✅' : '❌',
        `Multi-team: Bob holds ${multi.count} active contracts, primary team unchanged (Alpha)`);
    const bobWs = await page.evaluate(async () => { await App.go('career'); return document.getElementById('view-root').innerText; });
    log(/My Contracts \(2\)/i.test(bobWs) && /Join another team/i.test(bobWs) ? '✅' : '❌',
        'Driver page lists both contracts + offers "Join another team" (all non-exclusive)');

    /* ---- 7. Dave: SPONSOR player — capped offers, deal with Alice's team ---- */
    await registerPlayer('Dave', 'dave@example.com', 'Sponsor');
    await page.click('button:has-text("Create Sponsor Profile")');
    await page.waitForSelector('#role-profile-form');
    await page.fill('#rp-name', 'MegaFuel');
    await page.click('#role-profile-form button[type=submit]');
    await toast(/Profile saved/);
    const daveIds = await page.evaluate(async ({ bobId }) => {
        const profiles = await DB.roleProfiles({ force: true });
        const sponsor = profiles.find(p => p.uid === Auth.uid() && p.role === 'sponsor');
        // Same player also moonlights as Bob's agent and owns the venue (for settlement fees).
        await DB.create('roleProfiles', { uid: Auth.uid(), role: 'agent', name: 'Dave Deals', prestige: 1, clientDriverIds: [bobId] });
        await DB.create('roleProfiles', { uid: Auth.uid(), role: 'track-owner', name: 'Dave Venues', prestige: 1, tracks: ['Test Ring'] });
        return { sponsorProfileId: sponsor.id, daveUid: Auth.uid() };
    }, ids);
    const sponsorCapErr = await page.evaluate(async ({ sponsorProfileId, teamA }) => {
        try {
            const team = await DB.get('teams', teamA);
            await Deals.start({ kind: 'sponsorship', sponsorProfileId, sponsorName: 'MegaFuel', sponsorUid: Auth.uid(),
                teamId: teamA, teamName: team.name, ownerUid: team.ownerUid, salary: 5000 });
            return 'NOT BLOCKED';
        } catch (e) { return e.message; }
    }, { sponsorProfileId: daveIds.sponsorProfileId, teamA: ids.teamA });
    log(/capped at \$2,000/.test(sponsorCapErr) ? '✅' : '❌', "Sponsor spend capped by the SPONSOR's prestige: " + sponsorCapErr.slice(0, 80));
    await page.evaluate((id) => Deals.sponsorOfferForm(id), daveIds.sponsorProfileId);
    await page.waitForSelector('#spo-form');
    await page.selectOption('#spo-team', ids.teamA);
    await page.fill('#spo-pay', '500');
    await page.fill('#spo-note', 'MegaFuel on the sidepods, $500 a race.');
    await page.click('#spo-form button[type=submit]');
    log('✅', 'Sponsorship offer sent to player team: ' + (await toast(/Offer sent/)));

    /* ---- 8. Alice accepts the sponsorship in the deal room ---- */
    await signIn('alice@example.com');
    const negId3 = await page.evaluate(async () =>
        (await DB.list('negotiations', { force: true })).find(n => n.status === 'open' && n.kind === 'sponsorship').id);
    await page.evaluate((id) => Deals.room(id), negId3);
    await page.waitForSelector('#deal-accept');
    await page.click('#deal-accept');
    await toast(/Sponsorship live/);
    const spon = await page.evaluate(async () =>
        (await DB.contracts({ force: true })).find(c => c.type === 'sponsorship' && c.status === 'active'));
    log(spon && spon.salary === 500 && spon.sponsorName === 'MegaFuel' ? '✅' : '❌',
        `Sponsorship contract active: MegaFuel → Alpha Racing at $${spon?.salary}/race`);

    /* ---- 9. Race-day settlement: salaries, sponsorship, commission, venue fee ---- */
    const before = await balances();
    await page.evaluate(async ({ bobId, npcId }) => {
        const world = await DB.loadWorld(true);
        const race = { id: 'settlement-gp', name: 'Settlement GP', track: 'Test Ring', seriesId: 'none',
            results: [{ driverId: bobId, position: 1, dnf: false }, { driverId: npcId, position: 2, dnf: false }] };
        await Sim.payoutRace(race, world);
    }, ids);
    const after = await balances();
    // Expected deltas:
    //  Bob:  +5000 prize +1200 Alpha salary +600 Bravo salary                    = +6800
    //  Alice:+2500 P1 team share +1750 P2 team share +500 sponsorship
    //        −1200 (Bob) −770 (NPC) payroll                                      = +2780
    //  Carol: −600 (Bob's Bravo salary)                                          = −600
    //  Dave:  −500 sponsorship +120 agent commission (10% of $1,200) +140 venue  = −240
    const delta = (n) => after[n] - before[n];
    log(delta('Bob') === 6800 ? '✅' : '❌', `Bob settlement: prize + BOTH team salaries = +$${delta('Bob')} (expected +$6,800)`);
    log(delta('Alice') === 2780 ? '✅' : '❌', `Alice settlement: team shares + sponsorship − payroll = +$${delta('Alice')} (expected +$2,780)`);
    log(delta('Carol') === -600 ? '✅' : '❌', `Carol settlement: payroll for Bob's second seat = $${delta('Carol')} (expected −$600)`);
    log(delta('Dave') === -240 ? '✅' : '❌', `Dave settlement: −sponsorship +10% agent commission +venue fee = $${delta('Dave')} (expected −$240)`);
    const ledger = await page.evaluate(async () => (await DB.list('ledger', { force: true })).map(t => t.label));
    const ledgerHas = (re) => ledger.some(l => re.test(l));
    log(ledgerHas(/Payroll: Bob Racer/) && ledgerHas(/Salary from Alpha Racing/) && ledgerHas(/Agent commission/) &&
        ledgerHas(/Hosting fee: Test Ring/) && ledgerHas(/Sponsorship from MegaFuel/) ? '✅' : '❌',
        `Ledger tracks every payment type (${ledger.length} entries)`);

    /* ---- 10. Team Management tab: payroll with caps, sponsorships, finances ---- */
    await page.evaluate(() => App.go('career'));
    await page.waitForSelector('[data-owner-tab="manage"]');
    await page.click('[data-owner-tab="manage"]');
    await page.waitForSelector('#view-root .panel');
    const manage = await page.evaluate(() => document.getElementById('view-root').innerText);
    const manageChecks = [
        ['Payroll panel with both hires', /PAYROLL/i.test(manage) && /Npc Speed/.test(manage) && /Bob Racer/.test(manage)],
        ['prestige caps shown per contract', /\(cap \$2,000\)/.test(manage)],
        ['multi-team chip on Bob\'s contract', /Multi-team/i.test(manage)],
        ['sponsorships panel with MegaFuel deal', /MegaFuel/.test(manage) && /Player deal/i.test(manage)],
        ['finances ledger panel', /Team Finances/i.test(manage) && /Payroll: Bob Racer/.test(manage)],
        ['net-per-race stat', /Net \/ race/i.test(manage)]
    ];
    for (const [label, ok] of manageChecks) log(ok ? '✅' : '❌', `Team Management: ${label}`);
    await shot('18-team-management');

    /* ---- 11. Adjust pay: NPC renegotiation resolves instantly ---- */
    const npcContractId = await page.evaluate(async ({ npcId }) =>
        (await DB.contracts({ force: true })).find(c => c.personId === npcId && c.status === 'active').id, ids);
    await page.evaluate((id) => Deals.adjustPay(id), npcContractId);
    await page.waitForSelector('#adjust-form');
    await page.fill('#aj-salary', '900');
    await page.click('#adjust-form button[type=submit]');
    await toast(/accepted the new terms/);
    const npcSalary = await page.evaluate(async (id) => (await DB.get('contracts', id)).salary, npcContractId);
    log(npcSalary === 900 ? '✅' : '❌', `Adjust pay: NPC accepted the raise instantly ($${npcSalary}/race)`);

    /* ---- 12. Bob: garage — buy and sell a car at the Dealership ---- */
    await signIn('bob@example.com');
    await page.evaluate(() => App.go('dealership'));
    await page.waitForSelector('.car-card');
    await page.click('.car-card:has-text("Barn-Find") button:has-text("Buy")');
    await toast(/is yours/);
    await page.evaluate(() => App.go('career'));
    await page.waitForSelector('#view-root .panel');
    const garageText = await page.evaluate(() => document.getElementById('view-root').innerText);
    log(/My Garage \(1\)/i.test(garageText) && /Barn-Find/.test(garageText) ? '✅' : '❌', "Driver page garage shows Bob's new car");
    log(/Salary from Alpha Racing/.test(garageText) && /Prize money/.test(garageText) ? '✅' : '❌', 'Driver page Earnings panel shows race income');
    await shot('19-driver-page');
    await page.click('#view-root button:has-text("Sell")');
    await toast(/Sold the/);
    bal = await balances();
    log(bal.Bob === before.Bob + 6800 - 3200 + 1920 ? '✅' : '❌', `Garage sell-back at 60% (Bob ${bal.Bob})`);

    console.log('\n=== STEPS ===\n' + steps.join('\n'));
    await browser.close();
    process.exit(steps.some(s => s.startsWith('❌')) ? 1 : 0);
})().catch(e => { console.error('DRIVER CRASH:', e); process.exit(2); });
