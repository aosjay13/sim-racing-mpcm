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
    // A dominant, title-winning season earns ~650 XP at the league's usual
    // ~9-round cadence — so Elite is a ~10-season career and Legend ~15.
    LEVELS: [
        { stars: 1, floor: 0,     name: 'Rookie' },
        { stars: 2, floor: 200,   name: 'Contender' },
        { stars: 3, floor: 2000,  name: 'Front Runner' },
        { stars: 4, floor: 6500,  name: 'Elite' },
        { stars: 5, floor: 10000, name: 'Legend' }
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
                if (p.role === 'series-owner' && ((p.seriesIds || []).includes(race.seriesId)
                    || (p.uid && series?.ownerUid === p.uid))) {
                    bump(personaUpd, p, this.HOST_XP + (race.results || []).length);
                } else if (p.role === 'track-owner' && race.track &&
                    (p.tracks || []).some(t => t.toLowerCase() === race.track.toLowerCase())) {
                    bump(personaUpd, p, this.VENUE_XP);
                } else if (p.role === 'agent' || p.role === 'crew-chief') {
                    const clientXP = (p.clientDriverIds || []).reduce((s, id) => s + (driverXP[id] || 0), 0);
                    bump(personaUpd, p, clientXP * this.XP_SHARE.agent);
                } else if (p.role === 'mechanic' && teamXP[p.teamId]) {
                    bump(personaUpd, p, teamXP[p.teamId] * this.XP_SHARE.staff);
                } else if (p.role === 'sponsor') {
                    const xp = (teamXP[p.sponsoredTeamId] || 0) + (driverXP[p.sponsoredDriverId] || 0);
                    bump(personaUpd, p, xp * this.XP_SHARE.sponsor);
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

/* ============================================================
   Track Packs — per-game track libraries. Installing one creates
   (or matches by name) the game and seeds its tracks tagged with
   that game's id, so the library, schedule builder, and race form
   can offer tracks for whatever game the league is playing.
   ============================================================ */
const TRACK_PACKS = {
    gt7: {
        game: { name: 'Gran Turismo 7', platform: 'PS5 / PS4', color: '#0070d1' },
        tracks: [
            { name: 'Suzuka Circuit', country: 'Japan', type: 'Road', length: '5.81 km' },
            { name: 'Fuji Speedway', country: 'Japan', type: 'Road', length: '4.56 km' },
            { name: 'Autodromo Nazionale Monza', country: 'Italy', type: 'Road', length: '5.79 km' },
            { name: 'Circuit de Spa-Francorchamps', country: 'Belgium', type: 'Road', length: '7.00 km' },
            { name: 'Nürburgring Nordschleife', country: 'Germany', type: 'Road', length: '20.83 km' },
            { name: 'Circuit de la Sarthe (Le Mans)', country: 'France', type: 'Road', length: '13.63 km' },
            { name: 'Autódromo José Carlos Pace (Interlagos)', country: 'Brazil', type: 'Road', length: '4.31 km' },
            { name: 'Mount Panorama Circuit (Bathurst)', country: 'Australia', type: 'Road', length: '6.21 km' },
            { name: 'WeatherTech Raceway Laguna Seca', country: 'USA', type: 'Road', length: '3.60 km' },
            { name: 'Daytona International Speedway', country: 'USA', type: 'Oval', length: '4.02 km' },
            { name: 'Watkins Glen International', country: 'USA', type: 'Road', length: '5.43 km' },
            { name: 'Willow Springs Raceway', country: 'USA', type: 'Road', length: '4.02 km' },
            { name: 'Tsukuba Circuit', country: 'Japan', type: 'Road', length: '2.05 km' },
            { name: 'Brands Hatch', country: 'UK', type: 'Road', length: '3.91 km' },
            { name: 'Circuit de Barcelona-Catalunya', country: 'Spain', type: 'Road', length: '4.66 km' },
            { name: 'Red Bull Ring', country: 'Austria', type: 'Road', length: '4.32 km' },
            { name: 'Autodrome Lago Maggiore', country: 'GT Original', type: 'Road', length: '5.81 km' },
            { name: 'Dragon Trail — Seaside', country: 'GT Original', type: 'Road', length: '5.21 km' },
            { name: 'Trial Mountain Circuit', country: 'GT Original', type: 'Road', length: '5.99 km' },
            { name: 'Deep Forest Raceway', country: 'GT Original', type: 'Road', length: '4.55 km' },
            { name: 'High Speed Ring', country: 'GT Original', type: 'Road', length: '4.10 km' },
            { name: 'Grand Valley Highway 1', country: 'GT Original', type: 'Road', length: '5.20 km' },
            { name: 'Tokyo Expressway — East', country: 'Japan', type: 'Street', length: '7.29 km' },
            { name: 'Special Stage Route X', country: 'GT Original', type: 'Oval', length: '30.28 km' },
            { name: 'Alsace — Village', country: 'GT Original', type: 'Road', length: '5.42 km' },
            { name: 'Kyoto Driving Park — Yamagiwa', country: 'GT Original', type: 'Road', length: '4.91 km' },
            { name: 'Sardegna — Road Track A', country: 'GT Original', type: 'Road', length: '5.11 km' },
            { name: "Fisherman's Ranch", country: 'GT Original', type: 'Rally', length: '6.65 km' },
            { name: 'Colorado Springs — Lake', country: 'GT Original', type: 'Rally', length: '4.05 km' }
        ]
    },
    wreckfest: {
        game: { name: 'Wreckfest', platform: 'PC / PS / Xbox', color: '#c8641e' },
        tracks: [
            { name: 'Big Valley Speedway', country: 'USA', type: 'Oval', length: '' },
            { name: 'Bloomfield Speedway', country: 'USA', type: 'Dirt', length: '' },
            { name: 'Bonebreaker Valley', country: 'USA', type: 'Road', length: '' },
            { name: 'Crash Canyon', country: 'USA', type: 'Road', length: '' },
            { name: 'Deathloop', country: 'USA', type: 'Road', length: '' },
            { name: 'Drytown Desert Circuit', country: 'USA', type: 'Dirt', length: '' },
            { name: 'Eagles Peak Motorpark', country: 'USA', type: 'Road', length: '' },
            { name: 'Espedalen Raceway', country: 'Finland', type: 'Dirt', length: '' },
            { name: 'Fire Rock Raceway', country: 'USA', type: 'Oval', length: '' },
            { name: 'Firwood Motocenter', country: 'Finland', type: 'Road', length: '' },
            { name: 'Hillstreet Circuit', country: 'USA', type: 'Street', length: '' },
            { name: 'Kingston Raceway', country: 'USA', type: 'Road', length: '' },
            { name: 'Madman Stadium', country: 'USA', type: 'Oval', length: '' },
            { name: 'Motorcity Circuit', country: 'USA', type: 'Road', length: '' },
            { name: 'Northland Raceway', country: 'Finland', type: 'Road', length: '' },
            { name: 'Pinehills Raceway', country: 'USA', type: 'Road', length: '' },
            { name: 'Rattlesnake Racepark', country: 'USA', type: 'Road', length: '' },
            { name: 'Rockfield Roughspot', country: 'UK', type: 'Dirt', length: '' },
            { name: 'Sandstone Raceway', country: 'USA', type: 'Road', length: '' },
            { name: 'Savolax Sandpit', country: 'Finland', type: 'Dirt', length: '' },
            { name: 'Speedbowl', country: 'USA', type: 'Oval', length: '' },
            { name: 'Vale Falls Circuit', country: 'USA', type: 'Road', length: '' }
        ]
    },
    forza: {
        game: { name: 'Forza Motorsport', platform: 'Xbox / PC', color: '#e6b31e' },
        tracks: [
            { name: 'Maple Valley Raceway', country: 'Forza Original', type: 'Road', length: '4.20 km' },
            { name: 'Grand Oak Raceway', country: 'Forza Original', type: 'Road', length: '4.30 km' },
            { name: 'Hakone Circuit', country: 'Forza Original', type: 'Road', length: '5.10 km' },
            { name: 'Eaglerock Speedway', country: 'Forza Original', type: 'Oval', length: '1.61 km' },
            { name: 'Circuit de Spa-Francorchamps', country: 'Belgium', type: 'Road', length: '7.00 km' },
            { name: 'Silverstone Circuit', country: 'UK', type: 'Road', length: '5.89 km' },
            { name: 'Suzuka Circuit', country: 'Japan', type: 'Road', length: '5.81 km' },
            { name: 'WeatherTech Raceway Laguna Seca', country: 'USA', type: 'Road', length: '3.60 km' },
            { name: 'Road America', country: 'USA', type: 'Road', length: '6.51 km' },
            { name: 'Watkins Glen International', country: 'USA', type: 'Road', length: '5.43 km' },
            { name: 'Circuit de la Sarthe (Le Mans)', country: 'France', type: 'Road', length: '13.63 km' },
            { name: 'Nürburgring GP', country: 'Germany', type: 'Road', length: '5.15 km' },
            { name: 'Nürburgring Nordschleife', country: 'Germany', type: 'Road', length: '20.83 km' },
            { name: 'Kyalami Grand Prix Circuit', country: 'South Africa', type: 'Road', length: '4.52 km' },
            { name: 'Road Atlanta', country: 'USA', type: 'Road', length: '4.09 km' },
            { name: 'Mid-Ohio Sports Car Course', country: 'USA', type: 'Road', length: '3.86 km' },
            { name: 'Virginia International Raceway', country: 'USA', type: 'Road', length: '5.26 km' },
            { name: 'Lime Rock Park', country: 'USA', type: 'Road', length: '2.45 km' },
            { name: 'Hockenheimring', country: 'Germany', type: 'Road', length: '4.57 km' },
            { name: 'Circuit de Barcelona-Catalunya', country: 'Spain', type: 'Road', length: '4.66 km' },
            { name: 'Yas Marina Circuit', country: 'UAE', type: 'Road', length: '5.28 km' },
            { name: 'Mugello Circuit', country: 'Italy', type: 'Road', length: '5.25 km' },
            { name: 'Daytona International Speedway', country: 'USA', type: 'Oval', length: '4.02 km' },
            { name: 'Homestead-Miami Speedway', country: 'USA', type: 'Oval', length: '2.41 km' },
            { name: 'Indianapolis Motor Speedway', country: 'USA', type: 'Oval', length: '4.02 km' }
        ]
    },
    iracing: {
        game: { name: 'iRacing', platform: 'PC', color: '#0090d4' },
        tracks: [
            { name: 'Daytona International Speedway', country: 'USA', type: 'Oval', length: '4.02 km' },
            { name: 'Talladega Superspeedway', country: 'USA', type: 'Oval', length: '4.28 km' },
            { name: 'Charlotte Motor Speedway', country: 'USA', type: 'Oval', length: '2.41 km' },
            { name: 'Bristol Motor Speedway', country: 'USA', type: 'Oval', length: '0.86 km' },
            { name: 'Martinsville Speedway', country: 'USA', type: 'Oval', length: '0.85 km' },
            { name: 'Richmond Raceway', country: 'USA', type: 'Oval', length: '1.21 km' },
            { name: 'Darlington Raceway', country: 'USA', type: 'Oval', length: '2.20 km' },
            { name: 'Phoenix Raceway', country: 'USA', type: 'Oval', length: '1.61 km' },
            { name: 'Iowa Speedway', country: 'USA', type: 'Oval', length: '1.41 km' },
            { name: 'Watkins Glen International', country: 'USA', type: 'Road', length: '5.43 km' },
            { name: 'Road America', country: 'USA', type: 'Road', length: '6.51 km' },
            { name: 'WeatherTech Raceway Laguna Seca', country: 'USA', type: 'Road', length: '3.60 km' },
            { name: 'Sebring International Raceway', country: 'USA', type: 'Road', length: '6.02 km' },
            { name: 'Circuit de Spa-Francorchamps', country: 'Belgium', type: 'Road', length: '7.00 km' },
            { name: 'Autodromo Nazionale Monza', country: 'Italy', type: 'Road', length: '5.79 km' },
            { name: 'Silverstone Circuit', country: 'UK', type: 'Road', length: '5.89 km' },
            { name: 'Suzuka Circuit', country: 'Japan', type: 'Road', length: '5.81 km' },
            { name: 'Nürburgring Nordschleife', country: 'Germany', type: 'Road', length: '20.83 km' },
            { name: 'Mount Panorama Circuit (Bathurst)', country: 'Australia', type: 'Road', length: '6.21 km' },
            { name: 'Autodromo Enzo e Dino Ferrari (Imola)', country: 'Italy', type: 'Road', length: '4.91 km' },
            { name: 'Circuit of the Americas', country: 'USA', type: 'Road', length: '5.51 km' },
            { name: 'Long Beach Street Circuit', country: 'USA', type: 'Street', length: '3.17 km' },
            { name: 'Brands Hatch', country: 'UK', type: 'Road', length: '3.91 km' },
            { name: 'Donington Park', country: 'UK', type: 'Road', length: '4.02 km' },
            { name: 'Okayama International Circuit', country: 'Japan', type: 'Road', length: '3.70 km' },
            { name: 'Lime Rock Park', country: 'USA', type: 'Road', length: '2.45 km' },
            { name: 'Oulton Park', country: 'UK', type: 'Road', length: '4.33 km' }
        ]
    },
    ams2: {
        game: { name: 'Automobilista 2', platform: 'PC', color: '#ffcc00' },
        tracks: [
            { name: 'Autódromo José Carlos Pace (Interlagos)', country: 'Brazil', type: 'Road', length: '4.31 km' },
            { name: 'Autódromo Internacional de Goiânia', country: 'Brazil', type: 'Road', length: '3.84 km' },
            { name: 'Autódromo Internacional de Curitiba', country: 'Brazil', type: 'Road', length: '3.70 km' },
            { name: 'Autódromo Ayrton Senna (Londrina)', country: 'Brazil', type: 'Road', length: '3.15 km' },
            { name: 'Autódromo Zilmar Beux (Cascavel)', country: 'Brazil', type: 'Road', length: '3.30 km' },
            { name: 'Velopark', country: 'Brazil', type: 'Road', length: '2.27 km' },
            { name: 'Autódromo Internacional de Campo Grande', country: 'Brazil', type: 'Road', length: '3.43 km' },
            { name: 'Autódromo Internacional de Santa Cruz do Sul', country: 'Brazil', type: 'Road', length: '3.53 km' },
            { name: 'Autódromo Internacional de Tarumã', country: 'Brazil', type: 'Road', length: '3.07 km' },
            { name: 'Autódromo Internacional Nelson Piquet (Jacarepaguá)', country: 'Brazil', type: 'Road', length: '5.03 km' },
            { name: 'Autódromo de Brasília', country: 'Brazil', type: 'Road', length: '5.48 km' },
            { name: 'Circuit de Spa-Francorchamps', country: 'Belgium', type: 'Road', length: '7.00 km' },
            { name: 'Silverstone Circuit', country: 'UK', type: 'Road', length: '5.89 km' },
            { name: 'Brands Hatch', country: 'UK', type: 'Road', length: '3.91 km' },
            { name: 'Donington Park', country: 'UK', type: 'Road', length: '4.02 km' },
            { name: 'Oulton Park', country: 'UK', type: 'Road', length: '4.33 km' },
            { name: 'Cadwell Park', country: 'UK', type: 'Road', length: '3.50 km' },
            { name: 'Snetterton Circuit', country: 'UK', type: 'Road', length: '4.78 km' },
            { name: 'Autodromo Enzo e Dino Ferrari (Imola)', country: 'Italy', type: 'Road', length: '4.91 km' },
            { name: 'Autodromo Nazionale Monza', country: 'Italy', type: 'Road', length: '5.79 km' },
            { name: 'Nürburgring GP', country: 'Germany', type: 'Road', length: '5.15 km' },
            { name: 'Hockenheimring', country: 'Germany', type: 'Road', length: '4.57 km' },
            { name: 'Red Bull Ring (Spielberg)', country: 'Austria', type: 'Road', length: '4.32 km' },
            { name: 'Circuito de Jerez', country: 'Spain', type: 'Road', length: '4.42 km' },
            { name: 'Circuito do Estoril', country: 'Portugal', type: 'Road', length: '4.18 km' },
            { name: 'Kyalami Grand Prix Circuit', country: 'South Africa', type: 'Road', length: '4.52 km' },
            { name: 'WeatherTech Raceway Laguna Seca', country: 'USA', type: 'Road', length: '3.60 km' },
            { name: 'Road America', country: 'USA', type: 'Road', length: '6.51 km' },
            { name: 'Watkins Glen International', country: 'USA', type: 'Road', length: '5.43 km' },
            { name: 'Daytona International Speedway', country: 'USA', type: 'Oval', length: '4.02 km' },
            { name: 'Sebring International Raceway', country: 'USA', type: 'Road', length: '6.02 km' },
            { name: 'Long Beach Street Circuit', country: 'USA', type: 'Street', length: '3.17 km' },
            { name: 'Azure Circuit', country: 'Monaco', type: 'Street', length: '3.34 km' }
        ]
    },
    nr2003: {
        game: { name: 'NASCAR Racing 2003 Season', platform: 'PC', color: '#bb2222' },
        tracks: [
            { name: 'Atlanta Motor Speedway', country: 'USA', type: 'Oval', length: '2.48 km' },
            { name: 'Bristol Motor Speedway', country: 'USA', type: 'Oval', length: '0.86 km' },
            { name: 'California Speedway', country: 'USA', type: 'Oval', length: '3.22 km' },
            { name: 'Charlotte (Lowe’s) Motor Speedway', country: 'USA', type: 'Oval', length: '2.41 km' },
            { name: 'Chicagoland Speedway', country: 'USA', type: 'Oval', length: '2.41 km' },
            { name: 'Darlington Raceway', country: 'USA', type: 'Oval', length: '2.20 km' },
            { name: 'Daytona International Speedway', country: 'USA', type: 'Oval', length: '4.02 km' },
            { name: 'Dover International Speedway', country: 'USA', type: 'Oval', length: '1.61 km' },
            { name: 'Homestead-Miami Speedway', country: 'USA', type: 'Oval', length: '2.41 km' },
            { name: 'Indianapolis Motor Speedway', country: 'USA', type: 'Oval', length: '4.02 km' },
            { name: 'Kansas Speedway', country: 'USA', type: 'Oval', length: '2.41 km' },
            { name: 'Las Vegas Motor Speedway', country: 'USA', type: 'Oval', length: '2.41 km' },
            { name: 'Martinsville Speedway', country: 'USA', type: 'Oval', length: '0.85 km' },
            { name: 'Michigan International Speedway', country: 'USA', type: 'Oval', length: '3.22 km' },
            { name: 'New Hampshire International Speedway', country: 'USA', type: 'Oval', length: '1.70 km' },
            { name: 'North Carolina Speedway (Rockingham)', country: 'USA', type: 'Oval', length: '1.63 km' },
            { name: 'Phoenix International Raceway', country: 'USA', type: 'Oval', length: '1.61 km' },
            { name: 'Pocono Raceway', country: 'USA', type: 'Oval', length: '4.02 km' },
            { name: 'Richmond International Raceway', country: 'USA', type: 'Oval', length: '1.21 km' },
            { name: 'Talladega Superspeedway', country: 'USA', type: 'Oval', length: '4.28 km' },
            { name: 'Texas Motor Speedway', country: 'USA', type: 'Oval', length: '2.41 km' },
            { name: 'Infineon Raceway (Sears Point)', country: 'USA', type: 'Road', length: '3.22 km' },
            { name: 'Watkins Glen International', country: 'USA', type: 'Road', length: '3.94 km' }
        ]
    }
};
window.TRACK_PACKS = TRACK_PACKS;

// Install one game's track pack: create (or match by name) the game doc,
// then seed its tracks tagged with that gameId. A track is skipped only if
// the SAME game already has it — the same circuit in two different games is
// two library entries on purpose.
async function installTrackPack(packKey, gameId = null) {
    const pack = TRACK_PACKS[packKey];
    if (!pack) throw new Error('Unknown track pack.');

    const games = await DB.games({ force: true });
    if (!gameId) {
        const existing = games.find(g => (g.name || '').toLowerCase() === pack.game.name.toLowerCase());
        gameId = existing ? existing.id
            : await DB.create('games', { ...pack.game, active: true });
    }
    const game = (await DB.games({ force: true })).find(g => g.id === gameId);

    const existingTracks = await DB.tracks({ force: true }).catch(() => []);
    const mine = new Set(existingTracks.filter(t => (t.gameId || null) === gameId)
        .map(t => (t.name || '').toLowerCase()));
    const fresh = pack.tracks.filter(t => !mine.has(t.name.toLowerCase()));
    if (fresh.length) await DB.batchCreate('tracks', fresh.map(t => ({ ...t, gameId, isNPC: true })));

    return { game, gameId, created: fresh.length, skipped: pack.tracks.length - fresh.length };
}
window.installTrackPack = installTrackPack;

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
// (matched by name) so re-running never duplicates. Pass a gameId to tag
// every track, series, season, and race it creates with that game.
async function installRealWorldPack(gameId = null) {
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
    // Skip only tracks the SAME game already has (or untagged ones, pre-pack).
    const mineTracks = existingTracks.filter(t => (t.gameId || null) === (gameId || null) || !t.gameId);
    const newTracks = REAL_TRACKS.filter(t => !has(mineTracks, t.name));
    if (newTracks.length) {
        await DB.batchCreate('tracks', newTracks.map(t => ({ ...t, gameId: gameId || null, isNPC: true })));
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
            name: pack.name, description: pack.description, gameId: gameId || null,
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
            seriesId, gameId: gameId || null, name: `${pack.name} ${year}`, year,
            status: 'active', startDate: Util.todayISO(), endDate: null,
            ownerUid: null, championDriverId: null, championTeamId: null
        });
        summary.seasons++;

        // Full-season schedule, one round a week starting next Saturday.
        const start = new Date();
        start.setDate(start.getDate() + ((6 - start.getDay() + 7) % 7 || 7));
        const races = generateScheduleRaces({
            series: { id: seriesId, name: pack.name, gameId: gameId || null },
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

        // Telemetry for performance clauses: incidents, laps led, laps done.
        // The winner and pole-sitter split most of the leading; front-runners
        // stay cleaner than the midfield scrap.
        const laps = Number(race.laps) || 20;
        const ledPool = [finishers[0], finishers[1], quali[0] && finishers.find(f => f.d.id === quali[0].d.id)]
            .filter(Boolean);
        const results = [
            ...finishers.map((r, i) => ({
                driverId: r.d.id, position: i + 1, dnf: false,
                pole: r.d.id === poleId, fastestLap: r.d.id === flId,
                incidents: Math.random() < (i < 3 ? 0.55 : 0.35) ? 0 : 1 + Math.floor(Math.random() * 3),
                lapsLed: ledPool.some(p => p.d.id === r.d.id) ? Math.max(1, Math.floor(laps * (i === 0 ? 0.5 : 0.2) * Math.random() + (i === 0 ? laps * 0.2 : 0))) : 0,
                lapsCompleted: laps
            })),
            ...runners.filter(r => r.dnf).map(r => ({
                driverId: r.d.id, position: null, dnf: true,
                pole: r.d.id === poleId, fastestLap: false,
                incidents: 1 + Math.floor(Math.random() * 4),
                lapsLed: 0, lapsCompleted: Math.floor(laps * Math.random() * 0.9)
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

    // Race-day settlement: everything the league owes anyone moves when a
    // race completes. Prize money, team shares, brand-sponsor payouts,
    // CONTRACT SALARIES (owners pay, talent collects), sponsorship deals,
    // agent commissions, venue hosting fees, promoter fees, crew stipends —
    // all landing in real player wallets with a ledger entry each. AI money
    // comes from / vanishes into the league (their reward is prestige).
    VENUE_FEE_BASE: 100,          // player track owners: base + per-entrant when their venue hosts
    VENUE_FEE_PER_ENTRANT: 20,
    PROMOTER_FEE_PER_ENTRANT: 50, // player series owners: per entrant in their series' races
    CREW_STIPEND: 100,            // player crew-chief/mechanic personas attached to a team that raced

    async payoutRace(race, world) {
        try {
            const results = race.results || [];
            const raceName = race.name || race.track || 'race';
            // { wallet: {type:'player'|'team', id}, amount, icon, label } — one
            // ledger row each. Team money (payroll debits, prize/sponsor
            // shares) targets teams/{id}.budget via addTeam; personal money
            // (driver winnings, staff/agent/persona earnings) targets
            // users/{uid}.balance via add — two isolated wallets, never
            // conflated even when the same human owns both.
            const tx = [];
            const add = (uid, amount, icon, label) => {
                amount = Math.round(Number(amount) || 0);
                if (uid && amount) tx.push({ wallet: { type: 'player', id: uid }, amount, icon, label, refId: race.id || null });
            };
            const addTeam = (teamId, amount, icon, label) => {
                amount = Math.round(Number(amount) || 0);
                if (teamId && amount) tx.push({ wallet: { type: 'team', id: teamId }, amount, icon, label, refId: race.id || null });
            };

            let sponsors = [], contracts = [], profiles = [];
            try { sponsors = await DB.list('sponsors', { force: true }); } catch (e) { /* not seeded */ }
            try { contracts = (await DB.contracts({ force: true })).filter(c => c.status === 'active'); } catch (e) { /* none */ }
            try { profiles = await DB.roleProfiles({ force: true }); } catch (e) { /* none */ }

            const racedTeams = new Set();
            const racedDrivers = new Set(results.map(r => r.driverId));

            /* -- 1. Prize money + team owner's share -- */
            for (const res of results) {
                const driver = world.driversById[res.driverId];
                if (!driver) continue;
                const prize = this.prizeFor(res);
                add(driver.ownerUid, prize, '🏆', `Prize money — ${raceName}`);
                const team = world.teamsById[driver.teamId];
                if (team) {
                    racedTeams.add(team.id);
                    if (team.ownerUid) addTeam(team.id, Math.round(prize * this.TEAM_SHARE), '🏆', `Team share: ${driver.name} — ${raceName}`);
                }
            }

            /* -- 2. Brand sponsors pay the team's budget for every team that raced -- */
            for (const teamId of racedTeams) {
                const team = world.teamsById[teamId];
                if (!team?.ownerUid) continue;
                sponsors.filter(s => s.teamId === teamId)
                    .forEach(s => addTeam(teamId, s.payoutPerRace, '💰', `Sponsor payout: ${s.name} — ${raceName}`));
            }

            /* -- 3. Contract salaries: TEAM pays (budget), talent collects
                  (personal wallet) — the internal-payout case (owner hiring
                  their own driver persona) is just this same code path; the
                  two wallets are different documents so it's never a no-op. -- */
            const hires = contracts.filter(c => c.type !== 'sponsorship');
            for (const c of hires) {
                const isDriver = c.personKind === 'driver';
                const due = isDriver ? racedDrivers.has(c.personId) : racedTeams.has(c.teamId);
                if (!due || !c.salary) continue;
                const team = world.teamsById[c.teamId];
                if (team?.ownerUid) addTeam(team.id, -c.salary, '💼', `Payroll: ${c.personName} — ${raceName}`);
                // Player talent collects: drivers via their driver doc, player
                // crew (crew chief / mechanic / agent) via personUid on the contract.
                const paidUid = c.personUid || (isDriver ? world.driversById[c.personId]?.ownerUid : null);
                add(paidUid, c.salary, '💼', `Salary from ${c.teamName || 'team'} — ${raceName}`);
            }

            /* -- 3.5 Contract performance clauses: evaluated against this race's
                  result, paid in the same settlement, one ledger row per clause.
                  Drivers ride their own result; staff ride the team's best car.
                  Missing telemetry ⇒ the clause simply doesn't fire. -- */
            for (const c of hires.filter(c => c.clauses && c.status === 'active')) {
                const isDriver = c.personKind === 'driver';
                let payouts = [];
                if (isDriver) {
                    const res = results.find(r => r.driverId === c.personId);
                    if (res) payouts = Clauses.forRace(c, race, res);
                } else if (racedTeams.has(c.teamId)) {
                    payouts = Clauses.forRaceStaff(c, race, world);
                }
                if (!payouts.length) continue;
                const team = world.teamsById[c.teamId];
                const paidUid = c.personUid || (isDriver ? world.driversById[c.personId]?.ownerUid : null);
                for (const p of payouts) {
                    if (team?.ownerUid) addTeam(team.id, -p.amount, '📜', `Clause paid: ${p.label} — ${c.personName} — ${raceName}`);
                    add(paidUid, p.amount, '📜', `${p.label} bonus — ${raceName}`);
                }
            }

            /* -- 4. Sponsorship deals (negotiated): sponsor pays personally (a
                  sponsor persona's own wallet — not a team). The target's side
                  is TEAM money when the deal backs a team, personal when it
                  backs a driver directly. -- */
            for (const c of contracts.filter(c => c.type === 'sponsorship')) {
                const due = c.teamId ? racedTeams.has(c.teamId) : racedDrivers.has(c.driverId);
                if (!due || !c.salary) continue;
                add(c.sponsorUid, -c.salary, '🤝', `Sponsorship paid: ${c.teamName || c.driverName} — ${raceName}`);
                if (c.teamId) {
                    if (world.teamsById[c.teamId]?.ownerUid) addTeam(c.teamId, c.salary, '🤝', `Sponsorship from ${c.sponsorName} — ${raceName}`);
                } else {
                    add(world.driversById[c.driverId]?.ownerUid, c.salary, '🤝', `Sponsorship from ${c.sponsorName} — ${raceName}`);
                }
            }

            /* -- 5. Player role personas earn their cut -- */
            const playerProfiles = profiles.filter(p => p.uid);
            // Agents: commission on every contracted client who raced.
            for (const p of playerProfiles.filter(p => p.role === 'agent')) {
                for (const clientId of (p.clientDriverIds || []).filter(id => racedDrivers.has(id))) {
                    const c = hires.find(c => c.personKind === 'driver' && c.personId === clientId && c.salary);
                    const salary = c?.salary || world.driversById[clientId]?.salary || 0;
                    if (salary) add(p.uid, salary * Deals.AGENT_COMMISSION, '💼', `Agent commission: ${world.driversById[clientId]?.name || 'client'} — ${raceName}`);
                }
            }
            // Track owners: hosting fee when their venue hosts a league race.
            if (race.track) {
                playerProfiles.filter(p => p.role === 'track-owner' &&
                    (p.tracks || []).some(t => t.toLowerCase() === race.track.toLowerCase()))
                    .forEach(p => add(p.uid, this.VENUE_FEE_BASE + this.VENUE_FEE_PER_ENTRANT * results.length, '🛣️', `Hosting fee: ${race.track}`));
            }
            // Series owners: promoter fee per entrant.
            playerProfiles.filter(p => p.role === 'series-owner' &&
                ((p.seriesIds || []).includes(race.seriesId) || (world.seriesById[race.seriesId]?.ownerUid === p.uid)))
                .forEach(p => add(p.uid, this.PROMOTER_FEE_PER_ENTRANT * results.length, '🏆', `Promoter fee — ${raceName}`));
            // Crew personas attached to a team that raced.
            playerProfiles.filter(p => (p.role === 'crew-chief' || p.role === 'mechanic') && racedTeams.has(p.teamId))
                .forEach(p => add(p.uid, this.CREW_STIPEND, '🔧', `Race-day crew stipend — ${raceName}`));

            /* -- Apply: one balance write per wallet (players and teams
                  batched separately), one ledger row per line, every row
                  tagged with the wallet it actually moved. -- */
            await Wallet.applyBatch(tx);

            // Post-race solvency check: any team whose budget moved this race is
            // re-evaluated (a completed race advances the repossession fuse).
            const touchedTeams = [...new Set(tx.filter(l => l.wallet?.type === 'team').map(l => l.wallet.id))];
            for (const id of touchedTeams) {
                try { await Insolvency.evaluate(id, { raceCompleted: true }); } catch (e) { console.warn('Solvency eval failed:', e); }
            }

            // Car numbers: credit any owned number whose owner ran this race
            // toward its use-it-or-lose-it season quota.
            try { await Numbers.recordFielded(race, world); } catch (e) { console.warn('Number fielding failed:', e); }
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
