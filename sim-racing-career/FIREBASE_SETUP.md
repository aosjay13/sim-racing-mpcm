# Firebase Setup Guide

This guide will walk you through setting up Firebase for your Sim Racing Career application.

## Step 1: Create a Firebase Project

1. Navigate to [Firebase Console](https://console.firebase.google.com)
2. Click "Add project"
3. Enter project name: `sim-racing-career` (or your preferred name)
4. Uncheck "Enable Google Analytics" (optional)
5. Click "Create project"
6. Wait for project to be created

## Step 2: Set Up Firestore Database

1. In the Firebase Console, click on "Build" in the left sidebar
2. Click "Firestore Database"
3. Click "Create database"
4. Select "Start in test mode" (for development)
5. Choose your region (closest to your location is best)
6. Click "Create"

### Firestore Security Rules (Development)
For testing, use these open rules (never use in production):

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

1. In Firestore, go to "Rules" tab
2. Replace all rules with above
3. Click "Publish"

## Step 3: Get Your Firebase Config

1. Go to Project Settings (click gear icon in top-left)
2. Under "Your apps", click "Web" (if no apps yet, create one)
3. Copy the config object that looks like:

```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123def456"
};
```

## Step 4: Update Your Application Config (Private)

1. Create `js/firebase-config.local.js` in your project
2. Paste your Firebase config into that file
3. Save the file

Use this structure:

```javascript
window.__SRMPC_FIREBASE_CONFIG__ = {
  apiKey: "YOUR_ACTUAL_API_KEY",
  authDomain: "your-actual-project.firebaseapp.com",
  projectId: "your-actual-project-id",
  storageBucket: "your-actual-project.appspot.com",
  messagingSenderId: "YOUR_ACTUAL_SENDER_ID",
  appId: "YOUR_ACTUAL_APP_ID"
};
```

`js/firebase-config.local.js` is gitignored, so your key will not be committed.

```javascript
const firebaseConfig = {
    apiKey: "YOUR_ACTUAL_API_KEY",
    authDomain: "your-actual-project.firebaseapp.com",
    projectId: "your-actual-project-id",
    storageBucket: "your-actual-project.appspot.com",
    messagingSenderId: "YOUR_ACTUAL_SENDER_ID",
    appId: "YOUR_ACTUAL_APP_ID"
};
```

## Step 5: Create Database Collections

The application will auto-create collections as you add data, but you can pre-create them:

1. In Firestore, click "Create collection"
2. Enter collection name: `drivers`
3. Click "Auto-ID" and then "Save" (creates first empty doc)
4. Delete that document
5. Repeat for these collections:
   - `teams`
   - `races`
   - `standings`
   - `sponsorships`

## Step 6: Test Your Setup

1. Run your application locally
2. Open browser console (F12)
3. You should see: "Firebase initialized successfully"
4. In the browser console, type: `loadSampleData()`
5. Go to Firebase Console > Firestore and verify documents were created

## Step 7: Set Up Firebase Hosting (Optional)

For easier deployment and Google Sites embedding:

1. Install Firebase CLI:
   ```bash
   npm install -g firebase-tools
   ```

2. Login to Firebase:
   ```bash
   firebase login
   ```

3. Initialize Firebase hosting in your project:
   ```bash
   cd sim-racing-career
   firebase init hosting
   ```

4. When prompted:
   - Select your project
   - Set public directory to: `.` (current directory)
   - Configure as single-page app: `Yes`

5. Deploy:
   ```bash
   firebase deploy --only hosting
   ```

6. Your app will be hosted at: `https://your-project.web.app`

## Step 8: Embed in Google Sites

Once deployed to Firebase Hosting:

1. Open your Google Site
2. Click "Insert"
3. Select "Embed code"
4. Paste this code:

```html
<iframe 
  src="https://your-project.web.app/" 
  width="100%" 
  height="800px" 
  frameborder="0"
  style="border: none; margin: 0; padding: 0;">
</iframe>
```

5. Click "Insert"

## Environment Variables (For Firebase Projects Hosting)

If using Firebase Hosting, create a `.env` file with:

```
FIREBASE_API_KEY=your_api_key
FIREBASE_PROJECT_ID=your_project_id
```

Then update `js/firebase-config.js` to read from `.env`:

```javascript
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    // ...
};
```

## Quick Setup Option (No File Editing)

If you do not want to edit files, you can store config in your browser for this app:

1. Open `app.html`
2. Open browser devtools console
3. Run:

```javascript
SRMPCFirebase.setConfig({
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123def456"
});
```

To clear a saved browser config later:

```javascript
SRMPCFirebase.clearConfig();
```

If Firebase is not initialized and you want an interactive setup, run:

```javascript
SRMPCFirebase.quickSetup();
```

## Firestore Backup

### Auto Backup (Recommended)
1. Go to Firestore Database
2. Click "Backups" tab
3. Click "Create Backup"
4. Enable automatic backups

### Manual Backup
```bash
gcloud firestore export gs://your-bucket-name/backups/$(date +%Y%m%d-%H%M%S)
```

## Production Security Rules

When ready for production, implement proper security:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Only authenticated users can read/write
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
    
    // Users can only modify their own data
    match /users/{userId} {
      allow read, write: if request.auth.uid == userId;
    }
  }
}
```

## Troubleshooting

### "Firebase is not defined"
- Check that Firebase CDN scripts are loaded in `index.html`
- Open browser console and check for network errors

### "Permission denied" errors
- Update Firestore security rules to test mode
- Check that Firestore is enabled in your project

### Data not appearing
- Verify Firestore database is active and has data
- Check browser console for errors
- Verify Firebase config is correct

### Connection timeout
- Check your internet connection
- Verify Firebase project is running
- Check Firebase console for service status

## Firebase Quotas

Free tier includes:
- 1 GB storage
- 50K read operations/day
- 20K write operations/day
- 20K delete operations/day

Monitor usage in Firebase Console > Quotas

## Next Steps

1. ✅ Set up Firebase Project
2. ✅ Configure Firestore
3. ✅ Add Firebase config to app
4. ✅ Test with sample data
5. ⬜ Deploy to Firebase Hosting
6. ⬜ Embed in Google Sites
7. ⬜ Set up proper security rules
8. ⬜ Start using the app!

---

**Need help?** Check Firebase docs: https://firebase.google.com/docs
