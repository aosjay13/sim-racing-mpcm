# Sim Racing Multiplayer Career Mode (SRC Career)

A modern, embeddable web application for managing a text-based roleplaying motorsport career platform. Track drivers, manage teams, schedule races, monitor standings—all with support for multiple racing simulations.

## Features

✨ **Core Features**
- 🏎️ Driver Management - Create and manage driver profiles with stats tracking
- 🏁 Team Management - Build racing teams with colors, sponsors, and members
- 📅 Race Calendar - Schedule races across multiple simulations
- 🏆 Championship Standings - Real-time championship points tracking
- 📊 Statistics Database - Comprehensive career stats for all participants
- 🎮 Multi-Game Support - iRacing, NASCAR Racing 2003, Wreckfest, BeamNG, and more
- 🤝 Sponsorship System - Manage sponsor deals and partnerships
- 💾 Real-time Database - Powered by Firebase Firestore

## Supported Racing Games

- iRacing
- NASCAR Racing 2003
- Wreckfest
- Wreckfest 2
- Automobilista 1
- Automobilista 2
- BeamNG.Drive
- And more! (Easily extensible)

## Technology Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Backend**: Firebase (Firestore, Authentication, Storage)
- **Styling**: Modern racing aesthetic with dark theme
- **Deployment**: Google Sites (via embed code)

## Quick Start

### 1. Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project (name it "sim-racing-career" or similar)
3. Enable Firestore Database (Start in test mode for development)
4. Enable Authentication (optional, for future enhancements)
5. Copy your Firebase config and update `js/firebase-config.js`

Your Firebase config will look like:
```javascript
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "SENDER_ID",
    appId: "APP_ID"
};
```

### 2. Local Testing

```bash
# Navigate to the project directory
cd sim-racing-career

# Start a simple local server (Python 3)
python -m http.server 8000

# Or using Node.js http-server
npx http-server

# Open http://localhost:8000 in your browser
```

### 3. Load Sample Data

In the browser console, type:
```javascript
loadSampleData()
```

This will create sample teams, drivers, races, and standings for testing.

### 4. Deploying to Google Sites

#### Option A: Embed via Google Sites
1. Open your Google Site
2. Click "Insert" > "Embed" > "Embed code"
3. Use this embed code:

```html
<iframe 
  src="https://your-hosting-url/sim-racing-career/" 
  width="100%" 
  height="800px" 
  frameborder="0"
  style="border: none;">
</iframe>
```

#### Option B: Host on GitHub Pages

```bash
# Create a GitHub repository
# Push the sim-racing-career folder to GitHub
git add .
git commit -m "Initial commit"
git push origin main

# Enable GitHub Pages in repository settings
# Use: https://yourusername.github.io/sim-racing-career/
```

#### Option C: Host on Firebase Hosting

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize Firebase hosting
firebase init hosting

# Deploy
firebase deploy --only hosting
```

## User Interface Guide

### Dashboard
- Overview of your career
- Quick stats: total drivers, teams, completed races
- Upcoming events
- Recent activity feed

### Drivers
- View all drivers
- Add new drivers
- Manage driver stats and career history
- Filter by team or search by name
- Quick actions: Edit, View, Delete

### Teams
- Manage racing teams
- Set team colors and branding
- Track team statistics
- Manage team sponsorships
- Add drivers to teams

### Calendar
- Visual calendar of scheduled races
- Month navigation
- List of all scheduled races
- Event details (date, time, game, track)

### Standings
- Championship points leaderboard
- Real-time points tracking
- Filter by game/simulation
- Track wins, podiums, races completed

## Database Schema

### Collections

#### drivers
```json
{
  "name": "string",
  "number": "number",
  "teamId": "string",
  "country": "string",
  "bio": "string",
  "avatar": "string",
  "joinDate": "timestamp",
  "isActive": "boolean",
  "stats": {
    "racesEntered": "number",
    "racesCompleted": "number",
    "wins": "number",
    "podiums": "number",
    "polePositions": "number",
    "dnf": "number",
    "totalPoints": "number"
  },
  "sponsorships": "array",
  "careerHistory": "array"
}
```

#### teams
```json
{
  "name": "string",
  "color": "string (hex)",
  "description": "string",
  "logo": "string (URL)",
  "foundedDate": "timestamp",
  "owner": "string",
  "stats": {
    "drivers": "number",
    "racesEntered": "number",
    "totalWins": "number",
    "totalPoints": "number"
  },
  "sponsors": "array",
  "members": "array"
}
```

#### races
```json
{
  "name": "string",
  "date": "timestamp",
  "game": "string",
  "track": "string",
  "status": "scheduled|active|completed",
  "participants": "array",
  "results": "array",
  "pointsSystem": "object",
  "description": "string",
  "streamLink": "string (URL)",
  "recordedLink": "string (URL)"
}
```

#### standings
```json
{
  "season": "number",
  "game": "string",
  "entries": [
    {
      "driverId": "string",
      "points": "number",
      "races": "number",
      "wins": "number",
      "podiums": "number"
    }
  ],
  "lastUpdated": "timestamp"
}
```

#### sponsorships
```json
{
  "driverId": "string",
  "teamId": "string",
  "companyName": "string",
  "dealAmount": "number",
  "startDate": "timestamp",
  "endDate": "timestamp",
  "status": "active|expired|pending|terminated",
  "description": "string"
}
```

## API Reference

### Database Methods

#### Drivers
```javascript
// Create driver
Database.drivers.create(driverData)

// Get all drivers
Database.drivers.getAll()

// Get driver by ID
Database.drivers.getById(driverId)

// Update driver
Database.drivers.update(driverId, updates)

// Delete driver
Database.drivers.delete(driverId)

// Get drivers by team
Database.drivers.getByTeam(teamId)

// Update driver stats
Database.drivers.updateStats(driverId, statsUpdate)
```

#### Teams
```javascript
// Create team
Database.teams.create(teamData)

// Get all teams
Database.teams.getAll()

// Get team by ID
Database.teams.getById(teamId)

// Update team
Database.teams.update(teamId, updates)

// Add sponsor to team
Database.teams.addSponsor(teamId, sponsorData)
```

#### Races
```javascript
// Create race
Database.races.create(raceData)

// Get all races
Database.races.getAll()

// Get upcoming races
Database.races.getUpcoming()

// Set race results
Database.races.setResults(raceId, results)

// Add participant
Database.races.addParticipant(raceId, driverId)
```

#### Standings
```javascript
// Create standings
Database.standings.create(standingsData)

// Get current season standings
Database.standings.getCurrentSeasonStandings()

// Update driver standing
Database.standings.updateDriverStanding(standingsId, driverId, points)
```

## Customization

### Adding a New Racing Game

1. Open `index.html`
2. Find the race game select (`#race-game`)
3. Add a new option:
```html
<option value="my-new-game">My New Game</option>
```

4. Add the game icon in `js/app.js`:
```javascript
const icons = {
    'my-new-game': '🎮'
};
```

### Styling / Theme

- Edit `css/style.css` to customize colors
- Key CSS variables in `:root`:
  - `--primary-accent`: Red/accent color (#FF4444)
  - `--primary-dark`: Dark background (#0F0F0F)
  - `--secondary-accent`: Gold color (#FFD700)

### Points System

Modify the default F1-style points in `js/database.js`:
```javascript
function getDefaultPointsSystem() {
    return {
        1: 25,  // 1st place
        2: 18,  // 2nd place
        // ... customize as needed
    };
}
```

## Firebase Security Rules (Development)

For testing, use this Firestore security rule (OPEN - Not for production):

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

**For production**, implement proper authentication and rules.

## Troubleshooting

### Firebase Not Initialized
- Ensure you've updated `js/firebase-config.js` with your credentials
- Check browser console for error messages
- Verify Firebase credentials are correct

### Data Not Saving
- Check Firebase quota and limits
- Verify Firestore rules allow read/write
- Check browser console for errors

### Embed Not Working on Google Sites
- Ensure URL is HTTPS (Google Sites requires it)
- Check iframe width/height settings
- Verify CORS headers if self-hosting

## Browser Compatibility

- Chrome/Chromium: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support
- Edge: ✅ Full support
- IE 11: ❌ Not supported

## Future Features (Roadmap)

- 🔐 User authentication
- 📱 Mobile app version
- 🎥 Stream integration
- 📢 Notifications and alerts
- 💬 In-app chat/messaging
- 🏅 Achievement/badge system
- 📈 Advanced analytics
- 🔧 Admin panel
- 🌍 Multiplayer lobby
- 🎨 Customizable themes

## Contributing

This is a template/starter project. Feel free to:
- Customize the UI
- Add more features
- Integrate with other APIs
- Deploy to your own Firebase project

## License

Free to use and modify for personal or commercial use.

## Support

For issues or questions:
1. Check the console for error messages
2. Verify Firebase configuration
3. Test with sample data first
4. Review the database schema

---

**Version**: 1.0  
**Last Updated**: 2026-03-27
