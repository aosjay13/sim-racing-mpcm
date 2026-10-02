/* Pure checks for js/race-rules.js (RaceRules) and the results-file
   metadata reader in js/solo/sc-import.js (SC.Import.meta):
   equipment formats, tech inspection, team efficiency, pace / AI-tip
   direction, per-game translation (iRacing per model, ACC / AC per entry,
   Wreckfest PP allowance), success ballast, race codes, track and car
   matching, result checks on real-format files, screenshot text checks,
   entry lists, and the importer fixes (iRacing car numbers, AC server JSON).
   Run: node race-rules-test.js   (no browser) */
const path = require('path');
const fs = require('fs');
global.window = global;
require('../../../../sim-racing-career/js/solo/sc-tracks.js');
require('../../../../sim-racing-career/js/solo/sc-gamedb.js');
require('../../../../sim-racing-career/js/solo/sc-import.js');
const PC = require('../../../../sim-racing-career/js/paddock-core.js');
const RR = require('../../../../sim-racing-career/js/race-rules.js');
const I = SC.Import;
const FIX = path.join(__dirname, 'fixtures');

let pass = 0, fail = 0;
const log = (ok, msg) => { if (ok) pass++; else fail++; console.log(ok ? '✅' : '❌', msg); };
const fixture = (f) => I.decode(fs.readFileSync(path.join(FIX, f)));

/* ---------------- formats ---------------- */
{
    const ir = SC.game('iracing'), acc = SC.game('acc'), wf = SC.game('wreckfest');
    const mx5 = SC.seriesOf(ir, 'mx5'), cup = SC.seriesOf(ir, 'cup'), street = SC.seriesOf(ir, 'streetstock'), gt3 = acc.series.find(s => /GTWC Sprint/i.test(s.short));
    const d = { mx5: RR.defaultFormat(mx5, ir), cup: RR.defaultFormat(cup, ir), street: RR.defaultFormat(street, ir), gt3: RR.defaultFormat(gt3, acc), wf: RR.defaultFormat(wf.series[0], wf) };
    log(d.mx5 === 'spec' && d.cup === 'spec' && d.street === 'open' && d.gt3 === 'bop' && d.wf === 'open',
        `Library defaults: MX-5 Cup ${d.mx5}, Next Gen Cup ${d.cup}, Street Stock ${d.street}, GT3 ${d.gt3}, Wreckfest ${d.wf}`);
    const r = RR.rules({ format: 'bop', bop: [{ car: 'Porsche 992 GT3 R', weightKg: 15, powerPct: 98 }], ballast: { mode: 'standings', steps: ['30', 20, 'x'] }, cap: { label: '' } });
    log(r.format === 'bop' && r.explicit && r.ballast.steps.join() === '30,20' && r.cap === null && r.kgPerPlace === 10, 'Stored rules normalise (steps, empty cap, defaults)');
    const bop = RR.parseBop('Porsche 992 GT3 R | 15 | 98\nFerrari 296 GT3 | 0 | 100 | 2\n\n | 5');
    log(bop.length === 2 && bop[1].restrictorPct === 2 && RR.parseBop(RR.bopText(bop)).length === 2, 'BoP table text ⇄ rows round-trips');
}

/* ---------------- tech inspection ---------------- */
{
    const car = PC.ensureCar({ name: 'Cup car', stats: { performance: 6 }, parts: { engine: { tier: 2, eff: 1 }, cage: { tier: 1, eff: 1 }, cooling: { tier: 1, eff: 1 } }, tune: 1 });
    const spec = RR.inspect(car, RR.rules({ format: 'spec' }), { PARTS: PC.PARTS, pi: PC.pi(car) });
    log(!spec.legal && spec.issues.length === 2 && spec.issues.some(i => i.part === 'engine') && spec.issues.some(i => i.code === 'tune') && !spec.issues.some(i => i.part === 'cage' || i.part === 'cooling'),
        `Spec: engine build + dyno tune illegal, cage + cooling legal (${spec.issues.map(i => i.part).join(', ')})`);
    const openCap = RR.inspect(car, RR.rules({ format: 'open', cap: { pi: 50 } }), { PARTS: PC.PARTS, pi: PC.pi(car) });
    const openOk = RR.inspect(car, RR.rules({ format: 'open', cap: { pi: 90 } }), { PARTS: PC.PARTS, pi: PC.pi(car) });
    log(!openCap.legal && openCap.issues[0].code === 'pi' && openOk.legal, `Open: PI ${PC.pi(car)} fails a 50 limit, passes 90`);
    // Remove a part → it goes on the shelf; refitting it costs labour only.
    const r = PC.rng('rm');
    const q = PC.quote(car, { service: 'remove', part: 'engine' }, PC.SHOPS.mainst);
    const off = PC.performJob(car, { service: 'remove', part: 'engine' }, 1, 0, r).car;
    const offTune = PC.performJob(off, { service: 'remove', part: 'tune' }, 1, 0, r).car;
    const refit = PC.quote(offTune, { service: 'install', part: 'engine', tier: 2 }, PC.SHOPS.mainst);
    const legalNow = RR.inspect(offTune, RR.rules({ format: 'spec' }), { PARTS: PC.PARTS, pi: PC.pi(offTune) });
    log(q.total > 0 && !off.parts.engine && off.shelf.engine?.tier === 2 && offTune.tune === 0 && refit.parts === 0 && refit.labor > 0 && legalNow.legal
        && PC.removable(car).length === 4 && PC.diyAllowed({ service: 'remove', part: 'engine' }, 3) && !PC.diyAllowed({ service: 'remove', part: 'engine' }, 2),
        `Remove a part: $${q.total} at a shop, kept on the shelf, refit for labour only ($${refit.labor}); now spec-legal`);
}

/* ---------------- efficiency, pace, AI tip ---------------- */
{
    const works = RR.efficiency({ staff: [{ role: 'crew-chief', rating: 92 }, { role: 'race-engineer', rating: 90 }, { role: 'mechanic', rating: 88 }, { role: 'spotter', rating: 85 }], workshop: 5, prep: 98, crewStars: 3, briefed: true });
    const garage = RR.efficiency({ workshop: 1, prep: 70, selfMech: 40, broke: true });
    log(works.score > 90 && works.grade === 'A' && garage.score < 55 && ['D', 'E'].includes(garage.grade),
        `Efficiency: works team ${works.score} (${works.grade}) vs broke privateer ${garage.score} (${garage.grade})`);
    const specGap = RR.paceBonus('spec', { eff: works.score, cond: 98 }) - RR.paceBonus('spec', { eff: garage.score, cond: 70 });
    const openGap = RR.paceBonus('open', { pi: 75, eff: 60, ref: 55 }) - RR.paceBonus('open', { pi: 50, eff: 60, ref: 55 });
    log(specGap > 3 && specGap < 10 && openGap > 3, `Pace: spec gap from efficiency ${specGap.toFixed(1)}, open gap from equipment ${openGap.toFixed(1)}`);
    const tipFast = RR.aiTip('open', { pi: 75, eff: 70, ref: 55 }), tipSlow = RR.aiTip('open', { pi: 40, eff: 70, ref: 55 });
    log(tipFast > 0 && tipSlow < 0 && /lower/.test(RR.aiTipText(tipFast)) && /raise/.test(RR.aiTipText(tipSlow)) && PC.aiOffset(PC.ensureCar({ stats: { performance: 9 } })) > 0,
        `AI tip: a better car LOWERS the AI (+${tipFast}: "${RR.aiTipText(tipFast)}"), a worse one raises it (${tipSlow})`);
    log(Math.abs(RR.aiTip('spec', { eff: 100, cond: 100 })) <= 3 && RR.riskMult(90) < RR.riskMult(40) && RR.wearMult(90) < 1,
        `Spec tip capped at ±3; well-run teams break less (×${RR.riskMult(90).toFixed(2)}) and wear less (×${RR.wearMult(90).toFixed(2)})`);
    const healthy = PC.ensureCar({ stats: { durability: 3 }, cond: { engine: 35, gearbox: 40, suspension: 40, brakes: 40, tyres: 40, body: 40 } });
    let a = 0, b = 0;
    for (let i = 0; i < 400; i++) { if (PC.gremlinCheck(healthy, { seed: 'g' + i, riskMult: 0.6 }).fails) a++; if (PC.gremlinCheck(healthy, { seed: 'g' + i, riskMult: 1.3 }).fails) b++; }
    log(a < b, `Gremlins follow efficiency: ${a}/400 failures for a top team vs ${b}/400 for a poor one`);
}

/* ---------------- per-game translation ---------------- */
{
    const open = RR.rules({ format: 'open', cap: { label: 'C', gameMin: 120, gameMax: 164, pi: 70 }, ballast: { mode: 'standings', steps: [30, 20, 10] } });
    const acc = RR.entryAdjust(open, 'acc', { pi: 58, standing: 1 });
    log(acc.adjust === 'entry' && acc.ballastKg === 60 && acc.restrictorPct === 0, `ACC open: 12 PI under the limit (30 kg) + leader's 30 kg = ${acc.ballastKg} kg ballast`);
    const big = RR.entryAdjust(RR.rules({ format: 'open', cap: { pi: 90 }, kgPerPI: 4, lever: 'both' }), 'acc', { pi: 40 });
    log(big.ballastKg === 100 && big.restrictorPct === 20 && big.notes.length === 2, `ACC caps: ballast ${big.ballastKg} kg / restrictor ${big.restrictorPct}% with notes`);
    const wf = RR.entryAdjust(open, 'wreckfest', { pi: 58, standing: 2 });
    log(wf.pp === 149 && wf.ballastKg === 0 && /simulated races only/.test(wf.notes.join()), `Wreckfest: PP allowance ${wf.pp} (class C 120–164); ballast can't be set per driver`);
    const ir = RR.entryAdjust(RR.rules({ format: 'bop', bop: [{ car: 'Porsche 992 GT3 R', weightKg: 300, powerPct: 120 }], gridDrop: true, ballast: { mode: 'lastRace', steps: [25] } }), 'iracing', { model: 'Porsche 992 GT3 R', last: 1 });
    log(ir.powerPct === 110 && ir.modelWeightKg === 250 && ir.gridDrop === 3, `iRacing: power clamped to ${ir.powerPct}%, weight to ${ir.modelWeightKg} kg, 25 kg success ballast → ${ir.gridDrop}-place grid drop`);
    const ac = RR.entryAdjust(RR.rules({ format: 'bop', bop: [{ car: 'ks_mazda_mx5_cup', weightKg: 10, powerPct: 95 }] }), 'ac', { model: 'Mazda MX-5 Cup' });
    log(ac.ballastKg === 10 && ac.restrictorPct === 5, `AC BoP by fuzzy model: ${ac.ballastKg} kg, power 95% → restrictor ${ac.restrictorPct}`);
    log(RR.successBallast({ mode: 'standings', steps: [30, 20], max: 25 }, { standing: 1 }) === 25 && RR.successBallast({ mode: 'off', steps: [30] }, { standing: 1 }) === 0, 'Success ballast honours max and off');
    const accList = JSON.parse(RR.accEntryList([{ name: 'Ann Apex', number: 7, ballastKg: 130, restrictorPct: 3, steamId: '76561198000000001' }]));
    const acList = RR.acEntryList([{ name: 'Ann Apex', ballastKg: 45, restrictorPct: 12, model: 'ks_mazda_mx5_cup' }]);
    log(accList.forceEntryList === 1 && accList.entries[0].ballastKg === 100 && accList.entries[0].drivers[0].playerID === 'S76561198000000001' && accList.entries[0].drivers[0].lastName === 'Apex'
        && /\[CAR_0\][\s\S]*BALLAST=45[\s\S]*RESTRICTOR=12/.test(acList), 'Entry lists: ACC entrylist.json (ballast capped at 100) and AC entry_list.ini');
}

/* ---------------- race codes, matching ---------------- */
{
    const codes = new Set(); let bad = 0;
    for (let i = 0; i < 3000; i++) { const c = RR.raceCode({ id: 'race' + i, round: i % 30 }); if (!/^PX\d*-[A-Z0-9]{4}$/.test(c)) bad++; codes.add(c); }
    log(!bad && codes.size === 3000 && RR.hasCode('Phoenix GT3 px12-ab3d !', 'PX12-AB3D'), `Race codes: 3000 unique, well-formed, matched case/dash-insensitively`);
    const T = (a, b) => RR.trackMatch(a, b);
    log(T('Monza', 'GAMEDATA\\LOCATIONS\\Monza\\Monza.TRK') && T('Nürburgring GP', 'ks_nurburgring') && !T('Nürburgring GP', 'ks_nordschleife') && T('Circuit of the Americas', 'cota')
        && T('Mount Panorama (Bathurst)', 'mount_panorama') && !T('Road America', 'Road Atlanta') && !T('Road America', 'Circuit of the Americas') && T('Spa-Francorchamps', 'spa') && !T('Daytona', 'Talladega Superspeedway'),
        'Track matching: file paths, AC/ACC ids, layouts and look-alike names');
    log(RR.carMatch('Mazda MX-5 Cup', 'ks_mazda_mx5_cup') && !RR.carMatch('Porsche 911 GT3 Cup', 'Porsche 911 GT3 R') && RR.carMatch('Dallara IR18', 'Dallara IR18'), 'Car matching: internal ids yes, different model no');
}

/* ---------------- importer: metadata + fixes ---------------- */
{
    const ir = I.parse(fixture('iracing-race.csv'), 'r.csv').rows;
    log(ir.map(r => r.num).join() === '5,13,8,99' && ir[0].car === 'Dallara IR18', `iRacing CSV: car numbers ${ir.map(r => r.num).join('/')} (were all 18 from "Dallara IR18"), car model read`);
    const m = {
        ir: I.meta(fixture('iracing-race.csv'), null, 'r.csv'), rf2: I.meta(fixture('rf2-race.xml'), null, '2026_05_01_20_00_00-12R1.xml'),
        gtr: I.meta(fixture('gtr2-race.txt'), null, 'race.txt'), nr: I.meta(fixture('nr2003-race.html'), null, 'r.html'), ac: I.meta(fixture('ac-race_out.json'), null, 'race_out.json')
    };
    log(m.ir.track === 'Road America' && m.ir.server === 'AI Race' && m.ir.date === '2026-05-01' && m.ir.session === 'race' && m.ir.leaderLaps === 20
        && m.rf2.track === 'Sebring International Raceway' && m.rf2.date === '2026-05-01' && m.rf2.session === 'race'
        && m.gtr.track === 'Monza' && m.nr.track === 'Bristol Motor Speedway' && m.nr.session === 'race' && m.nr.leaderLaps === 500
        && m.ac.track === 'ks_nurburgring' && m.ac.raceLaps === 10 && m.ac.cars[0] === 'ks_mazda_mx5_cup',
        'Metadata: track, server, session, date, laps and cars from iRacing / rF2 / GTR2 / NR2003 / AC files');
    const acs = JSON.stringify({ TrackName: 'ks_vallelunga', TrackConfig: 'extended_circuit', Type: 'RACE', RaceLaps: 12, DurationSecs: 0,
        Cars: [{ CarId: 0, Model: 'ks_mazda_mx5_cup', BallastKG: 30, Restrictor: 0 }, { CarId: 1, Model: 'ks_mazda_mx5_cup', BallastKG: 0, Restrictor: 0 }],
        Result: [{ DriverName: 'Ann Apex', DriverGuid: 'a', CarId: 0, CarModel: 'ks_mazda_mx5_cup', BestLap: 101000, TotalTime: 1, BallastKG: 30, Restrictor: 0 }, { DriverName: 'Bob Brake', DriverGuid: 'b', CarId: 1, CarModel: 'ks_mazda_mx5_cup', BestLap: 100500, TotalTime: 2, BallastKG: 0, Restrictor: 0 }],
        Laps: Array.from({ length: 24 }, (_, i) => ({ DriverGuid: i % 2 ? 'b' : 'a', CarId: i % 2, LapTime: 100000 })) });
    const parsed = I.parse(acs, '2026_10_2_20_15_RACE.json');
    const am = I.meta(acs, null, '2026_10_2_20_15_RACE.json');
    log(parsed.format === 'ac-server-json' && parsed.rows[0].name === 'Ann Apex' && parsed.rows[0].ballast === 30 && parsed.rows[1].fl && parsed.rows[0].laps === 12
        && am.session === 'race' && am.raceLaps === 12 && am.date === '2026-10-02' && am.layout === 'extended_circuit',
        'AC server results JSON: order, laps from Laps[], ballast per car, date from the filename');
    const accName = I.meta(JSON.stringify({ sessionType: 'Q', trackName: 'monza', serverName: 'X', sessionResult: { leaderBoardLines: [] } }), null, '261002_201500_Q.json');
    log(accName.session === 'qualify' && accName.date === '2026-10-02' && accName.server === 'X', 'ACC: session type, server name and the date in the file name');
}

/* ---------------- result checks ---------------- */
{
    const race = { id: 'r1', track: 'Road America', laps: 20, date: '2026-05-02', round: 4 };
    const sheet = RR.sheet(race, {});
    const text = fixture('iracing-race.csv');
    const rows = I.parse(text, 'r.csv').rows;
    const meta = I.meta(text, null, 'r.csv');
    const me = rows.find(r => r.name === '__ME__');
    const ok = RR.checkFile({ race, sheet: { ...sheet, mode: 'either' }, meta, rows, me, claimed: { position: 2 } });
    log(ok.status === 'valid' && ok.checks.find(c => c.key === 'claim').ok === true, `Right file, right claim → ${ok.status}`);
    const lie = RR.checkFile({ race, sheet, meta, rows, me, claimed: { position: 1 } });
    log(lie.status === 'invalid' && /P1; the file says P2/.test(RR.summary(lie)), `Claiming P1 with a P2 file → ${lie.status}: ${RR.summary(lie)}`);
    const wrongTrack = RR.checkFile({ race: { ...race, track: 'Watkins Glen' }, sheet, meta, rows });
    const wrongLaps = RR.checkFile({ race: { ...race, laps: 30 }, sheet: { ...sheet, laps: 30 }, meta, rows });
    const oldFile = RR.checkFile({ race: { ...race, date: '2026-09-01' }, sheet, meta, rows });
    log(wrongTrack.status === 'invalid' && wrongLaps.status === 'invalid' && oldFile.status === 'invalid', `Wrong track / distance / an old file → all invalid`);
    const online = RR.checkFile({ race, sheet: { ...sheet, mode: 'online', codeRequired: true }, meta, rows });
    const onlineOk = RR.checkFile({ race, sheet: { ...sheet, mode: 'online', codeRequired: true }, meta: { ...meta, server: `Phoenix ${sheet.code}` }, rows });
    log(online.status === 'invalid' && /no race code/.test(RR.summary(online)) && onlineOk.status === 'valid', `Online race: server "AI Race" lacks the code → invalid; with ${sheet.code} → valid`);
    const quali = RR.checkFile({ race: { track: 'Monza', laps: 20 }, sheet: { laps: 20, mode: 'offline' }, meta: { session: 'qualify', track: 'monza', leaderLaps: 20 }, rows: [] });
    const notMe = RR.checkFile({ race, sheet, meta, rows, me: null, needMe: true });
    const field = RR.checkFile({ race, sheet: { ...sheet, mode: 'offline', field: 20 }, meta, rows });
    const wrongCar = RR.checkFile({ race, sheet: { ...sheet, gameCars: 'Mazda MX-5 Cup' }, meta, rows, me });
    const ballast = RR.checkFile({ race, sheet, meta, rows, me: { ...me, ballast: 0 }, expect: { ballastKg: 30 } });
    log([quali, notMe, field, wrongCar, ballast].every(x => x.status === 'invalid'), 'Qualifying file, not in the file, short offline field, wrong car, missing ballast → invalid');
    const paste = RR.checkFile({ race, sheet, meta: I.meta('1. Ann\n2. Bob', 'paste'), rows: [] });
    log(paste.status === 'unverified', `A file with nothing to compare stays ${paste.status} (GM review)`);
}

/* ---------------- screenshots ---------------- */
{
    const race = { id: 'r2', track: 'Road America', laps: 20, date: '2026-10-02' };
    const sheet = { ...RR.sheet(race, {}), mode: 'online', codeRequired: true, windowDays: 3 };
    const known = SC.game('iracing').tracks;
    const good = RR.checkText({ race, sheet, text: `SESSION ${sheet.code}\nROAD AMERICA - RACE RESULTS\nLAP 20/20\n1 Ann Apex  +0.000`, driverName: 'Ann Apex', fileDate: '2026-10-02', knownTracks: known });
    const otherTrack = RR.checkText({ race, sheet, text: 'DAYTONA INTERNATIONAL SPEEDWAY RACE RESULTS lap 20/20 Ann Apex', driverName: 'Ann Apex', knownTracks: known });
    const shortRace = RR.checkText({ race, sheet, text: 'Road America results Lap 12/12 Ann Apex', driverName: 'Ann Apex', knownTracks: known });
    const position = RR.checkText({ race, sheet, text: 'Road America results Position 3/24 Ann Apex', driverName: 'Ann Apex', knownTracks: known });
    const old = RR.checkText({ race, sheet, text: 'Road America Ann Apex', driverName: 'Ann Apex', fileDate: '2026-08-01' });
    const blank = RR.checkText({ race, sheet, text: '' });
    log(good.status === 'valid' && otherTrack.status === 'invalid' && shortRace.status === 'invalid' && position.status === 'valid' && old.status === 'invalid' && blank.status === 'unverified',
        `Screenshot text: code + track → valid; Daytona / 12-lap / dated before the window → invalid; "3/24" isn't read as laps; unreadable → unverified`);
}

console.log(`\n${pass}/${pass + fail} steps passed`);
process.exit(fail ? 1 : 0);
