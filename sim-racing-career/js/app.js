// Main Application File - Sim Racing Career Mode

const AppSession = {
    user: null,
    isAuthenticated: false,
    isAdmin: false,
    claimedDriverId: '',
    loginIntent: '',
    hasEnteredApp: false,
    authInFlight: false,
    authAutoLaunchAttempted: false
};

function refreshAuthRoleUI() {
    const selectedRoleEl = document.getElementById('auth-selected-role');
    const submitBtn = document.getElementById('auth-submit-btn');
    const driverPanel = document.getElementById('auth-driver-login-btn');
    const adminPanel = document.getElementById('auth-admin-login-btn');

    const roleIsSelected = AppSession.loginIntent === 'admin' || AppSession.loginIntent === 'driver';
    const selectedRoleLabel = AppSession.loginIntent === 'admin'
        ? 'Administrator / Game Master'
        : (AppSession.loginIntent === 'driver' ? 'Driver' : 'Not selected');

    if (selectedRoleEl) {
        selectedRoleEl.textContent = selectedRoleLabel;
    }

    if (submitBtn) {
        submitBtn.textContent = roleIsSelected
            ? `Sign In as ${AppSession.loginIntent === 'admin' ? 'Admin' : 'Driver'}`
            : 'Select Driver or Admin First';
        submitBtn.disabled = !roleIsSelected;
    }

    if (driverPanel) {
        driverPanel.classList.toggle('auth-panel-selected', AppSession.loginIntent === 'driver');
    }

    if (adminPanel) {
        adminPanel.classList.toggle('auth-panel-selected', AppSession.loginIntent === 'admin');
    }
}

function refreshUsernameHelper() {
    const usernameInput = document.getElementById('auth-email');
    const helperEl = document.getElementById('auth-username-helper');
    if (!helperEl) return;

    const normalized = String(usernameInput?.value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '');
    helperEl.textContent = `No email needed. Internal auth ID preview: ${(normalized || 'your_username')}@srmpc.local`;
}

// ===== APPLICATION INITIALIZATION =====
document.addEventListener('DOMContentLoaded', async function() {
    console.log('Initializing Sim Racing Career Mode...');
    
    initializeEventListeners();
    updateAuthDiagnostics();
    await initializeAuthSession();
    loadDriverTeamOptions();
    toggleNewDriverTeamFields();
    refreshAuthRoleUI();
    refreshUsernameHelper();
});

function updateAuthDiagnostics() {
    const diagnosticsEl = document.getElementById('auth-gate-diagnostics');
    if (!diagnosticsEl) return;

    const host = window.location.hostname || '';
    const status = window.getFirebaseInitStatus ? window.getFirebaseInitStatus() : null;
    const hints = [];

    if (!status?.initialized) {
        hints.push('Firebase is not fully initialized in this session.');
    }

    if (host.includes('github.dev') || host.includes('app.github.dev')) {
        hints.push('Preview domains usually require adding this exact host to Firebase Auth Authorized domains.');
    }

    if (window.AuthService?.isEmbeddedContext?.()) {
        hints.push('Embedded mode detected: Google sign-in will open in a separate browser tab.');
    }

    if (!status?.hasAuth) {
        hints.push('Firebase Auth is unavailable. Check firebase-config.js credentials.');
    }

    if (!hints.length) {
        diagnosticsEl.classList.add('hidden');
        diagnosticsEl.textContent = '';
        return;
    }

    diagnosticsEl.textContent = `Auth diagnostics (${host}): ${hints.join(' ')}`;
    diagnosticsEl.classList.remove('hidden');
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
        })
    ]);
}

async function initializeAuthSession() {
    updateShellVisibility();

    if (!window.AuthService) {
        console.warn('AuthService is not available. Running in guest mode.');
        updateAuthUI();
        return;
    }

    await window.AuthService.waitUntilReady();

    const params = new URLSearchParams(window.location.search);
    const authIntentParam = params.get('authIntent');

    if (authIntentParam === 'admin' || authIntentParam === 'driver') {
        AppSession.loginIntent = authIntentParam;
    }

    window.AuthService.onAuthStateChanged(async (state) => {
        AppSession.user = state.user;
        AppSession.isAuthenticated = state.isAuthenticated;
        AppSession.isAdmin = state.isAdmin;

        if (AppSession.isAuthenticated && AppSession.user?.uid) {
            try {
                const resolvedAdmin = await Database.admins.isAdmin(AppSession.user.uid);
                AppSession.isAdmin = Boolean(resolvedAdmin);

                if (window.AuthService && window.AuthService._isAdmin !== AppSession.isAdmin) {
                    window.AuthService._isAdmin = AppSession.isAdmin;
                }
            } catch (error) {
                console.warn('Admin role verification fallback failed:', error);
            }
        }

        try {
            if (!AppSession.isAuthenticated) {
                AppSession.claimedDriverId = '';
                AppSession.hasEnteredApp = false;
            } else {
                await hydrateSessionProfile();
            }
        } catch (error) {
            console.error('Session profile hydration failed, continuing with auth session:', error);

            if (!AppSession.isAuthenticated) {
                AppSession.claimedDriverId = '';
            } else {
                try {
                    const saved = localStorage.getItem('srmpcUserProfile');
                    if (saved) {
                        const localProfile = JSON.parse(saved);
                        AppSession.claimedDriverId = localProfile?.primaryDriver || '';
                    }
                } catch (parseError) {
                    console.warn('Could not parse local profile fallback:', parseError);
                }
            }
        }

        updateAuthUI();

        if (AppSession.isAuthenticated && !AppSession.hasEnteredApp) {
            AppSession.hasEnteredApp = true;

            if (window.location.search.includes('authLaunch=1')) {
                const cleanedUrl = window.location.pathname + window.location.hash;
                window.history.replaceState({}, document.title, cleanedUrl);
            }

            if (AppSession.loginIntent === 'admin' && !AppSession.isAdmin) {
                UI.showNotification('Admin access was not found for this account. Opening Driver portal instead.', 'error');
            }

            if (AppSession.isAdmin) {
                UI.switchView('admin');
            } else {
                UI.switchView('driver-hub');
            }
        }

        Promise.allSettled([
            UI.loadDashboard(),
            UI.loadDrivers(),
            UI.loadTeams(),
            UI.loadStandings(),
            UI.loadDriverHub(),
            loadDriverTeamOptions()
        ]);
    });
}

async function hydrateSessionProfile() {
    if (!AppSession.isAuthenticated || !AppSession.user?.uid) return;

    const uid = AppSession.user.uid;
    let localProfile = null;

    try {
        const saved = localStorage.getItem('srmpcUserProfile');
        if (saved) {
            localProfile = JSON.parse(saved);
        }
    } catch (error) {
        console.warn('Could not parse local profile cache:', error);
    }

    let remoteProfile = null;

    try {
        remoteProfile = await Database.users.getProfile(uid);

        if (!remoteProfile) {
            await Database.users.upsertProfile(uid, {
                displayName: AppSession.user.displayName || localProfile?.name || '',
                email: AppSession.user.email || localProfile?.email || '',
                primaryTeam: localProfile?.primaryTeam || '',
                primaryDriver: localProfile?.primaryDriver || ''
            });

            remoteProfile = await Database.users.getProfile(uid);
        }
    } catch (error) {
        console.warn('Remote profile sync failed; continuing with local/auth profile only:', error);
    }

    const mergedProfile = {
        name: remoteProfile?.displayName || localProfile?.name || AppSession.user.displayName || '',
        email: remoteProfile?.email || AppSession.user.email || localProfile?.email || '',
        primaryTeam: remoteProfile?.primaryTeam || localProfile?.primaryTeam || '',
        primaryDriver: remoteProfile?.primaryDriver || localProfile?.primaryDriver || '',
        savedAt: new Date().toISOString()
    };

    AppSession.claimedDriverId = mergedProfile.primaryDriver || '';
    localStorage.setItem('srmpcUserProfile', JSON.stringify(mergedProfile));
}

function updateShellVisibility() {
    const appShell = document.getElementById('app');
    const authGate = document.getElementById('auth-gate');

    if (appShell) {
        appShell.classList.toggle('hidden', !AppSession.isAuthenticated);
    }

    if (authGate) {
        authGate.classList.toggle('hidden', AppSession.isAuthenticated);
    }
}

function updateAuthUI() {
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const roleBadge = document.getElementById('auth-role-badge');
    const emailForm = document.getElementById('auth-email-form');
    const profileAccountType = document.getElementById('profile-account-type');
    const workspaceBannerEyebrow = document.getElementById('workspace-banner-eyebrow');
    const workspaceBannerTitle = document.getElementById('workspace-banner-title');
    const workspaceBannerCopy = document.getElementById('workspace-banner-copy');

    UI.applyRoleExperience({
        isAuthenticated: AppSession.isAuthenticated,
        isAdmin: AppSession.isAdmin
    });

    if (profileAccountType) {
        profileAccountType.textContent = !AppSession.isAuthenticated
            ? 'Guest'
            : (AppSession.isAdmin ? 'Administrator' : 'Driver');
    }

    if (workspaceBannerEyebrow) {
        workspaceBannerEyebrow.textContent = !AppSession.isAuthenticated
            ? 'Guest Workspace'
            : (AppSession.isAdmin ? 'Admin Workspace' : 'Driver Workspace');
    }

    if (workspaceBannerTitle) {
        workspaceBannerTitle.textContent = !AppSession.isAuthenticated
            ? 'Sign in to unlock your racing workspace.'
            : (AppSession.isAdmin
                ? 'Racing Manager is live. League control tools are unlocked.'
                : 'Driver tools are live. Follow races, teams, and your season progress.');
    }

    if (workspaceBannerCopy) {
        workspaceBannerCopy.textContent = !AppSession.isAuthenticated
            ? 'Drivers get a live career hub. Admins get the full Racing Manager control surface.'
            : (AppSession.isAdmin
                ? 'Add drivers, add teams, schedule race events, manage sponsorships, and review pending submissions from one screen.'
                : 'Browse the live roster, follow the race calendar, review standings, and use Driver Hub for your personal profile and garage.');
    }

    if (loginBtn) {
        loginBtn.classList.toggle('hidden', AppSession.isAuthenticated);
    }

    if (logoutBtn) {
        logoutBtn.classList.toggle('hidden', !AppSession.isAuthenticated);
    }

    if (roleBadge) {
        roleBadge.classList.remove('auth-role-admin', 'auth-role-user');
        if (AppSession.isAdmin) {
            roleBadge.textContent = 'Admin';
            roleBadge.classList.add('auth-role-admin');
        } else if (AppSession.isAuthenticated) {
            roleBadge.textContent = 'Driver';
            roleBadge.classList.add('auth-role-user');
        } else {
            roleBadge.textContent = 'Guest';
        }
    }

    if (emailForm) {
        emailForm.classList.toggle('hidden', AppSession.isAuthenticated);
    }

    updateShellVisibility();

    const addRaceBtn = document.getElementById('add-race-btn');
    const addTeamBtn = document.getElementById('add-team-btn');
    const addDriverBtn = document.getElementById('add-driver-btn');
    const quickAddDriverBtn = document.getElementById('quick-add-driver');
    const addSponsorBtn = document.getElementById('add-sponsor-btn');
    const adminNavBtn = document.getElementById('admin-nav-btn');
    const driverHubNavBtn = document.getElementById('driver-hub-nav-btn');
    const dashboardNavBtn = document.getElementById('dashboard-nav-btn');
    const sponsorsNavBtn = document.getElementById('sponsors-nav-btn');

    if (addRaceBtn) {
        addRaceBtn.classList.toggle('hidden', !AppSession.isAdmin);
        addRaceBtn.disabled = !AppSession.isAdmin;
        addRaceBtn.title = AppSession.isAdmin ? '' : 'Admin login required';
    }

    if (addTeamBtn) {
        addTeamBtn.classList.toggle('hidden', !AppSession.isAdmin);
        addTeamBtn.disabled = !AppSession.isAdmin;
        addTeamBtn.title = AppSession.isAdmin ? '' : 'Admin login required';
    }

    if (addDriverBtn) {
        addDriverBtn.classList.toggle('hidden', !AppSession.isAdmin);
        addDriverBtn.disabled = !AppSession.isAdmin;
        addDriverBtn.title = AppSession.isAdmin ? '' : 'Admin login required';
    }

    if (quickAddDriverBtn) {
        quickAddDriverBtn.classList.toggle('hidden', !AppSession.isAdmin);
        quickAddDriverBtn.disabled = !AppSession.isAdmin;
        quickAddDriverBtn.title = AppSession.isAdmin ? '' : 'Admin login required';
    }

    if (addSponsorBtn) {
        addSponsorBtn.classList.toggle('hidden', !AppSession.isAdmin);
        addSponsorBtn.disabled = !AppSession.isAdmin;
        addSponsorBtn.title = AppSession.isAdmin ? '' : 'Admin login required';
    }

    if (adminNavBtn) {
        adminNavBtn.classList.toggle('hidden', !AppSession.isAdmin);
        if (!AppSession.isAdmin && UI.currentView === 'admin') {
            UI.switchView('dashboard');
        }
    }

    if (driverHubNavBtn) {
        const visible = AppSession.isAuthenticated && !AppSession.isAdmin;
        driverHubNavBtn.classList.toggle('hidden', !visible);
        if (!visible && UI.currentView === 'driver-hub') {
            UI.switchView('dashboard');
        }
    }

    if (sponsorsNavBtn) {
        sponsorsNavBtn.classList.toggle('hidden', !AppSession.isAdmin);
        if (!AppSession.isAdmin && UI.currentView === 'sponsors') {
            UI.switchView(AppSession.isAuthenticated ? 'driver-hub' : 'dashboard');
        }
    }
}

function requireAuthenticated(message = 'Please sign in to continue.') {
    if (!AppSession.isAuthenticated) {
        UI.showNotification(message, 'error');
        return false;
    }

    return true;
}

function requireAdmin(message = 'Administrator access required for this action.') {
    if (!AppSession.isAdmin) {
        UI.showNotification(message, 'error');
        return false;
    }

    return true;
}

async function handleLogin() {
    await handleEmailPasswordAuth(AppSession.loginIntent);
}

async function handleEmailPasswordAuth(intent) {
    const notify = (message, type = 'success') => {
        if (window.UI && typeof window.UI.showNotification === 'function') {
            window.UI.showNotification(message, type);
            return;
        }
        // Fallback so auth flow never crashes if UI wiring is delayed.
        if (type === 'error') {
            console.error(message);
        } else {
            console.log(message);
        }
    };

    if (!window.AuthService) {
        notify('Authentication service is unavailable.', 'error');
        return;
    }

    if (AppSession.authInFlight) {
        return;
    }

    const username = document.getElementById('auth-email')?.value?.trim() || '';
    const password = document.getElementById('auth-password')?.value || '';
    const createAccount = Boolean(document.getElementById('auth-create-account')?.checked);
    const displayName = document.getElementById('auth-display-name')?.value?.trim() || '';
    const errorEl = document.getElementById('auth-email-error');

    if (errorEl) {
        errorEl.style.display = 'none';
        errorEl.textContent = '';
    }

    const selectedIntent = intent === 'admin' || intent === 'driver' ? intent : AppSession.loginIntent;
    if (selectedIntent !== 'admin' && selectedIntent !== 'driver') {
        if (errorEl) {
            errorEl.textContent = 'Select Driver or Admin/Game Master first.';
            errorEl.style.display = 'block';
        }
        notify('Select Driver or Admin/Game Master first.', 'error');
        return;
    }

    if (!username || !password) {
        if (errorEl) {
            errorEl.textContent = 'Enter both username and password.';
            errorEl.style.display = 'block';
        }
        notify('Enter both username and password.', 'error');
        return;
    }

    AppSession.loginIntent = selectedIntent;
    AppSession.authInFlight = true;

    const loginBtn = document.getElementById('login-btn');
    const driverBtn = document.getElementById('auth-driver-login-btn');
    const adminBtn = document.getElementById('auth-admin-login-btn');
    const submitBtn = document.getElementById('auth-submit-btn');
    const emailInput = document.getElementById('auth-email');
    const passwordInput = document.getElementById('auth-password');
    const displayNameInput = document.getElementById('auth-display-name');
    const createAccountInput = document.getElementById('auth-create-account');
    [loginBtn, driverBtn, adminBtn, submitBtn, emailInput, passwordInput, displayNameInput, createAccountInput].forEach((control) => {
        if (control) control.disabled = true;
    });

    try {
        if (createAccount) {
            try {
                await window.AuthService.registerWithUsernamePassword({
                    username,
                    password,
                    displayName,
                    requestedRole: selectedIntent
                });

                if (selectedIntent === 'admin') {
                    notify('Account created. Admin/Game Master access is pending approval.', 'success');
                } else {
                    notify('Account created and signed in as Driver.', 'success');
                }
            } catch (createError) {
                // If username already exists, attempt sign-in with provided password.
                const createMessage = (createError?.message || '').toLowerCase();
                if (createMessage.includes('already in use') || createMessage.includes('already exists')) {
                    await window.AuthService.signInWithUsernamePassword(username, password);
                    notify('Account already exists — signed you in instead.', 'success');
                } else {
                    throw createError;
                }
            }
        } else {
            await window.AuthService.signInWithUsernamePassword(username, password);
            notify('Signed in successfully.');
        }
    } catch (error) {
        console.error('Email/password auth error:', error);
        if (errorEl) {
            errorEl.textContent = error.message || 'Sign in failed.';
            errorEl.style.display = 'block';
        }
        notify('Sign in failed: ' + (error.message || 'Unknown error'), 'error');
    } finally {
        AppSession.authInFlight = false;
        [loginBtn, driverBtn, adminBtn, submitBtn, emailInput, passwordInput, displayNameInput, createAccountInput].forEach((control) => {
            if (control) control.disabled = false;
        });
    }
}

async function handleIntentLogin(intent) {
    AppSession.loginIntent = intent === 'admin' ? 'admin' : 'driver';
    refreshAuthRoleUI();

    const usernameInput = document.getElementById('auth-email');
    if (usernameInput) {
        usernameInput.focus();
    }
}

async function handleLogout() {
    if (!window.AuthService) return;

    try {
        await window.AuthService.signOut();
        UI.showNotification('Signed out successfully.');
    } catch (error) {
        console.error('Logout error:', error);
        UI.showNotification('Sign out failed: ' + error.message, 'error');
    }
}

// ===== EVENT LISTENERS SETUP =====
function initializeEventListeners() {
    document.getElementById('auth-driver-login-btn')?.addEventListener('click', () => {
        handleIntentLogin('driver');
    });

    document.getElementById('auth-admin-login-btn')?.addEventListener('click', () => {
        handleIntentLogin('admin');
    });

    document.getElementById('auth-email-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        await handleEmailPasswordAuth(AppSession.loginIntent);
    });

    document.getElementById('auth-email')?.addEventListener('input', refreshUsernameHelper);

    // Navigation buttons use delegation so role-based visibility changes do not break clicks.
    document.querySelector('.nav-main')?.addEventListener('click', (event) => {
        const button = event.target.closest('.nav-btn');
        if (!button || button.classList.contains('hidden') || button.disabled) {
            return;
        }

        const viewName = button.dataset.view;
        if (viewName) {
            UI.switchView(viewName);
        }
    });

    // Modal management
    setupModalHandlers();

    // Dashboard actions
    document.getElementById('quick-add-driver')?.addEventListener('click', async () => {
        if (!requireAdmin('Administrator access required to add drivers.')) return;
        await loadDriverTeamOptions();
        const driverForm = document.getElementById('driver-form');
        driverForm?.reset();
        toggleNewDriverTeamFields();
        UI.showModal('add-driver-modal');
    });

    // Driver management
    document.getElementById('add-driver-btn')?.addEventListener('click', async () => {
        if (!requireAdmin('Administrator access required to add drivers.')) return;
        await loadDriverTeamOptions();
        const driverForm = document.getElementById('driver-form');
        driverForm?.reset();
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
        if (!requireAdmin('Administrator access required to add teams.')) return;
        UI.showModal('add-team-modal');
    });

    document.getElementById('team-form')?.addEventListener('submit', handleAddTeam);
    document.getElementById('cancel-team')?.addEventListener('click', () => {
        UI.closeModal('add-team-modal');
    });

    // Race management
    document.getElementById('add-race-btn')?.addEventListener('click', () => {
        if (!requireAdmin()) return;
        UI.showModal('add-race-modal');
    });

    document.getElementById('race-form')?.addEventListener('submit', handleAddRace);
    document.getElementById('cancel-race')?.addEventListener('click', () => {
        UI.closeModal('add-race-modal');
    });
    document.getElementById('race-details-close')?.addEventListener('click', () => {
        UI.closeModal('race-details-modal');
    });
    document.getElementById('race-signup-toggle')?.addEventListener('click', async () => {
        await UI.toggleRaceSignup();
    });
    document.getElementById('race-submit-results')?.addEventListener('click', async () => {
        await UI.submitRaceResults();
    });
    document.getElementById('race-reopen')?.addEventListener('click', async () => {
        await UI.reopenRace();
    });
    document.getElementById('race-rebuild-standings')?.addEventListener('click', async () => {
        await UI.rebuildStandings();
    });

    // Calendar navigation
    document.getElementById('prev-month')?.addEventListener('click', () => {
        UI.currentMonth.setMonth(UI.currentMonth.getMonth() - 1);
        UI.loadCalendar();
    });

    document.getElementById('next-month')?.addEventListener('click', () => {
        UI.currentMonth.setMonth(UI.currentMonth.getMonth() + 1);
        UI.loadCalendar();
    });

    // Filters
    document.getElementById('driver-search')?.addEventListener('input', filterDrivers);
    document.getElementById('team-filter')?.addEventListener('change', filterDrivers);

    // Header actions
    document.getElementById('settings-btn')?.addEventListener('click', handleSettings);
    document.getElementById('user-btn')?.addEventListener('click', handleUserMenu);
    document.getElementById('login-btn')?.addEventListener('click', () => handleIntentLogin(AppSession.loginIntent));
    document.getElementById('logout-btn')?.addEventListener('click', handleLogout);

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

    // Sponsor management
    document.getElementById('add-sponsor-btn')?.addEventListener('click', () => {
        if (!requireAdmin()) return;
        UI.focusSponsorshipForm();
    });

    document.getElementById('sponsorship-create-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!requireAdmin()) return;
        await UI.saveSponsorshipContractFromForm();
    });

    document.getElementById('sponsor-status-filter')?.addEventListener('change', async () => {
        await UI.loadSponsors();
    });

    document.getElementById('admin-refresh-btn')?.addEventListener('click', async () => {
        if (!requireAdmin()) return;
        await UI.loadAdminPanel();
    });

    document.getElementById('admin-quick-add-driver')?.addEventListener('click', async () => {
        if (!requireAdmin()) return;
        await loadDriverTeamOptions();
        document.getElementById('driver-form')?.reset();
        toggleNewDriverTeamFields();
        UI.showModal('add-driver-modal');
    });

    document.getElementById('admin-quick-add-team')?.addEventListener('click', () => {
        if (!requireAdmin()) return;
        document.getElementById('team-form')?.reset();
        UI.showModal('add-team-modal');
    });

    document.getElementById('admin-quick-add-race')?.addEventListener('click', () => {
        if (!requireAdmin()) return;
        document.getElementById('race-form')?.reset();
        UI.showModal('add-race-modal');
    });

    document.getElementById('moderation-type-filter')?.addEventListener('change', async () => {
        if (!requireAdmin()) return;
        await UI.loadModerationQueue();
    });

    document.getElementById('admin-create-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!requireAdmin()) return;
        await UI.saveAdminFromForm();
    });

    document.getElementById('game-create-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!requireAdmin()) return;
        await UI.saveGameFromForm();
    });

    document.getElementById('car-create-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!requireAdmin()) return;
        await UI.saveCarFromForm();
    });

    document.getElementById('admin-payout-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!requireAdmin()) return;
        await UI.saveAdminPayoutFromForm();
    });

    document.getElementById('admin-payout-refresh-btn')?.addEventListener('click', async () => {
        if (!requireAdmin()) return;
        await UI.loadAdminPayoutActivity();
    });

    document.getElementById('driver-hub-refresh-btn')?.addEventListener('click', async () => {
        if (!requireAuthenticated('Sign in to access Driver Hub.')) return;
        await UI.loadDriverHub();
    });

    document.getElementById('driver-shop-game-filter')?.addEventListener('change', async () => {
        await UI.loadCarsCatalog();
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
        const visibleTeams = AppSession.isAdmin ? teams : teams.filter((team) => (team.status || 'approved') === 'approved');

        visibleTeams.forEach((team) => {
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

    const teamColorInput = document.getElementById('new-driver-team-color');
    const creatingNewTeam = teamSelect.value === '__create_new__';

    teamNameGroup.style.display = creatingNewTeam ? 'block' : 'none';
    teamColorGroup.style.display = creatingNewTeam ? 'block' : 'none';

    teamNameInput.disabled = !creatingNewTeam;
    if (teamColorInput) {
        teamColorInput.disabled = !creatingNewTeam;
    }

    if (!creatingNewTeam) {
        teamNameInput.value = '';
        if (teamColorInput) {
            teamColorInput.value = '#FF4444';
        }
    }
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
            document.getElementById('user-driver').value = profile.primaryDriver || '';
            AppSession.claimedDriverId = profile.primaryDriver || '';
        }
    } catch (error) {
        console.warn('Could not load saved settings:', error);
    }
}

// ===== LOAD USER TEAMS FOR PROFILE =====
async function loadUserTeamsForProfile() {
    try {
        const [teams, drivers] = await Promise.all([
            Database.teams.getAll(),
            Database.drivers.getAll()
        ]);

        const visibleTeams = AppSession.isAdmin ? teams : teams.filter((team) => (team.status || 'approved') === 'approved');
        const visibleDrivers = AppSession.isAdmin ? drivers : drivers.filter((driver) => (driver.status || 'approved') === 'approved');

        const userTeamSelect = document.getElementById('user-team');
        const userDriverSelect = document.getElementById('user-driver');
        userTeamSelect.innerHTML = '<option value="">Not assigned</option>';
        visibleTeams.forEach(team => {
            const option = document.createElement('option');
            option.value = team.id;
            option.textContent = team.name;
            userTeamSelect.appendChild(option);
        });

        if (userDriverSelect) {
            userDriverSelect.innerHTML = '<option value="">Select approved driver</option>';
            visibleDrivers.forEach((driver) => {
                const option = document.createElement('option');
                option.value = driver.id;
                option.textContent = driver.name;
                userDriverSelect.appendChild(option);
            });
        }

        // Restore saved selection
        const savedProfile = localStorage.getItem('srmpcUserProfile');
        if (savedProfile) {
            const profile = JSON.parse(savedProfile);
            if (profile.primaryTeam) {
                userTeamSelect.value = profile.primaryTeam;
            }
            if (profile.primaryDriver && userDriverSelect) {
                userDriverSelect.value = profile.primaryDriver;
                AppSession.claimedDriverId = profile.primaryDriver;
            }
        }

        if (AppSession.isAuthenticated && AppSession.user?.uid) {
            const remoteProfile = await Database.users.getProfile(AppSession.user.uid);
            if (remoteProfile) {
                if (remoteProfile.primaryTeam) {
                    userTeamSelect.value = remoteProfile.primaryTeam;
                }
                if (remoteProfile.primaryDriver && userDriverSelect) {
                    userDriverSelect.value = remoteProfile.primaryDriver;
                    AppSession.claimedDriverId = remoteProfile.primaryDriver;
                }
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

    if (!requireAdmin('Administrator access required to add drivers.')) {
        return;
    }

    const driverForm = document.getElementById('driver-form');
    const submitButton = driverForm?.querySelector('button[type="submit"]');
    const originalButtonText = submitButton?.textContent;

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Creating...';
    }

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
        const recordStatus = 'approved';

        if (driverTeamSelection === '__create_new__') {
            if (!newDriverTeamName.trim()) {
                UI.showNotification('New team name is required', 'error');
                return;
            }

            teamId = await withTimeout(Database.teams.create({
                name: newDriverTeamName.trim(),
                color: newDriverTeamColor || '#FF4444',
                ownerUid: AppSession.user?.uid || null,
                status: recordStatus,
                createdByUid: AppSession.user?.uid || null,
                createdByEmail: AppSession.user?.email || null
            }), 12000, 'Creating team timed out. Check your Firebase connection and try again.');
            createdTeamId = teamId;
        } else if (driverTeamSelection) {
            teamId = driverTeamSelection;
        }

        // Create driver
        try {
            const driverId = await withTimeout(Database.drivers.create({
                name: driverName,
                number: driverNumber ? parseInt(driverNumber, 10) : null,
                teamId: teamId,
                ownerUid: AppSession.user?.uid || null,
                country: driverCountry,
                bio: driverDescription,
                status: recordStatus,
                createdByUid: AppSession.user?.uid || null,
                createdByEmail: AppSession.user?.email || null
            }), 12000, 'Creating driver timed out. Check your Firebase connection and try again.');

            UI.showNotification(`Driver "${driverName}" added successfully!`);
            document.getElementById('driver-form').reset();
            toggleNewDriverTeamFields();
            UI.closeModal('add-driver-modal');

            await Promise.allSettled([
                UI.loadDrivers(),
                UI.loadTeams(),
                UI.loadDashboard(),
                UI.loadAdminPanel(),
                loadDriverTeamOptions()
            ]);

            // Log activity
            console.log(`Driver "${driverName}" (#${driverNumber || 'N/A'}) created successfully`, driverId);
        } catch (driverError) {
            // Prevent orphan teams when driver creation fails right after creating a team.
            if (createdTeamId) {
                try {
                    await withTimeout(Database.teams.delete(createdTeamId), 12000, 'Timed out while rolling back temporary team creation.');
                } catch (cleanupError) {
                    console.error('Rollback failed for newly created team:', cleanupError);
                }
            }

            throw driverError;
        }
    } catch (error) {
        console.error('Error adding driver:', error);
        UI.showNotification('Error adding driver: ' + error.message, 'error');
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = originalButtonText || 'Add Driver';
        }
    }
}

async function handleAddTeam(e) {
    e.preventDefault();

    if (!requireAdmin('Administrator access required to add teams.')) {
        return;
    }

    try {
        const teamName = document.getElementById('team-name').value;
        const teamColor = document.getElementById('team-color').value;
        const teamDescription = document.getElementById('team-description').value;

        if (!teamName.trim()) {
            UI.showNotification('Team name is required', 'error');
            return;
        }

        const recordStatus = 'approved';

        const teamId = await Database.teams.create({
            name: teamName,
            color: teamColor,
            description: teamDescription,
            ownerUid: AppSession.user?.uid || null,
            status: recordStatus,
            createdByUid: AppSession.user?.uid || null,
            createdByEmail: AppSession.user?.email || null
        });

        UI.showNotification('Team created successfully!');
        document.getElementById('team-form').reset();
        UI.closeModal('add-team-modal');
        await Promise.allSettled([
            UI.loadTeams(),
            UI.loadDrivers(),
            loadDriverTeamOptions(),
            UI.loadDashboard(),
            UI.loadAdminPanel()
        ]); // Refresh drivers to show new team option

        console.log(`Team "${teamName}" created successfully`);
    } catch (error) {
        console.error('Error creating team:', error);
        UI.showNotification('Error creating team: ' + error.message, 'error');
    }
}

async function handleAddRace(e) {
    e.preventDefault();

    if (!requireAdmin()) {
        return;
    }

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
        await Promise.allSettled([
            UI.loadCalendar(),
            UI.loadDashboard(),
            UI.loadAdminPanel()
        ]);

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
        if (!AppSession.isAdmin) {
            drivers = drivers.filter((driver) => (driver.status || 'approved') === 'approved');
        }

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

        const driver = await Database.drivers.getById(driverId);
        if (!driver) {
            UI.showNotification('Driver not found', 'error');
            return;
        }

        const isDriverOwner = Boolean(
            AppSession.isAuthenticated &&
            AppSession.claimedDriverId === driverId &&
            driver.ownerUid &&
            driver.ownerUid === AppSession.user?.uid
        );

        if (!AppSession.isAdmin && !isDriverOwner) {
            UI.showNotification('You can only edit your own claimed driver profile.', 'error');
            return;
        }

        let updates;
        if (AppSession.isAdmin) {
            updates = {
                name: document.getElementById('edit-driver-name').value,
                number: document.getElementById('edit-driver-number').value ? parseInt(document.getElementById('edit-driver-number').value) : null,
                teamId: document.getElementById('edit-driver-team').value || null,
                country: document.getElementById('edit-driver-country').value,
                bio: document.getElementById('edit-driver-description').value
            };
        } else {
            updates = {
                name: document.getElementById('edit-driver-name').value,
                country: document.getElementById('edit-driver-country').value,
                bio: document.getElementById('edit-driver-description').value
            };
        }

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

        const team = await Database.teams.getById(teamId);
        if (!team) {
            UI.showNotification('Team not found', 'error');
            return;
        }

        const isTeamOwner = Boolean(
            AppSession.isAuthenticated &&
            team.ownerUid &&
            team.ownerUid === AppSession.user?.uid
        );

        if (!AppSession.isAdmin && !isTeamOwner) {
            UI.showNotification('You can only edit your own team.', 'error');
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

async function handleSaveProfile(e) {
    e.preventDefault();
    try {
        const profile = {
            name: document.getElementById('user-name').value,
            email: document.getElementById('user-email').value,
            primaryTeam: document.getElementById('user-team').value,
            primaryDriver: document.getElementById('user-driver').value,
            savedAt: new Date().toISOString()
        };

        localStorage.setItem('srmpcUserProfile', JSON.stringify(profile));

        AppSession.claimedDriverId = profile.primaryDriver || '';

        if (AppSession.isAuthenticated && AppSession.user?.uid) {
            await Database.users.upsertProfile(AppSession.user.uid, {
                displayName: profile.name,
                email: profile.email || AppSession.user.email || '',
                primaryTeam: profile.primaryTeam,
                primaryDriver: profile.primaryDriver
            });
        }

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
window.loadDriverTeamOptions = loadDriverTeamOptions;
window.AppSession = AppSession;

console.log('Application initialized. Press Ctrl+Shift+D to load sample data.');
