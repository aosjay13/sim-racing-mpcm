# Phoenix's Sim Racing Multiplayer Career Mode (SRMPC)

Two ways to run a sim-racing career across every game you play:

| | **Solo Career** (`career.html`) | **League app** (`app.html`) |
| --- | --- | --- |
| Who | You, single-player | A multiplayer league with a Game Master |
| Account | None — saved in your browser, works offline | Firebase email/password or GM passcode |
| What | 40-season careers in one game: contracts, money, sponsors, R&D, facilities, staff, calendars, standings, an evolving AI world, and a Paddock of your own cars, dealers, shops and side events | Shared series, schedules, results, standings, deals, teams, number registry, and the Paddock: garages, new and used dealers, mechanic shops, sponsors, training, side events, loans |

Live site: <https://aosjay13.github.io/sim-racing-mpcm/>

**New here? Read [GETTING_STARTED.md](GETTING_STARTED.md)**: how to play the Solo Career,
join a league as a driver, run one as the Game Master, and the league owner's one-time
Firebase checklist.

## Solo Career

Pick a game, a series and a role (driver, owner-driver or team principal). Before
each round the app tells you what to set up in your sim — track, laps, weather and
the AI level that matches your car against the field. Race it, then log or import
the result. See **[SOLO_CAREER.md](SOLO_CAREER.md)** for the full guide.

Supported games: NASCAR Racing 2003 Season, iRacing, Automobilista 2, Assetto
Corsa, Assetto Corsa Competizione, Project CARS, Project CARS 2, EA SPORTS F1
(22–25), NASCAR 26 (and 25), GTR 2, RACE 07 (+ GTR Evolution / STCC), RaceRoom,
Wreckfest, Wreckfest 2, Automobilista, rFactor, rFactor 2, Le Mans Ultimate,
Gran Turismo 7, Forza Motorsport, BeamNG.drive, NASCAR Heat 5, EA SPORTS WRC,
DiRT Rally 2.0 — plus a **Custom game** builder for anything else.

## League app

Firebase-backed multiplayer league: players register, pick roles (driver, team
owner, crew, agent, sponsor…), negotiate contracts in deal rooms, and the Game
Master runs series, schedules, results and simulations. See `MANUAL.md`.

### The Paddock (between races)

`js/paddock-core.js` holds the rules (pure functions, shared with the Solo Career); the league
screens are `js/srmpc-paddock.js` and `js/srmpc-paddock-trade.js`. Every player gets a **🅿️
Paddock** tab with paddock time that refills after each race they run:

- **Garage**: six components per car wear on race day; condition sets the car's performance
  index, reliability, value and the race window's AI-level tip. Worn cars get a pre-race
  "mechanical gremlin" order (retire on lap N). Garage levels from Driveway to Pro Facility.
- **Shops & DIY**: seven NPC mechanic shops plus player-run shops (Mechanic role, with a bookings
  queue and walk-in diagnosis jobs), twelve upgrade parts in four tiers, dyno tunes, inspections.
- **Dealers**: Phoenix Motors (the GM catalog: warranty, finance, trade-ins), four used lots that
  restock weekly with hidden faults, inspections and haggling, and the Player Market (private
  sales and the new 🚘 Car Dealer role's lots, with AI walk-in buyers).
- **Sponsors** with slots, objectives, happiness, appearance requests and renewals, for drivers
  and team owners; **training** of eight RPG skills with perks; **side events**; **paddock event**
  cards; **fans and merch**; **loans** with a credit score.
- Race day settles it all inside `Sim.payoutRace`. The GM tunes it in *Admin → 🅿️ Paddock*.
- Nothing needs a new Firestore collection: state lives on `users`, `teams`, `roleProfiles`
  and `config/paddock`.

See [MANUAL.md](MANUAL.md#the-paddock-between-races).

### League Director (Game Master autopilot)

The GM's only regular job is entering race results. The **🤖 League Director**
(`js/srmpc-director.js`, *Admin → Overview*) simulates races nobody entered, races the AI
field around the GM's results, crowns champions and schedules the next season, has AI team
principals answer applications on the spot, refills AI seats, runs number auctions and
weekly challenges, and approves series proposals. It runs in Game Master sessions (on
sign-in, after results are saved, every 10 minutes) and logs everything it does. See
[GETTING_STARTED.md](GETTING_STARTED.md#run-a-league-as-the-game-master-the-hands-off-way).

### Shared with the Solo Career

Both modes run on the same game library, so a league race and a solo race look
and score the same:

- **Game library** — *Admin → Games → 📚 Add from library* installs any of the 24
  games with its real series (same points systems as the Solo Career), its track
  list (with track types and lap lengths) and, optionally, an AI field of rival
  teams and drivers for each series.
- **Real calendars** — the Schedule Builder's *Load the real calendar* fills in the
  season's tracks with per-round laps (`Track | laps`), scaled to a race length.
- **Race briefing** — every upcoming race shows *Set this up in your game*: car,
  track type, distance, weather and time of day (the same for every driver), grid,
  lobby realism settings and which results file to save. *Copy setup* puts it on
  the clipboard for the host.
- **Report my result** — on race day, signed-up drivers log their own finish, grid
  slot, laps led and incidents, just like the Solo Career. The Game Master's results
  form arrives pre-filled from those reports.
- **Results import** — the GM can load the sim's results file (rFactor / LMU / AMS
  XML, GTR2 / RACE 07 logs, NR2003 HTML, iRacing CSV, AC / ACC JSON, any CSV) or paste
  a finishing order. Names are matched to league drivers; guests and AI in the
  lobby are skipped and positions re-numbered.
- **Characters** — driver profiles take a nationality (with flag), nickname, age
  and helmet colour, like the Solo Career's character creator.
- **Points & achievements** — the league gains the Solo points systems (NASCAR
  classic with laps-led bonuses, ARCA, BTCC, DTM, WEC, Super GT, karting, rally,
  Wreckfest wrecks…) and Solo-style achievements (Last to First, Grand Slam,
  Charger, 10 Wins, 100 Starts…).

## Project files

- `index.html` — landing page
- `career.html`, `css/career.css`, `js/solo/` — Solo Career (`sc-tracks.js`, `sc-gamedb.js`,
  `sc-names.js` and `sc-import.js` are also loaded by the league app)
- `js/srmpc-library.js` — the league's bridge to the shared library
- `js/paddock-core.js` — Paddock rules shared by both modes; `js/srmpc-paddock.js`,
  `js/srmpc-paddock-trade.js` (league) and `js/solo/sc-paddock.js` (Solo Career)
- `app.html`, `css/style.css`, `js/srmpc-*.js` — League app (`js/srmpc-core.js` holds the Firebase config)
- `firestore.rules` — Firestore security rules for the league app
- `docs/design/` — design notes (contracts, recruitment, car number registry); `docs/archive/` — older notes

## Local development

```bash
python3 -m http.server 8000   # from the repository root
# http://localhost:8000/sim-racing-career/career.html  (Solo Career)
# http://localhost:8000/sim-racing-career/app.html     (League app)
```

Headless verification lives in `.claude/skills/verify/` (see its `SKILL.md`).
