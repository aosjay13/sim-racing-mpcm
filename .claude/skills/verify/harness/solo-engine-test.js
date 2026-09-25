/* Solo Career engine soak test (Node, no browser).
   Plays complete careers for every game × role with a simple bot and
   checks world invariants after every round. Usage:
     node solo-engine-test.js            # all games, 40 seasons
     node solo-engine-test.js nr2003 5   # one game, 5 seasons      */
'use strict';
const path = require('path');
global.window = global;
const SOLO = path.join(__dirname, '../../../../sim-racing-career/js/solo');
['sc-tracks', 'sc-gamedb', 'sc-names', 'sc-engine', 'sc-import'].forEach(f => {
    try { require(path.join(SOLO, f + '.js')); } catch (e) { if (f !== 'sc-import') throw e; }
});
const E = SC.Engine;

const onlyGame = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : null;
const SEASONS = Number(process.argv[3]) || 40;
const problems = [];
const fail = (ctx, msg) => { problems.push(`${ctx}: ${msg}`); if (problems.length < 60) console.log('❌', ctx, msg); };

let botRng = 12345;
const r = () => { botRng = (botRng * 1103515245 + 12345) & 0x7fffffff; return botRng / 0x7fffffff; };

function finiteDeep(obj, pathStr, ctx, seen = new Set()) {
    if (obj === null || typeof obj !== 'object' || seen.has(obj)) return;
    seen.add(obj);
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'number' && !Number.isFinite(v)) { fail(ctx, `non-finite ${pathStr}.${k} = ${v}`); return; }
        if (v && typeof v === 'object') finiteDeep(v, pathStr + '.' + k, ctx, seen);
    }
}

function checkWorld(S, ctx) {
    const seen = new Map();
    for (const t of Object.values(S.teams)) {
        if (!t.sid) continue;
        for (const id of t.drivers) {
            if (seen.has(id)) fail(ctx, `driver ${id} in two teams (${seen.get(id)} & ${t.id})`);
            seen.set(id, t.id);
            if (id !== 'P' && !S.drivers[id]) fail(ctx, `team ${t.name} references missing driver ${id}`);
            if (id !== 'P' && S.drivers[id] && S.drivers[id].teamId !== t.id) fail(ctx, `driver ${id} teamId mismatch`);
        }
        if (t.drivers.length > t.cars) fail(ctx, `${t.name} has ${t.drivers.length} drivers for ${t.cars} cars`);
    }
    const P = S.player;
    if (P.role !== 'principal') {
        const holders = Object.values(S.teams).filter(t => t.sid && t.drivers.includes('P'));
        if (holders.length !== 1) fail(ctx, `player is on ${holders.length} teams`);
        else if (holders[0].id !== P.teamId) fail(ctx, `player teamId ${P.teamId} but racing for ${holders[0].id}`);
    }
    finiteDeep(S.player, 'player', ctx);
    for (const t of Object.values(S.teams)) if (t.player) finiteDeep(t, 'team', ctx);
}

function botPreseason(S) {
    const P = S.player;
    if (P.role === 'driver') {
        for (const o of S.sponsorOffers.filter(o => o.personal)) { try { E.signPersonalSponsor(S, o.id); } catch (e) { /* full */ } }
        if (!P.training && r() < 0.5) { try { E.startTraining(S, ['fitness', 'feedback', 'marketability'][Math.floor(r() * 3)]); } catch (e) { /* broke */ } }
        return;
    }
    const t = S.teams[P.teamId];
    for (const o of S.sponsorOffers.slice()) {
        if (o.personal) continue;
        if (E.sponsorSlotsFree(S, t, o.slot) > 0) { try { E.signSponsor(S, o.id); } catch (e) { /* */ } }
    }
    // fill seats
    let guard = 0;
    const seats = () => t.cars - t.drivers.length;
    while (seats() > 0 && guard++ < 5) {
        const m = E.marketFor(S).filter(x => !x.team).sort((a, b) => a.ask - b.ask);
        const cand = m[Math.floor(r() * Math.min(5, m.length))];
        if (!cand) break;
        try { E.hireDriver(S, cand.d.id, { years: 2 }); } catch (e) { /* too pricey */ }
    }
    // staff upgrade sometimes
    if (r() < 0.3 && S.staffPool.length) {
        const best = S.staffPool.slice().sort((a, b) => b.skill - a.skill)[0];
        try { E.hireStaff(S, best.id); } catch (e) { /* */ }
    }
    if (r() < 0.4) {
        const keys = Object.keys(E.FACILITIES);
        const k = keys[Math.floor(r() * keys.length)];
        const c = E.facilityCost(S, k);
        if (c && t.budget > c.cost * 3) { try { E.upgradeFacility(S, k); } catch (e) { /* */ } }
    }
}

function botRD(S) {
    const P = S.player;
    if (P.role === 'driver') return;
    const t = S.teams[P.teamId];
    if ((t.rd || []).length < E.rdSlots(t)) {
        const level = r() < 0.6 ? 'minor' : r() < 0.8 ? 'major' : 'breakthrough';
        const cost = E.rdCost(S, level);
        if (t.budget > cost * 4) {
            const area = ['engine', 'aero', 'chassis', 'rel', 'next'][Math.floor(r() * 5)];
            try { E.startRD(S, area, level); } catch (e) { /* */ }
        }
    }
}

function botRound(S) {
    const P = S.player;
    const ev = E.nextEvent(S);
    const N = E.driversIn(S, S.season.sid).length;
    if (P.role === 'principal') {
        const strategy = {};
        S.teams[P.teamId].drivers.forEach(id => { strategy[id] = ['push', 'balanced', 'conserve'][Math.floor(r() * 3)]; });
        return E.completeRound(S, { mode: 'sim', strategy });
    }
    if (r() < 0.3) return E.completeRound(S, { mode: 'sim' });
    if (ev.order && r() < 0.8) return E.completeRound(S, { mode: 'manual', player: { start: 1 + Math.floor(r() * N), dnf: true, dnfReason: 'mech', lapsDone: ev.order.at } });
    const skillBias = Math.min(0.9, Math.max(0.05, (P.dr - 40) / 60));
    const pos = Math.max(1, Math.min(N, Math.round(N * (1 - skillBias) * (0.3 + r() * 1.1))));
    const dnf = r() < 0.07;
    return E.completeRound(S, {
        mode: 'manual', player: {
            start: 1 + Math.floor(r() * N), pos: dnf ? null : pos, dnf, dnfReason: 'crash', led: Math.floor(r() * 10), fl: r() < 0.1,
            inc: Math.floor(r() * 5), damage: ['none', 'none', 'light', 'heavy'][Math.floor(r() * 4)], wrecks: ev.format === 'derby' ? Math.floor(r() * 5) : undefined
        }
    });
}

function botPostseason(S) {
    const P = S.player;
    if (P.role === 'driver') {
        if (S.offers.length && (!P.contract || P.contract.seasons <= 0 || r() < 0.3)) {
            const cur = E.seriesDef(S, P.sid).tier;
            const best = S.offers.slice().sort((a, b) => (E.seriesDef(S, a.sid).tier - E.seriesDef(S, b.sid).tier) || (b.salary - a.salary))[0];
            if (best && (!best.pay || P.money > Math.abs(best.salary))) {
                if (r() < 0.3) { try { E.counterOffer(S, best.id, 0.1); } catch (e) { /* */ } }
                if (S.offers.find(o => o.id === best.id)) E.acceptOffer(S, best.id);
            }
            void cur;
        }
        if (P.money > 3e6 && r() < 0.05) {
            const t = E.teamsIn(S, P.sid).filter(x => !x.player).sort((a, b) => E.teamPrice(S, a) - E.teamPrice(S, b))[0];
            if (t && E.teamPrice(S, t) < P.money) { try { E.buyTeam(S, t.id); } catch (e) { /* */ } }
        }
    } else if (P.role === 'owner') {
        const pr = S.postseason.promotion;
        const up = pr?.up.find(x => x.ok);
        if (up && r() < 0.7) E.changeSeries(S, up.sid);
    } else if (P.role === 'principal') {
        if (P.fired || P.contract.seasons <= 0 && P.board.confidence < 40) {
            const jobs = E.principalOffers(S);
            if (jobs[0]) E.takePrincipalJob(S, jobs[0].teamId);
            else E.takePrincipalJob(S, E.teamsIn(S, P.sid).filter(t => t.id !== P.teamId)[0].id);
        }
    }
}

function runCareer(gameId, seriesId, role, difficulty, seed) {
    const ctx = `${gameId}/${seriesId}/${role}/${difficulty}`;
    const t0 = Date.now();
    let S;
    try {
        S = E.newCareer({ gameId, seriesId, role, difficulty, seed, character: { first: 'Bot', last: 'Tester', nat: 'USA', age: 17, num: 42 }, teamName: 'Bot Racing', raceLength: 0.25, seasonLength: 'full' });
    } catch (e) { fail(ctx, 'newCareer threw: ' + e.stack); return null; }
    let rounds = 0;
    const tierPath = [];
    for (let season = 1; season <= SEASONS; season++) {
        try {
            botPreseason(S);
            E.beginSeason(S);
            while (S.phase === 'season') {
                botRD(S);
                const rep = botRound(S);
                if (!rep || !rep.ev.done) { fail(ctx, 'round did not complete'); break; }
                rounds++;
                if (rounds % 7 === 0) checkWorld(S, `${ctx} s${season}`);
            }
            if (S.phase !== 'postseason') { fail(ctx, `season ${season} ended in phase ${S.phase}`); break; }
            tierPath.push(E.seriesDef(S, S.history[S.history.length - 1].sid).tier);
            if (S.postseason.mustRetire) {
                if (season !== SEASONS && SEASONS === 40) fail(ctx, `mustRetire at season ${season}`);
                break;
            }
            botPostseason(S);
            E.advanceSeason(S);
            checkWorld(S, `${ctx} after rollover s${season}`);
        } catch (e) {
            fail(ctx, `season ${season}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`);
            break;
        }
    }
    if (SEASONS === 40) {
        if (!S.postseason?.mustRetire) fail(ctx, 'no forced retirement after 40 seasons');
        try {
            const hof = E.retire(S, 'forced');
            if (!hof || hof.seasons !== 40) fail(ctx, `HoF entry seasons=${hof && hof.seasons}`);
            if (S.phase !== 'retired') fail(ctx, 'phase not retired');
        } catch (e) { fail(ctx, 'retire threw ' + e.message); }
        try { E.advanceSeason(S); fail(ctx, 'advanced past retirement'); } catch (e) { /* expected */ }
    }
    const size = JSON.stringify(S).length;
    const ms = Date.now() - t0;
    return { ctx, rounds, ms, size, tiers: tierPath.join(''), money: Math.round(S.player.money), titles: S.player.career.titles, wins: S.player.career.w, dr: S.player.dr, team: S.teams[S.player.teamId]?.budget };
}

const games = SC.GAMES.filter(g => !onlyGame || g.id === onlyGame);
const results = [];
let seed = 1;
for (const g of games) {
    const ladders = SC.laddersOf(g);
    const entrySeries = ladders.map(L => L.series[0]); // entry rung of each ladder
    for (const role of ['driver', 'owner', 'principal']) {
        const sd = entrySeries[(seed) % entrySeries.length];
        const diff = ['easy', 'normal', 'hard', 'legend'][seed % 4];
        const res = runCareer(g.id, sd.id, role, diff, seed++);
        if (res) { results.push(res); console.log(`✅ ${res.ctx}: ${res.rounds} rounds, ${res.ms}ms, ${(res.size / 1024).toFixed(0)}KB, tiers ${res.tiers}, $${res.money}, titles ${res.titles}, wins ${res.wins}, dr ${res.dr}, team $${res.team}`); }
    }
}
// A top-tier start and a custom game.
const extra = [
    ['f1', 'f1', 'driver', 'normal'], ['nascar26', 'cup', 'owner', 'hard'], ['iracing', 'gp', 'principal', 'easy'], ['wreckfest', 'derbyleague', 'driver', 'normal']
];
for (const [g, s, role, d] of extra) {
    if (onlyGame && onlyGame !== g) continue;
    const res = runCareer(g, s, role, d, seed++);
    if (res) console.log(`✅ ${res.ctx}: ${res.rounds} rounds, ${res.ms}ms, ${(res.size / 1024).toFixed(0)}KB, tiers ${res.tiers}, $${res.money}, titles ${res.titles}, wins ${res.wins}`);
}
const maxSize = Math.max(...results.map(r => r.size));
console.log(`\n${results.length} careers, max save ${(maxSize / 1024).toFixed(0)}KB, ${problems.length} problem(s)`);
process.exit(problems.length ? 1 : 0);
