# Contract Signing System — Design & Architecture

**Status:** ⚠️ SUPERSEDED — resolved differently than originally proposed. See §0.
**Scope:** Every path by which a player joins a team — driver, crew, or any other position — must end in an explicit, player-performed signature on a pending contract. No auto-assignment, ever, including onboarding.

---

## 0. Resolution (2026-07-10 audit)

This doc originally proposed a dedicated `js/srmpc-contracts.js` module with its own
`draft → pending → sign()` state machine, layered on top of the negotiation system. That
module was **never built** — instead, the double-opt-in requirement was satisfied by routing
every hiring path through the existing `recruitment` (applications/vacancies) and
`negotiations` (`Deals.start/counter/accept`) collections, which already require an explicit
action from both parties before `Deals.execute()` writes an active contract. A negotiation
`accept()` is only valid from whichever side's *turn* it is, and the terms being accepted are
always exactly what the other party last proposed (an offer or their own counter) — so both
sides always perform an explicit action agreeing to the identical final numbers. That satisfies
"formal offer + explicit acceptance" without a separate signature ceremony.

Re-audit of the six gaps below against current code (see `RECRUITMENT_CONTRACTS_DESIGN.md` for
the shipped architecture):

| # | Gap | Status |
|---|-----|--------|
| 1 | Onboarding team picker | **Fixed.** `Career.driverOnboarding` now always creates the driver with `teamId: null`; picking a team only files a `recruitment` application. |
| 2 | Instant "Join a Team" | **Fixed.** Routes through `Hub.apply()` → pending application, not an instant write. |
| 3 | Recruitment offer accept (`Hub.actOffer`) | **Removed (2026-07-10).** Nothing created `recruitment` docs with `kind: 'offer'` anymore — team→player offers go through `Deals.start`. The dead `Hub.actOffer`/`Hub.signPlayerDriver` instant-sign bypass (and its unreachable render branches) has been deleted from `js/srmpc-hub.js` so it can't be reconnected by accident. |
| 4 | Negotiation accept → `Deals.execute()` | **Not a gap** — see resolution above. Whoever's turn it is accepts exactly the terms the other side proposed; this is a legitimate double opt-in, just not a separate "signature" step. |
| 5 | Free-agent market hire | **Mitigated by exclusion.** `Market`'s hireable pool filters out any driver with `ownerUid` set (`js/srmpc-market.js`) — player-owned talent is never reachable through `Market.negotiate`'s direct write; only AI free agents are. |
| 6 | Staff / role-profile assignment (`_setRoleTeam`) | **Removed.** That function no longer exists; staff hiring goes through `Hub.applyStaff`/`Deals.execute`, inheriting the same negotiation double opt-in as driver hires. |

The sections below are kept for historical/design reference only — the `Contracts` module they
describe was not implemented and should not be assumed to exist.

## 1. The rule (as originally proposed — not implemented)

> A player's team membership (`drivers.teamId`, `staff.teamId`, `users.teamId`) may only ever
> be written by **`Contracts.sign()`**, and `Contracts.sign()` may only be called by the player
> named on the contract (`personUid`). AI talent (no `personUid`) is auto-signed by the system.

Everything upstream — negotiations, recruitment offers, instant joins, onboarding — only ever
produces a `contracts` document with `status: 'pending'`.

## 2. Original gap list (historical — see §0 for current status)

| # | Path | Location | Problem |
|---|------|----------|---------|
| 1 | Onboarding team picker | `js/srmpc-career.js:291-311` | Writes `teamId` on the new driver + `users` doc and auto-creates an **active** contract at standard salary. Violates the "no team at career start without signing" rule. |
| 2 | Instant "Join a Team" | `js/srmpc-career.js:379-388` → `Hub.signPlayerDriver` (`js/srmpc-hub.js:411-434`) | One click on a team row instantly writes membership + active contract. No terms review, no signature entity. |
| 3 | Recruitment offer accept | `js/srmpc-hub.js:436-451` (`Hub.actOffer`) | Player's click is explicit, but there is no pending-contract state — the accept goes straight to `signPlayerDriver`. |
| 4 | Negotiation accept | `js/srmpc-deals.js:192-204` → `execute()` (`:216-277`) | When the **team owner** accepts the player's counter, `execute()` immediately writes the player's `drivers.teamId` / `users.teamId` (`:258-264`). The joining player never performs the final signature. |
| 5 | Free-agent market hire | `js/srmpc-market.js:614-630` | `Market.negotiate` writes `teamId` directly. If the free agent is player-owned (`person.ownerUid`), that player is force-assigned. |
| 6 | Staff / role-profile assignment | `js/srmpc-career.js:1007-1009` (`_setRoleTeam`) | Direct assignment for non-driver positions. |

## 3. Architecture

**One choke point.** All six paths converge into a single new module, `js/srmpc-contracts.js`
(global `Contracts`, loaded in `app.html` after `srmpc-data.js` and before `srmpc-deals.js`).

### Contract state machine (extends the existing `contracts` collection)

```
                  ┌───────────────► withdrawn   (offering side cancels)
draft ─► pending ─┼───────────────► declined    (player refuses)
                  ├───────────────► expired     (offerExpires passed; lazy sweep)
                  └── sign() ─────► active ───► ended | released | bought-out
```

No new collection: pending contracts live in `contracts`, so `DB.contracts()`
(`js/srmpc-data.js:162`) and its cache keep working. Every existing consumer already filters
`status === 'active'`, so pending docs are invisible to standings, rosters, payroll, and buyout
logic by construction.

### Why the player's own "accept" can double as the signature

If the joining player is the one performing the accept action (they accepted an offer, or
accepted in the negotiation room), that click **is** the informed, explicit signature — the
terms were on screen. The pending state exists for the opposite case: when the *other* side's
action concludes the terms (owner accepts the player's counter; owner drafts terms after an
application). Then the contract parks at `pending` and waits in the player's inbox.

Concretely: `Deals.accept()` checks `Auth.uid() === neg.personUid` — if true, draft + sign in
one call; if false, draft only.

## 4. Data model

`contracts/{id}` — superset of today's shape (`js/srmpc-deals.js:265-271`):

```js
{
  // Parties
  teamId, teamName, ownerUid,          // hiring side (ownerUid null → AI team)
  personId, personKind,                // 'driver' | 'staff'
  personName, personUid,               // personUid null → AI talent (auto-signs)
  role,                                // 'driver' | staff role ('engineer', 'strategist', …)

  // Terms — immutable once pending; new terms require a new negotiation
  salary,                              // $/race
  buyout,                              // Hub.buyoutFor(salary) unless negotiated
  exclusive,                           // bool — multi-team rules (Deals.canSignWithTeam)
  seasonYear,

  // Lifecycle
  status,          // 'pending'|'active'|'declined'|'withdrawn'|'expired'
                   //           |'ended'|'released'|'bought-out'
  offeredAt,       // ISO date
  offerExpires,    // ISO date, default offeredAt + 7 days
  signedAt,        // ISO date | null
  signature,       // { uid, name, at } | null — audit trail; uid null = AI auto-sign

  // Provenance
  source,          // 'negotiation'|'recruitment-offer'|'instant-join'|'onboarding'|'market'
  negotiationId,   // string | null
  recruitmentId    // string | null
}
```

## 5. The `Contracts` module

```js
/* ============================================================
   Phoenix SRMPC — Contract signing
   The ONLY code allowed to change team membership. Everything
   upstream (deals, recruitment, instant join, onboarding) just
   drafts a pending contract; the named player signs it.
   ============================================================ */
'use strict';

const Contracts = {
    OFFER_TTL_DAYS: 7,

    /* ---------- Drafting: park an offer as a pending contract ---------- */
    // Returns the contract doc. AI talent (no personUid) auto-signs.
    async draft({ teamId, teamName, ownerUid = null,
                  personId, personKind, personName, personUid = null,
                  role, salary, buyout = null, exclusive = false,
                  source, negotiationId = null, recruitmentId = null }) {
        salary = Math.round(Number(salary) || 0);
        if (salary <= 0) throw new Error('Salary must be above zero.');
        await this._validate({ personId, personKind, teamId, exclusive, salary });

        // One pending contract per person+team pair.
        const dup = (await DB.contracts({ force: true }).catch(() => []))
            .find(c => c.status === 'pending' && c.personId === personId && c.teamId === teamId);
        if (dup) throw new Error('A contract for this signing is already awaiting a signature.');

        const offeredAt = Util.todayISO();
        const id = await DB.create('contracts', {
            teamId, teamName, ownerUid,
            personId, personKind, personName, personUid,
            role: role || (personKind === 'driver' ? 'driver' : 'staff'),
            salary, buyout: buyout ?? Hub.buyoutFor(salary), exclusive: !!exclusive,
            seasonYear: new Date().getFullYear(),
            status: 'pending', offeredAt,
            offerExpires: Util.isoAddDays(offeredAt, this.OFFER_TTL_DAYS),
            signedAt: null, signature: null,
            source, negotiationId, recruitmentId
        });

        if (!personUid) return this.sign(id, { asAI: true });   // nobody to sign → system signs
        News.post('📜', `${teamName} tabled a contract for ${personName} — awaiting signature`);
        return DB.get('contracts', id);
    },

    /* ---------- THE signature ---------- */
    // The single place in the app that flips team membership.
    async sign(contractId, { asAI = false } = {}) {
        const c = await DB.get('contracts', contractId);
        if (!c || c.status !== 'pending') throw new Error('This contract is no longer open for signing.');
        if (!asAI && c.personUid !== Auth.uid()) throw new Error('Only the person named on this contract can sign it.');
        if (c.offerExpires && c.offerExpires < Util.todayISO()) {
            await DB.update('contracts', contractId, { status: 'expired' });
            throw new Error('This offer has expired — ask for fresh terms.');
        }

        // The world may have changed since drafting — revalidate everything.
        await this._validate(c);

        await DB.update('contracts', contractId, {
            status: 'active', signedAt: Util.todayISO(),
            signature: {
                uid: asAI ? null : Auth.uid(),
                name: asAI ? c.personName : (Auth.state.profile?.displayName || c.personName),
                at: Util.todayISO()
            }
        });
        await this._applyMembership(c);
        await this._settleBonus(c);
        News.post('🤝', `${c.personName} signed with ${c.teamName} (${Economy.fmt(c.salary)}/race${c.exclusive ? ', exclusive' : ', non-exclusive'})`);
        return DB.get('contracts', contractId);
    },

    /* ---------- Refusals ---------- */
    async decline(contractId) {              // player's call
        const c = await DB.get('contracts', contractId);
        if (!c || c.status !== 'pending') return;
        if (c.personUid !== Auth.uid()) throw new Error('Only the person named on this contract can decline it.');
        await DB.update('contracts', contractId, { status: 'declined' });
        News.post('👋', `${c.personName} passed on ${c.teamName}'s contract`);
    },

    async withdraw(contractId) {             // offering side's call
        const c = await DB.get('contracts', contractId);
        if (!c || c.status !== 'pending') return;
        if (c.ownerUid !== Auth.uid()) throw new Error('Only the offering team can withdraw this contract.');
        await DB.update('contracts', contractId, { status: 'withdrawn' });
    },

    /* ---------- Inbox ---------- */
    async pendingFor(uid = Auth.uid()) {
        if (!uid) return [];
        await this.expireStale();
        return (await DB.contracts({ force: true }).catch(() => []))
            .filter(c => c.status === 'pending' && (c.personUid === uid || c.ownerUid === uid))
            .sort((a, b) => (b.offeredAt || '').localeCompare(a.offeredAt || ''));
    },

    async pendingCount() {                   // nav badge: contracts awaiting MY signature
        const uid = Auth.uid();
        return (await this.pendingFor(uid)).filter(c => c.personUid === uid).length;
    },

    async expireStale() {                    // lazy sweep on inbox load — no cron needed
        const today = Util.todayISO();
        const stale = (await DB.contracts().catch(() => []))
            .filter(c => c.status === 'pending' && c.offerExpires && c.offerExpires < today);
        for (const c of stale) await DB.update('contracts', c.id, { status: 'expired' });
    },

    /* ---------- Private: validation & side effects ---------- */
    // Runs at draft time AND again at sign time (days may pass in between:
    // caps move, exclusive deals get signed elsewhere, teams fold).
    async _validate({ personId, personKind, teamId, exclusive, salary }) {
        const team = await DB.get('teams', teamId);
        if (!team) throw new Error('That team no longer exists.');
        const world = await DB.loadWorld();
        const collection = personKind === 'driver' ? 'drivers' : 'staff';
        const person = await DB.get(collection, personId);
        if (!person) throw new Error('That person no longer exists.');

        const stars = personKind === 'driver'
            ? Prestige.driverStars(personId, world) : Prestige.stored(person);
        const cap = Economy.payCap(stars);
        if (salary > cap) throw new Error(`League rule: pay is capped at ${Economy.fmt(cap)}/race at their prestige level.`);

        if (personKind === 'driver') {
            const can = await Deals.canSignWithTeam(personId, teamId, exclusive);
            if (!can.ok) throw new Error(can.reason);
        } else if (person.teamId && person.teamId !== teamId) {
            throw new Error(`${person.name} already works for another team.`);
        }
    },

    // Consolidates the membership writes currently duplicated in
    // Deals.execute (srmpc-deals.js:258-264), Hub.signPlayerDriver
    // (srmpc-hub.js:421-425) and Market.negotiate (srmpc-market.js:616).
    async _applyMembership(c) {
        const collection = c.personKind === 'driver' ? 'drivers' : 'staff';
        const person = await DB.get(collection, c.personId);
        const becomesPrimary = !person.teamId;   // multi-team: first signing = primary team
        if (!becomesPrimary) return;
        await DB.update(collection, c.personId, { teamId: c.teamId, salary: c.salary });
        if (c.personKind === 'driver' && c.personUid) {
            if (c.personUid === Auth.uid()) await Auth.updateProfile({ teamId: c.teamId });
            else await DB.update('users', c.personUid, { teamId: c.teamId }).catch(() => {});
        }
    },

    // Signing bonus (one race of salary) moves at SIGN time, not accept time
    // (today it fires in Deals.execute, srmpc-deals.js:272-274). A declined or
    // expired offer must never touch a wallet.
    async _settleBonus(c) {
        if (c.ownerUid) await Economy.adjustWallet(c.ownerUid, -c.salary, '🤝', `Signing bonus paid: ${c.personName}`);
        if (c.personUid) await Economy.adjustWallet(c.personUid, c.salary, '🤝', `Signing bonus from ${c.teamName}`);
    }
};
window.Contracts = Contracts;
```

*(Requires one small util: `Util.isoAddDays(iso, n)` alongside `Util.todayISO()` in `srmpc-core.js`.)*

### 5.1 The review modal — `Contracts.reviewModal(contractId)`

Reuses the deal-room pattern (`Deals.room`, `js/srmpc-deals.js:285-376`):

- Header: `📜 Contract — {personName} ⇄ {teamName}`, subtitle "Review the terms, then sign or decline."
- Terms grid: salary/race, buyout clause, 🔒/🔓 exclusivity, season year, prestige-cap chip, **expiry date**.
- Actions, by viewer:
  - `personUid` (the player joining): **`✍️ Sign Contract`** (primary) / `❌ Decline`
  - `ownerUid` (offering side): `🚫 Withdraw Offer`
  - anyone else: read-only.
- On sign: toast `Contract signed: welcome to {teamName}! 🤝`, `App.go('career')`.

Pending contracts surface in two places: the Hub Recruitment inbox (`js/srmpc-hub.js:175-186`,
merged into `_inbox()` so the tab badge counts them) and a "📜 Awaiting your signature" panel on
My Career / profile.

## 6. Integration changes, file by file

### `js/srmpc-deals.js` — `execute()` (fresh hires only)
Replace the direct contract-create + membership writes (`:247-276`) with:

```js
const contract = await Contracts.draft({
    teamId: neg.teamId, teamName: neg.teamName, ownerUid: neg.ownerUid,
    personId: neg.personId, personKind: neg.personKind, personName: neg.personName,
    personUid: neg.personUid, salary: neg.salary, buyout: neg.buyout || null,
    exclusive: neg.exclusive, source: 'negotiation', negotiationId: neg.id
});
// The player's own accept IS their signature — the terms were on screen.
if (neg.personUid && neg.personUid === Auth.uid()) await Contracts.sign(contract.id);
else if (neg.personUid) Util.notify(`Deal agreed — the contract is in ${neg.personName}'s inbox to sign. 📜`);
```

Unchanged: sponsorships (no team membership) and renegotiations (`neg.contractId` set — terms
change on an already-signed contract; both sides are already in the room).

### `js/srmpc-hub.js`
- **Delete `signPlayerDriver`** (`:411-434`) — absorbed by `Contracts.draft/_applyMembership`.
- **`actOffer`** (`:436-451`): accept → `Contracts.draft({ source: 'recruitment-offer', … })`
  then `Contracts.reviewModal(id)`. The player sees the full terms sheet and clicks Sign.
  Mark the recruitment doc `status: 'accepted'` only after the contract is signed (listen in
  `sign()` via `recruitmentId`, or flip it in the modal's sign handler).
- `_inbox()` (`:175-186`): include `Contracts.pendingFor()` docs where `personUid === uid`.

### `js/srmpc-career.js`
- **Onboarding** (`:291-311`): always create the driver as a free agent (`teamId: null`), never
  auto-create a contract. If the player picked a team in the form, call
  `Contracts.draft({ source: 'onboarding', standard terms })` after profile creation and open
  `Contracts.reviewModal` immediately — career starts team-less until they sign. Rookie news
  reads "joins the league as a free agent" until signature.
- **`joinTeam`** (`:379-388`): replace `Hub.signPlayerDriver(...)` with
  `Contracts.draft({ source: 'instant-join', salary: Hub.STANDARD_SALARY, exclusive: false })`
  + `Contracts.reviewModal`. Still two clicks total, but the signature is explicit and audited.
- **`_setRoleTeam`** (`:1007-1009`): if the roleProfile is player-owned, route through
  `Contracts.draft` (personKind `'staff'`); direct write allowed only for AI profiles.

### `js/srmpc-market.js` — `negotiate()` (`:595-639`)
- Player-owned free agent (`person.ownerUid`) → open a negotiation via `Deals.start()` instead
  of writing directly; the flow ends in a pending contract that the player signs.
- AI free agent → `Contracts.draft(...)` (auto-signs, preserving today's instant feel).
- Delete the direct `DB.update(collection, personId, { teamId, salary })` at `:616`; the
  up-front `Economy.spend` moves into `_settleBonus` so money moves only on signature.

### `js/srmpc-views.js` / nav badge
Deals badge becomes `await Deals.myTurnCount() + await Contracts.pendingCount()`.

## 7. Sign-time revalidation — why `_validate` runs twice

Between draft and signature, days can pass. Signing re-checks, and blocks with a clear message
if anything drifted:

| Drift | Guard |
|---|---|
| Prestige cap dropped below the agreed salary | `Economy.payCap` re-check |
| Player signed an exclusive deal elsewhere meanwhile | `Deals.canSignWithTeam` |
| Team deleted / taken over | team existence check |
| Offer older than 7 days | `offerExpires` → auto-`expired` |
| Duplicate signing (double-click, two tabs) | `status !== 'pending'` guard |

## 8. Firestore rules

Today `contracts` is writable by any authenticated user (`firestore.rules:17`). Tighten the one
transition that matters — only the named player may activate their own pending contract:

```
match /contracts/{doc} {
  allow read: if true;
  allow create: if isAuthenticated();
  allow update: if isAuthenticated() && !(
    resource.data.status == 'pending'
    && request.resource.data.status == 'active'
    && resource.data.personUid != null
    && request.auth.uid != resource.data.personUid
  );
  allow delete: if isAuthenticated();
}
```

⚠️ Remember: `firestore.rules` changes must be **deployed** (`firebase deploy --only
firestore:rules`) or they silently do nothing (see FIREBASE_SETUP.md).

## 9. Verification plan (`.claude/skills/verify` harness)

Add a `contracts-drive.js` covering:

1. Onboarding with a team picked → driver doc has `teamId: null`, one `pending` contract exists.
2. `Contracts.sign` by the named player → contract `active` with `signature.uid`, `drivers.teamId`
   and `users.teamId` set, bonus moved.
3. `sign` by a different uid → rejected, no membership change.
4. Decline → `declined`, player still a free agent, wallets untouched.
5. Owner accepts player's counter in a negotiation → contract parks `pending`; player signs from inbox.
6. Player accepts an offer in the deal room → drafted **and** signed in one step.
7. Expired offer → `sign` fails and status flips to `expired`.
8. AI free-agent hire → auto-signed, instant (regression: today's market feel preserved).
9. Existing regression suites (deals, profile, market) stay green.
