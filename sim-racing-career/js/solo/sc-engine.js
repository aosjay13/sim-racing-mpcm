/* ============================================================
   Phoenix SRMPC — Solo Career engine
   Pure logic (no DOM): every function takes the save object S
   and mutates it in place. The UI renders from S and persists
   it through SC.Store. Deterministic: all randomness comes from
   the seeded generator stored in S.rng, so a save replays the
   same way and the Node test-suite can run whole 40-season
   careers headlessly.

   Core loop
     newCareer → startSeason → [briefing → completeRound]×N
       → endSeason (postseason: offers, sponsors, awards)
       → advanceSeason → … → retirement (40 seasons max)
   ============================================================ */
'use strict';

(function (root) {
    const SC = root.SC = root.SC || {};
    const E = {};
    const SAVE_VERSION = 1;
    const MAX_SEASONS = 40;

    /* ============================================================
       Random + small helpers
       ============================================================ */
    function rnd(S) {
        let a = S.rng = (S.rng + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    const ri = (S, min, max) => min + Math.floor(rnd(S) * (max - min + 1));
    const rf = (S, min, max) => min + rnd(S) * (max - min);
    const pick = (S, arr) => arr[Math.floor(rnd(S) * arr.length)];
    const gauss = (S) => (rnd(S) + rnd(S) + rnd(S) + rnd(S) - 2) / 0.5774; // ≈ N(0,1)
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const round1 = (v) => Math.round(v * 10) / 10;
    const mean = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    function shuffle(S, arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd(S) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
        return a;
    }
    function weightedPick(S, entries) { // [[item, weight], …]
        const total = entries.reduce((s, e) => s + Math.max(0, e[1]), 0);
        if (total <= 0) return entries.length ? entries[0][0] : null;
        let x = rnd(S) * total;
        for (const [item, w] of entries) { x -= Math.max(0, w); if (x <= 0) return item; }
        return entries[entries.length - 1][0];
    }
    const nid = (S, p) => p + (S.seq++).toString(36);

    function fmtMoney(n, { exact = false } = {}) {
        n = Math.round(Number(n) || 0);
        const neg = n < 0; const a = Math.abs(n);
        let s;
        if (exact || a < 10000) s = '$' + a.toLocaleString('en-US');
        else if (a < 1e6) s = '$' + (a / 1e3).toFixed(a < 1e5 ? 1 : 0).replace(/\.0$/, '') + 'K';
        else if (a < 1e9) s = '$' + (a / 1e6).toFixed(a < 1e7 ? 2 : 1).replace(/\.?0+$/, '') + 'M';
        else s = '$' + (a / 1e9).toFixed(2) + 'B';
        return (neg ? '−' : '') + s;
    }
    SC.fmtMoney = fmtMoney;

    /* ============================================================
       Tunables
       ============================================================ */
    const DIFF = {
        easy: { label: 'Easy', icon: '🟢', money: 1.6, costs: 0.85, offers: 1.25, aiAdj: -3, ownerBudget: 1.1, startPct: [0.35, 0.65], board: 1.3, aiDev: 0.8, rd: 1.15 },
        normal: { label: 'Normal', icon: '🟡', money: 1, costs: 1, offers: 1, aiAdj: 0, ownerBudget: 0.8, startPct: [0.5, 0.8], board: 1, aiDev: 1, rd: 1 },
        hard: { label: 'Hard', icon: '🟠', money: 0.7, costs: 1.1, offers: 0.8, aiAdj: 2, ownerBudget: 0.6, startPct: [0.72, 0.92], board: 0.8, aiDev: 1.25, rd: 0.88 },
        legend: { label: 'Legend', icon: '🔴', money: 0.45, costs: 1.2, offers: 0.65, aiAdj: 4, ownerBudget: 0.45, startPct: [0.9, 1], board: 0.65, aiDev: 1.5, rd: 0.75 }
    };
    E.DIFF = DIFF;

    const ROLES = {
        driver: { label: 'Driver', icon: '🧑‍🚀', desc: 'You race for AI-run teams. Earn a salary, win races, attract sponsors, climb the ladder through contract offers.' },
        owner: { label: 'Owner-Driver', icon: '🏢', desc: 'Found your own team and drive for it. Manage budget, car R&D, facilities, staff, sponsors and your teammate — Motorsport Manager with you behind the wheel.' },
        principal: { label: 'Team Principal', icon: '📋', desc: 'Run a team from the pit wall. Hire drivers, develop the car, keep the board happy. Races are simulated — pure management.' }
    };
    E.ROLES = ROLES;

    // Mean AI driver skill per tier rung (1 = top).
    const TIER_SKILL = { 1: 82, 2: 76, 3: 70, 4: 64, 5: 58, 6: 53, 7: 48, 8: 44 };
    const tierSkill = (t) => TIER_SKILL[clamp(t, 1, 8)];

    const FACILITIES = {
        factory: { label: 'Factory', icon: '🏭', desc: 'Parallel R&D projects (1 slot at L1–2, 2 at L3–4, 3 at L5) and faster builds.' },
        design: { label: 'Design Centre', icon: '📐', desc: '+6% to every R&D gain per level.' },
        windtunnel: { label: 'Wind Tunnel', icon: '🌬️', desc: '+10% aero gains per level.' },
        dyno: { label: 'Powertrain Dyno', icon: '⚡', desc: '+10% engine gains per level.' },
        sim: { label: 'Simulator', icon: '🖥️', desc: 'Sharper setups (lowers your recommended AI) and faster teammate development.' },
        pit: { label: 'Pit Crew Centre', icon: '🔧', desc: 'Cleaner stops and fewer mechanical DNFs.' },
        hospitality: { label: 'Hospitality Suite', icon: '🥂', desc: '+5% sponsor income per level; L3+ opens an extra sponsor slot.' },
        scouting: { label: 'Scouting Dept.', icon: '🔭', desc: 'Reveals true driver ratings (L2) and potential (L3+). More market options.' }
    };
    E.FACILITIES = FACILITIES;

    const AREAS = {
        engine: { label: 'Engine / Power', icon: '⚙️' },
        aero: { label: 'Aerodynamics', icon: '🌬️' },
        chassis: { label: 'Chassis & Mechanical Grip', icon: '🔩' },
        rel: { label: 'Reliability', icon: '🛡️' }
    };
    E.AREAS = AREAS;

    const RD_LEVELS = {
        minor: { label: 'Minor upgrade', cost: 0.022, rounds: 2, gain: [1, 2.6], fail: 0.05 },
        major: { label: 'Major upgrade', cost: 0.06, rounds: 4, gain: [2.2, 5.5], fail: 0.1 },
        breakthrough: { label: 'Breakthrough program', cost: 0.14, rounds: 7, gain: [4.5, 10], fail: 0.25 }
    };
    E.RD_LEVELS = RD_LEVELS;

    const SPONSOR_SLOTS = {
        title: { label: 'Title sponsor', share: 0.22, count: 1 },
        primary: { label: 'Primary sponsor', share: 0.1, count: 2 },
        secondary: { label: 'Associate sponsor', share: 0.035, count: 3 }
    };
    E.SPONSOR_SLOTS = SPONSOR_SLOTS;

    const RACE_LENGTHS = [
        { v: 1, label: '100% (real distance)' }, { v: 0.75, label: '75%' }, { v: 0.5, label: '50%' },
        { v: 0.25, label: '25%' }, { v: 0.1, label: '10% (sprint)' }
    ];
    E.RACE_LENGTHS = RACE_LENGTHS;
    const SEASON_LENGTHS = [
        { v: 'full', label: 'Full real-world calendar' }, { v: 'half', label: 'Half season' },
        { v: 'short', label: 'Short season (≈8 rounds)' }, { v: 'mini', label: 'Mini season (≈5 rounds)' }
    ];
    E.SEASON_LENGTHS = SEASON_LENGTHS;

    const DAMAGE = { none: 0, light: 0.12, heavy: 0.45, totaled: 1.2 };
    E.DAMAGE = DAMAGE;

    /* ============================================================
       Game / series / track lookups (custom-aware)
       ============================================================ */
    function gameOf(S) { return S.customGame || SC.game(S.gameId); }
    function seriesDef(S, sid) { return (gameOf(S)?.series || []).find(s => s.id === sid) || null; }
    function trackInfo(S, name) {
        return (S.customTracks && S.customTracks[name]) || SC.track(name);
    }
    function typeInfo(type) { return SC.TRACK_TYPES[type] || SC.TRACK_TYPES.rd; }
    function gridFor(S, sd) {
        const g = gameOf(S);
        return clamp(Math.min(sd.grid || 20, g.maxGrid || 60, S.settings.maxGrid || 99), 4, 60);
    }
    function tierSalary(sd) { return Math.max(1500, sd.budget * 0.08); }
    function seriesRounds(S, sid) { return S.season?.others?.[sid]?.total || 0; }
    E.gameOf = gameOf; E.seriesDef = seriesDef; E.trackInfo = trackInfo; E.typeInfo = typeInfo; E.tierSalary = tierSalary;

    /* ============================================================
       Name generation
       ============================================================ */
    function natFor(S) {
        const mix = SC.NATION_MIX[S.gameId];
        if (mix) return weightedPick(S, Object.entries(mix).filter(([k]) => SC.NATIONS[k]));
        return pick(S, Object.keys(SC.NATIONS));
    }
    function personName(S, nat) {
        const n = SC.NATIONS[nat] || SC.NATIONS.USA;
        for (let tries = 0; tries < 12; tries++) {
            const first = pick(S, n.first), last = pick(S, n.last);
            const key = first + ' ' + last;
            if (!S.usedNames[key]) { S.usedNames[key] = 1; return { first, last }; }
        }
        const first = pick(S, n.first), last = pick(S, n.last) + ' ' + String.fromCharCode(65 + ri(S, 0, 25)) + '.';
        return { first, last };
    }
    function teamName(S, ladder) {
        const styles = SC.TEAM_STYLE[ladder] || SC.TEAM_STYLE.custom;
        for (let tries = 0; tries < 20; tries++) {
            const nat = natFor(S);
            const n = SC.NATIONS[nat];
            const name = pick(S, styles)(pick(S, SC.TEAM_WORDS), pick(S, n.last), pick(S, SC.TEAM_PLACES), pick(S, n.last));
            if (!S.usedTeamNames[name]) { S.usedTeamNames[name] = 1; return { name, nat }; }
        }
        const name = pick(S, SC.TEAM_WORDS) + ' Racing ' + ri(S, 2, 99);
        S.usedTeamNames[name] = 1;
        return { name, nat: natFor(S) };
    }
    function abbr(name) {
        const words = name.replace(/[^\p{L}\s-]/gu, '').split(/[\s-]+/).filter(w => w && !/^(Team|Racing|Motorsports?|GP|Corse|Scuderia|Co)$/i.test(w));
        const w = words.length ? words : name.split(/\s+/);
        return (w.length >= 3 ? w.map(x => x[0]).join('') : w.length === 2 ? w[0].slice(0, 2) + w[1][0] : w[0].slice(0, 3)).toUpperCase().slice(0, 3);
    }
    const COLORS = ['#e10600', '#1e41ff', '#00d2be', '#ff8000', '#006f62', '#2293d1', '#b6babd', '#900000', '#ffd700', '#6cd3bf', '#5e8faa',
        '#c92d4b', '#7c3aed', '#16a34a', '#f97316', '#0ea5e9', '#eab308', '#db2777', '#14b8a6', '#84cc16', '#a16207', '#1d4ed8', '#dc2626', '#059669'];

    /* ============================================================
       World generation
       ============================================================ */
    function makeDriver(S, { tier, quality = 0.5, age = null, ladder = 'gt', nat = null, rookie = false }) {
        nat = nat || natFor(S);
        const young = ladder === 'kart' || ladder === 'formula';
        const a = age != null ? age : rookie ? ri(S, young ? 15 : 17, young ? 20 : 24) : clamp(Math.round(tier <= 2 ? rf(S, 21, 38) : tier <= 4 ? rf(S, 18, 34) : rf(S, 16, 32)), 15, 44);
        const base = tierSkill(tier) + (quality - 0.5) * 16 + gauss(S) * 4.5;
        const skill = clamp(round1(rookie ? base - rf(S, 2, 8) : base), 25, 97);
        const potRoom = a < 22 ? rf(S, 4, 22) : a < 26 ? rf(S, 1, 12) : rf(S, 0, 4);
        const d = {
            id: nid(S, 'd'), ...personName(S, nat), nat, age: a,
            skill, pot: clamp(round1(skill + potRoom), skill, 99),
            cons: clamp(Math.round(50 + (skill - 60) * 0.6 + gauss(S) * 12), 15, 99),
            agg: clamp(Math.round(50 + gauss(S) * 18), 5, 99),
            teamId: null, sid: null, num: null, salary: 0, years: 0, morale: 60,
            car: { st: 0, w: 0, p: 0, pl: 0, t: 0, pts: 0, seasons: 0 }, hist: []
        };
        // Veterans arrive with years of racing behind them (so "rookie" means something).
        if (!rookie) d.car.seasons = Math.max(0, a - ri(S, 16, 20));
        S.drivers[d.id] = d;
        return d;
    }
    function driverName(S, id) {
        if (id === 'P') return playerName(S);
        const d = S.drivers[id] || S.retired[id];
        return d ? `${d.first} ${d.last}` : 'Unknown';
    }
    function playerName(S) { const p = S.player; return `${p.first} ${p.last}`; }
    E.driverName = driverName;

    function makeStaff(S, role, quality = 0.5, tier = 4) {
        const nat = natFor(S);
        const skill = clamp(Math.round(50 + (quality - 0.5) * 50 + gauss(S) * 10), 10, 98);
        const sd = { budget: S._refBudget || 1000000 };
        return {
            id: nid(S, 's'), role, ...personName(S, nat), nat, age: ri(S, 28, 62), skill,
            salary: Math.round(tierSalary(sd) * (role === 'td' ? 0.45 : role === 'commercial' ? 0.25 : role === 'crewchief' ? 0.25 : 0.2) * (0.4 + skill / 90) / 100) * 100,
            years: ri(S, 1, 3)
        };
    }

    function carForQuality(S, q) {
        const b = 42 + q * 40;
        return {
            engine: clamp(round1(b + gauss(S) * 4), 20, 95),
            aero: clamp(round1(b + gauss(S) * 4), 20, 95),
            chassis: clamp(round1(b + gauss(S) * 4), 20, 95),
            rel: clamp(round1(55 + q * 30 + gauss(S) * 5), 25, 97)
        };
    }

    function makeTeam(S, sd, quality, cars) {
        const { name, nat } = teamName(S, sd.ladder);
        const t = {
            id: nid(S, 't'), name, abbr: abbr(name), nat, color: pick(S, COLORS), sid: sd.id,
            make: sd.makes && sd.makes.length ? pick(S, sd.makes) : null,
            cars, drivers: [], prestige: clamp(Math.round(20 + quality * 70 + gauss(S) * 6), 5, 98),
            car: carForQuality(S, quality),
            tech: clamp(Math.round(35 + quality * 55 + gauss(S) * 8), 10, 98),
            ops: clamp(Math.round(35 + quality * 55 + gauss(S) * 8), 10, 98),
            budget: Math.round(sd.budget * (0.55 + quality * 1.05)),
            fund: 0.55 + quality * 1.05, // income level vs the series typical budget
            titles: 0, hist: [], player: false, founded: S.year - ri(S, 1, 45)
        };
        S.teams[t.id] = t;
        return t;
    }

    // Build every championship in the game: teams, drivers, calendars.
    function buildWorld(S) {
        const g = gameOf(S);
        for (const sd of g.series) {
            S._refBudget = sd.budget;
            const grid = gridFor(S, sd);
            const [minT, maxT] = sd.teamSize || [2, 2];
            let remaining = grid;
            const teams = [];
            while (remaining > 0) {
                let cars = ri(S, minT, maxT);
                if (cars > remaining) cars = remaining;
                if (remaining - cars > 0 && remaining - cars < minT) cars = remaining - cars >= 1 && cars + (remaining - cars) <= maxT ? remaining : cars;
                teams.push(cars);
                remaining -= cars;
            }
            // quality descending so the first teams are the big dogs
            const n = teams.length;
            teams.forEach((cars, i) => {
                const q = clamp(1 - i / Math.max(1, n - 1) + gauss(S) * 0.06, 0, 1);
                const t = makeTeam(S, sd, n === 1 ? 0.6 : q, cars);
                for (let c = 0; c < cars; c++) {
                    const d = makeDriver(S, { tier: sd.tier, quality: clamp(q + gauss(S) * 0.18, 0, 1), ladder: sd.ladder });
                    signDriver(S, d, t, ri(S, 1, 3));
                }
            });
            S.series[sd.id] = { id: sd.id, base: baseCalendar(S, sd), champs: [] };
        }
        delete S._refBudget;
        assignNumbers(S);
    }

    function signDriver(S, d, t, years, salary = null) {
        if (d.teamId && S.teams[d.teamId]) {
            const old = S.teams[d.teamId];
            old.drivers = old.drivers.filter(x => x !== d.id);
        }
        d.teamId = t.id; d.sid = t.sid; d.years = years;
        const sd = seriesDef(S, t.sid);
        d.salary = salary != null ? salary : Math.round(tierSalary(sd) * clamp(0.35 + (d.skill - tierSkill(sd.tier) + 8) / 16, 0.25, 3) / 100) * 100;
        if (!t.drivers.includes(d.id)) t.drivers.push(d.id);
    }
    function releaseDriver(S, d) {
        if (d.teamId && S.teams[d.teamId]) {
            const t = S.teams[d.teamId];
            t.drivers = t.drivers.filter(x => x !== d.id);
        }
        d.teamId = null; d.years = 0; d.salary = 0;
    }

    function assignNumbers(S) {
        for (const sid of Object.keys(S.series)) {
            const used = new Set();
            const ds = Object.values(S.drivers).filter(d => d.sid === sid && d.teamId && !d.isPlayer);
            if (S.player.sid === sid && S.player.role !== 'principal') used.add(S.player.num);
            ds.forEach(d => {
                if (d.num && !used.has(d.num)) { used.add(d.num); return; }
                let n; let tries = 0;
                do { n = ri(S, 1, 99); tries++; } while (used.has(n) && tries < 200);
                d.num = n; used.add(n);
            });
        }
    }

    // A series' stable "real world" calendar (drawn once per career).
    function baseCalendar(S, sd) {
        const g = gameOf(S);
        if (sd.cal && sd.cal.length) {
            return sd.cal.map(entry => {
                const [t, laps] = String(entry).split('|');
                return { t, laps: laps ? Number(laps) : null };
            });
        }
        const pool = g.tracks.filter(t => (sd.pool || ['rd']).includes(trackInfo(S, t).type));
        const list = pool.length ? pool : g.tracks.slice();
        const rounds = sd.rounds || Math.min(10, list.length);
        const picked = [];
        const sh = shuffle(S, list);
        for (let i = 0; i < rounds; i++) picked.push({ t: sh[i % sh.length], laps: null });
        return picked;
    }

    function trimCalendar(base, mode) {
        const n = base.length;
        let want = n;
        if (mode === 'half') want = Math.ceil(n / 2);
        else if (mode === 'short') want = Math.min(n, 8);
        else if (mode === 'mini') want = Math.min(n, 5);
        else if (typeof mode === 'number') want = clamp(Math.round(mode), 1, n);
        if (want >= n) return base.slice();
        const out = [];
        for (let i = 0; i < want; i++) out.push(base[Math.round(i * (n - 1) / Math.max(1, want - 1))]);
        return out;
    }

    // Turn a calendar entry into a playable event.
    function makeEvent(S, sd, entry, round, total) {
        const tr = trackInfo(S, entry.t);
        const type = tr.type;
        const len = sd.len || { laps: 20 };
        const pct = S.settings.raceLength || 1;
        let laps = null, mins = null, stages = null;
        if (sd.format === 'rally' || type === 'ry') {
            stages = Math.max(2, Math.round((len.stages || 6) * Math.max(0.35, pct)));
        } else if (type === 'ar') {
            mins = Math.max(3, Math.round((len.mins || 5)));
        } else if (entry.laps) {
            laps = Math.max(1, Math.round(entry.laps * pct));
        } else if (len.laps) {
            laps = Math.max(1, Math.round(len.laps * pct));
        } else if (len.km) {
            laps = Math.max(1, Math.round(len.km / Math.max(0.3, tr.km || 4) * pct));
        } else if (len.mins) {
            mins = Math.max(5, Math.round(len.mins * pct / 5) * 5);
        }
        const format = sd.format === 'derby' || (sd.format === 'mixed' && type === 'ar') ? 'derby'
            : sd.format === 'rally' || type === 'ry' ? 'rally' : 'race';
        // Season runs mid-Feb → end of Nov; dates are cosmetic.
        const start = Date.UTC(S.year, 1, 15), end = Date.UTC(S.year, 10, 30);
        const when = new Date(start + (end - start) * (total <= 1 ? 0 : round / (total - 1)));
        const wx = weatherFor(S, tr, type);
        return {
            r: round + 1, t: entry.t, type, km: tr.km, laps, mins, stages, format, night: !!tr.night,
            date: when.toISOString().slice(0, 10), wx, done: false, res: null, order: null
        };
    }

    function weatherFor(S, tr, type) {
        const rainChance = ['ss', 'ov', 'so', 'dt'].includes(type) ? 0 : (SC.RAIN[tr.country] ?? 0.12);
        const roll = rnd(S);
        const cond = roll < rainChance * 0.55 ? 'Wet' : roll < rainChance ? 'Mixed (rain later)' : rnd(S) < 0.3 ? 'Overcast' : 'Clear';
        const temp = Math.round(cond === 'Wet' ? rf(S, 9, 18) : rf(S, 14, 32));
        return { cond, temp, time: tr.night ? 'Night' : pick(S, ['Afternoon', 'Afternoon', 'Late afternoon', 'Midday']) };
    }

    /* ============================================================
       New career
       ============================================================ */
    E.newCareer = function (opts) {
        const seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 2 ** 31);
        const S = {
            v: SAVE_VERSION, id: opts.id || ('c' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)),
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            gameId: opts.gameId, customGame: opts.customGame || null, customTracks: opts.customTracks || {},
            rng: seed | 0, seq: 1,
            settings: {
                difficulty: opts.difficulty || 'normal',
                raceLength: opts.raceLength || 0.5,
                seasonLength: opts.seasonLength || 'full',
                maxGrid: opts.maxGrid || null,
                aiBase: null,
                reliabilityOrders: opts.reliabilityOrders !== false,
                allowSim: opts.allowSim !== false,
                maxSeasons: MAX_SEASONS
            },
            phase: 'preseason', year: opts.startYear || (gameOf({ gameId: opts.gameId, customGame: opts.customGame })?.era || new Date().getFullYear()),
            seasonNo: 1, startYear: null,
            player: null, teams: {}, drivers: {}, retired: {}, series: {}, staffPool: [],
            season: null, history: [], inbox: [], ledger: [], offers: [], sponsorOffers: [],
            achievements: {}, usedNames: {}, usedTeamNames: {}, regsResetIn: 0, flags: {}
        };
        S.startYear = S.year;
        const g = gameOf(S);
        if (!g) throw new Error('Unknown game.');
        const sd = seriesDef(S, opts.seriesId);
        if (!sd) throw new Error('Pick a starting series.');
        S.settings.aiBase = opts.aiBase != null ? Number(opts.aiBase) : (g.ai.kind === 'steps' ? g.ai.def : g.ai.def);
        S.regsResetIn = ri(S, 5, 8);

        const c = opts.character || {};
        const role = ROLES[opts.role] ? opts.role : 'driver';
        const diff = DIFF[S.settings.difficulty];
        S.player = {
            id: 'P', first: (c.first || 'Rookie').trim(), last: (c.last || 'Driver').trim(), nick: (c.nick || '').trim(),
            nat: c.nat || 'USA', age: clamp(Number(c.age) || 18, 14, 45), num: clamp(Number(c.num) || 7, 0, 999), color: c.color || '#ff3b3b',
            role, teamId: null, sid: sd.id, money: 0,
            dr: round1(clamp(tierSkill(sd.tier) - 3 + (S.settings.difficulty === 'easy' ? 3 : S.settings.difficulty === 'legend' ? -3 : 0), 30, 90)),
            rep: clamp(Math.round(40 - sd.tier * 6 + (S.settings.difficulty === 'easy' ? 6 : 0)), 3, 60),
            attrs: { feedback: ri(S, 35, 55), marketability: ri(S, 30, 55), fitness: ri(S, 45, 65) },
            contract: null, sponsors: [], morale: 70,
            career: { st: 0, w: 0, p: 0, t5: 0, t10: 0, pl: 0, fl: 0, dnf: 0, led: 0, titles: 0, pts: 0, earn: 0, seasons: 0, simmed: 0, best: null, wr: 0 },
            tracks: {}, types: {}, form: [], seriesTitles: {}, retired: false, agent: false, training: null
        };
        S.player.birthYear = S.year - S.player.age;
        S.usedNames[`${S.player.first} ${S.player.last}`] = 1;

        buildWorld(S);
        S.flags.startField = fieldSkillMean(S, sd.id);
        E._placePlayer(S, sd, opts);
        S.staffPool = [];
        refreshStaffPool(S);
        startSeason(S);
        inbox(S, '🏁', `Welcome to ${g.name}`, welcomeText(S), 'news');
        return S;
    };

    function welcomeText(S) {
        const sd = seriesDef(S, S.player.sid);
        const t = S.teams[S.player.teamId];
        const role = S.player.role;
        const lines = [`Season 1 of your career starts in the ${sd.name}.`];
        if (role === 'driver') lines.push(`You've signed with ${t.name} — ${S.player.contract.seasons} season deal worth ${fmtMoney(S.player.contract.salary)}/season${S.player.contract.salary < 0 ? ' (you bring the money)' : ''}.`);
        if (role === 'owner') lines.push(`${t.name} is officially on the entry list. Budget: ${fmtMoney(t.budget)}. Hire a teammate, sign sponsors and start R&D before round 1.`);
        if (role === 'principal') lines.push(`The board of ${t.name} expects a P${S.player.board.target} finish in the teams' championship. Don't let them down.`);
        lines.push(`You have up to ${S.settings.maxSeasons} seasons before this character must retire. Race each round in ${gameOf(S).short}, then log your result here.`);
        return lines.join(' ');
    }

    E._placePlayer = function (S, sd, opts) {
        const P = S.player;
        const diff = DIFF[S.settings.difficulty];
        const teams = teamsIn(S, sd.id).sort((a, b) => b.prestige - a.prestige);
        const salary = tierSalary(sd);
        if (P.role === 'driver') {
            const [lo, hi] = diff.startPct;
            const idx = clamp(Math.round(rf(S, lo, hi) * (teams.length - 1)), 0, teams.length - 1);
            const t = teams[idx];
            const out = t.drivers.map(id => S.drivers[id]).sort((a, b) => a.skill - b.skill)[0];
            if (out) releaseDriver(S, out);
            P.teamId = t.id;
            t.drivers.push('P');
            const payDriver = S.settings.difficulty === 'legend' && sd.tier >= 3;
            P.contract = {
                teamId: t.id, seasons: 2, status: t.cars === 1 ? 'lead' : 'second',
                salary: payDriver ? -Math.round(salary * 0.25 / 100) * 100 : Math.round(salary * (0.35 + (1 - idx / Math.max(1, teams.length - 1)) * 0.3) * diff.money / 100) * 100,
                winBonus: Math.round(salary * 0.04 / 10) * 10, podiumBonus: Math.round(salary * 0.015 / 10) * 10, prizeShare: 0.1
            };
            P.money = Math.max(2000, Math.round(salary * 0.6 * diff.money / 100) * 100);
            if (payDriver) P.money = Math.max(P.money, Math.abs(P.contract.salary) * 1.2);
        } else if (P.role === 'owner') {
            // Found a brand-new team; the weakest AI entry makes room.
            const cars = clamp(Number(opts.cars) || Math.min(2, (sd.teamSize || [2, 2])[1]), 1, Math.max(1, (sd.teamSize || [2, 2])[1]));
            const quality = S.settings.difficulty === 'easy' ? 0.45 : S.settings.difficulty === 'normal' ? 0.3 : S.settings.difficulty === 'hard' ? 0.18 : 0.08;
            const t = makeTeam(S, sd, quality, cars);
            t.name = (opts.teamName || '').trim() || `${P.last} Racing`;
            t.abbr = abbr(t.name);
            t.color = opts.teamColor || P.color;
            t.nat = P.nat; t.player = true; t.founded = S.year; t.prestige = 10;
            if (sd.makes && opts.make && sd.makes.includes(opts.make)) t.make = opts.make;
            t.budget = Math.round(sd.budget * diff.ownerBudget);
            t.fund = 0.6;
            t.facilities = { factory: 1, design: 1, windtunnel: 1, dyno: 1, sim: 1, pit: 1, hospitality: 1, scouting: 1 };
            t.staff = startingStaff(S, sd, 0.35);
            t.sponsors = []; t.rd = []; t.builds = []; t.nextYear = 0;
            freeSeats(S, sd, cars);
            P.teamId = t.id;
            t.drivers.push('P');
            // Teammate(s): best cheap free agents.
            for (let c = 1; c < cars; c++) {
                const fas = freeAgentsFor(S, sd).sort((a, b) => b.skill - a.skill);
                const fa = fas[Math.min(3, fas.length - 1)] || makeDriver(S, { tier: sd.tier, quality: 0.3, ladder: sd.ladder });
                signDriver(S, fa, t, 1);
            }
            P.contract = { teamId: t.id, seasons: 99, status: 'lead', salary: Math.round(salary * 0.2 / 100) * 100, winBonus: 0, podiumBonus: 0, prizeShare: 0, owner: true };
            P.money = Math.max(5000, Math.round(salary * 0.3 * diff.money / 100) * 100);
            const sp = sponsorOffersFor(S, t, 3, true);
            S.sponsorOffers = sp;
        } else {
            // Principal: take over a lower-midfield team.
            const idx = clamp(Math.round(rf(S, 0.55, 0.85) * (teams.length - 1)), 0, teams.length - 1);
            const t = teams[idx];
            t.player = true;
            t.facilities = facilitiesFromLevel(S, t);
            t.staff = startingStaff(S, sd, t.tech / 100);
            t.sponsors = aiSponsorsToReal(S, t);
            t.rd = []; t.builds = []; t.nextYear = 0;
            P.teamId = t.id;
            P.contract = { teamId: t.id, seasons: 3, status: 'principal', salary: Math.round(salary * 0.5 * diff.money / 100) * 100, winBonus: Math.round(salary * 0.02 / 10) * 10, podiumBonus: 0, prizeShare: 0 };
            P.money = Math.max(5000, Math.round(salary * 0.3 * diff.money / 100) * 100);
            P.board = { confidence: 60, target: boardTarget(S, t) };
        }
        if (P.role !== 'principal') {
            const d = S.drivers.P = {
                id: 'P', first: P.first, last: P.last, nat: P.nat, age: P.age, skill: P.dr, pot: 99, cons: 70, agg: 50,
                teamId: P.teamId, sid: sd.id, num: P.num, salary: P.contract.salary, years: P.contract.seasons, isPlayer: true,
                car: { st: 0, w: 0, p: 0, pl: 0, t: 0, pts: 0, seasons: 0 }, hist: []
            };
            d.num = P.num;
        }
        assignNumbers(S);
    };

    function startingStaff(S, sd, q) {
        S._refBudget = sd.budget;
        const st = {
            td: makeStaff(S, 'td', q),
            crewchief: makeStaff(S, 'crewchief', q),
            commercial: makeStaff(S, 'commercial', q),
            engineers: []
        };
        const t = S.teams[S.player?.teamId];
        const cars = t ? t.cars : 2;
        for (let i = 0; i < Math.max(1, cars); i++) st.engineers.push(makeStaff(S, 'engineer', q));
        delete S._refBudget;
        return st;
    }
    function facilitiesFromLevel(S, t) {
        const base = clamp(Math.round(1 + t.tech / 30), 1, 4);
        const f = {};
        Object.keys(FACILITIES).forEach(k => { f[k] = clamp(base + ri(S, -1, 1), 1, 5); });
        return f;
    }
    function aiSponsorsToReal(S, t) {
        const sd = seriesDef(S, t.sid);
        const out = [];
        const brands = shuffle(S, SC.BRANDS);
        const add = (slot, i) => {
            const value = Math.round(sd.budget * SPONSOR_SLOTS[slot].share * (0.5 + t.prestige / 100) / 100) * 100;
            out.push({ id: nid(S, 'sp'), brand: brands[i].name, industry: brands[i].industry, slot, value, seasons: ri(S, 1, 2), obj: null, happy: 60 });
        };
        add('title', 0); add('primary', 1); add('secondary', 2);
        return out;
    }
    function boardTarget(S, t) {
        const ranked = teamsIn(S, t.sid).sort((a, b) => b.prestige - a.prestige);
        const idx = ranked.findIndex(x => x.id === t.id);
        return clamp(idx + 1 - (S.settings.difficulty === 'easy' ? 0 : 1), 1, ranked.length);
    }

    // Remove AI cars so the grid stays the same size when the player's
    // team joins (weakest teams shrink or leave the series).
    function freeSeats(S, sd, need) {
        let guard = 0;
        while (need > 0 && guard++ < 50) {
            const ts = teamsIn(S, sd.id).filter(t => !t.player).sort((a, b) => a.prestige - b.prestige);
            const t = ts[0];
            if (!t) break;
            const ds = t.drivers.map(id => S.drivers[id]).filter(Boolean).sort((a, b) => a.skill - b.skill);
            if (ds.length) releaseDriver(S, ds[0]);
            t.cars -= 1; need -= 1;
            if (t.cars <= 0) {
                // The team folds out of this series — move it to reserve (kept for history).
                t.sid = null; t.folded = S.year;
            }
        }
    }

    function teamsIn(S, sid) { return Object.values(S.teams).filter(t => t.sid === sid && !t.folded); }
    function driversIn(S, sid) {
        const out = [];
        for (const t of teamsIn(S, sid)) for (const id of t.drivers) out.push(id);
        return out;
    }
    E.teamsIn = teamsIn; E.driversIn = driversIn;
    function freeAgentsFor(S, sd) {
        return Object.values(S.drivers).filter(d => !d.teamId && !d.isPlayer && Math.abs(tierOfDriver(S, d) - sd.tier) <= 2);
    }
    function tierOfDriver(S, d) {
        if (d.sid) return seriesDef(S, d.sid)?.tier || 5;
        return d.lastTier || 5;
    }

    /* ============================================================
       Season start
       ============================================================ */
    function startSeason(S) {
        const P = S.player;
        const sd = seriesDef(S, P.sid);
        const cal = trimCalendar(S.series[sd.id].base, S.settings.seasonLength);
        const events = cal.map((e, i) => makeEvent(S, sd, e, i, cal.length));
        const others = {};
        for (const osd of gameOf(S).series) {
            if (osd.id === sd.id) continue;
            const oc = trimCalendar(S.series[osd.id].base, 'full');
            others[osd.id] = { types: oc.map(e => trackInfo(S, e.t).type), total: oc.length, done: 0 };
        }
        S.season = {
            no: S.seasonNo, year: S.year, sid: sd.id, events, round: 0,
            tables: {}, others, started: false, notes: []
        };
        for (const s of gameOf(S).series) S.season.tables[s.id] = { d: {}, t: {} };
        S.phase = 'preseason';
        // Owner / principal: season operating budget top-up happens as races run.
        if (S.settings.reliabilityOrders) events.forEach(ev => rollReliability(S, ev));
        if (!S.sponsorOffers.length && (P.role !== 'driver')) S.sponsorOffers = sponsorOffersFor(S, S.teams[P.teamId], 3);
        if (P.role !== 'principal' && !S.flags.personalSponsorSeason) personalSponsorOffers(S, P.role === 'owner' ? 1 : 2);
        S.flags.personalSponsorSeason = false;
    }
    E.startSeason = startSeason;

    // Lock in the calendar and go racing.
    E.beginSeason = function (S) {
        if (S.phase !== 'preseason') return;
        S.phase = 'season';
        S.season.started = true;
        const P = S.player;
        if (P.role !== 'driver') {
            const t = S.teams[P.teamId];
            const sd = seriesDef(S, t.sid);
            let guard = 0;
            while (t.drivers.length < t.cars && guard++ < 6) {
                // Empty seat on the grid: the team manager signs a one-season stopgap.
                const fas = freeAgentsFor(S, sd).sort((a, b) => E.driverAsk(S, a, sd) - E.driverAsk(S, b, sd));
                const d = fas[Math.min(fas.length - 1, ri(S, 0, 4))] || makeDriver(S, { tier: sd.tier, quality: 0.25, ladder: sd.ladder });
                signDriver(S, d, t, 1, Math.round(E.driverAsk(S, d, sd) * 0.7 / 100) * 100);
                inbox(S, '🪑', `Stopgap signing: ${d.first} ${d.last}`, `A seat was empty at the start of the season, so the team manager signed ${d.first} ${d.last} (skill ${Math.round(d.skill)}) on a one-season deal. Replace them any time from the Market.`, 'team');
            }
            assignNumbers(S);
        }
        inbox(S, '🚦', `Season ${S.seasonNo} is go`, `${S.season.events.length} rounds in the ${seriesDef(S, S.season.sid).name}. First up: ${S.season.events[0].t}.`, 'news');
    };

    // The owner/principal can edit the calendar in preseason.
    E.setCalendar = function (S, entries) {
        if (S.phase !== 'preseason') throw new Error('The calendar is locked once the season starts.');
        const sd = seriesDef(S, S.season.sid);
        const clean = entries.filter(e => e && e.t).slice(0, 60);
        if (!clean.length) throw new Error('A season needs at least one round.');
        S.season.events = clean.map((e, i) => {
            const ev = makeEvent(S, sd, { t: e.t, laps: e.laps || null }, i, clean.length);
            if (e.lapsFixed) ev.laps = e.lapsFixed;
            return ev;
        });
        if (S.settings.reliabilityOrders) S.season.events.forEach(ev => rollReliability(S, ev));
    };

    E.addCustomTrack = function (S, name, type = 'rd', km = 4, country = '') {
        name = String(name || '').trim();
        if (!name) throw new Error('Name the track.');
        if (!SC.TRACK_TYPES[type]) type = 'rd';
        S.customTracks[name] = { name, type, km: Number(km) || 4, country, night: false, mod: true, custom: true };
        return S.customTracks[name];
    };

    /* ============================================================
       Car performance
       ============================================================ */
    function carScore(team, type) {
        const w = typeInfo(type).weights;
        const c = team.car;
        return c.engine * w.engine + c.aero * w.aero + c.chassis * w.chassis;
    }
    function fieldCarMean(S, sid, type) {
        return mean(teamsIn(S, sid).map(t => carScore(t, type)));
    }
    E.carScore = carScore;
    E.fieldCarMean = fieldCarMean;
    function fieldSkillMean(S, sid) {
        const ids = driversIn(S, sid).filter(id => id !== 'P');
        return mean(ids.map(id => S.drivers[id]?.skill || 60));
    }
    E.fieldSkillMean = fieldSkillMean;

    function specOf(S, sid) { return clamp(seriesDef(S, sid)?.spec ?? 0.5, 0.02, 1); }

    /* ============================================================
       Race simulation
       ============================================================ */
    // strategy: { [driverId]: 'push'|'balanced'|'conserve' } (principal/owner teammate orders)
    function simulate(S, sid, ev, fixed = {}) {
        const sd = seriesDef(S, sid);
        const type = ev.type || 'rd';
        const ti = typeInfo(type);
        const spec = specOf(S, sid);
        const fieldCar = fieldCarMean(S, sid, type);
        const derby = ev.format === 'derby';
        const entrants = [];
        for (const t of teamsIn(S, sid)) {
            for (const id of t.drivers) {
                const d = id === 'P' ? S.drivers.P : S.drivers[id];
                if (!d) continue;
                entrants.push({ id, d, t });
            }
        }
        if (entrants.length < 2) return null;
        const strat = fixed.strategy || {};
        const staff = (t, key) => t.staff ? (key === 'engineer' ? mean((t.staff.engineers || []).map(s => s.skill)) : t.staff[key]?.skill || 50) : (key === 'engineer' ? t.tech : t.ops);
        const perf = (e, quali) => {
            const skill = e.id === 'P' ? S.player.dr : e.d.skill;
            const car = (carScore(e.t, type) - fieldCar) * spec * 0.85;
            const eng = (staff(e.t, 'engineer') - 50) * 0.04;
            const ops = quali ? 0 : (staff(e.t, 'crewchief') - 50) * 0.035 + ((e.t.facilities?.pit || 3) - 3) * 0.3;
            const sim = e.t.facilities ? (e.t.facilities.sim - 3) * 0.25 : 0;
            const cons = e.id === 'P' ? 70 : e.d.cons;
            const sd2 = (quali ? 5.5 : 8.5) * (1.25 - cons / 160) * (derby ? 1.6 : 1);
            const push = strat[e.id] === 'push' ? 2 : strat[e.id] === 'conserve' ? -1.5 : 0;
            const aggr = derby ? ((e.id === 'P' ? 55 : e.d.agg) - 50) * 0.08 : 0;
            return skill + car + eng + ops + sim + push + aggr + gauss(S) * sd2;
        };
        // Qualifying / grid
        const q = entrants.map(e => ({ e, v: perf(e, true) })).sort((a, b) => b.v - a.v);
        let grid = q.map(x => x.e.id);
        // Fixed start positions (player / teammate reported)
        const fixedStart = {};
        for (const [id, f] of Object.entries(fixed.byId || {})) if (f.start) fixedStart[id] = clamp(Number(f.start), 1, grid.length);
        if (Object.keys(fixedStart).length) grid = placeFixed(grid, fixedStart);

        // Race: DNFs + pace
        const laps = ev.laps || (ev.mins ? Math.round(ev.mins * 1.2) : ev.stages ? ev.stages : 20);
        const dnf = {};
        const lapsDone = {};
        const racePerf = {};
        for (const e of entrants) {
            racePerf[e.id] = perf(e, false) + (grid.length - grid.indexOf(e.id)) * (derby ? 0 : 0.08);
            if (derby) continue;
            const rel = e.t.car.rel;
            const pitF = e.t.facilities ? 1.15 - e.t.facilities.pit * 0.06 : 1;
            const mech = 0.035 * (1.7 - rel / 100) * pitF;
            const cons = e.id === 'P' ? 70 : e.d.cons;
            const agg = e.id === 'P' ? 50 : e.d.agg;
            const s = strat[e.id] === 'push' ? 1.35 : strat[e.id] === 'conserve' ? 0.75 : 1;
            const crash = ti.dnf * (1.3 - cons / 160) * (0.8 + agg / 250) * s * (ev.wx?.cond === 'Wet' ? 1.4 : 1);
            const roll = rnd(S);
            if (roll < mech) dnf[e.id] = 'mech';
            else if (roll < mech + crash) dnf[e.id] = 'crash';
            if (dnf[e.id]) lapsDone[e.id] = Math.floor(laps * rf(S, 0.05, 0.95));
        }
        // Forced mechanical failure from the pre-race reliability order (AI only here)
        let order;
        const fixedPos = {};
        for (const [id, f] of Object.entries(fixed.byId || {})) {
            if (f.dnf) { dnf[id] = f.dnfReason === 'mech' ? 'mech' : 'crash'; lapsDone[id] = f.lapsDone != null ? Number(f.lapsDone) : Math.floor(laps * 0.5); }
            else { delete dnf[id]; if (f.pos) fixedPos[id] = Number(f.pos); }
        }
        if (fixed.order && fixed.order.length) {
            // Imported classification: listed ids in that order; unlisted AI slot in by pace.
            order = fixed.order.filter(id => entrants.some(e => e.id === id));
            for (const id of order) if (!(fixed.dnfIds || []).includes(id)) delete dnf[id];
            const rest = entrants.filter(e => !order.includes(e.id)).sort((a, b) => racePerf[b.id] - racePerf[a.id]).map(e => e.id);
            order = order.concat(rest);
            (fixed.dnfIds || []).forEach(id => { if (!dnf[id]) { dnf[id] = 'crash'; lapsDone[id] = Math.floor(laps * 0.5); } });
            // Non-DNF entrants must be classified ahead of DNFs.
            const fin = order.filter(id => !dnf[id]);
            const out = order.filter(id => dnf[id]);
            for (const id of Object.keys(dnf)) if (!order.includes(id)) out.push(id);
            order = fin.concat(out.sort((a, b) => (lapsDone[b] || 0) - (lapsDone[a] || 0)));
        } else {
            const finishers = entrants.filter(e => !dnf[e.id]).sort((a, b) => racePerf[b.id] - racePerf[a.id]).map(e => e.id);
            let fin = finishers;
            const nFin = finishers.length;
            const fp = {};
            for (const [id, p] of Object.entries(fixedPos)) fp[id] = clamp(p, 1, nFin);
            if (Object.keys(fp).length) fin = placeFixed(finishers, fp);
            const outs = entrants.filter(e => dnf[e.id]).map(e => e.id).sort((a, b) => (lapsDone[b] || 0) - (lapsDone[a] || 0));
            order = fin.concat(outs);
            if (derby) { // derby: everyone "finishes"; order = survival
                order = entrants.map(e => e.id).sort((a, b) => racePerf[b] - racePerf[a]);
                if (Object.keys(fixedPos).length) order = placeFixed(order, Object.fromEntries(Object.entries(fixedPos).map(([k, v]) => [k, clamp(v, 1, order.length)])));
                Object.keys(dnf).forEach(k => delete dnf[k]);
            }
        }
        // Fastest lap, laps led, wrecks
        const finishersOrder = order.filter(id => !dnf[id]);
        let fl = null;
        const flFixed = Object.entries(fixed.byId || {}).find(([, f]) => f.fl);
        if (flFixed) fl = flFixed[0];
        else if (!derby && finishersOrder.length) {
            const cands = finishersOrder.slice(0, Math.min(8, finishersOrder.length)).filter(id => !(fixed.byId && fixed.byId[id]));
            fl = cands.length ? weightedPick(S, cands.map((id, i) => [id, 8 - i])) : null;
        }
        const led = {};
        if (!derby && ev.format !== 'rally') {
            let remaining = laps;
            for (const [id, f] of Object.entries(fixed.byId || {})) {
                const n = clamp(Number(f.led) || 0, 0, remaining);
                if (n) { led[id] = n; remaining -= n; }
            }
            const leaders = order.slice(0, 5).filter(id => !(fixed.byId && fixed.byId[id]) && !dnf[id]);
            const poleId = grid[0];
            if (!(fixed.byId && fixed.byId[poleId]) && !leaders.includes(poleId)) leaders.push(poleId);
            const winner = order[0];
            if (remaining > 0 && leaders.length) {
                const weights = leaders.map(id => [id, id === winner ? 5 : id === poleId ? 2.5 : 1]);
                const total = weights.reduce((s, w) => s + w[1], 0);
                let given = 0;
                weights.forEach(([id, w], i) => {
                    const n = i === weights.length - 1 ? remaining - given : Math.round(remaining * w / total * rf(S, 0.6, 1.3));
                    const v = clamp(n, 0, remaining - given);
                    if (v > 0) { led[id] = (led[id] || 0) + v; given += v; }
                });
            }
        }
        const wrecks = {};
        if (derby || ev.format === 'race' && ['f8', 'ar'].includes(type)) {
            for (const e of entrants) {
                const f = fixed.byId?.[e.id];
                wrecks[e.id] = f && f.wrecks != null ? Number(f.wrecks) || 0 : Math.max(0, Math.round(rf(S, 0, 3) + ((e.id === 'P' ? 55 : e.d.agg) - 50) / 25));
            }
        }
        return { order, dnf, grid, pole: grid[0], fl, led, wrecks, lapsDone, laps, inc: fixed.inc || {} };
    }
    E.simulate = simulate;

    // Put fixed ids at their requested 1-based positions; others keep order.
    function placeFixed(list, fixedMap) {
        const out = new Array(list.length).fill(null);
        const fixedIds = Object.keys(fixedMap);
        const sorted = fixedIds.sort((a, b) => fixedMap[a] - fixedMap[b]);
        for (const id of sorted) {
            let p = clamp(fixedMap[id], 1, list.length) - 1;
            while (out[p] !== null && p < out.length - 1) p++;
            while (out[p] !== null && p > 0) p--;
            out[p] = id;
        }
        const rest = list.filter(id => !fixedIds.includes(id));
        let k = 0;
        for (let i = 0; i < out.length; i++) if (out[i] === null) out[i] = rest[k++];
        return out.filter(x => x != null);
    }
    E._placeFixed = placeFixed;

    /* ---------------- Points ---------------- */
    function pointsFor(sysId, pos, { dnf = false, pole = false, fl = false, led = 0, mostLed = false, wrecks = 0 } = {}) {
        const sys = SC.POINTS[sysId] || SC.POINTS.f1;
        let pts = 0;
        if (!dnf && pos) pts += sys.table[pos - 1] || 0;
        if (pole && sys.pole) pts += sys.pole;
        if (fl && sys.fl && (!sys.flTop || (!dnf && pos && pos <= sys.flTop))) pts += sys.fl;
        if (led > 0 && sys.led) pts += sys.led;
        if (mostLed && sys.mostLed) pts += sys.mostLed;
        if (wrecks && sys.wreck) pts += wrecks * sys.wreck;
        return pts;
    }
    E.pointsFor = pointsFor;

    // Score a simulated race into the season tables. Returns per-id points.
    function applyRace(S, sid, res) {
        const sd = seriesDef(S, sid);
        const tb = S.season.tables[sid] || (S.season.tables[sid] = { d: {}, t: {} });
        const maxLed = Math.max(0, ...Object.values(res.led));
        const mostLedId = maxLed > 0 ? Object.keys(res.led).find(id => res.led[id] === maxLed) : null;
        const pts = {};
        const teamRace = {};
        res.order.forEach((id, i) => {
            const pos = i + 1;
            const isDnf = !!res.dnf[id];
            const p = pointsFor(sd.points, pos, { dnf: isDnf, pole: res.pole === id, fl: res.fl === id, led: res.led[id] || 0, mostLed: mostLedId === id, wrecks: res.wrecks[id] || 0 });
            pts[id] = p;
            const d = id === 'P' ? S.drivers.P : S.drivers[id];
            const teamId = d?.teamId;
            const row = tb.d[id] || (tb.d[id] = { pts: 0, st: 0, w: 0, p: 0, t5: 0, t10: 0, pl: 0, fl: 0, dnf: 0, led: 0, best: null, sum: 0, fin: 0, wr: 0, team: teamId });
            row.team = teamId;
            row.pts += p; row.st += 1;
            if (isDnf) row.dnf += 1;
            else {
                if (pos === 1) row.w += 1;
                if (pos <= 3) row.p += 1;
                if (pos <= 5) row.t5 += 1;
                if (pos <= 10) row.t10 += 1;
                row.sum += pos; row.fin += 1;
                if (row.best === null || pos < row.best) row.best = pos;
            }
            if (res.pole === id) row.pl += 1;
            if (res.fl === id) row.fl += 1;
            row.led += res.led[id] || 0;
            row.wr += res.wrecks[id] || 0;
            if (teamId) (teamRace[teamId] = teamRace[teamId] || []).push({ p, pos, dnf: isDnf });
            // AI career stats
            if (d && id !== 'P') {
                d.car.st += 1; d.car.pts += p;
                if (!isDnf && pos === 1) d.car.w += 1;
                if (!isDnf && pos <= 3) d.car.p += 1;
                if (res.pole === id) d.car.pl += 1;
            }
        });
        for (const [teamId, arr] of Object.entries(teamRace)) {
            const trow = tb.t[teamId] || (tb.t[teamId] = { pts: 0, w: 0, p: 0, best: null });
            trow.pts += arr.map(x => x.p).sort((a, b) => b - a).slice(0, 2).reduce((a, b) => a + b, 0);
            arr.forEach(x => {
                if (!x.dnf && x.pos === 1) trow.w += 1;
                if (!x.dnf && x.pos <= 3) trow.p += 1;
                if (!x.dnf && (trow.best === null || x.pos < trow.best)) trow.best = x.pos;
            });
        }
        return { pts, mostLedId };
    }

    function standings(S, sid, season = null) {
        const tb = (season || S.season).tables[sid];
        if (!tb) return [];
        const rows = Object.entries(tb.d).map(([id, r]) => ({ id, name: driverName(S, id), ...r, avg: r.fin ? r.sum / r.fin : null }));
        rows.sort((a, b) => b.pts - a.pts || b.w - a.w || b.p - a.p || (a.best ?? 99) - (b.best ?? 99) || a.name.localeCompare(b.name));
        rows.forEach((r, i) => { r.rank = i + 1; });
        return rows;
    }
    function teamStandings(S, sid, season = null) {
        const tb = (season || S.season).tables[sid];
        if (!tb) return [];
        const rows = Object.entries(tb.t).map(([id, r]) => ({ id, name: S.teams[id]?.name || '—', ...r }));
        rows.sort((a, b) => b.pts - a.pts || b.w - a.w || b.p - a.p || (a.best ?? 99) - (b.best ?? 99));
        rows.forEach((r, i) => { r.rank = i + 1; });
        return rows;
    }
    E.standings = standings;
    E.teamStandings = teamStandings;

    /* ============================================================
       Race weekend briefing (what to set up in-game)
       ============================================================ */
    E.nextEvent = function (S) { return S.season?.events?.[S.season.round] || null; };

    function rollReliability(S, ev) {
        if (S.player.role === 'principal') { ev.order = null; return; }
        const t = S.teams[S.player.teamId];
        if (!t || ev.format === 'derby') { ev.order = null; return; }
        const pitF = t.facilities ? 1.15 - t.facilities.pit * 0.06 : 1;
        const p = 0.035 * (1.7 - t.car.rel / 100) * pitF;
        if (rnd(S) < p) {
            const total = ev.laps || ev.stages || ev.mins || 20;
            const at = Math.max(1, Math.round(total * rf(S, 0.25, 0.92)));
            ev.order = { kind: 'retire', at, unit: ev.laps ? 'lap' : ev.stages ? 'stage' : 'minute', part: pick(S, ['engine', 'gearbox', 'hydraulics', 'suspension', 'electrics', 'fuel pump', 'driveshaft']) };
        } else ev.order = null;
    }

    E.recommendAI = function (S, ev) {
        const g = gameOf(S);
        const scale = g.ai;
        const P = S.player;
        const t = S.teams[P.teamId];
        const sid = S.season.sid;
        const lines = [];
        let deltaPts = 0;
        if (t) {
            const spec = specOf(S, sid);
            const mine = carScore(t, ev.type), field = fieldCarMean(S, sid, ev.type);
            const gap = (field - mine) * spec * 0.85;
            deltaPts += gap;
            lines.push(`${gap >= 0 ? '🔻' : '🔺'} Your car is ${Math.abs(mine - field).toFixed(1)} pts ${mine >= field ? 'up on' : 'down on'} the field here (${typeInfo(ev.type).label.toLowerCase()})${spec < 0.2 ? ' — spec series, so it barely matters' : ''}.`);
            const eng = t.staff ? mean((t.staff.engineers || []).map(s => s.skill)) : t.tech;
            const engAdj = -(eng - 50) / 25;
            if (Math.abs(engAdj) >= 0.4) { deltaPts += engAdj; lines.push(`🎧 Race engineer setup work: ${engAdj < 0 ? 'easier' : 'harder'} (${engAdj > 0 ? '+' : ''}${engAdj.toFixed(1)}).`); }
            if (t.facilities && t.facilities.sim > 1) { const a = -(t.facilities.sim - 1) * 0.5; deltaPts += a; lines.push(`🖥️ Simulator prep: ${a.toFixed(1)}.`); }
        }
        // Field strength rises as you climb the ladder.
        const startField = S.flags.startField || (S.flags.startField = fieldSkillMean(S, sid));
        const tierAdj = (fieldSkillMean(S, sid) - startField) * 0.45;
        if (Math.abs(tierAdj) >= 0.5) { deltaPts += tierAdj; lines.push(`🏆 Field strength vs your first series: ${tierAdj > 0 ? 'tougher' : 'softer'} (${tierAdj > 0 ? '+' : ''}${tierAdj.toFixed(1)}).`); }
        const dAdj = DIFF[S.settings.difficulty].aiAdj;
        if (dAdj) { deltaPts += dAdj; lines.push(`${DIFF[S.settings.difficulty].icon} ${DIFF[S.settings.difficulty].label} difficulty (${dAdj > 0 ? '+' : ''}${dAdj}).`); }
        let value, label;
        if (scale.kind === 'steps') {
            const baseIdx = Math.max(0, scale.steps.indexOf(S.settings.aiBase ?? scale.def));
            const idx = clamp(baseIdx + Math.round(deltaPts / 7), 0, scale.steps.length - 1);
            value = scale.steps[idx]; label = value;
        } else {
            const perPt = (scale.max - scale.min) / 60;
            const base = Number(S.settings.aiBase ?? scale.def);
            value = clamp(Math.round(base + deltaPts * perPt), scale.min, scale.max);
            label = `${value}${scale.unit || ''}`;
        }
        return { value, label, setting: scale.label, extra: scale.extra || '', deltaPts: round1(deltaPts), lines };
    };

    E.briefing = function (S, ev) {
        const sd = seriesDef(S, S.season.sid);
        const tr = trackInfo(S, ev.t);
        const P = S.player;
        const t = S.teams[P.teamId];
        const mates = t ? t.drivers.filter(id => id !== 'P').map(id => S.drivers[id]).filter(Boolean) : [];
        const length = ev.stages ? `${ev.stages} stages` : ev.laps ? `${ev.laps} laps` : ev.mins ? `${ev.mins} minutes` : '—';
        return {
            sd, tr, ev, length, grid: driversIn(S, S.season.sid).length,
            ai: E.recommendAI(S, ev), mates, car: sd.car + (t?.make ? ` — ${t.make}` : ''),
            wx: ev.wx, order: ev.order,
            realism: realismHints(sd, ev)
        };
    };

    function realismHints(sd, ev) {
        const h = [];
        if (ev.format === 'derby') h.push('Last car standing — damage on, no respawns.');
        else {
            h.push(sd.tier <= 2 ? 'Damage: Full · Tyre wear: Real · Fuel: Real' : 'Damage: Full or Realistic · Tyre wear & fuel: On');
            if (['ss', 'ov', 'so'].includes(ev.type)) h.push('Yellow flags / cautions: On if your game supports them.');
            if (ev.mins) h.push('Timed race — run it to the flag, then log the classification.');
            if (sd.len?.km && ev.laps) h.push(`Distance scaled to your race-length setting.`);
        }
        return h;
    }

    /* ============================================================
       Completing a round
       input = {
         mode: 'manual' | 'sim' | 'import',
         player: { start, pos, dnf, dnfReason:'crash'|'mech', lapsDone, led, fl, inc, damage, wrecks },
         mates: { [driverId]: same shape } (optional, owner/driver who watched the teammate),
         order: [...ids], dnfIds: [...] (import),
         strategy: { [driverId]: 'push'|'balanced'|'conserve' }
       }
       ============================================================ */
    E.completeRound = function (S, input = {}) {
        if (S.phase === 'preseason') E.beginSeason(S);
        if (S.phase !== 'season') throw new Error('No race to run right now.');
        const ev = E.nextEvent(S);
        if (!ev) throw new Error('The season is already complete.');
        const P = S.player;
        const sid = S.season.sid;
        const mode = input.mode || 'manual';
        if (mode === 'sim' && P.role !== 'principal' && !S.settings.allowSim) throw new Error('Simulating your own races is switched off in Settings.');

        const fixed = { byId: {}, strategy: input.strategy || {} };
        if (P.role !== 'principal' && mode === 'manual' && input.player) {
            const pl = input.player;
            fixed.byId.P = {
                start: pl.start ? Number(pl.start) : null, pos: pl.dnf ? null : Number(pl.pos) || null,
                dnf: !!pl.dnf, dnfReason: pl.dnfReason || 'crash', lapsDone: pl.lapsDone,
                led: Number(pl.led) || 0, fl: !!pl.fl, wrecks: pl.wrecks
            };
            if (ev.format === 'derby' && !fixed.byId.P.pos) {
                // Derbies have no DNF — being wrecked out is your survival position.
                fixed.byId.P.pos = pl.dnf ? driversIn(S, sid).length : null;
                fixed.byId.P.dnf = false;
            }
            if (!fixed.byId.P.dnf && !fixed.byId.P.pos) throw new Error(ev.format === 'derby' ? 'Enter your survival position.' : 'Enter your finishing position (or tick DNF).');
        }
        for (const [id, m] of Object.entries(input.mates || {})) {
            if (!m || (!m.pos && !m.dnf)) continue;
            fixed.byId[id] = { start: m.start || null, pos: m.dnf ? null : Number(m.pos) || null, dnf: !!m.dnf, dnfReason: m.dnfReason || 'crash', led: Number(m.led) || 0, fl: !!m.fl };
        }
        if (mode === 'import') {
            fixed.order = input.order || [];
            fixed.dnfIds = input.dnfIds || [];
            if (input.player) {
                fixed.byId.P = { start: input.player.start || null, led: Number(input.player.led) || 0, fl: !!input.player.fl, wrecks: input.player.wrecks };
            }
        }
        // Enforce the reliability order for the SIMULATED player as well.
        if (mode === 'sim' && ev.order && P.role !== 'principal') fixed.byId.P = { dnf: true, dnfReason: 'mech', lapsDone: ev.order.at };

        const res = simulate(S, sid, ev, fixed);
        if (!res) throw new Error('This series has no grid — something went wrong generating the world.');
        const { pts } = applyRace(S, sid, res);
        ev.done = true;
        ev.res = { order: res.order, dnf: res.dnf, grid: res.grid, pole: res.pole, fl: res.fl, led: res.led, wrecks: res.wrecks, pts, mode };
        const report = { ev, res, pts, lines: [], money: [], mode };

        // Player driving result
        if (P.role !== 'principal') {
            const pos = res.order.indexOf('P') + 1;
            const isDnf = !!res.dnf.P;
            ev.res.player = {
                pos, dnf: isDnf, dnfReason: res.dnf.P || null, start: res.grid.indexOf('P') + 1, pts: pts.P || 0,
                inc: input.player?.inc != null ? Number(input.player.inc) : null, damage: input.player?.damage || 'none',
                led: res.led.P || 0, fl: res.fl === 'P', wrecks: res.wrecks.P || 0, sim: mode === 'sim'
            };
            playerRaceStats(S, ev, report);
        }
        raceEconomy(S, ev, res, report, input);
        teamRaceEffects(S, ev, res, report);
        progressProjects(S, report);
        aiDevelopment(S);
        S.season.round += 1;
        advanceOtherSeries(S);
        midSeasonEvents(S, report);
        raceNews(S, ev, res, report);
        checkAchievements(S, ev);
        if (S.season.round >= S.season.events.length) {
            report.seasonOver = true;
            E.endSeason(S);
        }
        S.updatedAt = new Date().toISOString();
        return report;
    };

    function playerRaceStats(S, ev, report) {
        const P = S.player;
        const pr = ev.res.player;
        const sid = S.season.sid;
        const sd = seriesDef(S, sid);
        const c = P.career;
        const N = ev.res.order.length;
        c.st += 1;
        if (pr.sim) c.simmed += 1;
        if (pr.dnf) c.dnf += 1;
        else {
            if (pr.pos === 1) c.w += 1;
            if (pr.pos <= 3) c.p += 1;
            if (pr.pos <= 5) c.t5 += 1;
            if (pr.pos <= 10) c.t10 += 1;
            if (c.best === null || pr.pos < c.best) c.best = pr.pos;
        }
        if (pr.start === 1) c.pl += 1;
        if (pr.fl) c.fl += 1;
        c.led += pr.led;
        c.pts += pr.pts;
        c.wr += pr.wrecks || 0;
        const tr = P.tracks[ev.t] || (P.tracks[ev.t] = { st: 0, w: 0, p: 0, best: null, sum: 0, fin: 0 });
        tr.st += 1;
        if (!pr.dnf) { tr.sum += pr.pos; tr.fin += 1; if (pr.pos === 1) tr.w += 1; if (pr.pos <= 3) tr.p += 1; if (tr.best === null || pr.pos < tr.best) tr.best = pr.pos; }
        S.drivers.P.car.st += 1;

        // Performance index vs what the car should do → driver rating.
        const t = S.teams[P.teamId];
        const spec = specOf(S, sid);
        const scores = teamsIn(S, sid).map(x => carScore(x, ev.type)).sort((a, b) => a - b);
        const mine = carScore(t, ev.type);
        const carPct = scores.length > 1 ? scores.filter(v => v < mine).length / (scores.length - 1) : 0.5;
        const expected = 0.5 + (carPct - 0.5) * Math.min(1, spec * 1.1);
        let actual = null;
        if (!pr.dnf) actual = N > 1 ? (N - pr.pos) / (N - 1) : 1;
        else if (pr.dnfReason === 'crash') actual = 0.05;
        if (actual !== null) {
            const perf = clamp(50 + (actual - expected) * 100, 0, 100);
            const fieldMean = fieldSkillMean(S, sid);
            const obs = fieldMean + (perf - 50) * 0.45;
            const k = pr.sim ? 0.03 : 0.12;
            const before = P.dr;
            P.dr = round1(clamp(P.dr + (obs - P.dr) * k, 20, 99));
            S.drivers.P.skill = P.dr;
            report.drDelta = round1(P.dr - before);
            report.perf = Math.round(perf);
            const ty = P.types[ev.type] || (P.types[ev.type] = { st: 0, perf: 0 });
            ty.st += 1; ty.perf += perf;
            P.form.push(Math.round(perf)); if (P.form.length > 10) P.form.shift();
            // Reputation: scaled by tier.
            const tierF = 1 + (6 - clamp(sd.tier, 1, 6)) * 0.22;
            let dRep = (perf - 50) / 50 * 0.9 * tierF;
            if (!pr.dnf && pr.pos === 1) dRep += 1.4 * tierF;
            else if (!pr.dnf && pr.pos <= 3) dRep += 0.5 * tierF;
            if (pr.sim) dRep *= 0.4;
            P.rep = round1(clamp(P.rep + dRep, 0, 100));
            report.repDelta = round1(dRep);
        }
        // Team morale in you.
        if (P.role === 'driver') {
            const mates = t.drivers.filter(id => id !== 'P');
            let dm = 0;
            if (!pr.dnf && mates.every(id => ev.res.order.indexOf(id) > ev.res.order.indexOf('P') || ev.res.dnf[id])) dm += 2;
            if (pr.dnf && pr.dnfReason === 'crash') dm -= 4;
            if (pr.damage === 'heavy') dm -= 3;
            if (pr.damage === 'totaled') dm -= 6;
            if (!pr.dnf && pr.pos <= 3) dm += 3;
            P.morale = clamp(Math.round(P.morale + dm), 0, 100);
        }
        // Personal sponsor objective tracking.
        for (const sp of P.sponsors) {
            sp.paid = (sp.paid || 0);
        }
    }

    /* ---------------- Money ---------------- */
    function ledger(S, wallet, amount, label, cat) {
        amount = Math.round(amount);
        if (!amount) return;
        // r: 0 = pre-season, 1..N = the round being settled, N+1 = season end / off-season.
        const r = !S.season || S.phase === 'preseason' ? 0 : S.season.round + 1;
        S.ledger.push({ s: S.seasonNo, r, w: wallet, a: amount, l: label, c: cat });
        if (wallet === 'p') { S.player.money += amount; if (amount > 0) S.player.career.earn += amount; }
        else if (S.teams[S.player.teamId]) S.teams[S.player.teamId].budget += amount;
        if (S.ledger.length > 4000) S.ledger.splice(0, S.ledger.length - 4000);
    }
    E._ledger = ledger;

    function prizeFor(S, sd, pos, N, dnf) {
        const pool = sd.budget * 0.12 * (N / 2) / Math.max(1, S.season.events.length);
        const w = (p) => Math.pow(N - p + 1, 1.35);
        let total = 0;
        for (let i = 1; i <= N; i++) total += w(i);
        const share = dnf ? w(N) * 0.6 : w(pos);
        return pool * share / total;
    }
    E.prizeFor = (S, pos, dnf) => prizeFor(S, seriesDef(S, S.season.sid), pos, driversIn(S, S.season.sid).length, dnf);

    function raceEconomy(S, ev, res, report, input) {
        const P = S.player;
        const sd = seriesDef(S, S.season.sid);
        const rounds = S.season.events.length;
        const N = res.order.length;
        const diff = DIFF[S.settings.difficulty];
        const t = S.teams[P.teamId];
        const raceName = `R${ev.r} ${ev.t}`;

        // ---- Personal wallet ----
        if (P.contract && P.role === 'driver') {
            const c = P.contract;
            if (c.salary > 0) ledger(S, 'p', c.salary / rounds, `Salary — ${t.name}`, 'salary');
            else if (c.salary < 0) ledger(S, 'p', c.salary / rounds, `Seat payment to ${t.name} (paid drive)`, 'salary');
            const pos = res.order.indexOf('P') + 1;
            const dnf = !!res.dnf.P;
            if (!dnf && pos === 1 && c.winBonus) ledger(S, 'p', c.winBonus, `Win bonus — ${raceName}`, 'bonus');
            else if (!dnf && pos <= 3 && c.podiumBonus) ledger(S, 'p', c.podiumBonus, `Podium bonus — ${raceName}`, 'bonus');
            if (c.prizeShare) ledger(S, 'p', prizeFor(S, sd, pos, N, dnf) * c.prizeShare, `Prize-money share — ${raceName}`, 'prize');
        }
        if (P.role === 'principal' && P.contract) {
            ledger(S, 'p', P.contract.salary / rounds, `Principal salary — ${t.name}`, 'salary');
            const best = Math.min(...t.drivers.map(id => res.dnf[id] ? 99 : res.order.indexOf(id) + 1));
            if (best === 1 && P.contract.winBonus) ledger(S, 'p', P.contract.winBonus, `Win bonus — ${raceName}`, 'bonus');
        }
        for (const sp of P.sponsors) {
            ledger(S, 'p', sp.value / rounds, `Personal sponsor — ${sp.brand}`, 'sponsor');
            if (sp.obj) trackObjective(sp, res, 'P');
        }
        // Personal living costs & agent.
        const living = Math.max(2000, tierSalary(sd) * 0.1) * diff.costs;
        ledger(S, 'p', -living / rounds, 'Travel & living costs', 'living');
        if (P.agent && P.contract && P.contract.salary > 0) ledger(S, 'p', -(P.contract.salary / rounds) * 0.08, 'Agent commission (8%)', 'agent');

        // ---- Team wallet (owner / principal) ----
        if (P.role !== 'driver' && t) {
            for (const id of t.drivers) {
                const dnf = !!res.dnf[id];
                const pos = res.order.indexOf(id) + 1;
                ledger(S, 't', prizeFor(S, sd, pos, N, dnf), `Prize money — ${driverName(S, id)} P${dnf ? 'DNF' : pos}`, 'prize');
            }
            const hosp = 1 + ((t.facilities?.hospitality || 1) - 1) * 0.05;
            for (const sp of t.sponsors || []) {
                ledger(S, 't', sp.value / rounds * hosp, `Sponsor — ${sp.brand} (${SPONSOR_SLOTS[sp.slot].label.toLowerCase()})`, 'sponsor');
                if (sp.obj) trackObjective(sp, res, null, t);
            }
            ledger(S, 't', sd.budget * 0.08 / rounds * (t.cars / 2), 'Series participation payment', 'funding');
            const ops = sd.budget * 0.26 / rounds * (t.cars / 2) * diff.costs;
            ledger(S, 't', -ops, `Race operations — travel, tyres, fuel, parts (${t.cars} car${t.cars > 1 ? 's' : ''})`, 'ops');
            // Salaries
            for (const id of t.drivers) {
                if (id === 'P') {
                    if (P.role === 'owner' && P.contract?.salary > 0) {
                        ledger(S, 't', -P.contract.salary / rounds, `Driver fee — ${playerName(S)} (you)`, 'salary');
                        ledger(S, 'p', P.contract.salary / rounds, `Driver fee from ${t.name}`, 'salary');
                    }
                    continue;
                }
                const d = S.drivers[id];
                if (d && d.salary) ledger(S, 't', -d.salary / rounds, `Driver salary — ${d.first} ${d.last}`, 'salary');
                if (d && d.salary < 0) { /* pay driver brought money: already a negative salary = income */ }
            }
            const staffCost = staffList(t).reduce((s, x) => s + (x.salary || 0), 0);
            if (staffCost) ledger(S, 't', -staffCost / rounds, 'Staff payroll', 'staff');
            const facCost = Object.values(t.facilities || {}).reduce((s, l) => s + l, 0) * sd.budget * 0.0035 / rounds;
            if (facCost) ledger(S, 't', -facCost, 'Facility upkeep', 'facilities');
            if (P.role === 'principal') {
                // AI-owned team: the owners inject the season budget per race.
                ledger(S, 't', sd.budget * 0.3 * t.fund / rounds, 'Owner funding', 'funding');
            }
            if (t.budget < 0) ledger(S, 't', t.budget * 0.015, 'Interest on overdraft (1.5%/race)', 'interest');
        }
        // Damage repairs
        const dmg = input.player?.damage;
        if (dmg && DAMAGE[dmg]) {
            const perCar = sd.budget * 0.26 / rounds / 2;
            const cost = perCar * DAMAGE[dmg] * diff.costs;
            if (P.role === 'driver') report.lines.push(`🔧 The team spent ${fmtMoney(cost)} fixing your ${dmg} damage.`);
            else ledger(S, 't', -cost, `Crash repairs (${dmg}) — ${playerName(S)}`, 'repairs');
        }
        // AI mechanical crash repairs for your teammates (owner/principal)
        if (P.role !== 'driver' && t) {
            for (const id of t.drivers) {
                if (id !== 'P' && res.dnf[id] === 'crash') ledger(S, 't', -sd.budget * 0.26 / rounds / 2 * 0.45 * diff.costs, `Crash repairs — ${driverName(S, id)}`, 'repairs');
            }
        }
    }

    function staffList(t) {
        if (!t.staff) return [];
        return [t.staff.td, t.staff.crewchief, t.staff.commercial, ...(t.staff.engineers || [])].filter(Boolean);
    }
    E.staffList = staffList;

    function trackObjective(sp, res, id, team) {
        const o = sp.obj;
        if (!o) return;
        const ids = team ? team.drivers : [id];
        const positions = ids.map(x => res.dnf[x] ? 99 : res.order.indexOf(x) + 1);
        const best = Math.min(...positions);
        if (o.kind === 'win' && best === 1) o.hits = (o.hits || 0) + 1;
        if (o.kind === 'podium' && best <= 3) o.hits = (o.hits || 0) + 1;
        if (o.kind === 'top10' && best <= 10) o.hits = (o.hits || 0) + 1;
        if (o.kind === 'finish' && positions.every(p => p < 99)) o.hits = (o.hits || 0) + 1;
    }

    function teamRaceEffects(S, ev, res, report) {
        const P = S.player;
        const t = S.teams[P.teamId];
        if (!t) return;
        // Drivers on your team grow a little faster with a good simulator.
        if (t.facilities) {
            for (const id of t.drivers) {
                const d = S.drivers[id];
                if (!d || id === 'P') continue;
                if (d.skill < d.pot) d.skill = round1(Math.min(d.pot, d.skill + 0.04 * t.facilities.sim + (d.age < 24 ? 0.05 : 0)));
            }
        }
    }

    /* ---------------- R&D, facilities ---------------- */
    function rdSlots(t) { const f = t.facilities?.factory || 1; return f >= 5 ? 3 : f >= 3 ? 2 : 1; }
    E.rdSlots = rdSlots;

    E.rdCost = function (S, level) {
        const sd = seriesDef(S, S.season.sid);
        return Math.round(sd.budget * RD_LEVELS[level].cost * DIFF[S.settings.difficulty].costs / 100) * 100;
    };
    E.startRD = function (S, area, level) {
        const P = S.player;
        if (P.role === 'driver') throw new Error('Only team owners and principals run R&D.');
        const t = S.teams[P.teamId];
        if (!AREAS[area] && area !== 'next') throw new Error('Pick an area to develop.');
        const L = RD_LEVELS[level];
        if (!L) throw new Error('Pick a program size.');
        if ((t.rd || []).length >= rdSlots(t)) throw new Error(`All ${rdSlots(t)} R&D slot${rdSlots(t) > 1 ? 's are' : ' is'} busy — upgrade the Factory for more.`);
        const cost = E.rdCost(S, level);
        if (t.budget < cost) throw new Error(`Not enough team budget — this program costs ${fmtMoney(cost)}.`);
        const rounds = Math.max(1, Math.round(L.rounds * (1 - ((t.facilities?.factory || 1) - 1) * 0.08)));
        ledger(S, 't', -cost, `R&D: ${L.label} — ${area === 'next' ? "next year's car" : AREAS[area].label}`, 'rd');
        t.rd = t.rd || [];
        t.rd.push({ id: nid(S, 'rd'), area, level, left: rounds, total: rounds });
        return t.rd[t.rd.length - 1];
    };
    function rdGain(S, t, area, level) {
        const L = RD_LEVELS[level];
        const td = t.staff?.td?.skill ?? t.tech;
        let g = rf(S, L.gain[0], L.gain[1]);
        g *= 0.6 + td / 100 * 0.8;
        g *= 1 + ((t.facilities?.design || 1) - 1) * 0.06;
        if (area === 'aero') g *= 1 + ((t.facilities?.windtunnel || 1) - 1) * 0.1;
        if (area === 'engine') g *= 1 + ((t.facilities?.dyno || 1) - 1) * 0.1;
        if (S.player.role !== 'principal' && t.id === S.player.teamId) g *= 1 + (S.player.attrs.feedback - 50) / 250;
        g *= DIFF[S.settings.difficulty].rd;
        if (area !== 'next' && area !== 'rel') {
            // The further ahead of the pack, the harder the next tenth is to find.
            const lead = t.car[area] - mean(teamsIn(S, t.sid).filter(x => x.id !== t.id).map(x => x.car[area]));
            g *= clamp(1 - lead / 25, 0.2, 1.15);
        }
        const failed = rnd(S) < L.fail;
        if (failed) g *= 0.35;
        return { g, failed };
    }
    function progressProjects(S, report) {
        const P = S.player;
        const t = S.teams[P.teamId];
        if (!t || P.role === 'driver') return;
        for (const pj of (t.rd || []).slice()) {
            pj.left -= 1;
            if (pj.left > 0) continue;
            t.rd = t.rd.filter(x => x !== pj);
            const { g, failed } = rdGain(S, t, pj.area, pj.level);
            if (pj.area === 'next') {
                t.nextYear = round1((t.nextYear || 0) + g);
                inbox(S, '📐', `Next-year car program complete`, `The design office banked +${g.toFixed(1)} points for next season's car${failed ? ' (the concept underdelivered)' : ''}.`, 'rd');
                report.lines.push(`📐 Next-year program banked +${g.toFixed(1)}.`);
            } else {
                const before = t.car[pj.area];
                const dim = clamp((100 - before) / 40, 0.2, 1);
                t.car[pj.area] = round1(clamp(before + g * dim, 1, 99));
                const msg = `${AREAS[pj.area].label}: ${before.toFixed(1)} → ${t.car[pj.area].toFixed(1)}${failed ? ' (partial — the part underdelivered on the dyno)' : ''}.`;
                inbox(S, failed ? '⚠️' : '🔬', `${RD_LEVELS[pj.level].label} delivered`, msg, 'rd');
                report.lines.push(`🔬 ${msg}`);
            }
        }
        for (const b of (t.builds || []).slice()) {
            b.left -= 1;
            if (b.left > 0) continue;
            t.builds = t.builds.filter(x => x !== b);
            t.facilities[b.key] = b.to;
            inbox(S, '🏗️', `${FACILITIES[b.key].label} upgraded to level ${b.to}`, FACILITIES[b.key].desc, 'team');
            report.lines.push(`🏗️ ${FACILITIES[b.key].label} is now level ${b.to}.`);
        }
    }

    E.facilityCost = function (S, key) {
        const t = S.teams[S.player.teamId];
        const sd = seriesDef(S, S.season.sid);
        const lvl = t.facilities[key];
        if (lvl >= 5) return null;
        return {
            cost: Math.round(sd.budget * 0.045 * Math.pow(lvl + 1, 1.55) * DIFF[S.settings.difficulty].costs / 1000) * 1000,
            rounds: 2 + lvl, to: lvl + 1,
            upkeep: Math.round(sd.budget * 0.0035 / 100) * 100
        };
    };
    E.upgradeFacility = function (S, key) {
        const P = S.player;
        if (P.role === 'driver') throw new Error('Only team owners and principals manage facilities.');
        const t = S.teams[P.teamId];
        if (!FACILITIES[key]) throw new Error('Unknown facility.');
        if ((t.builds || []).some(b => b.key === key)) throw new Error('That facility is already under construction.');
        if ((t.builds || []).length >= 2) throw new Error('Two construction projects at once is the limit.');
        const c = E.facilityCost(S, key);
        if (!c) throw new Error('Already at the maximum level.');
        if (t.budget < c.cost) throw new Error(`Not enough team budget — the upgrade costs ${fmtMoney(c.cost)}.`);
        ledger(S, 't', -c.cost, `Construction: ${FACILITIES[key].label} → L${c.to}`, 'facilities');
        t.builds = t.builds || [];
        t.builds.push({ key, to: c.to, left: c.rounds });
        return c;
    };

    // AI teams chip away at the car every round, proportional to money + tech.
    function aiDevelopment(S) {
        for (const t of Object.values(S.teams)) {
            if (t.player || !t.sid) continue;
            const sd = seriesDef(S, t.sid);
            const rounds = Math.max(8, S.season.others?.[t.sid]?.total || S.season.events.length || 12);
            const rate = 9.5 / rounds * (0.45 + t.fund * 0.45) * (0.6 + t.tech / 125) * DIFF[S.settings.difficulty].aiDev;
            if (rnd(S) < 0.6) {
                const area = pick(S, ['engine', 'aero', 'chassis', 'chassis', 'rel']);
                const dim = clamp((100 - t.car[area]) / 40, 0.2, 1);
                t.car[area] = round1(clamp(t.car[area] + rate * rf(S, 0.4, 2.2) * dim, 1, 99));
            }
            void sd;
        }
    }

    /* ---------------- Other championships tick along ---------------- */
    function advanceOtherSeries(S) {
        const frac = S.season.round / Math.max(1, S.season.events.length);
        for (const [sid, o] of Object.entries(S.season.others)) {
            const target = Math.round(o.total * frac);
            while (o.done < target) {
                const type = o.types[o.done] || 'rd';
                const sd = seriesDef(S, sid);
                const ev = { type, format: sd.format === 'derby' || (sd.format === 'mixed' && type === 'ar') ? 'derby' : sd.format === 'rally' ? 'rally' : 'race', laps: 20, wx: { cond: 'Clear' } };
                const res = simulate(S, sid, ev, {});
                if (res) applyRace(S, sid, res);
                o.done += 1;
            }
        }
    }
    E._advanceOtherSeries = advanceOtherSeries;

    /* ---------------- Mid-season: approaches, sponsor bumps ---------------- */
    function midSeasonEvents(S, report) {
        const P = S.player;
        const total = S.season.events.length;
        const r = S.season.round;
        if (P.role === 'driver' && total >= 4 && (r === Math.round(total * 0.6))) {
            const offers = generateOffers(S, { mid: true });
            if (offers.length) {
                S.offers = S.offers.filter(o => !o.mid).concat(offers);
                inbox(S, '📨', `${offers.length} team${offers.length > 1 ? 's' : ''} want${offers.length > 1 ? '' : 's'} to talk`, `Word travels fast. ${offers.map(o => S.teams[o.teamId]?.name).join(', ')} ${offers.length > 1 ? 'have' : 'has'} approached your camp about next season. See Contracts.`, 'contract');
            }
        }
        if (P.role !== 'driver' && r === Math.round(total / 2) && rnd(S) < 0.6) {
            const t = S.teams[P.teamId];
            const extra = sponsorOffersFor(S, t, 1);
            if (extra.length) {
                S.sponsorOffers = S.sponsorOffers.concat(extra);
                inbox(S, '🤝', `${extra[0].brand} wants in`, `A mid-season sponsorship offer landed: ${fmtMoney(extra[0].value)}/season as ${SPONSOR_SLOTS[extra[0].slot].label.toLowerCase()}.`, 'sponsor');
            }
        }
        if (P.role === 'driver' && r === Math.round(total / 3) && P.sponsors.length < 3 && rnd(S) < 0.5 + P.attrs.marketability / 200) {
            personalSponsorOffers(S, 1);
        }
        // Training completes
        if (P.training && r >= P.training.until) {
            const tr = TRAINING[P.training.key];
            P.attrs[tr.attr] = clamp(P.attrs[tr.attr] + P.training.gain, 0, 100);
            inbox(S, '🏋️', `${tr.label} complete`, `${tr.attr[0].toUpperCase() + tr.attr.slice(1)} +${P.training.gain}.`, 'team');
            report.lines.push(`🏋️ ${tr.label} complete (+${P.training.gain} ${tr.attr}).`);
            P.training = null;
        }
    }

    function raceNews(S, ev, res, report) {
        const sd = seriesDef(S, S.season.sid);
        const winner = res.order[0];
        const P = S.player;
        const wName = driverName(S, winner);
        const wTeam = S.teams[(winner === 'P' ? S.drivers.P : S.drivers[winner])?.teamId]?.name || '';
        let body = `${wName} (${wTeam}) won round ${ev.r} at ${ev.t}. Pole: ${driverName(S, res.pole)}.`;
        if (P.role !== 'principal') {
            const pr = ev.res.player;
            body += ` You ${pr.dnf ? `retired (${pr.dnfReason === 'mech' ? 'mechanical' : 'accident'})` : `finished P${pr.pos}`} from P${pr.start} for ${pr.pts} pts.`;
        } else {
            const t = S.teams[P.teamId];
            body += ' ' + t.drivers.map(id => `${driverName(S, id)} ${res.dnf[id] ? 'DNF' : 'P' + (res.order.indexOf(id) + 1)}`).join(', ') + '.';
        }
        const st = standings(S, S.season.sid);
        const me = P.role === 'principal' ? null : st.find(r => r.id === 'P');
        if (me) body += ` Championship: P${me.rank}, ${me.pts} pts (leader ${st[0].name} on ${st[0].pts}).`;
        inbox(S, winner === 'P' ? '🏆' : '🏁', `R${ev.r} ${ev.t}: ${winner === 'P' ? 'YOU WIN!' : wName + ' wins'}`, body, 'race');
        report.headline = winner === 'P' ? 'Victory!' : P.role !== 'principal' && !ev.res.player.dnf && ev.res.player.pos <= 3 ? 'Podium!' : '';
        void sd;
    }

    /* ============================================================
       Inbox
       ============================================================ */
    function inbox(S, icon, title, body, kind = 'news') {
        S.inbox.unshift({ id: nid(S, 'm'), s: S.seasonNo, r: S.season ? S.season.round : 0, icon, title, body, kind, read: false });
        if (S.inbox.length > 400) S.inbox.length = 400;
    }
    E.inbox = inbox;
    E.unread = (S) => S.inbox.filter(m => !m.read).length;

    /* ============================================================
       Personal development (driver attributes)
       ============================================================ */
    const TRAINING = {
        fitness: { label: 'Fitness camp', attr: 'fitness', cost: 0.02, rounds: 3, gain: [3, 7], desc: 'Endurance and heat tolerance. Endurance series and long races want fit drivers.' },
        feedback: { label: 'Engineering course', attr: 'feedback', cost: 0.03, rounds: 4, gain: [3, 7], desc: 'Better technical feedback — speeds up your team’s R&D and helps you land seats.' },
        marketability: { label: 'Media training', attr: 'marketability', cost: 0.025, rounds: 3, gain: [3, 8], desc: 'Sponsors love a polished personality: more and bigger personal deals.' }
    };
    E.TRAINING = TRAINING;
    E.trainingCost = (S, key) => Math.round(tierSalary(seriesDef(S, S.player.sid)) * TRAINING[key].cost * 3 / 100) * 100 + 500;
    E.startTraining = function (S, key) {
        const P = S.player;
        const tr = TRAINING[key];
        if (!tr) throw new Error('Pick a program.');
        if (P.training) throw new Error('You are already in a program.');
        if (P.attrs[tr.attr] >= 99) throw new Error('Already maxed out.');
        const cost = E.trainingCost(S, key);
        if (P.money < cost) throw new Error(`Not enough personal money — this costs ${fmtMoney(cost)}.`);
        ledger(S, 'p', -cost, `${tr.label}`, 'training');
        const round = S.season ? S.season.round : 0;
        P.training = { key, until: round + tr.rounds, gain: ri(S, tr.gain[0], tr.gain[1]) };
        return P.training;
    };
    E.toggleAgent = function (S, on) {
        S.player.agent = !!on;
        inbox(S, '🕴️', on ? 'You hired an agent' : 'You let your agent go', on ? 'Your agent takes 8% of salary but gets you more — and better — contract offers.' : 'No more commission — but you negotiate alone now.', 'contract');
    };

    /* ============================================================
       Sponsors
       ============================================================ */
    function objectiveFor(S, t) {
        const sd = seriesDef(S, t.sid);
        const ranked = teamsIn(S, t.sid).sort((a, b) => carScore(b, 'rd') - carScore(a, 'rd'));
        const rank = ranked.findIndex(x => x.id === t.id) + 1;
        const strong = rank <= Math.ceil(ranked.length / 4);
        const mid = rank <= Math.ceil(ranked.length / 2);
        const kinds = strong ? ['win', 'podium', 'champ'] : mid ? ['podium', 'top10', 'champ'] : ['top10', 'finish', 'champ'];
        const kind = pick(S, kinds);
        const n = S.season?.events?.length || 10;
        if (kind === 'champ') return { kind, target: clamp(rank + ri(S, -1, 1), 1, ranked.length), label: null };
        if (kind === 'win') return { kind, target: ri(S, 1, 2), label: null };
        if (kind === 'podium') return { kind, target: clamp(Math.round(n * rf(S, 0.1, 0.3)), 1, n), label: null };
        if (kind === 'top10') return { kind, target: clamp(Math.round(n * rf(S, 0.3, 0.7)), 1, n), label: null };
        return { kind: 'finish', target: clamp(Math.round(n * 0.7), 1, n), label: null };
        void sd;
    }
    function objLabel(o) {
        if (!o) return '—';
        return o.kind === 'champ' ? `Finish P${o.target} or better in the teams' championship`
            : o.kind === 'win' ? `Win ${o.target} race${o.target > 1 ? 's' : ''}`
                : o.kind === 'podium' ? `${o.target} podium finish${o.target > 1 ? 'es' : ''}`
                    : o.kind === 'top10' ? `${o.target} top-10 finish${o.target > 1 ? 'es' : ''}`
                        : `Bring every car home in ${o.target} races`;
    }
    E.objLabel = objLabel;

    function sponsorOffersFor(S, t, count, initial = false) {
        if (!t) return [];
        const sd = seriesDef(S, t.sid);
        const com = t.staff?.commercial?.skill ?? 50;
        const n = count + (com > 70 ? 1 : 0) + ((t.facilities?.hospitality || 1) >= 3 ? 1 : 0);
        const taken = new Set((t.sponsors || []).map(s => s.brand).concat(S.sponsorOffers.map(s => s.brand)));
        const brands = shuffle(S, SC.BRANDS.filter(b => !taken.has(b.name)));
        const out = [];
        const slots = ['title', 'primary', 'primary', 'secondary', 'secondary', 'secondary'];
        for (let i = 0; i < n && i < brands.length; i++) {
            const slot = initial ? slots[i % slots.length] : pick(S, ['primary', 'secondary', 'secondary', 'title']);
            const val = sd.budget * SPONSOR_SLOTS[slot].share * (0.6 + t.prestige / 160) * (0.8 + com / 250) * rf(S, 0.8, 1.2) * DIFF[S.settings.difficulty].money;
            const obj = objectiveFor(S, t);
            out.push({
                id: nid(S, 'so'), brand: brands[i].name, industry: brands[i].industry, slot,
                value: Math.round(val / 100) * 100, bonus: Math.round(val * 0.35 / 100) * 100,
                signing: Math.round(val * 0.08 / 100) * 100, seasons: ri(S, 1, 3), obj, happy: 60
            });
        }
        return out;
    }
    E.sponsorSlotsFree = function (S, t, slot) {
        const max = SPONSOR_SLOTS[slot].count + (slot === 'secondary' && (t.facilities?.hospitality || 1) >= 3 ? 1 : 0);
        return max - (t.sponsors || []).filter(s => s.slot === slot).length;
    };
    E.signSponsor = function (S, offerId) {
        const P = S.player;
        const i = S.sponsorOffers.findIndex(o => o.id === offerId);
        if (i < 0) throw new Error('That offer is gone.');
        const o = S.sponsorOffers[i];
        const t = S.teams[P.teamId];
        if (E.sponsorSlotsFree(S, t, o.slot) <= 0) throw new Error(`No free ${SPONSOR_SLOTS[o.slot].label.toLowerCase()} slot — end a deal first.`);
        S.sponsorOffers.splice(i, 1);
        t.sponsors = t.sponsors || [];
        t.sponsors.push({ ...o, obj: o.obj ? { ...o.obj, hits: 0 } : null, since: S.seasonNo });
        if (o.signing) ledger(S, 't', o.signing, `Signing fee — ${o.brand}`, 'sponsor');
        inbox(S, '🤝', `${o.brand} signed`, `${SPONSOR_SLOTS[o.slot].label}: ${fmtMoney(o.value)}/season for ${o.seasons} season${o.seasons > 1 ? 's' : ''}. Objective: ${objLabel(o.obj)} (bonus ${fmtMoney(o.bonus)}).`, 'sponsor');
    };
    E.dropSponsor = function (S, sponsorId) {
        const t = S.teams[S.player.teamId];
        const sp = (t.sponsors || []).find(s => s.id === sponsorId);
        if (!sp) throw new Error('Sponsor not found.');
        t.sponsors = t.sponsors.filter(s => s !== sp);
        const fee = Math.round(sp.value * 0.25);
        ledger(S, 't', -fee, `Early termination — ${sp.brand}`, 'sponsor');
        return fee;
    };
    E.declineSponsor = function (S, offerId) { S.sponsorOffers = S.sponsorOffers.filter(o => o.id !== offerId); };

    // Personal sponsors (driver role — also available to owner-drivers).
    function personalSponsorOffers(S, count = 2) {
        const P = S.player;
        const sd = seriesDef(S, P.sid);
        const base = tierSalary(sd) * 0.2 * (0.4 + P.rep / 70) * (0.6 + P.attrs.marketability / 100) * DIFF[S.settings.difficulty].money;
        const taken = new Set(P.sponsors.map(s => s.brand).concat(S.sponsorOffers.map(s => s.brand)));
        const brands = shuffle(S, SC.BRANDS.filter(b => !taken.has(b.name)));
        const n = count + (P.attrs.marketability > 70 ? 1 : 0);
        for (let i = 0; i < n && i < brands.length; i++) {
            const val = Math.round(base * rf(S, 0.6, 1.4) / 100) * 100;
            if (val < 200) continue;
            S.sponsorOffers.push({
                id: nid(S, 'so'), personal: true, brand: brands[i].name, industry: brands[i].industry, slot: 'personal',
                value: val, bonus: Math.round(val * 0.3 / 100) * 100, signing: Math.round(val * 0.05 / 100) * 100,
                seasons: ri(S, 1, 2), obj: { kind: pick(S, ['top10', 'podium', 'finish']), target: ri(S, 2, 5) }, happy: 60
            });
        }
    }
    E.signPersonalSponsor = function (S, offerId) {
        const P = S.player;
        const i = S.sponsorOffers.findIndex(o => o.id === offerId && o.personal);
        if (i < 0) throw new Error('That offer is gone.');
        if (P.sponsors.length >= 3) throw new Error('Three personal sponsors is the maximum — drop one first.');
        const o = S.sponsorOffers.splice(i, 1)[0];
        P.sponsors.push({ ...o, obj: o.obj ? { ...o.obj, hits: 0 } : null, since: S.seasonNo });
        if (o.signing) ledger(S, 'p', o.signing, `Signing fee — ${o.brand}`, 'sponsor');
        inbox(S, '🤝', `Personal deal: ${o.brand}`, `${fmtMoney(o.value)}/season for ${o.seasons} season${o.seasons > 1 ? 's' : ''}.`, 'sponsor');
    };

    /* ============================================================
       Staff
       ============================================================ */
    function refreshStaffPool(S) {
        const sd = seriesDef(S, S.player.sid);
        S._refBudget = sd.budget;
        const scout = S.teams[S.player.teamId]?.facilities?.scouting || 1;
        const pool = [];
        for (const role of ['td', 'engineer', 'engineer', 'crewchief', 'commercial']) {
            for (let i = 0; i < 2 + Math.floor(scout / 2); i++) pool.push(makeStaff(S, role, rnd(S)));
        }
        delete S._refBudget;
        S.staffPool = pool;
    }
    E.refreshStaffPool = refreshStaffPool;
    E.hireStaff = function (S, staffId, replaceId = null) {
        const P = S.player;
        if (P.role === 'driver') throw new Error('Drivers don’t hire staff.');
        const t = S.teams[P.teamId];
        const s = S.staffPool.find(x => x.id === staffId);
        if (!s) throw new Error('That person has taken another job.');
        const signOn = Math.round(s.salary * 0.2);
        if (t.budget < signOn) throw new Error(`Not enough budget for the ${fmtMoney(signOn)} signing fee.`);
        let out = null;
        if (s.role === 'engineer') {
            const eng = t.staff.engineers;
            if (eng.length >= Math.max(1, t.cars)) {
                out = eng.find(e => e.id === replaceId) || eng.slice().sort((a, b) => a.skill - b.skill)[0];
                t.staff.engineers = eng.filter(e => e !== out);
            }
            t.staff.engineers.push(s);
        } else {
            out = t.staff[s.role];
            t.staff[s.role] = s;
        }
        S.staffPool = S.staffPool.filter(x => x !== s);
        ledger(S, 't', -signOn, `Signing fee — ${s.first} ${s.last} (${SC.STAFF_ROLES[s.role].label})`, 'staff');
        if (out) {
            const sev = Math.round(out.salary * 0.5 * Math.max(0, out.years - 1) + out.salary * 0.1);
            if (sev) ledger(S, 't', -sev, `Severance — ${out.first} ${out.last}`, 'staff');
        }
        inbox(S, '🤝', `${s.first} ${s.last} joins as ${SC.STAFF_ROLES[s.role].label}`, `Skill ${s.skill}, ${fmtMoney(s.salary)}/season for ${s.years} season${s.years > 1 ? 's' : ''}.${out ? ` ${out.first} ${out.last} leaves.` : ''}`, 'team');
        return s;
    };

    /* ============================================================
       Driver market (owner / principal)
       ============================================================ */
    E.driverAsk = function (S, d, sd) {
        const base = tierSalary(sd);
        const rel = (d.skill - tierSkill(sd.tier) + 8) / 16;
        return Math.max(0, Math.round(base * clamp(0.25 + rel, 0.15, 3.2) / 100) * 100);
    };
    E.marketFor = function (S) {
        const P = S.player;
        const sd = seriesDef(S, S.season.sid);
        const scout = S.teams[P.teamId]?.facilities?.scouting || 1;
        const tierLimit = 2 + (scout >= 3 ? 1 : 0);
        const rows = Object.values(S.drivers).filter(d => !d.isPlayer && !d.retiredFlag && d.teamId !== P.teamId && (!d.teamId || S.teams[d.teamId]?.sid) && Math.abs(tierOfDriver(S, d) - sd.tier) <= tierLimit - 1)
            .map(d => {
                const team = d.teamId ? S.teams[d.teamId] : null;
                const ask = E.driverAsk(S, d, sd);
                const buyout = team ? Math.round(d.salary * Math.max(1, d.years) * 0.6 / 100) * 100 : 0;
                const noise = scout >= 2 ? 0 : 6;
                return {
                    d, team, ask, buyout, series: d.sid ? seriesDef(S, d.sid)?.short : 'Free agent',
                    skillLo: Math.round(d.skill - noise), skillHi: Math.round(d.skill + noise), potVisible: scout >= 3
                };
            });
        rows.sort((a, b) => b.d.skill - a.d.skill);
        return rows.slice(0, 80);
    };
    E.hireDriver = function (S, driverId, { years = 2, salary = null, replaceId = null } = {}) {
        const P = S.player;
        if (P.role === 'driver') throw new Error('Only owners and principals sign drivers.');
        const t = S.teams[P.teamId];
        const sd = seriesDef(S, t.sid);
        const d = S.drivers[driverId];
        if (!d || d.isPlayer) throw new Error('Driver not found.');
        const ask = E.driverAsk(S, d, sd);
        const pay = salary != null ? Math.round(Number(salary)) : ask;
        if (pay < ask * 0.85) {
            // Negotiation: below 85% of the ask they walk.
            throw new Error(`${d.first} ${d.last} wants at least ${fmtMoney(Math.round(ask * 0.85 / 100) * 100)}/season.`);
        }
        const oldTeam = d.teamId ? S.teams[d.teamId] : null;
        const buyout = oldTeam ? Math.round(d.salary * Math.max(1, d.years) * 0.6 / 100) * 100 : 0;
        const signOn = Math.round(pay * 0.1);
        if (t.budget < buyout + signOn) throw new Error(`Need ${fmtMoney(buyout + signOn)} (buyout + signing fee) in the team budget.`);
        let out = null;
        const mates = t.drivers.filter(id => id !== 'P');
        const seats = t.cars - (t.drivers.includes('P') ? 1 : 0);
        if (mates.length >= seats) {
            out = S.drivers[replaceId] && mates.includes(replaceId) ? S.drivers[replaceId] : mates.map(id => S.drivers[id]).sort((a, b) => a.skill - b.skill)[0];
            if (!out) throw new Error('No seat to fill.');
            const sev = Math.round(out.salary * Math.max(0, out.years) * 0.5);
            if (t.budget < buyout + signOn + sev) throw new Error(`Releasing ${out.first} ${out.last} costs ${fmtMoney(sev)} — not enough budget.`);
            if (sev) ledger(S, 't', -sev, `Contract termination — ${out.first} ${out.last}`, 'salary');
            releaseDriver(S, out);
        }
        if (buyout) ledger(S, 't', -buyout, `Buyout paid to ${oldTeam.name} — ${d.first} ${d.last}`, 'salary');
        if (signOn) ledger(S, 't', -signOn, `Signing fee — ${d.first} ${d.last}`, 'salary');
        if (oldTeam) {
            // The AI team backfills from free agents.
            signDriver(S, d, t, clamp(years, 1, 4), pay);
            backfillTeam(S, oldTeam);
        } else signDriver(S, d, t, clamp(years, 1, 4), pay);
        assignNumbers(S);
        inbox(S, '✍️', `${d.first} ${d.last} signed`, `${fmtMoney(pay)}/season for ${years} season${years > 1 ? 's' : ''}.${out ? ` ${out.first} ${out.last} has been released.` : ''}`, 'team');
        return d;
    };
    E.releaseTeamDriver = function (S, driverId) {
        const t = S.teams[S.player.teamId];
        const d = S.drivers[driverId];
        if (!d || !t.drivers.includes(driverId)) throw new Error('Not on your team.');
        const sev = Math.round(d.salary * Math.max(0, d.years) * 0.5);
        if (sev) ledger(S, 't', -sev, `Contract termination — ${d.first} ${d.last}`, 'salary');
        releaseDriver(S, d);
        return sev;
    };
    function backfillTeam(S, t) {
        const sd = seriesDef(S, t.sid);
        if (!sd) return;
        let guard = 0;
        while (t.drivers.length < t.cars && guard++ < 6) {
            const fa = freeAgentsFor(S, sd).sort((a, b) => b.skill - a.skill)[ri(S, 0, 3)] || makeDriver(S, { tier: sd.tier, quality: 0.35, ladder: sd.ladder });
            signDriver(S, fa, t, ri(S, 1, 2));
        }
    }

    /* ============================================================
       Contract offers (driver role)
       ============================================================ */
    function appeal(S) {
        const P = S.player;
        return P.dr + (P.rep - 30) * 0.12 + (P.attrs.marketability - 50) * 0.04 + (P.attrs.feedback - 50) * 0.03 + (P.agent ? 1.5 : 0);
    }
    E.appeal = appeal;

    function generateOffers(S, { mid = false } = {}) {
        const P = S.player;
        const cur = seriesDef(S, P.sid);
        const g = gameOf(S);
        const diff = DIFF[S.settings.difficulty];
        const ap = appeal(S);
        const cands = [];
        for (const sd of g.series) {
            const sameLadder = sd.ladder === cur.ladder;
            const dt = cur.tier - sd.tier; // +1 = one rung up
            if (sameLadder && (dt > 1 || dt < -1)) continue;
            if (!sameLadder && Math.abs(dt) > 0) continue;
            if (!sameLadder && rnd(S) > 0.35) continue;
            for (const t of teamsIn(S, sd.id)) {
                if (t.id === P.teamId) continue;
                const standard = mean(t.drivers.filter(id => id !== 'P').map(id => S.drivers[id]?.skill || tierSkill(sd.tier))) || tierSkill(sd.tier);
                // Big teams are picky: they want someone at least as good as their drivers.
                const need = standard - 3 + (dt > 0 ? 2 : 0) + Math.max(0, t.prestige - 50) / 8;
                const margin = ap - need;
                const chance = clamp(0.25 + margin / 8, 0, 0.9) * diff.offers * (mid ? 0.35 : 1) * (sameLadder ? 1 : 0.6);
                if (rnd(S) > chance) continue;
                cands.push({ sd, t, margin, dt, sameLadder });
            }
        }
        // Current team renewal logic
        cands.sort((a, b) => (b.t.prestige + b.dt * 25 + b.margin * 2) - (a.t.prestige + a.dt * 25 + a.margin * 2));
        const max = mid ? 2 : 2 + (P.agent ? 1 : 0) + (P.rep >= 55 ? 1 : 0);
        const out = [];
        for (const c of cands.slice(0, max)) out.push(makeOffer(S, c.t, c.sd, c.margin, mid));
        return out;
    }
    E._generateOffers = generateOffers;

    function makeOffer(S, t, sd, margin, mid = false) {
        const P = S.player;
        const base = tierSalary(sd);
        const factor = clamp(0.35 + (t.prestige / 100) * 0.5 + margin * 0.05, 0.15, 3) * DIFF[S.settings.difficulty].money * (P.agent ? 1.12 : 1);
        let salary = Math.round(base * factor / 100) * 100;
        let pay = false;
        if (margin < -2 && sd.tier >= 3) { salary = -Math.round(base * clamp(-margin * 0.05, 0.1, 0.6) / 100) * 100; pay = true; }
        const mates = t.drivers.filter(id => id !== 'P').map(id => S.drivers[id]).filter(Boolean);
        const lead = t.cars === 1 || mates.every(d => d.skill < P.dr);
        return {
            id: nid(S, 'of'), teamId: t.id, sid: sd.id, salary, pay, seasons: ri(S, 1, 3), mid,
            status: lead ? 'lead' : 'second', winBonus: Math.round(base * 0.04 / 10) * 10, podiumBonus: Math.round(base * 0.015 / 10) * 10,
            prizeShare: 0.1, interest: clamp(Math.round(50 + margin * 6), 5, 99), countered: 0
        };
    }

    E.acceptOffer = function (S, offerId) {
        const P = S.player;
        const o = S.offers.find(x => x.id === offerId);
        if (!o) throw new Error('That offer has expired.');
        if (o.pay && P.money < Math.abs(o.salary) * 0.5) throw new Error(`This is a paid seat — you need at least ${fmtMoney(Math.abs(o.salary) * 0.5)} in the bank to take it.`);
        P.nextContract = { teamId: o.teamId, sid: o.sid, seasons: o.seasons, status: o.status, salary: o.salary, winBonus: o.winBonus, podiumBonus: o.podiumBonus, prizeShare: o.prizeShare };
        S.offers = [];
        const t = S.teams[o.teamId];
        inbox(S, '✍️', `Signed with ${t.name}`, `${seriesDef(S, o.sid).name} from next season: ${fmtMoney(o.salary)}/season${o.salary < 0 ? ' (paid seat)' : ''}, ${o.seasons} season${o.seasons > 1 ? 's' : ''}, ${o.status === 'lead' ? 'lead driver' : 'second driver'}.`, 'contract');
        return P.nextContract;
    };
    E.declineOffer = function (S, offerId) { S.offers = S.offers.filter(o => o.id !== offerId); };
    // Ask for more: pct 0.1 / 0.2 / 0.35. Returns { ok, offer, walked }.
    E.counterOffer = function (S, offerId, pct = 0.15) {
        const o = S.offers.find(x => x.id === offerId);
        if (!o) throw new Error('That offer has expired.');
        if (o.countered >= 2) throw new Error('They’ve made their final offer.');
        o.countered += 1;
        const chance = clamp(o.interest / 100 - pct * 1.4 + (S.player.agent ? 0.1 : 0), 0.05, 0.95);
        if (rnd(S) < chance) {
            if (o.salary >= 0) o.salary = Math.round(o.salary * (1 + pct) / 100) * 100;
            else o.salary = Math.round(o.salary * (1 - pct) / 100) * 100;
            o.interest = clamp(o.interest - 8, 5, 99);
            return { ok: true, offer: o };
        }
        if (rnd(S) < 0.35 + pct) {
            S.offers = S.offers.filter(x => x !== o);
            return { ok: false, walked: true };
        }
        o.interest = clamp(o.interest - 12, 5, 99);
        return { ok: false, offer: o };
    };

    /* ============================================================
       Season end
       ============================================================ */
    E.endSeason = function (S) {
        if (S.phase === 'postseason') return;
        const P = S.player;
        const g = gameOf(S);
        // Finish any other championships.
        for (const o of Object.values(S.season.others)) o.done = Math.min(o.done, o.total);
        S.season.round = S.season.events.length;
        advanceOtherSeries(S);
        const sid = S.season.sid;
        const sd = seriesDef(S, sid);
        const archive = { no: S.seasonNo, year: S.year, sid, series: sd.name, tier: sd.tier, ladder: sd.ladder, role: P.role, teamId: P.teamId, team: S.teams[P.teamId]?.name || '—', champs: {}, events: [] };

        // Champions everywhere.
        for (const s of g.series) {
            const st = standings(S, s.id);
            const ts = teamStandings(S, s.id);
            if (!st.length) continue;
            const champ = st[0];
            const tchamp = ts[0];
            archive.champs[s.id] = { d: champ.id, dn: champ.name, pts: champ.pts, t: tchamp?.id || null, tn: tchamp?.name || '' };
            S.series[s.id].champs.push({ no: S.seasonNo, year: S.year, d: champ.id, dn: champ.name, t: tchamp?.id, tn: tchamp?.name });
            if (champ.id !== 'P' && S.drivers[champ.id]) S.drivers[champ.id].car.t += 1;
            if (tchamp && S.teams[tchamp.id]) S.teams[tchamp.id].titles += 1;
            // AI driver season history lines
            st.forEach(r => {
                const d = r.id === 'P' ? null : S.drivers[r.id];
                if (d) { d.hist.push({ s: S.seasonNo, sid: s.id, pos: r.rank, pts: r.pts, w: r.w }); if (d.hist.length > 45) d.hist.shift(); d.car.seasons += 1; }
            });
            ts.forEach(r => { const t = S.teams[r.id]; if (t) { t.hist.push({ s: S.seasonNo, sid: s.id, pos: r.rank, pts: r.pts, w: r.w }); if (t.hist.length > 45) t.hist.shift(); } });
        }

        // Player summary
        const st = standings(S, sid);
        const ts = teamStandings(S, sid);
        const me = st.find(r => r.id === 'P');
        const myTeam = ts.find(r => r.id === P.teamId);
        archive.pos = me ? me.rank : null;
        archive.pts = me ? me.pts : 0;
        archive.row = me ? { st: me.st, w: me.w, p: me.p, t5: me.t5, t10: me.t10, pl: me.pl, fl: me.fl, dnf: me.dnf, led: me.led, avg: me.avg, wr: me.wr } : null;
        archive.teamPos = myTeam ? myTeam.rank : null;
        archive.teamPts = myTeam ? myTeam.pts : 0;
        archive.field = st.length;
        archive.top = st.slice(0, 10).map(r => ({ id: r.id, n: r.name, t: S.teams[r.team]?.abbr || '', pts: r.pts, w: r.w }));
        archive.teamTop = ts.slice(0, 10).map(r => ({ id: r.id, n: r.name, pts: r.pts, w: r.w }));
        archive.events = S.season.events.filter(e => e.done).map(e => ({
            r: e.r, t: e.t, type: e.type, order: e.res.order, dnf: e.res.dnf, pole: e.res.pole, fl: e.res.fl,
            p: e.res.player ? { pos: e.res.player.pos, st: e.res.player.start, dnf: e.res.player.dnf, pts: e.res.player.pts, sim: e.res.player.sim } : null
        }));
        const champion = me && me.rank === 1;
        if (P.role !== 'principal') {
            P.career.seasons += 1;
            if (champion) {
                P.career.titles += 1;
                P.seriesTitles[sid] = (P.seriesTitles[sid] || 0) + 1;
                P.rep = clamp(P.rep + 7 * (1 + (6 - clamp(sd.tier, 1, 6)) * 0.2), 0, 100);
                inbox(S, '🏆', `CHAMPION! ${sd.name}`, `You are the ${S.year} ${sd.name} champion with ${me.pts} points and ${me.w} win${me.w === 1 ? '' : 's'}.`, 'news');
            } else if (me && me.rank <= 3) P.rep = clamp(P.rep + 2.5, 0, 100);
            S.drivers.P.car.seasons += 1;
            if (champion) S.drivers.P.car.t += 1;
        } else {
            P.career.seasons += 1;
            if (myTeam && myTeam.rank === 1) { P.career.titles += 1; P.seriesTitles[sid] = (P.seriesTitles[sid] || 0) + 1; }
        }

        // Money: TV / constructors' prize fund.
        const t = S.teams[P.teamId];
        if (t && P.role !== 'driver' && myTeam) {
            const n = ts.length;
            const pool = sd.budget * 0.12 * n;
            const w = (r) => Math.pow(n - r + 1, 1.2);
            let tot = 0; for (let i = 1; i <= n; i++) tot += w(i);
            ledger(S, 't', pool * w(myTeam.rank) / tot, `Championship prize fund — P${myTeam.rank} in the teams' standings`, 'prize');
        }
        // Sponsor objectives & renewals.
        settleSponsors(S, archive, ts);
        // Board (principal)
        if (P.role === 'principal') boardReview(S, myTeam, ts.length, archive);
        // Money snapshot
        const seasonLedger = S.ledger.filter(l => l.s === S.seasonNo);
        archive.money = {
            pIn: seasonLedger.filter(l => l.w === 'p' && l.a > 0).reduce((s, l) => s + l.a, 0),
            pOut: seasonLedger.filter(l => l.w === 'p' && l.a < 0).reduce((s, l) => s + l.a, 0),
            tIn: seasonLedger.filter(l => l.w === 't' && l.a > 0).reduce((s, l) => s + l.a, 0),
            tOut: seasonLedger.filter(l => l.w === 't' && l.a < 0).reduce((s, l) => s + l.a, 0),
            pEnd: P.money, tEnd: t ? t.budget : null
        };
        archive.dr = P.dr; archive.rep = P.rep;
        S.history.push(archive);
        S.phase = 'postseason';
        S.postseason = { awards: seasonAwards(S, sid, st), promotion: promotionStatus(S, myTeam, ts.length) };

        // Overdraft consequences.
        if (t && P.role === 'owner') {
            if (t.budget < 0) {
                S.flags.debtSeasons = (S.flags.debtSeasons || 0) + 1;
                if (S.flags.debtSeasons >= 2) {
                    administration(S);
                } else {
                    inbox(S, '🚨', 'The bank is watching', `${t.name} ended the season ${fmtMoney(t.budget)} in the red. Finish next season in the black or the team goes into administration.`, 'finance');
                }
            } else S.flags.debtSeasons = 0;
        }
        if (t && P.role === 'principal' && t.budget < 0) {
            P.board.confidence = clamp(P.board.confidence - 12, 0, 100);
            inbox(S, '🚨', 'Overspend', `The board is unhappy that ${t.name} finished ${fmtMoney(t.budget)} overdrawn (confidence −12).`, 'board');
            if (P.board.confidence <= 15) P.fired = true;
        }

        // Contracts & offers for next season.
        if (P.role === 'driver') {
            if (P.contract) P.contract.seasons -= 1;
            const renew = P.contract && P.contract.seasons <= 0 && !P.nextContract;
            const offers = generateOffers(S, {});
            // Current team renewal if they still like you.
            const cur = S.teams[P.teamId];
            if (renew && cur && P.morale >= 35) {
                const csd = seriesDef(S, cur.sid);
                const margin = appeal(S) - (mean(cur.drivers.filter(id => id !== 'P').map(id => S.drivers[id]?.skill || 60)) - 3);
                offers.unshift({ ...makeOffer(S, cur, csd, Math.max(margin, 0)), renewal: true });
            }
            // Never leave the player stranded: a backmarker seat always exists.
            if (P.contract && P.contract.seasons <= 0 && !offers.length) {
                const pool = teamsIn(S, P.sid).filter(x => x.id !== P.teamId).sort((a, b) => a.prestige - b.prestige);
                const csd = seriesDef(S, P.sid);
                if (pool[0]) offers.push(makeOffer(S, pool[0], csd, -4));
            }
            // Already signed for next season (mid-season pre-contract)? The market is closed.
            S.offers = P.nextContract ? [] : S.offers.filter(o => o.mid).concat(offers);
            if (S.offers.length) inbox(S, '📨', `${S.offers.length} contract offer${S.offers.length > 1 ? 's' : ''} on the table`, `Review them in Contracts before the new season.${P.contract && P.contract.seasons > 0 ? ` You're still under contract with ${S.teams[P.teamId].name} for ${P.contract.seasons} more season${P.contract.seasons > 1 ? 's' : ''} — moving means they get a buyout.` : ''}`, 'contract');
        }
        // Last season's unsigned offers expire; a fresh batch arrives.
        S.sponsorOffers = [];
        if (P.role !== 'driver') {
            S.sponsorOffers = sponsorOffersFor(S, S.teams[P.teamId], 3);
            refreshStaffPool(S);
        }
        if (P.role !== 'principal') {
            personalSponsorOffers(S, P.role === 'owner' ? 1 : 2);
            S.flags.personalSponsorSeason = true;
        }
        // Retirement check.
        if (S.seasonNo >= S.settings.maxSeasons) {
            S.postseason.mustRetire = true;
            inbox(S, '🎖️', 'The final season is complete', `That's ${S.settings.maxSeasons} seasons. Time to hang up the helmet — head to your retirement ceremony.`, 'news');
        }
        return archive;
    };

    function seasonAwards(S, sid, st) {
        const aw = [];
        if (st[0]) aw.push({ icon: '🏆', label: 'Champion', who: st[0].name, id: st[0].id });
        const mostWins = st.slice().sort((a, b) => b.w - a.w)[0];
        if (mostWins && mostWins.w) aw.push({ icon: '🥇', label: 'Most wins', who: `${mostWins.name} (${mostWins.w})`, id: mostWins.id });
        const poles = st.slice().sort((a, b) => b.pl - a.pl)[0];
        if (poles && poles.pl) aw.push({ icon: '⏱️', label: 'Pole king', who: `${poles.name} (${poles.pl})`, id: poles.id });
        const rookies = st.filter(r => r.id === 'P' ? S.player.career.seasons <= 1 : (S.drivers[r.id]?.car.seasons || 0) <= 1);
        if (rookies[0]) aw.push({ icon: '🌱', label: 'Rookie of the Year', who: rookies[0].name, id: rookies[0].id });
        const clean = st.filter(r => r.st >= 3).sort((a, b) => a.dnf - b.dnf || b.pts - a.pts)[0];
        if (clean) aw.push({ icon: '🧼', label: 'Iron man (fewest DNFs)', who: `${clean.name} (${clean.dnf})`, id: clean.id });
        return aw;
    }

    function settleSponsors(S, archive, ts) {
        const P = S.player;
        const t = S.teams[P.teamId];
        const myRank = ts.find(r => r.id === P.teamId)?.rank || 99;
        const check = (sp, walletKey) => {
            const o = sp.obj;
            let met = false;
            if (o) {
                if (o.kind === 'champ') met = myRank <= o.target;
                else met = (o.hits || 0) >= o.target;
            }
            if (met && sp.bonus) ledger(S, walletKey, sp.bonus, `Objective bonus — ${sp.brand}`, 'sponsor');
            sp.happy = clamp((sp.happy || 60) + (met ? 15 : -12), 0, 100);
            sp.seasons -= 1;
            if (o) o.hits = 0;
            return met;
        };
        if (t && P.role !== 'driver') {
            const keep = [];
            for (const sp of t.sponsors || []) {
                const met = check(sp, 't');
                if (sp.seasons > 0) keep.push(sp);
                else if (sp.happy >= 55 && rnd(S) < 0.75) {
                    sp.seasons = ri(S, 1, 2);
                    sp.value = Math.round(sp.value * (met ? 1.08 : 0.97) / 100) * 100;
                    sp.obj = objectiveFor(S, t); sp.obj.hits = 0;
                    keep.push(sp);
                    inbox(S, '🔁', `${sp.brand} renewed`, `${fmtMoney(sp.value)}/season for ${sp.seasons} more season${sp.seasons > 1 ? 's' : ''}.`, 'sponsor');
                } else inbox(S, '👋', `${sp.brand} leaves`, `Their deal expired and they walked away.`, 'sponsor');
            }
            t.sponsors = keep;
        }
        const pk = [];
        for (const sp of P.sponsors) {
            check(sp, 'p');
            if (sp.seasons > 0) pk.push(sp);
            else if (sp.happy >= 55 && rnd(S) < 0.6) { sp.seasons = ri(S, 1, 2); pk.push(sp); }
        }
        P.sponsors = pk;
    }

    function boardReview(S, myTeam, n, archive) {
        const P = S.player;
        const b = P.board;
        const pos = myTeam ? myTeam.rank : n;
        const diff = pos - b.target;
        const delta = (diff <= -2 ? 25 : diff <= 0 ? 12 : diff === 1 ? -8 : -20) * DIFF[S.settings.difficulty].board;
        b.confidence = clamp(Math.round(b.confidence + delta), 0, 100);
        archive.board = { target: b.target, pos, confidence: b.confidence };
        const t = S.teams[P.teamId];
        if (b.confidence <= 15) {
            P.fired = true;
            inbox(S, '🚪', 'The board has let you go', `P${pos} against a target of P${b.target} was the final straw. Find a new team in Contracts.`, 'board');
        } else {
            inbox(S, '📋', 'Board review', `Target P${b.target}, finished P${pos}. Confidence ${b.confidence}%.`, 'board');
        }
        P.contract.seasons -= 1;
        void t;
    }

    function promotionStatus(S, myTeam, n) {
        const P = S.player;
        if (P.role !== 'owner') return null;
        const sd = seriesDef(S, S.season.sid);
        const up = gameOf(S).series.filter(s => s.ladder === sd.ladder && s.tier === sd.tier - 1);
        const down = gameOf(S).series.filter(s => s.ladder === sd.ladder && s.tier === sd.tier + 1);
        const t = S.teams[P.teamId];
        const eligible = myTeam && (myTeam.rank <= 3 || (standings(S, sd.id).find(r => r.id === 'P')?.rank === 1));
        return {
            up: up.map(s => ({ sid: s.id, name: s.name, fee: Math.round(s.budget * 0.25 / 1000) * 1000, ok: eligible && t.budget >= s.budget * 0.25 })),
            down: down.map(s => ({ sid: s.id, name: s.name, refund: Math.round(sd.budget * 0.05 / 1000) * 1000 })),
            eligible, reason: eligible ? '' : 'Finish in the top 3 of the teams’ championship (or win the drivers’ title) to earn a place in the series above.'
        };
    }

    // Owner: move the team up / down a rung for next season.
    E.changeSeries = function (S, sid) {
        const P = S.player;
        if (S.phase !== 'postseason') throw new Error('Series moves happen in the off-season.');
        if (P.role !== 'owner') throw new Error('Only owner-drivers can move their team between series.');
        const pr = S.postseason.promotion;
        const upItem = pr?.up.find(x => x.sid === sid);
        const downItem = pr?.down.find(x => x.sid === sid);
        if (!upItem && !downItem) throw new Error('Not an available series.');
        if (upItem && !upItem.ok) throw new Error(pr.eligible ? `Entry fee is ${fmtMoney(upItem.fee)} — not enough in the team budget.` : pr.reason);
        const t = S.teams[P.teamId];
        if (upItem) ledger(S, 't', -upItem.fee, `Entry fee — ${upItem.name}`, 'entry');
        if (downItem) ledger(S, 't', downItem.refund, `Series exit settlement`, 'entry');
        P.moveTo = sid;
        inbox(S, upItem ? '⬆️' : '⬇️', `${t.name} will race in the ${seriesDef(S, sid).name}`, upItem ? 'The entry is accepted. Next season you face a much stronger field — and much bigger money.' : 'A step back to rebuild.', 'team');
    };

    // Two seasons in the red: the team is sold from under you, debts cleared.
    function administration(S) {
        const P = S.player;
        const t = S.teams[P.teamId];
        inbox(S, '⚖️', `${t.name} enters administration`, `Two straight seasons in the red. Creditors sold the team; the debt (${fmtMoney(t.budget)}) went with it. You're a driver for hire now — check Contracts.`, 'finance');
        t.budget = seriesDef(S, t.sid).budget * 0.5;
        t.player = false; t.fund = 0.7;
        S.flags.debtSeasons = 0;
        P.role = 'driver';
        P.contract = { teamId: t.id, seasons: 0, status: 'lead', salary: 0, winBonus: 0, podiumBonus: 0, prizeShare: 0.1 };
        P.rep = clamp(P.rep - 8, 0, 100);
        const offers = generateOffers(S, {});
        const pool = teamsIn(S, P.sid).filter(x => x.id !== P.teamId).sort((a, b) => a.prestige - b.prestige);
        if (!offers.length && pool[0]) offers.push(makeOffer(S, pool[0], seriesDef(S, P.sid), -3));
        S.offers = offers;
        S.postseason.promotion = null;
    }

    E.setDriverFee = function (S, amount) {
        const P = S.player;
        if (P.role !== 'owner') throw new Error('Only owner-drivers set their own fee.');
        const sd = seriesDef(S, P.sid);
        P.contract.salary = clamp(Math.round(Number(amount) || 0), 0, Math.round(tierSalary(sd) * 3));
        return P.contract.salary;
    };

    // Owner: sell up and become a driver for hire / found again later.
    E.sellTeam = function (S) {
        const P = S.player;
        if (P.role !== 'owner') throw new Error('You do not own a team.');
        if (S.phase !== 'postseason') throw new Error('Sell in the off-season.');
        const t = S.teams[P.teamId];
        const value = Math.max(0, Math.round((t.budget * 0.9 + seriesDef(S, t.sid).budget * (0.15 + t.prestige / 400)) / 1000) * 1000);
        ledger(S, 'p', value, `Sold ${t.name}`, 'team');
        t.budget = seriesDef(S, t.sid).budget * 0.6;
        t.player = false; t.fund = 0.8;
        P.role = 'driver';
        P.contract = { teamId: t.id, seasons: 0, status: 'lead', salary: 0, winBonus: 0, podiumBonus: 0, prizeShare: 0.1 };
        const offers = generateOffers(S, {});
        if (!offers.length) {
            const pool = teamsIn(S, P.sid).filter(x => x.id !== P.teamId).sort((a, b) => a.prestige - b.prestige);
            if (pool[0]) offers.push(makeOffer(S, pool[0], seriesDef(S, P.sid), -2));
        }
        S.offers = offers;
        inbox(S, '💼', `${t.name} sold`, `You pocketed ${fmtMoney(value)}. You're a driver for hire — check Contracts.`, 'team');
        return value;
    };

    // Driver: buy an AI team (become owner-driver) in the off-season.
    E.teamPrice = function (S, t) {
        const sd = seriesDef(S, t.sid);
        return Math.round(sd.budget * (0.25 + t.prestige / 250) / 1000) * 1000;
    };
    E.buyTeam = function (S, teamId) {
        const P = S.player;
        if (S.phase !== 'postseason') throw new Error('Team sales close in the off-season.');
        if (P.role !== 'driver') throw new Error('Only a driver can buy their way into ownership.');
        const t = S.teams[teamId];
        if (!t || t.player || !t.sid) throw new Error('That team is not for sale.');
        const price = E.teamPrice(S, t);
        if (P.money < price) throw new Error(`You need ${fmtMoney(price)} — you have ${fmtMoney(P.money)}.`);
        ledger(S, 'p', -price, `Purchased ${t.name}`, 'team');
        // leave current team
        const old = S.teams[P.teamId];
        if (old) old.drivers = old.drivers.filter(id => id !== 'P');
        if (old && old.id !== t.id) backfillTeam(S, old);
        P.role = 'owner';
        t.player = true;
        t.facilities = facilitiesFromLevel(S, t);
        t.staff = startingStaffFor(S, t);
        t.sponsors = aiSponsorsToReal(S, t);
        t.rd = []; t.builds = []; t.nextYear = 0;
        // make a seat for the player
        const mates = t.drivers.map(id => S.drivers[id]).filter(Boolean).sort((a, b) => a.skill - b.skill);
        if (mates.length >= t.cars && mates[0]) releaseDriver(S, mates[0]);
        t.drivers.push('P');
        P.teamId = t.id; P.sid = t.sid;
        S.drivers.P.teamId = t.id; S.drivers.P.sid = t.sid;
        P.contract = { teamId: t.id, seasons: 99, status: 'lead', salary: Math.round(tierSalary(seriesDef(S, t.sid)) * 0.2 / 100) * 100, winBonus: 0, podiumBonus: 0, prizeShare: 0, owner: true };
        P.nextContract = null; S.offers = [];
        S.sponsorOffers = sponsorOffersFor(S, t, 2);
        refreshStaffPool(S);
        inbox(S, '🏢', `You own ${t.name}`, `Welcome to management. Budget ${fmtMoney(t.budget)} — and every bill is yours now.`, 'team');
        return t;
    };
    function startingStaffFor(S, t) {
        const sd = seriesDef(S, t.sid);
        S._refBudget = sd.budget;
        const q = t.tech / 100;
        const st = { td: makeStaff(S, 'td', q), crewchief: makeStaff(S, 'crewchief', t.ops / 100), commercial: makeStaff(S, 'commercial', q), engineers: [] };
        for (let i = 0; i < t.cars; i++) st.engineers.push(makeStaff(S, 'engineer', q));
        delete S._refBudget;
        return st;
    }

    // Principal: after being fired (or at will) move to another team.
    E.principalOffers = function (S) {
        const P = S.player;
        const sd = seriesDef(S, P.sid);
        const rep = P.rep;
        const g = gameOf(S);
        const out = [];
        for (const s of g.series.filter(x => x.ladder === sd.ladder && Math.abs(x.tier - sd.tier) <= 1)) {
            for (const t of teamsIn(S, s.id).filter(x => x.id !== P.teamId)) {
                const need = t.prestige * 0.6;
                if (rep + rf(S, -15, 15) >= need) out.push({ teamId: t.id, sid: s.id, salary: Math.round(tierSalary(s) * 0.5 / 100) * 100 });
            }
        }
        return out.sort((a, b) => S.teams[b.teamId].prestige - S.teams[a.teamId].prestige).slice(0, 4);
    };
    E.takePrincipalJob = function (S, teamId) {
        const P = S.player;
        const t = S.teams[teamId];
        if (!t) throw new Error('Team not found.');
        const old = S.teams[P.teamId];
        if (old) { old.player = false; }
        t.player = true;
        t.facilities = t.facilities || facilitiesFromLevel(S, t);
        t.staff = t.staff || startingStaffFor(S, t);
        t.sponsors = t.sponsors || aiSponsorsToReal(S, t);
        t.rd = t.rd || []; t.builds = t.builds || []; t.nextYear = t.nextYear || 0;
        P.teamId = t.id; P.sid = t.sid;
        P.contract = { teamId: t.id, seasons: 3, status: 'principal', salary: Math.round(tierSalary(seriesDef(S, t.sid)) * 0.5 / 100) * 100, winBonus: Math.round(tierSalary(seriesDef(S, t.sid)) * 0.02 / 10) * 10, podiumBonus: 0, prizeShare: 0 };
        P.board = { confidence: 60, target: boardTarget(S, t) };
        P.fired = false;
        inbox(S, '📋', `New job: ${t.name}`, `The board wants P${P.board.target} in the teams' championship.`, 'board');
    };

    /* ============================================================
       Advance to the next season (rollover)
       ============================================================ */
    E.advanceSeason = function (S) {
        if (S.phase !== 'postseason') throw new Error('Finish the season first.');
        if (S.postseason?.mustRetire) throw new Error('This career is complete — retire the character.');
        const P = S.player;
        if (P.role === 'principal' && P.fired) throw new Error('You need a new team first — take one of the offers.');
        if (P.role === 'driver') resolveDriverMove(S);
        if (P.role === 'principal' && P.contract.seasons <= 0) {
            // Board renews if confidence is decent.
            if (P.board.confidence >= 40) { P.contract.seasons = 2; inbox(S, '📋', 'Contract extended', 'The board extended your deal by two seasons.', 'board'); }
            else { P.fired = true; throw new Error('Your contract ran out and the board did not renew — take another job first.'); }
        }
        // Owner series move
        if (P.role === 'owner' && P.moveTo) moveTeamToSeries(S, S.teams[P.teamId], P.moveTo);
        P.moveTo = null;

        worldRollover(S);
        S.year += 1;
        S.seasonNo += 1;
        P.age += 1;
        if (S.drivers.P) S.drivers.P.age = P.age;
        // Next-year car bank + regulation cycle
        carRollover(S);
        if (P.role === 'driver') {
            P.sid = S.teams[P.teamId]?.sid || P.sid;
        } else P.sid = S.teams[P.teamId].sid;
        if (S.drivers.P) { S.drivers.P.sid = P.sid; S.drivers.P.teamId = P.teamId; }
        S.offers = [];
        S.postseason = null;
        assignNumbers(S);
        startSeason(S);
        // Owner/principal staff contracts
        if (P.role !== 'driver') staffRollover(S);
        return S;
    };

    function resolveDriverMove(S) {
        const P = S.player;
        const nc = P.nextContract;
        if (!nc) {
            if (P.contract && P.contract.seasons > 0) return; // still signed
            // Contract expired and nothing accepted: pick the best available offer automatically.
            let best = S.offers.slice().sort((a, b) => b.salary - a.salary)[0];
            if (!best) {
                // Never strand the player: a backmarker (possibly paid) seat always exists.
                const sd = seriesDef(S, P.sid);
                const lower = gameOf(S).series.find(x => x.ladder === sd.ladder && x.tier === sd.tier + 1);
                const pool = teamsIn(S, P.sid).filter(x => x.id !== P.teamId && !x.player).sort((a, b) => a.prestige - b.prestige);
                const t = pool[0] || (lower && teamsIn(S, lower.id).filter(x => !x.player).sort((a, b) => a.prestige - b.prestige)[0]);
                if (!t) throw new Error('You have no seat for next season — accept an offer in Contracts first.');
                best = makeOffer(S, t, seriesDef(S, t.sid), -1);
                if (best.pay && P.money < Math.abs(best.salary) * 0.5) { best.salary = 0; best.pay = false; }
                S.offers.push(best);
                inbox(S, '🕴️', 'Last-minute seat', `With no deal signed, your camp found a seat at ${t.name} for next season.`, 'contract');
            }
            E.acceptOffer(S, best.id);
        }
        const c = P.nextContract;
        if (!c) return;
        const old = S.teams[P.teamId];
        const t = S.teams[c.teamId];
        if (old && old.id !== t.id) {
            if (P.contract && P.contract.seasons > 0) {
                inbox(S, '💸', 'Buyout agreed', `${t.name} paid ${old.name} to release you early.`, 'contract');
            }
            old.drivers = old.drivers.filter(id => id !== 'P');
            backfillTeam(S, old);
        }
        if (!t.drivers.includes('P')) {
            if (t.drivers.length >= t.cars) {
                const out = t.drivers.map(id => S.drivers[id]).filter(Boolean).sort((a, b) => a.skill - b.skill)[0];
                if (out) releaseDriver(S, out);
            }
            t.drivers.push('P');
        }
        P.teamId = t.id; P.sid = t.sid;
        P.contract = { teamId: t.id, seasons: c.seasons, status: c.status, salary: c.salary, winBonus: c.winBonus, podiumBonus: c.podiumBonus, prizeShare: c.prizeShare };
        P.nextContract = null;
        P.morale = 70;
    }

    function moveTeamToSeries(S, t, sid) {
        const sd = seriesDef(S, sid);
        // Swap places with the weakest team of the target series.
        const weakest = teamsIn(S, sid).filter(x => !x.player).sort((a, b) => a.prestige - b.prestige)[0];
        const oldSid = t.sid;
        if (weakest) {
            weakest.sid = oldSid;
            weakest.drivers.forEach(id => { const d = S.drivers[id]; if (d) d.sid = oldSid; });
            // Keep grid sizes: match car counts.
            const diff = weakest.cars - t.cars;
            weakest.cars = t.cars;
            if (diff > 0) for (let i = 0; i < diff; i++) { const d = weakest.drivers.map(id => S.drivers[id]).sort((a, b) => a.skill - b.skill)[0]; if (d) releaseDriver(S, d); }
            else backfillTeam(S, weakest);
        }
        t.sid = sid;
        t.drivers.forEach(id => { const d = id === 'P' ? S.drivers.P : S.drivers[id]; if (d) d.sid = sid; });
        // A fresh start in the new class: cars reset near the new field's lower quartile.
        const scores = teamsIn(S, sid).filter(x => x.id !== t.id).map(x => x.car);
        const q = (k) => { const v = scores.map(c => c[k]).sort((a, b) => a - b); return v[Math.floor(v.length * 0.3)] || 55; };
        ['engine', 'aero', 'chassis'].forEach(k => { t.car[k] = round1(Math.max(t.car[k] * 0.4 + q(k) * 0.6, q(k) - 3)); });
        t.prestige = clamp(t.prestige - 15, 5, 100);
        t.sponsors = (t.sponsors || []).map(sp => ({ ...sp, value: Math.round(sp.value * (sd.budget / seriesDef(S, oldSid).budget) * 0.7 / 100) * 100 }));
    }

    function carRollover(S) {
        S.regsResetIn -= 1;
        const reset = S.regsResetIn <= 0;
        if (reset) S.regsResetIn = ri(S, 5, 8);
        for (const sid of Object.keys(S.series)) {
            const ts = teamsIn(S, sid);
            const m = {};
            ['engine', 'aero', 'chassis', 'rel'].forEach(k => { m[k] = mean(ts.map(t => t.car[k])); });
            for (const t of ts) {
                const keep = reset ? 0.35 : 0.72;
                ['engine', 'aero', 'chassis'].forEach(k => {
                    const regressed = m[k] + (t.car[k] - m[k]) * keep;
                    const bonus = (t.player ? (t.nextYear || 0) / 3 : (t.fund - 1) * 2.5 + (t.tech - 50) / 25) + (reset ? gauss(S) * 4 : gauss(S) * 1.2);
                    t.car[k] = round1(clamp(regressed + bonus, 25, 97));
                });
                t.car.rel = round1(clamp(m.rel + (t.car.rel - m.rel) * 0.8 + ((t.staff?.td?.skill ?? t.tech) - 50) / 20, 30, 98));
                if (t.player) t.nextYear = 0;
            }
        }
        if (reset) inbox(S, '📜', 'New technical regulations!', 'A major rules reset shuffles the pecking order this season — every car regressed toward the pack. Big R&D spenders now have a chance to leap ahead.', 'news');
        else if (S.regsResetIn === 1) inbox(S, '📜', 'Rules change coming', 'The governing body confirmed new technical regulations for NEXT season. Investment in next year’s car now carries extra risk — cars will be pulled back to the pack.', 'news');
    }

    function staffRollover(S) {
        const t = S.teams[S.player.teamId];
        for (const s of staffList(t)) {
            s.years -= 1; s.age += 1;
            if (s.years <= 0) {
                if (rnd(S) < 0.8) { s.years = ri(S, 1, 3); s.salary = Math.round(s.salary * rf(S, 1.0, 1.12) / 100) * 100; inbox(S, '🔁', `${s.first} ${s.last} re-signed`, `${SC.STAFF_ROLES[s.role].label}: ${fmtMoney(s.salary)}/season for ${s.years} more.`, 'team'); }
                else {
                    inbox(S, '👋', `${s.first} ${s.last} moves on`, `Your ${SC.STAFF_ROLES[s.role].label.toLowerCase()} left for a rival — a replacement from the staff market steps in.`, 'team');
                    const repl = makeStaff(S, s.role, 0.35);
                    if (s.role === 'engineer') t.staff.engineers = t.staff.engineers.map(e => e === s ? repl : e);
                    else t.staff[s.role] = repl;
                }
            }
            s.skill = clamp(Math.round(s.skill + (s.age < 45 ? rf(S, 0, 2) : rf(S, -2, 0.5))), 5, 99);
        }
        // Engineers per car
        while (t.staff.engineers.length < t.cars) t.staff.engineers.push(makeStaff(S, 'engineer', 0.3));
    }

    // AI world: ageing, retirement, contracts, promotions, rookies.
    function worldRollover(S) {
        const g = gameOf(S);
        const P = S.player;
        // 1. Ageing & progression
        for (const d of Object.values(S.drivers)) {
            if (d.isPlayer) continue;
            d.age += 1;
            const dev = d.age < 22 ? rf(S, 0.5, 4) : d.age < 27 ? rf(S, -0.5, 2.5) : d.age < 33 ? rf(S, -1, 1) : -rf(S, 0.5, 2.2) * (d.age - 31) / 3;
            if (dev > 0) d.skill = round1(Math.min(d.pot, d.skill + dev * clamp((d.pot - d.skill) / 8, 0.15, 1)));
            else d.skill = round1(clamp(d.skill + dev, 20, 99));
            d.cons = clamp(d.cons + (d.age < 28 ? ri(S, 0, 2) : ri(S, -1, 1)), 10, 99);
            if (d.sid) d.lastTier = seriesDef(S, d.sid)?.tier || d.lastTier;
        }
        // 2. Retirements
        for (const d of Object.values(S.drivers)) {
            if (d.isPlayer) continue;
            const t = d.lastTier || tierOfDriver(S, d);
            let p = d.age >= 36 ? (d.age - 35) * 0.13 : 0;
            if (d.age >= 46) p = 1;
            if (!d.teamId && d.age > 27 && d.skill < tierSkill(t) - 8) p += 0.35;
            if (!d.teamId && d.age > 33) p += 0.2;
            if (!d.teamId && d.age > 29) p += 0.25;
            if (rnd(S) < p) {
                releaseDriver(S, d);
                S.retired[d.id] = { first: d.first, last: d.last, nat: d.nat, car: d.car, age: d.age, retiredYear: S.year };
                delete S.drivers[d.id];
                if (d.car.t > 0 || d.car.w >= 10) inbox(S, '🎖️', `${d.first} ${d.last} retires`, `${d.car.t} title${d.car.t === 1 ? '' : 's'}, ${d.car.w} wins in ${d.car.st} starts.`, 'news');
            }
        }
        // 3. Contracts tick; AI teams decide renewals
        for (const t of Object.values(S.teams)) {
            if (!t.sid) continue;
            for (const id of t.drivers.slice()) {
                if (id === 'P') continue;
                const d = S.drivers[id];
                if (!d) { t.drivers = t.drivers.filter(x => x !== id); continue; }
                d.years -= 1;
                if (d.years <= 0) {
                    const sd = seriesDef(S, t.sid);
                    const keep = d.skill >= tierSkill(sd.tier) - 4 + (t.prestige - 50) / 12 && rnd(S) < 0.7;
                    if (keep) { d.years = ri(S, 1, 3); d.salary = E.driverAsk(S, d, sd); }
                    else if (!t.player) releaseDriver(S, d);
                    else { d.years = 1; } // your own drivers stay until you release them — they re-sign for a season
                }
            }
        }
        // 3b. Stars far too good for their series get snapped up by outside
        //     championships (keeps the lower rungs from filling with veterans).
        for (const t of Object.values(S.teams)) {
            if (!t.sid || t.player) continue;
            const sd = seriesDef(S, t.sid);
            if (!sd || sd.tier <= 1) continue;
            for (const id of t.drivers.slice()) {
                const d = S.drivers[id];
                if (!d || d.isPlayer || d.skill <= tierSkill(sd.tier) + 11 || rnd(S) > 0.35) continue;
                releaseDriver(S, d);
                S.retired[d.id] = { first: d.first, last: d.last, nat: d.nat, car: d.car, age: d.age, retiredYear: S.year, movedOn: true };
                delete S.drivers[d.id];
            }
        }
        // 4. Prestige & budgets follow results
        for (const s of g.series) {
            const ts = teamStandings(S, s.id);
            const n = ts.length;
            ts.forEach(r => {
                const t = S.teams[r.id];
                if (!t) return;
                const target = 100 * (1 - (r.rank - 1) / Math.max(1, n - 1));
                t.prestige = clamp(Math.round(t.prestige * 0.72 + target * 0.28), 3, 99);
                if (!t.player) {
                    t.fund = clamp(t.fund * 0.8 + (0.55 + t.prestige / 100 * 1.05) * 0.2, 0.4, 1.8);
                    t.tech = clamp(Math.round(t.tech + (t.prestige > 60 ? ri(S, 0, 3) : ri(S, -3, 1))), 10, 98);
                    t.ops = clamp(Math.round(t.ops + (t.prestige > 60 ? ri(S, 0, 3) : ri(S, -3, 1))), 10, 98);
                }
            });
        }
        // 5. Fill every AI vacancy, top rung first. Candidates are the rung
        //    below's top performers plus free agents near this level. A team only
        //    signs someone close to its standard; otherwise it brings in outside
        //    talent (junior categories and championships the game doesn't
        //    simulate) — that keeps each tier's strength stable over 40 seasons.
        const ladders = SC.laddersOf(g);
        for (const L of ladders) {
            const rungs = L.series.slice().sort((a, b) => a.tier - b.tier); // top first
            const entryTier = rungs[rungs.length - 1].tier;
            for (const sd of rungs) {
                const below = rungs.filter(x => x.tier === sd.tier + 1);
                for (const t of teamsIn(S, sd.id).filter(x => !x.player).sort((a, b) => b.prestige - a.prestige)) {
                    let guard = 0;
                    while (t.drivers.length < t.cars && guard++ < 8) {
                        const want = tierSkill(sd.tier) + (t.prestige - 50) / 8;
                        const cands = [];
                        for (const b of below) {
                            cands.push(...standings(S, b.id).slice(0, 6).map(r => S.drivers[r.id])
                                .filter(d => d && !d.isPlayer && !(d.teamId && S.teams[d.teamId]?.player)));
                        }
                        cands.push(...Object.values(S.drivers).filter(d => !d.teamId && !d.isPlayer && (d.lastTier || 9) <= sd.tier + 2
                            && ((d.lastTier || 9) >= sd.tier - 1 || d.age < 28)));
                        const score = (d) => d.skill + (d.age < 26 ? 2 : 0) - Math.max(0, d.age - 33);
                        const ok = [...new Set(cands)].filter(d => d.teamId !== t.id && d.skill >= want - 6).sort((a, b) => score(b) - score(a));
                        let d = ok[Math.min(ri(S, 0, 2), ok.length - 1)];
                        if (!d) {
                            d = makeDriver(S, { tier: sd.tier, quality: clamp(t.prestige / 100 + gauss(S) * 0.15, 0, 1), ladder: sd.ladder, rookie: sd.tier === entryTier, age: sd.tier === entryTier ? null : ri(S, 19, 31) });
                        }
                        const from = d.teamId ? S.teams[d.teamId] : null;
                        signDriver(S, d, t, ri(S, 1, 3));
                        if (from && from.sid !== sd.id && d.car.st > 0) inbox(S, '⬆️', `${d.first} ${d.last} promoted`, `${d.first} ${d.last} steps up to ${t.name} in the ${sd.name}.`, 'news');
                    }
                }
            }
        }
        // 6. Fresh rookies into the free-agent pool so the ladder never dries up
        for (const L of ladders) {
            const entry = L.series.slice().sort((a, b) => b.tier - a.tier)[0];
            for (let i = 0; i < 3; i++) {
                const d = makeDriver(S, { tier: entry.tier, quality: rnd(S), ladder: entry.ladder, rookie: true });
                d.lastTier = entry.tier;
            }
        }
        // 7. Trim the free-agent pool (keeps saves small over 40 seasons)
        const fas = Object.values(S.drivers).filter(d => !d.teamId && !d.isPlayer);
        const limit = Math.max(40, Object.keys(S.series).length * 6);
        if (fas.length > limit) {
            fas.sort((a, b) => (a.skill - a.age * 0.4) - (b.skill - b.age * 0.4));
            for (const d of fas.slice(0, fas.length - limit)) {
                S.retired[d.id] = { first: d.first, last: d.last, nat: d.nat, car: d.car, age: d.age, retiredYear: S.year };
                delete S.drivers[d.id];
            }
        }
        // 8. Keep retired archive lean: only drivers that raced
        const ret = Object.entries(S.retired);
        if (ret.length > 1500) ret.filter(([, r]) => !r.car || !r.car.st).forEach(([id]) => delete S.retired[id]);
        // 9. Used names: drop the ones no longer active (so the pool can reuse them decades later)
        if (Object.keys(S.usedNames).length > 4000) {
            const active = new Set(Object.values(S.drivers).map(d => `${d.first} ${d.last}`));
            S.usedNames = Object.fromEntries([...active].map(n => [n, 1]));
        }
        // Principal of a fired career stays unemployed until a job is taken (handled in UI).
        void P;
    }

    /* ============================================================
       Retirement & Hall of Fame
       ============================================================ */
    E.canRetire = (S) => S.phase === 'postseason' || S.phase === 'preseason';
    E.retire = function (S, reason = 'voluntary') {
        if (!E.canRetire(S) && reason !== 'forced') throw new Error('You can retire between seasons (after the final round or before round 1).');
        const P = S.player;
        const g = gameOf(S);
        const c = P.career;
        const tiersRaced = [...new Set(S.history.map(h => h.tier))];
        const topTier = Math.min(...(tiersRaced.length ? tiersRaced : [9]));
        const legacy = Math.round(c.titles * 120 + c.w * 12 + c.p * 3 + c.pl * 2 + c.st * 0.2 + (9 - topTier) * 25 + P.rep * 2);
        const bestSeason = S.history.slice().sort((a, b) => (a.pos || 99) - (b.pos || 99) || a.tier - b.tier)[0];
        const entry = {
            id: S.id, name: playerName(S), nick: P.nick, nat: P.nat, role: P.role, gameId: S.gameId, game: g.name, gameShort: g.short,
            seasons: S.history.length, from: S.startYear, to: S.history.length ? S.history[S.history.length - 1].year : S.year,
            age: P.age, titles: c.titles, wins: c.w, podiums: c.p, poles: c.pl, starts: c.st, points: c.pts, earnings: Math.round(c.earn),
            topSeries: S.history.filter(h => h.tier === topTier).map(h => h.series)[0] || '—', seriesTitles: Object.entries(P.seriesTitles).map(([sid, n]) => `${seriesDef(S, sid)?.name || sid} ×${n}`),
            legacy, reason, retiredAt: new Date().toISOString(), best: bestSeason ? `${bestSeason.year} ${bestSeason.series}: P${bestSeason.pos || '—'}` : '—',
            dr: P.dr, rep: Math.round(P.rep), achievements: Object.keys(S.achievements).length
        };
        P.retired = true;
        S.phase = 'retired';
        S.hof = entry;
        inbox(S, '🎖️', 'Retirement', `${entry.name} retires after ${entry.seasons} season${entry.seasons === 1 ? '' : 's'}: ${entry.titles} title${entry.titles === 1 ? '' : 's'}, ${entry.wins} wins, ${entry.podiums} podiums. Legacy score ${legacy}.`, 'news');
        return entry;
    };

    /* ============================================================
       Achievements
       ============================================================ */
    const ACH = [
        { id: 'first-start', icon: '🚦', label: 'First Start', test: (S) => S.player.career.st >= 1 },
        { id: 'first-points', icon: '🔢', label: 'On the Board', test: (S) => S.player.career.pts > 0 },
        { id: 'first-podium', icon: '🥉', label: 'Podium Finisher', test: (S) => S.player.career.p >= 1 },
        { id: 'first-win', icon: '🏆', label: 'Race Winner', test: (S) => S.player.career.w >= 1 },
        { id: 'first-pole', icon: '⏱️', label: 'Pole Sitter', test: (S) => S.player.career.pl >= 1 },
        { id: 'wins10', icon: '🔟', label: '10 Wins', test: (S) => S.player.career.w >= 10 },
        { id: 'wins50', icon: '5️⃣', label: '50 Wins', test: (S) => S.player.career.w >= 50 },
        { id: 'wins100', icon: '💯', label: 'Centurion — 100 Wins', test: (S) => S.player.career.w >= 100 },
        { id: 'starts100', icon: '📅', label: '100 Starts', test: (S) => S.player.career.st >= 100 },
        { id: 'starts500', icon: '🗓️', label: '500 Starts', test: (S) => S.player.career.st >= 500 },
        { id: 'title', icon: '👑', label: 'Champion', test: (S) => S.player.career.titles >= 1 },
        { id: 'titles5', icon: '🌟', label: 'Five-Time Champion', test: (S) => S.player.career.titles >= 5 },
        { id: 'multi-series', icon: '🧭', label: 'Champion in 3 Series', test: (S) => Object.keys(S.player.seriesTitles).length >= 3 },
        { id: 'top-tier', icon: '🔝', label: 'Top of the Ladder', test: (S) => seriesDef(S, S.player.sid)?.tier === 1 },
        { id: 'millionaire', icon: '💰', label: 'Millionaire', test: (S) => S.player.money >= 1e6 },
        { id: 'grand-slam', icon: '🎰', label: 'Grand Slam (pole, win, fastest lap, most laps led)', test: (S, ev) => { const r = ev?.res; if (!r?.player) return false; const max = Math.max(0, ...Object.values(r.led)); return r.pole === 'P' && r.order[0] === 'P' && r.fl === 'P' && (r.led.P || 0) === max && max > 0; } },
        { id: 'last-to-first', icon: '🚀', label: 'Last to First', test: (S, ev) => ev?.res?.player && ev.res.player.pos === 1 && ev.res.player.start === ev.res.order.length },
        { id: 'owner-win', icon: '🏢', label: 'Owner-Driver Winner', test: (S) => S.player.role === 'owner' && S.player.career.w >= 1 },
        { id: 'hat-trick', icon: '🎩', label: 'Hat-trick (3 wins in a row)', test: (S) => { const done = S.season.events.filter(e => e.done && e.res?.player); const last3 = done.slice(-3); return last3.length === 3 && last3.every(e => e.res.player.pos === 1 && !e.res.player.dnf); } },
        { id: 'iron', icon: '🛡️', label: 'Iron Career — 40 Seasons', test: (S) => S.history.length >= 40 },
        { id: 'wrecker', icon: '💥', label: 'Wrecking Ball (50 wrecks)', test: (S) => S.player.career.wr >= 50 }
    ];
    E.ACHIEVEMENTS = ACH;
    function checkAchievements(S, ev) {
        for (const a of ACH) {
            if (S.achievements[a.id]) continue;
            let ok = false;
            try { ok = S.player.role === 'principal' && !['millionaire', 'iron'].includes(a.id) ? false : a.test(S, ev); } catch (e) { ok = false; }
            if (ok) {
                S.achievements[a.id] = { s: S.seasonNo, r: S.season ? S.season.round : 0, y: S.year };
                inbox(S, a.icon, `Achievement: ${a.label}`, `Unlocked in season ${S.seasonNo} (${S.year}).`, 'news');
            }
        }
    }
    E.checkAchievements = checkAchievements;

    /* ============================================================
       Summaries for the UI
       ============================================================ */
    E.summary = function (S) {
        const P = S.player;
        const sd = seriesDef(S, S.season?.sid || P.sid);
        const t = S.teams[P.teamId];
        return {
            id: S.id, name: playerName(S), nat: P.nat, role: P.role, game: gameOf(S)?.name, gameShort: gameOf(S)?.short, gameId: S.gameId,
            color: gameOf(S)?.color, icon: gameOf(S)?.icon, series: sd?.name, team: t?.name, seasonNo: S.seasonNo, maxSeasons: S.settings.maxSeasons,
            year: S.year, phase: S.phase, round: S.season ? S.season.round : 0, rounds: S.season ? S.season.events.length : 0,
            titles: P.career.titles, wins: P.career.w, money: P.money, updatedAt: S.updatedAt, retired: S.phase === 'retired'
        };
    };

    E.careerTrackTable = function (S) {
        return Object.entries(S.player.tracks).map(([t, r]) => ({ t, ...r, avg: r.fin ? r.sum / r.fin : null, type: trackInfo(S, t).type }))
            .sort((a, b) => b.st - a.st || (a.avg ?? 99) - (b.avg ?? 99));
    };
    E.typeRatings = function (S) {
        return Object.entries(S.player.types).map(([type, r]) => ({ type, label: typeInfo(type).label, icon: typeInfo(type).icon, st: r.st, perf: r.st ? Math.round(r.perf / r.st) : null }))
            .sort((a, b) => b.st - a.st);
    };
    E.derivedAttributes = function (S) {
        // From the logged results (not self-reported): qualifying, racecraft, consistency, safety.
        const races = [];
        for (const h of S.history) for (const e of h.events) if (e.p && !e.p.sim) races.push({ ...e.p, N: e.order.length });
        for (const e of (S.season?.events || [])) if (e.done && e.res?.player && !e.res.player.sim) races.push({ pos: e.res.player.pos, st: e.res.player.start, dnf: e.res.player.dnf, N: e.res.order.length, inc: e.res.player.inc });
        const recent = races.slice(-40);
        if (!recent.length) return null;
        const qual = mean(recent.map(r => r.N > 1 ? (r.N - r.st) / (r.N - 1) : 0.5)) * 100;
        const fin = recent.filter(r => !r.dnf);
        const racecraft = clamp(50 + mean(fin.map(r => (r.st - r.pos))) * 3, 0, 100);
        const pcts = fin.map(r => r.N > 1 ? (r.N - r.pos) / (r.N - 1) : 0.5);
        const sd = pcts.length > 1 ? Math.sqrt(mean(pcts.map(p => (p - mean(pcts)) ** 2))) : 0.2;
        const consistency = clamp(100 - sd * 220, 0, 100);
        const safety = clamp(100 - (recent.filter(r => r.dnf).length / recent.length) * 250 - mean(recent.filter(r => r.inc != null).map(r => r.inc)) * 6 || 0, 0, 100);
        return { qual: Math.round(qual), racecraft: Math.round(racecraft), consistency: Math.round(consistency), safety: Math.round(safety), n: recent.length };
    };

    E.MAX_SEASONS = MAX_SEASONS;
    E.SAVE_VERSION = SAVE_VERSION;
    E.tierSkill = tierSkill;
    E.clamp = clamp;
    E.rnd = rnd;
    SC.Engine = E;
})(typeof window !== 'undefined' ? window : globalThis);
