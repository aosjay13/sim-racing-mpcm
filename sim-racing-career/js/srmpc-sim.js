/* ============================================================
   Phoenix SRMPC — Prestige, AI World & Simulation
   • Prestige (1–5 ★): a leveling ladder from Rookie to Legend.
     Everyone starts at 1 star. Drivers/teams compute XP live from
     results + championships; staff/sponsors/personas bank
     prestigeXP as the races they're part of complete.
   • Real-World Pack: real tracks + real-style championships seeded
     with full AI grids (teams, drivers, crew, sponsors, agents,
     series & track owner personas).
   • Sim engine: simulate races and whole seasons, with prize money
     and sponsor payouts flowing to player wallets, and AI free-agency
     churn feeding the news + hire market.
   ============================================================ */
'use strict';

/* ============================================================
   Prestige — the career ladder. Everyone starts at 1 ★ Rookie
   and climbs to 5 ★ Legend on prestige XP.
   XP = points + wins·15 + podiums·6 + poles·3 + titles·250.
   Drivers/teams compute XP live from results; staff, sponsors,
   and role personas bank prestigeXP as the races they're part
   of complete (their team scores, their series runs, their
   clients deliver).
   ============================================================ */
const Prestige = {
    LEVELS: [
        { stars: 1, floor: 0,    name: 'Rookie' },
        { stars: 2, floor: 200,  name: 'Contender' },
        { stars: 3, floor: 600,  name: 'Front Runner' },
        { stars: 4, floor: 1500, name: 'Elite' },
        { stars: 5, floor: 3200, name: 'Legend' }
    ],
    TITLE_XP: 250,
    // Worth multiplier per star — the higher the prestige, the more money you're worth.
    MULTIPLIER: { 1: 1, 2: 1.5, 3: 2.25, 4: 3.5, 5: 5 },

    starsFromScore(score) {
        let stars = 1;
        for (const lvl of this.LEVELS) {
            if (score >= lvl.floor) stars = lvl.stars;
        }
        return stars;
    },

    levelName(stars) { return this.LEVELS[this.clamp(stars) - 1].name; },

    // Everything a progress UI needs for one XP total.
    progress(score) {
        score = Math.max(0, Math.round(Number(score) || 0));
        const stars = this.starsFromScore(score);
        const lvl = this.LEVELS[stars - 1];
        const next = this.LEVELS[stars] || null;
        return {
            score, stars,
            name: lvl.name,
            next,
            toNext: next ? next.floor - score : 0,
            pct: next ? Math.round((score - lvl.floor) / (next.floor - lvl.floor) * 100) : 100
        };
    },

    clamp(n) { return Math.min(5, Math.max(1, Math.round(Number(n) || 1))); },

    // Stored prestige XP for staff / sponsors / role personas. A GM-set star
    // level acts as a floor (its XP equivalent), so hand-promoted careers
    // never fall below it — but everyone keeps earning past it.
    storedScore(entity) {
        const floor = this.LEVELS[this.clamp(entity?.prestige) - 1].floor;
        return Math.max(Math.round(Number(entity?.prestigeXP) || 0), floor);
    },

    stored(entity) { return this.starsFromScore(this.storedScore(entity)); },

    multiplier(stars) { return this.MULTIPLIER[this.clamp(stars)] || 1; },

    // How many championships each driver / team has won (from closed seasons).
    _titleCounts(world, key) {
        const counts = {};
        (world.seasons || []).forEach(se => {
            if (se.status === 'completed' && se[key]) {
                counts[se[key]] = (counts[se[key]] || 0) + 1;
            }
        });
        return counts;
    },

    driverScore(row, titles = 0) {
        if (!row) return titles * this.TITLE_XP;
        return Math.round(row.points + row.wins * 15 + row.podiums * 6 + (row.poles || 0) * 3 + titles * this.TITLE_XP);
    },

    // Stars for one driver. Pass precomputed rows (Stats.driverTable) when
    // rendering lists so the table isn't rebuilt per driver.
    driverStars(driverId, world, rows = null) {
        return this.driverProgress(driverId, world, rows).stars;
    },

    driverProgress(driverId, world, rows = null) {
        const row = (rows || Stats.driverTable(world.races, world)).find(r => r.driverId === driverId);
        const titles = this._titleCounts(world, 'championDriverId')[driverId] || 0;
        return this.progress(this.driverScore(row, titles));
    },

    teamScore(row, titles = 0) {
        if (!row) return titles * this.TITLE_XP;
        return Math.round(row.points + row.wins * 15 + row.podiums * 6 + titles * this.TITLE_XP);
    },

    teamStars(teamId, world, teamRows = null) {
        return this.teamProgress(teamId, world, teamRows).stars;
    },

    teamProgress(teamId, world, teamRows = null) {
        const row = (teamRows || Stats.teamTable(world.races, world)).find(t => t.teamId === teamId);
        const titles = this._titleCounts(world, 'championTeamId')[teamId] || 0;
        return this.progress(this.teamScore(row, titles));
    },

    // A driver's market worth per race: base rating salary × prestige multiplier.
    driverWorth(driver, stars) {
        const base = driverAskingSalary(driver?.rating || 70);
        return Math.round(base * this.multiplier(stars) / 10) * 10;
    },

    stars(n) { n = this.clamp(n); return '★'.repeat(n) + '☆'.repeat(5 - n); },

    chip(n, label = 'Prestige') {
        n = this.clamp(n);
        return `<span class="chip prestige-chip" title="${Util.esc(label)}: ${n}/5 ${this.levelName(n)} — worth ×${this.multiplier(n)}">${this.stars(n)}</span>`;
    },

    // Star ladder with an XP bar: "★★☆☆☆ Contender · 360 XP to Front Runner".
    progressBar(prog, label = 'Prestige') {
        const sub = prog.next
            ? `${prog.score} XP · ${prog.toNext} to ${prog.next.name}`
            : `${prog.score} XP · max prestige`;
        return `<div class="prestige-progress" title="${Util.esc(label)}: ${prog.stars}/5 ${prog.name} — worth ×${this.multiplier(prog.stars)}">
            <div class="prestige-progress-top">
                <span class="prestige-stars">${this.stars(prog.stars)}</span>
                <span class="prestige-level">${prog.name}</span>
                <span class="prestige-next">${sub}</span>
            </div>
            <div class="progress"><div class="progress-fill prestige-fill" style="width:${prog.pct}%"></div></div>
        </div>`;
    },

    /* ----- XP accrual for stored-prestige careers -----
       Runs once per race completion (sim + manual results). Team results
       feed the team's staff and sponsors; series owners earn hosting XP,
       track owners earn venue XP, agents earn a cut of client XP. */
    XP_SHARE: { staff: 1, sponsor: 1, agent: 0.5 },
    HOST_XP: 5,        // series owner: 5 + 1 per entrant, per race run
    VENUE_XP: 25,      // track owner: per league race hosted at their venue

    // Same XP currency as driverScore, for one race result.
    _resultXP(res, series) {
        let xp = pointsForResult(res, series);
        const pos = Number(res.position);
        if (!res.dnf && pos === 1) xp += 15;
        if (!res.dnf && pos && pos <= 3) xp += 6;
        if (res.pole) xp += 3;
        return xp;
    },

    async awardRaceXP(race, world) {
        try {
            const series = world.seriesById[race.seriesId] || null;
            const teamXP = {};   // teamId -> XP earned this race
            const driverXP = {}; // driverId -> XP earned this race
            for (const res of race.results || []) {
                const d = world.driversById[res.driverId];
                if (!d) continue;
                const xp = this._resultXP(res, series);
                driverXP[d.id] = xp;
                if (d.teamId) teamXP[d.teamId] = (teamXP[d.teamId] || 0) + xp;
            }

            const [staff, sponsors, personas] = await Promise.all([
                DB.staff().catch(() => []),
                DB.sponsors().catch(() => []),
                DB.roleProfiles().catch(() => [])
            ]);

            const bump = (list, entity, xp) => {
                xp = Math.round(xp);
                if (xp > 0) list.push({ id: entity.id, patch: { prestigeXP: Math.round(Number(entity.prestigeXP) || 0) + xp } });
            };

            const staffUpd = [], sponsorUpd = [], personaUpd = [];
            staff.filter(s => teamXP[s.teamId]).forEach(s => bump(staffUpd, s, teamXP[s.teamId] * this.XP_SHARE.staff));
            sponsors.filter(s => teamXP[s.teamId]).forEach(s => bump(sponsorUpd, s, teamXP[s.teamId] * this.XP_SHARE.sponsor));
            personas.forEach(p => {
                if (p.role === 'series-owner' && (p.seriesIds || []).includes(race.seriesId)) {
                    bump(personaUpd, p, this.HOST_XP + (race.results || []).length);
                } else if (p.role === 'track-owner' && race.track &&
                    (p.tracks || []).some(t => t.toLowerCase() === race.track.toLowerCase())) {
                    bump(personaUpd, p, this.VENUE_XP);
                } else if (p.role === 'agent' || p.role === 'crew-chief') {
                    const clientXP = (p.clientDriverIds || []).reduce((s, id) => s + (driverXP[id] || 0), 0);
                    bump(personaUpd, p, clientXP * this.XP_SHARE.agent);
                }
            });

            if (staffUpd.length) await DB.batchUpdate('staff', staffUpd);
            if (sponsorUpd.length) await DB.batchUpdate('sponsors', sponsorUpd);
            if (personaUpd.length) await DB.batchUpdate('roleProfiles', personaUpd);
        } catch (e) { console.warn('Prestige XP award failed:', e); }
    },

    // Championship bonus when a season closes: the champion team's staff and
    // sponsors bank title XP, and the series' promoter earns a cut.
    async awardTitleXP(snapshot, seriesId) {
        try {
            const [staff, sponsors, personas] = await Promise.all([
                DB.staff().catch(() => []),
                DB.sponsors().catch(() => []),
                DB.roleProfiles().catch(() => [])
            ]);
            const upd = (entity, xp) => ({ id: entity.id, patch: { prestigeXP: Math.round(Number(entity.prestigeXP) || 0) + xp } });

            if (snapshot.championTeamId) {
                const staffUpd = staff.filter(s => s.teamId === snapshot.championTeamId).map(s => upd(s, this.TITLE_XP));
                const sponsorUpd = sponsors.filter(s => s.teamId === snapshot.championTeamId).map(s => upd(s, this.TITLE_XP));
                if (staffUpd.length) await DB.batchUpdate('staff', staffUpd);
                if (sponsorUpd.length) await DB.batchUpdate('sponsors', sponsorUpd);
            }
            const promoUpd = personas
                .filter(p => p.role === 'series-owner' && (p.seriesIds || []).includes(seriesId))
                .map(p => upd(p, Math.round(this.TITLE_XP / 2)));
            if (promoUpd.length) await DB.batchUpdate('roleProfiles', promoUpd);
        } catch (e) { console.warn('Prestige title XP failed:', e); }
    }
};
window.Prestige = Prestige;

/* ============================================================
   Real-World Pack — tracks, championships, AI grids.
   ============================================================ */
const REAL_TRACKS = [
    { name: 'Silverstone Circuit', country: 'UK', type: 'Road', length: '5.89 km' },
    { name: 'Circuit de Spa-Francorchamps', country: 'Belgium', type: 'Road', length: '7.00 km' },
    { name: 'Autodromo Nazionale Monza', country: 'Italy', type: 'Road', length: '5.79 km' },
    { name: 'Suzuka Circuit', country: 'Japan', type: 'Road', length: '5.81 km' },
    { name: 'Autódromo José Carlos Pace (Interlagos)', country: 'Brazil', type: 'Road', length: '4.31 km' },
    { name: 'Circuit de Monaco', country: 'Monaco', type: 'Street', length: '3.34 km' },
    { name: 'Nürburgring GP', country: 'Germany', type: 'Road', length: '5.15 km' },
    { name: 'Circuit de la Sarthe (Le Mans)', country: 'France', type: 'Road', length: '13.63 km' },
    { name: 'Circuit Zandvoort', country: 'Netherlands', type: 'Road', length: '4.26 km' },
    { name: 'Red Bull Ring', country: 'Austria', type: 'Road', length: '4.32 km' },
    { name: 'Circuit de Barcelona-Catalunya', country: 'Spain', type: 'Road', length: '4.66 km' },
    { name: 'Hungaroring', country: 'Hungary', type: 'Road', length: '4.38 km' },
    { name: 'Autodromo Enzo e Dino Ferrari (Imola)', country: 'Italy', type: 'Road', length: '4.91 km' },
    { name: 'Circuit of the Americas', country: 'USA', type: 'Road', length: '5.51 km' },
    { name: 'Watkins Glen International', country: 'USA', type: 'Road', length: '5.43 km' },
    { name: 'WeatherTech Raceway Laguna Seca', country: 'USA', type: 'Road', length: '3.60 km' },
    { name: 'Road America', country: 'USA', type: 'Road', length: '6.51 km' },
    { name: 'Sebring International Raceway', country: 'USA', type: 'Road', length: '6.02 km' },
    { name: 'Daytona International Speedway', country: 'USA', type: 'Oval', length: '4.02 km' },
    { name: 'Talladega Superspeedway', country: 'USA', type: 'Oval', length: '4.28 km' },
    { name: 'Charlotte Motor Speedway', country: 'USA', type: 'Oval', length: '2.41 km' },
    { name: 'Bristol Motor Speedway', country: 'USA', type: 'Oval', length: '0.86 km' },
    { name: 'Martinsville Speedway', country: 'USA', type: 'Oval', length: '0.85 km' },
    { name: 'Indianapolis Motor Speedway', country: 'USA', type: 'Oval', length: '4.02 km' },
    { name: 'Mount Panorama Circuit (Bathurst)', country: 'Australia', type: 'Road', length: '6.21 km' },
    { name: 'Fuji Speedway', country: 'Japan', type: 'Road', length: '4.56 km' }
];

const REAL_WORLD_PACK = [
    {
        name: 'Formula World Championship',
        description: 'The pinnacle of open-wheel racing — real Grand Prix venues, elite AI teams.',
        pointsSystem: 'f1',
        laps: 55,
        tracks: ['Circuit de Monaco', 'Silverstone Circuit', 'Circuit de Spa-Francorchamps',
            'Autodromo Nazionale Monza', 'Suzuka Circuit', 'Circuit of the Americas',
            'Autódromo José Carlos Pace (Interlagos)', 'Circuit Zandvoort', 'Red Bull Ring', 'Hungaroring'],
        teams: [
            { name: 'Scuderia Falchi', color: '#d40000', hq: 'Italy' },
            { name: 'Silberpfeil GP', color: '#00d2be', hq: 'Germany' },
            { name: 'Taurus Racing', color: '#1e41ff', hq: 'Austria' },
            { name: 'Britannia Grand Prix', color: '#ff8000', hq: 'UK' },
            { name: 'Bleu Alpine Course', color: '#2293d1', hq: 'France' }
        ]
    },
    {
        name: 'GT World Challenge',
        description: 'Pro GT machinery on the world’s classic road courses.',
        pointsSystem: 'motogp',
        laps: 30,
        tracks: ['Mount Panorama Circuit (Bathurst)', 'Circuit de Spa-Francorchamps', 'Nürburgring GP',
            'WeatherTech Raceway Laguna Seca', 'Autodromo Enzo e Dino Ferrari (Imola)',
            'Circuit de Barcelona-Catalunya', 'Fuji Speedway', 'Road America'],
        teams: [
            { name: 'Stuttgart Flat-Six Motorsport', color: '#c8a24b', hq: 'Germany' },
            { name: 'Maranello GT Corse', color: '#b02020', hq: 'Italy' },
            { name: 'Rising Sun NSX Works', color: '#e0e0e0', hq: 'Japan' },
            { name: 'Bavarian M Power Racing', color: '#3c73c8', hq: 'Germany' }
        ]
    },
    {
        name: 'National Stock Car Cup',
        description: 'Full-contact oval warfare — superspeedways, short tracks, and one road course.',
        pointsSystem: 'nascar',
        laps: 160,
        tracks: ['Daytona International Speedway', 'Talladega Superspeedway', 'Charlotte Motor Speedway',
            'Bristol Motor Speedway', 'Martinsville Speedway', 'Indianapolis Motor Speedway',
            'Watkins Glen International', 'Sebring International Raceway'],
        teams: [
            { name: 'Dixie Thunder Racing', color: '#cc2222', hq: 'USA' },
            { name: 'Appalachian Speed Co.', color: '#22aacc', hq: 'USA' },
            { name: 'Lone Star Motorsports', color: '#ddaa22', hq: 'USA' },
            { name: 'Great Lakes Racing Group', color: '#7755dd', hq: 'USA' }
        ]
    }
];

const SPONSOR_BRANDS = [
    { name: 'Velocity Energy Drinks', industry: 'Energy drinks' },
    { name: 'Apex Lubricants', industry: 'Oil & fuels' },
    { name: 'TurboByte Cloud', industry: 'Technology' },
    { name: 'IronGrip Tires', industry: 'Tires' },
    { name: 'Nova Financial', industry: 'Banking' },
    { name: 'Meteor Watches', industry: 'Luxury goods' },
    { name: 'Crossflow Airlines', industry: 'Travel' },
    { name: 'Blacksmith Tools', industry: 'Hardware' },
    { name: 'Quantum Telecom', industry: 'Telecom' },
    { name: 'Redline Apparel', industry: 'Clothing' },
    { name: 'Summit Insurance', industry: 'Insurance' },
    { name: 'Fusion Batteries', industry: 'Automotive' },
    { name: 'Golden Wing Brewery', industry: 'Beverages' }
];

// Seeds the whole real-world universe. Skips anything that already exists
// (matched by name) so re-running never duplicates.
async function installRealWorldPack() {
    const summary = { tracks: 0, series: 0, seasons: 0, races: 0, teams: 0, drivers: 0, staff: 0, sponsors: 0, personas: 0 };
    const year = new Date().getFullYear();

    const [existingTracks, existingSeries, existingTeams, existingDrivers, existingStaff, existingSponsors, existingProfiles] =
        await Promise.all([
            DB.list('tracks', { force: true }).catch(() => []),
            DB.series({ force: true }),
            DB.teams({ force: true }),
            DB.drivers({ force: true }),
            DB.list('staff', { force: true }).catch(() => []),
            DB.list('sponsors', { force: true }).catch(() => []),
            DB.roleProfiles({ force: true }).catch(() => [])
        ]);
    const has = (list, name) => list.some(x => (x.name || '').toLowerCase() === name.toLowerCase());
    const usedNames = new Set([...existingDrivers, ...existingStaff, ...existingProfiles].map(x => x.name));

    // ---- Tracks (with AI track-owner personas, ~4 venues each) ----
    const newTracks = REAL_TRACKS.filter(t => !has(existingTracks, t.name));
    if (newTracks.length) {
        await DB.batchCreate('tracks', newTracks.map(t => ({ ...t, isNPC: true })));
        summary.tracks = newTracks.length;
        for (let i = 0; i < newTracks.length; i += 4) {
            await DB.create('roleProfiles', {
                name: makeNpcName(usedNames), role: 'track-owner', uid: null, isNPC: true, prestige: 1, // every career starts at 1 ★
                bio: 'AI venue group managing world-class circuits.',
                tracks: newTracks.slice(i, i + 4).map(t => t.name)
            });
            summary.personas++;
        }
    }

    // ---- Championships ----
    for (const pack of REAL_WORLD_PACK) {
        if (has(existingSeries, pack.name)) continue;

        const seriesId = await DB.create('series', {
            name: pack.name, description: pack.description, gameId: null,
            season: year, pointsSystem: pack.pointsSystem, status: 'active',
            ownerUid: null, isNPC: true
        });
        summary.series++;

        // AI series-owner persona fronting the championship.
        await DB.create('roleProfiles', {
            name: makeNpcName(usedNames), role: 'series-owner', uid: null, isNPC: true, prestige: 1,
            bio: `AI promoter running the ${pack.name}.`, seriesIds: [seriesId]
        });
        summary.personas++;

        const seasonId = await DB.create('seasons', {
            seriesId, gameId: null, name: `${pack.name} ${year}`, year,
            status: 'active', startDate: Util.todayISO(), endDate: null,
            ownerUid: null, championDriverId: null, championTeamId: null
        });
        summary.seasons++;

        // Full-season schedule, one round a week starting next Saturday.
        const start = new Date();
        start.setDate(start.getDate() + ((6 - start.getDay() + 7) % 7 || 7));
        const races = generateScheduleRaces({
            series: { id: seriesId, name: pack.name, gameId: null },
            seasonId,
            cadence: 'weekly',
            startDate: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
            time: '20:00', laps: pack.laps, tracks: pack.tracks
        });
        await DB.batchCreate('races', races);
        summary.races += races.length;

        // Teams with 2 drivers + crew chief + mechanic each, plus a sponsor.
        const sponsorPool = SPONSOR_BRANDS.filter(b => !has(existingSponsors, b.name));
        for (const t of pack.teams) {
            if (has(existingTeams, t.name)) continue;
            const teamId = await DB.create('teams', {
                name: t.name, color: t.color, headquarters: t.hq,
                description: `AI works team competing in the ${pack.name}.`,
                recruiting: false, isEstablished: true, isNPC: true,
                ownerUid: null, status: 'approved', seriesId
            });
            summary.teams++;

            const drivers = [makeNpcDriver(usedNames, teamId), makeNpcDriver(usedNames, teamId)];
            drivers.forEach(d => { d.seriesId = seriesId; });
            await DB.batchCreate('drivers', drivers);
            summary.drivers += drivers.length;

            const staff = [makeNpcStaff('crew-chief', usedNames, teamId), makeNpcStaff('mechanic', usedNames, teamId)];
            await DB.batchCreate('staff', staff);
            summary.staff += staff.length;

            const brand = sponsorPool.shift();
            if (brand) {
                await DB.create('sponsors', {
                    ...brand, isNPC: true, prestige: 1,
                    teamId, payoutPerRace: _randInt(20, 60) * 10
                });
                summary.sponsors++;
            }
        }

        // One AI agent per championship with a book of that grid's drivers.
        const gridDrivers = (await DB.drivers({ force: true })).filter(d => d.seriesId === seriesId);
        await DB.create('roleProfiles', {
            name: makeNpcName(usedNames), role: 'agent', uid: null, isNPC: true, prestige: 1,
            bio: `AI super-agent representing ${pack.name} talent.`,
            clientDriverIds: gridDrivers.slice(0, 4).map(d => d.id)
        });
        summary.personas++;
    }

    News.post('🌍', `The Real-World Racing Pack has arrived: ${summary.series} championships, ${summary.teams} AI teams, ${summary.tracks} real tracks — simulated seasons are live!`);
    return summary;
}
window.installRealWorldPack = installRealWorldPack;

/* ============================================================
   Simulation engine
   ============================================================ */
const Sim = {
    // Prize money by finishing position (P1 first); DNF gets start money.
    PRIZES: [5000, 3500, 2500, 1800, 1400, 1000, 850, 700, 600, 500],
    PRIZE_OTHER: 300,
    PRIZE_DNF: 150,
    TEAM_SHARE: 0.5,          // team owner's cut on top of driver prize
    DNF_CHANCE: 0.10,
    SHAKEUP_CHANCE: 0.06,     // post-race chance an AI driver hits free agency

    prizeFor(res) {
        if (res.dnf) return this.PRIZE_DNF;
        const p = Number(res.position);
        if (!p) return 0;
        return this.PRIZES[p - 1] ?? this.PRIZE_OTHER;
    },

    // Who lines up: the series' AI grid (drivers on teams entered in the
    // series) + player drivers signed up for the race.
    async gridFor(race, world) {
        const seriesTeamIds = new Set(world.teams.filter(t => t.seriesId === race.seriesId).map(t => t.id));
        const grid = world.drivers.filter(d => d.teamId && seriesTeamIds.has(d.teamId));
        try {
            const signups = (await DB.signups({ force: true })).filter(s => s.raceId === race.id);
            for (const s of signups) {
                const d = world.driversById[s.driverId];
                if (d && !grid.some(g => g.id === d.id)) grid.push(d);
            }
        } catch (e) { /* signups need auth — fine */ }
        return grid;
    },

    // One driver's pace for a session: skill rating ± race-day variance.
    _pace(driver) {
        const rating = Number(driver.rating) || 75;
        const gauss = (Math.random() + Math.random() + Math.random()) / 3; // ~normal 0..1
        return rating + (gauss - 0.5) * 30;
    },

    async simulateRace(raceId, { quiet = false } = {}) {
        const world = await DB.loadWorld(true);
        const race = world.races.find(r => r.id === raceId);
        if (!race) throw new Error('Race not found.');
        if (race.status === 'completed') throw new Error('That race already has results.');

        const grid = await this.gridFor(race, world);
        if (grid.length < 2) {
            throw new Error('No AI grid for this race. Enter its teams in the series (Admin → Teams → Edit → Series) or install the Real-World Pack.');
        }

        // Qualifying → pole; race pace + DNF roll → classification.
        const quali = grid.map(d => ({ d, q: this._pace(d) })).sort((a, b) => b.q - a.q);
        const poleId = quali[0].d.id;
        const runners = grid.map(d => ({ d, pace: this._pace(d), dnf: Math.random() < this.DNF_CHANCE }));
        const finishers = runners.filter(r => !r.dnf).sort((a, b) => b.pace - a.pace);
        // Never let everyone crash out.
        if (!finishers.length) { runners[0].dnf = false; finishers.push(runners[0]); }
        const flId = finishers[Math.floor(Math.random() * Math.min(6, finishers.length))].d.id;

        const results = [
            ...finishers.map((r, i) => ({
                driverId: r.d.id, position: i + 1, dnf: false,
                pole: r.d.id === poleId, fastestLap: r.d.id === flId
            })),
            ...runners.filter(r => r.dnf).map(r => ({
                driverId: r.d.id, position: null, dnf: true,
                pole: r.d.id === poleId, fastestLap: false
            }))
        ];

        await DB.update('races', raceId, { status: 'completed', results, simulated: true });

        const winner = world.driversById[results[0].driverId];
        News.post('🏁', `${winner?.name || 'An AI driver'} wins the simulated ${race.name || race.track || 'race'}${winner?.teamId ? ` for ${world.teamsById[winner.teamId]?.name || 'their team'}` : ''}!`);

        await this.payoutRace({ ...race, results }, world);
        await Prestige.awardRaceXP({ ...race, results }, world);
        await this._maybeShakeup(world);

        if (!quiet) Util.notify(`Simulated: ${winner?.name || '—'} wins ${race.name || race.track}. 🏁`);
        return { race, winner };
    },

    // Simulate every remaining scheduled race in a series (round order).
    async simulateSeason(seriesId, { onlyNext = false } = {}) {
        const world = await DB.loadWorld(true);
        const pending = world.races
            .filter(r => r.seriesId === seriesId && r.status !== 'completed')
            .sort((a, b) => (Number(a.round) || 999) - (Number(b.round) || 999) || (a.date || '').localeCompare(b.date || ''));
        if (!pending.length) throw new Error('No scheduled races left in this series.');

        const todo = onlyNext ? pending.slice(0, 1) : pending;
        for (const r of todo) await this.simulateRace(r.id, { quiet: true });

        const left = pending.length - todo.length;
        Util.notify(left
            ? `Simulated ${Util.plural(todo.length, 'race')} — ${left} still to run.`
            : `Season simulated! Crown the champion from Admin → Series → Seasons. 🏆`);
        return todo.length;
    },

    // Prize money + sponsor payouts land in real player wallets. AI earnings
    // are reflected in prestige, not cash.
    async payoutRace(race, world) {
        try {
            const owners = new Map(); // uid -> credit
            const credit = (uid, amt) => { if (uid && amt) owners.set(uid, (owners.get(uid) || 0) + amt); };
            const paidTeams = new Set();

            let sponsors = [];
            try { sponsors = await DB.list('sponsors', { force: true }); } catch (e) { /* not seeded */ }

            for (const res of race.results || []) {
                const driver = world.driversById[res.driverId];
                if (!driver) continue;
                const prize = this.prizeFor(res);
                credit(driver.ownerUid, prize);                                  // player driver
                const team = world.teamsById[driver.teamId];
                if (team?.ownerUid) {
                    credit(team.ownerUid, Math.round(prize * this.TEAM_SHARE)); // player team owner
                    if (!paidTeams.has(team.id)) {
                        paidTeams.add(team.id);
                        sponsors.filter(s => s.teamId === team.id)
                            .forEach(s => credit(team.ownerUid, Number(s.payoutPerRace) || 0));
                    }
                }
            }

            for (const [uid, amount] of owners) {
                const user = await DB.get('users', uid).catch(() => null);
                if (!user) continue;
                await DB.update('users', uid, { balance: (Number(user.balance) || 0) + amount }).catch(() => {});
                if (uid === Auth.uid()) await Auth.reloadProfile().catch(() => {});
            }
        } catch (e) { console.warn('Race payout failed:', e); }
    },

    // Silly-season churn: occasionally an AI driver walks, hitting the free
    // agent market where players can snag them (money + prestige permitting).
    async _maybeShakeup(world) {
        if (Math.random() > this.SHAKEUP_CHANCE) return;
        const candidates = world.drivers.filter(d => d.isNPC && d.teamId && !d.ownerUid);
        if (!candidates.length) return;
        const d = candidates[Math.floor(Math.random() * candidates.length)];
        const team = world.teamsById[d.teamId];
        try {
            await DB.update('drivers', d.id, { teamId: null });
            const contracts = await DB.contracts({ force: true }).catch(() => []);
            for (const c of contracts.filter(c => c.personId === d.id && c.status === 'active')) {
                await DB.update('contracts', c.id, { status: 'released', endedAt: Util.todayISO() });
            }
            News.post('💥', `Silly season! ${d.name} and ${team?.name || 'their team'} part ways — a ${Prestige.stars(Prestige.driverStars(d.id, world))} driver is on the market`);
        } catch (e) { console.warn('Shakeup failed:', e); }
    }
};
window.Sim = Sim;
