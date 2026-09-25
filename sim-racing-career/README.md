# Phoenix's Sim Racing Multiplayer Career Mode (SRMPC)

Two ways to run a sim-racing career across every game you play:

| | **Solo Career** (`career.html`) | **League app** (`app.html`) |
| --- | --- | --- |
| Who | You, single-player | A multiplayer league with a Game Master |
| Account | None — saved in your browser, works offline | Firebase email/password or GM passcode |
| What | 40-season careers in one game: contracts, money, sponsors, R&D, facilities, staff, calendars, standings, an evolving AI world | Shared series, schedules, results, standings, deals, teams, garages, dealership, number registry |

Live site: <https://aosjay13.github.io/sim-racing-mpcm/>

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

## Project files

- `index.html` — landing page
- `career.html`, `css/career.css`, `js/solo/` — Solo Career
- `app.html`, `css/style.css`, `js/srmpc-*.js` — League app (`js/srmpc-core.js` holds the Firebase config)
- `firestore.rules` — Firestore security rules for the league app

## Local development

```bash
python3 -m http.server 8000   # from the repository root
# http://localhost:8000/sim-racing-career/career.html  (Solo Career)
# http://localhost:8000/sim-racing-career/app.html     (League app)
```

Headless verification lives in `.claude/skills/verify/` (see its `SKILL.md`).
