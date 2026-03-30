// UI Management and Interactions

const UI = {
    // Track current view
    currentView: 'dashboard',
    currentMonth: new Date(),

    // ===== VIEW MANAGEMENT =====
    switchView(viewName) {
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
            case 'sponsors':
                this.loadSponsors();
                break;
            case 'teams':
                this.loadTeams();
                break;
        }
    },

    // ===== MODAL MANAGEMENT =====
    showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    },

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = 'auto';
        }
    },

    closeAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.remove('active');
        });
        document.body.style.overflow = 'auto';
    },

    // ===== DASHBOARD =====
    async loadDashboard() {
        try {
            // Load stats
            const drivers = await Database.drivers.getAll();
            const teams = await Database.teams.getAll();
            const races = await Database.races.getAll();
            const upcomingRaces = await Database.races.getUpcoming();

            document.getElementById('total-drivers').textContent = drivers.length;
            document.getElementById('total-teams').textContent = teams.length;
            document.getElementById('races-completed').textContent = races.filter(r => r.status === 'completed').length;

            // Next race
            if (upcomingRaces.length > 0) {
                const nextRace = upcomingRaces[0];
                const daysUntil = Math.ceil((new Date(nextRace.date) - new Date()) / (1000 * 60 * 60 * 24));
                document.getElementById('next-race-days').textContent = daysUntil + ' days';
            }

            // Upcoming events
            const eventsContainer = document.getElementById('upcoming-events');
            eventsContainer.innerHTML = '';
            if (upcomingRaces.length > 0) {
                upcomingRaces.slice(0, 5).forEach(race => {
                    const eventEl = document.createElement('div');
                    eventEl.className = 'race-item';
                    eventEl.innerHTML = `
                        <div class="race-title">${race.name}</div>
                        <div class="race-details">
                            <div class="race-detail">
                                <span class="race-detail-label">📅</span>
                                <span class="race-detail-value">${new Date(race.date).toLocaleDateString()}</span>
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
                    `;
                    eventsContainer.appendChild(eventEl);
                });
            } else {
                eventsContainer.innerHTML = '<p class="empty-state">No upcoming races</p>';
            }
        } catch (error) {
            console.error('Error loading dashboard:', error);
        }
    },

    // ===== DRIVERS =====
    async loadDrivers() {
        try {
            const drivers = await Database.drivers.getAll();
            const driversGrid = document.getElementById('drivers-grid');
            driversGrid.innerHTML = '';

            if (drivers.length === 0) {
                driversGrid.innerHTML = '<div class="empty-state">No drivers yet. Create your first driver to get started!</div>';
                return;
            }

            drivers.forEach(driver => {
                const driverCard = this.createDriverCard(driver);
                driversGrid.appendChild(driverCard);
            });

            // Update team filter
            const teams = await Database.teams.getAll();
            const teamFilter = document.getElementById('team-filter');
            teamFilter.innerHTML = '<option value="">All Teams</option>';
            teams.forEach(team => {
                const option = document.createElement('option');
                option.value = team.id;
                option.textContent = team.name;
                teamFilter.appendChild(option);
            });
        } catch (error) {
            console.error('Error loading drivers:', error);
        }
    },

    createDriverCard(driver) {
        const card = document.createElement('div');
        card.className = 'driver-card';
        card.innerHTML = `
            <div class="driver-header">
                <div>
                    ${driver.number ? `<div class="driver-number">#${driver.number}</div>` : ''}
                    <div class="driver-name">${driver.name}</div>
                    ${driver.teamId ? `<div class="driver-team">Team TBD</div>` : ''}
                    ${driver.country ? `<div class="driver-country">${driver.country}</div>` : ''}
                </div>
            </div>
            <div class="driver-stats">
                <div class="stat-row">
                    <span class="stat-label">Races</span>
                    <span class="stat-value">${driver.stats?.racesCompleted || 0}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Wins</span>
                    <span class="stat-value">${driver.stats?.wins || 0}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Podiums</span>
                    <span class="stat-value">${driver.stats?.podiums || 0}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Points</span>
                    <span class="stat-value">${driver.stats?.totalPoints || 0}</span>
                </div>
            </div>
            <div class="card-actions">
                <button onclick="UI.editDriver('${driver.id}')">Edit</button>
                <button onclick="UI.viewDriver('${driver.id}')">View</button>
                <button onclick="UI.deleteDriver('${driver.id}')">Delete</button>
            </div>
        `;
        return card;
    },

    async editDriver(driverId) {
        try {
            const driver = await Database.drivers.getById(driverId);
            if (!driver) {
                this.showNotification('Driver not found', 'error');
                return;
            }

            // Store current driver ID for save handler
            window.currentEditingDriverId = driverId;

            // Populate form
            document.getElementById('edit-driver-name').value = driver.name;
            document.getElementById('edit-driver-number').value = driver.number || '';
            document.getElementById('edit-driver-country').value = driver.country || '';
            document.getElementById('edit-driver-description').value = driver.bio || '';

            // Populate team select
            const teams = await Database.teams.getAll();
            const teamSelect = document.getElementById('edit-driver-team');
            teamSelect.innerHTML = '<option value="">No Team</option>';
            teams.forEach(team => {
                const option = document.createElement('option');
                option.value = team.id;
                option.textContent = team.name;
                if (driver.teamId === team.id) {
                    option.selected = true;
                }
                teamSelect.appendChild(option);
            });

            this.showModal('edit-driver-modal');
        } catch (error) {
            console.error('Error loading driver for edit:', error);
            this.showNotification('Error loading driver', 'error');
        }
    },

    async deleteDriver(driverId) {
        if (confirm('Are you sure you want to delete this driver?')) {
            try {
                await Database.drivers.delete(driverId);
                UI.loadDrivers();
                this.showNotification('Driver deleted successfully');
            } catch (error) {
                console.error('Error deleting driver:', error);
                this.showNotification('Error deleting driver', 'error');
            }
        }
    },

    async viewDriver(driverId) {
        try {
            const driver = await Database.drivers.getById(driverId);
            if (!driver) {
                this.showNotification('Driver not found', 'error');
                return;
            }

            // Get team info if available
            let teamName = 'No Team';
            if (driver.teamId) {
                const team = await Database.teams.getById(driver.teamId);
                teamName = team?.name || 'Unknown Team';
            }

            // Build HTML content
            const content = `
                <div style="padding: 1rem;">
                    <div class="stat-row" style="margin-bottom: 1rem; border: none;">
                        <span class="stat-label">Driver</span>
                        <span class="stat-value" style="font-size: 1.5rem;">${driver.name}</span>
                    </div>
                    ${driver.number ? `
                    <div class="stat-row">
                        <span class="stat-label">Number</span>
                        <span class="stat-value">#${driver.number}</span>
                    </div>
                    ` : ''}
                    <div class="stat-row">
                        <span class="stat-label">Team</span>
                        <span class="stat-value">${teamName}</span>
                    </div>
                    ${driver.country ? `
                    <div class="stat-row">
                        <span class="stat-label">Country</span>
                        <span class="stat-value">${driver.country}</span>
                    </div>
                    ` : ''}
                    <div class="stat-row">
                        <span class="stat-label">Races Completed</span>
                        <span class="stat-value">${driver.stats?.racesCompleted || 0}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Wins</span>
                        <span class="stat-value">${driver.stats?.wins || 0}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Podiums</span>
                        <span class="stat-value">${driver.stats?.podiums || 0}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Pole Positions</span>
                        <span class="stat-value">${driver.stats?.polePositions || 0}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">DNF (Did Not Finish)</span>
                        <span class="stat-value">${driver.stats?.dnf || 0}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Total Points</span>
                        <span class="stat-value">${driver.stats?.totalPoints || 0}</span>
                    </div>
                    ${driver.bio ? `
                    <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border-color);">
                        <p style="color: var(--text-secondary); margin-bottom: 0.5rem;">Bio</p>
                        <p>${driver.bio}</p>
                    </div>
                    ` : ''}
                </div>
            `;

            document.getElementById('view-driver-title').textContent = `${driver.name} - Career Stats`;
            document.getElementById('view-driver-content').innerHTML = content;
            this.showModal('view-driver-modal');
        } catch (error) {
            console.error('Error viewing driver:', error);
            this.showNotification('Error loading driver details', 'error');
        }
    },

    // ===== TEAMS =====
    async loadTeams() {
        try {
            const teams = await Database.teams.getAll();
            const teamsGrid = document.getElementById('teams-grid');
            teamsGrid.innerHTML = '';

            if (teams.length === 0) {
                teamsGrid.innerHTML = '<div class="empty-state">No teams yet. Create your first team!</div>';
                return;
            }

            teams.forEach(team => {
                const teamCard = this.createTeamCard(team);
                teamsGrid.appendChild(teamCard);
            });
        } catch (error) {
            console.error('Error loading teams:', error);
        }
    },

    createTeamCard(team) {
        const card = document.createElement('div');
        card.className = 'team-card';
        card.innerHTML = `
            <div class="team-header" style="background-color: ${team.color}20; border-left: 4px solid ${team.color}">
                <div class="team-badge" style="background-color: ${team.color}">T</div>
                <div class="team-name">${team.name}</div>
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
                <button onclick="UI.editTeam('${team.id}')">Edit</button>
                <button onclick="UI.viewTeam('${team.id}')">View</button>
                <button onclick="UI.deleteTeam('${team.id}')">Delete</button>
            </div>
        `;
        return card;
    },

    async editTeam(teamId) {
        try {
            const team = await Database.teams.getById(teamId);
            if (!team) {
                this.showNotification('Team not found', 'error');
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
            this.renderCalendar();
            const races = await Database.races.getAll();
            this.renderRacesList(races);
        } catch (error) {
            console.error('Error loading calendar:', error);
        }
    },

    renderCalendar() {
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
        for (let i = 1; i <= lastDay.getDate(); i++) {
            const day = document.createElement('div');
            day.className = 'calendar-day';
            day.textContent = i;

            if (year === today.getFullYear() && month === today.getMonth() && i === today.getDate()) {
                day.classList.add('today');
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

    async renderRacesList(races) {
        const racesList = document.getElementById('races-list');
        racesList.innerHTML = '';

        if (races.length === 0) {
            racesList.innerHTML = '<p class="empty-state">No races scheduled</p>';
            return;
        }

        // Sort races by date
        races.sort((a, b) => new Date(a.date) - new Date(b.date));

        races.forEach(race => {
            const raceEl = document.createElement('div');
            raceEl.className = 'race-item';
            raceEl.innerHTML = `
                <div class="race-title">${race.name}</div>
                <div class="race-details">
                    <div class="race-detail">
                        <span class="race-detail-label">📅</span>
                        <span class="race-detail-value">${new Date(race.date).toLocaleDateString()}</span>
                    </div>
                    <div class="race-detail">
                        <span class="race-detail-label">⏰</span>
                        <span class="race-detail-value">${new Date(race.date).toLocaleTimeString()}</span>
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
            `;
            racesList.appendChild(raceEl);
        });
    },

    // ===== SPONSORS =====
    async loadSponsors() {
        try {
            const sponsorsGrid = document.getElementById('sponsors-grid');
            // Placeholder — sponsors feature coming soon
            sponsorsGrid.innerHTML = `
                <div class="empty-state">
                    <p style="font-size:1.2rem; margin-bottom:0.5rem;">\ud83e\udd1d No sponsors yet</p>
                    <p style="color: var(--text-secondary);">Add sponsors to track partnerships, deals, and branding across your career.</p>
                </div>
            `;
        } catch (error) {
            console.error('Error loading sponsors:', error);
        }
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
    }
};
