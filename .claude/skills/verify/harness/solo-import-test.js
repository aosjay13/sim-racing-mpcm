/* Results-importer test (Node). Parses every fixture format, maps names
   onto a real career grid, and feeds the result through completeRound. */
'use strict';
const fs = require('fs');
const path = require('path');
global.window = global;
const SOLO = path.join(__dirname, '../../../../sim-racing-career/js/solo');
['sc-tracks', 'sc-gamedb', 'sc-names', 'sc-engine', 'sc-import'].forEach(f => require(path.join(SOLO, f + '.js')));
const E = SC.Engine, I = SC.Import;
const FIX = path.join(__dirname, 'fixtures');
let bad = 0;
const ok = (cond, msg) => { console.log(cond ? '✅' : '❌', msg); if (!cond) bad++; };

function career() {
    const S = E.newCareer({ gameId: 'rf2', seriesId: 'indycar', role: 'driver', difficulty: 'normal', seed: 99, character: { first: 'Jamie', last: 'Import', nat: 'USA', num: 13 } });
    E.beginSeason(S);
    const ids = E.driversIn(S, S.season.sid).filter(id => id !== 'P');
    const ai = ids.map(id => S.drivers[id]);
    const entrants = E.driversIn(S, S.season.sid).map(id => { const d = id === 'P' ? S.drivers.P : S.drivers[id]; return { id, first: d.first, last: d.last, num: d.num, skill: d.skill }; });
    return { S, ai, entrants };
}
function fill(text, ai) {
    return text.replace(/__ME__/g, 'Jamie Import').replace(/__P1__/g, `${ai[0].first} ${ai[0].last}`)
        .replace(/__P3__/g, `${ai[1].first} ${ai[1].last}`).replace(/__P5__/g, `${ai[2].last}, ${ai[2].first}`.replace(/, /, ' ').split(' ').reverse().join(' '));
}

const cases = [
    { file: 'rf2-race.xml', fmt: 'isi-xml', mePos: 2, meStart: 1, meLed: 1, dnfName: 2 },
    { file: 'gtr2-race.txt', fmt: 'isi-txt', mePos: 2, dnfName: 1 },
    { file: 'nr2003-race.html', fmt: 'html', mePos: 2, meStart: 1, meLed: 150, dnfName: 2 },
    { file: 'iracing-race.csv', fmt: 'iracing-csv', mePos: 2, meStart: 6, meLed: 3, dnfName: 2 },
    { file: 'ac-race_out.json', fmt: 'ac-json', mePos: 2, dnfName: 2 }
];

for (const c of cases) {
    const { S, ai, entrants } = career();
    const text = fill(fs.readFileSync(path.join(FIX, c.file), 'utf8'), ai);
    const buf = new TextEncoder().encode(text).buffer;
    const decoded = I.decode(buf);
    const { format, rows } = I.parse(decoded, c.file);
    ok(format === c.fmt, `${c.file}: detected ${format}`);
    const matched = I.match(rows, entrants);
    const me = matched.find(r => r.id === 'P');
    ok(me && me.pos === c.mePos, `${c.file}: player row found at P${me && me.pos} (${me && me.how})`);
    if (c.meStart) ok(me && me.start === c.meStart, `${c.file}: start P${me && me.start}`);
    if (c.meLed != null) ok(me && me.led === c.meLed, `${c.file}: laps led ${me && me.led}`);
    ok(matched.filter(r => r.dnf).length >= 1, `${c.file}: DNF detected (${matched.filter(r => r.dnf).map(r => r.name).join(', ')})`);
    ok(matched.filter(r => r.how === 'name' || r.how === 'file-player').length >= 3, `${c.file}: ${matched.filter(r => r.how === 'name').length} names matched to career drivers`);
    const input = I.toRoundInput(matched);
    const rep = E.completeRound(S, input);
    ok(rep.ev.res.player.pos === c.mePos, `${c.file}: career result recorded as P${rep.ev.res.player.pos} (grid of ${rep.ev.res.order.length})`);
    ok(rep.ev.res.order[0] === matched.find(r => r.pos === 1).id, `${c.file}: winner carried over (${E.driverName(S, rep.ev.res.order[0])})`);
}

// ACC: UTF-16LE with BOM
{
    const { S, ai, entrants } = career();
    const acc = {
        sessionType: 'R', trackName: 'monza',
        sessionResult: {
            leaderBoardLines: [
                { car: { raceNumber: 7, drivers: [{ firstName: ai[0].first, lastName: ai[0].last }] }, currentDriver: { firstName: ai[0].first, lastName: ai[0].last }, timing: { lapCount: 25, bestLap: 107000 } },
                { car: { raceNumber: 13, drivers: [{ firstName: 'Jamie', lastName: 'Import' }] }, currentDriver: { firstName: 'Jamie', lastName: 'Import' }, timing: { lapCount: 25, bestLap: 106500 } },
                { car: { raceNumber: 8, drivers: [{ firstName: ai[1].first, lastName: ai[1].last }] }, currentDriver: { firstName: ai[1].first, lastName: ai[1].last }, timing: { lapCount: 9, bestLap: 108000 } }
            ]
        }
    };
    const json = JSON.stringify(acc);
    const u16 = new Uint8Array(2 + json.length * 2);
    u16[0] = 0xFF; u16[1] = 0xFE;
    for (let i = 0; i < json.length; i++) { const cc = json.charCodeAt(i); u16[2 + i * 2] = cc & 0xFF; u16[3 + i * 2] = cc >> 8; }
    const text = I.decode(u16.buffer);
    const { format, rows } = I.parse(text, 'acc.json');
    ok(format === 'acc-json', `ACC UTF-16 decoded + detected (${format})`);
    const matched = I.match(rows, entrants);
    const me = matched.find(r => r.id === 'P');
    ok(me && me.pos === 2 && me.fl, `ACC: player P${me && me.pos}, fastest lap ${me && me.fl}`);
    ok(matched[2].dnf, 'ACC: 9-lap car flagged DNF');
    const rep = E.completeRound(S, I.toRoundInput(matched));
    ok(rep.ev.res.player.pos === 2 && rep.ev.res.fl === 'P', 'ACC: import recorded P2 + fastest lap');
}

// Generic CSV (semicolon) and pasted list
{
    const { S, ai, entrants } = career();
    const csv = `Position;Driver;Grid;Status\n1;${ai[2].first} ${ai[2].last};3;Finished\n2;${ai[3].first} ${ai[3].last};5;Finished\n3;Jamie Import;1;Finished\n4;${ai[4].last} ${ai[4].first[0]};2;DNF\n`;
    const { format, rows } = I.parse(csv, 'results.csv');
    ok(format === 'csv', `semicolon CSV detected (${format})`);
    const matched = I.match(rows, entrants);
    ok(matched.find(r => r.id === 'P')?.pos === 3, 'CSV: player at P3');
    ok(matched[3].id === ai[4].id, `CSV: "Lastname F" style matched to ${ai[4].first} ${ai[4].last}`);
    const rep = E.completeRound(S, I.toRoundInput(matched));
    ok(rep.ev.res.player.pos === 3 && rep.ev.res.player.start === 1, `CSV: recorded P3 from P1 (got P${rep.ev.res.player.pos} from P${rep.ev.res.player.start})`);
}
{
    const { S, ai, entrants } = career();
    const paste = `1. ${ai[0].first} ${ai[0].last}\nP2 #13 Jamie Import\n3) ${ai[1].first.toUpperCase()} ${ai[1].last.toUpperCase()} +4.512\n${ai[2].first} ${ai[2].last} - DNF\n`;
    const { format, rows } = I.parse(paste, '');
    ok(format === 'paste', `pasted list detected (${format})`);
    const matched = I.match(rows, entrants);
    ok(matched.find(r => r.id === 'P')?.pos === 2, 'Paste: player at P2');
    ok(matched[2].id === ai[1].id, 'Paste: upper-case name + gap stripped and matched');
    ok(matched[3].dnf, 'Paste: "- DNF" parsed');
    const rep = E.completeRound(S, I.toRoundInput(matched));
    ok(rep.ev.res.player.pos === 2, 'Paste: recorded P2');
    ok(rep.ev.res.dnf[ai[2].id], 'Paste: DNF carried into the career result');
}
console.log(bad ? `\n${bad} failure(s)` : '\nAll importer checks passed');
process.exit(bad ? 1 : 0);
