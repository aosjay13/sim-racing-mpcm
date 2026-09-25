/* ============================================================
   Phoenix SRMPC — Solo Career: launcher, new-career wizard,
   custom-game builder, Hall of Fame.
   ============================================================ */
'use strict';

(function (root) {
    const SC = root.SC = root.SC || {};
    const K = SC.UI;
    const esc = K.esc;

    const BUDGET_PRESETS = [
        [60000, 'Grassroots club ($60K)'], [250000, 'Regional ($250K)'], [1000000, 'National ($1M)'], [4000000, 'International ($4M)'],
        [12000000, 'Major league ($12M)'], [30000000, 'World championship ($30M)'], [140000000, 'Pinnacle ($140M)']
    ];

    /* ============================================================
       Launcher — save slots
       ============================================================ */
    async function launcher(el) {
        const [slots, hof] = await Promise.all([SC.Store.list().catch(() => []), SC.Store.hof().catch(() => [])]);
        const active = slots.filter(s => !s.retired);
        const retired = slots.filter(s => s.retired);
        el.innerHTML = `
        <section class="sc-hero">
            <div>
                <p class="section-label">Single-player · works offline · no account</p>
                <h1>Solo Career</h1>
                <p class="muted sc-hero-sub">Pick your sim, pick a championship, and build a legacy of up to ${SC.Engine.MAX_SEASONS} seasons.
                The app runs everything around the racing: contracts, money, sponsors, staff, car development, calendars,
                AI rivals and their careers, standings and stats. You race the rounds in your game and log the result here.</p>
                <div class="btn-row">
                    <a class="btn btn-primary" href="#/new">➕ New career</a>
                    <label class="btn btn-secondary" for="sc-import-save">📂 Import save file<input id="sc-import-save" type="file" accept=".json,application/json" hidden></label>
                    <a class="btn btn-ghost" href="#/hof">🎖️ Hall of Fame${hof.length ? ` (${hof.length})` : ''}</a>
                </div>
            </div>
            <div class="sc-hero-games">${SC.GAMES.slice(0, 16).map(g => `<span class="sc-game-dot" style="--gc:${esc(g.color)}" title="${esc(g.name)}">${g.icon}<small>${esc(g.short)}</small></span>`).join('')}
                <span class="sc-game-dot" style="--gc:#7c3aed" title="Any other sim">⭐<small>+ Custom</small></span></div>
        </section>
        ${SC.Store.usingFallback ? '<div class="warn-banner">⚠️ This browser blocked IndexedDB, so careers are stored in the small localStorage area. Export your saves regularly.</div>' : ''}
        ${K.panel(`🏁 Your careers <span class="muted small">(${active.length})</span>`, active.length ? `<div class="sc-slots">${active.map(slotCard).join('')}</div>`
            : K.empty('🏎️', 'No careers yet', 'Start one — each save is tied to one game, and you can run as many as you like side by side.', '<a class="btn btn-primary" href="#/new">Start your first career</a>'))}
        ${retired.length ? K.panel('🎖️ Retired careers', `<div class="sc-slots">${retired.map(slotCard).join('')}</div>`) : ''}
        ${K.panel('How it works', `
            <ol class="sc-steps">
                <li><strong>Choose a game</strong> — NR2003, iRacing, AMS2, ACC, F1, Wreckfest and more (or define your own).</li>
                <li><strong>Choose a series and a role</strong> — hired driver, owner-driver, or team principal.</li>
                <li><strong>Before each round</strong> the Race screen tells you exactly what to set up in your game: track, laps, weather, and the AI difficulty that matches your car's pace against this field.</li>
                <li><strong>Race it in your sim</strong>, then log your finish — or import the results file (rFactor/LMU/GTR2/RACE 07/NR2003/iRacing/AC/ACC) — or simulate the round.</li>
                <li><strong>The app handles the rest</strong>: points, prize money, salaries, sponsors, R&amp;D, the other championships, AI transfers, rookies and retirements. At season end you choose your next move.</li>
                <li><strong>After ${SC.Engine.MAX_SEASONS} seasons</strong> your character retires into the Hall of Fame. Start a new one to keep going.</li>
            </ol>`)}`;
        K.$$('[data-open]', el).forEach(b => b.addEventListener('click', () => SC.App.nav(`#/c/${encodeURIComponent(b.dataset.open)}/home`)));
        K.$$('[data-export]', el).forEach(b => b.addEventListener('click', async () => {
            const S = await SC.Store.load(b.dataset.export);
            if (S) K.download(SC.Store.exportBlob(S), `solo-career-${K.slug(S.player.first + ' ' + S.player.last)}-${S.gameId}-s${S.seasonNo}.json`);
        }));
        K.$$('[data-delete]', el).forEach(b => b.addEventListener('click', async () => {
            const meta = slots.find(s => s.id === b.dataset.delete);
            const ok = await K.Modal.confirm('Delete career?', `Delete <strong>${esc(meta?.name)}</strong> (${esc(meta?.game)})? This cannot be undone — export it first if you might want it back. Hall of Fame entries are kept.`, { ok: 'Delete', danger: true });
            if (!ok) return;
            await SC.Store.remove(b.dataset.delete);
            K.toast('Career deleted.');
            launcher(el);
        }));
        K.$('#sc-import-save', el)?.addEventListener('change', async (e) => {
            const f = e.target.files[0];
            if (!f) return;
            try {
                const S = await SC.Store.importText(await f.text());
                K.toast(`Imported ${S.player.first} ${S.player.last}. 🏁`);
                SC.App.nav(`#/c/${encodeURIComponent(S.id)}/home`);
            } catch (err) { K.toast(err.message, 'error'); }
        });
    }

    function slotCard(m) {
        const updated = m.updatedAt ? new Date(m.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
        const roleLabel = SC.Engine.ROLES[m.role]?.label || m.role;
        return `<article class="sc-slot" style="--gc:${esc(m.color || '#555')}">
            <div class="sc-slot-icon">${m.icon || '🏁'}</div>
            <div class="sc-slot-main">
                <h3>${K.flag(m.nat)} ${esc(m.name)} ${m.retired ? K.badge('Retired', 'badge-purple') : ''}</h3>
                <p class="muted small">${esc(m.game)} · ${esc(roleLabel)}${m.team ? ' · ' + esc(m.team) : ''}</p>
                <p class="small">${esc(m.series || '')}</p>
                <div class="chip-row">
                    <span class="chip">Season ${m.seasonNo}/${m.maxSeasons} · ${m.year}</span>
                    <span class="chip">🏆 ${m.titles}</span><span class="chip">🥇 ${m.wins} wins</span>
                    <span class="chip ${K.moneyCls(m.money)}">${K.money(m.money)}</span>
                </div>
                <p class="muted small">Last played ${esc(updated)}</p>
            </div>
            <div class="btn-col">
                <button class="btn btn-primary btn-sm" data-open="${esc(m.id)}">${m.retired ? 'View' : 'Continue'}</button>
                <button class="btn btn-ghost btn-sm" data-export="${esc(m.id)}">Export</button>
                <button class="btn btn-danger btn-sm" data-delete="${esc(m.id)}">Delete</button>
            </div>
        </article>`;
    }

    /* ============================================================
       Hall of Fame
       ============================================================ */
    async function hallOfFame(el) {
        const rows = await SC.Store.hof().catch(() => []);
        el.innerHTML = `
        <div class="view-head"><div><h1>🎖️ Hall of Fame</h1><p class="muted">Every retired Solo Career character, ranked by legacy score.</p></div>
            <a class="btn btn-ghost" href="#/">← Save slots</a></div>
        ${K.panel('', rows.length ? `<div class="sc-table-wrap"><table class="table">
            <thead><tr><th>#</th><th>Driver</th><th>Game</th><th>Career</th><th class="num">Titles</th><th class="num">Wins</th><th class="num">Podiums</th><th class="num">Poles</th><th class="num">Starts</th><th class="num">Earnings</th><th class="num">Legacy</th><th></th></tr></thead>
            <tbody>${rows.map((h, i) => `<tr>
                <td class="rank">${i + 1}</td>
                <td><strong>${K.flag(h.nat)} ${esc(h.name)}</strong>${h.nick ? ` <span class="muted">“${esc(h.nick)}”</span>` : ''}<br><span class="muted small">${esc(SC.Engine.ROLES[h.role]?.label || '')} · best: ${esc(h.best)}</span></td>
                <td>${esc(h.gameShort || h.game)}</td>
                <td>${h.from}–${h.to}<br><span class="muted small">${h.seasons} season${h.seasons === 1 ? '' : 's'} · ${esc(h.reason === 'forced' ? 'full career' : 'retired early')}</span></td>
                <td class="num">${h.titles}</td><td class="num">${h.wins}</td><td class="num">${h.podiums}</td><td class="num">${h.poles}</td><td class="num">${h.starts}</td>
                <td class="num">${K.money(h.earnings)}</td><td class="num"><strong>${h.legacy}</strong></td>
                <td><button class="btn btn-ghost btn-sm" data-rm="${esc(h.id)}" title="Remove from Hall of Fame">✕</button></td>
            </tr>${h.seriesTitles?.length ? `<tr class="sc-subrow"><td></td><td colspan="11" class="muted small">🏆 ${h.seriesTitles.map(esc).join(' · ')}</td></tr>` : ''}`).join('')}</tbody></table></div>`
            : K.empty('🎖️', 'The Hall is empty', 'Characters join when they retire — after 40 seasons, or earlier by choice.', '<a class="btn btn-primary" href="#/new">Start a career</a>'))}`;
        K.$$('[data-rm]', el).forEach(b => b.addEventListener('click', async () => {
            const ok = await K.Modal.confirm('Remove entry?', 'Remove this character from the Hall of Fame?', { ok: 'Remove', danger: true });
            if (!ok) return;
            await SC.Store.removeHof(b.dataset.rm);
            hallOfFame(el);
        }));
    }

    /* ============================================================
       New-career wizard
       ============================================================ */
    let W = null;
    function freshWizard() {
        return {
            step: 1, gameId: null, custom: null, customTracks: {}, seriesId: null, role: 'driver', filter: '',
            char: { first: '', last: '', nick: '', nat: 'USA', age: 18, num: Math.floor(Math.random() * 98) + 2, color: '#ff3b3b' },
            owner: { teamName: '', teamColor: '#ff3b3b', make: '', cars: 2 },
            opts: { difficulty: 'normal', raceLength: 0.5, seasonLength: 'full', maxGrid: null, aiBase: null, reliabilityOrders: true, allowSim: true, startYear: null }
        };
    }
    const STEPS = ['Game', 'Series', 'Role', 'Driver', 'Options', 'Review'];

    function gameObj() { return W.gameId === 'custom' ? W.custom : SC.game(W.gameId); }

    async function wizard(el) {
        if (!W) W = freshWizard();
        const stepper = `<ol class="sc-stepper">${STEPS.map((s, i) => `<li class="${i + 1 === W.step ? 'active' : i + 1 < W.step ? 'done' : ''}"><span>${i + 1}</span>${s}</li>`).join('')}</ol>`;
        let body = '';
        if (W.step === 1) body = stepGame();
        else if (W.step === 1.5) body = stepCustomGame();
        else if (W.step === 2) body = stepSeries();
        else if (W.step === 3) body = stepRole();
        else if (W.step === 4) body = stepCharacter();
        else if (W.step === 5) body = stepOptions();
        else body = stepReview();
        el.innerHTML = `
        <div class="view-head"><div><h1>New career</h1><p class="muted">One character, one game, up to ${SC.Engine.MAX_SEASONS} seasons.</p></div>
            <div class="btn-row"><button class="btn btn-ghost" id="wz-cancel">Cancel</button></div></div>
        ${stepper}
        <div id="wz-body">${body}</div>`;
        K.$('#wz-cancel', el).onclick = () => { W = null; SC.App.nav('#/'); };
        wireStep(el);
    }

    function nav(back, next, nextLabel = 'Next →', nextDisabled = false) {
        return `<div class="sc-wizard-nav">
            ${back ? '<button class="btn btn-ghost" id="wz-back">← Back</button>' : '<span></span>'}
            ${next ? `<button class="btn btn-primary" id="wz-next" ${nextDisabled ? 'disabled' : ''}>${nextLabel}</button>` : ''}</div>`;
    }

    function stepGame() {
        const f = W.filter.toLowerCase();
        const games = SC.GAMES.filter(g => !f || (g.name + ' ' + g.short + ' ' + g.dev).toLowerCase().includes(f));
        return K.panel('1 · Which game are you racing?', `
            <input id="wz-filter" class="input sc-search" placeholder="Search games…" value="${esc(W.filter)}">
            <div class="sc-game-grid">
                ${games.map(g => `<button class="sc-game-card ${W.gameId === g.id ? 'selected' : ''}" data-game="${g.id}" style="--gc:${esc(g.color)}">
                    <span class="sc-game-icon">${g.icon}</span>
                    <span class="sc-game-name">${esc(g.name)}</span>
                    <span class="muted small">${esc(g.dev)} · ${g.year} · ${esc(g.platform)}</span>
                    <span class="small">${g.series.length} series · ${SC.laddersOf(g).length} ladder${SC.laddersOf(g).length > 1 ? 's' : ''} · ${g.tracks.length} tracks</span>
                    <span class="muted small sc-game-blurb">${esc(g.blurb)}</span>
                </button>`).join('')}
                <button class="sc-game-card ${W.gameId === 'custom' ? 'selected' : ''}" data-game="custom" style="--gc:#7c3aed">
                    <span class="sc-game-icon">⭐</span><span class="sc-game-name">Custom game</span>
                    <span class="muted small">Any other sim, mod pack or league</span>
                    <span class="muted small sc-game-blurb">Define your own tracks, series ladder, grid sizes and AI scale. Perfect for rFactor mods, BeamNG scenarios, Kart Racing Pro, Grand Prix Legends…</span>
                </button>
            </div>`);
    }

    function stepCustomGame() {
        const c = W.custom || SC.blankCustomGame();
        const trackLines = (c.tracks || []).map(t => { const i = W.customTracks[t] || SC.track(t); return `${t} | ${i.type} | ${i.km}`; }).join('\n');
        const series = c.series.length ? c.series : [{ name: '', short: '', ladder: 'custom', tier: 2, grid: 20, teamSize: [2, 2], points: 'f1', budget: 1000000, len: { laps: 20 }, rounds: 10, car: '' }];
        const typeOpts = Object.entries(SC.TRACK_TYPES).map(([k, v]) => `${k} = ${v.label}`).join(' · ');
        return K.panel('⭐ Build your custom game', `
            <div class="form-row">
                <label class="field"><span>Game name</span><input id="cg-name" class="input" value="${esc(c.name === 'My Sim' ? '' : c.name)}" placeholder="e.g. Grand Prix Legends" maxlength="60"></label>
                <label class="field"><span>Short name</span><input id="cg-short" class="input" value="${esc(c.short === 'Custom' ? '' : c.short)}" placeholder="GPL" maxlength="14"></label>
                <label class="field"><span>Colour</span><input id="cg-color" class="input input-color" type="color" value="${esc(c.color)}"></label>
            </div>
            <div class="form-row">
                <label class="field"><span>In-game AI setting name</span><input id="cg-ai-label" class="input" value="${esc(c.ai.label)}"></label>
                <label class="field"><span>AI min</span><input id="cg-ai-min" class="input" type="number" value="${c.ai.min}"></label>
                <label class="field"><span>AI max</span><input id="cg-ai-max" class="input" type="number" value="${c.ai.max}"></label>
                <label class="field"><span>Your usual AI level</span><input id="cg-ai-def" class="input" type="number" value="${c.ai.def}"></label>
                <label class="field"><span>Max cars your game allows</span><input id="cg-maxgrid" class="input" type="number" min="4" max="60" value="${c.maxGrid}"></label>
            </div>
            <label class="field"><span>Tracks — one per line: <code>Name | type | length km</code></span>
                <textarea id="cg-tracks" class="input" rows="7" placeholder="Monza | rd | 5.79&#10;Bristol | so | 0.86&#10;Crash Arena | ar">${esc(trackLines)}</textarea></label>
            <p class="muted small">Types: ${esc(typeOpts)}</p>
            <h3 class="sc-subhead">Series ladder</h3>
            <p class="muted small">Tier 1 is the top of a ladder. Series with the same ladder name form a promotion path.</p>
            <div id="cg-series">${series.map((s, i) => customSeriesRow(s, i)).join('')}</div>
            <button class="btn btn-secondary btn-sm" id="cg-add">➕ Add series</button>
            ${nav(true, true, 'Use this game →')}`);
    }
    function customSeriesRow(s, i) {
        const pts = Object.entries(SC.POINTS).map(([k, v]) => [k, v.label]);
        const lens = s.len?.mins ? `${s.len.mins}m` : String(s.len?.laps || 20);
        return `<div class="sc-cg-row" data-row="${i}">
            <input class="input" data-f="name" placeholder="Series name" value="${esc(s.name)}">
            <input class="input" data-f="car" placeholder="Car / class" value="${esc(s.car || '')}">
            <input class="input" data-f="ladder" placeholder="Ladder" value="${esc(s.ladder === 'custom' ? '' : s.ladder)}" title="Ladder name — same name = same promotion path">
            <label class="sc-mini"><span>Tier</span><input class="input" data-f="tier" type="number" min="1" max="8" value="${s.tier}"></label>
            <label class="sc-mini"><span>Grid</span><input class="input" data-f="grid" type="number" min="4" max="60" value="${s.grid}"></label>
            <label class="sc-mini"><span>Cars/team</span><input class="input" data-f="team" type="number" min="1" max="4" value="${s.teamSize?.[1] || 2}"></label>
            <label class="sc-mini"><span>Rounds</span><input class="input" data-f="rounds" type="number" min="1" max="40" value="${s.rounds || 10}"></label>
            <label class="sc-mini"><span>Laps or “30m”</span><input class="input" data-f="len" value="${esc(lens)}"></label>
            ${K.select('', pts, s.points, 'data-f="points"')}
            ${K.select('', BUDGET_PRESETS, s.budget, 'data-f="budget"')}
            <button class="btn btn-ghost btn-sm" data-rmrow="${i}" title="Remove">✕</button>
        </div>`;
    }
    function readCustomGame() {
        const name = K.$('#cg-name').value.trim();
        if (!name) throw new Error('Name your game.');
        const ai = { label: K.$('#cg-ai-label').value.trim() || 'AI Difficulty', kind: 'range', min: Number(K.$('#cg-ai-min').value) || 0, max: Number(K.$('#cg-ai-max').value) || 100, def: Number(K.$('#cg-ai-def').value) || 75, unit: '' };
        if (ai.max <= ai.min) throw new Error('AI max must be above AI min.');
        const customTracks = {};
        const tracks = [];
        for (const line of K.$('#cg-tracks').value.split(/\r?\n/)) {
            const [n, type, km] = line.split('|').map(s => (s || '').trim());
            if (!n) continue;
            const known = SC.TRACKS[n];
            const tt = SC.TRACK_TYPES[type] ? type : known ? known.type : 'rd';
            customTracks[n] = { name: n, type: tt, km: Number(km) || known?.km || 4, country: known?.country || '', night: !!known?.night, custom: true };
            if (!tracks.includes(n)) tracks.push(n);
        }
        if (tracks.length < 2) throw new Error('Add at least two tracks.');
        const series = K.$$('.sc-cg-row').map((row, i) => {
            const v = (f) => row.querySelector(`[data-f="${f}"]`).value.trim();
            if (!v('name')) return null;
            const lenRaw = v('len').toLowerCase();
            const len = /m/.test(lenRaw) ? { mins: parseInt(lenRaw, 10) || 30 } : { laps: parseInt(lenRaw, 10) || 20 };
            const team = Math.max(1, Math.min(4, Number(v('team')) || 2));
            return {
                id: 's' + i + '-' + K.slug(v('name')).slice(0, 12), name: v('name'), short: v('name').split(/\s+/).map(w => w[0]).join('').slice(0, 5).toUpperCase(),
                ladder: v('ladder') ? K.slug(v('ladder')) : 'custom', tier: Math.max(1, Math.min(8, Number(v('tier')) || 1)),
                car: v('car') || 'Your car', grid: Math.max(4, Math.min(60, Number(v('grid')) || 20)), teamSize: [Math.min(team, 2), team],
                points: v('points'), budget: Number(v('budget')) || 1000000, spec: 0.4, len, pool: [...new Set(tracks.map(t => customTracks[t].type))], rounds: Math.max(1, Math.min(40, Number(v('rounds')) || 10))
            };
        }).filter(Boolean);
        if (!series.length) throw new Error('Add at least one series.');
        // Unknown ladder ids need a label for the ladder view.
        series.forEach(s => { if (!SC.LADDERS[s.ladder]) SC.LADDERS[s.ladder] = { label: s.ladder.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + ' Ladder', icon: '⭐' }; });
        const g = { ...SC.blankCustomGame(), name, short: K.$('#cg-short').value.trim() || name.slice(0, 12), color: K.$('#cg-color').value, ai, maxGrid: Math.max(4, Math.min(60, Number(K.$('#cg-maxgrid').value) || 40)), tracks, series, blurb: 'Custom game' };
        return { g, customTracks };
    }

    function stepSeries() {
        const g = gameObj();
        const ladders = SC.laddersOf(g);
        return K.panel(`2 · Where does your career start? <span class="muted small">${esc(g.name)}</span>`, `
            <p class="muted">Series are grouped into ladders. Starting on the bottom rung is the classic route — you can start higher, but you'll arrive with a small reputation and a backmarker seat.</p>
            <div class="sc-ladders">
                ${ladders.map(L => `<div class="sc-ladder">
                    <h3>${L.icon} ${esc(L.label)}</h3>
                    ${L.series.map((s, i) => {
                        const grid = Math.min(s.grid, g.maxGrid);
                        const rounds = s.cal ? s.cal.length : s.rounds;
                        return `<button class="sc-series-card ${W.seriesId === s.id ? 'selected' : ''}" data-series="${esc(s.id)}">
                            <span class="sc-series-top"><span class="sc-tier">${K.stars(s.tier)}</span>${i === 0 ? K.badge('Entry', 'badge-green') : s.tier === 1 ? K.badge('Top', 'badge-amber') : ''}</span>
                            <strong>${esc(s.name)}</strong>
                            <span class="muted small">${esc(s.car)}</span>
                            <span class="small">${grid} cars · ${rounds} rounds · ${esc(SC.POINTS[s.points]?.label.split(' (')[0] || s.points)} points</span>
                            <span class="small">Team budgets ≈ ${K.money(s.budget)}</span>
                            ${s.mod ? `<span class="sc-note">🧩 ${esc(s.mod)}</span>` : ''}${s.dlc ? `<span class="sc-note">🛒 DLC: ${esc(s.dlc)}</span>` : ''}
                        </button>`;
                    }).join('')}
                </div>`).join('')}
            </div>
            ${nav(true, true, 'Next →', !W.seriesId)}`);
    }

    function stepRole() {
        const R = SC.Engine.ROLES;
        const tips = {
            driver: 'You race every round in the game. Teams, R&D and money are run by the AI team — your job is results, sponsors and your next contract.',
            owner: 'You race every round AND run the team: budget, car development, facilities, staff, sponsors, teammate. Go broke two seasons running and the team is sold.',
            principal: 'You don’t drive. Every round is simulated from your strategy calls. The board sets targets; miss them and you’re fired.'
        };
        return K.panel('3 · What kind of career?', `
            <div class="role-grid sc-role-grid">${Object.entries(R).map(([id, r]) => `
                <button class="role-card ${W.role === id ? 'selected' : ''}" data-role="${id}">
                    <span class="role-icon">${r.icon}</span><span class="role-name">${esc(r.label)}</span>
                    <span class="role-desc">${esc(r.desc)}</span><span class="muted small">${esc(tips[id])}</span>
                </button>`).join('')}</div>
            ${nav(true, true)}`);
    }

    function stepCharacter() {
        const c = W.char, o = W.owner;
        const g = gameObj();
        const sd = SC.seriesOf(g, W.seriesId);
        const nats = Object.entries(SC.NATIONS).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([k, v]) => [k, `${v.flag} ${v.name}`]);
        const maxCars = Math.max(1, (sd.teamSize || [2, 2])[1]);
        return K.panel(W.role === 'principal' ? '4 · Who is running the team?' : '4 · Create your driver', `
            <div class="form-row">
                <label class="field"><span>First name *</span><input id="ch-first" class="input" value="${esc(c.first)}" maxlength="24" autofocus></label>
                <label class="field"><span>Last name *</span><input id="ch-last" class="input" value="${esc(c.last)}" maxlength="28"></label>
                <label class="field"><span>Nickname (optional)</span><input id="ch-nick" class="input" value="${esc(c.nick)}" maxlength="24"></label>
            </div>
            <div class="form-row">
                <label class="field"><span>Nationality</span>${K.select('ch-nat', nats, c.nat)}</label>
                <label class="field"><span>Age</span><input id="ch-age" class="input" type="number" min="14" max="45" value="${c.age}"></label>
                ${W.role !== 'principal' ? `<label class="field"><span>Car number</span><input id="ch-num" class="input" type="number" min="0" max="999" value="${c.num}"></label>
                <label class="field"><span>Helmet colour</span><input id="ch-color" class="input input-color" type="color" value="${esc(c.color)}"></label>` : ''}
            </div>
            <p class="muted small">Your age matters for flavour and history only — every career gets up to ${SC.Engine.MAX_SEASONS} seasons, then the character retires.</p>
            ${W.role === 'owner' ? `
            <h3 class="sc-subhead">Your team</h3>
            <div class="form-row">
                <label class="field"><span>Team name</span><input id="ow-name" class="input" value="${esc(o.teamName)}" placeholder="${esc((c.last || 'Your') + ' Racing')}" maxlength="40"></label>
                <label class="field"><span>Team colour</span><input id="ow-color" class="input input-color" type="color" value="${esc(o.teamColor)}"></label>
                ${sd.makes && sd.makes.length ? `<label class="field"><span>Manufacturer</span>${K.select('ow-make', sd.makes.map(m => [m, m]), o.make || sd.makes[0])}</label>` : ''}
                <label class="field"><span>Cars</span>${K.select('ow-cars', Array.from({ length: maxCars }, (_, i) => [i + 1, `${i + 1} car${i ? 's' : ''}${i ? ' (you + ' + i + ' teammate' + (i > 1 ? 's' : '') + ')' : ' (just you)'}`]), Math.min(o.cars, maxCars))}</label>
            </div>` : ''}
            ${nav(true, true)}`);
    }

    function stepOptions() {
        const g = gameObj();
        const sd = SC.seriesOf(g, W.seriesId);
        const E = SC.Engine;
        const o = W.opts;
        const ai = g.ai;
        const gridDefault = Math.min(sd.grid, g.maxGrid);
        const aiInput = ai.kind === 'steps'
            ? K.select('op-ai', ai.steps.map(s => [s, s]), o.aiBase ?? ai.def)
            : `<input id="op-ai" class="input" type="number" min="${ai.min}" max="${ai.max}" value="${o.aiBase ?? ai.def}">`;
        return K.panel('5 · Difficulty & race options', `
            <h3 class="sc-subhead">Difficulty</h3>
            <div class="role-grid">${Object.entries(E.DIFF).map(([id, d]) => `
                <button class="role-card ${o.difficulty === id ? 'selected' : ''}" data-diff="${id}">
                    <span class="role-icon">${d.icon}</span><span class="role-name">${d.label}</span>
                    <span class="role-desc">${esc({ easy: 'Generous money, better starting seat, softer AI.', normal: 'The intended experience.', hard: 'Tighter budgets, tougher rivals, pickier teams.', legend: 'Back of the grid, paid seats, relentless AI development.' }[id])}</span>
                </button>`).join('')}</div>
            <div class="form-row">
                <label class="field"><span>Race length</span>${K.select('op-len', E.RACE_LENGTHS.map(r => [r.v, r.label]), o.raceLength)}</label>
                <label class="field"><span>Season length</span>${K.select('op-season', E.SEASON_LENGTHS.map(r => [r.v, r.label]), o.seasonLength)}</label>
                <label class="field"><span>Max cars on track (your game/PC limit)</span><input id="op-grid" class="input" type="number" min="4" max="${g.maxGrid}" value="${o.maxGrid || gridDefault}"></label>
                <label class="field"><span>Start year</span><input id="op-year" class="input" type="number" min="1950" max="2100" value="${o.startYear || g.era}"></label>
            </div>
            <div class="sc-callout">
                <strong>🎚️ AI calibration — ${esc(ai.label)}${ai.kind === 'range' ? ` (${ai.min}–${ai.max})` : ''}</strong>
                <p class="muted small">What ${esc(ai.label)} do you race closely with, in an average car, at an average track? The Race screen adjusts from this number every round —
                up when your car is slower than the field or the series is stronger, down when you have the better car. Not sure? Keep the default and tweak it in Settings after a few rounds.</p>
                <label class="field sc-narrow"><span>Your baseline</span>${aiInput}</label>
            </div>
            <label class="check"><input id="op-rel" type="checkbox" ${o.reliabilityOrders ? 'checked' : ''}> Reliability orders — if your car is fragile, the team may order you to retire at a given lap (you honour it in-game).</label>
            <label class="check"><input id="op-sim" type="checkbox" ${o.allowSim ? 'checked' : ''}> Allow simulating my own races (for rounds you can't run).</label>
            ${nav(true, true)}`);
    }

    function stepReview() {
        const g = gameObj();
        const sd = SC.seriesOf(g, W.seriesId);
        const E = SC.Engine;
        const c = W.char;
        return K.panel('6 · Ready to go', `
            <div class="sc-review">
                <div><span class="muted small">Game</span><strong>${g.icon} ${esc(g.name)}</strong></div>
                <div><span class="muted small">Starting series</span><strong>${esc(sd.name)}</strong><span class="muted small">${esc(sd.car)}</span></div>
                <div><span class="muted small">Role</span><strong>${E.ROLES[W.role].icon} ${E.ROLES[W.role].label}</strong></div>
                <div><span class="muted small">${W.role === 'principal' ? 'Principal' : 'Driver'}</span><strong>${K.flag(c.nat)} ${esc(c.first)} ${esc(c.last)}${c.nick ? ` “${esc(c.nick)}”` : ''}</strong><span class="muted small">Age ${c.age}${W.role !== 'principal' ? ` · #${c.num}` : ''}</span></div>
                ${W.role === 'owner' ? `<div><span class="muted small">Team</span><strong>${esc(W.owner.teamName || c.last + ' Racing')}</strong><span class="muted small">${W.owner.cars} car${W.owner.cars > 1 ? 's' : ''}${W.owner.make ? ' · ' + esc(W.owner.make) : ''}</span></div>` : ''}
                <div><span class="muted small">Difficulty</span><strong>${E.DIFF[W.opts.difficulty].icon} ${E.DIFF[W.opts.difficulty].label}</strong></div>
                <div><span class="muted small">Races</span><strong>${esc(E.RACE_LENGTHS.find(r => r.v === Number(W.opts.raceLength))?.label || '')} · ${esc(E.SEASON_LENGTHS.find(r => r.v === W.opts.seasonLength)?.label || '')}</strong></div>
            </div>
            <p class="muted">The app now builds the whole ${esc(g.short)} world: every series, team, driver and calendar. Rival drivers age, improve, move teams and retire over the decades — just like you.</p>
            ${nav(true, true, '🏁 Start career')}`);
    }

    function readStep(el) {
        if (W.step === 4) {
            const v = (id) => K.$('#' + id, el)?.value;
            W.char.first = (v('ch-first') || '').trim(); W.char.last = (v('ch-last') || '').trim(); W.char.nick = (v('ch-nick') || '').trim();
            W.char.nat = v('ch-nat') || W.char.nat; W.char.age = Number(v('ch-age')) || 18;
            if (K.$('#ch-num', el)) { W.char.num = Number(v('ch-num')) || 0; W.char.color = v('ch-color'); }
            if (K.$('#ow-name', el)) {
                W.owner.teamName = v('ow-name').trim(); W.owner.teamColor = v('ow-color');
                W.owner.make = v('ow-make') || ''; W.owner.cars = Number(v('ow-cars')) || 1;
            }
        }
        if (W.step === 5) {
            const v = (id) => K.$('#' + id, el)?.value;
            W.opts.raceLength = Number(v('op-len')); W.opts.seasonLength = v('op-season');
            W.opts.maxGrid = Number(v('op-grid')) || null; W.opts.startYear = Number(v('op-year')) || null;
            const g = gameObj();
            W.opts.aiBase = g.ai.kind === 'steps' ? v('op-ai') : Number(v('op-ai'));
            W.opts.reliabilityOrders = K.$('#op-rel', el).checked; W.opts.allowSim = K.$('#op-sim', el).checked;
        }
    }

    function validateStep() {
        if (W.step === 4) {
            if (!W.char.first || !W.char.last) throw new Error('Give your character a first and last name.');
            if (W.char.age < 14 || W.char.age > 45) throw new Error('Age must be between 14 and 45.');
        }
        if (W.step === 5) {
            const g = gameObj();
            if (g.ai.kind === 'range' && (W.opts.aiBase < g.ai.min || W.opts.aiBase > g.ai.max)) throw new Error(`The AI baseline must be between ${g.ai.min} and ${g.ai.max}.`);
            if (W.opts.maxGrid && W.opts.maxGrid < 4) throw new Error('A grid needs at least 4 cars.');
        }
    }

    function wireStep(el) {
        const rerender = () => wizard(el);
        K.$('#wz-back', el)?.addEventListener('click', () => {
            try { readStep(el); } catch (e) { /* ignore on back */ }
            if (W.step === 1.5) W.step = 1;
            else if (W.step === 2 && W.gameId === 'custom') W.step = 1.5;
            else W.step = Math.max(1, Math.floor(W.step) - 1);
            rerender();
        });
        K.$('#wz-next', el)?.addEventListener('click', async () => {
            try {
                if (W.step === 1.5) {
                    const { g, customTracks } = readCustomGame();
                    W.custom = g; W.customTracks = customTracks; W.seriesId = null; W.step = 2; rerender(); return;
                }
                readStep(el); validateStep();
                if (W.step === 6) { await startCareer(); return; }
                W.step += 1; rerender();
            } catch (e) { K.toast(e.message, 'error'); }
        });
        // Step 1
        K.$('#wz-filter', el)?.addEventListener('input', (e) => {
            W.filter = e.target.value;
            const pos = e.target.selectionStart;
            rerender();
            const inp = K.$('#wz-filter'); if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
        });
        K.$$('[data-game]', el).forEach(b => b.addEventListener('click', () => {
            if (b.dataset.game === 'custom') { W.gameId = 'custom'; W.custom = W.custom || SC.blankCustomGame(); W.step = 1.5; rerender(); return; }
            if (W.gameId !== b.dataset.game) { W.seriesId = null; W.opts.aiBase = null; W.opts.maxGrid = null; W.opts.startYear = null; }
            W.gameId = b.dataset.game; W.step = 2; rerender();
        }));
        // Custom game rows
        K.$('#cg-add', el)?.addEventListener('click', () => {
            const wrap = K.$('#cg-series', el);
            const i = wrap.children.length;
            wrap.insertAdjacentHTML('beforeend', customSeriesRow({ name: '', ladder: 'custom', tier: Math.max(1, 3 - i), grid: 20, teamSize: [2, 2], points: 'f1', budget: 1000000, len: { laps: 20 }, rounds: 10 }, i));
        });
        el.addEventListener('click', (e) => { const rm = e.target.closest('[data-rmrow]'); if (rm) rm.closest('.sc-cg-row').remove(); });
        // Step 2
        K.$$('[data-series]', el).forEach(b => b.addEventListener('click', () => {
            W.seriesId = b.dataset.series;
            const g = gameObj(); const sd = SC.seriesOf(g, W.seriesId);
            W.owner.cars = Math.min(W.owner.cars || 2, (sd.teamSize || [2, 2])[1]);
            if (!W.owner.make && sd.makes) W.owner.make = sd.makes[0];
            W.step = 3; rerender();
        }));
        // Step 3
        K.$$('[data-role]', el).forEach(b => b.addEventListener('click', () => { W.role = b.dataset.role; W.step = 4; rerender(); }));
        // Step 5
        K.$$('[data-diff]', el).forEach(b => b.addEventListener('click', () => { readStep(el); W.opts.difficulty = b.dataset.diff; rerender(); }));
    }

    async function startCareer() {
        const btn = K.$('#wz-next');
        if (btn) { btn.disabled = true; btn.textContent = 'Building the world…'; }
        await new Promise(r => setTimeout(r, 30));
        try {
            const g = gameObj();
            const S = SC.Engine.newCareer({
                gameId: W.gameId, customGame: W.gameId === 'custom' ? W.custom : null, customTracks: W.gameId === 'custom' ? W.customTracks : {},
                seriesId: W.seriesId, role: W.role, character: W.char, teamName: W.owner.teamName, teamColor: W.owner.teamColor, make: W.owner.make, cars: W.owner.cars,
                difficulty: W.opts.difficulty, raceLength: W.opts.raceLength, seasonLength: W.opts.seasonLength, maxGrid: W.opts.maxGrid,
                aiBase: W.opts.aiBase, reliabilityOrders: W.opts.reliabilityOrders, allowSim: W.opts.allowSim, startYear: W.opts.startYear || g.era
            });
            await SC.Store.save(S);
            W = null;
            K.toast(`Welcome to ${g.short}, ${S.player.first}! 🏁`);
            SC.App.nav(`#/c/${encodeURIComponent(S.id)}/home`);
        } catch (e) {
            console.error(e);
            K.toast(e.message, 'error');
            if (btn) { btn.disabled = false; btn.textContent = '🏁 Start career'; }
        }
    }

    SC.Setup = { launcher, hallOfFame, wizard, resetWizard: () => { W = null; } };
})(typeof window !== 'undefined' ? window : globalThis);
