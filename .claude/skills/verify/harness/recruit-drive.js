/* Drive the two-way recruitment system + deal-room UX + hub notification
   badge through the real UI on the shim:
   1) deal room: in-place updates after countering (no stale accept button),
      current-offer hero, latest-move highlight, live poll picks up the other
      side's moves, stale-accept guard refuses a moved deal,
   2) red notification badge on the League Hub nav (pending decisions +
      unseen answers), cleared by visiting the recruitment tab,
   3) recruitment profiles (per-role attributes) shown when scouting,
   4) job board: post a crew-chief vacancy → player applies with attributes →
      owner proposes terms → negotiation → contract signs, roleProfile joins
      the team, contract carries personUid for payroll,
   5) scouting: owner filters free agents by role and opens a driver offer,
   6) polite rejection: declined application notifies the applicant. */
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
    const badge = () => page.evaluate(() => {
        const b = document.getElementById('hub-badge');
        return { hidden: b.classList.contains('hidden'), n: Number(b.textContent) || 0 };
    });

    const signOut = async () => {
        await page.evaluate(() => Modal.close());
        if (await page.locator('#app-shell:not(.hidden)').count()) await page.click('#signout-btn');
        await page.waitForSelector('#auth-gate:not(.hidden)');
    };
    const registerPlayer = async (name, email, role) => {
        await signOut();
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
        await signOut();
        await page.click('.gate-tab[data-pane="player"]');
        if (!(await page.locator('#gate-name-field.hidden').count())) await page.click('#gate-mode-toggle');
        await page.fill('#gate-email', email);
        await page.fill('#gate-password', 'secret1');
        await page.click('#gate-player-submit');
        await page.waitForSelector('#app-shell:not(.hidden)');
    };

    await page.goto('http://localhost:8317/sim-racing-career/app.html');
    await page.click('.gate-tab[data-pane="admin"]'); // settle the gate
    await page.click('.gate-tab[data-pane="player"]');

    /* ---- 1. Dana: team owner, founds Delta Works ---- */
    await registerPlayer('Dana', 'dana@example.com', 'Team Owner');
    await page.click('.onboard-card:has-text("Found a new team")');
    await page.fill('#tf-name', 'Delta Works');
    await page.click('#team-form button[type=submit]');
    await toast(/Team founded/);
    log('✅', 'Dana founded Delta Works');

    /* ---- 2. Eve: driver + recruitment profile (attributes) ---- */
    await registerPlayer('Eve', 'eve@example.com', 'Driver');
    await page.click('.onboard-card:has-text("Start from scratch")');
    await page.fill('#ob-name', 'Eve Quick');
    await page.click('#ob-driver-form button[type=submit]');
    await toast(/Welcome to the grid/);
    await page.click('#view-root button:has-text("Recruitment Profile")');
    await page.waitForSelector('#recruit-form');
    // Pace/safety are auto-tracked from race results now (0.5.8.1), not self-rated fields.
    await page.fill('#rc-disciplines', 'GT3, endurance');
    await page.fill('#rc-availability', 'Weeknights EU');
    await page.click('#recruit-form button[type=submit]');
    log('✅', 'Eve saved a driver recruitment profile: ' + (await toast(/Recruitment profile saved/i)));

    /* ---- 3. Frank: crew chief role profile + attributes ---- */
    await registerPlayer('Frank', 'frank@example.com', 'Crew Chief');
    await page.click('#view-root button:has-text("Create Crew Chief Profile")');
    await page.waitForSelector('#role-profile-form');
    await page.fill('#rp-name', 'Frank Wrench');
    await page.click('#role-profile-form button[type=submit]');
    await toast(/Profile saved/);
    await page.waitForSelector('#view-root button:has-text("Recruitment Profile")');
    await page.click('#view-root button:has-text("Recruitment Profile")');
    await page.waitForSelector('#recruit-form');
    await page.fill('#rc-strategy', '8');
    await page.fill('#rc-efficiency', '9');
    await page.fill('#rc-communication', 'Calm on the radio');
    await page.click('#recruit-form button[type=submit]');
    log('✅', 'Frank (Crew Chief) saved a recruitment profile: ' + (await toast(/Recruitment profile saved/i)));

    /* ---- 4. Dana posts a crew-chief vacancy on the job board ---- */
    await signIn('dana@example.com');
    await page.evaluate(() => App.go('hub', 'recruitment'));
    await page.waitForSelector('#hub-body .panel');
    await page.click('button:has-text("Post a Vacancy")');
    await page.waitForSelector('#vac-form');
    await page.selectOption('#vac-role', 'crew-chief');
    await page.fill('#vac-title', 'Seeking a Crew Chief for the endurance series');
    await page.fill('#vac-desc', 'Late-night stints, cool head required.');
    await page.fill('#vac-pay', '250');
    await page.click('#vac-form button[type=submit]');
    log('✅', 'Vacancy posted: ' + (await toast(/Vacancy posted/i)));

    /* ---- 5. Frank applies to the vacancy; Dana's nav badge lights up ---- */
    await signIn('frank@example.com');
    await page.evaluate(() => App.go('hub', 'recruitment'));
    await page.waitForSelector('#hub-body .panel');
    const board = await page.evaluate(() => document.getElementById('hub-body').innerText);
    log(/Seeking a Crew Chief/i.test(board) && /Delta Works/i.test(board) ? '✅' : '❌', 'Job board lists the vacancy with team + role');
    await page.click('#hub-body .race-row:has-text("Seeking a Crew Chief") button:has-text("Apply")');
    log('✅', 'Frank applied: ' + (await toast(/Application sent to Delta Works/i)));
    await shot('22-job-board');

    await signIn('dana@example.com');
    await page.evaluate(() => App.go('dashboard'));
    await page.waitForFunction(() => !document.getElementById('hub-badge').classList.contains('hidden'));
    let b = await badge();
    log(b.n >= 1 ? '✅' : '❌', `Dana's League Hub nav badge shows ${b.n} pending decision(s)`);

    /* ---- 6. Dana reviews the application (attrs visible) and proposes terms ---- */
    await page.evaluate(() => App.go('hub', 'recruitment'));
    await page.waitForSelector('#hub-body .panel');
    const inboxText = await page.evaluate(() => document.getElementById('hub-body').innerText);
    log(/Frank Wrench applies for Crew Chief at Delta Works/i.test(inboxText) ? '✅' : '❌', 'Inbox shows the staff application');
    log(/Race strategy experience: 8\/10/i.test(inboxText) && /Fuel & tire calculation: 9\/10/i.test(inboxText) ? '✅' : '❌',
        'Application carries the recruitment attributes (strategy 8/10, fuel & tire 9/10)');
    await page.click('#hub-body .race-row:has-text("Frank Wrench") button:has-text("Sign them")');
    await page.waitForSelector('#staff-sign-form');
    await page.fill('#ss-salary', '240');
    await page.fill('#ss-note', 'The endurance seat is yours if the number works.');
    await page.click('#staff-sign-form button[type=submit]');
    log('✅', 'Terms proposed: ' + (await toast(/Terms sent to Frank Wrench/i)));

    /* ---- 7. Frank: badge shows events, deal room signs the contract ---- */
    await signIn('frank@example.com');
    await page.evaluate(() => App.go('dashboard'));
    await page.waitForFunction(() => !document.getElementById('hub-badge').classList.contains('hidden'));
    b = await badge();
    log(b.n >= 2 ? '✅' : '❌', `Frank's badge counts the negotiation + accepted application (${b.n})`);
    const negFrank = await page.evaluate(async () =>
        (await DB.list('negotiations', { force: true })).find(n => n.status === 'open' && n.personName === 'Frank Wrench').id);
    await page.evaluate((id) => Deals.room(id), negFrank);
    await page.waitForSelector('#deal-accept');
    const frankRoom = await page.evaluate(() => document.querySelector('.modal-card').innerText);
    log(/endurance seat is yours/i.test(frankRoom) && /latest offer by/i.test(frankRoom) ? '✅' : '❌',
        'Deal room hero states who made the latest offer, message visible');
    await page.click('#deal-accept');
    await toast(/Contract signed: Frank Wrench/i);
    const staffState = await page.evaluate(async () => {
        const p = (await DB.list('roleProfiles', { force: true })).find(x => x.name === 'Frank Wrench');
        const c = (await DB.contracts({ force: true })).find(x => x.personId === p.id && x.status === 'active');
        const team = (await DB.teams({ force: true })).find(t => t.name === 'Delta Works');
        const user = (await DB.users({ force: true })).find(u => u.displayName === 'Frank');
        return { joined: p.teamId === team.id, contract: c && { salary: c.salary, personUid: c.personUid, role: c.role }, frankUid: user.id || null, balance: Number(user.balance) };
    });
    log(staffState.joined ? '✅' : '❌', 'Frank\'s crew-chief profile joined Delta Works on signing');
    log(staffState.contract?.salary === 240 && staffState.contract?.personUid ? '✅' : '❌',
        `Contract active at $240/race with personUid for payroll (role ${staffState.contract?.role})`);
    log(staffState.balance === 75240 ? '✅' : '❌', `Frank pocketed the signing bonus (balance $${staffState.balance})`);

    /* ---- 8. Scouting: Dana filters free agents, sees Eve's attributes ---- */
    await signIn('dana@example.com');
    await page.evaluate(() => App.go('hub', 'recruitment'));
    await page.waitForSelector('#hub-body .panel');
    await page.click('#hub-body .chip-btn:has-text("Drivers")');
    await page.waitForSelector('#hub-body .panel');
    const scout = await page.evaluate(() => document.getElementById('hub-body').innerText);
    // Pace/safety are auto-tracked from race results (0.5.8.1) — Eve hasn't raced, so just
    // confirm the live chip renders (not a stale self-rated number) alongside her free-text attrs.
    log(/Scout Free Agents/i.test(scout) && /Eve Quick/i.test(scout) && /Pace: \d+\/10/i.test(scout) && /GT3, endurance/i.test(scout) ? '✅' : '❌',
        'Scout list shows Eve with her recruitment attributes under the Drivers filter');
    await shot('23-scout-free-agents');
    await page.click('#hub-body .race-row:has-text("Eve Quick") button:has-text("Offer")');
    await page.waitForSelector('#hub-offer-form');
    await page.fill('#ho-salary', '600');
    await page.uncheck('#ho-exclusive');
    await page.fill('#ho-note', 'Second seat for the endurance rounds.');
    await page.click('#hub-offer-form button[type=submit]');
    await toast(/Negotiation opened/);
    log('✅', 'Dana opened a scouted offer to Eve (team → player recruitment)');

    /* ---- 9. Deal room UX: counter updates IN PLACE, no stale buttons ---- */
    await signIn('eve@example.com');
    const negEve = await page.evaluate(async () =>
        (await DB.list('negotiations', { force: true })).find(n => n.status === 'open' && n.personName === 'Eve Quick').id);
    await page.evaluate((id) => Deals.room(id), negEve);
    await page.waitForSelector('#deal-accept');
    let roomText = await page.evaluate(() => document.querySelector('.modal-card').innerText);
    log(/Accept \$600\/race/i.test(roomText) ? '✅' : '❌', 'Accept button carries the current number ($600)');
    await page.fill('#deal-salary', '800');
    await page.fill('#deal-note', 'Endurance pays extra.');
    await page.click('#deal-act button[type=submit]');
    await toast(/Counter sent/);
    await page.waitForFunction(() => /counter at \$800\/race/i.test(document.querySelector('.modal-card')?.innerText || ''));
    roomText = await page.evaluate(() => document.querySelector('.modal-card').innerText);
    // The counter's delta renders as a highlighted chip ($600 → $800) since 0.5.8.5.
    log(/latest counter by you/i.test(roomText) && /\$600 → \$800\/race/i.test(roomText) && !/Accept \$600/i.test(roomText) ? '✅' : '❌',
        'Room re-rendered in place: hero says "latest counter by you", thread chip shows $600 → $800, no stale $600 button');
    log(await page.evaluate(() => !!document.querySelector('.modal-card .race-row.deal-latest')) ? '✅' : '❌',
        'Latest move is visually highlighted in the thread');
    await shot('24-deal-room-live');

    /* ---- 10. Live poll + stale-accept guard (other side moves mid-room) ---- */
    await signIn('dana@example.com');
    await page.evaluate((id) => Deals.room(id), negEve);
    await page.waitForSelector('#deal-accept');
    // Eve "on another device" bumps her counter to $900 behind Dana's open room.
    await page.evaluate(async (id) => {
        const n = await DB.get('negotiations', id, { force: true });
        await DB.update('negotiations', id, {
            salary: 900,
            history: [...n.history, { byUid: n.sideBUid, byName: 'Eve Quick', action: 'counter', salary: 900, note: 'Actually — $900.', at: Util.todayISO() }]
        });
    }, negEve);
    await page.click('#deal-accept'); // still shows $800 — must refuse
    const guardToast = await toast(/moved to \$900/i);
    log('✅', 'Stale accept refused: ' + guardToast.slice(0, 90));
    await page.waitForFunction(() => /Accept \$900\/race/i.test(document.querySelector('.modal-card')?.innerText || ''));
    log('✅', 'Room refreshed itself to the real number ($900) after the guard fired');
    await page.click('#deal-accept');
    await toast(/Contract signed: Eve Quick/i);
    log('✅', 'Dana accepted the live number — contract signed at $900');

    /* ---- 11. Polite rejection + unseen-answer badge for the applicant ---- */
    await signIn('frank@example.com'); // Frank applies somewhere he'll be declined
    await page.evaluate(async () => {
        const me = (await DB.list('roleProfiles', { force: true })).find(p => p.name === 'Frank Wrench');
        await DB.update('roleProfiles', me.id, { teamId: null }); // free him for a second application
    });
    const delta = await page.evaluate(async () => (await DB.teams({ force: true })).find(t => t.name === 'Delta Works').id);
    await page.evaluate(async (teamId) => {
        const me = (await DB.list('roleProfiles', { force: true })).find(p => p.name === 'Frank Wrench');
        await Hub.applyStaff(me.id, teamId);
    }, delta);
    await toast(/Application sent/i);
    await signIn('dana@example.com');
    await page.evaluate(() => App.go('hub', 'recruitment'));
    await page.waitForSelector('#hub-body .race-row:has-text("Frank Wrench")');
    await page.click('#hub-body .race-row:has-text("Frank Wrench") button:has-text("Decline")');
    await toast(/polite heads-up/i);
    log('✅', 'Dana declined with an automated polite rejection');
    await signIn('frank@example.com');
    await page.evaluate(() => App.go('dashboard'));
    await page.waitForFunction(() => !document.getElementById('hub-badge').classList.contains('hidden'));
    b = await badge();
    log(b.n >= 1 ? '✅' : '❌', `Frank's badge flags the unseen rejection (${b.n})`);
    await page.evaluate(() => App.go('hub', 'recruitment'));
    await page.waitForSelector('#hub-body .panel');
    const sent = await page.evaluate(() => document.getElementById('hub-body').innerText);
    log(/went in another direction/i.test(sent) ? '✅' : '❌', 'Sent list shows the polite rejection message');
    await page.waitForFunction(() => document.getElementById('hub-badge').classList.contains('hidden')
        || Number(document.getElementById('hub-badge').textContent) === 0, null, { timeout: 15000 }).catch(() => {});
    b = await badge();
    log(b.hidden || b.n === 0 ? '✅' : '❌', 'Visiting the recruitment tab marks the answer seen — badge clears');

    await browser.close();
    const fails = steps.filter(s => s.startsWith('❌'));
    console.log(`\n${steps.length - fails.length}/${steps.length} steps passed`);
    if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
})().catch(e => { console.error('❌ DRIVE CRASHED:', e); process.exit(1); });
