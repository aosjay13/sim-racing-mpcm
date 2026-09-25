/* ============================================================
   Phoenix SRMPC — Solo Career: management & stats screens
   Calendar, Standings, Team (car/R&D, facilities, staff,
   sponsors), Market, Finances, Inbox, Career, World, Settings.
   ============================================================ */
'use strict';

(function (root) {
    const SC = root.SC = root.SC || {};
    const K = SC.UI;
    const esc = K.esc;
    const E = () => SC.Engine;
    const App = () => SC.App;
    const V = SC.Views = SC.Views || {};
    const dn = (S, id) => E().driverName(S, id);

    /* ============================================================
       CALENDAR
       ============================================================ */
    V.calendar = async function (el) {
        const S = App().S;
        const sd = E().seriesDef(S, S.season.sid);
        const evs = S.season.events;
        el.innerHTML = `
        <div class="view-head"><div><p class="section-label">${S.year} · Season ${S.seasonNo}</p><h1>🗓️ ${esc(sd.name)} calendar</h1></div>
            ${S.phase === 'preseason' ? '<button class="btn btn-secondary" data-go="race">Edit calendar</button>' : ''}</div>
        ${K.panel('', `<div class="sc-table-wrap"><table class="table">
            <thead><tr><th>R</th><th>Date</th><th>Track</th><th>Length</th><th>Weather</th><th>Winner</th><th>You</th></tr></thead>
            <tbody>${evs.map((ev, i) => {
                const next = S.phase === 'season' && i === S.season.round;
                const res = ev.res;
                const mine = res?.player;
                const myTeam = S.player.role === 'principal' && res ? S.teams[S.player.teamId].drivers.map(id => res.dnf[id] ? 'DNF' : 'P' + (res.order.indexOf(id) + 1)).join(' / ') : '';
                return `<tr class="${next ? 'sc-next-row' : ''}" ${ev.done ? `data-ev="${i}"` : ''} style="${ev.done ? 'cursor:pointer' : ''}">
                    <td>${ev.r}</td><td>${K.date(ev.date)}</td>
                    <td>${esc(ev.t)} ${next ? K.badge('Next', 'badge-red') : ''}<br><span class="muted small">${V._typeChip(ev.type)}</span></td>
                    <td>${V._lengthText(ev)}</td><td class="small">${esc(ev.wx.cond)}${ev.night ? ' · night' : ''}</td>
                    <td>${res ? esc(dn(S, res.order[0])) : ''}</td>
                    <td>${mine ? K.pos(mine.pos, mine.dnf) + (mine.sim ? ' <span class="muted small">sim</span>' : '') : myTeam ? esc(myTeam) : ''}</td></tr>`;
            }).join('')}</tbody></table></div>`)}`;
        K.$$('[data-ev]', el).forEach(r => r.addEventListener('click', () => V.showEventResults(S, evs[Number(r.dataset.ev)])));
        K.$$('[data-go]', el).forEach(b => b.addEventListener('click', () => App().go(b.dataset.go)));
    };

    /* ============================================================
       STANDINGS
       ============================================================ */
    V.standings = async function (el, param) {
        const S = App().S;
        const g = E().gameOf(S);
        const [sidParam, tabParam] = String(param || '').split(':');
        const sid = sidParam && E().seriesDef(S, sidParam) ? sidParam : S.season.sid;
        const tab = tabParam || 'drivers';
        const sd = E().seriesDef(S, sid);
        const mine = sid === S.season.sid;
        const st = E().standings(S, sid);
        const ts = E().teamStandings(S, sid);
        const done = mine ? S.season.round : S.season.others[sid]?.done || 0;
        const total = mine ? S.season.events.length : S.season.others[sid]?.total || 0;
        const form = (id) => {
            if (!mine) return '';
            const evs = S.season.events.filter(e => e.done).slice(-5);
            return `<span class="form-pips">${evs.map(e => { const p = e.res.order.indexOf(id) + 1; const d = e.res.dnf[id];
                return K.resultPip(p, d, (e.res.pts[id] || 0) > 0, `R${e.r}: ${d ? 'DNF' : 'P' + p}`); }).join('')}</span>`;
        };
        const leader = st[0]?.pts || 0;
        let body = '';
        if (tab === 'drivers') body = st.length ? `<div class="sc-table-wrap"><table class="table"><thead><tr><th>#</th><th>Driver</th><th>Team</th><th class="num">Pts</th><th class="num">Gap</th><th class="num">W</th><th class="num">Pod</th><th class="num">Poles</th><th class="num">DNF</th><th class="num">Avg</th>${mine ? '<th>Form</th>' : ''}</tr></thead>
            <tbody>${st.map(r => { const d = r.id === 'P' ? S.drivers.P : S.drivers[r.id] || S.retired[r.id]; const tm = S.teams[r.team];
                return `<tr class="${r.id === 'P' ? 'sc-me' : ''}" data-driver="${esc(r.id)}"><td class="rank">${r.rank}</td><td>${d ? K.flag(d.nat) : ''} ${esc(r.name)}</td>
                <td><span class="team-dot" style="background:${esc(tm?.color || '#555')}"></span> ${esc(tm?.name || '')}</td><td class="num"><strong>${r.pts}</strong></td><td class="num muted">${r.rank > 1 ? '−' + (leader - r.pts) : ''}</td>
                <td class="num">${r.w}</td><td class="num">${r.p}</td><td class="num">${r.pl}</td><td class="num">${r.dnf}</td><td class="num">${r.avg ? r.avg.toFixed(1) : '—'}</td>${mine ? `<td>${form(r.id)}</td>` : ''}</tr>`; }).join('')}</tbody></table></div>`
            : K.empty('🏆', 'No results yet', 'Standings appear after the first round.');
        else if (tab === 'teams') body = ts.length ? `<div class="sc-table-wrap"><table class="table"><thead><tr><th>#</th><th>Team</th><th class="num">Pts</th><th class="num">Wins</th><th class="num">Podiums</th><th>Drivers</th></tr></thead>
            <tbody>${ts.map(r => { const tm = S.teams[r.id]; return `<tr class="${r.id === S.player.teamId ? 'sc-me' : ''}" data-team="${esc(r.id)}"><td class="rank">${r.rank}</td>
                <td><span class="team-dot" style="background:${esc(tm?.color || '#555')}"></span> ${esc(r.name)}${tm?.make ? ` <span class="muted small">${esc(tm.make)}</span>` : ''}</td>
                <td class="num"><strong>${r.pts}</strong></td><td class="num">${r.w}</td><td class="num">${r.p}</td><td class="small muted">${(tm?.drivers || []).map(id => esc(dn(S, id))).join(', ')}</td></tr>`; }).join('')}</tbody></table></div>`
            : K.empty('🏆', 'No results yet', 'Team standings appear after the first round.');
        else {
            const champs = S.series[sid]?.champs || [];
            body = champs.length ? `<div class="sc-table-wrap"><table class="table"><thead><tr><th>Season</th><th>Drivers' champion</th><th>Teams' champion</th><th></th></tr></thead>
                <tbody>${champs.slice().reverse().map(c => { const h = S.history.find(x => x.no === c.no && x.sid === sid);
                    return `<tr class="${c.d === 'P' ? 'sc-me' : ''}"><td>${c.year}</td><td>${c.d === 'P' ? '⭐ ' : ''}${esc(c.dn)}</td><td>${esc(c.tn || '')}</td><td>${h ? `<button class="btn btn-ghost btn-sm" data-hist="${h.no}">Your season</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>`
                : K.empty('📜', 'No completed seasons yet', 'Champions are recorded here at the end of every season.');
        }
        el.innerHTML = `
        <div class="view-head"><div><p class="section-label">${S.year} · after ${done}/${total} rounds</p><h1>🏆 Standings</h1></div>
            <label class="field sc-narrow"><span>Championship</span>${K.select('st-series', g.series.map(s => [s.id, `${s.id === S.season.sid ? '⭐ ' : ''}${s.name}`]), sid)}</label></div>
        ${K.tabs([['drivers', 'Drivers'], ['teams', 'Teams'], ['history', 'Past champions']], tab, 'data-stab')}
        ${K.panel(`${esc(sd.name)}${mine ? '' : ' <span class="muted small">(simulated)</span>'}`, body)}`;
        K.$('#st-series', el).addEventListener('change', (e) => App().go('standings', `${e.target.value}:${tab}`));
        K.$$('[data-stab]', el).forEach(b => b.addEventListener('click', () => App().go('standings', `${sid}:${b.dataset.stab}`)));
        K.$$('[data-driver]', el).forEach(r => r.addEventListener('click', () => V.driverCard(S, r.dataset.driver)));
        K.$$('[data-team]', el).forEach(r => r.addEventListener('click', () => V.teamCard(S, r.dataset.team)));
        K.$$('[data-hist]', el).forEach(b => b.addEventListener('click', () => V.seasonCard(S, Number(b.dataset.hist))));
    };

    V.driverCard = function (S, id) {
        const P = S.player;
        if (id === 'P') { App().go('career'); return; }
        const d = S.drivers[id] || S.retired[id];
        if (!d) return;
        const t = S.teams[d.teamId];
        const scout = S.teams[P.teamId]?.facilities?.scouting || (P.role === 'driver' ? 2 : 1);
        const skill = scout >= 2 || P.role === 'driver' ? Math.round(d.skill) : `${Math.round(d.skill - 6)}–${Math.round(d.skill + 6)}`;
        K.Modal.open(`${K.Modal.head(`${d.first} ${d.last}`, `${SC.nationName(d.nat)} · age ${d.age}${d.num != null ? ' · #' + d.num : ''}`)}
            <div class="stat-strip">${K.stat(skill, 'Rating')}${d.pot && scout >= 3 ? K.stat(Math.round(d.pot), 'Potential') : ''}${K.stat(d.car.t, 'Titles')}${K.stat(d.car.w, 'Wins')}${K.stat(d.car.p, 'Podiums')}${K.stat(d.car.st, 'Starts')}</div>
            <p>${t ? `Drives for <strong>${esc(t.name)}</strong> in the ${esc(E().seriesDef(S, t.sid)?.name || '')}${d.years ? ` (${d.years} season${d.years > 1 ? 's' : ''} left)` : ''}.` : S.retired[id] ? 'Retired.' : 'Free agent.'}</p>
            ${d.hist && d.hist.length ? `<div class="sc-table-wrap"><table class="table table-tight"><thead><tr><th>Season</th><th>Series</th><th class="num">Pos</th><th class="num">Pts</th><th class="num">W</th></tr></thead><tbody>
                ${d.hist.slice().reverse().slice(0, 12).map(h => `<tr><td>${S.startYear + h.s - 1}</td><td>${esc(E().seriesDef(S, h.sid)?.short || h.sid)}</td><td class="num">${K.ord(h.pos)}</td><td class="num">${h.pts}</td><td class="num">${h.w}</td></tr>`).join('')}</tbody></table></div>` : ''}
            <div class="modal-actions"><button class="btn btn-primary" data-close>Close</button></div>`);
    };

    V.teamCard = function (S, id) {
        const t = S.teams[id]; if (!t) return;
        const field = E().teamsIn(S, t.sid);
        const avg = (k) => field.reduce((s, x) => s + x.car[k], 0) / Math.max(1, field.length);
        K.Modal.open(`${K.Modal.head(t.name, `${E().seriesDef(S, t.sid)?.name || 'Inactive'} · ${SC.nationName(t.nat)}${t.make ? ' · ' + t.make : ''}`)}
            <div class="stat-strip">${K.stat(t.prestige, 'Prestige')}${K.stat(t.titles, 'Titles')}${K.stat(t.cars, 'Cars')}${K.stat(S.year - t.founded + 1, 'Years racing')}</div>
            <div class="sc-car-mini">${Object.entries(E().AREAS).map(([k, a]) => K.rating(a.label, t.car[k], { mark: avg(k), markLabel: 'Field average', icon: a.icon })).join('')}</div>
            <p class="small">Drivers: ${t.drivers.map(x => esc(dn(S, x))).join(', ') || '—'}</p>
            ${t.hist.length ? `<p class="muted small">Recent: ${t.hist.slice(-6).reverse().map(h => `${S.startYear + h.s - 1} ${K.ord(h.pos)}`).join(' · ')}</p>` : ''}
            <div class="modal-actions"><button class="btn btn-primary" data-close>Close</button></div>`);
    };

    V.seasonCard = function (S, no) {
        const h = S.history.find(x => x.no === no); if (!h) return;
        K.Modal.open(`${K.Modal.head(`${h.year} — ${h.series}`, `${h.team} · ${E().ROLES[h.role]?.label || ''}`)}
            <div class="stat-strip">${h.pos ? K.stat(K.ord(h.pos), 'Position') : ''}${K.stat(h.pts, 'Points')}${h.row ? K.stat(h.row.w, 'Wins') + K.stat(h.row.p, 'Podiums') : ''}${h.teamPos ? K.stat(K.ord(h.teamPos), 'Team') : ''}</div>
            <h3 class="sc-subhead">Your rounds</h3>
            <div class="sc-table-wrap"><table class="table table-tight"><thead><tr><th>R</th><th>Track</th><th>Result</th><th>Winner</th></tr></thead><tbody>
            ${h.events.map(e => `<tr><td>${e.r}</td><td>${esc(e.t)}</td><td>${e.p ? K.pos(e.p.pos, e.p.dnf) + ` <span class="muted small">from P${e.p.st}${e.p.sim ? ' · sim' : ''}</span>` : ''}</td><td>${esc(dn(S, e.order[0]))}</td></tr>`).join('')}</tbody></table></div>
            <h3 class="sc-subhead">Final top 10</h3>
            <table class="table table-tight"><tbody>${h.top.map((r, i) => `<tr class="${r.id === 'P' ? 'sc-me' : ''}"><td>${i + 1}</td><td>${esc(r.n)}</td><td class="num">${r.pts}</td></tr>`).join('')}</tbody></table>
            <div class="modal-actions"><button class="btn btn-primary" data-close>Close</button></div>`, { wide: true });
    };

    /* ============================================================
       TEAM
       ============================================================ */
    V.team = async function (el, tab) {
        const S = App().S; const P = S.player;
        const t = S.teams[P.teamId];
        if (!t) { el.innerHTML = K.empty('🛠️', 'No team', 'You are between teams.'); return; }
        const manage = P.role !== 'driver';
        const tabs = manage ? [['overview', 'Overview'], ['car', 'Car & R&D'], ['facilities', 'Facilities'], ['staff', 'Staff'], ['sponsors', 'Sponsors']] : [['overview', 'Overview'], ['car', 'Car']];
        tab = tabs.some(x => x[0] === tab) ? tab : 'overview';
        const sd = E().seriesDef(S, t.sid);
        let body = '';
        if (tab === 'overview') body = teamOverview(S, t);
        else if (tab === 'car') body = carTab(S, t, manage);
        else if (tab === 'facilities') body = facilitiesTab(S, t);
        else if (tab === 'staff') body = staffTab(S, t);
        else body = sponsorsTab(S, t);
        el.innerHTML = `
        <div class="view-head"><div><p class="section-label">${esc(sd.name)}${t.make ? ' · ' + esc(t.make) : ''}</p><h1><span class="team-dot sc-team-dot-lg" style="background:${esc(t.color)}"></span> ${esc(t.name)}</h1></div>
            ${manage ? `<div class="chip-row"><span class="chip sc-money-chip ${K.moneyCls(t.budget)}">🏢 Budget ${K.money(t.budget)}</span></div>` : ''}</div>
        ${K.tabs(tabs, tab, 'data-ttab')}
        <div class="sc-tab-body">${body}</div>`;
        K.$$('[data-ttab]', el).forEach(b => b.addEventListener('click', () => App().go('team', b.dataset.ttab)));
        wireTeam(el, S, t, tab);
    };

    function teamOverview(S, t) {
        const P = S.player;
        const ts = E().teamStandings(S, t.sid);
        const me = ts.find(r => r.id === t.id);
        const drivers = t.drivers.map(id => ({ id, d: id === 'P' ? S.drivers.P : S.drivers[id] })).filter(x => x.d);
        const staff = t.staff ? E().staffList(t) : [];
        // Season head-to-head vs each teammate (classification order already puts DNFs last).
        const h2h = t.drivers.includes('P') ? t.drivers.filter(id => id !== 'P').map(id => {
            let me = 0, them = 0;
            for (const e of S.season.events) {
                if (!e.done || !e.res) continue;
                const a = e.res.order.indexOf('P'), b = e.res.order.indexOf(id);
                if (a < 0 || b < 0) continue;
                if (a < b) me++; else them++;
            }
            return { id, me, them };
        }) : [];
        return `<div class="grid-2">
            ${K.panel('Team', `<div class="stat-strip">${K.stat(me ? K.ord(me.rank) : '—', 'Teams’ standing')}${K.stat(t.prestige, 'Prestige')}${K.stat(t.titles, 'Titles')}${K.stat(t.cars, 'Cars')}</div>
                ${P.role === 'driver' ? `<p>Your contract: <strong>${K.money(P.contract.salary)}/season</strong>${P.contract.salary < 0 ? ' (you pay for the seat)' : ''}, ${P.contract.seasons > 0 ? P.contract.seasons + ' season(s) left' : 'expiring'}, ${P.contract.status === 'lead' ? 'lead driver' : 'second driver'}.
                    Win bonus ${K.money(P.contract.winBonus)} · podium bonus ${K.money(P.contract.podiumBonus)} · ${Math.round(P.contract.prizeShare * 100)}% of your prize money.</p>
                    <div class="sc-meter-row"><span>Team faith in you</span>${K.progress(P.morale)}</div>
                    <p class="muted small">Beat your teammate, score podiums and keep the car in one piece to keep faith high — it decides whether you're re-signed.</p>` : ''}
                ${P.role === 'principal' ? `<p>Board target: <strong>P${P.board.target}</strong> in the teams' championship. Confidence ${P.board.confidence}%.</p>${K.progress(P.board.confidence)}` : ''}`)}
            ${K.panel('Drivers', `<table class="table table-tight"><tbody>${drivers.map(({ id, d }) => `<tr class="${id === 'P' ? 'sc-me' : ''}"><td>#${d.num ?? ''}</td><td>${K.flag(d.nat)} ${esc(d.first + ' ' + d.last)}${id === 'P' ? ' (you)' : ''}</td><td class="num">${Math.round(id === 'P' ? P.dr : d.skill)}</td><td class="muted small">age ${d.age}${id !== 'P' ? ` · ${K.money(d.salary)}/yr · ${d.years}y` : ''}</td></tr>`).join('')}</tbody></table>
                ${h2h.some(x => x.me + x.them) ? `<h3 class="sc-subhead">Head-to-head this season</h3>${h2h.map(x => `<div class="sc-line"><span>You vs ${esc(dn(S, x.id))}</span><strong class="${x.me >= x.them ? 'sc-pos' : 'sc-neg'}">${x.me} – ${x.them}</strong></div>`).join('')}` : ''}
                ${S.season.preview && P.role !== 'principal' ? `<p class="muted small">Pre-season prediction: P${S.season.preview.expect} of ${S.season.preview.field}.</p>` : ''}
                ${staff.length ? `<h3 class="sc-subhead">Key staff</h3><ul class="small">${staff.map(s => `<li>${SC.STAFF_ROLES[s.role].icon} ${esc(SC.STAFF_ROLES[s.role].label)}: <strong>${esc(s.first + ' ' + s.last)}</strong> (${s.skill})</li>`).join('')}</ul>` : ''}`)}
        </div>`;
    }

    function carTab(S, t, manage) {
        const field = E().teamsIn(S, t.sid);
        const avg = (k) => field.reduce((s, x) => s + x.car[k], 0) / field.length;
        const best = (k) => Math.max(...field.map(x => x.car[k]));
        const spec = E().seriesDef(S, t.sid).spec;
        const ranks = Object.keys(SC.TRACK_TYPES).filter(ty => E().gameOf(S).tracks.some(tn => E().trackInfo(S, tn).type === ty)).map(ty => {
            const sorted = field.slice().sort((a, b) => E().carScore(b, ty) - E().carScore(a, ty));
            return { ty, rank: sorted.findIndex(x => x.id === t.id) + 1 };
        });
        const cars = `${K.panel('Car performance', `
            ${Object.entries(E().AREAS).map(([k, a]) => `<div class="sc-car-row">${K.rating(a.label, t.car[k], { mark: avg(k), markLabel: 'Field average', icon: a.icon })}<span class="muted small">best ${best(k).toFixed(1)}</span></div>`).join('')}
            <p class="muted small">Marker = field average. ${spec < 0.2 ? '⚠️ Spec series — car differences only matter a little here; driver and setup do the talking.' : spec >= 0.8 ? 'Constructor series — the car is king.' : ''}</p>
            <div class="chip-row">${ranks.map(r => `<span class="chip">${E().typeInfo(r.ty).icon} ${esc(E().typeInfo(r.ty).label)}: ${K.ord(r.rank)}</span>`).join('')}</div>
            ${S.regsResetIn <= 1 ? '<div class="panel-alert">📜 New technical regulations arrive next season — cars will be pulled back toward the pack.</div>' : ''}`)}`;
        if (!manage) return cars + K.panel('Development', '<p class="muted">Your team runs its own R&D program. Deliver results and good technical feedback (Market → Training) to help it along.</p>');
        const slots = E().rdSlots(t);
        const projects = (t.rd || []);
        const levels = Object.entries(E().RD_LEVELS);
        return `<div class="grid-2">${cars}
            ${K.panel(`🔬 R&D — ${projects.length}/${slots} slots busy`, `
                ${projects.length ? projects.map(p => `<div class="sc-project"><strong>${esc(p.area === 'next' ? "Next year's car" : E().AREAS[p.area].label)}</strong> · ${esc(E().RD_LEVELS[p.level].label)}
                    ${K.progress((p.total - p.left) / p.total * 100)}<span class="muted small">${p.left} round${p.left === 1 ? '' : 's'} to go</span></div>`).join('') : '<p class="muted">No projects running.</p>'}
                ${t.nextYear ? `<p class="small">📐 Banked for next year's car: <strong>+${t.nextYear.toFixed(1)}</strong></p>` : ''}
                <h3 class="sc-subhead">Start a program</h3>
                <div class="form-row">
                    <label class="field"><span>Area</span>${K.select('rd-area', [...Object.entries(E().AREAS).map(([k, a]) => [k, `${a.icon} ${a.label}`]), ['next', "📐 Next year's car (applied at season rollover)"]], 'aero')}</label>
                </div>
                <div class="sc-rd-levels">${levels.map(([k, L]) => `<button class="sc-rd-level" data-rd="${k}" ${projects.length >= slots ? 'disabled' : ''}>
                    <strong>${esc(L.label)}</strong><span>${K.money(E().rdCost(S, k))}</span><span class="muted small">${L.rounds} rounds · +${L.gain[0]}–${L.gain[1]} pts · ${Math.round(L.fail * 100)}% risk</span></button>`).join('')}</div>
                <p class="muted small">Gains scale with your Technical Director, Design Centre, Wind Tunnel (aero) and Dyno (engine)${S.player.role === 'owner' ? ', and your own technical feedback' : ''}. The further ahead of the field you are, the harder each point gets. Each winter every car keeps ~72% of its advantage over the pack, and the whole field is pulled back toward the regulations baseline.</p>`)}
        </div>`;
    }

    function facilitiesTab(S, t) {
        const builds = t.builds || [];
        return `<div class="card-grid">${Object.entries(E().FACILITIES).map(([k, f]) => {
            const lvl = t.facilities[k];
            const c = E().facilityCost(S, k);
            const b = builds.find(x => x.key === k);
            return `<article class="panel sc-fac"><div class="panel-head"><h2>${f.icon} ${esc(f.label)}</h2><span class="sc-level">L${lvl}</span></div>
                <div class="sc-level-pips">${[1, 2, 3, 4, 5].map(i => `<span class="${i <= lvl ? 'on' : ''}"></span>`).join('')}</div>
                <p class="muted small">${esc(f.desc)}</p>
                ${b ? `<p class="small">🏗️ Building L${b.to}: ${b.left} round${b.left === 1 ? '' : 's'} left</p>` : c ? `<button class="btn btn-secondary btn-sm btn-block sc-wrap-btn" data-fac="${k}"><span>Upgrade to L${c.to}</span><span class="small">${K.money(c.cost)} · ${c.rounds} rounds</span></button>` : '<p class="small">✅ Maximum level</p>'}
            </article>`;
        }).join('')}</div>`;
    }

    function staffTab(S, t) {
        const cur = E().staffList(t);
        const pool = S.staffPool.slice().sort((a, b) => a.role.localeCompare(b.role) || b.skill - a.skill);
        return `<div class="grid-2">
            ${K.panel('Your staff', cur.map(s => `<div class="sc-staff"><div><strong>${SC.STAFF_ROLES[s.role].icon} ${esc(s.first + ' ' + s.last)}</strong> <span class="muted small">${esc(SC.STAFF_ROLES[s.role].label)} · age ${s.age}</span>
                ${K.bar(s.skill)}<span class="muted small">Skill ${s.skill} · ${K.money(s.salary)}/season · ${s.years} season${s.years === 1 ? '' : 's'} left</span></div></div>`).join('') +
                `<p class="muted small">${Object.values(SC.STAFF_ROLES).map(r => `${r.icon} <strong>${esc(r.label)}</strong>: ${esc(r.desc)}`).join('<br>')}</p>`)}
            ${K.panel('Staff market', pool.length ? `<div class="sc-table-wrap"><table class="table table-tight"><thead><tr><th>Name</th><th>Role</th><th class="num">Skill</th><th class="num">Salary</th><th></th></tr></thead><tbody>
                ${pool.map(s => `<tr><td>${K.flag(s.nat)} ${esc(s.first + ' ' + s.last)}<br><span class="muted small">age ${s.age}, ${s.years}y</span></td><td>${SC.STAFF_ROLES[s.role].icon} ${esc(SC.STAFF_ROLES[s.role].label)}</td>
                <td class="num">${s.skill}</td><td class="num">${K.money(s.salary)}</td><td><button class="btn btn-secondary btn-sm" data-hire-staff="${s.id}">Hire</button></td></tr>`).join('')}</tbody></table></div>
                <p class="muted small">Hiring replaces the current person in that role (engineers replace your weakest engineer once every car has one). Signing fee 20% of salary; the person leaving gets severance.</p>`
                : '<p class="muted">The market refreshes every off-season.</p>')}
        </div>`;
    }

    function sponsorsTab(S, t) {
        const offers = S.sponsorOffers.filter(o => !o.personal);
        const slotInfo = Object.entries(E().SPONSOR_SLOTS).map(([k, s]) => `<span class="chip">${esc(s.label)}: ${(t.sponsors || []).filter(x => x.slot === k).length}/${s.count + (k === 'secondary' && (t.facilities?.hospitality || 1) >= 3 ? 1 : 0)}</span>`).join('');
        const card = (sp, offer) => `<article class="sc-offer" style="--gc:var(--accent-2)">
            <div class="sc-offer-head"><strong>${esc(sp.brand)}</strong> <span class="muted small">${esc(sp.industry)}</span> ${K.badge(E().SPONSOR_SLOTS[sp.slot]?.label || sp.slot, 'badge-blue')}</div>
            <div class="chip-row"><span class="chip">💰 ${K.money(sp.value)}/season</span><span class="chip">${sp.seasons} season${sp.seasons > 1 ? 's' : ''}${offer ? '' : ' left'}</span>${sp.signing && offer ? `<span class="chip">Signing ${K.money(sp.signing)}</span>` : ''}</div>
            ${sp.obj ? `<p class="small">🎯 ${esc(E().objLabel(sp.obj))} → bonus ${K.money(sp.bonus)}${!offer && sp.obj.kind !== 'champ' ? ` <span class="muted">(${sp.obj.hits || 0}/${sp.obj.target})</span>` : ''}</p>` : ''}
            ${!offer ? `<div class="sc-meter-row"><span class="small">Happiness</span>${K.progress(sp.happy || 60)}</div>` : ''}
            <div class="btn-row">${offer ? `<button class="btn btn-primary btn-sm" data-sign="${sp.id}">Sign</button><button class="btn btn-ghost btn-sm" data-decline-sp="${sp.id}">Decline</button>`
                : `<button class="btn btn-ghost btn-sm" data-drop="${sp.id}">End deal (fee ${K.money(Math.round(sp.value * 0.25))})</button>`}</div></article>`;
        return `<div class="chip-row sc-gap">${slotInfo}</div>
            <div class="grid-2">
                ${K.panel('Current sponsors', (t.sponsors || []).length ? `<div class="sc-offers">${t.sponsors.map(sp => card(sp, false)).join('')}</div>` : '<p class="muted">No sponsors yet — sign some before round 1.</p>')}
                ${K.panel('Offers', offers.length ? `<div class="sc-offers">${offers.map(sp => card(sp, true)).join('')}</div>` : '<p class="muted">New offers arrive every off-season (and sometimes mid-season). A better Commercial Director and Hospitality Suite bring more.</p>')}
            </div>`;
    }

    function wireTeam(el, S, t, tab) {
        K.$$('[data-rd]', el).forEach(b => b.addEventListener('click', () => App().act((S2) => E().startRD(S2, K.$('#rd-area', el).value, b.dataset.rd), { ok: 'R&D program started. 🔬' })));
        K.$$('[data-fac]', el).forEach(b => b.addEventListener('click', () => App().act((S2) => E().upgradeFacility(S2, b.dataset.fac), { ok: (c) => `Construction started — ready in ${c.rounds} rounds. 🏗️` })));
        K.$$('[data-hire-staff]', el).forEach(b => b.addEventListener('click', () => App().act((S2) => E().hireStaff(S2, b.dataset.hireStaff), { ok: (s) => `${s.first} ${s.last} hired.` })));
        K.$$('[data-sign]', el).forEach(b => b.addEventListener('click', () => App().act((S2) => E().signSponsor(S2, b.dataset.sign), { ok: 'Sponsor signed. 🤝' })));
        K.$$('[data-decline-sp]', el).forEach(b => b.addEventListener('click', () => App().act((S2) => E().declineSponsor(S2, b.dataset.declineSp), { ok: 'Offer declined.' })));
        K.$$('[data-drop]', el).forEach(b => b.addEventListener('click', async () => {
            if (await K.Modal.confirm('End sponsorship?', 'Ending a deal early costs a termination fee of 25% of its season value.', { ok: 'End deal', danger: true }))
                App().act((S2) => E().dropSponsor(S2, b.dataset.drop), { ok: (fee) => `Deal ended (fee ${K.money(fee)}).` });
        }));
    }

    /* ============================================================
       MARKET
       ============================================================ */
    V.market = async function (el, tab) {
        const S = App().S; const P = S.player;
        const driver = P.role === 'driver';
        const tabs = driver ? [['contracts', 'Contracts'], ['sponsors', 'Personal sponsors'], ['training', 'Training'], ['buy', 'Buy a team']]
            : [['drivers', 'Driver market'], ['mine', 'Your drivers'], ['staff', 'Staff'], ...(P.role === 'owner' ? [['personal', 'Personal sponsors']] : [])];
        tab = tabs.some(x => x[0] === tab) ? tab : tabs[0][0];
        let body = '';
        if (tab === 'contracts') body = contractsTab(S);
        else if (tab === 'sponsors' || tab === 'personal') body = personalSponsorsTab(S);
        else if (tab === 'training') body = trainingTab(S);
        else if (tab === 'buy') body = buyTab(S);
        else if (tab === 'drivers') body = driverMarketTab(S);
        else if (tab === 'mine') body = myDriversTab(S);
        else if (tab === 'staff') { App().go('team', 'staff'); return; }
        el.innerHTML = `<div class="view-head"><div><h1>🤝 Market</h1><p class="muted">${driver ? 'Your contract, sponsors and personal development.' : 'Sign drivers, and manage your own personal deals.'}</p></div></div>
            ${K.tabs(tabs, tab, 'data-mtab')}<div class="sc-tab-body">${body}</div>`;
        K.$$('[data-mtab]', el).forEach(b => b.addEventListener('click', () => App().go('market', b.dataset.mtab)));
        V._wireOffers(el);
        K.$('#mk-agent', el)?.addEventListener('change', (e) => App().act((S2) => E().toggleAgent(S2, e.target.checked), { ok: e.target.checked ? 'Agent hired. 🕴️' : 'Agent released.' }));
        K.$$('[data-psign]', el).forEach(b => b.addEventListener('click', () => App().act((S2) => E().signPersonalSponsor(S2, b.dataset.psign), { ok: 'Personal sponsor signed. 🤝' })));
        K.$$('[data-pdecline]', el).forEach(b => b.addEventListener('click', () => App().act((S2) => E().declineSponsor(S2, b.dataset.pdecline), { ok: 'Declined.' })));
        K.$$('[data-train]', el).forEach(b => b.addEventListener('click', () => App().act((S2) => E().startTraining(S2, b.dataset.train), { ok: 'Program booked. 🏋️' })));
        K.$$('[data-buy]', el).forEach(b => b.addEventListener('click', async () => {
            const t = S.teams[b.dataset.buy];
            if (await K.Modal.confirm(`Buy ${esc(t.name)}?`, `Price ${K.money(E().teamPrice(S, t))} from your personal wallet. You become an owner-driver: every bill and every decision is yours from next season.`, { ok: 'Buy team' }))
                App().act((S2) => E().buyTeam(S2, b.dataset.buy), { ok: 'Team purchased! 🏢' });
        }));
        K.$$('[data-hire]', el).forEach(b => b.addEventListener('click', () => hireModal(S, b.dataset.hire)));
        K.$$('[data-release]', el).forEach(b => b.addEventListener('click', async () => {
            const d = S.drivers[b.dataset.release];
            const sev = Math.round(d.salary * Math.max(0, d.years) * 0.5);
            if (await K.Modal.confirm(`Release ${esc(d.first + ' ' + d.last)}?`, `Termination costs ${K.money(sev)} (half the remaining contract). You'll need a replacement before the next round — or a stopgap is signed automatically.`, { ok: 'Release', danger: true }))
                App().act((S2) => E().releaseTeamDriver(S2, b.dataset.release), { ok: 'Driver released.' });
        }));
        K.$('#mk-filter', el)?.addEventListener('change', (e) => { V._marketFilter = e.target.value; App().go('market', 'drivers'); });
    };

    function contractsTab(S) {
        const P = S.player; const t = S.teams[P.teamId];
        return `<div class="grid-2">
            ${K.panel('Current contract', `<p><strong>${esc(t.name)}</strong> — ${esc(E().seriesDef(S, t.sid).name)}</p>
                <div class="chip-row"><span class="chip">${K.money(P.contract.salary)}/season</span><span class="chip">${P.contract.seasons > 0 ? P.contract.seasons + ' season(s) left' : 'Expiring'}</span><span class="chip">${P.contract.status === 'lead' ? 'Lead driver' : 'Second driver'}</span></div>
                <div class="sc-meter-row"><span>Team faith</span>${K.progress(P.morale)}</div>
                <div class="sc-meter-row"><span>Market appeal</span>${K.progress(Math.min(100, E().appeal(S)))}</div>
                <p class="muted small">Teams judge your driver rating (${Math.round(P.dr)}), reputation (${Math.round(P.rep)}), marketability and feedback. Offers arrive mid-season (from ~60% of the calendar) and at season end.</p>
                <label class="check"><input id="mk-agent" type="checkbox" ${P.agent ? 'checked' : ''}> 🕴️ Use an agent — more & better offers, +12% salaries, negotiates harder; takes 8% of your salary.</label>`)}
            ${K.panel('Offers', S.offers.length ? `<div class="sc-offers">${S.offers.map(o => V._offerCard(S, o)).join('')}</div>` : `<p class="muted">No offers right now.${S.phase === 'season' ? ' Keep delivering — teams watch results.' : ''}</p>`)}
        </div>`;
    }

    function personalSponsorsTab(S) {
        const P = S.player;
        const offers = S.sponsorOffers.filter(o => o.personal);
        const card = (sp, offer) => `<article class="sc-offer"><div class="sc-offer-head"><strong>${esc(sp.brand)}</strong> <span class="muted small">${esc(sp.industry)}</span></div>
            <div class="chip-row"><span class="chip">💰 ${K.money(sp.value)}/season</span><span class="chip">${sp.seasons} season${sp.seasons > 1 ? 's' : ''}</span></div>
            ${sp.obj ? `<p class="small">🎯 ${esc(E().objLabel(sp.obj))} → bonus ${K.money(sp.bonus)}${!offer ? ` (${sp.obj.hits || 0}/${sp.obj.target})` : ''}</p>` : ''}
            ${offer ? `<div class="btn-row"><button class="btn btn-primary btn-sm" data-psign="${sp.id}">Sign</button><button class="btn btn-ghost btn-sm" data-pdecline="${sp.id}">Decline</button></div>` : ''}</article>`;
        return `<div class="grid-2">
            ${K.panel(`Your deals (${P.sponsors.length}/3)`, P.sponsors.length ? `<div class="sc-offers">${P.sponsors.map(sp => card(sp, false)).join('')}</div>` : '<p class="muted">No personal sponsors yet.</p>')}
            ${K.panel('Offers', offers.length ? `<div class="sc-offers">${offers.map(sp => card(sp, true)).join('')}</div>` : '<p class="muted">Brands come calling as your reputation and marketability grow — new offers each off-season and sometimes mid-season.</p>')}
        </div>`;
    }

    function trainingTab(S) {
        const P = S.player;
        return `<div class="grid-2">
            ${K.panel('Off-track attributes', Object.entries(P.attrs).map(([k, v]) => K.rating(k[0].toUpperCase() + k.slice(1), v)).join('') +
                (P.training ? `<div class="panel-alert">🏋️ ${esc(E().TRAINING[P.training.key].label)} — finishes after round ${P.training.until}.</div>` : ''))}
            ${K.panel('Programs', Object.entries(E().TRAINING).map(([k, tr]) => `<div class="sc-line"><div><strong>${esc(tr.label)}</strong><p class="muted small">${esc(tr.desc)} · ${tr.rounds} rounds · +${tr.gain[0]}–${tr.gain[1]}</p></div>
                <button class="btn btn-secondary btn-sm" data-train="${k}" ${P.training ? 'disabled' : ''}>${K.money(E().trainingCost(S, k))}</button></div>`).join(''))}
        </div>`;
    }

    function buyTab(S) {
        const P = S.player;
        const open = S.phase === 'postseason';
        const teams = E().teamsIn(S, P.sid).filter(t => !t.player).sort((a, b) => E().teamPrice(S, a) - E().teamPrice(S, b));
        return K.panel('Buy your way into ownership', `<p class="muted">Own a team and you become an owner-driver: budget, R&D, facilities, staff and sponsors are yours to run. Team sales only close in the off-season.</p>
            <p>You have <strong>${K.money(P.money)}</strong>.</p>
            <div class="sc-table-wrap"><table class="table table-tight"><thead><tr><th>Team</th><th class="num">Prestige</th><th class="num">Car</th><th class="num">Price</th><th></th></tr></thead><tbody>
            ${teams.map(t => { const price = E().teamPrice(S, t); return `<tr><td><span class="team-dot" style="background:${esc(t.color)}"></span> ${esc(t.name)}</td><td class="num">${t.prestige}</td><td class="num">${E().carScore(t, 'rd').toFixed(1)}</td><td class="num">${K.money(price)}</td>
                <td><button class="btn btn-secondary btn-sm" data-buy="${t.id}" ${open && P.money >= price ? '' : 'disabled'}>${open ? 'Buy' : 'Off-season only'}</button></td></tr>`; }).join('')}
            </tbody></table></div>`);
    }

    V._marketFilter = 'fa';
    function driverMarketTab(S) {
        const P = S.player;
        const t = S.teams[P.teamId];
        const sd = E().seriesDef(S, t.sid);
        const f = V._marketFilter;
        let rows = E().marketFor(S);
        if (f === 'fa') rows = rows.filter(r => !r.team);
        if (f === 'young') rows = rows.filter(r => r.d.age <= 23);
        const seats = t.cars - t.drivers.length;
        return K.panel(`Driver market ${seats > 0 ? K.badge(`${seats} empty seat${seats > 1 ? 's' : ''}`, 'badge-red') : ''}`, `
            <div class="form-row"><label class="field sc-narrow"><span>Show</span>${K.select('mk-filter', [['fa', 'Free agents'], ['all', 'Everyone (buyouts)'], ['young', 'Young talent (≤23)']], f)}</label>
                <p class="muted small">Scouting L${t.facilities.scouting}: ${t.facilities.scouting >= 3 ? 'true ratings and potential visible' : t.facilities.scouting >= 2 ? 'true ratings visible' : 'ratings are estimates (±6)'}. Series average rating: ${Math.round(E().fieldSkillMean(S, t.sid))}.</p></div>
            <div class="sc-table-wrap"><table class="table table-tight"><thead><tr><th>Driver</th><th class="num">Age</th><th class="num">Rating</th>${t.facilities.scouting >= 3 ? '<th class="num">Pot.</th>' : ''}<th>Currently</th><th class="num">Asks</th><th class="num">Buyout</th><th></th></tr></thead><tbody>
            ${rows.map(r => `<tr><td>${K.flag(r.d.nat)} ${esc(r.d.first + ' ' + r.d.last)}</td><td class="num">${r.d.age}</td><td class="num">${r.skillLo === r.skillHi ? r.skillLo : r.skillLo + '–' + r.skillHi}</td>
                ${t.facilities.scouting >= 3 ? `<td class="num">${Math.round(r.d.pot)}</td>` : ''}<td class="small">${r.team ? esc(r.team.name) + ` <span class="muted">(${esc(r.series)})</span>` : '<span class="muted">Free agent</span>'}</td>
                <td class="num">${K.money(r.ask)}</td><td class="num">${r.buyout ? K.money(r.buyout) : '—'}</td><td><button class="btn btn-secondary btn-sm" data-hire="${r.d.id}">Sign…</button></td></tr>`).join('')}
            </tbody></table></div>`);
        void sd;
    }

    function myDriversTab(S) {
        const P = S.player; const t = S.teams[P.teamId];
        const ds = t.drivers.filter(id => id !== 'P').map(id => S.drivers[id]).filter(Boolean);
        return K.panel(`Your drivers (${t.drivers.length}/${t.cars} seats)`, ds.length ? `<table class="table"><thead><tr><th>Driver</th><th class="num">Age</th><th class="num">Rating</th><th class="num">Salary</th><th class="num">Years</th><th></th></tr></thead><tbody>
            ${ds.map(d => `<tr><td>${K.flag(d.nat)} ${esc(d.first + ' ' + d.last)}</td><td class="num">${d.age}</td><td class="num">${Math.round(d.skill)}</td><td class="num">${K.money(d.salary)}</td><td class="num">${d.years}</td>
            <td><button class="btn btn-danger btn-sm" data-release="${d.id}">Release</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">No hired drivers.</p>');
    }

    function hireModal(S, id) {
        const d = S.drivers[id];
        const t = S.teams[S.player.teamId];
        const sd = E().seriesDef(S, t.sid);
        const ask = E().driverAsk(S, d, sd);
        const mates = t.drivers.filter(x => x !== 'P').map(x => S.drivers[x]).filter(Boolean);
        const seats = t.cars - (t.drivers.includes('P') ? 1 : 0);
        const full = mates.length >= seats;
        const oldTeam = d.teamId ? S.teams[d.teamId] : null;
        const buyout = oldTeam ? Math.round(d.salary * Math.max(1, d.years) * 0.6 / 100) * 100 : 0;
        K.Modal.open(`${K.Modal.head(`Sign ${d.first} ${d.last}`, `${SC.nationName(d.nat)} · age ${d.age}${oldTeam ? ' · under contract with ' + oldTeam.name : ' · free agent'}`)}
            <form id="hire-form" class="form-grid">
                <div class="form-row">
                    <label class="field"><span>Salary per season (asks ${K.money(ask)})</span><input id="hire-sal" class="input" type="number" min="0" step="100" value="${ask}"></label>
                    <label class="field"><span>Seasons</span>${K.select('hire-years', [[1, '1'], [2, '2'], [3, '3'], [4, '4']], 2)}</label>
                </div>
                ${full ? `<label class="field"><span>Replaces</span>${K.select('hire-replace', mates.map(m => [m.id, `${m.first} ${m.last} (${Math.round(m.skill)}) — severance ${K.money(Math.round(m.salary * Math.max(0, m.years) * 0.5))}`]), mates.sort((a, b) => a.skill - b.skill)[0].id)}</label>` : ''}
                <p class="muted small">Offer at least 85% of the asking salary or they walk. Signing fee: 10% of salary${buyout ? `. Buyout to ${esc(oldTeam.name)}: ${K.money(buyout)}` : ''}.</p>
                <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary">Sign driver</button></div>
            </form>`);
        K.$('#hire-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const opts = { salary: Number(K.$('#hire-sal').value), years: Number(K.$('#hire-years').value), replaceId: K.$('#hire-replace')?.value || null };
            K.Modal.close();
            App().act((S2) => E().hireDriver(S2, id, opts), { ok: (dd) => `${dd.first} ${dd.last} signed. ✍️` });
        });
    }

    /* ============================================================
       FINANCES
       ============================================================ */
    V.finances = async function (el, param) {
        const S = App().S; const P = S.player;
        const t = S.teams[P.teamId];
        const showTeam = P.role !== 'driver';
        const [walletP, seasonP] = String(param || '').split(':');
        const wallet = walletP === 't' && showTeam ? 't' : walletP === 'p' ? 'p' : (showTeam ? 't' : 'p');
        const season = Number(seasonP) || S.seasonNo;
        const rows = S.ledger.filter(l => l.w === wallet && l.s === season);
        const byCat = {};
        rows.forEach(l => { byCat[l.c] = (byCat[l.c] || 0) + l.a; });
        const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
        const income = rows.filter(l => l.a > 0).reduce((s, l) => s + l.a, 0);
        const spend = rows.filter(l => l.a < 0).reduce((s, l) => s + l.a, 0);
        const seasons = [...new Set([S.seasonNo, ...S.ledger.map(l => l.s)])].sort((a, b) => b - a);
        const catLabel = { salary: 'Salaries', bonus: 'Bonuses', prize: 'Prize money', sponsor: 'Sponsors', living: 'Living costs', agent: 'Agent', ops: 'Race operations', staff: 'Staff', facilities: 'Facilities', rd: 'R&D', repairs: 'Repairs', funding: 'Series & owner funding', interest: 'Interest', entry: 'Entry fees', team: 'Team deals', training: 'Training' };
        el.innerHTML = `
        <div class="view-head"><div><h1>💰 Finances</h1><p class="muted">Two separate wallets: your personal money and ${showTeam ? 'the team budget' : 'your team’s (run by the AI)'}.</p></div></div>
        <div class="stat-strip">
            ${K.stat(K.money(P.money), 'Personal wallet', K.moneyCls(P.money))}
            ${showTeam ? K.stat(K.money(t.budget), 'Team budget', K.moneyCls(t.budget)) : ''}
            ${K.stat(K.money(P.career.earn), 'Career earnings')}
            ${K.stat(K.signed(income + spend), `Season ${season} net (${wallet === 't' ? 'team' : 'personal'})`)}
        </div>
        <div class="form-row sc-gap">
            ${showTeam ? `<label class="field sc-narrow"><span>Wallet</span>${K.select('fi-wallet', [['t', '🏢 Team budget'], ['p', '👤 Personal']], wallet)}</label>` : ''}
            <label class="field sc-narrow"><span>Season</span>${K.select('fi-season', seasons.map(s => [s, `Season ${s} (${S.startYear + s - 1})`]), season)}</label>
        </div>
        <div class="grid-2">
            ${K.panel('Where the money went', cats.length ? K.hbars(cats.map(([c, v]) => ({ label: catLabel[c] || c, value: v, color: v >= 0 ? 'var(--good)' : 'var(--bad)' })), { fmt: (v) => K.signed(v) }) : '<p class="muted">No transactions yet this season.</p>')}
            ${K.panel('Season by season', S.history.length ? `<table class="table table-tight"><thead><tr><th>Season</th><th class="num">Personal net</th>${showTeam ? '<th class="num">Team net</th><th class="num">Team end</th>' : ''}<th class="num">Personal end</th></tr></thead><tbody>
                ${S.history.slice().reverse().map(h => `<tr><td>${h.year}</td><td class="num ${K.moneyCls(h.money.pIn + h.money.pOut)}">${K.signed(h.money.pIn + h.money.pOut)}</td>${showTeam ? `<td class="num ${K.moneyCls(h.money.tIn + h.money.tOut)}">${K.signed(h.money.tIn + h.money.tOut)}</td><td class="num">${h.money.tEnd != null ? K.money(h.money.tEnd) : '—'}</td>` : ''}<td class="num">${K.money(h.money.pEnd)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Completed seasons appear here.</p>')}
        </div>
        ${P.role === 'owner' ? K.panel('Your driver fee', `<p class="muted small">As owner-driver you pay yourself from the team budget each round.</p>
            <div class="form-row"><label class="field sc-narrow"><span>Fee per season</span><input id="fi-fee" class="input" type="number" min="0" step="100" value="${P.contract.salary}"></label><button class="btn btn-secondary" id="fi-fee-save">Save</button></div>`) : ''}
        ${K.panel(`Ledger — ${rows.length} entries`, rows.length ? `<div class="sc-table-wrap sc-ledger"><table class="table table-tight"><thead><tr><th>Round</th><th>Item</th><th class="num">Amount</th></tr></thead><tbody>
            ${rows.slice().reverse().map(l => `<tr><td>${l.r === 0 ? 'Pre-season' : l.r > (S.history.find(h => h.no === l.s)?.events.length ?? S.season.events.length) ? 'Season end' : 'R' + l.r}</td><td>${esc(l.l)}</td><td class="num ${K.moneyCls(l.a)}">${K.signed(l.a)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nothing yet.</p>')}`;
        K.$('#fi-wallet', el)?.addEventListener('change', (e) => App().go('finances', `${e.target.value}:${season}`));
        K.$('#fi-season', el)?.addEventListener('change', (e) => App().go('finances', `${wallet}:${e.target.value}`));
        K.$('#fi-fee-save', el)?.addEventListener('click', () => App().act((S2) => E().setDriverFee(S2, K.$('#fi-fee', el).value), { ok: (v) => `Driver fee set to ${K.money(v)}/season.` }));
    };

    /* ============================================================
       INBOX
       ============================================================ */
    V.inbox = async function (el, kind) {
        const S = App().S;
        const kinds = [['all', 'All'], ['race', '🏁 Races'], ['contract', '📨 Contracts'], ['sponsor', '🤝 Sponsors'], ['team', '🛠️ Team'], ['rd', '🔬 R&D'], ['finance', '💰 Money'], ['board', '📋 Board'], ['news', '📰 News']];
        kind = kinds.some(k => k[0] === kind) ? kind : 'all';
        const msgs = S.inbox.filter(m => kind === 'all' || m.kind === kind);
        el.innerHTML = `
        <div class="view-head"><div><h1>📨 Inbox</h1><p class="muted">${E().unread(S)} unread</p></div><button class="btn btn-ghost btn-sm" id="ib-read">Mark all read</button></div>
        ${K.tabs(kinds, kind, 'data-ik')}
        ${K.panel('', msgs.length ? `<div class="sc-inbox">${msgs.map(m => `<details class="sc-msg ${m.read ? '' : 'unread'}" data-msg="${m.id}">
            <summary><span class="sc-msg-icon">${m.icon}</span><span class="sc-msg-title">${esc(m.title)}</span><span class="muted small">S${m.s}${m.r ? ' · after R' + m.r : ''}</span></summary>
            <p>${esc(m.body)}</p></details>`).join('')}</div>` : K.empty('📭', 'Nothing here', 'Messages about races, contracts, sponsors and your team land here.'))}`;
        K.$$('[data-ik]', el).forEach(b => b.addEventListener('click', () => App().go('inbox', b.dataset.ik)));
        K.$$('[data-msg]', el).forEach(d => d.addEventListener('toggle', () => {
            const m = S.inbox.find(x => x.id === d.dataset.msg);
            if (d.open && m && !m.read) { m.read = true; d.classList.remove('unread'); App().save(); const badge = document.querySelector('[data-go="inbox"] .nav-badge'); const n = E().unread(S); if (badge) { if (n) badge.textContent = n; else badge.remove(); } }
        }));
        K.$('#ib-read', el).addEventListener('click', () => App().act((S2) => { S2.inbox.forEach(m => { m.read = true; }); }, { ok: 'All caught up.' }));
    };

    /* ============================================================
       CAREER (profile & stats)
       ============================================================ */
    V.career = async function (el) {
        const S = App().S; const P = S.player;
        const c = P.career;
        const principal = P.role === 'principal';
        const der = principal ? null : E().derivedAttributes(S);
        const hist = S.history;
        const labels = hist.map(h => String(h.year));
        const posChart = K.lineChart([{ name: principal ? 'Teams’ championship' : 'Championship position', color: 'var(--accent)', values: hist.map(h => principal ? h.teamPos : h.pos) }], labels, { invert: true, maxY: Math.max(2, ...hist.map(h => h.field || 2)) });
        const drChart = principal ? '' : K.lineChart([{ name: 'Driver rating', color: '#3987e5', values: hist.map(h => Math.round(h.dr)) }, { name: 'Reputation', color: '#17a673', values: hist.map(h => Math.round(h.rep)) }], labels, { maxY: 100 });
        const tracks = principal ? [] : E().careerTrackTable(S).slice(0, 30);
        const types = principal ? [] : E().typeRatings(S);
        const ach = E().achievementsFor(S);
        el.innerHTML = `
        <section class="sc-profile">
            <div class="sc-helmet" style="--hc:${esc(P.color)}">${principal ? '📋' : `<span>${P.num}</span>`}</div>
            <div><p class="section-label">${esc(E().ROLES[P.role].label)} · ${esc(E().gameOf(S).name)}</p>
                <h1>${K.flag(P.nat)} ${esc(P.first)} ${esc(P.last)}${P.nick ? ` <span class="muted">“${esc(P.nick)}”</span>` : ''}</h1>
                <p class="muted">Age ${P.age} · ${S.seasonNo > 1 || hist.length ? `${hist.length} season${hist.length === 1 ? '' : 's'} complete` : 'Rookie season'} · Season ${S.seasonNo} of ${S.settings.maxSeasons}</p></div>
        </section>
        <div class="stat-strip">
            ${K.stat(c.titles, principal ? 'Team titles' : 'Titles')}
            ${principal ? '' : K.stat(c.w, 'Wins') + K.stat(c.p, 'Podiums') + K.stat(c.pl, 'Poles') + K.stat(c.fl, 'Fastest laps') + K.stat(c.st, 'Starts') + K.stat(c.st ? Math.round(c.w / c.st * 100) + '%' : '—', 'Win rate') + K.stat(c.led, 'Laps led')}
            ${K.stat(K.money(c.earn), 'Earnings')}
        </div>
        <div class="grid-2">
            ${K.panel('Ratings', `${principal ? '' : K.rating('Driver rating', P.dr, { mark: E().fieldSkillMean(S, S.season.sid), markLabel: 'Current field average' })}${K.rating('Reputation', P.rep)}
                ${der ? `<h3 class="sc-subhead">From your logged races (last ${der.n})</h3>${K.rating('Qualifying', der.qual)}${K.rating('Racecraft (places gained)', der.racecraft)}${K.rating('Consistency', der.consistency)}${K.rating('Safety', der.safety)}` : ''}
                ${principal ? '' : `<h3 class="sc-subhead">Off-track</h3>${Object.entries(P.attrs).map(([k, v]) => K.rating(k[0].toUpperCase() + k.slice(1), v)).join('')}`}
                ${types.length ? `<h3 class="sc-subhead">Track-type performance</h3><div class="chip-row">${types.map(t => `<span class="chip">${t.icon} ${esc(t.label)}: ${t.perf ?? '—'} <span class="muted">(${t.st})</span></span>`).join('')}</div>` : ''}`)}
            ${K.panel('Progression', hist.length < 2 ? `<p class="muted">Your season-by-season charts (championship position${principal ? '' : ', driver rating and reputation'}) appear once two seasons are complete.</p>` : `${posChart}${drChart}`)}
        </div>
        ${K.panel('Season by season', hist.length ? `<div class="sc-table-wrap"><table class="table"><thead><tr><th>Year</th><th>Series</th><th>Team</th><th class="num">Pos</th><th class="num">Pts</th><th class="num">W</th><th class="num">Pod</th><th class="num">Poles</th><th class="num">DNF</th><th class="num">Team</th><th></th></tr></thead><tbody>
            ${hist.slice().reverse().map(h => `<tr class="${h.pos === 1 ? 'sc-champ-row' : ''}"><td>${h.year}</td><td>${esc(h.series)} <span class="muted small">${K.stars(h.tier)}</span></td><td>${esc(h.team)}</td>
                <td class="num">${h.pos ? K.ord(h.pos) : '—'}${h.pos === 1 ? ' 🏆' : ''}</td><td class="num">${h.pts}</td><td class="num">${h.row?.w ?? '—'}</td><td class="num">${h.row?.p ?? '—'}</td><td class="num">${h.row?.pl ?? '—'}</td><td class="num">${h.row?.dnf ?? '—'}</td><td class="num">${h.teamPos ? K.ord(h.teamPos) : '—'}</td>
                <td><button class="btn btn-ghost btn-sm" data-hist="${h.no}">Details</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Your first season is under way.</p>')}
        <div class="grid-2">
            ${principal ? '' : K.panel('Track records', tracks.length ? `<div class="sc-table-wrap"><table class="table table-tight"><thead><tr><th>Track</th><th class="num">Starts</th><th class="num">Wins</th><th class="num">Podiums</th><th class="num">Best</th><th class="num">Avg</th></tr></thead><tbody>
                ${tracks.map(r => `<tr><td>${E().typeInfo(r.type).icon} ${esc(r.t)}</td><td class="num">${r.st}</td><td class="num">${r.w}</td><td class="num">${r.p}</td><td class="num">${r.best ? 'P' + r.best : '—'}</td><td class="num">${r.avg ? r.avg.toFixed(1) : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Race to build your track records.</p>')}
            ${K.panel(`Achievements (${Object.keys(S.achievements).length}/${ach.length})`, `<div class="sc-ach">${ach.map(a => { const got = S.achievements[a.id];
                return `<div class="sc-ach-item ${got ? 'got' : ''}" title="${got ? 'Unlocked ' + got.y : 'Locked'}"><span>${a.icon}</span><span>${esc(a.label)}</span>${got ? `<small>${got.y}</small>` : ''}</div>`; }).join('')}</div>`)}
        </div>`;
        K.$$('[data-hist]', el).forEach(b => b.addEventListener('click', () => V.seasonCard(S, Number(b.dataset.hist))));
    };

    /* ============================================================
       WORLD
       ============================================================ */
    V.world = async function (el, tab) {
        const S = App().S;
        const g = E().gameOf(S);
        tab = ['series', 'drivers', 'teams', 'records'].includes(tab) ? tab : 'series';
        let body = '';
        if (tab === 'series') {
            body = SC.laddersOf(g).map(L => K.panel(`${L.icon} ${esc(L.label)}`, `<div class="sc-table-wrap"><table class="table table-tight"><thead><tr><th>Series</th><th>Leader now</th><th>Last champion</th><th class="num">Titles won by you</th></tr></thead><tbody>
                ${L.series.map(sd => { const st = E().standings(S, sd.id); const ch = (S.series[sd.id]?.champs || []).slice(-1)[0];
                    return `<tr class="${sd.id === S.season.sid ? 'sc-me' : ''}" data-series="${sd.id}" style="cursor:pointer"><td>${K.stars(sd.tier)} <strong>${esc(sd.name)}</strong><br><span class="muted small">${esc(sd.car)}</span></td>
                    <td>${st[0] ? esc(st[0].name) + ` <span class="muted small">${st[0].pts} pts</span>` : '<span class="muted">—</span>'}</td><td>${ch ? `${ch.year}: ${esc(ch.dn)}` : '<span class="muted">—</span>'}</td><td class="num">${S.player.seriesTitles[sd.id] || 0}</td></tr>`; }).join('')}</tbody></table></div>`)).join('');
        } else if (tab === 'drivers') {
            const q = (V._worldQuery || '').toLowerCase();
            const all = Object.values(S.drivers).filter(d => !d.isPlayer && (!q || (d.first + ' ' + d.last).toLowerCase().includes(q))).sort((a, b) => b.skill - a.skill).slice(0, 120);
            body = K.panel('Driver database', `<input id="wd-q" class="input sc-search" placeholder="Search drivers…" value="${esc(V._worldQuery || '')}">
                <div class="sc-table-wrap"><table class="table table-tight"><thead><tr><th>Driver</th><th class="num">Age</th><th class="num">Rating</th><th>Series / team</th><th class="num">Titles</th><th class="num">Wins</th><th class="num">Starts</th></tr></thead><tbody>
                ${all.map(d => `<tr data-driver="${d.id}" style="cursor:pointer"><td>${K.flag(d.nat)} ${esc(d.first + ' ' + d.last)}</td><td class="num">${d.age}</td><td class="num">${Math.round(d.skill)}</td>
                    <td class="small">${d.teamId ? `${esc(E().seriesDef(S, d.sid)?.short || '')} · ${esc(S.teams[d.teamId]?.name || '')}` : '<span class="muted">Free agent</span>'}</td><td class="num">${d.car.t}</td><td class="num">${d.car.w}</td><td class="num">${d.car.st}</td></tr>`).join('')}</tbody></table></div>`);
        } else if (tab === 'teams') {
            body = g.series.map(sd => K.panel(esc(sd.name), `<div class="chip-row">${E().teamsIn(S, sd.id).sort((a, b) => b.prestige - a.prestige).map(t => `<button class="chip chip-btn ${t.id === S.player.teamId ? 'chip-active' : ''}" data-team="${t.id}"><span class="team-dot" style="background:${esc(t.color)}"></span> ${esc(t.name)} · ${t.prestige}</button>`).join('')}</div>`)).join('');
        } else {
            const pool = Object.entries(S.drivers).concat(Object.entries(S.retired)).map(([id, d]) => ({ id, name: `${d.first} ${d.last}`, ...d.car, retired: !!S.retired[id] }));
            const P = S.player;
            if (P.role !== 'principal') pool.push({ id: 'P', name: `${P.first} ${P.last}`, t: P.career.titles, w: P.career.w, p: P.career.p, pl: P.career.pl, st: P.career.st });
            const top = (k) => pool.filter(x => !(x.id === 'P' && false)).sort((a, b) => (b[k] || 0) - (a[k] || 0)).slice(0, 10);
            const list = (k, label) => K.panel(label, `<table class="table table-tight"><tbody>${top(k).map((r, i) => `<tr class="${r.id === 'P' ? 'sc-me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}${r.retired ? ' <span class="muted small">(ret.)</span>' : ''}</td><td class="num"><strong>${r[k] || 0}</strong></td></tr>`).join('')}</tbody></table>`);
            body = `<div class="grid-2">${list('t', '👑 Most titles')}${list('w', '🥇 Most wins')}${list('p', '🍾 Most podiums')}${list('st', '📅 Most starts')}</div>`;
        }
        el.innerHTML = `<div class="view-head"><div><h1>🌍 ${esc(g.name)} world</h1><p class="muted">${Object.keys(S.drivers).length} active drivers · ${Object.values(S.teams).filter(t => t.sid).length} teams · ${g.series.length} championships</p></div></div>
            ${K.tabs([['series', 'Championships'], ['drivers', 'Drivers'], ['teams', 'Teams'], ['records', 'All-time records']], tab, 'data-wtab')}
            <div class="sc-tab-body">${body}</div>`;
        K.$$('[data-wtab]', el).forEach(b => b.addEventListener('click', () => App().go('world', b.dataset.wtab)));
        K.$$('[data-series]', el).forEach(r => r.addEventListener('click', () => App().go('standings', `${r.dataset.series}:drivers`)));
        K.$$('[data-driver]', el).forEach(r => r.addEventListener('click', () => V.driverCard(S, r.dataset.driver)));
        K.$$('[data-team]', el).forEach(r => r.addEventListener('click', () => V.teamCard(S, r.dataset.team)));
        K.$('#wd-q', el)?.addEventListener('change', (e) => { V._worldQuery = e.target.value; App().go('world', 'drivers'); });
    };

    /* ============================================================
       SETTINGS
       ============================================================ */
    V.settings = async function (el) {
        const S = App().S; const P = S.player;
        const g = E().gameOf(S);
        const ai = g.ai;
        const st = S.settings;
        const aiInput = ai.kind === 'steps' ? K.select('se-ai', ai.steps.map(s => [s, s]), st.aiBase) : `<input id="se-ai" class="input" type="number" min="${ai.min}" max="${ai.max}" value="${st.aiBase}">`;
        el.innerHTML = `
        <div class="view-head"><div><h1>⚙️ Settings</h1><p class="muted">${esc(g.name)} · ${E().DIFF[st.difficulty].icon} ${E().DIFF[st.difficulty].label} difficulty</p></div></div>
        <div class="grid-2">
            ${K.panel('Racing', `<form id="se-form" class="form-grid">
                <div class="sc-callout"><strong>🎚️ AI calibration — ${esc(ai.label)}</strong>
                    <p class="muted small">Your baseline for an evenly-matched car. If you're winning too easily in an average car, raise it; if you're always at the back, lower it. The Race screen adjusts from here every round.</p>
                    <label class="field sc-narrow"><span>Baseline${ai.kind === 'range' ? ` (${ai.min}–${ai.max})` : ''}</span>${aiInput}</label></div>
                <div class="form-row">
                    <label class="field"><span>Race length</span>${K.select('se-len', E().RACE_LENGTHS.map(r => [r.v, r.label]), st.raceLength)}</label>
                    <label class="field"><span>Season length (from next season)</span>${K.select('se-season', E().SEASON_LENGTHS.map(r => [r.v, r.label]), st.seasonLength)}</label>
                    <label class="field"><span>Max cars (from next season)</span><input id="se-grid" class="input" type="number" min="4" max="${g.maxGrid}" value="${st.maxGrid || g.maxGrid}"></label>
                </div>
                <label class="check"><input id="se-rel" type="checkbox" ${st.reliabilityOrders ? 'checked' : ''}> Reliability orders (the team may order you to retire)</label>
                <label class="check"><input id="se-sim" type="checkbox" ${st.allowSim ? 'checked' : ''}> Allow simulating my own races</label>
                <label class="field"><span>Nickname</span><input id="se-nick" class="input" value="${esc(P.nick)}" maxlength="24"></label>
                <button class="btn btn-primary" type="submit">Save settings</button>
            </form>`)}
            ${K.panel('Save file', `
                <p class="muted small">Careers are stored in this browser. Export a backup file regularly — it also moves a career to another device (Import on the save-slot screen).</p>
                <div class="btn-row"><button class="btn btn-secondary" id="se-export">⬇️ Export save</button><a class="btn btn-ghost" href="#/">⏏ Save slots</a></div>
                <h3 class="sc-subhead">Retirement</h3>
                <p class="muted small">Characters retire automatically after ${st.maxSeasons} seasons. You can retire early between seasons.</p>
                <button class="btn btn-ghost" id="se-retire" ${E().canRetire(S) && S.phase !== 'retired' ? '' : 'disabled'}>🎖️ Retire now</button>
                <h3 class="sc-subhead">Danger zone</h3>
                <button class="btn btn-danger" id="se-delete">🗑️ Delete this career</button>`)}
        </div>
        ${K.panel('How the app maps to your game', `<ul class="small sc-help">
            <li><strong>Before each round</strong>, open Race: set the track, laps, weather and the recommended <em>${esc(ai.label)}</em> in ${esc(g.short)}. ${g.formats.includes('paste') ? '' : ''}</li>
            <li><strong>After the race</strong>, log your finish (and grid spot, laps led, fastest lap, damage), or import the results file: ${g.formats.map(f => esc(SC.RESULT_FORMATS[f] || f)).join('; ')}.</li>
            <li><strong>Names:</strong> use the entry list (Race → Show the field → Copy roster) to name the AI in your game after the career drivers — imports then match automatically.</li>
            <li><strong>Your rating</strong> only moves with results measured against what your car should achieve — so a P8 in a backmarker can be worth more than a P3 in the best car.</li>
            <li><strong>Undo:</strong> the last logged race can be undone from the Race or Home screen.</li>
        </ul>`)}`;
        K.$('#se-form', el).addEventListener('submit', (e) => {
            e.preventDefault();
            App().act((S2) => {
                const s = S2.settings;
                const v = K.$('#se-ai', el).value;
                if (ai.kind === 'range') { const n = Number(v); if (!(n >= ai.min && n <= ai.max)) throw new Error(`AI baseline must be ${ai.min}–${ai.max}.`); s.aiBase = n; } else s.aiBase = v;
                s.raceLength = Number(K.$('#se-len', el).value);
                s.seasonLength = K.$('#se-season', el).value;
                s.maxGrid = Math.max(4, Math.min(g.maxGrid, Number(K.$('#se-grid', el).value) || g.maxGrid));
                s.reliabilityOrders = K.$('#se-rel', el).checked;
                s.allowSim = K.$('#se-sim', el).checked;
                S2.player.nick = K.$('#se-nick', el).value.trim();
                if (!s.reliabilityOrders) S2.season.events.forEach(ev => { if (!ev.done) ev.order = null; });
            }, { ok: 'Settings saved.' });
        });
        K.$('#se-export', el).addEventListener('click', () => K.download(SC.Store.exportBlob(S), `solo-career-${K.slug(P.first + ' ' + P.last)}-${S.gameId}-s${S.seasonNo}.json`));
        K.$('#se-retire', el).addEventListener('click', () => V._retireFlow('voluntary'));
        K.$('#se-delete', el).addEventListener('click', async () => {
            if (!(await K.Modal.confirm('Delete this career?', 'This permanently removes the save from this browser. Export it first if you might want it back.', { ok: 'Delete forever', danger: true }))) return;
            await SC.Store.remove(S.id);
            SC.App.S = null;
            K.toast('Career deleted.');
            SC.App.nav('#/');
        });
    };
})(typeof window !== 'undefined' ? window : globalThis);
