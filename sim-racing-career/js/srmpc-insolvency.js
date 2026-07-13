/* ============================================================
   Phoenix SRMPC — Team Bankruptcy, Asset Liquidation & Repossession

   A two-phase penalty protocol layered on top of the isolated Team
   Wallet (teams/{id}.budget — see js/srmpc-wallet.js):

   • Phase 1 — INSOLVENCY: when a team's budget hits ≤ $0 it is flagged
     `financialState:'insolvent'`. An insolvent team is frozen from
     extending new offers or acquiring talent (Deals.start guard). The
     owner raises capital by injecting personal funds or selling garage
     cars INTO the team, or by racing (prize share + sponsor income land
     in the team wallet). Personal wallets are never at risk — the strict
     isolation rules hold throughout.

   • Phase 2 — REPOSSESSION: if the team can't recover (budget ≤
     REPO_BALANCE, or underwater past REPO_GRACE_RACES completed races)
     the league repossesses it: every active contract is nullified to an
     open, buyout-free agreement; the residual debt is written off; the
     owner is stripped (personal wallet untouched); marketValue is
     recomputed and the team is relisted on the Team Marketplace.

   State lives on the team doc: financialState / insolventAt /
   insolventRaces. The evaluation is a pure transition driven off the
   post-race ledger settlement (Sim.payoutRace) and any owner capital move.

   NOTE (number surrender): "surrender car numbers to the auction pool for
   a refund" is a designed-but-unbuilt lever — the Series Number registry
   (CAR_NUMBER_REGISTRY_DESIGN.md) is not implemented. The hook below
   (numbersAvailable / the liquidation modal) lights up automatically once
   a `Numbers` module exposes surrenderForTeam(); until then it's hidden.
   ============================================================ */
'use strict';

const Insolvency = {
    REPO_BALANCE: -25000,   // massive negative → instant repossession
    REPO_GRACE_RACES: 3,    // completed races allowed underwater before auto-repossession

    isInsolvent(team) { return team?.financialState === 'insolvent'; },

    /* ---------------- State machine ---------------- */
    // Pure transition on ONE owned team, run after any team-budget change.
    // raceCompleted advances the grace fuse (only completed races count).
    async evaluate(teamId, { raceCompleted = false } = {}) {
        const t = await DB.get('teams', teamId, { force: true }).catch(() => null);
        // Only player-owned, non-repossessed teams have a solvency state — an
        // unowned marketplace team can't go bankrupt.
        if (!t || !t.ownerUid || t.financialState === 'repossessed') return;
        const budget = Number(t.budget) || 0;

        if (budget > 0) {
            if (t.financialState === 'insolvent') {
                await DB.update('teams', teamId, { financialState: 'solvent', insolventAt: null, insolventRaces: 0 });
                News.post('✅', `${t.name} is solvent again — the hiring freeze is lifted.`);
            }
            return;
        }

        const racesUnderwater = (Number(t.insolventRaces) || 0) + (raceCompleted ? 1 : 0);
        if (budget <= this.REPO_BALANCE || racesUnderwater > this.REPO_GRACE_RACES) {
            return this.repossess(teamId, { reason: budget <= this.REPO_BALANCE ? 'critical debt' : 'unresolved insolvency' });
        }

        if (t.financialState !== 'insolvent') {
            await DB.update('teams', teamId, { financialState: 'insolvent', insolventAt: Util.todayISO(), insolventRaces: racesUnderwater });
            News.post('🧯', `${t.name} is INSOLVENT (${Economy.fmt(budget)}). Liquidate assets or face repossession.`);
        } else if (raceCompleted) {
            await DB.update('teams', teamId, { insolventRaces: racesUnderwater });
        }
    },

    // Guard used at every "team spends / acquires" entry point.
    async assertSolvent(teamId) {
        if (!teamId) return;
        const t = await DB.get('teams', teamId).catch(() => null);
        if (t?.financialState === 'insolvent') {
            throw new Error(`${t.name} is insolvent — clear the debt before extending offers or acquiring talent.`);
        }
    },

    /* ---------------- Phase 1: liquidation / capital ---------------- */
    // Owner → team. Personal→team is an allowed cross-wallet transfer, so the
    // isolation invariant holds; the primitive writes the paired ledger rows.
    async injectOwnerFunds(teamId, amount) {
        amount = Math.round(Number(amount) || 0);
        if (amount <= 0) throw new Error('Enter an amount above zero.');
        if (Economy.balance() < amount) throw new Error(`Not enough personal funds — you have ${Economy.fmt(Economy.balance())}.`);
        await Wallet.executeRoleTransaction({
            from: { type: 'player', id: Auth.uid() }, to: { type: 'team', id: teamId },
            amount, icon: '🏁',
            fromLabel: 'Capital injected into team', toLabel: 'Owner capital injection'
        });
        await this.evaluate(teamId);
        return amount;
    },

    // Sell a garage car (a PERSONAL asset) and route the depreciated proceeds
    // into the TEAM wallet. Reuses Market.SELL_RATIO (60%).
    async liquidateCar(teamId, carId) {
        const cars = Market.myGarage();
        const car = cars.find(c => c.id === carId);
        if (!car) throw new Error('That car is no longer in your garage.');
        const value = Math.round((Number(car.price) || 0) * Market.SELL_RATIO);
        await Auth.updateProfile({ garage: cars.filter(c => c.id !== carId) });
        await Wallet.adjustTeamWallet(teamId, value, '🏁', `Liquidated ${car.name} into the team (${Math.round(Market.SELL_RATIO * 100)}%)`);
        await this.evaluate(teamId);
        return value;
    },

    // Number surrender — active only once a Numbers registry exists.
    numbersAvailable() { return !!(window.Numbers && typeof Numbers.surrenderForTeam === 'function'); },

    /* ---------------- Phase 2: repossession ---------------- */
    async repossess(teamId, { reason = 'insolvency' } = {}) {
        const t = await DB.get('teams', teamId, { force: true }).catch(() => null);
        if (!t) return;
        const world = await DB.loadWorld(true);
        const exOwner = t.ownerUid;

        // 1. Nullify active contracts → open, buyout-free agreement.
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
        // Non-player staff attached to the team are cut loose too.
        const staff = (await DB.staff({ force: true }).catch(() => [])).filter(s => s.teamId === teamId);
        for (const s of staff) await DB.update('staff', s.id, { teamId: null }).catch(() => {});

        // 2. League writes off residual debt, strips ownership, recomputes price,
        //    relists on the marketplace (ownerUid:null + isEstablished:true).
        const debt = Number(t.budget) || 0;
        if (debt < 0) await Wallet.adjustTeamWallet(teamId, -debt, '🧯', `Debt written off on repossession (${reason})`);
        await DB.update('teams', teamId, {
            ownerUid: null, isEstablished: true, recruiting: false,
            financialState: 'solvent', insolventAt: null, insolventRaces: 0,
            marketValue: null, tier: null
        });
        const fresh = await DB.get('teams', teamId, { force: true });
        if (fresh) await Wallet.backfillMarketValue({ ...fresh }, world); // recompute marketValue + tier

        // 3. Strip the ex-owner. Their personal wallet is NEVER touched.
        if (exOwner) {
            const owner = await DB.get('users', exOwner).catch(() => null);
            if (owner?.teamId === teamId) {
                if (exOwner === Auth.uid()) await Auth.updateProfile({ teamId: null });
                else await DB.update('users', exOwner, { teamId: null }).catch(() => {});
            }
        }
        News.post('🏦', `${t.name} REPOSSESSED (${reason}). Drivers freed without penalty; the team is back on the market.`);
        Util.notify(`${t.name} was repossessed — it's back on the marketplace.`, 'error');
        if (typeof App !== 'undefined' && App.current?.view === 'career') App.go('career');
    },

    /* ---------------- UI: flat 2D, checkered-flag bullets ---------------- */
    warningPanel(team) {
        const budget = Number(team.budget) || 0;
        return `<section class="panel panel-alert">
            <div class="panel-head"><h2>🧯 ${Util.esc(team.name)} is Insolvent</h2>
                <span class="chip" style="color:var(--bad)">${Economy.fmt(budget)}</span></div>
            <p class="muted">The team budget is underwater. New hires are frozen until the debt clears. Raise capital by:</p>
            <ul class="checkered-list">
                <li>Injecting your personal funds into the team</li>
                <li>Selling a car from your garage into the team (${Math.round(Market.SELL_RATIO * 100)}% of value)</li>
                <li>Racing — prize share &amp; sponsor income land in the team wallet</li>
            </ul>
            <p class="muted small">Stay underwater past ${this.REPO_GRACE_RACES} races, or hit ${Economy.fmt(this.REPO_BALANCE)}, and the league repossesses the team — your personal wallet is never touched.</p>
            <div class="btn-row"><button class="btn btn-primary btn-sm" onclick="Insolvency.liquidationModal('${Util.attr(team.id)}')">🏁 Raise Capital</button></div>
        </section>`;
    },

    async liquidationModal(teamId) {
        const team = await DB.get('teams', teamId, { force: true });
        const cars = Market.myGarage();
        const owed = Math.abs(Math.min(0, Number(team.budget) || 0));
        Modal.open(`
            ${Modal.header('🏁 Raise Capital', `${Util.esc(team.name)} owes ${Economy.fmt(owed)}. Clear it to lift the hiring freeze.`)}
            <form id="insolv-inject-form" class="form-grid">
                <label class="field"><span>Inject personal funds — you have ${Economy.fmt(Economy.balance())}</span>
                    <input id="insolv-amt" class="input" type="number" min="10" step="10" placeholder="Amount"></label>
                <button type="submit" class="btn btn-primary">Inject funds 🏁</button>
            </form>
            <hr class="sep">
            <h3>Sell cars into the team</h3>
            ${cars.length ? `<ul class="checkered-list">${cars.map(c => `
                <li style="justify-content:space-between">
                    <span>${c.emoji || '🚗'} ${Util.esc(c.name)} — worth ${Economy.fmt(Math.round((Number(c.price) || 0) * Market.SELL_RATIO))}</span>
                    <button class="btn btn-ghost btn-sm" onclick="Insolvency._sell('${Util.attr(teamId)}','${Util.attr(c.id)}')">Sell in</button>
                </li>`).join('')}</ul>`
                : '<p class="muted small">No cars in your garage to sell.</p>'}
            ${this.numbersAvailable() ? `<hr class="sep"><h3>Surrender car numbers</h3>
                <p class="muted small">Return this team's owned car numbers to the auction pool for a partial refund.</p>
                <button class="btn btn-secondary btn-sm" onclick="Insolvency._surrenderNumbers('${Util.attr(teamId)}')">🔢 Surrender all numbers</button>` : ''}
            <div class="modal-actions"><button class="btn btn-ghost" onclick="Modal.close()">Close</button></div>`);
        document.getElementById('insolv-inject-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const v = await this.injectOwnerFunds(teamId, document.getElementById('insolv-amt').value);
                Modal.close(); Util.notify(`Injected ${Economy.fmt(v)} into the team. 🏁`); App.go('career');
            } catch (err) { Util.notify(err.message, 'error'); }
        });
    },

    async _sell(teamId, carId) {
        try {
            const v = await this.liquidateCar(teamId, carId);
            Modal.close(); Util.notify(`Sold into the team for ${Economy.fmt(v)}. 🏁`); App.go('career');
        } catch (err) { Util.notify(err.message, 'error'); }
    },

    async _surrenderNumbers(teamId) {
        try {
            const refunded = await Numbers.surrenderForTeam(teamId);
            await this.evaluate(teamId);
            Modal.close();
            Util.notify(refunded ? `Numbers surrendered — ${Economy.fmt(refunded)} refunded to the team. 🔢` : 'No owned numbers to surrender.');
            App.go('career');
        } catch (err) { Util.notify(err.message, 'error'); }
    }
};
window.Insolvency = Insolvency;
