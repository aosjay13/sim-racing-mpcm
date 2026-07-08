/* Drive the GM persona/sponsorship flows through the real UI on the shim:
   role-aware persona form (agent, series owner, track owner, sponsor,
   mechanic), World-tab list with AI/Player badges + role detail,
   GM editing a player's role profile, sponsor brand add/edit. */
const { chromium } = require('playwright');
const path = require('path');

const SHOT_DIR = __dirname;
const steps = [];
const log = (mark, msg) => { steps.push(`${mark} ${msg}`); console.log(`${mark} ${msg}`); };

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

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
        window.prompt = (m) => { window.__dialogs.push('prompt: ' + String(m).split('\n')[0]); return 'x'; };
        window.alert = (m) => { window.__dialogs.push('alert: ' + String(m).split('\n')[0]); };
    });
    page.on('pageerror', e => log('❌', 'pageerror: ' + e.message));

    const toast = async (re = /./, timeout = 30000) => {
        await page.waitForFunction((s) => new RegExp(s).test(document.getElementById('toast-holder')?.innerText || ''), re.source, { timeout });
        const text = await page.evaluate(() => document.getElementById('toast-holder').innerText.replace(/\n+/g, ' · '));
        await page.evaluate(() => document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove()));
        return text.trim();
    };
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

    /* ---- 2. Seed a small world + one PLAYER role profile ---- */
    const ids = await page.evaluate(async () => {
        const teamA = await DB.create('teams', { name: 'Apex Racing', status: 'approved', ownerUid: null, isNPC: true });
        const teamB = await DB.create('teams', { name: 'Blaze Motorsport', status: 'approved', ownerUid: null, isNPC: true });
        const d1 = await DB.create('drivers', { name: 'Ayrton Tester', teamId: teamA, ownerUid: null, status: 'approved' });
        const d2 = await DB.create('drivers', { name: 'Nikki Probe', teamId: teamB, ownerUid: null, status: 'approved' });
        const s1 = await DB.create('series', { name: 'Phoenix GT Cup', status: 'active', ownerUid: null, season: 2026, pointsSystem: 'f1' });
        await DB.create('tracks', { name: 'Silverstone Circuit', country: 'UK', type: 'Road' });
        await DB.create('tracks', { name: 'Suzuka Circuit', country: 'Japan', type: 'Road' });
        // A player's role profile (has a uid) — the GM must be able to edit it.
        const pp = await DB.create('roleProfiles', { name: 'PlayerAgent Pete', role: 'agent', uid: 'player-uid-1', prestige: 1, clientDriverIds: [d1] });
        return { teamA, teamB, d1, d2, s1, pp };
    });
    log('✅', 'World seeded: 2 teams, 2 drivers, 1 series, 2 tracks, 1 player role profile');

    /* ---- 3. Add persona: AGENT with client drivers ---- */
    await page.evaluate(() => App.go('admin', 'world'));
    await page.waitForSelector('#admin-body .panel');
    await page.click('#admin-body button:has-text("＋ Add Persona")');
    await page.waitForSelector('#persona-form');
    await page.fill('#pe-name', 'Silva Dealmaker');
    await page.selectOption('#pe-role', 'agent');
    // Role-specific section must be visible for agent, others hidden.
    const agentVis = await page.evaluate(() => ({
        clients: !document.querySelector('#pe-clients').closest('.pe-only').hidden,
        series: document.querySelector('#pe-series').closest('.pe-only').hidden,
        venues: document.querySelector('#pe-venues').closest('.pe-only').hidden,
        sponsor: document.querySelector('#pe-spon-team').closest('.pe-only').hidden
    }));
    log(agentVis.clients && agentVis.series && agentVis.venues && agentVis.sponsor ? '✅' : '❌',
        `Role-aware form: agent shows clients only (clients:${agentVis.clients} series-hidden:${agentVis.series} venues-hidden:${agentVis.venues} sponsor-hidden:${agentVis.sponsor})`);
    await page.check('#pe-clients label:has-text("Ayrton Tester") input');
    await page.check('#pe-clients label:has-text("Nikki Probe") input');
    await page.fill('#pe-bio', 'Superagent to the stars.');
    await page.click('#persona-form button[type=submit]');
    log('✅', 'Agent persona: ' + (await toast(/Persona added/)));

    /* ---- 4. Add persona: SERIES OWNER with a series ---- */
    await page.waitForSelector('#admin-body .panel');
    await page.click('#admin-body button:has-text("＋ Add Persona")');
    await page.waitForSelector('#persona-form');
    await page.fill('#pe-name', 'Bernie Promoter');
    await page.selectOption('#pe-role', 'series-owner');
    await page.check('#pe-series label:has-text("Phoenix GT Cup") input');
    await page.click('#persona-form button[type=submit]');
    log('✅', 'Series-owner persona: ' + (await toast(/Persona added/)));

    /* ---- 5. Add persona: TRACK OWNER — library venue + custom venue ---- */
    await page.waitForSelector('#admin-body .panel');
    await page.click('#admin-body button:has-text("＋ Add Persona")');
    await page.waitForSelector('#persona-form');
    await page.fill('#pe-name', 'Vera Venues');
    await page.selectOption('#pe-role', 'track-owner');
    await page.check('#pe-venues label:has-text("Silverstone Circuit") input');
    await page.fill('#pe-tracks-custom', 'Phoenix Dirt Bowl');
    await page.click('#persona-form button[type=submit]');
    log('✅', 'Track-owner persona: ' + (await toast(/Persona added/)));

    /* ---- 6. Add persona: SPONSOR with team + driver deals ---- */
    await page.waitForSelector('#admin-body .panel');
    await page.click('#admin-body button:has-text("＋ Add Persona")');
    await page.waitForSelector('#persona-form');
    await page.fill('#pe-name', 'Meg A. Brand');
    await page.selectOption('#pe-role', 'sponsor');
    await page.selectOption('#pe-spon-team', ids.teamA);
    await page.selectOption('#pe-spon-driver', ids.d2);
    await page.click('#persona-form button[type=submit]');
    log('✅', 'Sponsor persona: ' + (await toast(/Persona added/)));

    /* ---- 7. Add persona: MECHANIC with a team ---- */
    await page.waitForSelector('#admin-body .panel');
    await page.click('#admin-body button:has-text("＋ Add Persona")');
    await page.waitForSelector('#persona-form');
    await page.fill('#pe-name', 'Torque Tommy');
    await page.selectOption('#pe-role', 'mechanic');
    await page.selectOption('#pe-team', ids.teamB);
    await page.click('#persona-form button[type=submit]');
    log('✅', 'Mechanic persona: ' + (await toast(/Persona added/)));

    /* ---- 8. Docs carry the fields the XP engine reads ---- */
    const docs = await page.evaluate(async () => {
        const ps = await DB.roleProfiles({ force: true });
        const by = (n) => ps.find(p => p.name === n);
        return {
            agent: by('Silva Dealmaker'), promo: by('Bernie Promoter'),
            venue: by('Vera Venues'), sponsor: by('Meg A. Brand'), mech: by('Torque Tommy')
        };
    });
    log(docs.agent?.clientDriverIds?.length === 2 && docs.agent.isNPC && !docs.agent.uid ? '✅' : '❌',
        `Agent doc: ${docs.agent?.clientDriverIds?.length} clientDriverIds, isNPC=${docs.agent?.isNPC}`);
    log(docs.promo?.seriesIds?.length === 1 && docs.promo.seriesIds[0] === ids.s1 ? '✅' : '❌',
        `Series-owner doc: seriesIds=[${docs.promo?.seriesIds}] matches the picked series`);
    log(docs.venue?.tracks?.length === 2 && docs.venue.tracks.includes('Silverstone Circuit') && docs.venue.tracks.includes('Phoenix Dirt Bowl') ? '✅' : '❌',
        `Track-owner doc: tracks=[${docs.venue?.tracks?.join(', ')}] (library + custom)`);
    log(docs.sponsor?.sponsoredTeamId === ids.teamA && docs.sponsor?.sponsoredDriverId === ids.d2 ? '✅' : '❌',
        'Sponsor doc: sponsoredTeamId + sponsoredDriverId saved');
    log(docs.mech?.teamId === ids.teamB ? '✅' : '❌', 'Mechanic doc: teamId saved');

    /* ---- 9. World list shows badges + role detail; player profile listed ---- */
    await page.waitForSelector('#admin-body .panel');
    const listText = await page.evaluate(() => document.querySelector('#admin-body').innerText);
    const expect = [
        [/Silva Dealmaker/, 'agent row'],
        [/2 clients — Ayrton Tester, Nikki Probe/, 'agent client detail'],
        [/runs Phoenix GT Cup/, 'series-owner detail'],
        [/2 venues — Silverstone Circuit, Phoenix Dirt Bowl/, 'track-owner detail'],
        [/backs Apex Racing · backs Nikki Probe/, 'sponsor deal detail'],
        [/wrenching for Blaze Motorsport/, 'mechanic detail'],
        [/PlayerAgent Pete/, 'player role profile listed for GM'],
        [/👤 Player/i, 'Player badge'],
        [/🤖 AI/i, 'AI badge']
    ];
    for (const [re, what] of expect) log(re.test(listText) ? '✅' : '❌', `World list shows ${what}`);
    await page.evaluate(() => {
        const h = Array.from(document.querySelectorAll('#admin-body h2')).find(x => /Personas/i.test(x.textContent));
        h?.closest('.panel')?.scrollIntoView({ block: 'start' });
    });
    await shot('15-personas-world');

    /* ---- 10. GM edits the PLAYER's role profile through the same form ---- */
    await page.evaluate((id) => Admin.personaForm(id), ids.pp);
    await page.waitForSelector('#persona-form');
    const editHead = await page.evaluate(() => document.querySelector('.modal-card').innerText);
    log(/Edit Role Profile/i.test(editHead) && /player/i.test(editHead) ? '✅' : '❌',
        'Player profile opens as "Edit Role Profile" with player note');
    const preChecked = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#pe-clients input')).some(i => i.checked));
    log(preChecked ? '✅' : '❌', "Player agent's existing client pre-checked in the form");
    await page.fill('#pe-name', 'PlayerAgent Pete Jr.');
    await page.check('#pe-clients label:has-text("Nikki Probe") input');
    await page.click('#persona-form button[type=submit]');
    log('✅', 'Player profile edit: ' + (await toast(/Persona updated/)));
    const player = await page.evaluate(async (id) => DB.get('roleProfiles', id), ids.pp);
    log(player.name === 'PlayerAgent Pete Jr.' && player.uid === 'player-uid-1' && player.clientDriverIds.length === 2 ? '✅' : '❌',
        `Player profile saved: name="${player.name}", uid preserved (${player.uid}), ${player.clientDriverIds.length} clients`);

    /* ---- 11. Switching a persona's role clears stale assignments ---- */
    const agentId = docs.agent.id;
    await page.evaluate((id) => Admin.personaForm(id), agentId);
    await page.waitForSelector('#persona-form');
    await page.selectOption('#pe-role', 'sponsor');
    await page.selectOption('#pe-spon-team', ids.teamB);
    await page.click('#persona-form button[type=submit]');
    await toast(/Persona updated/);
    const switched = await page.evaluate(async (id) => DB.get('roleProfiles', id), agentId);
    log(switched.role === 'sponsor' && switched.clientDriverIds.length === 0 && switched.sponsoredTeamId === ids.teamB ? '✅' : '❌',
        `Role switch agent→sponsor: clients cleared (${switched.clientDriverIds.length}), sponsoredTeamId set`);

    /* ---- 12. Sponsor brand add + edit still works ---- */
    await page.waitForSelector('#admin-body .panel');
    await page.click('#admin-body button:has-text("＋ Add Sponsor")');
    await page.waitForSelector('#sponsor-form');
    await page.fill('#sp-name', 'Vortex Energy');
    await page.fill('#sp-industry', 'Beverages');
    await page.selectOption('#sp-team', ids.teamA);
    await page.click('#sponsor-form button[type=submit]');
    log('✅', 'Sponsor brand added: ' + (await toast(/Sponsor added/)));
    const brandId = await page.evaluate(async () =>
        (await DB.sponsors({ force: true })).find(s => s.name === 'Vortex Energy')?.id);
    await page.evaluate((id) => Admin.sponsorForm(id), brandId);
    await page.waitForSelector('#sponsor-form');
    await page.fill('#sp-payout', '500');
    await page.click('#sponsor-form button[type=submit]');
    log('✅', 'Sponsor brand edited: ' + (await toast(/Sponsor updated/)));
    const brand = await page.evaluate(async (id) => DB.get('sponsors', id), brandId);
    log(brand.payoutPerRace === 500 && brand.teamId === ids.teamA ? '✅' : '❌',
        `Sponsor brand doc: pays ${brand.payoutPerRace}/race backing team A`);

    console.log('\nDIALOGS SEEN:\n' + (await page.evaluate(() => window.__dialogs)).map(d => '  ' + d).join('\n'));
    console.log('\n=== STEPS ===\n' + steps.join('\n'));
    await browser.close();
    process.exit(steps.some(s => s.startsWith('❌')) ? 1 : 0);
})().catch(e => { console.error('DRIVER CRASH:', e); process.exit(2); });
