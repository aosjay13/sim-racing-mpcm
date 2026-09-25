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

## Run a league as the Game Master (the hands-off way)

The **League Director** runs the league for you. Your only regular job is entering race
results.

**Set up once (about 5 minutes):**

1. On the sign-in screen choose **⚙️ Game Master** and enter the league passcode.
2. **Admin → Settings → 🔑 Passcode**: change it from the built-in default (it's public).
3. **Admin → Overview → 📚 Game library**: pick your game, tick the series you want, and
   keep an **AI field** (rival AI teams and drivers) so every series has a full grid.
4. On the same page, the **🤖 League Director** panel: check the race day, time and race
   length for new seasons, then press **▶ Run now**. It schedules a season for every
   series with an AI field.
5. Copy the app link from the checklist and send it to your drivers.

**Every race after that:**

- Open the app. The Director catches up as soon as you sign in.
- **Needs your attention** lists only races your drivers entered. Open each one and press
  **Enter Results**. Drivers' own reports are already filled in; you can also import the
  sim's results file or paste the finishing order. Leave **🤖 Race the AI field around these
  results** ticked and save.

**What the Director handles for you:**

- Races nobody entered are simulated with the AI field a couple of days after race day.
- The AI field races around your results, so the whole championship moves.
- When every round is done it crowns the champion, pays title bonuses, rolls car numbers
  over, and schedules the next season.
- Drivers and crew who apply to AI teams get an offer in their deal room straight away;
  release requests are granted; empty AI seats get filled.
- Car-number auctions close after 3 days and renewal windows after 7. Team owners and 5★
  drivers can request a number themselves.
- Weekly challenges get posted, checked against race results, and approved.
- Series proposed by players go live.

Every switch is in the Director panel, along with a log of everything it did. Want even
less to do? Tick **Confirm results from driver reports** and races confirm themselves once
every entered driver has reported. (You can still edit any result.)

The Director runs whenever a Game Master has the app open: on sign-in, right after you
save results, and every 10 minutes. There's no server, so if nobody opens the app for a
week it simply catches up next time.

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
