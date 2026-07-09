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
    // driver; applications and release requests go to the team's owner — or to
    // the Game Master when the team has no player owner.
    _forMe(r, uid) {
        if (r.kind === 'offer') return r.driverUid === uid;
        return r.ownerUid ? r.ownerUid === uid : Auth.isAdmin();
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

    async tab_recruitment(el) {
        const uid = Auth.uid();
        const [world, recruitment, contracts, myDeals] = await Promise.all([
            DB.loadWorld(),
            DB.recruitment({ force: true }).catch(() => []),
            DB.contracts({ force: true }).catch(() => []),
            Deals.mine().catch(() => [])
        ]);
        const profile = Auth.state.profile;
        const myTeam = world.teams.find(t => t.ownerUid === uid);
        const myDriver = profile?.driverId ? world.driversById[profile.driverId] : null;

        const inbox = recruitment.filter(r => r.status === 'pending' && this._forMe(r, uid));
        const outbox = recruitment.filter(r =>
            (r.kind === 'offer' ? r.ownerUid === uid : r.driverUid === uid))
            .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 8);
        const openDeals = myDeals.filter(n => n.status === 'open');

        const kindLabel = { offer: 'Contract offer', application: 'Application', 'release-request': 'Release request' };
        const statusBadge = (s) => `<span class="badge ${s === 'pending' ? 'badge-amber' : s === 'accepted' ? 'badge-green' : 'badge-dim'}">${Util.esc(s)}</span>`;

        const inboxRow = (r) => {
            let text = '', sub = '', actions = '';
            if (r.kind === 'offer') {
                text = `${r.teamName} offers you a seat`;
                sub = `${Economy.fmt(r.salary)}/race · buyout ${Economy.fmt(r.buyout)}`;
                actions = `<button class="btn btn-primary btn-sm" onclick="Hub.actOffer('${Util.attr(r.id)}',true)">✓ Accept</button>
                    <button class="btn btn-danger btn-sm" onclick="Hub.actOffer('${Util.attr(r.id)}',false)">✕ Decline</button>`;
            } else if (r.kind === 'application') {
                const unowned = !r.ownerUid;
                text = `${r.driverName} wants to drive for ${r.teamName}`;
                sub = unowned
                    ? '🤖 This team has no player owner — negotiate the deal yourself as GM, or send in the AI team principal'
                    : 'Accepting opens a contract form where you set their pay';
                actions = `<button class="btn btn-primary btn-sm" onclick="Hub.acceptApplication('${Util.attr(r.id)}')">✍️ ${unowned ? 'Negotiate as GM' : 'Sign them'}</button>
                    ${unowned ? `<button class="btn btn-secondary btn-sm" onclick="Hub.aiPrincipal('${Util.attr(r.id)}')">🤖 AI Principal</button>` : ''}
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
                </div>
                <div class="btn-row">${actions}</div>
            </div>`;
        };

        // Player drivers an owner can approach: free agents AND drivers whose
        // contracts leave room for another team (no exclusive clause).
        const activeDriverContracts = (id) => contracts.filter(c => c.status === 'active' &&
            c.type !== 'sponsorship' && c.personKind === 'driver' && c.personId === id);
        const signable = myTeam
            ? world.drivers.filter(d => d.ownerUid && d.ownerUid !== uid).filter(d => {
                const act = activeDriverContracts(d.id);
                return !act.some(c => c.exclusive !== false) && !act.some(c => c.teamId === myTeam.id);
            })
            : [];
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
                    ${outbox.map(r => `<div class="race-row">
                        <div class="race-row-main">
                            <span class="race-title">${Util.esc(kindLabel[r.kind] || r.kind)} — ${Util.esc(r.kind === 'offer' ? r.driverName : r.teamName)}</span>
                            ${r.salary ? `<span class="race-sub">${Economy.fmt(r.salary)}/race</span>` : ''}
                        </div>
                        ${statusBadge(r.status)}
                    </div>`).join('')}` : ''}
            </section>

            ${myTeam ? `<section class="panel">
                <div class="panel-head"><h2>🏎 Player Drivers</h2><span class="chip chip-dim">Open contract negotiations</span></div>
                ${signable.length ? signable.map(d => {
                    const act = activeDriverContracts(d.id);
                    return `<div class="race-row">
                        <div class="race-row-main">
                            <span class="race-title">${Util.esc(d.name)} <span class="badge badge-blue">Player</span></span>
                            <span class="race-sub">${act.length ? `${Util.plural(act.length, 'team')} (non-exclusive) — open to another seat` : Util.esc(d.country || 'Free agent')}</span>
                        </div>
                        <button class="btn btn-primary btn-sm" onclick="Hub.offerForm('${Util.attr(d.id)}','${Util.attr(myTeam.id)}')">✍️ Negotiate</button>
                    </div>`;
                }).join('')
                    : '<p class="muted">No signable player drivers right now (exclusive contracts lock drivers to one team). AI free agents are hired from My Career → Hire.</p>'}
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
                <p class="muted small" id="ho-buyout-note">Buyout clause: ${Economy.fmt(this.buyoutFor(this.STANDARD_SALARY))} (10× salary, min ${Economy.fmt(1000)}). Signing bonus (one race of salary) is paid when the deal closes.</p>
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
                    note: Util.$('#ho-note').value
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

    // Puts a player driver on a team with a signed contract. Shared by
    // accepted applications and instant joins. Multi-team aware: the first
    // team a driver signs with becomes their primary (points-scoring) team.
    async signPlayerDriver({ driverId, driverUid, teamId, salary, exclusive = false }) {
        const team = await DB.get('teams', teamId);
        const driver = await DB.get('drivers', driverId);
        if (!driver) throw new Error('Driver profile not found.');
        const can = await Deals.canSignWithTeam(driverId, teamId, exclusive);
        if (!can.ok) throw new Error(can.reason);
        salary = Math.round(Number(salary) || 0);
        const world = await DB.loadWorld();
        const cap = Economy.payCap(Prestige.driverStars(driverId, world));
        if (salary > cap) throw new Error(`League rule: pay is capped at ${Economy.fmt(cap)}/race at their prestige level.`);
        if (!driver.teamId) {
            await DB.update('drivers', driverId, { teamId });
            if (driverUid === Auth.uid()) await Auth.updateProfile({ teamId });
            else if (driverUid) await DB.update('users', driverUid, { teamId }).catch(() => {});
        }
        await DB.create('contracts', {
            teamId, teamName: team?.name || '',
            ownerUid: team?.ownerUid || null,
            personId: driverId, personKind: 'driver', personName: driver.name,
            role: 'driver', salary, buyout: this.buyoutFor(salary), exclusive: !!exclusive,
            seasonYear: new Date().getFullYear(), status: 'active', signedAt: Util.todayISO()
        });
        News.post('🤝', `${driver.name} signed with ${team?.name || 'a team'} (${Economy.fmt(salary)}/race${exclusive ? ', exclusive' : ''})`);
    },

    async actOffer(id, accept) {
        try {
            const offer = await DB.get('recruitment', id);
            if (!offer || offer.status !== 'pending') { this.refresh(); return; }
            if (!accept) {
                await DB.update('recruitment', id, { status: 'declined' });
                Util.notify('Offer declined.');
                this.refresh();
                return;
            }
            await this.signPlayerDriver({ driverId: offer.driverId, driverUid: offer.driverUid, teamId: offer.teamId, salary: offer.salary, exclusive: offer.exclusive !== false });
            await DB.update('recruitment', id, { status: 'accepted' });
            Util.notify(`Welcome to ${offer.teamName}! Contract signed. 🤝`);
            App.go('career');
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    async actApplication(id, accept) {
        try {
            if (!accept) {
                await DB.update('recruitment', id, { status: 'declined' });
                Util.notify('Application declined.');
                this.refresh();
            }
        } catch (e) { Util.notify(e.message, 'error'); }
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
                <p class="muted small">Buyout clause is 10× salary (min ${Economy.fmt(1000)}).</p>
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
                    note: Util.$('#hs-note').value
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
                <button class="btn btn-secondary" id="lv-request" ${pendingReq ? 'disabled' : ''}>
                    📨 ${pendingReq ? 'Release request already pending' : 'Request release (owner may waive the buyout)'}</button>
                <button class="btn btn-ghost" onclick="Modal.close()">Stay with the team</button>
            </div>
        `);

        Util.$('#lv-pay')?.addEventListener('click', async () => {
            try {
                await Economy.spend(buyout, `Contract buyout: ${team?.name || 'team'}`, '💸');
                await Economy.adjustWallet(payee, buyout, '💸', `Buyout received: ${driver.name}`);
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
