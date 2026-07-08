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
   `http://localhost:8317/sim-racing-career/app.html`; it references `../Phoenix SRMPCM Logo.png`).
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
- `harness/persona-drive.js` covers the GM persona/role-profile + sponsor flows (v3.10.0).
