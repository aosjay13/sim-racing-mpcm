/* ============================================================
   Phoenix SRMPC — AI Financial Parity & Dynamic Budgets

   AI-controlled (unowned) teams used to run on ghost money: their
   income and spending "came from / vanished into the league" with
   no wallet and no audit trail. This module makes the AI economy
   REAL, on the exact same rails as human teams:

   • Every AI wallet movement goes through Wallet.applyBatch /
     Wallet.adjustTeamWallet / Wallet.executeRoleTransaction — one
     immutable ledger row per line, same schema, same collection.
   • Income: AI teams now collect their prize team-share and brand
     sponsor payouts (payoutRace gates removed), PLUS an automated
     consortium sponsorship per race — calculateAISponsorship() —
     scaled by team prestige, the strength of the field they raced
     against, and the human-economy anchor below.
   • Spending: AI payroll, clause bonuses, and sign-on bonuses now
     debit teams/{id}.budget for unowned teams exactly like owned
     ones (payoutRace + Deals.execute); blind-bid number auctions
     already charged the right wallet via executeRoleTransaction.

   Economy anchoring: each race settlement recomputes the median
   budget of HUMAN teams vs AI teams and stores an anchorMultiplier
   in config/aiEconomy (clamped 1–ANCHOR_MAX). If human economies
   inflate, AI sponsorship scales up so AI teams can keep bidding
   on top free agents. The GM also holds a globalMultiplier knob.

   Insolvency parity: an AI team whose budget hits ≤ $0 enters the
   SAME 'insolvent' state as humans (hiring freeze via
   Insolvency.assertSolvent), but acts instantly: it auto-liquidates
   its garage at Market.SELL_RATIO and surrenders its car numbers.
   If still underwater past the same grace rules it is marked
   'repossessed' (league receivership) — and instead of rotting on
   the marketplace, a CONSORTIUM TAKEOVER fires after
   CONSORTIUM_GRACE_RACES more completed races: debt written off
   (ledger row), marketValue recomputed, a baseline tier budget
   injected (ledger row), and the team returns to the grid solvent.

   GM oversight: Admin → 🏦 AI Finance (adminPanel below) — flat 2D
   panels and race-rows with 🏁 checkered markers, per house style.
   ============================================================ */
'use strict';

const Parity = {
    /* ---------------- Tuning ---------------- */
    SPONSOR_BASE: 800,          // 1★ consortium payout/race; scales by Prestige.MULTIPLIER
    FIELD_TIER_STEP: 0.125,     // field-strength tier: 1★ field ×1.0 → 5★ field ×1.5
    ANCHOR_MAX: 3,              // anchor multiplier ceiling — inflation chase, not a money printer
    ANCHOR_BASELINE: 50000,     // healthy AI median (medium-tier operating budget)
    CONSORTIUM_GRACE_RACES: 3,  // completed races in receivership before the takeover fires
    BID_HEADROOM: 2,            // AI opens talks only with ≥ salary×2 in the bank (sign-on + first payroll)

    aiTeams(world) { return (world?.teams || []).filter(t => !t.ownerUid); },
    isAI(team) { return !!team && !team.ownerUid; },

    /* ---------------- config/aiEconomy ---------------- */
    // { globalMultiplier (GM knob), anchorMultiplier + medians (computed),
    //   updatedAt } — one doc, career-namespaced like all config.
    _defaults: { globalMultiplier: 1, anchorMultiplier: 1, humanMedian: 0, aiMedian: 0, updatedAt: null },

    async config() {
        const doc = await DB.get('config', 'aiEconomy').catch(() => null);
        return { ...this._defaults, ...(doc || {}) };
    },
    async saveConfig(patch) {
        await DB.set('config', 'aiEconomy', { ...patch, updatedAt: Util.todayISO() });
        DB.invalidate('config');
    },

    /* ============================================================
       1. Dynamic AI sponsorship engine
       ============================================================ */
    // Strength of the field this race: average prestige of the drivers who
    // actually took the start. A 1★ club field pays ×1.0, an all-5★ pro
    // field ×1.5 — the series tier expressed by who shows up to it.
    fieldTier(race, world) {
        const stars = (race.results || [])
            .map(r => Prestige.driverStars(r.driverId, world))
            .filter(s => Number.isFinite(s));
        if (!stars.length) return 1;
        const avg = stars.reduce((a, b) => a + b, 0) / stars.length;
        return 1 + (Prestige.clamp(avg) - 1) * this.FIELD_TIER_STEP;
    },

    // The automated per-race sponsor payout for one AI team:
    //   base(prestige) × fieldTier(series strength) × anchor × GM global knob
    // Pure — the caller adds it to the race settlement batch so it lands as
    // a normal ledger-paired team-wallet credit.
    calculateAISponsorship(team, race, world, cfg) {
        if (!this.isAI(team) || team.financialState === 'repossessed') return 0;
        const stars = Prestige.teamStars(team.id, world);
        const base = this.SPONSOR_BASE * Prestige.multiplier(stars);
        const raw = base * this.fieldTier(race, world)
            * (Number(cfg?.anchorMultiplier) || 1)
            * (Number(cfg?.globalMultiplier) || 1);
        return Math.max(0, Math.round(raw / 10) * 10);
    },

    /* ---------------- Human-economy anchoring ---------------- */
    median(nums) {
        const s = nums.filter(Number.isFinite).sort((a, b) => a - b);
        if (!s.length) return 0;
        const m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
    },

    // Recompute the anchor from live wallets. anchor = humanMedian over the
    // healthier of (baseline, aiMedian): if human budgets inflate past what
    // AI teams hold, AI sponsorship scales up to chase — clamped so a single
    // whale season can't triple-print forever. Runs on every race settlement
    // (data is already loaded there) and on the GM dashboard button.
    async refreshAnchor(world) {
        const humans = (world.teams || []).filter(t => t.ownerUid && Number.isFinite(Number(t.budget)));
        const ais = this.aiTeams(world).filter(t => Number.isFinite(Number(t.budget)));
        const humanMedian = this.median(humans.map(t => Number(t.budget)));
        const aiMedian = this.median(ais.map(t => Number(t.budget)));
        const anchorMultiplier = !humanMedian ? 1
            : Math.min(this.ANCHOR_MAX, Math.max(1,
                Math.round(humanMedian / Math.max(this.ANCHOR_BASELINE, aiMedian) * 100) / 100));
        const cfg = await this.config();
        await this.saveConfig({ ...cfg, anchorMultiplier, humanMedian, aiMedian });
        return { anchorMultiplier, humanMedian, aiMedian };
    },

    /* ---------------- AI bidding guard (free-agent talks) ---------------- */
    // The AI principal only opens contract talks it can actually fund: not
    // insolvent / in receivership, and holding sign-on + first payroll.
    async assertAICanBid(teamId, salary) {
        const t = await DB.get('teams', teamId, { force: true }).catch(() => null);
        if (!t || t.ownerUid) return;
        if (t.financialState === 'insolvent' || t.financialState === 'repossessed') {
            throw new Error(`${t.name} is ${t.financialState === 'insolvent' ? 'insolvent' : 'in league receivership'} — the consortium won't fund new signings until it recovers.`);
        }
        const need = Math.round(Number(salary) || 0) * this.BID_HEADROOM;
        if ((Number(t.budget) || 0) < need) {
            throw new Error(`${t.name} can't fund this signing — the offer needs ${Economy.fmt(need)} on hand (sign-on + first payroll) but the team budget is ${Economy.fmt(Number(t.budget) || 0)}.`);
        }
    },

    /* ============================================================
       2. AI insolvency & market recovery
       Delegated here by Insolvency.evaluate for unowned teams —
       same thresholds, same ledger discipline, but the AI "owner"
       reacts instantly instead of waiting on a human.
       ============================================================ */
    async evaluateAITeam(teamId, { raceCompleted = false } = {}) {
        const t = await DB.get('teams', teamId, { force: true }).catch(() => null);
        if (!t || t.ownerUid || t.financialState === 'repossessed') return;
        let budget = Number(t.budget) || 0;

        if (budget > 0) {
            if (t.financialState === 'insolvent') {
                await DB.update('teams', teamId, { financialState: 'solvent', insolventAt: null, insolventRaces: 0 });
                News.post('✅', `${t.name} (AI) is solvent again — back in the hiring market.`);
            }
            return;
        }

        // Flag / advance the fuse — same fields and grace as human teams.
        const racesUnderwater = (Number(t.insolventRaces) || 0) + (raceCompleted ? 1 : 0);
        if (t.financialState !== 'insolvent') {
            await DB.update('teams', teamId, { financialState: 'insolvent', insolventAt: Util.todayISO(), insolventRaces: racesUnderwater });
            News.post('🧯', `${t.name} (AI) is INSOLVENT (${Economy.fmt(budget)}) — liquidating assets.`);
        } else if (raceCompleted) {
            await DB.update('teams', teamId, { insolventRaces: racesUnderwater });
        }

        // Instant liquidation: garage cars at Market.SELL_RATIO, numbers
        // surrendered for their partial refund — every credit a ledger row.
        budget = await this.liquidateAIAssets(teamId);
        if (budget > 0) {
            await DB.update('teams', teamId, { financialState: 'solvent', insolventAt: null, insolventRaces: 0 });
            News.post('✅', `${t.name} (AI) liquidated assets and cleared its debt — solvent again.`);
            return;
        }

        if (budget <= Insolvency.REPO_BALANCE || racesUnderwater > Insolvency.REPO_GRACE_RACES) {
            await this.aiRepossess(teamId, { reason: budget <= Insolvency.REPO_BALANCE ? 'critical debt' : 'unresolved insolvency' });
        }
    },

    // Sell the TEAM's garage into the wallet and surrender its numbers.
    // Returns the fresh budget after liquidation.
    async liquidateAIAssets(teamId) {
        const t = await DB.get('teams', teamId, { force: true }).catch(() => null);
        if (!t) return 0;
        const garage = Garage.garageOf(t);
        for (const car of garage) {
            const back = Math.round((Number(car.price) || 0) * Market.SELL_RATIO);
            if (back) await Wallet.adjustTeamWallet(teamId, back, '🏁', `Liquidated ${car.name} (AI insolvency, ${Math.round(Market.SELL_RATIO * 100)}%)`);
        }
        if (garage.length) await Garage.persistTeamGarage(teamId, []);
        try { await Numbers.surrenderForTeam(teamId); } catch (e) { /* no registry yet */ }
        return Wallet.teamBalanceFresh(teamId);
    },

    // League receivership: contracts released (players walk free, no
    // penalty), the team is parked with its debt intact and a takeover
    // fuse — NOT relisted like a human repossession; the consortium loop
    // below brings it back as an active CPU competitor.
    async aiRepossess(teamId, { reason = 'insolvency' } = {}) {
        const t = await DB.get('teams', teamId, { force: true }).catch(() => null);
        if (!t || t.ownerUid) return;
        const contracts = (await DB.contracts({ force: true }).catch(() => []))
            .filter(c => c.teamId === teamId && c.status === 'active');
        for (const c of contracts) {
            if (c.type === 'sponsorship') {
                await DB.update('contracts', c.id, { status: 'ended', endedAt: Util.todayISO() }).catch(() => {});
                continue;
            }
            try { await Hub._freeDriver(c.personId, c.personUid, 'released', c.id); }
            catch (e) { await DB.update('contracts', c.id, { status: 'released', endedAt: Util.todayISO() }).catch(() => {}); }
        }
        const staff = (await DB.staff({ force: true }).catch(() => [])).filter(s => s.teamId === teamId);
        for (const s of staff) await DB.update('staff', s.id, { teamId: null }).catch(() => {});

        await DB.update('teams', teamId, {
            financialState: 'repossessed', repossessedAt: Util.todayISO(), repossessedRaces: 0,
            recruiting: false, insolventAt: null, insolventRaces: 0
        });
        News.post('🏦', `${t.name} (AI) enters league receivership (${reason}) — a consortium takeover fires after ${this.CONSORTIUM_GRACE_RACES} more races.`);
    },

    /* ---------------- Consortium takeover ---------------- */
    // New (simulated) ownership: residual debt written off, marketValue and
    // tier recomputed from current prestige, and a baseline tier budget
    // injected — both movements are explicit ledger rows, no ghost money.
    async consortiumTakeover(teamId, { forced = false } = {}) {
        const t = await DB.get('teams', teamId, { force: true }).catch(() => null);
        if (!t) throw new Error('Team not found.');
        if (t.ownerUid) throw new Error(`${t.name} is player-owned — consortium bailouts are for AI teams.`);
        const world = await DB.loadWorld(true);
        const debt = Number(t.budget) || 0;
        if (debt < 0) await Wallet.adjustTeamWallet(teamId, -debt, '🏦', `Debt written off — consortium takeover${forced ? ' (GM-forced)' : ''}`);

        // Baseline identity: tier + marketValue from CURRENT prestige, then
        // the tier's standard operating budget lands in the wallet.
        await DB.update('teams', teamId, {
            financialState: 'solvent', repossessedAt: null, repossessedRaces: 0,
            insolventAt: null, insolventRaces: 0, marketValue: null, tier: null
        });
        const fresh = await DB.get('teams', teamId, { force: true });
        const priced = await Wallet.backfillMarketValue({ ...fresh }, world);
        const baseline = (Wallet.TEAM_DIFFICULTIES[priced.tier] || Wallet.TEAM_DIFFICULTIES.medium).teamStart;
        await Wallet.adjustTeamWallet(teamId, baseline, '🏦', `Consortium baseline funding (${priced.tier} tier)${forced ? ' — GM-forced' : ''}`);

        News.post('🏦', `${t.name} taken over by a new consortium${forced ? ' (league-brokered)' : ''} — debts cleared, ${Economy.fmt(baseline)} operating budget, back on the grid.`);
        return { debtCleared: Math.abs(Math.min(0, debt)), baseline, tier: priced.tier, marketValue: priced.marketValue };
    },

    /* ---------------- Per-race sweep ---------------- */
    // Called from Sim.payoutRace after settlement: advances receivership
    // fuses (repossessed teams don't race, so the touched-team evaluation
    // never reaches them) and refreshes the human-economy anchor.
    async raceTick(world) {
        for (const t of this.aiTeams(world).filter(t => t.financialState === 'repossessed')) {
            const races = (Number(t.repossessedRaces) || 0) + 1;
            if (races >= this.CONSORTIUM_GRACE_RACES) {
                try { await this.consortiumTakeover(t.id); } catch (e) { console.warn('Consortium takeover failed:', e); }
            } else {
                await DB.update('teams', t.id, { repossessedRaces: races }).catch(() => {});
            }
        }
        try { await this.refreshAnchor(await DB.loadWorld(true)); } catch (e) { console.warn('Anchor refresh failed:', e); }
    },

    /* ============================================================
       4. GM Financial Oversight Dashboard (Admin → 🏦 AI Finance)
       Flat 2D panels + race-rows, 🏁 checkered markers throughout.
       ============================================================ */
    _stateBadge(t) {
        if (t.financialState === 'repossessed')
            return `<span class="badge badge-dim">🏦 Receivership · takeover in ${Math.max(0, this.CONSORTIUM_GRACE_RACES - (Number(t.repossessedRaces) || 0))} races</span>`;
        if (t.financialState === 'insolvent')
            return `<span class="badge" style="background:var(--bad);color:#fff">🧯 Insolvent${t.insolventRaces ? ` · ${t.insolventRaces}/${Insolvency.REPO_GRACE_RACES} races underwater` : ''}</span>`;
        return '<span class="badge badge-green">✅ Solvent</span>';
    },

    async adminPanel(el) {
        const [world, cfg] = await Promise.all([DB.loadWorld(true), this.config()]);
        const ais = this.aiTeams(world)
            .map(t => ({ ...t, stars: Prestige.teamStars(t.id, world) }))
            .sort((a, b) => (Number(b.budget) || 0) - (Number(a.budget) || 0));
        // Nominal payout preview: a typical (tier ×1.25) field at current knobs.
        const est = (t) => Math.round(this.SPONSOR_BASE * Prestige.multiplier(t.stars) * 1.25
            * (cfg.anchorMultiplier || 1) * (cfg.globalMultiplier || 1) / 10) * 10;

        const rows = ais.map(t => `
            <div class="race-row" style="${t.financialState === 'repossessed' ? 'opacity:.6' : ''}">
                <div class="driver-hero-num" style="font-size:1rem;min-width:2.4rem;height:2.4rem">🏁</div>
                <div class="race-row-main">
                    <span class="race-title">${Util.esc(t.name)} ${Prestige.chip(t.stars)} ${this._stateBadge(t)}</span>
                    <span class="race-sub">🏁 Budget <strong style="color:${(Number(t.budget) || 0) < 0 ? 'var(--bad)' : 'var(--good)'}">${Economy.fmt(Number(t.budget) || 0)}</strong>
                        · 🏁 Consortium sponsorship ≈ ${Economy.fmt(est(t))}/race
                        · 🏁 ${Util.esc(t.tier || 'untiered')}${Number.isFinite(t.marketValue) ? ` · 🏁 Market value ${Economy.fmt(t.marketValue)}` : ''}</span>
                </div>
                <div class="btn-row">
                    <button class="btn btn-secondary btn-sm" onclick="Parity.gmAdjust('${Util.attr(t.id)}')">💵 Adjust</button>
                    <button class="btn btn-ghost btn-sm" onclick="Parity.gmForceConsortium('${Util.attr(t.id)}')">🏦 Consortium</button>
                </div>
            </div>`).join('');

        el.innerHTML = `
        <section class="panel" style="margin-bottom:1.1rem">
            <div class="panel-head"><h2>🏦 AI Financial Parity</h2>
                <span class="chip chip-dim">🏁 anchor updated ${cfg.updatedAt ? Util.esc(Util.fmtDateShort(cfg.updatedAt)) : 'never'}</span></div>
            <div class="chip-row" style="margin-bottom:.7rem">
                <span class="chip chip-dim">🏁 Human median ${Economy.fmt(cfg.humanMedian)}</span>
                <span class="chip chip-dim">🏁 AI median ${Economy.fmt(cfg.aiMedian)}</span>
                <span class="chip chip-dim">🏁 Anchor ×${cfg.anchorMultiplier}</span>
                <span class="chip chip-dim">🏁 Global ×${cfg.globalMultiplier}</span>
            </div>
            <form id="parity-cfg-form" class="form-row" style="align-items:flex-end;gap:.6rem">
                <label class="field" style="max-width:14rem"><span>🏁 Global AI economy multiplier</span>
                    <input id="parity-global" class="input" type="number" min="0" max="5" step="0.05" value="${Number(cfg.globalMultiplier) || 1}"></label>
                <button type="submit" class="btn btn-primary btn-sm">Save 🏁</button>
                <button type="button" id="parity-anchor-btn" class="btn btn-secondary btn-sm">🏁 Recalculate anchor now</button>
            </form>
            <ul class="checkered-list" style="margin-top:.8rem">
                <li>AI sponsorship per race = ${Economy.fmt(this.SPONSOR_BASE)} × prestige multiplier × field strength (×1.0–×1.5) × anchor × global.</li>
                <li>The anchor chases the human-team median budget (capped ×${this.ANCHOR_MAX}) so AI teams can keep bidding on top free agents.</li>
                <li>Every AI movement is a real team-wallet write with a paired ledger row — no ghost money anywhere.</li>
                <li>Broke AI teams liquidate instantly, sit ${this.CONSORTIUM_GRACE_RACES} races in receivership, then a consortium clears the debt and refunds a baseline budget.</li>
            </ul>
        </section>
        <section class="panel">
            <div class="panel-head"><h2>🏁 AI Teams (${ais.length})</h2></div>
            ${rows || C.empty('🏦', 'No AI teams on the grid', 'Unowned teams (no player owner) are the CPU competitors this system funds. Seed a world from Admin → World.')}
        </section>`;

        Util.$('#parity-cfg-form', el)?.addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const v = Math.max(0, Math.min(5, Number(Util.$('#parity-global').value) || 1));
                await this.saveConfig({ ...(await this.config()), globalMultiplier: v });
                Util.notify(`Global AI economy multiplier set to ×${v}. 🏁`);
                Admin.refresh();
            } catch (err) { Util.notify(err.message, 'error'); }
        });
        Util.$('#parity-anchor-btn', el)?.addEventListener('click', async () => {
            try {
                const a = await this.refreshAnchor(await DB.loadWorld(true));
                Util.notify(`Anchor recalculated: human median ${Economy.fmt(a.humanMedian)} → ×${a.anchorMultiplier}. 🏁`);
                Admin.refresh();
            } catch (err) { Util.notify(err.message, 'error'); }
        });
    },

    /* ---------------- GM overrides ---------------- */
    async gmAdjust(teamId) {
        if (!Admin.guard()) return;
        const t = await DB.get('teams', teamId, { force: true });
        if (!t) return;
        const raw = prompt(`Adjust ${t.name}'s budget by (± amount). Current: ${Economy.fmt(Number(t.budget) || 0)}`, '10000');
        const delta = Math.round(Number(raw));
        if (!raw || !Number.isFinite(delta) || !delta) return;
        try {
            await Wallet.adjustTeamWallet(teamId, delta, '🏛️', `GM budget adjustment (AI parity)`);
            await Insolvency.evaluate(teamId);
            Util.notify(`${t.name} budget ${delta > 0 ? '+' : ''}${Economy.fmt(Math.abs(delta)).replace('$', delta > 0 ? '$' : '−$')} — ledger row written. 🏁`);
            Admin.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    async gmForceConsortium(teamId) {
        if (!Admin.guard()) return;
        const t = await DB.get('teams', teamId, { force: true });
        if (!t) return;
        if (!confirm(`Force a consortium takeover of ${t.name}? Debt is written off and a baseline tier budget is injected (both as ledger rows).`)) return;
        try {
            const r = await this.consortiumTakeover(teamId, { forced: true });
            Util.notify(`${t.name}: ${r.debtCleared ? Economy.fmt(r.debtCleared) + ' debt cleared, ' : ''}${Economy.fmt(r.baseline)} baseline injected (${r.tier}). 🏦`);
            Admin.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    }
};
window.Parity = Parity;
