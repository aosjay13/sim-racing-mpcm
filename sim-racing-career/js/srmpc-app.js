/* ============================================================
   Phoenix SRMPC — App bootstrap
   Routing, auth gate, header, navigation.
   ============================================================ */
'use strict';

const App = {
    current: { view: 'dashboard', param: null },
    _started: false,

    routes: {
        'dashboard': (el) => Views.dashboard(el),
        'series': (el) => Views.series(el),
        'series-detail': (el, id) => Views.seriesDetail(el, id),
        'races': (el) => Views.races(el),
        'standings': (el) => Views.standings(el),
        'stats': (el) => Views.stats(el),
        'challenges': (el) => Views.challenges(el),
        'career': (el) => Views.career(el),
        'dealership': (el) => Market.dealership(el),
        'hub': (el, tab) => Hub.render(el, tab),
        'profile': (el, uid) => Profile.render(el, uid),
        'admin': (el, tab) => Admin.render(el, tab)
    },

    async go(view, param = null) {
        const route = this.routes[view];
        if (!route) view = 'dashboard';
        this.current = { view, param };
        Modal.close(false, true); // silent — navigation renders fresh anyway

        // Nav highlight ('series-detail' highlights 'series')
        const navKey = view === 'series-detail' ? 'series' : view;
        Util.$$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === navKey));

        // Keep the header identity fresh (e.g. after founding a team or
        // creating a driver, which navigate here without an auth change).
        this.updateHeader();

        const el = document.getElementById('view-root');
        el.classList.remove('view-anim');
        el.innerHTML = '<div class="loading"><div class="loading-spinner"></div>Loading…</div>';
        window.scrollTo({ top: 0 });
        try {
            await (this.routes[view])(el, param);
            // Restart the view entrance animation (reflow resets it).
            void el.offsetWidth;
            el.classList.add('view-anim');
        } catch (e) {
            console.error(`Error rendering view "${view}":`, e);
            el.innerHTML = C.empty('⚠️', 'Something went wrong loading this page', e.message,
                `<button class="btn btn-primary" onclick="App.go('${view}'${param ? `,'${Util.attr(param)}'` : ''})">Try again</button>`);
        }
        this.refreshHubBadge(); // fire-and-forget — never blocks navigation
    },

    /* ---------------- League Hub notification badge ---------------- */
    // Red counter on the League Hub nav button: decisions waiting on me,
    // negotiations where it's my move, and unseen results of things I sent.
    async refreshHubBadge() {
        const el = document.getElementById('hub-badge');
        if (!el) return;
        let n = 0;
        try { if (Auth.isSignedIn()) n = await Hub.notifCount(); } catch (e) { /* signed out / offline */ }
        el.textContent = n > 99 ? '99+' : String(n);
        el.classList.toggle('hidden', !n);
    },

    /* ---------------- Startup ---------------- */
    async start() {
        // Kill any legacy service worker + caches from the old app so stale
        // code can never be served again.
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations()
                .then(regs => regs.forEach(r => r.unregister()))
                .catch(() => {});
        }
        if (window.caches?.keys) {
            caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {});
        }

        if (SRMPC.firebaseError) {
            document.getElementById('boot-error').classList.remove('hidden');
            document.getElementById('boot-error-msg').textContent = SRMPC.firebaseError.message;
            return;
        }

        this.wireAuthGate();
        this.wireHeader();

        Auth.onChange(() => this.onAuthChange());
        await Auth.init();
    },

    onAuthChange() {
        const gate = document.getElementById('auth-gate');
        const shell = document.getElementById('app-shell');
        const signedIn = Auth.isSignedIn();

        gate.classList.toggle('hidden', signedIn);
        shell.classList.toggle('hidden', !signedIn);
        this.updateHeader();

        if (signedIn && !this._started) {
            this._started = true;
            // Players without a role land on career (role picker); everyone else on dashboard.
            if (Auth.isPlayer() && !Auth.state.profile?.activeRole) this.go('career');
            else this.go('dashboard');
        } else if (!signedIn) {
            this._started = false;
        }
    },

    /* ---------------- Header ---------------- */
    wireHeader() {
        Util.$$('.nav-btn').forEach(btn =>
            btn.addEventListener('click', () => this.go(btn.dataset.view)));

        document.getElementById('signout-btn').addEventListener('click', async () => {
            await Auth.signOut();
            Util.notify('Signed out. See you on the grid!');
        });

        document.getElementById('gm-elevate-btn').addEventListener('click', () => this.showGmModal());
        document.getElementById('player-return-btn').addEventListener('click', () => this.returnToPlayer());

        // The role badge doubles as a switcher: players get the role picker,
        // an elevated Game Master drops back to their player career.
        document.getElementById('role-badge').addEventListener('click', () => {
            if (Auth.isAdmin() && this._canReturnToPlayer()) this.returnToPlayer();
            else if (Auth.isPlayer()) Career.showRolePicker();
        });

        // The username opens the player's own full profile page.
        document.getElementById('header-username').addEventListener('click', () => {
            if (Auth.uid() && Auth.state.profile) this.go('profile', Auth.uid());
        });

        // Theme toggle (light / dark)
        const themeBtn = document.getElementById('theme-toggle');
        const applyThemeIcon = () => {
            const dark = document.documentElement.getAttribute('data-theme') !== 'light';
            themeBtn.textContent = dark ? '🌙' : '☀️';
        };
        applyThemeIcon();
        themeBtn.addEventListener('click', () => {
            const dark = document.documentElement.getAttribute('data-theme') !== 'light';
            const next = dark ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            try { localStorage.setItem('srmpc_theme', next); } catch (e) { /* */ }
            applyThemeIcon();
        });

        // Mobile nav toggle
        document.getElementById('nav-toggle').addEventListener('click', () => {
            document.getElementById('main-nav').classList.toggle('open');
        });
        Util.$$('.nav-btn').forEach(btn => btn.addEventListener('click', () => {
            document.getElementById('main-nav').classList.remove('open');
        }));
    },

    updateHeader() {
        const badge = document.getElementById('role-badge');
        const gmBtn = document.getElementById('gm-elevate-btn');
        const playerBtn = document.getElementById('player-return-btn');
        const adminNav = document.getElementById('nav-admin');
        const careerNav = document.getElementById('nav-career');
        const userName = document.getElementById('header-username');

        // Fallback while the role identity (driver/team name) loads.
        const fallbackName = Auth.state.profile?.displayName
            || (Auth.state.user?.email || '').split('@')[0] || 'Player';

        if (Auth.isAdmin()) {
            badge.textContent = 'Game Master';
            badge.className = 'role-badge badge-admin' + (this._canReturnToPlayer() ? ' role-badge-btn' : '');
            badge.title = this._canReturnToPlayer() ? 'Switch back to your player career' : '';
            userName.textContent = Auth.state.profile ? fallbackName : 'Admin';
            if (Auth.state.profile) this._refreshHeaderIdentity(userName);
        } else if (Auth.isPlayer()) {
            const role = Career.roleInfo(Auth.state.profile?.activeRole);
            badge.textContent = role ? role.label : 'Player';
            badge.className = 'role-badge badge-player role-badge-btn';
            badge.title = 'Switch role';
            userName.textContent = fallbackName;
            this._refreshHeaderIdentity(userName);
        } else {
            badge.textContent = '';
            badge.className = 'role-badge';
            badge.title = '';
            userName.textContent = '';
        }

        gmBtn.classList.toggle('hidden', !Auth.isPlayer());
        playerBtn.classList.toggle('hidden', !this._canReturnToPlayer());
        adminNav.classList.toggle('hidden', !Auth.isAdmin());
        careerNav.classList.toggle('hidden', !(Auth.isPlayer() || (Auth.isAdmin() && Auth.state.profile)));
    },

    /* ---------------- Header identity ---------------- */
    // Shows who you ARE in the league, not your login: a Driver's driver
    // name, a Team Owner's team name, other roles' profile name.
    _identitySeq: 0,

    async _refreshHeaderIdentity(el) {
        const seq = ++this._identitySeq;
        try {
            const name = await this._identityName();
            // A newer header update may have run while we fetched — don't clobber it.
            if (name && seq === this._identitySeq) el.textContent = name;
        } catch (e) { /* keep the fallback name */ }
    },

    async _identityName() {
        const p = Auth.state.profile;
        if (!p) return null;
        const role = p.activeRole;

        if (role === 'driver' && p.driverId) {
            const d = await DB.get('drivers', p.driverId);
            if (d?.name) return d.name;
        }
        if (role === 'team-owner') {
            const teams = await DB.teams();
            const t = teams.find(t => t.ownerUid === Auth.uid());
            if (t?.name) return t.name;
        }
        if (role && role !== 'driver' && role !== 'team-owner') {
            const profiles = await DB.roleProfiles().catch(() => []);
            const mine = profiles.find(rp => rp.uid === Auth.uid() && rp.role === role);
            if (mine?.name) return mine.name;
        }
        return null;
    },

    /* ---------------- Game Master ⇄ Player switching ---------------- */
    _canReturnToPlayer() {
        return Auth.isAdmin() && !!Auth.state.user && !Auth.state.user.isAnonymous;
    },

    async returnToPlayer() {
        await Auth.dropAdmin();
        if (Auth.isPlayer()) {
            Util.notify('Back to your player career. Unlock GM again anytime with the GM button. 🏎');
            this.go('career');
        } else {
            Util.notify('Signed out of Game Master.');
        }
    },

    /* ---------------- Auth gate ---------------- */
    _gateMode: 'signin', // 'signin' | 'register'

    wireAuthGate() {
        // Tabs
        Util.$$('.gate-tab').forEach(tab => tab.addEventListener('click', () => {
            Util.$$('.gate-tab').forEach(t => t.classList.toggle('active', t === tab));
            document.getElementById('gate-player-pane').classList.toggle('hidden', tab.dataset.pane !== 'player');
            document.getElementById('gate-admin-pane').classList.toggle('hidden', tab.dataset.pane !== 'admin');
        }));

        // Player sign in / register toggle
        const modeToggle = document.getElementById('gate-mode-toggle');
        modeToggle.addEventListener('click', () => {
            this._gateMode = this._gateMode === 'signin' ? 'register' : 'signin';
            const registering = this._gateMode === 'register';
            document.getElementById('gate-name-field').classList.toggle('hidden', !registering);
            document.getElementById('gate-player-submit').textContent = registering ? 'Create Account & Start Career' : 'Sign In';
            modeToggle.textContent = registering ? '← Already have an account? Sign in' : 'New here? Create a player account →';
            this._gateError('');
        });

        document.getElementById('gate-forgot').addEventListener('click', async (e) => {
            e.preventDefault();
            const email = document.getElementById('gate-email').value.trim();
            if (!email) { this._gateError('Enter your email first, then click "Forgot password".'); return; }
            try {
                await Auth.sendPasswordReset(email);
                Util.notify('Password reset email sent — check your inbox.');
            } catch (err) { this._gateError(this._friendlyAuthError(err)); }
        });

        document.getElementById('gate-player-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('gate-player-submit');
            const email = document.getElementById('gate-email').value.trim();
            const password = document.getElementById('gate-password').value;
            const name = document.getElementById('gate-name').value.trim();
            this._gateError('');

            if (!email || !password) { this._gateError('Email and password are required.'); return; }
            if (this._gateMode === 'register' && password.length < 6) { this._gateError('Password must be at least 6 characters.'); return; }

            btn.disabled = true;
            btn.textContent = this._gateMode === 'register' ? 'Creating account…' : 'Signing in…';
            try {
                if (this._gateMode === 'register') await Auth.playerSignUp(email, password, name);
                else await Auth.playerSignIn(email, password);
                // onAuthChange handles the rest.
            } catch (err) {
                this._gateError(this._friendlyAuthError(err));
            } finally {
                btn.disabled = false;
                btn.textContent = this._gateMode === 'register' ? 'Create Account & Start Career' : 'Sign In';
            }
        });

        document.getElementById('gate-admin-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('gate-admin-submit');
            const passcode = document.getElementById('gate-passcode').value;
            const errEl = document.getElementById('gate-admin-error');
            errEl.textContent = '';
            if (!passcode) { errEl.textContent = 'Enter the admin passcode.'; return; }
            btn.disabled = true;
            btn.textContent = 'Unlocking…';
            try {
                await Auth.unlockAdmin(passcode);
                Util.notify('Welcome back, Game Master. ⚙');
            } catch (err) {
                errEl.textContent = err.message || 'Incorrect passcode.';
            } finally {
                btn.disabled = false;
                btn.textContent = 'Unlock Game Master';
            }
        });
    },

    /* ---------------- Game Master elevation ---------------- */
    showGmModal() {
        Modal.open(`
            ${Modal.header('⚙ Unlock Game Master', 'Enter the passcode to run the league on top of your player account.')}
            <form id="gm-form" class="form-grid">
                <label class="field"><span>Game Master passcode</span>
                    <input id="gm-pass" class="input" type="password" autocomplete="off" placeholder="Passcode" required autofocus></label>
                <p id="gm-error" class="form-error"></p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Unlock</button>
                </div>
            </form>
        `);
        const form = document.getElementById('gm-form');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = form.querySelector('button[type=submit]');
            const passcode = document.getElementById('gm-pass').value;
            if (!passcode) return;
            btn.disabled = true; btn.textContent = 'Unlocking…';
            try {
                await Auth.elevateToAdmin(passcode);
                Modal.close();
                Util.notify('Game Master unlocked. ⚙');
                this.go('admin');
            } catch (err) {
                document.getElementById('gm-error').textContent = err.message || 'Incorrect passcode.';
                btn.disabled = false; btn.textContent = 'Unlock';
            }
        });
        setTimeout(() => document.getElementById('gm-pass')?.focus(), 50);
    },

    _gateError(msg) {
        document.getElementById('gate-player-error').textContent = msg;
    },

    _friendlyAuthError(err) {
        const map = {
            'auth/user-not-found': 'No account found with this email. New here? Create an account below.',
            'auth/wrong-password': 'Incorrect email or password.',
            'auth/invalid-credential': 'Incorrect email or password.',
            'auth/invalid-email': 'That email address doesn’t look valid.',
            'auth/email-already-in-use': 'This email is already registered — switch to Sign In.',
            'auth/weak-password': 'Password is too weak — use at least 6 characters.',
            'auth/too-many-requests': 'Too many attempts. Wait a bit and try again.',
            'auth/network-request-failed': 'Network error — check your connection and try again.'
        };
        return map[err.code] || err.message || 'Something went wrong. Please try again.';
    }
};
window.App = App;

document.addEventListener('DOMContentLoaded', () => App.start());
