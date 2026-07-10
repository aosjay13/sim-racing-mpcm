# Recruitment & Advanced Contract Negotiation — System Logic & Architecture

**Status:** Design. Sections marked ✅ SHIPPED exist in the codebase today (v0.5.4–0.5.5);
sections marked 🔷 NEW are specified here for implementation.
**Companion doc:** `CONTRACT_SIGNING_DESIGN.md` (the pending-contract / signature model).

---

## 0. Requirement → status map

| Requirement | Status | Where |
|---|---|---|
| Two-way recruitment, all roles (driver / crew chief / mechanic / agent) | ✅ SHIPPED | `js/srmpc-hub.js` — job board (`vacancyForm`, `applyVacancy`), scouting (`offerForm`, `staffOfferForm`), applications (`apply`, `applyStaff`), review (`acceptApplication`, `acceptStaffApplication`, `actApplication`), GM/AI for unowned teams (`aiPrincipal`, `Deals.aiPrincipalOffer`) |
| Double-opt-in before signing | ✅ SHIPPED | Every path funnels into a `negotiations` doc (`Deals.start`); nothing signs until the counterparty calls `Deals.accept` → `Deals.execute` (`js/srmpc-deals.js`) |
| Buyout clause on signed contracts | ✅ SHIPPED | `Hub.buyoutFor` (10× salary, min $1,000), `Hub.leaveTeamFlow` (pay / request release), `Hub.actRelease` (owner waives), status `bought-out` |
| "Open agreement" (no-contract, no buyout) | 🔷 NEW | §3 — `agreement: 'open'` contracts |
| Strictly per-race payouts on event completion | ✅ SHIPPED | `Sim.payoutRace` (`js/srmpc-sim.js:790+`) — the single settlement engine |
| Sign-on bonus as the only upfront payment | ✅ partial / 🔷 formalized | Paid at execution today (`Deals.execute`), but hard-coded to 1× salary; §4 makes it a negotiated `signOnBonus` field |
| Performance clauses (wins, avg finish, finish/event/safety/championship bonuses) | 🔷 NEW | §5–§7 — the `Clauses` engine |

---

## 1. Architecture overview

Three layers, one money pipe:

```
RECRUITMENT LAYER (✅)          CONTRACT LAYER                 SETTLEMENT LAYER
recruitment collection          contracts collection           Sim.payoutRace (per race)
 ├ vacancy   (job board)        ├ agreement: contracted|open   ├ prize money
 ├ application (player→team)    ├ salary  (per-race only)      ├ salaries        (✅)
 ├ offer / negotiations         ├ buyout  (0 when open)        ├ sponsorships    (✅)
 └ release-request              ├ signOnBonus (once, at sign)  ├ 🔷 Clauses.forRace
        │                       └ clauses { … }  ← 🔷          ├ persona fees    (✅)
        ▼                               │                      └ ledger rows (✅)
   Deals.start → accept → execute ──────┘             Admin.closeSeason
   (double-opt-in: the only door                       ├ 🔷 Clauses.championship
    into an active contract)                           └ 🔷 Clauses.enforceTermination
```

**New module:** `js/srmpc-clauses.js` (global `Clauses`), loaded in `app.html` after
`srmpc-data.js` and before `srmpc-sim.js`. Pure evaluation functions — no writes; the
settlement engine and season close are the only callers that move money.

**Invariant (the per-race rule):** all *recurring* compensation flows through
`Sim.payoutRace`, which runs exactly once per race completion and writes one `ledger`
row per line item plus one batched balance write per player. The only event-driven
one-off payments in the whole economy are: the **sign-on bonus** (at `Deals.execute`),
**buyouts** (`Hub.leaveTeamFlow` / `Market.release` context), and player-to-player
purchases. Nothing else may call `Economy.adjustWallet` for compensation.

---

## 2. Recruitment flow (✅ shipped — reference)

Both directions end at the same place: a negotiation both sides must agree on.

**Team → Player (scouting):**
1. Owner opens *🔭 Scout Free Agents* (League Hub → Recruitment), filters by role.
   Candidates surface their 🧲 recruitment profile (`Hub.RECRUIT_ATTRS`): drivers —
   pace, safety, disciplines, availability; crew chiefs — strategy, fuel/tire,
   communication; mechanics — telemetry, setups, classes; agents — negotiation,
   networking, roster.
2. `Hub.offerForm` (drivers) / `Hub.staffOfferForm` (crew) → `Deals.start` — a formal
   offer in a deal room.
3. Player **accepts** (→ contract executes), **declines** (closed & logged), or
   **counters/messages** (`Deals.counter`, `Deals.sendNote` — the direct line).

**Player → Team (applications):**
1. Owner posts a vacancy (`Hub.vacancyForm`, kind `vacancy` in the `recruitment`
   collection — no new collection, no rules deploy) or the player applies directly.
2. `Hub.applyVacancy` / `Hub.apply` / `Hub.applyStaff` — the application carries the
   applicant's attributes snapshot.
3. Owner (or GM / 🤖 AI principal for unowned teams) **accepts** → terms form →
   negotiation → player's final accept executes the contract; or **declines** →
   automated polite rejection (`politeMsg`) + red-badge notification for the applicant.

---

## 3. Contract data model (extended)

`contracts/{id}` — superset of the shipped shape (`Deals.execute`, `js/srmpc-deals.js`):

```js
{
  // ---- Parties (✅ existing) ----
  teamId, teamName, ownerUid,            // ownerUid null → league-owned (unowned team)
  personId, personKind,                  // 'driver' | 'staff'
  personUid,                             // player talent → payroll credits this wallet
  roleProfileId,                         // player crew live in roleProfiles
  personName, role,

  // ---- Terms ----
  salary,                                // $/race — the ONLY recurring payment
  exclusive,                             // multi-team rules (Deals.canSignWithTeam)
  seasonYear,

  // 🔷 Agreement type
  agreement: 'contracted' | 'open',
  //   contracted → buyout clause enforced on exit (existing leaveTeamFlow)
  //   open       → handshake deal: race for / assist the team, leave anytime,
  //                buyout = 0, NO termination clauses allowed, still per-race pay.

  buyout,                                // 0 when agreement === 'open'
  // 🔷 The one legal upfront payment (default 1× salary, negotiable, 0 allowed):
  signOnBonus,

  // 🔷 Performance clauses (null = plain contract). Validated by Clauses.validate
  //    against team prestige and salary at negotiation time AND at execution.
  clauses: {
    // Termination stipulations (high-prestige teams only — §6)
    minWins:      { count: 2 },                        // wins this seasonYear or you're out
    minAvgFinish: { position: 8, minStarts: 5 },       // rolling avg finish must be ≤ position

    // Per-race performance bonuses (driver contracts)
    winBonus: 500,
    finishBonus: [                                     // tiered — best matching tier pays
      { atOrBetter: 3,  amount: 300 },
      { atOrBetter: 5,  amount: 150 },
      { atOrBetter: 10, amount: 50 }
    ],
    // Per-race event bonuses
    poleBonus: 150, fastestLapBonus: 150, mostLapsLedBonus: 200,
    // Safety / consistency bonuses
    cleanRaceBonus: 100,        // zero incident points (needs result.incidents)
    fullDistanceBonus: 100,     // 100% of laps completed (needs result.lapsCompleted)

    // End-of-season championship bonuses (paid at Admin.closeSeason)
    championshipBonus: [
      { rank: 1, amount: 5000 }, { rank: 3, amount: 2000 }, { rank: 10, amount: 500 }
    ]
  },

  // ---- Lifecycle (✅ existing) ----
  status: 'active' | 'ended' | 'released' | 'bought-out' | 'terminated'(🔷 for-cause),
  signedAt, endedAt
}
```

**Race result rows** (`races/{id}.results[]`) gain optional telemetry — all fields are
optional and every consumer degrades gracefully (a clause whose input is missing simply
doesn't fire — no bonus, no penalty):

```js
{ driverId, position, dnf, pole, fastestLap,          // ✅ existing
  incidents: 0,          // 🔷 incident points this race (admin result form / sim)
  lapsLed: 12,           // 🔷 for mostLapsLedBonus (race-level max wins the bonus)
  lapsCompleted: 40 }    // 🔷 vs race.laps for fullDistanceBonus
```

**Ledger** (✅ existing, unchanged): `{ uid, amount, icon, label, refId }` —
clause payouts use `refId: race.id` and icon `📜`, so every clause dollar is auditable
per race. Idempotency comes from the settlement trigger, not dedup logic:
`payoutRace` fires only on the `scheduled → completed` transition (the admin result
form guards re-edits with `wasCompleted`, `js/srmpc-admin.js:892`; the sim only
processes scheduled races).

**Negotiation docs** carry the full term sheet (`agreement`, `signOnBonus`, `clauses`)
so the deal room can render a clause summary. Scope decision for v1: **counters
renegotiate the salary number only** — the clause sheet is set by the offering side and
visible (chips) to the other side, who can accept, decline, or argue in messages. This
keeps the existing turn engine (`Deals.counter`) untouched.

---

## 4. Contract execution & the sign-on bonus (`Deals.execute` changes)

```js
// In the fresh-hire branch of Deals.execute (js/srmpc-deals.js):
const bonus = Number.isFinite(neg.signOnBonus) ? neg.signOnBonus : neg.salary; // default 1× salary
await DB.create('contracts', {
    …existing fields…,
    agreement: neg.agreement || 'contracted',
    buyout: neg.agreement === 'open' ? 0 : (neg.buyout || Hub.buyoutFor(neg.salary)),
    signOnBonus: bonus,
    clauses: neg.clauses || null
});
// The ONLY upfront payment in the system:
if (bonus && neg.ownerUid)  await Economy.adjustWallet(neg.ownerUid, -bonus, '🤝', `Sign-on bonus paid: ${neg.personName}`);
if (bonus && neg.personUid) await Economy.adjustWallet(neg.personUid,  bonus, '🤝', `Sign-on bonus from ${neg.teamName}`);
```

Validation at `Deals.start` AND re-checked in `execute` (state may drift mid-negotiation):
- `salary ≤ Economy.payCap(stars)` (✅ existing prestige cap)
- 🔷 `Clauses.validate(neg.clauses, { teamStars, salary })` (§6)
- 🔷 `signOnBonus ≤ 2 × salary` — a bonus is a sweetener, not a disguised lump-sum
- 🔷 `agreement === 'open'` ⇒ `clauses.minWins/minAvgFinish` must be null (you can't
  be fired for cause from a handshake), `buyout === 0`.

**Consistency fix to land with this work:** `Hub.signPlayerDriver` (the legacy
recruitment-offer accept path, `js/srmpc-hub.js`) creates contracts without paying any
bonus while `Deals.execute` pays one — unify both through the `signOnBonus` field.

---

## 5. The `Clauses` engine (`js/srmpc-clauses.js` — 🔷 NEW)

Pure functions; money only moves inside `Sim.payoutRace` / `Admin.closeSeason`.

```js
const Clauses = {
    /* ---- Availability & sanity: what may this team offer at all? (§6) ---- */
    validate(clauses, { teamStars, salary }) { … throws Error with the broken rule … },

    /* ---- Suggested tiers for the offer-form UI ---- */
    defaults(teamStars, salary) { … },

    /* ---- Per-race evaluation: one driver result → payouts ---- */
    // Returns [{ id, label, amount }]. Pure; missing telemetry ⇒ clause skipped.
    forRace(contract, race, result) {
        const c = contract.clauses; if (!c || result.dnf === undefined) return [];
        const out = [];
        const pos = Number(result.position) || null;
        if (c.winBonus && pos === 1 && !result.dnf) out.push({ id: 'win', label: 'Race win', amount: c.winBonus });
        if (Array.isArray(c.finishBonus) && pos && !result.dnf) {
            const tier = c.finishBonus.filter(t => pos <= t.atOrBetter)
                .sort((a, b) => a.atOrBetter - b.atOrBetter)[0];       // best tier only
            if (tier) out.push({ id: 'finish' + tier.atOrBetter, label: `Top ${tier.atOrBetter} finish (P${pos})`, amount: tier.amount });
        }
        if (c.poleBonus && result.pole) out.push({ id: 'pole', label: 'Pole position', amount: c.poleBonus });
        if (c.fastestLapBonus && result.fastestLap) out.push({ id: 'flap', label: 'Fastest lap', amount: c.fastestLapBonus });
        if (c.mostLapsLedBonus && Number(result.lapsLed) > 0) {
            const most = Math.max(...race.results.map(r => Number(r.lapsLed) || 0));
            if (Number(result.lapsLed) === most) out.push({ id: 'led', label: 'Most laps led', amount: c.mostLapsLedBonus });
        }
        if (c.cleanRaceBonus && result.incidents === 0) out.push({ id: 'clean', label: 'Clean race (0 incidents)', amount: c.cleanRaceBonus });
        if (c.fullDistanceBonus && race.laps && Number(result.lapsCompleted) >= Number(race.laps)) {
            out.push({ id: 'fulldist', label: '100% race distance', amount: c.fullDistanceBonus });
        }
        return out;
    },

    /* ---- Staff clauses ride the TEAM's best result ---- */
    // Crew chiefs / mechanics on clause contracts are evaluated against the
    // team's best-finishing car in that race (same forRace logic, synthetic result).
    forRaceStaff(contract, race, world) { … },

    /* ---- Termination stipulations: season-to-date check ---- */
    // Pure read over Stats.driverTable (live-computed — no stored aggregates,
    // matching the "no drift" philosophy in js/srmpc-data.js).
    seasonCheck(contract, races, world) {
        const c = contract.clauses; if (!c) return { breaches: [] };
        const year = String(contract.seasonYear);
        const raced = races.filter(r => r.status === 'completed' && (r.date || '').startsWith(year));
        const row = Stats.driverTable(raced, world).find(r => r.driverId === contract.personId);
        const breaches = [];
        if (c.minWins && (row?.wins || 0) < c.minWins.count)
            breaches.push({ clause: 'minWins', detail: `${row?.wins || 0}/${c.minWins.count} required wins` });
        if (c.minAvgFinish && row && row.finishCount >= (c.minAvgFinish.minStarts || 5)
            && row.avgFinish > c.minAvgFinish.position)
            breaches.push({ clause: 'minAvgFinish', detail: `avg P${row.avgFinish.toFixed(1)} vs required P${c.minAvgFinish.position}` });
        return { breaches, row };
    },

    /* ---- Championship bonuses from the crowned-season snapshot ---- */
    championship(contract, seasonSnapshot) {
        const tiers = contract.clauses?.championshipBonus || [];
        const entry = (seasonSnapshot.standingsArchive || []).find(d => d.driverId === contract.personId);
        if (!entry) return null;
        const tier = tiers.filter(t => entry.rank <= t.rank).sort((a, b) => a.rank - b.rank)[0];
        return tier ? { rank: entry.rank, amount: tier.amount, label: `Championship P${entry.rank}` } : null;
    }
};
```

---

## 6. Prestige gating — "dynamic, scalable clauses"

Clause availability and size scale with `Prestige.teamStars(teamId, world)` — the same
ladder that already gates hiring (`Market.negotiate`'s one-star rule) and pay
(`Economy.payCap`). Enforced by `Clauses.validate` at offer time and re-checked at
execution:

| Team prestige | Termination clauses | Bonus clauses |
|---|---|---|
| 1★–2★ | none — you can't demand wins from a garage team | finish / event / safety bonuses |
| 3★ | `minAvgFinish` ≥ P10, `minStarts` ≥ 5 | + championship bonuses |
| 4★ | + `minWins` ≤ 2, `minAvgFinish` ≥ P8 | all |
| 5★ | `minWins` ≤ 5, `minAvgFinish` ≥ P5 | all |

**Anti-laundering caps** (so bonuses can't smuggle pay past the prestige pay cap):
any single clause amount ≤ 2× salary; worst-case per-race clause total ≤ 5× salary;
championship tier ≤ 25× salary. `validate` computes the worst case (win + best finish
tier + pole + FL + led + clean + full distance) and rejects sheets that exceed it.

---

## 7. Settlement integration — the per-race pipe

### 7.1 `Sim.payoutRace` (✅ existing engine, `js/srmpc-sim.js:790+`) gains step 3.5

Current steps: 1 prize money → 2 brand sponsor payouts → **3 contract salaries**
(owners debited, talent credited via `personUid`) → 4 negotiated sponsorships →
5 persona fees (agent commission, venue, promoter, crew stipends) → batched balance
writes + `Economy.logMany` ledger rows.

```js
/* -- 3.5 🔷 Performance clauses: evaluated per completed race, paid same tick -- */
for (const c of hires.filter(c => c.clauses && c.status === 'active')) {
    const payouts = c.personKind === 'driver'
        ? (() => { const res = results.find(r => r.driverId === c.personId);
                   return res ? Clauses.forRace(c, race, res) : []; })()
        : (racedTeams.has(c.teamId) ? Clauses.forRaceStaff(c, race, world) : []);
    const team = world.teamsById[c.teamId];
    const paidUid = c.personUid || (c.personKind === 'driver' ? world.driversById[c.personId]?.ownerUid : null);
    for (const p of payouts) {
        add(team?.ownerUid, -p.amount, '📜', `Clause paid: ${p.label} — ${c.personName} — ${raceName}`);
        add(paidUid,         p.amount, '📜', `📜 ${p.label} bonus — ${raceName}`);
    }
}
```

League-owned teams (`ownerUid null`): the debit line no-ops (existing `add()` guard,
`js/srmpc-sim.js:806-809`) — the league mints the bonus, exactly like salaries today.

### 7.2 `Admin.closeSeason` (✅ existing, `js/srmpc-admin.js:330`) gains two steps

```js
const snapshot = Stats.crownSeason(world.races, world, seasonId);   // ✅ existing
// 🔷 a) Championship bonuses — the season's ONE non-race payout moment,
//       allowed because it is settlement of a per-season standing, not a lump sum:
for (const c of activeClauseContracts) {
    const prize = Clauses.championship(c, snapshot);
    if (prize) { debit owner / credit talent, '🏆', ledger refId: seasonId }
}
// 🔷 b) Termination enforcement — for-cause exits, no buyout owed either way:
for (const c of activeContractsWithTerminationClauses) {
    const { breaches } = Clauses.seasonCheck(c, world.races, world);
    if (breaches.length) {
        await DB.update('contracts', c.id, { status: 'terminated', endedAt: …, terminationReason: breaches });
        // primary-team fallback identical to Hub._freeDriver (js/srmpc-hub.js)
        News.post('⚖️', `${c.personName} released for cause by ${c.teamName} — ${breaches[0].detail}`);
    }
}
```

Mid-season, the Team Management tab and the player's contract list show a computed
**"⚠️ On notice"** chip (live `Clauses.seasonCheck`, no writes) so nobody is surprised
at season close.

---

## 8. Buyouts & open agreements

**Contracted exits (✅ existing, unchanged):**
- `Hub.leaveTeamFlow(contractId)` — with an active buyout: pay it
  (`Economy.spend` → `adjustWallet(payee)` → `_freeDriver('bought-out')`) or file a
  `release-request` the owner answers (`Hub.actRelease`: waive or "they must pay").
- Owner-side release is always free for the owner (`Market.release`).

**🔷 Buyout negotiation (the "financial penalty *or negotiation*" middle path):**
`Deals.start({ kind: 'buyout', contractId, salary: proposedFigure })` — reuses the whole
deal-room engine with the figure-on-the-table being the buyout price instead of a
salary. Accept ⇒ pay the agreed figure and release (`execute` branch: debit leaver,
credit owner, `_freeDriver('bought-out')`). Cap rule does not apply (it's not pay);
floor 0 (an agreed free exit), ceiling: the contractual buyout (you negotiate *down*).

**🔷 Open agreements:** offer forms get an agreement toggle —
`🔒 Contracted (buyout ${Hub.buyoutFor(salary)})` vs `🤝 Open agreement (leave anytime)`.
Open contracts: `buyout: 0`, no termination clauses, exit via the *already shipped*
free-exit branch in `leaveTeamFlow` ("No contract, no buyout, or nobody to pay → simple
free exit"). Per-race salary, bonuses, and sign-on bonus all still apply — it's the
*exit* that's frictionless, not the pay.

---

## 9. Storage & security

- **No new collections.** Clauses, agreement type, and sign-on bonus ride on
  `contracts`; vacancies already ride on `recruitment`; telemetry rides on
  `races.results[]`. Nothing to add to `firestore.rules`, **no deploy required**
  (the 2026-07-09 incident: deployed rules must include every collection —
  `negotiations`/`ledger` are already live).
- Ledger is append-only by convention; every clause/bonus/buyout dollar has a row with
  `refId` (race id or season id) for audit.

## 10. Verification plan (`.claude/skills/verify` — `clauses-drive.js`)

1. Offer with clause sheet from a 1★ team demanding `minWins` → `Clauses.validate` blocks.
2. 4★+ team offers: win $500 / top-5 $150 / pole $150 / clean $100 / full-distance $100 /
   championship P1 $5,000; player accepts → contract stores the sheet; sign-on bonus
   (and only it) paid immediately.
3. Complete a race with `position:1, pole:true, incidents:0, lapsCompleted:laps` →
   payoutRace pays salary + win + pole + clean + full-distance in ONE settlement;
   ledger shows one 📜 row per clause; owner debited symmetrically.
4. Result row *without* telemetry → safety clauses silently skip (no bonus, no crash).
5. Second completion attempt / result edit → no double payout (`wasCompleted` guard).
6. `closeSeason` → championship bonus paid from the crowned snapshot; a driver breaching
   `minWins` is `terminated` for cause, News posted, team owes no buyout.
7. Open agreement: sign → leave immediately → no buyout charged, contract `ended`.
8. Buyout negotiation: propose $400 against a $2,000 clause → owner counters $800 →
   accept → $800 moves, contract `bought-out`.
9. Regression: all ten existing suites stay green.
