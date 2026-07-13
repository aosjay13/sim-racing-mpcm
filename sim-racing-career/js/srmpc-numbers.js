/* ============================================================
   Phoenix SRMPC — Car Number Acquisition & Bidding

   Realistic, series-scoped car numbers. #24 in one series is a
   different asset from #24 in another (deterministic registry id
   `${seriesId}__${number}` guarantees it).

   Ownership: a TEAM charter (any driver in the seat runs the team's
   number) OR a DRIVER's personal brand number (5★+ only). When a
   number-owning driver signs with a number-owning team, the contract's
   `numberPreference` toggle resolves which one they run.

   Acquisition: blind sealed-bid auctions. Bids are recorded but not
   revealed; at the GM-run close the highest bid wins and is charged
   at that moment (charge-the-winner-at-close, cascading to the next
   bid if the top bidder can no longer pay). Money flows to the league
   sink through Wallet.executeRoleTransaction, so every bid deduction is
   ledger-paired automatically.

   Lifecycle at SEASON CLOSE ONLY (there is no backend cron — this runs
   inside Admin.closeSeason): a number fielded in zero races that season
   is revoked (use-it-or-lose-it); otherwise its owner gets a first-
   right-of-refusal renewal window (pay LEASE_FEE) before it goes to
   public auction.

   Bankruptcy integration: surrenderForTeam() is the lever
   Insolvency.numbersAvailable() waits for — an insolvent team can dump
   its numbers back to the pool for a partial refund.
   ============================================================ */
'use strict';

const Numbers = {
    MIN_FIELD_RACES: 1,      // must be fielded in ≥ this many races/season or it's revoked
    DRIVER_STAR_GATE: 5,     // only 5★ drivers may hold a personal number
    LEASE_FEE: 2000,         // first-right-of-refusal renewal fee
    SURRENDER_REFUND: 0.5,   // fraction of feePaid refunded on surrender

    regId(seriesId, number) { return `${seriesId}__${number}`; },
    seriesNumberMax(series) { return Math.min(999, Math.max(0, Number(series?.numberMax) || 99)); },

    async listForSeries(seriesId) {
        return (await DB.list('numberRegistry', { force: true }).catch(() => []))
            .filter(r => r.seriesId === seriesId);
    },

    /* ---------------- Auctions ---------------- */
    async openAuction(seriesId, number, seasonId = null) {
        const reg = await DB.get('numberRegistry', this.regId(seriesId, number), { force: true }).catch(() => null);
        if (reg && (reg.status === 'owned' || reg.status === 'retired')) {
            throw new Error(`#${number} is ${reg.status} — free it before auctioning.`);
        }
        const auctionId = 'auc_' + Util.uid();
        await DB.set('numberRegistry', this.regId(seriesId, number), {
            seriesId, number: Number(number), status: 'auction', auctionId, seasonId,
            ownerType: null, ownerId: null, ownerUid: null, leaseId: null
        });
        return auctionId;
    },

    // Blind bid — validated against the correct wallet but not revealed to rivals.
    async placeBid(seriesId, number, { bidderType, bidderId, bidderUid, amount }) {
        const reg = await DB.get('numberRegistry', this.regId(seriesId, number), { force: true }).catch(() => null);
        if (reg?.status !== 'auction') throw new Error('That number is not up for auction.');
        amount = Math.round(Number(amount) || 0);
        if (amount <= 0) throw new Error('Bid must be above zero.');

        if (bidderType === 'driver') {
            const stars = Prestige.driverStars(bidderId, await DB.loadWorld());
            if (stars < this.DRIVER_STAR_GATE) throw new Error(`Only ${this.DRIVER_STAR_GATE}★ drivers can hold a personal number.`);
        }
        const bal = bidderType === 'team' ? Wallet.teamBalance(bidderId) : Wallet.playerBalance(bidderUid);
        if (amount > bal) throw new Error(`Bid exceeds your ${bidderType} wallet (${Economy.fmt(bal)}).`);

        await DB.create('numberBids', {
            auctionId: reg.auctionId, seriesId, number: Number(number), seasonId: reg.seasonId,
            bidderType, bidderId, bidderUid: bidderUid || null, amount, status: 'pending'
        });
    },

    // GM/season-rollover close: highest sealed bid wins; charge at close, cascade
    // to the next bid if the top bidder can no longer cover it.
    async resolveAuction(seriesId, number) {
        const reg = await DB.get('numberRegistry', this.regId(seriesId, number), { force: true }).catch(() => null);
        if (reg?.status !== 'auction') return null;
        const bids = (await DB.list('numberBids', { force: true }).catch(() => []))
            .filter(b => b.auctionId === reg.auctionId && b.status === 'pending')
            .sort((a, b) => b.amount - a.amount || (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));

        for (const bid of bids) {
            const bal = bid.bidderType === 'team' ? Wallet.teamBalance(bid.bidderId) : Wallet.playerBalance(bid.bidderUid);
            if (bal < bid.amount) { await DB.update('numberBids', bid.id, { status: 'lost' }); continue; }
            const wallet = bid.bidderType === 'team'
                ? { type: 'team', id: bid.bidderId } : { type: 'player', id: bid.bidderUid };
            await Wallet.executeRoleTransaction({
                from: wallet, to: null, amount: bid.amount, icon: '🔢',
                label: `Won #${number} — ${seriesId} auction`
            });
            await this._grantLease(seriesId, number, {
                ownerType: bid.bidderType, ownerId: bid.bidderId, ownerUid: bid.bidderUid,
                feePaid: bid.amount, source: 'auction', seasonId: reg.seasonId
            });
            await DB.update('numberBids', bid.id, { status: 'won' });
            for (const l of bids.filter(x => x.id !== bid.id)) await DB.update('numberBids', l.id, { status: 'lost' });
            News.post('🔢', `#${number} in ${seriesId} won at auction for ${Economy.fmt(bid.amount)}.`);
            return bid;
        }
        // No payable bids — return to the pool.
        await DB.set('numberRegistry', this.regId(seriesId, number), { status: 'available', auctionId: null });
        return null;
    },

    /* ---------------- Leases ---------------- */
    async _grantLease(seriesId, number, o) {
        const world = await DB.loadWorld(true);
        const eligibleRaces = world.races.filter(r => r.seriesId === seriesId && (!o.seasonId || r.seasonId === o.seasonId)).length;
        const leaseId = await DB.create('numberLeases', {
            seriesId, number: Number(number), seasonId: o.seasonId || null,
            ownerType: o.ownerType, ownerId: o.ownerId, ownerUid: o.ownerUid || null,
            source: o.source || 'auction', feePaid: Number(o.feePaid) || 0,
            fieldedRaces: 0, eligibleRaces, status: 'active', startedAt: Util.todayISO()
        });
        await DB.set('numberRegistry', this.regId(seriesId, number), {
            seriesId, number: Number(number), status: 'owned', auctionId: null,
            ownerType: o.ownerType, ownerId: o.ownerId, ownerUid: o.ownerUid || null,
            leaseId, seasonId: o.seasonId || null
        });
        // Denormalize onto the team/driver for display (mirrors driver.number).
        await DB.update(o.ownerType === 'team' ? 'teams' : 'drivers', o.ownerId, { number: Number(number) }).catch(() => {});
        return leaseId;
    },

    async _release(seriesId, number, reason) {
        const reg = await DB.get('numberRegistry', this.regId(seriesId, number), { force: true }).catch(() => null);
        if (!reg) return;
        if (reg.leaseId) await DB.update('numberLeases', reg.leaseId, { status: 'revoked', endedAt: Util.todayISO() }).catch(() => {});
        if (reg.ownerId) await DB.update(reg.ownerType === 'team' ? 'teams' : 'drivers', reg.ownerId, { number: null }).catch(() => {});
        await DB.set('numberRegistry', this.regId(seriesId, number), {
            status: 'available', ownerType: null, ownerId: null, ownerUid: null, leaseId: null, retiredReason: reason || null
        });
    },

    // Insolvency lever — dump a team's numbers back to the pool for a partial refund.
    async surrenderForTeam(teamId) {
        const regs = (await DB.list('numberRegistry', { force: true }).catch(() => []))
            .filter(r => r.status === 'owned' && r.ownerType === 'team' && r.ownerId === teamId);
        let refunded = 0;
        for (const r of regs) {
            const lease = r.leaseId ? await DB.get('numberLeases', r.leaseId).catch(() => null) : null;
            const refund = Math.round((Number(lease?.feePaid) || 0) * this.SURRENDER_REFUND);
            if (refund) { await Wallet.adjustTeamWallet(teamId, refund, '🔢', `Surrendered #${r.number} (${r.seriesId})`); refunded += refund; }
            await this._release(r.seriesId, r.number, 'surrendered');
        }
        return refunded;
    },

    /* ---------------- Validation ---------------- */
    // The number an entry actually runs under. A driver's personal number only
    // wins if their contract says so; otherwise the team's number, else theirs.
    effectiveNumber(driver, team, contract) {
        if (driver?.number && contract?.numberPreference === 'driver') return driver.number;
        return team?.number ?? driver?.number ?? null;
    },

    async holdsNumber(ownerType, ownerId, seriesId, number) {
        const reg = await DB.get('numberRegistry', this.regId(seriesId, number), { force: true }).catch(() => null);
        return reg?.status === 'owned' && reg.ownerType === ownerType && reg.ownerId === ownerId;
    },

    // Post-race: bump the fielded counter for every owned number whose owner
    // (team or driver) actually ran in this completed race. Drives use-it-or-lose-it.
    async recordFielded(race, world) {
        if (race?.status !== 'completed' || !race.seriesId) return;
        const regs = (await this.listForSeries(race.seriesId)).filter(r => r.status === 'owned');
        if (!regs.length) return;
        const teamIds = new Set(), driverIds = new Set();
        for (const res of (race.results || [])) {
            const d = world.driversById[res.driverId];
            if (!d) continue;
            driverIds.add(d.id);
            if (d.teamId) teamIds.add(d.teamId);
        }
        for (const r of regs) {
            const fielded = r.ownerType === 'team' ? teamIds.has(r.ownerId) : driverIds.has(r.ownerId);
            if (!fielded || !r.leaseId) continue;
            const lease = await DB.get('numberLeases', r.leaseId).catch(() => null);
            if (lease) await DB.update('numberLeases', r.leaseId, { fieldedRaces: (Number(lease.fieldedRaces) || 0) + 1 });
        }
    },

    /* ---------------- Season rollover (renewal + revocation) ---------------- */
    // Runs from Admin.closeSeason. Revokes numbers fielded in too few races;
    // moves the rest into a first-right-of-refusal renewal window.
    async processSeasonRollover(seriesId, newSeasonId = null) {
        const regs = (await this.listForSeries(seriesId)).filter(r => r.status === 'owned');
        let revoked = 0, renewals = 0;
        for (const r of regs) {
            const lease = r.leaseId ? await DB.get('numberLeases', r.leaseId).catch(() => null) : null;
            const fielded = Number(lease?.fieldedRaces) || 0;
            if (fielded < this.MIN_FIELD_RACES) {
                await this._release(seriesId, r.number, 'revoked-inactivity');
                News.post('🔢', `#${r.number} revoked in ${seriesId} — never fielded this season.`);
                revoked++;
            } else {
                await DB.set('numberRegistry', this.regId(seriesId, r.number), { status: 'renewal', seasonId: newSeasonId });
                renewals++;
            }
        }
        return { revoked, renewals };
    },

    // First right of refusal — the current owner pays the standard lease fee.
    async renew(seriesId, number) {
        const reg = await DB.get('numberRegistry', this.regId(seriesId, number), { force: true }).catch(() => null);
        if (reg?.status !== 'renewal') throw new Error('That number is not in a renewal window.');
        const bal = reg.ownerType === 'team' ? Wallet.teamBalance(reg.ownerId) : Wallet.playerBalance(reg.ownerUid);
        if (bal < this.LEASE_FEE) throw new Error(`Renewal costs ${Economy.fmt(this.LEASE_FEE)} — not enough in the ${reg.ownerType} wallet.`);
        const wallet = reg.ownerType === 'team' ? { type: 'team', id: reg.ownerId } : { type: 'player', id: reg.ownerUid };
        await Wallet.executeRoleTransaction({ from: wallet, to: null, amount: this.LEASE_FEE, icon: '🔢', label: `Renewed #${number} — ${seriesId}` });
        await this._grantLease(seriesId, number, {
            ownerType: reg.ownerType, ownerId: reg.ownerId, ownerUid: reg.ownerUid,
            feePaid: this.LEASE_FEE, source: 'renewal', seasonId: reg.seasonId
        });
    },

    // GM finalizes the window: numbers the owner declined to renew go to public auction.
    async finalizeRenewals(seriesId, seasonId = null) {
        const pending = (await this.listForSeries(seriesId)).filter(r => r.status === 'renewal');
        for (const r of pending) await this.openAuction(seriesId, r.number, seasonId || r.seasonId);
        return pending.length;
    },

    /* ---------------- Player-facing UI ---------------- */
    // Wallets the signed-in player can bid from: their owned team, and their
    // own driver if 5★+ (personal brand number).
    _myBidders(world) {
        const uid = Auth.uid();
        const out = [];
        const myTeam = world.teams.find(t => t.ownerUid === uid);
        if (myTeam) out.push({ type: 'team', id: myTeam.id, uid, label: `${myTeam.name} — team wallet ${Economy.fmt(Wallet.teamBalance(myTeam.id))}` });
        const driverId = Auth.state.profile?.driverId;
        if (driverId && Prestige.driverStars(driverId, world) >= this.DRIVER_STAR_GATE) {
            out.push({ type: 'driver', id: driverId, uid, label: `You (${this.DRIVER_STAR_GATE}★ driver) — personal wallet ${Economy.fmt(Wallet.playerBalance(uid))}` });
        }
        return out;
    },

    async bidModal(seriesId, number) {
        const world = await DB.loadWorld();
        const bidders = this._myBidders(world);
        if (!bidders.length) { Util.notify(`Own a team, or be a ${this.DRIVER_STAR_GATE}★ driver, to bid on a number.`, 'info'); return; }
        Modal.open(`
            ${Modal.header(`🔢 Bid on #${number}`, `${Util.esc(world.seriesById[seriesId]?.name || 'Series')} · blind sealed bid — rivals can't see your amount. The winner is charged when the Game Master closes the auction.`)}
            <form id="num-bid-form" class="form-grid">
                <label class="field"><span>Bid as</span><select id="nb-bidder" class="input">
                    ${bidders.map((b, i) => `<option value="${i}">${Util.esc(b.label)}</option>`).join('')}</select></label>
                <label class="field"><span>Bid amount</span><input id="nb-amount" class="input" type="number" min="10" step="10" required></label>
                <p id="nb-error" class="form-error"></p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Place sealed bid 🔢</button>
                </div>
            </form>`);
        document.getElementById('num-bid-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const b = bidders[Number(document.getElementById('nb-bidder').value)];
            try {
                await this.placeBid(seriesId, number, { bidderType: b.type, bidderId: b.id, bidderUid: b.uid, amount: document.getElementById('nb-amount').value });
                Modal.close(); Util.notify(`Sealed bid placed on #${number}. 🔢`);
            } catch (err) { document.getElementById('nb-error').textContent = err.message; }
        });
    },

    async renewFlow(seriesId, number) {
        try { await this.renew(seriesId, number); Util.notify(`Renewed #${number}. 🔢`); App.go(App.current.view, App.current.param); }
        catch (err) { Util.notify(err.message, 'error'); }
    },

    // Registry panel for the Series detail page. Shows numbers that are in play
    // (auction / renewal / owned) with Bid / Renew actions.
    async seriesPanel(seriesId, world) {
        const regs = (await this.listForSeries(seriesId))
            .filter(r => r.status !== 'available')
            .sort((a, b) => a.number - b.number);
        const uid = Auth.uid();
        const nameOf = (r) => r.ownerType === 'team'
            ? (world.teamsById[r.ownerId]?.name || 'a team')
            : (world.driversById[r.ownerId]?.name || 'a driver');
        const iOwn = (r) => (r.ownerType === 'team' && world.teamsById[r.ownerId]?.ownerUid === uid) || (r.ownerType === 'driver' && r.ownerUid === uid);
        const badge = { auction: '<span class="badge badge-green">Auction open</span>', renewal: '<span class="badge badge-purple">Renewal window</span>', owned: '<span class="badge badge-blue">Owned</span>', retired: '<span class="badge badge-dim">Retired</span>' };
        return `<section class="panel">
            <div class="panel-head"><h2>🔢 Car Numbers</h2></div>
            <p class="muted small">Numbers are series-scoped assets. Teams charter a number for their seat; ${this.DRIVER_STAR_GATE}★ drivers can hold a personal brand number. Blind sealed-bid auctions; field it at least once a season or lose it.</p>
            ${regs.length ? `<table class="table">
                <thead><tr><th>#</th><th>Status</th><th>Holder</th><th></th></tr></thead>
                <tbody>${regs.map(r => `<tr>
                    <td class="strong">#${r.number}</td>
                    <td>${badge[r.status] || r.status}</td>
                    <td>${r.status === 'owned' || r.status === 'renewal' ? Util.esc(nameOf(r)) : '—'}</td>
                    <td class="right">
                        ${r.status === 'auction' ? `<button class="btn btn-primary btn-sm" onclick="Numbers.bidModal('${Util.attr(seriesId)}',${r.number})">Bid</button>` : ''}
                        ${r.status === 'renewal' && iOwn(r) ? `<button class="btn btn-secondary btn-sm" onclick="Numbers.renewFlow('${Util.attr(seriesId)}',${r.number})">Renew ${Economy.fmt(this.LEASE_FEE)}</button>` : ''}
                    </td>
                </tr>`).join('')}</tbody></table>`
                : '<p class="muted small">No numbers in play yet — the Game Master opens auctions from the Admin console.</p>'}
        </section>`;
    }
};
window.Numbers = Numbers;
