/* ============================================================
   Phoenix SRMPC — Paddock core (shared, pure logic)
   The "between races" RPG layer: cars that wear out, mechanic
   shops and upgrade parts, new and used car dealers (with hidden
   faults, inspections and haggling), personal and team sponsors
   with objectives and happiness, driver skills and training,
   side events, paddock decision cards, loans and car finance.

   No DOM, no Firebase, no globals besides PaddockCore. Every
   random roll takes an explicit rng (PaddockCore.rng(seed)), so
   the league app (Firestore) and the Solo Career (IndexedDB)
   both get deterministic, replayable outcomes, and the Node test
   suite can drive it headlessly.

   A car entry (garage / dealer lot) carries, on top of the
   existing { id, name, carId, emoji, price, stats, imageUrl }:
     cond:    { engine, gearbox, suspension, brakes, tyres, body } 0–100
     races:   race starts (the odometer), km: distance driven
     parts:   { <partId>: { tier, eff, at, shop } } — one per category
     tune:    0–3 dyno tune steps
     title:   'clean' | 'rebuilt' | 'salvage'
     hidden:  [{ comp, drop, label }] faults the seller didn't mention
     history: [{ at, icon, text }] newest first (capped)
     warranty: races of free repairs left at the factory service centre
     finance: { balance, perRace, racesLeft, missed, lender }
   Legacy entries (no cond) are treated as fresh — ensureCar()
   fills the gaps without changing their value.
   ============================================================ */
'use strict';

(function (root) {
    const PC = {};
    const VERSION = 1;
    PC.VERSION = VERSION;

    /* ============================================================
       Random + small helpers
       ============================================================ */
    function hashStr(str) {
        str = String(str);
        let h = 1779033703 ^ str.length;
        for (let i = 0; i < str.length; i++) {
            h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
            h = (h << 13) | (h >>> 19);
        }
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return (h ^= h >>> 16) >>> 0;
    }
    function mulberry32(a) {
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    PC.hash = hashStr;
    PC.rng = (seed) => mulberry32(hashStr(seed));

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const ri = (r, a, b) => a + Math.floor(r() * (b - a + 1));
    const rf = (r, a, b) => a + r() * (b - a);
    const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
    const chance = (r, p) => r() < p;
    const roundTo = (n, step = 10) => Math.round((Number(n) || 0) / step) * step;
    const shuffle = (r, arr) => {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
        return a;
    };
    function weighted(r, entries) { // [[item, weight], …]
        const total = entries.reduce((s, e) => s + Math.max(0, e[1]), 0);
        if (total <= 0) return entries.length ? entries[0][0] : null;
        let x = r() * total;
        for (const [item, w] of entries) { x -= Math.max(0, w); if (x <= 0) return item; }
        return entries[entries.length - 1][0];
    }
    PC.util = { clamp, ri, rf, pick, chance, roundTo, shuffle, weighted };

    // Stars multiplier — mirrors the league's Prestige.MULTIPLIER so money
    // scales the same way with prestige in both modes.
    const STAR_MULT = { 1: 1, 2: 1.5, 3: 2.25, 4: 3.5, 5: 5 };
    const starMult = (s) => STAR_MULT[clamp(Math.round(Number(s) || 1), 1, 5)];
    PC.starMult = starMult;

    // ISO week key ("2026-W40") — the used lots restock weekly.
    PC.weekKey = function (date = new Date()) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const day = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - day);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
        return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
    };
    PC.dayKey = function (date = new Date()) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };

    /* ============================================================
       Car components, wear and condition
       ============================================================ */
    // wear: % lost per "standard" race (≈150 km) for an average car.
    // cost: share of the car's (floored) price to restore 100 points.
    // risk: how much a worn component threatens a mechanical DNF.
    const COMPONENTS = {
        engine: { label: 'Engine', icon: '⚙️', wear: 7, cost: 0.05, risk: 1.0, w: 0.30 },
        gearbox: { label: 'Gearbox', icon: '🕹️', wear: 5, cost: 0.03, risk: 0.8, w: 0.15 },
        suspension: { label: 'Suspension', icon: '🔩', wear: 5, cost: 0.03, risk: 0.6, w: 0.15 },
        brakes: { label: 'Brakes', icon: '🛑', wear: 10, cost: 0.012, risk: 0.5, w: 0.10 },
        tyres: { label: 'Tyres', icon: '🛞', wear: 35, cost: 0.006, risk: 0.35, w: 0.20 },
        body: { label: 'Body & aero', icon: '🚘', wear: 3, cost: 0.03, risk: 0.15, w: 0.10 }
    };
    PC.COMPONENTS = COMPONENTS;
    PC.COMP_KEYS = Object.keys(COMPONENTS);

    // Track-type multipliers per component (types from SC.TRACK_TYPES).
    const TYPE_WEAR = {
        ss: { engine: 1.3, tyres: 0.9, brakes: 0.5, body: 1.2 },
        ov: { engine: 1.15, tyres: 1.0, brakes: 0.7 },
        so: { brakes: 1.5, body: 1.5, tyres: 1.15, suspension: 1.1 },
        rd: { brakes: 1.2, gearbox: 1.1 },
        st: { brakes: 1.4, body: 1.6, suspension: 1.3, gearbox: 1.2 },
        dt: { suspension: 1.8, body: 1.3, tyres: 1.2, engine: 1.1 },
        ry: { suspension: 2.0, body: 1.5, tyres: 1.3 },
        rx: { suspension: 1.7, body: 1.8, tyres: 1.3 },
        ar: { body: 4.0, suspension: 2.2, engine: 1.2 },
        f8: { body: 2.5, suspension: 1.6, brakes: 1.3 },
        kt: { tyres: 1.1, engine: 0.8, gearbox: 0.6 },
        hc: { engine: 1.1, brakes: 1.3, tyres: 0.6 }
    };
    PC.TYPE_WEAR = TYPE_WEAR;

    const TITLES = {
        clean: { label: 'Clean title', mult: 1 },
        rebuilt: { label: 'Rebuilt title', mult: 0.8 },
        salvage: { label: 'Salvage title', mult: 0.55 }
    };
    PC.TITLES = TITLES;

    function fullCond(v = 100) {
        const c = {};
        PC.COMP_KEYS.forEach(k => { c[k] = v; });
        return c;
    }
    PC.fullCond = fullCond;

    // Normalise any garage entry (legacy or new) into a complete car. Pure:
    // returns a new object; legacy fields are preserved untouched.
    PC.ensureCar = function (entry) {
        const e = { ...(entry || {}) };
        const cond = { ...fullCond(100), ...(e.cond || {}) };
        PC.COMP_KEYS.forEach(k => { cond[k] = clamp(Math.round(Number(cond[k]) || 0), 0, 100); });
        e.cond = cond;
        e.races = Math.max(0, Math.round(Number(e.races) || 0));
        e.km = Math.max(0, Math.round(Number(e.km) || 0));
        e.parts = { ...(e.parts || {}) };
        e.shelf = { ...(e.shelf || {}) };   // removed parts kept for refitting (labour only)
        e.tune = clamp(Math.round(Number(e.tune) || 0), 0, 3);
        e.title = TITLES[e.title] ? e.title : 'clean';
        e.hidden = Array.isArray(e.hidden) ? e.hidden.slice() : [];
        e.history = Array.isArray(e.history) ? e.history.slice() : [];
        e.stats = {
            performance: clamp(Math.round(Number(e.stats?.performance) || 5), 1, 10),
            durability: clamp(Math.round(Number(e.stats?.durability) || 5), 1, 10)
        };
        e.price = Math.max(0, Math.round(Number(e.price) || 0));
        return e;
    };

    PC.addHistory = function (car, icon, text, at) {
        car.history = [{ at: at || PC.dayKey(), icon, text: String(text).slice(0, 160) }, ...(car.history || [])].slice(0, 24);
        return car;
    };

    // Weighted average condition (what "overall condition" means everywhere).
    PC.overall = function (car) {
        const c = PC.ensureCar(car).cond;
        return Math.round(PC.COMP_KEYS.reduce((s, k) => s + c[k] * COMPONENTS[k].w, 0));
    };

    PC.condLabel = function (v) {
        v = Number(v) || 0;
        return v >= 90 ? 'Excellent' : v >= 75 ? 'Good' : v >= 55 ? 'Fair' : v >= 35 ? 'Worn' : v >= 15 ? 'Poor' : 'Failing';
    };
    PC.condTone = (v) => v >= 75 ? 'good' : v >= 45 ? 'warn' : 'bad';

    /* ============================================================
       Upgrade parts
       ============================================================ */
    // perf: performance-index points at tier "perf" 1.0. wear: multiplier
    // deltas per tier step on the named component (positive = faster wear).
    const PARTS = {
        engine: { label: 'Engine build', icon: '⚙️', comp: 'engine', perf: 2.2, wear: { engine: 0.06 }, desc: 'Forged internals and a blueprinted block — more power, a bit more stress.' },
        intake: { label: 'Intake & turbo', icon: '🌪️', comp: 'engine', perf: 1.6, wear: { engine: 0.05 }, desc: 'Bigger breathing. Strong gains, warmer engine.' },
        ecu: { label: 'ECU tune', icon: '💾', comp: 'engine', perf: 1.2, wear: { engine: 0.08 }, desc: 'Cheap power from a remap — at the cost of engine life.' },
        exhaust: { label: 'Race exhaust', icon: '💨', comp: 'engine', perf: 0.8, wear: {}, desc: 'Freer flow and a louder voice. Fans love it.' },
        cooling: { label: 'Cooling package', icon: '❄️', comp: 'engine', perf: 0, wear: { engine: -0.1, gearbox: -0.05 }, rel: 0.12, desc: 'Bigger radiators and oil coolers — the engine lasts longer and fails less.' },
        gearbox: { label: 'Sequential gearbox', icon: '🕹️', comp: 'gearbox', perf: 1.3, wear: { gearbox: -0.04 }, desc: 'Faster shifts and tougher internals.' },
        suspension: { label: 'Coilovers & dampers', icon: '🔩', comp: 'suspension', perf: 1.6, wear: { suspension: -0.05, tyres: -0.03 }, desc: 'Adjustable race suspension — more grip, kinder to tyres.' },
        brakes: { label: 'Big brake kit', icon: '🛑', comp: 'brakes', perf: 1.0, wear: { brakes: -0.12 }, desc: 'Bigger rotors and calipers — later braking, longer pad life.' },
        tyres: { label: 'Softer tyre compound', icon: '🛞', comp: 'tyres', perf: 1.5, wear: { tyres: 0.12 }, desc: 'More grip, faster wear. Pack spares.' },
        aero: { label: 'Aero kit', icon: '🪽', comp: 'body', perf: 1.4, wear: { body: 0.05 }, desc: 'Splitter, wing and diffuser. Expensive to fix after contact.' },
        weight: { label: 'Weight reduction', icon: '🪶', comp: 'body', perf: 1.2, wear: { body: 0.06 }, desc: 'Carbon panels and a stripped interior.' },
        cage: { label: 'Roll cage & safety', icon: '🛡️', comp: 'body', perf: -0.3, wear: { body: -0.15, suspension: -0.05 }, rel: 0.05, desc: 'Stiffer shell, far less damage in contact. Adds a little weight.' }
    };
    PC.PARTS = PARTS;

    const TIERS = [
        null,
        { tier: 1, id: 'street', label: 'Street', stars: '★', cost: 0.035, perf: 1.0 },
        { tier: 2, id: 'sport', label: 'Sport', stars: '★★', cost: 0.075, perf: 2.0 },
        { tier: 3, id: 'race', label: 'Race', stars: '★★★', cost: 0.14, perf: 3.4 },
        { tier: 4, id: 'elite', label: 'Elite', stars: '★★★★', cost: 0.24, perf: 5.0 }
    ];
    PC.TIERS = TIERS;

    const costBase = (car) => clamp(Number(car?.price) || 0, 10000, 220000);
    PC.costBase = costBase;

    // List price of a part at a tier (before shop multiplier).
    PC.partCost = function (car, partId, tier) {
        const t = TIERS[tier];
        if (!PARTS[partId] || !t) return 0;
        const weight = partId === 'exhaust' || partId === 'ecu' ? 0.6 : partId === 'cage' || partId === 'cooling' ? 0.7 : 1;
        return roundTo(costBase(car) * t.cost * weight, 50);
    };

    // Wear multiplier on a component from every installed part.
    function partWearMult(car, comp) {
        let m = 1;
        for (const [pid, p] of Object.entries(car.parts || {})) {
            const def = PARTS[pid];
            if (!def || !def.wear || !def.wear[comp]) continue;
            m += def.wear[comp] * (Number(p.tier) || 0);
        }
        return Math.max(0.35, m);
    }
    PC.partWearMult = partWearMult;

    /* ============================================================
       Performance index, reliability and value
       ============================================================ */
    PC.basePI = (car) => {
        const perf = clamp(Number(car?.stats?.performance) || 5, 1, 10);
        return 15 + perf * 7;
    };

    PC.upgradePI = function (car) {
        let pi = 0;
        for (const [pid, p] of Object.entries(car.parts || {})) {
            const def = PARTS[pid];
            const t = TIERS[p.tier];
            if (!def || !t) continue;
            pi += def.perf * t.perf * (Number(p.eff) || 1);
        }
        return pi + (Number(car.tune) || 0) * 1.2;
    };

    // Performance index 1–100: base car + upgrades − a penalty for wear.
    PC.pi = function (car) {
        const c = PC.ensureCar(car);
        const penalty = (100 - PC.overall(c)) * 0.22;
        return clamp(Math.round(PC.basePI(c) + PC.upgradePI(c) - penalty), 1, 100);
    };

    // Per-component mechanical risk for one race. Healthy parts barely ever
    // fail; below 60% the odds climb steeply.
    function compRisk(cond) {
        if (cond >= 60) return 0.002;
        const x = (60 - cond) / 60;
        return 0.002 + x * x * 0.33;
    }
    PC.riskBreakdown = function (car) {
        const c = PC.ensureCar(car);
        const dur = 1.3 - c.stats.durability / 10 * 0.6;
        let relBonus = 0;
        for (const [pid, p] of Object.entries(c.parts)) relBonus += (PARTS[pid]?.rel || 0) * (Number(p.tier) || 0);
        const relMult = Math.max(0.3, 1 - relBonus);
        const out = {};
        PC.COMP_KEYS.forEach(k => { out[k] = Math.min(0.9, compRisk(c.cond[k]) * COMPONENTS[k].risk * dur * relMult); });
        return out;
    };
    PC.failRisk = function (car) {
        const b = PC.riskBreakdown(car);
        return 1 - Object.values(b).reduce((p, r) => p * (1 - r), 1);
    };
    PC.reliability = (car) => Math.round((1 - PC.failRisk(car)) * 100);

    // Market value — what the car is worth to a buyer today.
    PC.depreciation = function (races) {
        races = Math.max(0, Number(races) || 0);
        if (!races) return 1;
        return 0.9 * (0.25 + 0.75 * Math.exp(-races / 120));
    };
    // Condition as a buyer sees it: tyres are consumables, so they barely
    // move the price; engine and chassis health do.
    PC.valueCondition = function (car) {
        const c = PC.ensureCar(car).cond;
        const keys = PC.COMP_KEYS.filter(k => k !== 'tyres');
        const w = keys.reduce((s, k) => s + COMPONENTS[k].w, 0);
        return keys.reduce((s, k) => s + c[k] * COMPONENTS[k].w, 0) / w * 0.92 + c.tyres * 0.08;
    };
    PC.upgradesValue = function (car) {
        let v = 0;
        for (const [pid, p] of Object.entries(car.parts || {})) v += PC.partCost(car, pid, p.tier) * 0.5 * (Number(p.eff) || 1);
        return v + (Number(car.tune) || 0) * costBase(car) * 0.004;
    };
    PC.marketValue = function (car) {
        if (!car) return 0;
        const raw = car;
        const c = PC.ensureCar(car);
        // Legacy entries with no paddock data, and untouched cars that have
        // never raced, hold their exact purchase price.
        if (!raw.cond && !raw.races) return c.price;
        if (!c.races && c.title === 'clean' && !c.tune && !Object.keys(c.parts).length && PC.valueCondition(c) >= 99.5) return c.price;
        const condFactor = 0.45 + 0.55 * PC.valueCondition(c) / 100;
        const v = c.price * PC.depreciation(c.races) * condFactor * TITLES[c.title].mult + PC.upgradesValue(c);
        return roundTo(Math.max(c.price * 0.05, v), 50);
    };
    // Dealer buy-back (straight sale) and trade-in (against a purchase).
    PC.SELL_RATIO = 0.6;
    PC.TRADE_RATIO = 0.72;
    PC.sellBackValue = (car) => Math.round(PC.marketValue(car) * PC.SELL_RATIO);
    PC.tradeInValue = (car) => Math.round(PC.marketValue(car) * PC.TRADE_RATIO);

    /* ============================================================
       Race wear — applied once per race the car starts
       ctx: { km, laps, type, result: { dnf, incidents, position },
              skills: { tyres, mechanical }, wearMult, failComp }
       ============================================================ */
    PC.raceDistanceFactor = function ({ km, laps } = {}) {
        if (Number(km) > 0) return clamp(Number(km) / 150, 0.4, 2.4);
        if (Number(laps) > 0) return clamp(Number(laps) / 40, 0.4, 2.4);
        return 1;
    };

    PC.applyRaceWear = function (car, ctx, r) {
        const c = PC.ensureCar(car);
        const before = { ...c.cond };
        const dist = PC.raceDistanceFactor(ctx);
        const tw = TYPE_WEAR[ctx.type] || {};
        const durMult = 1.35 - c.stats.durability / 10 * 0.6;
        const tyresSkill = Number(ctx.skills?.tyres) || 0;
        const mechSkill = Number(ctx.skills?.mechanical) || 0;
        const gm = Number(ctx.wearMult) > 0 ? Number(ctx.wearMult) : 1;
        const res = ctx.result || {};
        const notes = [];

        for (const k of PC.COMP_KEYS) {
            let w = COMPONENTS[k].wear * dist * (tw[k] || 1) * durMult * partWearMult(c, k) * rf(r, 0.8, 1.2) * gm;
            if (k === 'tyres') w *= 1 - clamp(tyresSkill, 0, 100) / 250;
            w *= 1 - clamp(mechSkill, 0, 100) / 500;
            c.cond[k] = clamp(c.cond[k] - w, 0, 100);
        }
        // Contact damage.
        const inc = Math.max(0, Math.round(Number(res.incidents) || 0));
        if (inc) {
            const cage = (c.parts.cage?.tier || 0) * 0.15;
            c.cond.body = clamp(c.cond.body - inc * rf(r, 4, 9) * (1 - cage) * gm, 0, 100);
            c.cond.suspension = clamp(c.cond.suspension - inc * rf(r, 1, 3.5) * (1 - cage) * gm, 0, 100);
            notes.push(`${inc} incident${inc > 1 ? 's' : ''} — bodywork damage`);
        }
        // A DNF hurts: either the component that failed or a crash.
        if (res.dnf) {
            const comp = ctx.failComp && COMPONENTS[ctx.failComp] ? ctx.failComp
                : (chance(r, 0.5) ? null : pick(r, ['engine', 'gearbox', 'suspension']));
            if (comp) {
                c.cond[comp] = clamp(c.cond[comp] - rf(r, 15, 32), 0, 100);
                notes.push(`${COMPONENTS[comp].label} failure`);
            } else {
                const cage = (c.parts.cage?.tier || 0) * 0.15;
                c.cond.body = clamp(c.cond.body - rf(r, 15, 35) * (1 - cage), 0, 100);
                c.cond.suspension = clamp(c.cond.suspension - rf(r, 8, 20) * (1 - cage), 0, 100);
                notes.push('Crash damage');
            }
        }
        // Undisclosed faults (bought used without an inspection) surface now.
        if (c.hidden.length) {
            for (const h of c.hidden) {
                if (COMPONENTS[h.comp]) c.cond[h.comp] = clamp(c.cond[h.comp] - (Number(h.drop) || 0), 0, 100);
                notes.push(`Hidden fault surfaced: ${h.label || COMPONENTS[h.comp]?.label}`);
            }
            c.hidden = [];
        }
        if (Number(ctx.extraTyres) > 0) c.cond.tyres = clamp(c.cond.tyres - Number(ctx.extraTyres), 0, 100);
        PC.COMP_KEYS.forEach(k => { c.cond[k] = Math.round(c.cond[k]); });
        if (ctx.countRace !== false) {
            c.races += 1;
            if (c.warranty > 0) c.warranty -= 1;
        }
        c.km += Math.round(Number(ctx.km) > 0 ? Number(ctx.km) : dist * 150);
        const delta = {};
        PC.COMP_KEYS.forEach(k => { delta[k] = c.cond[k] - before[k]; });
        return { car: c, delta, notes };
    };

    // Pre-race mechanical check: a seeded roll per race + car. When it
    // fails, the driver gets an order to retire on a given lap (honour it
    // in the sim, log a DNF).
    // riskMult: team efficiency (RaceRules.riskMult) — a well-run team breaks less.
    PC.gremlinCheck = function (car, { seed, laps = 0, riskMult = 1 } = {}) {
        const r = PC.rng(seed);
        const risk = Math.min(0.95, PC.failRisk(car) * (Number(riskMult) > 0 ? Number(riskMult) : 1));
        const roll = r();
        if (roll >= risk) return { fails: false, risk };
        const b = PC.riskBreakdown(car);
        const comp = weighted(r, Object.entries(b));
        const L = Math.max(1, Math.round(Number(laps) || 0));
        const lap = L > 1 ? clamp(Math.round(L * rf(r, 0.2, 0.9)), 1, L) : null;
        return { fails: true, risk, comp, lap, pct: Math.round(rf(r, 20, 90)) };
    };

    // The car's edge over an "average" 55-PI car, in AI-strength steps (±6).
    // Positive = your car is quicker than the field's, so LOWER the in-game
    // AI to let the paddock car's advantage show; negative = raise it.
    // (Format-aware tips live in RaceRules.aiTip.)
    PC.aiOffset = function (car) {
        return clamp(Math.round((PC.pi(car) - 55) / 6), -6, 6);
    };

    /* ============================================================
       Mechanic shops & services
       ============================================================ */
    const SHOPS = {
        wrench: {
            id: 'wrench', name: 'Wrench & Pray Garage', icon: '🪛', boss: 'Dale "Two-Socket" Hargrove',
            tagline: 'Cheapest labour in the county. Usually works.', priceMul: 0.7, quality: 0.55, botch: 0.12,
            specialties: ['repair', 'tyres'], minStars: 1
        },
        mainst: {
            id: 'mainst', name: 'Main Street Auto Care', icon: '🧰', boss: 'Priya Okafor',
            tagline: 'Honest service, fair prices, done by Friday.', priceMul: 0.92, quality: 0.72, botch: 0.05,
            specialties: ['service', 'tyres', 'brakes'], minStars: 1
        },
        dirt: {
            id: 'dirt', name: 'Dirt Slingers Fab Shop', icon: '🟤', boss: 'Buck Braddock',
            tagline: 'Cages, chassis and bent suspension straightened.', priceMul: 1.0, quality: 0.78, botch: 0.04,
            specialties: ['suspension', 'cage', 'body', 'weight', 'repair'], minStars: 1
        },
        apex: {
            id: 'apex', name: 'Apex Performance Tuning', icon: '🏎️', boss: 'Kasper Lindqvist',
            tagline: 'Dyno cells, turbo builds and very loud exhausts.', priceMul: 1.25, quality: 0.84, botch: 0.03,
            specialties: ['engine', 'intake', 'ecu', 'exhaust', 'cooling', 'tune', 'gearbox'], minStars: 1
        },
        factory: {
            id: 'factory', name: 'Factory Works Service Centre', icon: '🏭', boss: 'Elena Beaumont',
            tagline: 'Dealer service with genuine parts. Warranty work is free.', priceMul: 1.3, quality: 0.9, botch: 0.01,
            specialties: ['service', 'repair', 'engine', 'gearbox'], minStars: 1, warranty: true
        },
        aero: {
            id: 'aero', name: 'Velocity Aero Works', icon: '🪽', boss: 'Yuki Nakamura',
            tagline: 'Wind-tunnel developed aero and carbon bodywork.', priceMul: 1.4, quality: 0.86, botch: 0.03,
            specialties: ['aero', 'weight', 'body', 'brakes'], minStars: 2
        },
        precision: {
            id: 'precision', name: 'Precision Race Engineering', icon: '🔬', boss: 'Dr. Hugo Delacroix',
            tagline: 'Works-team standard. If you have to ask the price…', priceMul: 1.65, quality: 0.96, botch: 0.005,
            specialties: ['all'], minStars: 3
        }
    };
    PC.SHOPS = SHOPS;

    // What a job is. kind: 'repair' (comps), 'install' (part + tier),
    // 'tune' (dyno step), 'inspect' (reveal hidden faults), 'detail'.
    const SERVICES = {
        tyres: { label: 'Fresh tyres', icon: '🛞', kind: 'repair', comps: ['tyres'], cat: 'tyres' },
        brakes: { label: 'Brake pads & fluid', icon: '🛑', kind: 'repair', comps: ['brakes'], cat: 'brakes' },
        service: { label: 'Full service', icon: '🧰', kind: 'repair', comps: ['tyres', 'brakes', 'gearbox', 'suspension'], cat: 'service' },
        engine: { label: 'Engine rebuild', icon: '⚙️', kind: 'repair', comps: ['engine'], cat: 'engine' },
        gearbox: { label: 'Gearbox overhaul', icon: '🕹️', kind: 'repair', comps: ['gearbox'], cat: 'gearbox' },
        suspension: { label: 'Suspension rebuild', icon: '🔩', kind: 'repair', comps: ['suspension'], cat: 'suspension' },
        body: { label: 'Body & aero repair', icon: '🚘', kind: 'repair', comps: ['body'], cat: 'body' },
        restore: { label: 'Full restoration', icon: '✨', kind: 'repair', comps: PC.COMP_KEYS.slice(), cat: 'repair' },
        tune: { label: 'Dyno tune', icon: '📈', kind: 'tune', cat: 'tune' },
        inspect: { label: 'Inspection', icon: '🔍', kind: 'inspect', cat: 'service' },
        detail: { label: 'Detail & fresh livery', icon: '🧽', kind: 'detail', cat: 'body' },
        install: { label: 'Install a part', icon: '🧩', kind: 'install', cat: null },
        remove: { label: 'Remove a part', icon: '🪛', kind: 'remove', cat: null }
    };
    // What can be taken off a car: fitted parts, plus the dyno tune map.
    PC.removable = function (car) {
        const c = PC.ensureCar(car);
        const out = Object.entries(c.parts).map(([id, p]) => ({ id, label: `${TIERS[p.tier]?.label || ''} ${PARTS[id]?.label || id}`.trim(), icon: PARTS[id]?.icon || '🧩', perf: PARTS[id]?.perf || 0 }));
        if (c.tune > 0) out.push({ id: 'tune', label: `Dyno tune map (step ${c.tune}/3)`, icon: '📈', perf: 1 });
        return out;
    };
    PC.SERVICES = SERVICES;

    function shopFits(shop, cat) {
        const sp = shop?.specialties || [];
        return sp.includes('all') || (cat && sp.includes(cat));
    }
    PC.shopFits = shopFits;

    // Effective quality 0–1 for a job at a shop (or a DIY job).
    PC.jobQuality = function (shop, cat, { careful = false, diy = null } = {}) {
        if (diy) {
            const lvl = GARAGE_LEVELS[clamp(diy.level || 1, 1, 5)];
            const perk = (diy.mechanical || 0) >= 80 ? 0.1 : 0;
            return clamp(0.42 + (diy.mechanical || 0) / 250 + lvl.diyQuality + perk + (careful ? 0.05 : 0), 0.3, 1);
        }
        return clamp((shop?.quality || 0.7) + (shopFits(shop, cat) ? 0.05 : 0) + (careful ? 0.08 : 0), 0.3, 1);
    };

    // Price a job. Returns { parts, labor, total, lines[], ap? }. opts:
    // { diy: {level, mechanical}, econ, warranty } — DIY pays parts only.
    PC.quote = function (car, job, shop, opts = {}) {
        const c = PC.ensureCar(car);
        const econ = Number(opts.econ) > 0 ? Number(opts.econ) : 1;
        const svc = SERVICES[job.service] || SERVICES.install;
        const base = costBase(c);
        let partsCost = 0, labor = 0;
        const lines = [];
        if (svc.kind === 'repair') {
            const comps = job.comps && job.comps.length ? job.comps : svc.comps;
            for (const k of comps) {
                const missing = 100 - c.cond[k];
                if (missing <= 0) continue;
                const cost = Math.max(40, base * COMPONENTS[k].cost * missing / 100);
                partsCost += cost * 0.55;
                labor += cost * 0.45;
                lines.push(`${COMPONENTS[k].icon} ${COMPONENTS[k].label} ${c.cond[k]}% → ~100%`);
            }
        } else if (svc.kind === 'install') {
            const cost = PC.partCost(c, job.part, job.tier);
            const shelved = c.shelf[job.part] && Number(c.shelf[job.part].tier) === Number(job.tier);
            partsCost += shelved ? 0 : cost;
            labor += cost * 0.18 + 150;
            lines.push(`${PARTS[job.part]?.icon || '🧩'} ${TIERS[job.tier]?.label || ''} ${PARTS[job.part]?.label || 'part'}${shelved ? ' (from your shelf — labour only)' : ''}`);
        } else if (svc.kind === 'remove') {
            if (job.part === 'tune' ? c.tune > 0 : c.parts[job.part]) {
                const p = c.parts[job.part];
                labor += job.part === 'tune' ? 200 + base * 0.002 : PC.partCost(c, job.part, p.tier) * 0.08 + 120;
                lines.push(job.part === 'tune' ? '📈 Flash the stock engine map back' : `🪛 Take off the ${TIERS[p.tier]?.label || ''} ${PARTS[job.part]?.label || 'part'} (kept on your shelf)`);
            }
        } else if (svc.kind === 'tune') {
            labor += 350 + base * 0.004 * (c.tune + 1);
            lines.push(`📈 Dyno tune step ${c.tune + 1} of 3`);
        } else if (svc.kind === 'inspect') {
            labor += 150 + base * 0.003;
            lines.push('🔍 Full inspection and compression test');
        } else if (svc.kind === 'detail') {
            partsCost += 120 + base * 0.002;
            labor += 200;
            lines.push('🧽 Detail, polish and fresh livery');
        }
        const mul = opts.diy ? 0 : (shop?.priceMul || 1) * (shopFits(shop, svc.cat || job.part) ? 0.9 : 1);
        const partsMul = opts.diy ? 1 : (shop?.priceMul || 1) * 0.5 + 0.5;
        partsCost = partsCost * partsMul * econ;
        labor = labor * mul * econ;
        if (opts.warranty && shop?.warranty && svc.kind === 'repair') { partsCost = 0; labor = 0; lines.push('🛡️ Covered by warranty'); }
        partsCost = roundTo(partsCost, 10);
        labor = roundTo(labor, 10);
        const out = { parts: partsCost, labor, total: partsCost + labor, lines };
        if (opts.diy) out.ap = PC.diyAP(job, c);
        return out;
    };

    // Paddock-time cost of doing a job yourself.
    PC.diyAP = function (job, car) {
        const svc = SERVICES[job.service] || SERVICES.install;
        if (svc.kind === 'install') return 2 + (Number(job.tier) || 1);
        if (svc.kind === 'remove') return job.part === 'tune' ? 1 : 1 + Math.ceil((Number(car ? PC.ensureCar(car).parts[job.part]?.tier : 1) || 1) / 2);
        if (svc.kind === 'tune') return 3;
        if (svc.kind === 'inspect') return 1;
        if (svc.kind === 'detail') return 2;
        const per = { tyres: 1, brakes: 1, suspension: 2, gearbox: 2, body: 2, engine: 3 };
        const comps = job.comps && job.comps.length ? job.comps : svc.comps;
        const c = car ? PC.ensureCar(car) : null;
        return comps.filter(k => !c || c.cond[k] < 100).reduce((s, k) => s + (per[k] || 1), 0) || 1;
    };

    // What the garage level lets you do yourself.
    PC.diyAllowed = function (job, level) {
        const lvl = GARAGE_LEVELS[clamp(level || 1, 1, 5)];
        const svc = SERVICES[job.service] || SERVICES.install;
        if (svc.kind === 'install') return lvl.installs;
        if (svc.kind === 'remove') return job.part === 'tune' ? lvl.installs : lvl.level >= 3;
        if (svc.kind === 'tune') return lvl.tune;
        if (svc.kind === 'inspect' || svc.kind === 'detail') return true;
        const comps = job.comps && job.comps.length ? job.comps : svc.comps;
        return comps.every(k => lvl.diy.includes(k));
    };

    // Carry out a job. Returns { car, result: 'ok'|'botched', text, revealed? }.
    PC.performJob = function (car, job, quality, botchChance, r) {
        const c = PC.ensureCar(car);
        const svc = SERVICES[job.service] || SERVICES.install;
        const botched = chance(r, botchChance || 0);
        let text = '';
        let revealed = null;
        if (svc.kind === 'repair') {
            const comps = job.comps && job.comps.length ? job.comps : svc.comps;
            const target = Math.round(70 + 30 * quality);
            for (const k of comps) {
                let t = Math.max(c.cond[k], target + ri(r, -2, 2));
                if (botched && k === comps[0]) t = Math.max(c.cond[k], t - ri(r, 12, 25));
                c.cond[k] = clamp(t, 0, 100);
            }
            // A proper repair also finds and fixes any hidden faults in those parts.
            c.hidden = c.hidden.filter(h => !comps.includes(h.comp));
            text = `${svc.label}: ${comps.map(k => `${COMPONENTS[k].label} ${c.cond[k]}%`).join(', ')}`;
        } else if (svc.kind === 'install') {
            const def = PARTS[job.part];
            if (!def || !TIERS[job.tier]) throw new Error('Unknown part.');
            const eff = Math.round(clamp((0.85 + 0.15 * quality) * (botched ? 0.6 : 1), 0.3, 1) * 100) / 100;
            // Swapping a part out puts the old one on the shelf; refitting a shelved one uses it up.
            if (c.parts[job.part] && Number(c.parts[job.part].tier) !== Number(job.tier)) c.shelf[job.part] = { tier: c.parts[job.part].tier };
            else if (c.shelf[job.part] && Number(c.shelf[job.part].tier) === Number(job.tier)) delete c.shelf[job.part];
            c.parts[job.part] = { tier: job.tier, eff, at: PC.dayKey(), shop: job.shopName || null };
            if (botched) c.cond[def.comp] = clamp(c.cond[def.comp] - ri(r, 8, 16), 0, 100);
            text = `Installed ${TIERS[job.tier].label} ${def.label} (${Math.round(eff * 100)}% fitted)`;
        } else if (svc.kind === 'remove') {
            if (job.part === 'tune') {
                if (!c.tune) throw new Error('There is no dyno tune to remove.');
                c.tune = 0;
                text = 'Stock engine map flashed back';
            } else {
                const p = c.parts[job.part];
                if (!p) throw new Error('That part is not fitted.');
                c.shelf[job.part] = { tier: p.tier };
                delete c.parts[job.part];
                if (botched) c.cond[PARTS[job.part]?.comp || 'body'] = clamp(c.cond[PARTS[job.part]?.comp || 'body'] - ri(r, 4, 9), 0, 100);
                text = `Removed the ${TIERS[p.tier]?.label || ''} ${PARTS[job.part]?.label || 'part'} (on the shelf)`;
            }
        } else if (svc.kind === 'tune') {
            c.tune = clamp(c.tune + (botched ? 0 : 1), 0, 3);
            if (botched) c.cond.engine = clamp(c.cond.engine - ri(r, 5, 12), 0, 100);
            text = botched ? 'Dyno tune went wrong — engine stressed, no gain' : `Dyno tune step ${c.tune}/3`;
        } else if (svc.kind === 'inspect') {
            revealed = c.hidden.slice();
            text = revealed.length ? `Inspection found: ${revealed.map(h => h.label).join(', ')}` : 'Inspection: no hidden faults';
            c.inspected = true;
        } else if (svc.kind === 'detail') {
            c.cond.body = clamp(c.cond.body + 6, 0, 100);
            c.detailed = (Number(c.detailed) || 0) + 1;
            text = 'Detailed and re-liveried — showroom fresh';
        }
        if (botched && svc.kind !== 'inspect' && svc.kind !== 'detail') text += ' — botched job';
        return { car: c, result: botched ? 'botched' : 'ok', text, revealed };
    };

    /* ============================================================
       Garage levels (personal / team workshops)
       ============================================================ */
    const GARAGE_LEVELS = [
        null,
        { level: 1, name: 'Driveway', icon: '🏠', slots: 2, cost: 0, diy: ['tyres'], installs: false, tune: false, diyQuality: 0, desc: 'Room for a couple of cars. Tyre changes on the driveway.' },
        { level: 2, name: 'Lock-up Garage', icon: '🔐', slots: 3, cost: 6000, diy: ['tyres', 'brakes'], installs: false, tune: false, diyQuality: 0.02, desc: 'A rented unit with a trolley jack. Do your own brakes.' },
        { level: 3, name: 'Home Workshop', icon: '🧰', slots: 4, cost: 18000, diy: ['tyres', 'brakes', 'suspension', 'gearbox', 'body'], installs: false, tune: false, diyQuality: 0.05, desc: 'Ramps, an engine crane and proper tools.' },
        { level: 4, name: 'Race Shop', icon: '🏁', slots: 6, cost: 45000, diy: PC.COMP_KEYS.slice(), installs: true, tune: false, diyQuality: 0.1, desc: 'Fit your own upgrades and rebuild engines in-house.' },
        { level: 5, name: 'Pro Facility', icon: '🏭', slots: 8, cost: 100000, diy: PC.COMP_KEYS.slice(), installs: true, tune: true, diyQuality: 0.15, desc: 'Your own dyno cell. Works-team standard.' }
    ];
    PC.GARAGE_LEVELS = GARAGE_LEVELS;
    PC.garageLevel = (n) => GARAGE_LEVELS[clamp(Math.round(Number(n) || 1), 1, 5)];

    /* ============================================================
       Dealers — new (franchise) and used lots
       ============================================================ */
    const DEALERS = {
        phoenix: {
            id: 'phoenix', name: 'Phoenix Motors', icon: '🏬', kind: 'new',
            tagline: 'Franchise dealer — brand-new cars, a 5-race factory warranty and financing.',
            warrantyRaces: 5, finance: true
        },
        secondgear: {
            id: 'secondgear', name: 'Second Gear Pre-Owned', icon: '🔑', kind: 'used',
            tagline: 'Certified pre-owned. Mostly honest, firm on price.',
            honesty: 0.85, markup: 1.08, haggle: 0.92, patience: 3, count: 6, races: [4, 60], upgradeOdds: 0.15, titleOdds: { rebuilt: 0.05, salvage: 0 }
        },
        lucky: {
            id: 'lucky', name: "Lucky Lou's Auto Lot", icon: '🎲', kind: 'used',
            tagline: 'Bargains! Every car runs*. (*at time of sale)',
            honesty: 0.35, markup: 0.97, haggle: 0.78, patience: 2, count: 6, races: [25, 150], upgradeOdds: 0.2, titleOdds: { rebuilt: 0.2, salvage: 0.1 }
        },
        exchange: {
            id: 'exchange', name: 'Race Car Exchange', icon: '🏁', kind: 'used',
            tagline: 'Ex-race cars with upgrades already fitted. Ridden hard.',
            honesty: 0.7, markup: 1.12, haggle: 0.88, patience: 3, count: 5, races: [15, 90], upgradeOdds: 0.9, titleOdds: { rebuilt: 0.15, salvage: 0.03 }
        },
        auction: {
            id: 'auction', name: 'Salvage Auction', icon: '🔨', kind: 'used',
            tagline: 'Insurance write-offs, sold as seen. No haggling, no returns.',
            honesty: 0.15, markup: 0.62, haggle: 1, patience: 0, count: 4, races: [30, 200], upgradeOdds: 0.25, titleOdds: { rebuilt: 0.2, salvage: 0.7 }, asIs: true
        }
    };
    PC.DEALERS = DEALERS;
    PC.USED_DEALERS = Object.values(DEALERS).filter(d => d.kind === 'used').map(d => d.id);

    const HISTORIES = [
        'One careful owner, garaged every winter.',
        'Ex-league car. Raced hard, maintained harder.',
        'Former track-day toy. Lots of laps, few crashes.',
        'Rebuilt after a big off at the hairpin.',
        'Imported. Paperwork "mostly" in order.',
        'Barely used — the owner got scared of it.',
        'Previous owner was a weekend club racer.',
        'Sat in a barn for two seasons. Starts first time.',
        'Ex-driving-school car. Clutch has seen things.',
        'Spare car from a pro team, never raced in anger.',
        'Fleet return from a rental track experience.',
        'Owned by a mechanic. Or so he says.'
    ];
    const FAULTS = [
        { comp: 'engine', label: 'tired piston rings', drop: [15, 30] },
        { comp: 'engine', label: 'head-gasket weep', drop: [18, 35] },
        { comp: 'gearbox', label: 'worn synchros', drop: [15, 28] },
        { comp: 'suspension', label: 'bent wishbone', drop: [15, 30] },
        { comp: 'suspension', label: 'leaking dampers', drop: [10, 22] },
        { comp: 'brakes', label: 'warped rotors', drop: [15, 30] },
        { comp: 'body', label: 'hidden chassis rust', drop: [12, 25] },
        { comp: 'body', label: 'filler hiding crash damage', drop: [15, 30] }
    ];
    PC.FAULTS = FAULTS;

    // Build one used listing from a catalog model.
    function makeListing(r, dealer, model, id) {
        const races = ri(r, dealer.races[0], dealer.races[1]);
        // True condition: older cars are tireder; tyres are random.
        const base = clamp(95 - races * 0.35 + rf(r, -15, 10), 18, 98);
        const cond = {};
        PC.COMP_KEYS.forEach(k => {
            cond[k] = Math.round(clamp(base + rf(r, -18, 12) + (k === 'tyres' ? rf(r, -30, 15) : 0), 5, 100));
        });
        let title = 'clean';
        const to = dealer.titleOdds || {};
        const roll = r();
        if (roll < (to.salvage || 0)) title = 'salvage';
        else if (roll < (to.salvage || 0) + (to.rebuilt || 0)) title = 'rebuilt';
        if (title === 'salvage') { cond.body = Math.min(cond.body, ri(r, 15, 50)); cond.suspension = Math.min(cond.suspension, ri(r, 25, 60)); }

        // Faults the seller may not mention.
        const hidden = [];
        const faultCount = chance(r, 1 - dealer.honesty) ? ri(r, 1, races > 80 ? 3 : 2) : 0;
        for (const f of shuffle(r, FAULTS).slice(0, faultCount)) {
            if (hidden.some(h => h.comp === f.comp)) continue;
            hidden.push({ comp: f.comp, label: f.label, drop: ri(r, f.drop[0], f.drop[1]) });
        }
        // Pre-fitted upgrades (ex-race cars especially).
        const parts = {};
        if (chance(r, dealer.upgradeOdds || 0)) {
            const n = ri(r, 1, dealer.id === 'exchange' ? 4 : 2);
            for (const pid of shuffle(r, Object.keys(PARTS)).slice(0, n)) {
                parts[pid] = { tier: ri(r, 1, dealer.id === 'exchange' ? 3 : 2), eff: Math.round(rf(r, 0.75, 1) * 100) / 100, at: null, shop: 'previous owner' };
            }
        }
        const car = PC.ensureCar({
            id: id, sourceId: model.id || null, carId: model.carId, name: model.name, emoji: model.emoji || '🚗',
            gameId: model.gameId || null, imageUrl: model.imageUrl || '', price: model.price,
            stats: model.stats, condition: 'used', cond, races, km: races * ri(r, 110, 190), parts, title, hidden,
            tag: 'Used'
        });
        // .cond is what the advert says; .hidden faults knock it down after
        // the first race (or show up in an inspection).
        const trueCar = PC.revealedCar(car, true);
        const trueValue = PC.marketValue(trueCar);
        const shownValue = PC.marketValue(car);
        const asking = roundTo(shownValue * dealer.markup * rf(r, 0.96, 1.08), 100);
        // The lowest the dealer will go: never far under what the car is
        // really worth to them, never above the sticker.
        const floor = roundTo(Math.min(asking, Math.max(trueValue * 0.9, asking * dealer.haggle)), 50);
        return {
            id, dealer: dealer.id, modelId: model.id || null, car,
            history: pick(r, HISTORIES), asking: Math.max(500, asking), floor: Math.max(400, floor),
            shownOverall: PC.overall(car), trueOverall: PC.overall(trueCar)
        };
    }

    // Advertised version of a car: hidden faults not yet applied, so the
    // listing shows better numbers than reality. revealed=true → the truth.
    PC.revealedCar = function (car, revealed) {
        const c = PC.ensureCar(car);
        if (revealed) {
            for (const h of c.hidden) c.cond[h.comp] = clamp(c.cond[h.comp] - h.drop, 0, 100);
            c.hidden = [];
            return c;
        }
        return c; // hidden faults live in .hidden; .cond is what's advertised
    };

    // A dealer's whole lot for a week. models: the catalog (array of
    // { id, name, carId, price, stats, emoji, gameId, imageUrl }).
    PC.usedLot = function (dealerId, { week, salt = 0, models = [], count = null } = {}) {
        const dealer = DEALERS[dealerId];
        if (!dealer || dealer.kind !== 'used' || !models.length) return [];
        const r = PC.rng(`lot|${dealerId}|${week}|${salt}`);
        const n = count || dealer.count;
        const out = [];
        for (let i = 0; i < n; i++) {
            const model = models[Math.floor(r() * models.length)];
            out.push(makeListing(r, dealer, model, `${dealerId}-${week}-${salt}-${i}`));
        }
        return out;
    };

    // Haggling. state: { attempts, lastCounter, walked } (per buyer+listing).
    // Returns { outcome: 'accept'|'counter'|'walk'|'insulted', price, state, line }.
    PC.haggle = function (listing, offer, state = {}, { media = 0, dealerLicense = false } = {}) {
        const dealer = DEALERS[listing.dealer] || { patience: 2, haggle: 0.9 };
        const st = { attempts: 0, lastCounter: listing.asking, walked: false, ...state };
        offer = Math.round(Number(offer) || 0);
        if (st.walked) return { outcome: 'walk', price: null, state: st, line: 'The salesman won\'t even look at you now. Come back next week.' };
        if (dealer.asIs || !dealer.patience) return { outcome: 'walk', price: null, state: st, line: 'Auction lots are sold at the posted price. No haggling.' };
        // Negotiation skill and a dealer licence shave the floor.
        const floor = Math.round(listing.floor * (1 - clamp(media, 0, 100) / 100 * 0.05) * (dealerLicense ? 0.94 : 1));
        st.attempts += 1;
        if (offer >= Math.min(floor, st.lastCounter)) {
            return { outcome: 'accept', price: Math.min(offer, st.lastCounter), state: st, line: pickLine(['"You drive a hard bargain. Deal!"', '"Fine. Keys are in it."', '"My boss is going to kill me. Sold."'], offer) };
        }
        if (offer < floor * 0.8) {
            st.attempts += 1; // insulting offers burn patience twice as fast
            if (st.attempts > dealer.patience) { st.walked = true; return { outcome: 'walk', price: null, state: st, line: '"Are you serious? Get off my lot."' }; }
            return { outcome: 'insulted', price: st.lastCounter, state: st, line: `"That's insulting. Still ${money(st.lastCounter)}."` };
        }
        if (st.attempts > dealer.patience) { st.walked = true; return { outcome: 'walk', price: null, state: st, line: '"We\'re going in circles. I\'ve got other customers."' }; }
        // Meet partway between their last number and the floor.
        const counter = roundTo(Math.max(floor, st.lastCounter - (st.lastCounter - Math.max(offer, floor)) * 0.5), 50);
        st.lastCounter = counter;
        return { outcome: 'counter', price: counter, state: st, line: `"I can do ${money(counter)}. That's practically cost."` };
    };
    function pickLine(lines, n) { return lines[Math.abs(Math.round(n)) % lines.length]; }
    function money(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('en-US'); }

    // Car finance: 20% down, the rest over N races at a credit-scored rate.
    PC.financePlan = function (price, { credit = 650, races = 12 } = {}) {
        price = Math.round(Number(price) || 0);
        const rate = clamp(0.16 - (clamp(credit, 300, 850) - 300) / 550 * 0.1, 0.05, 0.16);
        const down = roundTo(price * 0.2, 10);
        const financed = price - down;
        const total = Math.round(financed * (1 + rate));
        const perRace = Math.ceil(total / races / 10) * 10;
        return { price, down, financed, rate, races, total, perRace };
    };

    /* ============================================================
       Driver skills (RPG attributes)
       ============================================================ */
    const SKILLS = {
        pace: { label: 'Pace', icon: '⏱️', desc: 'Raw one-lap speed.', perks: [[10, 'Quick Learner', 'Training XP +10%'], [16, 'Qualifying Ace', 'Simulated races: +2 pace']] },
        racecraft: { label: 'Racecraft', icon: '🥊', desc: 'Wheel-to-wheel fighting.', perks: [[10, 'Elbows Out', 'Club races: better results'], [16, 'Overtaker', 'Simulated races: fewer places lost']] },
        consistency: { label: 'Consistency', icon: '🎯', desc: 'Clean, repeatable laps.', perks: [[10, 'Metronome', 'Fewer incidents in simulated races'], [16, 'Clean Machine', 'Sponsors +2 happiness per race']] },
        tyres: { label: 'Tyre management', icon: '🛞', desc: 'Looking after the rubber.', perks: [[10, 'Smooth Operator', 'Tyre wear −15%'], [16, 'Tyre Whisperer', 'Tyre wear −30%']] },
        wet: { label: 'Wet weather', icon: '🌧️', desc: 'Pace when it rains.', perks: [[10, 'Rain Dancer', 'Wet races give bonus fans'], [16, 'Rainmaster', 'Wet races give bonus XP']] },
        fitness: { label: 'Fitness', icon: '💪', desc: 'Stamina in and out of the car.', perks: [[10, 'Iron Lungs', '+2 paddock time'], [16, 'Marathon Runner', '+4 paddock time']] },
        media: { label: 'Media', icon: '🎤', desc: 'Interviews, sponsors and haggling.', perks: [[10, 'Camera Ready', 'Sponsor offers +10%'], [16, 'Brand Icon', '+1 personal sponsor slot']] },
        mechanical: { label: 'Mechanical', icon: '🔧', desc: 'Feedback and spanner skills.', perks: [[10, 'Mechanical Sympathy', 'All wear −8%'], [16, 'Wrench Wizard', 'DIY quality +10%']] }
    };
    PC.SKILLS = SKILLS;
    PC.SKILL_KEYS = Object.keys(SKILLS);
    PC.MAX_LEVEL = 20;
    PC.xpToNext = (lvl) => 40 + 20 * lvl;
    PC.skillValue = (s) => clamp((Number(s?.lvl) || 0) * 5, 0, 100);

    PC.newSkills = function (r) {
        const out = {};
        PC.SKILL_KEYS.forEach(k => { out[k] = { lvl: 6, xp: 0 }; });
        if (r) for (let i = 0; i < 3; i++) out[pick(r, PC.SKILL_KEYS)].lvl += 1;
        return out;
    };
    PC.skillValues = function (skills) {
        const v = {};
        PC.SKILL_KEYS.forEach(k => { v[k] = PC.skillValue(skills?.[k]); });
        return v;
    };
    PC.hasPerk = (skills, key, level) => (Number(skills?.[key]?.lvl) || 0) >= level;

    // Add XP to skills; returns { skills, levelUps: [{ key, lvl }] }.
    PC.gainXP = function (skills, gains) {
        const s = JSON.parse(JSON.stringify(skills || PC.newSkills()));
        const levelUps = [];
        const learner = PC.hasPerk(s, 'pace', 10) ? 1.1 : 1;
        for (const [k, amount] of Object.entries(gains || {})) {
            if (!s[k]) s[k] = { lvl: 6, xp: 0 };
            let xp = (Number(s[k].xp) || 0) + Math.round((Number(amount) || 0) * learner);
            while (s[k].lvl < PC.MAX_LEVEL && xp >= PC.xpToNext(s[k].lvl)) {
                xp -= PC.xpToNext(s[k].lvl);
                s[k].lvl += 1;
                levelUps.push({ key: k, lvl: s[k].lvl });
            }
            s[k].xp = s[k].lvl >= PC.MAX_LEVEL ? 0 : xp;
        }
        return { skills: s, levelUps };
    };

    // Driver rating (55–95 scale the league's sim and market use).
    PC.ratingFromSkills = function (skills) {
        const v = PC.skillValues(skills);
        return Math.round(50 + (v.pace * 0.35 + v.racecraft * 0.25 + v.consistency * 0.2 + v.tyres * 0.1 + v.wet * 0.1) * 0.45);
    };

    // XP for one race result. res: { position, dnf, incidents, start, pole, fastestLap }.
    PC.raceXP = function (res, { wet = false } = {}) {
        if (!res) return {};
        const pos = Number(res.position) || 0;
        let total = 25;
        if (res.dnf) total = 10;
        else if (pos === 1) total += 40;
        else if (pos && pos <= 3) total += 25;
        else if (pos && pos <= 5) total += 15;
        else if (pos && pos <= 10) total += 8;
        if (!res.dnf && !(Number(res.incidents) > 0)) total += 10;
        const gained = !res.dnf && Number(res.start) && pos ? Number(res.start) - pos : 0;
        if (gained > 0) total += Math.min(30, gained * 3);
        if (res.pole) total += 10;
        if (res.fastestLap) total += 8;
        const g = {
            pace: total * 0.3, racecraft: total * 0.25, consistency: total * 0.2, tyres: total * 0.15,
            fitness: 5 + total * (wet ? 0 : 0.1)
        };
        if (wet) g.wet = total * (0.1 + 0.1);
        Object.keys(g).forEach(k => { g[k] = Math.round(g[k]); });
        return g;
    };

    // Fans earned from a race.
    PC.raceFans = function (res, { wet = false, wetPerk = false } = {}) {
        if (!res) return 0;
        const pos = Number(res.position) || 0;
        let f = 10;
        if (!res.dnf) {
            if (pos === 1) f += 200; else if (pos && pos <= 3) f += 80; else if (pos && pos <= 10) f += 25;
        }
        if (res.pole) f += 20;
        if (res.fastestLap) f += 10;
        if (wet && wetPerk) f = Math.round(f * 1.3);
        return f;
    };

    // Merch sales per race from the fan base. The merch stand opens at
    // 1,000 fans — before that nobody's buying your caps.
    PC.MERCH_FANS = 1000;
    PC.merchFor = (fans, econ = 1) => (Number(fans) || 0) < PC.MERCH_FANS ? 0 : roundTo((Number(fans) || 0) * 0.02 * econ, 10);

    /* ============================================================
       Paddock time (action points)
       ============================================================ */
    PC.AP_BASE = 10;
    PC.apMax = function (skills, base = PC.AP_BASE) {
        return base + (PC.hasPerk(skills, 'fitness', 16) ? 4 : PC.hasPerk(skills, 'fitness', 10) ? 2 : 0);
    };
    // Lazy daily regeneration: returns { ap, apAt } for "now".
    PC.regenAP = function (ap, apAt, { max, perDay = 4, now = Date.now() } = {}) {
        ap = Math.max(0, Number(ap) || 0);
        const last = Number(apAt) || now;
        const days = Math.floor((now - last) / 86400000);
        if (days <= 0) return { ap: Math.min(ap, max), apAt: last };
        return { ap: Math.min(max, ap + days * perDay), apAt: last + days * 86400000 };
    };

    /* ============================================================
       Training
       ============================================================ */
    const TRAINING = {
        sim: { label: 'Simulator session', icon: '🖥️', ap: 2, cost: 300, xp: { pace: 60, consistency: 30 }, desc: 'Hours on the rig learning the next track.' },
        karting: { label: 'Karting test day', icon: '🛞', ap: 3, cost: 500, xp: { racecraft: 70, pace: 20 }, desc: 'Elbows-out practice against the local hotshoes.' },
        gym: { label: 'Gym & cardio block', icon: '🏋️', ap: 2, cost: 150, xp: { fitness: 80 }, desc: 'Neck, core and heart-rate work.' },
        media: { label: 'Media coaching', icon: '🎤', ap: 2, cost: 400, xp: { media: 80 }, desc: 'Interview practice and social-media strategy.' },
        engineering: { label: 'Engineering workshop', icon: '🔧', ap: 2, cost: 350, xp: { mechanical: 80 }, desc: 'Learn to read data and turn spanners.' },
        tyreclinic: { label: 'Tyre clinic', icon: '🛞', ap: 2, cost: 450, xp: { tyres: 80 }, desc: 'A tyre engineer explains degradation.' },
        wetschool: { label: 'Wet-weather school', icon: '🌧️', ap: 3, cost: 650, xp: { wet: 90, consistency: 20 }, desc: 'A day on a soaked skid pan.' },
        coach: { label: 'Private driver coach', icon: '🧑‍🏫', ap: 4, cost: 2500, xp: { pace: 80, racecraft: 60, consistency: 60 }, desc: 'A former champion rides along. Expensive, effective.' }
    };
    PC.TRAINING = TRAINING;
    PC.trainingCost = (key, econ = 1) => roundTo((TRAINING[key]?.cost || 0) * econ, 10);
    PC.runTraining = function (key, r) {
        const t = TRAINING[key];
        if (!t) throw new Error('Unknown training session.');
        const gains = {};
        for (const [k, v] of Object.entries(t.xp)) gains[k] = Math.round(v * rf(r, 0.85, 1.2));
        return gains;
    };

    /* ============================================================
       Side events between races
       ctx: { car (or null), skills, fans, econ, sponsors (count), rating }
       ============================================================ */
    const SIDE_EVENTS = {
        trackday: { label: 'Track day', icon: '🏁', ap: 3, fee: 250, needsCar: true, wear: 0.5, desc: 'Lap after lap with no pressure. Great practice, some wear.' },
        clubrace: { label: 'Club race', icon: '🏆', ap: 3, fee: 400, needsCar: true, wear: 0.85, desc: 'A local club race. Prize money for the podium, risk of contact.' },
        hillclimb: { label: 'Hill climb', icon: '⛰️', ap: 3, fee: 350, needsCar: true, wear: 0.6, desc: 'One car, one hill, beat the clock. Rewards a quick car.' },
        drift: { label: 'Drift exhibition', icon: '🌀', ap: 2, fee: 0, needsCar: true, wear: 0.4, desc: 'Smoke show for the crowd. Paid appearance, eats tyres.' },
        carshow: { label: 'Cars & coffee show', icon: '☕', ap: 1, fee: 0, needsCar: true, wear: 0, desc: 'Park it, polish it, talk to fans. Upgrades and condition win trophies.' },
        stream: { label: 'Sim-racing stream', icon: '🎮', ap: 2, fee: 0, needsCar: false, wear: 0, desc: 'Go live on your rig. Builds fans and media skill.' },
        charity: { label: 'Charity karting', icon: '🤝', ap: 2, fee: 300, needsCar: false, wear: 0, desc: 'Race celebrities for a good cause. Fans love it.' },
        photo: { label: 'Sponsor photo shoot', icon: '📸', ap: 1, fee: 0, needsCar: false, wear: 0, needsSponsor: true, desc: 'Smile for the brand. Every sponsor gets happier.' }
    };
    PC.SIDE_EVENTS = SIDE_EVENTS;

    // Each side event once per paddock week (league: per calendar week and
    // per race run; Solo: per round). weekId is the caller's notion of "week".
    PC.eventDone = (p, key, weekId) => !!(p?.weekly && p.weekly.id === weekId && (p.weekly.done || []).includes(key));
    PC.markEvent = function (p, key, weekId) {
        if (!p.weekly || p.weekly.id !== weekId) p.weekly = { id: weekId, done: [] };
        p.weekly.done = [...new Set([...(p.weekly.done || []), key])];
    };

    PC.runSideEvent = function (key, ctx, r) {
        const ev = SIDE_EVENTS[key];
        if (!ev) throw new Error('Unknown event.');
        const econ = Number(ctx.econ) > 0 ? Number(ctx.econ) : 1;
        const sk = PC.skillValues(ctx.skills);
        const car = ctx.car ? PC.ensureCar(ctx.car) : null;
        const pi = car ? PC.pi(car) : 50;
        const out = { money: 0, fans: 0, xp: {}, wear: null, text: '', sponsorHappy: 0, place: null, crash: false };
        // Side events wear the car like a short race but don't add a race start.
        const wearCtx = (mult, extra = {}) => ({ km: 150 * mult, type: extra.type || 'rd', result: extra.result || {}, skills: sk, countRace: false, extraTyres: extra.extraTyres || 0 });

        if (key === 'trackday') {
            out.xp = { pace: ri(r, 30, 50), consistency: ri(r, 18, 32), mechanical: ri(r, 5, 12) };
            out.fans = ri(r, 10, 40);
            const crash = chance(r, 0.05 * (1.2 - sk.consistency / 100));
            out.crash = crash;
            out.wear = { mult: ev.wear, ctx: wearCtx(ev.wear, { result: crash ? { incidents: 2 } : {} }) };
            out.text = crash ? 'You pushed too hard into the last corner and kissed the wall. Lesson learned.' : 'A full day of laps. You found a tenth in the slow corners.';
        } else if (key === 'clubrace') {
            const field = ri(r, 12, 20);
            const score = pi * 0.5 + (Number(ctx.rating) || PC.ratingFromSkills(ctx.skills)) * 0.5 + (PC.hasPerk(ctx.skills, 'racecraft', 10) ? 4 : 0) + rf(r, -12, 12);
            const rivals = 60 + rf(r, -3, 3);
            let place = clamp(Math.round(field / 2 - (score - rivals) / 2.2 + rf(r, -2, 2)), 1, field);
            const crash = chance(r, 0.08 * (1.3 - sk.racecraft / 100));
            if (crash) place = null;
            out.place = place; out.crash = crash;
            const prizes = [800, 500, 300, 200, 100];
            out.money = place && place <= 5 ? roundTo(prizes[place - 1] * econ, 10) : 0;
            out.fans = place === 1 ? ri(r, 90, 150) : place && place <= 3 ? ri(r, 50, 90) : ri(r, 15, 40);
            out.xp = { racecraft: ri(r, 40, 60), pace: ri(r, 15, 25), consistency: ri(r, 8, 15) };
            out.wear = { mult: ev.wear, ctx: wearCtx(ev.wear, { result: { dnf: crash, incidents: crash ? 0 : ri(r, 0, 2) } }) };
            out.text = crash ? 'Taken out on lap 3 by a guy in a rental helmet. DNF.' : `Finished P${place} of ${field}.${place === 1 ? ' Club champion for the day! 🏆' : ''}`;
        } else if (key === 'hillclimb') {
            const score = pi * 0.65 + sk.pace * 0.35 + rf(r, -10, 10);
            const place = clamp(Math.round(10 - (score - 55) / 3), 1, 20);
            out.place = place;
            const prizes = [600, 350, 200];
            out.money = place <= 3 ? roundTo(prizes[place - 1] * econ, 10) : 0;
            out.fans = place === 1 ? ri(r, 60, 120) : ri(r, 15, 50);
            out.xp = { pace: ri(r, 25, 40), consistency: ri(r, 20, 30) };
            out.wear = { mult: ev.wear, ctx: wearCtx(ev.wear, { type: 'hc' }) };
            out.text = `Class P${place}. ${place === 1 ? 'Fastest up the hill! ⛰️' : place <= 3 ? 'On the podium.' : 'The hill won today.'}`;
        } else if (key === 'drift') {
            out.money = roundTo(rf(r, 200, 600) * (1 + Math.min(1, (ctx.fans || 0) / 10000)) * econ, 10);
            out.fans = ri(r, 60, 200);
            out.xp = { racecraft: ri(r, 15, 25), media: ri(r, 15, 25) };
            out.wear = { mult: ev.wear, ctx: wearCtx(ev.wear, { extraTyres: ri(r, 18, 32) }) };
            out.text = 'Tyre smoke everywhere. The crowd went wild.';
        } else if (key === 'carshow') {
            const appeal = (car ? PC.overall(car) * 0.4 + Object.keys(car.parts).length * 6 + (Number(car.detailed) ? 8 : 0) + (car.price / 6000) : 0) + rf(r, -10, 10);
            const trophy = appeal > 60 ? (appeal > 80 ? 'Best in Show' : 'Class winner') : null;
            out.money = trophy ? roundTo((trophy === 'Best in Show' ? 400 : 150) * econ, 10) : 0;
            out.fans = Math.round(20 + Math.max(0, appeal) * 0.8);
            out.xp = { media: ri(r, 15, 25) };
            out.text = trophy ? `Your ${car?.name || 'car'} took ${trophy}! 🏆` : 'Plenty of people stopped to look. No trophy this time.';
        } else if (key === 'stream') {
            out.fans = ri(r, 40, 160) + Math.round(sk.media * 0.6);
            out.money = roundTo(rf(r, 50, 250) * econ, 10);
            out.xp = { media: ri(r, 30, 45), pace: ri(r, 8, 14) };
            out.text = pick(r, ['Chat loved the commentary.', 'A big streamer raided you mid-race.', 'Three hours, one rage-quit, lots of new followers.']);
        } else if (key === 'charity') {
            out.fans = ri(r, 80, 200);
            out.xp = { racecraft: ri(r, 20, 35), media: ri(r, 15, 25) };
            out.text = pick(r, ['You beat a pop star into turn one. Headlines everywhere.', 'Raised a lot for the children\'s hospital.', 'Lost to a weather presenter. The fans found it hilarious.']);
        } else if (key === 'photo') {
            out.sponsorHappy = ri(r, 8, 14);
            out.fans = ri(r, 10, 40);
            out.xp = { media: ri(r, 20, 35) };
            out.text = 'The brand team got their shots. Everyone is happy.';
        }
        return out;
    };

    /* ============================================================
       Paddock decision cards (random between-race events)
       Effects: money, fans, xp {}, ap, sponsorHappy, carDamage {comp: n},
                carRepair {comp: n}, credit, giftCar (used listing spec)
       Values with [a, b] are ranges rolled at resolve time.
       ============================================================ */
    const CARDS = [
        {
            id: 'journalist', icon: '📰', title: 'A journalist wants a quote',
            text: 'A paddock reporter asks what you make of your rivals\' pace this season.',
            choices: [
                { id: 'humble', label: 'Stay humble', effects: { fans: [10, 30], xp: { media: 25 } }, note: 'Safe, polite, forgettable.' },
                { id: 'bold', label: 'Say you\'ll beat them all', effects: { fans: [60, 160], xp: { media: 35 }, sponsorHappy: -4 }, note: 'Fans love it. Sponsors wince.' },
                { id: 'skip', label: 'No comment', effects: { fans: [-10, 0] } }
            ]
        },
        {
            id: 'barnfind', icon: '🏚️', title: 'Barn find!',
            text: 'A farmer down the road has an old race car under a tarp. "Make me an offer," he says.',
            choices: [
                { id: 'buy', label: 'Buy it as-is', effects: { giftCar: { priceShare: [0.18, 0.3], cond: [15, 55], races: [80, 220] } }, costShare: true, note: 'Could be a gem. Could be scrap.' },
                { id: 'pass', label: 'Pass', effects: {} }
            ]
        },
        {
            id: 'hospitality', icon: '🥂', title: 'Sponsor hospitality night',
            text: 'Your sponsors are hosting clients and want you there signing caps.',
            requires: 'sponsor',
            choices: [
                { id: 'go', label: 'Go and work the room', effects: { ap: -2, sponsorHappy: 10, fans: [20, 50], xp: { media: 30 } } },
                { id: 'decline', label: 'Decline politely', effects: { sponsorHappy: -6 } }
            ]
        },
        {
            id: 'tip', icon: '🧑‍🔧', title: 'An old mechanic\'s tip',
            text: 'A veteran mechanic offers to show you a trick with your car\'s setup — for a price.',
            requires: 'car',
            choices: [
                { id: 'pay', label: 'Pay for the secret', money: -600, effects: { xp: { mechanical: 70 }, carRepair: { suspension: 10 } } },
                { id: 'pass', label: 'Thanks, I\'ll figure it out', effects: { xp: { mechanical: 10 } } }
            ]
        },
        {
            id: 'pothole', icon: '🕳️', title: 'Pothole on the way home',
            text: 'You clatter through a pothole on the trailer ramp. Something sounded expensive.',
            requires: 'car',
            choices: [
                { id: 'fix', label: 'Pay for a quick fix', money: -350, effects: {} },
                { id: 'ignore', label: 'It\'s probably fine', effects: { carDamage: { suspension: [8, 18] } } }
            ]
        },
        {
            id: 'fanclub', icon: '📣', title: 'Start an official fan club?',
            text: 'A superfan offers to run your official fan club if you fund the merch.',
            choices: [
                { id: 'fund', label: 'Fund it', money: -1000, effects: { fans: [250, 450], xp: { media: 20 } } },
                { id: 'no', label: 'Not right now', effects: {} }
            ]
        },
        {
            id: 'rival', icon: '😤', title: 'A rival mocks you online',
            text: 'A rival posts a clip of your last mistake with a laughing emoji.',
            choices: [
                { id: 'clapback', label: 'Clap back', effects: { fans: [40, 120], sponsorHappy: -3, xp: { media: 15 } } },
                { id: 'train', label: 'Answer on track — go train', effects: { ap: -1, xp: { racecraft: 45, pace: 20 } } },
                { id: 'ignore', label: 'Rise above it', effects: { xp: { consistency: 15 } } }
            ]
        },
        {
            id: 'tyredeal', icon: '🛞', title: 'Tyre supplier clearance',
            text: 'A supplier is clearing old stock: fresh tyres fitted today at half price.',
            requires: 'car',
            choices: [
                { id: 'buy', label: 'Fit them', money: -250, effects: { carRepair: { tyres: 100 } } },
                { id: 'pass', label: 'No thanks', effects: {} }
            ]
        },
        {
            id: 'auction', icon: '🖊️', title: 'Charity auction',
            text: 'Organisers ask you to donate a signed race suit for a charity auction.',
            choices: [
                { id: 'donate', label: 'Donate it', effects: { fans: [80, 180], credit: 5 } },
                { id: 'no', label: 'It\'s my lucky suit', effects: {} }
            ]
        },
        {
            id: 'ticket', icon: '🚓', title: 'Speeding ticket',
            text: 'Caught doing 20 over in the tow car. Pay up or fight it?',
            choices: [
                { id: 'pay', label: 'Pay the fine', money: -300, effects: {} },
                { id: 'fight', label: 'Fight it in court', effects: { gamble: { win: 0.45, winEffects: { fans: [5, 20] }, loseEffects: { money: -900, fans: [-30, -10] } } } }
            ]
        },
        {
            id: 'engineoffer', icon: '⚙️', title: 'Engine builder\'s offer',
            text: 'An engine builder has a cancelled order: a fresh rebuild for your car at a big discount.',
            requires: 'car',
            choices: [
                { id: 'take', label: 'Take the rebuild', moneyShare: -0.012, effects: { carRepair: { engine: 100 } } },
                { id: 'pass', label: 'Not this time', effects: {} }
            ]
        },
        {
            id: 'esports', icon: '🎮', title: 'Esports invitational',
            text: 'You\'re invited to a televised sim race against real-world pros.',
            choices: [
                { id: 'enter', label: 'Enter', effects: { ap: -2, gamble: { win: 0.4, winEffects: { money: 2000, fans: [150, 300] }, loseEffects: { money: 200, fans: [30, 80] } }, xp: { pace: 30 } } },
                { id: 'skip', label: 'Skip it', effects: {} }
            ]
        },
        {
            id: 'mentor', icon: '🧓', title: 'A retired champion calls',
            text: 'A retired champion saw your last race and offers a free coaching session.',
            choices: [
                { id: 'accept', label: 'Accept gratefully', effects: { ap: -2, xp: { pace: 50, racecraft: 40, consistency: 40 } } },
                { id: 'later', label: 'Maybe later', effects: {} }
            ]
        },
        {
            id: 'flood', icon: '🌧️', title: 'Storm warning',
            text: 'A storm is coming and your car is parked outside.',
            requires: 'car',
            choices: [
                { id: 'cover', label: 'Rent a covered bay for the night', money: -150, effects: {} },
                { id: 'risk', label: 'Leave it', effects: { gamble: { win: 0.6, winEffects: {}, loseEffects: { carDamage: { body: [6, 15] } } } } }
            ]
        },
        {
            id: 'bank', icon: '🏦', title: 'The bank calls',
            text: 'Your bank offers a credit review if you bring your racing accounts up to date.',
            choices: [
                { id: 'review', label: 'Do the paperwork', effects: { ap: -1, credit: 20 } },
                { id: 'ignore', label: 'Ignore it', effects: {} }
            ]
        }
    ];
    PC.CARDS = CARDS;
    PC.cardById = (id) => CARDS.find(c => c.id === id) || null;

    // Draw the next card. ctx: { hasCar, hasSponsor, recent: [ids] }.
    PC.drawCard = function (r, ctx = {}) {
        const pool = CARDS.filter(c =>
            (!c.requires || (c.requires === 'car' ? ctx.hasCar : c.requires === 'sponsor' ? ctx.hasSponsor : true))
            && !(ctx.recent || []).includes(c.id));
        const list = pool.length ? pool : CARDS.filter(c => !c.requires);
        return pick(r, list).id;
    };

    // Resolve a choice into concrete effects (ranges rolled, gambles settled).
    PC.resolveCard = function (cardId, choiceId, r, ctx = {}) {
        const card = PC.cardById(cardId);
        const choice = card?.choices.find(c => c.id === choiceId);
        if (!card || !choice) throw new Error('That choice is no longer available.');
        const out = { money: 0, fans: 0, xp: {}, ap: 0, sponsorHappy: 0, carDamage: {}, carRepair: {}, credit: 0, giftCar: null, text: '', won: null };
        const roll = (v) => Array.isArray(v) ? ri(r, Math.min(v[0], v[1]), Math.max(v[0], v[1])) : (Number(v) || 0);
        const carPrice = Number(ctx.carPrice) || 30000;
        if (choice.money) out.money += choice.money;
        if (choice.moneyShare) out.money += roundTo(choice.moneyShare * clamp(carPrice, 10000, 220000), 10);
        const apply = (eff) => {
            if (!eff) return;
            if (eff.money) out.money += roll(eff.money);
            if (eff.fans) out.fans += roll(eff.fans);
            if (eff.ap) out.ap += roll(eff.ap);
            if (eff.sponsorHappy) out.sponsorHappy += roll(eff.sponsorHappy);
            if (eff.credit) out.credit += roll(eff.credit);
            for (const [k, v] of Object.entries(eff.xp || {})) out.xp[k] = (out.xp[k] || 0) + roll(v);
            for (const [k, v] of Object.entries(eff.carDamage || {})) out.carDamage[k] = (out.carDamage[k] || 0) + roll(v);
            for (const [k, v] of Object.entries(eff.carRepair || {})) out.carRepair[k] = Math.max(out.carRepair[k] || 0, roll(v));
            if (eff.giftCar) {
                const g = eff.giftCar;
                const model = ctx.model || { name: 'Mystery race car', carId: 'mystery-race-car', price: 30000, stats: { performance: 5, durability: 5 }, emoji: '🚗' };
                const price = roundTo(model.price * rf(r, g.priceShare[0], g.priceShare[1]), 100);
                const cond = {};
                PC.COMP_KEYS.forEach(k => { cond[k] = ri(r, g.cond[0], g.cond[1]); });
                out.money -= price;
                out.giftCar = PC.ensureCar({ ...model, condition: 'used', cond, races: ri(r, g.races[0], g.races[1]), title: chance(r, 0.4) ? 'rebuilt' : 'clean', tag: 'Barn find' });
                out.giftCar.paid = price;
            }
            if (eff.gamble) {
                const won = chance(r, eff.gamble.win);
                out.won = won;
                apply(won ? eff.gamble.winEffects : eff.gamble.loseEffects);
            }
        };
        apply(choice.effects);
        out.text = `${card.icon} ${card.title}: ${choice.label}${out.won === true ? ' — it paid off!' : out.won === false ? ' — it didn\'t go your way.' : ''}`;
        return out;
    };

    /* ============================================================
       Sponsors — offers, objectives, happiness, renewals
       ============================================================ */
    const DRIVER_SLOTS = {
        primary: { label: 'Primary personal sponsor', mult: 1.0, count: 1 },
        apparel: { label: 'Helmet & apparel', mult: 0.6, count: 1 },
        partner: { label: 'Social & digital partner', mult: 0.35, count: 2 }
    };
    const TEAM_SLOTS = {
        title: { label: 'Title sponsor', mult: 3.0, count: 1 },
        primary: { label: 'Primary sponsor', mult: 1.6, count: 2 },
        associate: { label: 'Associate sponsor', mult: 0.7, count: 3 }
    };
    PC.DRIVER_SLOTS = DRIVER_SLOTS;
    PC.TEAM_SLOTS = TEAM_SLOTS;
    PC.slotsFor = (kind) => kind === 'team' ? TEAM_SLOTS : DRIVER_SLOTS;
    PC.slotCount = function (kind, slot, { skills = null } = {}) {
        const def = PC.slotsFor(kind)[slot];
        if (!def) return 0;
        return def.count + (kind === 'driver' && slot === 'partner' && PC.hasPerk(skills, 'media', 16) ? 1 : 0);
    };

    const OBJECTIVES = {
        starts: { label: (n) => `Start ${n} race${n > 1 ? 's' : ''}`, diff: 0.1 },
        finish: { label: (n) => `Finish ${n} race${n > 1 ? 's' : ''}`, diff: 0.25 },
        clean: { label: (n) => `${n} clean race${n > 1 ? 's' : ''} (no incidents)`, diff: 0.35 },
        top10: { label: (n) => `${n} top-10 finish${n > 1 ? 'es' : ''}`, diff: 0.4 },
        gain: { label: (n) => `Gain 3+ places in ${n} race${n > 1 ? 's' : ''}`, diff: 0.45 },
        top5: { label: (n) => `${n} top-5 finish${n > 1 ? 'es' : ''}`, diff: 0.55 },
        podium: { label: (n) => `${n} podium${n > 1 ? 's' : ''}`, diff: 0.7 },
        pole: { label: (n) => `${n} pole position${n > 1 ? 's' : ''}`, diff: 0.8 },
        win: { label: (n) => `Win ${n} race${n > 1 ? 's' : ''}`, diff: 0.95 }
    };
    PC.OBJECTIVES = OBJECTIVES;
    PC.objLabel = (o) => o && OBJECTIVES[o.kind] ? OBJECTIVES[o.kind].label(o.target) : '—';

    // Does a result satisfy an objective for this race?
    PC.objectiveHit = function (kind, res) {
        if (!res) return false;
        const pos = Number(res.position) || 0;
        const fin = !res.dnf && pos > 0;
        switch (kind) {
            case 'starts': return true;
            case 'finish': return fin;
            case 'clean': return fin && !(Number(res.incidents) > 0);
            case 'top10': return fin && pos <= 10;
            case 'gain': return fin && Number(res.start) > 0 && Number(res.start) - pos >= 3;
            case 'top5': return fin && pos <= 5;
            case 'podium': return fin && pos <= 3;
            case 'pole': return !!res.pole;
            case 'win': return fin && pos === 1;
            default: return false;
        }
    };

    const FALLBACK_BRANDS = [
        ['Velocity Energy Drinks', 'Energy drinks'], ['Apex Lubricants', 'Oil & fuels'], ['TurboByte Cloud', 'Technology'],
        ['IronGrip Tires', 'Tires'], ['Nova Financial', 'Banking'], ['Meteor Watches', 'Luxury goods'],
        ['Crossflow Airlines', 'Travel'], ['Blacksmith Tools', 'Hardware'], ['Quantum Telecom', 'Telecom'],
        ['Redline Apparel', 'Clothing'], ['Summit Insurance', 'Insurance'], ['Fusion Batteries', 'Automotive'],
        ['Golden Wing Brewery', 'Beverages'], ['Halcyon Gaming', 'Gaming'], ['Kestrel Logistics', 'Logistics'],
        ['Zenith Optics', 'Optics'], ['Cobalt Components', 'Automotive parts'], ['Ember Coffee Co.', 'Food & drink'],
        ['Stratos Media', 'Media'], ['Atlas Steel', 'Industrial'], ['Pulsar Headsets', 'Electronics'],
        ['Tundra Outdoor', 'Outdoor gear'], ['Monarch Hotels', 'Hospitality'], ['Ridgeway Homes', 'Real estate']
    ].map(([name, industry]) => ({ name, industry }));
    PC.FALLBACK_BRANDS = FALLBACK_BRANDS;

    // Generate sponsor offers. ctx: { kind: 'driver'|'team', stars, fans,
    // media, econ, brands, taken: [brand names], industries: [taken], count,
    // skills, minStarsByBrand: { name: stars } }
    PC.sponsorOffers = function (r, ctx = {}) {
        const kind = ctx.kind === 'team' ? 'team' : 'driver';
        const stars = clamp(Math.round(Number(ctx.stars) || 1), 1, 5);
        const fans = Math.max(0, Number(ctx.fans) || 0);
        const media = clamp(Number(ctx.media) || 30, 0, 100);
        const econ = Number(ctx.econ) > 0 ? Number(ctx.econ) : 1;
        const slots = PC.slotsFor(kind);
        const base = (kind === 'team' ? 400 : 250) * starMult(stars) * (1 + Math.min(3, fans / 5000))
            * (0.8 + media / 250) * (PC.hasPerk(ctx.skills, 'media', 10) ? 1.1 : 1) * econ;
        const taken = new Set((ctx.taken || []).map(s => String(s).toLowerCase()));
        const takenInd = new Set((ctx.industries || []).map(s => String(s).toLowerCase()));
        const brands = shuffle(r, (ctx.brands && ctx.brands.length ? ctx.brands : FALLBACK_BRANDS)
            .filter(b => !taken.has(String(b.name).toLowerCase()) && !takenInd.has(String(b.industry || '').toLowerCase())
                && (Number(b.minStars) || 1) <= stars));
        const count = clamp(Number(ctx.count) || 3, 1, 6);
        const kinds = Object.keys(OBJECTIVES);
        const out = [];
        for (let i = 0; i < count && i < brands.length; i++) {
            const b = brands[i];
            const slot = weighted(r, kind === 'team'
                ? [['title', 0.15], ['primary', 0.35], ['associate', 0.5]]
                : [['primary', 0.25], ['apparel', 0.35], ['partner', 0.4]]);
            // Harder objectives at higher prestige.
            const maxDiff = 0.3 + stars * 0.14;
            const objKind = pick(r, kinds.filter(k => OBJECTIVES[k].diff <= maxDiff));
            const races = ri(r, 4, 10);
            const d = OBJECTIVES[objKind].diff;
            const target = clamp(Math.round(races * (d < 0.3 ? rf(r, 0.6, 0.9) : d < 0.6 ? rf(r, 0.3, 0.6) : rf(r, 0.1, 0.3))), 1, races);
            const perRace = roundTo(base * slots[slot].mult * rf(r, 0.8, 1.25), 10);
            out.push({
                id: `so-${hashStr(b.name + '|' + r()).toString(36)}`,
                brand: b.name, industry: b.industry || 'General', kind, slot, slotLabel: slots[slot].label,
                perRace: Math.max(50, perRace),
                signing: roundTo(perRace * rf(r, 0.5, 1.5), 10),
                races, obj: { kind: objKind, target, hits: 0 },
                bonus: roundTo(perRace * races * (0.15 + d * 0.5), 50),
                happy: 60, pushed: false
            });
        }
        return out;
    };

    // "Push for more": one try per offer. Returns { ok, offer }.
    PC.pushOffer = function (offer, r, { media = 30, stars = 1 } = {}) {
        if (offer.pushed) return { ok: false, offer, withdrawn: false };
        const p = clamp(0.35 + media / 250 + (stars - 1) * 0.05, 0.2, 0.85);
        if (chance(r, p)) {
            const bump = rf(r, 0.1, 0.2);
            return { ok: true, withdrawn: false, offer: { ...offer, pushed: true, perRace: roundTo(offer.perRace * (1 + bump), 10), bonus: roundTo(offer.bonus * (1 + bump), 50) } };
        }
        return { ok: false, withdrawn: chance(r, 0.5), offer: { ...offer, pushed: true, happy: 50 } };
    };

    PC.signDeal = function (offer, at) {
        return {
            id: offer.id, brand: offer.brand, industry: offer.industry, kind: offer.kind, slot: offer.slot, slotLabel: offer.slotLabel,
            perRace: offer.perRace, bonus: offer.bonus, races: offer.races, racesLeft: offer.races,
            obj: { ...offer.obj, hits: 0 }, happy: offer.happy || 60, since: at || PC.dayKey(), request: null, paid: 0
        };
    };

    // One race for one deal. res = the driver's result (team deals: best
    // car). Returns { deal, pay, bonus, ended, walked, renew, lines[] }.
    PC.sponsorRace = function (deal, res, r, { cleanPerk = false } = {}) {
        const d = { ...deal, obj: { ...deal.obj } };
        const lines = [];
        const pay = d.perRace;
        d.paid = (Number(d.paid) || 0) + pay;
        if (PC.objectiveHit(d.obj.kind, res)) { d.obj.hits = (Number(d.obj.hits) || 0) + 1; }
        const pos = Number(res?.position) || 0;
        let h = 0;
        if (res?.dnf) h -= 4;
        else if (pos === 1) h += 8; else if (pos && pos <= 3) h += 6; else if (pos && pos <= 10) h += 3; else h -= 1;
        if (!res?.dnf && !(Number(res?.incidents) > 0)) h += 2;
        if (Number(res?.incidents) >= 3) h -= 3;
        if (cleanPerk) h += 2;
        // Behind schedule on the objective makes them nervous.
        const done = d.races - d.racesLeft + 1;
        const expected = d.obj.target * done / d.races;
        if (d.obj.hits + 0.5 < expected * 0.7) h -= 2;
        d.happy = clamp(Math.round((Number(d.happy) || 60) + h), 0, 100);
        d.racesLeft = Math.max(0, (Number(d.racesLeft) || 0) - 1);
        // Appearance requests: expire after two races if ignored.
        if (d.request) {
            d.request.racesLeft = (Number(d.request.racesLeft) || 2) - 1;
            if (d.request.racesLeft <= 0) { d.happy = clamp(d.happy - 10, 0, 100); lines.push(`${d.brand} is annoyed you skipped their ${d.request.label}.`); d.request = null; }
        } else if (d.racesLeft > 1 && chance(r, 0.22)) {
            d.request = pick(r, [
                { key: 'store', label: 'store opening', ap: 2 },
                { key: 'video', label: 'promo video shoot', ap: 1 },
                { key: 'clients', label: 'client hot-lap day', ap: 2 },
                { key: 'social', label: 'social-media takeover', ap: 1 }
            ]);
            d.request = { ...d.request, racesLeft: 2 };
            lines.push(`${d.brand} asks you to attend a ${d.request.label}.`);
        }
        let bonus = 0, ended = false, walked = false, renew = null;
        if (d.happy < 20 && d.racesLeft > 0) {
            walked = true; ended = true;
            lines.push(`${d.brand} pulled out of the deal — results and attitude weren't good enough.`);
        } else if (d.racesLeft <= 0) {
            ended = true;
            if (d.obj.hits >= d.obj.target) { bonus = d.bonus; lines.push(`${d.brand}: objective met — bonus paid!`); }
            else lines.push(`${d.brand}: objective missed (${d.obj.hits}/${d.obj.target}). No bonus.`);
            if (d.happy >= 50) {
                const up = d.obj.hits >= d.obj.target ? rf(r, 0.12, 0.25) : rf(r, -0.05, 0.08);
                renew = { perRace: roundTo(d.perRace * (1 + up), 10), races: ri(r, 5, 10) };
            }
        }
        return { deal: d, pay, bonus, ended, walked, renew, lines };
    };

    // Turn a renewal into a fresh offer from the same brand.
    PC.renewalOffer = function (deal, renew, r) {
        const kinds = Object.keys(OBJECTIVES);
        const objKind = pick(r, kinds.filter(k => OBJECTIVES[k].diff <= 0.7));
        const target = clamp(Math.round(renew.races * rf(r, 0.25, 0.6)), 1, renew.races);
        return {
            id: `so-${hashStr(deal.brand + '|renew|' + r()).toString(36)}`,
            brand: deal.brand, industry: deal.industry, kind: deal.kind, slot: deal.slot, slotLabel: deal.slotLabel,
            perRace: renew.perRace, signing: roundTo(renew.perRace * 0.5, 10), races: renew.races,
            obj: { kind: objKind, target, hits: 0 }, bonus: roundTo(renew.perRace * renew.races * 0.3, 50),
            happy: Math.max(60, deal.happy), pushed: false, renewal: true
        };
    };

    /* ============================================================
       Loans & credit
       ============================================================ */
    const LOANS = {
        micro: { id: 'micro', label: 'Quick cash loan', icon: '💵', amount: 5000, races: 6, rate: 0.1, minStars: 1 },
        starter: { id: 'starter', label: 'Racer starter loan', icon: '🏁', amount: 15000, races: 10, rate: 0.14, minStars: 1 },
        growth: { id: 'growth', label: 'Growth loan', icon: '📈', amount: 40000, races: 14, rate: 0.18, minStars: 2 },
        big: { id: 'big', label: 'Championship push', icon: '🏆', amount: 100000, races: 20, rate: 0.22, minStars: 3 }
    };
    PC.LOANS = LOANS;
    PC.creditLimit = ({ stars = 1, fans = 0, credit = 650 } = {}) =>
        roundTo((10000 + clamp(stars, 1, 5) * 15000 + Math.max(0, fans) * 3) * (0.6 + (clamp(credit, 300, 850) - 300) / 550 * 0.8), 500);
    PC.loanTerms = function (id, { credit = 650, econ = 1 } = {}) {
        const L = LOANS[id];
        if (!L) return null;
        const amount = roundTo(L.amount * econ, 100);
        const rate = clamp(L.rate + (650 - clamp(credit, 300, 850)) / 1000, 0.04, 0.4);
        const total = Math.round(amount * (1 + rate));
        return { ...L, amount, rate, total, perRace: Math.ceil(total / L.races / 10) * 10 };
    };
    // Credit score after a payment: on time (wallet still ≥ 0) builds it,
    // a payment that pushes you into the red hurts.
    PC.creditAfterPayment = (credit, balanceAfter) =>
        clamp(Math.round((Number(credit) || 650) + (balanceAfter >= 0 ? 6 : -35)), 300, 850);

    /* ============================================================
       Car dealer role — AI walk-in buyers and lot sizes
       ============================================================ */
    PC.lotCapacity = (stars) => 4 + 2 * clamp(Math.round(Number(stars) || 1), 1, 5);
    PC.TRADE_DISCOUNT = { new: 0.08, used: 0.12 };
    // Daily chance an AI customer buys a listed lot car, from how its
    // retail price compares with what it's really worth.
    PC.aiBuyerChance = function (car, retail, { stars = 1, fans = 0 } = {}) {
        const value = PC.marketValue(car);
        if (!value || !retail) return 0;
        const ratio = retail / value;
        if (ratio > 1.45) return 0;
        const base = ratio <= 0.95 ? 0.45 : ratio <= 1.1 ? 0.3 : ratio <= 1.25 ? 0.15 : 0.05;
        return clamp(base * (1 + (clamp(stars, 1, 5) - 1) * 0.08) * (1 + Math.min(0.5, fans / 20000)) * (car.detailed ? 1.15 : 1), 0, 0.75);
    };

    /* ============================================================
       Mechanic role — walk-in diagnosis jobs
       ============================================================ */
    const SYMPTOMS = [
        { text: 'Grinding noise every time I brake', answer: 'brakes', wrong: ['gearbox', 'engine'] },
        { text: 'Steering wheel shakes above 100 mph', answer: 'tyres', wrong: ['engine', 'brakes'] },
        { text: 'Blue smoke from the exhaust on throttle', answer: 'engine', wrong: ['gearbox', 'body'] },
        { text: 'Gears crunch going into third', answer: 'gearbox', wrong: ['brakes', 'suspension'] },
        { text: 'Car wallows and bounces over kerbs', answer: 'suspension', wrong: ['tyres', 'engine'] },
        { text: 'Pedal goes soft after a few hard laps', answer: 'brakes', wrong: ['suspension', 'gearbox'] },
        { text: 'Loses power and overheats in traffic', answer: 'engine', wrong: ['body', 'tyres'] },
        { text: 'Front splitter scrapes and the bumper rattles', answer: 'body', wrong: ['suspension', 'engine'] },
        { text: 'Clunk from the rear when I lift off', answer: 'suspension', wrong: ['gearbox', 'brakes'] },
        { text: 'Pops out of gear on the overrun', answer: 'gearbox', wrong: ['engine', 'tyres'] },
        { text: 'Tyres are bald on the inside edge only', answer: 'suspension', wrong: ['tyres', 'brakes'] },
        { text: 'Misfires and stutters at high revs', answer: 'engine', wrong: ['gearbox', 'suspension'] },
        { text: 'Understeers badly and the tread is cracked', answer: 'tyres', wrong: ['body', 'engine'] },
        { text: 'Wind noise and a loose panel at speed', answer: 'body', wrong: ['tyres', 'gearbox'] }
    ];
    PC.SYMPTOMS = SYMPTOMS;
    const OWNERS = ['a nervous track-day dad', 'a delivery driver', 'a karting mum', 'a retired rally driver', 'a teenager with a loan',
        'a club racer', 'a local news anchor', 'a vintage collector', 'a ride-share driver', 'a stunt performer'];
    const JOB_CARS = ['hatchback', 'pickup truck', 'track-day coupé', 'old rally car', 'family estate', 'muscle car', 'hot hatch', 'roadster', 'van', 'kit car'];

    // Today's walk-ins for a mechanic. stars: prestige (pay + hints).
    PC.walkInJobs = function (seed, { stars = 1, count = 3, econ = 1 } = {}) {
        const r = PC.rng(`walkin|${seed}`);
        const out = [];
        const sy = shuffle(r, SYMPTOMS);
        for (let i = 0; i < count; i++) {
            const s = sy[i % sy.length];
            const options = shuffle(r, [s.answer, ...s.wrong]);
            out.push({
                id: `wi-${hashStr(seed + '|' + i).toString(36)}`,
                owner: pick(r, OWNERS), car: pick(r, JOB_CARS), symptom: s.text, options, answer: s.answer,
                pay: roundTo(rf(r, 150, 450) * starMult(stars) * econ, 10), ap: ri(r, 1, 2), xp: ri(r, 8, 16)
            });
        }
        return out;
    };
    // Hint for skilled mechanics: one wrong option struck out.
    PC.walkInHint = function (job, stars) {
        if ((Number(stars) || 1) < 3) return null;
        return job.options.find(o => o !== job.answer) || null;
    };

    // Quality a player-run shop delivers (by the mechanic's prestige stars).
    PC.playerShopQuality = (stars) => clamp(0.62 + 0.07 * clamp(Math.round(Number(stars) || 1), 1, 5), 0.6, 0.97);
    PC.playerShop = function (profile, stars) {
        const shop = profile?.shop || {};
        return {
            id: 'player:' + (profile?.id || ''), name: shop.name || `${profile?.name || 'Player'}'s Garage`, icon: '👤',
            boss: profile?.name || 'A league mechanic', tagline: shop.tagline || 'Run by a league mechanic.',
            priceMul: clamp(Number(shop.laborMul) || 1, 0.6, 1.8), quality: PC.playerShopQuality(stars),
            botch: clamp(0.08 - 0.015 * clamp(stars, 1, 5), 0.005, 0.08),
            specialties: shop.specialty ? [shop.specialty] : ['repair'], minStars: 1, player: true,
            uid: profile?.uid || null, profileId: profile?.id || null
        };
    };

    /* ============================================================
       Fresh paddock state for a player
       ============================================================ */
    PC.newPaddock = function (seed, now = Date.now()) {
        const r = PC.rng(`paddock|${seed}`);
        return {
            v: VERSION, ap: PC.AP_BASE, apAt: now, fans: 50, credit: 650,
            skills: PC.newSkills(r), garageLevel: 1,
            sponsors: [], offers: [], offersAt: 0,
            loans: [], card: null, cardAt: 0, cardsSeen: 0, recentCards: [],
            seq: 0, haggle: {}, inspected: {},
            stats: { sideEvents: 0, trainings: 0, shopJobs: 0, diyJobs: 0, carsBought: 0, carsSold: 0, cardsPlayed: 0, earned: 0 },
            log: []
        };
    };
    PC.ensurePaddock = function (p, seed, now = Date.now()) {
        const base = PC.newPaddock(seed, now);
        if (!p || typeof p !== 'object') return base;
        const out = { ...base, ...p };
        out.skills = { ...base.skills, ...(p.skills || {}) };
        out.stats = { ...base.stats, ...(p.stats || {}) };
        ['sponsors', 'offers', 'loans', 'log', 'recentCards'].forEach(k => { if (!Array.isArray(out[k])) out[k] = []; });
        ['haggle', 'inspected'].forEach(k => { if (!out[k] || typeof out[k] !== 'object') out[k] = {}; });
        return out;
    };
    PC.logLine = function (p, icon, text, at) {
        p.log = [{ at: at || PC.dayKey(), icon, text: String(text).slice(0, 180) }, ...(p.log || [])].slice(0, 40);
        return p;
    };
    // Next seeded rng for a player (advances their sequence).
    PC.nextRng = function (p, uid, tag = '') {
        p.seq = (Number(p.seq) || 0) + 1;
        return PC.rng(`${uid}|${tag}|${p.seq}`);
    };

    root.PaddockCore = PC;
    if (typeof module !== 'undefined' && module.exports) module.exports = PC;
})(typeof window !== 'undefined' ? window : globalThis);
