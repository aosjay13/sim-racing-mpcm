/* ============================================================
   Phoenix SRMPC — Career & Challenges
   Role picker, role workspaces, career onboarding
   (start from scratch OR join an established team), challenges.
   ============================================================ */
'use strict';

const ROLES = [
    { id: 'driver', icon: '🏎️', label: 'Driver', desc: 'Race, earn points, build your career stats across games.' },
    { id: 'team-owner', icon: '🏢', label: 'Team Owner', desc: 'Found or take over a team, recruit drivers, chase the constructors title.' },
    { id: 'crew-chief', icon: '📋', label: 'Crew Chief', desc: 'Support your drivers with strategy and race-day calls.' },
    { id: 'mechanic', icon: '🔧', label: 'Mechanic', desc: 'Keep a team’s machinery in fighting shape.' },
    { id: 'agent', icon: '💼', label: 'Agent', desc: 'Represent drivers, broker seats and sponsorships.' },
    { id: 'sponsor', icon: '💰', label: 'Sponsor', desc: 'Back teams and drivers, put your brand on the podium.' },
    { id: 'series-owner', icon: '🏆', label: 'Series Owner', desc: 'Propose and promote championships for the league.' },
    { id: 'track-owner', icon: '🛣️', label: 'Track Owner', desc: 'Register venues and host league events.' }
];
window.ROLES = ROLES;

const Career = {
    roleInfo(id) { return ROLES.find(r => r.id === id) || null; },

    /* ---------------- Role picker ---------------- */
    showRolePicker(force = false) {
        const current = Auth.state.profile?.activeRole;
        Modal.open(`
            ${Modal.header('Choose your career path', 'You can switch roles anytime — your progress in each is kept.')}
            <div class="role-grid">
                ${ROLES.map(r => `
                    <button class="role-card ${current === r.id ? 'selected' : ''}" onclick="Career.pickRole('${r.id}')">
                        <span class="role-icon">${r.icon}</span>
                        <span class="role-name">${r.label}</span>
                        <span class="role-desc">${r.desc}</span>
                    </button>`).join('')}
            </div>
        `, { wide: true });
    },

    async pickRole(roleId) {
        try {
            await Auth.updateProfile({ activeRole: roleId });
            Modal.close();
            Util.notify(`You are now playing as ${this.roleInfo(roleId)?.label || roleId}.`);
            App.go('career');
        } catch (e) {
            Util.notify('Could not save role: ' + e.message, 'error');
        }
    },

    /* ---------------- Career view (router) ---------------- */
    async render(el) {
        const profile = Auth.state.profile;

        if (!Auth.isSignedIn()) {
            el.innerHTML = C.empty('🔒', 'Sign in to start your career', 'Create a player account to pick a role and start racing.');
            return;
        }
        if (Auth.isAdmin() && !profile) {
            el.innerHTML = `
            <div class="view-head"><div><h1>My Career</h1></div></div>
            ${C.empty('🎛', 'You are the Game Master', 'Admin sessions run the league rather than play a career. To also play, sign in with a player account (you can unlock admin on top of it with the GM button).',
                `<button class="btn btn-primary" onclick="App.go('admin')">Open Admin Console</button>`)}`;
            return;
        }
        if (!profile?.activeRole) {
            el.innerHTML = `
            <div class="view-head"><div><h1>My Career</h1><p class="muted">Pick a role to unlock your workspace.</p></div></div>
            <div class="role-grid">
                ${ROLES.map(r => `
                    <button class="role-card" onclick="Career.pickRole('${r.id}')">
                        <span class="role-icon">${r.icon}</span>
                        <span class="role-name">${r.label}</span>
                        <span class="role-desc">${r.desc}</span>
                    </button>`).join('')}
            </div>`;
            return;
        }

        const role = profile.activeRole;
        if (role === 'driver') return this.driverWorkspace(el);
        if (role === 'team-owner') return this.teamOwnerWorkspace(el);
        return this.genericWorkspace(el, role);
    },

    _workspaceHead(roleId, extraBtns = '') {
        const info = this.roleInfo(roleId);
        return `<div class="view-head">
            <div><h1>${info.icon} ${info.label} Career</h1><p class="muted">${Util.esc(Auth.state.profile?.displayName || '')} — ${info.desc}</p></div>
            <div class="btn-row">
                ${extraBtns}
                <button class="btn btn-ghost" onclick="Career.showRolePicker()">⇄ Switch Role</button>
            </div>
        </div>`;
    },

    /* ---------------- Driver workspace ---------------- */
    async driverWorkspace(el) {
        const world = await DB.loadWorld();
        const profile = Auth.state.profile;
        let driver = profile.driverId ? world.driversById[profile.driverId] : null;

        // Self-heal: linked driver was deleted, or an unlinked driver exists for this uid.
        if (!driver) {
            const mine = world.drivers.find(d => d.ownerUid === Auth.uid());
            if (mine) {
                driver = mine;
                await Auth.updateProfile({ driverId: mine.id });
            } else if (profile.driverId) {
                await Auth.updateProfile({ driverId: null });
            }
        }

        if (!driver) {
            el.innerHTML = `
            ${this._workspaceHead('driver')}
            <div class="onboard-split">
                <div class="onboard-card" onclick="Career.driverOnboarding('scratch')">
                    <span class="onboard-icon">🌱</span>
                    <h3>Start from scratch</h3>
                    <p>Begin as a free agent rookie. Prove yourself, then sign with a team — or found your own story.</p>
                    <span class="btn btn-primary">Start Fresh Career</span>
                </div>
                <div class="onboard-card" onclick="Career.driverOnboarding('established')">
                    <span class="onboard-icon">🏢</span>
                    <h3>Join an established team</h3>
                    <p>Slot straight into an existing team’s lineup and race for the constructors title from day one.</p>
                    <span class="btn btn-secondary">Browse Teams</span>
                </div>
            </div>`;
            return;
        }

        const team = world.teamsById[driver.teamId];
        const career = Stats.driverTable(world.races, world).find(r => r.driverId === driver.id);
        const history = Stats.driverHistory(driver.id, world.races, world);

        let mySignups = [];
        try {
            const signups = await DB.signups();
            const upcoming = world.races.filter(r => r.status !== 'completed');
            mySignups = signups.filter(s => s.uid === Auth.uid())
                .map(s => upcoming.find(r => r.id === s.raceId)).filter(Boolean)
                .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
        } catch (e) { /* fine */ }

        let myClaims = [];
        try {
            myClaims = (await DB.claims()).filter(c => c.uid === Auth.uid());
        } catch (e) { /* fine */ }
        const approvedClaims = myClaims.filter(c => c.status === 'approved').length;

        el.innerHTML = `
        ${this._workspaceHead('driver', `<button class="btn btn-secondary" onclick="Career.editDriverModal()">✎ Edit Profile</button>`)}

        <div class="driver-hero panel">
            <div class="driver-hero-num">${driver.number ? '#' + Util.esc(String(driver.number)) : '🏎️'}</div>
            <div class="driver-hero-info">
                <h2>${Util.esc(driver.name)}</h2>
                <div class="chip-row">
                    ${team ? `<button class="chip chip-btn" onclick="Views.showTeam('${Util.attr(team.id)}')"><span class="team-dot" style="background:${Util.esc(team.color || '#666')}"></span>${Util.esc(team.name)}</button>` : '<span class="chip chip-dim">Free agent</span>'}
                    ${driver.country ? `<span class="chip chip-dim">${Util.esc(driver.country)}</span>` : ''}
                </div>
            </div>
            <div class="btn-col">
                ${team
                    ? `<button class="btn btn-ghost btn-sm" onclick="Career.leaveTeam()">Leave team</button>`
                    : `<button class="btn btn-primary btn-sm" onclick="Career.joinTeamModal()">Join a team</button>`}
            </div>
        </div>

        <div class="stat-strip">
            ${C.statChip(career?.starts || 0, 'Starts')}
            ${C.statChip(career?.wins || 0, 'Wins')}
            ${C.statChip(career?.podiums || 0, 'Podiums')}
            ${C.statChip(career?.poles || 0, 'Poles')}
            ${C.statChip(career?.points || 0, 'Career pts')}
            ${C.statChip(approvedClaims, 'Challenges done')}
        </div>

        <div class="grid-2">
            <section class="panel">
                <div class="panel-head"><h2>🏁 My Upcoming Races</h2><button class="btn btn-ghost btn-sm" onclick="App.go('races')">Race calendar →</button></div>
                ${mySignups.length ? mySignups.map(r => C.raceRow(r, world)).join('')
                    : C.empty('📅', 'Not signed up for anything', 'Open the race calendar and get yourself on a grid.',
                        `<button class="btn btn-primary" onclick="App.go('races')">Find a race</button>`)}
            </section>

            <section class="panel">
                <div class="panel-head"><h2>📊 Race History</h2></div>
                ${history.length ? `<table class="table table-tight">
                    <thead><tr><th></th><th>Race</th><th>Game</th><th class="num">Pts</th></tr></thead>
                    <tbody>${history.slice(0, 12).map(h => `
                        <tr>
                            <td>${C.posBadge(h.result)}</td>
                            <td>${Util.esc(h.race.name || h.race.track || 'Race')}<span class="muted"> · ${Util.esc(Util.fmtDateShort(h.race.date))}</span></td>
                            <td class="muted">${Util.esc(h.game?.name || '—')}</td>
                            <td class="num strong">${h.points}</td>
                        </tr>`).join('')}</tbody></table>`
                    : C.empty('🏁', 'No races completed yet', 'Your full race-by-race history will build here.')}
            </section>
        </div>`;
    },

    async driverOnboarding(startMode) {
        let teamsHtml = '';
        if (startMode === 'established') {
            const teams = (await DB.teams()).filter(t => t.recruiting !== false);
            if (!teams.length) {
                Util.notify('No teams are recruiting yet — starting from scratch instead. You can join a team later.', 'info');
                startMode = 'scratch';
            } else {
                teamsHtml = `
                <label class="field"><span>Choose your team</span>
                    <select id="ob-team" class="input">
                        ${teams.map(t => `<option value="${Util.attr(t.id)}">${Util.esc(t.name)}</option>`).join('')}
                    </select>
                </label>`;
            }
        }
        Modal.open(`
            ${Modal.header(startMode === 'scratch' ? '🌱 Fresh Career' : '🏢 Join an Established Team', 'Create your driver profile')}
            <form id="ob-driver-form" class="form-grid">
                <label class="field"><span>Driver name *</span><input id="ob-name" class="input" required value="${Util.esc(Auth.state.profile?.displayName || '')}" maxlength="40"></label>
                <div class="form-row">
                    <label class="field"><span>Race number</span><input id="ob-number" class="input" type="number" min="0" max="999" placeholder="e.g. 13"></label>
                    <label class="field"><span>Country</span><input id="ob-country" class="input" placeholder="e.g. USA" maxlength="30"></label>
                </div>
                ${teamsHtml}
                <label class="field"><span>Bio (optional)</span><textarea id="ob-bio" class="input" rows="2" maxlength="300" placeholder="Tell the league who you are…"></textarea></label>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Start Career 🏁</button>
                </div>
            </form>
        `);
        Util.$('#ob-driver-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type=submit]');
            btn.disabled = true;
            try {
                const name = Util.$('#ob-name').value.trim();
                if (!name) throw new Error('Driver name is required.');
                const teamId = Util.$('#ob-team')?.value || null;
                const driverId = await DB.create('drivers', {
                    name,
                    number: Util.$('#ob-number').value ? Number(Util.$('#ob-number').value) : null,
                    country: Util.$('#ob-country').value.trim(),
                    bio: Util.$('#ob-bio').value.trim(),
                    teamId,
                    ownerUid: Auth.uid(),
                    careerStart: startMode,
                    status: 'approved'
                });
                await Auth.updateProfile({ driverId, teamId: teamId || null });
                Modal.close();
                Util.notify('Welcome to the grid! Your career starts now. 🏁');
                App.go('career');
            } catch (err) {
                Util.notify(err.message, 'error');
                btn.disabled = false;
            }
        });
    },

    async editDriverModal() {
        const profile = Auth.state.profile;
        const driver = profile?.driverId ? await DB.get('drivers', profile.driverId) : null;
        if (!driver) { Util.notify('No driver profile found.', 'error'); return; }
        Modal.open(`
            ${Modal.header('Edit Driver Profile')}
            <form id="edit-driver-form" class="form-grid">
                <label class="field"><span>Driver name *</span><input id="ed-name" class="input" required value="${Util.esc(driver.name)}" maxlength="40"></label>
                <div class="form-row">
                    <label class="field"><span>Race number</span><input id="ed-number" class="input" type="number" min="0" max="999" value="${driver.number ?? ''}"></label>
                    <label class="field"><span>Country</span><input id="ed-country" class="input" value="${Util.esc(driver.country || '')}" maxlength="30"></label>
                </div>
                <label class="field"><span>Bio</span><textarea id="ed-bio" class="input" rows="3" maxlength="300">${Util.esc(driver.bio || '')}</textarea></label>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save</button>
                </div>
            </form>
        `);
        Util.$('#edit-driver-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                await DB.update('drivers', driver.id, {
                    name: Util.$('#ed-name').value.trim(),
                    number: Util.$('#ed-number').value ? Number(Util.$('#ed-number').value) : null,
                    country: Util.$('#ed-country').value.trim(),
                    bio: Util.$('#ed-bio').value.trim()
                });
                Modal.close();
                Util.notify('Profile updated.');
                App.go('career');
            } catch (err) { Util.notify(err.message, 'error'); }
        });
    },

    async joinTeamModal() {
        const teams = (await DB.teams({ force: true })).filter(t => t.recruiting !== false);
        if (!teams.length) { Util.notify('No teams are recruiting right now.', 'info'); return; }
        Modal.open(`
            ${Modal.header('Join a Team', 'Teams currently recruiting drivers')}
            <div class="stack">${teams.map(t => `
                <div class="race-row" onclick="Career.joinTeam('${Util.attr(t.id)}')">
                    ${C.logoBox(t)}
                    <div class="race-row-main">
                        <span class="race-title">${Util.esc(t.name)}</span>
                        <span class="race-sub">${Util.esc(t.description || '')}</span>
                    </div>
                    <span class="btn btn-primary btn-sm">Join</span>
                </div>`).join('')}
            </div>
        `);
    },

    async joinTeam(teamId) {
        try {
            const driverId = Auth.state.profile?.driverId;
            if (!driverId) throw new Error('Create your driver profile first.');
            await DB.update('drivers', driverId, { teamId });
            await Auth.updateProfile({ teamId });
            Modal.close();
            Util.notify('You have signed with the team! 🤝');
            App.go('career');
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    async leaveTeam() {
        if (!confirm('Leave your current team and become a free agent?')) return;
        try {
            const driverId = Auth.state.profile?.driverId;
            await DB.update('drivers', driverId, { teamId: null });
            await Auth.updateProfile({ teamId: null });
            Util.notify('You are now a free agent.');
            App.go('career');
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    /* ---------------- Team owner workspace ---------------- */
    async teamOwnerWorkspace(el) {
        const world = await DB.loadWorld();
        let team = world.teams.find(t => t.ownerUid === Auth.uid());

        if (!team) {
            const takeover = world.teams.filter(t => !t.ownerUid);
            el.innerHTML = `
            ${this._workspaceHead('team-owner')}
            <div class="onboard-split">
                <div class="onboard-card" onclick="Career.teamForm()">
                    <span class="onboard-icon">🌱</span>
                    <h3>Found a new team</h3>
                    <p>Start from scratch: name, colors, logo, and an empty garage. Build it into a dynasty.</p>
                    <span class="btn btn-primary">Create Team</span>
                </div>
                <div class="onboard-card ${takeover.length ? '' : 'disabled'}" ${takeover.length ? `onclick="Career.takeoverModal()"` : ''}>
                    <span class="onboard-icon">🏢</span>
                    <h3>Take over an established team</h3>
                    <p>${takeover.length ? `${Util.plural(takeover.length, 'unowned team')} available. Inherit the roster and history.` : 'No unowned teams available right now.'}</p>
                    <span class="btn btn-secondary">Browse Teams</span>
                </div>
            </div>`;
            return;
        }

        const roster = world.drivers.filter(d => d.teamId === team.id);
        const teamRow = Stats.teamTable(world.races, world).find(t => t.teamId === team.id);
        const results = Stats.completedRaces(world.races)
            .filter(r => r.results.some(res => roster.some(d => d.id === res.driverId)))
            .sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 8);

        el.innerHTML = `
        ${this._workspaceHead('team-owner', `<button class="btn btn-secondary" onclick="Career.teamForm('${Util.attr(team.id)}')">✎ Edit Team</button>`)}

        <div class="driver-hero panel">
            ${C.logoBox(team, 'logo-xl')}
            <div class="driver-hero-info">
                <h2>${Util.esc(team.name)}</h2>
                <div class="chip-row">
                    ${team.recruiting !== false ? '<span class="badge badge-green">Recruiting</span>' : '<span class="badge badge-dim">Roster closed</span>'}
                    ${team.headquarters ? `<span class="chip chip-dim">📍 ${Util.esc(team.headquarters)}</span>` : ''}
                </div>
                ${team.description ? `<p class="muted">${Util.esc(team.description)}</p>` : ''}
            </div>
            <div class="btn-col">
                <button class="btn btn-secondary btn-sm" onclick="Career.toggleRecruiting('${Util.attr(team.id)}', ${team.recruiting === false})">
                    ${team.recruiting === false ? 'Open recruiting' : 'Close recruiting'}
                </button>
            </div>
        </div>

        <div class="stat-strip">
            ${C.statChip(roster.length, 'Drivers')}
            ${C.statChip(teamRow?.points || 0, 'Points')}
            ${C.statChip(teamRow?.wins || 0, 'Wins')}
            ${C.statChip(teamRow?.podiums || 0, 'Podiums')}
        </div>

        <div class="grid-2">
            <section class="panel">
                <div class="panel-head"><h2>👥 Roster</h2></div>
                ${roster.length ? roster.map(d => `
                    <div class="race-row" onclick="Views.showDriver('${Util.attr(d.id)}')">
                        <div class="driver-hero-num" style="font-size:1.1rem;min-width:3rem">${d.number ? '#' + Util.esc(String(d.number)) : '🏎️'}</div>
                        <div class="race-row-main">
                            <span class="race-title">${Util.esc(d.name)}</span>
                            <span class="race-sub">${Util.esc(d.country || '')}</span>
                        </div>
                    </div>`).join('')
                    : C.empty('👥', 'No drivers yet', 'Keep recruiting open — drivers can sign with you from their career page. The Game Master can also assign drivers.')}
            </section>

            <section class="panel">
                <div class="panel-head"><h2>📊 Recent Team Results</h2></div>
                ${results.length ? results.map(r => C.raceRow(r, world)).join('')
                    : C.empty('📊', 'No results yet', 'Team results appear once your drivers finish races.')}
            </section>
        </div>`;
    },

    async teamForm(teamId = null) {
        const team = teamId ? await DB.get('teams', teamId) : null;
        Modal.open(`
            ${Modal.header(team ? 'Edit Team' : 'Found a New Team')}
            <form id="team-form" class="form-grid">
                <label class="field"><span>Team name *</span><input id="tf-name" class="input" required value="${Util.esc(team?.name || '')}" maxlength="50"></label>
                <div class="form-row">
                    <label class="field"><span>Team color</span><input id="tf-color" class="input input-color" type="color" value="${Util.esc(team?.color || '#ff5a36')}"></label>
                    <label class="field"><span>Headquarters</span><input id="tf-hq" class="input" value="${Util.esc(team?.headquarters || '')}" maxlength="50" placeholder="e.g. Phoenix, AZ"></label>
                </div>
                <label class="field"><span>Team logo (optional)</span><input id="tf-logo" class="input" type="file" accept="image/*"></label>
                <label class="field"><span>Description</span><textarea id="tf-desc" class="input" rows="2" maxlength="300">${Util.esc(team?.description || '')}</textarea></label>
                <label class="check"><input id="tf-recruiting" type="checkbox" ${team?.recruiting !== false ? 'checked' : ''}> Open to new drivers (shows in “Join a team”)</label>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">${team ? 'Save' : 'Create Team'}</button>
                </div>
            </form>
        `);
        Util.$('#team-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type=submit]');
            btn.disabled = true;
            try {
                const data = {
                    name: Util.$('#tf-name').value.trim(),
                    color: Util.$('#tf-color').value,
                    headquarters: Util.$('#tf-hq').value.trim(),
                    description: Util.$('#tf-desc').value.trim(),
                    recruiting: Util.$('#tf-recruiting').checked
                };
                if (!data.name) throw new Error('Team name is required.');
                const file = Util.$('#tf-logo').files[0];
                if (file) data.logo = await Util.compressImage(file);
                if (team) {
                    await DB.update('teams', team.id, data);
                    Util.notify('Team updated.');
                } else {
                    await DB.create('teams', { ...data, ownerUid: Auth.uid(), isEstablished: false, status: 'approved' });
                    Util.notify('Team founded! Time to build a legacy. 🏢');
                }
                Modal.close();
                App.go('career');
            } catch (err) {
                Util.notify(err.message, 'error');
                btn.disabled = false;
            }
        });
    },

    async takeoverModal() {
        const teams = (await DB.teams({ force: true })).filter(t => !t.ownerUid);
        if (!teams.length) { Util.notify('No unowned teams available.', 'info'); return; }
        Modal.open(`
            ${Modal.header('Take Over a Team', 'These established teams need an owner')}
            <div class="stack">${teams.map(t => `
                <div class="race-row" onclick="Career.takeoverTeam('${Util.attr(t.id)}')">
                    ${C.logoBox(t)}
                    <div class="race-row-main">
                        <span class="race-title">${Util.esc(t.name)}</span>
                        <span class="race-sub">${Util.esc(t.description || '')}</span>
                    </div>
                    <span class="btn btn-primary btn-sm">Take over</span>
                </div>`).join('')}
            </div>
        `);
    },

    async takeoverTeam(teamId) {
        try {
            await DB.update('teams', teamId, { ownerUid: Auth.uid(), isEstablished: true });
            await Auth.updateProfile({ teamId });
            Modal.close();
            Util.notify('The team is yours. Make it a dynasty. 🏢');
            App.go('career');
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    async toggleRecruiting(teamId, open) {
        try {
            await DB.update('teams', teamId, { recruiting: open });
            Util.notify(open ? 'Recruiting opened.' : 'Recruiting closed.');
            App.go('career');
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    /* ---------------- Generic role workspace ---------------- */
    async genericWorkspace(el, roleId) {
        const info = this.roleInfo(roleId);
        const world = await DB.loadWorld();
        let profiles = [];
        try { profiles = await DB.roleProfiles(); } catch (e) { /* fine */ }
        const mine = profiles.find(p => p.uid === Auth.uid() && p.role === roleId);

        if (!mine) {
            el.innerHTML = `
            ${this._workspaceHead(roleId)}
            ${C.empty(info.icon, `Set up your ${info.label} profile`, info.desc,
                `<button class="btn btn-primary" onclick="Career.roleProfileForm('${roleId}')">Create ${info.label} Profile</button>`)}`;
            return;
        }

        // Player's challenge points (approved claims × each challenge's points).
        let challengePoints = 0;
        try {
            const [challenges, claims] = await Promise.all([DB.challenges(), DB.claims()]);
            const ptsById = Object.fromEntries(challenges.map(c => [c.id, Number(c.points) || 1]));
            challengePoints = claims.filter(c => c.uid === Auth.uid() && c.status === 'approved')
                .reduce((s, c) => s + (ptsById[c.challengeId] ?? 1), 0);
        } catch (e) { /* challenges optional */ }

        const driverRows = Stats.driverTable(world.races, world);
        const rowFor = (id) => driverRows.find(r => r.driverId === id);
        const kpi = (v, l) => C.statChip(v, l);
        let kpis = '', contextHtml = '';

        if (roleId === 'crew-chief' || roleId === 'agent') {
            const clientIds = mine.clientDriverIds || [];
            const clients = clientIds.map(id => world.driversById[id]).filter(Boolean);
            const rows = clients.map(d => rowFor(d.id)).filter(Boolean);
            const totWins = rows.reduce((s, r) => s + r.wins, 0);
            const totPod = rows.reduce((s, r) => s + r.podiums, 0);
            const totPts = rows.reduce((s, r) => s + r.points, 0);
            const bestRank = rows.length ? Math.min(...rows.map(r => r.rank)) : null;
            const label = roleId === 'agent' ? 'Clients' : 'My Drivers';
            const marketValue = (r) => r ? Math.round(r.points + r.wins * 15 + r.podiums * 6 + r.poles * 3) : 0;

            kpis = `${kpi(clients.length, label)}${kpi(totWins, 'Client wins')}${kpi(totPod, 'Client podiums')}${kpi(bestRank ? '#' + bestRank : '—', 'Best ranked')}`;
            contextHtml = `<section class="panel">
                <div class="panel-head"><h2>${roleId === 'agent' ? '💼' : '📋'} ${label} — Form Board</h2>
                    <button class="btn btn-secondary btn-sm" onclick="Career.pickClients('${Util.attr(mine.id)}')">✎ Manage</button></div>
                ${clients.length ? clients.map(d => {
                    const r = rowFor(d.id);
                    const form = Stats.driverForm(d.id, world.races, world);
                    return `<div class="race-row" onclick="Views.showDriver('${Util.attr(d.id)}')">
                        <div class="race-row-main">
                            <span class="race-title">${Util.esc(d.name)} ${r ? `<span class="chip chip-dim">#${r.rank}</span>` : ''}</span>
                            <span class="race-sub">${r ? `${r.points} pts · ${r.wins}W · avg ${r.avgFinish ? r.avgFinish.toFixed(1) : '—'}${roleId === 'agent' ? ` · 💵 value ${marketValue(r)}` : ''}` : 'No results yet'}</span>
                        </div>
                        <div class="race-row-side">${C.formPips(form)}</div>
                    </div>`;
                }).join('') : C.empty('👥', `No ${label.toLowerCase()} yet`, `Add drivers to your book to track their form here.`)}
            </section>`;

            if (roleId === 'agent') {
                const openSeats = world.teams.filter(t => t.recruiting).map(t => ({ t, n: world.drivers.filter(d => d.teamId === t.id).length }));
                contextHtml += `<section class="panel">
                    <div class="panel-head"><h2>🪑 Open Seats</h2></div>
                    ${openSeats.length ? openSeats.map(({ t, n }) => `<div class="race-row" onclick="Views.showTeam('${Util.attr(t.id)}')">
                        ${C.logoBox(t)}<div class="race-row-main"><span class="race-title">${Util.esc(t.name)}</span><span class="race-sub">${Util.plural(n, 'driver')} signed · recruiting</span></div>
                        <span class="badge badge-green">Hiring</span></div>`).join('')
                        : C.empty('🪑', 'No open seats', 'No teams are recruiting right now — check back after the next round.')}
                </section>`;
            }
        } else if (roleId === 'mechanic') {
            const team = world.teamsById[mine.teamId];
            const roster = team ? world.drivers.filter(d => d.teamId === team.id) : [];
            const rosterRows = roster.map(d => rowFor(d.id)).filter(Boolean);
            const teamRank = team ? Stats.teamTable(world.races, world).find(t => t.teamId === team.id)?.rank : null;
            const starts = rosterRows.reduce((s, r) => s + r.starts, 0);
            const dnfs = rosterRows.reduce((s, r) => s + r.dnfs, 0);
            const reliability = starts ? Math.round((1 - dnfs / starts) * 100) : null;

            kpis = `${kpi(teamRank ? '#' + teamRank : '—', 'Constructor rank')}${kpi(roster.length, 'Cars')}${kpi(reliability != null ? reliability + '%' : '—', 'Reliability')}${kpi(dnfs, 'DNFs')}`;
            contextHtml = `<section class="panel">
                <div class="panel-head"><h2>🔧 My Garage</h2>
                    <button class="btn btn-secondary btn-sm" onclick="Career.pickTeamForRole('${Util.attr(mine.id)}')">✎ Choose Team</button></div>
                ${team ? `<div class="race-row" onclick="Views.showTeam('${Util.attr(team.id)}')">
                        ${C.logoBox(team)}
                        <div class="race-row-main"><span class="race-title">${Util.esc(team.name)}</span>
                        <span class="race-sub">${Util.plural(roster.length, 'car')} · ${reliability != null ? reliability + '% finish rate' : 'no data yet'}</span></div>
                    </div>
                    ${rosterRows.map(r => `<div class="race-row" onclick="Views.showDriver('${Util.attr(r.driverId)}')">
                        <div class="race-row-main"><span class="race-title">${Util.esc(r.driver.name)}</span>
                        <span class="race-sub">${r.starts} starts · ${r.dnfs} DNF · ${r.starts ? Math.round((1 - r.dnfs / r.starts) * 100) : 0}% finish</span></div>
                        <div class="progress" style="width:80px"><div class="progress-fill" style="width:${r.starts ? Math.round((1 - r.dnfs / r.starts) * 100) : 0}%"></div></div>
                    </div>`).join('')}`
                    : C.empty('🔧', 'No team yet', 'Pick the team whose cars you keep alive.')}
            </section>`;
        } else if (roleId === 'sponsor') {
            const sponsoredTeam = world.teamsById[mine.sponsoredTeamId];
            const sponsoredDriver = world.driversById[mine.sponsoredDriverId];
            const teamRow = sponsoredTeam ? Stats.teamTable(world.races, world).find(t => t.teamId === sponsoredTeam.id) : null;
            const drvRow = sponsoredDriver ? rowFor(sponsoredDriver.id) : null;
            const exposurePts = (teamRow?.points || 0) + (drvRow?.points || 0);
            const exposureWins = (teamRow?.wins || 0) + (drvRow?.wins || 0);
            const exposurePod = (teamRow?.podiums || 0) + (drvRow?.podiums || 0);

            kpis = `${kpi(exposurePts, 'Exposure pts')}${kpi(exposureWins, 'Wins backed')}${kpi(exposurePod, 'Podiums backed')}${kpi(challengePoints, 'Challenge pts')}`;
            contextHtml = `<section class="panel">
                <div class="panel-head"><h2>💰 Portfolio ROI</h2>
                    <button class="btn btn-secondary btn-sm" onclick="Career.sponsorPortfolio('${Util.attr(mine.id)}')">✎ Manage</button></div>
                ${sponsoredTeam || sponsoredDriver ? `
                    ${sponsoredTeam ? `<div class="race-row" onclick="Views.showTeam('${Util.attr(sponsoredTeam.id)}')">${C.logoBox(sponsoredTeam)}<div class="race-row-main"><span class="race-title">${Util.esc(sponsoredTeam.name)}</span><span class="race-sub">${teamRow ? `#${teamRow.rank} · ${teamRow.points} pts · ${teamRow.wins} wins` : 'Sponsored team'}</span></div></div>` : ''}
                    ${sponsoredDriver ? `<div class="race-row" onclick="Views.showDriver('${Util.attr(sponsoredDriver.id)}')"><div class="race-row-main"><span class="race-title">${Util.esc(sponsoredDriver.name)}</span><span class="race-sub">${drvRow ? `#${drvRow.rank} · ${drvRow.points} pts · ${drvRow.wins} wins` : 'Sponsored driver'}</span></div></div>` : ''}`
                    : C.empty('💰', 'Nothing sponsored yet', 'Put your brand on a team or driver and follow the ROI on race day.')}
            </section>`;
        } else if (roleId === 'series-owner') {
            const mySeries = world.series.filter(s => s.ownerUid === Auth.uid());
            const seriesIds = new Set(mySeries.map(s => s.id));
            const myRaces = world.races.filter(r => seriesIds.has(r.seriesId));
            const needResults = myRaces.filter(r => r.status !== 'completed' && Util.isPast(r.date));
            const mySeasons = (world.seasons || []).filter(se => seriesIds.has(se.seriesId));

            kpis = `${kpi(mySeries.length, 'My series')}${kpi(myRaces.length, 'Races')}${kpi(mySeasons.length, 'Seasons')}${kpi(needResults.length, 'Need results')}`;
            contextHtml = `<section class="panel">
                <div class="panel-head"><h2>🏆 My Series</h2>
                    <button class="btn btn-secondary btn-sm" onclick="Career.proposeSeries()">＋ Propose Series</button></div>
                ${mySeries.length ? mySeries.map(s => {
                    const sRaces = world.races.filter(r => r.seriesId === s.id);
                    const pending = sRaces.filter(r => r.status !== 'completed' && Util.isPast(r.date)).length;
                    return `<div class="race-row" onclick="App.go('series-detail','${Util.attr(s.id)}')">
                        ${C.logoBox(s)}
                        <div class="race-row-main"><span class="race-title">${Util.esc(s.name)}</span>
                            <span class="race-sub">${Util.plural(sRaces.length, 'race')}${pending ? ` · ⚠ ${pending} awaiting results` : ' · schedule healthy'}</span></div>
                        ${C.statusBadge(s.status || 'active')}
                    </div>`;
                }).join('')
                    : C.empty('🏆', 'No series yet', 'Propose a championship — the Game Master approves and publishes it.')}
            </section>`;
        } else if (roleId === 'track-owner') {
            const trackStats = Stats.trackTable(world.races, world);
            const myTracks = (mine.tracks || []);
            const hosted = myTracks.reduce((s, name) => {
                const ts = trackStats.find(t => t.track.toLowerCase() === name.toLowerCase());
                return s + (ts?.races || 0);
            }, 0);
            const kings = myTracks.filter(name => trackStats.find(t => t.track.toLowerCase() === name.toLowerCase())?.kingOfTrack).length;

            kpis = `${kpi(myTracks.length, 'Venues')}${kpi(hosted, 'Races hosted')}${kpi(kings, 'Track kings')}${kpi(challengePoints, 'Challenge pts')}`;
            contextHtml = `<section class="panel">
                <div class="panel-head"><h2>🛣️ My Venues</h2>
                    <button class="btn btn-secondary btn-sm" onclick="Career.addVenue('${Util.attr(mine.id)}')">＋ Register Venue</button></div>
                ${myTracks.length ? myTracks.map(name => {
                    const ts = trackStats.find(t => t.track.toLowerCase() === name.toLowerCase());
                    return `<div class="race-row">
                        <div class="race-row-main"><span class="race-title">${Util.esc(name)}</span>
                        <span class="race-sub">${ts ? `${Util.plural(ts.races, 'league race')} · ${Util.plural(ts.uniqueWinners, 'winner')}${ts.kingOfTrack ? ` · 👑 ${Util.esc(ts.kingOfTrack.name)} (${ts.kingOfTrack.wins})` : ''}` : 'No league races hosted yet'}</span></div>
                    </div>`;
                }).join('') : C.empty('🛣️', 'No venues registered', 'Register the tracks you host — league races there count toward your venue stats.')}
            </section>`;
        }

        el.innerHTML = `
        ${this._workspaceHead(roleId, `<button class="btn btn-secondary" onclick="Career.roleProfileForm('${roleId}','${Util.attr(mine.id)}')">✎ Edit Profile</button>`)}
        <div class="driver-hero panel">
            <div class="driver-hero-num">${info.icon}</div>
            <div class="driver-hero-info">
                <h2>${Util.esc(mine.name)}</h2>
                ${mine.bio ? `<p class="muted">${Util.esc(mine.bio)}</p>` : ''}
                <div class="chip-row"><span class="chip">${info.label}</span><span class="chip chip-dim">🎯 ${challengePoints} challenge pts</span></div>
            </div>
        </div>
        ${kpis ? `<div class="stat-strip">${kpis}</div>` : ''}
        <div class="grid-2">
            ${contextHtml}
            <section class="panel">
                <div class="panel-head"><h2>🎯 Active Challenges</h2><button class="btn btn-ghost btn-sm" onclick="App.go('challenges')">All →</button></div>
                <p class="muted">You've banked <strong>${challengePoints}</strong> challenge ${challengePoints === 1 ? 'point' : 'points'}. Complete solo & multiplayer challenges to climb the league leaderboard, whatever your role.</p>
                <button class="btn btn-primary" onclick="App.go('challenges')">Browse challenges</button>
            </section>
        </div>`;
    },

    async roleProfileForm(roleId, profileId = null) {
        const info = this.roleInfo(roleId);
        const existing = profileId ? await DB.get('roleProfiles', profileId) : null;
        Modal.open(`
            ${Modal.header(`${info.icon} ${info.label} Profile`)}
            <form id="role-profile-form" class="form-grid">
                <label class="field"><span>Name *</span><input id="rp-name" class="input" required value="${Util.esc(existing?.name || Auth.state.profile?.displayName || '')}" maxlength="50"></label>
                <label class="field"><span>Bio</span><textarea id="rp-bio" class="input" rows="3" maxlength="300" placeholder="Your story in the league…">${Util.esc(existing?.bio || '')}</textarea></label>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save</button>
                </div>
            </form>
        `);
        Util.$('#role-profile-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const data = { name: Util.$('#rp-name').value.trim(), bio: Util.$('#rp-bio').value.trim() };
                if (!data.name) throw new Error('Name is required.');
                if (existing) await DB.update('roleProfiles', existing.id, data);
                else await DB.create('roleProfiles', { ...data, uid: Auth.uid(), role: roleId });
                Modal.close();
                Util.notify('Profile saved.');
                App.go('career');
            } catch (err) { Util.notify(err.message, 'error'); }
        });
    },

    async pickClients(profileId) {
        const [profile, drivers] = await Promise.all([DB.get('roleProfiles', profileId), DB.drivers()]);
        const selected = new Set(profile?.clientDriverIds || []);
        Modal.open(`
            ${Modal.header('Manage Drivers', 'Pick the drivers in your book')}
            <div class="stack" id="client-list">${drivers.map(d => `
                <label class="check"><input type="checkbox" value="${Util.attr(d.id)}" ${selected.has(d.id) ? 'checked' : ''}> ${Util.esc(d.name)}</label>`).join('')}
            </div>
            <div class="modal-actions">
                <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                <button class="btn btn-primary" id="save-clients">Save</button>
            </div>
        `);
        Util.$('#save-clients').addEventListener('click', async () => {
            try {
                const ids = Util.$$('#client-list input:checked').map(i => i.value);
                await DB.update('roleProfiles', profileId, { clientDriverIds: ids });
                Modal.close();
                Util.notify('Saved.');
                App.go('career');
            } catch (e) { Util.notify(e.message, 'error'); }
        });
    },

    async pickTeamForRole(profileId) {
        const teams = await DB.teams();
        if (!teams.length) { Util.notify('No teams exist yet.', 'info'); return; }
        Modal.open(`
            ${Modal.header('Choose Your Team')}
            <div class="stack">${teams.map(t => `
                <div class="race-row" onclick="Career._setRoleTeam('${Util.attr(profileId)}','${Util.attr(t.id)}')">
                    ${C.logoBox(t)}
                    <div class="race-row-main"><span class="race-title">${Util.esc(t.name)}</span></div>
                </div>`).join('')}
            </div>
        `);
    },

    async _setRoleTeam(profileId, teamId) {
        try {
            await DB.update('roleProfiles', profileId, { teamId });
            Modal.close();
            Util.notify('Team assigned.');
            App.go('career');
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    async sponsorPortfolio(profileId) {
        const [profile, teams, drivers] = await Promise.all([DB.get('roleProfiles', profileId), DB.teams(), DB.drivers()]);
        Modal.open(`
            ${Modal.header('Sponsorship Portfolio')}
            <div class="form-grid">
                <label class="field"><span>Sponsored team</span>
                    <select id="sp-team" class="input">
                        <option value="">None</option>
                        ${teams.map(t => `<option value="${Util.attr(t.id)}" ${profile?.sponsoredTeamId === t.id ? 'selected' : ''}>${Util.esc(t.name)}</option>`).join('')}
                    </select></label>
                <label class="field"><span>Sponsored driver</span>
                    <select id="sp-driver" class="input">
                        <option value="">None</option>
                        ${drivers.map(d => `<option value="${Util.attr(d.id)}" ${profile?.sponsoredDriverId === d.id ? 'selected' : ''}>${Util.esc(d.name)}</option>`).join('')}
                    </select></label>
                <div class="modal-actions">
                    <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button class="btn btn-primary" id="save-portfolio">Save</button>
                </div>
            </div>
        `);
        Util.$('#save-portfolio').addEventListener('click', async () => {
            try {
                await DB.update('roleProfiles', profileId, {
                    sponsoredTeamId: Util.$('#sp-team').value || null,
                    sponsoredDriverId: Util.$('#sp-driver').value || null
                });
                Modal.close();
                Util.notify('Portfolio saved.');
                App.go('career');
            } catch (e) { Util.notify(e.message, 'error'); }
        });
    },

    async proposeSeries() {
        const games = await DB.games();
        Modal.open(`
            ${Modal.header('Propose a Series', 'The Game Master reviews and publishes proposals')}
            <form id="propose-series-form" class="form-grid">
                <label class="field"><span>Series name *</span><input id="ps-name" class="input" required maxlength="60"></label>
                <label class="field"><span>Game</span>
                    <select id="ps-game" class="input">
                        <option value="">Any / undecided</option>
                        ${games.map(g => `<option value="${Util.attr(g.id)}">${Util.esc(g.name)}</option>`).join('')}
                    </select></label>
                <label class="field"><span>Pitch</span><textarea id="ps-desc" class="input" rows="3" maxlength="400" placeholder="Format, car class, cadence…"></textarea></label>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Submit Proposal</button>
                </div>
            </form>
        `);
        Util.$('#propose-series-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const name = Util.$('#ps-name').value.trim();
                if (!name) throw new Error('Series name is required.');
                await DB.create('series', {
                    name,
                    gameId: Util.$('#ps-game').value || null,
                    description: Util.$('#ps-desc').value.trim(),
                    status: 'proposed',
                    ownerUid: Auth.uid(),
                    season: new Date().getFullYear(),
                    pointsSystem: 'f1'
                });
                Modal.close();
                Util.notify('Proposal submitted! The Game Master will review it.');
                App.go('career');
            } catch (err) { Util.notify(err.message, 'error'); }
        });
    },

    async addVenue(profileId) {
        const name = prompt('Venue / track name:');
        if (!name?.trim()) return;
        try {
            const profile = await DB.get('roleProfiles', profileId);
            const tracks = [...(profile?.tracks || []), name.trim()];
            await DB.update('roleProfiles', profileId, { tracks });
            Util.notify('Venue registered.');
            App.go('career');
        } catch (e) { Util.notify(e.message, 'error'); }
    }
};
window.Career = Career;
Views.career = (el) => Career.render(el);

/* ============================================================
   Challenges view
   ============================================================ */
const Challenges = {
    _tab: 'all',

    async render(el) {
        let challenges = [], claims = [];
        try {
            [challenges, claims] = await Promise.all([DB.challenges({ force: true }), DB.claims({ force: true })]);
        } catch (e) {
            el.innerHTML = C.empty('🎯', 'Challenges unavailable', 'Sign in to view league challenges.');
            return;
        }
        const today = Util.todayISO();
        const isAdmin = Auth.isAdmin();
        const uid = Auth.uid();

        const active = challenges.filter(c => c.status === 'active' && (!c.endDate || c.endDate >= today));
        const filtered = this._tab === 'all' ? active : active.filter(c => c.cadence === this._tab);
        const myClaims = claims.filter(c => c.uid === uid);
        const claimByChallenge = Object.fromEntries(myClaims.map(c => [c.challengeId, c]));

        // Leaderboard: challenge points earned per player from approved claims.
        // Each challenge carries a numeric `points` value; older challenges
        // without one count as 1 point so nobody loses past progress.
        const pointsByChallenge = Object.fromEntries(challenges.map(c => [c.id, Number(c.points) || 1]));
        const tally = new Map(); // name -> { points, done }
        claims.filter(c => c.status === 'approved').forEach(c => {
            const key = c.playerName || c.uid;
            const row = tally.get(key) || { points: 0, done: 0 };
            row.points += pointsByChallenge[c.challengeId] ?? 1;
            row.done += 1;
            tally.set(key, row);
        });
        const leaderboard = Array.from(tally.entries())
            .sort((a, b) => b[1].points - a[1].points || b[1].done - a[1].done)
            .slice(0, 10);
        // This player's own challenge-point total (surfaced in workspaces too).
        const myApproved = myClaims.filter(c => c.status === 'approved');
        const myChallengePoints = myApproved.reduce((s, c) => s + (pointsByChallenge[c.challengeId] ?? 1), 0);

        el.innerHTML = `
        <div class="view-head">
            <div><h1>Challenges</h1><p class="muted">Fresh solo & multiplayer objectives every week and month.</p></div>
            ${isAdmin ? `<button class="btn btn-primary" onclick="App.go('admin','challenges')">⚙ Manage Challenges</button>` : ''}
        </div>

        <div class="filter-bar">
            <div class="tab-row">
                <button class="tab ${this._tab === 'all' ? 'active' : ''}" data-tab="all">All (${active.length})</button>
                <button class="tab ${this._tab === 'weekly' ? 'active' : ''}" data-tab="weekly">Weekly</button>
                <button class="tab ${this._tab === 'monthly' ? 'active' : ''}" data-tab="monthly">Monthly</button>
            </div>
        </div>

        <div class="grid-cal">
            <div>
                ${filtered.length ? `<div class="card-grid">${filtered.map(c => {
                    const claim = claimByChallenge[c.id];
                    return `<div class="challenge-card">
                        <div class="chip-row">
                            <span class="badge ${c.mode === 'multiplayer' ? 'badge-purple' : 'badge-blue'}">${c.mode === 'multiplayer' ? '👥 Multiplayer' : '👤 Solo'}</span>
                            <span class="chip chip-dim">${c.cadence === 'weekly' ? '📅 Weekly' : '🗓 Monthly'}</span>
                        </div>
                        <h3>${Util.esc(c.title)}</h3>
                        <p class="muted">${Util.esc(c.description)}</p>
                        ${c.reward ? `<p class="reward">🎁 ${Util.esc(c.reward)}</p>` : ''}
                        <p class="muted small">Ends ${Util.esc(Util.fmtDate(c.endDate))}</p>
                        ${Auth.isPlayer() ? (
                            claim
                                ? `<span class="badge ${claim.status === 'approved' ? 'badge-green' : claim.status === 'rejected' ? 'badge-red' : 'badge-amber'}">${claim.status === 'approved' ? '✓ Completed' : claim.status === 'rejected' ? '✕ Not accepted' : '⏳ Awaiting GM review'}</span>`
                                : `<button class="btn btn-primary btn-sm" onclick="Challenges.claim('${Util.attr(c.id)}')">Mark as completed</button>`
                        ) : ''}
                    </div>`;
                }).join('')}</div>`
                : C.empty('🎯', 'No active challenges', isAdmin ? 'Generate a fresh weekly or monthly set in one click.' : 'The Game Master will drop new challenges soon.',
                    isAdmin ? `<button class="btn btn-primary" onclick="App.go('admin','challenges')">Generate Challenges</button>` : '')}
            </div>

            <div class="stack">
                <section class="panel">
                    <div class="panel-head"><h2>🏅 Challenge Points</h2>
                        ${Auth.isPlayer() ? `<span class="chip chip-dim">You: ${myChallengePoints} pts</span>` : ''}</div>
                    ${leaderboard.length ? `<table class="table table-tight">
                        <thead><tr><th>#</th><th>Player</th><th class="num">Pts</th><th class="num">Done</th></tr></thead>
                        <tbody>${leaderboard.map(([name, row], i) => `
                            <tr><td class="rank">${i + 1}</td><td>${Util.esc(name)}</td><td class="num strong">${row.points}</td><td class="num muted">${row.done}</td></tr>`).join('')}
                        </tbody></table>`
                        : '<p class="muted">No completed challenges yet. Be the first!</p>'}
                </section>
                ${myClaims.length ? `<section class="panel">
                    <div class="panel-head"><h2>📜 My Claims</h2></div>
                    ${myClaims.slice(0, 8).map(cl => {
                        const ch = challenges.find(c => c.id === cl.challengeId);
                        return `<div class="race-row">
                            <div class="race-row-main">
                                <span class="race-title">${Util.esc(ch?.title || 'Challenge')}</span>
                                ${cl.note ? `<span class="race-sub">${Util.esc(cl.note)}</span>` : ''}
                            </div>
                            <span class="badge ${cl.status === 'approved' ? 'badge-green' : cl.status === 'rejected' ? 'badge-red' : 'badge-amber'}">${cl.status}</span>
                        </div>`;
                    }).join('')}
                </section>` : ''}
            </div>
        </div>`;

        Util.$$('.tab', el).forEach(btn => btn.addEventListener('click', () => {
            this._tab = btn.dataset.tab;
            this.render(el);
        }));
    },

    async claim(challengeId) {
        Modal.open(`
            ${Modal.header('Claim Completion', 'Tell the Game Master how you did it')}
            <form id="claim-form" class="form-grid">
                <label class="field"><span>Proof / notes (optional)</span>
                    <textarea id="claim-note" class="input" rows="3" maxlength="400" placeholder="e.g. Won at Silverstone on 6/28, screenshot in Discord"></textarea></label>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Submit Claim</button>
                </div>
            </form>
        `);
        Util.$('#claim-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                await DB.create('challengeClaims', {
                    challengeId,
                    uid: Auth.uid(),
                    playerName: Auth.state.profile?.displayName || 'Player',
                    note: Util.$('#claim-note').value.trim(),
                    status: 'pending'
                });
                Modal.close();
                Util.notify('Claim submitted — the Game Master will review it. 🎯');
                App.go('challenges');
            } catch (err) { Util.notify(err.message, 'error'); }
        });
    }
};
window.Challenges = Challenges;
Views.challenges = (el) => Challenges.render(el);
