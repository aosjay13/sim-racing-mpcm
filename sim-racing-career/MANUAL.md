# Phoenix SRMPC — League Manual

How to use the multiplayer league app (`app.html`), for drivers, other career roles and the
Game Master. New here? The short version is [GETTING_STARTED.md](GETTING_STARTED.md). The
single-player mode has its own guide: [SOLO_CAREER.md](SOLO_CAREER.md).

**Live app:** <https://aosjay13.github.io/sim-racing-mpcm/app.html>

## Contents

1. [Signing in](#signing-in)
2. [Getting around](#getting-around)
3. [Career roles](#career-roles)
4. [Racing as a driver](#racing-as-a-driver)
5. [Money, cars and contracts](#money-cars-and-contracts)
6. [League Hub](#league-hub)
7. [Game Master guide](#game-master-guide)
8. [Points systems](#points-systems)
9. [Troubleshooting](#troubleshooting)

## Signing in

The sign-in screen has two tabs and a career-mode picker.

- **🏎️ Player**: sign in with email and password, or **New here? Create a player account**
  (display name, email, password of 6+ characters). **Forgot password** emails a reset link
  to the address you typed.
- **⚙️ Game Master**: enter the league passcode to run the league.
- **Career mode**: a league can host several separate worlds (each with its own players,
  results, money and GM passcode). Pick the one you're joining.
- **🏁 Play Solo Career** opens the single-player mode, no account needed.

The first time you sign in to a career you pick a **difficulty**, which sets your starting
money, and then a **career role**.

## Getting around

| Tab | What's there |
| --- | --- |
| **Dashboard** | Your next step (for players), next races, the featured championship, latest results, active challenges, Hall of Fame |
| **Series** | Every championship; open one for its schedule, standings and car numbers |
| **Races** | Calendar and race list; click a race for its briefing, entry list and results |
| **Standings** | Driver and team championships with points progression, per series and season |
| **Stats** | Records, track history and career tables |
| **Challenges** | Weekly / monthly solo and multiplayer challenges you can claim |
| **League Hub** | News, achievements, the player directory and recruitment |
| **Dealership** | Buy cars for your personal or team garage |
| **My Career** | Your role's workspace |
| **Admin** | Game Master console (GM only) |
| **Solo Career ↗** | The single-player mode |

The header shows your name, your role (click it to switch), the career you're in, the
light/dark toggle, **GM** (unlock Game Master on top of your player login) and **Sign out**.
On a phone, the ☰ button opens the menu.

## Career roles

| Role | What you do |
| --- | --- |
| 🏎️ **Driver** | Race, earn points and prize money, sign contracts with teams |
| 🏢 **Team Owner** | Found or buy a team, hire drivers and crew, manage the team budget |
| 📋 **Crew Chief** | Strategy and race-day calls for a team |
| 🔧 **Mechanic** | Keep a team's cars running |
| 💼 **Agent** | Represent drivers and broker seats and sponsorships |
| 💰 **Sponsor** | Back teams and drivers |
| 🏆 **Series Owner** | Propose and promote championships |
| 🛣️ **Track Owner** | Register venues and host league races |

Switch roles any time from **My Career → ⇄ Switch Role**; progress in each role is kept.

## Racing as a driver

1. **Create your driver**: My Career → Driver → **Start from scratch** (or **Join an
   established team** to apply to one straight away). You set a name, nickname,
   nationality, age and helmet colour. Car numbers come from the league's number registry,
   not the sign-up form.
2. **Find a race**: the dashboard's next-step banner points you to the next open race, or
   browse **Races**. If the series requires a car, you need an eligible one in your garage
   (or your team's); the race window tells you which.
3. **Sign up**: open the race and press **🏁 Sign me up**.
4. **Set up your game**: the race window's **🎮 Set this up in your game** card lists the car,
   track type and lap length, distance, weather and time of day (the same for every driver),
   grid size, lobby realism settings and which results file your sim saves. **📋 Copy setup**
   copies it for the lobby host.
5. **Report your result**: on race day (or once the GM marks the race live) the race window
   shows **📝 Report my result**: finishing position or DNF, grid slot, laps led, incidents,
   fastest lap. You can update it until the official results are in.
6. **Results**: once the GM saves the results, standings, stats, prestige, prize money,
   contract pay and achievements all update. Your workspace keeps your race history.

**Prestige** stars (1★ Rookie up to Legend) grow with points, wins, poles and titles, and
decide which teams and deals you can reach.

## Money, cars and contracts

- **Two wallets**: your personal money and, for team owners, a separate team budget. The
  **Earnings & Spending** panel lists every payment.
- **Race-day payouts**: prize money by finishing position, team shares, sponsor deals,
  contract salaries, agent commissions, venue and promoter fees.
- **Dealership & garage**: buy cars into your personal or team garage; series can require
  specific cars.
- **Contracts and deals**: every seat and sponsorship is negotiated in a deal room with
  offers and counter-offers (salary, buyout, exclusivity, performance clauses). Nothing is
  signed automatically.
- **Car numbers**: won or leased through the registry. Team owners and 5★ drivers can
  **＋ Request a number** on a series page, which opens a 3-day sealed-bid auction.

## League Hub

- **News**: race results and league announcements.
- **Achievements**: unlocked automatically from results. The list includes First Start,
  On the Board, podiums, wins, poles, fastest laps, 10 Wins, 100 Starts, Charger (10+ places
  gained), Last to First, Grand Slam, Wrecking Ball and League Champion.
- **Players**: the player directory and profiles.
- **Recruitment**: open seats, the job board, applications and offers. The red badge on
  **League Hub** counts things waiting on you.

## Game Master guide

Unlock with the passcode on the sign-in screen (or **GM** in the header while signed in as
a player). Everything lives under **Admin**.

### Overview

A **🚀 Get your league racing** checklist appears until the league is set up (add a game,
create a series, schedule races, invite drivers, run the first race), with a button for each
step. Below it are the **🤖 League Director**, **Quick Actions** and **Needs Your Attention**
(races your drivers entered that are waiting for results, challenge claims, series
proposals).

### League Director (autopilot)

The Director does the routine Game Master work whenever a GM has the app open (on sign-in,
right after results are saved, and every 10 minutes), and logs everything it does in its
panel. Each job can be switched off:

| Switch | What it does |
| --- | --- |
| Simulate races nobody entered | After the grace period (default 2 days) a race with no entries is simulated with the AI field, or cancelled if the series has no AI |
| Race the AI field around your results | The results form's AI option is ticked by default: your drivers keep the positions you enter, AI drivers fill the rest |
| Close seasons and crown champions | When every round of a season is done: champion, title bonuses and termination clauses, car-number rollover, league news |
| Schedule the next season | Real calendar for library series (scaled to your race length), otherwise last season's tracks; on your race day, time and cadence |
| AI principals answer applications | Applications to AI teams get an opening offer in the applicant's deal room straight away; release requests are granted |
| Keep AI teams' seats filled | Empty AI seats go to the best free agent, or a new rookie |
| Run car-number auctions | Auctions close 3 days after opening; renewal windows last 7 days, then the number goes to auction |
| Run challenges | Keeps a weekly set posted, verifies measurable ones (podium, pole, fastest lap, clean race, places gained…) from results, approves the rest after 2 days |
| Approve series proposals | Player-proposed series go live |
| Confirm results from driver reports (off by default) | When every entered driver has reported, the race confirms itself |

**Run now** runs it on demand. Turning the master switch off stops everything.

### Games

- **📚 Add from library** installs any of the 24 games the Solo Career supports with its real
  series (each with its points system), its tracks, and optionally an **AI field** of rival
  teams and drivers per series. Installing again only adds what's missing.
- **＋ Custom game** adds any other sim by hand; its edit form can link it to a library
  profile for briefings, track info and results import.

### Series, seasons and the schedule

- **Series**: create or edit a championship (game, points system, logo, eligible cars,
  highest car number). **Seasons** groups races into a season and crowns champions when you
  close it.
- **📅 Schedule Builder**: pick the series and season, the first date, time and cadence, and
  list the tracks one per line. Add `| laps` to set a round's distance
  (`Watkins Glen | 40`). Library series have **Load the real calendar**, scaled to a race
  length.

### Races and results

- **Races** lists every race: add or edit one, mark it **live**, simulate it (AI grid), or
  enter results.
- **Enter Results**: drivers' own reports are pre-filled and marked *reported*. Or use
  **📂 Import a results file**: rFactor / LMU / AMS XML, GTR2 / RACE 07 logs, NR2003 HTML,
  iRacing CSV, AC / ACC JSON, any CSV, or a pasted finishing order. Names are matched to
  league drivers; fix any flagged row, then **Apply**. Lobby guests and AI are skipped and
  positions re-numbered (untick to keep the file's positions). Optional columns: Grid, Inc,
  Led, Laps; pick pole and fastest lap. **Save Results** scores the race and runs the payouts
  (first save only, so editing never double-pays). **Reopen** clears results.

### World, people and money

- **Teams / Drivers**: add, edit and delete; generate free agents and rival AI teams.
- **World**: tracks and track packs, sponsors, staff, AI personas, the Real-World Pack.
- **Players**: player accounts and role resets.
- **Challenges**: generate or write challenges and review claims.
- **Numbers**: the car-number registry, auctions and renewals.
- **AI Finance**: how AI teams are funded, with GM overrides.
- **GM Override**: rename anything, edit wallets and contracts, and a raw document editor.
- **Settings**: career modes (create, rename, reset, delete), the **🔑 Passcode** for this
  career, and data export.

Change the Game Master passcode in **Settings** before you share the app, because the
built-in default is public.

## Points systems

| System | Points |
| --- | --- |
| Formula 1 | 25-18-15-12-10-8-6-4-2-1, +1 fastest lap |
| Formula 1 + fastest lap | as F1, +1 fastest lap for a top-10 finisher |
| Formula 2 feature | as F1, +2 pole, +1 fastest lap (top 10) |
| MotoGP / GT | 25-20-16-13-11-10-9-8-7-6-5-4-3-2-1 |
| IndyCar | 50-40-35-32-30… +1 pole |
| NASCAR modern | 40-35-34-33… |
| NASCAR 1975–2003 | 175-170-165… +5 for leading a lap, +5 for leading the most laps |
| ARCA / short track | 50-45-43-42… |
| WEC | 25-18-15… +1 pole |
| BTCC | 20-17-15-13… +1 fastest lap, +1 for leading a lap |
| WTCC | 10-8-6-5-4-3-2-1 |
| DTM | 25-18-15… +3 pole |
| Super GT | 20-15-11-8-6-5-4-3-2-1 |
| Karting | 25-20-17-15-13… |
| Rally | 25-18-15-12-10-8-6-4-2-1 |
| Wreckfest | 10-8-6-5-4-3-2-1 +1 per wreck |
| Simple | 10-9-8…1 |
| Custom | your own list |

Points are always recomputed from the results, so changing a series' points system updates
every standing.

## Troubleshooting

- **"Can't reach the league server"**: your network or a blocker is stopping Firebase
  (`gstatic.com`, `firebaseio.com`, `googleapis.com`). Allow them and reload. The Solo Career
  works offline in the meantime.
- **"Email sign-in isn't switched on"** or **"website address isn't authorised"**: the league
  owner needs to finish the Firebase checklist in [GETTING_STARTED.md](GETTING_STARTED.md).
- **Admin shows "anonymous sign-in is disabled"**: GM saves need Anonymous sign-in enabled in
  Firebase → Authentication → Sign-in method.
- **Can't sign up for a race**: check the race window, which says which car the series
  requires; buy one in the Dealership (or race for a team that owns one).
