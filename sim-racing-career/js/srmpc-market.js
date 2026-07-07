/* ============================================================
   Phoenix SRMPC — Market & Economy
   Player wallets, NPC free agents (drivers + pit crew),
   hiring with salary negotiation, contracts, and the
   Dealership placeholder.
   ============================================================ */
'use strict';

/* ---------------- Economy ---------------- */
const Economy = {
    // Starting budget granted once, the first time a player picks a role.
    // A Team Owner starts with enough to buy a car and sign a small crew.
    STARTING_BUDGETS: { 'team-owner': 50000, 'driver': 10000 },
    DEFAULT_BUDGET: 5000,

    fmt(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('en-US'); },
    startingFor(roleId) { return this.STARTING_BUDGETS[roleId] ?? this.DEFAULT_BUDGET; },
    balance() { return Number(Auth.state.profile?.balance) || 0; },

    // One-time wallet grant. Returns true if money was granted just now.
    async ensureWallet(roleId) {
        const p = Auth.state.profile;
        if (!p || p.walletInitialized) return false;
        await Auth.updateProfile({ balance: this.startingFor(roleId), walletInitialized: true });
        return true;
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

    askingFor(person, kind) {
        if (person.askingSalary) return person.askingSalary;
        return kind === 'driver'
            ? driverAskingSalary(person.rating || 70)
            : staffAskingSalary(person.role, person.rating || 70);
    },

    /* ----- Free agent market (team owners) ----- */
    async hireModal(teamId) {
        const [drivers, staff] = await Promise.all([
            DB.drivers({ force: true }),
            DB.list('staff', { force: true }).catch(() => [])
        ]);
        // Free agents only: no team and not another player's driver.
        const freeDrivers = drivers.filter(d => !d.teamId && !d.ownerUid);
        const freeCrew = staff.filter(s => !s.teamId);

        const row = (p, kind) => {
            const info = kind === 'staff' ? staffRoleInfo(p.role) : null;
            const asking = this.askingFor(p, kind);
            return `<div class="race-row">
                <div class="driver-hero-num" style="font-size:1rem;min-width:2.6rem;height:2.6rem">${kind === 'driver' ? (p.number ? '#' + Util.esc(String(p.number)) : '🏎️') : info.icon}</div>
                <div class="race-row-main">
                    <span class="race-title">${Util.esc(p.name)}</span>
                    <span class="race-sub">${kind === 'driver' ? 'Driver' : Util.esc(info.label)}${p.country ? ' · ' + Util.esc(p.country) : ''}</span>
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
            <p class="muted small">💵 Your balance: <strong>${Economy.fmt(Economy.balance())}</strong> · Signing bonus = one race of salary, paid up front.</p>
            ${freeDrivers.length ? `<h3 class="section-label">🏎 Drivers (${freeDrivers.length})</h3>
                <div class="stack" style="gap:.15rem">${freeDrivers.map(d => row(d, 'driver')).join('')}</div>` : ''}
            ${freeCrew.length ? `<h3 class="section-label" style="margin-top:1rem">🧰 Pit Crew & Staff (${freeCrew.length})</h3>
                <div class="stack" style="gap:.15rem">${freeCrew.map(s => row(s, 'staff')).join('')}</div>` : ''}
        `, { wide: true });
    },

    /* ----- Salary negotiation ----- */
    async negotiate(kind, personId, teamId) {
        const collection = kind === 'driver' ? 'drivers' : 'staff';
        const person = await DB.get(collection, personId);
        if (!person) { Util.notify('That free agent is no longer available.', 'error'); return; }
        if (person.teamId) { Util.notify(`${person.name} already signed elsewhere.`, 'info'); return; }
        const asking = this.askingFor(person, kind);
        const roleLabel = kind === 'driver' ? 'Driver' : staffRoleInfo(person.role).label;

        Modal.open(`
            ${Modal.header(`✍️ Contract Offer — ${Util.esc(person.name)}`, `${roleLabel} · asking ${Economy.fmt(asking)} per race`)}
            <form id="offer-form" class="form-grid">
                <div class="chip-row">
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
                Modal.close();
                Util.notify(`${person.name} signed for ${Economy.fmt(offer)}/race! 🤝`);
                App.go('career');
            } catch (err) {
                errEl.textContent = err.message;
                btn.disabled = false;
            }
        });
    },

    /* ----- Releasing a hire ----- */
    async release(kind, personId, teamId) {
        const collection = kind === 'driver' ? 'drivers' : 'staff';
        const person = await DB.get(collection, personId);
        if (!confirm(`Release ${person?.name || 'this person'} from your team? They return to the free agent market.`)) return;
        try {
            await DB.update(collection, personId, { teamId: null });
            const contracts = await DB.contracts({ force: true }).catch(() => []);
            const active = contracts.filter(c => c.personId === personId && c.teamId === teamId && c.status === 'active');
            for (const c of active) await DB.update('contracts', c.id, { status: 'released', endedAt: Util.todayISO() });
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
