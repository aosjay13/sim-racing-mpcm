# Phoenix's Sim Racing Multiplayer Career Mode (SRMPC)

A web app for managing a multiplayer sim-racing career: drivers, teams, race schedule, and standings.

Live GitHub Pages site:
https://aosjay13.github.io/sim-racing-mpcm/

## What Changed for GitHub Pages

This repository now uses:
- `index.html` as a public landing page
- `app.html` as the full SRMPC application

That means your root site URL can act as a clean project home page, while the app stays one click away.

## Quick Links

- Landing page: `index.html`
- Main app: `app.html`
- Core styles: `css/style.css`
- App bootstrap: `js/app.js`
- Data layer: `js/database.js`
- UI handlers: `js/ui.js`
- Firebase config: `js/firebase-config.js`

## Features

- Driver management with profile details
- Team management with team colors
- Race calendar and event scheduling
- Championship standings table
- Multi-game support
- Firebase-backed persistence (Firestore)

## Supported Sim Titles

- iRacing
- NASCAR Racing 2003
- Wreckfest
- Wreckfest 2
- Automobilista 1
- Automobilista 2
- BeamNG.Drive

## Tech Stack

- HTML5
- CSS3
- JavaScript (ES6+)
- Firebase (Firestore/Auth/Storage SDK loaded in app)

## Local Development

1. Clone repo:
   ```bash
   git clone https://github.com/aosjay13/sim-racing-mpcm.git
   cd sim-racing-mpcm
   ```

2. Run a local static server:
   ```bash
   python -m http.server 8000
   ```

3. Open:
   - `http://localhost:8000/` (landing page)
   - `http://localhost:8000/app.html` (full app)

## Firebase Setup

1. Create/select a Firebase project in Firebase Console.
2. Enable Firestore.
3. Put your project config in `js/firebase-config.js`.

Expected shape:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

## Deploy to GitHub Pages

1. Commit and push to `main`.
2. In GitHub repo settings, open Pages.
3. Set Source to `Deploy from a branch`.
4. Select branch `main` and folder `/ (root)`.
5. Save.

Your live URL:
https://aosjay13.github.io/sim-racing-mpcm/

App direct URL:
https://aosjay13.github.io/sim-racing-mpcm/app.html

## Suggested Git Commands

Use these from the repository root:

```bash
git add README.md index.html app.html
git commit -m "Add GitHub Pages landing page and full README"
git push origin main
```

## Notes

- `index.html` is intentionally lightweight for visitors.
- `app.html` preserves the original SRMPC interface and scripts.
- If you want the app at root again later, swap files or redirect root to `app.html`.
