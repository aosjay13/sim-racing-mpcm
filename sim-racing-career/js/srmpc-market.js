/* ============================================================
   Phoenix SRMPC — Market & Economy
   Player wallets, NPC free agents (drivers + pit crew),
   hiring with salary negotiation, contracts, and the
   Dealership placeholder.
   ============================================================ */
'use strict';

/* ---------------- Economy ---------------- */
const Economy = {
    // Career difficulty sets the one-time starting budget. Scaled to
    // real-world racing money: Easy ≈ a sponsored GT program, Medium ≈ a
    // serious club-racing season, Hard ≈ grassroots with a used car.
    DIFFICULTIES: {
        easy: { id: 'easy', icon: '🟢', label: 'Sponsored Start', tagline: 'Easy — a major sponsor bankrolls your debut. Buy cars, hire a full crew, live comfortably.', start: 250000 },
        medium: { id: 'medium', icon: '🟡', label: 'Semi-Pro', tagline: 'Medium — a solid season budget. Enough for a car and a small crew if you spend wisely.', start: 75000 },
        hard: { id: 'hard', icon: '🔴', label: 'Grassroots Underdog', tagline: 'Hard — a shoestring budget and a dream. Every dollar hurts.', start: 15000 }
    },
    difficultyInfo(id) { return this.DIFFICULTIES[id] || null; },

    fmt(n) {
        n = Math.round(Number(n) || 0);
        return (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US');
    },
    balance() { return Number(Auth.state.profile?.balance) || 0; },

    /* ----- Difficulty picker (first login + change-with-restart) ----- */
    difficultyPicker(firstTime = true) {
        const current = Auth.state.profile?.difficulty;
        Modal.open(`
            ${Modal.header(firstTime ? '🎮 Choose Your Difficulty' : '🎮 Change Difficulty',
                firstTime ? 'How hard should your career be? This sets your starting budget.'
                    : 'Changing difficulty RESTARTS your career from nothing.')}
            <div class="role-grid">
                ${Object.values(this.DIFFICULTIES).map(d => `
                    <button class="role-card ${current === d.id ? 'selected' : ''}"
                        onclick="Economy.${firstTime ? 'pickDifficulty' : 'confirmRestart'}('${d.id}')">
                        <span class="role-icon">${d.icon}</span>
                        <span class="role-name">${d.label}${current === d.id ? ' (current)' : ''}</span>
                        <span class="role-desc">${d.tagline}</span>
                        <span class="market-price">${this.fmt(d.start)} starting budget</span>
                    </button>`).join('')}
            </div>
            <p class="muted small" style="margin-top:.8rem">${firstTime
                ? 'You can change difficulty later — but that restarts your career from scratch.'
                : '⚠ Restarting releases your team ownership, deletes your driver profile and stats, ends your contracts, clears challenge progress, and sets your balance to the new starting budget.'}</p>
        `, { wide: true });
    },

    async pickDifficulty(id) {
        try {
            const d = this.DIFFICULTIES[id];
            if (!d) return;
            // Mirrored into roleDifficulty.driver too — this is the personal
            // wallet's difficulty, tracked per-role alongside (and fully
            // independent of) Wallet.TEAM_DIFFICULTIES for Team Owner.
            const roleDifficulty = { ...(Auth.state.profile?.roleDifficulty || {}), driver: id };
            await Auth.updateProfile({ difficulty: id, balance: d.start, walletInitialized: true, roleDifficulty });
            Modal.close();
            Util.notify(`${d.icon} ${d.label} — starting budget ${this.fmt(d.start)}. Good luck out there!`);
            App.go('career');
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    async confirmRestart(id) {
        const d = this.DIFFICULTIES[id];
        if (!d) return;
        if (Auth.state.profile?.difficulty === id) { Util.notify('That is already your difficulty.', 'info'); return; }
        const typed = prompt(
            `Restarting on ${d.label} wipes your career:\n\n` +
            `• Team ownership released (team becomes available for takeover)\n` +
            `• Your driver profile and stats are deleted\n` +
            `• Your contracts end and challenge progress clears\n` +
            `• Balance resets to ${this.fmt(d.start)}\n\n` +
            `Type RESET to confirm.`);
        if ((typed || '').trim().toUpperCase() !== 'RESET') { Util.notify('Restart cancelled — career untouched.', 'info'); return; }
        await this.restartCareer(id);
    },

    async resetCareerPrompt() {
        const currentDiffId = Auth.state.profile?.difficulty;
        const d = this.difficultyInfo(currentDiffId);
        if (!d) {
            Util.notify('Choose a difficulty first before resetting your career.', 'info');
            return;
        }
        const typed = prompt(
            `Resetting your career on ${d.label} wipes everything and starts you fresh:\n\n` +
            `• Team ownership released (team becomes available for takeover)\n` +
            `• Your driver profile and stats are deleted\n` +
            `• Your contracts end and challenge progress clears\n` +
            `• Balance resets to ${this.fmt(d.start)}\n\n` +
            `Type RESET to confirm.`);
        if ((typed || '').trim().toUpperCase() !== 'RESET') {
            Util.notify('Reset cancelled — career untouched.', 'info');
            return;
        }
        await this.restartCareer(currentDiffId);
    },

    // Full career wipe + fresh start on the chosen difficulty.
    async restartCareer(diffId) {
        try {
            const uid = Auth.uid();
            const d = this.DIFFICULTIES[diffId];
            const name = Auth.state.profile?.displayName || 'A player';

            // Release owned teams (kept intact for takeover).
            const teams = await DB.teams({ force: true });
            for (const t of teams.filter(t => t.ownerUid === uid)) {
                await DB.update('teams', t.id, { ownerUid: null, isEstablished: true });
            }
            // End contracts tied to my driver(s), then delete the drivers.
            const drivers = await DB.drivers({ force: true });
            const myDrivers = drivers.filter(dr => dr.ownerUid === uid);
            const contracts = await DB.contracts({ force: true }).catch(() => []);
            for (const c of contracts.filter(c => c.status === 'active' && myDrivers.some(dr => dr.id === c.personId))) {
                await DB.update('contracts', c.id, { status: 'released', endedAt: Util.todayISO() });
            }
            for (const dr of myDrivers) await DB.remove('drivers', dr.id);
            // Role profiles, challenge claims, race signups — gone.
            const rps = await DB.roleProfiles({ force: true }).catch(() => []);
            for (const rp of rps.filter(r => r.uid === uid)) await DB.remove('roleProfiles', rp.id);
            const claims = await DB.claims({ force: true }).catch(() => []);
            for (const c of claims.filter(c => c.uid === uid)) await DB.remove('challengeClaims', c.id);
            const signups = await DB.signups({ force: true }).catch(() => []);
            for (const s of signups.filter(s => s.uid === uid)) await DB.remove('raceSignups', s.id);
            // Withdraw anything pending in the recruitment market.
            const rec = await DB.recruitment({ force: true }).catch(() => []);
            for (const r of rec.filter(r => r.status === 'pending' && (r.driverUid === uid || r.ownerUid === uid))) {
                await DB.update('recruitment', r.id, { status: 'withdrawn' });
            }
            // Fresh profile. Team Owner difficulty/budget are untouched — a
            // personal-career restart doesn't reach into the isolated team
            // wallet (any owned team was just released above).
            const roleDifficulty = { ...(Auth.state.profile?.roleDifficulty || {}), driver: diffId };
            await Auth.updateProfile({
                activeRole: null, driverId: null, teamId: null,
                difficulty: diffId, balance: d.start, walletInitialized: true, roleDifficulty
            });
            Modal.close();
            News.post('🔄', `${name} restarted their career on ${d.icon} ${d.label}`);
            Util.notify(`Career restarted on ${d.label}. Starting budget: ${this.fmt(d.start)}. 🔄`);
            App.go('career');
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    async spend(amount, label, icon = '💸') {
        amount = Math.round(Number(amount) || 0);
        const bal = this.balance();
        if (amount > bal) {
            throw new Error(`Not enough funds — ${label} costs ${this.fmt(amount)} but you have ${this.fmt(bal)}.`);
        }
        await Auth.updateProfile({ balance: bal - amount });
        this.logTx(Auth.uid(), -amount, icon, label);
    },

    /* ----- Prestige pay cap: nobody can be paid above their star level ----- */
    PAY_CAP_BASE: 2000, // 1★ cap; higher stars scale by the prestige multiplier
    payCap(stars) { return Math.round(this.PAY_CAP_BASE * Prestige.multiplier(stars) / 10) * 10; },
    capLine(stars) {
        return `${Prestige.stars(stars)} ${Prestige.levelName(stars)} — pay capped at ${this.fmt(this.payCap(stars))}/race`;
    },

    /* ----- Ledger: every wallet movement, tracked ----- */
    // Fire-and-forget: a failed ledger write must never break the payment.
    async logTx(uid, amount, icon, label, refId = null) {
        if (!uid || !Math.round(Number(amount) || 0)) return;
        try {
            await DB.create('ledger', {
                uid, amount: Math.round(Number(amount)), icon: icon || '💵',
                label: String(label || '').slice(0, 140), refId, at: Util.todayISO()
            });
        } catch (e) { console.warn('Ledger write failed:', e); }
    },

    async logMany(entries) {
        const rows = entries.filter(t => t.uid && Math.round(Number(t.amount) || 0));
        if (!rows.length) return;
        try {
            await DB.batchCreate('ledger', rows.map(t => ({
                uid: t.uid, amount: Math.round(Number(t.amount)), icon: t.icon || '💵',
                label: String(t.label || '').slice(0, 140), refId: t.refId || null, at: Util.todayISO()
            })));
        } catch (e) { console.warn('Ledger batch failed:', e); }
    },

    // Credit/debit ANY player's wallet (race payouts, buyouts, signing
    // bonuses between players). Debits may go negative — contract debts are
    // real; the ledger shows where the money went.
    async adjustWallet(uid, delta, icon, label, refId = null) {
        delta = Math.round(Number(delta) || 0);
        if (!uid || !delta) return;
        if (uid === Auth.uid()) {
            await Auth.updateProfile({ balance: this.balance() + delta });
        } else {
            const user = await DB.get('users', uid).catch(() => null);
            if (!user) return;
            await DB.update('users', uid, { balance: (Number(user.balance) || 0) + delta }).catch(() => {});
        }
        this.logTx(uid, delta, icon, label, refId);
    },

    async ledgerFor(uid, limit = 10) {
        const rows = (await DB.list('ledger', { force: true }).catch(() => []))
            .filter(t => t.uid === uid)
            .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0) || (b.at || '').localeCompare(a.at || ''));
        return { recent: rows.slice(0, limit), total: rows.reduce((s, t) => s + t.amount, 0), count: rows.length };
    },

    // Reusable "Earnings & Spending" panel for any workspace.
    async earningsPanel(title = '💵 Earnings & Spending') {
        const { recent, count } = await this.ledgerFor(Auth.uid());
        return `<section class="panel">
            <div class="panel-head"><h2>${title}</h2><span class="chip wallet-chip">💵 ${this.fmt(this.balance())}</span></div>
            ${recent.length ? recent.map(t => `
                <div class="race-row">
                    <div class="driver-hero-num" style="font-size:1rem;min-width:2.4rem;height:2.4rem">${t.icon || '💵'}</div>
                    <div class="race-row-main">
                        <span class="race-title">${Util.esc(t.label)}</span>
                        <span class="race-sub">${Util.esc(Util.fmtDateShort(t.at))}</span>
                    </div>
                    <span class="market-price" style="color:${t.amount < 0 ? 'var(--bad)' : 'var(--good)'}">${t.amount < 0 ? '−' : '+'}${this.fmt(Math.abs(t.amount))}</span>
                </div>`).join('') + (count > recent.length ? `<p class="muted small">Showing the last ${recent.length} of ${count} transactions.</p>` : '')
            : C.empty('📒', 'No transactions yet', 'Prizes, salaries, sponsorship payouts, fees, and purchases all land here as they happen.')}
        </section>`;
    },

    walletChip() {
        if (!Auth.isPlayer() || !Auth.state.profile?.walletInitialized) return '';
        const bal = this.balance();
        return `<span class="chip wallet-chip" title="Your career balance" ${bal < 0 ? 'style="color:var(--bad)"' : ''}>💵 ${this.fmt(bal)}</span>`;
    }
};
window.Economy = Economy;

/* ---------------- NPC generation ---------------- */
const STAFF_ROLES = [
    { id: 'crew-chief', label: 'Crew Chief', icon: '📋', base: 150, perPoint: 10 },
    { id: 'race-engineer', label: 'Race Engineer', icon: '🛠', base: 140, perPoint: 9 },
    { id: 'mechanic', label: 'Mechanic', icon: '🔧', base: 100, perPoint: 8 },
    { id: 'spotter', label: 'Spotter', icon: '📡', base: 80, perPoint: 6 }
];
window.STAFF_ROLES = STAFF_ROLES;
function staffRoleInfo(id) {
    return STAFF_ROLES.find(r => r.id === id) || { id, label: id || 'Staff', icon: '👷', base: 100, perPoint: 8 };
}
window.staffRoleInfo = staffRoleInfo;

const NPC_POOL = {
    first: ['Marco', 'Dale', 'Kimi', 'Sofia', 'Ryo', 'Elena', 'Trevor', 'Nash', 'Bruno', 'Yuki',
        'Colt', 'Ivy', 'Andre', 'Priya', 'Lars', 'Maya', 'Diego', 'Kasper', 'Nina', 'Jett',
        'Rosco', 'Tatiana', 'Hugo', 'Zane', 'Freya', 'Otto', 'Carmen', 'Silas', 'Lena', 'Buck'],
    last: ['Vettori', 'Hargrove', 'Nakamura', 'Silva', 'Kowalski', 'Beaumont', 'McAllister', 'Ortiz',
        'Lindqvist', 'Romano', 'Steele', 'Duval', 'Yamada', 'Krueger', 'Bianchi', 'Foster',
        'Sorensen', 'Alvarez', 'Novak', 'Thorne', 'Delacroix', 'Okafor', 'Petrov', 'Marlowe',
        'Castellano', 'Reyes', 'Voss', 'Ashford', 'Kimura', 'Braddock'],
    countries: ['USA', 'UK', 'Italy', 'Japan', 'Germany', 'Brazil', 'Spain', 'Sweden', 'France',
        'Canada', 'Australia', 'Mexico', 'Netherlands', 'Finland', 'Poland'],
    teamNames: ['Apex Velocity Racing', 'Ironclad Motorsport', 'Midnight Torque', 'Redline Syndicate',
        'Vulcan Racing Co.', 'Slipstream Union', 'Copperhead GP', 'Northstar Racing',
        'Grid Kings', 'Turbine Alley Racing'],
    teamColors: ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#9b5de5', '#00b4d8', '#ef476f', '#06d6a0', '#ffd166', '#8338ec']
};

function _rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function _randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

// Per-race asking salary, rounded to $10. Rating runs 55–95.
function driverAskingSalary(rating) {
    return Math.round((200 + Math.max(0, rating - 50) * 35) / 10) * 10;
}
function staffAskingSalary(roleId, rating) {
    const r = staffRoleInfo(roleId);
    return Math.round((r.base + Math.max(0, rating - 50) * r.perPoint) / 10) * 10;
}
window.driverAskingSalary = driverAskingSalary;
window.staffAskingSalary = staffAskingSalary;

function makeNpcName(usedNames) {
    for (let i = 0; i < 50; i++) {
        const name = `${_rand(NPC_POOL.first)} ${_rand(NPC_POOL.last)}`;
        if (!usedNames.has(name)) { usedNames.add(name); return name; }
    }
    const fallback = `${_rand(NPC_POOL.first)} ${_rand(NPC_POOL.last)} ${_randInt(2, 99)}`;
    usedNames.add(fallback);
    return fallback;
}

function makeNpcDriver(usedNames, teamId = null) {
    const rating = _randInt(55, 95);
    return {
        name: makeNpcName(usedNames),
        number: _randInt(2, 99),
        country: _rand(NPC_POOL.countries),
        bio: '',
        teamId,
        ownerUid: null,
        status: 'approved',
        isNPC: true,
        rating,
        askingSalary: driverAskingSalary(rating)
    };
}

function makeNpcStaff(roleId, usedNames, teamId = null) {
    const rating = _randInt(55, 95);
    return {
        name: makeNpcName(usedNames),
        role: roleId,
        country: _rand(NPC_POOL.countries),
        teamId,
        ownerUid: null,
        isNPC: true,
        rating,
        prestige: 1, // everyone starts their career at 1 star
        askingSalary: staffAskingSalary(roleId, rating)
    };
}

// Creates rival teams (with rosters) + free agents. Admin-only entry point.
async function generateNPCWorld({ freeDrivers = 10, freeCrew = 12, rivalTeams = 4 } = {}) {
    const [existingDrivers, existingStaff, existingTeams] = await Promise.all([
        DB.drivers({ force: true }),
        DB.list('staff', { force: true }).catch(() => []),
        DB.teams({ force: true })
    ]);
    const usedNames = new Set([...existingDrivers, ...existingStaff].map(x => x.name));
    const usedTeamNames = new Set(existingTeams.map(t => t.name));
    const summary = { teams: 0, drivers: 0, staff: 0 };

    const drivers = [];
    const staff = [];

    const teamNamePool = NPC_POOL.teamNames.filter(n => !usedTeamNames.has(n));
    for (let i = 0; i < Math.min(rivalTeams, teamNamePool.length); i++) {
        const teamId = await DB.create('teams', {
            name: teamNamePool[i],
            color: NPC_POOL.teamColors[i % NPC_POOL.teamColors.length],
            headquarters: _rand(NPC_POOL.countries),
            description: 'League-run rival team. Beat them on track — or take them over.',
            recruiting: true,
            isEstablished: true,
            isNPC: true,
            ownerUid: null,
            status: 'approved'
        });
        drivers.push(makeNpcDriver(usedNames, teamId), makeNpcDriver(usedNames, teamId));
        staff.push(makeNpcStaff('crew-chief', usedNames, teamId), makeNpcStaff('mechanic', usedNames, teamId));
        summary.teams++;
    }

    for (let i = 0; i < freeDrivers; i++) drivers.push(makeNpcDriver(usedNames));
    for (let i = 0; i < freeCrew; i++) {
        staff.push(makeNpcStaff(STAFF_ROLES[i % STAFF_ROLES.length].id, usedNames));
    }

    if (drivers.length) await DB.batchCreate('drivers', drivers);
    if (staff.length) await DB.batchCreate('staff', staff);
    summary.drivers = drivers.length;
    summary.staff = staff.length;
    return summary;
}
window.generateNPCWorld = generateNPCWorld;

/* ---------------- Bulk AI personas & sponsorships ---------------- */
const PERSONA_BIOS = {
    'agent': ['Talent scout with a phone that never stops ringing.', 'Closes seat deals before breakfast.', 'Knows every team principal by first name.'],
    'series-owner': ['Promoter chasing the next great championship.', 'Sells out grandstands for a living.', 'Believes every race should be an event.'],
    'track-owner': ['Venue group keeping historic circuits alive.', 'Buys tracks the way others buy watches.', 'Every apex on their land is sacred.'],
    'sponsor': ['Marketing chief who bets the budget on race wins.', 'Wants the brand on every podium photo.', 'ROI measured in champagne sprayed.']
};
const BRAND_POOL = {
    first: ['Vortex', 'Titanium', 'Comet', 'Ridgeway', 'Onyx', 'Drifter', 'Boltline', 'Zephyr', 'Cobalt', 'Ember',
        'Falconer', 'Zenith', 'Pulsar', 'Atlas', 'Halcyon', 'Monarch', 'Stratos', 'Kestrel', 'Argon', 'Tundra'],
    second: ['Energy', 'Motorsports', 'Fuels', 'Dynamics', 'Lubricants', 'Telecom', 'Financial', 'Gaming', 'Tyres',
        'Logistics', 'Optics', 'Beverages', 'Apparel', 'Tools', 'Media', 'Components', 'Racing Oil', 'Electronics'],
    industries: ['Energy drinks', 'Automotive', 'Technology', 'Finance', 'Beverages', 'Clothing', 'Logistics',
        'Gaming', 'Insurance', 'Telecom', 'Media', 'Hardware']
};

function _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Bulk-creates AI personas (agents, series owners, track owners, sponsor
// characters) and brand sponsors, auto-assigning them to whatever the league
// already has: agents rep unclaimed drivers, series owners claim unpromoted
// series, track owners split unowned venues, sponsors back teams & drivers.
// Admin-only entry point, mirroring generateNPCWorld.
async function generatePersonaWorld({ agents = 0, seriesOwners = 0, trackOwners = 0, sponsors = 0, brands = 0 } = {}) {
    const [drivers, teams, seriesList, tracks, profiles, existingSponsors, existingStaff] = await Promise.all([
        DB.drivers({ force: true }),
        DB.teams({ force: true }),
        DB.series({ force: true }),
        DB.list('tracks', { force: true }).catch(() => []),
        DB.list('roleProfiles', { force: true }).catch(() => []),
        DB.list('sponsors', { force: true }).catch(() => []),
        DB.list('staff', { force: true }).catch(() => [])
    ]);
    const usedNames = new Set([...drivers, ...existingStaff, ...profiles].map(x => x.name));
    const bio = (role) => _rand(PERSONA_BIOS[role]);
    const personas = [];
    const summary = { agents: 0, seriesOwners: 0, trackOwners: 0, sponsors: 0, brands: 0 };

    // Agents: 2–4 clients each, preferring drivers no AI agent reps yet.
    const repped = new Set(profiles.filter(p => p.role === 'agent').flatMap(p => p.clientDriverIds || []));
    let driverPool = _shuffle(drivers.filter(d => !repped.has(d.id)));
    for (let i = 0; i < agents; i++) {
        if (!driverPool.length) driverPool = _shuffle(drivers.slice()); // everyone repped → double-book
        const book = driverPool.splice(0, Math.min(driverPool.length, _randInt(2, 4))).map(d => d.id);
        personas.push({ name: makeNpcName(usedNames), role: 'agent', uid: null, isNPC: true, prestige: 1, bio: bio('agent'), clientDriverIds: book });
        summary.agents++;
    }

    // Series owners: claim series that have no promoter persona and no player owner.
    const promoted = new Set(profiles.filter(p => p.role === 'series-owner').flatMap(p => p.seriesIds || []));
    const openSeries = _shuffle(seriesList.filter(s => !promoted.has(s.id) && !s.ownerUid));
    for (let i = 0; i < seriesOwners; i++) {
        const claimed = openSeries.splice(0, Math.max(1, Math.ceil(openSeries.length / (seriesOwners - i)))).map(s => s.id);
        personas.push({ name: makeNpcName(usedNames), role: 'series-owner', uid: null, isNPC: true, prestige: 1, bio: bio('series-owner'), seriesIds: claimed });
        summary.seriesOwners++;
    }

    // Track owners: split unowned library venues into portfolios of up to 4.
    const ownedVenues = new Set(profiles.filter(p => p.role === 'track-owner').flatMap(p => p.tracks || []).map(t => t.toLowerCase()));
    const openTracks = _shuffle(tracks.map(t => t.name).filter(n => n && !ownedVenues.has(n.toLowerCase())));
    for (let i = 0; i < trackOwners; i++) {
        const venues = openTracks.splice(0, Math.min(4, Math.max(1, Math.ceil(openTracks.length / (trackOwners - i)))));
        personas.push({ name: makeNpcName(usedNames), role: 'track-owner', uid: null, isNPC: true, prestige: 1, bio: bio('track-owner'), tracks: venues });
        summary.trackOwners++;
    }

    // Sponsor personas: each backs a team and one of its drivers when possible.
    for (let i = 0; i < sponsors; i++) {
        const team = teams.length ? _rand(teams) : null;
        const roster = team ? drivers.filter(d => d.teamId === team.id) : [];
        const driver = roster.length ? _rand(roster) : (drivers.length ? _rand(drivers) : null);
        personas.push({
            name: makeNpcName(usedNames), role: 'sponsor', uid: null, isNPC: true, prestige: 1, bio: bio('sponsor'),
            sponsoredTeamId: team?.id || null, sponsoredDriverId: driver?.id || null
        });
        summary.sponsors++;
    }

    // Brand sponsors: named pool first (skipping existing names), procedural
    // after, preferring teams that don't have a backer yet.
    const brandNames = new Set(existingSponsors.map(s => (s.name || '').toLowerCase()));
    const namedPool = _shuffle((typeof SPONSOR_BRANDS !== 'undefined' ? SPONSOR_BRANDS : [])
        .filter(b => !brandNames.has(b.name.toLowerCase())));
    const backed = new Set(existingSponsors.map(s => s.teamId).filter(Boolean));
    const openTeams = _shuffle(teams.filter(t => !backed.has(t.id)));
    const brandDocs = [];
    for (let i = 0; i < brands; i++) {
        let brand = namedPool.shift();
        for (let tries = 0; !brand && tries < 50; tries++) {
            const name = `${_rand(BRAND_POOL.first)} ${_rand(BRAND_POOL.second)}`;
            if (!brandNames.has(name.toLowerCase())) brand = { name, industry: _rand(BRAND_POOL.industries) };
        }
        if (!brand) break;
        brandNames.add(brand.name.toLowerCase());
        const team = openTeams.shift() || (teams.length ? _rand(teams) : null);
        brandDocs.push({ ...brand, isNPC: true, prestige: 1, teamId: team?.id || null, payoutPerRace: _randInt(20, 60) * 10 });
        summary.brands++;
    }

    if (personas.length) await DB.batchCreate('roleProfiles', personas);
    if (brandDocs.length) await DB.batchCreate('sponsors', brandDocs);
    return summary;
}
window.generatePersonaWorld = generatePersonaWorld;

/* ---------------- Market: hiring & contracts ---------------- */
const Market = {
    // NPCs accept any offer at or above this share of their asking salary.
    MIN_OFFER_RATIO: 0.85,

    _ratingChip(r) { return r ? `<span class="chip rating-chip" title="Skill rating">⭐ ${r}</span>` : ''; },

    // Prestige makes people expensive: base rating salary × star multiplier.
    askingFor(person, kind, stars = 1) {
        const base = person.askingSalary || (kind === 'driver'
            ? driverAskingSalary(person.rating || 70)
            : staffAskingSalary(person.role, person.rating || 70));
        return Math.round(base * Prestige.multiplier(stars) / 10) * 10;
    },

    // Stars for a market listing: drivers earn theirs on track, staff/others
    // carry a stored level.
    starsFor(person, kind, world, rows) {
        return kind === 'driver' ? Prestige.driverStars(person.id, world, rows) : Prestige.stored(person);
    },

    /* ----- Free agent market (team owners) ----- */
    async hireModal(teamId) {
        const [drivers, staff, world] = await Promise.all([
            DB.drivers({ force: true }),
            DB.list('staff', { force: true }).catch(() => []),
            DB.loadWorld()
        ]);
        const rows = Stats.driverTable(world.races, world);
        const teamStars = Prestige.teamStars(teamId, world);
        // Free agents only: no team and not another player's driver.
        const freeDrivers = drivers.filter(d => !d.teamId && !d.ownerUid);
        const freeCrew = staff.filter(s => !s.teamId);

        const row = (p, kind) => {
            const info = kind === 'staff' ? staffRoleInfo(p.role) : null;
            const stars = this.starsFor(p, kind, world, rows);
            const asking = this.askingFor(p, kind, stars);
            const outOfReach = stars > teamStars + 1;
            return `<div class="race-row">
                <div class="driver-hero-num" style="font-size:1rem;min-width:2.6rem;height:2.6rem">${kind === 'driver' ? (p.number ? '#' + Util.esc(String(p.number)) : '🏎️') : info.icon}</div>
                <div class="race-row-main">
                    <span class="race-title">${Util.esc(p.name)} ${Prestige.chip(stars)}</span>
                    <span class="race-sub">${kind === 'driver' ? 'Driver' : Util.esc(info.label)}${p.country ? ' · ' + Util.esc(p.country) : ''}${outOfReach ? ' · 🔒 needs a more prestigious team' : ''}</span>
                </div>
                <div class="race-row-side">
                    ${this._ratingChip(p.rating)}
                    <span class="market-price">${Economy.fmt(asking)}/race</span>
                    <button class="btn btn-primary btn-sm" onclick="Market.negotiate('${kind}','${Util.attr(p.id)}','${Util.attr(teamId)}')">Hire</button>
                </div>
            </div>`;
        };

        if (!freeDrivers.length && !freeCrew.length) {
            Modal.open(`
                ${Modal.header('🤝 Free Agent Market', 'Nobody is available right now')}
                ${C.empty('🤖', 'The market is empty', 'Ask the Game Master to generate free agents (Admin → Overview → Generate Free Agents), then come back to build your roster.',
                    Auth.isAdmin() ? `<button class="btn btn-primary" onclick="Modal.close();Admin.generateNPCsForm()">Generate Free Agents</button>` : '')}
            `);
            return;
        }

        Modal.open(`
            ${Modal.header('🤝 Free Agent Market', 'Hire drivers and pit crew — you set the pay, they sign a season contract')}
            <p class="muted small">💵 Your balance: <strong>${Economy.fmt(Economy.balance())}</strong> · Signing bonus = one race of salary, paid up front.
                Your team's prestige: <strong>${Prestige.stars(teamStars)}</strong> — stars set what talent will sign for you and what they cost.</p>
            ${freeDrivers.length ? `<h3 class="section-label">🏎 Drivers (${freeDrivers.length})</h3>
                <div class="stack" style="gap:.15rem">${freeDrivers.map(d => row(d, 'driver')).join('')}</div>` : ''}
            ${freeCrew.length ? `<h3 class="section-label" style="margin-top:1rem">🧰 Pit Crew & Staff (${freeCrew.length})</h3>
                <div class="stack" style="gap:.15rem">${freeCrew.map(s => row(s, 'staff')).join('')}</div>` : ''}
        `, { wide: true });
    },

    /* ----- Salary negotiation ----- */
    async negotiate(kind, personId, teamId) {
        const collection = kind === 'driver' ? 'drivers' : 'staff';
        const [person, team, world] = await Promise.all([
            DB.get(collection, personId),
            DB.get('teams', teamId).catch(() => null),
            DB.loadWorld()
        ]);
        if (!person) { Util.notify('That free agent is no longer available.', 'error'); return; }
        if (person.teamId) { Util.notify(`${person.name} already signed elsewhere.`, 'info'); return; }

        // Prestige gate: stars only sign for teams within one star of their level.
        const stars = this.starsFor(person, kind, world, Stats.driverTable(world.races, world));
        const teamStars = Prestige.teamStars(teamId, world);
        if (stars > teamStars + 1) {
            Modal.open(`
                ${Modal.header(`🔒 ${Util.esc(person.name)} isn't interested`, 'Prestige gap')}
                <p class="muted">${Util.esc(person.name)} is a <strong>${Prestige.stars(stars)}</strong> talent, and
                ${Util.esc(team?.name || 'your team')} is currently <strong>${Prestige.stars(teamStars)}</strong>.
                Stars only sign for teams within one star of their level — win races, take podiums, and collect
                championships to raise your team's prestige, then come back with the contract.</p>
                <div class="modal-actions"><button class="btn btn-primary" onclick="Modal.close()">Understood</button></div>
            `);
            return;
        }

        const asking = this.askingFor(person, kind, stars);
        const cap = Economy.payCap(stars);
        const roleLabel = kind === 'driver' ? 'Driver' : staffRoleInfo(person.role).label;

        Modal.open(`
            ${Modal.header(`✍️ Contract Offer — ${Util.esc(person.name)}`, `${roleLabel} · asking ${Economy.fmt(asking)} per race`)}
            <form id="offer-form" class="form-grid">
                <div class="chip-row">
                    ${Prestige.chip(stars)}
                    ${this._ratingChip(person.rating)}
                    ${person.country ? `<span class="chip chip-dim">${Util.esc(person.country)}</span>` : ''}
                    <span class="chip chip-dim">Season contract</span>
                </div>
                <label class="field"><span>Salary per race (your offer)</span>
                    <input id="offer-salary" class="input" type="number" min="0" max="${cap}" step="10" value="${Math.min(asking, cap)}" required></label>
                <p class="muted small">They'll accept a fair offer — lowball and they'll counter. 📜 League rule: pay can never exceed
                    a talent's prestige level (${Economy.capLine(stars)}). Signing bonus (one race of salary) is paid from your
                    team's budget of <strong>${Economy.fmt(Wallet.teamBalance(teamId))}</strong> when they sign — never your personal wallet.</p>
                <p id="offer-error" class="form-error"></p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Offer Contract ✍️</button>
                </div>
            </form>
        `);

        Util.$('#offer-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type=submit]');
            const errEl = Util.$('#offer-error');
            errEl.textContent = '';
            const offer = Math.round(Number(Util.$('#offer-salary').value) || 0);
            // Round up to $10 so the counter always satisfies the input's step.
            const minAccept = Math.min(Math.ceil(asking * this.MIN_OFFER_RATIO / 10) * 10, cap);

            if (offer > cap) {
                errEl.textContent = `League rule: ${person.name} is ${Prestige.stars(stars)} — nobody may pay them more than ${Economy.fmt(cap)}/race until their prestige rises.`;
                return;
            }
            if (offer < minAccept) {
                Util.$('#offer-salary').value = minAccept;
                errEl.textContent = `${person.name} counters: "${Economy.fmt(minAccept)}/race and I'll sign today." (Offer updated — submit to agree.)`;
                return;
            }
            btn.disabled = true;
            try {
                // The TEAM's budget pays the signing bonus, not the owner's
                // personal wallet — AI free agents have no wallet to credit,
                // so this is a real debit with no counterpart (a sink), same
                // as every other team hiring cost.
                await Wallet.teamSpend(teamId, offer, `Signing bonus: ${person.name}`, '🤝');
                await DB.update(collection, personId, { teamId, salary: offer });
                await DB.create('contracts', {
                    teamId,
                    teamName: team?.name || '',
                    ownerUid: Auth.uid(),
                    personId,
                    personKind: kind,
                    personName: person.name,
                    role: kind === 'driver' ? 'driver' : person.role,
                    salary: offer,
                    exclusive: true,
                    seasonYear: new Date().getFullYear(),
                    status: 'active',
                    signedAt: Util.todayISO()
                });
                News.post('🤝', `${team?.name || 'A team'} signed ${person.name} (${kind === 'driver' ? 'driver' : staffRoleInfo(person.role).label}, ${Economy.fmt(offer)}/race)`);
                Modal.close();
                Util.notify(`${person.name} signed for ${Economy.fmt(offer)}/race! 🤝`);
                App.go('career');
            } catch (err) {
                errEl.textContent = err.message;
                btn.disabled = false;
            }
        });
    },

    /* ----- Releasing a hire (owner's call — always free for them) ----- */
    // Multi-team aware: only this team's contract ends. The person's primary
    // team link moves to their next active contract (or free agency).
    async release(kind, personId, teamId) {
        // Player crew (crew chief / mechanic / agent) live in roleProfiles,
        // AI crew in staff — resolve whichever collection actually has them.
        let collection = kind === 'driver' ? 'drivers' : 'staff';
        let [person, team] = await Promise.all([
            DB.get(collection, personId).catch(() => null),
            DB.get('teams', teamId).catch(() => null)
        ]);
        if (!person && kind !== 'driver') {
            person = await DB.get('roleProfiles', personId).catch(() => null);
            if (person) collection = 'roleProfiles';
        }
        if (!confirm(`Release ${person?.name || 'this person'} from your team? Their contract with you ends.`)) return;
        try {
            const contracts = await DB.contracts({ force: true }).catch(() => []);
            const active = contracts.filter(c => c.personId === personId && c.teamId === teamId && c.status === 'active');
            for (const c of active) await DB.update('contracts', c.id, { status: 'released', endedAt: Util.todayISO() });

            // Primary team link: fall back to another active team contract if they have one.
            if (person && (person.teamId === teamId || !person.teamId)) {
                const other = contracts.find(c => c.personId === personId && c.status === 'active' &&
                    c.teamId !== teamId && c.personKind === kind && c.type !== 'sponsorship');
                const nextTeamId = other?.teamId || null;
                await DB.update(collection, personId, { teamId: nextTeamId });
                if (kind === 'driver' && person?.ownerUid) {
                    if (person.ownerUid === Auth.uid()) await Auth.updateProfile({ teamId: nextTeamId });
                    else await DB.update('users', person.ownerUid, { teamId: nextTeamId }).catch(() => {});
                }
            }
            News.post('👋', `${team?.name || 'A team'} released ${person?.name || 'a team member'}`);
            Util.notify(`${person?.name || 'They'} released. Contract ended.`);
            App.go('career');
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    /* ---------------- Dealership & garage ---------------- */
    SELL_RATIO: 0.6, // cars sell back at 60% of what you paid

    myGarage() { return Array.isArray(Auth.state.profile?.garage) ? Auth.state.profile.garage : []; },

    // The storefront itself is the GM-curated global inventory — see
    // js/srmpc-dealership.js. (This delegate keeps the App.go route and every
    // existing "🏬 Dealership" button working.)
    dealership(el) { return Dealership.storefront(el); },

    // Reusable garage panel — shown at the Dealership AND on the driver page.
    garagePanel() {
        const cars = this.myGarage();
        return `<section class="panel">
            <div class="panel-head"><h2>🚗 My Garage (${cars.length})</h2>
                <button class="btn btn-secondary btn-sm" onclick="App.go('dealership')">🏬 Dealership</button></div>
            ${cars.length ? cars.map(c => `
                <div class="race-row">
                    <div class="driver-hero-num" style="font-size:1.2rem;min-width:2.8rem;height:2.8rem">${c.emoji || '🚗'}</div>
                    <div class="race-row-main">
                        <span class="race-title">${Util.esc(c.name)}</span>
                        <span class="race-sub">${Util.esc(c.tag || '')} · bought ${Util.esc(Util.fmtDateShort(c.boughtAt))} for ${Economy.fmt(c.price)}</span>
                    </div>
                    <button class="btn btn-ghost btn-sm" onclick="Market.sellCar('${Util.attr(c.id)}')">Sell ${Economy.fmt(Math.round(c.price * this.SELL_RATIO))}</button>
                </div>`).join('')
            : C.empty('🏚', 'Your garage is empty', 'Cars you buy at the Dealership live here — take them street racing or lend them to your team.')}
        </section>`;
    },

    async sellCar(carId) {
        try {
            const cars = this.myGarage();
            const car = cars.find(c => c.id === carId);
            if (!car) return;
            const back = Math.round(car.price * this.SELL_RATIO);
            if (!confirm(`Sell your ${car.name} back to the Dealership for ${Economy.fmt(back)}? (You paid ${Economy.fmt(car.price)}.)`)) return;
            // Two isolated writes (garage, then wallet) — matches buyCar's
            // pattern and keeps wallet changes a single-purpose operation.
            await Garage.persistPlayerGarage(cars.filter(c => c.id !== carId));
            await Auth.updateProfile({ balance: Economy.balance() + back });
            Economy.logTx(Auth.uid(), back, '🚗', `Sold ${car.name} (Dealership)`);
            Util.notify(`Sold the ${car.name} for ${Economy.fmt(back)}. 💵`);
            App.go(App.current.view, App.current.param);
        } catch (e) { Util.notify(e.message, 'error'); }
    }
};
window.Market = Market;
