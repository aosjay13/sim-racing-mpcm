/* ============================================================
   Phoenix SRMPC — Racing Library (shared with Solo Career)
   The league runs on the same game, series, track and results
   data as the Solo Career (js/solo/sc-tracks.js, sc-gamedb.js,
   sc-names.js, sc-import.js), so both modes speak one language:

   - Game library: install any of the Solo Career's games with its
     real series (points systems, cars) and track list.
   - Track info: type, lap length and country for any track name.
   - Race briefing: "set this up in your game" for every race —
     distance, weather, time of day, lobby realism, results file.
   - Results import: rFactor/LMU/AMS XML, GTR2/RACE 07 logs,
     NR2003 HTML, iRacing CSV, AC/ACC JSON, any CSV, or a pasted
     finishing order, matched to league drivers by name/number.
   - Driver self-reports: racers log their own result after the
     race (like the Solo Career), the GM's results form pre-fills.
   Everything degrades gracefully if the shared files are missing.
   ============================================================ */
'use strict';

const Library = {
    ok() { return !!(window.SC && Array.isArray(SC.GAMES) && SC.track); },
    _norm(s) {
        return window.SC?.Import ? SC.Import.norm(s)
            : String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    },

    /* ---------------- Tracks ---------------- */
    _index: null,
    _buildIndex() {
        const idx = new Map();
        // SC.track() only answers exact names, so index every library name
        // (and the name without any "(…)" part) for forgiving lookups.
        const names = new Set();
        SC.GAMES.forEach(g => (g.tracks || []).forEach(n => names.add(n)));
        Object.keys(SC.TRACKS || {}).forEach(n => names.add(n));
        names.forEach(n => {
            const t = SC.track(n);
            if (!t || t.custom) return;
            idx.set(this._norm(n), t);
            const bare = this._norm(n.replace(/\(.*?\)/g, ''));
            if (bare && !idx.has(bare)) idx.set(bare, t);
        });
        this._index = idx;
    },
    // Library info for a free-typed track name, or null if we don't know it.
    track(name) {
        if (!this.ok() || !name) return null;
        const exact = SC.track(name);
        if (exact && !exact.custom) return exact;
        if (!this._index) this._buildIndex();
        const n = this._norm(name);
        if (this._index.has(n)) return this._index.get(n);
        const bare = this._norm(String(name).replace(/\(.*?\)/g, ''));
        if (this._index.has(bare)) return this._index.get(bare);
        // "Circuit de Spa-Francorchamps" → "Spa-Francorchamps", "Watkins Glen International" → "Watkins Glen".
        let best = null;
        for (const [k, t] of this._index) {
            if (k.length < 5) continue;
            if ((n.includes(k) || k.includes(n) && n.length >= 5) && (!best || k.length > best[0].length)) best = [k, t];
        }
        return best ? best[1] : null;
    },
    typeInfo(type) { return (this.ok() && (SC.TRACK_TYPES[type] || SC.TRACK_TYPES.rd)) || { label: 'Circuit', icon: '🛣️' }; },
    trackChip(name) {
        const t = this.track(name);
        if (!t) return '';
        const ti = this.typeInfo(t.type);
        return `<span class="chip chip-dim" title="${Util.esc(ti.label)}">${ti.icon} ${Util.esc(ti.label)}</span>`;
    },

    /* ---------------- Nations (same list as the Solo Career) ---------------- */
    nations() {
        return this.ok() && SC.NATIONS ? Object.entries(SC.NATIONS).sort((a, b) => a[1].name.localeCompare(b[1].name)) : [];
    },
    // A driver's nation code: stored `nat`, else a match on the free-text country.
    natOf(person) {
        if (!person) return null;
        if (person.nat && SC.NATIONS?.[person.nat]) return person.nat;
        const c = this._norm(person.country);
        if (!c) return null;
        const hit = this.nations().find(([code, n]) => this._norm(n.name) === c || this._norm(code) === c
            || (c === 'uk' && code === 'GBR') || (c === 'us' && code === 'USA') || (c === 'united states of america' && code === 'USA'));
        return hit ? hit[0] : null;
    },
    flag(person) { const n = this.natOf(person); return n ? SC.NATIONS[n].flag : ''; },
    nationSelect(id, value) {
        const list = this.nations();
        if (!list.length) return `<input id="${id}" class="input" maxlength="30" value="${Util.esc(value || '')}" placeholder="e.g. USA">`;
        return `<select id="${id}" class="input"><option value="">— Choose —</option>${list.map(([code, n]) =>
            `<option value="${code}" ${value === code ? 'selected' : ''}>${n.flag} ${Util.esc(n.name)}</option>`).join('')}</select>`;
    },
    // Read a nationSelect back into { nat, country } (country keeps older views working).
    readNation(id) {
        const v = Util.$('#' + id)?.value || '';
        if (this.ok() && SC.NATIONS?.[v]) return { nat: v, country: SC.NATIONS[v].name };
        return { nat: null, country: v.trim() };
    },

    /* ---------------- Games & series ---------------- */
    libGameFor(game) {
        if (!game || !this.ok()) return null;
        if (game.libraryId) return SC.game(game.libraryId);
        if (game.libraryId === null || game.libraryId === '') return null; // GM unlinked it on purpose
        const n = this._norm(game.name);
        if (!n) return null;
        return SC.GAMES.find(g => this._norm(g.name) === n || this._norm(g.short) === n)
            || SC.GAMES.find(g => { const s = this._norm(g.short); return s.length >= 4 && (n.includes(s) || n.includes(this._norm(g.name))); })
            || null;
    },
    libSeriesFor(series, game) {
        if (!series || !this.ok() || !series.libraryId) return null;
        const lg = (series.libraryGame && SC.game(series.libraryGame)) || this.libGameFor(game);
        return lg ? SC.seriesOf(lg, series.libraryId) : null;
    },
    // Solo points ids → league POINTS_SYSTEMS ids (identical tables share an id).
    POINTS_MAP: { gt: 'motogp' },
    leaguePoints(scId) {
        if (window.POINTS_SYSTEMS?.[scId]) return scId;
        return this.POINTS_MAP[scId] || 'f1';
    },
    ladderLabel(id) { return (this.ok() && SC.LADDERS[id]?.label) || 'Series'; },

    // A library series' real calendar as schedule-builder lines ("Track | laps").
    calendarLines(game, sd, pct = 1) {
        if (!sd) return [];
        const len = sd.len || {};
        let entries = (sd.cal || []).map(e => { const [t, l] = String(e).split('|'); return { t: t.trim(), laps: l ? Number(l) : null }; });
        if (!entries.length) {
            const pool = (game.tracks || []).filter(n => !sd.pool || sd.pool.includes(SC.track(n).type));
            entries = pool.slice(0, sd.rounds || 10).map(t => ({ t, laps: null }));
        }
        return entries.map(e => {
            const tr = SC.track(e.t);
            let laps = e.laps || len.laps || (len.km && tr.km ? Math.round(len.km / Math.max(0.3, tr.km)) : null);
            if (laps) laps = Math.max(Math.min(laps, 5), Math.round(laps * pct));
            return laps && !len.stages && !len.mins ? `${e.t} | ${laps}` : e.t;
        });
    },

    /* ---------------- Install from the library (GM) ---------------- */
    async installForm() {
        if (!Admin.guard()) return;
        if (!this.ok()) { Util.notify('The shared game library did not load — reload the page.', 'error'); return; }
        const games = await DB.games({ force: true });
        const installed = new Set(games.map(g => g.libraryId || this.libGameFor(g)?.id).filter(Boolean));
        Modal.open(`
            ${Modal.header('📚 Game Library', 'The same games, series, points and tracks as the Solo Career — pick one to add to the league')}
            <input id="lib-filter" class="input" placeholder="Search games…" style="margin-bottom:.8rem">
            <div class="lib-grid" id="lib-grid">${SC.GAMES.map(g => `
                <button type="button" class="lib-game" data-lib="${Util.attr(g.id)}" style="--gc:${Util.esc(g.color)}">
                    <span class="lib-game-icon">${g.icon}</span>
                    <span class="lib-game-name">${Util.esc(g.name)}</span>
                    <span class="muted small">${Util.esc(g.dev || '')} · ${g.year} · ${g.series.length} series · ${g.tracks.length} tracks</span>
                    ${installed.has(g.id) ? '<span class="badge badge-green">In the league</span>' : ''}
                </button>`).join('')}</div>
        `, { wide: true });
        Util.$('#lib-filter').addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            Util.$$('#lib-grid .lib-game').forEach(b => { b.style.display = b.innerText.toLowerCase().includes(q) ? '' : 'none'; });
        });
        Util.$$('#lib-grid [data-lib]').forEach(b => b.addEventListener('click', () => this.installGameForm(b.dataset.lib)));
    },

    async installGameForm(libId) {
        const g = SC.game(libId);
        if (!g) return;
        const [games, series] = await Promise.all([DB.games({ force: true }), DB.series({ force: true })]);
        const existing = games.find(x => x.libraryId === g.id) || games.find(x => this.libGameFor(x)?.id === g.id);
        const have = new Set(series.filter(s => existing && s.gameId === existing.id && s.libraryId).map(s => s.libraryId));
        const ladders = SC.laddersOf(g);
        Modal.open(`
            ${Modal.header(`${g.icon} ${g.name}`, `${g.dev || ''} · ${g.year} · ${g.platform}`)}
            <form id="lib-install" class="form-grid">
                <p class="muted small">${Util.esc(g.blurb || '')}</p>
                ${existing ? `<p class="small">✅ Already in the league as <strong>${Util.esc(existing.name)}</strong> — installing adds any series and tracks it's missing.</p>` : ''}
                <div class="lib-series">${ladders.map(L => `
                    <div><h4 class="section-label">${L.icon} ${Util.esc(L.label)}</h4>
                    ${L.series.map(s => `<label class="check"><input type="checkbox" data-sd="${Util.attr(s.id)}" ${have.has(s.id) ? 'disabled' : 'checked'}>
                        <span><strong>${Util.esc(s.name)}</strong> <span class="muted small">— ${Util.esc(s.car)} · ${Util.esc(window.POINTS_SYSTEMS?.[this.leaguePoints(s.points)]?.label || s.points)} points${have.has(s.id) ? ' · already installed' : ''}</span></span></label>`).join('')}
                    </div>`).join('')}</div>
                <div class="form-row">
                    <label class="field"><span>Season / year</span><input id="lib-year" class="input" type="number" value="${new Date().getFullYear()}"></label>
                    <label class="field"><span>AI field per series (cars, 0 = none)</span><input id="lib-ai" class="input" type="number" min="0" max="40" value="12"></label>
                </div>
                <label class="check"><input id="lib-tracks" type="checkbox" checked> Add its ${g.tracks.length} tracks to the track library</label>
                <p class="muted small">The AI field creates rival teams (two cars each) and drivers for every new series, named like the Solo Career's world — they fill simulated grids and are teams players can apply to.</p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" id="lib-back">← All games</button>
                    <button type="submit" class="btn btn-primary">Install ${Util.esc(g.short)} 📚</button>
                </div>
            </form>`, { wide: true });
        Util.$('#lib-back').addEventListener('click', () => this.installForm());
        Util.$('#lib-install').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type=submit]');
            btn.disabled = true; btn.textContent = 'Installing…';
            try {
                const seriesIds = Util.$$('#lib-install [data-sd]').filter(c => c.checked && !c.disabled).map(c => c.dataset.sd);
                const r = await this.install(g.id, seriesIds, {
                    tracks: Util.$('#lib-tracks').checked, year: Number(Util.$('#lib-year').value) || new Date().getFullYear(),
                    aiField: Math.max(0, Math.min(40, Number(Util.$('#lib-ai').value) || 0))
                });
                Modal.close();
                Util.notify(`${g.short} installed: ${r.series} series, ${Util.plural(r.tracks, 'track')}${r.drivers ? `, ${Util.plural(r.teams, 'AI team')} with ${Util.plural(r.drivers, 'driver')}` : ''}. Build a schedule next. 📚`);
                Admin.refresh();
            } catch (err) {
                Util.notify(err.message, 'error');
                btn.disabled = false; btn.textContent = `Install ${g.short} 📚`;
            }
        });
    },

    // Idempotent: reuses the game if it's already in the league, skips series
    // and tracks that are already there.
    async install(libId, seriesIds = null, { tracks = true, year = new Date().getFullYear(), aiField = 0 } = {}) {
        const g = SC.game(libId);
        if (!g) throw new Error('Unknown game.');
        const games = await DB.games({ force: true });
        let game = games.find(x => x.libraryId === g.id) || games.find(x => this.libGameFor(x)?.id === g.id);
        let gameId = game?.id;
        const gameData = { libraryId: g.id, short: g.short, icon: g.icon, dev: g.dev || '', year: g.year };
        if (gameId) await DB.update('games', gameId, gameData);
        else gameId = await DB.create('games', { name: g.name, platform: g.platform || '', color: g.color, active: true, ...gameData });

        const series = await DB.series({ force: true });
        const have = new Set(series.filter(s => s.gameId === gameId && s.libraryId).map(s => s.libraryId));
        const wanted = g.series.filter(s => (!seriesIds || seriesIds.includes(s.id)) && !have.has(s.id));
        if (!wanted.length && !tracks) throw new Error('Nothing new to install — pick at least one series.');
        const out = { gameId, series: wanted.length, tracks: 0, teams: 0, drivers: 0 };
        const usedNames = new Set((await DB.drivers({ force: true })).map(d => d.name));
        const usedTeams = new Set((await DB.teams({ force: true })).map(t => (t.name || '').toLowerCase()));
        for (const sd of wanted) {
            const seriesId = await DB.create('series', {
                name: sd.name, gameId, season: year,
                pointsSystem: this.leaguePoints(sd.points), status: 'active',
                numberMax: 99, carChoices: [],
                description: `${sd.car}${sd.mod ? ` · ${sd.mod}` : ''}${sd.dlc ? ` · DLC: ${sd.dlc}` : ''}`,
                libraryId: sd.id, libraryGame: g.id, ladder: sd.ladder || null, tier: sd.tier || null,
                format: sd.format || 'race', grid: Math.min(sd.grid || 20, g.maxGrid || 60)
            });
            if (aiField > 0) {
                const f = await this.aiField(g, sd, seriesId, Math.min(aiField, sd.grid || aiField), usedNames, usedTeams);
                out.teams += f.teams; out.drivers += f.drivers;
            }
        }

        let createdTracks = 0;
        if (tracks) {
            const existing = await DB.tracks({ force: true }).catch(() => []);
            const mine = new Set(existing.filter(t => (t.gameId || null) === gameId).map(t => (t.name || '').toLowerCase()));
            const fresh = g.tracks.filter(n => !mine.has(n.toLowerCase())).map(n => {
                const t = SC.track(n);
                return { name: n, gameId, country: t.country || '', type: this.typeInfo(t.type).label, libType: t.type, length: t.km ? `${t.km.toFixed(2)} km` : '', isNPC: true };
            });
            for (let i = 0; i < fresh.length; i += 400) await DB.batchCreate('tracks', fresh.slice(i, i + 400));
            createdTracks = fresh.length;
        }
        out.tracks = createdTracks;
        return out;
    },

    // Rival teams (two cars each) + drivers for one series, named from the
    // game's nation mix the way the Solo Career builds its world. Ratings
    // climb with the series tier, so top-rung fields are faster.
    async aiField(g, sd, seriesId, cars, usedNames, usedTeams) {
        const rand = (n) => Math.floor(Math.random() * n);
        const pickW = (obj) => { const e = Object.entries(obj); let r = Math.random() * e.reduce((t, [, w]) => t + w, 0); for (const [k, w] of e) { r -= w; if (r <= 0) return k; } return e[0][0]; };
        const mix = SC.NATION_MIX?.[g.id] || { USA: 40, GBR: 20, GER: 15, ITA: 10, FRA: 10, BRA: 5 };
        const personName = () => {
            for (let i = 0; i < 60; i++) {
                const nat = pickW(mix); const N = SC.NATIONS[nat];
                const name = `${N.first[rand(N.first.length)]} ${N.last[rand(N.last.length)]}`;
                if (!usedNames.has(name)) { usedNames.add(name); return { name, nat }; }
            }
            const name = `Driver ${usedNames.size + 1}`; usedNames.add(name); return { name, nat: null };
        };
        const styles = SC.TEAM_STYLE[sd.ladder] || SC.TEAM_STYLE.custom;
        const teamName = () => {
            for (let i = 0; i < 60; i++) {
                const w = SC.TEAM_WORDS[rand(SC.TEAM_WORDS.length)];
                const nat = pickW(mix); const N = SC.NATIONS[nat];
                const sur = N.last[rand(N.last.length)], sur2 = N.last[rand(N.last.length)];
                const name = styles[rand(styles.length)](w, sur, SC.TEAM_PLACES[rand(SC.TEAM_PLACES.length)], sur2);
                if (!usedTeams.has(name.toLowerCase())) { usedTeams.add(name.toLowerCase()); return name; }
            }
            return `${sd.short} Team ${usedTeams.size + 1}`;
        };
        const tier = Number(sd.tier) || 3;
        const lo = Math.max(45, 78 - tier * 5), hi = Math.min(97, lo + 22);
        const colors = ['#e11d2e', '#1d4ed8', '#16a34a', '#f59e0b', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#475569', '#0f766e', '#be123c'];
        const res = { teams: 0, drivers: 0 };
        const nTeams = Math.max(1, Math.ceil(cars / 2));
        for (let i = 0; i < nTeams; i++) {
            const make = sd.makes?.length ? sd.makes[i % sd.makes.length] : null;
            const teamId = await DB.create('teams', {
                name: teamName(), color: colors[i % colors.length],
                description: `AI team in the ${sd.name}${make ? ` · ${make}` : ''}.`,
                recruiting: true, isEstablished: true, isNPC: true, ownerUid: null, status: 'approved', seriesId,
                make: make || null, budget: window.Wallet?.TEAM_DIFFICULTIES?.medium?.teamStart ?? 50000
            });
            res.teams++;
            const seats = Math.min(2, cars - i * 2);
            const drivers = [];
            for (let k = 0; k < seats; k++) {
                const base = typeof makeNpcDriver === 'function' ? makeNpcDriver(usedNames, teamId) : { teamId, ownerUid: null, status: 'approved', isNPC: true };
                const who = personName();
                const rating = lo + rand(hi - lo + 1);
                drivers.push({
                    ...base, name: who.name, nat: who.nat, country: who.nat ? SC.NATIONS[who.nat].name : (base.country || ''),
                    rating, askingSalary: typeof driverAskingSalary === 'function' ? driverAskingSalary(rating) : base.askingSalary,
                    seriesId, teamId
                });
            }
            if (drivers.length) { await DB.batchCreate('drivers', drivers); res.drivers += drivers.length; }
        }
        return res;
    },

    /* ---------------- Race conditions & briefing ---------------- */
    _rng(seed) {
        let h = 2166136261;
        for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
        let a = h >>> 0;
        return () => {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    },
    // Same weather model as the Solo Career, seeded by the race so every
    // driver in the league sees the same forecast.
    conditions(race) {
        if (race.conditions?.cond) return race.conditions;
        const tr = this.track(race.track);
        const type = tr?.type || 'rd';
        const r = this._rng(`${race.id || ''}|${race.track || ''}|${race.date || ''}`);
        const rainChance = ['ss', 'ov', 'so', 'dt', 'ar'].includes(type) ? 0 : ((this.ok() && SC.RAIN[tr?.country]) ?? 0.12);
        const roll = r();
        const cond = roll < rainChance * 0.55 ? 'Wet' : roll < rainChance ? 'Mixed (rain later)' : r() < 0.3 ? 'Overcast' : 'Clear';
        const temp = Math.round(cond === 'Wet' ? 9 + r() * 9 : 14 + r() * 18);
        const time = tr?.night ? 'Night' : ['Afternoon', 'Afternoon', 'Late afternoon', 'Midday'][Math.floor(r() * 4)];
        return { cond, temp, time };
    },
    wxIcon(cond) { return cond === 'Wet' ? '🌧️' : String(cond).startsWith('Mixed') ? '🌦️' : cond === 'Overcast' ? '☁️' : '☀️'; },

    realism(sd, tr, race) {
        const h = [];
        const type = tr?.type;
        if (sd?.format === 'derby' || type === 'ar') h.push('Last car standing — damage on, no respawns.');
        else {
            h.push(sd && sd.tier && sd.tier <= 2 ? 'Damage: Full · Tyre wear: Real · Fuel: Real' : 'Damage: Full or Realistic · Tyre wear & fuel: On');
            if (['ss', 'ov', 'so', 'dt'].includes(type)) h.push('Cautions / yellow flags: On if the game supports them.');
            h.push('Ghosting and collisions: On for the race start.');
        }
        return h;
    },

    // "Set this up in your game" — shown on every upcoming race.
    briefing(race, world, entrants = 0) {
        const game = world.gamesById[race.gameId];
        const series = world.seriesById[race.seriesId];
        const lg = this.libGameFor(game);
        const sd = this.libSeriesFor(series, game);
        const tr = this.track(race.track);
        const ti = tr ? this.typeInfo(tr.type) : null;
        const wx = this.conditions(race);
        const km = tr?.km && race.laps ? Math.round(race.laps * tr.km) : null;
        const length = race.laps ? `${race.laps} laps${km ? ` (≈ ${km} km)` : ''}`
            : sd?.len?.mins ? `${sd.len.mins} minutes` : sd?.len?.stages ? `${sd.len.stages} stages` : 'Set by the host';
        const gridMax = Math.min(Number(series?.grid) || sd?.grid || 24, lg?.maxGrid || 60);
        const ai = lg?.ai;
        const rows = [
            ['Game', `${lg ? lg.icon + ' ' : ''}${Util.esc(game?.name || lg?.name || '—')}`],
            sd ? ['Car', Util.esc(sd.car)] : null,
            ['Track', `${Util.esc(race.track || '—')}${ti ? ` <span class="muted">· ${ti.icon} ${Util.esc(ti.label)}${tr.km ? ` · ${tr.km} km lap` : ''}${tr.country ? ` · ${Util.esc(tr.country)}` : ''}</span>` : ''}`],
            ['Distance', Util.esc(length)],
            ['Start', `${Util.esc(Util.fmtDate(race.date))}${race.time ? ' · ' + Util.esc(Util.fmtTime(race.time)) : ''}`],
            ['Weather', `${this.wxIcon(wx.cond)} ${Util.esc(wx.cond)}, ${wx.temp}°C · ${Util.esc(wx.time)}`],
            ['Grid', `${entrants} signed up${gridMax ? ` · up to ${gridMax} cars` : ''}${ai ? ` · AI fill: ${Util.esc(ai.label)} ${ai.kind === 'steps' ? Util.esc(ai.def) : ai.def + (ai.unit || '')}` : ''}`],
            ['Lobby', this.realism(sd, tr, race).map(Util.esc).join('<br>')],
            lg ? ['Results', Util.esc(lg.formats.map(f => SC.RESULT_FORMATS[f] || f).join(' · '))] : null
        ].filter(Boolean);
        const text = [`${race.name || race.track} — ${series?.name || ''}`.trim(),
            ...rows.map(([k, v]) => `${k}: ${String(v).replace(/<br>/g, '; ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')}`)].join('\n');
        return `
            <section class="lib-brief">
                <h3 class="section-label">🎮 Set this up in ${Util.esc(lg?.short || game?.name || 'your game')}</h3>
                <dl class="lib-brief-grid">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
                <button type="button" class="btn btn-ghost btn-sm" data-copy-setup="${Util.esc(text)}">📋 Copy setup</button>
            </section>`;
    },
    wireBriefing(root = document) {
        Util.$$('[data-copy-setup]', root).forEach(b => b.addEventListener('click', () => {
            const text = b.dataset.copySetup;
            const done = () => Util.notify('Setup copied — paste it in the lobby chat or your notes. 📋');
            if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => Util.notify('Copy failed — select the text manually.', 'error'));
            else done();
        }));
    },

    /* ---------------- Results import (GM results form) ---------------- */
    importPanel(race, world) {
        if (!this.ok() || !SC.Import) return '';
        const lg = this.libGameFor(world.gamesById[race.gameId]);
        return `
            <details class="lib-import">
                <summary>📂 Import a results file or paste the finishing order</summary>
                <p class="muted small">${lg ? `Best for ${Util.esc(lg.short)}: ${Util.esc(lg.formats.map(f => SC.RESULT_FORMATS[f] || f).join(' · '))}. ` : ''}Any supported sim works: rFactor / LMU / AMS XML, GTR2 / RACE 07 logs, NR2003 HTML, iRacing CSV, AC / ACC JSON.</p>
                <div class="form-row">
                    <label class="field"><span>Results file</span><input id="lib-im-file" class="input" type="file" accept=".xml,.txt,.html,.htm,.csv,.json,.tsv"></label>
                    <label class="field"><span>…or paste</span><textarea id="lib-im-text" class="input" rows="4" placeholder="1. Driver Name&#10;2. Driver Name&#10;3. Driver Name - DNF"></textarea></label>
                </div>
                <label class="check"><input id="lib-im-renum" type="checkbox" checked> Re-number positions among league drivers (skip AI / guests in the lobby)</label>
                <button type="button" class="btn btn-secondary btn-sm" id="lib-im-read">🔍 Read results</button>
                <div id="lib-im-map"></div>
            </details>`;
    },
    _entrant(d) {
        const parts = String(d.name || '').trim().split(/\s+/);
        return { id: d.id, first: parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '', last: parts.length > 1 ? parts[parts.length - 1] : parts[0] || '', num: Number(d.number) || null, nick: d.nick || '' };
    },
    wireImport(race, world, drivers, apply) {
        const btn = Util.$('#lib-im-read');
        if (!btn) return;
        let matched = null;
        btn.addEventListener('click', async () => {
            try {
                const file = Util.$('#lib-im-file').files[0];
                let text = Util.$('#lib-im-text').value;
                if (file) text = SC.Import.decode(await file.arrayBuffer());
                if (!String(text || '').trim()) throw new Error('Choose a results file or paste the finishing order.');
                const { format, rows } = SC.Import.parse(text, file?.name || '');
                if (!rows.length) throw new Error('No drivers found in that file.');
                // Car numbers only identify a driver when nobody else in the league shares them.
                const numCount = {};
                drivers.forEach(d => { const n = Number(d.number); if (n) numCount[n] = (numCount[n] || 0) + 1; });
                const entrants = drivers.map(d => { const e = this._entrant(d); if (e.num && numCount[e.num] > 1) e.num = null; return e; });
                matched = SC.Import.match(rows, entrants, { playerId: '__none__', autoFill: false });
                const opts = (sel) => `<option value="">— skip (not a league driver) —</option>${drivers.map(d => `<option value="${Util.attr(d.id)}" ${sel === d.id ? 'selected' : ''}>${Util.esc(d.name)}</option>`).join('')}`;
                Util.$('#lib-im-map').innerHTML = `
                    <p class="small">Read <strong>${rows.length}</strong> rows (${Util.esc(format)}). ${matched.filter(m => m.id).length} matched to league drivers — fix any row, then apply.</p>
                    <table class="table table-tight"><thead><tr><th>Pos</th><th>In the file</th><th>League driver</th></tr></thead><tbody>
                    ${matched.map((m, i) => `<tr><td>${m.dnf ? 'DNF' : 'P' + (m.pos || i + 1)}</td><td>${Util.esc(m.name)}${m.num != null ? ` <span class="muted">#${m.num}</span>` : ''}${m.how === 'name' && m.conf < 0.9 ? ' <span class="badge badge-amber">check</span>' : m.how === 'number' ? ' <span class="badge badge-amber" title="Matched by car number — check it">by car #</span>' : ''}</td>
                        <td><select class="input" data-im-row="${i}">${opts(m.id)}</select></td></tr>`).join('')}</tbody></table>
                    <button type="button" class="btn btn-primary btn-sm" id="lib-im-apply">⬇ Apply to the results form</button>`;
                Util.$('#lib-im-apply').addEventListener('click', () => {
                    Util.$$('[data-im-row]').forEach(s => { matched[Number(s.dataset.imRow)].id = s.value || null; });
                    const used = matched.filter(m => m.id);
                    const ids = used.map(m => m.id);
                    if (new Set(ids).size !== ids.length) { Util.notify('The same league driver is picked twice.', 'error'); return; }
                    const renum = Util.$('#lib-im-renum').checked;
                    let p = 0;
                    const results = used.map(m => {
                        if (!m.dnf) p += 1;
                        return {
                            driverId: m.id, position: m.dnf ? null : (renum ? p : m.pos), dnf: !!m.dnf,
                            start: m.start || null, lapsLed: m.led ?? null, lapsCompleted: m.laps ?? null,
                            incidents: m.inc ?? null, wrecks: m.wrecks ?? null, fastestLap: !!m.fl
                        };
                    });
                    apply(results);
                    Util.notify(`Applied ${Util.plural(results.length, 'result')} — check the table and save. ✅`);
                });
            } catch (e) { Util.notify(e.message, 'error'); }
        });
    },

    /* ---------------- Driver self-report (race modal) ---------------- */
    // Open once the race is live or its date has arrived, until results are in.
    canReport(race) {
        return (race.status !== 'completed' && race.status !== 'cancelled') && (race.status === 'live' || (!!race.date && race.date <= Util.todayISO()));
    },
    reportPanel(race, signup, world) {
        const rep = signup.report || {};
        const tr = this.track(race.track);
        const derby = tr?.type === 'ar';
        return `
            <section class="lib-report">
                <h3 class="section-label">📝 Report my result</h3>
                <p class="muted small">Log how your race went — the Game Master sees it pre-filled when entering the official results.${signup.report ? ` <strong>Reported ${rep.dnf ? 'DNF' : 'P' + rep.position}.</strong> You can update it until results are in.` : ''}</p>
                <form id="lib-rep-form" class="form-grid">
                    <div class="form-row">
                        <label class="field"><span>${derby ? 'Survival position' : 'Finishing position'}</span><input id="rep-pos" class="input" type="number" min="1" max="99" value="${rep.position || ''}"></label>
                        <label class="field"><span>Started (grid)</span><input id="rep-start" class="input" type="number" min="1" max="99" value="${rep.start || ''}"></label>
                        ${derby ? `<label class="field"><span>Wrecks</span><input id="rep-wrecks" class="input" type="number" min="0" value="${rep.wrecks ?? ''}"></label>`
                            : `<label class="field"><span>Laps led</span><input id="rep-led" class="input" type="number" min="0" value="${rep.lapsLed ?? ''}"></label>`}
                        <label class="field"><span>Incidents</span><input id="rep-inc" class="input" type="number" min="0" value="${rep.incidents ?? ''}"></label>
                    </div>
                    <div class="chip-row">
                        <label class="check"><input id="rep-dnf" type="checkbox" ${rep.dnf ? 'checked' : ''}> Did not finish</label>
                        ${derby ? '' : `<label class="check"><input id="rep-fl" type="checkbox" ${rep.fastestLap ? 'checked' : ''}> I set the fastest lap</label>`}
                    </div>
                    <button type="submit" class="btn btn-primary btn-sm">💾 ${signup.report ? 'Update' : 'Submit'} my result</button>
                </form>
            </section>`;
    },
    wireReport(race, signup) {
        const form = Util.$('#lib-rep-form');
        if (!form) return;
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const num = (id) => { const v = Util.$('#' + id)?.value; return v === '' || v == null ? null : Number(v); };
            const dnf = Util.$('#rep-dnf').checked;
            const position = num('rep-pos');
            if (!dnf && !position) { Util.notify('Enter your finishing position (or tick DNF).', 'error'); return; }
            const report = {
                position: dnf ? null : position, dnf, start: num('rep-start'),
                lapsLed: num('rep-led'), incidents: num('rep-inc'), wrecks: num('rep-wrecks'),
                fastestLap: !!Util.$('#rep-fl')?.checked, at: new Date().toISOString()
            };
            Object.keys(report).forEach(k => { if (report[k] === null) delete report[k]; });
            try {
                await DB.update('raceSignups', signup.id, { report });
                Util.notify('Result reported — thanks! The Game Master will confirm it. 📝');
                Views.showRace(race.id);
            } catch (err) { Util.notify('Could not save your report: ' + err.message, 'error'); }
        });
    }
};
window.Library = Library;
