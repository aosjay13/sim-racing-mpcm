# Car Number Acquisition & Bidding System — Design & Architecture

**Status:** Design (not yet implemented)
**Scope:** Replace the decorative, free-text `drivers.number` field (`js/srmpc-career.js:341`,
`js/srmpc-admin.js:1082`) with a series-scoped, ownable, auctioned asset — mirroring how
`js/srmpc-contracts.js` turned `teamId` from a direct write into a governed asset transfer
(see `CONTRACT_SIGNING_DESIGN.md`) and how `js/srmpc-clauses.js` turned pay into a governed,
prestige-gated sheet (see `RECRUITMENT_CONTRACTS_DESIGN.md`). Same playbook, third asset class.

---

## 0. Requirement → status map

| # | Requirement | Where it lands |
|---|---|---|
| 1 | Series-scoped registry, status states | §3.1 `numberRegistry`, §4.1 `Numbers.statusOf` |
| 2 | Dual ownership (team charter vs. driver-retained) + primary/secondary conflict | §3.2 `numberLeases`, §4.2 `Numbers.resolveForEntry`, contract field `numberChoice` |
| 3 | Off-season auctions, blind bid / timer, ledger deduction | §3.3 `numberBids`, §5 `Numbers` auction engine |
| 4 | First right of refusal, use-it-or-lose-it | §7 `Numbers.seasonRollover` |
| — | Race-entry validation | §6 `Numbers.validateRaceEntry` |
| — | Firestore schemas / rules | §3, §8 |

## 1. Architecture overview

**One new module, `js/srmpc-numbers.js`** (global `Numbers`), loaded in `app.html` after
`srmpc-data.js` and `srmpc-clauses.js`, before `srmpc-deals.js` (contracts need to read
`Numbers.resolveForEntry` when a driver with a personal number signs).

**No subcollections.** Like every other collection in this app (`contracts`, `negotiations`,
`ledger`), the three new collections are flat and top-level, filtered client-side via
`DB.list()`/`world` joins — consistent with `js/srmpc-data.js:64-185`.

**Money moves once, at resolution — never at bid time.** Exactly the rule
`CONTRACT_SIGNING_DESIGN.md §5` established for signing bonuses ("bonus moves at SIGN time,
not accept time"): placing a bid never touches a wallet; `Economy.adjustWallet` only fires when
an auction actually resolves to a winner. This avoids needing an escrow/hold system this app
has never had.

**Numbers are computed live where possible.** The `Stats` engine already accepts that team
standings join `race.results[].driverId` to the driver's **current** `teamId`
(`js/srmpc-data.js:265-291`), not the team they were on when the race happened — the codebase's
established tradeoff for "no stored aggregates → no drift." The hoarding-prevention job
(§7.2) makes the same tradeoff for "which number a driver raced under": it resolves
historically-completed races against **today's** lease state rather than stamping a number
onto every race result. This is a deliberate simplification, called out explicitly because it's
the one place this design diverges from a naively "more correct" historical snapshot.

### Required core additions

Two small, generically-useful additions this design depends on (same category as
`CONTRACT_SIGNING_DESIGN.md`'s "requires one small util: `Util.isoAddDays`" — still not present
in `js/srmpc-core.js`, so it's needed here too):

```js
// js/srmpc-core.js — add alongside Util.todayISO()
isoAddDays(iso, n) {
    const d = this.parseISODate(iso);
    if (!d) return null;
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
```

```js
// js/srmpc-data.js — add to the DB object, alongside create()/update()
// Upsert at a KNOWN id — needed for deterministic doc ids (registry rows,
// one-bid-per-entrant-per-round). create() always calls .add() (random id);
// update() 404s if the doc doesn't exist yet. set() does neither.
async set(collection, id, data, { merge = true } = {}) {
    await this._fs().collection(collection).doc(id).set({
        ...data, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge });
    this.invalidate(collection);
},

// Atomic read-then-write for auction resolution — the one place in this
// design where two writers (two players bidding) could otherwise race.
async transact(fn) {
    return this._fs().runTransaction(fn);
}
```

---

## 2. Series scoping & number format

Real series don't all use the same range (F1: 00–99 with 1 reserved for the defending
champion; IndyCar/NASCAR go to 3 digits). Add an optional field to `series`:

```js
// series/{id} — existing doc, one new optional field
{
  ...,
  numberFormat: { min: 0, max: 99 }   // default when absent: {min:0, max:99}
}
```

`Numbers.rangeFor(series)` returns `series.numberFormat || { min: 0, max: 99 }`. No migration
needed — every existing series just inherits the 00–99 default, and the admin series form
(`js/srmpc-admin.js:395+`) gets two new number inputs.

---

## 3. Firestore schemas

### 3.1 `numberRegistry` — `SeriesNumberRegistry`

**Doc id is deterministic: `${seriesId}__${number}`.** This is the load-bearing design choice
for requirement #1 ("Number 24 in Tier 1 is a completely separate asset from Number 24 in Tier
2"): isolation is enforced by the id itself, not by a query filter, so there is no way to
accidentally cross-write between series. A number with **no doc** is implicitly `available` —
consistent with this app's habit of not pre-seeding rows it doesn't need yet (nobody creates a
`ledger` row until money actually moves).

```js
// numberRegistry/{seriesId}__{number}
{
  seriesId,                 // string, ref → series/{id}
  number,                   // int, within series.numberFormat range
  status,                   // 'available' (default/no doc) | 'auction' | 'leased' | 'retired'

  // Present only while status === 'auction'
  auction: {
    round,                  // int, increments each time this number goes back to auction
    type,                   // 'blind' | 'timed'  (see §5.0)
    reservePrice,           // int, minimum winning bid
    opensAt, closesAt,      // ISO dates
    openedByUid             // GM who opened it (or 'system' for auto season-rollover pool)
  } | null,

  currentLeaseId,           // string | null — ref → numberLeases/{id} when status === 'leased'
  retiredReason,            // string | null — GM note, only when status === 'retired'

  createdAt, updatedAt      // Firestore server timestamps (DB.create/update convention)
}
```

### 3.2 `numberLeases` — `NumberLeases`

One doc per **ownership stint**. Past leases are never deleted (`status` moves to
`'expired' | 'revoked' | 'relinquished'`) — this is the audit trail for who has held a number,
mirroring how `contracts` docs pile up with terminal statuses rather than being deleted
(`CONTRACT_SIGNING_DESIGN.md §4`).

```js
// numberLeases/{id}  (auto id via DB.create)
{
  seriesId, number,

  ownerType,                // 'team' | 'driver'
  ownerId,                  // teamId or driverId
  ownerUid,                 // controlling player's uid; null → AI/league-owned (mirrors
                             // contracts.ownerUid — a null owner stays member/GM-editable)
  ownerName,                // cached display name (team name or driver name)

  status,                   // 'active' | 'expired' | 'revoked' | 'relinquished'
  seasonYear,                // year this stint covers (renewal extends this, doesn't replace the doc)

  acquiredVia,               // 'auction' | 'renewal' | 'gm-grant'
  acquiredAt,                 // ISO date
  price,                     // int — winning bid (auction) or lease fee (renewal); 0 for gm-grant

  // First-right-of-refusal window (§7.1) — present only while a renewal decision is pending
  renewal: {
    opensAt, closesAt,       // ISO dates
    fee                      // int, the standard renewal lease fee
  } | null,

  endedAt, endReason,        // ISO date | null, string | null — set when status leaves 'active'

  createdAt, updatedAt
}
```

### 3.3 `numberBids` — `NumberBids`

**Doc id is also deterministic: `${seriesId}__${number}__${round}__${bidderType}_${bidderId}`.**
One entrant can only ever have one live bid per auction round — placing a new bid *overwrites*
their own prior bid (a real sealed-bid auction lets you revise your sealed envelope until the
envelope opens; it does not let you flood the pool with decoy bids). This piggybacks on
`DB.set()`'s upsert semantics (§1) instead of needing a "find my existing bid and update it"
round-trip.

```js
// numberBids/{seriesId}__{number}__{round}__{bidderType}_{bidderId}
{
  seriesId, number, round,   // ties back to numberRegistry.auction.round at bid time

  bidderType,                // 'team' | 'driver'
  bidderId,                  // teamId or driverId
  bidderUid,                 // wallet owner: team.ownerUid or driver.personUid
  bidderName,                // cached display name

  amount,                    // int, the sealed bid
  placedAt,                  // ISO date (tie-break: earliest wins on equal amount)

  status,                    // 'submitted' | 'won' | 'lost' | 'refunded'
                             // 'refunded' = won on paper but couldn't afford it at resolution
                             // (balance dropped between bid and close) — passed over, no charge

  createdAt, updatedAt
}
```

---

## 4. Resolution & the dual-ownership conflict

### 4.1 `Numbers.statusOf(seriesId, number, registryDoc)`

Pure function: `registryDoc?.status || 'available'`. Used everywhere instead of inlining the
"no doc = available" rule.

### 4.2 The primary/secondary toggle (requirement #2)

A driver can hold a personal `numberLeases` doc (`ownerType: 'driver'`) *and* later sign with a
team that holds its own `numberLeases` doc (`ownerType: 'team'`) for the same or a different
number. Real-world precedent (a driver's personal brand number vs. their team's charter number)
means both leases stay valid simultaneously — the conflict is only about **which one paints the
car**, and it's a per-contract choice, not a permanent one.

`contracts` (from `CONTRACT_SIGNING_DESIGN.md §4`) gains one optional field, set at
`Contracts.sign()` time when both a driver lease and a team lease exist for that pairing:

```js
// contracts/{id} — one new optional field
numberChoice   // 'team' | 'driver' | null — null when there's no conflict to resolve
```

```js
// js/srmpc-numbers.js
const Numbers = {
    /* Resolves the number a driver races under for a given contract.
       Team lease is the default (a seat in a car livery is a team asset,
       same real-world convention IndyCar/NASCAR use) — the driver's own
       number only wins if the contract explicitly says so. */
    async resolveForEntry(contract, world) {
        const leases = await DB.list('numberLeases', { force: true }).catch(() => []);
        const active = leases.filter(l => l.status === 'active');
        const teamLease = active.find(l => l.ownerType === 'team' && l.ownerId === contract.teamId);
        const driverLease = active.find(l => l.ownerType === 'driver' && l.ownerId === contract.personId);

        if (teamLease && driverLease) {
            const choice = contract.numberChoice === 'driver' ? driverLease : teamLease;
            return { number: choice.number, source: choice === driverLease ? 'driver' : 'team', conflict: true };
        }
        if (driverLease) return { number: driverLease.number, source: 'driver', conflict: false };
        if (teamLease) return { number: teamLease.number, source: 'team', conflict: false };
        return { number: null, source: null, conflict: false };  // no lease → fall back to unowned car number
    }
};
```

`Contracts.reviewModal` (existing, `CONTRACT_SIGNING_DESIGN.md §5.1`) gets one more terms-grid
row when both leases exist: a `🔢 Race number` selector (team's # vs. driver's #), read at sign
time into `numberChoice`. If the player doesn't touch it, it defaults to the team's number —
so this is additive, not a blocking prompt for the common case.

---

## 5. Auction engine

### 5.0 Blind sealed-bid vs. open timer — pick blind as the default

The app has no server compute (`firebase.json` — hosting + Firestore rules only, no Cloud
Functions/cron). An "open auction with a live countdown and running high bid" needs a trusted
clock and a way to punish last-second sniping fairly; enforcing that from client JS alone is
gameable (a player can see the current high bid and simply keep re-submitting). **Blind
sealed-bid needs no live clock and no visible running total** — it only needs a close time in
the past, which is exactly the kind of lazy, client-checked deadline this codebase already uses
successfully for contract offers (`Contracts.expireStale()`, `CONTRACT_SIGNING_DESIGN.md §5`:
*"lazy sweep on inbox load — no cron needed"*). `numberBids.amount` stays hidden from other
bidders in the UI until `resolveAuction` runs (Firestore rules don't restrict *read* by default
in this app, so hiding is a UI convention, same trust model the rules file already documents:
*"a friends-league, not a bank"*).

`auction.type` is still a field on the registry doc so a GM can flip to `'timed'` later if
Cloud Functions ever get added — the schema doesn't foreclose it, but only `'blind'` is
implemented here.

### 5.1 Opening an auction

```js
const Numbers = {
    // ... resolveForEntry from §4.2 ...

    BID_WINDOW_DAYS: 7,
    RENEWAL_WINDOW_DAYS: 5,
    MIN_FIELD_PCT: 0.5,          // use-it-or-lose-it threshold, §7.2
    RENEWAL_FEE_PCT: 0.25,       // first-right-of-refusal price: 25% of the last winning bid/fee

    rangeFor(series) { return series?.numberFormat || { min: 0, max: 99 }; },

    regId(seriesId, number) { return `${seriesId}__${number}`; },

    async statusOf(seriesId, number) {
        const doc = await DB.get('numberRegistry', this.regId(seriesId, number)).catch(() => null);
        return doc?.status || 'available';
    },

    // GM action (off-season) or the system (season-rollover pool, §7.2).
    async openAuction({ seriesId, number, reservePrice = 0, days = this.BID_WINDOW_DAYS, openedByUid = null }) {
        const series = await DB.get('series', seriesId);
        if (!series) throw new Error('That series no longer exists.');
        const { min, max } = this.rangeFor(series);
        number = Math.round(Number(number));
        if (!Number.isFinite(number) || number < min || number > max) {
            throw new Error(`Number must be between ${min} and ${max} for this series.`);
        }
        const id = this.regId(seriesId, number);
        const current = await DB.get('numberRegistry', id).catch(() => null);
        if (current && current.status === 'leased') throw new Error(`#${number} is currently leased — it can't be auctioned while owned.`);
        if (current && current.status === 'auction') throw new Error(`#${number} already has an auction open.`);
        if (current?.status === 'retired') throw new Error(`#${number} is retired and blocked from auction.`);

        const round = (current?.auction?.round || 0) + 1;
        const opensAt = Util.todayISO();
        await DB.set('numberRegistry', id, {
            seriesId, number, status: 'auction',
            auction: { round, type: 'blind', reservePrice: Math.round(Number(reservePrice) || 0),
                       opensAt, closesAt: Util.isoAddDays(opensAt, days), openedByUid: openedByUid || Auth.uid() },
            currentLeaseId: null
        });
        News.post('🔨', `#${number} in ${series.name} goes to auction — sealed bids close ${Util.fmtDateShort(Util.isoAddDays(opensAt, days))}.`);
        return DB.get('numberRegistry', id);
    },

    /* ---------- Bidding ---------- */
    async placeBid({ seriesId, number, bidderType, bidderId, amount }) {
        amount = Math.round(Number(amount) || 0);
        if (amount <= 0) throw new Error('Bid must be above zero.');

        const reg = await DB.get('numberRegistry', this.regId(seriesId, number));
        if (!reg || reg.status !== 'auction') throw new Error('This number is not currently at auction.');
        if (reg.auction.closesAt < Util.todayISO()) throw new Error('Bidding has closed for this number — awaiting resolution.');
        if (amount < reg.auction.reservePrice) throw new Error(`Bid must meet the reserve of ${Economy.fmt(reg.auction.reservePrice)}.`);

        const { bidderUid, bidderName } = await this._bidderInfo(bidderType, bidderId);
        if (bidderUid !== Auth.uid() && !Auth.isAdmin()) throw new Error('You can only bid on behalf of your own team or yourself.');

        const bal = bidderUid === Auth.uid() ? Economy.balance() : (await DB.get('users', bidderUid))?.balance || 0;
        if (amount > bal) throw new Error(`Not enough funds — this bid is ${Economy.fmt(amount)} but the wallet holds ${Economy.fmt(bal)}.`);

        const id = `${seriesId}__${number}__${reg.auction.round}__${bidderType}_${bidderId}`;
        await DB.set('numberBids', id, {
            seriesId, number, round: reg.auction.round,
            bidderType, bidderId, bidderUid, bidderName,
            amount, placedAt: Util.todayISO(), status: 'submitted'
        });
        return DB.get('numberBids', id);
    },

    async _bidderInfo(bidderType, bidderId) {
        if (bidderType === 'team') {
            const team = await DB.get('teams', bidderId);
            if (!team) throw new Error('That team no longer exists.');
            if (!team.ownerUid) throw new Error('AI/unowned teams cannot place bids directly — a GM may open the auction on their behalf instead.');
            return { bidderUid: team.ownerUid, bidderName: team.name };
        }
        const driver = await DB.get('drivers', bidderId);
        if (!driver) throw new Error('That driver no longer exists.');
        if (!driver.ownerUid) throw new Error('AI drivers cannot place bids.');
        return { bidderUid: driver.ownerUid, bidderName: driver.name };
    },

    /* ---------- Resolution: highest bidder who can still afford it wins ---------- */
    // Lazy sweep, same pattern as Contracts.expireStale — call from anywhere
    // the registry is listed (auction browser load) and from the season
    // rollover job. Safe to call repeatedly; no-ops once resolved.
    async resolveDueAuctions(seriesId = null) {
        const today = Util.todayISO();
        const all = await DB.list('numberRegistry', { force: true }).catch(() => []);
        const due = all.filter(r => r.status === 'auction' && r.auction?.closesAt < today
            && (!seriesId || r.seriesId === seriesId));
        const results = [];
        for (const reg of due) results.push(await this._resolveOne(reg));
        return results;
    },

    async _resolveOne(reg) {
        const bids = (await DB.list('numberBids', { force: true }).catch(() => []))
            .filter(b => b.seriesId === reg.seriesId && b.number === reg.number && b.round === reg.auction.round)
            .sort((a, b) => b.amount - a.amount || a.placedAt.localeCompare(b.placedAt));

        // Transaction: re-read the registry doc so two concurrent resolve
        // calls (two players loading the auction list at once) can't both
        // "win" the same number — the second writer's precondition fails
        // and it simply no-ops.
        return DB.transact(async (tx) => {
            const ref = SRMPC.db.collection('numberRegistry').doc(this.regId(reg.seriesId, reg.number));
            const snap = await tx.get(ref);
            const live = snap.data();
            if (!live || live.status !== 'auction' || live.auction?.round !== reg.auction.round) {
                return { number: reg.number, seriesId: reg.seriesId, winner: null, reason: 'already resolved' };
            }

            let winner = null;
            for (const b of bids) {
                const walletUid = b.bidderUid;
                const bal = walletUid === Auth.uid() ? Economy.balance() : (await DB.get('users', walletUid).catch(() => null))?.balance ?? 0;
                if (bal >= b.amount) { winner = b; break; }   // can still afford it → wins
            }

            if (!winner) {
                tx.set(ref, { status: 'available', auction: null, currentLeaseId: null,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
                return { number: reg.number, seriesId: reg.seriesId, winner: null, reason: 'no valid bids' };
            }

            const leaseRef = SRMPC.db.collection('numberLeases').doc();
            tx.set(leaseRef, {
                seriesId: reg.seriesId, number: reg.number,
                ownerType: winner.bidderType, ownerId: winner.bidderId, ownerUid: winner.bidderUid, ownerName: winner.bidderName,
                status: 'active', seasonYear: new Date().getFullYear(),
                acquiredVia: 'auction', acquiredAt: Util.todayISO(), price: winner.amount,
                renewal: null, endedAt: null, endReason: null,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(), updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            tx.set(ref, { status: 'leased', auction: null, currentLeaseId: leaseRef.id,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });

            for (const b of bids) {
                tx.set(SRMPC.db.collection('numberBids').doc(`${reg.seriesId}__${reg.number}__${reg.auction.round}__${b.bidderType}_${b.bidderId}`),
                    { status: b === winner ? 'won' : (bids.indexOf(b) < bids.indexOf(winner) ? 'refunded' : 'lost') }, { merge: true });
            }
            return { number: reg.number, seriesId: reg.seriesId, winner, leaseId: leaseRef.id };
        }).then(async (outcome) => {
            if (outcome.winner) {
                await Economy.adjustWallet(outcome.winner.bidderUid, -outcome.winner.amount, '🔨',
                    `Won #${outcome.number} at auction`, outcome.leaseId);
                News.post('🔢', `${outcome.winner.bidderName} wins #${outcome.number} for ${Economy.fmt(outcome.winner.amount)}!`);
            }
            return outcome;
        });
    }
};
window.Numbers = Numbers;
```

Note on `Economy.adjustWallet` happening *after* the transaction, not inside it: Firestore
retries a transaction's entire callback on write contention, and `Economy.adjustWallet`
(`js/srmpc-market.js:184-195`) is a non-idempotent side effect (it both writes a balance and
appends a `ledger` row) — calling it from inside the callback risks the wallet being debited
more than once if the callback re-runs. So the transaction's only job is the atomic, contended
part — deciding *who wins* and flipping the registry/lease state, which is safe to retry because
it's pure overwrite — and the one-shot wallet debit happens once, after the transaction
commits. Same division of labor `Contracts.sign()` uses: status flip first, `_settleBonus`
after (`CONTRACT_SIGNING_DESIGN.md §5`).

---

## 6. Validation: does this entry actually hold the number?

Requirement #3's last clause: verify a team/driver registering for a race holds a valid lease
for the number being submitted. Since numbers resolve automatically from the active lease
(§4.2) rather than being freehand-typed at signup, "submitting a number" means the signup simply
carries whatever `resolveForEntry` currently returns — the validation is really "is that
resolution still backed by a live, non-revoked lease."

```js
// Extends Numbers (§5)
Numbers.validateRaceEntry = async function ({ driverId, teamId, seriesId, world }) {
    const contract = (await DB.contracts({ force: true }).catch(() => []))
        .find(c => c.status === 'active' && c.personKind === 'driver' && c.personId === driverId && c.teamId === teamId);
    if (!contract) return { ok: true, number: null };   // no active contract → nothing to validate yet

    const resolved = await this.resolveForEntry(contract, world);
    if (!resolved.number) return { ok: true, number: null };   // free car number, not a leased asset — allowed

    const reg = await DB.get('numberRegistry', this.regId(seriesId, resolved.number)).catch(() => null);
    const lease = reg?.currentLeaseId ? await DB.get('numberLeases', reg.currentLeaseId).catch(() => null) : null;
    const ownerMatches = lease && lease.status === 'active'
        && ((resolved.source === 'team' && lease.ownerType === 'team' && lease.ownerId === teamId)
            || (resolved.source === 'driver' && lease.ownerType === 'driver' && lease.ownerId === driverId));

    if (!ownerMatches) {
        return { ok: false, number: resolved.number,
            reason: `#${resolved.number} is no longer a valid lease for ${resolved.source === 'team' ? 'this team' : 'this driver'} — it may have been revoked or lost at renewal.` };
    }
    return { ok: true, number: resolved.number };
};
```

**Where this plugs in:**
- `js/srmpc-views.js:588` (`DB.create('raceSignups', { raceId, uid, driverId })`) — call
  `Numbers.validateRaceEntry` first; on `ok:false`, block the signup with `Util.notify(reason,
  'error')` (same pattern as every other guarded write in this app). On success, stamp the
  resolved number onto the signup doc for display: `raceSignups.number`.
- `js/srmpc-sim.js` `Sim.gridFor` (`:708-719`) — **advisory only, never blocking.** The AI grid
  must never stop simulating because a lease lapsed; a driver with an invalid number still
  races, they just show up as `🏎️` (no number) in results/standings until the lease issue is
  resolved, exactly like today's driver with `number: null`.

---

## 7. Legacy renewals & hoarding prevention

This is the season-rollover job — the same integration point `RECRUITMENT_CONTRACTS_DESIGN.md
§7.2` used for championship-bonus and termination-clause settlement:
`js/srmpc-admin.js:330` `Admin.closeSeason`.

### 7.1 First right of refusal

```js
Numbers.openRenewalWindows = async function (seriesId, seasonId) {
    const leases = (await DB.list('numberLeases', { force: true }).catch(() => []))
        .filter(l => l.seriesId === seriesId && l.status === 'active' && !l.renewal);
    const opensAt = Util.todayISO();
    for (const lease of leases) {
        const fee = Math.max(1, Math.round((lease.price || 0) * this.RENEWAL_FEE_PCT));
        await DB.update('numberLeases', lease.id, {
            renewal: { opensAt, closesAt: Util.isoAddDays(opensAt, this.RENEWAL_WINDOW_DAYS), fee }
        });
        News.post('📬', `${lease.ownerName}'s renewal window for #${lease.number} is open — ${Economy.fmt(fee)} to keep it.`);
    }
};

// Owner-initiated — mirrors Contracts.sign's "only the named party" guard.
Numbers.renew = async function (leaseId) {
    const lease = await DB.get('numberLeases', leaseId);
    if (!lease || lease.status !== 'active' || !lease.renewal) throw new Error('This number has no open renewal window.');
    if (lease.ownerUid && lease.ownerUid !== Auth.uid() && !Auth.isAdmin()) throw new Error('Only the owner can renew this lease.');
    if (lease.renewal.closesAt < Util.todayISO()) throw new Error('The renewal window has closed.');

    if (lease.ownerUid) await Economy.spend(lease.renewal.fee, `Renewal lease fee — #${lease.number}`, '📜');
    await DB.update('numberLeases', leaseId, {
        renewal: null, seasonYear: new Date().getFullYear(), acquiredVia: 'renewal',
        acquiredAt: Util.todayISO(), price: lease.renewal.fee
    });
    News.post('✅', `${lease.ownerName} renews #${lease.number} for another season.`);
};

// Lazy sweep — anything still sitting in an expired renewal window when the
// registry is next listed loses first-right-of-refusal and re-enters the pool.
Numbers.expireRenewalWindows = async function () {
    const today = Util.todayISO();
    const stale = (await DB.list('numberLeases', { force: true }).catch(() => []))
        .filter(l => l.status === 'active' && l.renewal && l.renewal.closesAt < today);
    for (const lease of stale) {
        await DB.update('numberLeases', lease.id, { status: 'expired', endedAt: today, endReason: 'renewal-lapsed' });
        await DB.update('numberRegistry', this.regId(lease.seriesId, lease.number), { status: 'available', currentLeaseId: null });
        News.post('⌛', `#${lease.number} reverts to the pool — ${lease.ownerName} let the renewal window lapse.`);
    }
};
```

### 7.2 Use-it-or-lose-it

Computed live against completed races for the season being closed — same join style
`Stats.driverTable`/`Stats.teamTable` already use (§1's live-resolution tradeoff).

```js
// participation = races the owner fielded at all this season (denominator);
// used = races where the CURRENT lease's number is the one they'd resolve to.
// Both computed against today's roster/lease state, not a historical snapshot.
Numbers._usage = function (lease, races, world, seasonId) {
    const completed = Stats.completedRaces(races, { seriesId: lease.seriesId, seasonId });
    let participation = 0, used = 0;
    for (const race of completed) {
        const fielded = lease.ownerType === 'team'
            ? race.results.some(r => world.driversById[r.driverId]?.teamId === lease.ownerId)
            : race.results.some(r => r.driverId === lease.ownerId);
        if (!fielded) continue;
        participation++;
        // Did the entity actually race under THIS number (not overridden away via numberChoice)?
        if (lease.ownerType === 'driver') { used++; continue; }  // driver's own car — always themselves
        used++;  // team lease: any car fielded under the team counts as fielding the team's number,
                 // UNLESS every driver on it currently overrides to their own personal number —
                 // edge case left to GM judgement rather than over-modeling here.
    }
    return { participation, used, pct: participation ? used / participation : 0 };
};

Numbers.enforceHoarding = async function (seriesId, seasonId) {
    const world = await DB.loadWorld(true);
    const races = world.races;
    const leases = (await DB.list('numberLeases', { force: true }).catch(() => []))
        .filter(l => l.seriesId === seriesId && l.status === 'active');

    const series = world.seriesById[seriesId];
    const minPct = series?.numberFieldMinPct ?? this.MIN_FIELD_PCT;
    const revoked = [];
    for (const lease of leases) {
        const { participation, pct } = this._usage(lease, races, world, seasonId);
        if (participation < 3) continue;   // grace period — too small a sample to judge (mirrors Clauses.MIN_AVG_STARTS)
        if (pct >= minPct) continue;
        await DB.update('numberLeases', lease.id, { status: 'revoked', endedAt: Util.todayISO(), endReason: 'hoarding-clause' });
        await DB.update('numberRegistry', this.regId(seriesId, lease.number), { status: 'available', currentLeaseId: null });
        News.post('🚫', `#${lease.number} stripped from ${lease.ownerName} — fielded in only ${Math.round(pct * 100)}% of races (league minimum ${Math.round(minPct * 100)}%).`);
        revoked.push(lease);
    }
    return revoked;
};
```

### 7.3 Champion's courtesy — realistic touch, low cost

Real series (F1, IndyCar) let the reigning champion run #1. `Stats.crownSeason` already
computes `championDriverId`/`championTeamId` inside `Admin.closeSeason`
(`js/srmpc-admin.js:334`) — reuse that snapshot for free:

```js
Numbers.offerChampionsNumberOne = async function (seriesId, snapshot) {
    const regId = this.regId(seriesId, 1);
    const reg = await DB.get('numberRegistry', regId).catch(() => null);
    if (reg?.status === 'leased') return;   // already spoken for this season
    const champTeam = snapshot.championTeamId ? await DB.get('teams', snapshot.championTeamId) : null;
    if (!champTeam?.ownerUid) return;       // AI champion — no player to offer it to
    News.post('🥇', `${champTeam.name} may claim #1 as reigning champion — first right of refusal before it goes to auction.`);
    // Surfaced as a one-click claim in the season-close summary; claiming
    // creates a lease via acquiredVia:'gm-grant', price:0, same shape as §5's winner path.
};
```

### 7.4 Full rollover sequence — `Admin.closeSeason` gains one step

Inserted alongside the clause-settlement steps `RECRUITMENT_CONTRACTS_DESIGN.md §7.2` already
adds at `js/srmpc-admin.js:330`:

```js
// 🔷 Car numbers: resolve stale auctions, enforce hoarding, open renewals,
//    offer the champion #1, then let next season's numbers head to auction.
await Numbers.resolveDueAuctions(seriesId);
await Numbers.enforceHoarding(seriesId, seasonId);
await Numbers.expireRenewalWindows();
await Numbers.openRenewalWindows(seriesId, seasonId);
if (snapshot.championTeamId) await Numbers.offerChampionsNumberOne(seriesId, snapshot);
```

Order matters: hoarding revocations happen *before* renewal windows open (a revoked number
never gets a first-right-of-refusal), and stale windows from the *previous* rollover expire
before new ones open (so a lapsed renewal doesn't linger as if it were still live).

---

## 8. Firestore rules

New collections need the same "member-write, GM-override-everything" shape as `contracts`/
`negotiations` (`firestore.rules:46-72`) — plus one tightened edge: only the bidder identified
by `bidderUid` may create/overwrite their own bid doc, mirroring the contracts rule's "only the
named party can flip pending→active" pattern (`CONTRACT_SIGNING_DESIGN.md §8`).

```
match /numberRegistry/{doc} {
  allow read: if true;
  allow write: if isAuthenticated();   // status transitions are all gated in app logic;
                                        // GM override already covers admin actions (line 24)
}

match /numberLeases/{doc} {
  allow read: if true;
  allow create: if isAuthenticated();
  allow update: if isAuthenticated() && (
    resource.data.get('ownerUid', null) == request.auth.uid
    || resource.data.get('ownerUid', null) == null   // league-owned lease stays member-editable
  );
  allow delete: if false;   // leases are an audit trail — terminal statuses only, never deleted
}

match /numberBids/{doc} {
  allow read: if isAuthenticated();   // hidden from the UI until resolution, but not secret from
                                      // authenticated members — same trust level as `negotiations`
  allow create, update: if isAuthenticated() && request.resource.data.bidderUid == request.auth.uid;
  allow delete: if false;
}
```

⚠️ Per this project's own incident note (`RECRUITMENT_CONTRACTS_DESIGN.md §9` and this repo's
memory of the 2026-07-09 outage): **new `match` blocks in `firestore.rules` do nothing until
deployed** — `firebase deploy --only firestore:rules`. Silently-missing rules read as "every
write fails," not as an obvious error.

---

## 9. Integration changes, file by file

### `js/srmpc-numbers.js` — 🔷 NEW
The full `Numbers` module (§4.2, §5, §6, §7).

### `js/srmpc-core.js`
Add `Util.isoAddDays` (§1) — not yet present despite being flagged as needed in
`CONTRACT_SIGNING_DESIGN.md`.

### `js/srmpc-data.js`
Add `DB.set()` and `DB.transact()` (§1).

### `js/srmpc-admin.js`
- `closeSeason()` (`:330`): five-line rollover hook (§7.4).
- `seriesForm()` (`:395+`): two new inputs for `numberFormat.min/max`.
- New `Admin.numbersModal(seriesId)`: registry browser (available/auction/leased/retired), open
  auction / retire / gm-grant actions — same shape as `Admin.teamForm`/`seasonsModal`.

### `js/srmpc-contracts.js` (per `CONTRACT_SIGNING_DESIGN.md`)
- `_validate()`: no change needed — number conflicts are resolved, not blocking.
- `sign()`: after `_applyMembership`, call `Numbers.resolveForEntry` and persist `numberChoice`
  if the review modal set one.
- `reviewModal()`: add the `🔢 Race number` selector when both a team and driver lease exist
  (§4.2).

### `js/srmpc-views.js`
- `:588` free-agent race signup: call `Numbers.validateRaceEntry` before `DB.create`
  (§6).

### `js/srmpc-sim.js`
- `gridFor()`: no blocking change — simulation must never stop for a lapsed lease (§6).
- `simulateRace()`: results display can show `Numbers.resolveForEntry` output live in the UI
  layer (`srmpc-views.js` race-result rendering) rather than the sim engine itself.

### `js/srmpc-career.js` / `js/srmpc-admin.js` driver forms (`:341`, `:1082`)
The free-text `number` input becomes read-only, sourced from `Numbers.resolveForEntry` — a
driver no longer types their own number, they win or lease it. Keep `drivers.number` as the
denormalized cache of the last-resolved value (same pattern as `drivers.teamId` being a cache
that only `Contracts` writes) so every existing display site (`srmpc-profile.js:317`,
`srmpc-views.js:834,900`, `srmpc-market.js:510`) keeps working unmodified.

---

## 10. Verification plan (`.claude/skills/verify` — `numbers-drive.js`)

1. Open an auction for #24 in Series A and #24 in Series B independently — winning one must not
   touch the other's registry doc (isolation, requirement #1).
2. Two sealed bids on the same number; resolve → highest bidder's wallet is debited exactly
   once, a `numberLeases` doc exists with `status:'active'`, loser's bid is `status:'lost'`.
3. Winning bidder's balance drops below their bid *after* bidding but before resolution (e.g. an
   unrelated purchase) → resolution skips them (`status:'refunded'`), next-highest affordable
   bidder wins instead.
4. Call `resolveDueAuctions` twice in a row on an already-resolved number → second call is a
   no-op (transaction precondition), no double lease, no double charge.
5. Driver holds a personal #7 lease, signs with a team holding #3 — default entry resolves to
   #3; setting `numberChoice:'driver'` at signing resolves to #7 instead.
6. Season close: a lease fielded in 1 of 8 completed races (12.5%, below the 50% default) is
   revoked and the registry reverts to `available`; a lease fielded in 5 of 8 (62.5%) opens a
   renewal window instead.
7. Renewal window expires unpaid → lease flips to `expired`, registry reverts to `available` on
   the next lazy sweep.
8. Reigning champion's team is offered #1 first-right-of-refusal before #1 (if unowned) is
   auctioned to the general pool.
9. `firestore.rules` regression: a player cannot create a `numberBids` doc with someone else's
   `bidderUid`, cannot write another player's `numberLeases` doc.
