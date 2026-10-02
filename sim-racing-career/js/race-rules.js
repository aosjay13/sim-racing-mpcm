/* ============================================================
   Phoenix SRMPC — Race rules (shared by the league and Solo)
   How a series treats equipment, and how a result is checked.

   - Equipment formats: spec (identical cars), BoP (different
     cars balanced per model), open (build to a class limit).
   - Team efficiency: staff, workshop, car prep and race-day crew.
     It moves pace in simulated races, the offline AI tip, race
     wear and the odds of a mechanical gremlin.
   - What each sim can actually enforce: iRacing per-car power %
     and weight, ACC / AC per-entry ballast and restrictor,
     Wreckfest / GT7 / Forza class limits, the rest by AI level.
   - Race sheets: race code, session name, every setting a host
     or an offline racer needs, entry lists for ACC / AC.
   - Result checks: does a results file or screenshot match the
     race sheet (track, session, laps, code, date, field, car,
     the driver's own claim)? invalid / unverified / valid.

   Pure functions with no DOM — the Node tests load this file.
   ============================================================ */
'use strict';

(function (root) {
    const RR = {};
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
    RR.clamp = clamp;

    function hash(s) {
        let h = 2166136261;
        for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
        return h >>> 0;
    }
    RR.hash = hash;

    /* ============================================================
       Equipment formats
       ============================================================ */
    RR.FORMATS = {
        spec: {
            id: 'spec', label: 'Spec', icon: '🟰', tag: 'Identical cars', upgrades: false,
            desc: 'Everyone races the same car. Performance parts and engine maps are illegal; safety and cooling parts are fine. Teams win on preparation, staff, setup and execution.',
            real: 'IndyCar, Formula 2 / 3 / 4, NASCAR Next Gen, one-make cups (MX-5, GR86, Carrera Cup).'
        },
        bop: {
            id: 'bop', label: 'Balance of Performance', icon: '⚖️', tag: 'Different cars, balanced', upgrades: false,
            desc: 'Several car models, balanced by the series with weight, power or restrictor settings per model. Performance parts are illegal, so the BoP and team efficiency decide it.',
            real: 'GT3 / GT4 championships, IMSA GTP, WEC Hypercar, TCR.'
        },
        open: {
            id: 'open', label: 'Open (build to the class)', icon: '🔧', tag: 'Equipment varies', upgrades: true,
            desc: 'Build your own car up to the class limit. Better-funded teams bring faster cars, so one team can dominate a season.',
            real: 'Street, pure, mini and pro stocks, late models, club racing, Wreckfest classes.'
        }
    };
    RR.FORMAT_KEYS = Object.keys(RR.FORMATS);
    RR.format = (id) => RR.FORMATS[id] || RR.FORMATS.open;

    // A sensible default for a library series. The GM can always change it.
    RR.defaultFormat = function (sd, lg = null) {
        if (!sd) return 'open';
        const gid = lg?.id || '';
        if (['wreckfest', 'wreckfest2', 'beamng'].includes(gid) || sd.format === 'derby' || sd.format === 'mixed') return 'open';
        const text = `${sd.car || ''} ${sd.name || ''}`;
        if (/\/|\bGT3\b|\bGT4\b|\bGTP\b|Hypercar|LMGT3|\bGTE\b|\bTCR\b|\bDTM\b|\bGr\.\s?[1-4]\b|GT500|Blancpain|GT Masters|GT World/i.test(text)) return 'bop';
        const spec = Number(sd.spec ?? 0.5);
        if (spec <= 0.15) return 'spec';
        // Modern top-tier stock cars run a common chassis (NASCAR Next Gen).
        if (sd.ladder === 'stock' && (Number(sd.tier) || 9) <= 3 && (Number(lg?.era) || 0) >= 2022) return 'spec';
        return 'open';
    };

    // Is this part legal under the format? Parts that add no performance
    // (a safety cage, a cooling package) are always legal.
    RR.partLegal = (partDef, format) => RR.format(format).upgrades || !partDef || (Number(partDef.perf) || 0) <= 0;

    /* ============================================================
       What each sim can enforce
       adjust: 'entry'  per-driver ballast / restrictor on the server
               'model'  per car model only (power %, weight)
               'tune'   players build their own car to a class limit
               'none'   the game's own BoP; AI level offline
       ============================================================ */
    const CTRL = {
        iracing: {
            adjust: 'model', power: [90, 110], weight: [-50, 250], codeIn: ['iracing-csv'],
            host: [
                'Hosted session → Session name: paste the session name below (it is printed in the results CSV).',
                'Car options, per car model: Engine power (90–110%), Weight penalty (kg), Max fuel %, Max tire sets, Fixed setup.',
                'iRacing applies power and weight per car model, never per driver.'
            ]
        },
        acc: {
            adjust: 'entry', ballast: [0, 100], restrictor: [0, 20], codeIn: ['acc-json'],
            host: [
                'settings.json → serverName: paste the session name below (ACC writes it into results/*.json).',
                'entrylist.json: per driver "ballastKg" (0–100) and "restrictor" (0–20%); set "forceEntryList": 1 to enforce it.',
                'event.json: track, sessions, weather. eventRules.json: mandatory pit stops, refuelling, tyre sets.'
            ]
        },
        ac: {
            adjust: 'entry', ballast: [0, 150], restrictor: [0, 100], codeIn: [],
            host: [
                'server_cfg.ini → NAME: paste the session name below. MAX_BALLAST_KG must cover the biggest ballast.',
                'entry_list.ini: per car BALLAST=kg and RESTRICTOR=0–100.',
                'Upload acServer results/*.json (it records each car\'s ballast and restrictor) or race_out.json offline.'
            ]
        },
        wreckfest: {
            adjust: 'tune', unit: 'PP', codeIn: [],
            classes: [{ id: 'D', min: 0, max: 119 }, { id: 'C', min: 120, max: 164 }, { id: 'B', min: 165, max: 219 }, { id: 'A', min: 220, max: 999 }],
            host: [
                'server_config.cfg: server_name (put the session name in it), car_class_restriction=d / c / b / a, car_restriction=<car> for one-make races, special_vehicles_disabled=1.',
                'Everyone builds their car in the garage up to the PP allowance shown for them below.',
                'Screenshot the lobby and the results screen; Wreckfest has no results file.'
            ]
        },
        wreckfest2: {
            adjust: 'tune', unit: 'class', codeIn: [],
            host: ['Lobby name: the session name below. Restrict the car class the series uses.', 'Screenshot the lobby and the results screen.']
        },
        gt7: {
            adjust: 'tune', unit: 'PP', codeIn: [],
            host: ['Lobby → Regulations: PP limit, Balance of Performance on/off, Tuning prohibited for spec races.', 'Room title / comment: the session name below. Screenshot the results.']
        },
        forza: {
            adjust: 'tune', unit: 'PI', codeIn: [],
            host: ['Private lobby: car class / PI limit, min/max power and weight, drivetrain and aspiration filters.', 'Lobby name: the session name below. Screenshot the results.']
        },
        rf2: { adjust: 'none', codeIn: ['isi-xml'], host: ['Dedicated server name: paste the session name below — the results XML carries it (ServerName), with race laps / time, damage, fuel and tyre multipliers.', 'Car balance comes from the mod / the game\'s BoP.'] },
        lmu: { adjust: 'none', codeIn: ['isi-xml'], host: ['Server name: the session name below (written into the results XML).', 'Le Mans Ultimate applies the official BoP itself.'] },
        ams1: { adjust: 'none', codeIn: ['isi-xml'], host: ['Server name: the session name below (written into the results XML).'] },
        rf1: { adjust: 'none', codeIn: ['isi-xml'], host: ['Server name: the session name below (written into the results XML).'] },
        gtr2: { adjust: 'none', codeIn: [], host: ['Server name: the session name below. Upload the race .txt log from UserData/Log/Results.'] },
        race07: { adjust: 'none', codeIn: [], host: ['Server name: the session name below. Upload the race .txt log from UserData/Log/Results.'] },
        nr2003: { adjust: 'none', codeIn: [], host: ['Server name: the session name below. Export the race results to HTML (exports_imports) and upload it.'] }
    };
    const GENERIC = { adjust: 'none', codeIn: [], host: ['Lobby / server name: the session name below. Screenshot the lobby and the results screen.'] };
    RR.GAME_CTRL = CTRL;
    RR.ctrl = (gameId) => CTRL[gameId] || GENERIC;
    RR.classesFor = (gameId) => RR.ctrl(gameId).classes || null;

    /* ============================================================
       Series rules (stored on the series doc as `rules`)
       ============================================================ */
    RR.RULE_DEFAULTS = {
        format: 'open',
        cap: null,              // { label, gameMin, gameMax, pi } — class limit
        bop: [],                // [{ car, weightKg, powerPct, restrictorPct }]
        ballast: { mode: 'off', steps: [], max: 100 },   // success ballast
        lever: 'ballast',       // open format on ACC / AC: 'ballast' | 'restrictor' | 'both'
        kgPerPI: 2.5,           // equipment ballast per PI point under the class limit
        gridDrop: false,        // per-driver kg the game can't set → grid places instead
        kgPerPlace: 10
    };
    RR.rules = function (stored, { sd = null, lg = null } = {}) {
        const s = stored || {};
        const r = { ...RR.RULE_DEFAULTS, ...s };
        r.format = RR.FORMATS[s.format] ? s.format : RR.defaultFormat(sd, lg);
        r.explicit = !!RR.FORMATS[s.format];
        r.bop = Array.isArray(s.bop) ? s.bop.filter(b => b && b.car) : [];
        r.ballast = { ...RR.RULE_DEFAULTS.ballast, ...(s.ballast || {}) };
        r.ballast.steps = (r.ballast.steps || []).map(Number).filter(n => Number.isFinite(n) && n >= 0);
        r.cap = s.cap && (num(s.cap.pi) || num(s.cap.gameMax) || s.cap.label) ? {
            label: String(s.cap.label || ''), gameMin: num(s.cap.gameMin), gameMax: num(s.cap.gameMax), pi: num(s.cap.pi)
        } : null;
        r.kgPerPI = num(s.kgPerPI) ?? RR.RULE_DEFAULTS.kgPerPI;
        r.kgPerPlace = Math.max(1, num(s.kgPerPlace) ?? RR.RULE_DEFAULTS.kgPerPlace);
        return r;
    };

    // "Car | weight kg | power % | restrictor %" lines ⇄ the BoP table.
    RR.parseBop = function (text) {
        return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
            const [car, w, p, rs] = l.split('|').map(x => x.trim());
            return { car, weightKg: num(w) || 0, powerPct: num(p) || null, restrictorPct: num(rs) || 0 };
        }).filter(b => b.car);
    };
    RR.bopText = (bop) => (bop || []).map(b => [b.car, b.weightKg || 0, b.powerPct || '', b.restrictorPct || ''].join(' | ').replace(/( \| )+$/, '')).join('\n');

    /* ============================================================
       Tech inspection
       ============================================================ */
    // car: a paddock garage entry. PARTS: PaddockCore.PARTS. pi: the car's PI.
    RR.inspect = function (car, rules, { PARTS = {}, pi = null } = {}) {
        const issues = [];
        const f = RR.format(rules?.format);
        if (car) {
            if (!f.upgrades) {
                for (const [pid, p] of Object.entries(car.parts || {})) {
                    const def = PARTS[pid];
                    if (!RR.partLegal(def, rules.format)) {
                        issues.push({ code: 'part', part: pid, text: `${def?.label || pid} is a performance part — illegal in a ${f.label.toLowerCase()} series`, fix: 'Remove it at a shop (🪛 Remove a part), or yourself in a Home Workshop or better.' });
                    }
                }
                if (Number(car.tune) > 0) issues.push({ code: 'tune', part: 'tune', text: `Dyno tune ${car.tune}/3 — engine maps are illegal in a ${f.label.toLowerCase()} series`, fix: 'Book "Remove a part → Dyno tune map" to go back to the stock map.' });
            }
            if (f.upgrades && rules?.cap?.pi && pi != null && pi > rules.cap.pi) {
                issues.push({ code: 'pi', text: `PI ${pi} is over the ${rules.cap.label ? rules.cap.label + ' ' : ''}class limit of ${rules.cap.pi}`, fix: 'Remove or downgrade parts until the PI is at or under the limit.' });
            }
        }
        return { legal: !issues.length, issues, pi };
    };

    /* ============================================================
       Team efficiency
       ============================================================ */
    RR.STAFF_ROLES = { 'crew-chief': 0.3, 'race-engineer': 0.3, mechanic: 0.25, spotter: 0.15 };
    RR.STAFF_LABEL = { 'crew-chief': 'Crew chief', 'race-engineer': 'Race engineer', mechanic: 'Mechanic', spotter: 'Spotter' };
    // staff: [{ role, rating 0–100 }]; workshop: garage level 1–5; prep: race-car
    // condition 0–100; crewStars: a registered player mechanic's stars;
    // briefed: a crew chief filed a pit-wall briefing; broke: in the red;
    // selfMech: a privateer's own mechanical skill standing in for a mechanic.
    RR.efficiency = function ({ staff = [], workshop = 1, prep = 100, crewStars = 0, briefed = false, broke = false, selfMech = null } = {}) {
        const best = {};
        for (const s of staff || []) {
            const r = num(s?.rating) || 0;
            if (RR.STAFF_ROLES[s?.role] && r > (best[s.role] || 0)) best[s.role] = r;
        }
        if (selfMech != null && !best.mechanic) best.mechanic = clamp(Math.round(selfMech), 30, 70);
        let staffScore = 0;
        for (const [role, w] of Object.entries(RR.STAFF_ROLES)) staffScore += w * (best[role] || 40);
        const ws = 35 + clamp(Math.round(Number(workshop) || 1), 1, 5) * 13;
        const pr = clamp(Number(prep) || 0, 0, 100);
        let score = 0.5 * staffScore + 0.2 * ws + 0.3 * pr;
        const extras = [];
        if (crewStars) { score += crewStars * 1.5; extras.push(`race-day mechanic +${(crewStars * 1.5).toFixed(1).replace(/\.0$/, '')}`); }
        if (briefed) { score += 4; extras.push('pit-wall briefing +4'); }
        if (broke) { score -= 8; extras.push('cash-strapped −8'); }
        score = clamp(Math.round(score), 10, 100);
        return {
            score, grade: RR.effGrade(score), staff: Math.round(staffScore), workshop: ws, prep: Math.round(pr), extras,
            roles: Object.keys(RR.STAFF_ROLES).map(role => ({ role, label: RR.STAFF_LABEL[role], rating: best[role] || null }))
        };
    };
    RR.effGrade = (s) => s >= 85 ? 'A' : s >= 75 ? 'B' : s >= 62 ? 'C' : s >= 50 ? 'D' : 'E';
    // An AI team's numbers from its prestige stars (1–5).
    RR.aiWorkshop = (stars) => clamp(Math.round(1 + (Number(stars) || 1) * 0.8), 1, 5);
    RR.aiPrep = (stars) => clamp(78 + (Number(stars) || 1) * 4, 0, 100);
    // An AI team's equipment in an open series: richer teams build faster cars.
    RR.aiTeamPI = (stars, rules) => {
        const pi = 46 + (Number(stars) || 1) * 4 + ((Number(stars) || 1) >= 4 ? 2 : 0);
        return rules?.cap?.pi ? Math.min(pi, rules.cap.pi) : pi;
    };
    // The "average car" an open field brings: near the class limit if there is one.
    RR.openRef = (rules) => rules?.cap?.pi ? Math.max(40, rules.cap.pi - 6) : 55;
    // An imperfect BoP: each model ends up a touch fast or slow (±0.6), fixed per season.
    RR.bopBias = (model, seed = '') => ((hash(`${model}|${seed}`) % 1000) / 1000 - 0.5) * 1.2;

    // Pace bonus in a simulated race (added to a 0–100 driver rating).
    RR.paceBonus = function (format, { pi = 55, eff = 70, cond = 100, ref = 55, bias = 0 } = {}) {
        if (format === 'open') return (pi - ref) * 0.15 + (eff - 70) * 0.06;
        const b = (eff - 70) * 0.12 + (cond - 90) * 0.04;
        return format === 'bop' ? b + bias : b;
    };
    // Offline races vs AI: how many AI-strength steps your equipment is worth.
    // Positive = you have the edge → LOWER the AI (your car is quicker than
    // the field's); negative = raise it. Spec / BoP cars are equal, so only
    // preparation and team efficiency count, and by less.
    RR.aiTip = function (format, { pi = 55, eff = 70, cond = 100, ref = 55 } = {}) {
        if (format === 'open') return clamp(Math.round((pi - ref) / 6 + (eff - 70) / 15), -6, 6);
        return clamp(Math.round((eff - 70) / 8 + (cond - 90) / 15), -3, 3);
    };
    RR.aiTipText = function (steps, aiLabel = 'AI strength') {
        if (!steps) return `leave ${aiLabel} at your usual level`;
        const n = Math.abs(steps);
        return `${steps > 0 ? 'lower' : 'raise'} ${aiLabel} about ${n} step${n === 1 ? '' : 's'} from your usual level`;
    };
    // A well-run team breaks less and wears its cars less.
    RR.riskMult = (eff) => clamp(1.35 - (Number(eff) || 50) * 0.007, 0.6, 1.3);
    RR.wearMult = (eff) => clamp(1.2 - (Number(eff) || 50) * 0.004, 0.8, 1.15);

    /* ============================================================
       Ballast, restrictors and class allowances
       ============================================================ */
    RR.successBallast = function (ballast, { standing = null, last = null } = {}) {
        if (!ballast || !ballast.mode || ballast.mode === 'off') return 0;
        const pos = ballast.mode === 'standings' ? standing : last;
        if (!pos) return 0;
        return clamp(Number((ballast.steps || [])[pos - 1]) || 0, 0, Number(ballast.max) || 200);
    };
    RR.bopRow = function (bop, model) {
        if (!model || !bop?.length) return null;
        const m = RR.carTokens(model);
        return bop.find(b => RR.carMatch(b.car, model)) || bop.find(b => RR.carTokens(b.car).some(t => m.includes(t) && t.length >= 4)) || null;
    };
    // Your in-game build allowance in a "tune" game (Wreckfest PP, GT7 PP,
    // Forza PI): the class minimum for a bare car up to the class maximum
    // for a car at the paddock class limit.
    RR.ppAllowance = function (cap, pi) {
        const max = num(cap?.gameMax);
        if (!max || max >= 999) return null;
        const min = num(cap.gameMin) ?? Math.round(max * 0.85);
        const top = num(cap.pi) || 75;
        const f = clamp(((Number(pi) || 0) - 35) / Math.max(5, top - 35), 0, 1);
        return Math.round(min + (max - min) * f);
    };

    // Everything one entry runs with, already translated for the game.
    // model: the in-game car; pi: the paddock car's PI (open format);
    // standing / last: championship position / last finish (success ballast).
    RR.entryAdjust = function (rules, gameId, { model = '', pi = null, standing = null, last = null, mode = 'either' } = {}) {
        const ctrl = RR.ctrl(gameId);
        const out = { modelWeightKg: 0, powerPct: null, modelRestrictorPct: 0, driverKg: 0, driverRestrictorPct: 0, ballastKg: 0, restrictorPct: 0, pp: null, gridDrop: 0, lines: [], notes: [], adjust: ctrl.adjust };
        if (!rules) return out;
        if (rules.format === 'bop') {
            const row = RR.bopRow(rules.bop, model);
            if (row) {
                out.modelWeightKg = Number(row.weightKg) || 0;
                out.powerPct = num(row.powerPct);
                out.modelRestrictorPct = Number(row.restrictorPct) || 0;
                out.lines.push(`BoP for the ${row.car}: ${[out.modelWeightKg ? `${out.modelWeightKg > 0 ? '+' : ''}${out.modelWeightKg} kg` : '', out.powerPct ? `${out.powerPct}% power` : '', out.modelRestrictorPct ? `${out.modelRestrictorPct}% restrictor` : ''].filter(Boolean).join(', ') || 'no change'}`);
            } else if (rules.bop.length && model) out.notes.push(`${model} isn't in the BoP table — it runs as is.`);
        }
        if (rules.format === 'open' && pi != null) {
            if (ctrl.adjust === 'entry') {
                const gap = Math.max(0, (rules.cap?.pi || 75) - pi);
                const kg = Math.round(gap * (rules.kgPerPI || 2.5));
                if (rules.lever === 'restrictor' || rules.lever === 'both') out.driverRestrictorPct += Math.round(gap * 0.5);
                if (rules.lever !== 'restrictor') out.driverKg += kg;
                if (gap) out.lines.push(`Equipment: your car is ${gap} PI under the ${rules.cap?.pi ? 'class limit' : 'top of the field'} — ${[rules.lever !== 'restrictor' ? `${kg} kg` : '', rules.lever !== 'ballast' ? `${Math.round(gap * 0.5)}% restrictor` : ''].filter(Boolean).join(' + ')}`);
                else out.lines.push('Equipment: your car is at the class limit — no equipment ballast.');
            } else if (ctrl.adjust === 'tune' && rules.cap?.gameMax) {
                out.pp = RR.ppAllowance(rules.cap, pi);
                if (out.pp != null) out.lines.push(`Build allowance: up to ${out.pp} ${ctrl.unit || 'PP'} (class max ${rules.cap.gameMax}) — your paddock car is PI ${pi}.`);
            }
        }
        const sb = RR.successBallast(rules.ballast, { standing, last });
        if (sb) {
            out.driverKg += sb;
            out.lines.push(`Success ballast: +${sb} kg (${rules.ballast.mode === 'standings' ? `P${standing} in the championship` : `P${last} last time out`})`);
        }
        // Translate into what the game can set.
        if (ctrl.adjust === 'entry') {
            const powerAsRestrictor = out.powerPct && out.powerPct < 100 ? 100 - out.powerPct : 0;
            const wantKg = out.modelWeightKg + out.driverKg;
            const wantRs = out.modelRestrictorPct + out.driverRestrictorPct + powerAsRestrictor;
            out.ballastKg = clamp(Math.round(wantKg), ctrl.ballast[0], ctrl.ballast[1]);
            out.restrictorPct = clamp(Math.round(wantRs), ctrl.restrictor[0], ctrl.restrictor[1]);
            if (wantKg > ctrl.ballast[1]) out.notes.push(`Ballast capped at the game's ${ctrl.ballast[1]} kg.`);
            if (wantRs > ctrl.restrictor[1]) out.notes.push(`Restrictor capped at the game's ${ctrl.restrictor[1]}%.`);
            if (wantKg < 0) out.notes.push('Negative weight can\'t be set per entry; the car runs at 0 kg.');
        } else {
            if (ctrl.adjust === 'model' && out.powerPct != null) out.powerPct = clamp(out.powerPct, ctrl.power[0], ctrl.power[1]);
            if (ctrl.adjust === 'model' && out.modelWeightKg) out.modelWeightKg = clamp(out.modelWeightKg, ctrl.weight[0], ctrl.weight[1]);
            if (out.driverKg) {
                if (rules.gridDrop) {
                    out.gridDrop = Math.max(1, Math.round(out.driverKg / rules.kgPerPlace));
                    out.notes.push(`This game can't add weight to one driver, so ${out.driverKg} kg becomes a ${out.gridDrop}-place grid drop.`);
                } else if (mode !== 'offline') {
                    out.notes.push(`This game can't add weight to one driver — the ${out.driverKg} kg counts in simulated races only.`);
                }
            }
        }
        return out;
    };

    /* ============================================================
       Race sheets (stored on the race doc as `details`)
       ============================================================ */
    RR.DETAIL_DEFAULTS = {
        mode: 'either', layout: '', practiceMin: 10, qualiMin: 10, qualiType: 'timed', minutes: null,
        start: 'standing', weather: 'forecast', timeOfDay: '', damage: 'full', setup: 'open', fuel: 'real',
        tyreWear: 'real', pitRule: '', assists: 'any', flags: 'full', field: null, aiLevel: '', gameCars: '',
        proof: 'none', windowDays: 3, codeRequired: true, notes: ''
    };
    RR.OPTIONS = {
        mode: { either: 'Online lobby or offline vs AI', online: 'Online lobby (one server)', offline: 'Offline vs AI (everyone races their own)' },
        qualiType: { timed: 'Timed qualifying', onelap: 'One-lap qualifying', none: 'No qualifying (grid by standings)', reverse: 'Reverse grid' },
        start: { standing: 'Standing start', rolling: 'Rolling start', formation: 'Formation lap, then rolling', game: 'Game default' },
        weather: { forecast: 'Use the forecast', clear: 'Clear', overcast: 'Overcast', wet: 'Wet', dynamic: 'Dynamic (changes in session)', real: 'Real weather' },
        damage: { full: 'Full damage', reduced: 'Reduced damage', visual: 'Visual only', off: 'Off' },
        setup: { open: 'Open setups', fixed: 'Fixed setups' },
        fuel: { real: 'Real fuel use', x2: 'Double fuel use', off: 'Fuel use off' },
        tyreWear: { real: 'Real tyre wear', x2: 'Double tyre wear', off: 'Tyre wear off' },
        assists: { any: 'Any assists', real: 'Only what the real car has', none: 'No assists' },
        flags: { full: 'Full rules & flags', black: 'Black flags only (no cautions)', off: 'Flags off' },
        proof: { none: 'No proof needed', 'file-or-shot': 'Results file or a screenshot', file: 'Results file only', shot: 'Screenshot only' }
    };
    const ALPH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    RR.raceCode = function (race, prefix = 'PX') {
        let h = hash(`code|${race?.id || ''}|${race?.track || ''}|${race?.date || ''}`);
        let s = '';
        for (let i = 0; i < 4; i++) { s += ALPH[h % ALPH.length]; h = (Math.floor(h / ALPH.length) ^ hash(s + i)) >>> 0; }
        return `${prefix}${Number(race?.round) || ''}-${s}`;
    };
    // Results formats that carry the server / session name.
    RR.SERVER_FORMATS = ['acc-json', 'isi-xml', 'iracing-csv'];
    RR.codeKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    RR.hasCode = (text, code) => !!code && RR.codeKey(text).includes(RR.codeKey(code));
    RR.sessionName = (race, sheet, { league = 'Phoenix SRMPC', series = '' } = {}) =>
        `${league}${series ? ' ' + series : ''} ${sheet.code}`.replace(/\s+/g, ' ').trim().slice(0, 60);

    // The full sheet for a race: defaults < series defaults < race details.
    RR.sheet = function (race, { seriesDefaults = null, sd = null, lg = null } = {}) {
        const d = { ...RR.DETAIL_DEFAULTS, ...(seriesDefaults || {}), ...(race?.details || {}) };
        d.code = race?.details?.code || RR.raceCode(race);
        d.laps = num(race?.laps);
        d.minutes = num(d.minutes) || (!d.laps && sd?.len?.mins ? sd.len.mins : null);
        d.field = num(d.field) || null;
        d.windowDays = Math.max(0, num(d.windowDays) ?? 3);
        d.custom = !!race?.details;
        if (!d.gameCars && sd?.car) d.carHint = sd.car;
        const ctrl = RR.ctrl(lg?.id);
        // Can this game's results file prove the race code?
        d.codeInFile = (lg?.formats || []).some(f => (ctrl.codeIn || []).includes(f));
        return d;
    };

    // Plain-text race sheet — the "📋 Copy race sheet" button and the GM's notes.
    RR.sheetRows = function (race, sheet, { game = '', car = '', weather = null, rules = null, sessionName = '' } = {}) {
        const L = RR.OPTIONS;
        const rows = [];
        rows.push(['Race code', sheet.code]);
        if (sessionName) rows.push(['Session / server name', sessionName]);
        rows.push(['How it runs', L.mode[sheet.mode] || sheet.mode]);
        if (game) rows.push(['Game', game]);
        rows.push(['Track', `${race.track || '—'}${sheet.layout ? ` (${sheet.layout})` : ''}`]);
        if (sheet.gameCars || car) rows.push(['Car', sheet.gameCars || car]);
        if (rules) rows.push(['Rules', `${RR.format(rules.format).label}${rules.cap ? ` · class limit ${[rules.cap.label, rules.cap.gameMax ? `${rules.cap.gameMax}` : '', rules.cap.pi ? `paddock PI ${rules.cap.pi}` : ''].filter(Boolean).join(' / ')}` : ''}`]);
        const sessions = [sheet.practiceMin ? `Practice ${sheet.practiceMin} min` : '', sheet.qualiType === 'none' ? 'No qualifying' : sheet.qualiType === 'reverse' ? 'Reverse grid' : sheet.qualiMin ? `${L.qualiType[sheet.qualiType] || 'Qualifying'} ${sheet.qualiMin} min` : ''].filter(Boolean).join(' · ');
        if (sessions) rows.push(['Sessions', sessions]);
        rows.push(['Race', sheet.laps ? `${sheet.laps} laps` : sheet.minutes ? `${sheet.minutes} minutes` : 'Set by the host']);
        rows.push(['Start', L.start[sheet.start] || sheet.start]);
        const wx = sheet.weather === 'forecast' && weather ? `${weather.cond}, ${weather.temp}°C` : (L.weather[sheet.weather] || sheet.weather);
        rows.push(['Weather', `${wx}${sheet.timeOfDay ? ` · ${sheet.timeOfDay}` : weather?.time && sheet.weather === 'forecast' ? ` · ${weather.time}` : ''}`]);
        rows.push(['Damage', L.damage[sheet.damage] || sheet.damage]);
        rows.push(['Setups', L.setup[sheet.setup] || sheet.setup]);
        rows.push(['Fuel / tyres', `${L.fuel[sheet.fuel] || sheet.fuel} · ${L.tyreWear[sheet.tyreWear] || sheet.tyreWear}`]);
        if (sheet.pitRule) rows.push(['Pit rule', sheet.pitRule]);
        rows.push(['Assists', L.assists[sheet.assists] || sheet.assists]);
        rows.push(['Flags', L.flags[sheet.flags] || sheet.flags]);
        if (sheet.mode !== 'online' && sheet.field) rows.push(['Offline field', `${sheet.field} cars (you + ${sheet.field - 1} AI)${sheet.aiLevel ? ` · AI ${sheet.aiLevel} before your adjustment` : ''}`]);
        rows.push(['Proof', `${L.proof[sheet.proof] || sheet.proof}${sheet.proof !== 'none' && sheet.windowDays ? ` · dated within ${sheet.windowDays} day${sheet.windowDays === 1 ? '' : 's'} of the race` : ''}`]);
        if (sheet.notes) rows.push(['Notes', sheet.notes]);
        return rows;
    };
    RR.sheetText = (title, rows) => [title, ...rows.map(([k, v]) => `${k}: ${v}`)].join('\n');

    // ACC entrylist.json / AC entry_list.ini from per-entry adjustments.
    // entries: [{ name, number, ballastKg, restrictorPct, steamId?, model? }]
    RR.accEntryList = function (entries) {
        const out = {
            entries: entries.map(e => {
                const parts = String(e.name || 'Driver').trim().split(/\s+/);
                return {
                    drivers: [{ firstName: parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0], lastName: parts.length > 1 ? parts[parts.length - 1] : '', playerID: e.steamId ? `S${String(e.steamId).replace(/^S/i, '')}` : 'S<steam id>' }],
                    raceNumber: Number(e.number) || -1, forcedCarModel: -1, overrideDriverInfo: 1, isServerAdmin: 0,
                    ballastKg: clamp(Math.round(Number(e.ballastKg) || 0), 0, 100), restrictor: clamp(Math.round(Number(e.restrictorPct) || 0), 0, 20)
                };
            }),
            forceEntryList: 1
        };
        return JSON.stringify(out, null, 2);
    };
    RR.acEntryList = function (entries, { model = '' } = {}) {
        return entries.map((e, i) => [
            `[CAR_${i}]`, `MODEL=${e.model || model || '<car folder>'}`, 'SKIN=', 'SPECTATOR_MODE=0',
            `DRIVERNAME=${e.name || ''}`, 'TEAM=', `GUID=${e.steamId || ''}`,
            `BALLAST=${clamp(Math.round(Number(e.ballastKg) || 0), 0, 150)}`, `RESTRICTOR=${clamp(Math.round(Number(e.restrictorPct) || 0), 0, 100)}`, ''
        ].join('\n')).join('\n');
    };

    /* ============================================================
       Matching helpers
       ============================================================ */
    const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const TRACK_STOP = new Set(['the', 'of', 'de', 'del', 'della', 'la', 'le', 'di', 'and', 'circuit', 'circuito', 'circuitto', 'autodromo', 'raceway', 'speedway',
        'motor', 'motorsport', 'motorsports', 'international', 'intl', 'park', 'race', 'racing', 'track', 'course', 'full', 'layout', 'gp', 'grand', 'prix',
        'ks', 'rt', 'acu', 'rss', 'vrc', 'gamedata', 'locations', 'trk', 'gdb', 'config', 'combined', 'version', 'mod', 'tracks', 'superspeedway',
        'road', 'city', 'county', 'new', 'north', 'south', 'east', 'west', 'san', 'saint', 'valley', 'lake', 'national', 'world', 'street', 'oval', 'short', 'long']);
    const TRACK_ALIAS = { cota: 'americas', bathurst: 'panorama', ctmp: 'mosport', vir: 'virginia' };
    RR.trackTokens = function (name) {
        const t = fold(name).replace(/\.(trk|gdb|xml)$/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
        return [...new Set(t.map(x => TRACK_ALIAS[x] || x).filter(x => !TRACK_STOP.has(x) && (x.length >= 3 || /\d/.test(x))))];
    };
    // true / false / null (nothing to compare). resolve(name) → a canonical
    // track key (the league passes its library lookup) for known tracks.
    RR.trackMatch = function (raceTrack, fileTrack, resolve = null) {
        if (!raceTrack || !fileTrack) return null;
        if (resolve) {
            const a = resolve(raceTrack), b = resolve(fileTrack);
            if (a && b) return a === b;
        }
        const a = RR.trackTokens(raceTrack), b = RR.trackTokens(fileTrack);
        if (!a.length || !b.length) return null;
        if (a.some(x => b.includes(x))) return true;
        return a.join('') === b.join('');
    };
    const CAR_STOP = new Set(['ks', 'rss', 'acc', 'car', 'the', 'model', 'vrc', 'urd', 'ags', 'tatuus']);
    RR.carTokens = (name) => [...new Set(fold(name).replace(/['’.-]+/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(x => x && !CAR_STOP.has(x)))];
    // Every word of the allowed name appears in the file's car name.
    RR.carMatch = function (allowed, carName) {
        const a = RR.carTokens(allowed), c = RR.carTokens(carName);
        if (!a.length || !c.length) return false;
        return a.every(x => c.includes(x)) || c.every(x => a.includes(x));
    };
    RR.allowedCars = (text) => String(text || '').split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);

    const isoDays = (iso) => { const t = Date.parse(String(iso || '').slice(0, 10) + 'T12:00:00Z'); return Number.isFinite(t) ? Math.round(t / 86400000) : null; };
    const addDays = (iso, n) => { const d = isoDays(iso); return d == null ? null : new Date((d + n) * 86400000).toISOString().slice(0, 10); };
    RR.window = (race, sheet) => race?.date && sheet?.windowDays ? { from: addDays(race.date, -sheet.windowDays), to: addDays(race.date, sheet.windowDays) } : null;

    /* ============================================================
       Result checks
       status: 'invalid' (anything contradicts the sheet), 'valid'
       (track + distance confirmed, nothing wrong) or 'unverified'
       (nothing wrong, not enough to confirm — the GM decides).
       ============================================================ */
    function verdict(checks) {
        if (checks.some(c => c.ok === false)) return 'invalid';
        const ok = (k) => checks.find(c => c.key === k)?.ok === true;
        const has = (k) => checks.some(c => c.key === k);
        if (ok('code')) return 'valid';
        if (ok('track') && (!has('distance') || ok('distance')) && checks.find(c => c.key === 'session')?.ok !== false) return 'valid';
        return 'unverified';
    }
    RR.STATUS = {
        valid: { icon: '✅', label: 'Verified', tone: 'good' },
        unverified: { icon: '🟡', label: 'Unverified — GM review', tone: 'amber' },
        invalid: { icon: '⛔', label: 'Invalid', tone: 'bad' }
    };

    // A results file. meta: SC.Import.meta(); rows: parsed rows; me: the
    // driver's own row (driver reports); claimed: their typed report;
    // expect: { ballastKg, restrictorPct } the sheet requires of them.
    RR.checkFile = function ({ race, sheet, meta = {}, rows = [], me = null, claimed = null, expect = null, resolveTrack = null, needMe = false } = {}) {
        const checks = [];
        const add = (key, label, ok, detail) => checks.push({ key, label, ok, detail });
        // Session
        if (meta.session) add('session', 'Session', meta.session === 'race', meta.session === 'race' ? 'Race session' : `This is ${meta.session === 'qualify' ? 'qualifying' : meta.session === 'warmup' ? 'warm-up' : 'practice'}, not the race`);
        // Track
        const tm = RR.trackMatch(race?.track, meta.track, resolveTrack);
        if (tm === null) add('track', 'Track', null, meta.track ? `Couldn't compare "${meta.track}"` : 'The file doesn\'t name the track');
        else add('track', 'Track', tm, tm ? `${meta.track}` : `The file is from ${meta.track} — this race is at ${race.track}`);
        // Layout (only when the sheet names one and the file has one)
        if (sheet?.layout && meta.layout) {
            const lm = RR.trackTokens(sheet.layout).some(x => RR.trackTokens(`${meta.layout} ${meta.track}`).includes(x));
            add('layout', 'Layout', lm, lm ? meta.layout : `Layout "${meta.layout}" — the sheet says ${sheet.layout}`);
        }
        // Distance
        if (sheet?.laps) {
            const got = meta.raceLaps || meta.leaderLaps;
            if (got) add('distance', 'Distance', got === sheet.laps, got === sheet.laps ? `${got} laps` : `${got} laps — the sheet says ${sheet.laps}`);
            else add('distance', 'Distance', null, 'No lap count in the file');
        } else if (sheet?.minutes && meta.minutes) {
            const okm = Math.abs(meta.minutes - sheet.minutes) <= Math.max(2, sheet.minutes * 0.1);
            add('distance', 'Distance', okm, okm ? `${meta.minutes} minutes` : `${meta.minutes} minutes — the sheet says ${sheet.minutes}`);
        }
        // Race code (online sessions whose results carry the server name)
        if (sheet?.codeRequired && sheet.mode !== 'offline') {
            const has = !!meta.server && RR.hasCode(meta.server, sheet.code);
            if (has) add('code', 'Race code', true, `Server "${meta.server}"`);
            else if (sheet.mode === 'online') {
                // An online race's file must carry the code; 'either' only rewards it.
                if (meta.server) add('code', 'Race code', false, `Server "${meta.server}" has no race code ${sheet.code}`);
                else if (RR.SERVER_FORMATS.includes(meta.format)) add('code', 'Race code', false, `No server name in the file — this online race's results carry the code ${sheet.code}`);
            }
        }
        // Date window
        const win = RR.window(race, sheet);
        if (win && meta.date) {
            const inside = meta.date >= win.from && meta.date <= win.to;
            add('date', 'Date', inside, inside ? meta.date : `Dated ${meta.date} — results must be from ${win.from} to ${win.to}`);
        }
        // Offline field size
        if (sheet?.field && sheet.mode === 'offline' && rows.length) {
            add('field', 'Field', rows.length >= sheet.field, rows.length >= sheet.field ? `${rows.length} cars` : `Only ${rows.length} cars — the sheet says ${sheet.field}`);
        }
        // The driver's own row
        if (needMe && !me) add('me', 'Your result', false, 'Your name isn\'t in this file');
        if (me) {
            const allowed = RR.allowedCars(sheet?.gameCars);
            if (allowed.length && me.car && !/^ACC model/.test(me.car)) {
                const okc = allowed.some(a => RR.carMatch(a, me.car));
                add('car', 'Car', okc, okc ? me.car : `${me.car} isn't an allowed car (${allowed.join(', ')})`);
            }
            if (expect && me.ballast != null && (Number(expect.ballastKg) || 0) > 0) {
                const okb = Number(me.ballast) >= Number(expect.ballastKg);
                add('ballast', 'Ballast', okb, okb ? `${me.ballast} kg` : `Ran ${me.ballast} kg — the sheet requires ${expect.ballastKg} kg`);
            }
            if (expect && me.restrictor != null && (Number(expect.restrictorPct) || 0) > 0) {
                const okr = Number(me.restrictor) >= Number(expect.restrictorPct);
                add('restrictor', 'Restrictor', okr, okr ? `${me.restrictor}%` : `Ran ${me.restrictor}% restrictor — the sheet requires ${expect.restrictorPct}%`);
            }
            if (claimed) {
                if (!!claimed.dnf !== !!me.dnf) add('claim', 'Your report', false, me.dnf ? 'The file says DNF' : `The file says you finished P${me.pos}`);
                else if (!claimed.dnf && claimed.position && me.pos && Number(claimed.position) !== Number(me.pos)) add('claim', 'Your report', false, `You reported P${claimed.position}; the file says P${me.pos}`);
                else add('claim', 'Your report', true, me.dnf ? 'DNF' : `P${me.pos}`);
            }
        }
        return { status: verdict(checks), checks, kind: 'file', format: meta.format || null };
    };

    // A screenshot, read by OCR (text may be empty when OCR isn't available).
    // knownTracks: other track names in the game, to catch the wrong venue.
    RR.checkText = function ({ race, sheet, text = '', fileDate = null, driverName = '', knownTracks = [] } = {}) {
        const checks = [];
        const add = (key, label, ok, detail) => checks.push({ key, label, ok, detail });
        const t = fold(text).replace(/[^a-z0-9/:.+# -]+/g, ' ');
        const words = new Set(t.replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean));
        const readable = t.replace(/[^a-z]/g, '').length >= 12;
        if (sheet?.code && readable) {
            if (RR.hasCode(text, sheet.code)) add('code', 'Race code', true, `Found ${sheet.code}`);
            else if (sheet.mode === 'online' && sheet.codeRequired) add('code', 'Race code', null, `Couldn't see ${sheet.code} (show the lobby / server name if you can)`);
        }
        if (readable && race?.track) {
            const mine = RR.trackTokens(race.track);
            const found = mine.filter(x => x.length >= 4 && words.has(x));
            if (found.length) add('track', 'Track', true, `Found "${found.join(' ')}"`);
            else {
                const other = knownTracks.filter(n => !RR.trackMatch(race.track, n))
                    .find(n => { const tok = RR.trackTokens(n).filter(x => x.length >= 6 && !mine.includes(x)); return tok.length && tok.every(x => words.has(x)); });
                add('track', 'Track', other ? false : null, other ? `The screenshot shows ${other} — this race is at ${race.track}` : `Couldn't read the track name`);
            }
        }
        if (readable && sheet?.laps) {
            // "LAP 20/20" or "20/20 laps" — never a bare "3/24" (that's often a position).
            const totals = [...t.matchAll(/laps?\s*:?\s*(\d{1,3})\s*\/\s*(\d{1,3})\b|\b(\d{1,3})\s*\/\s*(\d{1,3})\s*laps?\b/g)]
                .map(m => Number(m[2] || m[4])).filter(n => n >= 3);
            if (totals.length) {
                const okl = totals.includes(sheet.laps);
                if (okl) add('distance', 'Distance', true, `${sheet.laps} laps`);
                else if (!words.has(String(sheet.laps))) add('distance', 'Distance', false, `Shows a ${totals[0]}-lap race — the sheet says ${sheet.laps}`);
            }
        }
        if (readable && driverName) {
            const nameTok = RR.carTokens(driverName).filter(x => x.length >= 3);
            const seen = nameTok.filter(x => words.has(x));
            add('name', 'Your name', seen.length ? true : null, seen.length ? 'Found your name' : 'Couldn\'t read your name');
        }
        const win = RR.window(race, sheet);
        if (win && fileDate) {
            // A screenshot can't be older than the race window (copies may be newer).
            const ok = fileDate >= addDays(win.from, -1);
            add('date', 'Date', ok ? null : false, ok ? `File date ${fileDate}` : `The screenshot is from ${fileDate}, before this race's window (${win.from})`);
        }
        if (!readable) add('ocr', 'Screenshot text', null, text ? 'The text was unreadable' : 'Text reading wasn\'t available');
        let status = verdict(checks.filter(c => c.key !== 'name'));
        // A screenshot is only "verified" when it shows the code, or the track plus your name.
        if (status === 'valid' && !checks.some(c => c.key === 'code' && c.ok) && !checks.some(c => c.key === 'name' && c.ok)) status = 'unverified';
        return { status, checks, kind: 'shot' };
    };

    RR.summary = (res) => res ? `${RR.STATUS[res.status].icon} ${RR.STATUS[res.status].label}${res.checks?.length ? ': ' + res.checks.filter(c => c.ok === false).map(c => c.detail).join('; ') : ''}`.replace(/: $/, '') : '';

    if (typeof module !== 'undefined' && module.exports) module.exports = RR;
    root.RaceRules = RR;
})(typeof window !== 'undefined' ? window : globalThis);
