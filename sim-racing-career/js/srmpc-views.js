/* ============================================================
   Phoenix SRMPC — Player views
   Dashboard, Series, Races, Standings, Stats + shared components.
   ============================================================ */
'use strict';

/* ---------------- Modal system ---------------- */
const Modal = {
    open(html, { wide = false } = {}) {
        this.close();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'active-modal';
        overlay.innerHTML = `<div class="modal-card ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this.close(); });
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
        requestAnimationFrame(() => overlay.classList.add('show'));
        return overlay;
    },
    close() {
        const overlay = document.getElementById('active-modal');
        if (overlay) overlay.remove();
        document.body.style.overflow = '';
    },
    header(title, subtitle = '') {
        return `<div class="modal-head">
            <div><h2>${Util.esc(title)}</h2>${subtitle ? `<p class="muted">${Util.esc(subtitle)}</p>` : ''}</div>
            <button class="icon-btn" onclick="Modal.close()" aria-label="Close">✕</button>
        </div>`;
    }
};
window.Modal = Modal;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') Modal.close(); });

/* ---------------- Shared components ---------------- */
const C = {
    logoBox(entity, cls = '') {
        const name = entity?.name || '?';
        if (entity?.logo) {
            return `<span class="logo-box ${cls}"><img src="${entity.logo}" alt="${Util.esc(name)} logo"></span>`;
        }
        const color = entity?.color || '#3d4d5c';
        const initials = name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
        return `<span class="logo-box mono ${cls}" style="background:${Util.esc(color)}">${Util.esc(initials)}</span>`;
    },

    gameChip(game) {
        if (!game) return '<span class="chip chip-dim">No game</span>';
        return `<span class="chip" style="border-color:${Util.esc(game.color || '#3d4d5c')}">${Util.esc(game.name)}</span>`;
    },

    statusBadge(status) {
        const map = {
            scheduled: ['Scheduled', 'badge-blue'], live: ['Live', 'badge-red'],
            completed: ['Completed', 'badge-green'], active: ['Active', 'badge-green'],
            finished: ['Finished', 'badge-dim'], pending: ['Pending', 'badge-amber'],
            proposed: ['Proposed', 'badge-amber']
        };
        const [label, cls] = map[status] || [status || '—', 'badge-dim'];
        return `<span class="badge ${cls}">${Util.esc(label)}</span>`;
    },

    posBadge(res) {
        if (res.dnf) return '<span class="pos pos-dnf">DNF</span>';
        const p = Number(res.position);
        const cls = p === 1 ? 'pos-1' : p === 2 ? 'pos-2' : p === 3 ? 'pos-3' : '';
        return `<span class="pos ${cls}">P${p || '—'}</span>`;
    },

    empty(icon, title, body, ctaHtml = '') {
        return `<div class="empty-state">
            <div class="empty-icon">${icon}</div>
            <h3>${Util.esc(title)}</h3>
            <p>${Util.esc(body)}</p>
            ${ctaHtml}
        </div>`;
    },

    statChip(value, label) {
        return `<div class="stat-chip"><span class="stat-value">${value}</span><span class="stat-label">${Util.esc(label)}</span></div>`;
    },

    // Recent-form pip strip. `form` is an array of category strings
    // (win/podium/points/out/dnf) oldest→newest, from Stats.driverForm.
    formPips(form) {
        if (!form || !form.length) return '<span class="muted small">—</span>';
        const title = { win: 'Win', podium: 'Podium', points: 'Points finish', out: 'Out of points', dnf: 'DNF' };
        return `<span class="form-pips">${form.map(c =>
            `<span class="pip pip-${c}" title="${title[c] || ''}"></span>`).join('')}</span>`;
    },

    winnerOf(race, world) {
        if (race.status !== 'completed' || !race.results?.length) return null;
        const w = race.results.find(r => Number(r.position) === 1 && !r.dnf);
        return w ? (world.driversById[w.driverId]?.name || 'Unknown') : null;
    },

    raceRow(race, world, { showSeries = true } = {}) {
        const series = world.seriesById[race.seriesId];
        const game = world.gamesById[race.gameId];
        const winner = this.winnerOf(race, world);
        return `<div class="race-row" onclick="Views.showRace('${Util.attr(race.id)}')">
            <div class="race-row-date">
                <span class="race-day">${Util.fmtDateShort(race.date)}</span>
                ${race.time ? `<span class="race-time">${Util.esc(Util.fmtTime(race.time))}</span>` : ''}
            </div>
            <div class="race-row-main">
                <span class="race-title">${Util.esc(race.name || race.track || 'Race')}</span>
                <span class="race-sub">${Util.esc(race.track || '')}${showSeries && series ? ` · ${Util.esc(series.name)}` : ''}</span>
            </div>
            <div class="race-row-side">
                ${winner ? `<span class="race-winner">🏆 ${Util.esc(winner)}</span>` : ''}
                ${game ? this.gameChip(game) : ''}
                ${this.statusBadge(race.status)}
            </div>
        </div>`;
    }
};
window.C = C;

/* ============================================================
   Views
   ============================================================ */
const Views = {
    /* ---------------- Dashboard ---------------- */
    async dashboard(el) {
        const world = await DB.loadWorld();
        const { races, series, games, teams, drivers } = world;

        const completed = races.filter(r => r.status === 'completed');
        const upcoming = races.filter(r => r.status !== 'completed' && !Util.isPast(r.date))
            .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999')).slice(0, 4);
        const recent = completed.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 4);

        // Featured championship = active series with the most completed races.
        const activeSeries = series.filter(s => (s.status || 'active') === 'active');
        const featured = activeSeries
            .map(s => ({ s, n: completed.filter(r => r.seriesId === s.id).length }))
            .sort((a, b) => b.n - a.n)[0]?.s || activeSeries[0] || null;
        const standings = featured ? Stats.driverTable(races, world, { seriesId: featured.id }).slice(0, 5) : [];

        let challenges = [];
        try {
            const all = await DB.challenges();
            const today = Util.todayISO();
            challenges = all.filter(c => c.status === 'active' && (!c.endDate || c.endDate >= today)).slice(0, 3);
        } catch (e) { /* challenges are optional on dashboard */ }

        const isAdmin = Auth.isAdmin();

        el.innerHTML = `
        <div class="view-head">
            <div>
                <h1>League Dashboard</h1>
                <p class="muted">Your multiplayer career across every game — live.</p>
            </div>
            ${isAdmin ? `<button class="btn btn-primary" onclick="App.go('admin')">⚙ Admin Console</button>` : ''}
        </div>

        <div class="stat-strip">
            ${C.statChip(games.length, 'Games')}
            ${C.statChip(series.length, 'Series')}
            ${C.statChip(drivers.length, 'Drivers')}
            ${C.statChip(teams.length, 'Teams')}
            ${C.statChip(completed.length, 'Races run')}
            ${C.statChip(races.length - completed.length, 'Races ahead')}
        </div>

        <div class="grid-2">
            <section class="panel">
                <div class="panel-head"><h2>🏁 Next Races</h2><button class="btn btn-ghost btn-sm" onclick="App.go('races')">All races →</button></div>
                ${upcoming.length
                    ? upcoming.map(r => C.raceRow(r, world)).join('')
                    : C.empty('📅', 'No upcoming races', isAdmin ? 'Build a schedule from the Admin Console in a few clicks.' : 'The Game Master hasn’t scheduled the next round yet.',
                        isAdmin ? `<button class="btn btn-primary" onclick="App.go('admin','series')">Open Schedule Builder</button>` : '')}
            </section>

            <section class="panel">
                <div class="panel-head"><h2>🏆 ${featured ? Util.esc(featured.name) : 'Championship'}</h2><button class="btn btn-ghost btn-sm" onclick="App.go('standings')">Full standings →</button></div>
                ${standings.length ? `
                    <table class="table table-tight">
                        <thead><tr><th>#</th><th>Driver</th><th class="num">Pts</th><th class="num">Wins</th></tr></thead>
                        <tbody>${standings.map(row => `
                            <tr onclick="Views.showDriver('${Util.attr(row.driverId)}')">
                                <td class="rank">${row.rank}</td>
                                <td>${Util.esc(row.driver.name)}</td>
                                <td class="num strong">${row.points}</td>
                                <td class="num">${row.wins}</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>`
                    : C.empty('🏆', 'No standings yet', 'Standings appear automatically after the first race results are entered.')}
            </section>

            <section class="panel">
                <div class="panel-head"><h2>📊 Latest Results</h2><button class="btn btn-ghost btn-sm" onclick="App.go('stats')">All stats →</button></div>
                ${recent.length
                    ? recent.map(r => C.raceRow(r, world)).join('')
                    : C.empty('📊', 'No results yet', 'Once races are completed, results and stats show up here.')}
            </section>

            <section class="panel">
                <div class="panel-head"><h2>🎯 Active Challenges</h2><button class="btn btn-ghost btn-sm" onclick="App.go('challenges')">All challenges →</button></div>
                ${challenges.length ? challenges.map(c => `
                    <div class="challenge-mini" onclick="App.go('challenges')">
                        <span class="badge ${c.mode === 'multiplayer' ? 'badge-purple' : 'badge-blue'}">${c.mode === 'multiplayer' ? 'Multiplayer' : 'Solo'}</span>
                        <div><strong>${Util.esc(c.title)}</strong><p class="muted">${Util.esc(c.description)}</p></div>
                    </div>`).join('')
                    : C.empty('🎯', 'No active challenges', isAdmin ? 'Generate a weekly or monthly challenge set from the Admin Console.' : 'New solo and multiplayer challenges drop weekly/monthly.',
                        isAdmin ? `<button class="btn btn-primary" onclick="App.go('admin','challenges')">Generate Challenges</button>` : '')}
            </section>
        </div>`;
    },

    /* ---------------- Series ---------------- */
    async series(el) {
        const world = await DB.loadWorld();
        const isAdmin = Auth.isAdmin();
        const visible = world.series.filter(s => isAdmin || (s.status || 'active') !== 'proposed');

        el.innerHTML = `
        <div class="view-head">
            <div><h1>Racing Series</h1><p class="muted">Every championship, across every game.</p></div>
            ${isAdmin ? `<button class="btn btn-primary" onclick="Admin.seriesForm()">＋ New Series</button>` : ''}
        </div>
        ${visible.length ? `<div class="card-grid">${visible.map(s => {
            const game = world.gamesById[s.gameId];
            const seriesRaces = world.races.filter(r => r.seriesId === s.id);
            const done = seriesRaces.filter(r => r.status === 'completed').length;
            const top = Stats.driverTable(world.races, world, { seriesId: s.id }).slice(0, 3);
            return `<div class="series-card" onclick="App.go('series-detail','${Util.attr(s.id)}')">
                <div class="series-card-top">
                    ${C.logoBox(s, 'logo-lg')}
                    <div>
                        <h3>${Util.esc(s.name)}</h3>
                        <div class="chip-row">${C.gameChip(game)}${s.season ? `<span class="chip chip-dim">Season ${Util.esc(String(s.season))}</span>` : ''}${C.statusBadge(s.status || 'active')}</div>
                    </div>
                </div>
                <div class="series-card-meta">
                    <span>${done}/${seriesRaces.length} rounds complete</span>
                    <div class="progress"><div class="progress-fill" style="width:${seriesRaces.length ? Math.round(done / seriesRaces.length * 100) : 0}%"></div></div>
                </div>
                ${top.length ? `<div class="series-card-top3">${top.map((r, i) => `<span class="top3-item"><span class="top3-medal">${['🥇', '🥈', '🥉'][i]}</span>${Util.esc(r.driver.name)} · ${r.points}</span>`).join('')}</div>` : '<div class="series-card-top3 muted">No results yet</div>'}
            </div>`;
        }).join('')}</div>`
        : C.empty('🏆', 'No series yet', isAdmin ? 'Create your first series — logo, points system, and a full schedule in a couple of minutes.' : 'The Game Master will publish the first championship soon.',
            isAdmin ? `<button class="btn btn-primary" onclick="Admin.seriesForm()">Create First Series</button>` : '')}`;
    },

    async seriesDetail(el, seriesId) {
        const world = await DB.loadWorld();
        const s = world.seriesById[seriesId];
        if (!s) { el.innerHTML = C.empty('❓', 'Series not found', 'It may have been deleted.'); return; }
        const game = world.gamesById[s.gameId];
        const seriesRaces = world.races.filter(r => r.seriesId === s.id)
            .sort((a, b) => (a.round || 999) - (b.round || 999) || (a.date || '').localeCompare(b.date || ''));
        const standings = Stats.driverTable(world.races, world, { seriesId: s.id });
        const teamStandings = Stats.teamTable(world.races, world, { seriesId: s.id });
        const isAdmin = Auth.isAdmin();
        const sys = POINTS_SYSTEMS[s.pointsSystem || 'f1'];

        el.innerHTML = `
        <button class="btn btn-ghost btn-sm" onclick="App.go('series')">← All series</button>
        <div class="series-hero">
            ${C.logoBox(s, 'logo-xl')}
            <div class="series-hero-info">
                <h1>${Util.esc(s.name)}</h1>
                <div class="chip-row">${C.gameChip(game)}${s.season ? `<span class="chip chip-dim">Season ${Util.esc(String(s.season))}</span>` : ''}<span class="chip chip-dim">${Util.esc(sys?.label || 'Custom points')}</span>${C.statusBadge(s.status || 'active')}</div>
                ${s.description ? `<p class="muted">${Util.esc(s.description)}</p>` : ''}
            </div>
            ${isAdmin ? `<div class="btn-col">
                <button class="btn btn-secondary btn-sm" onclick="Admin.seriesForm('${Util.attr(s.id)}')">✎ Edit Series</button>
                <button class="btn btn-secondary btn-sm" onclick="Admin.scheduleBuilder('${Util.attr(s.id)}')">📅 Schedule Builder</button>
                <button class="btn btn-secondary btn-sm" onclick="Admin.raceForm(null,'${Util.attr(s.id)}')">＋ Add Race</button>
            </div>` : ''}
        </div>

        <div class="grid-2">
            <section class="panel">
                <div class="panel-head"><h2>📅 Schedule</h2></div>
                ${seriesRaces.length ? `<table class="table">
                    <thead><tr><th>Rd</th><th>Date</th><th>Track</th><th>Status</th><th>Winner</th></tr></thead>
                    <tbody>${seriesRaces.map(r => `
                        <tr onclick="Views.showRace('${Util.attr(r.id)}')">
                            <td class="rank">${r.round || '—'}</td>
                            <td>${Util.esc(Util.fmtDateShort(r.date))}</td>
                            <td>${Util.esc(r.track || '—')}</td>
                            <td>${C.statusBadge(r.status)}</td>
                            <td>${Util.esc(C.winnerOf(r, world) || '—')}</td>
                        </tr>`).join('')}
                    </tbody></table>`
                    : C.empty('📅', 'No races scheduled', isAdmin ? 'Use the Schedule Builder to create the whole season in one click.' : 'Schedule coming soon.',
                        isAdmin ? `<button class="btn btn-primary" onclick="Admin.scheduleBuilder('${Util.attr(s.id)}')">Open Schedule Builder</button>` : '')}
            </section>

            <section class="panel">
                <div class="panel-head"><h2>🏆 Standings</h2></div>
                ${standings.length ? `<table class="table table-tight">
                    <thead><tr><th>#</th><th>Driver</th><th>Team</th><th class="num">Pts</th><th class="num">W</th><th class="num">Pod</th></tr></thead>
                    <tbody>${standings.map(row => `
                        <tr onclick="Views.showDriver('${Util.attr(row.driverId)}')">
                            <td class="rank">${row.rank}</td>
                            <td>${Util.esc(row.driver.name)}</td>
                            <td class="muted">${Util.esc(world.teamsById[row.driver.teamId]?.name || '—')}</td>
                            <td class="num strong">${row.points}</td>
                            <td class="num">${row.wins}</td>
                            <td class="num">${row.podiums}</td>
                        </tr>`).join('')}
                    </tbody></table>
                    ${teamStandings.length ? `<div class="panel-head" style="margin-top:1rem"><h2>🛠 Teams</h2></div>
                    <table class="table table-tight">
                        <thead><tr><th>#</th><th>Team</th><th class="num">Pts</th><th class="num">W</th></tr></thead>
                        <tbody>${teamStandings.map(t => `
                            <tr onclick="Views.showTeam('${Util.attr(t.teamId)}')">
                                <td class="rank">${t.rank}</td>
                                <td><span class="team-dot" style="background:${Util.esc(t.team.color || '#666')}"></span>${Util.esc(t.team.name)}</td>
                                <td class="num strong">${t.points}</td>
                                <td class="num">${t.wins}</td>
                            </tr>`).join('')}
                        </tbody></table>` : ''}`
                    : C.empty('🏆', 'No standings yet', 'Standings build automatically as race results come in.')}
            </section>
        </div>`;
    },

    /* ---------------- Races ---------------- */
    _raceFilters: { gameId: '', seriesId: '', month: null },

    async races(el) {
        const world = await DB.loadWorld();
        const f = this._raceFilters;
        if (!f.month) f.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const isAdmin = Auth.isAdmin();

        const filtered = world.races.filter(r =>
            (!f.gameId || r.gameId === f.gameId) && (!f.seriesId || r.seriesId === f.seriesId));
        const upcoming = filtered.filter(r => r.status !== 'completed')
            .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
        const completed = filtered.filter(r => r.status === 'completed')
            .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        el.innerHTML = `
        <div class="view-head">
            <div><h1>Race Calendar</h1><p class="muted">Sign up, check schedules, and review results.</p></div>
            ${isAdmin ? `<button class="btn btn-primary" onclick="Admin.raceForm()">＋ Add Race</button>` : ''}
        </div>

        <div class="filter-bar">
            <select id="race-filter-game" class="input">
                <option value="">All games</option>
                ${world.games.map(g => `<option value="${Util.attr(g.id)}" ${f.gameId === g.id ? 'selected' : ''}>${Util.esc(g.name)}</option>`).join('')}
            </select>
            <select id="race-filter-series" class="input">
                <option value="">All series</option>
                ${world.series.map(s => `<option value="${Util.attr(s.id)}" ${f.seriesId === s.id ? 'selected' : ''}>${Util.esc(s.name)}</option>`).join('')}
            </select>
        </div>

        <div class="grid-cal">
            <section class="panel">
                <div class="panel-head">
                    <h2>🗓 ${f.month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
                    <div class="btn-row">
                        <button class="icon-btn" id="cal-prev" aria-label="Previous month">‹</button>
                        <button class="icon-btn" id="cal-next" aria-label="Next month">›</button>
                    </div>
                </div>
                ${this._calendarHtml(f.month, filtered, world)}
            </section>

            <div class="stack">
                <section class="panel">
                    <div class="panel-head"><h2>⏭ Upcoming (${upcoming.length})</h2></div>
                    ${upcoming.length ? upcoming.slice(0, 12).map(r => C.raceRow(r, world)).join('')
                        : C.empty('📅', 'Nothing scheduled', isAdmin ? 'Add races or generate a full series schedule.' : 'Check back soon.')}
                </section>
                <section class="panel">
                    <div class="panel-head"><h2>✅ Completed (${completed.length})</h2></div>
                    ${completed.length ? completed.slice(0, 12).map(r => C.raceRow(r, world)).join('')
                        : C.empty('🏁', 'No completed races', 'Results will appear here after race day.')}
                </section>
            </div>
        </div>`;

        Util.$('#race-filter-game', el)?.addEventListener('change', (e) => { f.gameId = e.target.value; this.races(el); });
        Util.$('#race-filter-series', el)?.addEventListener('change', (e) => { f.seriesId = e.target.value; this.races(el); });
        Util.$('#cal-prev', el)?.addEventListener('click', () => { f.month = new Date(f.month.getFullYear(), f.month.getMonth() - 1, 1); this.races(el); });
        Util.$('#cal-next', el)?.addEventListener('click', () => { f.month = new Date(f.month.getFullYear(), f.month.getMonth() + 1, 1); this.races(el); });
    },

    _calendarHtml(month, races, world) {
        const year = month.getFullYear(), mon = month.getMonth();
        const firstDay = new Date(year, mon, 1).getDay();
        const daysInMonth = new Date(year, mon + 1, 0).getDate();
        const today = Util.todayISO();
        const byDate = {};
        races.forEach(r => { if (r.date) (byDate[r.date] = byDate[r.date] || []).push(r); });

        let cells = '';
        for (let i = 0; i < firstDay; i++) cells += '<div class="cal-cell cal-empty"></div>';
        for (let d = 1; d <= daysInMonth; d++) {
            const iso = `${year}-${String(mon + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dayRaces = byDate[iso] || [];
            cells += `<div class="cal-cell ${iso === today ? 'cal-today' : ''} ${dayRaces.length ? 'cal-has-race' : ''}">
                <span class="cal-daynum">${d}</span>
                ${dayRaces.slice(0, 2).map(r => `<button class="cal-race ${r.status === 'completed' ? 'done' : ''}" onclick="Views.showRace('${Util.attr(r.id)}')" title="${Util.esc(r.name || r.track || '')}">${Util.esc((r.track || r.name || 'Race').slice(0, 14))}</button>`).join('')}
                ${dayRaces.length > 2 ? `<span class="cal-more">+${dayRaces.length - 2}</span>` : ''}
            </div>`;
        }
        return `<div class="cal-grid">
            ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="cal-dow">${d}</div>`).join('')}
            ${cells}
        </div>`;
    },

    /* ---------------- Race detail modal ---------------- */
    async showRace(raceId) {
        const world = await DB.loadWorld();
        const race = world.races.find(r => r.id === raceId);
        if (!race) { Util.notify('Race not found.', 'error'); return; }
        const series = world.seriesById[race.seriesId];
        const game = world.gamesById[race.gameId];
        const isAdmin = Auth.isAdmin();

        let signups = [];
        try {
            signups = (await DB.signups({ force: true })).filter(s => s.raceId === raceId);
        } catch (e) { /* signups readable only when signed in */ }

        const uid = Auth.uid();
        const mySignup = uid ? signups.find(s => s.uid === uid) : null;
        const canSignUp = Auth.isPlayer() && Auth.state.profile?.driverId && race.status !== 'completed';

        const results = (race.results || []).slice().sort((a, b) => {
            if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
            return (Number(a.position) || 99) - (Number(b.position) || 99);
        });

        Modal.open(`
            ${Modal.header(race.name || race.track || 'Race', `${series ? series.name + ' · ' : ''}${Util.fmtDate(race.date)}${race.time ? ' · ' + Util.fmtTime(race.time) : ''}`)}
            <div class="chip-row" style="margin-bottom:1rem">
                ${C.gameChip(game)}
                ${race.track ? `<span class="chip chip-dim">📍 ${Util.esc(race.track)}</span>` : ''}
                ${race.laps ? `<span class="chip chip-dim">${Util.esc(String(race.laps))} laps</span>` : ''}
                ${C.statusBadge(race.status)}
            </div>

            ${race.status === 'completed' && results.length ? `
                <h3 class="section-label">Results</h3>
                <table class="table table-tight">
                    <thead><tr><th>Pos</th><th>Driver</th><th>Team</th><th class="num">Pts</th><th></th></tr></thead>
                    <tbody>${results.map(res => {
                        const drv = world.driversById[res.driverId];
                        return `<tr>
                            <td>${C.posBadge(res)}</td>
                            <td>${Util.esc(drv?.name || res.driverName || 'Unknown')}</td>
                            <td class="muted">${Util.esc(world.teamsById[drv?.teamId]?.name || '—')}</td>
                            <td class="num strong">${pointsForResult(res, series)}</td>
                            <td>${res.pole ? '<span title="Pole position">🅿️</span>' : ''}${res.fastestLap ? '<span title="Fastest lap">⚡</span>' : ''}</td>
                        </tr>`;
                    }).join('')}</tbody>
                </table>`
            : `
                <h3 class="section-label">Entry List (${signups.length})</h3>
                ${signups.length ? `<div class="chip-row">${signups.map(s => `<span class="chip">${Util.esc(world.driversById[s.driverId]?.name || 'Driver')}</span>`).join('')}</div>`
                    : '<p class="muted">No sign-ups yet. Be the first on the grid!</p>'}
                ${canSignUp ? `<div style="margin-top:1rem">
                    ${mySignup
                        ? `<button class="btn btn-secondary" onclick="Views.toggleSignup('${Util.attr(race.id)}')">Withdraw my entry</button>`
                        : `<button class="btn btn-primary" onclick="Views.toggleSignup('${Util.attr(race.id)}')">🏁 Sign me up</button>`}
                </div>` : (Auth.isPlayer() && !Auth.state.profile?.driverId && race.status !== 'completed'
                    ? `<p class="muted" style="margin-top:1rem">Create your driver profile in <a href="#" onclick="Modal.close();App.go('career');return false">My Career</a> to sign up for races.</p>` : '')}
            `}

            ${isAdmin ? `<div class="modal-actions">
                ${race.status !== 'completed'
                    ? `<button class="btn btn-primary" onclick="Admin.resultsForm('${Util.attr(race.id)}')">🏁 Enter Results</button>`
                    : `<button class="btn btn-secondary" onclick="Admin.resultsForm('${Util.attr(race.id)}')">✎ Edit Results</button>`}
                <button class="btn btn-secondary" onclick="Admin.raceForm('${Util.attr(race.id)}')">✎ Edit Race</button>
                <button class="btn btn-danger" onclick="Admin.deleteRace('${Util.attr(race.id)}')">Delete</button>
            </div>` : ''}
        `, { wide: race.status === 'completed' });
    },

    async toggleSignup(raceId) {
        try {
            const uid = Auth.uid();
            const driverId = Auth.state.profile?.driverId;
            if (!uid || !driverId) { Util.notify('Create your driver profile first (My Career).', 'error'); return; }
            const signups = (await DB.signups({ force: true })).filter(s => s.raceId === raceId && s.uid === uid);
            if (signups.length) {
                for (const s of signups) await DB.remove('raceSignups', s.id);
                Util.notify('Entry withdrawn.');
            } else {
                await DB.create('raceSignups', { raceId, uid, driverId });
                Util.notify('You are on the grid! 🏁');
            }
            this.showRace(raceId);
        } catch (e) {
            Util.notify('Could not update signup: ' + e.message, 'error');
        }
    },

    /* ---------------- Standings ---------------- */
    _standingsSeriesId: '',

    async standings(el) {
        const world = await DB.loadWorld();
        const activeSeries = world.series.filter(s => (s.status || 'active') !== 'proposed');
        if (!this._standingsSeriesId && activeSeries.length) {
            // Default to the series with the most completed racing.
            const completed = world.races.filter(r => r.status === 'completed');
            this._standingsSeriesId = activeSeries
                .map(s => ({ s, n: completed.filter(r => r.seriesId === s.id).length }))
                .sort((a, b) => b.n - a.n)[0]?.s.id || activeSeries[0].id;
        }
        const sel = this._standingsSeriesId;
        const filter = sel === '__career__' ? {} : { seriesId: sel };
        const drivers = Stats.driverTable(world.races, world, filter);
        const teams = Stats.teamTable(world.races, world, filter);
        const selSeries = world.seriesById[sel];

        el.innerHTML = `
        <div class="view-head">
            <div><h1>Standings</h1><p class="muted">Computed live from race results — always accurate.</p></div>
        </div>
        <div class="filter-bar">
            <select id="standings-series" class="input">
                ${activeSeries.map(s => `<option value="${Util.attr(s.id)}" ${sel === s.id ? 'selected' : ''}>${Util.esc(s.name)}${s.season ? ` (S${Util.esc(String(s.season))})` : ''}</option>`).join('')}
                <option value="__career__" ${sel === '__career__' ? 'selected' : ''}>🌐 Career — all games combined</option>
            </select>
        </div>

        <div class="grid-2">
            <section class="panel">
                <div class="panel-head"><h2>🏆 Drivers${selSeries ? ` — ${Util.esc(selSeries.name)}` : sel === '__career__' ? ' — Career' : ''}</h2></div>
                ${drivers.length ? `<table class="table">
                    <thead><tr><th>#</th><th>Driver</th><th>Team</th><th class="num">Pts</th><th class="num">W</th><th class="num">Pod</th><th class="num">DNF</th><th>Form</th></tr></thead>
                    <tbody>${drivers.map(row => `
                        <tr onclick="Views.showDriver('${Util.attr(row.driverId)}')">
                            <td class="rank">${row.rank <= 3 ? ['🥇', '🥈', '🥉'][row.rank - 1] : row.rank}</td>
                            <td>${Util.esc(row.driver.name)}</td>
                            <td class="muted">${Util.esc(world.teamsById[row.driver.teamId]?.name || 'Free agent')}</td>
                            <td class="num strong">${row.points}</td>
                            <td class="num">${row.wins}</td>
                            <td class="num">${row.podiums}</td>
                            <td class="num">${row.dnfs}</td>
                            <td>${C.formPips(Stats.driverForm(row.driverId, world.races, world))}</td>
                        </tr>`).join('')}
                    </tbody></table>`
                    : C.empty('🏆', 'No results yet', 'Standings appear the moment the first result is saved.')}
            </section>

            <section class="panel">
                <div class="panel-head"><h2>🛠 Teams</h2></div>
                ${teams.length ? `<table class="table">
                    <thead><tr><th>#</th><th>Team</th><th class="num">Pts</th><th class="num">W</th><th class="num">Pod</th></tr></thead>
                    <tbody>${teams.map(t => `
                        <tr onclick="Views.showTeam('${Util.attr(t.teamId)}')">
                            <td class="rank">${t.rank}</td>
                            <td><span class="team-dot" style="background:${Util.esc(t.team.color || '#666')}"></span>${Util.esc(t.team.name)}</td>
                            <td class="num strong">${t.points}</td>
                            <td class="num">${t.wins}</td>
                            <td class="num">${t.podiums}</td>
                        </tr>`).join('')}
                    </tbody></table>`
                    : C.empty('🛠', 'No team results yet', 'Team standings need drivers assigned to teams with race results.')}
            </section>
        </div>`;

        Util.$('#standings-series', el)?.addEventListener('change', (e) => {
            this._standingsSeriesId = e.target.value;
            this.standings(el);
        });
    },

    /* ---------------- Stats ---------------- */
    _statsTab: 'drivers',
    _statsGameId: '',

    async stats(el) {
        const world = await DB.loadWorld();
        const tab = this._statsTab;
        const filter = this._statsGameId ? { gameId: this._statsGameId } : {};

        let body = '';
        if (tab === 'drivers') {
            const rows = Stats.driverTable(world.races, world, filter);
            body = rows.length ? `<table class="table">
                <thead><tr><th>#</th><th>Driver</th><th class="num">Starts</th><th class="num">Wins</th><th class="num">Win %</th><th class="num">Podiums</th><th class="num">Top 5</th><th class="num">Poles</th><th class="num">FL</th><th class="num">DNF</th><th class="num">Avg Fin</th><th class="num">Pts</th></tr></thead>
                <tbody>${rows.map(r => `
                    <tr onclick="Views.showDriver('${Util.attr(r.driverId)}')">
                        <td class="rank">${r.rank}</td>
                        <td>${Util.esc(r.driver.name)}</td>
                        <td class="num">${r.starts}</td>
                        <td class="num strong">${r.wins}</td>
                        <td class="num">${r.winPct.toFixed(0)}%</td>
                        <td class="num">${r.podiums}</td>
                        <td class="num">${r.top5}</td>
                        <td class="num">${r.poles}</td>
                        <td class="num">${r.fastestLaps}</td>
                        <td class="num">${r.dnfs}</td>
                        <td class="num">${r.avgFinish ? r.avgFinish.toFixed(1) : '—'}</td>
                        <td class="num strong">${r.points}</td>
                    </tr>`).join('')}</tbody></table>`
                : C.empty('📊', 'No driver stats yet', 'Stats build automatically from race results.');
        } else if (tab === 'tracks') {
            const rows = Stats.trackTable(world.races, world, filter);
            body = rows.length ? `<table class="table">
                <thead><tr><th>Track</th><th class="num">Races</th><th>Games</th><th>King of the Track</th><th class="num">Unique Winners</th></tr></thead>
                <tbody>${rows.map(t => `
                    <tr>
                        <td class="strong">${Util.esc(t.track)}</td>
                        <td class="num">${t.races}</td>
                        <td class="muted">${Util.esc(t.games.join(', ') || '—')}</td>
                        <td>${t.kingOfTrack ? `👑 ${Util.esc(t.kingOfTrack.name)} (${t.kingOfTrack.wins})` : '—'}</td>
                        <td class="num">${t.uniqueWinners}</td>
                    </tr>`).join('')}</tbody></table>`
                : C.empty('🛣', 'No track stats yet', 'Track history appears after races are completed.');
        } else {
            const rec = Stats.records(world.races, world);
            const recordCard = (icon, label, row, valueKey, suffix = '') => row
                ? `<div class="record-card"><span class="record-icon">${icon}</span><div><span class="record-value">${Util.esc(row.driver.name)}</span><span class="record-label">${Util.esc(label)} — ${valueKey === 'avgFinish' ? row.avgFinish.toFixed(1) : row[valueKey]}${suffix}</span></div></div>`
                : '';
            const any = Object.values(rec).some(Boolean);
            body = any ? `<div class="card-grid">
                ${recordCard('🏆', 'Most wins', rec.mostWins, 'wins')}
                ${recordCard('🍾', 'Most podiums', rec.mostPodiums, 'podiums')}
                ${recordCard('🅿️', 'Most poles', rec.mostPoles, 'poles')}
                ${recordCard('⚡', 'Most fastest laps', rec.mostFastestLaps, 'fastestLaps')}
                ${recordCard('💯', 'Most career points', rec.mostPoints, 'points')}
                ${recordCard('🔁', 'Most starts', rec.mostStarts, 'starts')}
                ${recordCard('🎯', 'Best avg finish (3+ races)', rec.bestAvgFinish, 'avgFinish')}
            </div>` : C.empty('🏅', 'No records yet', 'League records appear once races are completed.');
        }

        el.innerHTML = `
        <div class="view-head">
            <div><h1>Statistics</h1><p class="muted">Career numbers across every game — like a real career mode.</p></div>
        </div>
        <div class="stat-strip">
            ${C.statChip(Stats.completedRaces(world.races, filter).length, 'Races run')}
            ${C.statChip(Stats.driverTable(world.races, world, filter).length, 'Drivers scored')}
            ${C.statChip(Stats.trackTable(world.races, world, filter).length, 'Tracks raced')}
            ${(() => { const r = Stats.records(world.races, world); return C.statChip(r.mostWins ? r.mostWins.wins : 0, 'Most wins'); })()}
        </div>
        <div class="filter-bar">
            <div class="tab-row">
                <button class="tab ${tab === 'drivers' ? 'active' : ''}" data-tab="drivers">Drivers</button>
                <button class="tab ${tab === 'tracks' ? 'active' : ''}" data-tab="tracks">Tracks</button>
                <button class="tab ${tab === 'records' ? 'active' : ''}" data-tab="records">Records</button>
            </div>
            <select id="stats-game" class="input">
                <option value="">All games</option>
                ${world.games.map(g => `<option value="${Util.attr(g.id)}" ${this._statsGameId === g.id ? 'selected' : ''}>${Util.esc(g.name)}</option>`).join('')}
            </select>
        </div>
        <section class="panel">${body}</section>`;

        Util.$$('.tab', el).forEach(btn => btn.addEventListener('click', () => {
            this._statsTab = btn.dataset.tab;
            this.stats(el);
        }));
        Util.$('#stats-game', el)?.addEventListener('change', (e) => {
            this._statsGameId = e.target.value;
            this.stats(el);
        });
    },

    /* ---------------- Driver & Team detail modals ---------------- */
    async showDriver(driverId) {
        const world = await DB.loadWorld();
        const driver = world.driversById[driverId];
        if (!driver) { Util.notify('Driver not found.', 'error'); return; }
        const team = world.teamsById[driver.teamId];
        const career = Stats.driverTable(world.races, world).find(r => r.driverId === driverId);
        const history = Stats.driverHistory(driverId, world.races, world).slice(0, 10);

        Modal.open(`
            ${Modal.header(`${driver.number ? '#' + driver.number + ' ' : ''}${driver.name}`, `${team?.name || 'Free agent'}${driver.country ? ' · ' + driver.country : ''}`)}
            ${driver.bio ? `<p class="muted" style="margin-bottom:1rem">${Util.esc(driver.bio)}</p>` : ''}
            <div class="stat-strip">
                ${C.statChip(career?.starts || 0, 'Starts')}
                ${C.statChip(career?.wins || 0, 'Wins')}
                ${C.statChip(career?.podiums || 0, 'Podiums')}
                ${C.statChip(career?.poles || 0, 'Poles')}
                ${C.statChip(career?.points || 0, 'Points')}
                ${C.statChip(career?.avgFinish ? career.avgFinish.toFixed(1) : '—', 'Avg finish')}
            </div>
            ${history.length ? `
                <h3 class="section-label">Recent races</h3>
                <table class="table table-tight">
                    <thead><tr><th></th><th>Race</th><th>Game</th><th class="num">Pts</th></tr></thead>
                    <tbody>${history.map(h => `
                        <tr>
                            <td>${C.posBadge(h.result)}</td>
                            <td>${Util.esc(h.race.name || h.race.track || 'Race')}<span class="muted"> · ${Util.esc(Util.fmtDateShort(h.race.date))}</span></td>
                            <td class="muted">${Util.esc(h.game?.name || '—')}</td>
                            <td class="num strong">${h.points}</td>
                        </tr>`).join('')}</tbody>
                </table>` : '<p class="muted">No races completed yet.</p>'}
            ${Auth.isAdmin() ? `<div class="modal-actions">
                <button class="btn btn-secondary" onclick="Admin.driverForm('${Util.attr(driverId)}')">✎ Edit Driver</button>
                <button class="btn btn-danger" onclick="Admin.deleteDriver('${Util.attr(driverId)}')">Delete</button>
            </div>` : ''}
        `);
    },

    async showTeam(teamId) {
        const world = await DB.loadWorld();
        const team = world.teamsById[teamId];
        if (!team) { Util.notify('Team not found.', 'error'); return; }
        const roster = world.drivers.filter(d => d.teamId === teamId);
        const teamRow = Stats.teamTable(world.races, world).find(t => t.teamId === teamId);

        Modal.open(`
            ${Modal.header(team.name, team.headquarters || '')}
            <div class="team-modal-top">
                ${C.logoBox(team, 'logo-lg')}
                <div class="chip-row">
                    ${team.recruiting ? '<span class="badge badge-green">Recruiting drivers</span>' : ''}
                    ${team.isEstablished ? '<span class="badge badge-blue">Established team</span>' : ''}
                </div>
            </div>
            ${team.description ? `<p class="muted" style="margin:0.75rem 0">${Util.esc(team.description)}</p>` : ''}
            <div class="stat-strip">
                ${C.statChip(roster.length, 'Drivers')}
                ${C.statChip(teamRow?.points || 0, 'Points')}
                ${C.statChip(teamRow?.wins || 0, 'Wins')}
                ${C.statChip(teamRow?.podiums || 0, 'Podiums')}
            </div>
            ${roster.length ? `
                <h3 class="section-label">Roster</h3>
                <div class="chip-row">${roster.map(d => `<button class="chip chip-btn" onclick="Views.showDriver('${Util.attr(d.id)}')">${d.number ? '#' + Util.esc(String(d.number)) + ' ' : ''}${Util.esc(d.name)}</button>`).join('')}</div>`
                : '<p class="muted">No drivers on this team yet.</p>'}
            ${Auth.isAdmin() ? `<div class="modal-actions">
                <button class="btn btn-secondary" onclick="Admin.teamForm('${Util.attr(teamId)}')">✎ Edit Team</button>
                <button class="btn btn-danger" onclick="Admin.deleteTeam('${Util.attr(teamId)}')">Delete</button>
            </div>` : ''}
        `);
    }
};
window.Views = Views;
