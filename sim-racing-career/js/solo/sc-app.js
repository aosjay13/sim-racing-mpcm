/* ============================================================
   Phoenix SRMPC — Solo Career: app shell & router
   Hash routes:
     #/            save slots (launcher)
     #/new         new-career wizard
     #/hof         Hall of Fame
     #/c/<id>/<view>/<param>   inside a career
   Every engine action goes through App.act(): it snapshots for
   undo when asked, runs the mutation, autosaves, re-renders —
   and if anything throws, reloads the last good save so a
   half-applied action can never corrupt a career.
   ============================================================ */
'use strict';

(function (root) {
    const SC = root.SC = root.SC || {};
    const K = SC.UI;

    const NAV = [
        ['home', '🏠', 'Home'],
        ['race', '🏁', 'Race'],
        ['calendar', '🗓️', 'Calendar'],
        ['standings', '🏆', 'Standings'],
        ['team', '🛠️', 'Team'],
        ['market', '🤝', 'Market'],
        ['finances', '💰', 'Finances'],
        ['inbox', '📨', 'Inbox'],
        ['career', '🧑‍🚀', 'Career'],
        ['world', '🌍', 'World'],
        ['settings', '⚙️', 'Settings']
    ];

    const App = {
        S: null,
        route: { name: 'launcher' },
        undoInfo: null,

        async boot() {
            try { await SC.Store.init(); } catch (e) { console.warn(e); }
            window.addEventListener('hashchange', () => this.fromHash());
            this.wireTheme();
            await this.fromHash();
        },

        async fromHash() {
            // Navigating away (links, back button) never leaves a dialog stranded.
            if (document.getElementById('sc-modal')) K.Modal.close();
            const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
            try {
                if (!parts.length) { this.S = null; this.route = { name: 'launcher' }; }
                else if (parts[0] === 'new') { this.S = null; this.route = { name: 'wizard' }; }
                else if (parts[0] === 'hof') { this.S = null; this.route = { name: 'hof' }; }
                else if (parts[0] === 'c' && parts[1]) {
                    if (!this.S || this.S.id !== parts[1]) {
                        const S = await SC.Store.load(parts[1]);
                        if (!S) { K.toast('That career no longer exists on this device.', 'error'); location.hash = '#/'; return; }
                        this.S = this.migrate(S);
                        this.undoInfo = await SC.Store.getUndo(S.id).catch(() => null);
                    }
                    this.route = { name: 'career', view: parts[2] || 'home', param: parts[3] || null };
                } else { location.hash = '#/'; return; }
            } catch (e) {
                console.error(e);
                K.toast('Could not open that career: ' + e.message, 'error');
                this.route = { name: 'launcher' };
            }
            await this.render();
        },

        // Forward-compatible save upgrades live here.
        migrate(S) {
            S.flags = S.flags || {};
            S.customTracks = S.customTracks || {};
            S.sponsorOffers = S.sponsorOffers || [];
            S.offers = S.offers || [];
            // Custom games keep their own ladder names across reloads.
            (S.customGame?.series || []).forEach(sd => {
                if (!SC.LADDERS[sd.ladder]) SC.LADDERS[sd.ladder] = { label: sd.ladder.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + ' Ladder', icon: '⭐' };
            });
            return S;
        },

        go(view, param = null) {
            if (!this.S) { location.hash = '#/'; return; }
            const h = `#/c/${encodeURIComponent(this.S.id)}/${view}${param ? '/' + encodeURIComponent(param) : ''}`;
            if (location.hash === h) this.render(); else location.hash = h;
        },
        nav(hash) { if (location.hash === hash) this.fromHash(); else location.hash = hash; },

        async save() { if (this.S) await SC.Store.save(this.S); },

        // Run an engine mutation safely. opts: { ok, undo (label), rerender, keepModal }
        async act(fn, opts = {}) {
            const S = this.S;
            if (!S) return undefined;
            let snapshot = null;
            if (opts.undo) snapshot = JSON.stringify(S);
            try {
                const result = await fn(S);
                if (opts.undo) {
                    await SC.Store.setUndo(S.id, snapshot, opts.undo);
                    this.undoInfo = { label: opts.undo, at: new Date().toISOString() };
                }
                await this.save();
                if (opts.ok) K.toast(typeof opts.ok === 'function' ? opts.ok(result) : opts.ok);
                if (opts.rerender !== false) await this.render();
                return result;
            } catch (e) {
                console.error(e);
                K.toast(e.message || String(e), 'error');
                // Roll back anything the failed action half-applied.
                try { const fresh = await SC.Store.load(S.id); if (fresh) this.S = this.migrate(fresh); } catch (e2) { /* keep memory copy */ }
                if (opts.rerender !== false) await this.render();
                return undefined;
            }
        },

        async undo() {
            const S = this.S;
            const u = await SC.Store.getUndo(S.id);
            if (!u) { K.toast('Nothing to undo.', 'info'); return; }
            const ok = await K.Modal.confirm('Undo last race?', `This restores your career to just before: <strong>${K.esc(u.label)}</strong>. Only one step of undo is kept.`, { ok: 'Undo' });
            if (!ok) return;
            this.S = this.migrate(JSON.parse(u.json));
            await SC.Store.clearUndo(S.id);
            this.undoInfo = null;
            await this.save();
            K.toast('Restored. ↩');
            this.go('race');
        },

        /* ---------------- rendering ---------------- */
        async render() {
            const rootEl = document.getElementById('sc-app');
            if (!rootEl) return;
            try {
                if (this.route.name === 'career' && this.S) {
                    rootEl.innerHTML = this.shell();
                    this.wireShell();
                    const el = document.getElementById('sc-view');
                    const fn = SC.Views[this.route.view] || SC.Views.home;
                    await fn(el, this.route.param);
                    el.classList.remove('view-anim'); void el.offsetWidth; el.classList.add('view-anim');
                } else {
                    rootEl.innerHTML = this.plainShell();
                    this.wireShell();
                    const el = document.getElementById('sc-view');
                    const fn = this.route.name === 'wizard' ? SC.Setup.wizard : this.route.name === 'hof' ? SC.Setup.hallOfFame : SC.Setup.launcher;
                    await fn(el);
                }
            } catch (e) {
                console.error(e);
                const el = document.getElementById('sc-view') || rootEl;
                el.innerHTML = K.empty('⚠️', 'Something went wrong on this screen', e.message, '<button class="btn btn-primary" onclick="location.reload()">Reload</button>');
            }
        },

        plainShell() {
            return `
            <header class="header"><div class="header-inner">
                <a class="brand" href="#/"><img src="../phoenix-logo.png" alt="" class="brand-logo"><span class="brand-name">Phoenix <em>Solo Career</em></span></a>
                <div class="header-user">
                    <a class="btn btn-ghost btn-sm" href="app.html" title="Multiplayer league app">🌐 League</a>
                    <button id="theme-toggle" class="icon-btn" aria-label="Toggle theme">🌙</button>
                </div>
            </div></header>
            <main id="sc-view" class="view-root"></main>
            <footer class="footer">Phoenix SRMPC · Solo Career · Saves live in this browser — export them from Settings to back up.</footer>`;
        },

        shell() {
            const S = this.S, E = SC.Engine;
            const P = S.player;
            const g = E.gameOf(S);
            const sd = E.seriesDef(S, S.season?.sid || P.sid);
            const t = S.teams[P.teamId];
            const unread = E.unread(S);
            const phaseTxt = S.phase === 'season' ? `Round ${Math.min(S.season.round + 1, S.season.events.length)}/${S.season.events.length}`
                : S.phase === 'preseason' ? 'Pre-season' : S.phase === 'postseason' ? 'Off-season' : 'Retired';
            const nav = NAV.map(([id, icon, label]) => `<button class="nav-btn ${this.route.view === id ? 'active' : ''}" data-go="${id}">
                <span class="sc-nav-icon">${icon}</span>${label}${id === 'inbox' && unread ? `<span class="nav-badge">${unread > 99 ? '99+' : unread}</span>` : ''}</button>`).join('');
            return `
            <header class="header sc-header"><div class="header-inner">
                <a class="brand" href="#/" title="Save slots"><img src="../phoenix-logo.png" alt="" class="brand-logo"><span class="brand-name">Solo <em>Career</em></span></a>
                <button id="nav-toggle" class="icon-btn nav-toggle" aria-label="Menu">☰</button>
                <nav id="main-nav" class="main-nav">${nav}</nav>
                <div class="header-user">
                    <button id="theme-toggle" class="icon-btn" aria-label="Toggle theme">🌙</button>
                    <a class="btn btn-ghost btn-sm" href="#/" title="Save & exit to your save slots">⏏ Exit</a>
                </div>
            </div>
            <div class="sc-statusbar"><div class="sc-statusbar-inner">
                <span class="chip" style="border-color:${K.esc(g.color)}">${g.icon} ${K.esc(g.short)}</span>
                <span class="sc-status-name">${K.flag(P.nat)} ${K.esc(P.first + ' ' + P.last)}${P.role !== 'principal' ? ` <span class="muted">#${P.num}</span>` : ''}</span>
                <span class="muted">${K.esc(E.ROLES[P.role].label)}${t ? ' · ' + K.esc(t.name) : ''}</span>
                <span class="muted">${K.esc(sd?.name || '')}</span>
                <span class="sc-status-spacer"></span>
                <span class="chip">📅 ${S.year} · Season ${S.seasonNo}/${S.settings.maxSeasons}</span>
                <span class="chip">${phaseTxt}</span>
                <span class="chip sc-money-chip ${K.moneyCls(P.money)}" title="Personal wallet">👤 ${K.money(P.money)}</span>
                ${t && P.role !== 'driver' ? `<span class="chip sc-money-chip ${K.moneyCls(t.budget)}" title="Team budget">🏢 ${K.money(t.budget)}</span>` : ''}
            </div></div>
            </header>
            <main id="sc-view" class="view-root"></main>
            <footer class="footer">Phoenix SRMPC · Solo Career · ${K.esc(g.name)} · autosaved ${new Date(S.updatedAt).toLocaleTimeString()}</footer>`;
        },

        wireShell() {
            K.$$('[data-go]').forEach(b => b.addEventListener('click', () => { K.$('#main-nav')?.classList.remove('open'); this.go(b.dataset.go); }));
            K.$('#nav-toggle')?.addEventListener('click', () => K.$('#main-nav').classList.toggle('open'));
            this.wireTheme();
        },

        wireTheme() {
            const btn = document.getElementById('theme-toggle');
            if (!btn) return;
            const apply = () => { btn.textContent = document.documentElement.getAttribute('data-theme') === 'light' ? '☀️' : '🌙'; };
            apply();
            btn.onclick = () => {
                const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
                document.documentElement.setAttribute('data-theme', next);
                try { localStorage.setItem('srmpc_theme', next); } catch (e) { /* */ }
                apply();
            };
        }
    };

    SC.App = App;
    SC.NAV = NAV;
    document.addEventListener('DOMContentLoaded', () => App.boot());
})(typeof window !== 'undefined' ? window : globalThis);
