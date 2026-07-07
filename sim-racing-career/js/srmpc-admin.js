/* ============================================================
   Phoenix SRMPC — Admin Console (Game Master)
   Games, series (+ logo, + one-click schedule builder), races,
   results entry, teams, drivers, players, challenges, settings.
   ============================================================ */
'use strict';

const Admin = {
    _tab: 'overview',

    guard() {
        if (!Auth.isAdmin()) {
            Util.notify('Game Master access required.', 'error');
            return false;
        }
        return true;
    },

    async render(el, tab) {
        if (!Auth.isAdmin()) {
            el.innerHTML = C.empty('🔒', 'Game Master only', 'This console requires the admin passcode.');
            return;
        }
        if (tab) this._tab = tab;
        const t = this._tab;

        const tabs = [
            ['overview', '🎛 Overview'], ['games', '🎮 Games'], ['series', '🏆 Series'],
            ['races', '🏁 Races'], ['teams', '🛠 Teams'], ['drivers', '🏎 Drivers'],
            ['players', '👥 Players'], ['challenges', '🎯 Challenges'], ['settings', '⚙ Settings']
        ];

        el.innerHTML = `
        <div class="view-head">
            <div><h1>Admin Console</h1><p class="muted">Full league control. Everything here is live for your players.</p></div>
        </div>
        ${Auth.state.adminLocalOnly ? `<div class="warn-banner">⚠ Firebase anonymous sign-in is disabled, so admin saves will be rejected. Enable it in <strong>Firebase Console → Authentication → Sign-in method → Anonymous</strong>, then sign out and unlock again.</div>` : ''}
        <div class="tab-row tab-row-wrap">
            ${tabs.map(([id, label]) => `<button class="tab ${t === id ? 'active' : ''}" data-admin-tab="${id}">${label}</button>`).join('')}
        </div>
        <div id="admin-body"><div class="loading">Loading…</div></div>`;

        Util.$$('[data-admin-tab]', el).forEach(btn => btn.addEventListener('click', () => {
            this._tab = btn.dataset.adminTab;
            this.render(el);
        }));

        const body = Util.$('#admin-body', el);
        try {
            await this['tab_' + t](body);
        } catch (e) {
            console.error(e);
            body.innerHTML = C.empty('⚠️', 'Could not load this section', e.message);
        }
    },

    refresh() {
        const el = document.getElementById('view-root');
        if (el && App.current.view === 'admin') this.render(el);
    },

    /* ---------------- Overview ---------------- */
    async tab_overview(el) {
        const world = await DB.loadWorld(true);
        let claims = [], users = [];
        try { [claims, users] = await Promise.all([DB.claims({ force: true }), DB.users({ force: true })]); } catch (e) { /* */ }
        const pendingClaims = claims.filter(c => c.status === 'pending');
        const proposedSeries = world.series.filter(s => s.status === 'proposed');
        const unresulted = world.races.filter(r => r.status !== 'completed' && Util.isPast(r.date));

        el.innerHTML = `
        <div class="stat-strip">
            ${C.statChip(world.games.length, 'Games')}
            ${C.statChip(world.series.length, 'Series')}
            ${C.statChip(world.races.length, 'Races')}
            ${C.statChip(world.teams.length, 'Teams')}
            ${C.statChip(world.drivers.length, 'Drivers')}
            ${C.statChip(users.length, 'Player accounts')}
        </div>

        <div class="grid-2">
            <section class="panel">
                <div class="panel-head"><h2>⚡ Quick Actions</h2></div>
                <div class="quick-grid">
                    <button class="btn btn-secondary" onclick="Admin.gameForm()">🎮 Add Game</button>
                    <button class="btn btn-secondary" onclick="Admin.seriesForm()">🏆 New Series</button>
                    <button class="btn btn-secondary" onclick="Admin.scheduleBuilder()">📅 Schedule Builder</button>
                    <button class="btn btn-secondary" onclick="Admin.raceForm()">🏁 Add Race</button>
                    <button class="btn btn-secondary" onclick="Admin.teamForm()">🛠 Add Team</button>
                    <button class="btn btn-secondary" onclick="Admin.driverForm()">🏎 Add Driver</button>
                    <button class="btn btn-secondary" onclick="Admin.generateChallengesForm()">🎯 Generate Challenges</button>
                    <button class="btn btn-secondary" onclick="Admin.challengeForm()">＋ Custom Challenge</button>
                    <button class="btn btn-secondary" onclick="Admin.generateNPCsForm()">🤖 Generate Free Agents</button>
                </div>
            </section>

            <section class="panel">
                <div class="panel-head"><h2>📥 Needs Your Attention</h2></div>
                ${(!unresulted.length && !pendingClaims.length && !proposedSeries.length)
                    ? '<p class="muted">All clear — nothing waiting on you. 🎉</p>' : ''}
                ${unresulted.map(r => `
                    <div class="race-row">
                        <div class="race-row-main"><span class="race-title">Enter results: ${Util.esc(r.name || r.track || 'Race')}</span>
                        <span class="race-sub">Raced ${Util.esc(Util.fmtDateShort(r.date))}</span></div>
                        <button class="btn btn-primary btn-sm" onclick="Admin.resultsForm('${Util.attr(r.id)}')">Enter results</button>
                    </div>`).join('')}
                ${pendingClaims.length ? `
                    <div class="race-row">
                        <div class="race-row-main"><span class="race-title">${Util.plural(pendingClaims.length, 'challenge claim')} awaiting review</span></div>
                        <button class="btn btn-primary btn-sm" data-admin-goto="challenges">Review</button>
                    </div>` : ''}
                ${proposedSeries.map(s => `
                    <div class="race-row">
                        <div class="race-row-main"><span class="race-title">Series proposal: ${Util.esc(s.name)}</span>
                        <span class="race-sub">${Util.esc(s.description || '')}</span></div>
                        <div class="btn-row">
                            <button class="btn btn-primary btn-sm" onclick="Admin.approveSeries('${Util.attr(s.id)}')">Approve</button>
                            <button class="btn btn-danger btn-sm" onclick="Admin.deleteSeries('${Util.attr(s.id)}')">Reject</button>
                        </div>
                    </div>`).join('')}
            </section>
        </div>`;

        Util.$('[data-admin-goto]', el)?.addEventListener('click', (e) => {
            this._tab = e.target.dataset.adminGoto;
            this.render(document.getElementById('view-root'));
        });
    },

    /* ---------------- Games ---------------- */
    async tab_games(el) {
        const world = await DB.loadWorld(true);
        el.innerHTML = `
        <section class="panel">
            <div class="panel-head"><h2>🎮 Games (${world.games.length})</h2>
                <button class="btn btn-primary btn-sm" onclick="Admin.gameForm()">＋ Add Game</button></div>
            ${world.games.length ? `<table class="table">
                <thead><tr><th>Game</th><th>Platform</th><th class="num">Series</th><th class="num">Races</th><th></th></tr></thead>
                <tbody>${world.games.map(g => `
                    <tr>
                        <td><span class="team-dot" style="background:${Util.esc(g.color || '#666')}"></span><span class="strong">${Util.esc(g.name)}</span></td>
                        <td class="muted">${Util.esc(g.platform || '—')}</td>
                        <td class="num">${world.series.filter(s => s.gameId === g.id).length}</td>
                        <td class="num">${world.races.filter(r => r.gameId === g.id).length}</td>
                        <td class="row-actions">
                            <button class="btn btn-ghost btn-sm" onclick="Admin.gameForm('${Util.attr(g.id)}')">Edit</button>
                            <button class="btn btn-danger btn-sm" onclick="Admin.deleteGame('${Util.attr(g.id)}')">Delete</button>
                        </td>
                    </tr>`).join('')}</tbody></table>`
            : C.empty('🎮', 'No games yet', 'Add the sims your league races — F1, iRacing, Gran Turismo, Forza, anything.',
                `<button class="btn btn-primary" onclick="Admin.gameForm()">Add your first game</button>`)}
        </section>`;
    },

    async gameForm(gameId = null) {
        if (!this.guard()) return;
        const game = gameId ? await DB.get('games', gameId) : null;
        Modal.open(`
            ${Modal.header(game ? 'Edit Game' : 'Add Game', 'A game is any sim your league races in')}
            <form id="game-form" class="form-grid">
                <label class="field"><span>Game name *</span><input id="gf-name" class="input" required value="${Util.esc(game?.name || '')}" maxlength="60" placeholder="e.g. F1 25, iRacing, GT7"></label>
                <div class="form-row">
                    <label class="field"><span>Platform</span><input id="gf-platform" class="input" value="${Util.esc(game?.platform || '')}" maxlength="40" placeholder="PC / PS5 / Xbox / Cross-play"></label>
                    <label class="field"><span>Accent color</span><input id="gf-color" class="input input-color" type="color" value="${Util.esc(game?.color || '#29d1a5')}"></label>
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">${game ? 'Save' : 'Add Game'}</button>
                </div>
            </form>
        `);
        Util.$('#game-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const data = {
                    name: Util.$('#gf-name').value.trim(),
                    platform: Util.$('#gf-platform').value.trim(),
                    color: Util.$('#gf-color').value
                };
                if (!data.name) throw new Error('Game name is required.');
                if (game) await DB.update('games', game.id, data);
                else await DB.create('games', { ...data, active: true });
                Modal.close();
                Util.notify(game ? 'Game updated.' : 'Game added. 🎮');
                this.refresh();
            } catch (err) { Util.notify(err.message, 'error'); }
        });
    },

    async deleteGame(gameId) {
        if (!this.guard()) return;
        const world = await DB.loadWorld();
        const used = world.series.filter(s => s.gameId === gameId).length + world.races.filter(r => r.gameId === gameId).length;
        if (!confirm(used ? `This game is used by ${used} series/races — they will keep working but show no game. Delete anyway?` : 'Delete this game?')) return;
        try {
            await DB.remove('games', gameId);
            Util.notify('Game deleted.');
            Modal.close();
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    /* ---------------- Series ---------------- */
    async tab_series(el) {
        const world = await DB.loadWorld(true);
        el.innerHTML = `
        <section class="panel">
            <div class="panel-head"><h2>🏆 Series (${world.series.length})</h2>
                <div class="btn-row">
                    <button class="btn btn-secondary btn-sm" onclick="Admin.scheduleBuilder()">📅 Schedule Builder</button>
                    <button class="btn btn-primary btn-sm" onclick="Admin.seriesForm()">＋ New Series</button>
                </div></div>
            ${world.series.length ? `<table class="table">
                <thead><tr><th>Series</th><th>Game</th><th>Season</th><th>Status</th><th class="num">Races</th><th></th></tr></thead>
                <tbody>${world.series.map(s => `
                    <tr>
                        <td><div class="cell-flex">${C.logoBox(s)}<span class="strong">${Util.esc(s.name)}</span></div></td>
                        <td class="muted">${Util.esc(world.gamesById[s.gameId]?.name || '—')}</td>
                        <td class="muted">${Util.esc(String(s.season || '—'))}</td>
                        <td>${C.statusBadge(s.status || 'active')}</td>
                        <td class="num">${world.races.filter(r => r.seriesId === s.id).length}</td>
                        <td class="row-actions">
                            ${s.status === 'proposed' ? `<button class="btn btn-primary btn-sm" onclick="Admin.approveSeries('${Util.attr(s.id)}')">Approve</button>` : ''}
                            <button class="btn btn-ghost btn-sm" onclick="App.go('series-detail','${Util.attr(s.id)}')">View</button>
                            <button class="btn btn-ghost btn-sm" onclick="Admin.seriesForm('${Util.attr(s.id)}')">Edit</button>
                            <button class="btn btn-ghost btn-sm" onclick="Admin.scheduleBuilder('${Util.attr(s.id)}')">Schedule</button>
                            <button class="btn btn-ghost btn-sm" onclick="Admin.seasonsModal('${Util.attr(s.id)}')">Seasons</button>
                            <button class="btn btn-danger btn-sm" onclick="Admin.deleteSeries('${Util.attr(s.id)}')">Delete</button>
                        </td>
                    </tr>`).join('')}</tbody></table>`
            : C.empty('🏆', 'No series yet', 'A series is a championship: pick a game, a points system, upload a logo, then build the schedule.',
                `<button class="btn btn-primary" onclick="Admin.seriesForm()">Create your first series</button>`)}
        </section>`;
    },

    /* ---------------- Seasons ---------------- */
    async seasonsModal(seriesId) {
        if (!this.guard()) return;
        const [series, seasons, world] = await Promise.all([
            DB.get('series', seriesId),
            DB.seasons({ force: true }),
            DB.loadWorld(true)
        ]);
        if (!series) { Util.notify('Series not found.', 'error'); return; }
        const mine = seasons.filter(s => s.seriesId === seriesId)
            .sort((a, b) => (b.year || 0) - (a.year || 0) || (b.startDate || '').localeCompare(a.startDate || ''));

        const rows = mine.map(se => {
            const raceCount = world.races.filter(r => r.seasonId === se.id).length;
            const champ = se.championDriverId ? (world.driversById[se.championDriverId]?.name || '—') : null;
            return `<div class="race-row">
                <div class="race-row-main">
                    <span class="race-title">${Util.esc(se.name)} ${C.statusBadge(se.status || 'active')}</span>
                    <span class="race-sub">${Util.plural(raceCount, 'race')}${champ ? ` · 🏆 ${Util.esc(champ)}` : ''}</span>
                </div>
                <div class="row-actions">
                    ${se.status === 'completed'
                        ? `<button class="btn btn-ghost btn-sm" onclick="Admin.reopenSeason('${Util.attr(se.id)}','${Util.attr(seriesId)}')">Reopen</button>`
                        : `<button class="btn btn-primary btn-sm" onclick="Admin.closeSeason('${Util.attr(se.id)}','${Util.attr(seriesId)}')">Close &amp; crown</button>`}
                    <button class="btn btn-ghost btn-sm" onclick="Admin.seasonForm('${Util.attr(seriesId)}','${Util.attr(se.id)}')">Edit</button>
                    <button class="btn btn-danger btn-sm" onclick="Admin.deleteSeason('${Util.attr(se.id)}','${Util.attr(seriesId)}')">Delete</button>
                </div>
            </div>`;
        }).join('');

        Modal.open(`
            ${Modal.header(`📆 Seasons — ${Util.esc(series.name)}`, 'Each season is a dated edition with its own calendar and champion.')}
            ${mine.length ? `<div class="stack" style="gap:.2rem">${rows}</div>` : C.empty('📆', 'No seasons yet', 'Create a season, then build its schedule to assign races to it.')}
            <div class="modal-actions">
                <button type="button" class="btn btn-ghost" onclick="Modal.close()">Close</button>
                <button type="button" class="btn btn-primary" onclick="Admin.seasonForm('${Util.attr(seriesId)}')">＋ New Season</button>
            </div>
        `, { wide: true });
    },

    async seasonForm(seriesId, seasonId = null) {
        if (!this.guard()) return;
        const [series, season] = await Promise.all([
            DB.get('series', seriesId),
            seasonId ? DB.get('seasons', seasonId) : null
        ]);
        const yr = season?.year || new Date().getFullYear();
        Modal.open(`
            ${Modal.header(season ? 'Edit Season' : 'New Season')}
            <form id="season-form" class="form-grid">
                <label class="field"><span>Season name *</span><input id="se-name" class="input" required value="${Util.esc(season?.name || `${series?.name || 'Season'} ${yr}`)}" maxlength="60"></label>
                <div class="form-row">
                    <label class="field"><span>Year</span><input id="se-year" class="input" type="number" value="${yr}"></label>
                    <label class="field"><span>Status</span>
                        <select id="se-status" class="input">
                            <option value="upcoming" ${season?.status === 'upcoming' ? 'selected' : ''}>Upcoming</option>
                            <option value="active" ${(season?.status || 'active') === 'active' ? 'selected' : ''}>Active</option>
                            <option value="completed" ${season?.status === 'completed' ? 'selected' : ''}>Completed</option>
                        </select></label>
                </div>
                <div class="form-row">
                    <label class="field"><span>Start date</span><input id="se-start" class="input" type="date" value="${Util.esc(season?.startDate || '')}"></label>
                    <label class="field"><span>End date</span><input id="se-end" class="input" type="date" value="${Util.esc(season?.endDate || '')}"></label>
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Admin.seasonsModal('${Util.attr(seriesId)}')">Back</button>
                    <button type="submit" class="btn btn-primary">${season ? 'Save' : 'Create Season'}</button>
                </div>
            </form>
        `);
        Util.$('#season-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const data = {
                    seriesId,
                    gameId: series?.gameId || null,
                    name: Util.$('#se-name').value.trim(),
                    year: Util.$('#se-year').value ? Number(Util.$('#se-year').value) : null,
                    status: Util.$('#se-status').value,
                    startDate: Util.$('#se-start').value || null,
                    endDate: Util.$('#se-end').value || null
                };
                if (!data.name) throw new Error('Season name is required.');
                if (season) await DB.update('seasons', season.id, data);
                else await DB.create('seasons', { ...data, ownerUid: Auth.uid(), championDriverId: null, championTeamId: null });
                Util.notify(season ? 'Season saved.' : 'Season created. 📆');
                this.seasonsModal(seriesId);
            } catch (err) { Util.notify(err.message, 'error'); }
        });
    },

    async closeSeason(seasonId, seriesId) {
        if (!this.guard()) return;
        try {
            const world = await DB.loadWorld(true);
            const snapshot = Stats.crownSeason(world.races, world, seasonId);
            if (!snapshot.championDriverId) {
                if (!confirm('No completed races are assigned to this season yet, so there is no champion to crown. Close it anyway?')) return;
            }
            await DB.update('seasons', seasonId, { ...snapshot, status: 'completed' });
            const champ = snapshot.championDriverId ? (world.driversById[snapshot.championDriverId]?.name || 'Champion') : null;
            Util.notify(champ ? `Season closed — 🏆 ${champ} is your champion!` : 'Season closed.');
            this.seasonsModal(seriesId);
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    async reopenSeason(seasonId, seriesId) {
        if (!this.guard()) return;
        try {
            await DB.update('seasons', seasonId, { status: 'active', championDriverId: null, championTeamId: null, standingsArchive: [], teamArchive: [] });
            Util.notify('Season reopened — standings are live again.');
            this.seasonsModal(seriesId);
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    async deleteSeason(seasonId, seriesId) {
        if (!this.guard()) return;
        if (!confirm('Delete this season? Races assigned to it are kept but become unassigned.')) return;
        try {
            const races = await DB.races({ force: true });
            for (const r of races.filter(r => r.seasonId === seasonId)) {
                await DB.update('races', r.id, { seasonId: null });
            }
            await DB.remove('seasons', seasonId);
            Util.notify('Season deleted.');
            this.seasonsModal(seriesId);
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    async seriesForm(seriesId = null) {
        if (!this.guard()) return;
        const [series, games] = await Promise.all([seriesId ? DB.get('series', seriesId) : null, DB.games()]);
        const sys = series?.pointsSystem || 'f1';
        Modal.open(`
            ${Modal.header(series ? 'Edit Series' : 'Create Series', 'A championship with its own logo, schedule, and points')}
            <form id="series-form" class="form-grid">
                <label class="field"><span>Series name *</span><input id="sf-name" class="input" required value="${Util.esc(series?.name || '')}" maxlength="60" placeholder="e.g. Phoenix GT Championship"></label>
                <div class="form-row">
                    <label class="field"><span>Game</span>
                        <select id="sf-game" class="input">
                            <option value="">— No game —</option>
                            ${games.map(g => `<option value="${Util.attr(g.id)}" ${series?.gameId === g.id ? 'selected' : ''}>${Util.esc(g.name)}</option>`).join('')}
                        </select></label>
                    <label class="field"><span>Season / year</span><input id="sf-season" class="input" type="number" value="${series?.season || new Date().getFullYear()}"></label>
                </div>
                <div class="form-row">
                    <label class="field"><span>Points system</span>
                        <select id="sf-points" class="input">
                            ${Object.entries(POINTS_SYSTEMS).map(([id, s]) => `<option value="${id}" ${sys === id ? 'selected' : ''}>${Util.esc(s.label)}</option>`).join('')}
                        </select></label>
                    <label class="field"><span>Status</span>
                        <select id="sf-status" class="input">
                            <option value="active" ${(series?.status || 'active') === 'active' ? 'selected' : ''}>Active</option>
                            <option value="finished" ${series?.status === 'finished' ? 'selected' : ''}>Finished</option>
                        </select></label>
                </div>
                <label class="field" id="sf-custom-wrap" style="display:${sys === 'custom' ? '' : 'none'}"><span>Custom points (comma separated, P1 first)</span>
                    <input id="sf-custom" class="input" value="${Util.esc((series?.customPoints || []).join(', '))}" placeholder="e.g. 30, 25, 20, 16, 12, 10, 8, 6, 4, 2"></label>
                <label class="field"><span>Series logo ${series?.logo ? '(current logo kept unless you choose a new one)' : '(optional)'}</span>
                    <input id="sf-logo" class="input" type="file" accept="image/*"></label>
                <label class="field"><span>Description</span><textarea id="sf-desc" class="input" rows="2" maxlength="400">${Util.esc(series?.description || '')}</textarea></label>
                <div class="modal-actions">
                    ${series?.logo ? `<button type="button" class="btn btn-ghost" id="sf-remove-logo">Remove logo</button>` : ''}
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">${series ? 'Save' : 'Create Series'}</button>
                </div>
            </form>
        `, { wide: true });

        let removeLogo = false;
        Util.$('#sf-points').addEventListener('change', (e) => {
            Util.$('#sf-custom-wrap').style.display = e.target.value === 'custom' ? '' : 'none';
        });
        Util.$('#sf-remove-logo')?.addEventListener('click', (e) => {
            removeLogo = true;
            e.target.textContent = 'Logo will be removed';
            e.target.disabled = true;
        });
        Util.$('#series-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type=submit]');
            btn.disabled = true;
            try {
                const data = {
                    name: Util.$('#sf-name').value.trim(),
                    gameId: Util.$('#sf-game').value || null,
                    season: Number(Util.$('#sf-season').value) || new Date().getFullYear(),
                    pointsSystem: Util.$('#sf-points').value,
                    status: Util.$('#sf-status').value,
                    description: Util.$('#sf-desc').value.trim()
                };
                if (!data.name) throw new Error('Series name is required.');
                if (data.pointsSystem === 'custom') {
                    data.customPoints = Util.$('#sf-custom').value.split(',').map(v => Number(v.trim())).filter(v => !Number.isNaN(v));
                    if (!data.customPoints.length) throw new Error('Enter at least one custom points value.');
                }
                const file = Util.$('#sf-logo').files[0];
                if (file) data.logo = await Util.compressImage(file);
                else if (removeLogo) data.logo = null;

                let id = series?.id;
                if (series) await DB.update('series', series.id, data);
                else id = await DB.create('series', data);
                Modal.close();
                Util.notify(series ? 'Series updated.' : 'Series created! Now build its schedule. 🏆');
                if (!series) this.scheduleBuilder(id);
                else this.refresh();
            } catch (err) {
                Util.notify(err.message, 'error');
                btn.disabled = false;
            }
        });
    },

    async approveSeries(seriesId) {
        if (!this.guard()) return;
        try {
            await DB.update('series', seriesId, { status: 'active' });
            Util.notify('Series approved and live. 🏆');
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    async deleteSeries(seriesId) {
        if (!this.guard()) return;
        const world = await DB.loadWorld();
        const races = world.races.filter(r => r.seriesId === seriesId);
        if (!confirm(races.length
            ? `Delete this series AND its ${races.length} races (results included)? This cannot be undone.`
            : 'Delete this series?')) return;
        try {
            for (const r of races) await DB.remove('races', r.id);
            await DB.remove('series', seriesId);
            Util.notify('Series deleted.');
            Modal.close();
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    /* ---------------- Schedule builder ---------------- */
    async scheduleBuilder(seriesId = null) {
        if (!this.guard()) return;
        const [series, seasons] = await Promise.all([DB.series(), DB.seasons({ force: true })]);
        const editable = series.filter(s => (s.status || 'active') === 'active');
        if (!editable.length) {
            Util.notify('Create a series first — the builder generates its schedule.', 'info');
            this.seriesForm();
            return;
        }
        const initialSid = seriesId && editable.find(s => s.id === seriesId) ? seriesId : editable[0].id;
        const seasonOptions = (sid) => {
            const list = seasons.filter(se => se.seriesId === sid && se.status !== 'completed')
                .sort((a, b) => (b.year || 0) - (a.year || 0));
            return `<option value="__new__">＋ New season for this series</option>
                <option value="">— No season (unassigned) —</option>
                ${list.map(se => `<option value="${Util.attr(se.id)}">${Util.esc(se.name)}</option>`).join('')}`;
        };
        Modal.open(`
            ${Modal.header('📅 Schedule Builder', 'Type your tracks, pick a cadence — get a full season in one click')}
            <form id="sched-form" class="form-grid">
                <div class="form-row">
                    <label class="field"><span>Series *</span>
                        <select id="sb-series" class="input">
                            ${editable.map(s => `<option value="${Util.attr(s.id)}" ${initialSid === s.id ? 'selected' : ''}>${Util.esc(s.name)}</option>`).join('')}
                        </select></label>
                    <label class="field"><span>Season</span>
                        <select id="sb-season" class="input">${seasonOptions(initialSid)}</select></label>
                </div>
                <div class="form-row">
                    <label class="field"><span>First race date *</span><input id="sb-start" class="input" type="date" required value="${Util.todayISO()}"></label>
                    <label class="field"><span>Race time</span><input id="sb-time" class="input" type="time" value="20:00"></label>
                </div>
                <div class="form-row">
                    <label class="field"><span>Cadence</span>
                        <select id="sb-cadence" class="input">
                            <option value="weekly">Weekly</option>
                            <option value="biweekly">Every 2 weeks</option>
                            <option value="monthly">Monthly</option>
                        </select></label>
                    <label class="field"><span>Laps (optional)</span><input id="sb-laps" class="input" type="number" min="1" placeholder="e.g. 25"></label>
                </div>
                <label class="field"><span>Tracks — one per line, in order *</span>
                    <textarea id="sb-tracks" class="input" rows="8" placeholder="Silverstone&#10;Spa-Francorchamps&#10;Monza&#10;Suzuka&#10;Interlagos" required></textarea></label>
                <p class="muted small" id="sb-preview">Each line becomes a round, spaced by your cadence.</p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Generate Schedule 🏁</button>
                </div>
            </form>
        `, { wide: true });

        const preview = () => {
            const n = Util.$('#sb-tracks').value.split('\n').map(t => t.trim()).filter(Boolean).length;
            Util.$('#sb-preview').textContent = n
                ? `Will create ${Util.plural(n, 'race')}, starting ${Util.fmtDate(Util.$('#sb-start').value)} (${Util.$('#sb-cadence').value}).`
                : 'Each line becomes a round, spaced by your cadence.';
        };
        ['sb-tracks', 'sb-start', 'sb-cadence'].forEach(id => Util.$('#' + id).addEventListener('input', preview));

        // Keep the season dropdown in sync with the chosen series.
        Util.$('#sb-series').addEventListener('change', (e) => {
            Util.$('#sb-season').innerHTML = seasonOptions(e.target.value);
        });

        Util.$('#sched-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type=submit]');
            btn.disabled = true;
            btn.textContent = 'Creating…';
            try {
                const sid = Util.$('#sb-series').value;
                const s = editable.find(x => x.id === sid);

                // Resolve the season: create a new one, use an existing one, or none.
                let seasonId = Util.$('#sb-season').value;
                if (seasonId === '__new__') {
                    const yr = Util.parseISODate(Util.$('#sb-start').value)?.getFullYear() || new Date().getFullYear();
                    const name = (prompt('Name this season:', `${s.name} ${yr}`) || '').trim();
                    if (!name) { btn.disabled = false; btn.textContent = 'Generate Schedule 🏁'; return; }
                    seasonId = await DB.create('seasons', {
                        seriesId: sid, gameId: s.gameId || null, name, year: yr,
                        status: 'active', startDate: Util.$('#sb-start').value || null, endDate: null,
                        ownerUid: Auth.uid(), championDriverId: null, championTeamId: null
                    });
                } else if (!seasonId) {
                    seasonId = null;
                }

                // Idempotency: if this series+season already has a calendar, ask whether
                // to append or replace — never silently duplicate the whole season.
                const allRaces = await DB.races({ force: true });
                const existing = allRaces.filter(r => r.seriesId === sid && (r.seasonId || null) === seasonId);
                let startRound = 1;
                if (existing.length) {
                    const choice = confirm(
                        `${s.name} already has ${Util.plural(existing.length, 'race')} in this season.\n\n` +
                        `OK = APPEND the new rounds after the existing ones.\n` +
                        `Cancel = REPLACE this season's schedule (deletes the current ${existing.length}).`
                    );
                    if (choice) {
                        startRound = existing.reduce((m, r) => Math.max(m, Number(r.round) || 0), 0) + 1;
                    } else {
                        for (const r of existing) await DB.remove('races', r.id);
                    }
                }

                const races = generateScheduleRaces({
                    series: s,
                    seasonId,
                    cadence: Util.$('#sb-cadence').value,
                    startDate: Util.$('#sb-start').value,
                    time: Util.$('#sb-time').value,
                    laps: Util.$('#sb-laps').value ? Number(Util.$('#sb-laps').value) : null,
                    tracks: Util.$('#sb-tracks').value.split('\n'),
                    startRound
                });
                await DB.batchCreate('races', races);
                Modal.close();
                Util.notify(`Schedule created — ${Util.plural(races.length, 'race')} added to ${s.name}. 📅`);
                App.go('series-detail', sid);
            } catch (err) {
                Util.notify(err.message, 'error');
                btn.disabled = false;
                btn.textContent = 'Generate Schedule 🏁';
            }
        });
    },

    /* ---------------- Races ---------------- */
    async tab_races(el) {
        const world = await DB.loadWorld(true);
        const races = world.races.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        el.innerHTML = `
        <section class="panel">
            <div class="panel-head"><h2>🏁 Races (${races.length})</h2>
                <button class="btn btn-primary btn-sm" onclick="Admin.raceForm()">＋ Add Race</button></div>
            ${races.length ? `<table class="table">
                <thead><tr><th>Date</th><th>Race</th><th>Series</th><th>Status</th><th></th></tr></thead>
                <tbody>${races.map(r => `
                    <tr>
                        <td class="muted">${Util.esc(Util.fmtDateShort(r.date))}</td>
                        <td><span class="strong">${Util.esc(r.name || r.track || 'Race')}</span><span class="muted"> · ${Util.esc(r.track || '')}</span></td>
                        <td class="muted">${Util.esc(world.seriesById[r.seriesId]?.name || '—')}</td>
                        <td>${C.statusBadge(r.status)}</td>
                        <td class="row-actions">
                            ${r.status !== 'completed' ? `<button class="btn btn-ghost btn-sm" onclick="Admin.toggleLive('${Util.attr(r.id)}')">${r.status === 'live' ? '⏹ End live' : '🔴 Go live'}</button>` : ''}
                            <button class="btn ${r.status === 'completed' ? 'btn-ghost' : 'btn-primary'} btn-sm" onclick="Admin.resultsForm('${Util.attr(r.id)}')">${r.status === 'completed' ? 'Edit results' : 'Enter results'}</button>
                            <button class="btn btn-ghost btn-sm" onclick="Admin.raceForm('${Util.attr(r.id)}')">Edit</button>
                            <button class="btn btn-danger btn-sm" onclick="Admin.deleteRace('${Util.attr(r.id)}')">Delete</button>
                        </td>
                    </tr>`).join('')}</tbody></table>`
            : C.empty('🏁', 'No races yet', 'Add races one at a time here, or generate a whole season with the Schedule Builder.',
                `<button class="btn btn-primary" onclick="Admin.scheduleBuilder()">Open Schedule Builder</button>`)}
        </section>`;
    },

    async raceForm(raceId = null, presetSeriesId = null) {
        if (!this.guard()) return;
        const [race, series, games, allRaces, seasons] = await Promise.all([
            raceId ? DB.get('races', raceId) : null, DB.series(), DB.games(), DB.races(), DB.seasons()
        ]);
        const seasonOptionsFor = (sid, selId) => {
            const list = seasons.filter(se => se.seriesId === sid);
            return `<option value="">— No season —</option>${list.map(se =>
                `<option value="${Util.attr(se.id)}" ${selId === se.id ? 'selected' : ''}>${Util.esc(se.name)}</option>`).join('')}`;
        };
        Modal.open(`
            ${Modal.header(race ? 'Edit Race' : 'Add Race')}
            <form id="race-form" class="form-grid">
                <label class="field"><span>Race name</span><input id="rf-name" class="input" value="${Util.esc(race?.name || '')}" maxlength="80" placeholder="Leave blank to use the track name"></label>
                <div class="form-row">
                    <label class="field"><span>Track *</span><input id="rf-track" class="input" required value="${Util.esc(race?.track || '')}" maxlength="60" placeholder="e.g. Watkins Glen"></label>
                    <label class="field"><span>Laps</span><input id="rf-laps" class="input" type="number" min="1" value="${race?.laps || ''}"></label>
                </div>
                <div class="form-row">
                    <label class="field"><span>Date *</span><input id="rf-date" class="input" type="date" required value="${Util.esc(race?.date || Util.todayISO())}"></label>
                    <label class="field"><span>Time</span><input id="rf-time" class="input" type="time" value="${Util.esc(race?.time || '20:00')}"></label>
                    <label class="field"><span>Round</span><input id="rf-round" class="input" type="number" min="1" value="${race?.round || ''}" placeholder="Auto"></label>
                </div>
                <div class="form-row">
                    <label class="field"><span>Series</span>
                        <select id="rf-series" class="input">
                            <option value="">— Standalone race —</option>
                            ${series.map(s => `<option value="${Util.attr(s.id)}" ${(race?.seriesId || presetSeriesId) === s.id ? 'selected' : ''}>${Util.esc(s.name)}</option>`).join('')}
                        </select></label>
                    <label class="field"><span>Game</span>
                        <select id="rf-game" class="input">
                            <option value="">—</option>
                            ${games.map(g => `<option value="${Util.attr(g.id)}" ${race?.gameId === g.id ? 'selected' : ''}>${Util.esc(g.name)}</option>`).join('')}
                        </select></label>
                    <label class="field"><span>Season</span>
                        <select id="rf-season" class="input">${seasonOptionsFor(race?.seriesId || presetSeriesId || '', race?.seasonId)}</select></label>
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">${race ? 'Save' : 'Add Race'}</button>
                </div>
            </form>
        `);
        // Repopulate seasons when the series changes.
        Util.$('#rf-series').addEventListener('change', (e) => {
            Util.$('#rf-season').innerHTML = seasonOptionsFor(e.target.value, null);
        });
        Util.$('#race-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const seriesId = Util.$('#rf-series').value || null;
                const linkedSeries = series.find(s => s.id === seriesId);

                // Round: use the entered value, otherwise auto-assign the next round
                // for this series (so manually added races sort correctly instead of
                // falling to the bottom with no round).
                let round = Util.$('#rf-round').value ? Number(Util.$('#rf-round').value) : null;
                if (!round && seriesId) {
                    const maxRound = allRaces
                        .filter(r => r.seriesId === seriesId && r.id !== raceId)
                        .reduce((m, r) => Math.max(m, Number(r.round) || 0), 0);
                    round = maxRound + 1;
                }

                const data = {
                    name: Util.$('#rf-name').value.trim() || Util.$('#rf-track').value.trim(),
                    track: Util.$('#rf-track').value.trim(),
                    laps: Util.$('#rf-laps').value ? Number(Util.$('#rf-laps').value) : null,
                    date: Util.$('#rf-date').value,
                    time: Util.$('#rf-time').value,
                    round: round || null,
                    seriesId,
                    seasonId: Util.$('#rf-season').value || null,
                    gameId: Util.$('#rf-game').value || linkedSeries?.gameId || null
                };
                if (!data.track) throw new Error('Track is required.');
                if (!data.date) throw new Error('Date is required.');
                if (race) await DB.update('races', race.id, data);
                else await DB.create('races', { ...data, status: 'scheduled', results: [] });
                Modal.close();
                Util.notify(race ? 'Race updated.' : 'Race added to the calendar. 🏁');
                this.refresh();
                if (App.current.view !== 'admin') App.go(App.current.view, App.current.param);
            } catch (err) { Util.notify(err.message, 'error'); }
        });
    },

    async toggleLive(raceId) {
        if (!this.guard()) return;
        try {
            const race = await DB.get('races', raceId);
            if (!race) throw new Error('Race not found.');
            const next = race.status === 'live' ? 'scheduled' : 'live';
            await DB.update('races', raceId, { status: next });
            Util.notify(next === 'live' ? 'Race is now LIVE. 🔴' : 'Race set back to scheduled.');
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    async deleteRace(raceId) {
        if (!this.guard()) return;
        if (!confirm('Delete this race (and its results)? Standings recalculate automatically.')) return;
        try {
            await DB.remove('races', raceId);
            Modal.close();
            Util.notify('Race deleted.');
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    /* ---------------- Results entry ---------------- */
    async resultsForm(raceId) {
        if (!this.guard()) return;
        const world = await DB.loadWorld(true);
        const race = world.races.find(r => r.id === raceId);
        if (!race) { Util.notify('Race not found.', 'error'); return; }

        let signups = [];
        try { signups = (await DB.signups({ force: true })).filter(s => s.raceId === raceId); } catch (e) { /* */ }
        const signedIds = new Set(signups.map(s => s.driverId));

        const existing = {};
        (race.results || []).forEach(r => { existing[r.driverId] = r; });

        // Signed-up drivers first, then everyone else.
        const drivers = world.drivers.slice().sort((a, b) => {
            const sa = signedIds.has(a.id) || existing[a.id] ? 0 : 1;
            const sb = signedIds.has(b.id) || existing[b.id] ? 0 : 1;
            return sa - sb || a.name.localeCompare(b.name);
        });

        if (!drivers.length) {
            Util.notify('No drivers exist yet. Add drivers first (Admin → Drivers).', 'error');
            return;
        }

        Modal.open(`
            ${Modal.header(`🏁 Results — ${race.name || race.track || 'Race'}`, `${Util.fmtDate(race.date)} · Points are computed automatically from the series points system`)}
            <form id="results-form">
                <div class="form-row">
                    <label class="field"><span>🅿️ Pole position</span>
                        <select id="res-pole" class="input">
                            <option value="">— None —</option>
                            ${drivers.map(d => `<option value="${Util.attr(d.id)}" ${existing[d.id]?.pole ? 'selected' : ''}>${Util.esc(d.name)}</option>`).join('')}
                        </select></label>
                    <label class="field"><span>⚡ Fastest lap</span>
                        <select id="res-fl" class="input">
                            <option value="">— None —</option>
                            ${drivers.map(d => `<option value="${Util.attr(d.id)}" ${existing[d.id]?.fastestLap ? 'selected' : ''}>${Util.esc(d.name)}</option>`).join('')}
                        </select></label>
                </div>
                <table class="table table-tight results-table">
                    <thead><tr><th>Pos</th><th>Driver</th><th>DNF</th></tr></thead>
                    <tbody>
                        ${drivers.map(d => {
                            const ex = existing[d.id];
                            return `<tr data-driver="${Util.attr(d.id)}">
                                <td><input class="input input-pos" type="number" min="1" max="99" value="${ex && !ex.dnf ? ex.position || '' : ''}" placeholder="—"></td>
                                <td>${Util.esc(d.name)} ${signedIds.has(d.id) ? '<span class="badge badge-blue">signed up</span>' : ''}</td>
                                <td><input type="checkbox" class="chk-dnf" ${ex?.dnf ? 'checked' : ''}></td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
                <p class="muted small">Leave position blank for drivers who didn’t race. Check DNF for drivers who started but didn’t finish (a DNF needs no position).</p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    ${race.status === 'completed' ? `<button type="button" class="btn btn-secondary" id="res-reopen">Reopen race (clear results)</button>` : ''}
                    <button type="submit" class="btn btn-primary">Save Results ✓</button>
                </div>
            </form>
        `, { wide: true });

        Util.$('#res-reopen')?.addEventListener('click', async () => {
            if (!confirm('Clear all results and set this race back to scheduled?')) return;
            try {
                await DB.update('races', raceId, { status: 'scheduled', results: [] });
                Modal.close();
                Util.notify('Race reopened — results cleared.');
                this.refresh();
            } catch (e) { Util.notify(e.message, 'error'); }
        });

        Util.$('#results-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const poleId = Util.$('#res-pole').value;
                const flId = Util.$('#res-fl').value;
                const results = [];
                const seenPositions = new Set();

                Util.$$('#results-form tbody tr').forEach(row => {
                    const driverId = row.dataset.driver;
                    const posVal = row.querySelector('.input-pos').value;
                    const dnf = row.querySelector('.chk-dnf').checked;
                    if (!posVal && !dnf && driverId !== poleId && driverId !== flId) return;
                    const position = posVal ? Number(posVal) : null;
                    if (position) {
                        if (seenPositions.has(position)) throw new Error(`Position ${position} is used twice.`);
                        seenPositions.add(position);
                    }
                    if (!position && !dnf) {
                        // Pole/FL only, didn't finish scoring — count as entrant with no classification.
                        results.push({ driverId, position: null, dnf: false, pole: driverId === poleId, fastestLap: driverId === flId });
                        return;
                    }
                    results.push({ driverId, position, dnf, pole: driverId === poleId, fastestLap: driverId === flId });
                });

                if (!results.length) throw new Error('Enter at least one finishing position or DNF.');
                await DB.update('races', raceId, { status: 'completed', results });
                Modal.close();
                Util.notify('Results saved — standings and stats updated everywhere. 🏆');
                this.refresh();
            } catch (err) { Util.notify(err.message, 'error'); }
        });
    },

    /* ---------------- Teams ---------------- */
    async tab_teams(el) {
        const world = await DB.loadWorld(true);
        el.innerHTML = `
        <section class="panel">
            <div class="panel-head"><h2>🛠 Teams (${world.teams.length})</h2>
                <button class="btn btn-primary btn-sm" onclick="Admin.teamForm()">＋ Add Team</button></div>
            ${world.teams.length ? `<table class="table">
                <thead><tr><th>Team</th><th class="num">Drivers</th><th>Owner</th><th>Recruiting</th><th></th></tr></thead>
                <tbody>${world.teams.map(t => `
                    <tr>
                        <td><div class="cell-flex">${C.logoBox(t)}<span class="strong">${Util.esc(t.name)}</span></div></td>
                        <td class="num">${world.drivers.filter(d => d.teamId === t.id).length}</td>
                        <td class="muted">${t.ownerUid ? 'Player-owned' : 'Unowned (available for takeover)'}</td>
                        <td>${t.recruiting !== false ? '<span class="badge badge-green">Open</span>' : '<span class="badge badge-dim">Closed</span>'}</td>
                        <td class="row-actions">
                            <button class="btn btn-ghost btn-sm" onclick="Views.showTeam('${Util.attr(t.id)}')">View</button>
                            <button class="btn btn-ghost btn-sm" onclick="Admin.teamForm('${Util.attr(t.id)}')">Edit</button>
                            <button class="btn btn-danger btn-sm" onclick="Admin.deleteTeam('${Util.attr(t.id)}')">Delete</button>
                        </td>
                    </tr>`).join('')}</tbody></table>`
            : C.empty('🛠', 'No teams yet', 'Create "established" teams for players to join or take over, or let players found their own.',
                `<button class="btn btn-primary" onclick="Admin.teamForm()">Create a team</button>`)}
        </section>`;
    },

    async teamForm(teamId = null) {
        if (!this.guard()) return;
        const team = teamId ? await DB.get('teams', teamId) : null;
        Modal.open(`
            ${Modal.header(team ? 'Edit Team' : 'Add Team', 'Teams without an owner can be taken over by Team Owner players')}
            <form id="admin-team-form" class="form-grid">
                <label class="field"><span>Team name *</span><input id="atf-name" class="input" required value="${Util.esc(team?.name || '')}" maxlength="50"></label>
                <div class="form-row">
                    <label class="field"><span>Color</span><input id="atf-color" class="input input-color" type="color" value="${Util.esc(team?.color || '#ff5a36')}"></label>
                    <label class="field"><span>Headquarters</span><input id="atf-hq" class="input" value="${Util.esc(team?.headquarters || '')}" maxlength="50"></label>
                </div>
                <label class="field"><span>Logo</span><input id="atf-logo" class="input" type="file" accept="image/*"></label>
                <label class="field"><span>Description</span><textarea id="atf-desc" class="input" rows="2" maxlength="300">${Util.esc(team?.description || '')}</textarea></label>
                <label class="check"><input id="atf-recruiting" type="checkbox" ${team?.recruiting !== false ? 'checked' : ''}> Recruiting (drivers can join)</label>
                <label class="check"><input id="atf-established" type="checkbox" ${team?.isEstablished ? 'checked' : ''}> Established team (shows in career takeover options)</label>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">${team ? 'Save' : 'Add Team'}</button>
                </div>
            </form>
        `);
        Util.$('#admin-team-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type=submit]');
            btn.disabled = true;
            try {
                const data = {
                    name: Util.$('#atf-name').value.trim(),
                    color: Util.$('#atf-color').value,
                    headquarters: Util.$('#atf-hq').value.trim(),
                    description: Util.$('#atf-desc').value.trim(),
                    recruiting: Util.$('#atf-recruiting').checked,
                    isEstablished: Util.$('#atf-established').checked
                };
                if (!data.name) throw new Error('Team name is required.');
                const file = Util.$('#atf-logo').files[0];
                if (file) data.logo = await Util.compressImage(file);
                if (team) await DB.update('teams', team.id, data);
                else await DB.create('teams', { ...data, ownerUid: null, status: 'approved' });
                Modal.close();
                Util.notify(team ? 'Team updated.' : 'Team created. 🛠');
                this.refresh();
            } catch (err) {
                Util.notify(err.message, 'error');
                btn.disabled = false;
            }
        });
    },

    async deleteTeam(teamId) {
        if (!this.guard()) return;
        const world = await DB.loadWorld();
        const roster = world.drivers.filter(d => d.teamId === teamId);
        if (!confirm(roster.length
            ? `Delete this team? Its ${roster.length} drivers become free agents.`
            : 'Delete this team?')) return;
        try {
            for (const d of roster) await DB.update('drivers', d.id, { teamId: null });
            await DB.remove('teams', teamId);
            Modal.close();
            Util.notify('Team deleted.');
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    /* ---------------- Drivers ---------------- */
    async tab_drivers(el) {
        const world = await DB.loadWorld(true);
        el.innerHTML = `
        <section class="panel">
            <div class="panel-head"><h2>🏎 Drivers (${world.drivers.length})</h2>
                <div class="btn-row">
                    <button class="btn btn-secondary btn-sm" onclick="Admin.generateNPCsForm()">🤖 Generate Free Agents</button>
                    <button class="btn btn-primary btn-sm" onclick="Admin.driverForm()">＋ Add Driver</button>
                </div></div>
            ${world.drivers.length ? `<table class="table">
                <thead><tr><th>Driver</th><th>Team</th><th>Type</th><th></th></tr></thead>
                <tbody>${world.drivers.map(d => `
                    <tr>
                        <td><span class="strong">${d.number ? '#' + Util.esc(String(d.number)) + ' ' : ''}${Util.esc(d.name)}</span>${d.country ? `<span class="muted"> · ${Util.esc(d.country)}</span>` : ''}</td>
                        <td class="muted">${Util.esc(world.teamsById[d.teamId]?.name || 'Free agent')}</td>
                        <td>${d.ownerUid ? '<span class="badge badge-blue">Player</span>' : '<span class="badge badge-dim">League / AI</span>'}</td>
                        <td class="row-actions">
                            <button class="btn btn-ghost btn-sm" onclick="Views.showDriver('${Util.attr(d.id)}')">View</button>
                            <button class="btn btn-ghost btn-sm" onclick="Admin.driverForm('${Util.attr(d.id)}')">Edit</button>
                            <button class="btn btn-danger btn-sm" onclick="Admin.deleteDriver('${Util.attr(d.id)}')">Delete</button>
                        </td>
                    </tr>`).join('')}</tbody></table>`
            : C.empty('🏎', 'No drivers yet', 'Players create their own driver when they start a career. You can also add league/AI drivers to fill grids.',
                `<button class="btn btn-primary" onclick="Admin.driverForm()">Add a driver</button>`)}
        </section>`;
    },

    async driverForm(driverId = null) {
        if (!this.guard()) return;
        const [driver, teams] = await Promise.all([driverId ? DB.get('drivers', driverId) : null, DB.teams()]);
        Modal.open(`
            ${Modal.header(driver ? 'Edit Driver' : 'Add Driver')}
            <form id="admin-driver-form" class="form-grid">
                <label class="field"><span>Name *</span><input id="adf-name" class="input" required value="${Util.esc(driver?.name || '')}" maxlength="40"></label>
                <div class="form-row">
                    <label class="field"><span>Number</span><input id="adf-number" class="input" type="number" min="0" max="999" value="${driver?.number ?? ''}"></label>
                    <label class="field"><span>Country</span><input id="adf-country" class="input" value="${Util.esc(driver?.country || '')}" maxlength="30"></label>
                </div>
                <label class="field"><span>Team</span>
                    <select id="adf-team" class="input">
                        <option value="">Free agent</option>
                        ${teams.map(t => `<option value="${Util.attr(t.id)}" ${driver?.teamId === t.id ? 'selected' : ''}>${Util.esc(t.name)}</option>`).join('')}
                    </select></label>
                <label class="field"><span>Bio</span><textarea id="adf-bio" class="input" rows="2" maxlength="300">${Util.esc(driver?.bio || '')}</textarea></label>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">${driver ? 'Save' : 'Add Driver'}</button>
                </div>
            </form>
        `);
        Util.$('#admin-driver-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const data = {
                    name: Util.$('#adf-name').value.trim(),
                    number: Util.$('#adf-number').value ? Number(Util.$('#adf-number').value) : null,
                    country: Util.$('#adf-country').value.trim(),
                    teamId: Util.$('#adf-team').value || null,
                    bio: Util.$('#adf-bio').value.trim()
                };
                if (!data.name) throw new Error('Driver name is required.');
                if (driver) await DB.update('drivers', driver.id, data);
                else await DB.create('drivers', { ...data, ownerUid: null, status: 'approved' });
                Modal.close();
                Util.notify(driver ? 'Driver updated.' : 'Driver added. 🏎');
                this.refresh();
            } catch (err) { Util.notify(err.message, 'error'); }
        });
    },

    /* ---------------- NPC world generator ---------------- */
    async generateNPCsForm() {
        if (!this.guard()) return;
        Modal.open(`
            ${Modal.header('🤖 Generate Free Agents & Rivals', 'Fill the league with hireable AI drivers, pit crew, and rival teams')}
            <form id="npc-form" class="form-grid">
                <div class="form-row">
                    <label class="field"><span>Free agent drivers</span><input id="npc-drivers" class="input" type="number" min="0" max="40" value="10"></label>
                    <label class="field"><span>Free agent pit crew</span><input id="npc-crew" class="input" type="number" min="0" max="40" value="12"></label>
                    <label class="field"><span>Rival teams</span><input id="npc-teams" class="input" type="number" min="0" max="10" value="4"></label>
                </div>
                <p class="muted small">Each rival team gets 2 drivers + a crew chief + a mechanic. Free agents appear in every Team Owner's hire market with a skill rating and an asking salary. Team Owners negotiate the actual pay.</p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Generate 🤖</button>
                </div>
            </form>
        `);
        Util.$('#npc-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type=submit]');
            btn.disabled = true;
            btn.textContent = 'Generating…';
            try {
                const summary = await generateNPCWorld({
                    freeDrivers: Number(Util.$('#npc-drivers').value) || 0,
                    freeCrew: Number(Util.$('#npc-crew').value) || 0,
                    rivalTeams: Number(Util.$('#npc-teams').value) || 0
                });
                Modal.close();
                Util.notify(`League populated: ${Util.plural(summary.teams, 'rival team')}, ${Util.plural(summary.drivers, 'driver')}, ${Util.plural(summary.staff, 'crew member')}. 🤖`);
                this.refresh();
            } catch (err) {
                Util.notify(err.message, 'error');
                btn.disabled = false;
                btn.textContent = 'Generate 🤖';
            }
        });
    },

    async deleteDriver(driverId) {
        if (!this.guard()) return;
        if (!confirm('Delete this driver? Their past race results remain in race records but stats stop counting them.')) return;
        try {
            await DB.remove('drivers', driverId);
            Modal.close();
            Util.notify('Driver deleted.');
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    /* ---------------- Players ---------------- */
    async tab_players(el) {
        let users = [];
        try { users = await DB.users({ force: true }); } catch (e) { /* */ }
        const world = await DB.loadWorld();
        el.innerHTML = `
        <section class="panel">
            <div class="panel-head"><h2>👥 Player Accounts (${users.length})</h2></div>
            ${users.length ? `<table class="table">
                <thead><tr><th>Player</th><th>Email</th><th>Role</th><th>Driver</th><th></th></tr></thead>
                <tbody>${users.map(u => {
                    const role = Career.roleInfo(u.activeRole);
                    return `<tr>
                        <td class="strong">${Util.esc(u.displayName || '—')}</td>
                        <td class="muted">${Util.esc(u.email || '—')}</td>
                        <td>${role ? `${role.icon} ${role.label}` : '<span class="muted">No role yet</span>'}</td>
                        <td class="muted">${Util.esc(world.driversById[u.driverId]?.name || '—')}</td>
                        <td class="row-actions">
                            <button class="btn btn-ghost btn-sm" onclick="Admin.resetPlayerRole('${Util.attr(u.id)}')">Reset role</button>
                        </td>
                    </tr>`;
                }).join('')}</tbody></table>`
            : C.empty('👥', 'No player accounts yet', 'Share the app link — players register with email + password on the login screen.')}
        </section>`;
    },

    async resetPlayerRole(uid) {
        if (!this.guard()) return;
        if (!confirm('Reset this player’s role? They will pick again on next visit (their driver/team records are kept).')) return;
        try {
            await DB.update('users', uid, { activeRole: null });
            Util.notify('Role reset.');
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    /* ---------------- Challenges ---------------- */
    async tab_challenges(el) {
        const [challenges, claims, world] = await Promise.all([
            DB.challenges({ force: true }), DB.claims({ force: true }), DB.loadWorld()
        ]);
        const pending = claims.filter(c => c.status === 'pending');
        const today = Util.todayISO();
        const sorted = challenges.slice().sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));

        el.innerHTML = `
        <div class="grid-2">
            <section class="panel">
                <div class="panel-head"><h2>🎯 Challenges (${challenges.length})</h2>
                    <div class="btn-row">
                        <button class="btn btn-secondary btn-sm" onclick="Admin.challengeForm()">＋ Custom</button>
                        <button class="btn btn-primary btn-sm" onclick="Admin.generateChallengesForm()">⚡ Generate Set</button>
                    </div></div>
                ${sorted.length ? sorted.map(c => `
                    <div class="race-row">
                        <div class="race-row-main">
                            <span class="race-title">${Util.esc(c.title)}
                                <span class="badge ${c.mode === 'multiplayer' ? 'badge-purple' : 'badge-blue'}">${c.mode}</span>
                                <span class="chip chip-dim">${c.cadence}</span>
                                ${c.status !== 'active' || (c.endDate && c.endDate < today) ? '<span class="badge badge-dim">ended</span>' : '<span class="badge badge-green">active</span>'}
                            </span>
                            <span class="race-sub">${Util.esc(c.description)} · ends ${Util.esc(Util.fmtDateShort(c.endDate))}</span>
                        </div>
                        <div class="btn-row">
                            <button class="btn btn-ghost btn-sm" onclick="Admin.challengeForm('${Util.attr(c.id)}')">Edit</button>
                            <button class="btn btn-danger btn-sm" onclick="Admin.deleteChallenge('${Util.attr(c.id)}')">Delete</button>
                        </div>
                    </div>`).join('')
                : C.empty('🎯', 'No challenges yet', 'Generate a weekly or monthly set in one click — solo and multiplayer objectives from the template pool.',
                    `<button class="btn btn-primary" onclick="Admin.generateChallengesForm()">Generate first set</button>`)}
            </section>

            <section class="panel">
                <div class="panel-head"><h2>📥 Claims to Review (${pending.length})</h2></div>
                ${pending.length ? pending.map(cl => {
                    const ch = challenges.find(c => c.id === cl.challengeId);
                    return `<div class="race-row">
                        <div class="race-row-main">
                            <span class="race-title">${Util.esc(cl.playerName || 'Player')} → ${Util.esc(ch?.title || 'Challenge')}</span>
                            ${cl.note ? `<span class="race-sub">“${Util.esc(cl.note)}”</span>` : ''}
                        </div>
                        <div class="btn-row">
                            <button class="btn btn-primary btn-sm" onclick="Admin.reviewClaim('${Util.attr(cl.id)}','approved')">✓ Approve</button>
                            <button class="btn btn-danger btn-sm" onclick="Admin.reviewClaim('${Util.attr(cl.id)}','rejected')">✕ Reject</button>
                        </div>
                    </div>`;
                }).join('') : '<p class="muted">No pending claims. 🎉</p>'}
            </section>
        </div>`;
    },

    async generateChallengesForm() {
        if (!this.guard()) return;
        Modal.open(`
            ${Modal.header('⚡ Generate Challenge Set', 'Random solo + multiplayer objectives from the template pool')}
            <form id="gen-form" class="form-grid">
                <div class="form-row">
                    <label class="field"><span>Cadence</span>
                        <select id="gen-cadence" class="input">
                            <option value="weekly">Weekly (ends in 7 days)</option>
                            <option value="monthly">Monthly (ends in 1 month)</option>
                        </select></label>
                    <label class="field"><span>How many</span><input id="gen-count" class="input" type="number" min="1" max="12" value="4"></label>
                </div>
                <p class="muted small">Track-specific templates use real tracks from your race calendar when available.</p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Generate 🎯</button>
                </div>
            </form>
        `);
        Util.$('#gen-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type=submit]');
            btn.disabled = true;
            try {
                const world = await DB.loadWorld();
                const tracks = Array.from(new Set(world.races.map(r => r.track).filter(Boolean)));
                const items = generateChallenges({
                    cadence: Util.$('#gen-cadence').value,
                    count: Number(Util.$('#gen-count').value) || 4,
                    tracks,
                    games: world.games
                });
                await DB.batchCreate('challenges', items);
                Modal.close();
                Util.notify(`${Util.plural(items.length, 'challenge')} published to the league. 🎯`);
                this.refresh();
            } catch (err) {
                Util.notify(err.message, 'error');
                btn.disabled = false;
            }
        });
    },

    async challengeForm(challengeId = null) {
        if (!this.guard()) return;
        const ch = challengeId ? await DB.get('challenges', challengeId) : null;
        const in7 = new Date(); in7.setDate(in7.getDate() + 7);
        const defEnd = `${in7.getFullYear()}-${String(in7.getMonth() + 1).padStart(2, '0')}-${String(in7.getDate()).padStart(2, '0')}`;
        Modal.open(`
            ${Modal.header(ch ? 'Edit Challenge' : 'Custom Challenge')}
            <form id="challenge-form" class="form-grid">
                <label class="field"><span>Title *</span><input id="cf-title" class="input" required value="${Util.esc(ch?.title || '')}" maxlength="60"></label>
                <label class="field"><span>Description *</span><textarea id="cf-desc" class="input" rows="2" required maxlength="400">${Util.esc(ch?.description || '')}</textarea></label>
                <div class="form-row">
                    <label class="field"><span>Mode</span>
                        <select id="cf-mode" class="input">
                            <option value="solo" ${ch?.mode === 'solo' ? 'selected' : ''}>Solo</option>
                            <option value="multiplayer" ${ch?.mode === 'multiplayer' ? 'selected' : ''}>Multiplayer</option>
                        </select></label>
                    <label class="field"><span>Cadence</span>
                        <select id="cf-cadence" class="input">
                            <option value="weekly" ${ch?.cadence === 'weekly' ? 'selected' : ''}>Weekly</option>
                            <option value="monthly" ${ch?.cadence === 'monthly' ? 'selected' : ''}>Monthly</option>
                        </select></label>
                </div>
                <div class="form-row">
                    <label class="field"><span>Ends</span><input id="cf-end" class="input" type="date" value="${Util.esc(ch?.endDate || defEnd)}"></label>
                    <label class="field"><span>Points</span><input id="cf-points" class="input" type="number" min="0" value="${ch?.points ?? 3}"></label>
                    <label class="field"><span>Reward text</span><input id="cf-reward" class="input" value="${Util.esc(ch?.reward || '')}" maxlength="80" placeholder="e.g. 3 challenge points"></label>
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">${ch ? 'Save' : 'Publish Challenge'}</button>
                </div>
            </form>
        `);
        Util.$('#challenge-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const data = {
                    title: Util.$('#cf-title').value.trim(),
                    description: Util.$('#cf-desc').value.trim(),
                    mode: Util.$('#cf-mode').value,
                    cadence: Util.$('#cf-cadence').value,
                    endDate: Util.$('#cf-end').value,
                    points: Util.$('#cf-points').value ? Number(Util.$('#cf-points').value) : 0,
                    reward: Util.$('#cf-reward').value.trim()
                };
                if (!data.title || !data.description) throw new Error('Title and description are required.');
                if (ch) await DB.update('challenges', ch.id, data);
                else await DB.create('challenges', { ...data, startDate: Util.todayISO(), status: 'active' });
                Modal.close();
                Util.notify(ch ? 'Challenge updated.' : 'Challenge published. 🎯');
                this.refresh();
            } catch (err) { Util.notify(err.message, 'error'); }
        });
    },

    async deleteChallenge(challengeId) {
        if (!this.guard()) return;
        if (!confirm('Delete this challenge (and hide it from players)?')) return;
        try {
            await DB.remove('challenges', challengeId);
            Util.notify('Challenge deleted.');
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    async reviewClaim(claimId, status) {
        if (!this.guard()) return;
        try {
            await DB.update('challengeClaims', claimId, { status, reviewedAt: Util.todayISO() });
            Util.notify(status === 'approved' ? 'Claim approved. ✓' : 'Claim rejected.');
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    /* ---------------- Settings ---------------- */
    async tab_settings(el) {
        el.innerHTML = `
        <div class="grid-2">
            <section class="panel">
                <div class="panel-head"><h2>🔑 Admin Passcode</h2></div>
                <p class="muted">The passcode is stored (hashed) in this browser. Anyone with the passcode can unlock Game Master on their own device.</p>
                <form id="passcode-form" class="form-grid">
                    <label class="field"><span>Current passcode</span><input id="pc-current" class="input" type="password" autocomplete="current-password"></label>
                    <label class="field"><span>New passcode (min 6 chars)</span><input id="pc-new" class="input" type="password" autocomplete="new-password"></label>
                    <button type="submit" class="btn btn-primary">Change Passcode</button>
                </form>
            </section>

            <section class="panel">
                <div class="panel-head"><h2>💾 Data</h2></div>
                <p class="muted">Download a full JSON backup of every league collection.</p>
                <button class="btn btn-secondary" id="export-btn">⬇ Export League Backup</button>
                <hr class="sep">
                <p class="muted small">Standings and statistics are always computed live from race results — there is nothing to rebuild and nothing that can drift out of sync.</p>
            </section>
        </div>`;

        Util.$('#passcode-form', el).addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                await Auth.changePasscode(Util.$('#pc-current').value, Util.$('#pc-new').value);
                Util.notify('Passcode changed on this device.');
                e.target.reset();
            } catch (err) { Util.notify(err.message, 'error'); }
        });

        Util.$('#export-btn', el).addEventListener('click', async () => {
            try {
                const collections = ['games', 'series', 'races', 'teams', 'drivers', 'users', 'challenges', 'challengeClaims', 'raceSignups', 'roleProfiles', 'staff', 'contracts'];
                const backup = { exportedAt: new Date().toISOString() };
                for (const c of collections) {
                    try { backup[c] = await DB.list(c, { force: true }); } catch (err) { backup[c] = { error: err.message }; }
                }
                const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `srmpc-backup-${Util.todayISO()}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
                Util.notify('Backup downloaded.');
            } catch (e) { Util.notify(e.message, 'error'); }
        });
    }
};
window.Admin = Admin;
