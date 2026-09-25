# Solo Career Mode

A single-player career that runs *around* your sim. You race the rounds in your
game; the app carries everything else — contracts, money, sponsors, staff, car
development, facilities, calendars, standings, statistics, and a living AI world
whose drivers age, improve, change teams, get promoted and retire over the
decades.

- **Open it:** `sim-racing-career/career.html` (also linked from the league app's
  sign-in screen, its nav bar, and the landing page).
- **No account, works offline.** Careers are saved in your browser (IndexedDB).
  Export a backup from **Settings → Export save**; import it on the save-slot
  screen (also how you move a career to another device).
- **Up to 40 seasons per character.** After season 40 the character retires into
  the **Hall of Fame**; start a new character to keep going. You can retire early
  between seasons.

## Starting a career

1. **Pick a game** (24 built in, plus *Custom game*).
2. **Pick a series.** Series are grouped into ladders (stock cars, open-wheel,
   GT, endurance, touring, rally, dirt, derby…). The bottom rung is the classic
   start; you can start higher with a small reputation and a backmarker seat.
3. **Pick a role**
   - **Driver** — you race for AI-run teams. Earn a salary, bonuses and personal
     sponsorship; climb the ladder through contract offers.
   - **Owner-Driver** — found your own team and drive for it. You run the budget,
     R&D, facilities, staff, sponsors and your teammate. Two seasons in the red and
     the team goes into administration.
   - **Team Principal** — you don't drive; every round is simulated from your
     pit-wall strategy. The board sets a target; miss it badly and you're fired.
4. **Create your character** (and team, for owners).
5. **Options** — difficulty, race length (10–100 % of real distance), season
   length (full calendar down to ~5 rounds), max cars your game/PC can handle, and
   your **AI calibration** baseline (see below).

## The loop

| Phase | What you do |
| --- | --- |
| Pre-season | Edit the calendar (reorder, add/remove rounds, lap counts, add mod tracks), sign sponsors, hire, start R&D. Press **Start season**. |
| Race weekend | The **Race** screen shows exactly what to set up in your game: track, laps/time, weather, time of day, grid size and the **recommended AI level**. Race it, then log the result, import the results file, or simulate. |
| After each round | Points, prize money, salaries, sponsor payments, R&D progress, the other championships, and your driver rating all update. A report pops up; **Undo last race** is available. |
| Off-season | Season review, awards, champions of every series, contract offers (accept / ask +10 % / +25 % / decline), sponsor renewals, promotions, team purchases, board reviews. Then **Start next season**. |

## AI calibration (how the app talks to your game)

Your in-game AI setting is the only lever a sim gives for "how fast is the
field". Set a **baseline** — the level where you race closely in an average car.
Every round the app adjusts from it:

- **Your car vs the field** at this track type (engine/aero/chassis weights differ
  for superspeedways, short ovals, street circuits, dirt, rally…), scaled by how
  much the car matters in that series (spec series barely move it).
- **Race engineer** skill and **simulator** facility (better setups → easier).
- **Field strength** — the AI gets tougher as you climb the ladder.
- **Difficulty** (Easy −3 … Legend +4 rating points).

If you win too easily in an average car, raise the baseline in Settings; if you're
always at the back, lower it.

## Logging results

- **Manual:** grid slot, finishing position (or DNF with reason and laps), laps
  led, fastest lap, incidents, car damage (repairs cost money), wrecks (derbies).
  Optionally your teammate's result.
- **Import:** load the file your sim writes, or paste a finishing order. Names are
  matched to the career grid (you can fix any row), and you always pick which row
  is you. Use **Race → Show the field → Copy roster** to name the AI in your game
  after the career drivers so imports match automatically.
- **Simulate:** for rounds you can't run. Counts in the championship but only
  nudges your rating/reputation.

### Results files by game

| Game | AI setting shown | Import |
| --- | --- | --- |
| NR2003 | Opponent Strength (80–110 %) | Export results → `exports_imports/*.html` |
| iRacing | AI Skill (0–125) | Results page → Export CSV |
| Automobilista 2 | Opponent Skill (70–120) | Paste / CSV (no native file) |
| Assetto Corsa | AI Level (70–100 %) | `Documents/Assetto Corsa/out/race_out.json` |
| Assetto Corsa Competizione | AI Strength (80–100) | Server `results/*.json` (UTF-16 handled) |
| Project CARS / 2 | Opponent Skill | Paste / CSV |
| EA SPORTS F1 | AI Difficulty (0–110) | Paste / CSV |
| NASCAR 26 (and 25) / Heat 5 | AI Strength | Paste / CSV |
| GTR2, RACE 07 | AI Strength (70–120 %) | `UserData/Log/Results/*.txt` |
| rFactor, rFactor 2, Le Mans Ultimate, Automobilista | AI Strength (70–120 %) | `UserData/Log/Results/*.xml` |
| RaceRoom | AI Difficulty (80–120 %) | Paste / CSV |
| Wreckfest, Wreckfest 2 | Novice / Amateur / Expert | Paste (survival order for derbies) |
| Gran Turismo 7 | Beginner / Intermediate / Professional | Paste |
| Forza Motorsport | Drivatar 1–8 | Paste |
| BeamNG.drive | AI risk | Paste |
| EA WRC, DiRT Rally 2.0 | AI Difficulty | Paste / CSV (overall classification) |
| Custom game | Whatever you define | Paste / CSV |

## Management systems

- **Driver rating** moves only with results measured against what your car should
  achieve — a P8 in a backmarker can be worth more than a P3 in the best car.
  **Reputation** grows faster in higher tiers and with titles. Both drive contract
  offers, salaries and sponsor interest.
- **Money:** two wallets — personal and team. Prize money, salaries, bonuses,
  sponsor payments, race operations, staff payroll, facility upkeep, repairs,
  R&D, construction, TV/championship prize fund, entry fees, overdraft interest.
  Everything is in the Finances ledger.
- **Car & R&D:** engine, aero, chassis and reliability ratings. Minor / major /
  breakthrough programs, or bank points for *next year's car*. Gains scale with
  staff and facilities and shrink the further ahead you are; every car regresses
  toward the pack each winter, and new technical regulations periodically reset
  the order.
- **Facilities (L1–5):** Factory (R&D slots), Design Centre, Wind Tunnel, Dyno,
  Simulator, Pit Crew Centre, Hospitality Suite (sponsor income + slot), Scouting.
- **Staff:** Technical Director, Race Engineers (one per car), Crew Chief / Team
  Manager, Commercial Director — with a staff market and contracts.
- **Sponsors:** title / primary / associate slots with per-season value, signing
  fees, objectives with bonuses, happiness and renewals. Drivers get personal
  sponsors too.
- **Market:** sign drivers (free agents or buyouts), release them, hire an agent,
  book training (fitness, engineering feedback, media), buy an AI team.
- **Reliability orders:** a fragile car may get a pre-race order to retire at a
  given lap — honour it in the game and log a mechanical DNF (toggle in Settings).
- **The AI world:** every championship in the game runs in parallel. Drivers age,
  improve toward their potential, decline, retire; top performers get promoted;
  rookies arrive; teams rise and fall with results.

## For developers

- Code: `js/solo/` — `sc-tracks.js` (track library), `sc-gamedb.js` (games,
  series, points), `sc-names.js`, `sc-engine.js` (pure career logic, seeded RNG),
  `sc-import.js` (results parsers), `sc-store.js` (IndexedDB), `sc-ui-kit.js`,
  `sc-views-*.js`, `sc-app.js` (router). Styles: `css/career.css`.
- Tests (in `.claude/skills/verify/harness/`):
  - `node solo-engine-test.js [game] [seasons]` — plays 40-season careers for every
    game × role and checks world invariants.
  - `node solo-import-test.js` — every results format end to end.
  - `node solo-drive.js` — drives the real UI in headless Chromium (serve the repo
    root on port 8317 first).
- Adding a game: append a `game({...})` block to `sc-gamedb.js`; any new track
  names go in `sc-tracks.js`. The engine needs no changes.
