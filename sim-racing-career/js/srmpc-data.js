/* ============================================================
   Phoenix SRMPC — Data layer
   Firestore CRUD, points systems, standings & stats computed
   LIVE from race results (no stored aggregates → no drift),
   schedule generator, challenge templates.
   ============================================================ */
'use strict';

/* ---------------- Points systems ---------------- */
const POINTS_SYSTEMS = {
    f1: {
        label: 'Formula 1 (25-18-15…)',
        points: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
        fastestLapBonus: 1, poleBonus: 0
    },
    motogp: {
        label: 'MotoGP (25-20-16…)',
        points: [25, 20, 16, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
        fastestLapBonus: 0, poleBonus: 0
    },
    indycar: {
        label: 'IndyCar (50-40-35…)',
        points: [50, 40, 35, 32, 30, 28, 26, 24, 22, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5],
        fastestLapBonus: 0, poleBonus: 1
    },
    nascar: {
        label: 'NASCAR-style (40-35-34…)',
        points: [40, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
        fastestLapBonus: 0, poleBonus: 0
    },
    linear: {
        label: 'Simple (10-9-8…1)',
        points: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
        fastestLapBonus: 0, poleBonus: 0
    },
    custom: { label: 'Custom', points: [], fastestLapBonus: 0, poleBonus: 0 }
};

function pointsForResult(result, series) {
    if (!result) return 0;
    const systemId = series?.pointsSystem || 'f1';
    const system = POINTS_SYSTEMS[systemId] || POINTS_SYSTEMS.f1;

    // A DNF scores no finishing points, but pole / fastest-lap bonuses still
    // count if the league's points system awards them (matches real series).
    if (result.dnf) {
        let bonus = 0;
        if (result.fastestLap && system.fastestLapBonus) bonus += system.fastestLapBonus;
        if (result.pole && system.poleBonus) bonus += system.poleBonus;
        return bonus;
    }

    const table = (systemId === 'custom' && Array.isArray(series?.customPoints) && series.customPoints.length)
        ? series.customPoints
        : system.points;
    const idx = Number(result.position) - 1;
    let pts = (idx >= 0 && idx < table.length) ? Number(table[idx]) || 0 : 0;
    if (result.fastestLap && system.fastestLapBonus) pts += system.fastestLapBonus;
    if (result.pole && system.poleBonus) pts += system.poleBonus;
    return pts;
}

/* ---------------- Firestore CRUD with a light cache ---------------- */
const DB = {
    _cache: {},

    _fs() {
        if (!SRMPC.db) {
            throw new Error('Database is not connected. Check your internet connection and reload.'
                + (SRMPC.firebaseError ? ` (${SRMPC.firebaseError.message})` : ''));
        }
        return SRMPC.db;
    },

    // Logical → physical collection name for the ACTIVE career. Everything in
    // the app routes through here, so career isolation is transparent to callers
    // (see Careers in js/srmpc-core.js). Falls back to the raw name if Careers
    // is somehow unavailable (e.g. the verify harness before it loads).
    _phys(collection) { return window.Careers ? Careers.collName(collection) : collection; },
    _c(collection) { return this._fs().collection(this._phys(collection)); },

    // Cache is keyed by PHYSICAL name so two careers never share cached rows.
    invalidate(collection) {
        if (collection) delete this._cache[this._phys(collection)];
        else this._cache = {};
    },

    async list(collection, { force = false } = {}) {
        const key = this._phys(collection);
        if (!force && this._cache[key]) return this._cache[key];
        const snap = await this._fs().collection(key).get();
        const docs = [];
        snap.forEach(d => docs.push({ id: d.id, ...d.data() }));
        this._cache[key] = docs;
        return docs;
    },

    async get(collection, id, { force = false } = {}) {
        if (!force) {
            const cached = this._cache[this._phys(collection)]?.find(d => d.id === id);
            if (cached) return cached;
        }
        const snap = await this._c(collection).doc(id).get();
        return snap.exists ? { id: snap.id, ...snap.data() } : null;
    },

    async create(collection, data) {
        const ref = await this._c(collection).add({
            ...data,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        this.invalidate(collection);
        return ref.id;
    },

    async update(collection, id, patch) {
        await this._c(collection).doc(id).update({
            ...patch,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        this.invalidate(collection);
    },

    async remove(collection, id) {
        await this._c(collection).doc(id).delete();
        this.invalidate(collection);
    },

    // Patch many docs in one write batch (used for prestige XP payouts).
    async batchUpdate(collection, updates) {
        if (!updates.length) return;
        const fs = this._fs();
        const phys = this._phys(collection);
        const batch = fs.batch();
        updates.forEach(({ id, patch }) => {
            batch.update(fs.collection(phys).doc(id), {
                ...patch,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });
        await batch.commit();
        this.invalidate(collection);
    },

    // Atomic read-then-write across one or more documents — used by
    // Wallet.executeRoleTransaction so a wallet transfer's debit, credit,
    // and paired ledger rows commit together or not at all.
    async runTransaction(fn) {
        const result = await this._fs().runTransaction(fn);
        this._cache = {};
        return result;
    },

    async batchCreate(collection, items) {
        const fs = this._fs();
        const phys = this._phys(collection);
        const batch = fs.batch();
        items.forEach(item => {
            const ref = fs.collection(phys).doc();
            batch.set(ref, {
                ...item,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });
        await batch.commit();
        this.invalidate(collection);
    },

    // Every collection that makes up one career's world. Used by wipeCareer and
    // the Settings backup export.
    WORLD_COLLECTIONS: [
        'games', 'series', 'seasons', 'races', 'teams', 'drivers', 'users',
        'challenges', 'challengeClaims', 'raceSignups', 'roleProfiles', 'staff',
        'contracts', 'tracks', 'sponsors', 'news', 'recruitment',
        'negotiations', 'ledger'
    ],

    // Delete every document in a career's world (all WORLD_COLLECTIONS), in
    // batched chunks. Does NOT touch Firebase Auth accounts, the global
    // config/admin GM registry, or the careers registry doc — so a reset clears
    // the world while players keep their logins and the career shell survives.
    // Targets a SPECIFIC career id (not necessarily the active one).
    async wipeCareer(id) {
        const fs = this._fs();
        let deleted = 0;
        for (const logical of this.WORLD_COLLECTIONS) {
            const phys = Careers.collNameFor(id, logical);
            const snap = await fs.collection(phys).get();
            const ids = [];
            snap.forEach(d => ids.push(d.id));
            for (let i = 0; i < ids.length; i += 450) {
                const batch = fs.batch();
                ids.slice(i, i + 450).forEach(docId => batch.delete(fs.collection(phys).doc(docId)));
                await batch.commit();
            }
            deleted += ids.length;
        }
        this.invalidate();
        return deleted;
    },

    /* --- convenience loaders used all over the UI --- */
    games(opts) { return this.list('games', opts); },
    series(opts) { return this.list('series', opts); },
    seasons(opts) { return this.list('seasons', opts); },
    races(opts) { return this.list('races', opts); },
    teams(opts) { return this.list('teams', opts); },
    drivers(opts) { return this.list('drivers', opts); },
    users(opts) { return this.list('users', opts); },
    challenges(opts) { return this.list('challenges', opts); },
    claims(opts) { return this.list('challengeClaims', opts); },
    signups(opts) { return this.list('raceSignups', opts); },
    roleProfiles(opts) { return this.list('roleProfiles', opts); },
    staff(opts) { return this.list('staff', opts); },
    contracts(opts) { return this.list('contracts', opts); },
    news(opts) { return this.list('news', opts); },
    recruitment(opts) { return this.list('recruitment', opts); },
    tracks(opts) { return this.list('tracks', opts); },
    sponsors(opts) { return this.list('sponsors', opts); },

    // Everything most views need, in one parallel load.
    async loadWorld(force = false) {
        const [games, series, races, teams, drivers, seasons] = await Promise.all([
            this.games({ force }), this.series({ force }), this.races({ force }),
            this.teams({ force }), this.drivers({ force }), this.seasons({ force }).catch(() => [])
        ]);
        return {
            games, series, races, teams, drivers, seasons,
            gamesById: Object.fromEntries(games.map(g => [g.id, g])),
            seriesById: Object.fromEntries(series.map(s => [s.id, s])),
            seasonsById: Object.fromEntries(seasons.map(s => [s.id, s])),
            teamsById: Object.fromEntries(teams.map(t => [t.id, t])),
            driversById: Object.fromEntries(drivers.map(d => [d.id, d]))
        };
    }
};
window.DB = DB;
window.POINTS_SYSTEMS = POINTS_SYSTEMS;
window.pointsForResult = pointsForResult;

/* ============================================================
   Stats engine — everything derived live from race results.
   A race doc looks like:
   { seriesId, gameId, name, track, date:'YYYY-MM-DD', time:'HH:MM',
     laps, status:'scheduled'|'completed',
     results: [{ driverId, position, dnf, pole, fastestLap }] }
   Points are always recomputed from the series points system, so
   changing a points system retroactively fixes every standing.
   ============================================================ */
const Stats = {
    // How many drivers per team count toward constructor points.
    CONSTRUCTOR_CAP: 2,

    completedRaces(races, { seriesId = null, gameId = null, seasonId = null } = {}) {
        return races.filter(r =>
            r.status === 'completed' &&
            Array.isArray(r.results) && r.results.length &&
            (!seriesId || r.seriesId === seriesId) &&
            (!gameId || r.gameId === gameId) &&
            (!seasonId || r.seasonId === seasonId)
        );
    },

    // Per-driver aggregate over a set of races.
    driverTable(races, world, filter = {}) {
        const completed = this.completedRaces(races, filter);
        const rows = new Map();

        for (const race of completed) {
            const series = world.seriesById[race.seriesId] || null;
            for (const res of race.results) {
                if (!res.driverId) continue;
                let row = rows.get(res.driverId);
                if (!row) {
                    const driver = world.driversById[res.driverId];
                    row = {
                        driverId: res.driverId,
                        driver: driver || { name: res.driverName || 'Unknown driver', teamId: null },
                        starts: 0, wins: 0, podiums: 0, top5: 0, poles: 0,
                        fastestLaps: 0, dnfs: 0, points: 0,
                        bestFinish: null, finishSum: 0, finishCount: 0
                    };
                    rows.set(res.driverId, row);
                }
                row.starts += 1;
                const pos = Number(res.position) || null;
                if (res.dnf) {
                    row.dnfs += 1;
                } else if (pos) {
                    if (pos === 1) row.wins += 1;
                    if (pos <= 3) row.podiums += 1;
                    if (pos <= 5) row.top5 += 1;
                    row.finishSum += pos;
                    row.finishCount += 1;
                    if (row.bestFinish === null || pos < row.bestFinish) row.bestFinish = pos;
                }
                if (res.pole) row.poles += 1;
                if (res.fastestLap) row.fastestLaps += 1;
                row.points += pointsForResult(res, series);
            }
        }

        const list = Array.from(rows.values());
        list.forEach(r => {
            r.avgFinish = r.finishCount ? (r.finishSum / r.finishCount) : null;
            r.winPct = r.starts ? (r.wins / r.starts * 100) : 0;
        });
        list.sort((a, b) => b.points - a.points || b.wins - a.wins || b.podiums - a.podiums || (a.avgFinish ?? 99) - (b.avgFinish ?? 99));
        list.forEach((r, i) => { r.rank = i + 1; });
        return list;
    },

    // Team standings. Wins/podiums count the whole roster, but constructor
    // POINTS only count each team's top-N scoring drivers (like real series,
    // where a third car doesn't inflate the constructors' championship).
    teamTable(races, world, filter = {}) {
        const scoringCap = Number(filter.constructorCap) || Stats.CONSTRUCTOR_CAP;
        const driverRows = this.driverTable(races, world, filter);
        const teams = new Map();
        for (const row of driverRows) {
            const teamId = row.driver?.teamId;
            if (!teamId || !world.teamsById[teamId]) continue;
            let t = teams.get(teamId);
            if (!t) {
                t = { teamId, team: world.teamsById[teamId], points: 0, wins: 0, podiums: 0, drivers: [] };
                teams.set(teamId, t);
            }
            t.wins += row.wins;
            t.podiums += row.podiums;
            t.drivers.push(row);
        }
        const list = Array.from(teams.values());
        list.forEach(t => {
            // driverTable already sorts by points desc, so keep the ordering when
            // capping the scorers.
            const scorers = t.drivers.slice().sort((a, b) => b.points - a.points).slice(0, scoringCap);
            t.points = scorers.reduce((sum, d) => sum + d.points, 0);
        });
        list.sort((a, b) => b.points - a.points || b.wins - a.wins);
        list.forEach((t, i) => { t.rank = i + 1; });
        return list;
    },

    // Per-track history: who has won where, laps run, etc.
    trackTable(races, world, filter = {}) {
        const completed = this.completedRaces(races, filter);
        const tracks = new Map();
        for (const race of completed) {
            const key = (race.track || 'Unknown track').trim();
            let t = tracks.get(key.toLowerCase());
            if (!t) {
                t = { track: key, races: 0, winners: new Map(), poles: new Map(), games: new Set() };
                tracks.set(key.toLowerCase(), t);
            }
            t.races += 1;
            if (race.gameId && world.gamesById[race.gameId]) t.games.add(world.gamesById[race.gameId].name);
            const winner = race.results.find(r => Number(r.position) === 1 && !r.dnf);
            if (winner) {
                const name = world.driversById[winner.driverId]?.name || 'Unknown';
                t.winners.set(name, (t.winners.get(name) || 0) + 1);
            }
            const pole = race.results.find(r => r.pole);
            if (pole) {
                const name = world.driversById[pole.driverId]?.name || 'Unknown';
                t.poles.set(name, (t.poles.get(name) || 0) + 1);
            }
        }
        const list = Array.from(tracks.values()).map(t => {
            const topWinner = Array.from(t.winners.entries()).sort((a, b) => b[1] - a[1])[0] || null;
            return {
                track: t.track,
                races: t.races,
                games: Array.from(t.games),
                kingOfTrack: topWinner ? { name: topWinner[0], wins: topWinner[1] } : null,
                uniqueWinners: t.winners.size
            };
        });
        list.sort((a, b) => b.races - a.races || a.track.localeCompare(b.track));
        return list;
    },

    // League records across everything.
    records(races, world) {
        const all = this.driverTable(races, world);
        const by = (key) => all.slice().sort((a, b) => b[key] - a[key])[0] || null;
        const bestAvg = all.filter(r => r.finishCount >= 3).sort((a, b) => a.avgFinish - b.avgFinish)[0] || null;
        return {
            mostWins: by('wins'), mostPodiums: by('podiums'), mostPoles: by('poles'),
            mostFastestLaps: by('fastestLaps'), mostPoints: by('points'),
            mostStarts: by('starts'), bestAvgFinish: bestAvg
        };
    },

    // A driver's recent form as category tags (oldest→newest of the last n),
    // for the little pip strip in standings. Categories: win/podium/points/out/dnf.
    driverForm(driverId, races, world, n = 5) {
        const history = this.driverHistory(driverId, races, world).slice(0, n).reverse();
        return history.map(h => {
            const res = h.result;
            if (res.dnf) return 'dnf';
            const pos = Number(res.position) || 99;
            if (pos === 1) return 'win';
            if (pos <= 3) return 'podium';
            if (h.points > 0) return 'points';
            return 'out';
        });
    },

    // A single driver's full race-by-race history (newest first).
    driverHistory(driverId, races, world) {
        const rows = [];
        for (const race of this.completedRaces(races)) {
            const res = race.results.find(r => r.driverId === driverId);
            if (!res) continue;
            rows.push({
                race,
                series: world.seriesById[race.seriesId] || null,
                game: world.gamesById[race.gameId] || null,
                result: res,
                points: pointsForResult(res, world.seriesById[race.seriesId])
            });
        }
        rows.sort((a, b) => (b.race.date || '').localeCompare(a.race.date || ''));
        return rows;
    },

    // Live-derived recruitment ratings (Hub.recruitChips) — never self-reported.
    // Both start at 0 with no race history and move as results come in, so a
    // rookie can't just type "Pace 10, Safety 10" on day one.

    // Average finishing percentile across starts: 1.0 = always wins, 0 = always
    // last. Scaled to 0–10. DNFs and single-car "races" don't count either way.
    driverPace(driverId, races, world) {
        const scored = this.driverHistory(driverId, races, world)
            .filter(h => !h.result.dnf && Number(h.result.position) && h.race.results.length > 1);
        if (!scored.length) return 0;
        const sum = scored.reduce((s, h) => {
            const gridSize = h.race.results.length;
            const pos = Number(h.result.position);
            return s + (gridSize - pos) / (gridSize - 1);
        }, 0);
        return Math.round((sum / scored.length) * 100) / 10;
    },

    // Inverse of average incidents/race (same `incidents` telemetry Clauses
    // reads for clean-race bonuses): 0 incidents/race → 10, 5+ → 0. Races
    // where incidents were never recorded are skipped, not punished — missing
    // telemetry never hurts a driver (same rule Clauses.forRace follows).
    driverSafety(driverId, races, world) {
        const tracked = this.driverHistory(driverId, races, world)
            .filter(h => h.result.incidents !== undefined && h.result.incidents !== null);
        if (!tracked.length) return 0;
        const avgIncidents = tracked.reduce((s, h) => s + Number(h.result.incidents), 0) / tracked.length;
        return Math.max(0, Math.round((10 - avgIncidents * 2) * 10) / 10);
    },

    // Cumulative points per driver across the (round-ordered) races in a filter.
    // Returns { labels:['R1','R2',…], series:[{driverId,name,values:[y,…]}] }.
    pointsProgression(races, world, filter, driverIds) {
        const completed = this.completedRaces(races, filter).slice()
            .sort((a, b) => (Number(a.round) || 0) - (Number(b.round) || 0) || (a.date || '').localeCompare(b.date || ''));
        const labels = completed.map((r, i) => r.round ? 'R' + r.round : (r.date ? Util.fmtDateShort(r.date) : 'R' + (i + 1)));
        const totals = Object.fromEntries(driverIds.map(id => [id, 0]));
        const series = driverIds.map(id => ({ driverId: id, name: world.driversById[id]?.name || '?', values: [] }));
        for (const race of completed) {
            for (const s of series) {
                const res = race.results.find(r => r.driverId === s.driverId);
                if (res) totals[s.driverId] += pointsForResult(res, world.seriesById[race.seriesId]);
                s.values.push(totals[s.driverId]);
            }
        }
        return { labels, series };
    },

    // Freeze a season's final standings + champions. Pure — recomputed from
    // results, returns the snapshot to store on the season doc.
    crownSeason(races, world, seasonId) {
        const filter = { seasonId };
        const drivers = this.driverTable(races, world, filter);
        const teams = this.teamTable(races, world, filter);
        return {
            championDriverId: drivers[0]?.driverId || null,
            championTeamId: teams[0]?.teamId || null,
            standingsArchive: drivers.map(d => ({
                driverId: d.driverId, name: d.driver?.name || '', rank: d.rank,
                points: d.points, wins: d.wins, podiums: d.podiums
            })),
            teamArchive: teams.map(t => ({
                teamId: t.teamId, name: t.team?.name || '', rank: t.rank,
                points: t.points, wins: t.wins
            }))
        };
    }
};
window.Stats = Stats;

/* ============================================================
   Schedule generator — a full series calendar in one click.
   ============================================================ */
function generateScheduleRaces({ series, cadence, startDate, time, tracks, laps, startRound = 1, seasonId = null }) {
    const start = Util.parseISODate(startDate);
    if (!start) throw new Error('Pick a valid start date.');
    const trackList = tracks.map(t => t.trim()).filter(Boolean);
    if (!trackList.length) throw new Error('Add at least one track (one per line).');

    const stepDays = cadence === 'weekly' ? 7 : cadence === 'biweekly' ? 14 : 0; // 0 → monthly
    const races = [];
    const d = new Date(start);
    const base = Number(startRound) || 1;

    trackList.forEach((track, i) => {
        const round = base + i;
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        races.push({
            seriesId: series.id,
            seasonId: seasonId || null,
            gameId: series.gameId || null,
            name: `${series.name} — Round ${round}`,
            round,
            track,
            date: iso,
            time: time || '',
            laps: laps || null,
            status: 'scheduled',
            results: []
        });
        if (stepDays) d.setDate(d.getDate() + stepDays);
        else d.setMonth(d.getMonth() + 1);
    });
    return races;
}
window.generateScheduleRaces = generateScheduleRaces;

/* ============================================================
   Challenge templates — for one-click weekly/monthly content.
   {TRACK} and {GAME} get filled from live league data when possible.
   ============================================================ */
const CHALLENGE_TEMPLATES = [
    { title: 'Podium Push', description: 'Finish on the podium in any league race this period.', mode: 'solo', points: 3, reward: 'Bragging rights + 3 challenge points' },
    { title: 'Clean Sweep', description: 'Complete a race with zero incidents or penalties.', mode: 'solo', points: 2, reward: '2 challenge points' },
    { title: 'Qualifying Ace', description: 'Take pole position in any series this period.', mode: 'solo', points: 3, reward: '3 challenge points' },
    { title: 'Iron Driver', description: 'Enter and finish every scheduled race this period — no DNFs, no absences.', mode: 'solo', points: 4, reward: '4 challenge points' },
    { title: 'Charge Through the Field', description: 'Gain 5 or more positions from your starting spot in a single race.', mode: 'solo', points: 3, reward: '3 challenge points' },
    { title: 'Fastest Lap Hunter', description: 'Set the fastest lap in any league race this period.', mode: 'solo', points: 2, reward: '2 challenge points' },
    { title: 'New Frontier', description: 'Run a race in a game you have never raced in the league before.', mode: 'solo', points: 2, reward: '2 challenge points' },
    { title: 'Track Specialist', description: 'Post your personal best lap time at {TRACK} and share proof in the league chat.', mode: 'solo', points: 2, reward: '2 challenge points' },
    { title: 'Team Stack', description: 'Get both teammates into the top 5 of the same race.', mode: 'multiplayer', points: 4, reward: '4 challenge points each' },
    { title: 'Convoy', description: 'Complete a full multiplayer endurance session (45+ min) with at least 3 league members.', mode: 'multiplayer', points: 3, reward: '3 challenge points each' },
    { title: 'Mentor Session', description: 'Pair up: a veteran coaches a newer member for a practice session at {TRACK}.', mode: 'multiplayer', points: 3, reward: '3 challenge points each' },
    { title: 'Rivals Duel', description: 'Challenge another driver to a best-of-3 sprint duel and report the result.', mode: 'multiplayer', points: 3, reward: 'Winner gets 3 points, loser 1' },
    { title: 'Team Time Attack', description: 'Combine your team’s best lap times at {TRACK} — beat the rival team’s combined time.', mode: 'multiplayer', points: 4, reward: '4 challenge points each' },
    { title: 'Full Grid Night', description: 'Help fill a full public/league lobby — 8+ league members in one race.', mode: 'multiplayer', points: 2, reward: '2 challenge points each' },
    { title: 'Photo Finish', description: 'Finish within 1 second of another league driver (any position) — both get credit.', mode: 'multiplayer', points: 2, reward: '2 challenge points each' },
    { title: 'Reverse Grid Hero', description: 'Organize and complete a reverse-grid race with 4+ members.', mode: 'multiplayer', points: 3, reward: '3 challenge points each' }
];

function generateChallenges({ cadence, count, tracks = [], games = [] }) {
    const pool = CHALLENGE_TEMPLATES.slice();
    // Shuffle
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picked = pool.slice(0, Math.min(count, pool.length));

    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);
    if (cadence === 'weekly') end.setDate(end.getDate() + 7);
    else end.setMonth(end.getMonth() + 1);
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    return picked.map(t => {
        const track = tracks.length ? tracks[Math.floor(Math.random() * tracks.length)] : 'your favorite track';
        const game = games.length ? games[Math.floor(Math.random() * games.length)].name : 'any game';
        return {
            title: t.title,
            description: t.description.replaceAll('{TRACK}', track).replaceAll('{GAME}', game),
            mode: t.mode,
            cadence,
            points: t.points || 0,
            reward: t.reward,
            startDate: iso(start),
            endDate: iso(end),
            status: 'active'
        };
    });
}
window.generateChallenges = generateChallenges;
