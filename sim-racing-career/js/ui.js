// UI Management and Interactions
// Database is a global var declared in database.js (loaded before this file)
// Alias: window.Database is set by database.js; bare 'Database' works because var is global-scoped
if (typeof Database === 'undefined' && typeof window.Database !== 'undefined') {
    var Database = window.Database;
}

var UI = {
    // Track current view
    currentView: 'dashboard',
    currentMonth: new Date(),
    currentRaceDetailsId: null,

    // Safe Database accessor — always pulls from global scope
    get db() {
        return typeof Database !== 'undefined' ? Database : window.Database;
    },

    isAdmin() {
        return Boolean(window.AuthService?.isAdmin?.());
    },

    isAuthenticatedUser() {
        return Boolean(window.AuthService?.isAuthenticated?.());
    },

    canEditTeam(team) {
        if (this.isAdmin()) return true;
        try {
            const profile = JSON.parse(localStorage.getItem('srmpcUserProfile') || '{}');
            return Boolean(profile.primaryTeam && profile.primaryTeam === team?.id);
        } catch {
            return false;
        }
    },

    canEditDriver(driver) {
        return this.isAdmin() || (window.AppSession?.claimedDriverId === driver?.id);
    },

    normalizeDate(value) {
        if (!value) return new Date(0);
        if (value?.toDate && typeof value.toDate === 'function') {
            return value.toDate();
        }
        return new Date(value);
    },

    formatCurrency(value) {
        return `$${Number(value || 0).toLocaleString()}`;
    },

    showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) {
            this.showNotification(`Modal not found: ${modalId}`, 'error');
            return;
        }

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    },

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        modal.classList.remove('active');
        document.body.style.overflow = 'auto';
    },

    applyRoleExperience({ isAuthenticated = false, isAdmin = false, isMember = false, activeRole = null } = {}) {
        const dashboardHeading = document.querySelector('#dashboard-view .card-featured h2');
        const dashboardCopy = document.querySelector('#dashboard-view .card-featured p');
        const quickAddDriverButton = document.getElementById('quick-add-driver');
        const addDriverButton = document.getElementById('add-driver-btn');
        const addTeamButton = document.getElementById('add-team-btn');
        const addRaceButton = document.getElementById('add-race-btn');
        const sponsorsNavButton = document.getElementById('sponsors-nav-btn');
        const driverHubNavButton = document.getElementById('driver-hub-nav-btn');
        const adminNavButton = document.getElementById('admin-nav-btn');

        if (dashboardHeading) {
            dashboardHeading.textContent = isAdmin
                ? 'Racing Manager Command Center'
                : (isMember ? 'Motorsport Manager HQ' : 'Career Dashboard');
        }

        if (dashboardCopy) {
            dashboardCopy.textContent = isAdmin
                ? 'Run the league from one screen. Build the roster, launch race weekends, manage sponsors, and keep every public view updated in real time.'
                : (isMember
                    ? 'Manage your role operations, review season data, and jump into your workspace from HQ.'
                    : 'Track your roster, schedule, and standings from your user dashboard.');
        }

        if (quickAddDriverButton) {
            quickAddDriverButton.textContent = isAdmin ? '+ Add Driver' : (isMember ? 'Open My Workspace' : 'Open Dashboard');
        }

        if (addDriverButton) {
            addDriverButton.textContent = isAdmin ? '+ New Driver' : (isMember ? '+ Add Role Driver' : '+ Request Driver Profile');
        }

        if (addTeamButton) {
            addTeamButton.textContent = isAdmin ? '+ Create Team' : (isMember ? '+ Build Team' : '+ Request Team');
        }

        if (addRaceButton) {
            addRaceButton.textContent = isAdmin ? '+ Schedule Race' : 'View Race Rules';
        }

        if (sponsorsNavButton) {
            sponsorsNavButton.textContent = isAdmin ? 'Sponsors' : (isMember ? 'Workspace' : 'Overview');
        }

        if (driverHubNavButton) {
            driverHubNavButton.textContent = isMember ? 'Workspace' : 'Driver Hub';
        }

        if (adminNavButton) {
            adminNavButton.textContent = 'Racing Manager';
        }

        document.body.dataset.role = !isAuthenticated ? 'guest' : (isAdmin ? 'admin' : (isMember ? `member member-${activeRole || 'none'}` : 'driver'));
    },

    async getVisibleDrivers() {
        const drivers = await Database.drivers.getAll();
        if (this.isAdmin()) return drivers;
        return drivers.filter((driver) => (driver.status || 'approved') === 'approved');
    },

    async getVisibleTeams() {
        const teams = await Database.teams.getAll();
        if (this.isAdmin()) return teams;
        return teams.filter((team) => (team.status || 'approved') === 'approved');
    },

    // ===== VIEW MANAGEMENT =====
    switchView(viewName) {
        if (viewName === 'member-workspace' && !window.AppSession?.isMember) {
            viewName = window.AuthService?.isAuthenticated?.() ? 'dashboard' : 'dashboard';
        }

        if (viewName === 'admin' && !this.isAdmin()) {
            this.showNotification('Administrator access required for this workspace.', 'error');
            viewName = window.AppSession?.isMember ? 'member-workspace' : 'dashboard';
        }

        if (viewName === 'driver-hub' && (!this.isAuthenticatedUser() || this.isAdmin())) {
            this.showNotification('Driver Hub is only available to signed-in drivers.', 'error');
            viewName = this.isAdmin() ? 'dashboard' : 'calendar';
        }

        if (viewName === 'sponsors' && !this.isAdmin()) {
            this.showNotification('Sponsors are managed from the admin workspace.', 'error');
            viewName = window.AppSession?.isMember ? 'member-workspace' : 'dashboard';
        }

        // Hide all views
        document.querySelectorAll('.view').forEach(view => {
            view.classList.remove('active');
        });

        // Show selected view
        const viewElement = document.getElementById(`${viewName}-view`);
        if (viewElement) {
            viewElement.classList.add('active');
        }

        // Update nav buttons
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.view === viewName) {
                btn.classList.add('active');
            }
        });

        this.currentView = viewName;

        // Refresh view data
        this.refreshView(viewName);
    },

    refreshView(viewName) {
        switch (viewName) {
            case 'dashboard':
                this.loadDashboard();
                break;
            case 'drivers':
                this.loadDrivers();
                break;
            case 'calendar':
                this.loadCalendar();
                break;
            case 'teams':
                this.loadTeams();
                break;
            case 'standings':
                this.loadStandings();
                break;
            case 'sponsors':
                this.loadSponsors();
                break;
            case 'member-workspace':
                this.loadMemberWorkspace();
                break;
            case 'driver-hub':
                this.loadDriverHub();
                break;
            case 'admin':
                this.loadAdminPanel();
                break;
            default:
                this.loadDashboard();
                break;
        }
    },

            // ===== SPONSORS =====
            focusSponsorshipForm() {
                const form = document.getElementById('sponsorship-create-form');
                if (form) {
                    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }

                const companyInput = document.getElementById('sponsor-company');
                companyInput?.focus();
            },

            async loadSponsors() {
                try {
                    const [drivers, teams, contracts] = await Promise.all([
                        this.getVisibleDrivers(),
                        this.getVisibleTeams(),
                        Database.sponsorships.getAll()
                    ]);

                    const sponsorsGrid = document.getElementById('sponsors-grid');
                    const statusFilter = document.getElementById('sponsor-status-filter')?.value || 'all';
                    const driverSelect = document.getElementById('sponsor-driver-id');
                    const teamSelect = document.getElementById('sponsor-team-id');
                    const createForm = document.getElementById('sponsorship-create-form');

                    const selectedDriver = driverSelect?.value || '';
                    const selectedTeam = teamSelect?.value || '';

                    if (driverSelect) {
                        driverSelect.innerHTML = '<option value="">Select driver</option>';
                        drivers
                            .sort((a, b) => String(a.name).localeCompare(String(b.name)))
                            .forEach((driver) => {
                                const option = document.createElement('option');
                                option.value = driver.id;
                                option.textContent = driver.name;
                                driverSelect.appendChild(option);
                            });
                        if (selectedDriver && Array.from(driverSelect.options).some((opt) => opt.value === selectedDriver)) {
                            driverSelect.value = selectedDriver;
                        }
                    }

                    if (teamSelect) {
                        teamSelect.innerHTML = '<option value="">No team</option>';
                        teams
                            .sort((a, b) => String(a.name).localeCompare(String(b.name)))
                            .forEach((team) => {
                                const option = document.createElement('option');
                                option.value = team.id;
                                option.textContent = team.name;
                                teamSelect.appendChild(option);
                            });
                        if (selectedTeam && Array.from(teamSelect.options).some((opt) => opt.value === selectedTeam)) {
                            teamSelect.value = selectedTeam;
                        }
                    }

                    if (createForm) {
                        createForm.querySelectorAll('input, select, textarea, button').forEach((el) => {
                            el.disabled = !this.isAdmin();
                        });
                    }

                    if (!sponsorsGrid) return;

                    const driversById = new Map(drivers.map((driver) => [driver.id, driver]));
                    const teamsById = new Map(teams.map((team) => [team.id, team]));

                    const filtered = contracts.filter((contract) => statusFilter === 'all' || (contract.status || 'active') === statusFilter);

                    if (!filtered.length) {
                        sponsorsGrid.innerHTML = '<p class="empty-state">No sponsorship contracts for this filter.</p>';
                        return;
                    }

                    sponsorsGrid.innerHTML = filtered.map((contract) => {
                        const driver = driversById.get(contract.driverId);
                        const team = contract.teamId ? teamsById.get(contract.teamId) : null;
                        const status = contract.status || 'active';
                        const model = contract.payoutModel || {};
                        return `
                            <div class="moderation-item">
                                <div class="moderation-item-header">
                                    <div>
                                        <p class="moderation-title">${contract.companyName}</p>
                                        <p class="moderation-meta">Driver: ${driver?.name || contract.driverId}</p>
                                        <p class="moderation-meta">Team: ${team?.name || 'Independent'}</p>
                                        <p class="moderation-meta">Base: ${this.formatCurrency(model.basePerRace || 0)} • Win: ${this.formatCurrency(model.winBonus || 0)} • Podium: ${this.formatCurrency(model.podiumBonus || 0)} • DNF Penalty: ${this.formatCurrency(model.dnfPenalty || 0)}</p>
                                        <p class="moderation-meta">${contract.startDate ? this.normalizeDate(contract.startDate).toLocaleDateString() : 'Now'} - ${contract.endDate ? this.normalizeDate(contract.endDate).toLocaleDateString() : 'Open-ended'}</p>
                                    </div>
                                    <span class="status-pill status-${status === 'active' ? 'approved' : status === 'pending' || status === 'paused' ? 'pending' : 'rejected'}">${status}</span>
                                </div>
                                ${contract.terms ? `<p class="moderation-meta" style="margin-bottom: 0.75rem;">${contract.terms}</p>` : ''}
                                ${this.isAdmin() ? `
                                    <div class="card-actions" style="padding: 0; border: none;">
                                        <button type="button" onclick="UI.setSponsorshipStatus('${contract.id}', 'active')">Activate</button>
                                        <button type="button" onclick="UI.setSponsorshipStatus('${contract.id}', 'paused')">Pause</button>
                                        <button type="button" onclick="UI.setSponsorshipStatus('${contract.id}', 'terminated')">Terminate</button>
                                    </div>
                                ` : ''}
                            </div>
                        `;
                    }).join('');
                } catch (error) {
                    console.error('Error loading sponsors:', error);
                    this.showNotification('Error loading sponsorships: ' + error.message, 'error');
                }
            },

            async saveSponsorshipContractFromForm() {
                if (!this.isAdmin()) {
                    this.showNotification('Only admins can create sponsorship contracts.', 'error');
                    return;
                }

                const companyName = document.getElementById('sponsor-company')?.value?.trim();
                const driverId = document.getElementById('sponsor-driver-id')?.value || '';
                const teamId = document.getElementById('sponsor-team-id')?.value || '';
                const status = document.getElementById('sponsor-status')?.value || 'active';
                const basePerRace = Number(document.getElementById('sponsor-base-per-race')?.value || 0);
                const winBonus = Number(document.getElementById('sponsor-win-bonus')?.value || 0);
                const podiumBonus = Number(document.getElementById('sponsor-podium-bonus')?.value || 0);
                const dnfPenalty = Number(document.getElementById('sponsor-dnf-penalty')?.value || 0);
                const startDate = document.getElementById('sponsor-start-date')?.value || '';
                const endDate = document.getElementById('sponsor-end-date')?.value || '';
                const terms = document.getElementById('sponsor-terms')?.value?.trim() || '';

                if (!companyName || !driverId) {
                    this.showNotification('Company and driver are required for sponsorship contracts.', 'error');
                    return;
                }

                if (basePerRace < 0 || winBonus < 0 || podiumBonus < 0 || dnfPenalty < 0) {
                    this.showNotification('Payout values must be non-negative.', 'error');
                    return;
                }

                try {
                    await Database.sponsorships.createContract({
                        companyName,
                        driverId,
                        teamId: teamId || null,
                        status,
                        basePerRace,
                        winBonus,
                        podiumBonus,
                        dnfPenalty,
                        startDate: startDate || null,
                        endDate: endDate || null,
                        terms
                    });

                    this.showNotification('Sponsorship contract created.');
                    document.getElementById('sponsorship-create-form')?.reset();
                    const statusSelect = document.getElementById('sponsor-status');
                    if (statusSelect) statusSelect.value = 'active';

                    await Promise.allSettled([
                        this.loadSponsors(),
                        this.loadDriverHub()
                    ]);
                } catch (error) {
                    console.error('Error creating sponsorship contract:', error);
                    this.showNotification('Could not create sponsorship contract: ' + error.message, 'error');
                }
            },

            async setSponsorshipStatus(contractId, status) {
                if (!this.isAdmin()) {
                    this.showNotification('Only admins can update sponsorship status.', 'error');
                    return;
                }

                try {
                    await Database.sponsorships.updateContract(contractId, { status });
                    this.showNotification('Sponsorship status updated.');
                    await Promise.allSettled([
                        this.loadSponsors(),
                        this.loadDriverHub()
                    ]);
                } catch (error) {
                    console.error('Error updating sponsorship status:', error);
                    this.showNotification('Could not update sponsorship status: ' + error.message, 'error');
                }
            },

            async saveAdminPayoutFromForm() {
                if (!this.isAdmin()) {
                    this.showNotification('Only admins can apply payout adjustments.', 'error');
                    return;
                }

                const userId = document.getElementById('admin-payout-user-id')?.value?.trim() || '';
                const driverId = document.getElementById('admin-payout-driver-id')?.value?.trim() || '';
                const amount = Number(document.getElementById('admin-payout-amount')?.value || 0);
                const note = document.getElementById('admin-payout-note')?.value?.trim() || '';

                if (!userId || !note) {
                    this.showNotification('Target user and reason are required.', 'error');
                    return;
                }

                if (!Number.isFinite(amount) || amount === 0) {
                    this.showNotification('Amount must be a non-zero number.', 'error');
                    return;
                }

                try {
                    await Database.economy.addManualAdjustment({
                        actorUid: window.AuthService?.getCurrentUser?.()?.uid || null,
                        userId,
                        amount,
                        note,
                        driverId: driverId || null
                    });

                    this.showNotification('Manual payout adjustment applied.');
                    document.getElementById('admin-payout-form')?.reset();

                    await Promise.allSettled([
                        this.loadAdminPayoutActivity(),
                        this.loadDriverHub()
                    ]);
                } catch (error) {
                    console.error('Error applying payout adjustment:', error);
                    this.showNotification('Could not apply payout adjustment: ' + error.message, 'error');
                }
            },

            async loadAdminPayoutActivity() {
                if (!this.isAdmin()) return;

                const list = document.getElementById('admin-payout-audit-list');
                if (!list) return;

                const [audits, drivers] = await Promise.all([
                    Database.payoutAudits.getAll(),
                    Database.drivers.getAll()
                ]);

                const driversById = new Map(drivers.map((driver) => [driver.id, driver]));

                if (!audits.length) {
                    list.innerHTML = '<p class="empty-state">No payout adjustments recorded.</p>';
                    return;
                }

                list.innerHTML = audits.slice(0, 20).map((audit) => {
                    const amount = Number(audit.amount || 0);
                    const isPenalty = amount < 0;
                    const driver = audit.driverId ? driversById.get(audit.driverId) : null;
                    return `
                        <div class="moderation-item">
                            <div class="moderation-item-header">
                                <div>
                                    <p class="moderation-title">${isPenalty ? 'Penalty' : 'Bonus'} ${this.formatCurrency(amount)}</p>
                                    <p class="moderation-meta">Target UID: ${audit.userId}</p>
                                    <p class="moderation-meta">Driver: ${driver?.name || audit.driverId || 'N/A'}</p>
                                    <p class="moderation-meta">Admin UID: ${audit.actorUid || 'Unknown'} • ${this.normalizeDate(audit.createdAt).toLocaleString()}</p>
                                </div>
                                <span class="status-pill ${isPenalty ? 'status-rejected' : 'status-approved'}">${audit.adjustmentType || (isPenalty ? 'manual-penalty' : 'manual-bonus')}</span>
                            </div>
                            <p class="moderation-meta">Reason: ${audit.reason || 'No reason provided'}</p>
                        </div>
                    `;
                }).join('');
            },

            async loadTeams() {
                const grid = document.getElementById('teams-grid');
                if (!grid) return;
                try {
                    const teams = await Database.teams.getAll();
                    if (!teams.length) {
                        grid.innerHTML = '<div class="empty-state">No teams yet. Create your first team!</div>';
                        return;
                    }
                    grid.innerHTML = '';
                    teams.forEach(team => {
                        const card = this.createTeamCard(team);
                        grid.appendChild(card);
                    });
                } catch (error) {
                    console.error('Error loading teams:', error);
                    grid.innerHTML = '<div class="empty-state">Failed to load teams.</div>';
                }
            },

    createTeamCard(team) {
        const card = document.createElement('div');
        card.className = 'team-card';
        card.innerHTML = `
            <div class="team-header" style="background-color: ${team.color}20; border-left: 4px solid ${team.color}">
                <div class="team-badge" style="background-color: ${team.color}">T</div>
                <div class="team-name">${team.name}</div>
                ${team.status ? `<span class="status-pill status-${team.status}">${team.status}</span>` : ''}
            </div>
            <div class="team-info">
                ${team.description ? `<p>${team.description}</p>` : ''}
                <div class="stat-row">
                    <span class="stat-label">Drivers</span>
                    <span class="stat-value">${team.stats?.drivers || 0}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Total Wins</span>
                    <span class="stat-value">${team.stats?.totalWins || 0}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Total Points</span>
                    <span class="stat-value">${team.stats?.totalPoints || 0}</span>
                </div>
            </div>
            <div class="card-actions">
                <button onclick="UI.viewTeam('${team.id}')">View</button>
                ${this.canEditTeam(team) ? `<button onclick="UI.editTeam('${team.id}')">Edit</button>` : ''}
                ${this.isAdmin() ? `<button onclick="UI.deleteTeam('${team.id}')">Delete</button>` : ''}
                ${this.isAdmin() && team.status === 'pending' ? `<button onclick="UI.approveTeam('${team.id}')">Approve</button>` : ''}
                ${this.isAdmin() && team.status === 'pending' ? `<button onclick="UI.rejectTeam('${team.id}')">Reject</button>` : ''}
            </div>
        `;
        return card;
    },

    async loadDrivers() {
        try {
            const [drivers, teams] = await Promise.all([
                this.getVisibleDrivers(),
                Database.teams.getAll()
            ]);
            const teamsById = new Map(teams.map(t => [t.id, t]));
            const driversGrid = document.getElementById('drivers-grid');
            if (!driversGrid) return;
            if (!drivers.length) {
                driversGrid.innerHTML = '<div class="empty-state">No drivers yet. Add a driver to get started.</div>';
                return;
            }
            driversGrid.innerHTML = '';
            [...drivers]
                .sort((a, b) => String(a.name).localeCompare(String(b.name)))
                .forEach(driver => driversGrid.appendChild(this.createDriverCard(driver, teamsById)));
        } catch (error) {
            console.error('Error loading drivers:', error);
        }
    },

    createDriverCard(driver, teamsById = null) {
        const card = document.createElement('div');
        card.className = 'driver-card';
        const teamName = teamsById && driver.teamId ? (teamsById.get(driver.teamId)?.name || '') : '';
        const isOwnDriver = window.AppSession?.claimedDriverId === driver.id;
        card.innerHTML = `
            <div class="driver-header">
                <div class="driver-number">#${driver.number || '??'}</div>
                <div class="driver-name">${driver.name}</div>
                ${teamName ? `<div class="driver-team">${teamName}</div>` : ''}
                ${(driver.status && driver.status !== 'approved') ? `<span class="status-pill status-${driver.status}">${driver.status}</span>` : (isOwnDriver ? '<span class="status-pill status-approved">You</span>' : '')}
            </div>
            <div class="driver-stats">
                ${driver.country ? `<div class="stat-row"><span class="stat-label">Country</span><span class="stat-value">${driver.country}</span></div>` : ''}
                <div class="stat-row"><span class="stat-label">Points</span><span class="stat-value">${driver.stats?.totalPoints || 0}</span></div>
                <div class="stat-row"><span class="stat-label">Wins</span><span class="stat-value">${driver.stats?.totalWins || 0}</span></div>
                <div class="stat-row"><span class="stat-label">Podiums</span><span class="stat-value">${driver.stats?.totalPodiums || 0}</span></div>
            </div>
            <div class="card-actions">
                ${this.canEditDriver(driver) ? `<button type="button" onclick="UI.editDriverModal('${driver.id}')">Edit</button>` : ''}
                ${this.isAdmin() ? `<button type="button" onclick="UI.deleteDriver('${driver.id}')">Delete</button>` : ''}
                ${this.isAdmin() && driver.status === 'pending' ? `<button type="button" onclick="UI.approveDriver('${driver.id}')">Approve</button>` : ''}
                ${this.isAdmin() && driver.status === 'pending' ? `<button type="button" onclick="UI.rejectDriver('${driver.id}')">Reject</button>` : ''}
            </div>
        `;
        return card;
    },

    async editDriverModal(driverId) {
        try {
            const driver = await Database.drivers.getById(driverId);
            if (!driver) { this.showNotification('Driver not found', 'error'); return; }
            if (!this.canEditDriver(driver)) {
                this.showNotification('You can only edit your own driver profile.', 'error');
                return;
            }
            window.currentEditingDriverId = driverId;
            document.getElementById('edit-driver-name').value = driver.name || '';
            document.getElementById('edit-driver-number').value = driver.number || '';
            document.getElementById('edit-driver-country').value = driver.country || '';
            document.getElementById('edit-driver-description').value = driver.bio || '';

            const teamSelect = document.getElementById('edit-driver-team');
            const numberInput = document.getElementById('edit-driver-number');
            if (this.isAdmin()) {
                if (teamSelect) {
                    const teams = await Database.teams.getAll();
                    teamSelect.innerHTML = '<option value="">No Team</option>';
                    teams.forEach(team => {
                        const opt = document.createElement('option');
                        opt.value = team.id;
                        opt.textContent = team.name;
                        teamSelect.appendChild(opt);
                    });
                    teamSelect.value = driver.teamId || '';
                    teamSelect.disabled = false;
                }
                if (numberInput) numberInput.disabled = false;
            } else {
                // Drivers can only edit name, country, bio — not team or number
                if (teamSelect) {
                    teamSelect.innerHTML = '';
                    const opt = document.createElement('option');
                    if (driver.teamId) {
                        const allTeams = await Database.teams.getAll();
                        const team = allTeams.find(t => t.id === driver.teamId);
                        opt.value = driver.teamId;
                        opt.textContent = team?.name || 'Your Team';
                    } else {
                        opt.value = '';
                        opt.textContent = 'No Team';
                    }
                    teamSelect.appendChild(opt);
                    teamSelect.disabled = true;
                }
                if (numberInput) numberInput.disabled = true;
            }

            this.showModal('edit-driver-modal');
        } catch (error) {
            console.error('Error opening edit driver modal:', error);
            this.showNotification('Error loading driver for edit.', 'error');
        }
    },

    async deleteDriver(driverId) {
        if (!this.isAdmin()) {
            this.showNotification('Only the Game Master can delete drivers.', 'error');
            return;
        }
        if (!confirm('Delete this driver? This cannot be undone.')) return;
        try {
            await Database.drivers.delete(driverId);
            this.showNotification('Driver deleted.');
            await Promise.allSettled([this.loadDrivers(), this.loadDashboard()]);
        } catch (error) {
            console.error('Error deleting driver:', error);
            this.showNotification('Could not delete driver: ' + error.message, 'error');
        }
    },

    async editTeam(teamId) {
        try {
            const team = await Database.teams.getById(teamId);
            if (!team) {
                this.showNotification('Team not found', 'error');
                return;
            }

            if (!this.canEditTeam(team)) {
                this.showNotification('You can only edit your own team.', 'error');
                return;
            }

            // Store current team ID for save handler
            window.currentEditingTeamId = teamId;

            // Populate form
            document.getElementById('edit-team-name').value = team.name;
            document.getElementById('edit-team-color').value = team.color || '#FF4444';
            document.getElementById('edit-team-description').value = team.description || '';

            this.showModal('edit-team-modal');
        } catch (error) {
            console.error('Error loading team for edit:', error);
            this.showNotification('Error loading team', 'error');
        }
    },

    async deleteTeam(teamId) {
        if (!this.isAdmin()) {
            this.showNotification('Only admins can delete teams.', 'error');
            return;
        }

        if (confirm('Are you sure you want to delete this team?')) {
            try {
                // Keep data consistent by unassigning drivers before deleting the team.
                const drivers = await Database.drivers.getByTeam(teamId);
                if (drivers.length > 0) {
                    await Promise.all(drivers.map((driver) =>
                        Database.drivers.update(driver.id, { teamId: null })
                    ));
                }

                await Database.teams.delete(teamId);

                await Promise.allSettled([
                    this.loadTeams(),
                    this.loadDrivers(),
                    this.loadDashboard()
                ]);

                if (typeof window.loadDriverTeamOptions === 'function') {
                    await window.loadDriverTeamOptions();
                }

                this.showNotification('Team deleted successfully');
            } catch (error) {
                console.error('Error deleting team:', error);
                this.showNotification('Error deleting team: ' + (error.message || 'Unknown error'), 'error');
            }
        }
    },

    async approveDriver(driverId) {
        if (!this.isAdmin()) {
            this.showNotification('Only admins can approve drivers.', 'error');
            return;
        }

        try {
            await Database.drivers.approve(driverId, window.AuthService?.getCurrentUser?.()?.uid || null);
            this.showNotification('Driver approved successfully.');
            await Promise.allSettled([this.loadDrivers(), this.loadDashboard()]);
        } catch (error) {
            console.error('Error approving driver:', error);
            this.showNotification('Error approving driver: ' + error.message, 'error');
        }
    },

    async rejectDriver(driverId) {
        if (!this.isAdmin()) {
            this.showNotification('Only admins can reject drivers.', 'error');
            return;
        }

        const moderationNotes = window.prompt('Optional rejection note:') || '';

        try {
            await Database.drivers.reject(driverId, window.AuthService?.getCurrentUser?.()?.uid || null, moderationNotes);
            this.showNotification('Driver rejected.');
            await Promise.allSettled([this.loadDrivers(), this.loadDashboard()]);
        } catch (error) {
            console.error('Error rejecting driver:', error);
            this.showNotification('Error rejecting driver: ' + error.message, 'error');
        }
    },

    async approveTeam(teamId) {
        if (!this.isAdmin()) {
            this.showNotification('Only admins can approve teams.', 'error');
            return;
        }

        try {
            await Database.teams.approve(teamId, window.AuthService?.getCurrentUser?.()?.uid || null);
            this.showNotification('Team approved successfully.');
            await Promise.allSettled([this.loadTeams(), this.loadDrivers(), this.loadDashboard()]);
        } catch (error) {
            console.error('Error approving team:', error);
            this.showNotification('Error approving team: ' + error.message, 'error');
        }
    },

    async rejectTeam(teamId) {
        if (!this.isAdmin()) {
            this.showNotification('Only admins can reject teams.', 'error');
            return;
        }

        const moderationNotes = window.prompt('Optional rejection note:') || '';

        try {
            await Database.teams.reject(teamId, window.AuthService?.getCurrentUser?.()?.uid || null, moderationNotes);
            this.showNotification('Team rejected.');
            await Promise.allSettled([this.loadTeams(), this.loadDrivers(), this.loadDashboard()]);
        } catch (error) {
            console.error('Error rejecting team:', error);
            this.showNotification('Error rejecting team: ' + error.message, 'error');
        }
    },

    async viewTeam(teamId) {
        try {
            const team = await Database.teams.getById(teamId);
            if (!team) {
                this.showNotification('Team not found', 'error');
                return;
            }

            // Get drivers for this team
            const drivers = await Database.drivers.getByTeam(teamId);
            const driversList = drivers.length > 0
                ? drivers.map(d => `<li>${d.name} ${d.number ? '#' + d.number : ''}</li>`).join('')
                : '<li style="color: var(--text-secondary);">No drivers yet</li>';

            // Build HTML content
            const content = `
                <div style="padding: 1rem;">
                    <div class="stat-row" style="margin-bottom: 1rem; border: none;">
                        <span class="stat-label">Team</span>
                        <span class="stat-value" style="font-size: 1.5rem; color: ${team.color};">${team.name}</span>
                    </div>
                    ${team.description ? `
                    <div class="stat-row">
                        <span class="stat-label">Description</span>
                        <span class="stat-value" style="max-width: 300px;">${team.description}</span>
                    </div>
                    ` : ''}
                    <div class="stat-row">
                        <span class="stat-label">Active Drivers</span>
                        <span class="stat-value">${team.stats?.drivers || drivers.length || 0}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Total Wins</span>
                        <span class="stat-value">${team.stats?.totalWins || 0}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Total Podiums</span>
                        <span class="stat-value">${team.stats?.totalPodiums || 0}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Total Points</span>
                        <span class="stat-value">${team.stats?.totalPoints || 0}</span>
                    </div>
                    ${drivers.length > 0 ? `
                    <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border-color);">
                        <p style="color: var(--text-secondary); margin-bottom: 0.5rem;">Drivers</p>
                        <ul style="list-style: none; padding: 0;">
                            ${driversList}
                        </ul>
                    </div>
                    ` : ''}
                </div>
            `;

            document.getElementById('view-team-title').textContent = `${team.name} - Team Details`;
            document.getElementById('view-team-content').innerHTML = content;
            this.showModal('view-team-modal');
        } catch (error) {
            console.error('Error viewing team:', error);
            this.showNotification('Error loading team details', 'error');
        }
    },

    // ===== CALENDAR =====
    async loadCalendar() {
        try {
            const races = await Database.races.getAll();
            this.renderCalendar(races);
            this.renderRacesList(races);
        } catch (error) {
            console.error('Error loading calendar:', error);
            this.showNotification('Unable to load calendar races.', 'error');
        }
    },

    renderCalendar(races = []) {
        const year = this.currentMonth.getFullYear();
        const month = this.currentMonth.getMonth();

        // Update month display
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
        document.getElementById('current-month').textContent = `${monthNames[month]} ${year}`;

        // Get calendar data
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const prevLastDay = new Date(year, month, 0).getDate();
        const nextDays = 7 - lastDay.getDay();

        const calendar = document.getElementById('calendar');
        calendar.innerHTML = '';

        // Day headers
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        dayNames.forEach(day => {
            const header = document.createElement('div');
            header.className = 'calendar-header';
            header.textContent = day;
            calendar.appendChild(header);
        });

        // Previous month days
        for (let i = prevLastDay - firstDay.getDay() + 1; i <= prevLastDay; i++) {
            const day = document.createElement('div');
            day.className = 'calendar-day other-month';
            day.textContent = i;
            calendar.appendChild(day);
        }

        // Current month days
        const today = new Date();
        const raceDays = new Set(
            races
                .map((race) => this.normalizeDate(race.date))
                .filter((date) => date.getFullYear() === year && date.getMonth() === month)
                .map((date) => date.getDate())
        );

        for (let i = 1; i <= lastDay.getDate(); i++) {
            const day = document.createElement('div');
            day.className = 'calendar-day';
            day.textContent = i;

            if (year === today.getFullYear() && month === today.getMonth() && i === today.getDate()) {
                day.classList.add('today');
            }

            if (raceDays.has(i)) {
                day.classList.add('has-race');
                day.title = 'Race scheduled';
            }

            calendar.appendChild(day);
        }

        // Next month days
        for (let i = 1; i <= nextDays; i++) {
            const day = document.createElement('div');
            day.className = 'calendar-day other-month';
            day.textContent = i;
            calendar.appendChild(day);
        }
    },

    renderRacesList(races) {
        const racesList = document.getElementById('races-list');
        racesList.innerHTML = '';

        if (races.length === 0) {
            racesList.innerHTML = '<p class="empty-state">No races scheduled</p>';
            return;
        }

        // Sort races by date
        races.sort((a, b) => this.normalizeDate(a.date) - this.normalizeDate(b.date));

        races.forEach(race => {
            const raceEl = document.createElement('div');
            raceEl.className = 'race-item';
            raceEl.innerHTML = `
                <div class="race-title">${race.name}</div>
                <div class="race-details">
                    <div class="race-detail">
                        <span class="race-detail-label">📅</span>
                        <span class="race-detail-value">${this.normalizeDate(race.date).toLocaleDateString()}</span>
                    </div>
                    <div class="race-detail">
                        <span class="race-detail-label">⏰</span>
                        <span class="race-detail-value">${this.normalizeDate(race.date).toLocaleTimeString()}</span>
                    </div>
                    <div class="race-detail">
                        <span class="race-detail-label">🎮</span>
                        <span class="race-detail-value">${race.game}</span>
                    </div>
                    ${race.track ? `
                    <div class="race-detail">
                        <span class="race-detail-label">🏁</span>
                        <span class="race-detail-value">${race.track}</span>
                    </div>
                    ` : ''}
                </div>
                <div class="form-actions" style="margin-top: 0.7rem; justify-content: flex-start;">
                    <button type="button" class="btn btn-secondary" onclick="UI.openRaceDetails('${race.id}')">View Details</button>
                </div>
            `;
            racesList.appendChild(raceEl);
        });
    },

    async openRaceDetails(raceId) {
        try {
            const race = await Database.races.getById(raceId);
            if (!race) {
                this.showNotification('Race not found.', 'error');
                return;
            }

            this.currentRaceDetailsId = raceId;

            const [signups, drivers, cars] = await Promise.all([
                Database.raceSignups.getByRace(raceId),
                Database.drivers.getAll(),
                Database.cars.getAll()
            ]);

            const existingResultByDriver = new Map((race.results || []).map((result) => [result.driverId, result]));

            const carMap = new Map(cars.map((car) => [car.id, car]));
            const driverMap = new Map(drivers.map((driver) => [driver.id, driver]));
            const signupListMarkup = signups.length > 0
                ? signups.map((signup) => {
                    const driver = driverMap.get(signup.driverId);
                    const car = signup.selectedCarId ? carMap.get(signup.selectedCarId) : null;
                    return `<li>${driver?.name || 'Unknown Driver'}${car ? ` - ${car.name}` : ''}</li>`;
                }).join('')
                : '<li>No drivers signed up yet</li>';

            const existingResultsMarkup = (race.results || []).length > 0
                ? race.results
                    .sort((a, b) => Number(a.finishPosition || 999) - Number(b.finishPosition || 999))
                    .map((result) => {
                        const driver = driverMap.get(result.driverId);
                        return `<li>#${result.finishPosition} - ${driver?.name || 'Unknown Driver'}${result.dnf ? ' (DNF)' : ''} - ${result.pointsAwarded || 0} pts</li>`;
                    })
                    .join('')
                : '<li>No results submitted yet</li>';

            const isAdmin = this.isAdmin();
            const canEditResults = isAdmin && (race.status === 'scheduled' || race.status === 'completed') && signups.length > 0;
            const resultsFormMarkup = canEditResults
                ? `
                <div class="form-group" style="margin-top: 1rem;">
                    <label>Submit Results</label>
                    ${signups.map((signup) => {
                        const driver = driverMap.get(signup.driverId);
                        const existing = existingResultByDriver.get(signup.driverId);
                        return `
                            <div class="stat-row" style="align-items: center; gap: 0.5rem;">
                                <span class="stat-label" style="min-width: 140px;">${driver?.name || 'Unknown Driver'}</span>
                                <input type="number" min="1" step="1" id="result-pos-${signup.driverId}" placeholder="Finish position" value="${existing?.finishPosition || ''}" style="max-width: 150px;">
                                <label style="display: inline-flex; align-items: center; gap: 0.3rem; margin: 0;">
                                    <input type="checkbox" id="result-dnf-${signup.driverId}" ${existing?.dnf ? 'checked' : ''}>
                                    DNF
                                </label>
                            </div>
                        `;
                    }).join('')}
                </div>
                `
                : '';

            const raceDate = this.normalizeDate(race.date);
            const detailsContent = `
                <div class="form-group">
                    <label>Race Name</label>
                    <p>${race.name}</p>
                </div>
                <div class="form-group">
                    <label>Date</label>
                    <p>${raceDate.toLocaleString()}</p>
                </div>
                <div class="form-group">
                    <label>Simulation</label>
                    <p>${race.game}</p>
                </div>
                <div class="form-group">
                    <label>Track</label>
                    <p>${race.track || 'TBA'}</p>
                </div>
                <div class="form-group">
                    <label>Signed Up Drivers (${signups.length})</label>
                    <ul class="signup-list">${signupListMarkup}</ul>
                </div>
                <div class="form-group">
                    <label>Results</label>
                    <ul class="signup-list">${existingResultsMarkup}</ul>
                </div>
                ${resultsFormMarkup}
            `;

            const detailsTitle = document.getElementById('race-details-title');
            const detailsBody = document.getElementById('race-details-content');
            const signupButton = document.getElementById('race-signup-toggle');
            const submitResultsButton = document.getElementById('race-submit-results');
            const reopenButton = document.getElementById('race-reopen');
            const rebuildButton = document.getElementById('race-rebuild-standings');
            const signupCarGroup = document.getElementById('race-signup-car-group');
            const signupCarSelect = document.getElementById('race-signup-car');
            const claimedDriverId = window.AppSession?.claimedDriverId || '';
            const userId = window.AuthService?.getCurrentUser?.()?.uid || '';
            const signedUp = claimedDriverId && userId
                ? await Database.raceSignups.isSignedUp({ raceId, driverId: claimedDriverId, userId })
                : false;

            if (signupCarGroup) signupCarGroup.classList.add('hidden');
            if (signupCarSelect) {
                signupCarSelect.innerHTML = '<option value="">Select owned compatible car</option>';
            }

            detailsTitle.textContent = `${race.name} - Details`;
            detailsBody.innerHTML = detailsContent;

            submitResultsButton.classList.add('hidden');
            reopenButton.classList.add('hidden');
            rebuildButton.classList.add('hidden');

            if (isAdmin) {
                signupButton.classList.add('hidden');
                rebuildButton.classList.remove('hidden');
                if (canEditResults) {
                    submitResultsButton.classList.remove('hidden');
                    submitResultsButton.disabled = false;
                    submitResultsButton.textContent = race.status === 'completed' ? 'Update Results' : 'Submit Results';
                }
                if (race.status === 'completed') {
                    reopenButton.classList.remove('hidden');
                    reopenButton.disabled = false;
                }
            } else if (!window.AuthService?.isAuthenticated?.()) {
                signupButton.classList.remove('hidden');
                signupButton.disabled = true;
                signupButton.textContent = 'Sign in to Sign Up';
            } else if (!claimedDriverId) {
                signupButton.classList.remove('hidden');
                signupButton.disabled = true;
                signupButton.textContent = 'Select Driver in Profile';
            } else if (race.status !== 'scheduled') {
                signupButton.classList.remove('hidden');
                signupButton.disabled = true;
                signupButton.textContent = 'Race Closed';
            } else {
                const ownedCompatibleCars = await Database.garage.getCompatibleOwnedCars(userId, race.game);

                if (signupCarGroup) signupCarGroup.classList.remove('hidden');
                if (signupCarSelect) {
                    signupCarSelect.innerHTML = '<option value="">Select owned compatible car</option>';
                    ownedCompatibleCars.forEach((car) => {
                        const option = document.createElement('option');
                        option.value = car.id;
                        option.textContent = `${car.name} ($${Number(car.price || 0).toLocaleString()})`;
                        signupCarSelect.appendChild(option);
                    });
                }

                signupButton.classList.remove('hidden');
                if (signedUp) {
                    signupButton.disabled = false;
                    signupButton.textContent = 'Withdraw';
                    const existingSignup = signups.find((entry) => entry.driverId === claimedDriverId && entry.userId === userId);
                    if (existingSignup?.selectedCarId && signupCarSelect) {
                        signupCarSelect.value = existingSignup.selectedCarId;
                    }
                } else if (!ownedCompatibleCars.length) {
                    signupButton.disabled = true;
                    signupButton.textContent = 'Buy Compatible Car First';
                } else {
                    signupButton.disabled = false;
                    signupButton.textContent = 'Sign Me Up';
                }
            }

            this.showModal('race-details-modal');
        } catch (error) {
            console.error('Error opening race details:', error);
            this.showNotification('Error loading race details: ' + error.message, 'error');
        }
    },

    async submitRaceResults() {
        if (!this.isAdmin()) {
            this.showNotification('Only admins can submit race results.', 'error');
            return;
        }

        const raceId = this.currentRaceDetailsId;
        if (!raceId) {
            this.showNotification('No race selected.', 'error');
            return;
        }

        try {
            const [race, signups] = await Promise.all([
                Database.races.getById(raceId),
                Database.raceSignups.getByRace(raceId)
            ]);

            if (!race) {
                this.showNotification('Race not found.', 'error');
                return;
            }

            if (race.status !== 'scheduled' && race.status !== 'completed') {
                this.showNotification('Results can only be managed for scheduled or completed races.', 'error');
                return;
            }

            const rawResults = signups.map((signup) => {
                const positionInput = document.getElementById(`result-pos-${signup.driverId}`);
                const dnfInput = document.getElementById(`result-dnf-${signup.driverId}`);
                const finishPosition = Number(positionInput?.value || 0);

                return {
                    driverId: signup.driverId,
                    finishPosition,
                    dnf: Boolean(dnfInput?.checked)
                };
            });

            if (rawResults.some((result) => !Number.isInteger(result.finishPosition) || result.finishPosition < 1)) {
                this.showNotification('Enter a valid finish position for every signed-up driver.', 'error');
                return;
            }

            const actorUid = window.AuthService?.getCurrentUser?.()?.uid || null;
            if (race.status === 'completed') {
                await Database.races.updateResults(raceId, rawResults, actorUid);
                this.showNotification('Race results updated and standings rebuilt.');
            } else {
                await Database.races.processResults(raceId, rawResults, actorUid);
                this.showNotification('Race results submitted and standings rebuilt.');
            }

            await Promise.allSettled([
                this.openRaceDetails(raceId),
                this.loadCalendar(),
                this.loadDashboard(),
                this.loadDrivers(),
                this.loadTeams(),
                this.loadStandings()
            ]);
        } catch (error) {
            console.error('Error submitting race results:', error);
            this.showNotification('Could not submit results: ' + error.message, 'error');
        }
    },

    async reopenRace() {
        if (!this.isAdmin()) {
            this.showNotification('Only admins can reopen races.', 'error');
            return;
        }

        const raceId = this.currentRaceDetailsId;
        if (!raceId) {
            this.showNotification('No race selected.', 'error');
            return;
        }

        if (!window.confirm('Reopen this race and clear existing results?')) {
            return;
        }

        try {
            await Database.races.reopenRace(raceId, window.AuthService?.getCurrentUser?.()?.uid || null);
            this.showNotification('Race reopened and standings rebuilt.');
            await Promise.allSettled([
                this.openRaceDetails(raceId),
                this.loadCalendar(),
                this.loadDashboard(),
                this.loadDrivers(),
                this.loadTeams(),
                this.loadStandings()
            ]);
        } catch (error) {
            console.error('Error reopening race:', error);
            this.showNotification('Could not reopen race: ' + error.message, 'error');
        }
    },

    async rebuildStandings() {
        if (!this.isAdmin()) {
            this.showNotification('Only admins can rebuild standings.', 'error');
            return;
        }

        try {
            await Database.integrity.rebuildAllAggregates(window.AuthService?.getCurrentUser?.()?.uid || null);
            this.showNotification('Standings rebuilt successfully.');
            await Promise.allSettled([
                this.loadDashboard(),
                this.loadDrivers(),
                this.loadTeams(),
                this.loadStandings(),
                this.loadCalendar()
            ]);
            if (this.currentRaceDetailsId) {
                await this.openRaceDetails(this.currentRaceDetailsId);
            }
        } catch (error) {
            console.error('Error rebuilding standings:', error);
            this.showNotification('Could not rebuild standings: ' + error.message, 'error');
        }
    },

    async loadAdminCommandCenter() {
        if (!this.isAdmin()) {
            const upcomingList = document.getElementById('admin-upcoming-races-list');
            const operationsFeed = document.getElementById('admin-operations-feed');
            ['admin-kpi-drivers', 'admin-kpi-teams', 'admin-kpi-races', 'admin-kpi-pending'].forEach((id) => {
                const element = document.getElementById(id);
                if (element) element.textContent = '0';
            });
            if (upcomingList) upcomingList.innerHTML = '<p class="empty-state">Admin access required.</p>';
            if (operationsFeed) operationsFeed.innerHTML = '<p class="empty-state">Admin access required.</p>';
            return;
        }

        try {
            const [drivers, teams, races, pendingDrivers, pendingTeams, accountRequests] = await Promise.all([
                Database.drivers.getAll(),
                Database.teams.getAll(),
                Database.races.getAll(),
                Database.drivers.getPending(),
                Database.teams.getPending(),
                Database.accounts.getAll()
            ]);

            const approvedDrivers = drivers.filter((driver) => (driver.status || 'approved') === 'approved');
            const approvedTeams = teams.filter((team) => (team.status || 'approved') === 'approved');
            const scheduledRaces = races
                .filter((race) => (race.status || 'scheduled') === 'scheduled')
                .sort((a, b) => this.normalizeDate(a.date) - this.normalizeDate(b.date));
            const pendingAccess = accountRequests.filter((request) => ['pending', 'joined'].includes(request.status || ''));
            const pendingCount = pendingDrivers.length + pendingTeams.length + pendingAccess.length;

            const setText = (id, value) => {
                const element = document.getElementById(id);
                if (element) element.textContent = String(value);
            };

            setText('admin-kpi-drivers', approvedDrivers.length);
            setText('admin-kpi-teams', approvedTeams.length);
            setText('admin-kpi-races', scheduledRaces.length);
            setText('admin-kpi-pending', pendingCount);

            const upcomingList = document.getElementById('admin-upcoming-races-list');
            if (upcomingList) {
                if (!scheduledRaces.length) {
                    upcomingList.innerHTML = '<p class="empty-state">No upcoming races on the board.</p>';
                } else {
                    upcomingList.innerHTML = scheduledRaces.slice(0, 4).map((race) => `
                        <div class="moderation-item">
                            <div class="moderation-item-header">
                                <div>
                                    <p class="moderation-title">${race.name}</p>
                                    <p class="moderation-meta">${this.normalizeDate(race.date).toLocaleString()}</p>
                                    <p class="moderation-meta">${race.game || 'Unassigned game'}${race.track ? ` • ${race.track}` : ''}</p>
                                </div>
                                <span class="status-pill status-approved">scheduled</span>
                            </div>
                        </div>
                    `).join('');
                }
            }

            const operationsFeed = document.getElementById('admin-operations-feed');
            if (operationsFeed) {
                const feedItems = [
                    {
                        title: pendingCount ? `${pendingCount} submissions waiting for review` : 'Moderation queue is clear',
                        copy: pendingCount
                            ? `${pendingDrivers.length} driver requests, ${pendingTeams.length} team requests, and ${pendingAccess.length} account access events are ready for action.`
                            : 'No pending driver or team submissions are blocking the grid.'
                    },
                    {
                        title: scheduledRaces.length ? `${scheduledRaces.length} race events scheduled` : 'No races scheduled yet',
                        copy: scheduledRaces.length
                            ? `Next up: ${scheduledRaces[0].name} on ${this.normalizeDate(scheduledRaces[0].date).toLocaleDateString()}.`
                            : 'Use Schedule Race to put the next event on the calendar.'
                    },
                    {
                        title: `${approvedDrivers.length} active drivers across ${approvedTeams.length} teams`,
                        copy: approvedTeams.length
                            ? 'Roster changes propagate into the public league views after each successful admin action.'
                            : 'Start by building teams, then slot drivers into your championship structure.'
                    }
                ];

                operationsFeed.innerHTML = feedItems.map((item) => `
                    <div class="ops-feed-item">
                        <div class="ops-feed-title">${item.title}</div>
                        <div class="ops-feed-copy">${item.copy}</div>
                    </div>
                `).join('');
            }
        } catch (error) {
            console.error('Error loading admin command center:', error);
            this.showNotification('Could not load admin command center: ' + error.message, 'error');
        }
    },

    async loadAdminPanel() {
        if (!this.isAdmin()) {
            const moderationList = document.getElementById('moderation-queue-list');
            const adminList = document.getElementById('admin-list');
            const payoutList = document.getElementById('admin-payout-audit-list');
            const accountList = document.getElementById('account-request-list');
            if (moderationList) moderationList.innerHTML = '<p class="empty-state">Admin access required.</p>';
            if (adminList) adminList.innerHTML = '<p class="empty-state">Admin access required.</p>';
            if (payoutList) payoutList.innerHTML = '<p class="empty-state">Admin access required.</p>';
            if (accountList) accountList.innerHTML = '<p class="empty-state">Admin access required.</p>';
            await this.loadAdminCommandCenter();
            return;
        }

        await Promise.allSettled([
            this.loadAdminCommandCenter(),
            this.loadModerationQueue(),
            this.loadAccountRequests(),
            this.loadAdminList(),
            this.loadGamesCatalog(),
            this.loadCarsCatalog(),
            this.loadAdminPayoutActivity()
        ]);
    },

    async loadAccountRequests() {
        if (!this.isAdmin()) return;

        const list = document.getElementById('account-request-list');
        if (!list) return;

        const requests = await Database.accounts.getAll();
        requests.sort((a, b) => this.normalizeDate(b.createdAt) - this.normalizeDate(a.createdAt));

        if (!requests.length) {
            list.innerHTML = '<p class="empty-state">No new account requests.</p>';
            return;
        }

        list.innerHTML = requests.slice(0, 25).map((request) => {
            const requestedRole = request.requestedRole === 'admin' ? 'Admin/Game Master' : 'Driver';
            const status = request.status || 'joined';
            const canReview = status === 'pending';
            const canMarkSeen = status === 'joined';

            return `
                <div class="moderation-item">
                    <div class="moderation-item-header">
                        <div>
                            <p class="moderation-title">${request.displayName || request.username || request.uid}</p>
                            <p class="moderation-meta">Username: ${request.username || 'N/A'}</p>
                            <p class="moderation-meta">Requested role: ${requestedRole}</p>
                            <p class="moderation-meta">UID: ${request.uid}</p>
                            <p class="moderation-meta">Created: ${this.normalizeDate(request.createdAt).toLocaleString()}</p>
                        </div>
                        <span class="status-pill status-${status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'pending'}">${status}</span>
                    </div>
                    ${(canReview || canMarkSeen) ? `
                        <div class="card-actions" style="padding: 0; border: none;">
                            ${canReview ? `<button type="button" onclick="UI.reviewAccountRequest('${request.id}', 'approve')">Approve Admin Access</button>` : ''}
                            ${canReview ? `<button type="button" onclick="UI.reviewAccountRequest('${request.id}', 'reject')">Reject</button>` : ''}
                            ${canMarkSeen ? `<button type="button" onclick="UI.reviewAccountRequest('${request.id}', 'seen')">Mark Seen</button>` : ''}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    },

    async reviewAccountRequest(requestId, action) {
        if (!this.isAdmin()) {
            this.showNotification('Only admins can review account access requests.', 'error');
            return;
        }

        const requests = await Database.accounts.getAll();
        const request = requests.find((item) => item.id === requestId);
        if (!request) {
            this.showNotification('Account request not found.', 'error');
            return;
        }

        const actorUid = window.AuthService?.getCurrentUser?.()?.uid || null;

        try {
            if (action === 'approve') {
                await Database.admins.upsert(request.uid, {
                    displayName: request.displayName || request.username || request.uid,
                    email: '',
                    isActive: true
                });

                await Database.accounts.updateRequest(requestId, {
                    status: 'approved',
                    reviewedByUid: actorUid,
                    reviewedAt: new Date()
                });

                await Database.users.upsertProfile(request.uid, {
                    displayName: request.displayName || request.username || '',
                    username: request.username || '',
                    requestedRole: 'admin',
                    roleStatus: 'approved'
                });
                this.showNotification('Admin/Game Master access approved.');
            } else if (action === 'reject') {
                await Database.accounts.updateRequest(requestId, {
                    status: 'rejected',
                    reviewedByUid: actorUid,
                    reviewedAt: new Date()
                });

                await Database.users.upsertProfile(request.uid, {
                    displayName: request.displayName || request.username || '',
                    username: request.username || '',
                    requestedRole: 'driver',
                    roleStatus: 'rejected'
                });
                this.showNotification('Admin/Game Master access request rejected.');
            } else {
                await Database.accounts.updateRequest(requestId, {
                    status: 'seen',
                    reviewedByUid: actorUid,
                    reviewedAt: new Date()
                });
                this.showNotification('New driver join marked as seen.');
            }

            await Promise.allSettled([
                this.loadAccountRequests(),
                this.loadAdminCommandCenter(),
                this.loadAdminList()
            ]);
        } catch (error) {
            console.error('Error reviewing account request:', error);
            this.showNotification('Could not process account request: ' + error.message, 'error');
        }
    },

    async loadModerationQueue() {
        if (!this.isAdmin()) return;

        const typeFilter = document.getElementById('moderation-type-filter')?.value || 'all';

        const [pendingDrivers, pendingTeams] = await Promise.all([
            Database.drivers.getPending(),
            Database.teams.getPending()
        ]);

        let queueItems = [
            ...pendingDrivers.map((driver) => ({
                type: 'driver',
                id: driver.id,
                name: driver.name,
                createdAt: driver.createdAt,
                createdByEmail: driver.createdByEmail || 'Unknown',
                status: driver.status || 'pending'
            })),
            ...pendingTeams.map((team) => ({
                type: 'team',
                id: team.id,
                name: team.name,
                createdAt: team.createdAt,
                createdByEmail: team.createdByEmail || 'Unknown',
                status: team.status || 'pending'
            }))
        ];

        queueItems.sort((a, b) => this.normalizeDate(b.createdAt) - this.normalizeDate(a.createdAt));

        if (typeFilter !== 'all') {
            queueItems = queueItems.filter((item) => item.type === typeFilter);
        }

        const list = document.getElementById('moderation-queue-list');
        if (!list) return;

        if (queueItems.length === 0) {
            list.innerHTML = '<p class="empty-state">No pending submissions for this filter.</p>';
            return;
        }

        list.innerHTML = queueItems.map((item) => `
            <div class="moderation-item">
                <div class="moderation-item-header">
                    <div>
                        <p class="moderation-title">${item.name}</p>
                        <p class="moderation-meta">${item.type.toUpperCase()} • ${this.normalizeDate(item.createdAt).toLocaleString()}</p>
                        <p class="moderation-meta">Submitted by: ${item.createdByEmail}</p>
                    </div>
                    <span class="status-pill status-${item.status}">${item.status}</span>
                </div>
                <div class="form-group" style="margin-bottom: 0.75rem;">
                    <label for="moderation-note-${item.type}-${item.id}">Moderation note</label>
                    <input type="text" id="moderation-note-${item.type}-${item.id}" placeholder="Optional note">
                </div>
                <div class="card-actions" style="padding: 0; border: none;">
                    <button type="button" onclick="UI.moderateSubmission('${item.type}', '${item.id}', 'approve')">Approve</button>
                    <button type="button" onclick="UI.moderateSubmission('${item.type}', '${item.id}', 'reject')">Reject</button>
                </div>
            </div>
        `).join('');
    },

    async moderateSubmission(type, id, action) {
        if (!this.isAdmin()) {
            this.showNotification('Only admins can moderate submissions.', 'error');
            return;
        }

        const actorUid = window.AuthService?.getCurrentUser?.()?.uid || null;
        const noteInput = document.getElementById(`moderation-note-${type}-${id}`);
        const note = noteInput?.value || '';

        try {
            if (type === 'driver') {
                if (action === 'approve') {
                    await Database.drivers.approve(id, actorUid);
                } else {
                    await Database.drivers.reject(id, actorUid, note);
                }
            } else {
                if (action === 'approve') {
                    await Database.teams.approve(id, actorUid);
                } else {
                    await Database.teams.reject(id, actorUid, note);
                }
            }

            this.showNotification(`${type} ${action}d successfully.`);
            await Promise.allSettled([
                this.loadAdminCommandCenter(),
                this.loadModerationQueue(),
                this.loadDrivers(),
                this.loadTeams(),
                this.loadDashboard()
            ]);
        } catch (error) {
            console.error('Moderation error:', error);
            this.showNotification('Moderation action failed: ' + error.message, 'error');
        }
    },

    async loadAdminList() {
        if (!this.isAdmin()) return;

        const admins = await Database.admins.getAll();
        const list = document.getElementById('admin-list');
        if (!list) return;

        if (!admins.length) {
            list.innerHTML = '<p class="empty-state">No admins found.</p>';
            return;
        }

        admins.sort((a, b) => this.normalizeDate(b.updatedAt || b.createdAt) - this.normalizeDate(a.updatedAt || a.createdAt));

        list.innerHTML = admins.map((admin) => `
            <div class="moderation-item">
                <div class="moderation-item-header">
                    <div>
                        <p class="moderation-title">${admin.displayName || admin.email || admin.id}</p>
                        <p class="moderation-meta">UID: ${admin.id}</p>
                        <p class="moderation-meta">${admin.email || 'No email provided'}</p>
                    </div>
                    <span class="status-pill ${admin.isActive === false ? 'status-rejected' : 'status-approved'}">${admin.isActive === false ? 'inactive' : 'active'}</span>
                </div>
                <div class="card-actions" style="padding: 0; border: none;">
                    <button type="button" onclick="UI.setAdminActive('${admin.id}', ${admin.isActive === false ? 'true' : 'false'})">${admin.isActive === false ? 'Activate' : 'Deactivate'}</button>
                    <button type="button" onclick="UI.removeAdmin('${admin.id}')">Remove</button>
                </div>
            </div>
        `).join('');
    },

    async saveAdminFromForm() {
        if (!this.isAdmin()) {
            this.showNotification('Only admins can manage admins.', 'error');
            return;
        }

        const uid = document.getElementById('admin-uid')?.value?.trim();
        const email = document.getElementById('admin-email')?.value?.trim() || '';
        const displayName = document.getElementById('admin-display-name')?.value?.trim() || '';
        const isActive = (document.getElementById('admin-is-active')?.value || 'true') === 'true';

        if (!uid) {
            this.showNotification('Admin UID is required.', 'error');
            return;
        }

        try {
            await Database.admins.upsert(uid, {
                email,
                displayName,
                isActive
            });
            this.showNotification('Admin saved successfully.');
            const form = document.getElementById('admin-create-form');
            form?.reset();
            const statusSelect = document.getElementById('admin-is-active');
            if (statusSelect) statusSelect.value = 'true';
            await Promise.allSettled([this.loadAdminList(), this.loadAdminCommandCenter()]);
        } catch (error) {
            console.error('Error saving admin:', error);
            this.showNotification('Could not save admin: ' + error.message, 'error');
        }
    },

    async setAdminActive(uid, isActive) {
        if (!this.isAdmin()) {
            this.showNotification('Only admins can manage admins.', 'error');
            return;
        }

        try {
            await Database.admins.setActive(uid, Boolean(isActive));
            this.showNotification('Admin status updated.');
            await Promise.allSettled([this.loadAdminList(), this.loadAdminCommandCenter()]);
        } catch (error) {
            console.error('Error updating admin status:', error);
            this.showNotification('Could not update admin: ' + error.message, 'error');
        }
    },

    async removeAdmin(uid) {
        if (!this.isAdmin()) {
            this.showNotification('Only admins can manage admins.', 'error');
            return;
        }

        if (!window.confirm('Remove this admin record?')) {
            return;
        }

        try {
            await Database.admins.remove(uid);
            this.showNotification('Admin removed.');
            await Promise.allSettled([this.loadAdminList(), this.loadAdminCommandCenter()]);
        } catch (error) {
            console.error('Error removing admin:', error);
            this.showNotification('Could not remove admin: ' + error.message, 'error');
        }
    },

    async loadGamesCatalog() {
        const games = await Database.games.getAll();
        const gamesList = document.getElementById('games-list');
        const carGameSelect = document.getElementById('car-game-key');
        const shopFilter = document.getElementById('driver-shop-game-filter');

        if (carGameSelect) {
            carGameSelect.innerHTML = '<option value="">Select game</option>';
        }

        if (shopFilter) {
            shopFilter.innerHTML = '<option value="">All Games</option>';
        }

        const sortedGames = [...games].sort((a, b) => String(a.name || a.key).localeCompare(String(b.name || b.key)));

        sortedGames.forEach((game) => {
            if (carGameSelect) {
                const option = document.createElement('option');
                option.value = game.key;
                option.textContent = game.name || game.key;
                carGameSelect.appendChild(option);
            }

            if (shopFilter) {
                const option = document.createElement('option');
                option.value = game.key;
                option.textContent = game.name || game.key;
                shopFilter.appendChild(option);
            }
        });

        if (!gamesList) return;

        if (!sortedGames.length) {
            gamesList.innerHTML = '<p class="empty-state">No games configured.</p>';
            return;
        }

        gamesList.innerHTML = sortedGames.map((game) => `
            <div class="moderation-item">
                <div class="moderation-item-header">
                    <div>
                        <p class="moderation-title">${game.name || game.key}</p>
                        <p class="moderation-meta">Key: ${game.key}</p>
                    </div>
                    <span class="status-pill ${game.isActive === false ? 'status-rejected' : 'status-approved'}">${game.isActive === false ? 'inactive' : 'active'}</span>
                </div>
                ${this.isAdmin() ? `
                <div class="card-actions" style="padding: 0; border: none;">
                    <button type="button" onclick="UI.removeGame('${game.id}')">Remove</button>
                </div>
                ` : ''}
            </div>
        `).join('');
    },

    async loadCarsCatalog() {
        const [cars, games] = await Promise.all([
            Database.cars.getAll(),
            Database.games.getAll()
        ]);

        const gameMap = new Map(games.map((game) => [game.key, game]));
        const activeCars = cars.filter((car) => car.isActive !== false);

        const carsList = document.getElementById('cars-list');
        if (carsList) {
            if (!activeCars.length) {
                carsList.innerHTML = '<p class="empty-state">No cars configured.</p>';
            } else {
                carsList.innerHTML = activeCars.map((car) => {
                    const game = gameMap.get(car.gameKey);
                    return `
                        <div class="moderation-item">
                            <div class="moderation-item-header">
                                <div>
                                    <p class="moderation-title">${car.name}</p>
                                    <p class="moderation-meta">${game?.name || car.gameKey}</p>
                                    <p class="moderation-meta">Price: $${Number(car.price || 0).toLocaleString()}</p>
                                </div>
                                <span class="status-pill status-approved">active</span>
                            </div>
                            ${this.isAdmin() ? `
                            <div class="card-actions" style="padding: 0; border: none;">
                                <button type="button" onclick="UI.removeCar('${car.id}')">Remove</button>
                            </div>
                            ` : ''}
                        </div>
                    `;
                }).join('');
            }
        }

        if (this.currentView === 'driver-hub') {
            await this.renderDriverShop(activeCars, gameMap);
        }
    },

    async saveGameFromForm() {
        if (!this.isAdmin()) {
            this.showNotification('Only admins can manage games.', 'error');
            return;
        }

        const gameKey = document.getElementById('game-key')?.value?.trim()?.toLowerCase();
        const gameName = document.getElementById('game-name')?.value?.trim();

        if (!gameKey || !gameName) {
            this.showNotification('Game key and name are required.', 'error');
            return;
        }

        try {
            await Database.games.upsert(gameKey, { name: gameName, isActive: true });
            this.showNotification('Game saved.');
            document.getElementById('game-create-form')?.reset();
            await Promise.allSettled([
                this.loadGamesCatalog(),
                this.loadCarsCatalog()
            ]);
        } catch (error) {
            console.error('Error saving game:', error);
            this.showNotification('Could not save game: ' + error.message, 'error');
        }
    },

    async saveCarFromForm() {
        if (!this.isAdmin()) {
            this.showNotification('Only admins can manage cars.', 'error');
            return;
        }

        const name = document.getElementById('car-name')?.value?.trim();
        const gameKey = document.getElementById('car-game-key')?.value?.trim()?.toLowerCase();
        const price = Number(document.getElementById('car-price')?.value || 0);

        if (!name || !gameKey) {
            this.showNotification('Car name and game are required.', 'error');
            return;
        }

        if (!Number.isFinite(price) || price < 0) {
            this.showNotification('Car price must be a non-negative number.', 'error');
            return;
        }

        try {
            await Database.cars.create({ name, gameKey, price, isActive: true });
            this.showNotification('Car saved.');
            document.getElementById('car-create-form')?.reset();
            await this.loadCarsCatalog();
        } catch (error) {
            console.error('Error saving car:', error);
            this.showNotification('Could not save car: ' + error.message, 'error');
        }
    },

    async removeGame(gameKey) {
        if (!this.isAdmin()) {
            this.showNotification('Only admins can manage games.', 'error');
            return;
        }

        if (!window.confirm('Remove this game from the catalog?')) {
            return;
        }

        try {
            await Database.games.remove(gameKey);
            this.showNotification('Game removed.');
            await Promise.allSettled([
                this.loadGamesCatalog(),
                this.loadCarsCatalog()
            ]);
        } catch (error) {
            console.error('Error removing game:', error);
            this.showNotification('Could not remove game: ' + error.message, 'error');
        }
    },

    async removeCar(carId) {
        if (!this.isAdmin()) {
            this.showNotification('Only admins can manage cars.', 'error');
            return;
        }

        if (!window.confirm('Remove this car from the catalog?')) {
            return;
        }

        try {
            await Database.cars.remove(carId);
            this.showNotification('Car removed.');
            await this.loadCarsCatalog();
        } catch (error) {
            console.error('Error removing car:', error);
            this.showNotification('Could not remove car: ' + error.message, 'error');
        }
    },

    async loadDriverHub() {
        if (!this.isAuthenticatedUser()) {
            const racesContainer = document.getElementById('driver-hub-races');
            const garageContainer = document.getElementById('driver-garage-list');
            const txContainer = document.getElementById('driver-wallet-transactions');
            const kpiContainer = document.getElementById('driver-hub-kpi-grid');
            const teamContainer = document.getElementById('driver-team-kpi');
            const historyContainer = document.getElementById('driver-performance-history');
            if (racesContainer) racesContainer.innerHTML = '<p class="empty-state">Sign in to access Driver Hub.</p>';
            if (garageContainer) garageContainer.innerHTML = '<p class="empty-state">Sign in to view your garage.</p>';
            if (txContainer) txContainer.innerHTML = '<p class="empty-state">Sign in to view wallet history.</p>';
            if (kpiContainer) kpiContainer.innerHTML = '<p class="empty-state">Sign in to view season KPIs.</p>';
            if (teamContainer) teamContainer.innerHTML = '<p class="empty-state">Sign in to view team KPIs.</p>';
            if (historyContainer) historyContainer.innerHTML = '<p class="empty-state">Sign in to view race history.</p>';
            return;
        }

        const userId = window.AuthService?.getCurrentUser?.()?.uid;
        if (!userId) return;

        await Promise.allSettled([
            this.renderDriverWallet(userId),
            this.renderDriverGarage(userId),
            this.renderDriverHubRaces(),
            this.renderDriverPerformance(userId),
            this.loadGamesCatalog(),
            this.loadCarsCatalog()
        ]);
    },

    async renderDriverPerformance(userId) {
        const kpiContainer = document.getElementById('driver-hub-kpi-grid');
        const teamContainer = document.getElementById('driver-team-kpi');
        const historyContainer = document.getElementById('driver-performance-history');

        if (!kpiContainer || !teamContainer || !historyContainer) return;

        const claimedDriverId = window.AppSession?.claimedDriverId || '';
        if (!claimedDriverId) {
            kpiContainer.innerHTML = '<p class="empty-state">Set your claimed driver in Profile to unlock personalized KPIs.</p>';
            teamContainer.innerHTML = '<p class="empty-state">No team KPI data yet.</p>';
            historyContainer.innerHTML = '<p class="empty-state">No race history yet.</p>';
            return;
        }

        const [driver, teams, races, transactions, contracts] = await Promise.all([
            Database.drivers.getById(claimedDriverId),
            Database.teams.getAll(),
            Database.races.getAll(),
            Database.economy.getTransactions(userId),
            Database.sponsorships.getDriverContracts(claimedDriverId, { includeInactive: true })
        ]);

        if (!driver) {
            kpiContainer.innerHTML = '<p class="empty-state">Your claimed driver was not found.</p>';
            teamContainer.innerHTML = '<p class="empty-state">No team KPI data yet.</p>';
            historyContainer.innerHTML = '<p class="empty-state">No race history yet.</p>';
            return;
        }

        let seasonYear = new Date().getFullYear();
        try {
            const settings = JSON.parse(localStorage.getItem('srmpcSettings') || '{}');
            seasonYear = Number(settings.seasonYear || seasonYear);
        } catch (error) {
            seasonYear = new Date().getFullYear();
        }
        const completedRaces = races
            .filter((race) => race.status === 'completed')
            .sort((a, b) => this.normalizeDate(b.date) - this.normalizeDate(a.date));

        const history = [];
        completedRaces.forEach((race) => {
            const result = (race.results || []).find((entry) => entry.driverId === claimedDriverId);
            if (!result) return;
            history.push({
                raceId: race.id,
                raceName: race.name,
                raceDate: race.date,
                game: race.game,
                track: race.track || 'TBA',
                finishPosition: Number(result.finishPosition || 0),
                pointsAwarded: Number(result.pointsAwarded || 0),
                dnf: Boolean(result.dnf)
            });
        });

        const seasonHistory = history.filter((entry) => this.normalizeDate(entry.raceDate).getFullYear() === seasonYear);
        const nonDnfSeason = seasonHistory.filter((entry) => !entry.dnf);
        const seasonWins = seasonHistory.filter((entry) => entry.finishPosition === 1 && !entry.dnf).length;
        const seasonPodiums = seasonHistory.filter((entry) => entry.finishPosition <= 3 && !entry.dnf).length;
        const seasonPoints = seasonHistory.reduce((sum, entry) => sum + Number(entry.pointsAwarded || 0), 0);
        const averageFinish = nonDnfSeason.length
            ? (nonDnfSeason.reduce((sum, entry) => sum + Number(entry.finishPosition || 0), 0) / nonDnfSeason.length).toFixed(2)
            : 'N/A';
        const sponsorPayoutTotal = transactions
            .filter((tx) => tx.type === 'sponsor-payout' && tx.driverId === claimedDriverId)
            .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
        const manualAdjustments = transactions
            .filter((tx) => tx.type === 'manual-bonus' || tx.type === 'manual-penalty')
            .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
        const activeContracts = contracts.filter((contract) => (contract.status || 'active') === 'active').length;

        const kpis = [
            { label: `Season ${seasonYear} Points`, value: seasonPoints },
            { label: 'Season Races', value: seasonHistory.length },
            { label: 'Season Wins', value: seasonWins },
            { label: 'Season Podiums', value: seasonPodiums },
            { label: 'Average Finish', value: averageFinish },
            { label: 'Active Contracts', value: activeContracts },
            { label: 'Sponsor Payouts (Total)', value: this.formatCurrency(sponsorPayoutTotal) },
            { label: 'Admin Adjustments', value: this.formatCurrency(manualAdjustments) }
        ];

        kpiContainer.innerHTML = kpis.map((kpi) => `
            <div class="kpi-card">
                <div class="kpi-value">${kpi.value}</div>
                <div class="kpi-label">${kpi.label}</div>
            </div>
        `).join('');

        const teamMap = new Map(teams.map((team) => [team.id, team]));
        const team = driver.teamId ? teamMap.get(driver.teamId) : null;
        if (!team) {
            teamContainer.innerHTML = '<p class="empty-state">No active team association for your claimed driver.</p>';
        } else {
            const teamContracts = await Database.sponsorships.getTeamContracts(team.id, { includeInactive: true });
            const teamStats = team.stats || {};
            teamContainer.innerHTML = `
                <div class="stat-row"><span class="stat-label">Team</span><span class="stat-value">${team.name}</span></div>
                <div class="stat-row"><span class="stat-label">Team Points</span><span class="stat-value">${Number(teamStats.totalPoints || 0)}</span></div>
                <div class="stat-row"><span class="stat-label">Team Wins</span><span class="stat-value">${Number(teamStats.totalWins || 0)}</span></div>
                <div class="stat-row"><span class="stat-label">Team Podiums</span><span class="stat-value">${Number(teamStats.totalPodiums || 0)}</span></div>
                <div class="stat-row"><span class="stat-label">Team Contracts</span><span class="stat-value">${teamContracts.length}</span></div>
            `;
        }

        if (!history.length) {
            historyContainer.innerHTML = '<p class="empty-state">No race history yet.</p>';
            return;
        }

        historyContainer.innerHTML = history.slice(0, 10).map((entry) => `
            <div class="moderation-item">
                <div class="moderation-item-header">
                    <div>
                        <p class="moderation-title">${entry.raceName}</p>
                        <p class="moderation-meta">${this.normalizeDate(entry.raceDate).toLocaleString()} • ${entry.game} • ${entry.track}</p>
                    </div>
                    <span class="status-pill ${entry.dnf ? 'status-rejected' : 'status-approved'}">${entry.dnf ? 'DNF' : `P${entry.finishPosition}`}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Points Awarded</span>
                    <span class="stat-value">${entry.pointsAwarded}</span>
                </div>
            </div>
        `).join('');
    },

    async renderDriverWallet(userId) {
        const [balance, transactions] = await Promise.all([
            Database.economy.getBalance(userId),
            Database.economy.getTransactions(userId)
        ]);

        const balanceEl = document.getElementById('driver-wallet-balance');
        const txEl = document.getElementById('driver-wallet-transactions');

        if (balanceEl) {
            balanceEl.textContent = `$${Number(balance).toLocaleString()}`;
        }

        if (!txEl) return;

        if (!transactions.length) {
            txEl.innerHTML = '<p class="empty-state">Starting budget: $200,000</p>';
            return;
        }

        txEl.innerHTML = transactions.slice(0, 8).map((tx) => {
            const amount = Number(tx.amount || 0);
            return `
                <div class="stat-row">
                    <span class="stat-label">${tx.note || tx.type || 'Transaction'}</span>
                    <span class="stat-value" style="color:${amount < 0 ? 'var(--danger)' : 'var(--success)'};">${amount < 0 ? '-' : '+'}$${Math.abs(amount).toLocaleString()}</span>
                </div>
            `;
        }).join('');
    },

    async renderDriverGarage(userId) {
        const [garageEntries, cars] = await Promise.all([
            Database.garage.getByUser(userId),
            Database.cars.getAll()
        ]);

        const carMap = new Map(cars.map((car) => [car.id, car]));
        const garageContainer = document.getElementById('driver-garage-list');
        if (!garageContainer) return;

        if (!garageEntries.length) {
            garageContainer.innerHTML = '<p class="empty-state">No cars owned yet.</p>';
            return;
        }

        garageContainer.innerHTML = garageEntries.map((entry) => {
            const car = carMap.get(entry.carId);
            if (!car) return '';
            return `
                <div class="stat-row">
                    <span class="stat-label">${car.name}</span>
                    <span class="stat-value">${car.gameKey}</span>
                </div>
            `;
        }).join('') || '<p class="empty-state">No cars owned yet.</p>';
    },

    async renderDriverShop(cars, gameMap) {
        const userId = window.AuthService?.getCurrentUser?.()?.uid;
        if (!userId) return;

        const filterKey = document.getElementById('driver-shop-game-filter')?.value || '';
        const ownedEntries = await Database.garage.getByUser(userId);
        const ownedSet = new Set(ownedEntries.map((entry) => entry.carId));

        const filteredCars = cars
            .filter((car) => car.isActive !== false)
            .filter((car) => !filterKey || car.gameKey === filterKey)
            .sort((a, b) => Number(a.price || 0) - Number(b.price || 0));

        const shopContainer = document.getElementById('driver-shop-cars');
        if (!shopContainer) return;

        if (!filteredCars.length) {
            shopContainer.innerHTML = '<p class="empty-state">No cars available for this filter.</p>';
            return;
        }

        shopContainer.innerHTML = filteredCars.map((car) => {
            const owned = ownedSet.has(car.id);
            const game = gameMap.get(car.gameKey);
            return `
                <div class="moderation-item">
                    <div class="moderation-item-header">
                        <div>
                            <p class="moderation-title">${car.name}</p>
                            <p class="moderation-meta">${game?.name || car.gameKey}</p>
                        </div>
                        <span class="status-pill ${owned ? 'status-approved' : 'status-pending'}">${owned ? 'owned' : `$${Number(car.price || 0).toLocaleString()}`}</span>
                    </div>
                    <div class="card-actions" style="padding: 0; border: none;">
                        <button type="button" ${owned ? 'disabled' : ''} onclick="UI.buyCar('${car.id}')">${owned ? 'Owned' : 'Buy'}</button>
                    </div>
                </div>
            `;
        }).join('');
    },

    async buyCar(carId) {
        if (!this.isAuthenticatedUser()) {
            this.showNotification('Sign in to purchase cars.', 'error');
            return;
        }

        const userId = window.AuthService?.getCurrentUser?.()?.uid;
        if (!userId) return;

        try {
            await Database.economy.purchaseCar({ userId, carId });
            this.showNotification('Car purchased successfully.');
            await Promise.allSettled([
                this.renderDriverWallet(userId),
                this.renderDriverGarage(userId),
                this.loadCarsCatalog()
            ]);
        } catch (error) {
            console.error('Error purchasing car:', error);
            this.showNotification('Could not purchase car: ' + error.message, 'error');
        }
    },

    async renderDriverHubRaces() {
        const races = await Database.races.getAll();
        const now = new Date();

        const upcoming = races
            .filter((race) => race.status === 'scheduled' && this.normalizeDate(race.date) > now)
            .sort((a, b) => this.normalizeDate(a.date) - this.normalizeDate(b.date));

        const container = document.getElementById('driver-hub-races');
        if (!container) return;

        if (!upcoming.length) {
            container.innerHTML = '<p class="empty-state">No upcoming races.</p>';
            return;
        }

        container.innerHTML = upcoming.map((race) => `
            <div class="race-item" style="margin-bottom: 0.9rem;">
                <div class="race-title">${race.name}</div>
                <div class="race-details">
                    <div class="race-detail">
                        <span class="race-detail-label">📅</span>
                        <span class="race-detail-value">${this.normalizeDate(race.date).toLocaleString()}</span>
                    </div>
                    <div class="race-detail">
                        <span class="race-detail-label">🎮</span>
                        <span class="race-detail-value">${race.game}</span>
                    </div>
                    <div class="race-detail">
                        <span class="race-detail-label">🏁</span>
                        <span class="race-detail-value">${race.track || 'TBA'}</span>
                    </div>
                </div>
                <div class="form-actions" style="margin-top: 0.7rem; justify-content: flex-start;">
                    <button type="button" class="btn btn-secondary" onclick="UI.openRaceDetails('${race.id}')">Open Race</button>
                </div>
            </div>
        `).join('');
    },

    async loadStandings() {
        try {
            const standings = await Database.standings.getCurrentSeasonStandings();
            const driverContainer = document.getElementById('driver-standings-table');
            const teamContainer = document.getElementById('team-standings-table');

            if (!driverContainer || !teamContainer) return;

            if (!standings || (!standings.entries?.length && !standings.teamEntries?.length)) {
                driverContainer.innerHTML = '<p class="empty-state">No standings data yet.</p>';
                teamContainer.innerHTML = '<p class="empty-state">No standings data yet.</p>';
                return;
            }

            const [drivers, teams] = await Promise.all([
                Database.drivers.getAll(),
                Database.teams.getAll()
            ]);

            const driverMap = new Map(drivers.map((driver) => [driver.id, driver]));
            const teamMap = new Map(teams.map((team) => [team.id, team]));

            const driverRows = (standings.entries || [])
                .sort((a, b) => b.points - a.points)
                .map((entry, index) => {
                    const driver = driverMap.get(entry.driverId);
                    const team = driver?.teamId ? teamMap.get(driver.teamId) : null;
                    return `
                        <tr>
                            <td>${index + 1}</td>
                            <td>${driver?.name || 'Unknown Driver'}</td>
                            <td>${team?.name || '-'}</td>
                            <td>${entry.points || 0}</td>
                            <td>${entry.races || 0}</td>
                            <td>${entry.wins || 0}</td>
                            <td>${entry.podiums || 0}</td>
                        </tr>
                    `;
                }).join('');

            const teamRows = (standings.teamEntries || [])
                .sort((a, b) => b.points - a.points)
                .map((entry, index) => {
                    const team = teamMap.get(entry.teamId);
                    return `
                        <tr>
                            <td>${index + 1}</td>
                            <td>${team?.name || 'Unknown Team'}</td>
                            <td>${entry.points || 0}</td>
                            <td>${entry.races || 0}</td>
                            <td>${entry.wins || 0}</td>
                            <td>${entry.podiums || 0}</td>
                        </tr>
                    `;
                }).join('');

            driverContainer.innerHTML = `
                <table class="standings-table">
                    <thead>
                        <tr><th>Pos</th><th>Driver</th><th>Team</th><th>Pts</th><th>Races</th><th>Wins</th><th>Podiums</th></tr>
                    </thead>
                    <tbody>${driverRows || '<tr><td colspan="7">No data</td></tr>'}</tbody>
                </table>
            `;

            teamContainer.innerHTML = `
                <table class="standings-table">
                    <thead>
                        <tr><th>Pos</th><th>Team</th><th>Pts</th><th>Races</th><th>Wins</th><th>Podiums</th></tr>
                    </thead>
                    <tbody>${teamRows || '<tr><td colspan="6">No data</td></tr>'}</tbody>
                </table>
            `;
        } catch (error) {
            console.error('Error loading standings:', error);
            this.showNotification('Error loading standings: ' + error.message, 'error');
        }
    },

    async toggleRaceSignup() {
        const raceId = this.currentRaceDetailsId;
        if (!raceId) {
            this.showNotification('No race selected.', 'error');
            return;
        }

        const user = window.AuthService?.getCurrentUser?.();
        if (!user || user.isAnonymous) {
            this.showNotification('Sign in to manage race sign-up.', 'error');
            return;
        }

        const driverId = window.AppSession?.claimedDriverId || '';
        if (!driverId) {
            this.showNotification('Pick your driver in Profile before signing up.', 'error');
            return;
        }

        const signedUp = await Database.raceSignups.isSignedUp({
            raceId,
            driverId,
            userId: user.uid
        });

        const selectedCarId = document.getElementById('race-signup-car')?.value || '';

        try {
            if (signedUp) {
                await Database.raceSignups.remove({
                    raceId,
                    driverId,
                    userId: user.uid
                });
                this.showNotification('You have withdrawn from this race.');
            } else {
                if (!selectedCarId) {
                    this.showNotification('Select an owned compatible car before signing up.', 'error');
                    return;
                }

                await Database.raceSignups.create({
                    raceId,
                    driverId,
                    userId: user.uid,
                    selectedCarId
                });
                this.showNotification('You are signed up for this race.');
            }

            await Promise.allSettled([
                this.openRaceDetails(raceId),
                this.loadCalendar(),
                this.loadDashboard()
            ]);
        } catch (error) {
            console.error('Error toggling race signup:', error);
            this.showNotification('Could not update sign-up: ' + error.message, 'error');
        }
    },

    // ===== SPONSORS =====
    focusSponsorshipForm() {
        const form = document.getElementById('sponsorship-create-form');
        if (form) {
            form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        const companyInput = document.getElementById('sponsor-company');
        companyInput?.focus();
    },

    async loadSponsors() {
        try {
            const [drivers, teams, contracts] = await Promise.all([
                this.getVisibleDrivers(),
                this.getVisibleTeams(),
                Database.sponsorships.getAll()
            ]);

            const sponsorsGrid = document.getElementById('sponsors-grid');
            const statusFilter = document.getElementById('sponsor-status-filter')?.value || 'all';
            const driverSelect = document.getElementById('sponsor-driver-id');
            const teamSelect = document.getElementById('sponsor-team-id');
            const createForm = document.getElementById('sponsorship-create-form');

            const selectedDriver = driverSelect?.value || '';
            const selectedTeam = teamSelect?.value || '';

            if (driverSelect) {
                driverSelect.innerHTML = '<option value="">Select driver</option>';
                drivers
                    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
                    .forEach((driver) => {
                        const option = document.createElement('option');
                        option.value = driver.id;
                        option.textContent = driver.name;
                        driverSelect.appendChild(option);
                    });
                if (selectedDriver && Array.from(driverSelect.options).some((opt) => opt.value === selectedDriver)) {
                    driverSelect.value = selectedDriver;
                }
            }

            if (teamSelect) {
                teamSelect.innerHTML = '<option value="">No team</option>';
                teams
                    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
                    .forEach((team) => {
                        const option = document.createElement('option');
                        option.value = team.id;
                        option.textContent = team.name;
                        teamSelect.appendChild(option);
                    });
                if (selectedTeam && Array.from(teamSelect.options).some((opt) => opt.value === selectedTeam)) {
                    teamSelect.value = selectedTeam;
                }
            }

            if (createForm) {
                createForm.querySelectorAll('input, select, textarea, button').forEach((el) => {
                    el.disabled = !this.isAdmin();
                });
            }

            if (!sponsorsGrid) return;

            const driversById = new Map(drivers.map((driver) => [driver.id, driver]));
            const teamsById = new Map(teams.map((team) => [team.id, team]));

            const filtered = contracts.filter((contract) => statusFilter === 'all' || (contract.status || 'active') === statusFilter);

            if (!filtered.length) {
                sponsorsGrid.innerHTML = '<p class="empty-state">No sponsorship contracts for this filter.</p>';
                return;
            }

            sponsorsGrid.innerHTML = filtered.map((contract) => {
                const driver = driversById.get(contract.driverId);
                const team = contract.teamId ? teamsById.get(contract.teamId) : null;
                const status = contract.status || 'active';
                const model = contract.payoutModel || {};
                return `
                    <div class="moderation-item">
                        <div class="moderation-item-header">
                            <div>
                                <p class="moderation-title">${contract.companyName}</p>
                                <p class="moderation-meta">Driver: ${driver?.name || contract.driverId}</p>
                                <p class="moderation-meta">Team: ${team?.name || 'Independent'}</p>
                                <p class="moderation-meta">Base: ${this.formatCurrency(model.basePerRace || 0)} • Win: ${this.formatCurrency(model.winBonus || 0)} • Podium: ${this.formatCurrency(model.podiumBonus || 0)} • DNF Penalty: ${this.formatCurrency(model.dnfPenalty || 0)}</p>
                                <p class="moderation-meta">${contract.startDate ? this.normalizeDate(contract.startDate).toLocaleDateString() : 'Now'} - ${contract.endDate ? this.normalizeDate(contract.endDate).toLocaleDateString() : 'Open-ended'}</p>
                            </div>
                            <span class="status-pill status-${status === 'active' ? 'approved' : status === 'pending' || status === 'paused' ? 'pending' : 'rejected'}">${status}</span>
                        </div>
                        ${contract.terms ? `<p class="moderation-meta" style="margin-bottom: 0.75rem;">${contract.terms}</p>` : ''}
                        ${this.isAdmin() ? `
                            <div class="card-actions" style="padding: 0; border: none;">
                                <button type="button" onclick="UI.setSponsorshipStatus('${contract.id}', 'active')">Activate</button>
                                <button type="button" onclick="UI.setSponsorshipStatus('${contract.id}', 'paused')">Pause</button>
                                <button type="button" onclick="UI.setSponsorshipStatus('${contract.id}', 'terminated')">Terminate</button>
                            </div>
                        ` : ''}
                    </div>
                `;
            }).join('');
        } catch (error) {
            console.error('Error loading sponsors:', error);
            this.showNotification('Error loading sponsorships: ' + error.message, 'error');
        }
    },

    async saveSponsorshipContractFromForm() {
        if (!this.isAdmin()) {
            this.showNotification('Only admins can create sponsorship contracts.', 'error');
            return;
        }

        const companyName = document.getElementById('sponsor-company')?.value?.trim();
        const driverId = document.getElementById('sponsor-driver-id')?.value || '';
        const teamId = document.getElementById('sponsor-team-id')?.value || '';
        const status = document.getElementById('sponsor-status')?.value || 'active';
        const basePerRace = Number(document.getElementById('sponsor-base-per-race')?.value || 0);
        const winBonus = Number(document.getElementById('sponsor-win-bonus')?.value || 0);
        const podiumBonus = Number(document.getElementById('sponsor-podium-bonus')?.value || 0);
        const dnfPenalty = Number(document.getElementById('sponsor-dnf-penalty')?.value || 0);
        const startDate = document.getElementById('sponsor-start-date')?.value || '';
        const endDate = document.getElementById('sponsor-end-date')?.value || '';
        const terms = document.getElementById('sponsor-terms')?.value?.trim() || '';

        if (!companyName || !driverId) {
            this.showNotification('Company and driver are required for sponsorship contracts.', 'error');
            return;
        }

        if (basePerRace < 0 || winBonus < 0 || podiumBonus < 0 || dnfPenalty < 0) {
            this.showNotification('Payout values must be non-negative.', 'error');
            return;
        }

        try {
            await Database.sponsorships.createContract({
                companyName,
                driverId,
                teamId: teamId || null,
                status,
                basePerRace,
                winBonus,
                podiumBonus,
                dnfPenalty,
                startDate: startDate || null,
                endDate: endDate || null,
                terms
            });

            this.showNotification('Sponsorship contract created.');
            document.getElementById('sponsorship-create-form')?.reset();
            const statusSelect = document.getElementById('sponsor-status');
            if (statusSelect) statusSelect.value = 'active';

            await Promise.allSettled([
                this.loadSponsors(),
                this.loadDriverHub()
            ]);
        } catch (error) {
            console.error('Error creating sponsorship contract:', error);
            this.showNotification('Could not create sponsorship contract: ' + error.message, 'error');
        }
    },

    async setSponsorshipStatus(contractId, status) {
        if (!this.isAdmin()) {
            this.showNotification('Only admins can update sponsorship status.', 'error');
            return;
        }

        try {
            await Database.sponsorships.updateContract(contractId, { status });
            this.showNotification('Sponsorship status updated.');
            await Promise.allSettled([
                this.loadSponsors(),
                this.loadDriverHub()
            ]);
        } catch (error) {
            console.error('Error updating sponsorship status:', error);
            this.showNotification('Could not update sponsorship status: ' + error.message, 'error');
        }
    },

    async saveAdminPayoutFromForm() {
        if (!this.isAdmin()) {
            this.showNotification('Only admins can apply payout adjustments.', 'error');
            return;
        }

        const userId = document.getElementById('admin-payout-user-id')?.value?.trim() || '';
        const driverId = document.getElementById('admin-payout-driver-id')?.value?.trim() || '';
        const amount = Number(document.getElementById('admin-payout-amount')?.value || 0);
        const note = document.getElementById('admin-payout-note')?.value?.trim() || '';

        if (!userId || !note) {
            this.showNotification('Target user and reason are required.', 'error');
            return;
        }

        if (!Number.isFinite(amount) || amount === 0) {
            this.showNotification('Amount must be a non-zero number.', 'error');
            return;
        }

        try {
            await Database.economy.addManualAdjustment({
                actorUid: window.AuthService?.getCurrentUser?.()?.uid || null,
                userId,
                amount,
                note,
                driverId: driverId || null
            });

            this.showNotification('Manual payout adjustment applied.');
            document.getElementById('admin-payout-form')?.reset();

            await Promise.allSettled([
                this.loadAdminPayoutActivity(),
                this.loadDriverHub()
            ]);
        } catch (error) {
            console.error('Error applying payout adjustment:', error);
            this.showNotification('Could not apply payout adjustment: ' + error.message, 'error');
        }
    },

    async loadAdminPayoutActivity() {
        if (!this.isAdmin()) return;

        const list = document.getElementById('admin-payout-audit-list');
        if (!list) return;

        const [audits, drivers] = await Promise.all([
            Database.payoutAudits.getAll(),
            Database.drivers.getAll()
        ]);

        const driversById = new Map(drivers.map((driver) => [driver.id, driver]));

        if (!audits.length) {
            list.innerHTML = '<p class="empty-state">No payout adjustments recorded.</p>';
            return;
        }

        list.innerHTML = audits.slice(0, 20).map((audit) => {
            const amount = Number(audit.amount || 0);
            const isPenalty = amount < 0;
            const driver = audit.driverId ? driversById.get(audit.driverId) : null;
            return `
                <div class="moderation-item">
                    <div class="moderation-item-header">
                        <div>
                            <p class="moderation-title">${isPenalty ? 'Penalty' : 'Bonus'} ${this.formatCurrency(amount)}</p>
                            <p class="moderation-meta">Target UID: ${audit.userId}</p>
                            <p class="moderation-meta">Driver: ${driver?.name || audit.driverId || 'N/A'}</p>
                            <p class="moderation-meta">Admin UID: ${audit.actorUid || 'Unknown'} • ${this.normalizeDate(audit.createdAt).toLocaleString()}</p>
                        </div>
                        <span class="status-pill ${isPenalty ? 'status-rejected' : 'status-approved'}">${audit.adjustmentType || (isPenalty ? 'manual-penalty' : 'manual-bonus')}</span>
                    </div>
                    <p class="moderation-meta">Reason: ${audit.reason || 'No reason provided'}</p>
                </div>
            `;
        }).join('');
    },

    // ===== UTILITIES =====
    showNotification(message, type = 'success') {
        console.log(`[${type.toUpperCase()}] ${message}`);

        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.style.position = 'fixed';
            container.style.top = '1rem';
            container.style.right = '1rem';
            container.style.zIndex = '9999';
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.gap = '0.5rem';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.minWidth = '260px';
        toast.style.maxWidth = '420px';
        toast.style.padding = '0.75rem 1rem';
        toast.style.borderRadius = '8px';
        toast.style.boxShadow = '0 8px 20px rgba(0,0,0,0.2)';
        toast.style.color = '#fff';
        toast.style.fontWeight = '600';
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-8px)';
        toast.style.transition = 'opacity 160ms ease, transform 160ms ease';
        toast.style.backgroundColor = type === 'error' ? '#c62828' : '#2e7d32';

        container.appendChild(toast);

        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-8px)';
            setTimeout(() => {
                toast.remove();
            }, 180);
        }, 3000);
    },

    formatDate(date) {
        return new Date(date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    },

    formatTime(date) {
        return new Date(date).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    // ===== ROLE PICKER =====
    showRolePicker() {
        const grid = document.getElementById('role-picker-grid');
        if (grid) {
            const roles = [
                { id: 'team-owner', label: 'Team Owner', icon: '\uD83C\uDFE2', color: '#FF4444', description: 'Build and manage a racing team. Hire drivers, buy cars, attract sponsors, and dominate the championship.' },
                { id: 'driver', label: 'Driver', icon: '\uD83C\uDFCE\uFE0F', color: '#00D9FF', description: 'Live your racing career. Track performance, manage contracts, grow sponsors, and climb the standings.' },
                { id: 'crew-chief', label: 'Crew Chief', icon: '\uD83D\uDEE0\uFE0F', color: '#FFD700', description: 'Lead the technical race weekend. Set strategy, manage car setups, and keep your drivers on the podium.' },
                { id: 'mechanic', label: 'Mechanic', icon: '\uD83D\uDD27', color: '#00C853', description: 'Keep cars race-ready. Service vehicles, log maintenance, and ensure peak mechanical performance.' },
                { id: 'agent', label: 'Agent', icon: '\uD83E\uDD1D', color: '#FF9800', description: 'Represent drivers and teams. Negotiate contracts, manage commissions, and grow your client roster.' },
                { id: 'sponsor', label: 'Sponsor', icon: '\uD83D\uDCB0', color: '#9C27B0', description: 'Invest in racing. Manage your sponsorship portfolio, track performance data, and maximize ROI.' },
                { id: 'series-owner', label: 'Series Owner', icon: '\uD83C\uDFC6', color: '#E91E63', description: 'Run the championship. Build the race calendar, write rules, manage participants, and crown the champion.' },
                { id: 'track-owner', label: 'Track Owner', icon: '\uD83C\uDFC1', color: '#607D8B', description: 'Own and operate race venues. Schedule events and host championship rounds at your tracks.' }
            ];
            const activeRole = window.AppSession?.activeRole || null;
            grid.innerHTML = roles.map((role) => `
                <button class="role-picker-card${activeRole === role.id ? ' role-picker-card-active' : ''}"
                        style="--role-color:${role.color};"
                        onclick="switchActiveRole('${role.id}')"
                        type="button">
                    <div class="role-picker-icon">${role.icon}</div>
                    <div class="role-picker-label">${role.label}</div>
                    <p class="role-picker-desc">${role.description}</p>
                    ${activeRole === role.id ? '<span class="role-picker-current">Current Role</span>' : ''}
                </button>
            `).join('');
        }
        this.showModal('role-picker-modal');
    },

    // ===== MEMBER WORKSPACE =====
    async loadMemberWorkspace() {
        const content = document.getElementById('member-workspace-content');
        const titleEl = document.getElementById('member-workspace-title');
        const subtitleEl = document.getElementById('member-workspace-subtitle');
        if (!content) return;

        const role = window.AppSession?.activeRole;
        const uid = window.AppSession?.memberUid;

        if (!role) {
            if (titleEl) titleEl.textContent = 'My Workspace';
            content.innerHTML = '<div class="empty-state" style="padding:4rem 2rem;"><p style="font-size:1.4rem;margin-bottom:1rem;">No role selected</p><p style="margin-bottom:1.5rem;color:var(--text-secondary);">Choose a career path to unlock your personalized workspace.</p><button class="btn btn-primary" onclick="UI.showRolePicker()">Choose a Role</button></div>';
            return;
        }

        const roleLabels = {
            'team-owner': 'Team Owner', 'driver': 'Driver', 'crew-chief': 'Crew Chief',
            'mechanic': 'Mechanic', 'agent': 'Agent', 'sponsor': 'Sponsor',
            'series-owner': 'Series Owner', 'track-owner': 'Track Owner'
        };
        if (titleEl) titleEl.textContent = (roleLabels[role] || 'Workspace') + ' Workspace';
        content.innerHTML = '<div class="empty-state">Loading&hellip;</div>';

        try {
            switch (role) {
                case 'team-owner': await this._loadTeamOwnerWorkspace(uid, content, subtitleEl); break;
                case 'driver': await this._loadDriverRoleWorkspace(uid, content, subtitleEl); break;
                case 'crew-chief': await this._loadCrewChiefWorkspace(uid, content, subtitleEl); break;
                case 'mechanic': await this._loadMechanicWorkspace(uid, content, subtitleEl); break;
                case 'agent': await this._loadAgentWorkspace(uid, content, subtitleEl); break;
                case 'sponsor': await this._loadSponsorWorkspace(uid, content, subtitleEl); break;
                case 'series-owner': await this._loadSeriesOwnerWorkspace(uid, content, subtitleEl); break;
                case 'track-owner': await this._loadTrackOwnerWorkspace(uid, content, subtitleEl); break;
                default: content.innerHTML = '<p class="empty-state">Unknown role.</p>';
            }
        } catch (err) {
            console.error('Error loading member workspace:', err);
            content.innerHTML = `<p class="empty-state">Could not load workspace: ${err.message}</p>`;
        }
    },

    _workspaceKpiBar(kpis) {
        return `<div class="member-workspace-kpis">${kpis.map(k => `<div class="stat-card"><div class="stat-value">${k.value}</div><div class="stat-label">${k.label}</div></div>`).join('')}</div>`;
    },

    _workspaceOnboard(icon, title, body, btnLabel, btnOnclick) {
        return `<div class="member-workspace-onboard card"><div class="card-header"><h3>${icon} ${title}</h3></div><div class="form" style="padding:1.5rem;"><p style="color:var(--text-secondary);margin-bottom:1.25rem;">${body}</p><button class="btn btn-primary" onclick="${btnOnclick}">${btnLabel}</button></div></div>`;
    },

    async _loadTeamOwnerWorkspace(uid, content, subtitleEl) {
        if (subtitleEl) subtitleEl.textContent = 'Your teams, cars, drivers, and budget';
        const [allTeams, allDrivers, allSponsors] = await Promise.all([
            Database.teams.getAll(),
            Database.drivers.getAll(),
            Database.sponsorships.getAll()
        ]);
        const myTeams = allTeams.filter(t => t.ownerUid === uid || t.createdByUid === uid);
        const myTeamIds = new Set(myTeams.map(t => t.id));
        const myDrivers = allDrivers.filter(d => myTeamIds.has(d.teamId));
        const mySponsors = allSponsors.filter(s => myTeamIds.has(s.teamId));
        const totalWins = myTeams.reduce((s, t) => s + (t.stats?.totalWins || 0), 0);
        const totalPts = myTeams.reduce((s, t) => s + (t.stats?.totalPoints || 0), 0);

        content.innerHTML = this._workspaceKpiBar([
            { value: myTeams.length, label: 'Teams Owned' },
            { value: myDrivers.length, label: 'Drivers Under Contract' },
            { value: mySponsors.length, label: 'Active Sponsor Deals' },
            { value: totalWins, label: 'Total Team Wins' },
            { value: totalPts, label: 'Championship Points' }
        ]) + (myTeams.length === 0
            ? this._workspaceOnboard('\uD83C\uDFE2', 'Welcome, Team Owner', 'You don\'t own any teams yet. Create your first team to start building your racing empire.', '+ Create Your First Team', 'document.getElementById(\'add-team-btn\').click()')
            : `<div class="member-workspace-grid">
                <div class="card"><div class="card-header"><h3>My Teams (${myTeams.length})</h3></div><div class="form" style="padding:1rem;">${myTeams.map(t => `<div class="moderation-item"><div class="moderation-item-header"><div><p class="moderation-title" style="color:${t.color}">${t.name}</p><p class="moderation-meta">${t.stats?.drivers || 0} drivers &bull; ${t.stats?.totalWins || 0} wins &bull; ${t.stats?.totalPoints || 0} pts</p></div><span class="status-pill status-${t.status || 'approved'}">${t.status || 'active'}</span></div><div class="card-actions" style="padding:0;border:none;"><button type="button" onclick="UI.viewTeam('${t.id}')">View</button><button type="button" onclick="UI.editTeam('${t.id}')">Manage</button></div></div>`).join('')}</div></div>
                <div class="card"><div class="card-header"><h3>My Drivers (${myDrivers.length})</h3></div><div class="form" style="padding:1rem;">${myDrivers.length === 0 ? '<p class="empty-state">No drivers on your teams yet.</p>' : myDrivers.map(d => `<div class="moderation-item"><div class="moderation-item-header"><div><p class="moderation-title">${d.name}${d.number ? ' #' + d.number : ''}</p><p class="moderation-meta">${d.stats?.totalPoints || 0} pts &bull; ${d.stats?.wins || 0} wins &bull; ${d.country || ''}</p></div><span class="status-pill status-${d.status || 'approved'}">${d.status || 'active'}</span></div></div>`).join('')}</div></div>
                <div class="card"><div class="card-header"><h3>Sponsor Deals (${mySponsors.length})</h3></div><div class="form" style="padding:1rem;">${mySponsors.length === 0 ? '<p class="empty-state">No sponsor deals on your teams.</p>' : mySponsors.map(s => `<div class="moderation-item"><div class="moderation-item-header"><div><p class="moderation-title">${s.companyName}</p><p class="moderation-meta">Base/Race: ${this.formatCurrency(s.payoutModel?.basePerRace || 0)}</p></div><span class="status-pill status-${s.status === 'active' ? 'approved' : s.status === 'pending' ? 'pending' : 'rejected'}">${s.status}</span></div></div>`).join('')}</div></div>
            </div>`);
    },

    async _loadDriverRoleWorkspace(uid, content, subtitleEl) {
        if (subtitleEl) subtitleEl.textContent = 'Your career, sponsors, race entries, and performance';
        const [allDrivers, allTeams, allSponsors, allRaces] = await Promise.all([
            Database.drivers.getAll(),
            Database.teams.getAll(),
            Database.sponsorships.getAll(),
            Database.races.getAll()
        ]);
        const claimedId = window.AppSession?.claimedDriverId || '';
        const myDriver = allDrivers.find(d => d.id === claimedId || d.ownerUid === uid);
        const myTeam = myDriver?.teamId ? allTeams.find(t => t.id === myDriver.teamId) : null;
        const mySponsors = allSponsors.filter(s => s.driverId === myDriver?.id);
        const upcomingRaces = allRaces.filter(r => r.status === 'scheduled').slice(0, 3);

        if (!myDriver) {
            content.innerHTML = this._workspaceOnboard('\uD83C\uDFCE\uFE0F', 'Welcome, Driver', 'You haven\'t claimed a driver profile yet. Set your driver in your user profile, or create one from the Drivers page.', 'Go to Driver List', 'UI.switchView(\'drivers\')');
            return;
        }

        content.innerHTML = this._workspaceKpiBar([
            { value: myDriver.stats?.totalPoints || 0, label: 'Season Points' },
            { value: myDriver.stats?.wins || myDriver.stats?.totalWins || 0, label: 'Career Wins' },
            { value: myDriver.stats?.podiums || myDriver.stats?.totalPodiums || 0, label: 'Podiums' },
            { value: mySponsors.length, label: 'Active Sponsors' },
            { value: myTeam?.name || 'Free Agent', label: 'Current Team' }
        ]) + `<div class="member-workspace-grid">
            <div class="card"><div class="card-header"><h3>\uD83C\uDFCE\uFE0F Driver Profile</h3></div><div class="form" style="padding:1rem;">
                <div class="stat-row"><span class="stat-label">Name</span><span class="stat-value">${myDriver.name}${myDriver.number ? ' #' + myDriver.number : ''}</span></div>
                <div class="stat-row"><span class="stat-label">Team</span><span class="stat-value">${myTeam?.name || 'Free Agent'}</span></div>
                <div class="stat-row"><span class="stat-label">Country</span><span class="stat-value">${myDriver.country || '—'}</span></div>
                <div class="stat-row"><span class="stat-label">Races</span><span class="stat-value">${myDriver.stats?.racesEntered || 0}</span></div>
                <div class="stat-row"><span class="stat-label">Best Finish</span><span class="stat-value">${myDriver.stats?.bestFinish || '—'}</span></div>
                <div class="card-actions" style="padding:0;border:none;margin-top:0.5rem;"><button type="button" onclick="UI.editDriverModal('${myDriver.id}')">Edit Profile</button></div>
            </div></div>
            <div class="card"><div class="card-header"><h3>\uD83D\uDCB0 Active Sponsors (${mySponsors.length})</h3></div><div class="form" style="padding:1rem;">${mySponsors.length === 0 ? '<p class="empty-state">No active sponsor deals.</p>' : mySponsors.map(s => `<div class="moderation-item"><div class="moderation-item-header"><div><p class="moderation-title">${s.companyName}</p><p class="moderation-meta">Base: ${this.formatCurrency(s.payoutModel?.basePerRace || 0)}/race | Win: +${this.formatCurrency(s.payoutModel?.winBonus || 0)}</p></div><span class="status-pill status-${s.status === 'active' ? 'approved' : 'pending'}">${s.status}</span></div></div>`).join('')}</div></div>
            <div class="card"><div class="card-header"><h3>\uD83C\uDFC1 Upcoming Races (${upcomingRaces.length})</h3></div><div class="form" style="padding:1rem;">${upcomingRaces.length === 0 ? '<p class="empty-state">No upcoming races scheduled.</p>' : upcomingRaces.map(r => `<div class="moderation-item"><div class="moderation-item-header"><div><p class="moderation-title">${r.name}</p><p class="moderation-meta">${this.normalizeDate(r.date).toLocaleDateString()} &bull; ${r.track || 'TBA'} &bull; ${r.game}</p></div></div><div class="card-actions" style="padding:0;border:none;"><button type="button" onclick="UI.openRaceDetails('${r.id}')">View & Sign Up</button></div></div>`).join('')}</div></div>
        </div>`;
    },

    async _loadCrewChiefWorkspace(uid, content, subtitleEl) {
        if (subtitleEl) subtitleEl.textContent = 'Your assigned drivers, setups, and race strategies';
        const myProfiles = await Database.crewChiefs.getByUser(uid);
        if (myProfiles.length === 0) {
            content.innerHTML = this._workspaceOnboard('\uD83D\uDEE0\uFE0F', 'Welcome, Crew Chief', 'You haven\'t created a crew chief profile yet. Ask the Game Master to assign you, or create your profile below.', '+ Create Crew Chief Profile', 'UI._createRoleEntityModal("crew-chief")');
            return;
        }
        const profile = myProfiles[0];
        const [allDrivers, allTeams] = await Promise.all([Database.drivers.getAll(), Database.teams.getAll()]);
        const assignedDrivers = allDrivers.filter(d => (profile.assignedDriverIds || []).includes(d.id));
        const myTeam = profile.assignedTeamId ? allTeams.find(t => t.id === profile.assignedTeamId) : null;
        content.innerHTML = this._workspaceKpiBar([
            { value: assignedDrivers.length, label: 'Assigned Drivers' },
            { value: myTeam?.name || 'Unassigned', label: 'Team' },
            { value: profile.specialty || 'General', label: 'Specialty' },
            { value: profile.experience || 0, label: 'Seasons Experience' }
        ]) + `<div class="member-workspace-grid">
            <div class="card"><div class="card-header"><h3>\uD83D\uDEE0\uFE0F My Profile</h3></div><div class="form" style="padding:1rem;">
                <div class="stat-row"><span class="stat-label">Name</span><span class="stat-value">${profile.name}</span></div>
                <div class="stat-row"><span class="stat-label">Specialty</span><span class="stat-value">${profile.specialty || 'General'}</span></div>
                <div class="stat-row"><span class="stat-label">Team</span><span class="stat-value">${myTeam?.name || 'Unassigned'}</span></div>
                ${profile.bio ? `<p style="color:var(--text-secondary);margin-top:0.5rem;">${profile.bio}</p>` : ''}
            </div></div>
            <div class="card"><div class="card-header"><h3>\uD83C\uDFCE\uFE0F Assigned Drivers (${assignedDrivers.length})</h3></div><div class="form" style="padding:1rem;">${assignedDrivers.length === 0 ? '<p class="empty-state">No drivers assigned yet.</p>' : assignedDrivers.map(d => `<div class="moderation-item"><div class="moderation-item-header"><div><p class="moderation-title">${d.name}${d.number ? ' #' + d.number : ''}</p><p class="moderation-meta">${d.stats?.totalPoints || 0} pts &bull; ${d.stats?.wins || 0} wins</p></div></div></div>`).join('')}</div></div>
            <div class="card"><div class="card-header"><h3>\uD83D\uDCDD Strategy Notes</h3></div><div class="form" style="padding:1rem;"><p style="color:var(--text-secondary);">${profile.notes || 'No strategy notes yet. Add notes for upcoming race weekends.'}</p></div></div>
        </div>`;
    },

    async _loadMechanicWorkspace(uid, content, subtitleEl) {
        if (subtitleEl) subtitleEl.textContent = 'Your assigned cars, maintenance queue, and service logs';
        const myProfiles = await Database.mechanics.getByUser(uid);
        if (myProfiles.length === 0) {
            content.innerHTML = this._workspaceOnboard('\uD83D\uDD27', 'Welcome, Mechanic', 'You haven\'t set up a mechanic profile yet. Create your profile to start tracking car assignments and service work.', '+ Create Mechanic Profile', 'UI._createRoleEntityModal("mechanic")');
            return;
        }
        const profile = myProfiles[0];
        const [allCars, allTeams] = await Promise.all([Database.cars.getAll(), Database.teams.getAll()]);
        const assignedCars = allCars.filter(c => (profile.assignedCarIds || []).includes(c.id));
        const myTeam = profile.assignedTeamId ? allTeams.find(t => t.id === profile.assignedTeamId) : null;
        content.innerHTML = this._workspaceKpiBar([
            { value: assignedCars.length, label: 'Cars Assigned' },
            { value: myTeam?.name || 'Unassigned', label: 'Team' },
            { value: profile.specialty || 'General', label: 'Specialty' },
            { value: profile.experience || 0, label: 'Seasons Experience' }
        ]) + `<div class="member-workspace-grid">
            <div class="card"><div class="card-header"><h3>\uD83D\uDD27 My Profile</h3></div><div class="form" style="padding:1rem;">
                <div class="stat-row"><span class="stat-label">Name</span><span class="stat-value">${profile.name}</span></div>
                <div class="stat-row"><span class="stat-label">Specialty</span><span class="stat-value">${profile.specialty || 'General'}</span></div>
                <div class="stat-row"><span class="stat-label">Team</span><span class="stat-value">${myTeam?.name || 'Unassigned'}</span></div>
            </div></div>
            <div class="card"><div class="card-header"><h3>\uD83D\uDE97 Assigned Cars (${assignedCars.length})</h3></div><div class="form" style="padding:1rem;">${assignedCars.length === 0 ? '<p class="empty-state">No cars assigned yet.</p>' : assignedCars.map(c => `<div class="moderation-item"><div class="moderation-item-header"><div><p class="moderation-title">${c.name}</p><p class="moderation-meta">${c.gameKey} &bull; ${this.formatCurrency(c.price || 0)}</p></div></div></div>`).join('')}</div></div>
            <div class="card"><div class="card-header"><h3>\uD83D\uDCCB Service Queue</h3></div><div class="form" style="padding:1rem;"><p class="empty-state">No open service items. All cars are race-ready!</p></div></div>
        </div>`;
    },

    async _loadAgentWorkspace(uid, content, subtitleEl) {
        if (subtitleEl) subtitleEl.textContent = 'Your clients, contracts, and commissions';
        const myProfiles = await Database.agents.getByUser(uid);
        if (myProfiles.length === 0) {
            content.innerHTML = this._workspaceOnboard('\uD83E\uDD1D', 'Welcome, Agent', 'You haven\'t set up an agent profile yet. Create your profile to start representing drivers and teams.', '+ Create Agent Profile', 'UI._createRoleEntityModal("agent")');
            return;
        }
        const profile = myProfiles[0];
        const [allDrivers, allTeams, allSponsors] = await Promise.all([
            Database.drivers.getAll(), Database.teams.getAll(), Database.sponsorships.getAll()
        ]);
        const clientDrivers = allDrivers.filter(d => (profile.clientDriverIds || []).includes(d.id));
        const clientTeams = allTeams.filter(t => (profile.clientTeamIds || []).includes(t.id));
        const relevantContracts = allSponsors.filter(s => (profile.clientDriverIds || []).includes(s.driverId));
        const totalContractValue = relevantContracts.reduce((s, c) => s + ((c.payoutModel?.basePerRace || 0) * 12), 0);
        content.innerHTML = this._workspaceKpiBar([
            { value: clientDrivers.length, label: 'Driver Clients' },
            { value: clientTeams.length, label: 'Team Clients' },
            { value: relevantContracts.length, label: 'Managed Contracts' },
            { value: profile.commissionPct + '%', label: 'Commission Rate' },
            { value: this.formatCurrency(Math.round(totalContractValue * (profile.commissionPct / 100))), label: 'Est. Annual Commission' }
        ]) + `<div class="member-workspace-grid">
            <div class="card"><div class="card-header"><h3>\uD83C\uDFCE\uFE0F Driver Clients (${clientDrivers.length})</h3></div><div class="form" style="padding:1rem;">${clientDrivers.length === 0 ? '<p class="empty-state">No driver clients yet.</p>' : clientDrivers.map(d => `<div class="moderation-item"><div class="moderation-item-header"><div><p class="moderation-title">${d.name}</p><p class="moderation-meta">${d.stats?.totalPoints || 0} pts &bull; ${d.country || ''}</p></div></div></div>`).join('')}</div></div>
            <div class="card"><div class="card-header"><h3>\uD83C\uDFE2 Team Clients (${clientTeams.length})</h3></div><div class="form" style="padding:1rem;">${clientTeams.length === 0 ? '<p class="empty-state">No team clients yet.</p>' : clientTeams.map(t => `<div class="moderation-item"><div class="moderation-item-header"><div><p class="moderation-title" style="color:${t.color}">${t.name}</p><p class="moderation-meta">${t.stats?.totalWins || 0} wins</p></div></div></div>`).join('')}</div></div>
            <div class="card"><div class="card-header"><h3>\uD83D\uDCC4 Active Sponsorship Deals (${relevantContracts.length})</h3></div><div class="form" style="padding:1rem;">${relevantContracts.length === 0 ? '<p class="empty-state">No sponsorship deals for your clients.</p>' : relevantContracts.map(s => `<div class="moderation-item"><div class="moderation-item-header"><div><p class="moderation-title">${s.companyName}</p><p class="moderation-meta">Base/Race: ${this.formatCurrency(s.payoutModel?.basePerRace || 0)}</p></div><span class="status-pill status-${s.status === 'active' ? 'approved' : 'pending'}">${s.status}</span></div></div>`).join('')}</div></div>
        </div>`;
    },

    async _loadSponsorWorkspace(uid, content, subtitleEl) {
        if (subtitleEl) subtitleEl.textContent = 'Your sponsorship portfolio, deal performance, and ROI';
        const myCompanies = await Database.sponsorCompanies.getByUser(uid);
        const allSponsors = await Database.sponsorships.getAll();
        const myCompanyNames = new Set(myCompanies.map(c => c.companyName?.toLowerCase()));
        const myDeals = allSponsors.filter(s => myCompanies.some(c => c.companyName === s.companyName) || s.sponsorUserId === uid);
        const totalValue = myDeals.reduce((s, d) => s + ((d.payoutModel?.basePerRace || 0) * 12), 0);

        if (myCompanies.length === 0) {
            content.innerHTML = this._workspaceOnboard('\uD83D\uDCB0', 'Welcome, Sponsor', 'You haven\'t created a sponsor company profile yet. Register your company to start managing sponsorship investments.', '+ Register Sponsor Company', 'UI._createRoleEntityModal("sponsor")');
            return;
        }
        content.innerHTML = this._workspaceKpiBar([
            { value: myCompanies.length, label: 'Companies' },
            { value: myDeals.length, label: 'Active Deals' },
            { value: this.formatCurrency(totalValue), label: 'Est. Annual Exposure' },
            { value: myCompanies.reduce((s, c) => s + (c.totalBudget || 0), 0) > 0 ? this.formatCurrency(myCompanies.reduce((s, c) => s + (c.totalBudget || 0), 0)) : '—', label: 'Total Budget' }
        ]) + `<div class="member-workspace-grid">
            <div class="card"><div class="card-header"><h3>\uD83C\uDFE2 My Companies (${myCompanies.length})</h3></div><div class="form" style="padding:1rem;">${myCompanies.map(c => `<div class="moderation-item"><div class="moderation-item-header"><div><p class="moderation-title">${c.companyName}</p><p class="moderation-meta">${c.industry || ''} &bull; Budget: ${this.formatCurrency(c.totalBudget || 0)}</p></div><span class="status-pill status-approved">${c.status || 'active'}</span></div></div>`).join('')}</div></div>
            <div class="card"><div class="card-header"><h3>\uD83D\uDCC4 My Deals (${myDeals.length})</h3></div><div class="form" style="padding:1rem;">${myDeals.length === 0 ? '<p class="empty-state">No active sponsorship deals.</p>' : myDeals.map(s => `<div class="moderation-item"><div class="moderation-item-header"><div><p class="moderation-title">${s.companyName}</p><p class="moderation-meta">Base/Race: ${this.formatCurrency(s.payoutModel?.basePerRace || 0)} &bull; Win Bonus: ${this.formatCurrency(s.payoutModel?.winBonus || 0)}</p></div><span class="status-pill status-${s.status === 'active' ? 'approved' : 'pending'}">${s.status}</span></div></div>`).join('')}</div></div>
        </div>`;
    },

    async _loadSeriesOwnerWorkspace(uid, content, subtitleEl) {
        if (subtitleEl) subtitleEl.textContent = 'Your racing series, season calendar, and standings';
        const mySeries = await Database.series.getByUser(uid);
        if (mySeries.length === 0) {
            content.innerHTML = this._workspaceOnboard('\uD83C\uDFC6', 'Welcome, Series Owner', 'You don\'t own any racing series yet. Create your first series to set up a championship, define the rule book, and invite drivers.', '+ Create Racing Series', 'UI._createRoleEntityModal("series")');
            return;
        }
        const allRaces = await Database.races.getAll();
        const totalParticipants = mySeries.reduce((s, sr) => s + (sr.registeredDriverIds?.length || 0), 0);
        content.innerHTML = this._workspaceKpiBar([
            { value: mySeries.length, label: 'Series Owned' },
            { value: totalParticipants, label: 'Total Participants' },
            { value: allRaces.filter(r => r.status === 'scheduled').length, label: 'Scheduled Races' },
            { value: allRaces.filter(r => r.status === 'completed').length, label: 'Completed Races' }
        ]) + `<div class="member-workspace-grid">
            ${mySeries.map(sr => `
            <div class="card"><div class="card-header"><h3>\uD83C\uDFC6 ${sr.name}</h3><span class="badge-new">${sr.season}</span></div><div class="form" style="padding:1rem;">
                <div class="stat-row"><span class="stat-label">Season</span><span class="stat-value">${sr.season}</span></div>
                <div class="stat-row"><span class="stat-label">Points System</span><span class="stat-value">${sr.pointsSystem?.toUpperCase() || 'F1'}</span></div>
                <div class="stat-row"><span class="stat-label">Max Participants</span><span class="stat-value">${sr.maxParticipants || 30}</span></div>
                <div class="stat-row"><span class="stat-label">Registered</span><span class="stat-value">${sr.registeredDriverIds?.length || 0}</span></div>
                ${sr.description ? `<p style="color:var(--text-secondary);margin-top:0.75rem;">${sr.description}</p>` : ''}
                ${sr.ruleSet ? `<div style="margin-top:0.75rem;"><p style="color:var(--text-secondary);font-size:0.85rem;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Rule Book</p><p style="color:var(--text-secondary);margin-top:0.25rem;white-space:pre-line;">${sr.ruleSet}</p></div>` : ''}
            </div></div>
            `).join('')}
            <div class="card"><div class="card-header"><h3>\uD83D\uDCC5 Race Calendar</h3></div><div class="form" style="padding:1rem;">${allRaces.filter(r => r.status === 'scheduled').slice(0, 5).map(r => `<div class="moderation-item"><div class="moderation-item-header"><div><p class="moderation-title">${r.name}</p><p class="moderation-meta">${this.normalizeDate(r.date).toLocaleDateString()} &bull; ${r.track || 'TBA'}</p></div></div></div>`).join('') || '<p class="empty-state">No scheduled races.</p>'}</div></div>
        </div>`;
    },

    async _loadTrackOwnerWorkspace(uid, content, subtitleEl) {
        if (subtitleEl) subtitleEl.textContent = 'Your venues, hosted events, and track operations';
        const myTracks = await Database.tracks.getByUser(uid);
        if (myTracks.length === 0) {
            content.innerHTML = this._workspaceOnboard('\uD83C\uDFC1', 'Welcome, Track Owner', 'You don\'t own any tracks yet. Register your first venue to start hosting race events and managing your circuit portfolio.', '+ Register a Track', 'UI._createRoleEntityModal("track")');
            return;
        }
        const allRaces = await Database.races.getAll();
        const trackNames = new Set(myTracks.map(t => t.name?.toLowerCase()));
        const hostedRaces = allRaces.filter(r => trackNames.has((r.track || '').toLowerCase()));
        content.innerHTML = this._workspaceKpiBar([
            { value: myTracks.length, label: 'Venues Owned' },
            { value: hostedRaces.length, label: 'Total Events Hosted' },
            { value: hostedRaces.filter(r => r.status === 'scheduled').length, label: 'Upcoming Races' },
            { value: myTracks.reduce((s, t) => s + (t.maxParticipants || 0), 0), label: 'Total Capacity' }
        ]) + `<div class="member-workspace-grid">
            ${myTracks.map(t => `
            <div class="card"><div class="card-header"><h3>\uD83C\uDFC1 ${t.name}</h3></div><div class="form" style="padding:1rem;">
                <div class="stat-row"><span class="stat-label">Country</span><span class="stat-value">${t.country || '—'}</span></div>
                <div class="stat-row"><span class="stat-label">Layout</span><span class="stat-value">${t.layout || 'Circuit'}</span></div>
                <div class="stat-row"><span class="stat-label">Length</span><span class="stat-value">${t.lengthMiles ? t.lengthMiles + ' mi' : '—'}</span></div>
                <div class="stat-row"><span class="stat-label">Corners</span><span class="stat-value">${t.corners || '—'}</span></div>
                <div class="stat-row"><span class="stat-label">Capacity</span><span class="stat-value">${t.maxParticipants || '—'}</span></div>
                ${t.features?.length ? `<p style="color:var(--text-secondary);font-size:0.82rem;margin-top:0.5rem;">${t.features.join(' &bull; ')}</p>` : ''}
            </div></div>
            `).join('')}
            <div class="card"><div class="card-header"><h3>\uD83D\uDCC5 Hosted Races (${hostedRaces.length})</h3></div><div class="form" style="padding:1rem;">${hostedRaces.slice(0, 6).map(r => `<div class="moderation-item"><div class="moderation-item-header"><div><p class="moderation-title">${r.name}</p><p class="moderation-meta">${this.normalizeDate(r.date).toLocaleDateString()} &bull; ${r.track}</p></div><span class="status-pill status-${r.status === 'completed' ? 'approved' : 'pending'}">${r.status}</span></div></div>`).join('') || '<p class="empty-state">No races at your venues yet.</p>'}</div></div>
        </div>`;
    },

    // ===== ROLE ENTITY CREATION MODAL (PLACEHOLDER) =====
    _createRoleEntityModal(entityType) {
        const labels = {
            'crew-chief': 'Crew Chief', 'mechanic': 'Mechanic', 'agent': 'Agent',
            'sponsor': 'Sponsor Company', 'series': 'Racing Series', 'track': 'Track / Venue'
        };
        const label = labels[entityType] || entityType;
        this.showNotification(`To create a ${label} profile, ask your Game Master to set this up for you, or contact support.`, 'info');
    }
};

window.UI = UI;
