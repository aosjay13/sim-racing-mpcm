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

    fmt(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('en-US'); },
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
            await Auth.updateProfile({ difficulty: id, balance: d.start, walletInitialized: true });
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
            // Fresh profile.
            await Auth.updateProfile({
                activeRole: null, driverId: null, teamId: null,
                difficulty: diffId, balance: d.start, walletInitialized: true
            });
            Modal.close();
            News.post('🔄', `${name} restarted their career on ${d.icon} ${d.label}`);
            Util.notify(`Career restarted on ${d.label}. Starting budget: ${this.fmt(d.start)}. 🔄`);
            App.go('career');
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    async spend(amount, label) {
        amount = Math.round(Number(amount) || 0);
        const bal = this.balance();
        if (amount > bal) {
            throw new Error(`Not enough funds — ${label} costs ${this.fmt(amount)} but you have ${this.fmt(bal)}.`);
        }
        await Auth.updateProfile({ balance: bal - amount });
    },

    walletChip() {
        if (!Auth.isPlayer() || !Auth.state.profile?.walletInitialized) return '';
        return `<span class="chip wallet-chip" title="Your career balance">💵 ${this.fmt(this.balance())}</span>`;
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
                    <input id="offer-salary" class="input" type="number" min="0" step="10" value="${asking}" required></label>
                <p class="muted small">They'll accept a fair offer — lowball too hard and they'll walk.
                    Signing bonus (one race of salary) is paid from your balance of <strong>${Economy.fmt(Economy.balance())}</strong> when they sign.</p>
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
            const minAccept = Math.ceil(asking * this.MIN_OFFER_RATIO);

            if (offer < minAccept) {
                errEl.textContent = `${person.name} declined — they won't sign for less than ${Economy.fmt(minAccept)} per race.`;
                return;
            }
            btn.disabled = true;
            try {
                await Economy.spend(offer, 'the signing bonus');
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
    async release(kind, personId, teamId) {
        const collection = kind === 'driver' ? 'drivers' : 'staff';
        const [person, team] = await Promise.all([
            DB.get(collection, personId),
            DB.get('teams', teamId).catch(() => null)
        ]);
        if (!confirm(`Release ${person?.name || 'this person'} from your team? They return to the free agent market.`)) return;
        try {
            await DB.update(collection, personId, { teamId: null });
            // A released PLAYER driver also gets their account unlinked.
            if (kind === 'driver' && person?.ownerUid) {
                if (person.ownerUid === Auth.uid()) await Auth.updateProfile({ teamId: null });
                else await DB.update('users', person.ownerUid, { teamId: null }).catch(() => {});
            }
            const contracts = await DB.contracts({ force: true }).catch(() => []);
            const active = contracts.filter(c => c.personId === personId && c.teamId === teamId && c.status === 'active');
            for (const c of active) await DB.update('contracts', c.id, { status: 'released', endedAt: Util.todayISO() });
            News.post('👋', `${team?.name || 'A team'} released ${person?.name || 'a team member'}`);
            Util.notify(`${person?.name || 'They'} released. Contract ended.`);
            App.go('career');
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    /* ---------------- Dealership (placeholder) ---------------- */
    STOCK: {
        new: [
            { emoji: '🏎️', name: 'Phoenix GT-R Street Spec', price: 42000, tag: 'Gran Turismo 7' },
            { emoji: '🚗', name: 'Falcon RS Coupe', price: 38500, tag: 'Forza' },
            { emoji: '🚙', name: 'Vulcan V8 Interceptor', price: 45900, tag: 'Wreckfest' }
        ],
        used: [
            { emoji: '🚘', name: "'09 Boxer Rally Special", price: 8900, tag: 'Used · 88k miles' },
            { emoji: '🚕', name: 'Retired Track Hatch', price: 6500, tag: 'Used · ex-league car' },
            { emoji: '🛻', name: 'Barn-Find Muscle Project', price: 3200, tag: 'Used · needs work' }
        ]
    },

    async dealership(el) {
        if (!Auth.isSignedIn()) {
            el.innerHTML = C.empty('🔒', 'Sign in to visit the Dealership', 'Every player can buy cars here — drivers keep their own garage and can bring cars to a new team.');
            return;
        }
        const carCard = (c) => `
            <div class="car-card">
                <span class="car-emoji">${c.emoji}</span>
                <h3>${Util.esc(c.name)}</h3>
                <div class="chip-row">
                    <span class="chip chip-dim">${Util.esc(c.tag)}</span>
                    <span class="market-price">${Economy.fmt(c.price)}</span>
                </div>
                <button class="btn btn-secondary btn-sm" disabled title="Buying opens with the garage update">🔧 Coming Soon</button>
            </div>`;

        el.innerHTML = `
        <div class="view-head">
            <div><h1>🏬 Dealership</h1><p class="muted">New and used rides for street racing nights — Wreckfest, Forza, Gran Turismo 7, and more.</p></div>
            <div class="btn-row">${Economy.walletChip()}</div>
        </div>

        <div class="warn-banner">🚧 The Dealership is a preview. Browsing is open — buying, selling, and your personal garage arrive in an upcoming update. Any player (not just team owners) will be able to own cars and bring them to a new team.</div>

        <section class="panel" style="margin-bottom:1.1rem">
            <div class="panel-head"><h2>✨ New Cars</h2><span class="chip chip-dim">Factory fresh</span></div>
            <div class="card-grid">${this.STOCK.new.map(carCard).join('')}</div>
        </section>

        <section class="panel" style="margin-bottom:1.1rem">
            <div class="panel-head"><h2>🔑 Used Lot</h2><span class="chip chip-dim">Priced to move</span></div>
            <div class="card-grid">${this.STOCK.used.map(carCard).join('')}</div>
        </section>

        <section class="panel">
            <div class="panel-head"><h2>🚗 My Garage</h2></div>
            ${C.empty('🏚', 'Your garage is empty', 'Cars you buy will live here — take them street racing or lend them to your team.')}
        </section>`;
    }
};
window.Market = Market;
