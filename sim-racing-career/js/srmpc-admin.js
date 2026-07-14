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
            ['races', '🏁 Races'], ['dealership', '🏬 Dealership'], ['teams', '🛠 Teams'], ['drivers', '🏎 Drivers'],
            ['world', '🌍 World'], ['players', '👥 Players'], ['challenges', '🎯 Challenges'],
            ['numbers', '🔢 Numbers'], ['override', '🔧 GM Override'], ['settings', '⚙ Settings']
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
                    <button class="btn btn-secondary" onclick="Admin.trackPackForm()">🛣 Load Track Pack</button>
                    <button class="btn btn-secondary" onclick="Admin.installPack()">🌍 Install Real-World Pack</button>
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
            // Title prestige: champion team's staff & sponsors + the promoter bank XP.
            await Prestige.awardTitleXP(snapshot, seriesId);

            // Contract clauses settle at the crowning: championship bonuses pay
            // from the frozen standings, and termination stipulations (mandatory
            // wins / average finish) end breached contracts for cause — the
            // season's only non-race settlement moment.
            const clauseContracts = (await DB.contracts({ force: true }).catch(() => []))
                .filter(c => c.status === 'active' && c.type !== 'sponsorship' && c.clauses);
            for (const c of clauseContracts) {
                const prize = Clauses.championship(c, snapshot);
                if (prize) {
                    const paidUid = c.personUid || (c.personKind === 'driver' ? world.driversById[c.personId]?.ownerUid : null);
                    await Wallet.executeRoleTransaction({
                        from: c.ownerUid ? { type: 'team', id: c.teamId } : null,
                        to: paidUid ? { type: 'player', id: paidUid } : null,
                        amount: prize.amount, icon: '🏆', refId: seasonId,
                        fromLabel: `Clause paid: ${prize.label} — ${c.personName}`,
                        toLabel: `${prize.label} bonus — season closed`
                    });
                    News.post('🏆', `${c.personName} banks a ${Economy.fmt(prize.amount)} championship bonus (P${prize.rank}) from ${c.teamName}`);
                }
            }
            for (const c of clauseContracts.filter(c => c.personKind === 'driver' && (c.clauses.minWins || c.clauses.minAvgFinish))) {
                const { breaches } = Clauses.seasonCheck(c, world.races, world, { seasonId });
                if (!breaches.length) continue;
                const reason = breaches.map(b => b.detail).join('; ');
                await DB.update('contracts', c.id, { terminationReason: reason });
                await Hub._freeDriver(c.personId, c.personUid || world.driversById[c.personId]?.ownerUid || null, 'terminated', c.id);
                News.post('⚖️', `${c.personName} released for cause by ${c.teamName} — ${reason}`);
            }

            // Car numbers: season close is the ONLY rollover moment — revoke
            // numbers never fielded this season, move the rest into a first-
            // right-of-refusal renewal window (see js/srmpc-numbers.js).
            try {
                const roll = await Numbers.processSeasonRollover(seriesId);
                if (roll.revoked || roll.renewals) News.post('🔢', `Number rollover for the series: ${roll.revoked} revoked, ${roll.renewals} up for renewal.`);
            } catch (e) { console.warn('Number rollover failed:', e); }

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
        const [series, games, inventory] = await Promise.all([
            seriesId ? DB.get('series', seriesId) : null, DB.games(),
            Dealership.inventory({ force: true }).catch(() => [])
        ]);
        const knownCarIds = [...new Set(inventory.map(c => c.carId || Garage.carId(c.name)))].join(' · ');
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
                <label class="field"><span>Highest car number (0–999)</span>
                    <input id="sf-nummax" class="input" type="number" min="0" max="999" value="${Number(series?.numberMax) || 99}"></label>
                <label class="field"><span>Eligible cars — space-separated car IDs (blank = open entry)</span>
                    <input id="sf-cars" class="input" value="${Util.esc((series?.carChoices || []).join(' '))}" placeholder="e.g. phoenix-gt-r-street-spec falcon-rs-coupe">
                    <span class="muted small">Drivers must own one of these (personally or via their team) to enter. ${knownCarIds ? `Catalog IDs: ${Util.esc(knownCarIds)}` : 'Stock the Dealership (Admin → Dealership) to get car IDs.'}</span></label>
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
                    numberMax: Math.min(999, Math.max(0, Number(Util.$('#sf-nummax').value) || 99)),
                    carChoices: Garage.parseChoices(Util.$('#sf-cars').value),
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
        const [series, seasons, allTracks, games, inventory] = await Promise.all([
            DB.series(), DB.seasons({ force: true }),
            DB.tracks({ force: true }).catch(() => []), DB.games(),
            Dealership.inventory({ force: true }).catch(() => [])
        ]);
        const knownCarIds = [...new Set(inventory.map(c => c.carId || Garage.carId(c.name)))].join(' · ');
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
                <label class="field"><span>Eligible cars — space-separated car IDs (blank = open entry)</span>
                    <input id="sb-cars" class="input" value="${Util.esc((series.find(s => s.id === initialSid)?.carChoices || []).join(' '))}" placeholder="e.g. phoenix-gt-r-street-spec falcon-rs-coupe">
                    <span class="muted small">Stamped on every generated race — entrants must own one of these cars (personal or team garage). ${knownCarIds ? `Catalog IDs: ${Util.esc(knownCarIds)}` : 'Stock the Dealership (Admin → Dealership) to get car IDs.'}</span></label>
                <label class="field"><span>Tracks — one per line, in order *</span>
                    <textarea id="sb-tracks" class="input" rows="8" placeholder="Silverstone&#10;Spa-Francorchamps&#10;Monza&#10;Suzuka&#10;Interlagos" required></textarea></label>
                <div class="field"><span id="sb-lib-label">Track library — click to add</span>
                    <div id="sb-lib" class="chip-cloud"></div></div>
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

        // Track library: the chosen series' game decides which tracks to offer.
        const renderLib = (sid) => {
            const s = series.find(x => x.id === sid);
            const game = games.find(g => g.id === s?.gameId) || null;
            const pool = (game ? allTracks.filter(t => t.gameId === game.id) : allTracks)
                .slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            Util.$('#sb-lib-label').textContent = game
                ? `Track library — ${game.name} — click to add`
                : 'Track library — all games — click to add';
            Util.$('#sb-lib').innerHTML = pool.length
                ? pool.map(t => `<button type="button" class="chip chip-btn" data-track="${Util.esc(t.name)}">${Util.esc(t.name)}</button>`).join('')
                : `<span class="muted small">${game
                    ? `No tracks loaded for ${Util.esc(game.name)} yet — load its Track Pack in Admin → World, or just type track names above.`
                    : 'No tracks in the library yet — load a Track Pack in Admin → World, or just type track names above.'}</span>`;
        };
        Util.$('#sb-lib').addEventListener('click', (e) => {
            const name = e.target.closest('[data-track]')?.dataset.track;
            if (!name) return;
            const ta = Util.$('#sb-tracks');
            ta.value = (ta.value.trimEnd() ? ta.value.trimEnd() + '\n' : '') + name;
            preview();
        });
        renderLib(initialSid);

        // Keep the season dropdown and track library in sync with the chosen series.
        Util.$('#sb-series').addEventListener('change', (e) => {
            Util.$('#sb-season').innerHTML = seasonOptions(e.target.value);
            Util.$('#sb-cars').value = (series.find(s => s.id === e.target.value)?.carChoices || []).join(' ');
            renderLib(e.target.value);
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

                // Persist the eligible-car list on the series too, so future
                // one-off races and the series page share the same requirement.
                const carChoices = Garage.parseChoices(Util.$('#sb-cars').value);
                await DB.update('series', sid, { carChoices }).catch(() => {});

                const races = generateScheduleRaces({
                    series: s,
                    seasonId,
                    carChoices,
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

    /* ---------------- Dealership (GM vehicle creation) ---------------- */
    tab_dealership(el) { return Dealership.adminPanel(el); },

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
                            ${r.status !== 'completed' ? `<button class="btn btn-ghost btn-sm" onclick="Admin.simRace('${Util.attr(r.id)}')">▶ Simulate</button>` : ''}
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
        const [race, series, games, allRaces, seasons, allTracks] = await Promise.all([
            raceId ? DB.get('races', raceId) : null, DB.series(), DB.games(), DB.races(), DB.seasons(),
            DB.tracks({ force: true }).catch(() => [])
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
                    <label class="field"><span>Track *</span><input id="rf-track" class="input" required list="rf-track-dl" value="${Util.esc(race?.track || '')}" maxlength="60" placeholder="e.g. Watkins Glen"><datalist id="rf-track-dl"></datalist></label>
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
        // Track suggestions follow the chosen game (or the series' game).
        const fillTrackList = () => {
            const gameId = Util.$('#rf-game').value ||
                series.find(s => s.id === Util.$('#rf-series').value)?.gameId || '';
            const pool = gameId ? allTracks.filter(t => t.gameId === gameId) : allTracks;
            Util.$('#rf-track-dl').innerHTML = pool
                .slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                .map(t => `<option value="${Util.attr(t.name)}"></option>`).join('');
        };
        fillTrackList();
        Util.$('#rf-game').addEventListener('change', fillTrackList);

        // Repopulate seasons (and track suggestions) when the series changes.
        Util.$('#rf-series').addEventListener('change', (e) => {
            Util.$('#rf-season').innerHTML = seasonOptionsFor(e.target.value, null);
            fillTrackList();
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
                    <thead><tr><th>Pos</th><th>Driver</th><th>DNF</th>
                        <th title="Incident points — 0 pays clean-race clause bonuses">Inc</th>
                        <th title="Laps led — most laps led pays clause bonuses">Led</th>
                        <th title="Laps completed — full distance pays clause bonuses">Laps</th></tr></thead>
                    <tbody>
                        ${drivers.map(d => {
                            const ex = existing[d.id];
                            const tv = (v) => (v === undefined || v === null) ? '' : v;
                            return `<tr data-driver="${Util.attr(d.id)}">
                                <td><input class="input input-pos" type="number" min="1" max="99" value="${ex && !ex.dnf ? ex.position || '' : ''}" placeholder="—"></td>
                                <td>${Util.esc(d.name)} ${signedIds.has(d.id) ? '<span class="badge badge-blue">signed up</span>' : ''}</td>
                                <td><input type="checkbox" class="chk-dnf" ${ex?.dnf ? 'checked' : ''}></td>
                                <td><input class="input input-inc" type="number" min="0" max="99" style="width:4rem" value="${tv(ex?.incidents)}" placeholder="—"></td>
                                <td><input class="input input-led" type="number" min="0" max="999" style="width:4rem" value="${tv(ex?.lapsLed)}" placeholder="—"></td>
                                <td><input class="input input-laps" type="number" min="0" max="999" style="width:4rem" value="${tv(ex?.lapsCompleted)}" placeholder="—"></td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
                <p class="muted small">Leave position blank for drivers who didn’t race. Check DNF for drivers who started but didn’t finish (a DNF needs no position).
                    Inc / Led / Laps are optional telemetry for contract performance clauses — blank fields simply skip those clauses.</p>
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
                    // Optional telemetry — only stored when actually entered, so
                    // clause evaluation can tell "0 incidents" from "not tracked".
                    const telemetry = {};
                    const tRead = (cls, key) => { const v = row.querySelector(cls).value; if (v !== '') telemetry[key] = Number(v); };
                    tRead('.input-inc', 'incidents'); tRead('.input-led', 'lapsLed'); tRead('.input-laps', 'lapsCompleted');
                    if (!position && !dnf) {
                        // Pole/FL only, didn't finish scoring — count as entrant with no classification.
                        results.push({ driverId, position: null, dnf: false, pole: driverId === poleId, fastestLap: driverId === flId, ...telemetry });
                        return;
                    }
                    results.push({ driverId, position, dnf, pole: driverId === poleId, fastestLap: driverId === flId, ...telemetry });
                });

                if (!results.length) throw new Error('Enter at least one finishing position or DNF.');
                const wasCompleted = race.status === 'completed';
                await DB.update('races', raceId, { status: 'completed', results });
                const winner = results.find(r => Number(r.position) === 1 && !r.dnf);
                const winnerName = winner ? world.driversById[winner.driverId]?.name : null;
                if (winnerName) News.post('🏆', `${winnerName} wins ${race.name || race.track || 'a league race'}!`);
                // Prize money + sponsor payouts + prestige XP — only on first
                // completion, so editing results never double-pays.
                if (!wasCompleted) {
                    await Sim.payoutRace({ ...race, results }, world);
                    await Prestige.awardRaceXP({ ...race, results }, world);
                }
                Modal.close();
                Util.notify('Results saved — standings, stats, and race earnings updated. 🏆');
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
        const [team, series] = await Promise.all([teamId ? DB.get('teams', teamId) : null, DB.series()]);
        Modal.open(`
            ${Modal.header(team ? 'Edit Team' : 'Add Team', 'Teams without an owner can be taken over by Team Owner players')}
            <form id="admin-team-form" class="form-grid">
                <label class="field"><span>Team name *</span><input id="atf-name" class="input" required value="${Util.esc(team?.name || '')}" maxlength="50"></label>
                <div class="form-row">
                    <label class="field"><span>Color</span><input id="atf-color" class="input input-color" type="color" value="${Util.esc(team?.color || '#ff5a36')}"></label>
                    <label class="field"><span>Headquarters</span><input id="atf-hq" class="input" value="${Util.esc(team?.headquarters || '')}" maxlength="50"></label>
                </div>
                <label class="field"><span>Championship entry (the team's drivers join this series' simulated grid)</span>
                    <select id="atf-series" class="input">
                        <option value="">— Not entered in a championship —</option>
                        ${series.filter(s => (s.status || 'active') === 'active').map(s =>
                            `<option value="${Util.attr(s.id)}" ${team?.seriesId === s.id ? 'selected' : ''}>${Util.esc(s.name)}</option>`).join('')}
                    </select></label>
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
                    isEstablished: Util.$('#atf-established').checked,
                    seriesId: Util.$('#atf-series').value || null
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
                    <label class="field"><span>Skill rating (AI pace, 50–99)</span><input id="adf-rating" class="input" type="number" min="50" max="99" value="${driver?.rating ?? ''}" placeholder="75"></label>
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
                    rating: Util.$('#adf-rating').value ? Math.min(99, Math.max(50, Number(Util.$('#adf-rating').value))) : null,
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

    async generatePersonasForm() {
        if (!this.guard()) return;
        Modal.open(`
            ${Modal.header('🎭 Generate Personas & Sponsors', 'Bulk-create AI characters and sponsorships, auto-assigned to your league')}
            <form id="persona-gen-form" class="form-grid">
                <div class="form-row">
                    <label class="field"><span>💼 Agents</span><input id="pg-agents" class="input" type="number" min="0" max="20" value="3"></label>
                    <label class="field"><span>🏆 Series owners</span><input id="pg-series" class="input" type="number" min="0" max="20" value="2"></label>
                    <label class="field"><span>🛣️ Track owners</span><input id="pg-tracks" class="input" type="number" min="0" max="20" value="2"></label>
                </div>
                <div class="form-row">
                    <label class="field"><span>🤝 Sponsor personas</span><input id="pg-sponsors" class="input" type="number" min="0" max="20" value="3"></label>
                    <label class="field"><span>💰 Sponsor brands</span><input id="pg-brands" class="input" type="number" min="0" max="20" value="4"></label>
                </div>
                <p class="muted small">Everyone arrives with work to do: agents sign 2–4 unrepresented drivers, series owners claim
                    unpromoted series, track owners split unowned venues, sponsor personas back a team and one of its drivers, and
                    sponsor brands attach to unbacked teams with a per-race payout. Edit any of them afterwards from this tab.</p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Generate 🎭</button>
                </div>
            </form>
        `);
        Util.$('#persona-gen-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type=submit]');
            btn.disabled = true;
            btn.textContent = 'Generating…';
            try {
                const s = await generatePersonaWorld({
                    agents: Number(Util.$('#pg-agents').value) || 0,
                    seriesOwners: Number(Util.$('#pg-series').value) || 0,
                    trackOwners: Number(Util.$('#pg-tracks').value) || 0,
                    sponsors: Number(Util.$('#pg-sponsors').value) || 0,
                    brands: Number(Util.$('#pg-brands').value) || 0
                });
                Modal.close();
                Util.notify(`Cast assembled: ${Util.plural(s.agents, 'agent')}, ${Util.plural(s.seriesOwners, 'series owner')}, `
                    + `${Util.plural(s.trackOwners, 'track owner')}, ${Util.plural(s.sponsors, 'sponsor persona')}, `
                    + `${Util.plural(s.brands, 'sponsor brand')}. 🎭`);
                this.refresh();
            } catch (err) {
                Util.notify(err.message, 'error');
                btn.disabled = false;
                btn.textContent = 'Generate 🎭';
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

    /* ---------------- World: tracks, sponsors, staff, AI personas ---------------- */
    async tab_world(el) {
        const [tracks, sponsors, staff, profiles, world] = await Promise.all([
            DB.tracks({ force: true }).catch(() => []),
            DB.sponsors({ force: true }).catch(() => []),
            DB.staff({ force: true }).catch(() => []),
            DB.roleProfiles({ force: true }).catch(() => []),
            DB.loadWorld(true)
        ]);
        // Every role profile — AI personas first, then player careers. The GM
        // can open and edit any of them through the same form.
        const isAI = (p) => !p.uid;
        const personas = profiles.slice().sort((a, b) =>
            (isAI(a) === isAI(b)) ? (a.name || '').localeCompare(b.name || '') : (isAI(a) ? -1 : 1));
        const teamName = (id) => world.teamsById[id]?.name || '—';
        const roleLabel = (id) => Career.roleInfo(id)?.label || staffRoleInfo(id).label;
        const personaDetail = (p) => {
            const few = (names) => names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '');
            if (p.role === 'series-owner') {
                const names = (p.seriesIds || []).map(id => world.seriesById[id]?.name).filter(Boolean);
                return names.length ? `runs ${few(names)}` : 'no series assigned';
            }
            if (p.role === 'track-owner') {
                const n = (p.tracks || []).length;
                return n ? `${Util.plural(n, 'venue')} — ${few(p.tracks)}` : 'no venues yet';
            }
            if (p.role === 'agent' || p.role === 'crew-chief') {
                const names = (p.clientDriverIds || []).map(id => world.driversById[id]?.name).filter(Boolean);
                const team = p.role === 'crew-chief' && p.teamId ? `${teamName(p.teamId)} · ` : '';
                return team + (names.length ? `${Util.plural(names.length, 'client')} — ${few(names)}` : 'no clients yet');
            }
            if (p.role === 'mechanic') return p.teamId ? `wrenching for ${teamName(p.teamId)}` : 'free agent';
            if (p.role === 'sponsor') {
                const deals = [];
                if (p.sponsoredTeamId) deals.push(`backs ${teamName(p.sponsoredTeamId)}`);
                if (p.sponsoredDriverId) deals.push(`backs ${world.driversById[p.sponsoredDriverId]?.name || 'a driver'}`);
                return deals.join(' · ') || 'no sponsorship deals yet';
            }
            return '';
        };

        const gameFilter = this._trackGame || '';
        const shownTracks = tracks.filter(t =>
            !gameFilter || (gameFilter === '__none__' ? !t.gameId : t.gameId === gameFilter));

        el.innerHTML = `
        <div class="panel" style="margin-bottom:1.1rem">
            <div class="panel-head"><h2>🌍 League World</h2>
                <div class="btn-row">
                    <button class="btn btn-primary btn-sm" onclick="Admin.trackPackForm()">🛣 Load Track Pack</button>
                    <button class="btn btn-secondary btn-sm" onclick="Admin.installPack()">🌍 Install Real-World Pack</button>
                    <button class="btn btn-secondary btn-sm" onclick="Admin.generateNPCsForm()">🤖 Generate Free Agents</button>
                    <button class="btn btn-secondary btn-sm" onclick="Admin.generatePersonasForm()">🎭 Generate Personas & Sponsors</button>
                </div></div>
            <p class="muted small">Track Packs load a game's circuits — ${Object.values(TRACK_PACKS).map(p => p.game.name).join(', ')} —
                creating the game automatically and tagging every track with it, so the schedule builder and race form offer the right
                venues for whatever you're playing. You can also add custom tracks (with their own logos) per game. The Real-World Pack
                seeds ${REAL_WORLD_PACK.length} full championships (${REAL_WORLD_PACK.map(p => p.name).join(' · ')}) with AI grids and can
                be tied to a game when you install it. Re-running any pack skips what already exists.</p>
        </div>

        <div class="grid-2">
            <section class="panel">
                <div class="panel-head"><h2>🛣 Tracks (${shownTracks.length}${gameFilter ? ' of ' + tracks.length : ''})</h2>
                    <div class="btn-row">
                        <select id="track-game-filter" class="input">
                            <option value="">All games</option>
                            ${world.games.map(g => `<option value="${Util.attr(g.id)}" ${gameFilter === g.id ? 'selected' : ''}>${Util.esc(g.name)}</option>`).join('')}
                            <option value="__none__" ${gameFilter === '__none__' ? 'selected' : ''}>No game</option>
                        </select>
                        <button class="btn btn-secondary btn-sm" onclick="Admin.trackPackForm()">🛣 Load Pack</button>
                        <button class="btn btn-primary btn-sm" onclick="Admin.trackForm()">＋ Add Track</button>
                    </div></div>
                ${shownTracks.length ? `<table class="table table-tight">
                    <thead><tr><th>Track</th><th>Game</th><th>Type</th><th></th></tr></thead>
                    <tbody>${shownTracks.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(t => `
                        <tr>
                            <td><div class="cell-flex">${C.logoBox(t)}<span class="strong">${Util.esc(t.name)}</span>${t.country ? `<span class="muted"> · ${Util.esc(t.country)}</span>` : ''}</div></td>
                            <td>${C.gameChip(world.gamesById[t.gameId])}</td>
                            <td class="muted">${Util.esc(t.type || '—')}${t.length ? ` · ${Util.esc(t.length)}` : ''}</td>
                            <td class="row-actions">
                                <button class="btn btn-ghost btn-sm" onclick="Admin.trackForm('${Util.attr(t.id)}')">Edit</button>
                                <button class="btn btn-danger btn-sm" onclick="Admin.deleteWorldDoc('tracks','${Util.attr(t.id)}','track')">Del</button>
                            </td>
                        </tr>`).join('')}</tbody></table>`
                : C.empty('🛣', gameFilter ? 'No tracks for this game yet' : 'No tracks yet',
                    'Load a Track Pack for the game you\'re playing — Gran Turismo 7, Wreckfest, Forza, iRacing, AMS2, NR2003 — or add custom venues with their own logos.',
                    `<button class="btn btn-primary" onclick="Admin.trackPackForm()">Load a Track Pack</button>`)}
            </section>

            <section class="panel">
                <div class="panel-head"><h2>💰 Sponsors (${sponsors.length})</h2>
                    <div class="btn-row">
                        <button class="btn btn-secondary btn-sm" onclick="Admin.generatePersonasForm()">🎭 Generate</button>
                        <button class="btn btn-primary btn-sm" onclick="Admin.sponsorForm()">＋ Add Sponsor</button>
                    </div></div>
                ${sponsors.length ? sponsors.map(s => `
                    <div class="race-row">
                        <div class="race-row-main">
                            <span class="race-title">${Util.esc(s.name)} ${Prestige.chip(Prestige.stored(s))}</span>
                            <span class="race-sub">${Util.esc(s.industry || 'Sponsor')} · backs ${Util.esc(teamName(s.teamId))} · pays ${Economy.fmt(s.payoutPerRace)}/race</span>
                        </div>
                        <div class="row-actions">
                            <button class="btn btn-ghost btn-sm" onclick="Admin.sponsorForm('${Util.attr(s.id)}')">Edit</button>
                            <button class="btn btn-danger btn-sm" onclick="Admin.deleteWorldDoc('sponsors','${Util.attr(s.id)}','sponsor')">Del</button>
                        </div>
                    </div>`).join('')
                : C.empty('💰', 'No sponsor brands yet', 'Sponsors back a team and pay the owner every race. The Real-World Pack seeds a full portfolio.')}
            </section>

            <section class="panel">
                <div class="panel-head"><h2>🧰 Crew & Staff (${staff.length})</h2>
                    <button class="btn btn-primary btn-sm" onclick="Admin.staffForm()">＋ Add Staff</button></div>
                ${staff.length ? staff.map(s => `
                    <div class="race-row">
                        <div class="race-row-main">
                            <span class="race-title">${Util.esc(s.name)} ${Prestige.chip(Prestige.stored(s))}</span>
                            <span class="race-sub">${Util.esc(staffRoleInfo(s.role).label)}${s.rating ? ` · ⭐ ${s.rating}` : ''} · ${Util.esc(s.teamId ? teamName(s.teamId) : 'Free agent')}</span>
                        </div>
                        <div class="row-actions">
                            <button class="btn btn-ghost btn-sm" onclick="Admin.staffForm('${Util.attr(s.id)}')">Edit</button>
                            <button class="btn btn-danger btn-sm" onclick="Admin.deleteWorldDoc('staff','${Util.attr(s.id)}','staff member')">Del</button>
                        </div>
                    </div>`).join('')
                : C.empty('🧰', 'No crew yet', 'Generate free agents or install the Real-World Pack to fill the pit lane.')}
            </section>

            <section class="panel">
                <div class="panel-head"><h2>🤖 Personas & Role Profiles (${personas.length})</h2>
                    <div class="btn-row">
                        <button class="btn btn-secondary btn-sm" onclick="Admin.generatePersonasForm()">🎭 Generate</button>
                        <button class="btn btn-primary btn-sm" onclick="Admin.personaForm()">＋ Add Persona</button>
                    </div></div>
                <p class="muted small">AI characters and player careers filling the league's non-driving roles — agents, sponsors, series owners,
                    track owners, crew chiefs, mechanics. As Game Master you can edit any of them, including players' profiles.</p>
                ${personas.length ? personas.map(p => `
                    <div class="race-row">
                        <div class="race-row-main">
                            <span class="race-title">${Util.esc(p.name)} ${Prestige.chip(Prestige.stored(p))} ${p.uid ? '<span class="badge badge-blue">👤 Player</span>' : '<span class="badge badge-dim">🤖 AI</span>'}</span>
                            <span class="race-sub" ${p.bio ? `title="${Util.attr(p.bio)}"` : ''}>${Util.esc(roleLabel(p.role))}${personaDetail(p) ? ` · ${Util.esc(personaDetail(p))}` : ''}</span>
                        </div>
                        <div class="row-actions">
                            <button class="btn btn-ghost btn-sm" onclick="Admin.personaForm('${Util.attr(p.id)}')">Edit</button>
                            <button class="btn btn-danger btn-sm" onclick="Admin.deleteWorldDoc('roleProfiles','${Util.attr(p.id)}','${p.uid ? "player role profile — their career progress in this role" : "persona"}')">Del</button>
                        </div>
                    </div>`).join('')
                : C.empty('🤖', 'No personas yet', 'Add AI agents, sponsors, promoters, and venue owners — or install the Real-World Pack to create them automatically.')}
            </section>
        </div>`;

        Util.$('#track-game-filter', el)?.addEventListener('change', (e) => {
            this._trackGame = e.target.value;
            this.refresh();
        });
    },

    /* ---------------- Track Packs (per-game track libraries) ---------------- */
    async trackPackForm() {
        if (!this.guard()) return;
        const games = await DB.games({ force: true });
        const packs = Object.entries(TRACK_PACKS);
        const packInfo = (key) => {
            const p = TRACK_PACKS[key];
            return `${p.tracks.length} tracks · game "${p.game.name}" is created automatically if you don't pick one below.`;
        };
        Modal.open(`
            ${Modal.header('🛣 Load Track Pack', "Load the track list for whatever game you're playing")}
            <form id="track-pack-form" class="form-grid">
                <label class="field"><span>Track pack *</span>
                    <select id="tp-pack" class="input">
                        ${packs.map(([key, p]) => `<option value="${key}">${Util.esc(p.game.name)} — ${p.tracks.length} tracks</option>`).join('')}
                    </select></label>
                <label class="field"><span>Attach to game</span>
                    <select id="tp-game" class="input">
                        <option value="">＋ Create / match the pack's game automatically</option>
                        ${games.map(g => `<option value="${Util.attr(g.id)}">${Util.esc(g.name)}</option>`).join('')}
                    </select></label>
                <p class="muted small" id="tp-info">${packInfo(packs[0][0])}</p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Load Tracks 🛣</button>
                </div>
            </form>
        `);
        Util.$('#tp-pack').addEventListener('change', (e) => {
            Util.$('#tp-info').textContent = packInfo(e.target.value);
        });
        Util.$('#track-pack-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type=submit]');
            btn.disabled = true;
            btn.textContent = 'Loading…';
            try {
                const s = await installTrackPack(Util.$('#tp-pack').value, Util.$('#tp-game').value || null);
                Modal.close();
                Util.notify(`${s.game?.name || 'Game'} track pack loaded: ${Util.plural(s.created, 'track')} added${s.skipped ? `, ${s.skipped} already in your library` : ''}. 🛣`);
                this._trackGame = s.gameId;
                this.refresh();
            } catch (err) {
                Util.notify(err.message, 'error');
                btn.disabled = false;
                btn.textContent = 'Load Tracks 🛣';
            }
        });
    },

    async trackForm(trackId = null) {
        if (!this.guard()) return;
        const [track, games] = await Promise.all([trackId ? DB.get('tracks', trackId) : null, DB.games()]);
        Modal.open(`
            ${Modal.header(track ? 'Edit Track' : 'Add Track', 'Custom tracks welcome — pick the game it belongs to and give it a logo')}
            <form id="track-form" class="form-grid">
                <label class="field"><span>Track name *</span><input id="tk-name" class="input" required value="${Util.esc(track?.name || '')}" maxlength="80"></label>
                <div class="form-row">
                    <label class="field"><span>Game</span>
                        <select id="tk-game" class="input">
                            <option value="">— No game —</option>
                            ${games.map(g => `<option value="${Util.attr(g.id)}" ${(track?.gameId || this._trackGame) === g.id ? 'selected' : ''}>${Util.esc(g.name)}</option>`).join('')}
                        </select></label>
                    <label class="field"><span>Country</span><input id="tk-country" class="input" value="${Util.esc(track?.country || '')}" maxlength="40"></label>
                </div>
                <div class="form-row">
                    <label class="field"><span>Type</span>
                        <select id="tk-type" class="input">
                            ${['Road', 'Oval', 'Street', 'Dirt', 'Rally', 'Kart'].map(t => `<option ${track?.type === t ? 'selected' : ''}>${t}</option>`).join('')}
                        </select></label>
                    <label class="field"><span>Length</span><input id="tk-length" class="input" value="${Util.esc(track?.length || '')}" maxlength="20" placeholder="e.g. 5.89 km"></label>
                </div>
                <label class="field"><span>Track logo ${track?.logo ? '(current logo kept unless you choose a new one)' : '(optional)'}</span>
                    <input id="tk-logo" class="input" type="file" accept="image/*"></label>
                <div class="modal-actions">
                    ${track?.logo ? `<button type="button" class="btn btn-ghost" id="tk-remove-logo">Remove logo</button>` : ''}
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">${track ? 'Save' : 'Add Track'}</button>
                </div>
            </form>
        `);
        let removeLogo = false;
        Util.$('#tk-remove-logo')?.addEventListener('click', (e) => {
            removeLogo = true;
            e.target.textContent = 'Logo will be removed';
            e.target.disabled = true;
        });
        Util.$('#track-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type=submit]');
            btn.disabled = true;
            try {
                const data = {
                    name: Util.$('#tk-name').value.trim(),
                    gameId: Util.$('#tk-game').value || null,
                    country: Util.$('#tk-country').value.trim(),
                    type: Util.$('#tk-type').value,
                    length: Util.$('#tk-length').value.trim()
                };
                if (!data.name) throw new Error('Track name is required.');
                const file = Util.$('#tk-logo').files[0];
                if (file) data.logo = await Util.compressImage(file);
                else if (removeLogo) data.logo = null;
                if (track) await DB.update('tracks', track.id, data);
                else await DB.create('tracks', data);
                Modal.close();
                Util.notify(track ? 'Track updated.' : 'Track added. 🛣');
                this.refresh();
            } catch (err) {
                Util.notify(err.message, 'error');
                btn.disabled = false;
            }
        });
    },

    async sponsorForm(sponsorId = null) {
        if (!this.guard()) return;
        const [sponsor, teams] = await Promise.all([sponsorId ? DB.get('sponsors', sponsorId) : null, DB.teams()]);
        Modal.open(`
            ${Modal.header(sponsor ? 'Edit Sponsor' : 'Add Sponsor', 'Sponsors back a team and pay its owner every race')}
            <form id="sponsor-form" class="form-grid">
                <label class="field"><span>Brand name *</span><input id="sp-name" class="input" required value="${Util.esc(sponsor?.name || '')}" maxlength="60"></label>
                <div class="form-row">
                    <label class="field"><span>Industry</span><input id="sp-industry" class="input" value="${Util.esc(sponsor?.industry || '')}" maxlength="40"></label>
                    <label class="field"><span>Prestige floor (1–5 ★)</span><input id="sp-prestige" class="input" type="number" min="1" max="5" value="${Prestige.clamp(sponsor?.prestige)}" title="Minimum star level. They also earn prestige XP from their team's results — currently ${sponsor ? Prestige.storedScore(sponsor) + ' XP (' + Prestige.levelName(Prestige.stored(sponsor)) + ')' : '0 XP'}."></label>
                    <label class="field"><span>Payout per race</span><input id="sp-payout" class="input" type="number" min="0" step="10" value="${sponsor?.payoutPerRace ?? 300}"></label>
                </div>
                <label class="field"><span>Sponsored team</span>
                    <select id="sp-team" class="input">
                        <option value="">— Unattached (available) —</option>
                        ${teams.map(t => `<option value="${Util.attr(t.id)}" ${sponsor?.teamId === t.id ? 'selected' : ''}>${Util.esc(t.name)}</option>`).join('')}
                    </select></label>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">${sponsor ? 'Save' : 'Add Sponsor'}</button>
                </div>
            </form>
        `);
        Util.$('#sponsor-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const data = {
                    name: Util.$('#sp-name').value.trim(),
                    industry: Util.$('#sp-industry').value.trim(),
                    prestige: Prestige.clamp(Util.$('#sp-prestige').value),
                    payoutPerRace: Math.round(Number(Util.$('#sp-payout').value) || 0),
                    teamId: Util.$('#sp-team').value || null
                };
                if (!data.name) throw new Error('Brand name is required.');
                if (sponsor) await DB.update('sponsors', sponsor.id, data);
                else await DB.create('sponsors', { ...data, isNPC: true });
                Modal.close();
                Util.notify(sponsor ? 'Sponsor updated.' : 'Sponsor added. 💰');
                this.refresh();
            } catch (err) { Util.notify(err.message, 'error'); }
        });
    },

    async staffForm(staffId = null) {
        if (!this.guard()) return;
        const [person, teams] = await Promise.all([staffId ? DB.get('staff', staffId) : null, DB.teams()]);
        Modal.open(`
            ${Modal.header(person ? 'Edit Staff' : 'Add Staff')}
            <form id="staff-form" class="form-grid">
                <label class="field"><span>Name *</span><input id="st-name" class="input" required value="${Util.esc(person?.name || '')}" maxlength="50"></label>
                <div class="form-row">
                    <label class="field"><span>Role</span>
                        <select id="st-role" class="input">
                            ${STAFF_ROLES.map(r => `<option value="${r.id}" ${person?.role === r.id ? 'selected' : ''}>${r.icon} ${r.label}</option>`).join('')}
                        </select></label>
                    <label class="field"><span>Skill rating (50–99)</span><input id="st-rating" class="input" type="number" min="50" max="99" value="${person?.rating ?? 70}"></label>
                    <label class="field"><span>Prestige floor (1–5 ★)</span><input id="st-prestige" class="input" type="number" min="1" max="5" value="${Prestige.clamp(person?.prestige)}" title="Minimum star level. They also earn prestige XP from their team's results — currently ${person ? Prestige.storedScore(person) + ' XP (' + Prestige.levelName(Prestige.stored(person)) + ')' : '0 XP'}."></label>
                </div>
                <label class="field"><span>Team</span>
                    <select id="st-team" class="input">
                        <option value="">Free agent</option>
                        ${teams.map(t => `<option value="${Util.attr(t.id)}" ${person?.teamId === t.id ? 'selected' : ''}>${Util.esc(t.name)}</option>`).join('')}
                    </select></label>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">${person ? 'Save' : 'Add Staff'}</button>
                </div>
            </form>
        `);
        Util.$('#staff-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const rating = Math.min(99, Math.max(50, Number(Util.$('#st-rating').value) || 70));
                const data = {
                    name: Util.$('#st-name').value.trim(),
                    role: Util.$('#st-role').value,
                    rating,
                    prestige: Prestige.clamp(Util.$('#st-prestige').value),
                    teamId: Util.$('#st-team').value || null,
                    askingSalary: staffAskingSalary(Util.$('#st-role').value, rating)
                };
                if (!data.name) throw new Error('Name is required.');
                if (person) await DB.update('staff', person.id, data);
                else await DB.create('staff', { ...data, isNPC: true, ownerUid: null });
                Modal.close();
                Util.notify(person ? 'Staff updated.' : 'Staff added. 🧰');
                this.refresh();
            } catch (err) { Util.notify(err.message, 'error'); }
        });
    },

    // Role-aware persona editor. Each role gets the assignment fields the
    // prestige/XP engine reads: agents & crew chiefs → client drivers,
    // crew chiefs & mechanics → team, series owners → their series,
    // track owners → venues, sponsors → sponsored team/driver.
    // Opens AI personas and players' role profiles alike (GM can edit any).
    async personaForm(profileId = null) {
        if (!this.guard()) return;
        const [persona, world, trackLib] = await Promise.all([
            profileId ? DB.get('roleProfiles', profileId) : null,
            DB.loadWorld(true),
            DB.tracks({ force: true }).catch(() => [])
        ]);
        let roles = ROLES.filter(r => r.id !== 'driver' && r.id !== 'team-owner');
        if (persona?.role && !roles.some(r => r.id === persona.role)) {
            const info = Career.roleInfo(persona.role);
            if (info) roles = [info, ...roles];
        }
        const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
        const teams = world.teams.slice().sort(byName);
        const drivers = world.drivers.slice().sort(byName);
        const seriesList = world.series.slice().sort(byName);
        // Track library names (deduped) + any custom venues already on the persona.
        const libNames = [...new Map(trackLib.map(t => [(t.name || '').toLowerCase(), t.name]))
            .values()].filter(Boolean).sort((a, b) => a.localeCompare(b));
        const owned = new Set((persona?.tracks || []).map(t => t.toLowerCase()));
        const customVenues = (persona?.tracks || []).filter(t => !libNames.some(n => n.toLowerCase() === t.toLowerCase()));

        const checkList = (id, items, isChecked) => `
            <div class="stack" id="${id}" style="max-height:180px;overflow-y:auto;gap:.15rem">
                ${items.length ? items.map(it => `
                    <label class="check"><input type="checkbox" value="${Util.esc(it.value)}" ${isChecked(it) ? 'checked' : ''}> ${Util.esc(it.label)}</label>`).join('')
                : '<p class="muted small">Nothing to pick from yet.</p>'}
            </div>`;
        const teamOptions = (selectedId) => `
            <option value="">— None —</option>
            ${teams.map(t => `<option value="${Util.attr(t.id)}" ${selectedId === t.id ? 'selected' : ''}>${Util.esc(t.name)}</option>`).join('')}`;

        Modal.open(`
            ${Modal.header(persona ? (persona.uid ? 'Edit Role Profile' : 'Edit AI Persona') : 'Add AI Persona',
                persona?.uid ? "A player's career profile — changes apply to their career" : 'An AI character filling a league role')}
            <form id="persona-form" class="form-grid">
                <label class="field"><span>Name *</span><input id="pe-name" class="input" required value="${Util.esc(persona?.name || '')}" maxlength="50"></label>
                <div class="form-row">
                    <label class="field"><span>Role</span>
                        <select id="pe-role" class="input">
                            ${roles.map(r => `<option value="${r.id}" ${persona?.role === r.id ? 'selected' : ''}>${r.icon} ${r.label}</option>`).join('')}
                        </select></label>
                    <label class="field"><span>Prestige floor (1–5 ★)</span><input id="pe-prestige" class="input" type="number" min="1" max="5" value="${Prestige.clamp(persona?.prestige)}" title="Minimum star level. Personas also earn prestige XP from the races they're part of — currently ${persona ? Prestige.storedScore(persona) + ' XP (' + Prestige.levelName(Prestige.stored(persona)) + ')' : '0 XP'}."></label>
                </div>
                <label class="field"><span>Bio</span><textarea id="pe-bio" class="input" rows="2" maxlength="300">${Util.esc(persona?.bio || '')}</textarea></label>

                <div class="field pe-only" data-roles="agent,crew-chief" hidden>
                    <span>💼 Client drivers <span class="muted">(they earn a cut of these drivers' race XP)</span></span>
                    ${checkList('pe-clients', drivers.map(d => ({ value: d.id, label: d.name })),
                        (it) => (persona?.clientDriverIds || []).includes(it.value))}
                </div>
                <label class="field pe-only" data-roles="crew-chief,mechanic" hidden><span>🔧 Team</span>
                    <select id="pe-team" class="input">${teamOptions(persona?.teamId)}</select></label>
                <div class="field pe-only" data-roles="series-owner" hidden>
                    <span>🏆 Series they run <span class="muted">(hosting XP every time one of these races completes)</span></span>
                    ${checkList('pe-series', seriesList.map(s => ({ value: s.id, label: s.name })),
                        (it) => (persona?.seriesIds || []).includes(it.value))}
                </div>
                <div class="field pe-only" data-roles="track-owner" hidden>
                    <span>🛣️ Venues they own <span class="muted">(venue XP for every league race hosted there)</span></span>
                    ${checkList('pe-venues', libNames.map(n => ({ value: n, label: n })), (it) => owned.has(it.value.toLowerCase()))}
                    <textarea id="pe-tracks-custom" class="input" rows="2" placeholder="Custom venues not in the track library — one per line">${Util.esc(customVenues.join('\n'))}</textarea>
                </div>
                <div class="form-row pe-only" data-roles="sponsor" hidden>
                    <label class="field"><span>💰 Sponsored team</span>
                        <select id="pe-spon-team" class="input">${teamOptions(persona?.sponsoredTeamId)}</select></label>
                    <label class="field"><span>💰 Sponsored driver</span>
                        <select id="pe-spon-driver" class="input">
                            <option value="">— None —</option>
                            ${drivers.map(d => `<option value="${Util.attr(d.id)}" ${persona?.sponsoredDriverId === d.id ? 'selected' : ''}>${Util.esc(d.name)}</option>`).join('')}
                        </select></label>
                </div>

                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">${persona ? 'Save' : 'Add Persona'}</button>
                </div>
            </form>
        `);

        const syncRoleFields = () => {
            const role = Util.$('#pe-role').value;
            Util.$$('#persona-form .pe-only').forEach(sec => {
                sec.hidden = !sec.dataset.roles.split(',').includes(role);
            });
        };
        Util.$('#pe-role').addEventListener('change', syncRoleFields);
        syncRoleFields();

        Util.$('#persona-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const role = Util.$('#pe-role').value;
                const checked = (sel) => Util.$$(sel + ' input:checked').map(i => i.value);
                let tracks = [];
                if (role === 'track-owner') {
                    tracks = [...checked('#pe-venues'),
                        ...Util.$('#pe-tracks-custom').value.split('\n').map(t => t.trim()).filter(Boolean)];
                    const seen = new Set();
                    tracks = tracks.filter(t => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
                }
                // Fields for the chosen role are saved; the rest are cleared so
                // switching a persona's role never leaves stale assignments.
                const data = {
                    name: Util.$('#pe-name').value.trim(),
                    role,
                    prestige: Prestige.clamp(Util.$('#pe-prestige').value),
                    bio: Util.$('#pe-bio').value.trim(),
                    clientDriverIds: (role === 'agent' || role === 'crew-chief') ? checked('#pe-clients') : [],
                    teamId: (role === 'crew-chief' || role === 'mechanic') ? (Util.$('#pe-team').value || null) : null,
                    seriesIds: role === 'series-owner' ? checked('#pe-series') : [],
                    tracks,
                    sponsoredTeamId: role === 'sponsor' ? (Util.$('#pe-spon-team').value || null) : null,
                    sponsoredDriverId: role === 'sponsor' ? (Util.$('#pe-spon-driver').value || null) : null
                };
                if (!data.name) throw new Error('Name is required.');
                if (persona) await DB.update('roleProfiles', persona.id, data);
                else await DB.create('roleProfiles', { ...data, uid: null, isNPC: true });
                Modal.close();
                Util.notify(persona ? 'Persona updated.' : 'Persona added. 🤖');
                this.refresh();
            } catch (err) { Util.notify(err.message, 'error'); }
        });
    },

    async deleteWorldDoc(collection, id, label) {
        if (!this.guard()) return;
        if (!confirm(`Delete this ${label}?`)) return;
        try {
            await DB.remove(collection, id);
            Util.notify(`Deleted ${label}.`);
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    /* ---------------- Real-World Pack & simulation ---------------- */
    async installPack() {
        if (!this.guard()) return;
        const games = await DB.games({ force: true });
        Modal.open(`
            ${Modal.header('🌍 Install Real-World Pack', 'Championships with full AI grids, ready to race')}
            <form id="rwp-form" class="form-grid">
                <p class="muted small">Installs ${REAL_TRACKS.length} real tracks and ${REAL_WORLD_PACK.length} championships
                    (${REAL_WORLD_PACK.map(p => p.name).join(' · ')}) with full schedules, active seasons, AI teams, drivers,
                    crew, sponsors, agents, and owner personas. Anything that already exists (matched by name) is skipped.</p>
                <label class="field"><span>Which game does this content run in?</span>
                    <select id="rwp-game" class="input">
                        <option value="">— Not tied to a game —</option>
                        ${games.map(g => `<option value="${Util.attr(g.id)}">${Util.esc(g.name)}</option>`).join('')}
                    </select></label>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Install Pack 🌍</button>
                </div>
            </form>
        `);
        Util.$('#rwp-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type=submit]');
            btn.disabled = true;
            btn.textContent = 'Installing…';
            Util.notify('Installing the Real-World Pack — this takes a few seconds…', 'info');
            try {
                const s = await installRealWorldPack(Util.$('#rwp-game').value || null);
                Modal.close();
                Util.notify(`Pack installed: ${s.series} series, ${s.races} races, ${s.teams} teams, ${s.drivers} drivers, ${s.tracks} tracks, ${s.sponsors} sponsors, ${s.personas} AI personas. 🌍`);
                this.refresh();
            } catch (err) {
                Util.notify('Pack install failed: ' + err.message, 'error');
                btn.disabled = false;
                btn.textContent = 'Install Pack 🌍';
            }
        });
    },

    async simRace(raceId) {
        if (!this.guard()) return;
        try {
            await Sim.simulateRace(raceId);
            this.refresh();
            if (App.current.view !== 'admin') App.go(App.current.view, App.current.param);
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    async simSeries(seriesId, onlyNext = false) {
        if (!this.guard()) return;
        try {
            if (!onlyNext && !confirm('Simulate ALL remaining scheduled races in this series?')) return;
            await Sim.simulateSeason(seriesId, { onlyNext });
            if (App.current.view === 'admin') this.refresh();
            else App.go(App.current.view, App.current.param);
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
                            <button class="btn btn-ghost btn-sm" onclick="App.go('profile','${Util.attr(u.id)}')">View profile</button>
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
    /* ---------------- GM Override — total control ---------------- */
    // The Game Master can edit ANYTHING: wallets, names, contract terms,
    // statuses, or any raw document in any collection. These tools bypass
    // every league rule (caps, buyouts, negotiations) on purpose — but money
    // changes still write ledger rows so the books always balance.
    OVERRIDE_COLLECTIONS: ['users', 'drivers', 'teams', 'staff', 'roleProfiles', 'contracts',
        'negotiations', 'recruitment', 'races', 'series', 'seasons', 'games', 'tracks',
        'sponsors', 'challenges', 'challengeClaims', 'raceSignups', 'news', 'ledger',
        'dealershipInventory', 'config'],

    _ovLabel(doc) {
        return doc.name || doc.title || doc.personName || doc.displayName || doc.teamName
            || (doc.message ? doc.message.slice(0, 40) : '') || doc.label || doc.id;
    },

    /* ---------------- Car Numbers (GM auction control) ---------------- */
    _numSeriesId: null,
    async tab_numbers(el) {
        const series = (await DB.series({ force: true }).catch(() => [])).filter(s => (s.status || 'active') === 'active');
        if (!series.length) { el.innerHTML = C.empty('🔢', 'No active series', 'Create a series first — car numbers are scoped to a series.'); return; }
        const sid = this._numSeriesId && series.find(s => s.id === this._numSeriesId) ? this._numSeriesId : series[0].id;
        this._numSeriesId = sid;
        const world = await DB.loadWorld(true);
        const regs = (await Numbers.listForSeries(sid)).sort((a, b) => a.number - b.number);
        const nameOf = (r) => r.ownerType === 'team' ? (world.teamsById[r.ownerId]?.name || 'team') : (world.driversById[r.ownerId]?.name || 'driver');

        el.innerHTML = `
        <section class="panel">
            <div class="panel-head"><h2>🔢 Car Numbers</h2><span class="chip chip-dim">blind sealed-bid · season-close rollover</span></div>
            <div class="form-row" style="align-items:end">
                <label class="field"><span>Series</span><select id="num-series" class="input">${series.map(s => `<option value="${Util.attr(s.id)}" ${s.id === sid ? 'selected' : ''}>${Util.esc(s.name)}</option>`).join('')}</select></label>
                <label class="field"><span>Open auction for #</span><input id="num-open" class="input" type="number" min="0" max="${Numbers.seriesNumberMax(world.seriesById[sid])}"></label>
                <button class="btn btn-primary" id="num-open-go">Open auction</button>
                <button class="btn btn-secondary" id="num-finalize" title="Send un-renewed numbers to public auction">Finalize renewals</button>
            </div>
            <p class="muted small">Highest sealed bid wins at close and is charged then; if they can't pay it cascades to the next bid. Season close (Series → Seasons → Close &amp; crown) revokes numbers never fielded and opens renewal windows.</p>
        </section>
        <section class="panel">
            <div class="panel-head"><h2>Registry — ${Util.esc(world.seriesById[sid]?.name || '')}</h2></div>
            ${regs.length ? `<table class="table">
                <thead><tr><th>#</th><th>Status</th><th>Holder</th><th>Bids</th><th></th></tr></thead>
                <tbody>${await Promise.all(regs.map(async r => {
                    const bids = r.status === 'auction'
                        ? (await DB.list('numberBids', { force: true })).filter(b => b.auctionId === r.auctionId && b.status === 'pending').length : 0;
                    return `<tr>
                        <td class="strong">#${r.number}</td>
                        <td>${Util.esc(r.status)}</td>
                        <td>${(r.status === 'owned' || r.status === 'renewal') ? Util.esc(nameOf(r)) : '—'}</td>
                        <td>${r.status === 'auction' ? bids : '—'}</td>
                        <td class="right">
                            ${r.status === 'auction' ? `<button class="btn btn-primary btn-sm" onclick="Admin.gmResolveAuction('${Util.attr(sid)}',${r.number})">Resolve (${bids})</button>` : ''}
                            ${(r.status === 'owned' || r.status === 'renewal') ? `<button class="btn btn-danger btn-sm" onclick="Admin.gmReleaseNumber('${Util.attr(sid)}',${r.number})">Revoke</button>` : ''}
                        </td>
                    </tr>`;
                })).then(rows => rows.join(''))}</tbody></table>`
                : '<p class="muted small">No numbers in play. Open an auction above.</p>'}
        </section>`;

        Util.$('#num-series', el).addEventListener('change', (e) => { this._numSeriesId = e.target.value; this.render(document.getElementById('view-root')); });
        Util.$('#num-open-go', el).addEventListener('click', () => this.gmOpenAuction(sid, Util.$('#num-open').value));
        Util.$('#num-finalize', el).addEventListener('click', () => this.gmFinalizeRenewals(sid));
    },

    async gmOpenAuction(seriesId, number) {
        if (!this.guard()) return;
        number = Math.round(Number(number));
        if (!Number.isFinite(number) || number < 0) { Util.notify('Enter a valid number.', 'info'); return; }
        try { await Numbers.openAuction(seriesId, number); Util.notify(`Auction open for #${number}. 🔢`); this.refresh(); }
        catch (err) { Util.notify(err.message, 'error'); }
    },
    async gmResolveAuction(seriesId, number) {
        if (!this.guard()) return;
        try {
            const win = await Numbers.resolveAuction(seriesId, number);
            Util.notify(win ? `#${number} sold for ${Economy.fmt(win.amount)}. 🔢` : `No payable bids on #${number} — returned to the pool.`);
            this.refresh();
        } catch (err) { Util.notify(err.message, 'error'); }
    },
    async gmFinalizeRenewals(seriesId) {
        if (!this.guard()) return;
        try { const n = await Numbers.finalizeRenewals(seriesId); Util.notify(`${n} un-renewed number${n === 1 ? '' : 's'} sent to auction.`); this.refresh(); }
        catch (err) { Util.notify(err.message, 'error'); }
    },
    async gmReleaseNumber(seriesId, number) {
        if (!this.guard()) return;
        if (!confirm(`Revoke #${number}? It returns to the available pool.`)) return;
        try { await Numbers._release(seriesId, number, 'gm-revoked'); Util.notify(`#${number} revoked.`); this.refresh(); }
        catch (err) { Util.notify(err.message, 'error'); }
    },

    async tab_override(el) {
        const [users, teams, drivers, contracts] = await Promise.all([
            DB.users({ force: true }).catch(() => []),
            DB.teams({ force: true }),
            DB.drivers({ force: true }),
            DB.contracts({ force: true }).catch(() => [])
        ]);
        const active = contracts.filter(c => c.status === 'active' && c.type !== 'sponsorship');
        const opt = (v, label) => `<option value="${Util.attr(v)}">${Util.esc(label)}</option>`;

        el.innerHTML = `
        <div class="warn-banner">🔧 <strong>Total control.</strong> Everything here bypasses league rules — pay caps, buyouts, negotiations, ownership. Wallet changes still write ledger rows. There is no undo.</div>
        <div class="grid-2">
            <section class="panel">
                <div class="panel-head"><h2>💵 Wallet Override</h2><span class="chip chip-dim">Player and Team wallets are isolated — pick which one</span></div>
                <div class="form-grid">
                    <div class="form-row">
                        <label class="field"><span>Wallet</span><select id="ov-wallet-kind" class="input">
                            <option value="player">👤 Player wallet</option><option value="team">🏢 Team wallet</option></select></label>
                    </div>
                    <label class="field" id="ov-wallet-user-field"><span>Player</span><select id="ov-wallet-user" class="input">
                        ${users.map(u => opt(u.id, `${u.displayName || u.email || u.id} — ${Economy.fmt(Number(u.balance) || 0)}`)).join('')}</select></label>
                    <label class="field hidden" id="ov-wallet-team-field"><span>Team</span><select id="ov-wallet-team" class="input">
                        ${teams.map(t => opt(t.id, `${t.name} — ${Economy.fmt(Number(t.budget) || 0)}`)).join('')}</select></label>
                    <div class="form-row">
                        <label class="field"><span>Operation</span><select id="ov-wallet-op" class="input">
                            <option value="adjust">± Adjust by amount</option><option value="set">= Set exact balance</option></select></label>
                        <label class="field"><span>Amount ($)</span><input id="ov-wallet-amt" class="input" type="number" step="10" value="0"></label>
                    </div>
                    <label class="field"><span>Reason (goes on their ledger)</span><input id="ov-wallet-why" class="input" maxlength="80" placeholder="GM adjustment"></label>
                    <button class="btn btn-primary" id="ov-wallet-go">Apply to wallet 💵</button>
                </div>
            </section>

            <section class="panel">
                <div class="panel-head"><h2>✏️ Renames</h2><span class="chip chip-dim">cascades everywhere the name is stored</span></div>
                <div class="form-grid">
                    <div class="form-row" style="align-items:end">
                        <label class="field"><span>Team</span><select id="ov-team" class="input">${teams.map(t => opt(t.id, t.name)).join('')}</select></label>
                        <label class="field"><span>New name</span><input id="ov-team-name" class="input" maxlength="40"></label>
                        <button class="btn btn-secondary" id="ov-team-go">Rename</button>
                    </div>
                    <div class="form-row" style="align-items:end">
                        <label class="field"><span>Driver</span><select id="ov-driver" class="input">${drivers.map(d => opt(d.id, d.name)).join('')}</select></label>
                        <label class="field"><span>New name</span><input id="ov-driver-name" class="input" maxlength="40"></label>
                        <button class="btn btn-secondary" id="ov-driver-go">Rename</button>
                    </div>
                    <div class="form-row" style="align-items:end">
                        <label class="field"><span>Player account</span><select id="ov-user" class="input">${users.map(u => opt(u.id, u.displayName || u.email || u.id)).join('')}</select></label>
                        <label class="field"><span>New display name</span><input id="ov-user-name" class="input" maxlength="40"></label>
                        <button class="btn btn-secondary" id="ov-user-go">Rename</button>
                    </div>
                </div>
            </section>

            <section class="panel">
                <div class="panel-head"><h2>📜 Contract Override</h2><span class="chip chip-dim">terms, status, buyout waivers</span></div>
                ${active.length ? `<div class="form-grid">
                    <label class="field"><span>Active contract</span><select id="ov-contract" class="input">
                        ${active.map(c => opt(c.id, `${c.personName} ⇄ ${c.teamName} · ${Economy.fmt(c.salary)}/race`)).join('')}</select></label>
                    <div class="form-row">
                        <label class="field"><span>Salary /race</span><input id="ov-c-salary" class="input" type="number" min="0" step="10"></label>
                        <label class="field"><span>Buyout</span><input id="ov-c-buyout" class="input" type="number" min="0" step="10"></label>
                    </div>
                    <div class="form-row">
                        <label class="field"><span>Agreement</span><select id="ov-c-agreement" class="input">
                            <option value="contracted">🔒 Contracted</option><option value="open">🤝 Open</option></select></label>
                        <label class="field"><span>Force status</span><select id="ov-c-status" class="input">
                            ${['active', 'ended', 'released', 'bought-out', 'terminated'].map(s => `<option value="${s}">${s}</option>`).join('')}</select></label>
                    </div>
                    <div class="btn-row">
                        <button class="btn btn-primary" id="ov-c-save">Save contract terms ✓</button>
                        <button class="btn btn-danger" id="ov-c-waive" title="End the contract immediately — no buyout changes hands, team links update">💸 Waive buyout & release now</button>
                    </div>
                    <p class="muted small">Forcing a non-active status on a driver contract also fixes their team links (primary team falls back to their next active deal).</p>
                </div>` : '<p class="muted">No active contracts to override.</p>'}
            </section>

            <section class="panel">
                <div class="panel-head"><h2>🧯 Team Solvency</h2><span class="chip chip-dim">bankruptcy · debt · repossession</span></div>
                <div class="form-grid">
                    <label class="field"><span>Team</span><select id="ov-solv-team" class="input">${teams.map(t => opt(t.id, `${t.name}${t.financialState === 'insolvent' ? ' · INSOLVENT' : ''}`)).join('')}</select></label>
                    <div class="btn-row">
                        <button class="btn btn-secondary" id="ov-solv-flag" title="Force the INSOLVENT flag on now">Flag insolvent</button>
                        <button class="btn btn-primary" id="ov-solv-forgive" title="Zero any debt and lift the flag">🧯 Forgive debt &amp; restore</button>
                        <button class="btn btn-danger" id="ov-solv-repo" title="Free all contracts (no buyout), strip ownership, relist">🏦 Force repossession</button>
                    </div>
                    <ul class="checkered-list">
                        <li>Forgive: writes off debt to $0 and clears the insolvent flag.</li>
                        <li>Repossession: nullifies contracts to open agreements, strips the owner (personal wallet untouched), recomputes marketValue, and relists the team.</li>
                    </ul>
                </div>
            </section>

            <section class="panel">
                <div class="panel-head"><h2>🗄 Raw Document Editor</h2><span class="chip chip-dim">any collection · any field</span></div>
                <div class="form-grid">
                    <div class="form-row" style="align-items:end">
                        <label class="field"><span>Collection</span><select id="ov-coll" class="input">
                            ${this.OVERRIDE_COLLECTIONS.map(c => opt(c, c)).join('')}</select></label>
                        <button class="btn btn-secondary" id="ov-coll-load">Load documents</button>
                    </div>
                    <label class="field"><span>Document</span><select id="ov-doc" class="input"><option value="">— load a collection first —</option></select></label>
                    <label class="field"><span>Document JSON (id and timestamps managed for you)</span>
                        <textarea id="ov-json" class="input" rows="12" spellcheck="false" style="font-family:var(--font-mono,monospace);font-size:.78rem"></textarea></label>
                    <div class="btn-row">
                        <button class="btn btn-primary" id="ov-doc-save">Save document ✓</button>
                        <button class="btn btn-danger" id="ov-doc-del">🗑 Delete document</button>
                    </div>
                    <p id="ov-doc-err" class="form-error"></p>
                </div>
            </section>
        </div>`;

        /* ---- Wallet ---- */
        Util.$('#ov-wallet-kind').addEventListener('change', (e) => {
            Util.$('#ov-wallet-user-field').classList.toggle('hidden', e.target.value === 'team');
            Util.$('#ov-wallet-team-field').classList.toggle('hidden', e.target.value !== 'team');
        });
        Util.$('#ov-wallet-go').addEventListener('click', async () => {
            if (!this.guard()) return;
            try {
                const kind = Util.$('#ov-wallet-kind').value;
                const amt = Math.round(Number(Util.$('#ov-wallet-amt').value) || 0);
                const why = `GM override: ${Util.$('#ov-wallet-why').value.trim() || 'balance adjustment'}`;
                if (kind === 'team') {
                    const teamId = Util.$('#ov-wallet-team').value;
                    const team = teams.find(t => t.id === teamId);
                    const delta = Util.$('#ov-wallet-op').value === 'set' ? amt - (Number(team?.budget) || 0) : amt;
                    if (!delta) { Util.notify('That changes nothing.', 'info'); return; }
                    await Wallet.adjustTeamWallet(teamId, delta, '🔧', why);
                    Util.notify(`Team budget updated (${delta > 0 ? '+' : ''}${Economy.fmt(delta)}) — ledger row written. 🔧`);
                    this.refresh();
                    return;
                }
                const uid = Util.$('#ov-wallet-user').value;
                const user = users.find(u => u.id === uid);
                const delta = Util.$('#ov-wallet-op').value === 'set' ? amt - (Number(user?.balance) || 0) : amt;
                if (!delta) { Util.notify('That changes nothing.', 'info'); return; }
                await Economy.adjustWallet(uid, delta, '🔧', why);
                Util.notify(`Wallet updated (${delta > 0 ? '+' : ''}${Economy.fmt(delta)}) — ledger row written. 🔧`);
                this.refresh();
            } catch (e) { Util.notify(e.message, 'error'); }
        });

        /* ---- Team Solvency ---- */
        Util.$('#ov-solv-flag')?.addEventListener('click', () => this.gmFlagInsolvent(Util.$('#ov-solv-team').value));
        Util.$('#ov-solv-forgive')?.addEventListener('click', () => this.gmForgiveDebt(Util.$('#ov-solv-team').value));
        Util.$('#ov-solv-repo')?.addEventListener('click', () => this.gmRepossess(Util.$('#ov-solv-team').value));

        /* ---- Renames (cascading) ---- */
        Util.$('#ov-team-go').addEventListener('click', () => this.ovRenameTeam(Util.$('#ov-team').value, Util.$('#ov-team-name').value.trim()));
        Util.$('#ov-driver-go').addEventListener('click', () => this.ovRenameDriver(Util.$('#ov-driver').value, Util.$('#ov-driver-name').value.trim()));
        Util.$('#ov-user-go').addEventListener('click', async () => {
            if (!this.guard()) return;
            const name = Util.$('#ov-user-name').value.trim();
            if (!name) { Util.notify('Enter a new display name.', 'info'); return; }
            await DB.update('users', Util.$('#ov-user').value, { displayName: name });
            Util.notify('Player renamed. ✏️'); this.refresh();
        });

        /* ---- Contract override ---- */
        const pickContract = () => active.find(c => c.id === Util.$('#ov-contract')?.value);
        const fillContract = () => {
            const c = pickContract(); if (!c) return;
            Util.$('#ov-c-salary').value = c.salary || 0;
            Util.$('#ov-c-buyout').value = c.buyout || 0;
            Util.$('#ov-c-agreement').value = c.agreement === 'open' ? 'open' : 'contracted';
            Util.$('#ov-c-status').value = c.status;
        };
        Util.$('#ov-contract')?.addEventListener('change', fillContract);
        fillContract();
        Util.$('#ov-c-save')?.addEventListener('click', async () => {
            if (!this.guard()) return;
            try {
                const c = pickContract(); if (!c) return;
                const status = Util.$('#ov-c-status').value;
                const patch = {
                    salary: Math.round(Number(Util.$('#ov-c-salary').value) || 0),
                    buyout: Math.round(Number(Util.$('#ov-c-buyout').value) || 0),
                    agreement: Util.$('#ov-c-agreement').value
                };
                if (status !== c.status && status !== 'active' && c.personKind === 'driver') {
                    await DB.update('contracts', c.id, patch);
                    await Hub._freeDriver(c.personId, c.personUid || null, status, c.id); // fixes team links too
                } else {
                    await DB.update('contracts', c.id, { ...patch, status });
                }
                News.post('🔧', `GM override: ${c.personName} ⇄ ${c.teamName} contract updated`);
                Util.notify('Contract updated. 🔧'); this.refresh();
            } catch (e) { Util.notify(e.message, 'error'); }
        });
        Util.$('#ov-c-waive')?.addEventListener('click', async () => {
            if (!this.guard()) return;
            const c = pickContract(); if (!c) return;
            if (!confirm(`End ${c.personName}'s contract with ${c.teamName} right now, buyout waived?`)) return;
            try {
                if (c.personKind === 'driver') await Hub._freeDriver(c.personId, c.personUid || null, 'released', c.id);
                else {
                    await DB.update('contracts', c.id, { status: 'released', endedAt: Util.todayISO() });
                    const coll = c.roleProfileId ? 'roleProfiles' : 'staff';
                    await DB.update(coll, c.personId, { teamId: null }).catch(() => {});
                }
                News.post('🔧', `GM override: ${c.personName} released from ${c.teamName}, buyout waived`);
                Util.notify(`${c.personName} released — buyout waived. 🔧`); this.refresh();
            } catch (e) { Util.notify(e.message, 'error'); }
        });

        /* ---- Raw document editor ---- */
        let ovDocs = [];
        const err = (m) => { Util.$('#ov-doc-err').textContent = m || ''; };
        Util.$('#ov-coll-load').addEventListener('click', async () => {
            err('');
            try {
                ovDocs = await DB.list(Util.$('#ov-coll').value, { force: true });
                Util.$('#ov-doc').innerHTML = ovDocs.length
                    ? ovDocs.map(d => opt(d.id, `${this._ovLabel(d)} (${d.id.slice(0, 6)}…)`)).join('')
                    : '<option value="">— empty collection —</option>';
                Util.$('#ov-doc').dispatchEvent(new Event('change'));
            } catch (e) { err(e.message); }
        });
        Util.$('#ov-doc').addEventListener('change', () => {
            const d = ovDocs.find(x => x.id === Util.$('#ov-doc').value);
            if (!d) { Util.$('#ov-json').value = ''; return; }
            const { id, createdAt, updatedAt, ...fields } = d;
            Util.$('#ov-json').value = JSON.stringify(fields, null, 2);
        });
        Util.$('#ov-doc-save').addEventListener('click', async () => {
            if (!this.guard()) return;
            err('');
            try {
                const id = Util.$('#ov-doc').value;
                if (!id) throw new Error('Pick a document first.');
                const patch = JSON.parse(Util.$('#ov-json').value);
                await DB.update(Util.$('#ov-coll').value, id, patch);
                Util.notify('Document saved. 🗄');
            } catch (e) { err(e.message); }
        });
        Util.$('#ov-doc-del').addEventListener('click', async () => {
            if (!this.guard()) return;
            const id = Util.$('#ov-doc').value;
            if (!id || !confirm(`Delete this document from "${Util.$('#ov-coll').value}" forever?`)) return;
            try {
                await DB.remove(Util.$('#ov-coll').value, id);
                Util.notify('Document deleted. 🗑');
                Util.$('#ov-coll-load').click();
            } catch (e) { err(e.message); }
        });
    },

    // Rename a team everywhere its name is denormalized.
    async ovRenameTeam(teamId, name) {
        if (!this.guard() || !name) { if (!name) Util.notify('Enter a new team name.', 'info'); return; }
        try {
            await DB.update('teams', teamId, { name });
            const [contracts, negs, rec] = await Promise.all([
                DB.contracts({ force: true }).catch(() => []),
                DB.list('negotiations', { force: true }).catch(() => []),
                DB.recruitment({ force: true }).catch(() => [])
            ]);
            for (const c of contracts.filter(c => c.teamId === teamId)) await DB.update('contracts', c.id, { teamName: name });
            for (const n of negs.filter(n => n.teamId === teamId)) await DB.update('negotiations', n.id, { teamName: name });
            for (const r of rec.filter(r => r.teamId === teamId)) await DB.update('recruitment', r.id, { teamName: name });
            News.post('🔧', `GM override: team renamed to ${name}`);
            Util.notify(`Team renamed to ${name} — cascaded to contracts, deals, and recruitment. ✏️`);
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    // Rename a driver everywhere their name is denormalized.
    async ovRenameDriver(driverId, name) {
        if (!this.guard() || !name) { if (!name) Util.notify('Enter a new driver name.', 'info'); return; }
        try {
            await DB.update('drivers', driverId, { name });
            const [contracts, negs, rec] = await Promise.all([
                DB.contracts({ force: true }).catch(() => []),
                DB.list('negotiations', { force: true }).catch(() => []),
                DB.recruitment({ force: true }).catch(() => [])
            ]);
            for (const c of contracts.filter(c => c.personId === driverId)) await DB.update('contracts', c.id, { personName: name });
            for (const n of negs.filter(n => n.personId === driverId)) await DB.update('negotiations', n.id, { personName: name });
            for (const r of rec.filter(r => r.driverId === driverId)) await DB.update('recruitment', r.id, { driverName: name });
            Util.notify(`Driver renamed to ${name} — cascaded everywhere. ✏️`);
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    async tab_settings(el) {
        const careers = await Careers.list({ force: true });
        const activeName = Careers.nameFor(Careers.activeId);
        const isOwner = Auth.isOwner();
        const requests = isOwner ? await Careers.listRequests() : [];
        const pending = requests.filter(r => r.status === 'pending');
        const decided = requests.filter(r => r.status !== 'pending').slice(0, 6);

        el.innerHTML = `
        ${isOwner ? `
        <section class="panel">
            <div class="panel-head"><h2>📩 New-career requests${pending.length ? ` <span class="badge badge-admin">${pending.length}</span>` : ''}</h2></div>
            <p class="muted">Players and other Game Masters can request a new career mode. Nothing is created until you approve it here.</p>
            ${pending.length ? `<table class="table">
                <thead><tr><th>Requested career</th><th>By</th><th></th></tr></thead>
                <tbody>
                    ${pending.map(r => `<tr>
                        <td><strong>${Util.esc(r.name)}</strong></td>
                        <td class="muted">${Util.esc(r.requestedByLabel || 'A league member')}</td>
                        <td class="right">
                            <button class="btn btn-primary btn-sm" onclick="Admin.careerApprove('${Util.attr(r.id)}')">Approve</button>
                            <button class="btn btn-danger btn-sm" onclick="Admin.careerDeny('${Util.attr(r.id)}')">Deny</button>
                        </td>
                    </tr>`).join('')}
                </tbody></table>`
                : '<p class="muted small">No pending requests.</p>'}
            ${decided.length ? `<hr class="sep"><p class="muted small">Recently: ${decided.map(r => `${Util.esc(r.name)} — ${Util.esc(r.status)}`).join(' · ')}</p>` : ''}
        </section>` : ''}

        <section class="panel">
            <div class="panel-head"><h2>🏁 Career Modes</h2></div>
            <p class="muted">Each career mode is a completely separate world — its own players, teams, drivers, results, money, and Game Master passcode. Nothing crosses between them. You're currently running <strong>${Util.esc(activeName)}</strong>.</p>
            <table class="table">
                <thead><tr><th>Career mode</th><th></th></tr></thead>
                <tbody>
                    ${careers.map(c => {
                        const isActive = c.id === Careers.activeId;
                        const isMain = c.id === Careers.DEFAULT_ID;
                        return `<tr>
                            <td>
                                <strong>${Util.esc(c.name)}</strong>
                                ${isActive ? '<span class="badge badge-admin" style="margin-left:.5rem">Current</span>' : ''}
                                ${isMain ? '<span class="muted small" style="margin-left:.5rem">default</span>' : ''}
                            </td>
                            <td class="right">
                                ${!isActive ? `<button class="btn btn-ghost btn-sm" onclick="Admin.careerSwitch('${Util.attr(c.id)}')">Switch to</button>` : ''}
                                <button class="btn btn-ghost btn-sm" onclick="Admin.careerRename('${Util.attr(c.id)}')">Rename</button>
                                <button class="btn btn-ghost btn-sm" onclick="Admin.careerReset('${Util.attr(c.id)}')">Reset</button>
                                ${(!isMain && !isActive) ? `<button class="btn btn-danger btn-sm" onclick="Admin.careerDelete('${Util.attr(c.id)}')">Delete</button>` : ''}
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
            <hr class="sep">
            <h3>➕ ${isOwner ? 'New career mode' : 'Request a new career mode'}</h3>
            <p class="muted small">${isOwner
                ? 'Creates a fresh, empty career. Players can join it from the sign-in screen; it gets its own Game Master passcode.'
                : 'Only the league owner can create a career directly. Submit a request and the owner will approve it before it goes live.'}</p>
            <form id="career-create-form" class="form-grid" data-mode="${isOwner ? 'create' : 'request'}">
                <label class="field"><span>Name</span><input id="cc-name" class="input" type="text" maxlength="60" placeholder="e.g. Season 2 · GT3 League" required></label>
                <label class="field"><span>Game Master passcode (min 6 chars)</span><input id="cc-pass" class="input" type="password" autocomplete="new-password" required></label>
                <label class="field"><span>Confirm passcode</span><input id="cc-pass2" class="input" type="password" autocomplete="new-password" required></label>
                <button type="submit" class="btn btn-primary">${isOwner ? 'Create Career Mode' : 'Submit request'}</button>
            </form>
        </section>

        <div class="grid-2">
            <section class="panel">
                <div class="panel-head"><h2>🔑 Passcode — ${Util.esc(activeName)}</h2></div>
                <p class="muted">This changes the Game Master passcode for the <strong>${Util.esc(activeName)}</strong> career only. Anyone with it can unlock Game Master for that career on their own device.</p>
                <form id="passcode-form" class="form-grid">
                    <label class="field"><span>Current passcode</span><input id="pc-current" class="input" type="password" autocomplete="current-password"></label>
                    <label class="field"><span>New passcode (min 6 chars)</span><input id="pc-new" class="input" type="password" autocomplete="new-password"></label>
                    <button type="submit" class="btn btn-primary">Change Passcode</button>
                </form>
            </section>

            <section class="panel">
                <div class="panel-head"><h2>💾 Data — ${Util.esc(activeName)}</h2></div>
                <p class="muted">Download a full JSON backup of every collection in this career.</p>
                <button class="btn btn-secondary" id="export-btn">⬇ Export Career Backup</button>
                <hr class="sep">
                <p class="muted small">Standings and statistics are always computed live from race results — there is nothing to rebuild and nothing that can drift out of sync.</p>
            </section>
        </div>`;

        Util.$('#career-create-form', el).addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = Util.$('#cc-name').value;
            const pass = Util.$('#cc-pass').value;
            const pass2 = Util.$('#cc-pass2').value;
            if (pass !== pass2) { Util.notify('The two passcodes do not match.', 'error'); return; }
            const btn = e.target.querySelector('button[type=submit]');
            btn.disabled = true;
            try {
                if (e.target.dataset.mode === 'create') {
                    await Careers.create(name, pass);
                    Util.notify(`Career “${name.trim()}” created. Players can now join it from sign-in. 🏁`);
                } else {
                    await Careers.requestCreate(name, pass);
                    Util.notify('Request submitted — the league owner will review it. 📩');
                }
                this.render(el);
            } catch (err) { Util.notify(err.message, 'error'); btn.disabled = false; }
        });

        Util.$('#passcode-form', el).addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                await Auth.changePasscode(Util.$('#pc-current').value, Util.$('#pc-new').value);
                Util.notify(`Passcode changed for ${Careers.nameFor(Careers.activeId)}.`);
                e.target.reset();
            } catch (err) { Util.notify(err.message, 'error'); }
        });

        Util.$('#export-btn', el).addEventListener('click', async () => {
            try {
                const backup = { exportedAt: new Date().toISOString(), career: Careers.nameFor(Careers.activeId) };
                for (const c of DB.WORLD_COLLECTIONS) {
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
    },

    /* ---------------- Career mode management ---------------- */
    careerSwitch(id) { App.switchCareer(id); },

    async careerApprove(reqId) {
        try {
            const id = await Careers.approveRequest(reqId);
            Util.notify(`Approved — “${Careers.nameFor(id)}” is live. Players can join it from sign-in. 🏁`);
            this.refresh();
        } catch (err) { Util.notify(err.message, 'error'); }
    },

    async careerDeny(reqId) {
        try {
            await Careers.denyRequest(reqId);
            Util.notify('Request denied.');
            this.refresh();
        } catch (err) { Util.notify(err.message, 'error'); }
    },

    /* ---------------- Team solvency (bankruptcy override) ---------------- */
    async gmFlagInsolvent(teamId) {
        if (!this.guard() || !teamId) return;
        try {
            await DB.update('teams', teamId, { financialState: 'insolvent', insolventAt: Util.todayISO() });
            const t = await DB.get('teams', teamId);
            News.post('🧯', `${t?.name || 'A team'} flagged insolvent by the league office.`);
            Util.notify('Team flagged insolvent.'); this.refresh();
        } catch (err) { Util.notify(err.message, 'error'); }
    },

    async gmForgiveDebt(teamId) {
        if (!this.guard() || !teamId) return;
        try {
            const t = await DB.get('teams', teamId, { force: true });
            const debt = Number(t?.budget) || 0;
            if (debt < 0) await Wallet.adjustTeamWallet(teamId, -debt, '🧯', 'GM: debt forgiven');
            await DB.update('teams', teamId, { financialState: 'solvent', insolventAt: null, insolventRaces: 0 });
            News.post('🧯', `${t?.name || 'A team'}'s debt was forgiven by the league office.`);
            Util.notify('Debt forgiven — solvency restored.'); this.refresh();
        } catch (err) { Util.notify(err.message, 'error'); }
    },

    async gmRepossess(teamId) {
        if (!this.guard() || !teamId) return;
        const t = await DB.get('teams', teamId);
        if (!t?.ownerUid) { Util.notify('That team has no owner to repossess from.', 'info'); return; }
        if (!confirm(`Force repossession of ${t.name}? Contracts are freed without penalty, the owner is stripped, and the team is relisted.`)) return;
        try {
            await Insolvency.repossess(teamId, { reason: 'GM action' });
            this.refresh();
        } catch (err) { Util.notify(err.message, 'error'); }
    },

    careerRename(id) {
        const current = Careers.nameFor(id);
        Modal.open(`
            ${Modal.header('✏️ Rename career mode', '')}
            <form id="career-rename-form" class="form-grid">
                <label class="field"><span>Name</span><input id="cr-name" class="input" type="text" maxlength="60" value="${Util.esc(current)}" required autofocus></label>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save</button>
                </div>
            </form>`);
        document.getElementById('career-rename-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                await Careers.rename(id, document.getElementById('cr-name').value);
                Modal.close();
                Util.notify('Career renamed.');
                App.updateHeader();
                this.refresh();
            } catch (err) { Util.notify(err.message, 'error'); }
        });
    },

    // Wipe a career's world but keep the shell (name + passcode). Confirm by
    // typing the exact name — this is irreversible.
    careerReset(id) {
        const name = Careers.nameFor(id);
        Modal.open(`
            ${Modal.header('♻️ Reset career', `This permanently deletes every series, race, team, driver, result, contract, and wallet in <strong>${Util.esc(name)}</strong>. Player logins are kept — they simply re-join a blank career. The career itself and its passcode stay. This cannot be undone.`)}
            <form id="career-reset-form" class="form-grid">
                <label class="field"><span>Type <strong>${Util.esc(name)}</strong> to confirm</span><input id="cx-name" class="input" type="text" autocomplete="off" required autofocus></label>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-danger">Reset career</button>
                </div>
            </form>`);
        document.getElementById('career-reset-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (document.getElementById('cx-name').value.trim() !== name) { Util.notify('Name did not match.', 'error'); return; }
            const btn = e.target.querySelector('button[type=submit]');
            btn.disabled = true; btn.textContent = 'Resetting…';
            try {
                const n = await DB.wipeCareer(id);
                Modal.close();
                Util.notify(`Reset “${name}” — cleared ${n} record${n === 1 ? '' : 's'}.`);
                if (id === Careers.activeId) App.go('dashboard');
                else this.refresh();
            } catch (err) { Util.notify(err.message, 'error'); btn.disabled = false; btn.textContent = 'Reset career'; }
        });
    },

    // Delete a career entirely: wipe its world then remove the registry doc.
    careerDelete(id) {
        const name = Careers.nameFor(id);
        Modal.open(`
            ${Modal.header('🗑 Delete career', `This deletes <strong>${Util.esc(name)}</strong> and all of its data forever. This cannot be undone.`)}
            <form id="career-delete-form" class="form-grid">
                <label class="field"><span>Type <strong>${Util.esc(name)}</strong> to confirm</span><input id="cd-name" class="input" type="text" autocomplete="off" required autofocus></label>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-danger">Delete career</button>
                </div>
            </form>`);
        document.getElementById('career-delete-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (document.getElementById('cd-name').value.trim() !== name) { Util.notify('Name did not match.', 'error'); return; }
            const btn = e.target.querySelector('button[type=submit]');
            btn.disabled = true; btn.textContent = 'Deleting…';
            try {
                await DB.wipeCareer(id);
                await Careers.deleteCareer(id);
                Modal.close();
                Util.notify(`Deleted “${name}”.`);
                this.refresh();
            } catch (err) { Util.notify(err.message, 'error'); btn.disabled = false; btn.textContent = 'Delete career'; }
        });
    }
};
window.Admin = Admin;
