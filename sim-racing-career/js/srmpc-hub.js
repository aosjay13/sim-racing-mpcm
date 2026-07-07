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
                </div>`).join('')
            : C.empty('📣', 'No news yet', 'The feed writes itself: driver signings, team takeovers, race winners, contract buyouts — every career move lands here automatically.')}
        </section>`;
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

    /* ---------------- Recruitment tab ---------------- */
    // Everything pending that needs MY decision.
    async _inbox() {
        if (!Auth.isSignedIn()) return [];
        const uid = Auth.uid();
        if (!uid) return [];
        const items = await DB.recruitment({ force: true }).catch(() => []);
        return items.filter(r => r.status === 'pending' &&
            (r.kind === 'offer' ? r.driverUid === uid : r.ownerUid === uid));
    },

    async tab_recruitment(el) {
        const uid = Auth.uid();
        const [world, recruitment, contracts] = await Promise.all([
            DB.loadWorld(),
            DB.recruitment({ force: true }).catch(() => []),
            DB.contracts({ force: true }).catch(() => [])
        ]);
        const profile = Auth.state.profile;
        const myTeam = world.teams.find(t => t.ownerUid === uid);
        const myDriver = profile?.driverId ? world.driversById[profile.driverId] : null;

        const inbox = recruitment.filter(r => r.status === 'pending' &&
            (r.kind === 'offer' ? r.driverUid === uid : r.ownerUid === uid));
        const outbox = recruitment.filter(r =>
            (r.kind === 'offer' ? r.ownerUid === uid : r.driverUid === uid))
            .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 8);

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
                text = `${r.driverName} wants to drive for ${r.teamName}`;
                sub = 'Accepting opens a contract form where you set their pay';
                actions = `<button class="btn btn-primary btn-sm" onclick="Hub.acceptApplication('${Util.attr(r.id)}')">✓ Sign them</button>
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

        // Free agent PLAYER drivers an owner can make offers to.
        const freeAgents = myTeam
            ? world.drivers.filter(d => d.ownerUid && !d.teamId && d.ownerUid !== uid)
            : [];
        // Teams a free-agent driver can apply to.
        const openTeams = (myDriver && !myDriver.teamId)
            ? world.teams.filter(t => t.recruiting !== false && t.ownerUid !== uid)
            : [];

        el.innerHTML = `
        <div class="grid-2">
            <section class="panel">
                <div class="panel-head"><h2>📥 Inbox (${inbox.length})</h2></div>
                ${inbox.length ? inbox.map(inboxRow).join('')
                    : '<p class="muted">Nothing needs your decision right now. 🎉</p>'}
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
                <div class="panel-head"><h2>🏎 Free Agent Players</h2><span class="chip chip-dim">Offer real players a seat</span></div>
                ${freeAgents.length ? freeAgents.map(d => `
                    <div class="race-row">
                        <div class="race-row-main">
                            <span class="race-title">${Util.esc(d.name)} <span class="badge badge-blue">Player</span></span>
                            <span class="race-sub">${Util.esc(d.country || 'Free agent')}</span>
                        </div>
                        <button class="btn btn-primary btn-sm" onclick="Hub.offerForm('${Util.attr(d.id)}','${Util.attr(myTeam.id)}')">✍️ Offer contract</button>
                    </div>`).join('')
                    : '<p class="muted">No free-agent player drivers right now. AI free agents are hired from My Career → Hire.</p>'}
            </section>` : ''}

            ${(myDriver && !myDriver.teamId) ? `<section class="panel">
                <div class="panel-head"><h2>🪑 Teams Hiring</h2><span class="chip chip-dim">Apply for a seat</span></div>
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
                <p class="muted">Team owners offer contracts to free-agent player drivers, and drivers apply to recruiting teams — all with real salaries and buyout clauses. Create a driver profile or found a team in <a href="#" onclick="App.go('career');return false">My Career</a> to join the market.</p>
            </section>` : ''}

            <section class="panel">
                <div class="panel-head"><h2>📜 Contract Rules</h2></div>
                <p class="muted small">• Joining a team signs a season contract with a salary per race and a <strong>buyout clause</strong> (10× salary, min ${Economy.fmt(1000)}).<br>
                • To leave mid-contract you either <strong>pay the buyout</strong> (it goes to the team owner) or <strong>request release</strong> — the owner decides whether to let you go for free.<br>
                • Owners can release anyone for free at any time, and can waive a buyout from their Contracts panel.</p>
            </section>
        </div>`;
    },

    /* ---------------- Recruitment actions ---------------- */
    async offerForm(driverId, teamId) {
        const [driver, team, recruitment] = await Promise.all([
            DB.get('drivers', driverId), DB.get('teams', teamId),
            DB.recruitment({ force: true }).catch(() => [])
        ]);
        if (!driver || driver.teamId) { Util.notify('That driver is no longer a free agent.', 'info'); this.refresh(); return; }
        if (recruitment.some(r => r.kind === 'offer' && r.driverId === driverId && r.teamId === teamId && r.status === 'pending')) {
            Util.notify('You already have a pending offer to this driver.', 'info'); return;
        }
        Modal.open(`
            ${Modal.header(`✍️ Offer — ${Util.esc(driver.name)}`, `A contract offer from ${Util.esc(team.name)}. They accept or decline from their League Hub inbox.`)}
            <form id="hub-offer-form" class="form-grid">
                <label class="field"><span>Salary per race</span>
                    <input id="ho-salary" class="input" type="number" min="0" step="10" value="${this.STANDARD_SALARY}" required></label>
                <p class="muted small" id="ho-buyout-note">Buyout clause: ${Economy.fmt(this.buyoutFor(this.STANDARD_SALARY))} (10× salary, min ${Economy.fmt(1000)}).</p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Send Offer ✍️</button>
                </div>
            </form>
        `);
        Util.$('#ho-salary').addEventListener('input', (e) => {
            Util.$('#ho-buyout-note').textContent = `Buyout clause: ${Economy.fmt(this.buyoutFor(e.target.value))} (10× salary, min ${Economy.fmt(1000)}).`;
        });
        Util.$('#hub-offer-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const salary = Math.round(Number(Util.$('#ho-salary').value) || 0);
                await DB.create('recruitment', {
                    kind: 'offer', status: 'pending',
                    teamId, teamName: team.name, ownerUid: Auth.uid(),
                    driverId, driverName: driver.name, driverUid: driver.ownerUid,
                    salary, buyout: this.buyoutFor(salary)
                });
                Modal.close();
                Util.notify(`Offer sent to ${driver.name}. They'll see it in their League Hub. ✍️`);
                this.refresh();
            } catch (err) { Util.notify(err.message, 'error'); }
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
            if (driver.teamId) throw new Error('You already have a team — leave it first.');
            if (recruitment.some(r => r.kind === 'application' && r.driverId === driver.id && r.teamId === teamId && r.status === 'pending')) {
                Util.notify('Your application is already pending.', 'info'); return;
            }
            await DB.create('recruitment', {
                kind: 'application', status: 'pending',
                teamId, teamName: team.name, ownerUid: team.ownerUid || null,
                driverId: driver.id, driverName: driver.name, driverUid: Auth.uid()
            });
            Util.notify(`Application sent to ${team.name}. 🤞`);
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    // Puts a player driver on a team with a signed contract. Shared by
    // accepted offers, accepted applications, and instant joins.
    async signPlayerDriver({ driverId, driverUid, teamId, salary }) {
        const team = await DB.get('teams', teamId);
        const driver = await DB.get('drivers', driverId);
        if (!driver) throw new Error('Driver profile not found.');
        if (driver.teamId) throw new Error(`${driver.name} already has a team.`);
        salary = Math.round(Number(salary) || 0);
        await DB.update('drivers', driverId, { teamId });
        if (driverUid === Auth.uid()) await Auth.updateProfile({ teamId });
        else if (driverUid) await DB.update('users', driverUid, { teamId }).catch(() => {});
        await DB.create('contracts', {
            teamId, teamName: team?.name || '',
            ownerUid: team?.ownerUid || null,
            personId: driverId, personKind: 'driver', personName: driver.name,
            role: 'driver', salary, buyout: this.buyoutFor(salary),
            seasonYear: new Date().getFullYear(), status: 'active', signedAt: Util.todayISO()
        });
        News.post('🤝', `${driver.name} signed with ${team?.name || 'a team'} (${Economy.fmt(salary)}/race)`);
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
            await this.signPlayerDriver({ driverId: offer.driverId, driverUid: offer.driverUid, teamId: offer.teamId, salary: offer.salary });
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

    async acceptApplication(id) {
        const app = await DB.get('recruitment', id);
        if (!app || app.status !== 'pending') { this.refresh(); return; }
        Modal.open(`
            ${Modal.header(`✍️ Sign ${Util.esc(app.driverName)}`, `Set the contract terms for ${Util.esc(app.teamName)}`)}
            <form id="hub-sign-form" class="form-grid">
                <label class="field"><span>Salary per race</span>
                    <input id="hs-salary" class="input" type="number" min="0" step="10" value="${this.STANDARD_SALARY}" required></label>
                <p class="muted small">Buyout clause is 10× salary (min ${Economy.fmt(1000)}).</p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Sign Contract ✍️</button>
                </div>
            </form>
        `);
        Util.$('#hub-sign-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                await this.signPlayerDriver({ driverId: app.driverId, driverUid: app.driverUid, teamId: app.teamId, salary: Util.$('#hs-salary').value });
                await DB.update('recruitment', id, { status: 'accepted', salary: Math.round(Number(Util.$('#hs-salary').value) || 0) });
                Modal.close();
                Util.notify(`${app.driverName} joins your roster. 🤝`);
                this.refresh();
            } catch (err) { Util.notify(err.message, 'error'); }
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
            await this._freeDriver(req.driverId, req.driverUid, 'released');
            await DB.update('recruitment', id, { status: 'accepted' });
            News.post('👋', `${req.driverName} released by ${req.teamName} — buyout waived`);
            Util.notify(`${req.driverName} released for free.`);
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    // Clears team links + ends any active contracts for a player driver.
    async _freeDriver(driverId, driverUid, contractStatus) {
        const driver = await DB.get('drivers', driverId);
        await DB.update('drivers', driverId, { teamId: null });
        if (driverUid === Auth.uid()) await Auth.updateProfile({ teamId: null });
        else if (driverUid) await DB.update('users', driverUid, { teamId: null }).catch(() => {});
        const contracts = await DB.contracts({ force: true }).catch(() => []);
        for (const c of contracts.filter(c => c.personId === driverId && c.status === 'active')) {
            await DB.update('contracts', c.id, { status: contractStatus, endedAt: Util.todayISO() });
        }
        return driver;
    },

    /* ---------------- Leaving a team (driver side) ---------------- */
    async leaveTeamFlow() {
        const profile = Auth.state.profile;
        const driverId = profile?.driverId;
        const driver = driverId ? await DB.get('drivers', driverId) : null;
        if (!driver?.teamId) { Util.notify('You are not on a team.', 'info'); return; }
        const team = await DB.get('teams', driver.teamId);
        const contracts = await DB.contracts({ force: true }).catch(() => []);
        const contract = contracts.find(c => c.personId === driverId && c.status === 'active');
        const buyout = Number(contract?.buyout) || 0;
        const payee = contract?.ownerUid || team?.ownerUid || null;

        // No contract, no buyout, or nobody to pay → simple free exit.
        if (!contract || !buyout || !payee) {
            if (!confirm(`Leave ${team?.name || 'your team'} and become a free agent?`)) return;
            await this._freeDriver(driverId, Auth.uid(), 'released');
            News.post('👋', `${driver.name} left ${team?.name || 'their team'} — now a free agent`);
            Util.notify('You are now a free agent.');
            App.go('career');
            return;
        }

        const pendingReq = (await DB.recruitment({ force: true }).catch(() => []))
            .some(r => r.kind === 'release-request' && r.driverId === driverId && r.status === 'pending');

        Modal.open(`
            ${Modal.header(`🚪 Leave ${Util.esc(team?.name || 'team')}`, 'Your contract has a buyout clause')}
            <p class="muted">Your contract: <strong>${Economy.fmt(contract.salary)}/race</strong> · buyout <strong>${Economy.fmt(buyout)}</strong>.
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
                await Economy.spend(buyout, 'your contract buyout');
                const owner = await DB.get('users', payee).catch(() => null);
                if (owner) await DB.update('users', payee, { balance: (Number(owner.balance) || 0) + buyout }).catch(() => {});
                await this._freeDriver(driverId, Auth.uid(), 'bought-out');
                Modal.close();
                News.post('💸', `${driver.name} paid a ${Economy.fmt(buyout)} buyout to leave ${team?.name || 'their team'}`);
                Util.notify(`Buyout paid — you are a free agent. 💸`);
                App.go('career');
            } catch (e) { Util.notify(e.message, 'error'); }
        });

        Util.$('#lv-request')?.addEventListener('click', async () => {
            try {
                await DB.create('recruitment', {
                    kind: 'release-request', status: 'pending',
                    teamId: driver.teamId, teamName: team?.name || '', ownerUid: payee,
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
