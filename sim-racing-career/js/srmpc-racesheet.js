/* ============================================================
   Phoenix SRMPC — Race sheets, series rules & result proof
   The league side of js/race-rules.js (RaceRules):

   - Series rules (series.rules): spec / BoP / open, class limit,
     BoP table, success ballast, how ballast reaches each sim.
   - Race sheets (race.details): race code + session name and
     every setting needed to build the race exactly — online or
     offline vs AI. Everyone sees it in the race window.
   - Your entry: tech inspection, team efficiency, the ballast /
     power / PP allowance / AI tip that applies to YOU.
   - GM tools: edit sheets and rules, entry adjustments table,
     ACC entrylist.json / AC entry_list.ini downloads.
   - Result proof: results files and screenshots are checked
     against the sheet (wrong track, distance, code, date, car
     or a claim the file contradicts → invalid).
   No new collections: series.rules, series.sheet, race.details,
   race.resultsCheck and the proof inside raceSignups.report.
   ============================================================ */
'use strict';

const RaceSheet = {
    get RR() { return window.RaceRules; },
    ok() { return !!window.RaceRules; },

    /* ---------------- context ---------------- */
    _ctx(race, world) {
        const series = world.seriesById?.[race.seriesId] || null;
        const game = world.gamesById?.[race.gameId] || (series ? world.gamesById?.[series.gameId] : null) || null;
        const lg = window.Library?.libGameFor ? Library.libGameFor(game) : null;
        const sd = window.Library?.libSeriesFor ? Library.libSeriesFor(series, game) : null;
        return { series, game, lg, sd, gameId: lg?.id || null };
    },
    rulesFor(race, world) {
        const { series, lg, sd } = this._ctx(race, world);
        return this.RR.rules(series?.rules, { sd, lg });
    },
    sheetFor(race, world) {
        const { series, lg, sd } = this._ctx(race, world);
        return this.RR.sheet(race, { seriesDefaults: series?.sheet || null, sd, lg });
    },
    sessionName(race, world, sheet) {
        const { series } = this._ctx(race, world);
        const short = series?.short || (series?.name || '').split(/\s+/).filter(w => /^[A-Z0-9]/.test(w)).map(w => w[0]).join('').slice(0, 5);
        return this.RR.sessionName(race, sheet, { league: 'Phoenix', series: short });
    },
    // The weather the sheet asks for (forecast unless the GM fixed it).
    weatherFor(race, sheet) {
        const fc = window.Library?.conditions ? Library.conditions(race) : { cond: 'Clear', temp: 20, time: 'Afternoon' };
        return { ...fc, time: sheet?.timeOfDay || fc.time };
    },
    resolveTrack(name) {
        const t = window.Library?.track ? Library.track(name) : null;
        return t ? (t.name || t.id || JSON.stringify([t.km, t.country, t.type])) : null;
    },

    /* ---------------- standings → success ballast ---------------- */
    standingsMap(race, world) {
        const out = {};
        if (!race.seriesId) return out;
        const before = (r) => (Number(r.round) && Number(race.round)) ? Number(r.round) < Number(race.round) : (r.date || '') < (race.date || '');
        const prior = world.races.filter(r => r.seriesId === race.seriesId && r.status === 'completed' && r.id !== race.id
            && (!race.seasonId || r.seasonId === race.seasonId) && before(r));
        if (!prior.length) return out;
        let table = [];
        try { table = Stats.driverTable(prior, world, { seriesId: race.seriesId }); } catch (e) { table = []; }
        table.forEach((row, i) => { out[row.driverId] = { standing: row.rank || i + 1, last: null }; });
        const lastRace = prior.slice().sort((a, b) => (Number(b.round) || 0) - (Number(a.round) || 0) || (b.date || '').localeCompare(a.date || ''))[0];
        (lastRace?.results || []).forEach(r => {
            if (!out[r.driverId]) out[r.driverId] = { standing: null, last: null };
            out[r.driverId].last = r.dnf ? null : Number(r.position) || null;
        });
        return out;
    },

    /* ---------------- team efficiency ---------------- */
    async effData(race) {
        const [staff, profiles, crew] = await Promise.all([
            DB.staff().catch(() => []), DB.roleProfiles().catch(() => []),
            window.Crew ? Crew.signups(race.id).catch(() => []) : Promise.resolve([])
        ]);
        return { staff, profiles, crew, teamRows: null };
    },
    _teamStars(teamId, world, data) {
        try {
            if (!data.teamRows) data.teamRows = Stats.teamTable(world.races, world);
            return Prestige.teamStars(teamId, world, data.teamRows);
        } catch (e) { return 1; }
    },
    // driver: league driver; teamId: the team that runs the car (null =
    // privateer); entry: the paddock car (or null); userPaddock: the owner's
    // paddock state (privateers' garage level + mechanical skill).
    efficiencyFor(driver, race, world, data, { teamId = null, entry = null, userPaddock = null } = {}) {
        const RR = this.RR, PC = window.PaddockCore;
        const team = teamId ? world.teamsById[teamId] : null;
        const staff = [];
        let workshop = 1, prep = entry && PC ? PC.overall(entry) : null, selfMech = null, crewStars = 0;
        if (team) {
            data.staff.filter(s => s.teamId === team.id).forEach(s => staff.push({ role: s.role, rating: Number(s.rating) || 60 }));
            data.profiles.filter(p => p.teamId === team.id && (p.role === 'mechanic' || p.role === 'crew-chief'))
                .forEach(p => staff.push({ role: p.role, rating: 55 + Prestige.stored(p) * 8 }));
            const stars = this._teamStars(team.id, world, data);
            workshop = Number(team.paddock?.garageLevel) || (team.ownerUid ? 1 : RR.aiWorkshop(stars));
            if (prep == null) prep = team.ownerUid ? 90 : RR.aiPrep(stars);
            const mech = data.crew.filter(s => s.role === 'mechanic' && s.teamId === team.id)
                .map(s => Prestige.stored(data.profiles.find(p => p.id === s.roleProfileId) || { prestige: 1 }));
            crewStars = mech.length ? Math.max(...mech) : 0;
        } else {
            workshop = Number(userPaddock?.garageLevel) || 1;
            if (userPaddock && PC) selfMech = 35 + PC.skillValue(userPaddock.skills?.mechanical) * 0.35;
            if (prep == null) prep = 90;
        }
        return RR.efficiency({
            staff, workshop, prep, crewStars, selfMech,
            briefed: !!race.crewChiefNotes?.[driver?.id],
            broke: !!team && Number(team.budget) < 0
        });
    },

    /* ---------------- one entry, fully worked out ---------------- */
    // Everything that applies to one driver in this race: their car,
    // inspection, efficiency, adjustments and the offline AI tip.
    entryFacts(race, world, { driver, signup = null, cars = [], userPaddock = null, data, rules, sheet, standings }) {
        const RR = this.RR, PC = window.PaddockCore;
        const { gameId } = this._ctx(race, world);
        const viaTeam = signup ? (signup.via === 'team' && signup.teamId) : null;
        // The team behind the car: the entering team, else the driver's contracted team.
        const teamId = viaTeam || driver?.teamId || null;
        let entry = null;
        if (window.Paddock && cars.length) {
            entry = Paddock.resolveRaceEntry(cars, { signup, raceCarId: viaTeam ? null : userPaddock?.raceCar, driverId: driver?.id, personal: !viaTeam });
        }
        const eff = this.efficiencyFor(driver, race, world, data, { teamId, entry, userPaddock: viaTeam ? null : userPaddock });
        let pi = entry && PC ? PC.pi(entry) : null;
        if (pi == null && rules.format === 'open' && teamId && !world.teamsById[teamId]?.ownerUid) pi = RR.aiTeamPI(this._teamStars(teamId, world, data), rules);
        const st = standings[driver?.id] || {};
        const model = signup?.gameCar || '';
        const adj = RR.entryAdjust(rules, gameId, { model, pi, standing: st.standing, last: st.last, mode: sheet.mode });
        const insp = entry && PC ? RR.inspect(entry, rules, { PARTS: PC.PARTS, pi }) : { legal: true, issues: [], pi };
        const cond = entry && PC ? PC.overall(entry) : eff.prep;
        let tip = RR.aiTip(rules.format, { pi: pi ?? RR.openRef(rules), eff: eff.score, cond, ref: RR.openRef(rules) });
        if (adj.driverKg && adj.adjust !== 'entry') tip -= Math.round(adj.driverKg / 30); // success ballast offline = a tougher field
        tip = RR.clamp(tip, -6, 6);
        return { driver, entry, teamId, eff, pi, adj, insp, tip, model, cond, standing: st.standing || null, last: st.last || null };
    },

    // Sim pace bonus for every driver on the grid (AI teams included).
    async simPaceMap(race, world, grid) {
        const RR = this.RR, PC = window.PaddockCore;
        const out = {};
        if (!this.ok()) return out;
        try {
            const rules = this.rulesFor(race, world);
            const sheet = this.sheetFor(race, world);
            const data = await this.effData(race);
            const standings = this.standingsMap(race, world);
            let signups = [];
            try { signups = (await DB.signups()).filter(s => s.raceId === race.id); } catch (e) { /* */ }
            const pcfg = window.Paddock ? await Paddock.config().catch(() => ({ enabled: false })) : { enabled: false };
            const seed = `${race.seriesId}|${race.seasonId || ''}`;
            for (const d of grid) {
                const signup = signups.find(s => s.driverId === d.id) || null;
                let cars = [], userPaddock = null, user = null;
                if (d.ownerUid && pcfg.enabled) {
                    user = await DB.get('users', d.ownerUid).catch(() => null);
                    userPaddock = user && PC ? PC.ensurePaddock(user.paddock, d.ownerUid) : null;
                    const viaTeam = signup?.via === 'team' && signup.teamId;
                    cars = viaTeam ? world.teamsById[signup.teamId]?.garage || [] : user?.garage || [];
                }
                const f = this.entryFacts(race, world, { driver: d, signup, cars, userPaddock, data, rules, sheet, standings });
                let bonus = RR.paceBonus(rules.format, { pi: f.pi ?? RR.openRef(rules), eff: f.eff.score, cond: f.cond, ref: RR.openRef(rules), bias: rules.format === 'bop' ? RR.bopBias(f.model || f.teamId || d.id, seed) : 0 });
                bonus -= (f.adj.driverKg || 0) * 0.03;          // success / equipment ballast
                bonus -= f.adj.gridDrop ? 0.4 : 0;
                if (userPaddock && PC.hasPerk(userPaddock.skills, 'pace', 16)) bonus += 2;
                out[d.id] = bonus;
            }
        } catch (e) { console.warn('Race rules pace map failed:', e); }
        return out;
    },

    /* ---------------- the race window ---------------- */
    // Your car's facts for the race window (null when you have no paddock car).
    async myFacts(race, world, mySignup, elig) {
        try {
            if (!Auth.isPlayer() || !Auth.state.profile?.driverId) return null;
            const driver = world.driversById[Auth.state.profile.driverId];
            if (!driver) return null;
            const rules = this.rulesFor(race, world);
            const sheet = this.sheetFor(race, world);
            const data = await this.effData(race);
            const PC = window.PaddockCore;
            const userPaddock = PC ? PC.ensurePaddock(Auth.state.profile.paddock, Auth.uid()) : null;
            const signup = mySignup || (elig?.carId || elig?.via ? { carId: elig.carId || null, via: elig.via, teamId: elig.teamId || null } : null);
            const viaTeam = signup?.via === 'team' && signup.teamId;
            let cars = window.Market ? Market.myGarage() : [];
            if (viaTeam) cars = (await DB.get('teams', viaTeam, { force: true }).catch(() => null))?.garage || [];
            return { ...this.entryFacts(race, world, { driver, signup, cars, userPaddock, data, rules, sheet, standings: this.standingsMap(race, world) }), rules, sheet };
        } catch (e) { console.warn('Race facts failed:', e); return null; }
    },

    effHtml(eff) {
        const roles = eff.roles.map(r => `${r.label} ${r.rating ? Math.round(r.rating) : '—'}`).join(' · ');
        return `<div class="rs-eff"><span class="rs-grade rs-grade-${eff.grade}">${eff.grade}</span>
            <div><strong>Team efficiency ${eff.score}</strong> <span class="muted small">staff ${eff.staff} · workshop ${eff.workshop} · car prep ${eff.prep}${eff.extras.length ? ' · ' + Util.esc(eff.extras.join(' · ')) : ''}</span>
            <div class="muted small">${Util.esc(roles)}</div></div></div>`;
    },
    inspectHtml(insp, rules) {
        const f = this.RR.format(rules.format);
        if (insp.legal) return `<p class="small pd-good-text">✅ Tech inspection: legal for this ${Util.esc(f.label.toLowerCase())} series${insp.pi != null && rules.cap?.pi ? ` (PI ${insp.pi} / limit ${rules.cap.pi})` : ''}.</p>`;
        return `<div class="warn-banner rs-illegal">⛔ <strong>Fails tech inspection.</strong><ul>${insp.issues.map(i => `<li>${Util.esc(i.text)} — <span class="muted">${Util.esc(i.fix)}</span></li>`).join('')}</ul></div>`;
    },
    adjustHtml(adj, sheet, gameLabel) {
        const RR = this.RR;
        const bits = [];
        if (adj.adjust === 'entry' && (adj.ballastKg || adj.restrictorPct)) bits.push(`<strong>${adj.ballastKg} kg ballast</strong>${adj.restrictorPct ? ` · <strong>${adj.restrictorPct}% restrictor</strong>` : ''} on your entry`);
        if (adj.adjust === 'model' && (adj.powerPct || adj.modelWeightKg)) bits.push(`Your car model runs ${[adj.powerPct ? `<strong>${adj.powerPct}% power</strong>` : '', adj.modelWeightKg ? `<strong>${adj.modelWeightKg > 0 ? '+' : ''}${adj.modelWeightKg} kg</strong>` : ''].filter(Boolean).join(' and ')} (set per car by the host)`);
        if (adj.pp != null) bits.push(`Build your in-game car to <strong>${adj.pp} ${Util.esc(RR.ctrl(adj.gameId).unit || 'PP')}</strong> or less`);
        if (adj.gridDrop) bits.push(`Start <strong>${adj.gridDrop} place${adj.gridDrop === 1 ? '' : 's'} back</strong> from where you qualify`);
        return `${bits.length ? `<p class="small rs-adjust">🎛️ ${bits.join('<br>🎛️ ')}</p>` : `<p class="small muted">🎛️ No ballast, restrictor or allowance for you in ${Util.esc(gameLabel || 'this game')}.</p>`}
            ${adj.lines.length || adj.notes.length ? `<ul class="small muted rs-lines">${adj.lines.concat(adj.notes).map(l => `<li>${Util.esc(l)}</li>`).join('')}</ul>` : ''}`;
    },

    // "⚖️ Rules" section of the race window (everyone).
    async rulesSection(race, world, { signups = [], mySignup = null, elig = null, facts = null } = {}) {
        if (!this.ok() || race.status === 'completed' || race.status === 'cancelled') return '';
        try {
            const RR = this.RR;
            const { lg, gameId, sd } = this._ctx(race, world);
            const rules = facts?.rules || this.rulesFor(race, world);
            const sheet = facts?.sheet || this.sheetFor(race, world);
            const f = RR.format(rules.format);
            const ctrl = RR.ctrl(gameId);
            const session = this.sessionName(race, world, sheet);
            const isAdmin = Auth.isAdmin();
            const chips = [
                `<span class="chip rs-format rs-format-${f.id}" title="${Util.esc(f.desc)}">${f.icon} ${Util.esc(f.label)}</span>`,
                rules.cap ? `<span class="chip chip-dim">Class limit: ${Util.esc([rules.cap.label, rules.cap.gameMax ? `≤ ${rules.cap.gameMax} ${ctrl.unit || ''}`.trim() : '', rules.cap.pi ? `paddock PI ≤ ${rules.cap.pi}` : ''].filter(Boolean).join(' · '))}</span>` : '',
                rules.ballast.mode !== 'off' && rules.ballast.steps.length ? `<span class="chip chip-dim">Success ballast: ${rules.ballast.steps.map((k, i) => `P${i + 1} +${k} kg`).join(', ')} (${rules.ballast.mode === 'standings' ? 'championship' : 'last race'})</span>` : '',
                sheet.proof !== 'none' ? `<span class="chip chip-dim">📸 Proof: ${Util.esc(RR.OPTIONS.proof[sheet.proof])}</span>` : ''
            ].filter(Boolean).join('');
            const bop = rules.format === 'bop' && rules.bop.length ? `
                <table class="table table-tight rs-bop"><thead><tr><th>Car</th><th class="num">Weight</th><th class="num">Power</th><th class="num">Restrictor</th></tr></thead><tbody>
                ${rules.bop.map(b => `<tr><td>${Util.esc(b.car)}</td><td class="num">${b.weightKg ? `${b.weightKg > 0 ? '+' : ''}${b.weightKg} kg` : '—'}</td><td class="num">${b.powerPct ? b.powerPct + '%' : '—'}</td><td class="num">${b.restrictorPct ? b.restrictorPct + '%' : '—'}</td></tr>`).join('')}</tbody></table>` : '';
            let mine = '';
            if (facts) {
                facts.adj.gameId = gameId;
                mine = `<div class="rs-mine">
                    <h4>Your entry${facts.entry ? ` — ${Util.esc(facts.entry.nick || facts.entry.name)}` : ''}</h4>
                    ${facts.entry ? this.inspectHtml(facts.insp, rules) : ''}
                    ${this.effHtml(facts.eff)}
                    ${this.adjustHtml(facts.adj, sheet, lg?.short)}
                    ${sheet.mode !== 'online' ? `<p class="small">🎚️ Racing offline vs AI: ${Util.esc(RR.aiTipText(facts.tip, lg?.ai?.label || 'AI strength'))}${sheet.aiLevel ? ` (sheet baseline: ${Util.esc(sheet.aiLevel)})` : ''}.</p>` : ''}
                </div>`;
            }
            const bopPick = rules.format === 'bop' && rules.bop.length && mySignup ? `
                <label class="field rs-gamecar"><span>Your in-game car (sets your BoP)</span><select class="input" id="rs-gamecar">
                    <option value="">— choose —</option>${rules.bop.map(b => `<option ${mySignup.gameCar === b.car ? 'selected' : ''}>${Util.esc(b.car)}</option>`).join('')}</select></label>` : '';
            const gmTools = isAdmin ? `<div class="btn-row rs-gm">
                    <button type="button" class="btn btn-secondary btn-sm" onclick="RaceSheet.raceSheetForm('${Util.attr(race.id)}')">📋 Edit race sheet</button>
                    ${race.seriesId ? `<button type="button" class="btn btn-secondary btn-sm" onclick="RaceSheet.seriesRulesForm('${Util.attr(race.seriesId)}')">⚖️ Series rules</button>` : ''}
                    ${signups.length ? `<button type="button" class="btn btn-ghost btn-sm" onclick="RaceSheet.entryTable('${Util.attr(race.id)}')">🎛️ Entry adjustments</button>` : ''}
                    ${signups.length && ctrl.adjust === 'entry' ? `<button type="button" class="btn btn-ghost btn-sm" onclick="RaceSheet.downloadEntryList('${Util.attr(race.id)}')">⬇ ${gameId === 'acc' ? 'entrylist.json' : 'entry_list.ini'}</button>` : ''}
                </div>` : '';
            return `<section class="rs-rules">
                <h3 class="section-label">⚖️ Rules — ${Util.esc(f.label)}</h3>
                <div class="chip-row">${chips}</div>
                <p class="small">${Util.esc(f.desc)} <span class="muted">Real-world: ${Util.esc(f.real)}</span></p>
                ${bop}
                <div class="rs-code"><span>Race code <strong>${Util.esc(sheet.code)}</strong></span><span>Session / server name <code>${Util.esc(session)}</code></span>
                    <button type="button" class="btn btn-ghost btn-sm" data-copy-setup="${Util.esc(session)}">📋 Copy name</button></div>
                <p class="muted small">${sheet.mode === 'offline' ? 'Offline race: build it from the sheet above, then upload your results file or a screenshot.' : `Put the session name in the ${Util.esc(lg?.short || 'game')} lobby / server name so the results prove which race they're from.`}${sheet.codeInFile ? ` ${Util.esc(lg?.short || 'This game')}'s results file records the server name.` : ''}</p>
                <details class="rs-host"><summary>🖥️ Host settings for ${Util.esc(lg?.short || 'this game')}</summary><ul class="small">${ctrl.host.map(h => `<li>${Util.esc(h)}</li>`).join('')}</ul>
                    ${sd?.car ? `<p class="small muted">Series car: ${Util.esc(sd.car)}</p>` : ''}</details>
                ${bopPick}
                ${mine}
                ${gmTools}
            </section>`;
        } catch (e) { console.warn('Rules section failed:', e); return ''; }
    },
    wireRules(race, mySignup) {
        const sel = Util.$('#rs-gamecar');
        if (sel && mySignup) sel.addEventListener('change', async () => {
            try {
                await DB.update('raceSignups', mySignup.id, { gameCar: sel.value || null });
                Util.notify('Car model saved — your BoP is updated. ⚖️');
                Views.showRace(race.id);
            } catch (e) { Util.notify('Could not save your car model: ' + e.message, 'error'); }
        });
    },

    /* ---------------- signup tech inspection ---------------- */
    // Returns { legal, issues } for the car a signup would race (open entry = legal).
    async techCheck(raceId, elig) {
        try {
            if (!this.ok() || !window.Paddock || !window.PaddockCore) return { legal: true, issues: [] };
            const cfg = await Paddock.config();
            const world = await DB.loadWorld();
            const race = world.races.find(r => r.id === raceId);
            if (!race) return { legal: true, issues: [] };
            const rules = this.rulesFor(race, world);
            const p = Paddock.stateOf(Auth.state.profile, cfg, Auth.uid());
            const viaTeam = elig?.via === 'team' && elig.teamId;
            const cars = viaTeam ? (await DB.get('teams', viaTeam, { force: true }).catch(() => null))?.garage || [] : Market.myGarage();
            const entry = Paddock.resolveRaceEntry(cars, { signup: { carId: elig?.carId || null }, raceCarId: viaTeam ? null : p.raceCar, driverId: Auth.state.profile?.driverId, personal: !viaTeam });
            if (!entry) return { legal: true, issues: [] };
            return this.RR.inspect(entry, rules, { PARTS: PaddockCore.PARTS, pi: PaddockCore.pi(entry) });
        } catch (e) { return { legal: true, issues: [] }; }
    },

    /* ---------------- GM: entry adjustments + entry lists ---------------- */
    async entryRows(raceId) {
        const world = await DB.loadWorld(true);
        const race = world.races.find(r => r.id === raceId);
        if (!race) throw new Error('Race not found.');
        const rules = this.rulesFor(race, world);
        const sheet = this.sheetFor(race, world);
        const data = await this.effData(race);
        const standings = this.standingsMap(race, world);
        const signups = (await DB.signups({ force: true })).filter(s => s.raceId === raceId);
        const PC = window.PaddockCore;
        const rows = [];
        for (const s of signups) {
            const driver = world.driversById[s.driverId];
            if (!driver) continue;
            const user = s.uid ? await DB.get('users', s.uid).catch(() => null) : null;
            const userPaddock = user && PC ? PC.ensurePaddock(user.paddock, s.uid) : null;
            const cars = s.via === 'team' && s.teamId ? world.teamsById[s.teamId]?.garage || [] : user?.garage || [];
            const f = this.entryFacts(race, world, { driver, signup: s, cars, userPaddock, data, rules, sheet, standings });
            rows.push({ ...f, name: driver.name, number: driver.number, steamId: user?.steamId || driver.steamId || '' });
        }
        return { race, world, rules, sheet, rows, ctx: this._ctx(race, world) };
    },
    async entryTable(raceId) {
        try {
            const { race, rules, rows, ctx } = await this.entryRows(raceId);
            const RR = this.RR;
            const unit = RR.ctrl(ctx.gameId).unit || 'PP';
            Modal.open(`
                ${Modal.header('🎛️ Entry adjustments', `${race.name || race.track} · ${RR.format(rules.format).label} · ${ctx.lg?.short || 'game'}`)}
                <table class="table table-tight"><thead><tr><th>Driver</th><th>Car</th><th class="num">PI</th><th class="num">Eff.</th><th>Tech</th><th>Adjustment</th></tr></thead><tbody>
                ${rows.map(r => `<tr><td>${Util.esc(r.name)}${r.standing ? ` <span class="muted small">P${r.standing}</span>` : ''}</td>
                    <td>${Util.esc(r.model || r.entry?.name || '—')}</td><td class="num">${r.pi ?? '—'}</td><td class="num">${r.eff.score}</td>
                    <td>${r.insp.legal ? '✅' : `⛔ <span class="small">${Util.esc(r.insp.issues.map(i => i.text).join('; '))}</span>`}</td>
                    <td class="small">${[r.adj.ballastKg ? `${r.adj.ballastKg} kg` : '', r.adj.restrictorPct ? `${r.adj.restrictorPct}% restr.` : '', r.adj.powerPct ? `${r.adj.powerPct}% power` : '', r.adj.pp != null ? `≤ ${r.adj.pp} ${unit}` : '', r.adj.gridDrop ? `−${r.adj.gridDrop} grid` : ''].filter(Boolean).join(' · ') || '—'}</td></tr>`).join('')}
                </tbody></table>
                <div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="Modal.close()">Close</button></div>`, { wide: true });
        } catch (e) { Util.notify(e.message, 'error'); }
    },
    async downloadEntryList(raceId) {
        try {
            const { rows, ctx } = await this.entryRows(raceId);
            const entries = rows.map(r => ({ name: r.name, number: r.number, ballastKg: r.adj.ballastKg, restrictorPct: r.adj.restrictorPct, steamId: r.steamId, model: r.model }));
            const acc = ctx.gameId === 'acc';
            const text = acc ? this.RR.accEntryList(entries) : this.RR.acEntryList(entries);
            const blob = new Blob([text], { type: acc ? 'application/json' : 'text/plain' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = acc ? 'entrylist.json' : 'entry_list.ini';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            Util.notify(`${a.download} downloaded — add each driver's Steam ID where it says so. ⬇`);
            return text;
        } catch (e) { Util.notify(e.message, 'error'); return null; }
    },

    /* ---------------- GM: series rules ---------------- */
    async seriesRulesForm(seriesId) {
        if (!Auth.isAdmin()) return;
        const RR = this.RR;
        const world = await DB.loadWorld(true);
        const series = world.seriesById[seriesId];
        if (!series) { Util.notify('Series not found.', 'error'); return; }
        const game = world.gamesById[series.gameId];
        const lg = window.Library ? Library.libGameFor(game) : null;
        const sd = window.Library ? Library.libSeriesFor(series, game) : null;
        const r = RR.rules(series.rules, { sd, lg });
        const sh = { ...RR.DETAIL_DEFAULTS, ...(series.sheet || {}) };
        const ctrl = RR.ctrl(lg?.id);
        const classes = RR.classesFor(lg?.id);
        const opt = (name, cur) => Object.entries(RR.OPTIONS[name]).map(([k, v]) => `<option value="${k}" ${String(cur) === k ? 'selected' : ''}>${Util.esc(v)}</option>`).join('');
        Modal.open(`
            ${Modal.header(`⚖️ Rules — ${series.name}`, `${lg?.short || game?.name || 'Any game'} · how equipment works and how every race is run`)}
            <form id="rs-rules-form" class="form-grid">
                <label class="field"><span>Equipment format</span><select id="rs-format" class="input">
                    ${RR.FORMAT_KEYS.map(k => `<option value="${k}" ${r.format === k ? 'selected' : ''}>${RR.FORMATS[k].icon} ${Util.esc(RR.FORMATS[k].label)} — ${Util.esc(RR.FORMATS[k].tag)}</option>`).join('')}</select>
                    <span class="muted small" id="rs-format-desc"></span>${!r.explicit && sd ? `<span class="muted small">Suggested for ${Util.esc(sd.name)}.</span>` : ''}</label>
                <fieldset class="rs-fieldset"><legend>Class limit</legend>
                    ${classes ? `<label class="field"><span>${Util.esc(lg.short)} class</span><select id="rs-class" class="input"><option value="">— none / custom —</option>${classes.map(c => `<option value="${c.id}" ${r.cap?.label === c.id ? 'selected' : ''}>Class ${c.id} (${c.min}–${c.max >= 999 ? '∞' : c.max} ${ctrl.unit})</option>`).join('')}</select></label>` : ''}
                    <div class="form-row">
                        <label class="field"><span>Class name</span><input id="rs-cap-label" class="input" maxlength="20" value="${Util.esc(r.cap?.label || '')}" placeholder="e.g. C, Gr.4, Street Stock"></label>
                        <label class="field"><span>In-game ${Util.esc(ctrl.unit || 'PP / PI')} min</span><input id="rs-cap-min" class="input" type="number" value="${r.cap?.gameMin ?? ''}"></label>
                        <label class="field"><span>In-game ${Util.esc(ctrl.unit || 'PP / PI')} max</span><input id="rs-cap-max" class="input" type="number" value="${r.cap?.gameMax ?? ''}"></label>
                        <label class="field"><span>Paddock PI limit</span><input id="rs-cap-pi" class="input" type="number" min="1" max="100" value="${r.cap?.pi ?? ''}" placeholder="e.g. 70"></label>
                    </div>
                    <span class="muted small">Open series: cars over the paddock PI limit fail tech inspection. ${ctrl.adjust === 'tune' ? `In ${Util.esc(lg.short)} each driver gets an in-game build allowance between the min and max from their paddock car.` : ''}</span>
                </fieldset>
                <label class="field" id="rs-bop-wrap"><span>BoP table — one car per line: Car | weight kg | power % | restrictor %</span>
                    <textarea id="rs-bop" class="input" rows="4" placeholder="Porsche 992 GT3 R | 15 | 98&#10;Ferrari 296 GT3 | 0 | 100&#10;BMW M4 GT3 | 10 | 99 | 2">${Util.esc(RR.bopText(r.bop))}</textarea>
                    <span class="muted small">${ctrl.adjust === 'model' ? 'iRacing sets power (90–110%) and weight per car model in the hosted session.' : ctrl.adjust === 'entry' ? `${Util.esc(lg?.short || 'This game')} applies it per entry (ballast / restrictor); power under 100% becomes restrictor.` : 'Shown to drivers; the host applies it if the game allows.'}</span></label>
                <fieldset class="rs-fieldset"><legend>Success ballast</legend>
                    <div class="form-row">
                        <label class="field"><span>Based on</span><select id="rs-sb-mode" class="input"><option value="off">Off</option><option value="standings" ${r.ballast.mode === 'standings' ? 'selected' : ''}>Championship position</option><option value="lastRace" ${r.ballast.mode === 'lastRace' ? 'selected' : ''}>Last race finish</option></select></label>
                        <label class="field"><span>kg for P1, P2, P3…</span><input id="rs-sb-steps" class="input" value="${Util.esc(r.ballast.steps.join(', '))}" placeholder="30, 20, 10"></label>
                        <label class="field"><span>Max kg</span><input id="rs-sb-max" class="input" type="number" min="0" value="${r.ballast.max ?? 100}"></label>
                    </div></fieldset>
                <fieldset class="rs-fieldset"><legend>Equipment ballast (open series)</legend>
                    <div class="form-row">
                        <label class="field"><span>Lever (ACC / AC)</span><select id="rs-lever" class="input"><option value="ballast">Ballast</option><option value="restrictor" ${r.lever === 'restrictor' ? 'selected' : ''}>Restrictor</option><option value="both" ${r.lever === 'both' ? 'selected' : ''}>Both</option></select></label>
                        <label class="field"><span>kg per PI under the limit</span><input id="rs-kgpi" class="input" type="number" step="0.5" min="0" value="${r.kgPerPI}"></label>
                    </div>
                    <label class="check"><input type="checkbox" id="rs-griddrop" ${r.gridDrop ? 'checked' : ''}> Games that can't weigh one driver: turn per-driver kg into grid places (1 per <input id="rs-kgplace" type="number" min="1" style="width:4rem" value="${r.kgPerPlace}"> kg)</label>
                </fieldset>
                <fieldset class="rs-fieldset"><legend>Race sheet defaults (each race can override)</legend>
                    <div class="form-row">
                        <label class="field"><span>How races run</span><select id="rs-d-mode" class="input">${opt('mode', sh.mode)}</select></label>
                        <label class="field"><span>Result proof</span><select id="rs-d-proof" class="input">${opt('proof', sh.proof)}</select></label>
                        <label class="field"><span>Results dated within (days)</span><input id="rs-d-window" class="input" type="number" min="0" max="30" value="${sh.windowDays}"></label>
                    </div>
                    <div class="form-row">
                        <label class="field"><span>Start</span><select id="rs-d-start" class="input">${opt('start', sh.start)}</select></label>
                        <label class="field"><span>Damage</span><select id="rs-d-damage" class="input">${opt('damage', sh.damage)}</select></label>
                        <label class="field"><span>Setups</span><select id="rs-d-setup" class="input">${opt('setup', sh.setup)}</select></label>
                        <label class="field"><span>Assists</span><select id="rs-d-assists" class="input">${opt('assists', sh.assists)}</select></label>
                    </div>
                    <label class="check"><input type="checkbox" id="rs-d-code" ${sh.codeRequired ? 'checked' : ''}> Online results must carry the race code (session / server name)</label>
                </fieldset>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save rules</button>
                </div>
            </form>`, { wide: true });
        const desc = () => {
            const f = RR.format(Util.$('#rs-format').value);
            Util.$('#rs-format-desc').textContent = `${f.desc} Real-world: ${f.real}`;
            Util.$('#rs-bop-wrap').style.display = f.id === 'bop' ? '' : 'none';
        };
        Util.$('#rs-format').addEventListener('change', desc); desc();
        Util.$('#rs-class')?.addEventListener('change', (e) => {
            const c = classes.find(x => x.id === e.target.value);
            if (!c) return;
            Util.$('#rs-cap-label').value = c.id; Util.$('#rs-cap-min').value = c.min; Util.$('#rs-cap-max').value = c.max >= 999 ? '' : c.max;
        });
        Util.$('#rs-rules-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const n = (id) => { const v = Util.$('#' + id).value; return v === '' ? null : Number(v); };
                const rules = {
                    format: Util.$('#rs-format').value,
                    cap: (n('rs-cap-pi') || n('rs-cap-max') || Util.$('#rs-cap-label').value.trim())
                        ? { label: Util.$('#rs-cap-label').value.trim(), gameMin: n('rs-cap-min'), gameMax: n('rs-cap-max'), pi: n('rs-cap-pi') } : null,
                    bop: RR.parseBop(Util.$('#rs-bop').value),
                    ballast: { mode: Util.$('#rs-sb-mode').value, steps: Util.$('#rs-sb-steps').value.split(/[,\s]+/).map(Number).filter(x => Number.isFinite(x) && x >= 0), max: n('rs-sb-max') ?? 100 },
                    lever: Util.$('#rs-lever').value, kgPerPI: n('rs-kgpi') ?? 2.5,
                    gridDrop: Util.$('#rs-griddrop').checked, kgPerPlace: Math.max(1, n('rs-kgplace') || 10)
                };
                if (rules.cap?.pi != null && (rules.cap.pi < 1 || rules.cap.pi > 100)) throw new Error('The paddock PI limit is 1–100.');
                if (rules.format === 'bop' && rules.bop.some(b => b.powerPct && (b.powerPct < 50 || b.powerPct > 150))) throw new Error('BoP power should be a percentage like 98.');
                const sheet = {
                    ...(series.sheet || {}),
                    mode: Util.$('#rs-d-mode').value, proof: Util.$('#rs-d-proof').value, windowDays: Math.max(0, n('rs-d-window') ?? 3),
                    start: Util.$('#rs-d-start').value, damage: Util.$('#rs-d-damage').value, setup: Util.$('#rs-d-setup').value,
                    assists: Util.$('#rs-d-assists').value, codeRequired: Util.$('#rs-d-code').checked
                };
                await DB.update('series', seriesId, { rules: JSON.parse(JSON.stringify(rules)), sheet: JSON.parse(JSON.stringify(sheet)) });
                Modal.close();
                Util.notify(`Rules saved — ${RR.format(rules.format).label} for ${series.name}. ⚖️`);
                if (App.current?.view === 'admin') Admin.refresh();
                else if (App.current?.view) App.go(App.current.view, App.current.param);
            } catch (err) { Util.notify(err.message, 'error'); }
        });
    },

    /* ---------------- GM: race sheet ---------------- */
    async raceSheetForm(raceId) {
        if (!Auth.isAdmin()) return;
        const RR = this.RR;
        const world = await DB.loadWorld(true);
        const race = world.races.find(r => r.id === raceId);
        if (!race) { Util.notify('Race not found.', 'error'); return; }
        const { lg, sd, series } = this._ctx(race, world);
        const d = this.sheetFor(race, world);
        const opt = (name, cur) => Object.entries(RR.OPTIONS[name]).map(([k, v]) => `<option value="${k}" ${String(cur) === k ? 'selected' : ''}>${Util.esc(v)}</option>`).join('');
        const v = (x) => x == null ? '' : Util.esc(String(x));
        Modal.open(`
            ${Modal.header(`📋 Race sheet — ${race.name || race.track}`, `${series?.name || 'Standalone'} · everything a host or an offline racer needs to build this race exactly`)}
            <form id="rs-sheet-form" class="form-grid">
                <div class="rs-code"><span>Race code <strong>${Util.esc(d.code)}</strong></span><span>Session name <code>${Util.esc(this.sessionName(race, world, d))}</code></span></div>
                <div class="form-row">
                    <label class="field"><span>How it runs</span><select id="rs-mode" class="input">${opt('mode', d.mode)}</select></label>
                    <label class="field"><span>Track layout</span><input id="rs-layout" class="input" maxlength="60" value="${v(d.layout)}" placeholder="e.g. GP, National, Oval"></label>
                    <label class="field"><span>Race laps</span><input id="rs-laps" class="input" type="number" min="1" value="${v(race.laps)}"></label>
                    <label class="field"><span>…or minutes</span><input id="rs-minutes" class="input" type="number" min="1" value="${race.laps ? '' : v(d.minutes)}"></label>
                </div>
                <div class="form-row">
                    <label class="field"><span>Practice (min)</span><input id="rs-prac" class="input" type="number" min="0" value="${v(d.practiceMin)}"></label>
                    <label class="field"><span>Qualifying</span><select id="rs-qtype" class="input">${opt('qualiType', d.qualiType)}</select></label>
                    <label class="field"><span>Qualifying (min)</span><input id="rs-quali" class="input" type="number" min="0" value="${v(d.qualiMin)}"></label>
                    <label class="field"><span>Start</span><select id="rs-start" class="input">${opt('start', d.start)}</select></label>
                </div>
                <div class="form-row">
                    <label class="field"><span>Weather</span><select id="rs-weather" class="input">${opt('weather', d.weather)}</select></label>
                    <label class="field"><span>Time of day</span><input id="rs-tod" class="input" maxlength="20" value="${v(d.timeOfDay)}" placeholder="e.g. 14:00, Night"></label>
                    <label class="field"><span>Damage</span><select id="rs-damage" class="input">${opt('damage', d.damage)}</select></label>
                    <label class="field"><span>Setups</span><select id="rs-setup" class="input">${opt('setup', d.setup)}</select></label>
                </div>
                <div class="form-row">
                    <label class="field"><span>Fuel</span><select id="rs-fuel" class="input">${opt('fuel', d.fuel)}</select></label>
                    <label class="field"><span>Tyre wear</span><select id="rs-tyres" class="input">${opt('tyreWear', d.tyreWear)}</select></label>
                    <label class="field"><span>Assists</span><select id="rs-assists" class="input">${opt('assists', d.assists)}</select></label>
                    <label class="field"><span>Flags</span><select id="rs-flags" class="input">${opt('flags', d.flags)}</select></label>
                </div>
                <label class="field"><span>Pit rule</span><input id="rs-pit" class="input" maxlength="80" value="${v(d.pitRule)}" placeholder="e.g. One mandatory stop, 4 tyres"></label>
                <div class="form-row">
                    <label class="field"><span>Offline field (cars incl. you)</span><input id="rs-field" class="input" type="number" min="2" max="80" value="${v(d.field)}" placeholder="${v(sd?.grid || lg?.maxGrid || 20)}"></label>
                    <label class="field"><span>Offline AI baseline</span><input id="rs-ai" class="input" maxlength="20" value="${v(d.aiLevel)}" placeholder="${v(lg?.ai ? `${lg.ai.label} ${lg.ai.def}${lg.ai.unit || ''}` : 'e.g. 95')}"></label>
                </div>
                <label class="field"><span>Allowed in-game cars (comma separated — checked against results files)</span><input id="rs-cars" class="input" maxlength="300" value="${v(d.gameCars)}" placeholder="${v(sd?.car || 'e.g. Mazda MX-5 Cup')}"></label>
                <div class="form-row">
                    <label class="field"><span>Result proof</span><select id="rs-proof" class="input">${opt('proof', d.proof === 'none' && !d.custom ? 'file-or-shot' : d.proof)}</select></label>
                    <label class="field"><span>Results dated within (days of race day)</span><input id="rs-window" class="input" type="number" min="0" max="30" value="${v(d.windowDays)}"></label>
                </div>
                <label class="check"><input type="checkbox" id="rs-code" ${d.codeRequired ? 'checked' : ''}> Online results must carry the race code ${d.codeInFile ? `(${Util.esc(lg.short)}'s results file records the server name)` : '(checked on screenshots)'}</label>
                <label class="field"><span>Notes for drivers</span><textarea id="rs-notes" class="input" rows="2" maxlength="400">${Util.esc(d.notes || '')}</textarea></label>
                <div class="modal-actions">
                    ${race.details ? '<button type="button" class="btn btn-ghost" id="rs-reset">Reset to series defaults</button>' : ''}
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save race sheet</button>
                </div>
            </form>`, { wide: true });
        Util.$('#rs-reset')?.addEventListener('click', async () => {
            if (!confirm('Drop this race\'s own sheet and use the series defaults?')) return;
            await DB.update('races', raceId, { details: null });
            Modal.close(); Util.notify('Race sheet reset to the series defaults.');
            Views.showRace(raceId);
        });
        Util.$('#rs-sheet-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const n = (id) => { const x = Util.$('#' + id).value; return x === '' ? null : Number(x); };
                const s = (id) => Util.$('#' + id).value.trim();
                const laps = n('rs-laps');
                const details = {
                    code: d.code, mode: s('rs-mode'), layout: s('rs-layout'), minutes: laps ? null : n('rs-minutes'),
                    practiceMin: n('rs-prac') ?? 0, qualiType: s('rs-qtype'), qualiMin: n('rs-quali') ?? 0, start: s('rs-start'),
                    weather: s('rs-weather'), timeOfDay: s('rs-tod'), damage: s('rs-damage'), setup: s('rs-setup'),
                    fuel: s('rs-fuel'), tyreWear: s('rs-tyres'), assists: s('rs-assists'), flags: s('rs-flags'),
                    pitRule: s('rs-pit'), field: n('rs-field'), aiLevel: s('rs-ai'), gameCars: s('rs-cars'),
                    proof: s('rs-proof'), windowDays: Math.max(0, n('rs-window') ?? 3), codeRequired: Util.$('#rs-code').checked,
                    notes: s('rs-notes'), updatedAt: new Date().toISOString()
                };
                if (!laps && !details.minutes) throw new Error('Give the race a distance: laps or minutes.');
                await DB.update('races', raceId, { details, laps: laps || null });
                Modal.close();
                Util.notify('Race sheet saved — every driver sees it in the race window. 📋');
                Views.showRace(raceId);
            } catch (err) { Util.notify(err.message, 'error'); }
        });
    },

    /* ============================================================
       Result proof — files and screenshots
       ============================================================ */
    // proof stored in report.proof: { kind: 'file'|'shot', status, checks,
    // name, format?, image? (screenshot data URL), at }.
    badge(proof) {
        if (!proof) return '<span class="badge badge-dim" title="No proof attached">no proof</span>';
        const st = this.RR.STATUS[proof.status] || this.RR.STATUS.unverified;
        const why = (proof.checks || []).map(c => `${c.ok === true ? '✓' : c.ok === false ? '✗' : '?'} ${c.label}: ${c.detail}`).join('\n');
        return `<span class="badge ${st.tone === 'good' ? 'badge-green' : st.tone === 'bad' ? 'badge-bad' : 'badge-amber'}" title="${Util.esc(why)}">${st.icon} ${proof.kind === 'shot' ? 'screenshot' : 'file'} ${st.label.split(' —')[0].toLowerCase()}</span>`;
    },
    checksHtml(res) {
        if (!res) return '';
        const st = this.RR.STATUS[res.status];
        return `<div class="rs-check rs-check-${res.status}"><strong>${st.icon} ${Util.esc(st.label)}</strong>
            <ul class="small">${res.checks.map(c => `<li class="${c.ok === true ? 'pd-good-text' : c.ok === false ? 'pd-bad-text' : 'muted'}">${c.ok === true ? '✓' : c.ok === false ? '✗' : '?'} ${Util.esc(c.label)}: ${Util.esc(c.detail)}</li>`).join('')}</ul></div>`;
    },

    // A results file → { status, checks, me (row), rows, meta, format }.
    checkFileText(text, filename, race, world, { driver = null, claimed = null, expect = null } = {}) {
        const RR = this.RR;
        const sheet = this.sheetFor(race, world);
        const { format, rows } = SC.Import.parse(text, filename);
        const meta = SC.Import.meta(text, format, filename);
        let me = null;
        if (driver) {
            const ent = Library._entrant(driver);
            const m = SC.Import.match(rows, [{ ...ent, id: driver.id }], { playerId: driver.id, autoFill: false });
            me = m.find(r => r.id === driver.id) || null;
        }
        const res = RR.checkFile({ race, sheet, meta, rows, me, claimed, expect, resolveTrack: (n) => this.resolveTrack(n), needMe: !!driver });
        return { ...res, me, rows, meta, format };
    },

    // Screenshot → compressed image + OCR text + checks.
    async checkShot(file, race, world, { driver = null } = {}) {
        const RR = this.RR;
        const sheet = this.sheetFor(race, world);
        const image = await this.shrinkShot(file);
        let text = '';
        try { text = await this.ocr(image); } catch (e) { text = ''; }
        const fileDate = file.lastModified ? new Date(file.lastModified).toISOString().slice(0, 10) : null;
        const { lg } = this._ctx(race, world);
        const res = RR.checkText({ race, sheet, text, fileDate, driverName: driver?.name || '', knownTracks: lg?.tracks || [] });
        return { ...res, image, text: text.slice(0, 600) };
    },
    // Screenshots are kept small enough to live on the signup doc.
    shrinkShot(file) {
        return new Promise((resolve, reject) => {
            if (!file || !/^image\//.test(file.type)) { reject(new Error('Choose a screenshot image (PNG or JPG).')); return; }
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Could not read the screenshot.'));
            reader.onload = () => {
                const img = new Image();
                img.onerror = () => reject(new Error('Could not load the screenshot.'));
                img.onload = () => {
                    const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
                    const c = document.createElement('canvas');
                    c.width = Math.max(1, Math.round(img.width * scale)); c.height = Math.max(1, Math.round(img.height * scale));
                    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                    let url = c.toDataURL('image/jpeg', 0.72);
                    if (url.length > 300000) url = c.toDataURL('image/jpeg', 0.5);
                    if (url.length > 450000) { reject(new Error('That screenshot is too big even after compression — crop it to the results.')); return; }
                    resolve(url);
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    },
    // OCR with Tesseract.js, loaded only when someone uploads a screenshot.
    _tess: null,
    async ocr(image) {
        if (!window.Tesseract) {
            if (!this._tess) this._tess = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
                s.onload = () => window.Tesseract ? resolve() : reject(new Error('OCR unavailable'));
                s.onerror = () => reject(new Error('OCR unavailable'));
                document.head.appendChild(s);
                setTimeout(() => reject(new Error('OCR timed out')), 20000);
            });
            await this._tess;
        }
        const out = await Promise.race([
            window.Tesseract.recognize(image, 'eng'),
            new Promise((_, rej) => setTimeout(() => rej(new Error('OCR timed out')), 45000))
        ]);
        return out?.data?.text || '';
    },

    // The proof inputs in "Report my result".
    proofPanelHtml(race, world, rep) {
        const sheet = this.sheetFor(race, world);
        const need = sheet.proof;
        const p = rep?.proof;
        return `<div class="rs-proof">
            <p class="small"><strong>📸 Proof${need === 'none' ? ' (optional)' : ''}:</strong> ${Util.esc(this.RR.OPTIONS.proof[need === 'none' ? 'file-or-shot' : need])}. It's checked against the race sheet — the wrong track, distance, race code, date or a different result makes it <strong>invalid</strong>.</p>
            <div class="form-row">
                ${need !== 'shot' ? '<label class="field"><span>Results file</span><input id="rep-proof-file" class="input" type="file" accept=".xml,.txt,.html,.htm,.csv,.json,.tsv"></label>' : ''}
                ${need !== 'file' ? '<label class="field"><span>Screenshot</span><input id="rep-proof-shot" class="input" type="file" accept="image/*"></label>' : ''}
            </div>
            <div id="rep-proof-out">${p ? `<p class="small">Current proof: ${this.badge(p)} ${Util.esc(p.name || '')}</p>` : ''}</div>
        </div>`;
    },
    // Read whichever proof the driver chose. Returns { proof, fill } or throws.
    async readProof(race, world, driver, claimed, mySignup = null) {
        const fileIn = Util.$('#rep-proof-file')?.files?.[0];
        const shotIn = Util.$('#rep-proof-shot')?.files?.[0];
        const out = Util.$('#rep-proof-out');
        if (fileIn) {
            const text = SC.Import.decode(await fileIn.arrayBuffer());
            // Online ACC / AC servers record each car's ballast and restrictor: check them too.
            const facts = await this.myFacts(race, world, mySignup, null).catch(() => null);
            const expect = facts?.adj?.adjust === 'entry' && facts.sheet?.mode !== 'offline' ? { ballastKg: facts.adj.ballastKg, restrictorPct: facts.adj.restrictorPct } : null;
            const res = this.checkFileText(text, fileIn.name, race, world, { driver, claimed, expect });
            if (out) out.innerHTML = this.checksHtml(res);
            const proof = { kind: 'file', status: res.status, checks: res.checks, name: fileIn.name, format: res.format, at: new Date().toISOString() };
            const fill = res.me ? { position: res.me.dnf ? null : res.me.pos, dnf: !!res.me.dnf, start: res.me.start ?? null, lapsLed: res.me.led ?? null, incidents: res.me.inc ?? null, fastestLap: !!res.me.fl, lapsCompleted: res.me.laps ?? null } : null;
            return { proof, fill };
        }
        if (shotIn) {
            if (out) out.innerHTML = '<p class="small muted">🔎 Reading the screenshot…</p>';
            const res = await this.checkShot(shotIn, race, world, { driver });
            if (out) out.innerHTML = this.checksHtml(res);
            return { proof: { kind: 'shot', status: res.status, checks: res.checks, name: shotIn.name, image: res.image, text: res.text, at: new Date().toISOString() }, fill: null };
        }
        return { proof: null, fill: null };
    },

    // GM import: check the file before it can fill the results form.
    importCheck(text, filename, race, world) {
        const res = this.checkFileText(text, filename, race, world);
        return res;
    }
};
window.RaceSheet = RaceSheet;
