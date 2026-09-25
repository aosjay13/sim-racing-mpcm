/* ============================================================
   Phoenix SRMPC — Solo Career: Home + Race weekend flow
   (pre-season calendar, the in-game setup card, logging /
   importing / simulating results, post-race report, season
   review, contract offers, retirement).
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
    const teamOfId = (S, id) => S.teams[(id === 'P' ? S.drivers.P : S.drivers[id])?.teamId] || null;
    V._dn = dn; V._teamOf = teamOfId;

    function typeChip(type) { const ti = E().typeInfo(type); return `<span class="chip" title="${esc(ti.label)}">${ti.icon} ${esc(ti.label)}</span>`; }
    V._typeChip = typeChip;
    function lengthText(ev) { return ev.stages ? `${ev.stages} stages` : ev.laps ? `${ev.laps} laps` : ev.mins ? `${ev.mins} min` : '—'; }
    V._lengthText = lengthText;

    /* ============================================================
       HOME
       ============================================================ */
    V.home = async function (el) {
        const S = App().S; const P = S.player;
        const sd = E().seriesDef(S, S.season.sid);
        const t = S.teams[P.teamId];
        const ev = E().nextEvent(S);
        const st = E().standings(S, S.season.sid);
        const ts = E().teamStandings(S, S.season.sid);
        const me = st.find(r => r.id === 'P');
        const myT = ts.find(r => r.id === P.teamId);

        let next;
        if (S.phase === 'retired') next = `<p>${esc(P.first)} ${esc(P.last)} has retired. See the Race tab for the final send-off.</p><button class="btn btn-primary" data-go="race">🎖️ Retirement</button>`;
        else if (S.phase === 'postseason') next = `<p><strong>Season ${S.seasonNo} is over.</strong> ${me ? `You finished ${K.ord(me.rank)} with ${me.pts} points.` : myT ? `${esc(t.name)} finished ${K.ord(myT.rank)} in the teams' championship.` : ''}</p><button class="btn btn-primary" data-go="race">📋 Season review & next move</button>`;
        else if (S.phase === 'preseason') next = `<p><strong>Pre-season ${S.year}.</strong> ${S.season.events.length} rounds in the ${esc(sd.name)}. Tweak the calendar, sign sponsors, then start the season.</p><button class="btn btn-primary" data-go="race">🚦 Pre-season checklist</button>`;
        else if (ev) {
            const b = E().briefing(S, ev);
            next = `<div class="sc-next">
                <div class="sc-next-round">R${ev.r}<small>/${S.season.events.length}</small></div>
                <div><h3>${esc(ev.t)}</h3><p class="muted small">${K.date(ev.date)} · ${lengthText(ev)} · ${esc(ev.wx.cond)}, ${ev.wx.temp}°C · ${esc(ev.wx.time)}</p>
                <div class="chip-row">${typeChip(ev.type)}${ev.format !== 'race' ? K.badge(ev.format === 'derby' ? 'Demolition derby' : 'Rally', 'badge-amber') : ''}
                ${P.role !== 'principal' ? `<span class="chip sc-ai-chip">🎚️ ${esc(b.ai.setting)} ${esc(b.ai.label)}</span>` : ''}</div></div></div>
                ${ev.order ? `<div class="warn-banner">📻 Team order for this round: retire at ${ev.order.unit} ${ev.order.at} (${esc(ev.order.part)} issue).</div>` : ''}
                <button class="btn btn-primary" data-go="race">🏁 Race weekend</button>`;
        }
        const standRows = st.slice(0, 6);
        if (me && me.rank > 6) standRows.push(me);
        const inbox = S.inbox.slice(0, 5);
        el.innerHTML = `
        <div class="view-head"><div><p class="section-label">${esc(E().gameOf(S).name)} · ${esc(sd.name)}</p>
            <h1>${P.role === 'principal' ? esc(t?.name || 'Team') : `${esc(P.first)} ${esc(P.last)}`}${P.nick ? ` <span class="muted">“${esc(P.nick)}”</span>` : ''}</h1></div>
            <div class="btn-row">${App().undoInfo && S.phase !== 'retired' ? `<button class="btn btn-ghost btn-sm" id="home-undo" title="${esc(App().undoInfo.label)}">↩ Undo last race</button>` : ''}</div></div>
        <div class="stat-strip">
            ${K.stat(`${S.seasonNo}<small>/${S.settings.maxSeasons}</small>`, 'Season')}
            ${P.role !== 'principal' ? K.stat(Math.round(P.dr), 'Driver rating') : K.stat(P.board?.confidence ?? '—', 'Board confidence')}
            ${K.stat(Math.round(P.rep), 'Reputation')}
            ${K.stat(P.career.titles, P.role === 'principal' ? 'Team titles' : 'Titles')}
            ${P.role !== 'principal' ? K.stat(P.career.w, 'Wins') : K.stat(myT ? K.ord(myT.rank) : '—', 'Team position')}
            ${K.stat(K.money(P.money), 'Personal')}
        </div>
        <div class="grid-2 sc-home">
            <div class="stack">
                ${K.panel('Next up', next || '')}
                ${K.panel(`🏆 ${esc(sd.short)} standings`, st.length ? `<table class="table table-tight"><tbody>${standRows.map(r => `
                    <tr class="${r.id === 'P' ? 'sc-me' : ''}"><td class="rank">${r.rank}</td><td>${esc(r.name)}<br><span class="muted small">${esc(S.teams[r.team]?.name || '')}</span></td>
                    <td class="num"><strong>${r.pts}</strong></td><td class="num muted small">${r.w}W</td></tr>`).join('')}</tbody></table>
                    ${me && st[0] && me.rank > 1 ? `<p class="muted small">${st[0].pts - me.pts} points behind the leader.</p>` : ''}` : '<p class="muted">No rounds run yet this season.</p>',
                    { actions: '<button class="btn btn-ghost btn-sm" data-go="standings">Full table</button>' })}
            </div>
            <div class="stack">
                ${K.panel('Career', `
                    <div class="sc-meter-row"><span>Season ${S.seasonNo} of ${S.settings.maxSeasons}</span>${K.progress(S.seasonNo / S.settings.maxSeasons * 100)}</div>
                    ${P.role !== 'principal' ? K.rating('Driver rating (from your results)', P.dr, { mark: E().fieldSkillMean(S, S.season.sid), markLabel: 'Field average' }) : ''}
                    ${K.rating('Reputation', P.rep)}
                    ${P.role !== 'principal' ? `<div class="sc-meter-row"><span>Recent form</span>${K.formPips(P.form.slice(-8))}</div>` : ''}
                    <div class="chip-row"><span class="chip">🏁 ${P.career.st} starts</span><span class="chip">🥇 ${P.career.w}</span><span class="chip">🍾 ${P.career.p} podiums</span><span class="chip">⏱️ ${P.career.pl} poles</span></div>`,
                    { actions: '<button class="btn btn-ghost btn-sm" data-go="career">Profile</button>' })}
                ${t ? K.panel(esc(t.name), teamSnapshot(S, t), { actions: '<button class="btn btn-ghost btn-sm" data-go="team">Team</button>' }) : ''}
                ${K.panel(`📨 Inbox ${E().unread(S) ? K.badge(E().unread(S) + ' new', 'badge-red') : ''}`, inbox.map(m => `
                    <div class="sc-msg-mini ${m.read ? '' : 'unread'}"><span>${m.icon}</span><div><strong>${esc(m.title)}</strong><p class="muted small">${esc(m.body).slice(0, 140)}${m.body.length > 140 ? '…' : ''}</p></div></div>`).join('') || '<p class="muted">Nothing yet.</p>',
                    { actions: '<button class="btn btn-ghost btn-sm" data-go="inbox">All messages</button>' })}
            </div>
        </div>`;
        K.$$('[data-go]', el).forEach(b => b.addEventListener('click', () => App().go(b.dataset.go)));
        K.$('#home-undo', el)?.addEventListener('click', () => App().undo());
    };

    function teamSnapshot(S, t) {
        const P = S.player;
        const sid = t.sid;
        const field = E().teamsIn(S, sid);
        const avg = (k) => field.reduce((s, x) => s + x.car[k], 0) / field.length;
        const lines = [];
        lines.push(`<div class="sc-car-mini">${Object.entries(E().AREAS).map(([k, a]) => K.rating(a.label, t.car[k], { mark: avg(k), markLabel: 'Field average', icon: a.icon })).join('')}</div>`);
        if (P.role === 'driver' && P.contract) {
            lines.push(`<p class="small">Contract: <strong>${K.money(P.contract.salary)}/season</strong>${P.contract.salary < 0 ? ' (paid seat)' : ''} · ${P.contract.seasons > 0 ? `${P.contract.seasons} season${P.contract.seasons > 1 ? 's' : ''} left` : 'expiring'} · ${P.contract.status === 'lead' ? 'Lead driver' : 'Second driver'}</p>`);
            lines.push(`<div class="sc-meter-row"><span>Team faith in you</span>${K.progress(P.morale)}</div>`);
        } else {
            lines.push(`<p class="small">Budget <strong class="${K.moneyCls(t.budget)}">${K.money(t.budget)}</strong> · ${(t.rd || []).length}/${E().rdSlots(t)} R&D slots busy · ${(t.sponsors || []).length} sponsors</p>`);
        }
        const mates = t.drivers.filter(id => id !== 'P');
        if (mates.length) lines.push(`<p class="muted small">${P.role === 'principal' ? 'Drivers' : 'Teammate'}: ${mates.map(id => `${esc(dn(S, id))} (${Math.round(S.drivers[id]?.skill || 0)})`).join(', ')}</p>`);
        return lines.join('');
    }

    /* ============================================================
       RACE — dispatches on phase
       ============================================================ */
    V.race = async function (el) {
        const S = App().S;
        if (S.phase === 'retired') return retiredView(el);
        if (S.phase === 'postseason') return postseasonView(el);
        if (S.phase === 'preseason') return preseasonView(el);
        return weekendView(el);
    };

    /* ---------------- Pre-season: calendar + checklist ---------------- */
    function preseasonView(el) {
        const S = App().S; const P = S.player;
        const sd = E().seriesDef(S, S.season.sid);
        const g = E().gameOf(S);
        const t = S.teams[P.teamId];
        const trackOpts = [...new Set([...g.tracks, ...Object.keys(S.customTracks)])].sort();
        const checks = [];
        if (P.role === 'driver') {
            checks.push([!!P.contract && P.contract.teamId === P.teamId, `Seat: ${esc(t?.name || '—')} (${K.money(P.contract?.salary || 0)}/season)`]);
            const po = S.sponsorOffers.filter(o => o.personal).length;
            checks.push([P.sponsors.length > 0 || !po, `Personal sponsors: ${P.sponsors.length} signed${po ? ` · ${po} offer${po > 1 ? 's' : ''} waiting` : ''}`, 'market']);
            checks.push([!!P.training, P.training ? `Training: ${esc(E().TRAINING[P.training.key].label)} in progress` : 'Optional: book a training program', 'market']);
        } else {
            checks.push([t.drivers.length >= t.cars, `Drivers: ${t.drivers.length}/${t.cars} seats filled${t.drivers.length < t.cars ? ' — empty seats get a stopgap signing at the start' : ''}`, 'market']);
            const free = ['title', 'primary', 'secondary'].reduce((s, sl) => s + Math.max(0, E().sponsorSlotsFree(S, t, sl)), 0);
            checks.push([(t.sponsors || []).length > 0, `Sponsors: ${(t.sponsors || []).length} signed, ${free} slot${free === 1 ? '' : 's'} free, ${S.sponsorOffers.filter(o => !o.personal).length} offers waiting`, 'team/sponsors']);
            checks.push([(t.rd || []).length > 0, `R&D: ${(t.rd || []).length}/${E().rdSlots(t)} projects running`, 'team/car']);
            checks.push([true, `Budget: ${K.money(t.budget)}`, 'finances']);
        }
        el.innerHTML = `
        <div class="view-head"><div><p class="section-label">Pre-season · ${S.year}</p><h1>${esc(sd.name)}</h1>
            <p class="muted">${esc(sd.car)}${t?.make ? ' — ' + esc(t.make) : ''} · ${E().driversIn(S, S.season.sid).length} cars · ${esc(SC.POINTS[sd.points]?.label || '')}</p></div>
            <button class="btn btn-primary" id="ps-start">🚦 Start season ${S.seasonNo}</button></div>
        <div class="grid-2">
            ${K.panel('Checklist', `<ul class="sc-checklist">${checks.map(([ok, txt, go]) => `<li class="${ok ? 'ok' : 'todo'}"><span>${ok ? '✅' : '⬜'}</span><span>${txt}</span>${go ? `<button class="btn btn-ghost btn-sm" data-goto="${go}">Open</button>` : ''}</li>`).join('')}</ul>`)}
            ${K.panel('Season settings', `
                <p class="muted small">Race length: <strong>${esc(E().RACE_LENGTHS.find(r => r.v === S.settings.raceLength)?.label || Math.round(S.settings.raceLength * 100) + '%')}</strong>.
                Change it in Settings, then press <em>Rebuild</em> to apply it to this calendar.</p>
                <div class="form-row">
                    <label class="field"><span>Season length</span>${K.select('ps-len', E().SEASON_LENGTHS.map(r => [r.v, r.label]), S.settings.seasonLength)}</label>
                </div>
                <button class="btn btn-secondary btn-sm" id="ps-rebuild">↻ Rebuild calendar</button>`)}
        </div>
        ${K.panel(`🗓️ Calendar — ${S.season.events.length} rounds`, `
            <p class="muted small">This is your schedule management: reorder, remove or add rounds, change lap counts, or add a mod/custom track. Locks when the season starts.</p>
            <div class="sc-table-wrap"><table class="table table-tight" id="ps-cal"><thead><tr><th>R</th><th>Track</th><th>Type</th><th class="num">Laps</th><th></th></tr></thead><tbody>
            ${S.season.events.map((ev, i) => `<tr data-i="${i}"><td>${ev.r}</td><td>${esc(ev.t)} ${E().trackInfo(S, ev.t).mod ? K.badge('mod', 'badge-purple') : ''}</td><td>${typeChip(ev.type)}</td>
                <td class="num">${ev.laps != null ? `<input class="input input-pos" type="number" min="1" max="2000" value="${ev.laps}" data-laps="${i}">` : `<span class="muted">${lengthText(ev)}</span>`}</td>
                <td class="row-actions"><button class="btn btn-ghost btn-sm" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn btn-ghost btn-sm" data-down="${i}" ${i === S.season.events.length - 1 ? 'disabled' : ''}>↓</button><button class="btn btn-ghost btn-sm" data-rm="${i}">✕</button></td></tr>`).join('')}
            </tbody></table></div>
            <div class="form-row sc-add-row">
                <label class="field"><span>Add a round</span>${K.select('ps-add-track', trackOpts.map(n => [n, n]), trackOpts[0])}</label>
                <button class="btn btn-secondary" id="ps-add">➕ Add round</button>
            </div>
            <details class="sc-details"><summary>Add a mod / custom track</summary>
                <div class="form-row">
                    <label class="field"><span>Track name</span><input id="ps-ct-name" class="input" maxlength="50" placeholder="e.g. Motordrome Oval"></label>
                    <label class="field"><span>Type</span>${K.select('ps-ct-type', Object.entries(SC.TRACK_TYPES).map(([k, v]) => [k, v.label]), 'rd')}</label>
                    <label class="field"><span>Length (km)</span><input id="ps-ct-km" class="input" type="number" step="0.01" value="3.5"></label>
                    <button class="btn btn-secondary" id="ps-ct-add">Add track</button>
                </div></details>
            <div class="btn-row"><button class="btn btn-primary" id="ps-save">💾 Save calendar</button></div>`)}`;

        let working = S.season.events.map(ev => ({ t: ev.t, laps: ev.laps, orig: ev }));
        const redraw = () => {
            const tb = K.$('#ps-cal tbody', el);
            tb.innerHTML = working.map((w, i) => {
                const tr = E().trackInfo(S, w.t);
                return `<tr><td>${i + 1}</td><td>${esc(w.t)} ${tr.mod ? K.badge('mod', 'badge-purple') : ''}</td><td>${typeChip(tr.type)}</td>
                <td class="num">${w.laps != null ? `<input class="input input-pos" type="number" min="1" max="2000" value="${w.laps}" data-laps="${i}">` : '<span class="muted">auto</span>'}</td>
                <td class="row-actions"><button class="btn btn-ghost btn-sm" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn btn-ghost btn-sm" data-down="${i}" ${i === working.length - 1 ? 'disabled' : ''}>↓</button><button class="btn btn-ghost btn-sm" data-rm="${i}">✕</button></td></tr>`;
            }).join('');
        };
        K.$('#ps-cal', el).addEventListener('click', (e) => {
            const b = e.target.closest('button'); if (!b) return;
            const i = Number(b.dataset.up ?? b.dataset.down ?? b.dataset.rm);
            if (b.dataset.up != null && i > 0) [working[i - 1], working[i]] = [working[i], working[i - 1]];
            if (b.dataset.down != null && i < working.length - 1) [working[i + 1], working[i]] = [working[i], working[i + 1]];
            if (b.dataset.rm != null) working.splice(i, 1);
            redraw();
        });
        K.$('#ps-cal', el).addEventListener('input', (e) => { const i = e.target.dataset.laps; if (i != null) working[Number(i)].laps = Math.max(1, Number(e.target.value) || 1); });
        K.$('#ps-add', el).onclick = () => { working.push({ t: K.$('#ps-add-track', el).value, laps: null }); redraw(); };
        // Adding a mod track must not re-render: that would throw away the
        // unsaved calendar edits above. Save the track, then add it as a round.
        K.$('#ps-ct-add', el).onclick = async () => {
            const tr = await App().act((S2) => E().addCustomTrack(S2, K.$('#ps-ct-name', el).value, K.$('#ps-ct-type', el).value, K.$('#ps-ct-km', el).value),
                { ok: (t2) => `${t2.name} added to the track list and the calendar.`, rerender: false });
            if (!tr) return;
            const sel = K.$('#ps-add-track', el);
            if (![...sel.options].some(o => o.value === tr.name)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(tr.name)}">${esc(tr.name)}</option>`);
            working.push({ t: tr.name, laps: null });
            K.$('#ps-ct-name', el).value = '';
            redraw();
        };
        K.$('#ps-save', el).onclick = () => App().act((S2) => E().setCalendar(S2, working.map(w => ({ t: w.t, lapsFixed: w.laps }))), { ok: 'Calendar saved. 🗓️' });
        K.$('#ps-rebuild', el).onclick = () => App().act((S2) => {
            S2.settings.seasonLength = K.$('#ps-len', el).value;
            E().startSeason(S2);
        }, { ok: 'Calendar rebuilt.' });
        K.$('#ps-start', el).onclick = () => App().act((S2) => E().beginSeason(S2), { ok: 'Lights out — season underway! 🚦' });
        K.$$('[data-goto]', el).forEach(b => b.addEventListener('click', () => { const [v, p] = b.dataset.goto.split('/'); App().go(v, p); }));
    }

    /* ---------------- Race weekend ---------------- */
    function weekendView(el) {
        const S = App().S; const P = S.player;
        const ev = E().nextEvent(S);
        const b = E().briefing(S, ev);
        const g = E().gameOf(S);
        const t = S.teams[P.teamId];
        const N = b.grid;
        const entrants = E().driversIn(S, S.season.sid);
        const principal = P.role === 'principal';
        const derby = ev.format === 'derby', rally = ev.format === 'rally';
        const posLabel = derby ? 'Survival position' : rally ? 'Overall classification' : 'Finishing position';
        const setupText = [
            `${g.name} — ${b.sd.name}`, `Car: ${b.car}`, `Track: ${ev.t}`, `Length: ${b.length}`, `Opponents: ${N - 1} AI`,
            `${b.ai.setting}: ${b.ai.label}`, b.ai.extra ? b.ai.extra : '', `Weather: ${ev.wx.cond}, ${ev.wx.temp}°C, ${ev.wx.time}`
        ].filter(Boolean).join('\n');

        el.innerHTML = `
        <div class="view-head"><div><p class="section-label">Round ${ev.r} of ${S.season.events.length} · ${K.date(ev.date)}, ${S.year}</p>
            <h1>${esc(ev.t)}</h1>
            <div class="chip-row">${typeChip(ev.type)}<span class="chip">📏 ${b.length}${b.tr.km ? ` · ${b.tr.km} km lap` : ''}</span>
            <span class="chip">${ev.wx.cond === 'Wet' ? '🌧️' : ev.wx.cond.startsWith('Mixed') ? '🌦️' : ev.wx.cond === 'Overcast' ? '☁️' : '☀️'} ${esc(ev.wx.cond)} ${ev.wx.temp}°C</span>
            <span class="chip">${ev.night ? '🌙 Night race' : '🕒 ' + esc(ev.wx.time)}</span>
            ${derby ? K.badge('Demolition derby', 'badge-amber') : rally ? K.badge('Rally', 'badge-amber') : ''}</div></div>
            ${App().undoInfo ? `<button class="btn btn-ghost btn-sm" id="rw-undo" title="${esc(App().undoInfo.label)}">↩ Undo last race</button>` : ''}</div>
        ${ev.order && !principal ? `<div class="panel-alert sc-order">📻 <strong>Team radio:</strong> telemetry shows a ${esc(ev.order.part)} problem. The team orders you to <strong>retire at ${ev.order.unit} ${ev.order.at}</strong>. Race it until then, park it, and log a mechanical DNF. (Turn these off in Settings.)</div>` : ''}
        <div class="grid-2">
            ${principal ? '' : K.panel(`🎮 Set this up in ${esc(g.short)}`, `
                <div class="sc-setup">
                    <div class="sc-setup-ai"><span class="muted small">${esc(b.ai.setting)}</span><strong>${esc(b.ai.label)}</strong>
                        ${b.ai.extra ? `<span class="muted small">${esc(b.ai.extra)}</span>` : ''}</div>
                    <dl class="sc-dl">
                        <dt>Series / car</dt><dd>${esc(b.sd.name)} — ${esc(b.car)}</dd>
                        <dt>Track</dt><dd>${esc(ev.t)}${b.tr.mod ? ' (add-on)' : ''}</dd>
                        <dt>Length</dt><dd>${b.length}</dd>
                        <dt>Field</dt><dd>${N} cars — you + ${N - 1} AI</dd>
                        <dt>Weather</dt><dd>${esc(ev.wx.cond)}, ${ev.wx.temp}°C, ${esc(ev.wx.time)}</dd>
                        <dt>Realism</dt><dd>${b.realism.map(esc).join('<br>')}</dd>
                    </dl>
                    <details class="sc-details"><summary>Why this AI level?</summary><ul class="small">${b.ai.lines.map(l => `<li>${esc(l)}</li>`).join('') || '<li>Baseline — your car and the field are evenly matched.</li>'}
                        <li>Your baseline is <strong>${esc(S.settings.aiBase)}</strong> (Settings → AI calibration).</li></ul></details>
                    <button class="btn btn-ghost btn-sm" id="rw-copy">📋 Copy setup</button>
                </div>`)}
            ${principal ? strategyPanel(S, t, ev) : resultPanel(S, ev, N, posLabel, derby, t)}
        </div>
        ${K.panel(`👥 Entry list — ${N} cars`, `
            <details class="sc-details"><summary>Show the field (use it to name the AI in your game)</summary>
            <div class="sc-table-wrap"><table class="table table-tight"><thead><tr><th>#</th><th>Driver</th><th>Team</th><th class="num">Rating</th></tr></thead><tbody>
            ${entrants.map(id => { const d = id === 'P' ? S.drivers.P : S.drivers[id]; const tm = S.teams[d.teamId];
                return `<tr class="${id === 'P' ? 'sc-me' : ''}"><td>${d.num ?? ''}</td><td>${K.flag(d.nat)} ${esc(d.first + ' ' + d.last)}</td><td><span class="team-dot" style="background:${esc(tm?.color || '#555')}"></span> ${esc(tm?.name || '')}</td><td class="num">${Math.round(id === 'P' ? P.dr : d.skill)}</td></tr>`; }).join('')}
            </tbody></table></div>
            <button class="btn btn-ghost btn-sm" id="rw-roster">📋 Copy roster (CSV)</button></details>`)}`;

        K.$('#rw-undo', el)?.addEventListener('click', () => App().undo());
        K.$('#rw-copy', el)?.addEventListener('click', () => copy(setupText, 'Setup copied.'));
        K.$('#rw-roster', el)?.addEventListener('click', () => {
            const csv = ['Number,Name,Team,Nationality,Rating'].concat(entrants.map(id => { const d = id === 'P' ? S.drivers.P : S.drivers[id]; return `${d.num ?? ''},"${d.first} ${d.last}","${S.teams[d.teamId]?.name || ''}",${d.nat},${Math.round(id === 'P' ? P.dr : d.skill)}`; })).join('\n');
            copy(csv, 'Roster copied as CSV.');
        });
        if (principal) wireStrategy(el, S, t);
        else wireResult(el, S, ev, N, derby, t);
    }

    function copy(text, msg) {
        const done = () => K.toast(msg);
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
        else fallbackCopy(text, done);
    }
    function fallbackCopy(text, done) {
        const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { K.toast('Copy failed — select the text manually.', 'error'); }
        ta.remove();
    }

    function resultPanel(S, ev, N, posLabel, derby, t) {
        const mates = t ? t.drivers.filter(id => id !== 'P') : [];
        const g = E().gameOf(S);
        const tabs = [['manual', '✍️ Log result'], ['import', '📂 Import file'], ['sim', '🎲 Simulate']];
        return K.panel('🏁 Your result', `
            ${K.tabs(tabs, 'manual', 'data-rtab')}
            <div class="sc-rtab" data-pane="manual">
                <form id="rs-form" class="form-grid">
                    <div class="form-row">
                        <label class="field"><span>${derby ? 'Starting slot' : 'Started (grid)'}</span><input id="rs-start" class="input" type="number" min="1" max="${N}" placeholder="1–${N}"></label>
                        <label class="field"><span>${esc(posLabel)} *</span><input id="rs-pos" class="input" type="number" min="1" max="${N}" placeholder="1–${N}" autofocus></label>
                    </div>
                    ${derby ? '' : `<label class="check"><input id="rs-dnf" type="checkbox" ${ev.order ? 'checked' : ''}> Did not finish</label>
                    <div class="form-row ${ev.order ? '' : 'hidden'}" id="rs-dnf-row">
                        <label class="field"><span>Reason</span>${K.select('rs-reason', [['crash', 'Accident / damage'], ['mech', 'Mechanical']], ev.order ? 'mech' : 'crash')}</label>
                        <label class="field"><span>${ev.laps ? 'Laps completed' : 'Completed'}</span><input id="rs-laps" class="input" type="number" min="0" value="${ev.order ? ev.order.at : ''}"></label>
                    </div>`}
                    <div class="form-row">
                        ${derby ? '<label class="field"><span>Wrecks (cars you took out)</span><input id="rs-wrecks" class="input" type="number" min="0" value="0"></label>'
                            : `<label class="field"><span>Laps led</span><input id="rs-led" class="input" type="number" min="0" value="0"></label>
                               <label class="field"><span>Incidents</span><input id="rs-inc" class="input" type="number" min="0" placeholder="optional"></label>`}
                        <label class="field"><span>Car damage</span>${K.select('rs-dmg', [['none', 'None'], ['light', 'Light'], ['heavy', 'Heavy'], ['totaled', 'Destroyed']], 'none')}</label>
                    </div>
                    ${derby ? '' : '<label class="check"><input id="rs-fl" type="checkbox"> I set the fastest lap</label>'}
                    ${ev.type === 'f8' ? '<label class="field"><span>Wrecks caused</span><input id="rs-wrecks" class="input" type="number" min="0" value="0"></label>' : ''}
                    ${mates.length ? `<details class="sc-details"><summary>Teammate result (optional — otherwise simulated)</summary>
                        ${mates.map(id => `<div class="form-row"><label class="field"><span>${esc(dn(S, id))}</span><input class="input" type="number" min="1" max="${N}" data-mate="${id}" placeholder="Position"></label>
                        <label class="check"><input type="checkbox" data-mate-dnf="${id}"> DNF</label></div>`).join('')}</details>` : ''}
                    <button class="btn btn-primary btn-block" type="submit">💾 Save result</button>
                </form>
            </div>
            <div class="sc-rtab hidden" data-pane="import">
                <p class="muted small">Load the results file your sim wrote, or paste a finishing order (one name per line). ${esc(g.short)} works best with: ${g.formats.map(f => esc(SC.RESULT_FORMATS[f] || f)).join('; ')}.</p>
                <label class="field"><span>Results file</span><input id="im-file" class="input" type="file" accept=".xml,.txt,.html,.htm,.csv,.json,.tsv"></label>
                <label class="field"><span>…or paste</span><textarea id="im-text" class="input" rows="6" placeholder="1. ${esc(S.player.first)} ${esc(S.player.last)}&#10;2. Driver Name&#10;3. Driver Name - DNF"></textarea></label>
                <button class="btn btn-secondary" id="im-parse">🔍 Read results</button>
                <div id="im-map"></div>
            </div>
            <div class="sc-rtab hidden" data-pane="sim">
                <p>Can't run this round? The app simulates it from your driver rating (${Math.round(S.player.dr)}) and your car.</p>
                <p class="muted small">Simulated rounds count in the championship but only nudge your rating and reputation a little.${S.settings.allowSim ? '' : ' <strong>Simulating your own races is switched off in Settings.</strong>'}</p>
                <button class="btn btn-secondary" id="rs-sim" ${S.settings.allowSim ? '' : 'disabled'}>🎲 Simulate round ${ev.r}</button>
            </div>`);
    }

    function wireResult(el, S, ev, N, derby, t) {
        K.$$('[data-rtab]', el).forEach(b => b.addEventListener('click', () => {
            K.$$('[data-rtab]', el).forEach(x => x.classList.toggle('active', x === b));
            K.$$('.sc-rtab', el).forEach(p => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.rtab));
        }));
        K.$('#rs-dnf', el)?.addEventListener('change', (e) => K.$('#rs-dnf-row', el).classList.toggle('hidden', !e.target.checked));
        K.$('#rs-form', el).addEventListener('submit', (e) => {
            e.preventDefault();
            const num = (id) => { const v = K.$('#' + id, el)?.value; return v === '' || v == null ? null : Number(v); };
            const dnf = !!K.$('#rs-dnf', el)?.checked;
            const pos = num('rs-pos');
            if (!dnf && (!pos || pos < 1 || pos > N)) { K.toast(`Enter a position between 1 and ${N}${derby ? '' : ' (or tick DNF)'}.`, 'error'); return; }
            const start = num('rs-start');
            if (start != null && (start < 1 || start > N)) { K.toast(`Grid position must be 1–${N}.`, 'error'); return; }
            const mates = {};
            K.$$('[data-mate]', el).forEach(inp => {
                const id = inp.dataset.mate; const d = K.$(`[data-mate-dnf="${id}"]`, el).checked;
                if (inp.value || d) mates[id] = { pos: Number(inp.value) || null, dnf: d };
            });
            if (mates && Object.values(mates).some(m => m.pos && m.pos === pos && !dnf)) { K.toast('Your teammate can’t finish in the same position as you.', 'error'); return; }
            const input = {
                mode: 'manual', mates, player: {
                    start, pos: dnf ? null : pos, dnf, dnfReason: K.$('#rs-reason', el)?.value || 'crash', lapsDone: num('rs-laps'),
                    led: num('rs-led') || 0, fl: !!K.$('#rs-fl', el)?.checked, inc: num('rs-inc'), damage: K.$('#rs-dmg', el).value,
                    wrecks: num('rs-wrecks') ?? undefined
                }
            };
            submitRound(input, `R${ev.r} ${ev.t}`);
        });
        K.$('#rs-sim', el)?.addEventListener('click', () => submitRound({ mode: 'sim' }, `R${ev.r} ${ev.t} (simulated)`));
        // Import
        let parsed = null;
        K.$('#im-parse', el).addEventListener('click', async () => {
            try {
                const f = K.$('#im-file', el).files[0];
                let text = K.$('#im-text', el).value;
                let name = '';
                if (f) { text = SC.Import.decode(await f.arrayBuffer()); name = f.name; }
                if (!text.trim()) throw new Error('Choose a results file or paste the finishing order.');
                const { format, rows } = SC.Import.parse(text, name);
                if (!rows.length) throw new Error('No drivers found in that file.');
                const entrants = E().driversIn(S, S.season.sid).map(id => { const d = id === 'P' ? S.drivers.P : S.drivers[id]; return { id, first: d.first, last: d.last, num: d.num, skill: id === 'P' ? S.player.dr : d.skill, nick: id === 'P' ? S.player.nick : '' }; });
                const matched = SC.Import.match(rows, entrants);
                parsed = { format, matched, entrants };
                drawMapping(el, S, parsed);
            } catch (err) { K.toast(err.message, 'error'); }
        });
    }

    function drawMapping(el, S, parsed) {
        const { format, matched, entrants } = parsed;
        const opts = [['', '— ignore this row —']].concat(entrants.map(e => [e.id, `${e.id === 'P' ? '⭐ YOU — ' : ''}${e.first} ${e.last}${e.num != null ? ' #' + e.num : ''}`]));
        const howLbl = { 'file-player': 'marked as player in file', name: 'name match', number: 'car number', auto: 'auto-assigned' };
        K.$('#im-map', el).innerHTML = `
            <p class="small">Read <strong>${matched.length}</strong> drivers (${esc(SC.RESULT_FORMATS[format] ? format : format)}). Check who is who — especially <strong>which row is you</strong>.</p>
            <div class="sc-table-wrap"><table class="table table-tight"><thead><tr><th>Pos</th><th>In file</th><th>Career driver</th><th></th></tr></thead><tbody>
            ${matched.map((r, i) => `<tr class="${r.id === 'P' ? 'sc-me' : ''}"><td>${r.dnf ? 'DNF' : 'P' + r.pos}</td><td>${esc(r.name)}${r.start ? ` <span class="muted small">(from P${r.start})</span>` : ''}</td>
                <td>${K.select('', opts, r.id || '', `data-map="${i}"`)}</td><td class="muted small">${esc(howLbl[r.how] || '')}</td></tr>`).join('')}
            </tbody></table></div>
            <button class="btn btn-primary btn-block" id="im-go">✅ Use these results</button>`;
        K.$('#im-go', el).addEventListener('click', () => {
            const rows = matched.map((r, i) => ({ ...r, id: K.$(`[data-map="${i}"]`, el).value || null }));
            const ids = rows.filter(r => r.id).map(r => r.id);
            if (!ids.includes('P')) { K.toast('Pick which row is you.', 'error'); return; }
            if (new Set(ids).size !== ids.length) { K.toast('Each career driver can only be used once.', 'error'); return; }
            const input = SC.Import.toRoundInput(rows);
            const ev = E().nextEvent(S);
            submitRound(input, `R${ev.r} ${ev.t} (imported)`);
        });
    }

    async function submitRound(input, label) {
        const report = await App().act((S) => E().completeRound(S, input), { undo: label, rerender: true });
        if (report) showReport(App().S, report);
    }

    function strategyPanel(S, t, ev) {
        const opts = [['push', '🔥 Push — faster, riskier'], ['balanced', '⚖️ Balanced'], ['conserve', '🛡️ Conserve — bring it home']];
        return K.panel('📋 Pit-wall strategy', `
            <p class="muted small">As principal you don't drive: set each car's approach and the race is simulated with your car, staff and facilities.</p>
            ${t.drivers.map(id => `<label class="field"><span>${esc(dn(S, id))} <span class="muted">(${Math.round(S.drivers[id]?.skill || 0)})</span></span>${K.select('', opts, 'balanced', `data-strat="${id}"`)}</label>`).join('')}
            <button class="btn btn-primary btn-block" id="st-go">▶ Run race weekend</button>`);
    }
    function wireStrategy(el, S, t) {
        K.$('#st-go', el).addEventListener('click', () => {
            const strategy = {};
            K.$$('[data-strat]', el).forEach(s => { strategy[s.dataset.strat] = s.value; });
            const ev = E().nextEvent(S);
            submitRound({ mode: 'sim', strategy }, `R${ev.r} ${ev.t}`);
        });
    }

    /* ---------------- Post-race report ---------------- */
    function showReport(S, rep) {
        const ev = rep.ev;
        const P = S.player;
        const res = ev.res;
        const principal = P.role === 'principal';
        const pr = res.player;
        const money = S.ledger.filter(l => l.s === S.seasonNo && l.r === ev.r || (rep.seasonOver && l.s === S.seasonNo && l.r === ev.r));
        const pNet = money.filter(l => l.w === 'p').reduce((s, l) => s + l.a, 0);
        const tNet = money.filter(l => l.w === 't').reduce((s, l) => s + l.a, 0);
        const st = S.history.length && rep.seasonOver ? null : E().standings(S, S.season.sid);
        const me = st ? st.find(r => r.id === 'P') : null;
        const t = S.teams[P.teamId];
        const head = principal
            ? `${t.drivers.map(id => `${esc(dn(S, id))} ${res.dnf[id] ? 'DNF' : 'P' + (res.order.indexOf(id) + 1)}`).join(' · ')}`
            : pr.dnf ? `Retired (${pr.dnfReason === 'mech' ? 'mechanical' : 'accident'})${ev.format === 'rally' ? '' : ` · started P${pr.start}`}`
                : `P${pr.pos}${ev.format === 'rally' ? ' overall' : ` from P${pr.start}`} · ${pr.pts} pts`;
        K.Modal.open(`
            ${K.Modal.head(rep.headline || `Round ${ev.r} report`, `${ev.t} · ${esc(E().seriesDef(S, S.history.length && rep.seasonOver ? S.history[S.history.length - 1].sid : S.season.sid).name)}`)}
            <div class="sc-report-hero ${!principal && !pr.dnf && pr.pos === 1 ? 'win' : ''}">
                ${principal ? '📋' : K.pos(pr.pos, pr.dnf)}<div><strong>${head}</strong>
                ${!principal && pr.sim ? '<span class="muted small">Simulated</span>' : ''}</div></div>
            <div class="stat-strip sc-report-stats">
                ${!principal && rep.drDelta != null ? K.stat(`${rep.drDelta >= 0 ? '+' : ''}${rep.drDelta}`, 'Rating') : ''}
                ${!principal && rep.repDelta != null ? K.stat(`${rep.repDelta >= 0 ? '+' : ''}${rep.repDelta}`, 'Reputation') : ''}
                ${K.stat(K.signed(pNet), 'Personal money')}
                ${principal || P.role === 'owner' ? K.stat(K.signed(tNet), 'Team money') : ''}
                ${me ? K.stat(`P${me.rank}`, 'Championship') : ''}
            </div>
            ${rep.lines.length ? `<ul class="sc-report-lines">${rep.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
            <h3 class="sc-subhead">Top 10</h3>
            ${classification(S, res, 10)}
            ${rep.seasonOver ? '<div class="panel-alert">🏁 That was the final round — the season review is ready.</div>' : ''}
            <div class="modal-actions"><button class="btn btn-ghost" id="rp-full">Full results</button><button class="btn btn-primary" data-close autofocus>${rep.seasonOver ? 'Season review →' : 'Continue'}</button></div>`,
        { wide: true });
        K.$('#rp-full').onclick = () => { V.showEventResults(S, ev); };
    }
    V.showReport = showReport;

    function classification(S, res, limit = 99) {
        const maxLed = Math.max(0, ...Object.values(res.led || {}));
        return `<div class="sc-table-wrap"><table class="table table-tight"><thead><tr><th>Pos</th><th>Driver</th><th>Team</th><th class="num">Pts</th><th></th></tr></thead><tbody>
            ${res.order.slice(0, limit).map((id, i) => {
                const tm = teamOfId(S, id);
                const flags = [res.pole === id ? '⏱️' : '', res.fl === id ? '🟣' : '', (res.led || {})[id] ? `${res.led[id]} led${res.led[id] === maxLed ? '★' : ''}` : '', (res.wrecks || {})[id] ? `💥${res.wrecks[id]}` : ''].filter(Boolean).join(' ');
                return `<tr class="${id === 'P' ? 'sc-me' : ''}"><td>${K.pos(i + 1, !!res.dnf[id])}</td><td>${esc(dn(S, id))}${res.dnf[id] ? ` <span class="muted small">(${res.dnf[id] === 'mech' ? 'mechanical' : 'accident'})</span>` : ''}</td>
                <td><span class="team-dot" style="background:${esc(tm?.color || '#555')}"></span> ${esc(tm?.name || '')}</td><td class="num">${res.pts ? res.pts[id] ?? '' : ''}</td><td class="muted small">${flags}</td></tr>`;
            }).join('')}</tbody></table></div>`;
    }
    V._classification = classification;

    V.showEventResults = function (S, ev) {
        K.Modal.open(`${K.Modal.head(`R${ev.r} — ${ev.t}`, `${K.date(ev.date)} · ${lengthText(ev)}${ev.res?.mode === 'sim' ? ' · simulated' : ev.res?.mode === 'import' ? ' · imported' : ''}`)}
            ${ev.res ? classification(S, ev.res) : '<p class="muted">Not run yet.</p>'}
            <div class="modal-actions"><button class="btn btn-primary" data-close>Close</button></div>`, { wide: true });
    };

    /* ---------------- Season review / off-season ---------------- */
    function postseasonView(el) {
        const S = App().S; const P = S.player;
        const h = S.history[S.history.length - 1];
        const ps = S.postseason || {};
        const t = S.teams[P.teamId];
        const champ = h.champs[h.sid];
        const blocks = [];
        if (ps.mustRetire) {
            blocks.push(K.panel('🎖️ The end of the road', `<p>That was season ${S.settings.maxSeasons} — the maximum for one character. It's time for the retirement ceremony and a place in the Hall of Fame.</p>
                <button class="btn btn-primary" id="po-retire-forced">🎖️ Retirement ceremony</button>`));
        } else if (P.role === 'driver') blocks.push(offersPanel(S));
        else if (P.role === 'owner') blocks.push(ownerPanel(S));
        else blocks.push(principalPanel(S));

        el.innerHTML = `
        <div class="view-head"><div><p class="section-label">Season ${h.no} review · ${h.year}</p><h1>${esc(h.series)}</h1></div>
            <div class="btn-row">
                ${!ps.mustRetire ? `<button class="btn btn-ghost" id="po-retire">🎖️ Retire now</button><button class="btn btn-primary" id="po-next">▶ Start season ${S.seasonNo + 1}</button>` : ''}
            </div></div>
        <div class="stat-strip">
            ${h.pos ? K.stat(K.ord(h.pos), 'Drivers’ championship') : ''}
            ${h.teamPos ? K.stat(K.ord(h.teamPos), 'Teams’ championship') : ''}
            ${h.row ? K.stat(h.pts, 'Points') + K.stat(h.row.w, 'Wins') + K.stat(h.row.p, 'Podiums') + K.stat(h.row.pl, 'Poles') : ''}
            ${K.stat(K.signed(h.money.pIn + h.money.pOut), 'Personal net')}
        </div>
        <div class="grid-2">
            <div class="stack">
                ${K.panel('🏆 Champions', `<p class="sc-champ">${champ ? `<strong>${esc(champ.dn)}</strong> — ${champ.pts} pts${champ.tn ? ` · Teams: <strong>${esc(champ.tn)}</strong>` : ''}` : '—'}</p>
                    <ul class="sc-awards">${(ps.awards || []).map(a => `<li class="${a.id === 'P' ? 'sc-me' : ''}"><span>${a.icon}</span><span>${esc(a.label)}</span><strong>${esc(a.who)}</strong></li>`).join('')}</ul>
                    <details class="sc-details"><summary>Other championships</summary><ul class="small">${Object.entries(h.champs).filter(([sid]) => sid !== h.sid).map(([sid, c]) => `<li><strong>${esc(E().seriesDef(S, sid)?.name || sid)}:</strong> ${esc(c.dn)}${c.tn ? ` (${esc(c.tn)})` : ''}</li>`).join('')}</ul></details>`)}
                ${K.panel('Final standings (top 10)', `<table class="table table-tight"><tbody>${h.top.map((r, i) => `<tr class="${r.id === 'P' ? 'sc-me' : ''}"><td class="rank">${i + 1}</td><td>${esc(r.n)}</td><td class="muted small">${esc(r.t)}</td><td class="num"><strong>${r.pts}</strong></td><td class="num muted small">${r.w}W</td></tr>`).join('')}</tbody></table>`)}
            </div>
            <div class="stack">${blocks.join('')}</div>
        </div>`;
        K.$('#po-next', el)?.addEventListener('click', async () => {
            const r = await App().act((S2) => E().advanceSeason(S2), { ok: (x) => `Welcome to ${x.year}. Season ${x.seasonNo} of ${x.settings.maxSeasons}! 🏁`, rerender: false });
            if (!r) { App().render(); return; }
            // Undo never reaches back across a season rollover.
            await SC.Store.clearUndo(r.id); App().undoInfo = null;
            App().go('race');
        });
        K.$('#po-retire', el)?.addEventListener('click', () => retireFlow('voluntary'));
        K.$('#po-retire-forced', el)?.addEventListener('click', () => retireFlow('forced'));
        wireOffers(el);
        K.$$('[data-promo]', el).forEach(b => b.addEventListener('click', () => App().act((S2) => E().changeSeries(S2, b.dataset.promo), { ok: 'Series change confirmed for next season.' })));
        K.$('#po-sell', el)?.addEventListener('click', async () => {
            const ok = await K.Modal.confirm('Sell your team?', 'You pocket the sale value and become a driver for hire. Your team keeps racing under new AI owners.', { ok: 'Sell team', danger: true });
            if (ok) App().act((S2) => E().sellTeam(S2), { ok: (v) => `Sold for ${K.money(v)}.` });
        });
        K.$$('[data-job]', el).forEach(b => b.addEventListener('click', () => App().act((S2) => E().takePrincipalJob(S2, b.dataset.job), { ok: 'New job accepted. 📋' })));
    }

    function offersPanel(S) {
        const P = S.player;
        const cur = S.teams[P.teamId];
        const nc = P.nextContract;
        const status = nc ? `<div class="panel-alert">✍️ Signed for next season: <strong>${esc(S.teams[nc.teamId].name)}</strong> (${esc(E().seriesDef(S, nc.sid).name)}), ${K.money(nc.salary)}/season × ${nc.seasons}.</div>`
            : P.contract && P.contract.seasons > 0 ? `<p class="muted">You're under contract with <strong>${esc(cur.name)}</strong> for ${P.contract.seasons} more season${P.contract.seasons > 1 ? 's' : ''}. You can stay, or sign elsewhere (your new team pays the buyout).</p>`
                : `<p><strong>Your contract with ${esc(cur?.name || 'your team')} has expired.</strong> Sign somewhere before starting the next season — or the best offer is taken automatically.</p>`;
        return K.panel('📨 Contract offers', `${status}
            ${S.offers.length ? `<div class="sc-offers">${S.offers.map(o => offerCard(S, o)).join('')}</div>` : '<p class="muted">No offers on the table.</p>'}
            <p class="muted small">Tip: an agent (Market → Contracts) brings more and better offers for an 8% cut.</p>`);
    }
    function offerCard(S, o) {
        const t = S.teams[o.teamId]; const sd = E().seriesDef(S, o.sid);
        const cur = E().seriesDef(S, S.player.sid);
        const move = sd.tier < cur.tier && sd.ladder === cur.ladder ? K.badge('Promotion', 'badge-green') : sd.tier > cur.tier ? K.badge('Step down', 'badge-amber') : sd.ladder !== cur.ladder ? K.badge('New discipline', 'badge-purple') : '';
        const field = E().teamsIn(S, o.sid);
        const rank = field.slice().sort((a, b) => E().carScore(b, 'rd') - E().carScore(a, 'rd')).findIndex(x => x.id === t.id) + 1;
        return `<article class="sc-offer" style="--gc:${esc(t.color)}">
            <div class="sc-offer-head"><strong>${esc(t.name)}</strong> ${o.renewal ? K.badge('Renewal', 'badge-blue') : ''}${move}</div>
            <p class="muted small">${esc(sd.name)} · car ranked ${K.ord(rank)} of ${field.length} · prestige ${t.prestige}</p>
            <div class="chip-row"><span class="chip ${o.salary < 0 ? 'sc-neg' : ''}">${o.salary < 0 ? '💸 Paid seat ' + K.money(-o.salary) : '💰 ' + K.money(o.salary)}/season</span>
                <span class="chip">${o.seasons} season${o.seasons > 1 ? 's' : ''}</span><span class="chip">${o.status === 'lead' ? '🥇 Lead driver' : '🥈 Second driver'}</span>
                ${o.winBonus ? `<span class="chip">Win bonus ${K.money(o.winBonus)}</span>` : ''}<span class="chip">Interest ${o.interest}%</span></div>
            <div class="btn-row"><button class="btn btn-primary btn-sm" data-accept="${o.id}">Accept</button>
                ${o.countered < 2 ? `<button class="btn btn-secondary btn-sm" data-counter="${o.id}" data-pct="0.1">Ask +10%</button><button class="btn btn-secondary btn-sm" data-counter="${o.id}" data-pct="0.25">Ask +25%</button>` : '<span class="muted small">Final offer</span>'}
                <button class="btn btn-ghost btn-sm" data-decline="${o.id}">Decline</button></div>
        </article>`;
    }
    V._offerCard = offerCard;
    function wireOffers(el) {
        K.$$('[data-accept]', el).forEach(b => b.addEventListener('click', () => App().act((S) => E().acceptOffer(S, b.dataset.accept), { ok: 'Contract signed. ✍️' })));
        K.$$('[data-decline]', el).forEach(b => b.addEventListener('click', () => App().act((S) => E().declineOffer(S, b.dataset.decline), { ok: 'Offer declined.' })));
        K.$$('[data-counter]', el).forEach(b => b.addEventListener('click', () => App().act((S) => E().counterOffer(S, b.dataset.counter, Number(b.dataset.pct)), {
            ok: (r) => r.ok ? 'They agreed to your terms! 🤝' : r.walked ? 'They walked away from the table.' : 'They refused — the original offer stands.'
        })));
    }
    V._wireOffers = wireOffers;

    function ownerPanel(S) {
        const pr = S.postseason?.promotion;
        const t = S.teams[S.player.teamId];
        const moving = S.player.moveTo ? `<div class="panel-alert">➡️ Next season: <strong>${esc(E().seriesDef(S, S.player.moveTo).name)}</strong></div>` : '';
        return K.panel('🏢 Team decisions', `${moving}
            ${pr && pr.up.length ? `<h3 class="sc-subhead">Move up</h3>${pr.eligible ? '' : `<p class="muted small">${esc(pr.reason)}</p>`}
                ${pr.up.map(u => `<div class="sc-line"><span>⬆️ ${esc(u.name)} — entry fee ${K.money(u.fee)}</span><button class="btn btn-primary btn-sm" data-promo="${esc(u.sid)}" ${u.ok && !S.player.moveTo ? '' : 'disabled'}>Enter</button></div>`).join('')}` : ''}
            ${pr && pr.down.length ? `<h3 class="sc-subhead">Step down</h3>${pr.down.map(d => `<div class="sc-line"><span>⬇️ ${esc(d.name)} — settlement ${K.money(d.refund)}</span><button class="btn btn-ghost btn-sm" data-promo="${esc(d.sid)}" ${S.player.moveTo ? 'disabled' : ''}>Move down</button></div>`).join('')}` : ''}
            <h3 class="sc-subhead">Ownership</h3>
            <div class="sc-line"><span>Budget ${K.money(t.budget)} · prestige ${t.prestige}</span><button class="btn btn-danger btn-sm" id="po-sell">Sell team</button></div>
            <p class="muted small">Also: re-sign sponsors (Team → Sponsors), hire drivers & staff (Market), and plan facility builds before the new season.</p>`);
    }

    function principalPanel(S) {
        const P = S.player;
        const h = S.history[S.history.length - 1];
        const jobs = (P.fired || P.contract.seasons <= 0) ? E().principalOffers(S) : [];
        return K.panel('📋 Board review', `
            ${h.board ? `<p>Target <strong>P${h.board.target}</strong> · finished <strong>P${h.board.pos}</strong> · confidence <strong>${h.board.confidence}%</strong></p>${K.progress(h.board.confidence)}` : ''}
            ${P.fired ? '<div class="panel-alert">🚪 You have been dismissed. Pick a new team to continue your career.</div>' : P.contract.seasons <= 0 ? '<p class="muted">Your contract is up — the board renews it if confidence is 40% or higher, otherwise take another job.</p>' : `<p class="muted">Contract: ${P.contract.seasons} season${P.contract.seasons > 1 ? 's' : ''} left.</p>`}
            ${jobs.length ? `<h3 class="sc-subhead">Teams interested in you</h3>${jobs.map(j => `<div class="sc-line"><span>${esc(S.teams[j.teamId].name)} — ${esc(E().seriesDef(S, j.sid).name)} · ${K.money(j.salary)}/season</span><button class="btn btn-primary btn-sm" data-job="${j.teamId}">Take job</button></div>`).join('')}`
                : P.fired ? `<p class="muted">No one is calling yet — take the lowest-ranked job in the series:</p>${E().teamsIn(S, P.sid).filter(t => t.id !== P.teamId).sort((a, b) => a.prestige - b.prestige).slice(0, 2).map(t => `<div class="sc-line"><span>${esc(t.name)}</span><button class="btn btn-secondary btn-sm" data-job="${t.id}">Take job</button></div>`).join('')}` : ''}`);
    }

    async function retireFlow(reason) {
        const S = App().S;
        if (reason !== 'forced') {
            const ok = await K.Modal.confirm('Retire this character?', `${esc(S.player.first)} ${esc(S.player.last)} will retire after ${S.history.length} season${S.history.length === 1 ? '' : 's'} and enter the Hall of Fame. The save stays viewable but can't race again.`, { ok: 'Retire', danger: true });
            if (!ok) return;
        }
        const entry = await App().act((S2) => E().retire(S2, reason), { rerender: false });
        if (!entry) return;
        await SC.Store.addHof(entry);
        await App().render();
        K.toast('Inducted into the Hall of Fame. 🎖️');
    }
    V._retireFlow = retireFlow;

    function retiredView(el) {
        const S = App().S; const h = S.hof;
        const g = E().gameOf(S);
        el.innerHTML = `
        <section class="sc-retired">
            <p class="section-label">Hall of Fame</p>
            <h1>${K.flag(S.player.nat)} ${esc(h?.name || '')}</h1>
            <p class="muted">${esc(g.name)} · ${h?.from}–${h?.to} · ${h?.seasons} seasons · ${esc(E().ROLES[S.player.role]?.label || '')}</p>
            <div class="stat-strip">${K.stat(h?.titles ?? 0, 'Titles')}${K.stat(h?.wins ?? 0, 'Wins')}${K.stat(h?.podiums ?? 0, 'Podiums')}${K.stat(h?.poles ?? 0, 'Poles')}${K.stat(h?.starts ?? 0, 'Starts')}${K.stat(h?.legacy ?? 0, 'Legacy score')}</div>
            ${h?.seriesTitles?.length ? `<p>🏆 ${h.seriesTitles.map(esc).join(' · ')}</p>` : ''}
            <p class="muted">Best season: ${esc(h?.best || '—')} · Career earnings ${K.money(h?.earnings || 0)}</p>
            <div class="btn-row sc-center"><a class="btn btn-primary" href="#/new" id="rt-new">🆕 Start a new character</a><a class="btn btn-ghost" href="#/hof">🎖️ Hall of Fame</a><button class="btn btn-ghost" data-go="career">📈 Career stats</button></div>
        </section>`;
        K.$$('[data-go]', el).forEach(b => b.addEventListener('click', () => App().go(b.dataset.go)));
        K.$('#rt-new', el).addEventListener('click', () => SC.Setup.resetWizard());
    }
})(typeof window !== 'undefined' ? window : globalThis);
