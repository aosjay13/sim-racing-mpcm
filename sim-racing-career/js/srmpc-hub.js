/* ============================================================
   Phoenix SRMPC — League Hub
   News feed (auto-generated league announcements),
   achievements (computed live from results, visible to all),
   and the recruitment center (offers, applications,
   release requests, contract buyouts).
   ============================================================ */
'use strict';

/* ---------------- League news ---------------- */
const News = {
    // Fire-and-forget: a failed news post must never break the action
    // (join, hire, result entry) that triggered it.
    async post(icon, message) {
        try {
            await DB.create('news', { icon, message, date: Util.todayISO() });
        } catch (e) { console.warn('News post failed:', e); }
    }
};
window.News = News;

/* ---------------- Achievements (computed live) ---------------- */
const ACHIEVEMENTS = [
    { id: 'first-start', icon: '🏁', label: 'First Start', desc: 'Complete your first league race', check: r => r.starts >= 1 },
    { id: 'veteran', icon: '🎖', label: 'Veteran', desc: '10 race starts', check: r => r.starts >= 10 },
    { id: 'podium', icon: '🍾', label: 'On the Box', desc: 'Finish on the podium', check: r => r.podiums >= 1 },
    { id: 'podium-regular', icon: '🥂', label: 'Podium Regular', desc: '5 podium finishes', check: r => r.podiums >= 5 },
    { id: 'first-win', icon: '🏆', label: 'First Win', desc: 'Win a league race', check: r => r.wins >= 1 },
    { id: 'hat-trick', icon: '🎩', label: 'Hat-Trick', desc: '3 race wins', check: r => r.wins >= 3 },
    { id: 'dominator', icon: '👑', label: 'Dominator', desc: '5 race wins', check: r => r.wins >= 5 },
    { id: 'pole-sitter', icon: '🅿️', label: 'Pole Sitter', desc: 'Take a pole position', check: r => r.poles >= 1 },
    { id: 'flying-lap', icon: '⚡', label: 'Flying Lap', desc: 'Set a fastest lap', check: r => r.fastestLaps >= 1 },
    { id: 'century', icon: '💯', label: 'Century Club', desc: '100 career points', check: r => r.points >= 100 },
    { id: 'iron', icon: '🛡', label: 'Iron Reliability', desc: '5+ starts without a DNF', check: r => r.starts >= 5 && r.dnfs === 0 }
];
const ACH_CHAMPION = { id: 'champion', icon: '🌟', label: 'League Champion', desc: 'Crowned champion of a completed season' };
window.ACHIEVEMENTS = ACHIEVEMENTS;

/* ---------------- The Hub view ---------------- */
const Hub = {
    _tab: 'news',

    // Standard terms for an instant "Join a team" signing. The recruitment
    // center lets owners offer custom terms instead.
    STANDARD_SALARY: 200,
    buyoutFor(salary) { return Math.max(1000, Math.round(Number(salary) || 0) * 10); },

    /* ---------------- Recruitment profiles (per-role attributes) ---------------- */
    // What teams filter candidates by, per position. num = 1-10 self-rating.
    // Drivers are the exception: Pace and Safety are NOT self-rated — they're
    // derived live from race results (Stats.driverPace/driverSafety) so a
    // rookie can't just type in a 10. See recruitChips().
    RECRUIT_ATTRS: {
        'driver': [
            { id: 'disciplines', label: 'Preferred disciplines', type: 'text', ph: 'GT3, ovals, endurance…' },
            { id: 'availability', label: 'Schedule availability', type: 'text', ph: 'Weeknights EU, Sunday races…' }
        ],
        'crew-chief': [
            { id: 'strategy', label: 'Race strategy experience', type: 'num' },
            { id: 'efficiency', label: 'Fuel & tire calculation', type: 'num' },
            { id: 'communication', label: 'Communication style', type: 'text', ph: 'Calm on the radio, data-first…' }
        ],
        'mechanic': [
            { id: 'telemetry', label: 'Telemetry analysis', type: 'num' },
            { id: 'setups', label: 'Setup building', type: 'num' },
            { id: 'classes', label: 'Car classes', type: 'text', ph: 'GT3, LMP2, stock cars…' }
        ],
        'agent': [
            { id: 'negotiation', label: 'Negotiation skill', type: 'num' },
            { id: 'networking', label: 'Sponsor networking', type: 'num' },
            { id: 'roster', label: 'Roster management', type: 'text', ph: 'How many clients, what kind…' }
        ]
    },
    _recruitRoleInfo(role) {
        return role === 'driver' ? { icon: '🏎️', label: 'Driver' }
            : (ROLES.find(r => r.id === role) || staffRoleInfo(role));
    },

    // Compact chips for scouting lists / applications: "Pace 8/10 · GT3, ovals".
    // `live` = { pace, safety } for role 'driver' — computed by the caller via
    // Stats.driverPace/driverSafety (needs `world`, which chip-building call
    // sites already have loaded). Never reads a self-reported pace/safety.
    recruitChips(role, recruit, live = null) {
        const chips = [];
        if (role === 'driver') {
            const pace = live?.pace ?? 0, safety = live?.safety ?? 0;
            chips.push(`<span class="chip chip-dim" title="Derived live from race results — not self-reported">Pace: ${pace}/10</span>`);
            chips.push(`<span class="chip chip-dim" title="Derived live from incident data — not self-reported">Safety: ${safety}/10</span>`);
        }
        const defs = this.RECRUIT_ATTRS[role];
        if (defs && recruit) {
            defs.forEach(a => {
                const v = recruit[a.id];
                if (v === undefined || v === null || v === '') return;
                chips.push(`<span class="chip chip-dim" title="${Util.esc(a.label)}">${Util.esc(a.label)}: ${a.type === 'num' ? `${Number(v)}/10` : Util.esc(String(v).slice(0, 40))}</span>`);
            });
        }
        return chips.join('');
    },

    // Edit MY recruitment profile for my active role. Drivers store it on
    // their driver doc; crew chiefs / mechanics / agents on their roleProfile.
    async recruitProfileForm() {
        const role = Auth.state.profile?.activeRole;
        const defs = this.RECRUIT_ATTRS[role];
        if (!defs) { Util.notify('Your current role is not recruited by teams.', 'info'); return; }
        let collection, doc;
        if (role === 'driver') {
            collection = 'drivers';
            doc = Auth.state.profile?.driverId ? await DB.get('drivers', Auth.state.profile.driverId) : null;
            if (!doc) { Util.notify('Create your driver profile first (My Career).', 'info'); return; }
        } else {
            collection = 'roleProfiles';
            doc = (await DB.roleProfiles({ force: true }).catch(() => []))
                .find(p => p.uid === Auth.uid() && p.role === role);
            if (!doc) { Util.notify(`Create your ${this._recruitRoleInfo(role).label} profile first (My Career).`, 'info'); return; }
        }
        const cur = doc.recruit || {};
        const info = this._recruitRoleInfo(role);
        let liveChips = '';
        if (role === 'driver') {
            const world = await DB.loadWorld();
            liveChips = this.recruitChips('driver', null, {
                pace: Stats.driverPace(doc.id, world.races, world),
                safety: Stats.driverSafety(doc.id, world.races, world)
            });
        }
        Modal.open(`
            ${Modal.header(`🧲 Recruitment Profile — ${Util.esc(doc.name)}`, `What teams see when scouting a ${info.label}. Honest numbers get better offers.`)}
            <form id="recruit-form" class="form-grid">
                <label class="check"><input id="rc-open" type="checkbox" ${doc.openToOffers === false ? '' : 'checked'}>
                    🟢 Open to offers — show me on the free agent / scouting lists</label>
                ${role === 'driver' ? `<div class="chip-row">${liveChips}</div>
                <p class="muted small">🔢 Pace and Safety are no longer self-rated — they're tracked automatically from your race results (finishing position and on-track incidents) and rise or fall as you race.</p>` : ''}
                ${defs.map(a => a.type === 'num'
                    ? `<label class="field"><span>${Util.esc(a.label)} (1–10)</span>
                        <input id="rc-${a.id}" class="input" type="number" min="1" max="10" value="${Number(cur[a.id]) || 5}"></label>`
                    : `<label class="field"><span>${Util.esc(a.label)}</span>
                        <input id="rc-${a.id}" class="input" maxlength="80" value="${Util.esc(cur[a.id] || '')}" placeholder="${Util.esc(a.ph || '')}"></label>`).join('')}
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save Profile 🧲</button>
                </div>
            </form>
        `);
        Util.$('#recruit-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const recruit = {};
                defs.forEach(a => {
                    const raw = Util.$('#rc-' + a.id).value;
                    recruit[a.id] = a.type === 'num' ? Math.max(1, Math.min(10, Number(raw) || 5)) : raw.trim();
                });
                await DB.update(collection, doc.id, { recruit, openToOffers: Util.$('#rc-open').checked });
                Modal.close();
                Util.notify('Recruitment profile saved — teams scouting your role will see it. 🧲');
                App.go('career');
            } catch (err) { Util.notify(err.message, 'error'); }
        });
    },

    async render(el, tab) {
        if (tab) this._tab = tab;
        const t = this._tab;

        // Pending inbox count for the tab label (cheap: cached after first load).
        let inboxCount = 0;
        try { inboxCount = (await this._inbox()).length; } catch (e) { /* signed out */ }

        const tabs = [
            ['news', '📣 News'],
            ['achievements', '🏅 Achievements'],
            ['players', '👥 Players'],
            ['recruitment', `🤝 Recruitment${inboxCount ? ` (${inboxCount})` : ''}`]
        ];
        el.innerHTML = `
        <div class="view-head">
            <div><h1>League Hub</h1><p class="muted">Announcements, achievements, and the driver market — the league's living room.</p></div>
        </div>
        <div class="filter-bar"><div class="tab-row">
            ${tabs.map(([id, label]) => `<button class="tab ${t === id ? 'active' : ''}" data-hub-tab="${id}">${label}</button>`).join('')}
        </div></div>
        <div id="hub-body"><div class="loading"><div class="loading-spinner"></div>Loading…</div></div>`;

        Util.$$('[data-hub-tab]', el).forEach(btn => btn.addEventListener('click', () => {
            this._tab = btn.dataset.hubTab;
            this.render(el);
        }));

        const body = Util.$('#hub-body', el);
        try {
            await this['tab_' + t](body);
        } catch (e) {
            console.error(e);
            body.innerHTML = C.empty('⚠️', 'Could not load this section', e.message);
        }
    },

    refresh() {
        const el = document.getElementById('view-root');
        if (el && App.current.view === 'hub') this.render(el);
    },

    /* ---------------- News tab ---------------- */
    async tab_news(el) {
        let news = [];
        try { news = await DB.news({ force: true }); } catch (e) { /* none yet */ }
        news.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

        el.innerHTML = `
        <section class="panel">
            <div class="panel-head"><h2>📣 League Announcements</h2><span class="chip chip-dim">Auto-generated</span></div>
            ${news.length ? news.slice(0, 50).map(n => `
                <div class="race-row">
                    <div class="driver-hero-num" style="font-size:1.1rem;min-width:2.6rem;height:2.6rem">${n.icon || '📣'}</div>
                    <div class="race-row-main">
                        <span class="race-title">${Util.esc(n.message)}</span>
                        <span class="race-sub">${Util.esc(Util.fmtDate(n.date))}</span>
                    </div>
                    ${Auth.isAdmin() ? `<button class="btn btn-danger btn-sm" onclick="Hub.deleteNews('${Util.attr(n.id)}')" title="Game Master: remove this announcement">Del</button>` : ''}
                </div>`).join('')
            : C.empty('📣', 'No news yet', 'The feed writes itself: driver signings, team takeovers, race winners, contract buyouts — every career move lands here automatically.')}
        </section>`;
    },

    // Game Master only: pull an announcement from the league feed.
    async deleteNews(id) {
        if (!Auth.isAdmin()) { Util.notify('Only the Game Master can delete news.', 'error'); return; }
        if (!confirm('Delete this announcement from the league news feed?')) return;
        try {
            await DB.remove('news', id);
            Util.notify('Announcement deleted. 🗑');
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    /* ---------------- Achievements tab ---------------- */
    async tab_achievements(el) {
        const world = await DB.loadWorld();
        const rows = Stats.driverTable(world.races, world);
        const championIds = new Set((world.seasons || [])
            .filter(se => se.status === 'completed' && se.championDriverId)
            .map(se => se.championDriverId));

        const entries = rows.map(r => {
            const earned = ACHIEVEMENTS.filter(a => a.check(r));
            if (championIds.has(r.driverId)) earned.unshift(ACH_CHAMPION);
            return { row: r, earned };
        }).filter(e => e.earned.length)
            .sort((a, b) => b.earned.length - a.earned.length || b.row.points - a.row.points);

        el.innerHTML = `
        <div class="grid-2">
            <section class="panel">
                <div class="panel-head"><h2>🏅 Earned Achievements</h2><span class="chip chip-dim">Live from results</span></div>
                ${entries.length ? entries.map(({ row, earned }) => `
                    <div class="race-row" onclick="Views.showDriver('${Util.attr(row.driverId)}')">
                        <div class="race-row-main">
                            <span class="race-title">${Util.esc(row.driver.name)}
                                <span class="chip chip-dim">${earned.length}/${ACHIEVEMENTS.length + 1}</span>
                                ${row.driver.ownerUid ? '<span class="badge badge-blue">Player</span>' : ''}
                            </span>
                            <span class="race-sub chip-row" style="margin-top:.25rem">
                                ${earned.map(a => `<span class="chip rating-chip" title="${Util.esc(a.label)} — ${Util.esc(a.desc)}">${a.icon} ${Util.esc(a.label)}</span>`).join('')}
                            </span>
                        </div>
                    </div>`).join('')
                : C.empty('🏅', 'No achievements earned yet', 'Achievements unlock automatically from race results — the first finisher earns First Start.')}
            </section>

            <section class="panel">
                <div class="panel-head"><h2>📖 All Achievements</h2></div>
                <div class="card-grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">
                    ${[ACH_CHAMPION, ...ACHIEVEMENTS].map(a => `
                        <div class="record-card">
                            <span class="record-icon">${a.icon}</span>
                            <div><span class="record-value">${Util.esc(a.label)}</span>
                            <span class="record-label">${Util.esc(a.desc)}</span></div>
                        </div>`).join('')}
                </div>
            </section>
        </div>`;
    },

    /* ---------------- Players tab (directory of real players) ---------------- */
    tab_players(el) { return Profile.directory(el); },

    /* ---------------- Recruitment tab ---------------- */
    // Does this recruitment item need THIS user's decision? Offers go to the
    // talent; applications and release requests go to the team's owner — or to
    // the Game Master when the team has no player owner. Vacancies are job
    // postings, not decisions.
    _forMe(r, uid) {
        if (r.kind === 'vacancy') return false;
        return r.ownerUid ? r.ownerUid === uid : Auth.isAdmin();
    },

    // Did I send this item? (For "your application was answered" events.)
    _sentByMe(r, uid) {
        if (r.kind === 'vacancy') return false;
        return r.driverUid === uid || r.applicantUid === uid;
    },

    // Everything pending that needs MY decision (recruitment + negotiations).
    async _inbox() {
        if (!Auth.isSignedIn()) return [];
        const uid = Auth.uid();
        if (!uid) return [];
        const items = await DB.recruitment({ force: true }).catch(() => []);
        const pending = items.filter(r => r.status === 'pending' && this._forMe(r, uid));
        let negs = 0;
        try { negs = await Deals.myTurnCount(); } catch (e) { /* fine */ }
        return [...pending, ...Array(negs).fill({ kind: 'negotiation' })];
    },

    // Powers the red counter on the League Hub nav button: decisions waiting
    // on me + negotiations where it's my move + unseen answers to things I
    // sent (my offer was declined, my application was accepted, …).
    async notifCount() {
        const uid = Auth.uid();
        if (!uid) return 0;
        const items = await DB.recruitment({ force: true }).catch(() => []);
        const pending = items.filter(r => r.status === 'pending' && this._forMe(r, uid)).length;
        const unseen = items.filter(r => this._sentByMe(r, uid)
            && ['accepted', 'declined'].includes(r.status) && !r['seen_' + uid]).length;
        let negs = 0;
        try { negs = await Deals.myTurnCount(); } catch (e) { /* fine */ }
        return pending + unseen + negs;
    },

    _scoutFilter: 'all',

    async tab_recruitment(el) {
        const uid = Auth.uid();
        const [world, recruitment, contracts, myDeals, roleProfiles] = await Promise.all([
            DB.loadWorld(),
            DB.recruitment({ force: true }).catch(() => []),
            DB.contracts({ force: true }).catch(() => []),
            Deals.mine().catch(() => []),
            DB.roleProfiles({ force: true }).catch(() => [])
        ]);
        const profile = Auth.state.profile;
        const myTeam = world.teams.find(t => t.ownerUid === uid);
        const myDriver = profile?.driverId ? world.driversById[profile.driverId] : null;
        const myRoleProfiles = roleProfiles.filter(p => p.uid === uid);

        const inbox = recruitment.filter(r => r.status === 'pending' && this._forMe(r, uid));
        const outbox = recruitment.filter(r => this._sentByMe(r, uid))
            .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 8);
        const openDeals = myDeals.filter(n => n.status === 'open');

        // Answers I haven't seen yet light up in Sent — mark them seen now
        // (they've been shown), then let the nav badge recount.
        const unseen = new Set(recruitment.filter(r => this._sentByMe(r, uid)
            && ['accepted', 'declined'].includes(r.status) && !r['seen_' + uid]).map(r => r.id));
        if (unseen.size) {
            Promise.all([...unseen].map(rid => DB.update('recruitment', rid, { ['seen_' + uid]: true }).catch(() => {})))
                .then(() => App.refreshHubBadge());
        }

        const kindLabel = { application: 'Application', 'release-request': 'Release request' };
        const statusBadge = (s) => `<span class="badge ${s === 'pending' ? 'badge-amber' : s === 'accepted' ? 'badge-green' : 'badge-dim'}">${Util.esc(s)}</span>`;

        const inboxRow = (r) => {
            let text = '', sub = '', actions = '', chips = '';
            if (r.kind === 'application') {
                const unowned = !r.ownerUid;
                const isStaff = !!r.profileId;
                const roleInfo = this._recruitRoleInfo(r.role || 'driver');
                const vac = r.vacancyId ? recruitment.find(v => v.id === r.vacancyId) : null;
                text = isStaff
                    ? `${r.applicantName} applies for ${roleInfo.label} at ${r.teamName}`
                    : `${r.driverName} wants to drive for ${r.teamName}`;
                sub = (vac ? `Vacancy: “${vac.title}” — ` : '') + (unowned
                    ? '🤖 This team has no player owner — negotiate the deal yourself as GM' + (isStaff ? '' : ', or send in the AI team principal')
                    : 'Accepting opens a contract form where you set their pay');
                chips = this.recruitChips(r.role || 'driver', r.attrs, !isStaff && r.driverId
                    ? { pace: Stats.driverPace(r.driverId, world.races, world), safety: Stats.driverSafety(r.driverId, world.races, world) }
                    : null);
                actions = `<button class="btn btn-primary btn-sm" onclick="Hub.${isStaff ? 'acceptStaffApplication' : 'acceptApplication'}('${Util.attr(r.id)}')">✍️ ${unowned ? 'Negotiate as GM' : 'Sign them'}</button>
                    ${unowned && !isStaff ? `<button class="btn btn-secondary btn-sm" onclick="Hub.aiPrincipal('${Util.attr(r.id)}')">🤖 AI Principal</button>` : ''}
                    <button class="btn btn-danger btn-sm" onclick="Hub.actApplication('${Util.attr(r.id)}',false)">✕ Decline</button>`;
            } else {
                text = `${r.driverName} requests release from ${r.teamName}`;
                sub = `Their contract buyout is ${Economy.fmt(r.buyout)} — you can let them go for free or make them pay it`;
                actions = `<button class="btn btn-primary btn-sm" onclick="Hub.actRelease('${Util.attr(r.id)}',true)">✓ Release free</button>
                    <button class="btn btn-danger btn-sm" onclick="Hub.actRelease('${Util.attr(r.id)}',false)">✕ They must pay</button>`;
            }
            return `<div class="race-row">
                <div class="race-row-main">
                    <span class="race-title">${Util.esc(text)}</span>
                    <span class="race-sub">${Util.esc(sub)}</span>
                    ${chips ? `<span class="chip-row" style="margin-top:.2rem">${chips}</span>` : ''}
                </div>
                <div class="btn-row">${actions}</div>
            </div>`;
        };

        // ---- Scouting pool: player drivers an owner can approach (free agents
        // AND non-exclusive multi-team drivers) + player crew free agents.
        const activeDriverContracts = (id) => contracts.filter(c => c.status === 'active' &&
            c.type !== 'sponsorship' && c.personKind === 'driver' && c.personId === id);
        const signable = myTeam
            ? world.drivers.filter(d => d.ownerUid && d.ownerUid !== uid && d.openToOffers !== false).filter(d => {
                const act = activeDriverContracts(d.id);
                return !act.some(c => c.exclusive !== false) && !act.some(c => c.teamId === myTeam.id);
            })
            : [];
        const scoutStaff = myTeam
            ? roleProfiles.filter(p => p.uid && p.uid !== uid && p.role !== 'driver'
                && this.RECRUIT_ATTRS[p.role] && !p.teamId && p.openToOffers !== false)
            : [];
        const f = this._scoutFilter;
        const scoutRows = [
            ...(f === 'all' || f === 'driver' ? signable.map(d => ({ kind: 'driver', p: d })) : []),
            ...(f === 'all' ? scoutStaff : scoutStaff.filter(p => p.role === f)).map(p => ({ kind: 'staff', p }))
        ];
        const scoutFilters = [['all', 'All'], ['driver', '🏎️ Drivers'], ['crew-chief', '📋 Crew Chiefs'], ['mechanic', '🔧 Mechanics'], ['agent', '💼 Agents']];

        // ---- Job board: open vacancies, newest first.
        const vacancies = recruitment.filter(r => r.kind === 'vacancy' && r.status === 'open')
            .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        const canPostVacancy = !!myTeam || Auth.isAdmin();
        const myRoleFor = (role) => role === 'driver' ? null : myRoleProfiles.find(p => p.role === role);

        // Teams a player driver can apply to (multi-team aware).
        const myActive = myDriver ? activeDriverContracts(myDriver.id) : [];
        const canSeekTeams = myDriver && !myActive.some(c => c.exclusive !== false);
        const openTeams = canSeekTeams
            ? world.teams.filter(t => t.recruiting !== false && t.ownerUid !== uid && !myActive.some(c => c.teamId === t.id))
            : [];

        el.innerHTML = `
        <div class="grid-2">
            <section class="panel">
                <div class="panel-head"><h2>📥 Inbox (${inbox.length + openDeals.filter(n => n.turnUid === uid).length})</h2></div>
                ${openDeals.filter(n => n.turnUid === uid).map(n => `
                    <div class="race-row">
                        <div class="race-row-main">
                            <span class="race-title">🤝 Negotiation: ${Util.esc(Deals._label(n))} <span class="badge badge-amber">Your move</span></span>
                            <span class="race-sub">${Economy.fmt(n.salary)}/race on the table${n.kind === 'team-driver' && !n.contractId ? (n.exclusive ? ' · exclusive' : ' · non-exclusive') : ''}</span>
                        </div>
                        <button class="btn btn-primary btn-sm" onclick="Deals.room('${Util.attr(n.id)}')">Open room</button>
                    </div>`).join('')}
                ${inbox.length ? inbox.map(inboxRow).join('') : ''}
                ${!inbox.length && !openDeals.some(n => n.turnUid === uid) ? '<p class="muted">Nothing needs your decision right now. 🎉</p>' : ''}
                ${openDeals.filter(n => n.turnUid !== uid).length ? `<h3 class="section-label" style="margin-top:1rem">⏳ Awaiting their answer</h3>
                    ${openDeals.filter(n => n.turnUid !== uid).map(n => `<div class="race-row">
                        <div class="race-row-main">
                            <span class="race-title">${Util.esc(Deals._label(n))}</span>
                            <span class="race-sub">${Economy.fmt(n.salary)}/race on the table</span>
                        </div>
                        <button class="btn btn-ghost btn-sm" onclick="Deals.room('${Util.attr(n.id)}')">Open</button>
                    </div>`).join('')}` : ''}
                ${outbox.length ? `<h3 class="section-label" style="margin-top:1rem">📤 Sent</h3>
                    ${outbox.map(r => `<div class="race-row ${unseen.has(r.id) ? 'deal-latest' : ''}">
                        <div class="race-row-main">
                            <span class="race-title">${Util.esc(kindLabel[r.kind] || r.kind)} — ${Util.esc(r.teamName)}
                                ${r.role && r.role !== 'driver' ? `<span class="chip chip-dim">${Util.esc(this._recruitRoleInfo(r.role).label)}</span>` : ''}
                                ${unseen.has(r.id) ? '<span class="badge badge-red">new</span>' : ''}</span>
                            ${r.salary ? `<span class="race-sub">${Economy.fmt(r.salary)}/race</span>` : ''}
                            ${r.status === 'declined' && r.politeMsg ? `<span class="race-sub">“${Util.esc(r.politeMsg)}”</span>` : ''}
                        </div>
                        ${statusBadge(r.status)}
                    </div>`).join('')}` : ''}
            </section>

            <section class="panel">
                <div class="panel-head"><h2>📌 Job Board</h2>
                    ${canPostVacancy ? `<button class="btn btn-secondary btn-sm" onclick="Hub.vacancyForm()">＋ Post a Vacancy</button>` : '<span class="chip chip-dim">Open positions across the league</span>'}
                </div>
                ${vacancies.length ? vacancies.map(v => {
                    const roleInfo = this._recruitRoleInfo(v.role);
                    const applied = recruitment.some(r => r.kind === 'application' && r.vacancyId === v.id && r.status === 'pending'
                        && (r.driverUid === uid || r.applicantUid === uid));
                    const mine = v.ownerUid === uid || v.postedBy === uid || (!v.ownerUid && Auth.isAdmin());
                    const eligible = v.role === 'driver'
                        ? (myDriver && canSeekTeams && !myActive.some(c => c.teamId === v.teamId))
                        : (myRoleFor(v.role) && !myRoleFor(v.role).teamId);
                    return `<div class="race-row">
                        <div class="race-row-main">
                            <span class="race-title">${roleInfo.icon || '👷'} ${Util.esc(v.title || `${roleInfo.label} wanted`)}
                                <span class="chip chip-dim">${Util.esc(roleInfo.label)}</span>
                                <span class="chip chip-dim">${Util.esc(v.teamName)}${v.ownerUid ? ' 👤' : ' 🤖'}</span></span>
                            <span class="race-sub">${Util.esc(v.description || '')}${v.salary ? ` · around ${Economy.fmt(v.salary)}/race` : ''}</span>
                        </div>
                        <div class="btn-row">
                            ${applied ? '<span class="badge badge-amber">Applied</span>'
                                : (v.ownerUid !== uid && eligible ? `<button class="btn btn-primary btn-sm" onclick="Hub.applyVacancy('${Util.attr(v.id)}')">Apply</button>` : '')}
                            ${mine ? `<button class="btn btn-ghost btn-sm" onclick="Hub.closeVacancy('${Util.attr(v.id)}')" title="Close this vacancy">✕ Close</button>` : ''}
                        </div>
                    </div>`;
                }).join('') : C.empty('📌', 'No open vacancies', 'Team owners post open positions here — drivers, crew chiefs, mechanics, and agents apply directly to the posting.')}
            </section>

            ${myTeam ? `<section class="panel">
                <div class="panel-head"><h2>🔭 Scout Free Agents</h2><span class="chip chip-dim">Pick your target, open a negotiation</span></div>
                <div class="chip-row" style="margin-bottom:.5rem">
                    ${scoutFilters.map(([id, label]) => `<button class="chip chip-btn ${f === id ? 'chip-active' : ''}" onclick="Hub._setScout('${id}')">${label}</button>`).join('')}
                </div>
                ${scoutRows.length ? scoutRows.map(({ kind, p }) => {
                    if (kind === 'driver') {
                        const act = activeDriverContracts(p.id);
                        return `<div class="race-row">
                            <div class="race-row-main">
                                <span class="race-title">🏎️ ${Util.esc(p.name)} <span class="badge badge-blue">Player</span></span>
                                <span class="race-sub">${act.length ? `${Util.plural(act.length, 'team')} (non-exclusive) — open to another seat` : Util.esc(p.country || 'Free agent')}</span>
                                <span class="chip-row" style="margin-top:.2rem">${this.recruitChips('driver', p.recruit, { pace: Stats.driverPace(p.id, world.races, world), safety: Stats.driverSafety(p.id, world.races, world) })}</span>
                            </div>
                            <button class="btn btn-primary btn-sm" onclick="Hub.offerForm('${Util.attr(p.id)}','${Util.attr(myTeam.id)}')">✍️ Offer</button>
                        </div>`;
                    }
                    const info = this._recruitRoleInfo(p.role);
                    return `<div class="race-row">
                        <div class="race-row-main">
                            <span class="race-title">${info.icon || '👷'} ${Util.esc(p.name)} <span class="badge badge-blue">Player</span> <span class="chip chip-dim">${Util.esc(info.label)}</span></span>
                            <span class="race-sub">${Util.esc(p.bio || 'Free agent')}</span>
                            <span class="chip-row" style="margin-top:.2rem">${this.recruitChips(p.role, p.recruit)}</span>
                        </div>
                        <button class="btn btn-primary btn-sm" onclick="Hub.staffOfferForm('${Util.attr(p.id)}','${Util.attr(myTeam.id)}')">✍️ Offer</button>
                    </div>`;
                }).join('')
                    : '<p class="muted">Nobody matches this filter right now. Players appear here when their recruitment profile is open to offers (AI free agents are hired from My Career → Hire).</p>'}
            </section>` : ''}

            ${canSeekTeams ? `<section class="panel">
                <div class="panel-head"><h2>🪑 Teams Hiring</h2><span class="chip chip-dim">${myActive.length ? 'Add another seat — your deals are non-exclusive' : 'Apply for a seat'}</span></div>
                ${openTeams.length ? openTeams.map(t => {
                    const pending = recruitment.some(r => r.kind === 'application' && r.driverId === myDriver.id && r.teamId === t.id && r.status === 'pending');
                    return `<div class="race-row">
                        ${C.logoBox(t)}
                        <div class="race-row-main">
                            <span class="race-title">${Util.esc(t.name)}</span>
                            <span class="race-sub">${Util.esc(t.description || 'Recruiting drivers')}</span>
                        </div>
                        ${pending ? '<span class="badge badge-amber">Applied</span>'
                            : `<button class="btn btn-primary btn-sm" onclick="Hub.apply('${Util.attr(t.id)}')">Apply</button>`}
                    </div>`;
                }).join('') : '<p class="muted">No teams are recruiting right now.</p>'}
            </section>` : ''}

            ${(!myTeam && !myDriver) ? `<section class="panel">
                <div class="panel-head"><h2>🤝 How it works</h2></div>
                <p class="muted">Team owners negotiate contracts with player drivers, and drivers apply to recruiting teams — real salaries, buyout clauses, and counter-offers in a shared deal room. Create a driver profile or found a team in <a href="#" onclick="App.go('career');return false">My Career</a> to join the market.</p>
            </section>` : ''}

            <section class="panel">
                <div class="panel-head"><h2>📜 Contract Rules</h2></div>
                <p class="muted small">• Every signing is a negotiation: one side offers a salary per race, the other <strong>accepts, counters, or declines</strong> — with messages in a shared deal room. AI talent answers instantly, and unowned teams negotiate through the Game Master or their 🤖 AI team principal.<br>
                • <strong>Prestige pay cap:</strong> nobody can be paid above their star level — ${Prestige.LEVELS.map(l => `${l.stars}★ ${Economy.fmt(Economy.payCap(l.stars))}`).join(' · ')} per race. Raise your prestige to raise your ceiling.<br>
                • Contracts carry a <strong>buyout clause</strong> (10× salary, min ${Economy.fmt(1000)}). Leave by paying it (goes to the owner) or requesting release.<br>
                • <strong>Multi-team driving:</strong> drivers may sign with several teams if every contract is non-exclusive. An exclusive contract locks them to that team — and pays like it.<br>
                • Salaries are paid automatically every race: owners fund payroll, talent collects, sponsors pay out, agents take ${Math.round(Deals.AGENT_COMMISSION * 100)}% commission.</p>
            </section>
        </div>`;
    },

    /* ---------------- Recruitment actions ---------------- */
    // A contract offer to a player driver opens a NEGOTIATION — they can
    // accept, counter with their own number, or talk terms in the deal room.
    async offerForm(driverId, teamId) {
        const [driver, team, world] = await Promise.all([
            DB.get('drivers', driverId), DB.get('teams', teamId), DB.loadWorld()
        ]);
        if (!driver) { Util.notify('That driver no longer exists.', 'info'); this.refresh(); return; }
        const stars = Prestige.driverStars(driverId, world);
        const cap = Economy.payCap(stars);
        Modal.open(`
            ${Modal.header(`✍️ Negotiate — ${Util.esc(driver.name)}`, `A contract offer from ${Util.esc(team.name)}. They can accept, counter, or decline in the deal room.`)}
            <form id="hub-offer-form" class="form-grid">
                <div class="chip-row">${Prestige.chip(stars)}<span class="chip chip-dim">⭐ ${Economy.capLine(stars)}</span></div>
                <div class="form-row">
                    <label class="field"><span>Salary per race</span>
                        <input id="ho-salary" class="input" type="number" min="10" max="${cap}" step="10" value="${Math.min(this.STANDARD_SALARY, cap)}" required></label>
                </div>
                <label class="check"><input id="ho-exclusive" type="checkbox" checked>
                    🔒 Exclusive contract — they drive for you and nobody else (uncheck to allow multi-team)</label>
                <label class="field"><span>Message with your offer</span>
                    <input id="ho-note" class="input" maxlength="200" placeholder="Why should they sign with you?"></label>
                ${Clauses.formSection({ teamStars: Prestige.teamStars(teamId, world), salary: this.STANDARD_SALARY, personKind: 'driver' })}
                <p class="muted small" id="ho-buyout-note">Buyout clause: ${Economy.fmt(this.buyoutFor(this.STANDARD_SALARY))} (10× salary, min ${Economy.fmt(1000)}). Sign-on bonus (default: one race of salary) is paid when the deal closes.</p>
                <p id="ho-error" class="form-error"></p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Open Negotiation ✍️</button>
                </div>
            </form>
        `);
        Util.$('#ho-salary').addEventListener('input', (e) => {
            Util.$('#ho-buyout-note').textContent = `Buyout clause: ${Economy.fmt(this.buyoutFor(e.target.value))} (10× salary, min ${Economy.fmt(1000)}). Signing bonus (one race of salary) is paid when the deal closes.`;
        });
        Util.$('#hub-offer-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const salary = Math.round(Number(Util.$('#ho-salary').value) || 0);
                await Deals.start({
                    kind: 'team-driver',
                    teamId, teamName: team.name, ownerUid: Auth.uid(),
                    personId: driverId, personKind: 'driver', personName: driver.name, personUid: driver.ownerUid || null,
                    salary, buyout: this.buyoutFor(salary),
                    exclusive: Util.$('#ho-exclusive').checked,
                    note: Util.$('#ho-note').value,
                    ...Clauses.readForm()
                });
                Modal.close();
                Util.notify(`Negotiation opened with ${driver.name} — follow it in your Deals panel. ✍️`);
                this.refresh();
            } catch (err) { Util.$('#ho-error').textContent = err.message; }
        });
    },

    async apply(teamId) {
        try {
            const profile = Auth.state.profile;
            const [driver, team, recruitment] = await Promise.all([
                DB.get('drivers', profile?.driverId), DB.get('teams', teamId),
                DB.recruitment({ force: true }).catch(() => [])
            ]);
            if (!driver) throw new Error('Create your driver profile first (My Career).');
            const can = await Deals.canSignWithTeam(driver.id, teamId, false);
            if (!can.ok) throw new Error(can.reason.replace('They are', 'You are').replace('They already', 'You already'));
            if (recruitment.some(r => r.kind === 'application' && r.driverId === driver.id && r.teamId === teamId && r.status === 'pending')) {
                Util.notify('Your application is already pending.', 'info'); return;
            }
            await DB.create('recruitment', {
                kind: 'application', status: 'pending',
                teamId, teamName: team.name, ownerUid: team.ownerUid || null,
                driverId: driver.id, driverName: driver.name, driverUid: Auth.uid()
            });
            Util.notify(team.ownerUid
                ? `Application sent to ${team.name}. 🤞`
                : `Application sent to ${team.name} — the league office (Game Master) will open contract talks. 🏛️`);
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    async actApplication(id, accept) {
        try {
            if (!accept) {
                // Automated, polite rejection — the applicant sees it in their
                // Sent list and gets a red-badge notification.
                await DB.update('recruitment', id, {
                    status: 'declined',
                    politeMsg: 'Thanks for applying — the team went in another direction this time. Keep racing; the next seat might be yours.'
                });
                Util.notify('Application declined — they get a polite heads-up.');
                this.refresh();
            }
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    _setScout(filter) {
        this._scoutFilter = filter;
        this.refresh();
    },

    /* ---------------- Job board (vacancies) ---------------- */
    // Owners post open positions; the GM can post for unowned teams too.
    async vacancyForm() {
        const uid = Auth.uid();
        const teams = (await DB.teams({ force: true }))
            .filter(t => t.ownerUid === uid || (!t.ownerUid && Auth.isAdmin()));
        if (!teams.length) { Util.notify('You need a team (or GM rights) to post a vacancy.', 'info'); return; }
        const roles = Object.keys(this.RECRUIT_ATTRS);
        Modal.open(`
            ${Modal.header('📌 Post a Vacancy', 'An open position on the public job board — players apply, you review, terms get negotiated before anything signs.')}
            <form id="vac-form" class="form-grid">
                <div class="form-row">
                    <label class="field"><span>Team</span>
                        <select id="vac-team" class="input">${teams.map(t => `<option value="${Util.attr(t.id)}">${Util.esc(t.name)}${t.ownerUid ? '' : ' 🤖'}</option>`).join('')}</select></label>
                    <label class="field"><span>Position</span>
                        <select id="vac-role" class="input">${roles.map(r => { const i = this._recruitRoleInfo(r); return `<option value="${r}">${i.icon || ''} ${i.label}</option>`; }).join('')}</select></label>
                </div>
                <label class="field"><span>Listing title</span>
                    <input id="vac-title" class="input" maxlength="80" placeholder="e.g. Seeking a Crew Chief for the endurance series" required></label>
                <label class="field"><span>What you're looking for</span>
                    <textarea id="vac-desc" class="input" rows="2" maxlength="240" placeholder="Schedule, expectations, what makes your garage worth joining…"></textarea></label>
                <label class="field"><span>Indicative pay per race (optional)</span>
                    <input id="vac-pay" class="input" type="number" min="10" step="10" placeholder="Final pay is negotiated"></label>
                <p id="vac-error" class="form-error"></p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Post Vacancy 📌</button>
                </div>
            </form>
        `);
        Util.$('#vac-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const team = teams.find(t => t.id === Util.$('#vac-team').value);
                await DB.create('recruitment', {
                    kind: 'vacancy', status: 'open',
                    teamId: team.id, teamName: team.name, ownerUid: team.ownerUid || null,
                    postedBy: uid, role: Util.$('#vac-role').value,
                    title: Util.$('#vac-title').value.trim(),
                    description: Util.$('#vac-desc').value.trim(),
                    salary: Math.round(Number(Util.$('#vac-pay').value) || 0) || null
                });
                Modal.close();
                News.post('📌', `${team.name} is hiring: ${Util.$('#vac-title').value.trim()}`);
                Util.notify('Vacancy posted to the job board. 📌');
                this.refresh();
            } catch (err) { Util.$('#vac-error').textContent = err.message; }
        });
    },

    async closeVacancy(id) {
        const v = await DB.get('recruitment', id);
        if (!v || v.kind !== 'vacancy') return;
        if (!confirm(`Close the "${v.title}" vacancy? Pending applications stay in your inbox.`)) return;
        await DB.update('recruitment', id, { status: 'closed' });
        Util.notify('Vacancy closed.');
        this.refresh();
    },

    // Apply to a specific vacancy — driver or staff role, profile attached.
    async applyVacancy(vacancyId) {
        try {
            const uid = Auth.uid();
            const v = await DB.get('recruitment', vacancyId);
            if (!v || v.kind !== 'vacancy' || v.status !== 'open') throw new Error('That vacancy has been filled or closed.');
            const recruitment = await DB.recruitment({ force: true }).catch(() => []);
            if (recruitment.some(r => r.kind === 'application' && r.vacancyId === vacancyId && r.status === 'pending'
                && (r.driverUid === uid || r.applicantUid === uid))) {
                Util.notify('Your application for this vacancy is already pending.', 'info'); return;
            }

            if (v.role === 'driver') {
                const driver = Auth.state.profile?.driverId ? await DB.get('drivers', Auth.state.profile.driverId) : null;
                if (!driver) throw new Error('Create your driver profile first (My Career).');
                const can = await Deals.canSignWithTeam(driver.id, v.teamId, false);
                if (!can.ok) throw new Error(can.reason.replace('They are', 'You are').replace('They already', 'You already'));
                await DB.create('recruitment', {
                    kind: 'application', status: 'pending', vacancyId, role: 'driver',
                    teamId: v.teamId, teamName: v.teamName, ownerUid: v.ownerUid || null,
                    driverId: driver.id, driverName: driver.name, driverUid: uid,
                    attrs: driver.recruit || null
                });
            } else {
                const p = (await DB.roleProfiles({ force: true }).catch(() => []))
                    .find(p => p.uid === uid && p.role === v.role);
                if (!p) throw new Error(`Create your ${this._recruitRoleInfo(v.role).label} profile first (switch role in My Career).`);
                if (p.teamId) throw new Error('You already work for a team — leave it before applying elsewhere.');
                await DB.create('recruitment', {
                    kind: 'application', status: 'pending', vacancyId, role: v.role,
                    teamId: v.teamId, teamName: v.teamName, ownerUid: v.ownerUid || null,
                    profileId: p.id, applicantUid: uid, applicantName: p.name, driverName: p.name,
                    attrs: p.recruit || null
                });
            }
            Util.notify(v.ownerUid
                ? `Application sent to ${v.teamName}. 🤞`
                : `Application sent to ${v.teamName} — the league office (Game Master) will review it. 🏛️`);
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    // A player crew member applies straight to a team (no vacancy needed) —
    // used by the crew-chief / mechanic / agent career workspaces.
    async applyStaff(profileId, teamId) {
        try {
            const uid = Auth.uid();
            const [p, team, recruitment] = await Promise.all([
                DB.get('roleProfiles', profileId), DB.get('teams', teamId),
                DB.recruitment({ force: true }).catch(() => [])
            ]);
            if (!p || p.uid !== uid) throw new Error('Profile not found.');
            if (p.teamId) throw new Error('You already work for a team — leave it before applying elsewhere.');
            if (recruitment.some(r => r.kind === 'application' && r.profileId === profileId && r.teamId === teamId && r.status === 'pending')) {
                Util.notify('Your application is already pending.', 'info'); return;
            }
            await DB.create('recruitment', {
                kind: 'application', status: 'pending', role: p.role,
                teamId, teamName: team?.name || '', ownerUid: team?.ownerUid || null,
                profileId, applicantUid: uid, applicantName: p.name, driverName: p.name,
                attrs: p.recruit || null
            });
            Modal.close();
            Util.notify(team?.ownerUid
                ? `Application sent to ${team.name}. 🤞`
                : `Application sent to ${team?.name || 'the team'} — the league office (Game Master) will review it. 🏛️`);
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    /* ---------------- Offering a contract to player crew ---------------- */
    // Team → player staff (crew chief / mechanic / agent): opens a negotiation
    // exactly like driver offers; nothing signs until they accept.
    async staffOfferForm(profileId, teamId) {
        const [p, team, world] = await Promise.all([DB.get('roleProfiles', profileId), DB.get('teams', teamId), DB.loadWorld()]);
        if (!p) { Util.notify('That profile no longer exists.', 'info'); this.refresh(); return; }
        const info = this._recruitRoleInfo(p.role);
        const stars = Prestige.stored(p);
        const cap = Economy.payCap(stars);
        const teamStars = Prestige.teamStars(teamId, world);
        Modal.open(`
            ${Modal.header(`✍️ Recruit — ${Util.esc(p.name)}`, `${info.label} · a contract offer from ${Util.esc(team.name)}. They accept, counter, or decline in the deal room.`)}
            <form id="staff-offer-form" class="form-grid">
                <div class="chip-row">${Prestige.chip(stars)}<span class="chip chip-dim">⭐ ${Economy.capLine(stars)}</span></div>
                <div class="chip-row">${this.recruitChips(p.role, p.recruit) || '<span class="chip chip-dim">No recruitment profile shared</span>'}</div>
                <label class="field"><span>Salary per race</span>
                    <input id="so-salary" class="input" type="number" min="10" max="${cap}" step="10" value="${Math.min(this.STANDARD_SALARY, cap)}" required></label>
                <label class="field"><span>Message with your offer</span>
                    <input id="so-note" class="input" maxlength="200" placeholder="Why your garage?"></label>
                ${Clauses.formSection({ teamStars, salary: this.STANDARD_SALARY, personKind: 'staff' })}
                <p id="so-error" class="form-error"></p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Open Negotiation ✍️</button>
                </div>
            </form>
        `);
        Util.$('#staff-offer-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                await Deals.start({
                    kind: 'team-staff',
                    teamId, teamName: team.name, ownerUid: Auth.uid(),
                    personId: profileId, roleProfileId: profileId, personKind: 'staff',
                    personName: p.name, personUid: p.uid,
                    salary: Util.$('#so-salary').value, note: Util.$('#so-note').value,
                    ...Clauses.readForm()
                });
                Modal.close();
                Util.notify(`Offer sent — ${p.name} answers in their Deals panel. 📨`);
                this.refresh();
            } catch (err) { Util.$('#so-error').textContent = err.message; }
        });
    },

    // Accepting a staff application: the owner (or GM for unowned teams)
    // proposes terms; the applicant accepts/counters in the deal room.
    async acceptStaffApplication(id) {
        const app = await DB.get('recruitment', id);
        if (!app || app.status !== 'pending') { this.refresh(); return; }
        const [p, world] = await Promise.all([DB.get('roleProfiles', app.profileId), DB.loadWorld()]);
        if (!p) { Util.notify('That profile no longer exists.', 'error'); return; }
        const info = this._recruitRoleInfo(app.role);
        const stars = Prestige.stored(p);
        const cap = Economy.payCap(stars);
        Modal.open(`
            ${Modal.header(`✍️ Terms for ${Util.esc(app.applicantName)}`, `${info.label} applying to ${Util.esc(app.teamName)}${app.ownerUid ? '' : ' (unowned team — you negotiate as the GM)'} — propose the contract; they accept or counter`)}
            <form id="staff-sign-form" class="form-grid">
                <div class="chip-row">${Prestige.chip(stars)}<span class="chip chip-dim">⭐ ${Economy.capLine(stars)}</span></div>
                <div class="chip-row">${this.recruitChips(app.role, app.attrs) || ''}</div>
                <label class="field"><span>Salary per race</span>
                    <input id="ss-salary" class="input" type="number" min="10" max="${cap}" step="10" value="${Math.min(this.STANDARD_SALARY, cap)}" required></label>
                <label class="field"><span>Message</span><input id="ss-note" class="input" maxlength="200" placeholder="Welcome aboard — here's the deal."></label>
                ${Clauses.formSection({ teamStars: Prestige.teamStars(app.teamId, world), salary: this.STANDARD_SALARY, personKind: 'staff' })}
                <p id="ss-error" class="form-error"></p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Propose Contract ✍️</button>
                </div>
            </form>
        `);
        Util.$('#staff-sign-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                await Deals.start({
                    kind: 'team-staff',
                    teamId: app.teamId, teamName: app.teamName,
                    ownerUid: app.ownerUid || null,
                    sideAProxyUid: app.ownerUid ? null : Auth.uid(),
                    personId: app.profileId, roleProfileId: app.profileId, personKind: 'staff',
                    personName: app.applicantName, personUid: app.applicantUid,
                    salary: Util.$('#ss-salary').value, note: Util.$('#ss-note').value,
                    ...Clauses.readForm()
                });
                await DB.update('recruitment', id, { status: 'accepted' });
                Modal.close();
                Util.notify(`Terms sent to ${app.applicantName} — the contract signs when they accept. ✍️`);
                this.refresh();
            } catch (err) { Util.$('#ss-error').textContent = err.message; }
        });
    },

    // Hands a pending application to the AI: the team principal opens the
    // deal room with a market-rate offer and the player negotiates from there.
    async aiPrincipal(id) {
        try {
            const n = await Deals.aiPrincipalOffer(id);
            Util.notify(`🤖 ${n.teamName}'s principal sent ${n.personName} an offer of ${Economy.fmt(n.salary)}/race — they'll answer in their deal room.`);
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    // Accepting an application opens a negotiation: the owner proposes terms,
    // the applying driver accepts/counters from their deal room. For unowned
    // teams the Game Master negotiates in the team's name — the contract stays
    // league-owned (no ownerUid), so the GM's wallet is never touched.
    async acceptApplication(id) {
        const app = await DB.get('recruitment', id);
        if (!app || app.status !== 'pending') { this.refresh(); return; }
        const world = await DB.loadWorld();
        const stars = Prestige.driverStars(app.driverId, world);
        const cap = Economy.payCap(stars);
        Modal.open(`
            ${Modal.header(`✍️ Terms for ${Util.esc(app.driverName)}`, `They applied to ${Util.esc(app.teamName)}${app.ownerUid ? '' : ' (unowned team — you negotiate as the GM)'} — propose the contract; they accept or counter`)}
            <form id="hub-sign-form" class="form-grid">
                <div class="chip-row">${Prestige.chip(stars)}<span class="chip chip-dim">⭐ ${Economy.capLine(stars)}</span></div>
                <label class="field"><span>Salary per race</span>
                    <input id="hs-salary" class="input" type="number" min="10" max="${cap}" step="10" value="${Math.min(this.STANDARD_SALARY, cap)}" required></label>
                <label class="check"><input id="hs-exclusive" type="checkbox" checked>
                    🔒 Exclusive contract (uncheck to allow them to drive for other teams too)</label>
                <label class="field"><span>Message</span><input id="hs-note" class="input" maxlength="200" placeholder="Welcome aboard — here's the deal."></label>
                ${Clauses.formSection({ teamStars: Prestige.teamStars(app.teamId, world), salary: this.STANDARD_SALARY, personKind: 'driver' })}
                <p class="muted small">Buyout clause is 10× salary (min ${Economy.fmt(1000)}) — unless you offer an open agreement above.</p>
                <p id="hs-error" class="form-error"></p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Propose Contract ✍️</button>
                </div>
            </form>
        `);
        Util.$('#hub-sign-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const salary = Math.round(Number(Util.$('#hs-salary').value) || 0);
                await Deals.start({
                    kind: 'team-driver',
                    teamId: app.teamId, teamName: app.teamName,
                    ownerUid: app.ownerUid || null,
                    sideAProxyUid: app.ownerUid ? null : Auth.uid(),
                    personId: app.driverId, personKind: 'driver', personName: app.driverName, personUid: app.driverUid || null,
                    salary, buyout: this.buyoutFor(salary),
                    exclusive: Util.$('#hs-exclusive').checked,
                    note: Util.$('#hs-note').value,
                    ...Clauses.readForm()
                });
                await DB.update('recruitment', id, { status: 'accepted', salary });
                Modal.close();
                Util.notify(`Terms sent to ${app.driverName} — the contract signs when they accept. ✍️`);
                this.refresh();
            } catch (err) { Util.$('#hs-error').textContent = err.message; }
        });
    },

    async actRelease(id, approve) {
        try {
            const req = await DB.get('recruitment', id);
            if (!req || req.status !== 'pending') { this.refresh(); return; }
            if (!approve) {
                await DB.update('recruitment', id, { status: 'declined' });
                Util.notify(`Denied — ${req.driverName} stays unless they pay the ${Economy.fmt(req.buyout)} buyout.`);
                this.refresh();
                return;
            }
            await this._freeDriver(req.driverId, req.driverUid, 'released', req.contractId || null);
            await DB.update('recruitment', id, { status: 'accepted' });
            News.post('👋', `${req.driverName} released by ${req.teamName} — buyout waived`);
            Util.notify(`${req.driverName} released for free.`);
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    // Ends ONE team contract for a player driver (or all, when no contractId
    // is given — used by release requests which predate multi-team). The
    // primary team link falls back to their next active contract.
    async _freeDriver(driverId, driverUid, contractStatus, contractId = null) {
        const driver = await DB.get('drivers', driverId);
        const contracts = await DB.contracts({ force: true }).catch(() => []);
        const mine = contracts.filter(c => c.personId === driverId && c.status === 'active' && c.type !== 'sponsorship');
        const ending = contractId ? mine.filter(c => c.id === contractId) : mine;
        for (const c of ending) {
            await DB.update('contracts', c.id, { status: contractStatus, endedAt: Util.todayISO() });
        }
        const remaining = mine.filter(c => !ending.some(e => e.id === c.id));
        const endedTeamIds = new Set(ending.map(c => c.teamId));
        if (!driver?.teamId || endedTeamIds.has(driver.teamId)) {
            const nextTeamId = remaining[0]?.teamId || null;
            await DB.update('drivers', driverId, { teamId: nextTeamId });
            if (driverUid === Auth.uid()) await Auth.updateProfile({ teamId: nextTeamId });
            else if (driverUid) await DB.update('users', driverUid, { teamId: nextTeamId }).catch(() => {});
        }
        return driver;
    },

    /* ---------------- Leaving a team (driver side, per contract) ---------------- */
    async leaveTeamFlow(contractId = null) {
        const profile = Auth.state.profile;
        const driverId = profile?.driverId;
        const driver = driverId ? await DB.get('drivers', driverId) : null;
        if (!driver) { Util.notify('Create your driver profile first.', 'info'); return; }
        const contracts = (await DB.contracts({ force: true }).catch(() => []))
            .filter(c => c.personId === driverId && c.status === 'active' && c.type !== 'sponsorship');
        const contract = contractId ? contracts.find(c => c.id === contractId) : contracts[0];
        if (!contract && !driver.teamId) { Util.notify('You are not on a team.', 'info'); return; }
        const teamId = contract?.teamId || driver.teamId;
        const team = await DB.get('teams', teamId).catch(() => null);
        const buyout = Number(contract?.buyout) || 0;
        const payee = contract?.ownerUid || team?.ownerUid || null;

        // No contract, no buyout, or nobody to pay → simple free exit.
        if (!contract || !buyout || !payee) {
            if (!confirm(`Leave ${team?.name || 'your team'}?`)) return;
            if (contract) await this._freeDriver(driverId, Auth.uid(), 'released', contract.id);
            else {
                await DB.update('drivers', driverId, { teamId: null });
                await Auth.updateProfile({ teamId: null });
            }
            News.post('👋', `${driver.name} left ${team?.name || 'their team'}`);
            Util.notify(`You left ${team?.name || 'the team'}.`);
            App.go('career');
            return;
        }

        const pendingReq = (await DB.recruitment({ force: true }).catch(() => []))
            .some(r => r.kind === 'release-request' && r.driverId === driverId && r.contractId === contract.id && r.status === 'pending');

        Modal.open(`
            ${Modal.header(`🚪 Leave ${Util.esc(team?.name || 'team')}`, 'This contract has a buyout clause')}
            <p class="muted">This contract: <strong>${Economy.fmt(contract.salary)}/race</strong>${contract.exclusive === false ? ' (non-exclusive)' : ''} · buyout <strong>${Economy.fmt(buyout)}</strong>.
                Your balance: <strong>${Economy.fmt(Economy.balance())}</strong>.</p>
            <div class="stack" style="margin-top:.8rem">
                <button class="btn btn-primary" id="lv-pay" ${Economy.balance() < buyout ? 'disabled title="Not enough funds"' : ''}>
                    💸 Pay the ${Economy.fmt(buyout)} buyout & leave now</button>
                <div class="form-row" style="align-items:end">
                    <label class="field"><span>…or propose a lower exit figure</span>
                        <input id="lv-figure" class="input" type="number" min="10" max="${buyout}" step="10" value="${Math.max(10, Math.round(buyout / 2 / 10) * 10)}"></label>
                    <button class="btn btn-secondary" id="lv-negotiate" title="Opens a deal room — the owner accepts, counters, or declines">🤝 Negotiate buyout</button>
                </div>
                <button class="btn btn-secondary" id="lv-request" ${pendingReq ? 'disabled' : ''}>
                    📨 ${pendingReq ? 'Release request already pending' : 'Request release (owner may waive the buyout)'}</button>
                <button class="btn btn-ghost" onclick="Modal.close()">Stay with the team</button>
            </div>
        `);

        Util.$('#lv-negotiate')?.addEventListener('click', async () => {
            try {
                const n = await Deals.startBuyout(contract.id, Util.$('#lv-figure').value,
                    'Proposing an early exit — here is my number.');
                Util.notify(`Buyout talks opened at ${Economy.fmt(n.salary)} — the owner answers in the deal room. 🤝`);
                Deals.room(n.id);
            } catch (e) { Util.notify(e.message, 'error'); }
        });

        Util.$('#lv-pay')?.addEventListener('click', async () => {
            try {
                // The leaving driver pays personally; the buyout replenishes
                // the TEAM's budget (it funds the next hire), not the owner's
                // personal wallet.
                await Economy.spend(buyout, `Contract buyout: ${team?.name || 'team'}`, '💸');
                await Wallet.adjustTeamWallet(teamId, buyout, '💸', `Buyout received: ${driver.name}`);
                await this._freeDriver(driverId, Auth.uid(), 'bought-out', contract.id);
                Modal.close();
                News.post('💸', `${driver.name} paid a ${Economy.fmt(buyout)} buyout to leave ${team?.name || 'their team'}`);
                Util.notify(`Buyout paid — contract with ${team?.name || 'the team'} ended. 💸`);
                App.go('career');
            } catch (e) { Util.notify(e.message, 'error'); }
        });

        Util.$('#lv-request')?.addEventListener('click', async () => {
            try {
                await DB.create('recruitment', {
                    kind: 'release-request', status: 'pending',
                    teamId, teamName: team?.name || '', ownerUid: payee,
                    driverId, driverName: driver.name, driverUid: Auth.uid(),
                    contractId: contract.id, buyout
                });
                Modal.close();
                Util.notify('Release requested — the team owner will decide in their League Hub. 📨');
            } catch (e) { Util.notify(e.message, 'error'); }
        });
    },

    /* ---------------- Owner contract tools ---------------- */
    async waiveBuyout(contractId) {
        try {
            const c = await DB.get('contracts', contractId);
            if (!c) return;
            if (!confirm(`Waive the buyout on ${c.personName}'s contract? They can then leave for free.`)) return;
            await DB.update('contracts', contractId, { buyout: 0 });
            Util.notify(`Buyout waived for ${c.personName}.`);
            App.go('career');
        } catch (e) { Util.notify(e.message, 'error'); }
    }
};
window.Hub = Hub;
