/* ============================================================
   Phoenix SRMPC — League Director (Game Master autopilot)
   Runs the league so the Game Master only has to enter results.

   There's no server, so the Director runs inside Game Master
   sessions: when a GM opens the app, right after results are
   saved, and every 10 minutes while the app stays open. Each run
   ("tick") catches up on everything that's due and is safe to
   repeat — nothing happens twice.

   What it does (each can be switched off in Admin → Overview):
   - Simulates races nobody entered, a couple of days after race day
     (AI field), and cancels ones nobody can run.
   - Races the AI field around the results the GM enters.
   - Closes finished seasons: crowns champions, pays title clauses,
     rolls car numbers over.
   - Schedules the next season (real calendar for library series,
     otherwise last season's tracks) on the chosen race day.
   - AI team principals answer applications and release requests
     (drivers get an offer in their deal room straight away).
   - Keeps AI teams' seats filled from free agents.
   - Closes number auctions and renewal windows on their deadline.
   - Keeps a set of challenges running, verifies them from race
     results, and approves the rest after a short wait.
   - Approves series proposals.
   - Optional: confirms results by itself once every entered driver
     has reported their own.

   Settings + an activity log live in the career's config/director doc.
   ============================================================ */
'use strict';

const Director = {
    DEFAULTS: {
        enabled: true,
        simAiRaces: true,       // races nobody entered → simulated after graceDays
        graceDays: 2,
        aiFill: true,           // AI field races around the GM's results
        seasons: true,          // close finished seasons, crown champions
        autoSchedule: true,     // schedule the next season
        cadence: 'weekly', raceDay: 6, raceTime: '20:00', lengthPct: 0.5,
        recruiting: true,       // AI principals answer applications / releases
        fillSeats: true,        // AI teams re-sign drivers into empty seats
        numbers: true,          // number auctions + renewal windows close on time
        challenges: true,       // keep challenges running, verify + approve claims
        proposals: true,        // approve series proposals
        autoConfirm: false      // confirm results from drivers' own reports
    },
    TICK_MS: 10 * 60 * 1000,
    MAX_RACES_PER_TICK: 30,
    _cfg: null,
    _running: false,
    _timer: null,

    /* ---------------- settings ---------------- */
    async config(force = false) {
        if (this._cfg && !force) return this._cfg;
        const doc = await DB.get('config', 'director', { force: true }).catch(() => null);
        this._cfg = { ...this.DEFAULTS, ...(doc || {}) };
        return this._cfg;
    },
    async saveConfig(patch) {
        await DB.set('config', 'director', patch);
        DB.invalidate('config');
        this._cfg = null;
        return this.config(true);
    },
    // Quick check used by player-side hooks (instant AI replies).
    async isOn(key) {
        try { const c = await this.config(); return !!(c.enabled && c[key]); } catch (e) { return false; }
    },

    /* ---------------- scheduling the ticks ---------------- */
    // Called on every auth change: GM sessions get a catch-up run now and a
    // heartbeat while the app stays open; everyone else gets nothing.
    onSession() {
        clearInterval(this._timer);
        this._timer = null;
        if (!Auth.isAdmin()) return;
        setTimeout(() => this.tick({ reason: 'login' }).catch(e => console.warn('Director:', e)), 1500);
        this._timer = setInterval(() => this.tick({ reason: 'heartbeat', quiet: true }).catch(() => {}), this.TICK_MS);
    },

    async tick({ reason = 'auto', quiet = false } = {}) {
        if (!Auth.isAdmin() || this._running) return [];
        const cfg = await this.config(true);
        if (!cfg.enabled) return [];
        // Another GM session mid-run? Let it finish (the lease expires on its own).
        if (reason !== 'manual' && cfg.lease && cfg.lease > Date.now()) return [];
        this._running = true;
        const actions = [];
        const act = (icon, text) => actions.push({ icon, text, at: new Date().toISOString() });
        try {
            // First ever run: remember the day, so races already on the calendar
            // before the Director existed are never simulated behind the GM's back.
            if (!cfg.activatedAt) cfg.activatedAt = Util.todayISO();
            await DB.set('config', 'director', { lease: Date.now() + 3 * 60 * 1000, activatedAt: cfg.activatedAt });
            const jobs = [
                ['proposals', 'Series proposals', this._proposals],
                ['recruiting', 'Recruitment', this._recruitment],
                ['fillSeats', 'AI seats', this._fillSeats],
                ['races', 'Races', this._races],
                ['seasons', 'Seasons', this._seasons],
                ['numbers', 'Car numbers', this._numbers],
                ['challenges', 'Challenges', this._challenges]
            ];
            for (const [key, label, fn] of jobs) {
                if (key !== 'races' && key !== 'seasons' && !cfg[key]) continue;
                try { await fn.call(this, cfg, act); } catch (e) { console.warn('Director job failed:', key, e); act('⚠️', `${label}: ${e.message}`); }
            }
        } finally {
            const fresh = await this.config(true).catch(() => cfg);
            const log = [...actions.slice().reverse(), ...(fresh.log || [])].slice(0, 40);
            await DB.set('config', 'director', { lease: 0, lastRun: new Date().toISOString(), log }).catch(() => {});
            this._cfg = null;
            this._running = false;
        }
        if (actions.length && !quiet) {
            Util.notify(`🤖 League Director: ${actions.length === 1 ? actions[0].text : `${actions.length} things handled — see Admin → Overview.`}`, 'info');
        }
        if (actions.length && App.current?.view && ['admin', 'dashboard', 'races', 'standings', 'series-detail'].includes(App.current.view) && !document.querySelector('.modal-overlay')) {
            App.go(App.current.view, App.current.param);
        }
        return actions;
    },

    /* ---------------- helpers ---------------- */
    _iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
    _addDays(iso, n) { const d = Util.parseISODate(iso) || new Date(); d.setDate(d.getDate() + n); return this._iso(d); },
    _daysSince(iso) {
        const d = Util.parseISODate(iso), t = Util.parseISODate(Util.todayISO());
        return d && t ? Math.round((t - d) / 86400000) : -1;
    },
    _raceName(r) { return r.name || r.track || 'a race'; },
    // AI drivers entered in a series (drivers on AI teams in that series).
    aiGridFor(seriesId, world, excludeIds = new Set()) {
        const teamIds = new Set(world.teams.filter(t => t.seriesId === seriesId && !t.ownerUid).map(t => t.id));
        return world.drivers.filter(d => d.teamId && teamIds.has(d.teamId) && !d.ownerUid && !excludeIds.has(d.id));
    },

    /* ---------------- results: AI field + saving ---------------- */
    // Race the AI field around entered results: every human keeps the exact
    // position typed in; AI drivers fill the other places in simulated pace
    // order (a few retire). Grid slots, pole and fastest lap fill in too.
    withAIField(race, results, world) {
        const entered = new Set(results.map(r => r.driverId));
        const ai = this.aiGridFor(race.seriesId, world, entered);
        if (!ai.length) return results;
        const pace = (d) => (typeof Sim !== 'undefined' ? Sim._pace(d) : Number(d.rating) || 75);
        const dnfChance = typeof Sim !== 'undefined' ? Sim.DNF_CHANCE : 0.1;
        const runners = ai.map(d => ({ d, pace: pace(d), q: pace(d), dnf: Math.random() < dnfChance }));
        const aiFinishers = runners.filter(r => !r.dnf).sort((a, b) => b.pace - a.pace);
        const humansIn = results.filter(r => !r.dnf && Number(r.position)).sort((a, b) => a.position - b.position);
        const size = humansIn.length + aiFinishers.length;
        const slots = new Array(size).fill(null);
        humansIn.forEach(h => {
            let p = Math.min(Math.max(1, Number(h.position)), size) - 1;
            while (slots[p] && p < size - 1) p++;
            while (slots[p] && p > 0) p--;
            slots[p] = { human: h };
        });
        let k = 0;
        for (let i = 0; i < size; i++) if (!slots[i]) slots[i] = { ai: aiFinishers[k++] };
        const laps = Number(race.laps) || null;
        // Grid: humans keep any grid slot entered; AI take the rest in qualifying order.
        const takenGrid = new Set(results.map(r => Number(r.start)).filter(Boolean));
        const quali = runners.slice().sort((a, b) => b.q - a.q);
        let g = 1;
        const gridOf = new Map();
        quali.forEach(r => { while (takenGrid.has(g)) g++; gridOf.set(r.d.id, g++); });

        const out = [];
        slots.forEach((s, i) => {
            if (s.human) { out.push({ ...s.human, position: i + 1 }); return; }
            const r = s.ai;
            out.push({ driverId: r.d.id, position: i + 1, dnf: false, start: gridOf.get(r.d.id), pole: false, fastestLap: false,
                incidents: Math.random() < 0.6 ? 0 : 1 + Math.floor(Math.random() * 2), lapsLed: 0, lapsCompleted: laps, aiFilled: true });
        });
        results.filter(r => r.dnf || !Number(r.position)).forEach(r => out.push({ ...r }));
        runners.filter(r => r.dnf).forEach(r => out.push({ driverId: r.d.id, position: null, dnf: true, start: gridOf.get(r.d.id), pole: false, fastestLap: false,
            incidents: 1 + Math.floor(Math.random() * 3), lapsLed: 0, lapsCompleted: laps ? Math.floor(laps * Math.random() * 0.9) : null, aiFilled: true }));
        // Pole / fastest lap / laps led only fill in when the GM left them empty.
        if (!out.some(r => r.pole)) { const p = out.find(r => Number(r.start) === 1); if (p) p.pole = true; }
        if (!out.some(r => r.fastestLap)) {
            const pool = out.filter(r => r.aiFilled && !r.dnf).slice(0, 6);
            if (pool.length) pool[Math.floor(Math.random() * pool.length)].fastestLap = true;
        }
        if (laps && !out.some(r => Number(r.lapsLed) > 0) && out[0]?.aiFilled) out[0].lapsLed = Math.max(1, Math.round(laps * 0.45));
        return out;
    },

    // The one way results get saved (GM form, driver-report confirmation).
    // Payouts, prestige and number fielding run on the first save only.
    async saveResults(race, results, world, { note = null } = {}) {
        const wasCompleted = race.status === 'completed';
        await DB.update('races', race.id, { status: 'completed', results, ...(note ? { resultsNote: note } : {}) });
        const winner = results.find(r => Number(r.position) === 1 && !r.dnf);
        const winnerName = winner ? world.driversById[winner.driverId]?.name : null;
        if (winnerName && !wasCompleted) News.post('🏆', `${winnerName} wins ${this._raceName(race)}!`);
        if (!wasCompleted) {
            await Sim.payoutRace({ ...race, results }, world);
            await Prestige.awardRaceXP({ ...race, results }, world);
        }
        return { winnerName, wasCompleted };
    },

    /* ---------------- job: series proposals ---------------- */
    async _proposals(cfg, act) {
        for (const s of (await DB.series({ force: true })).filter(s => s.status === 'proposed')) {
            await DB.update('series', s.id, { status: 'active' });
            News.post('🏆', `New championship approved: ${s.name}`);
            act('🏆', `Approved the series proposal "${s.name}"`);
        }
    },

    /* ---------------- job: recruitment ---------------- */
    async _recruitment(cfg, act) {
        const recs = await DB.recruitment({ force: true }).catch(() => []);
        for (const app of recs.filter(r => r.kind === 'application' && r.status === 'pending' && !r.ownerUid)) {
            const r = await this.answerApplication(app);
            if (r) act('🤖', r);
        }
        for (const req of recs.filter(r => r.kind === 'release-request' && r.status === 'pending' && !r.ownerUid)) {
            await Hub._freeDriver(req.driverId, req.driverUid, 'released', req.contractId || null);
            await DB.update('recruitment', req.id, { status: 'accepted' });
            News.post('👋', `${req.driverName} released by ${req.teamName}: the principal waived the buyout`);
            act('👋', `${req.teamName} released ${req.driverName}`);
        }
    },

    // An unowned team's principal answers one application: an opening offer
    // in the applicant's deal room, or a polite no if the move isn't possible.
    async answerApplication(app, { auto = false } = {}) {
        try {
            if (app.driverId && app.driverUid) {
                const n = await Deals.aiPrincipalOffer(app.id, { auto });
                return `${n.teamName}'s principal offered ${n.personName} ${Economy.fmt(n.salary)}/race`;
            }
            if (app.profileId && app.applicantUid) {
                const n = await this.aiStaffOffer(app);
                return `${n.teamName}'s principal offered ${n.personName} ${Economy.fmt(n.salary)}/race`;
            }
        } catch (e) {
            await DB.update('recruitment', app.id, { status: 'declined', note: e.message }).catch(() => {});
            return `${app.teamName} turned down ${app.driverName || app.applicantName}: ${e.message}`;
        }
        return null;
    },

    // Same as Deals.aiPrincipalOffer, for crew (crew chief / mechanic…) applying to an AI team.
    async aiStaffOffer(app) {
        const profile = await DB.get('roleProfiles', app.profileId);
        if (!profile) throw new Error('That profile no longer exists.');
        if (profile.teamId) throw new Error('They already work for a team.');
        const stars = Prestige.stored(profile);
        const cap = Economy.payCap(stars);
        const salary = Math.max(10, Math.min(Math.round(Market.askingFor(profile, 'staff', stars) / 10) * 10, cap));
        await Parity.assertAICanBid(app.teamId, salary);
        const principal = `${app.teamName} — Team Principal`;
        const neg = {
            kind: 'team-staff', status: 'open', contractId: null,
            teamId: app.teamId, teamName: app.teamName, ownerUid: null,
            personId: app.profileId, roleProfileId: app.profileId, personKind: 'staff', personName: app.applicantName, personUid: app.applicantUid,
            sponsorProfileId: null, sponsorName: '', sponsorUid: null,
            targetDriverId: null, targetDriverName: '', targetDriverUid: null,
            salary, buyout: Hub.buyoutFor(salary), exclusive: false,
            sideAUid: null, sideBUid: app.applicantUid, initiatorUid: null, turnUid: app.applicantUid,
            capStars: stars, capAmount: cap,
            history: [{ byUid: null, byName: principal, action: 'offer', salary, note: Deals._principalLine('offer', salary), at: Util.todayISO() }]
        };
        neg.state = Deals.stateFor(neg);
        neg.negotiationHistory = [Deals._historyEntry(neg, { byUid: null, byName: principal, action: 'offer' })];
        await DB.create('negotiations', neg);
        await DB.update('recruitment', app.id, { status: 'accepted' });
        News.post('🤖', `${app.teamName}'s team principal opened contract talks with ${app.applicantName}`);
        return neg;
    },

    // Player-side hook: right after someone applies to an AI team, the
    // principal answers on the spot (no waiting for a Game Master).
    async answerMyApplicationsNow() {
        if (!Auth.uid() || !(await this.isOn('recruiting'))) return 0;
        const uid = Auth.uid();
        const mine = (await DB.recruitment({ force: true }).catch(() => []))
            .filter(r => r.kind === 'application' && r.status === 'pending' && !r.ownerUid && (r.driverUid === uid || r.applicantUid === uid));
        let n = 0;
        for (const app of mine) { if (await this.answerApplication(app, { auto: true })) n++; }
        return n;
    },

    /* ---------------- job: keep AI seats filled ---------------- */
    async _fillSeats(cfg, act) {
        const world = await DB.loadWorld(true);
        const usedNames = new Set(world.drivers.map(d => d.name));
        const freeAgents = world.drivers.filter(d => !d.teamId && !d.ownerUid && d.isNPC)
            .sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
        for (const t of world.teams.filter(t => t.isNPC && !t.ownerUid && t.seriesId)) {
            const roster = world.drivers.filter(d => d.teamId === t.id);
            for (let i = roster.length; i < 2; i++) {
                const fa = freeAgents.shift();
                if (fa) {
                    await DB.update('drivers', fa.id, { teamId: t.id, seriesId: t.seriesId });
                    News.post('✍️', `${t.name} signs ${fa.name} for the open seat`);
                    act('✍️', `${t.name} signed free agent ${fa.name}`);
                } else if (typeof makeNpcDriver === 'function') {
                    const d = { ...makeNpcDriver(usedNames, t.id), seriesId: t.seriesId };
                    await DB.create('drivers', d);
                    News.post('🌱', `${t.name} promotes ${d.name} from their junior programme`);
                    act('🌱', `${t.name} promoted rookie ${d.name} into the empty seat`);
                }
            }
        }
    },

    /* ---------------- job: races ---------------- */
    async _races(cfg, act) {
        if (!cfg.simAiRaces && !cfg.autoConfirm) return;
        const world = await DB.loadWorld(true);
        const signups = await DB.signups({ force: true }).catch(() => []);
        const due = world.races
            .filter(r => r.status !== 'completed' && r.status !== 'cancelled' && r.date && this._daysSince(r.date) >= Math.max(1, Number(cfg.graceDays) || 0)
                && (!cfg.activatedAt || r.date >= cfg.activatedAt))
            .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (Number(a.round) || 0) - (Number(b.round) || 0))
            .slice(0, this.MAX_RACES_PER_TICK);
        for (const race of due) {
            const entries = signups.filter(s => s.raceId === race.id);
            if (entries.length) {
                // Humans raced: the GM enters results, unless every driver has
                // reported and the GM switched on auto-confirm.
                if (!cfg.autoConfirm || !entries.every(s => s.report)) continue;
                const results = entries.map(s => ({
                    driverId: s.driverId, position: s.report.dnf ? null : Number(s.report.position) || null, dnf: !!s.report.dnf,
                    start: s.report.start ?? null, incidents: s.report.incidents ?? null, lapsLed: s.report.lapsLed ?? null,
                    wrecks: s.report.wrecks ?? null, fastestLap: !!s.report.fastestLap, pole: Number(s.report.start) === 1
                }));
                const pos = results.filter(r => r.position).map(r => r.position);
                if (new Set(pos).size !== pos.length) { act('⚠️', `${this._raceName(race)}: two drivers reported the same position, so it's waiting for you`); continue; }
                const full = cfg.aiFill ? this.withAIField(race, results, world) : results;
                const { winnerName } = await this.saveResults(race, full, world, { note: 'Confirmed from driver reports' });
                act('✅', `Confirmed ${this._raceName(race)} from ${entries.length} driver report${entries.length === 1 ? '' : 's'}${winnerName ? ` — ${winnerName} wins` : ''}`);
                continue;
            }
            if (!cfg.simAiRaces) continue;
            const grid = this.aiGridFor(race.seriesId, world);
            if (grid.length >= 2) {
                const r = await Sim.simulateRace(race.id, { quiet: true });
                act('🏁', `Simulated ${this._raceName(race)} (no entries) — ${r?.winner?.name || 'AI'} wins`);
            } else {
                await DB.update('races', race.id, { status: 'cancelled', cancelReason: 'Nobody entered and the series has no AI field' });
                act('🚫', `Cancelled ${this._raceName(race)}: nobody entered and the series has no AI field`);
            }
        }
    },

    /* ---------------- job: seasons ---------------- */
    async _seasons(cfg, act) {
        if (!cfg.seasons && !cfg.autoSchedule) return;
        let world = await DB.loadWorld(true);
        for (const s of world.series.filter(s => (s.status || 'active') === 'active')) {
            const races = world.races.filter(r => r.seriesId === s.id);
            if (cfg.seasons) {
                for (const se of world.seasons.filter(se => se.seriesId === s.id && se.status !== 'completed')) {
                    const sr = races.filter(r => r.seasonId === se.id);
                    if (!sr.length || !sr.every(r => r.status === 'completed' || r.status === 'cancelled')) continue;
                    const { champName } = await Admin.closeSeasonCore(se.id, s.id);
                    act('🏆', `${se.name} is over${champName ? ` — ${champName} is champion` : ''}`);
                }
            }
            if (!cfg.autoSchedule) continue;
            if (races.some(r => r.status !== 'completed' && r.status !== 'cancelled')) continue;
            // Only series that can actually race: an AI field, or humans have raced it before.
            const canRace = this.aiGridFor(s.id, world).length >= 2 || races.some(r => r.status === 'completed' && (r.results || []).some(x => world.driversById[x.driverId]?.ownerUid));
            if (!canRace) continue;
            world = await DB.loadWorld(true);
            const made = await this.scheduleSeason(s, world, cfg);
            if (made) act('📅', `Scheduled ${made.name}: ${made.rounds} rounds from ${Util.fmtDateShort(made.start)}`);
        }
    },

    // Next race day on or after `fromIso` (raceDay 0 = Sunday … 6 = Saturday).
    _nextRaceDay(fromIso, raceDay) {
        const d = Util.parseISODate(fromIso) || new Date();
        const want = Number.isInteger(Number(raceDay)) ? Number(raceDay) : 6;
        while (d.getDay() !== want) d.setDate(d.getDate() + 1);
        return this._iso(d);
    },

    async scheduleSeason(series, world, cfg = null) {
        cfg = cfg || await this.config();
        const game = world.gamesById[series.gameId];
        const lg = window.Library ? Library.libGameFor(game) || (series.libraryGame && SC.game(series.libraryGame)) : null;
        const sd = window.Library ? Library.libSeriesFor(series, game) : null;
        const past = world.races.filter(r => r.seriesId === series.id)
            .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (Number(a.round) || 0) - (Number(b.round) || 0));
        let lines = [];
        if (sd && lg) lines = Library.calendarLines(lg, sd, Number(cfg.lengthPct) || 0.5);
        if (!lines.length && past.length) {
            // Re-run the most recent season's calendar.
            const lastSeason = past[past.length - 1].seasonId || null;
            lines = past.filter(r => (r.seasonId || null) === lastSeason).map(r => r.laps ? `${r.track} | ${r.laps}` : r.track).filter(Boolean);
        }
        if (!lines.length && series.gameId) {
            const tracks = (await DB.tracks({ force: true }).catch(() => [])).filter(t => t.gameId === series.gameId).map(t => t.name);
            lines = tracks.slice(0, 10);
        }
        if (!lines.length) return null;
        const seasons = world.seasons.filter(se => se.seriesId === series.id);
        const lastYear = Math.max(0, ...seasons.map(se => Number(se.year) || 0));
        const year = lastYear ? lastYear + 1 : (Number(series.season) || new Date().getFullYear());
        const lastDate = past.length ? past[past.length - 1].date : null;
        const from = [this._addDays(Util.todayISO(), 1), lastDate ? this._addDays(lastDate, 1) : null].filter(Boolean).sort().pop();
        const start = this._nextRaceDay(from, cfg.raceDay);
        const name = `${series.name} ${year}`;
        const seasonId = await DB.create('seasons', {
            seriesId: series.id, gameId: series.gameId || null, name, year,
            status: 'active', startDate: start, endDate: null,
            ownerUid: null, championDriverId: null, championTeamId: null, scheduledBy: 'director'
        });
        const races = generateScheduleRaces({
            series, seasonId, cadence: cfg.cadence || 'weekly', startDate: start, time: cfg.raceTime || '20:00',
            tracks: lines, laps: null, carChoices: series.carChoices || []
        });
        await DB.batchCreate('races', races);
        await DB.update('series', series.id, { season: year });
        News.post('📅', `${name} schedule is out: ${races.length} rounds, starting ${Util.fmtDate(start)} at ${races[0].track}`);
        return { name, rounds: races.length, start, seasonId };
    },

    /* ---------------- job: car numbers ---------------- */
    async _numbers(cfg, act) {
        const today = Util.todayISO();
        const regs = await DB.list('numberRegistry', { force: true }).catch(() => []);
        for (const r of regs) {
            if (r.status === 'auction') {
                if (!r.closesAt) { await DB.set('numberRegistry', r.id, { closesAt: this._addDays(today, Numbers.AUCTION_DAYS) }); continue; }
                if (r.closesAt > today) continue;
                const bid = await Numbers.resolveAuction(r.seriesId, r.number);
                act('🔢', bid ? `#${r.number} auction closed: won for ${Economy.fmt(bid.amount)}` : `#${r.number} auction closed with no bids`);
            } else if (r.status === 'renewal') {
                if (!r.renewalUntil) { await DB.set('numberRegistry', r.id, { renewalUntil: this._addDays(today, Numbers.RENEWAL_DAYS) }); continue; }
                if (r.renewalUntil > today) continue;
                await Numbers.openAuction(r.seriesId, r.number, r.seasonId || null);
                act('🔢', `#${r.number} wasn't renewed, so it's up for auction`);
            }
        }
    },

    /* ---------------- job: challenges ---------------- */
    // Challenges the Director can check against race results.
    CHECK_BY_TITLE: {
        'Podium Push': 'podium', 'Clean Sweep': 'clean', 'Qualifying Ace': 'pole', 'Iron Driver': 'iron',
        'Charge Through the Field': 'gain5', 'Fastest Lap Hunter': 'fl', 'New Frontier': 'newgame',
        'Team Stack': 'teamstack', 'Full Grid Night': 'fullgrid'
    },
    CLAIM_GRACE_DAYS: 2,

    _verify(check, uid, ch, world) {
        const mine = new Set(world.drivers.filter(d => d.ownerUid === uid).map(d => d.id));
        if (!mine.size) return false;
        const inWin = (r) => r.status === 'completed' && r.date && (!ch.startDate || r.date >= ch.startDate) && (!ch.endDate || r.date <= ch.endDate);
        const races = world.races.filter(inWin);
        const rows = races.flatMap(r => (r.results || []).filter(x => mine.has(x.driverId)).map(x => ({ r, x })));
        const pos = (x) => Number(x.position) || 0;
        switch (check) {
            case 'podium': return rows.some(({ x }) => !x.dnf && pos(x) >= 1 && pos(x) <= 3);
            case 'clean': return rows.some(({ x }) => !x.dnf && x.incidents !== undefined && x.incidents !== null && Number(x.incidents) === 0);
            case 'pole': return rows.some(({ x }) => x.pole);
            case 'fl': return rows.some(({ x }) => x.fastestLap);
            case 'gain5': return rows.some(({ x }) => !x.dnf && Number(x.start) && pos(x) && Number(x.start) - pos(x) >= 5);
            case 'iron': return rows.length >= 2 && rows.every(({ x }) => !x.dnf);
            case 'newgame': {
                const before = new Set(world.races.filter(r => r.status === 'completed' && ch.startDate && r.date < ch.startDate && (r.results || []).some(x => mine.has(x.driverId))).map(r => r.gameId));
                return rows.some(({ r }) => r.gameId && !before.has(r.gameId));
            }
            case 'teamstack': return rows.some(({ r, x }) => {
                const d = world.driversById[x.driverId];
                if (!d?.teamId || x.dnf || pos(x) > 5 || !pos(x)) return false;
                return (r.results || []).some(y => y.driverId !== x.driverId && !y.dnf && Number(y.position) && Number(y.position) <= 5 && world.driversById[y.driverId]?.teamId === d.teamId);
            });
            case 'fullgrid': return rows.some(({ r }) => (r.results || []).filter(y => world.driversById[y.driverId]?.ownerUid).length >= 8);
            default: return false;
        }
    },

    async _challenges(cfg, act) {
        const today = Util.todayISO();
        const [challenges, claims, world, users] = await Promise.all([
            DB.challenges({ force: true }).catch(() => []), DB.claims({ force: true }).catch(() => []),
            DB.loadWorld(true), DB.users({ force: true }).catch(() => [])
        ]);
        const live = challenges.filter(c => c.status === 'active' && (!c.endDate || c.endDate >= today));
        // 1. Keep a weekly set running.
        if (!live.length) {
            const tracks = [...new Set(world.races.filter(r => r.status !== 'completed' && r.date >= today).map(r => r.track).filter(Boolean))];
            const items = generateChallenges({ cadence: 'weekly', count: 4, tracks, games: world.games });
            await DB.batchCreate('challenges', items);
            act('🎯', `Posted ${items.length} new weekly challenges`);
        }
        // 2. Verify measurable challenges from results, approve/deny claims.
        const players = users.filter(u => u.id && world.drivers.some(d => d.ownerUid === u.id));
        const nameOf = (uid) => users.find(u => u.id === uid)?.displayName || world.drivers.find(d => d.ownerUid === uid)?.name || 'Player';
        for (const ch of challenges.filter(c => c.status === 'active')) {
            const check = ch.check || this.CHECK_BY_TITLE[ch.title] || null;
            const chClaims = claims.filter(c => c.challengeId === ch.id);
            const ended = ch.endDate && ch.endDate < today;
            if (check) {
                for (const u of players) {
                    if (!this._verify(check, u.id, ch, world)) continue;
                    const existing = chClaims.find(c => c.uid === u.id);
                    if (!existing) {
                        await DB.create('challengeClaims', { challengeId: ch.id, uid: u.id, playerName: nameOf(u.id), note: 'Verified from race results', status: 'approved', auto: true, reviewedAt: today });
                        act('🎯', `${nameOf(u.id)} completed "${ch.title}"`);
                    } else if (existing.status === 'pending') {
                        await DB.update('challengeClaims', existing.id, { status: 'approved', reviewedAt: today, auto: true });
                        act('🎯', `Approved ${existing.playerName}'s "${ch.title}" claim (verified from results)`);
                    }
                }
                if (ended) {
                    for (const c of chClaims.filter(c => c.status === 'pending' && !this._verify(check, c.uid, ch, world))) {
                        await DB.update('challengeClaims', c.id, { status: 'rejected', reviewedAt: today, auto: true, reviewNote: 'Not found in the race results for that period' });
                        act('🎯', `Declined ${c.playerName}'s "${ch.title}" claim: not in the results`);
                    }
                }
            } else {
                // Can't be checked from results (lap times, coaching, lobbies): trust the claim after a short wait.
                for (const c of chClaims.filter(c => c.status === 'pending')) {
                    const made = c.createdAt?.toDate ? this._iso(c.createdAt.toDate()) : (c.createdAt?.seconds ? this._iso(new Date(c.createdAt.seconds * 1000)) : today);
                    if (this._daysSince(made) < this.CLAIM_GRACE_DAYS) continue;
                    await DB.update('challengeClaims', c.id, { status: 'approved', reviewedAt: today, auto: true });
                    act('🎯', `Approved ${c.playerName}'s "${ch.title}" claim`);
                }
            }
            if (ended) await DB.update('challenges', ch.id, { status: 'expired' });
        }
    },

    /* ---------------- Admin → Overview panel ---------------- */
    SWITCHES: [
        ['simAiRaces', 'Simulate races nobody entered', 'Runs them with the AI field a couple of days after race day; cancels them if the series has no AI. Races dated before the Director was switched on are left for you.'],
        ['aiFill', 'Race the AI field around your results', 'You enter the human results; AI drivers fill the other places so the whole championship moves.'],
        ['seasons', 'Close seasons and crown champions', 'When every round is done: champions, title bonuses, car-number rollover.'],
        ['autoSchedule', 'Schedule the next season', 'Real calendar for library series, otherwise last season\'s tracks, on your race day.'],
        ['recruiting', 'AI principals answer applications', 'Drivers and crew applying to AI teams get an offer in their deal room right away; release requests are granted.'],
        ['fillSeats', 'Keep AI teams\' seats filled', 'Empty AI seats go to the best free agent (or a new rookie).'],
        ['numbers', 'Run car-number auctions', 'Auctions close after 3 days, renewal windows after 7.'],
        ['challenges', 'Run challenges', 'Posts weekly challenges, checks them against race results, approves the rest after 2 days.'],
        ['proposals', 'Approve series proposals', 'Championships proposed by Series Owners go live straight away.'],
        ['autoConfirm', 'Confirm results from driver reports', 'When every entered driver has reported, the results save themselves (you can still edit them).']
    ],

    async panelHtml() {
        const c = await this.config(true);
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const when = c.lastRun ? new Date(c.lastRun).toLocaleString() : 'not yet';
        return `<section class="panel director-panel">
            <div class="panel-head"><h2>🤖 League Director</h2>
                <div class="btn-row">
                    <span class="badge ${c.enabled ? 'badge-green' : 'badge-dim'}">${c.enabled ? 'Running the league' : 'Off'}</span>
                    <button class="btn btn-secondary btn-sm" id="dir-run">▶ Run now</button>
                </div></div>
            <p class="muted small">The Director does the Game Master's routine work whenever a GM has the app open (on sign-in, after you save results, and every 10 minutes). All you need to do is enter race results. Last run: ${Util.esc(when)}.</p>
            <label class="check dir-master"><input type="checkbox" id="dir-enabled" ${c.enabled ? 'checked' : ''}> <strong>Let the Director run the league</strong></label>
            <div class="dir-switches">${this.SWITCHES.map(([k, label, desc]) => `
                <label class="check dir-switch"><input type="checkbox" data-dir="${k}" ${c[k] ? 'checked' : ''}>
                    <span><strong>${Util.esc(label)}</strong><span class="muted small">${Util.esc(desc)}</span></span></label>`).join('')}</div>
            <div class="form-row">
                <label class="field"><span>New seasons race</span><select id="dir-cadence" class="input">
                    ${[['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Monthly']].map(([v, l]) => `<option value="${v}" ${c.cadence === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
                <label class="field"><span>On</span><select id="dir-day" class="input">${days.map((d, i) => `<option value="${i}" ${Number(c.raceDay) === i ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
                <label class="field"><span>At</span><input id="dir-time" class="input" type="time" value="${Util.esc(c.raceTime || '20:00')}"></label>
                <label class="field"><span>Race length (library calendars)</span><select id="dir-len" class="input">
                    ${[[1, 'Full distance'], [0.75, '75%'], [0.5, '50%'], [0.33, '33%'], [0.25, '25%'], [0.1, '10%']].map(([v, l]) => `<option value="${v}" ${Number(c.lengthPct) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
                <label class="field"><span>Simulate unentered races after</span><select id="dir-grace" class="input">
                    ${[1, 2, 3, 5, 7].map(v => `<option value="${v}" ${Number(c.graceDays) === v ? 'selected' : ''}>${v} day${v > 1 ? 's' : ''}</option>`).join('')}</select></label>
            </div>
            <div class="btn-row"><button class="btn btn-primary btn-sm" id="dir-save">Save Director settings</button></div>
            <h3 class="section-label" style="margin-top:1rem">Recent activity</h3>
            ${(c.log || []).length ? `<div class="dir-log">${c.log.slice(0, 15).map(l => `<div class="dir-log-row"><span>${l.icon}</span><span>${Util.esc(l.text)}</span><span class="muted small">${Util.esc(new Date(l.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</span></div>`).join('')}</div>`
                : '<p class="muted small">Nothing yet. The Director logs everything it does here.</p>'}
        </section>`;
    },

    wirePanel(el) {
        const read = () => {
            const patch = { enabled: Util.$('#dir-enabled', el).checked };
            Util.$$('[data-dir]', el).forEach(i => { patch[i.dataset.dir] = i.checked; });
            patch.cadence = Util.$('#dir-cadence', el).value;
            patch.raceDay = Number(Util.$('#dir-day', el).value);
            patch.raceTime = Util.$('#dir-time', el).value || '20:00';
            patch.lengthPct = Number(Util.$('#dir-len', el).value);
            patch.graceDays = Number(Util.$('#dir-grace', el).value);
            return patch;
        };
        Util.$('#dir-save', el)?.addEventListener('click', async () => {
            try {
                await this.saveConfig(read());
                Util.notify('Director settings saved. 🤖');
                this.onSession();
                Admin.refresh();
            } catch (e) { Util.notify(e.message, 'error'); }
        });
        Util.$('#dir-run', el)?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true; btn.textContent = 'Running…';
            try {
                await this.saveConfig(read());
                const done = await this.tick({ reason: 'manual', quiet: true });
                Util.notify(done.length ? `🤖 The Director handled ${done.length} thing${done.length === 1 ? '' : 's'}.` : '🤖 Nothing due right now: the league is up to date.', 'info');
                Admin.refresh();
            } catch (err) { Util.notify(err.message, 'error'); btn.disabled = false; btn.textContent = '▶ Run now'; }
        });
    }
};
window.Director = Director;
