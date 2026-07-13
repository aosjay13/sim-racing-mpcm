/* ============================================================
   Phoenix SRMPC — Isolated Wallets
   Team budgets and personal player budgets are two different
   fields on two different documents — `users/{uid}.balance` (the
   Player Wallet — unchanged mechanism, still governed by
   Economy.DIFFICULTIES) and `teams/{teamId}.budget` (the Team
   Wallet — new). They are never conflated: even when a team owner
   hires their own driver persona, paying salary debits the TEAM's
   document and credits the PLAYER's document — two real numbers
   moving, never a same-uid no-op.

   Wallet.executeRoleTransaction is the one function that moves
   money between any two wallets (team↔team, team↔player,
   player↔player, or either↔the league as an external sink/mint).
   Every transfer writes a matching pair of ledger rows in the same
   Firestore transaction — a wallet balance can never change without
   an immutable, paired audit trail.
   ============================================================ */
'use strict';

const Wallet = {
    // Team Owner difficulty — separate from Economy.DIFFICULTIES (which
    // governs the PERSONAL wallet). Picked once, the first time a player
    // enters the Team Owner role, and gates the team marketplace: which
    // teams are for sale, and how much operating budget a purchase seeds
    // the new team's wallet with.
    TEAM_DIFFICULTIES: {
        hard: {
            id: 'hard', icon: '🔴', label: 'Grassroots Underdog', tier: 'hard',
            tagline: 'Hard — a small, low-prestige garage team on a shoestring budget.',
            teamStart: 20000, foundPrice: 1000, marketValueRange: [2000, 8000]
        },
        medium: {
            id: 'medium', icon: '🟡', label: 'Midfield Runner', tier: 'medium',
            tagline: 'Medium — an established midfield operation with real resources.',
            teamStart: 50000, foundPrice: 3000, marketValueRange: [8000, 25000]
        },
        easy: {
            id: 'easy', icon: '🟢', label: 'Front-Running Outfit', tier: 'easy',
            tagline: 'Easy — a large, high-prestige team with a massive operating budget.',
            teamStart: 100000, foundPrice: 8000, marketValueRange: [25000, 60000]
        }
    },
    TEAM_TIER_ORDER: ['hard', 'medium', 'easy'],
    teamDifficultyInfo(id) { return this.TEAM_DIFFICULTIES[id] || null; },

    /* ---------------- Reads ---------------- */
    // Player Wallet: the existing users/{uid}.balance field. Kept alongside
    // Economy.balance() (same source) so team-facing code doesn't need to
    // depend on the Economy module — Wallet stands alone.
    playerBalance(uid = Auth.uid()) {
        if (!uid) return 0;
        if (uid === Auth.uid()) return Number(Auth.state.profile?.balance) || 0;
        const cached = DB._cache.users?.find(u => u.id === uid);
        return Number(cached?.balance) || 0;
    },
    // Team Wallet: teams/{teamId}.budget. Synchronous against whatever's
    // cached (matches how every other team field is read in this app —
    // via world.teamsById, itself populated by DB.teams()).
    teamBalance(teamId) {
        const t = DB._cache.teams?.find(x => x.id === teamId);
        return Number(t?.budget) || 0;
    },
    async teamBalanceFresh(teamId) {
        const t = await DB.get('teams', teamId, { force: true }).catch(() => null);
        return Number(t?.budget) || 0;
    },

    /* ---------------- The one function that moves money ---------------- */
    // from / to: { type: 'team'|'player', id } or null (external sink/mint —
    // the league). Reads and writes both wallets AND writes a matching pair
    // of ledger rows inside one Firestore transaction, so a balance can
    // never change without an immutable paired record. This is the
    // "executeRoleTransaction(payerId, payeeId, amount, context)" primitive:
    // payer/payee are wallet descriptors rather than bare uids specifically
    // so the SAME function safely covers the case a payer and payee resolve
    // to the same human (team owner paying their own driver persona) — the
    // two wallets are still two different Firestore documents, so the
    // transfer is always real, never a same-uid net-to-zero.
    // fromLabel/toLabel (optional): distinct ledger phrasing per side,
    // matching this app's existing "paid X / received from Y" convention —
    // falls back to `label` for whichever side doesn't override it.
    async executeRoleTransaction({ from = null, to = null, amount, icon = '💵', label = '', fromLabel = null, toLabel = null, refId = null }) {
        amount = Math.round(Number(amount) || 0);
        if (!amount || (!from && !to)) return null;
        // Route to the ACTIVE career's physical collections so wallet transfers
        // stay inside the current career (see Careers in js/srmpc-core.js).
        const collFor = (w) => Careers.collName(w.type === 'team' ? 'teams' : 'users');
        const fieldFor = (w) => w.type === 'team' ? 'budget' : 'balance';
        const pairId = Util.uid();
        const at = Util.todayISO();

        await DB.runTransaction(async (tx) => {
            const fs = DB._fs();
            const seen = {};
            for (const w of [from, to]) {
                if (!w) continue;
                const key = w.type + ':' + w.id;
                if (!seen[key]) seen[key] = { ref: fs.collection(collFor(w)).doc(w.id) };
            }
            for (const key in seen) seen[key].snap = await tx.get(seen[key].ref);

            const apply = (w, delta) => {
                const entry = seen[w.type + ':' + w.id];
                const field = fieldFor(w);
                const bal = Number(entry.snap.data()?.[field]) || 0;
                tx.set(entry.ref, { [field]: bal + delta, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
            };
            if (from) apply(from, -amount);
            if (to) apply(to, amount);

            const ledgerCol = fs.collection(Careers.collName('ledger'));
            const row = (w, delta, rowLabel) => ({
                walletType: w.type, walletId: w.id, uid: w.type === 'player' ? w.id : null,
                amount: delta, icon, label: String(rowLabel || label || '').slice(0, 140), refId, pairId, at,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            if (from) tx.set(ledgerCol.doc(), row(from, -amount, fromLabel));
            if (to) tx.set(ledgerCol.doc(), row(to, amount, toLabel));
        });

        DB.invalidate('users'); DB.invalidate('teams'); DB.invalidate('ledger');
        const myUid = Auth.uid();
        if ((from?.type === 'player' && from.id === myUid) || (to?.type === 'player' && to.id === myUid)) {
            await Auth.reloadProfile().catch(() => {});
        }
        return pairId;
    },

    /* ---------------- Single-sided team-wallet helpers ---------------- */
    // Mirrors Economy.spend/adjustWallet, but for a team's budget instead of
    // a player's balance — used where the OTHER side of a transfer is
    // already handled by an existing Economy call (e.g. a departing driver
    // pays their own buyout via Economy.spend; the team side of that same
    // transfer credits the team's budget via adjustTeamWallet), or where the
    // counterpart is a pure external sink (an AI hire's signing bonus).
    async teamSpend(teamId, amount, label, icon = '💸') {
        amount = Math.round(Number(amount) || 0);
        const team = await DB.get('teams', teamId).catch(() => null);
        const bal = Number(team?.budget) || 0;
        if (amount > bal) {
            throw new Error(`Not enough team budget — ${label} costs ${Economy.fmt(amount)} but the team has ${Economy.fmt(bal)}.`);
        }
        await this.adjustTeamWallet(teamId, -amount, icon, label);
    },

    async adjustTeamWallet(teamId, delta, icon, label, refId = null) {
        delta = Math.round(Number(delta) || 0);
        if (!teamId || !delta) return;
        const team = await DB.get('teams', teamId).catch(() => null);
        if (!team) return;
        await DB.update('teams', teamId, { budget: (Number(team.budget) || 0) + delta }).catch(() => {});
        try {
            await DB.create('ledger', {
                walletType: 'team', walletId: teamId, uid: null,
                amount: delta, icon: icon || '💵', label: String(label || '').slice(0, 140), refId,
                at: Util.todayISO()
            });
        } catch (e) { console.warn('Team ledger write failed:', e); }
    },

    /* ---------------- Batch settlement (race payouts, season close) ---------------- */
    // Many simultaneous line items, each tagged with its wallet. Nets
    // same-wallet deltas into one balance write per wallet (one batch for
    // players, one for teams — same shape as DB.batchUpdate elsewhere), but
    // keeps every individual line as its own ledger row for full audit
    // granularity. Not a runTransaction — matches the existing payoutRace
    // performance profile (settlement is infrequent enough that read-then-
    // write races aren't a practical concern), but every wallet write is
    // still ledger-paired at the row level.
    async applyBatch(lines) {
        lines = lines.filter(l => l.wallet && Math.round(Number(l.amount) || 0));
        if (!lines.length) return;
        const perWallet = new Map();
        for (const l of lines) {
            const key = l.wallet.type + ':' + l.wallet.id;
            perWallet.set(key, (perWallet.get(key) || 0) + Math.round(Number(l.amount) || 0));
        }
        const userUpdates = [], teamUpdates = [];
        for (const [key, delta] of perWallet) {
            if (!delta) continue;
            const [type, id] = key.split(':');
            if (type === 'player') {
                const doc = await DB.get('users', id).catch(() => null);
                if (doc) userUpdates.push({ id, patch: { balance: (Number(doc.balance) || 0) + delta } });
            } else {
                const doc = await DB.get('teams', id).catch(() => null);
                if (doc) teamUpdates.push({ id, patch: { budget: (Number(doc.budget) || 0) + delta } });
            }
        }
        if (userUpdates.length) await DB.batchUpdate('users', userUpdates);
        if (teamUpdates.length) await DB.batchUpdate('teams', teamUpdates);
        if (userUpdates.some(u => u.id === Auth.uid())) await Auth.reloadProfile().catch(() => {});

        const rows = lines.map(l => ({
            walletType: l.wallet.type, walletId: l.wallet.id, uid: l.wallet.type === 'player' ? l.wallet.id : null,
            amount: Math.round(Number(l.amount) || 0), icon: l.icon || '💵',
            label: String(l.label || '').slice(0, 140), refId: l.refId || null
        }));
        await DB.batchCreate('ledger', rows);
    },

    /* ---------------- Team ledger (mirrors Economy.ledgerFor, team-scoped) ---------------- */
    async teamLedgerFor(teamId, limit = 10) {
        const rows = (await DB.list('ledger', { force: true }).catch(() => []))
            .filter(t => t.walletType === 'team' && t.walletId === teamId)
            .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0) || (b.at || '').localeCompare(a.at || ''));
        return { recent: rows.slice(0, limit), total: rows.reduce((s, t) => s + t.amount, 0), count: rows.length };
    },

    async teamEarningsPanel(teamId, title = '📒 Team Finances') {
        const { recent, count } = await this.teamLedgerFor(teamId);
        return `<section class="panel">
            <div class="panel-head"><h2>${title}</h2><span class="chip wallet-chip">💵 ${Economy.fmt(this.teamBalance(teamId))}</span></div>
            ${recent.length ? recent.map(t => `
                <div class="race-row">
                    <div class="driver-hero-num" style="font-size:1rem;min-width:2.4rem;height:2.4rem">${t.icon || '💵'}</div>
                    <div class="race-row-main">
                        <span class="race-title">${Util.esc(t.label)}</span>
                        <span class="race-sub">${Util.esc(Util.fmtDateShort(t.at))}</span>
                    </div>
                    <span class="market-price" style="color:${t.amount < 0 ? 'var(--bad)' : 'var(--good)'}">${t.amount < 0 ? '−' : '+'}${Economy.fmt(Math.abs(t.amount))}</span>
                </div>`).join('') + (count > recent.length ? `<p class="muted small">Showing the last ${recent.length} of ${count} team transactions.</p>` : '')
            : C.empty('📒', 'No team transactions yet', 'Payroll, prize shares, sponsorships, buyouts, and clause bonuses all land here as they happen — never mixed with anyone\'s personal wallet.')}
        </section>`;
    },

    /* ---------------- Team wallet lifecycle ---------------- */
    // Idempotent: only seeds `budget` if the team doesn't already have a
    // number there. A pre-existing (already-owned, mid-career) team without
    // a wallet yet is backfilled from its CURRENT prestige tier rather than
    // shortchanged to the cheapest tier — see Career.teamTierForPrestige.
    async ensureTeamWallet(teamId, tier = 'medium') {
        const team = await DB.get('teams', teamId, { force: true }).catch(() => null);
        if (!team || Number.isFinite(team.budget)) return team;
        const d = this.TEAM_DIFFICULTIES[tier] || this.TEAM_DIFFICULTIES.medium;
        await DB.update('teams', teamId, { budget: d.teamStart, tier: team.tier || d.tier });
        return DB.get('teams', teamId, { force: true });
    },

    // Assigns marketValue/tier to a team that doesn't have one yet (existing
    // AI/league teams predate the marketplace). Computed once from current
    // prestige and persisted — a price tag that holds steady while a buyer
    // is browsing, not one that drifts every render.
    async backfillMarketValue(team, world) {
        if (Number.isFinite(team.marketValue) && team.tier) return team;
        const stars = Prestige.teamStars(team.id, world);
        const tier = stars >= 4 ? 'easy' : stars >= 3 ? 'medium' : 'hard';
        const [lo, hi] = this.TEAM_DIFFICULTIES[tier].marketValueRange;
        const marketValue = Math.round((lo + hi) / 2 / 100) * 100;
        await DB.update('teams', team.id, { marketValue, tier }).catch(() => {});
        return { ...team, marketValue, tier };
    }
};
window.Wallet = Wallet;
