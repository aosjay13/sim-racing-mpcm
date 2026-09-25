# Getting Started

Phoenix SRMPC has two ways to play:

| | Where | Account |
| --- | --- | --- |
| **Solo Career** | <https://aosjay13.github.io/sim-racing-mpcm/career.html> | None, saved in your browser |
| **League** (multiplayer) | <https://aosjay13.github.io/sim-racing-mpcm/app.html> | Email + password |

## Play the Solo Career (2 minutes)

1. Open the Solo Career link and press **New career**.
2. Pick your game (NR2003, iRacing, AMS2, ACC, F1, Wreckfest and 18 more, or a custom game),
   a series, and a role: **Driver**, **Owner-Driver** or **Team Principal**.
3. Create your character and choose difficulty, race length and season length.
4. Press **Start season**. The Race screen tells you exactly what to set up in your sim
   (track, laps, weather, AI level). Race it, then log the result or import the results file.

Saves live in your browser. Use **Settings → Export save** to back up or move a career.
The full guide is [SOLO_CAREER.md](SOLO_CAREER.md).

## Join a league as a driver

1. Open the league link, choose **🏎️ Player**, then **New here? Create a player account**.
2. Enter a display name, email and password (6+ characters) and create the account.
3. Pick a difficulty (it sets your starting money), then choose **Driver** as your role.
4. **Start from scratch** and create your driver: name, nickname, nationality, age, helmet colour.
5. The dashboard now shows your next step. Open the next race and press **Sign me up**.
   If the series needs a specific car, buy one in the **Dealership** first.
6. Read the race's **Set this up in your game** card and race it.
7. After the race, open it again and use **📝 Report my result**. The Game Master confirms
   the official results, and points, prize money and achievements update automatically.

Forgot your password? Type your email on the sign-in screen and press **Forgot password**.

## Run a league as the Game Master

1. On the sign-in screen choose **⚙️ Game Master** and enter the league passcode.
2. **Admin → Overview** shows a *Get your league racing* checklist:
   - **Add a game** with **📚 Game library**: pick a game, tick its series, and choose
     whether to add its tracks and an AI field (rival AI teams and drivers).
   - **Schedule races** with the **Schedule Builder**: pick the series, press
     **Load the real calendar** (or type tracks, one per line, `Track | laps`), set the first
     date and cadence, and generate.
   - **Invite your drivers**: copy the app link and send it round.
   - **Run the first race**: after it, open the race and press **Enter Results**. Drivers'
     own reports are pre-filled; you can also import the sim's results file or paste the
     finishing order. Save, and standings and payouts update.
3. **Admin → Settings** is where you change the Game Master passcode. Do this before you
   share the link, because the built-in default passcode is public.

## League owner: one-time Firebase checklist

The league runs on the Firebase project `sim-racing-career-228a3`. In the
[Firebase console](https://console.firebase.google.com/):

- **Authentication → Sign-in method**: enable **Email/Password** (players) and
  **Anonymous** (the Game Master unlock uses it). Without Anonymous, GM changes are rejected
  and the Admin console shows a warning.
- **Authentication → Settings → Authorized domains**: `aosjay13.github.io` must be listed
  (add any custom domain you use).
- **Firestore rules**: deploy the rules in this folder after any change to them:
  `firebase deploy --only firestore:rules`.

If a player sees *Can't reach the league server*, their network or a blocker is stopping
Firebase (`gstatic.com`, `firebaseio.com`, `googleapis.com`). The Solo Career still works
offline.

## More

- [README.md](README.md): project overview and the features shared by both modes
- [MANUAL.md](MANUAL.md): the full league manual
- [SOLO_CAREER.md](SOLO_CAREER.md): the full Solo Career guide
- [DEPLOYMENT.md](DEPLOYMENT.md) and [FIREBASE_SETUP.md](FIREBASE_SETUP.md): hosting your own copy
- `docs/design/`: design notes for contracts, recruitment and the car number registry
- `docs/archive/`: older implementation notes, kept for history
