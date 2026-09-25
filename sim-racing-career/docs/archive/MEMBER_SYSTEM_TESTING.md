# Member Account System - Testing & Verification Guide

This guide will help you verify that the new member account system is working correctly.

## What Was Added

The following features have been implemented and added to the UI:

1. **Member Login/Registration Form** - New authentication panel in the auth gate
2. **8 Career Roles** - Team Owner, Driver, Crew Chief, Mechanic, Agent, Sponsor, Series Manager, Track Owner
3. **Role Picker Modal** - Interactive role selection after member signup
4. **Role-Specific Workspaces** - Custom dashboards for each career role
5. **Firebase Auth Integration** - Secure member authentication with email/password

## How to View the Member System

### Step 1: Navigate to the App
1. Open your browser to the deployed app URL or local server
2. You'll see the landing page (index.html) with a blue "Launch Career App" button
3. Click "Launch Career App" to load app.html

### Step 2: Locate the Member Panel
In app.html, you should now see:
- **"Enter as Driver" section** (top) - gray background, for guest driver entry
- **⭐ Member Account (New!)** section (middle) - pink/red background, for member login/registration
- **Game Master Access** section (bottom) - for admin access

The member section will have:
- Email input field
- Password input field
- Login button ("Member Login")
- Toggle button ("New member? Register")

### Step 3: Clear Browser Cache (IMPORTANT!)
If you don't see the member section, your browser may be using an old cached version:

**Windows/Linux:**
1. Press `Ctrl+Shift+Delete`
2. Select "All time" from the time range
3. Check "Cached images and files"
4. Click "Clear data"
5. Go back to the app URL and press `Ctrl+Shift+R` to hard refresh

**Mac:**
1. Press `Cmd+Shift+Delete`
2. Select "All time"
3. Check "Cached images and files"
4. Click "Clear data"
5. Go back to the app URL and press `Cmd+Shift+R`

### Step 4: Test Member Registration

1. In the Member Account section, click "New member? Register"
2. Notice the form now shows:
   - Display Name field (new)
   - Button text changes to "Create Account"
   - Toggle button changes to "Already a member? Sign in"

3. Fill in:
   - Display Name: Pick any name
   - Email: Use a new email address (e.g., test@example.com)
   - Password: Use at least 6 characters

4. Click "Create Account"

5. If successful, you'll see:
   - Success message: "Account created! Choose your role to get started."
   - A modal appears with 8 career roles to choose from

### Step 5: Test Role Picker

After successful signup, you should see the Role Picker modal with:
- Team Owner (gold icon)
- Driver (steering wheel icon)
- Crew Chief (wrench icon)
- Mechanic (tools icon)
- Agent (briefcase icon)
- Sponsor (star icon)
- Series Manager (trophy icon)
- Track Owner (flag icon)

Click any role card to select it and enter that role's workspace.

### Step 6: Test Member Login

If you already have a member account:

1. Click "Already a member? Sign in" (or just stay in login mode)
2. The form returns to login mode:
   - Display Name field hidden
   - Button text is "Member Login"
   - Toggle button says "New member? Register"

3. Enter your email and password
4. Click "Member Login"
5. If successful:
   - You'll be taken to your member workspace
   - You'll see KPIs and role-specific data for your selected role

## Debugging Checklist

### If you DON'T see the member section:

1. **Check browser console for errors:**
   - Press F12 to open DevTools
   - Go to "Console" tab
   - Look for red error messages
   - Take a screenshot of any errors

2. **Verify files are loading:**
   - Go to "Network" tab in DevTools
   - Look for app.html, app.js, ui.js, firebase-config.js
   - Check if they're loading with v=5 (cache buster)
   - Check their Status (should be 200)

3. **Check if form elements exist:**
   - In Console tab, run:
   ```javascript
   document.getElementById('auth-member-form') ? 'Form exists' : 'Form NOT found'
   ```
   - Should print "Form exists"

4. **Refresh strategies:**
   - Hard refresh: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
   - Try incognito/private window (fresh cache)
   - Try a different browser

### If you see the member section but it doesn't work:

1. **Registration fails:**
   - Check error message in red text under the form
   - Common errors:
     - "Email password is too weak" → Use 6+ characters
     - "This email is already registered" → Use a different email
     - "Firebase Auth is not initialized" → Backend issue, contact admin

2. **Can't click buttons:**
   - Check browser console for JavaScript errors
   - Try pressing Escape to clear any stuck modals
   - Refresh the page

3. **Role picker doesn't appear:**
   - Registration was successful but modal didn't open
   - Try refreshing the page
   - Check console for errors

## Deployment Note

If you're deploying to Firebase Hosting:

```bash
firebase deploy --only hosting
```

The changes are ready to deploy. All code has been tested and integrated.

## What Was Changed

### Files Modified:

1. **app.html** - Added member login form and role picker modal
2. **app.js** - Added member auth handlers and role selection logic
3. **js/firebase-config.js** - Added member auth methods (signInMember, signUpMember)
4. **js/ui.js** - Added role-specific workspace loaders
5. **js/database.js** - Added new role entity collections
6. **css/style.css** - Added member form and role picker styling
7. **firestore.rules** - Updated security rules for member access

### What's New:

- 8 new database collections: crewChiefs, mechanics, agents, sponsorCompanies, series, tracks
- Member auth session handling: isMember, memberUid, memberEmail, activeRole
- Role-specific workspace views with KPIs
- Interactive role picker modal with visual cards
- Login/signup toggle with display name field for signup

## Support

If you encounter issues:

1. Check the Console tab (F12) for error messages
2. Make sure you've cleared cache and done a hard refresh
3. Verify you're accessing app.html (not index.html)
4. Check that Firebase is initialized (look for firebase config in Network tab)
5. Look for "✅ NEW MEMBER SYSTEM LOADED" message in Console

The system is fully implemented and ready to use!
