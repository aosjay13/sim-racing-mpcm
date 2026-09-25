/* ============================================================
   Phoenix SRMPC — Solo Career: race-results importer
   Reads the results file your sim writes (or anything pasted),
   normalises it to rows, and maps names onto the career grid.

     rFactor-family XML  rFactor 1/2, Le Mans Ultimate, AMS1, GTR2*
     ISI .txt results    GTR2 / RACE 07 / GTR Evolution ([SlotNNN])
     NR2003 HTML export  exports_imports/*.html
     iRacing CSV         session results → "Export to CSV"
     AC race_out.json    Documents/Assetto Corsa/out/race_out.json
     ACC results JSON    server results/*.json (UTF-16 handled)
     Any CSV/TSV/table   header auto-detection
     Pasted list         one driver per line in finishing order

   Pure functions — no DOM needed (the Node tests use them too).
   ============================================================ */
'use strict';

(function (root) {
    const SC = root.SC = root.SC || {};
    const I = {};

    /* ---------------- text helpers ---------------- */
    I.decode = function (buf) {
        // ArrayBuffer → string, handling UTF-16 (ACC) and UTF-8 BOMs.
        const b = new Uint8Array(buf);
        if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
        if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
        let zeros = 0;
        for (let i = 1; i < Math.min(b.length, 400); i += 2) if (b[i] === 0) zeros++;
        if (zeros > 40) return new TextDecoder('utf-16le').decode(b);
        let t = new TextDecoder('utf-8').decode(b);
        if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
        return t;
    };
    const decodeEntities = (s) => String(s || '')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
    const stripTags = (s) => decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    const num = (v) => { const n = parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10); return Number.isFinite(n) ? n : null; };
    I.norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

    function parseTime(s) {
        // "1:23:45.678", "23:45.678", "45.678", or milliseconds → seconds
        s = String(s || '').trim();
        if (!s || /dnf|dns|dsq|dq|---/i.test(s)) return null;
        if (/^\d{5,}$/.test(s)) return Number(s) / 1000;
        const parts = s.split(':').map(Number);
        if (parts.some(n => !Number.isFinite(n))) return null;
        return parts.reduce((acc, p) => acc * 60 + p, 0);
    }
    const FIN_RE = /^(running|finished( normally)?|classified|ok|fin|finish|lapped|active|\+?\s*\d+\s*laps?|-?\s*\d+\s*l(aps?)?|-)$/i;
    const DNF_RE = /\b(dnf|dns|dsq|dq|disq|ret|retired|out|accident|crash|mechanical|engine|gearbox|disconnected|none|did not finish)\b/i;

    /* ---------------- format detection ---------------- */
    I.detect = function (text, filename = '') {
        const t = String(text || '').trim();
        const fn = filename.toLowerCase();
        if (!t) return null;
        if (t.startsWith('{') || t.startsWith('[')) {
            try {
                const j = JSON.parse(t);
                if (j.sessionResult && j.sessionResult.leaderBoardLines) return 'acc-json';
                if (Array.isArray(j.sessions) && Array.isArray(j.players)) return 'ac-json';
            } catch (e) { /* not JSON */ }
        }
        if (/<rFactorXML|<RaceResults|<Driver>\s*<Name>/i.test(t)) return 'isi-xml';
        if (/\[Slot\d+\]/i.test(t) && /Driver\s*=/i.test(t)) return 'isi-txt';
        if (/<table/i.test(t) || fn.endsWith('.html') || fn.endsWith('.htm')) return 'html';
        const firstLines = t.split(/\r?\n/).slice(0, 12).join('\n');
        if (/fin pos|"fin pos"|cust id/i.test(firstLines)) return 'iracing-csv';
        if (/[,;\t]/.test(firstLines) && /(pos|position|fin|place)/i.test(firstLines) && /(driver|name)/i.test(firstLines)) return 'csv';
        return 'paste';
    };

    /* ---------------- column mapping for tables / CSV ---------------- */
    const COLS = {
        pos: ['fin pos', 'fin', 'finish', 'pos', 'position', 'place', 'p', 'rank', 'overall', 'result pos', 'classification'],
        start: ['start pos', 'st', 'start', 'grid', 'gridpos', 'grid pos', 'qual', 'starting position', 'start position', 'qualified'],
        name: ['name', 'driver', 'driver name', 'racer', 'player', 'pilot'],
        num: ['car #', 'car no', 'car number', '#', 'no', 'number', 'num', 'nr'],
        laps: ['laps comp', 'laps completed', 'laps', 'lap', 'lapscompleted', 'completed laps'],
        led: ['laps led', 'led', 'lapsled'],
        status: ['out', 'status', 'reason', 'finish status', 'result', 'state'],
        inc: ['inc', 'incidents', 'inc.', 'x'],
        team: ['team', 'team name'],
        wrecks: ['wrecks', 'kills', 'takedowns', 'wrecked']
    };
    function mapHeaders(headers) {
        const h = headers.map(x => I.norm(x).replace(/ +/g, ' '));
        const out = {};
        for (const [key, names] of Object.entries(COLS)) {
            for (const n of names) {
                const idx = h.findIndex((x, i) => x === I.norm(n) && !Object.values(out).includes(i));
                if (idx >= 0) { out[key] = idx; break; }
            }
        }
        return out;
    }
    function rowsFromTable(headers, body) {
        const m = mapHeaders(headers);
        if (m.name == null) return null;
        const rows = [];
        body.forEach((cells, i) => {
            const name = String(cells[m.name] ?? '').trim();
            if (!name) return;
            const status = m.status != null ? String(cells[m.status] ?? '') : '';
            rows.push({
                name,
                pos: m.pos != null ? num(cells[m.pos]) : i + 1,
                start: m.start != null ? num(cells[m.start]) : null,
                num: m.num != null ? num(cells[m.num]) : null,
                laps: m.laps != null ? num(cells[m.laps]) : null,
                led: m.led != null ? num(cells[m.led]) : null,
                inc: m.inc != null ? num(cells[m.inc]) : null,
                team: m.team != null ? String(cells[m.team] ?? '').trim() : '',
                wrecks: m.wrecks != null ? num(cells[m.wrecks]) : null,
                // Anything that isn't a "still running / classified" status is a retirement
                // (iRacing: Contact, Mechanical, Disconnected, Towed; NR2003: Accident, Engine…).
                dnf: !!status.trim() && !FIN_RE.test(status.trim()),
                status
            });
        });
        return rows;
    }

    function splitCsvLine(line, delim) {
        const out = []; let cur = ''; let q = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (q) {
                if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                else if (ch === '"') q = false;
                else cur += ch;
            } else if (ch === '"') q = true;
            else if (ch === delim) { out.push(cur); cur = ''; }
            else cur += ch;
        }
        out.push(cur);
        return out.map(s => s.trim());
    }
    function parseCsv(text) {
        const lines = String(text).split(/\r?\n/).filter(l => l.trim());
        const sample = lines.slice(0, 15).join('\n');
        const delim = (sample.match(/\t/g) || []).length > 3 ? '\t' : (sample.match(/;/g) || []).length > (sample.match(/,/g) || []).length ? ';' : ',';
        // Find the header row (iRacing exports put session info above it).
        let hi = lines.findIndex(l => {
            const cells = splitCsvLine(l, delim).map(c => I.norm(c));
            return cells.some(c => COLS.name.includes(c)) && cells.some(c => COLS.pos.includes(c) || COLS.laps.includes(c));
        });
        if (hi < 0) hi = lines.findIndex(l => splitCsvLine(l, delim).map(c => I.norm(c)).some(c => COLS.name.includes(c)));
        if (hi < 0) return null;
        const headers = splitCsvLine(lines[hi], delim);
        const body = lines.slice(hi + 1).map(l => splitCsvLine(l, delim)).filter(c => c.length >= 2);
        return rowsFromTable(headers, body);
    }

    function parseHtmlTables(html) {
        const tables = String(html).match(/<table[\s\S]*?<\/table>/gi) || [];
        let best = null;
        for (const tb of tables) {
            const trs = tb.match(/<tr[\s\S]*?<\/tr>/gi) || [];
            const grid = trs.map(tr => (tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) || []).map(stripTags));
            const hi = grid.findIndex(r => r.some(c => COLS.name.includes(I.norm(c))));
            if (hi < 0) continue;
            const rows = rowsFromTable(grid[hi], grid.slice(hi + 1).filter(r => r.length >= 2));
            if (rows && rows.length && (!best || rows.length > best.length)) best = rows;
        }
        return best;
    }

    /* ---------------- rFactor-family XML ---------------- */
    function tag(block, name) {
        const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
        return m ? decodeEntities(m[1].trim()) : null;
    }
    function parseIsiXml(xml) {
        // Prefer the (last) race session.
        const races = xml.match(/<Race\d*>[\s\S]*?<\/Race\d*>/gi);
        const scope = races && races.length ? races[races.length - 1] : xml;
        const drivers = scope.match(/<Driver>[\s\S]*?<\/Driver>/gi) || [];
        const rows = drivers.map(d => {
            const laps = (d.match(/<Lap [^>]*p="(\d+)"/gi) || []).map(l => Number((l.match(/p="(\d+)"/i) || [])[1]));
            const status = tag(d, 'FinishStatus') || '';
            return {
                name: tag(d, 'Name') || '', pos: num(tag(d, 'Position')), start: num(tag(d, 'GridPos')),
                num: num(tag(d, 'CarNumber')), laps: num(tag(d, 'Laps')), team: tag(d, 'TeamName') || '',
                led: laps.length ? laps.filter(p => p === 1).length : null,
                isPlayer: tag(d, 'isPlayer') === '1', status,
                dnf: /dnf|dq|dns/i.test(status) || /none/i.test(status) && num(tag(d, 'Laps')) === 0
            };
        }).filter(r => r.name);
        rows.sort((a, b) => (a.pos || 999) - (b.pos || 999));
        return rows;
    }

    /* ---------------- GTR2 / RACE 07 .txt ---------------- */
    function parseIsiTxt(text) {
        const sections = {};
        let cur = null;
        for (const raw of String(text).split(/\r?\n/)) {
            const line = raw.trim();
            const sec = line.match(/^\[(.+)\]$/);
            if (sec) { cur = sec[1]; sections[cur] = {}; continue; }
            const kv = line.match(/^([^=]+)=(.*)$/);
            if (kv && cur) sections[cur][kv[1].trim().toLowerCase()] = kv[2].trim();
        }
        const slots = Object.entries(sections).filter(([k]) => /^slot\d+$/i.test(k)).map(([, v]) => v).filter(v => v.driver);
        const rows = slots.map(v => {
            const rt = v.racetime || v['race time'] || '';
            const laps = num(v.laps);
            const time = parseTime(rt);
            return {
                name: v.driver, laps, time, pos: num(v.position), start: num(v.gridpos || v.grid || v.qualpos),
                team: v.team || '', num: num(v.number || v.carnumber), status: rt,
                dnf: /dnf|dsq|dns|dq/i.test(rt) || (v.reason && v.reason !== '0' && /\d/.test(v.reason) && Number(v.reason) > 0) || false
            };
        });
        const maxLaps = Math.max(0, ...rows.map(r => r.laps || 0));
        rows.forEach(r => { if (!r.dnf && r.laps != null && maxLaps && r.laps < maxLaps * 0.9) r.dnf = true; });
        if (rows.every(r => r.pos)) rows.sort((a, b) => a.pos - b.pos);
        else rows.sort((a, b) => (Number(a.dnf) - Number(b.dnf)) || ((b.laps || 0) - (a.laps || 0)) || ((a.time ?? 1e9) - (b.time ?? 1e9)));
        rows.forEach((r, i) => { r.pos = i + 1; });
        return rows;
    }

    /* ---------------- Assetto Corsa race_out.json ---------------- */
    function parseAcJson(j) {
        const sessions = j.sessions || [];
        const race = sessions.slice().reverse().find(s => s.type === 3 || /race/i.test(s.name || '')) || sessions[sessions.length - 1];
        if (!race) return [];
        const order = race.raceResult || race.raceresult || [];
        const totals = race.lapstotal || [];
        const maxLaps = Math.max(0, ...totals, race.lapsCount || 0);
        const best = (race.bestLaps || []).slice().sort((a, b) => a.time - b.time)[0];
        const led = {};
        // laps[] entries are {lap, car, time}; position per lap isn't stored, so leave laps led blank.
        return order.map((carIdx, i) => {
            const p = (j.players || [])[carIdx] || {};
            const laps = totals[carIdx];
            return {
                name: p.name || `Car ${carIdx}`, pos: i + 1, start: null, laps: laps ?? null, led: led[carIdx] ?? null,
                isPlayer: carIdx === 0, fl: best ? best.car === carIdx : false,
                dnf: laps != null && maxLaps > 0 && laps < maxLaps - 0 && laps < maxLaps * 0.9, status: ''
            };
        });
    }

    /* ---------------- ACC results JSON ---------------- */
    function parseAccJson(j) {
        const lines = j.sessionResult?.leaderBoardLines || [];
        const maxLaps = Math.max(0, ...lines.map(l => l.timing?.lapCount || 0));
        const bestLap = Math.min(...lines.map(l => l.timing?.bestLap || 1e12));
        return lines.map((l, i) => {
            const d = l.currentDriver || (l.car?.drivers || [])[0] || {};
            const name = `${d.firstName || ''} ${d.lastName || ''}`.trim() || d.shortName || `#${l.car?.raceNumber}`;
            const laps = l.timing?.lapCount ?? null;
            return {
                name, pos: i + 1, num: l.car?.raceNumber ?? null, laps, start: null, led: null,
                fl: l.timing?.bestLap === bestLap, team: l.car?.teamName || '',
                dnf: laps != null && maxLaps > 0 && laps < maxLaps * 0.9, status: ''
            };
        });
    }

    /* ---------------- pasted list ---------------- */
    function parsePaste(text) {
        const rows = [];
        for (const raw of String(text).split(/\r?\n/)) {
            let line = raw.trim();
            if (!line) continue;
            let dnf = false, wrecks = null, led = null;
            if (/\b(dnf|dns|dsq|ret|out|wrecked)\b/i.test(line)) { dnf = true; line = line.replace(/[-–—,(]*\s*\b(dnf|dns|dsq|ret|out|wrecked)\b\)?/ig, ' '); }
            const w = line.match(/(\d+)\s*(wrecks?|kills?)/i); if (w) { wrecks = Number(w[1]); line = line.replace(w[0], ' '); }
            const l = line.match(/(\d+)\s*(laps? led|led)/i); if (l) { led = Number(l[1]); line = line.replace(l[0], ' '); }
            // "1.", "P1", "1)", "1 -" position prefix; "#13" car numbers
            let pos = null, carNum = null;
            const pm = line.match(/^\s*p?(\d{1,3})\s*[.)\-:–]?\s+/i);
            if (pm) { pos = Number(pm[1]); line = line.slice(pm[0].length); }
            const nm = line.match(/#\s*(\d{1,3})/);
            if (nm) { carNum = Number(nm[1]); line = line.replace(nm[0], ' '); }
            line = line.replace(/[|,;\t]+/g, ' ').replace(/\s+/g, ' ').trim();
            // Strip trailing time / gap tokens like "+3.456" or "1:23.456"
            line = line.replace(/\s+[+]?\d+[:.]\d+(\.\d+)?\s*$/, '').trim();
            if (!line) continue;
            rows.push({ name: line, pos, num: carNum, dnf, wrecks, led, start: null });
        }
        // Positions default to line order; DNFs keep their place in the list.
        rows.forEach((r, i) => { if (!r.pos) r.pos = i + 1; });
        rows.sort((a, b) => a.pos - b.pos);
        return rows;
    }

    /* ---------------- entry point ---------------- */
    I.parse = function (text, filename = '', forced = null) {
        const format = forced || I.detect(text, filename);
        let rows = [];
        if (format === 'acc-json') rows = parseAccJson(JSON.parse(text));
        else if (format === 'ac-json') rows = parseAcJson(JSON.parse(text));
        else if (format === 'isi-xml') rows = parseIsiXml(text);
        else if (format === 'isi-txt') rows = parseIsiTxt(text);
        else if (format === 'html' || format === 'nr2003') rows = parseHtmlTables(text) || [];
        else if (format === 'iracing-csv' || format === 'csv') rows = parseCsv(text) || [];
        else rows = parsePaste(text);
        rows = (rows || []).filter(r => r && r.name);
        // Normalise positions: finishers first by pos, DNFs after (keep their relative order).
        rows.sort((a, b) => (a.pos || 999) - (b.pos || 999));
        return { format, rows };
    };

    /* ---------------- name matching ---------------- */
    function lev(a, b) {
        if (a === b) return 0;
        const m = a.length, n = b.length;
        if (!m || !n) return Math.max(m, n);
        let prev = Array.from({ length: n + 1 }, (_, j) => j);
        for (let i = 1; i <= m; i++) {
            const cur = [i];
            for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = cur;
        }
        return prev[n];
    }
    function score(rowName, cand) {
        const r = I.norm(rowName);
        const full = I.norm(cand.first + ' ' + cand.last);
        if (!r) return 0;
        if (r === full) return 1;
        const rr = r.split(' ');
        const last = I.norm(cand.last);
        const first = I.norm(cand.first);
        const reversed = I.norm(cand.last + ' ' + cand.first);
        if (r === reversed) return 0.97;
        if (rr.length >= 2 && rr[rr.length - 1] === last && rr[0][0] === first[0]) return 0.9;
        if (rr[0] === last && rr.length >= 2 && rr[1][0] === first[0]) return 0.88; // "Smith J"
        if (cand.nick && r === I.norm(cand.nick)) return 0.95;
        const d = lev(r, full);
        const ratio = 1 - d / Math.max(r.length, full.length);
        if (ratio >= 0.82) return 0.7 + (ratio - 0.82);
        if (rr.includes(last) && last.length > 3) return 0.6;
        return 0;
    }

    // entrants: [{ id, first, last, num, nick? }]
    // Returns rows with .id (matched or auto-filled) and .how ('file-player'|'name'|'number'|'auto').
    // autoFill: hand unmatched rows to the remaining entrants in skill order
    // (right for an AI field; the league turns it off — humans are never guessed).
    I.match = function (rows, entrants, { playerId = 'P', autoFill = true } = {}) {
        const out = rows.map(r => ({ ...r, id: null, how: null, conf: 0 }));
        const taken = new Set();
        // 1. File says "this is the player".
        const pRow = out.find(r => r.isPlayer);
        if (pRow && entrants.some(e => e.id === playerId)) { pRow.id = playerId; pRow.how = 'file-player'; pRow.conf = 1; taken.add(playerId); }
        // 2. Name scores, best-first greedy.
        const pairs = [];
        out.forEach((r, ri) => {
            if (r.id) return;
            entrants.forEach(e => { if (!taken.has(e.id)) { const s = score(r.name, e); if (s >= 0.6) pairs.push([s, ri, e.id]); } });
        });
        pairs.sort((a, b) => b[0] - a[0]);
        for (const [s, ri, id] of pairs) {
            if (out[ri].id || taken.has(id)) continue;
            out[ri].id = id; out[ri].how = 'name'; out[ri].conf = s; taken.add(id);
        }
        // 3. Car numbers.
        out.forEach(r => {
            if (r.id || r.num == null) return;
            const e = entrants.find(x => x.num === r.num && !taken.has(x.id));
            if (e) { r.id = e.id; r.how = 'number'; r.conf = 0.65; taken.add(e.id); }
        });
        // 4. Everyone else: remaining AI entrants in skill order (keeps your position exact).
        if (!autoFill) return out;
        const rest = entrants.filter(e => !taken.has(e.id) && e.id !== playerId).sort((a, b) => (b.skill || 0) - (a.skill || 0));
        out.forEach(r => {
            if (r.id) return;
            const e = rest.shift();
            if (e) { r.id = e.id; r.how = 'auto'; r.conf = 0; taken.add(e.id); }
        });
        return out;
    };

    // Build completeRound() import input from matched rows.
    I.toRoundInput = function (matched, playerId = 'P') {
        const rows = matched.filter(r => r.id);
        const finishers = rows.filter(r => !r.dnf);
        const dnfs = rows.filter(r => r.dnf).sort((a, b) => (b.laps || 0) - (a.laps || 0));
        const order = finishers.concat(dnfs).map(r => r.id);
        const me = rows.find(r => r.id === playerId);
        return {
            mode: 'import', order, dnfIds: dnfs.map(r => r.id),
            player: me ? { start: me.start || null, led: me.led || 0, fl: !!me.fl, wrecks: me.wrecks ?? undefined, inc: me.inc ?? null } : null
        };
    };

    SC.Import = I;
})(typeof window !== 'undefined' ? window : globalThis);
