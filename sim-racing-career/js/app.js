// Main Application File - Sim Racing Career Mode

// ===== APPLICATION INITIALIZATION =====
document.addEventListener('DOMContentLoaded', function() {
    console.log('Initializing Sim Racing Career Mode...');
    
    initializeEventListeners();
    loadDriverTeamOptions();
    toggleNewDriverTeamFields();
    UI.loadDashboard();
});

// ===== EVENT LISTENERS SETUP =====
function initializeEventListeners() {
    // Navigation buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const button = e.target.closest('.nav-btn');
            if (button) {
                const viewName = button.dataset.view;
                UI.switchView(viewName);
            }
        });
    });

    // Modal management
    setupModalHandlers();

    // Dashboard actions
    document.getElementById('quick-add-driver')?.addEventListener('click', async () => {
        await loadDriverTeamOptions();
        toggleNewDriverTeamFields();
        UI.showModal('add-driver-modal');
    });

    // Driver management
    document.getElementById('add-driver-btn')?.addEventListener('click', async () => {
        await loadDriverTeamOptions();
        toggleNewDriverTeamFields();
        UI.showModal('add-driver-modal');
    });

    document.getElementById('driver-form')?.addEventListener('submit', handleAddDriver);
    document.getElementById('driver-team')?.addEventListener('change', toggleNewDriverTeamFields);
    document.getElementById('cancel-driver')?.addEventListener('click', () => {
        UI.closeModal('add-driver-modal');
    });

    // Team management
    document.getElementById('add-team-btn')?.addEventListener('click', () => {
        UI.showModal('add-team-modal');
    });

    document.getElementById('team-form')?.addEventListener('submit', handleAddTeam);
    document.getElementById('cancel-team')?.addEventListener('click', () => {
        UI.closeModal('add-team-modal');
    });

    // Race management
    document.getElementById('add-race-btn')?.addEventListener('click', () => {
        UI.showModal('add-race-modal');
    });

    document.getElementById('race-form')?.addEventListener('submit', handleAddRace);
    document.getElementById('cancel-race')?.addEventListener('click', () => {
        UI.closeModal('add-race-modal');
    });

    // Calendar navigation
    document.getElementById('prev-month')?.addEventListener('click', () => {
        UI.currentMonth.setMonth(UI.currentMonth.getMonth() - 1);
        UI.renderCalendar();
    });

    document.getElementById('next-month')?.addEventListener('click', () => {
        UI.currentMonth.setMonth(UI.currentMonth.getMonth() + 1);
        UI.renderCalendar();
    });

    // Filters
    document.getElementById('driver-search')?.addEventListener('input', filterDrivers);
    document.getElementById('team-filter')?.addEventListener('change', filterDrivers);

    // Header actions
    document.getElementById('settings-btn')?.addEventListener('click', handleSettings);
    document.getElementById('user-btn')?.addEventListener('click', handleUserMenu);

    // Edit Driver Modal
    document.getElementById('edit-driver-form')?.addEventListener('submit', handleSaveEditDriver);
    document.getElementById('cancel-edit-driver')?.addEventListener('click', () => {
        UI.closeModal('edit-driver-modal');
    });

    // Edit Team Modal
    document.getElementById('edit-team-form')?.addEventListener('submit', handleSaveEditTeam);
    document.getElementById('cancel-edit-team')?.addEventListener('click', () => {
        UI.closeModal('edit-team-modal');
    });

    // Settings Modal
    document.getElementById('save-settings')?.addEventListener('click', handleSaveSettings);
    document.getElementById('close-settings')?.addEventListener('click', () => {
        UI.closeModal('settings-modal');
    });

    // User Profile Modal
    document.getElementById('save-profile')?.addEventListener('click', handleSaveProfile);
    document.getElementById('close-profile')?.addEventListener('click', () => {
        UI.closeModal('user-profile-modal');
    });

    // Sponsor management (placeholder)
    document.getElementById('add-sponsor-btn')?.addEventListener('click', () => {
        alert('Sponsor management coming soon!');
    });

    // Load saved settings on startup
    loadSavedSettings();
}

async function loadDriverTeamOptions() {
    const teamSelect = document.getElementById('driver-team');
    if (!teamSelect) return;

    const currentValue = teamSelect.value;

    teamSelect.innerHTML = `
        <option value="">No Team</option>
        <option value="__create_new__">+ Create New Team</option>
    `;

    try {
        const teams = await Database.teams.getAll();
        teams.forEach((team) => {
            const option = document.createElement('option');
            option.value = team.id;
            option.textContent = team.name;
            teamSelect.appendChild(option);
        });

        const hasCurrentValue = Array.from(teamSelect.options).some((opt) => opt.value === currentValue);
        teamSelect.value = hasCurrentValue ? currentValue : '';
    } catch (error) {
        console.error('Error loading teams for driver form:', error);
        teamSelect.value = '';
    }
}

function toggleNewDriverTeamFields() {
    const teamSelect = document.getElementById('driver-team');
    const teamNameGroup = document.getElementById('new-driver-team-name-group');
    const teamColorGroup = document.getElementById('new-driver-team-color-group');
    const teamNameInput = document.getElementById('new-driver-team-name');

    if (!teamSelect || !teamNameGroup || !teamColorGroup || !teamNameInput) return;

    const creatingNewTeam = teamSelect.value === '__create_new__';
    teamNameGroup.style.display = creatingNewTeam ? 'block' : 'none';
    teamColorGroup.style.display = creatingNewTeam ? 'block' : 'none';
    teamNameInput.required = creatingNewTeam;
}

// ===== LOAD SAVED SETTINGS =====
function loadSavedSettings() {
    try {
        const savedSettings = localStorage.getItem('srmpcSettings');
        if (savedSettings) {
            const settings = JSON.parse(savedSettings);
            document.getElementById('points-system').value = settings.pointsSystem || 'f1';
            document.getElementById('season-year').value = settings.seasonYear || new Date().getFullYear();
            document.getElementById('max-drivers').value = settings.maxDrivers || 2;
        }

        const savedProfile = localStorage.getItem('srmpcUserProfile');
        if (savedProfile) {
            const profile = JSON.parse(savedProfile);
            document.getElementById('user-name').value = profile.name || '';
            document.getElementById('user-email').value = profile.email || '';
            document.getElementById('user-team').value = profile.primaryTeam || '';
        }
    } catch (error) {
        console.warn('Could not load saved settings:', error);
    }
}

// ===== LOAD USER TEAMS FOR PROFILE =====
async function loadUserTeamsForProfile() {
    try {
        const teams = await Database.teams.getAll();
        const userTeamSelect = document.getElementById('user-team');
        userTeamSelect.innerHTML = '<option value="">Not assigned</option>';
        teams.forEach(team => {
            const option = document.createElement('option');
            option.value = team.id;
            option.textContent = team.name;
            userTeamSelect.appendChild(option);
        });

        // Restore saved selection
        const savedProfile = localStorage.getItem('srmpcUserProfile');
        if (savedProfile) {
            const profile = JSON.parse(savedProfile);
            if (profile.primaryTeam) {
                userTeamSelect.value = profile.primaryTeam;
            }
        }
    } catch (error) {
        console.error('Error loading teams for profile:', error);
    }
}

// ===== MODAL EVENT HANDLERS =====
function setupModalHandlers() {
    // Close modals when clicking the X button
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            if (modal) {
                modal.classList.remove('active');
                document.body.style.overflow = 'auto';
            }
        });
    });

    // Close modal when clicking outside of it
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
                document.body.style.overflow = 'auto';
            }
        });
    });
}

// ===== FORM HANDLERS =====
async function handleAddDriver(e) {
    e.preventDefault();

    try {
        const driverName = document.getElementById('driver-name').value;
        const driverNumber = document.getElementById('driver-number').value;
        const driverTeamSelection = document.getElementById('driver-team').value;
        const newDriverTeamName = document.getElementById('new-driver-team-name').value;
        const newDriverTeamColor = document.getElementById('new-driver-team-color').value;
        const driverCountry = document.getElementById('driver-country').value;
        const driverDescription = document.getElementById('driver-description').value;

        if (!driverName.trim()) {
            UI.showNotification('Driver name is required', 'error');
            return;
        }

        let teamId = null;
        let createdTeamId = null;

        if (driverTeamSelection === '__create_new__') {
            if (!newDriverTeamName.trim()) {
                UI.showNotification('New team name is required', 'error');
                return;
            }

            teamId = await Database.teams.create({
                name: newDriverTeamName.trim(),
                color: newDriverTeamColor || '#FF4444'
            });
            createdTeamId = teamId;
        } else if (driverTeamSelection) {
            teamId = driverTeamSelection;
        }

        // Create driver
        try {
            const driverId = await Database.drivers.create({
                name: driverName,
                number: driverNumber ? parseInt(driverNumber, 10) : null,
                teamId: teamId,
                country: driverCountry,
                bio: driverDescription
            });

            UI.showNotification('Driver added successfully!');
            document.getElementById('driver-form').reset();
            toggleNewDriverTeamFields();
            UI.closeModal('add-driver-modal');
            UI.loadDrivers();
            UI.loadDashboard();
            await loadDriverTeamOptions();

            // Log activity
            console.log(`Driver "${driverName}" (#${driverNumber || 'N/A'}) created successfully`, driverId);
        } catch (driverError) {
            // Prevent orphan teams when driver creation fails right after creating a team.
            if (createdTeamId) {
                try {
                    await Database.teams.delete(createdTeamId);
                } catch (cleanupError) {
                    console.error('Rollback failed for newly created team:', cleanupError);
                }
            }

            throw driverError;
        }
    } catch (error) {
        console.error('Error adding driver:', error);
        UI.showNotification('Error adding driver: ' + error.message, 'error');
    }
}

async function handleAddTeam(e) {
    e.preventDefault();

    try {
        const teamName = document.getElementById('team-name').value;
        const teamColor = document.getElementById('team-color').value;
        const teamDescription = document.getElementById('team-description').value;

        if (!teamName.trim()) {
            UI.showNotification('Team name is required', 'error');
            return;
        }

        const teamId = await Database.teams.create({
            name: teamName,
            color: teamColor,
            description: teamDescription
        });

        UI.showNotification('Team created successfully!');
        document.getElementById('team-form').reset();
        UI.closeModal('add-team-modal');
        UI.loadTeams();
        UI.loadDrivers(); // Refresh drivers to show new team option
        await loadDriverTeamOptions();
        UI.loadDashboard();

        console.log(`Team "${teamName}" created successfully`);
    } catch (error) {
        console.error('Error creating team:', error);
        UI.showNotification('Error creating team: ' + error.message, 'error');
    }
}

async function handleAddRace(e) {
    e.preventDefault();

    try {
        const raceName = document.getElementById('race-name').value;
        const raceDate = document.getElementById('race-date').value;
        const raceGame = document.getElementById('race-game').value;
        const raceTrack = document.getElementById('race-track').value;
        const raceDescription = document.getElementById('race-description').value;

        if (!raceName.trim() || !raceDate || !raceGame) {
            UI.showNotification('Please fill in all required fields', 'error');
            return;
        }

        const raceId = await Database.races.create({
            name: raceName,
            date: raceDate,
            game: raceGame,
            track: raceTrack,
            description: raceDescription
        });

        UI.showNotification('Race scheduled successfully!');
        document.getElementById('race-form').reset();
        UI.closeModal('add-race-modal');
        UI.loadCalendar();
        UI.loadDashboard();

        console.log(`Race "${raceName}" scheduled for ${raceDate}`);
    } catch (error) {
        console.error('Error scheduling race:', error);
        UI.showNotification('Error scheduling race: ' + error.message, 'error');
    }
}

// ===== FILTER HANDLERS =====
async function filterDrivers() {
    try {
        const searchTerm = document.getElementById('driver-search').value.toLowerCase();
        const teamFilter = document.getElementById('team-filter').value;

        let drivers = await Database.drivers.getAll();

        // Apply filters
        if (searchTerm) {
            drivers = drivers.filter(d => 
                d.name.toLowerCase().includes(searchTerm) ||
                (d.country && d.country.toLowerCase().includes(searchTerm))
            );
        }

        if (teamFilter) {
            drivers = drivers.filter(d => d.teamId === teamFilter);
        }

        // Render filtered drivers
        const driversGrid = document.getElementById('drivers-grid');
        driversGrid.innerHTML = '';

        if (drivers.length === 0) {
            driversGrid.innerHTML = '<div class="empty-state">No drivers match your filters</div>';
            return;
        }

        drivers.forEach(driver => {
            const driverCard = UI.createDriverCard(driver);
            driversGrid.appendChild(driverCard);
        });
    } catch (error) {
        console.error('Error filtering drivers:', error);
    }
}

// ===== SETTINGS & USER MENU =====
function handleSettings() {
    UI.showModal('settings-modal');
}

function handleUserMenu() {
    loadUserTeamsForProfile();
    UI.showModal('user-profile-modal');
}

async function handleSaveEditDriver(e) {
    e.preventDefault();
    try {
        const driverId = window.currentEditingDriverId;
        if (!driverId) {
            UI.showNotification('No driver selected', 'error');
            return;
        }

        const updates = {
            name: document.getElementById('edit-driver-name').value,
            number: document.getElementById('edit-driver-number').value ? parseInt(document.getElementById('edit-driver-number').value) : null,
            teamId: document.getElementById('edit-driver-team').value || null,
            country: document.getElementById('edit-driver-country').value,
            bio: document.getElementById('edit-driver-description').value
        };

        await Database.drivers.update(driverId, updates);
        UI.showNotification('Driver updated successfully!');
        UI.closeModal('edit-driver-modal');
        UI.loadDrivers();
        window.currentEditingDriverId = null;
    } catch (error) {
        console.error('Error saving driver:', error);
        UI.showNotification('Error saving driver: ' + error.message, 'error');
    }
}

async function handleSaveEditTeam(e) {
    e.preventDefault();
    try {
        const teamId = window.currentEditingTeamId;
        if (!teamId) {
            UI.showNotification('No team selected', 'error');
            return;
        }

        const updates = {
            name: document.getElementById('edit-team-name').value,
            color: document.getElementById('edit-team-color').value,
            description: document.getElementById('edit-team-description').value
        };

        await Database.teams.update(teamId, updates);
        UI.showNotification('Team updated successfully!');
        UI.closeModal('edit-team-modal');
        UI.loadTeams();
        UI.loadDrivers();
        window.currentEditingTeamId = null;
    } catch (error) {
        console.error('Error saving team:', error);
        UI.showNotification('Error saving team: ' + error.message, 'error');
    }
}

function handleSaveSettings(e) {
    e.preventDefault();
    try {
        const pointsSystem = document.getElementById('points-system').value;
        const seasonYear = document.getElementById('season-year').value;
        const maxDrivers = document.getElementById('max-drivers').value;

        // Store in localStorage for persistence
        localStorage.setItem('srmpcSettings', JSON.stringify({
            pointsSystem,
            seasonYear,
            maxDrivers,
            savedAt: new Date().toISOString()
        }));

        UI.showNotification('Settings saved successfully!');
        console.log('Settings saved:', { pointsSystem, seasonYear, maxDrivers });
    } catch (error) {
        console.error('Error saving settings:', error);
        UI.showNotification('Error saving settings', 'error');
    }
}

function handleSaveProfile(e) {
    e.preventDefault();
    try {
        const profile = {
            name: document.getElementById('user-name').value,
            email: document.getElementById('user-email').value,
            primaryTeam: document.getElementById('user-team').value,
            savedAt: new Date().toISOString()
        };

        localStorage.setItem('srmpcUserProfile', JSON.stringify(profile));
        UI.showNotification('Profile saved successfully!');
        console.log('Profile saved:', profile);
    } catch (error) {
        console.error('Error saving profile:', error);
        UI.showNotification('Error saving profile', 'error');
    }
}

// ===== SAMPLE DATA LOADER (FOR TESTING) =====
async function loadSampleData() {
    try {
        console.log('Loading sample data...');

        // Create teams
        const team1Id = await Database.teams.create({
            name: 'Apex Racing',
            color: '#FF0000',
            description: 'Elite racing team'
        });

        const team2Id = await Database.teams.create({
            name: 'Speed Demons',
            color: '#0066FF',
            description: 'High-speed specialists'
        });

        // Create drivers
        const driver1Id = await Database.drivers.create({
            name: 'John Smith',
            number: 1,
            teamId: team1Id,
            country: 'USA',
            bio: 'Championship contender'
        });

        const driver2Id = await Database.drivers.create({
            name: 'Emma Johnson',
            number: 2,
            teamId: team1Id,
            country: 'UK',
            bio: 'Rising star'
        });

        const driver3Id = await Database.drivers.create({
            name: 'Carlos Rodriguez',
            number: 3,
            teamId: team2Id,
            country: 'Spain',
            bio: 'Veteran racer'
        });

        // Create races
        const race1Id = await Database.races.create({
            name: 'iRacing Championship - Round 1',
            date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            game: 'iracing',
            track: 'Monza',
            description: 'First race of the season'
        });

        const race2Id = await Database.races.create({
            name: 'Wreckfest Demo Derby',
            date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            game: 'wreckfest',
            track: 'Junkyard Arena'
        });

        // Create standings
        const standingsId = await Database.standings.create({
            season: new Date().getFullYear(),
            game: 'mixed'
        });

        await Database.standings.updateDriverStanding(standingsId, driver1Id, 25);
        await Database.standings.updateDriverStanding(standingsId, driver2Id, 18);
        await Database.standings.updateDriverStanding(standingsId, driver3Id, 15);

        console.log('Sample data loaded successfully!');
        UI.loadDashboard();
    } catch (error) {
        console.error('Error loading sample data:', error);
    }
}

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', function(e) {
    // ESC to close modals
    if (e.key === 'Escape') {
        UI.closeAllModals();
    }

    // DEBUG: Load sample data (Ctrl+Shift+D)
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        loadSampleData();
    }
});

// ===== UTILITY FUNCTIONS =====
function getGameIcon(gameName) {
    const icons = {
        'iracing': '🏎️',
        'nascar2003': '🏁',
        'wreckfest': '💥',
        'wreckfest2': '💥',
        'automobilista1': '🏎️',
        'automobilista2': '🏎️',
        'beamng': '🚗'
    };
    return icons[gameName] || '🎮';
}

// Make functions globally available for inline onclick handlers
window.UI = UI;
window.Database = Database;
window.loadSampleData = loadSampleData;

console.log('Application initialized. Press Ctrl+Shift+D to load sample data.');
