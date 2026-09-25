# Quick Start Guide

Get your Sim Racing Career app up and running in 5 minutes!

## What You Have

```
sim-racing-career/
├── index.html                 # Main app file
├── README.md                  # Full documentation
├── FIREBASE_SETUP.md         # Firebase configuration guide
├── DEPLOYMENT.md             # Deployment instructions
├── QUICK_START.md            # This file!
├── css/
│   └── style.css             # Racing-themed styles
├── js/
│   ├── firebase-config.js    # Firebase configuration
│   ├── database.js           # Database operations
│   ├── ui.js                 # UI interactions
│   └── app.js                # Main app logic
└── assets/                   # For images/files (empty for now)
```

## Step 1: Get Firebase Ready (2 minutes)

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create new project
3. Add Firestore Database (test mode)
4. Copy your config from Project Settings
5. Paste into `js/firebase-config.js` (replace the placeholder values)

Save the file. You're done with Firebase setup!

## Step 2: Run Locally (1 minute)

```bash
cd sim-racing-career

# Option A: Python
python -m http.server 8000

# Option B: Node.js
npx http-server

# Then open: http://localhost:8000
```

## Step 3: Load Sample Data (30 seconds)

1. Open browser console (F12)
2. Type: `loadSampleData()`
3. Press Enter
4. You should see sample teams, drivers, and races!

## Step 4: Explore the App (1 minute)

- **Dashboard**: Overview and upcoming races
- **Drivers**: Add/manage drivers
- **Teams**: Create racing teams
- **Calendar**: Schedule races
- **Standings**: View championship points

## Step 5: Add Your First Driver (30 seconds)

1. Click "Drivers" tab
2. Click "+ New Driver"
3. Fill in Driver Name (required)
4. Click "Add Driver"
5. Done!

## What Works Now ✅

- ✅ Add drivers
- ✅ Add teams
- ✅ Schedule races
- ✅ View calendar
- ✅ Track standings
- ✅ Search/filter drivers
- ✅ Dashboard overview
- ✅ Real-time updates

## Next: Deploy to Google Sites

When ready to share:

### Quick Deploy (Firebase Hosting)
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy --only hosting
```

Your app will be at: `https://your-project.web.app`

### Then embed in Google Sites
```html
<iframe 
  src="https://your-project.web.app/" 
  width="100%" 
  height="800px" 
  frameborder="0">
</iframe>
```

## Keyboard Shortcuts

- `Escape` - Close any modal
- `Ctrl+Shift+D` - Load sample data

## File Guide

### index.html
- Main HTML structure
- All dialogs/modals
- Form definitions

### css/style.css
- Racing aesthetic
- Modern dark theme
- Responsive design
- 1500+ lines of styling

### js/firebase-config.js
- Firebase initialization
- Database helper functions
- Collection operations

### js/database.js
- Driver management
- Team management
- Race scheduling
- Standings tracking
- Sponsorship system

### js/ui.js
- View switching
- Modal management
- Data rendering
- Filtering

### js/app.js
- Event listeners
- Form handlers
- Initialization
- Sample data loader

## Common Tasks

### Add a new driver
1. Click "Drivers" tab
2. Click "+ New Driver"
3. Fill form and submit

### Create a team
1. Click "Teams" tab
2. Click "+ Create Team"
3. Enter team info
4. Drivers can be assigned to this team

### Schedule a race
1. Click "Calendar" tab
2. Click "+ Schedule Race"
3. Choose simulation game (iRacing, Wreckfest, etc)
4. Set date and track

### View standings
1. Click "Standings" tab
2. Filter by game if desired
3. See championship points

### Search drivers
1. Go to "Drivers" tab
2. Type in search box
3. Filter by team with dropdown

## Customization Ideas

### Change Colors
Edit `css/style.css`:
```css
:root {
    --primary-accent: #FF4444;  /* Change this color */
    --secondary-accent: #FFD700;
}
```

### Add More Racing Games
Edit `index.html`, find the race-game select:
```html
<option value="my-game">My Racing Game</option>
```

### Modify Point System
Edit `js/database.js`, function `getDefaultPointsSystem()`:
```javascript
function getDefaultPointsSystem() {
    return {
        1: 25,  // 1st place
        2: 18,  // etc
    };
}
```

## Database Structure

All data stored in Firebase Firestore collections:
- `drivers` - Driver profiles and stats
- `teams` - Racing team information
- `races` - Scheduled races
- `standings` - Championship points
- `sponsorships` - Sponsor deals

Data automatically syncs across tabs!

## Troubleshooting

### "Firebase not initialized"
- Update `js/firebase-config.js` with your real config
- Check browser console for errors

### Data not saving
- Check Firestore is enabled
- Verify security rules allow writes
- Check Firebase quota

### Styles not loading
- Refresh page (Ctrl+F5)
- Check Network tab in DevTools
- Verify css/style.css exists

### Empty standings
- Load sample data first (`loadSampleData()`)
- Or manually add drivers

## Next Steps

1. ✅ Configure Firebase (FIREBASE_SETUP.md)
2. ✅ Test locally
3. ✅ Deploy (DEPLOYMENT.md)
4. ✅ Embed in Google Sites
5. ⬜ Customize appearance
6. ⬜ Add more racers
7. ⬜ Set up sponsorships
8. ⬜ Invite friends!

## More Information

- Full docs: `README.md`
- Firebase setup: `FIREBASE_SETUP.md`
- Deployment: `DEPLOYMENT.md`
- Customize & extend the app to fit your needs!

## Getting Help

### In-app
- Press `F12` to open console
- Look for error messages
- Check tabs work smoothly

### Online Resources
- [Firebase Docs](https://firebase.google.com/docs)
- [MDN JavaScript](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
- [Firebase Console](https://console.firebase.google.com)

---

**Ready to manage your motorsport empire? Let's go! 🏁🏎️**

Questions? Check the README.md for comprehensive documentation.
