/* ============================================================
   Phoenix SRMPC — Contract performance clauses
   Pure evaluation engine for the advanced-contract system
   (RECRUITMENT_CONTRACTS_DESIGN.md). No function here moves
   money or writes documents — Sim.payoutRace settles per-race
   clauses and Admin.closeSeason settles championship bonuses
   and termination stipulations.

   Prestige gates what a team may demand; anti-laundering caps
   keep bonus money from smuggling pay past the prestige pay cap.
   Missing telemetry (incidents / laps) NEVER hurts anyone: a
   clause whose input is absent simply doesn't fire.
   ============================================================ */
'use strict';

const Clauses = {
    /* ---------------- Prestige gating ---------------- */
    // What a team of a given star level may put in a contract.
    // Termination clauses are driver-only — you can't fire a mechanic
    // for the car's finishing record they don't drive.
    gate(teamStars) {
        return {
            bonuses: true,                                  // every team may offer bonuses
            championship: teamStars >= 3,
            minAvgFinish: teamStars >= 3 ? (teamStars >= 5 ? 5 : teamStars >= 4 ? 8 : 10) : null, // tightest position allowed
            minWins: teamStars >= 4 ? (teamStars >= 5 ? 5 : 2) : null                             // most wins demandable
        };
    },

    // Anti-laundering caps relative to the per-race salary.
    MAX_SINGLE_MULT: 2,     // any one clause ≤ 2× salary
    MAX_PER_RACE_MULT: 5,   // worst-case single-race clause total ≤ 5× salary
    MAX_CHAMP_MULT: 25,     // any championship tier ≤ 25× salary
    MIN_AVG_STARTS: 5,      // avg-finish clauses need a fair sample

    // Best-case payout of one race (win + best finish tier + every event bonus).
    worstCasePerRace(c) {
        if (!c) return 0;
        const bestTier = (c.finishBonus || []).reduce((m, t) => Math.max(m, Number(t.amount) || 0), 0);
        return (Number(c.winBonus) || 0) + bestTier + (Number(c.poleBonus) || 0)
            + (Number(c.fastestLapBonus) || 0) + (Number(c.mostLapsLedBonus) || 0)
            + (Number(c.cleanRaceBonus) || 0) + (Number(c.fullDistanceBonus) || 0);
    },

    // Throws with the broken rule; returns the normalized sheet (or null).
    validate(clauses, { teamStars, salary, personKind = 'driver', agreement = 'contracted' }) {
        const c = this.normalize(clauses);
        if (!c) return null;
        const gate = this.gate(teamStars);
        const capSingle = salary * this.MAX_SINGLE_MULT;

        if ((c.minWins || c.minAvgFinish) && personKind !== 'driver')
            throw new Error('Termination clauses (wins / average finish) only apply to driver contracts.');
        if ((c.minWins || c.minAvgFinish) && agreement === 'open')
            throw new Error('An open agreement is a handshake — it cannot carry termination clauses.');
        if (c.minWins) {
            if (!gate.minWins) throw new Error(`League rule: only 4★+ teams may demand mandatory wins (this team is ${Prestige.stars(teamStars)}).`);
            if (c.minWins.count > gate.minWins) throw new Error(`League rule: a ${Prestige.stars(teamStars)} team may demand at most ${gate.minWins} wins per season.`);
        }
        if (c.minAvgFinish) {
            if (!gate.minAvgFinish) throw new Error(`League rule: only 3★+ teams may set average-finish requirements (this team is ${Prestige.stars(teamStars)}).`);
            if (c.minAvgFinish.position < gate.minAvgFinish) throw new Error(`League rule: a ${Prestige.stars(teamStars)} team may require at best an average of P${gate.minAvgFinish}.`);
        }
        if (c.championshipBonus?.length && !gate.championship)
            throw new Error(`League rule: championship bonuses need a 3★+ team (this team is ${Prestige.stars(teamStars)}).`);

        const singles = [c.winBonus, c.poleBonus, c.fastestLapBonus, c.mostLapsLedBonus,
            c.cleanRaceBonus, c.fullDistanceBonus, ...(c.finishBonus || []).map(t => t.amount)];
        if (singles.some(a => (Number(a) || 0) > capSingle))
            throw new Error(`Clause too rich: no single bonus may exceed 2× salary (${Economy.fmt(capSingle)}).`);
        if (this.worstCasePerRace(c) > salary * this.MAX_PER_RACE_MULT)
            throw new Error(`Clause sheet too rich: a perfect race would pay over 5× salary (${Economy.fmt(salary * this.MAX_PER_RACE_MULT)}) — trim the bonuses.`);
        if ((c.championshipBonus || []).some(t => (Number(t.amount) || 0) > salary * this.MAX_CHAMP_MULT))
            throw new Error(`Championship bonus too rich: tiers are capped at 25× salary (${Economy.fmt(salary * this.MAX_CHAMP_MULT)}).`);
        return c;
    },

    // Strip zeros/empties; null when nothing remains.
    normalize(c) {
        if (!c) return null;
        const num = (v) => { const n = Math.round(Number(v) || 0); return n > 0 ? n : 0; };
        const out = {};
        ['winBonus', 'poleBonus', 'fastestLapBonus', 'mostLapsLedBonus', 'cleanRaceBonus', 'fullDistanceBonus']
            .forEach(k => { if (num(c[k])) out[k] = num(c[k]); });
        const tiers = (c.finishBonus || []).map(t => ({ atOrBetter: Number(t.atOrBetter), amount: num(t.amount) }))
            .filter(t => t.amount && t.atOrBetter >= 1);
        if (tiers.length) out.finishBonus = tiers.sort((a, b) => a.atOrBetter - b.atOrBetter);
        const champ = (c.championshipBonus || []).map(t => ({ rank: Number(t.rank), amount: num(t.amount) }))
            .filter(t => t.amount && t.rank >= 1);
        if (champ.length) out.championshipBonus = champ.sort((a, b) => a.rank - b.rank);
        if (c.minWins && Number(c.minWins.count) >= 1) out.minWins = { count: Math.round(Number(c.minWins.count)) };
        if (c.minAvgFinish && Number(c.minAvgFinish.position) >= 1) {
            out.minAvgFinish = { position: Math.round(Number(c.minAvgFinish.position)), minStarts: Math.max(this.MIN_AVG_STARTS, Math.round(Number(c.minAvgFinish.minStarts) || 0)) };
        }
        return Object.keys(out).length ? out : null;
    },

    /* ---------------- Per-race evaluation (pure) ---------------- */
    // One driver result → [{ id, label, amount }]. Missing telemetry ⇒ skip.
    forRace(contract, race, result) {
        const c = contract.clauses;
        if (!c || !result) return [];
        const out = [];
        const pos = result.dnf ? null : (Number(result.position) || null);
        if (c.winBonus && pos === 1) out.push({ id: 'win', label: 'Race win', amount: c.winBonus });
        if (Array.isArray(c.finishBonus) && pos) {
            const tier = c.finishBonus.find(t => pos <= t.atOrBetter); // sorted → best tier first
            if (tier) out.push({ id: 'finish' + tier.atOrBetter, label: `Top ${tier.atOrBetter} finish (P${pos})`, amount: tier.amount });
        }
        if (c.poleBonus && result.pole) out.push({ id: 'pole', label: 'Pole position', amount: c.poleBonus });
        if (c.fastestLapBonus && result.fastestLap) out.push({ id: 'flap', label: 'Fastest lap', amount: c.fastestLapBonus });
        if (c.mostLapsLedBonus && Number(result.lapsLed) > 0) {
            const most = Math.max(...(race.results || []).map(r => Number(r.lapsLed) || 0));
            if (Number(result.lapsLed) === most) out.push({ id: 'led', label: 'Most laps led', amount: c.mostLapsLedBonus });
        }
        if (c.cleanRaceBonus && result.incidents === 0) out.push({ id: 'clean', label: 'Clean race (0 incidents)', amount: c.cleanRaceBonus });
        if (c.fullDistanceBonus && Number(race.laps) > 0 && Number(result.lapsCompleted) >= Number(race.laps)) {
            out.push({ id: 'fulldist', label: '100% race distance', amount: c.fullDistanceBonus });
        }
        return out;
    },

    // Staff clauses ride the TEAM's best-finishing car in that race.
    forRaceStaff(contract, race, world) {
        const best = (race.results || [])
            .filter(r => world.driversById[r.driverId]?.teamId === contract.teamId && !r.dnf && Number(r.position))
            .sort((a, b) => Number(a.position) - Number(b.position))[0];
        return best ? this.forRace(contract, race, best) : [];
    },

    /* ---------------- Season-to-date termination check (pure) ---------------- */
    // Computed live from race results (no stored aggregates → no drift).
    // seasonId filters to one crowned season; otherwise the contract's year.
    seasonCheck(contract, races, world, { seasonId = null } = {}) {
        const c = contract.clauses;
        if (!c || (!c.minWins && !c.minAvgFinish)) return { breaches: [], row: null };
        const pool = seasonId
            ? races.filter(r => r.seasonId === seasonId)
            : races.filter(r => (r.date || '').startsWith(String(contract.seasonYear || '')));
        const row = Stats.driverTable(pool, world).find(r => r.driverId === contract.personId) || null;
        const breaches = [];
        if (c.minWins && (row?.wins || 0) < c.minWins.count) {
            breaches.push({ clause: 'minWins', detail: `${row?.wins || 0} of ${c.minWins.count} required wins` });
        }
        if (c.minAvgFinish && row && row.finishCount >= (c.minAvgFinish.minStarts || this.MIN_AVG_STARTS)
            && row.avgFinish > c.minAvgFinish.position) {
            breaches.push({ clause: 'minAvgFinish', detail: `average P${row.avgFinish.toFixed(1)} vs required P${c.minAvgFinish.position}` });
        }
        return { breaches, row };
    },

    /* ---------------- Championship bonus from a crowned season ---------------- */
    championship(contract, seasonSnapshot) {
        const tiers = contract.clauses?.championshipBonus || [];
        if (!tiers.length) return null;
        const entry = (seasonSnapshot.standingsArchive || []).find(d => d.driverId === contract.personId);
        if (!entry) return null;
        const tier = tiers.find(t => entry.rank <= t.rank); // sorted → best tier first
        return tier ? { rank: entry.rank, amount: tier.amount, label: `Championship P${entry.rank}` } : null;
    },

    /* ---------------- Human-readable summary (deal rooms, contract lists) ---------------- */
    summary(c) {
        if (!c) return '';
        const p = [];
        if (c.minWins) p.push(`⚠️ ${c.minWins.count}+ wins required`);
        if (c.minAvgFinish) p.push(`⚠️ avg finish ≤ P${c.minAvgFinish.position}`);
        if (c.winBonus) p.push(`win ${Economy.fmt(c.winBonus)}`);
        (c.finishBonus || []).forEach(t => p.push(`top ${t.atOrBetter} ${Economy.fmt(t.amount)}`));
        if (c.poleBonus) p.push(`pole ${Economy.fmt(c.poleBonus)}`);
        if (c.fastestLapBonus) p.push(`fastest lap ${Economy.fmt(c.fastestLapBonus)}`);
        if (c.mostLapsLedBonus) p.push(`most laps led ${Economy.fmt(c.mostLapsLedBonus)}`);
        if (c.cleanRaceBonus) p.push(`clean race ${Economy.fmt(c.cleanRaceBonus)}`);
        if (c.fullDistanceBonus) p.push(`full distance ${Economy.fmt(c.fullDistanceBonus)}`);
        (c.championshipBonus || []).forEach(t => p.push(`champ. P${t.rank} ${Economy.fmt(t.amount)}`));
        return p.join(' · ');
    },

    /* ---------------- Offer-form section (shared by all offer/terms modals) ---------------- */
    // Renders agreement type + sign-on bonus + the clause sheet, gated live by
    // the offering team's prestige. Read back with Clauses.readForm().
    // `current` (optional): { agreement, signOnBonus, clauses } to pre-fill — used
    // when countering an existing negotiation so the sheet isn't silently wiped
    // (blank fields would read back as "no clauses" via readForm()) and the
    // section opens expanded so the terms are visible, not buried in <details>.
    formSection({ teamStars, salary, personKind = 'driver', current = null }) {
        const gate = this.gate(teamStars);
        const c = current?.clauses || {};
        const num = (id, label, v, ph = '0') => `
            <label class="field"><span>${label}</span>
                <input id="cl-${id}" class="input" type="number" min="0" step="10" placeholder="${ph}" value="${v || ''}"></label>`;
        const tierAmt = (n) => (c.finishBonus || []).find(t => t.atOrBetter === n)?.amount;
        const champAmt = (n) => (c.championshipBonus || []).find(t => t.rank === n)?.amount;
        return `
        <details class="clause-sheet"${current ? ' open' : ''}>
            <summary>📜 Advanced terms & performance clauses <span class="chip chip-dim">team ${Prestige.stars(teamStars)}</span></summary>
            <div class="form-grid" style="margin-top:.6rem">
                <div class="form-row">
                    <label class="field"><span>Agreement type</span>
                        <select id="cl-agreement" class="input">
                            <option value="contracted"${current?.agreement !== 'open' ? ' selected' : ''}>🔒 Contracted — buyout clause on exit</option>
                            <option value="open"${current?.agreement === 'open' ? ' selected' : ''}>🤝 Open agreement — leave anytime, no buyout</option>
                        </select></label>
                    <label class="field"><span>Sign-on bonus (paid once at signing)</span>
                        <input id="cl-signon" class="input" type="number" min="0" step="10" placeholder="default: one race of salary" value="${current && Number.isFinite(current.signOnBonus) ? current.signOnBonus : ''}"></label>
                </div>
                <p class="section-label" style="margin:0">💰 Per-race bonuses (owner pays when it happens)</p>
                <div class="form-row">${num('win', '🏆 Race win', c.winBonus)}${num('top3', '🥉 Top 3', tierAmt(3))}${num('top5', 'Top 5', tierAmt(5))}${num('top10', 'Top 10', tierAmt(10))}</div>
                <div class="form-row">${num('pole', '🅿️ Pole position', c.poleBonus)}${num('flap', '⚡ Fastest lap', c.fastestLapBonus)}${num('led', '🔁 Most laps led', c.mostLapsLedBonus)}</div>
                <div class="form-row">${num('clean', '🧼 Clean race (0 incidents)', c.cleanRaceBonus)}${num('fulldist', '🏁 100% distance', c.fullDistanceBonus)}</div>
                <p class="section-label" style="margin:0">🏆 Championship bonuses (paid when the season is crowned)</p>
                <div class="form-row">${num('champ1', 'Champion (P1)', champAmt(1))}${num('champ3', 'Top 3 overall', champAmt(3))}${num('champ10', 'Top 10 overall', champAmt(10))}</div>
                ${personKind === 'driver' && (gate.minWins || gate.minAvgFinish) ? `
                    <p class="section-label" style="margin:0">⚠️ Termination stipulations — breach at season close ends the contract for cause</p>
                    <div class="form-row">
                        ${gate.minWins ? `<label class="field"><span>Mandatory wins per season (max ${gate.minWins})</span>
                            <input id="cl-minwins" class="input" type="number" min="0" max="${gate.minWins}" placeholder="0 = none" value="${c.minWins?.count || ''}"></label>` : ''}
                        ${gate.minAvgFinish ? `<label class="field"><span>Required avg finish (best allowed: P${gate.minAvgFinish}, min ${this.MIN_AVG_STARTS} starts)</span>
                            <input id="cl-avgfinish" class="input" type="number" min="${gate.minAvgFinish}" max="30" placeholder="blank = none" value="${c.minAvgFinish?.position || ''}"></label>` : ''}
                    </div>` : `<p class="muted small">⚠️ Termination stipulations unlock at 3★ team prestige${personKind !== 'driver' ? ' and apply to driver contracts only' : ''}.</p>`}
                <p class="muted small">League caps: one bonus ≤ 2× salary, a perfect race ≤ 5× salary, championship tiers ≤ 25× salary.
                    Bonuses settle per race through the ledger — never upfront. Open agreements can't carry termination clauses.</p>
            </div>
        </details>`;
    },

    // Reads the section back → { agreement, signOnBonus, clauses }.
    readForm() {
        const v = (id) => { const el = Util.$('#cl-' + id); return el ? Math.round(Number(el.value) || 0) : 0; };
        const signonRaw = Util.$('#cl-signon')?.value;
        const clauses = this.normalize({
            winBonus: v('win'), poleBonus: v('pole'), fastestLapBonus: v('flap'),
            mostLapsLedBonus: v('led'), cleanRaceBonus: v('clean'), fullDistanceBonus: v('fulldist'),
            finishBonus: [
                { atOrBetter: 3, amount: v('top3') }, { atOrBetter: 5, amount: v('top5') }, { atOrBetter: 10, amount: v('top10') }
            ],
            championshipBonus: [
                { rank: 1, amount: v('champ1') }, { rank: 3, amount: v('champ3') }, { rank: 10, amount: v('champ10') }
            ],
            minWins: v('minwins') ? { count: v('minwins') } : null,
            minAvgFinish: v('avgfinish') ? { position: v('avgfinish') } : null
        });
        return {
            agreement: Util.$('#cl-agreement')?.value === 'open' ? 'open' : 'contracted',
            signOnBonus: signonRaw === '' || signonRaw === undefined ? null : Math.max(0, Math.round(Number(signonRaw) || 0)),
            clauses
        };
    }
};
window.Clauses = Clauses;
