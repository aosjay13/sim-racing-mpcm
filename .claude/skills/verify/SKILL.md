---
name: verify
description: Verify SRMPC app changes by driving the real UI headlessly against an in-memory Firebase shim (never production Firestore).
---

# Verifying Phoenix SRMPC changes

The app (`sim-racing-career/app.html`) is a static vanilla-JS site backed by the
**production** Firebase project `sim-racing-career-228a3`. Never drive writes
against it — sim/admin actions write real league data.

## Recipe (headless, hermetic)

1. Serve the repo root: `python3 -m http.server 8317` (app at
   `http://localhost:8317/sim-racing-career/app.html`; it references `../phoenix-logo.png`, a 640px web copy of the 7.6 MB `Phoenix SRMPCM Logo.png`).
2. Playwright Chromium with **all non-localhost routes fulfilled with empty stubs**
   (blocks gstatic Firebase CDN — a `**/gstatic.com/**` glob does NOT match
   `www.gstatic.com`; gate on `url.startsWith('http://localhost:8317')` instead).
3. `addInitScript` the Firebase compat shim (`harness/firebase-shim.js` next to
   this file): in-memory Firestore (`collection/doc/get/set/update/delete/add/batch`),
   fake auth with **async** listener firing (`setTimeout 0` — the app's
   `onAuthStateChanged` logic breaks if fired synchronously).
4. `addInitScript` overrides for `window.confirm/prompt/alert` — native dialogs
   are flaky under CDP and block JS.
5. GM passcode is the built-in default `phoenix13!` (shim has no `config/admin` doc).
6. Toasts: multiple can land in one tick — wait with a regex on
   `#toast-holder` innerText, then clear, never "read first toast".

Working harness: `harness/drive.js` (full 22-step flow: GM unlock, Real-World
Pack install + idempotency, race/season sim, standings/prestige, player signup,
team founding, prestige-gated hiring, prize payouts). Run:

```bash
cd .claude/skills/verify/harness && npm i playwright && npx playwright install chromium
# In the cloud container Chromium is preinstalled at /opt/pw-browsers/chromium —
# if Playwright wants a different revision, preload a patch that passes
# executablePath to chromium.launch (node -r ./patch.js drive.js).
python3 -m http.server 8317 &   # from repo root
node drive.js
```

## Gotchas

- `firestore.rules` enumerates collections — any new collection needs a rules
  entry AND `firebase deploy --only firestore:rules` or writes silently fail in prod.
- Script order in app.html matters: `srmpc-market.js` and `srmpc-sim.js` define
  globals (`makeNpcDriver`, `Prestige`, `Sim`, `REAL_WORLD_PACK`) used by later files.
- Bump the `?v=` cache-buster in app.html on every change.
- Asserting on `innerText`: panel headings/buttons render UPPERCASE via CSS
  `text-transform`, and `innerText` reflects it — use case-insensitive regexes.
- After sign-out the gate keeps its last sign-in/register mode — check
  `#gate-name-field.hidden` before clicking `#gate-mode-toggle`.
- `harness/profile-drive.js` covers the player-profile flows (v3.6.0).
- `harness/persona-drive.js` covers the GM persona/role-profile + sponsor flows, incl. bulk generation (v3.11.0).
- `harness/parity-drive.js` covers the AI Financial Parity system: per-race consortium sponsorship
  (prestige × field strength × human-median anchor × GM knob), AI payroll/sign-on through the real
  team wallet + ledger, AI insolvency auto-liquidation, receivership → consortium takeover, and the
  Admin → 🏦 AI Finance dashboard with GM overrides (v3.29.0). Config lives in config/aiEconomy.
  NOTE: `.panel` carries the app-wide `--shadow` token — "flat 2D" assertions should check for no
  NEW inline shadows/3D transforms, not computed panel style. Drives that pipe to `tail` show no
  interim output (tail buffers to EOF) — wallet-drive takes ~4 min; that's not a hang.
- `harness/carimg-drive.js` covers custom vehicle images: GM form URL/file inputs + instant preview,
  vehicleImages docs (img:// refs, browser-side compression), storefront card grid + checkered placeholder +
  broken-hotlink fallback, strict imageUrl inheritance into player/team garages (v3.28.0). New collection
  `vehicleImages` needs firestore.rules deployed in prod. NOTE: `Util.attr` strips non-word chars — never
  use it for URLs in attributes; use `Util.esc`.
- `harness/counterloop-drive.js` covers the symmetric counter-offer state machine: PENDING_OWNER_RESPONSE ⇄
  PENDING_PLAYER_RESPONSE, negotiationHistory term-sheet log, full-form workspace reset both directions,
  full-terms stale-accept guard, sponsorship loop, terminal states (v3.27.0).
- `harness/deals-drive.js` covers the negotiation economy: P2P deal rooms, prestige pay caps, multi-team
  contracts, sponsorship deals, race-day settlement, Team Management, garage (v3.12.0). New collections
  `negotiations` + `ledger` need firestore.rules deployed in prod.

## Solo Career (single-player, `career.html`)

Local-only (IndexedDB) — no Firebase, no shim needed; still block non-localhost routes.

- `node solo-engine-test.js [gameId|all] [seasons]` — pure-engine soak: plays a
  40-season career for every game × role (driver / owner / principal) with a bot,
  checking world invariants every few rounds (no driver on two teams, the player on
  exactly one team, finite money, forced retirement at 40, HoF entry). ~1 min for all.
- `node solo-import-test.js` — every results format (rF2/LMU XML, GTR2/RACE 07 txt,
  NR2003 HTML, iRacing CSV, AC race_out.json, ACC UTF-16 JSON, generic CSV, paste)
  parsed, name-matched and fed through `completeRound`.
- `node solo-play.js [gameId] [driver|owner|principal]` — plays like a person: builds
  a character in the wizard, logs a full race by hand (grid, finish, laps led,
  incidents, damage, teammate), simulates the next round, scans every screen for
  leaked values (NaN / undefined), undoes, reloads. Handles derby and rally rounds.
  Screenshots land in `harness/solo-play-shots/` (git-ignored).
- `node solo-drive.js` — drives the real UI: wizard, calendar editing, manual /
  imported / simulated results, undo, offers, sponsors, training, every screen,
  export → import, a fast-forward to season 40 → retirement → Hall of Fame,
  owner-driver R&D/facilities/staff/driver market, principal strategy, a custom
  game, mobile + light theme. Screenshots land in `harness/solo-shots/`.
- Engine is deterministic (seeded RNG in `S.rng`). Fast-forward in the browser with
  `SC.Engine.completeRound(SC.App.S, { mode: 'sim' })` then `SC.Store.save(SC.App.S)`.
- Views render from `SC.App.S`; every mutation goes through `SC.App.act()` (undo
  snapshot, autosave, rollback on error).

## League ↔ Solo shared library (v3.31.0)

`app.html` loads the Solo Career's pure data modules (`js/solo/sc-tracks.js`,
`sc-gamedb.js`, `sc-names.js`, `sc-import.js`) and `js/srmpc-library.js` (`Library`):
game library install (Admin → Games → 📚 Add from library: series with their Solo
points systems, tracks with types, optional AI field), "Load the real calendar" in
the Schedule Builder (`Track | laps` lines), the race briefing card, results import
in the GM results form, driver self-reports (stored as `report` on the driver's own
`raceSignups` doc — no new collection, no rules change), nationality / nickname /
age / helmet on driver profiles, and Solo-style achievements.

- `node league-race-drive.js` — the whole multiplayer loop on the shim: GM installs
  NR2003 from the library, builds a season from the real calendar, a player registers
  and creates a character, signs up, reads the briefing, reports their result; the GM
  sees it pre-filled, imports an NR2003 results page (name matching, guest skipped),
  saves; standings (library points), prize money, history and achievements are
  checked; round 2 is simulated with the AI field. Screenshots in `harness/league-shots/`.
- The shim state lives in the page — never `page.reload()` mid-drive; sign out and
  back in instead.
- The GM results form contains the import mapping table: select result rows with
  `#results-form .results-table tbody tr`, not `#results-form tbody tr`.

