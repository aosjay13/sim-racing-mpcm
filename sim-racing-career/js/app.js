// Main Application File - Sim Racing Career Mode

// AGGRESSIVE CACHE BUSTING - Force fresh loads
(function() {
    const timestamp = new Date().getTime();
    const scripts = document.querySelectorAll('script[src]');
    scripts.forEach(script => {
        const src = script.getAttribute('src');
        if (src && !src.includes('firebase')) {  // Don't modify Firebase URLs
            const separator = src.includes('?') ? '&' : '?';
            const newSrc = src.replace(/[?&]t=\d+/, '');  // Remove old timestamp
            script.setAttribute('src', newSrc + separator + 't=' + timestamp);
        }
    });
    console.log('🔄 Cache busting enabled - timestamp:', timestamp);
})();

// Normalize Database global for app.js too (covers direct Database.* usage in this file)
(function initializeAppDatabaseGlobal() {
    const base = (typeof window.Database === 'object' && window.Database) || {};
    const defaults = {
        drivers: { getAll: async () => [], getById: async () => null, getPending: async () => [] },
        teams: { getAll: async () => [], getById: async () => null, getPending: async () => [] },
        races: { getAll: async () => [], getById: async () => null },
        standings: { getCurrentSeasonStandings: async () => ({ entries: [], teamEntries: [] }) },
        sponsorships: { getAll: async () => [], getDriverContracts: async () => [], getTeamContracts: async () => [] },
        accounts: { getAll: async () => [] },
        users: { getProfile: async () => null, upsertProfile: async () => {} },
        admins: { getAll: async () => [] },
        payoutAudits: { getAll: async () => [] },
        integrity: { rebuildAllAggregates: async () => {} },
        economy: { getTransactions: async () => [], getBalance: async () => 0 },
        garage: { getByUser: async () => [] },
        games: { getAll: async () => [] },
        cars: { getAll: async () => [] },
        raceSignups: { getByRace: async () => [], isSignedUp: async () => false }
    };

    const merged = { ...defaults };
    Object.keys(defaults).forEach((key) => {
        merged[key] = {
            ...defaults[key],
            ...((base && typeof base[key] === 'object' && base[key]) || {})
        };
    });
    Object.keys(base || {}).forEach((key) => {
        if (!merged[key]) merged[key] = base[key];
    });

    window.Database = merged;
})();

var Database = window.Database;

const AppSession = {
    user: null,
    isAuthenticated: false,
    isAdmin: false,
    isMember: false,
    memberUid: null,
    memberEmail: null,
    activeRole: null,
    claimedDriverId: '',
    loginIntent: 'driver',
    hasEnteredApp: false,
    authInFlight: false,
    authAutoLaunchAttempted: false
};
// Initialize member signup mode
window._memberSignupMode = false;

// ===== APPLICATION INITIALIZATION =====
console.log('✅ NEW MEMBER SYSTEM LOADED - Member login panel and 8-role workspace system is active');

document.addEventListener('DOMContentLoaded', async function() {
    // Add visible timestamp to prove page is loading fresh
    const loadTime = new Date().toLocaleTimeString();
    console.log(`Page loaded at ${loadTime}`);
    
    console.log('Initializing Sim Racing Career Mode...');
    
    // Verify member form is in DOM
    const memberForm = document.getElementById('auth-member-form');
    const memberEmail = document.getElementById('auth-member-email');
    const memberPassword = document.getElementById('auth-member-password');
    const memberBtn = document.getElementById('auth-member-login-btn');
    console.log('✓ auth-member-form exists:', !!memberForm);
    console.log('✓ auth-member-email exists:', !!memberEmail);
    console.log('✓ auth-member-password exists:', !!memberPassword);
    console.log('✓ auth-member-login-btn exists:', !!memberBtn);
    
    initializeEventListeners();
    await initializeAuthSession();
    updatePasscodeGateUI();
    loadDriverTeamOptions();
    toggleNewDriverTeamFields();
});

function updatePasscodeGateUI() {
    const helperEl = document.getElementById('auth-username-helper');
    const hasPasscode = window.AuthService?.hasAdminPasscode?.();
    if (helperEl) {
        helperEl.textContent = hasPasscode
            ? 'Enter the admin passcode to unlock Game Master controls.'
            : 'No admin passcode set yet — enter a new passcode to set it up.';
    }

    const confirmField = document.getElementById('auth-passcode-confirm-field');
    const adminBtn = document.getElementById('auth-email-admin-btn');
    if (!hasPasscode) {
        if (confirmField) confirmField.style.display = '';
        if (adminBtn) adminBtn.textContent = 'Set Passcode & Unlock';
    } else {
        if (confirmField) confirmField.style.display = 'none';
        if (adminBtn) adminBtn.textContent = 'Unlock Game Master';
    }
}

async function initializeAuthSession() {
    updateShellVisibility();

    if (!window.AuthService) {
        console.warn('AuthService is not available. Running in guest mode.');
        updateAuthUI();
        return;
    }

    await window.AuthService.waitUntilReady();

    window.AuthService.onAuthStateChanged((state) => {
        AppSession.user = state.user;
        AppSession.isAuthenticated = state.isAuthenticated;
        AppSession.isAdmin = state.isAdmin;
        AppSession.isMember = state.isMember || false;
        AppSession.memberUid = state.user?.uid || null;
        AppSession.memberEmail = state.user?.email || null;

        if (!AppSession.isAuthenticated) {
            AppSession.claimedDriverId = '';
            AppSession.hasEnteredApp = false;
            AppSession.activeRole = null;
        }

        updateAuthUI();

        if (AppSession.isAuthenticated && !AppSession.hasEnteredApp) {
            AppSession.hasEnteredApp = true;

            if (AppSession.isAdmin) {
                window.UI?.switchView('admin');
            } else if (AppSession.isMember) {
                const savedRole = localStorage.getItem('srmpc_active_role');
                if (savedRole) {
                    AppSession.activeRole = savedRole;
                    window.UI?.switchView('member-workspace');
                } else {
                    window.UI?.showRolePicker();
                }
            } else {
                window.UI?.switchView('dashboard');
            }
        }

        Promise.allSettled([
            window.UI?.loadDashboard(),
            window.UI?.loadDrivers(),
            window.UI?.loadTeams(),
            window.UI?.loadStandings(),
            window.UI?.loadDriverHub(),
            loadDriverTeamOptions()
        ]);
    });
}

async function hydrateSessionProfile() {
    if (!AppSession.isAuthenticated) return;

    try {
        const saved = localStorage.getItem('srmpcUserProfile');
        if (saved) {
            const localProfile = JSON.parse(saved);
            AppSession.claimedDriverId = localProfile?.primaryDriver || '';
        }
    } catch (error) {
        console.warn('Could not parse local profile cache:', error);
    }
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

    const roleLabels = {
        'team-owner': 'Team Owner', 'driver': 'Driver', 'crew-chief': 'Crew Chief',
        'mechanic': 'Mechanic', 'agent': 'Agent', 'sponsor': 'Sponsor',
        'series-owner': 'Series Owner', 'track-owner': 'Track Owner'
    };
    const activeRoleLabel = AppSession.activeRole ? (roleLabels[AppSession.activeRole] || 'Member') : 'Member';

    window.UI?.applyRoleExperience({
        isAuthenticated: AppSession.isAuthenticated,
        isAdmin: AppSession.isAdmin,
        isMember: AppSession.isMember,
        activeRole: AppSession.activeRole
    });

    if (profileAccountType) {
        profileAccountType.textContent = !AppSession.isAuthenticated
            ? 'Guest'
            : (AppSession.isAdmin ? 'Administrator' : (AppSession.isMember ? `Member • ${activeRoleLabel}` : 'User'));
    }

    if (workspaceBannerEyebrow) {
        workspaceBannerEyebrow.textContent = !AppSession.isAuthenticated
            ? 'Guest Workspace'
            : (AppSession.isAdmin ? 'Admin Workspace' : (AppSession.isMember ? `${activeRoleLabel} Workspace` : 'User Workspace'));
    }

    if (workspaceBannerTitle) {
        const memberTitles = {
            'team-owner': 'Your teams, cars, drivers, and budget — all in one place.',
            'driver': 'Your career, sponsors, races, and performance — live.',
            'crew-chief': 'Your assigned drivers, race strategies, and setup notes.',
            'mechanic': 'Your cars, maintenance queue, and service logs.',
            'agent': 'Your clients, contracts, commissions, and opportunities.',
            'sponsor': 'Your sponsorship portfolio, deal performance, and ROI.',
            'series-owner': 'Your series, season calendar, rules, and standings.',
            'track-owner': 'Your venues, hosted events, and track operations.'
        };
        workspaceBannerTitle.textContent = !AppSession.isAuthenticated
            ? 'Sign in to unlock your racing workspace.'
            : (AppSession.isAdmin
                ? 'Racing Manager is live. League control tools are unlocked.'
                : (AppSession.isMember
                    ? (memberTitles[AppSession.activeRole] || 'Welcome back. Select a role to get started.')
                    : 'User tools are live. Follow races, teams, and your season progress.'));
    }

    if (workspaceBannerCopy) {
        workspaceBannerCopy.textContent = !AppSession.isAuthenticated
            ? 'Members get a full role-based career workspace. Admins get the full Racing Manager control surface.'
            : (AppSession.isAdmin
                ? 'Add drivers, add teams, schedule race events, manage sponsorships, and review pending submissions from one screen.'
                : (AppSession.isMember
                    ? 'Switch roles anytime to manage every part of your racing career.'
                    : 'Browse the live roster, follow the race calendar, and review standings.'));
    }

    if (loginBtn) {
        loginBtn.classList.toggle('hidden', AppSession.isAuthenticated);
    }

    if (logoutBtn) {
        logoutBtn.classList.toggle('hidden', !AppSession.isAuthenticated);
    }

    if (roleBadge) {
        roleBadge.classList.remove('auth-role-admin', 'auth-role-user', 'auth-role-member');
        if (AppSession.isAdmin) {
            roleBadge.textContent = 'Admin';
            roleBadge.classList.add('auth-role-admin');
        } else if (AppSession.isMember) {
            roleBadge.textContent = activeRoleLabel;
            roleBadge.classList.add('auth-role-member');
        } else if (AppSession.isAuthenticated) {
            roleBadge.textContent = 'User';
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
        addTeamBtn.classList.toggle('hidden', !AppSession.isAuthenticated);
        addTeamBtn.disabled = false;
        addTeamBtn.title = '';
    }

    if (addDriverBtn) {
        addDriverBtn.classList.toggle('hidden', !AppSession.isAuthenticated);
        addDriverBtn.disabled = false;
        addDriverBtn.title = '';
    }

    if (quickAddDriverBtn) {
        quickAddDriverBtn.classList.toggle('hidden', !AppSession.isAuthenticated);
        quickAddDriverBtn.disabled = false;
        quickAddDriverBtn.title = '';
    }

    if (addSponsorBtn) {
        addSponsorBtn.classList.toggle('hidden', !AppSession.isAdmin);
        addSponsorBtn.disabled = !AppSession.isAdmin;
        addSponsorBtn.title = AppSession.isAdmin ? '' : 'Admin login required';
    }

    if (adminNavBtn) {
        adminNavBtn.classList.toggle('hidden', !AppSession.isAdmin);
        if (!AppSession.isAdmin && window.UI?.currentView === 'admin') {
            window.UI.switchView('dashboard');
        }
    }

    if (driverHubNavBtn) {
        const visible = false;
        driverHubNavBtn.classList.toggle('hidden', !visible);
        if (!visible && window.UI?.currentView === 'driver-hub') {
            window.UI.switchView(AppSession.isMember ? 'member-workspace' : 'dashboard');
        }
    }

    const memberWorkspaceNavBtn = document.getElementById('member-workspace-nav-btn');
    if (memberWorkspaceNavBtn) {
        const visible = AppSession.isMember && !AppSession.isAdmin;
        memberWorkspaceNavBtn.classList.toggle('hidden', !visible);
        if (!visible && window.UI?.currentView === 'member-workspace') {
            window.UI.switchView('dashboard');
        }
    }

    if (sponsorsNavBtn) {
        sponsorsNavBtn.classList.toggle('hidden', !AppSession.isAdmin);
        if (!AppSession.isAdmin && window.UI?.currentView === 'sponsors') {
            window.UI.switchView(AppSession.isMember ? 'member-workspace' : 'dashboard');
        }
    }

    // Header and banner quick-access buttons
    const headerSwitchRoleBtn = document.getElementById('header-switch-role-btn');
    if (headerSwitchRoleBtn) {
        headerSwitchRoleBtn.classList.toggle('hidden', !AppSession.isMember || AppSession.isAdmin);
    }

    const headerAdminBtn = document.getElementById('header-admin-btn');
    if (headerAdminBtn) {
        headerAdminBtn.classList.toggle('hidden', !AppSession.isAdmin);
    }

    const bannerSelectRoleBtn = document.getElementById('banner-select-role-btn');
    if (bannerSelectRoleBtn) {
        bannerSelectRoleBtn.classList.toggle('hidden', !AppSession.isMember || AppSession.isAdmin);
    }

    const bannerOpenWorkspaceBtn = document.getElementById('banner-open-workspace-btn');
    if (bannerOpenWorkspaceBtn) {
        bannerOpenWorkspaceBtn.classList.toggle('hidden', !AppSession.isMember || AppSession.isAdmin);
    }

    const bannerOpenAdminBtn = document.getElementById('banner-open-admin-btn');
    if (bannerOpenAdminBtn) {
        bannerOpenAdminBtn.classList.toggle('hidden', !AppSession.isAdmin);
    }

    // Dashboard member role panel
    const memberRolePanel = document.getElementById('member-role-panel');
    if (memberRolePanel) {
        memberRolePanel.classList.toggle('hidden', !AppSession.isMember || AppSession.isAdmin);
        const badge = document.getElementById('member-role-panel-badge');
        const desc = document.getElementById('member-role-panel-desc');
        const roleLabels = {
            'team-owner': 'Team Owner', 'driver': 'Driver', 'crew-chief': 'Crew Chief',
            'mechanic': 'Mechanic', 'agent': 'Agent', 'sponsor': 'Sponsor',
            'series-owner': 'Series Owner', 'track-owner': 'Track Owner'
        };
        const roleLabelMap = {
            'team-owner': 'Build and manage a racing team from top to bottom.',
            'driver': 'Track your career stats, sponsors, and performance.',
            'crew-chief': 'Manage driver assignments and race strategies.',
            'mechanic': 'Track car assignments and service work.',
            'agent': 'Represent drivers and teams, manage contracts.',
            'sponsor': 'Manage your sponsorship portfolio and ROI.',
            'series-owner': 'Run the championship — calendar, rules, standings.',
            'track-owner': 'Own and operate race venues and events.'
        };
        if (badge) badge.textContent = AppSession.activeRole ? (roleLabels[AppSession.activeRole] || 'Member') : 'No Role Selected';
        if (desc) desc.textContent = AppSession.activeRole
            ? (roleLabelMap[AppSession.activeRole] || 'Your personalized workspace is ready.')
            : 'Choose a career path to unlock your personalized workspace and career tools.';
    }

    // Dashboard admin quick panel
    const adminQuickPanel = document.getElementById('admin-quick-panel');
    if (adminQuickPanel) {
        adminQuickPanel.classList.toggle('hidden', !AppSession.isAdmin);
    }
}

function requireAuthenticated(message = 'Please sign in to continue.') {
    if (!AppSession.isAuthenticated) {
        window.UI?.showNotification(message, 'error');
        return false;
    }

    return true;
}

function requireAdmin(message = 'Administrator access required for this action.') {
    if (!AppSession.isAdmin) {
        window.UI?.showNotification(message, 'error');
        return false;
    }

    return true;
}

function showAuthError(message) {
    const errorEl = document.getElementById('auth-email-error');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.cssText = 'display:block;color:#ff4444;font-weight:bold;font-size:0.95rem;margin-top:0.75rem;padding:0.5rem;background:rgba(255,68,68,0.12);border-radius:6px;border:1px solid #ff4444;';
        errorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    console.error('[AUTH ERROR]', message);
    if (window.UI && typeof window.UI.showNotification === 'function') {
        window.UI.showNotification(message, 'error');
    }
}

function clearAuthError() {
    const errorEl = document.getElementById('auth-email-error');
    if (errorEl) {
        errorEl.style.display = 'none';
        errorEl.textContent = '';
    }
}

async function handleAdminPasscode() {
    clearAuthError();
    const passcode = document.getElementById('auth-password')?.value || '';
    const confirmEl = document.getElementById('auth-passcode-confirm');
    const confirm = confirmEl?.value || '';
    const adminBtn = document.getElementById('auth-email-admin-btn');

    if (!passcode) { showAuthError('Enter the admin passcode.'); return; }
    if (AppSession.authInFlight) return;
    AppSession.authInFlight = true;
    if (adminBtn) { adminBtn.disabled = true; adminBtn.textContent = 'Checking…'; }

    try {
        const hasPasscode = window.AuthService.hasAdminPasscode();

        if (!hasPasscode) {
            // First-time setup
            if (passcode.length < 4) { showAuthError('Passcode must be at least 4 characters.'); return; }
            if (passcode !== confirm) { showAuthError('Passcodes do not match.'); return; }
            await window.AuthService.setAdminPasscode(passcode);
            updatePasscodeGateUI();
        }

        await window.AuthService.unlockAdmin(passcode);
        window.UI?.showNotification('Game Master access unlocked.', 'success');
    } catch (error) {
        showAuthError(error.message || 'Incorrect passcode.');
    } finally {
        AppSession.authInFlight = false;
        if (adminBtn) {
            adminBtn.disabled = false;
            adminBtn.textContent = window.AuthService.hasAdminPasscode() ? 'Unlock Game Master' : 'Set Passcode & Unlock';
        }
    }
}

async function handleLogout() {
    if (!window.AuthService) return;

    try {
        await window.AuthService.signOut();
        AppSession.activeRole = null;
        localStorage.removeItem('srmpc_active_role');
        updatePasscodeGateUI();
        window.UI?.showNotification('Signed out successfully.');
    } catch (error) {
        console.error('Logout error:', error);
        window.UI?.showNotification('Sign out failed: ' + error.message, 'error');
    }
}

// ===== MEMBER LOGIN / SIGNUP =====
async function handleMemberSignIn() {
    const email = document.getElementById('auth-member-email')?.value?.trim() || '';
    const password = document.getElementById('auth-member-password')?.value || '';
    const errorEl = document.getElementById('auth-member-error');
    if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }

    if (!email || !password) {
        if (errorEl) { errorEl.textContent = 'Email and password are required.'; errorEl.style.display = 'block'; }
        return;
    }
    if (AppSession.authInFlight) return;
    AppSession.authInFlight = true;
    const btn = document.getElementById('auth-member-login-btn');
    const origText = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

    try {
        await window.AuthService.signInMember(email, password);
    } catch (error) {
        const msg = error.code === 'auth/user-not-found' ? 'No account found with this email.'
            : error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential' ? 'Incorrect email or password.'
            : error.code === 'auth/invalid-email' ? 'Invalid email address.'
            : error.code === 'auth/too-many-requests' ? 'Too many failed attempts. Please try again later.'
            : error.message || 'Sign-in failed. Please try again.';
        if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
    } finally {
        AppSession.authInFlight = false;
        if (btn) { btn.disabled = false; btn.textContent = origText || 'Member Login'; }
    }
}

async function handleMemberSignUp() {
    const email = document.getElementById('auth-member-email')?.value?.trim() || '';
    const password = document.getElementById('auth-member-password')?.value || '';
    const displayName = document.getElementById('auth-member-name')?.value?.trim() || '';
    const errorEl = document.getElementById('auth-member-error');
    if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }

    if (!email || !password) {
        if (errorEl) { errorEl.textContent = 'Email and password are required.'; errorEl.style.display = 'block'; }
        return;
    }
    if (password.length < 6) {
        if (errorEl) { errorEl.textContent = 'Password must be at least 6 characters.'; errorEl.style.display = 'block'; }
        return;
    }
    if (AppSession.authInFlight) return;
    AppSession.authInFlight = true;
    const btn = document.getElementById('auth-member-login-btn');
    const origText = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Creating account…'; }

    try {
        const fbUser = await window.AuthService.signUpMember(email, password, displayName);
        if (fbUser?.uid) {
            await Promise.allSettled([
                Database.accounts.createRequest({
                    uid: fbUser.uid,
                    username: email.split('@')[0],
                    displayName: displayName || email.split('@')[0],
                    requestedRole: 'member'
                }),
                Database.users.upsertProfile(fbUser.uid, {
                    displayName: displayName || email.split('@')[0],
                    email,
                    requestedRole: 'member',
                    roleStatus: 'approved'
                })
            ]);
        }
        window.UI?.showNotification('Account created! Choose your role to get started.', 'success');
        // Switch back to login mode
        window._memberSignupMode = false;
        const signupPanel = document.getElementById('auth-member-signup-panel');
        const toggleBtn = document.getElementById('auth-member-toggle-btn');
        if (signupPanel) signupPanel.style.display = 'none';
        if (btn) btn.textContent = 'Member Login';
        if (toggleBtn) toggleBtn.textContent = 'New member? Register';
    } catch (error) {
        const msg = error.code === 'auth/email-already-in-use' ? 'This email is already registered. Try signing in.'
            : error.code === 'auth/invalid-email' ? 'Invalid email address.'
            : error.code === 'auth/weak-password' ? 'Password is too weak. Use at least 6 characters.'
            : error.message || 'Registration failed. Please try again.';
        if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
    } finally {
        AppSession.authInFlight = false;
        if (btn) { btn.disabled = false; btn.textContent = origText || 'Member Login'; }
    }
}

function switchActiveRole(roleId) {
    AppSession.activeRole = roleId;
    localStorage.setItem('srmpc_active_role', roleId);
    updateAuthUI();
    window.UI?.closeModal('role-picker-modal');
    window.UI?.switchView('member-workspace');
}

// ===== EVENT LISTENERS SETUP =====
function initializeEventListeners() {
    document.getElementById('auth-member-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (window._memberSignupMode) {
            await handleMemberSignUp();
        } else {
            await handleMemberSignIn();
        }
    });

    document.getElementById('auth-member-toggle-btn')?.addEventListener('click', () => {
        window._memberSignupMode = !window._memberSignupMode;
        const signupPanel = document.getElementById('auth-member-signup-panel');
        const loginBtn = document.getElementById('auth-member-login-btn');
        const toggleBtn = document.getElementById('auth-member-toggle-btn');
        if (signupPanel) signupPanel.style.display = window._memberSignupMode ? '' : 'none';
        if (loginBtn) loginBtn.textContent = window._memberSignupMode ? 'Create Account' : 'Member Login';
        if (toggleBtn) toggleBtn.textContent = window._memberSignupMode ? 'Already a member? Sign in' : 'New member? Register';
    });

    document.getElementById('member-workspace-refresh-btn')?.addEventListener('click', async () => {
        if (!AppSession.isMember) return;
        await window.UI?.loadMemberWorkspace();
    });

    document.getElementById('switch-role-btn')?.addEventListener('click', () => {
        window.UI?.showRolePicker();
    });

    document.getElementById('auth-email-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        await handleAdminPasscode();
    });

    document.getElementById('auth-email-admin-btn')?.addEventListener('click', async () => {
        await handleAdminPasscode();
    });

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

    // Header quick-access buttons
    document.getElementById('header-switch-role-btn')?.addEventListener('click', () => {
        window.UI?.showRolePicker();
    });

    document.getElementById('header-admin-btn')?.addEventListener('click', () => {
        window.UI?.switchView('admin');
    });

    // Banner CTA buttons
    document.getElementById('banner-select-role-btn')?.addEventListener('click', () => {
        window.UI?.showRolePicker();
    });

    document.getElementById('banner-open-workspace-btn')?.addEventListener('click', () => {
        window.UI?.switchView('member-workspace');
    });

    document.getElementById('banner-open-admin-btn')?.addEventListener('click', () => {
        window.UI?.switchView('admin');
    });

    // Modal management
    setupModalHandlers();

    // Dashboard role panel buttons
    document.getElementById('dashboard-select-role-btn')?.addEventListener('click', () => {
        window.UI?.showRolePicker();
    });

    document.getElementById('dashboard-open-workspace-btn')?.addEventListener('click', () => {
        window.UI?.switchView('member-workspace');
    });

    document.getElementById('dashboard-open-admin-btn')?.addEventListener('click', () => {
        window.UI?.switchView('admin');
    });

    document.getElementById('dashboard-quick-add-race-btn')?.addEventListener('click', () => {
        if (!requireAdmin()) return;
        UI.showModal('add-race-modal');
    });

    // Dashboard actions
    document.getElementById('quick-add-driver')?.addEventListener('click', async () => {
        if (!requireAuthenticated('Sign in to continue.')) return;
        if (AppSession.isAdmin) {
            await loadDriverTeamOptions();
            document.getElementById('driver-form')?.reset();
            toggleNewDriverTeamFields();
            UI.showModal('add-driver-modal');
        } else if (AppSession.isMember) {
            UI.switchView('member-workspace');
        } else {
            UI.switchView('dashboard');
        }
    });

    // Driver management
    document.getElementById('add-driver-btn')?.addEventListener('click', async () => {
        if (!requireAuthenticated('Sign in to submit a driver profile.')) return;
        await loadDriverTeamOptions();
        document.getElementById('driver-form')?.reset();
        toggleNewDriverTeamFields();
        // Update modal text based on role
        const addDriverModalTitle = document.querySelector('#add-driver-modal .modal-header h2');
        const addDriverSubmitBtn = document.querySelector('#driver-form button[type="submit"]');
        if (addDriverModalTitle) addDriverModalTitle.textContent = AppSession.isAdmin ? 'Add New Driver' : 'Request Driver Profile';
        if (addDriverSubmitBtn) addDriverSubmitBtn.textContent = AppSession.isAdmin ? 'Add Driver' : 'Submit Request';
        UI.showModal('add-driver-modal');
    });

    document.getElementById('driver-form')?.addEventListener('submit', handleAddDriver);
    document.getElementById('driver-team')?.addEventListener('change', toggleNewDriverTeamFields);
    document.getElementById('cancel-driver')?.addEventListener('click', () => {
        UI.closeModal('add-driver-modal');
    });

    // Team management
    document.getElementById('add-team-btn')?.addEventListener('click', () => {
        if (!requireAuthenticated('Sign in to create a team.')) return;
        document.getElementById('team-form')?.reset();
        const addTeamModalTitle = document.querySelector('#add-team-modal .modal-header h2');
        const addTeamSubmitBtn = document.querySelector('#team-form button[type="submit"]');
        if (addTeamModalTitle) addTeamModalTitle.textContent = AppSession.isAdmin ? 'Create Team' : 'Request Team';
        if (addTeamSubmitBtn) addTeamSubmitBtn.textContent = AppSession.isAdmin ? 'Create Team' : 'Submit Request';
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

    document.getElementById('edit-race-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!requireAdmin()) return;
        await UI.saveEditRaceFromForm();
    });

    document.getElementById('cancel-edit-race')?.addEventListener('click', () => {
        UI.closeModal('edit-race-modal');
    });

    document.getElementById('race-schedule-filter')?.addEventListener('change', async () => {
        if (!requireAdmin()) return;
        await UI.loadRaceSchedule();
    });

    document.getElementById('admin-race-schedule-refresh')?.addEventListener('click', async () => {
        if (!requireAdmin()) return;
        await UI.loadRaceSchedule();
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

    if (!requireAuthenticated('Sign in to submit a driver profile.')) {
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
        const recordStatus = AppSession.isAdmin ? 'approved' : 'pending';

        if (driverTeamSelection === '__create_new__') {
            if (!newDriverTeamName.trim()) {
                UI.showNotification('New team name is required', 'error');
                return;
            }

            teamId = await Database.teams.create({
                name: newDriverTeamName.trim(),
                color: newDriverTeamColor || '#FF4444',
                ownerUid: AppSession.user?.uid || null,
                status: recordStatus,
                createdByUid: AppSession.user?.uid || null,
                createdByEmail: AppSession.user?.email || null
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
                ownerUid: AppSession.user?.uid || null,
                country: driverCountry,
                bio: driverDescription,
                status: recordStatus,
                createdByUid: AppSession.user?.uid || null,
                createdByEmail: AppSession.user?.email || null
            });

            UI.showNotification(AppSession.isAdmin
                ? `Driver "${driverName}" added successfully!`
                : `Driver profile "${driverName}" submitted for Game Master approval.`);
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
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = originalButtonText || 'Add Driver';
        }
    }
}

async function handleAddTeam(e) {
    e.preventDefault();

    if (!requireAuthenticated('Sign in to create a team.')) {
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

        const recordStatus = AppSession.isAdmin ? 'approved' : 'pending';

        const teamId = await Database.teams.create({
            name: teamName,
            color: teamColor,
            description: teamDescription,
            ownerUid: AppSession.user?.uid || null,
            status: recordStatus,
            createdByUid: AppSession.user?.uid || null,
            createdByEmail: AppSession.user?.email || null
        });

        UI.showNotification(AppSession.isAdmin ? `Team "${teamName}" created successfully!` : `Team "${teamName}" submitted for Game Master approval.`);
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

        const teams = await Database.teams.getAll();
        const teamsById = new Map(teams.map(t => [t.id, t]));
        drivers.forEach(driver => {
            const driverCard = UI.createDriverCard(driver, teamsById);
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

        const isClaimedDriver = AppSession.isAuthenticated && AppSession.claimedDriverId === driverId;

        if (!AppSession.isAdmin && !isClaimedDriver) {
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

        let isTeamOwner = false;
        try {
            const savedProfile = JSON.parse(localStorage.getItem('srmpcUserProfile') || '{}');
            isTeamOwner = AppSession.isAuthenticated && savedProfile.primaryTeam === teamId;
        } catch { /* ignore */ }

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
window.handleEmailPasswordAuth = handleEmailPasswordAuth;
window.handleIntentLogin = handleIntentLogin;
window.switchActiveRole = switchActiveRole;

console.log('Application initialized. Press Ctrl+Shift+D to load sample data.');
