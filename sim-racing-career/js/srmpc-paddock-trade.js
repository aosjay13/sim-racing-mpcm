/* ============================================================
   Phoenix SRMPC — Paddock trade: dealers, markets, shops
   • 🏬 Phoenix Motors (the GM's catalog) gains trade-ins,
     financing and a factory warranty.
   • 🔑 Used lots: Second Gear Pre-Owned, Lucky Lou's Auto Lot,
     the Race Car Exchange and the Salvage Auction restock every
     week from the league's catalog (PaddockCore.usedLot). Cars
     carry real wear, mileage, titles and sometimes undisclosed
     faults; inspect before you buy and haggle the price down.
   • 👥 Player Market: cars players list for sale + every player
     Car Dealer's lot. Money moves wallet-to-wallet.
   • 🚘 Car Dealer role: buy stock at trade prices, recondition it,
     price it, sell to players — and to AI walk-in customers.
   • 🔧 Mechanic role: open a shop, work the bookings queue, and
     diagnose AI walk-in jobs for cash and XP.
   Used-lot sales are recorded in config/paddock.usedSold (one
   transaction per sale) so two players can't buy the same car.
   ============================================================ */
'use strict';

const PaddockTrade = {
    PC: window.PaddockCore,
    _dealer: 'secondgear',

    /* ============================================================
       Catalog models for the used lots
       ============================================================ */
    async models() {
        const inv = await Dealership.availableInventory().catch(() => []);
        if (inv.length) {
            return inv.map(c => ({
                id: c.id, name: c.name, carId: c.carId || Garage.carId(c.name), price: Number(c.price) || 20000,
                stats: c.stats || { performance: 5, durability: 5 }, emoji: c.emoji || '🚗', gameId: c.gameId || null, imageUrl: CarImg.normalize(c.imageUrl)
            }));
        }
        // No catalog yet: the lots trade in the starter-pack models.
        return Dealership.STARTER_PACK.flatMap(pack => pack.cars.map(c => ({
            id: 'starter-' + Garage.carId(c.name), name: c.name, carId: Garage.carId(c.name), price: c.price,
            stats: { performance: c.performance, durability: c.durability }, emoji: c.emoji, gameId: null, imageUrl: ''
        })));
    },
    async lot(dealerId, cfg) {
        cfg = cfg || await Paddock.config();
        return this.PC.usedLot(dealerId, { week: this.PC.weekKey(), salt: Number(cfg.lotSalt) || 0, models: await this.models() });
    },
    async findListing(listingId, cfg) {
        const dealerId = String(listingId).split('-')[0];
        return (await this.lot(dealerId, cfg)).find(l => l.id === listingId) || null;
    },

    // Destinations a purchase can go to: my garage, my team, my dealer lot.
    async destinations() {
        const holders = await Paddock.myHolders(await DB.loadWorld());
        return holders;
    },
    destSelect(id, holders, selected = null) {
        return `<select id="${id}" class="input">${holders.map(h => {
            const k = Paddock.key(h.type, h.id);
            return `<option value="${Util.attr(k)}" ${k === selected ? 'selected' : ''}>${h.icon} ${Util.esc(h.label)} — ${Economy.fmt(h.type === 'team' ? Wallet.teamBalance(h.id) : Economy.balance())}</option>`;
        }).join('')}</select>`;
    },
    isDealerLicensed(holders) { return holders.some(h => h.type === 'lot'); },

    /* ============================================================
       Dealership tabs (rendered inside Dealership.storefront)
       ============================================================ */
    tabRow(active) {
        const tabs = [['showroom', '🏬 Phoenix Motors'], ['used', '🔑 Used lots'], ['market', '👥 Player Market']];
        return `<div class="tab-row tab-row-wrap pd-tabs">${tabs.map(([id, label]) =>
            `<button class="tab ${active === id ? 'active' : ''}" data-deal-tab="${id}">${label}</button>`).join('')}</div>`;
    },
    wireTabs(el) {
        Util.$$('[data-deal-tab]', el).forEach(b => b.addEventListener('click', () => {
            Dealership._tab = b.dataset.dealTab;
            App.go('dealership');
        }));
    },

    /* ---------------- 🔑 Used lots ---------------- */
    async usedHtml() {
        const PC = this.PC;
        const cfg = await Paddock.config(true);
        const dealer = PC.DEALERS[this._dealer] || PC.DEALERS.secondgear;
        const lot = await this.lot(dealer.id, cfg);
        const p = Auth.state.profile ? Paddock.stateOf(Auth.state.profile, cfg, Auth.uid()) : null;
        const holders = await this.destinations();
        const licensed = this.isDealerLicensed(holders);
        const sold = cfg.usedSold || {};
        const canBuy = Auth.isPlayer() && Auth.state.profile?.walletInitialized;

        const card = (l) => {
            const inspected = !!p?.inspected?.[l.id];
            const car = inspected ? PC.revealedCar(l.car, true) : l.car;
            const st = p?.haggle?.[l.id];
            const price = st?.deal || st?.lastCounter || l.asking;
            const isSold = !!sold[l.id];
            const faults = inspected ? l.car.hidden : [];
            const trade = licensed ? Math.round(price * (1 - PC.TRADE_DISCOUNT.used) / 50) * 50 : null;
            return `<div class="car-card pd-listing ${isSold ? 'pd-sold' : ''}">
                ${CarImg.html(car.imageUrl, car.name)}
                <div class="checker-divider" role="separator">🏁</div>
                <div class="car-card-body">
                    <span class="race-title">${car.emoji || '🚗'} ${Util.esc(car.name)}
                        ${car.title !== 'clean' ? `<span class="badge badge-red">${PC.TITLES[car.title].label}</span>` : ''}
                        ${isSold ? '<span class="badge badge-dim">SOLD</span>' : ''}</span>
                    <span class="race-sub">“${Util.esc(l.history)}”</span>
                    ${Paddock.carKpis(car)}
                    ${Paddock.condGrid(car)}
                    ${Paddock.partChips(car)}
                    ${inspected ? (faults.length
                        ? `<p class="small pd-bad-text">🔍 Inspection found: ${faults.map(f => `${Util.esc(f.label)} (−${f.drop}% ${PC.COMPONENTS[f.comp].label.toLowerCase()})`).join(', ')}</p>`
                        : '<p class="small pd-good-text">🔍 Inspected — no hidden faults. What you see is what you get.</p>')
                        : `<p class="muted small">Advertised condition. ${dealer.honesty < 0.5 ? 'This lot isn\'t known for honesty…' : 'Probably accurate.'}</p>`}
                    <div class="pd-price-row"><span class="market-price">${Economy.fmt(price)}</span>
                        ${price < l.asking ? `<span class="muted small"><s>${Economy.fmt(l.asking)}</s></span>` : ''}
                        ${trade ? `<span class="chip chip-dim" title="Dealer licence: trade price when you buy for your lot">🚘 Trade ${Economy.fmt(trade)}</span>` : ''}</div>
                    <div class="btn-row">
                        <button class="btn btn-primary btn-sm" ${isSold || !canBuy ? 'disabled' : ''} onclick="PaddockTrade.buyUsedModal('${Util.attr(l.id)}')">🔑 Buy</button>
                        ${dealer.asIs ? '' : `<button class="btn btn-secondary btn-sm" ${isSold || !canBuy || st?.walked || st?.deal ? 'disabled' : ''} onclick="PaddockTrade.haggleModal('${Util.attr(l.id)}')">🤝 Haggle</button>`}
                        ${inspected ? '' : `<button class="btn btn-ghost btn-sm" ${isSold || !canBuy ? 'disabled' : ''} onclick="PaddockTrade.inspect('${Util.attr(l.id)}')">🔍 Inspect</button>`}
                    </div>
                </div>
            </div>`;
        };
        return `
        <section class="panel">
            <div class="panel-head"><h2>🔑 Used car lots</h2><span class="chip chip-dim">Restocks every Monday · ${Util.esc(PC.weekKey())}</span></div>
            <div class="chip-row" style="margin-bottom:.8rem">${PC.USED_DEALERS.map(id => {
                const d = PC.DEALERS[id];
                return `<button class="chip chip-btn ${id === dealer.id ? 'chip-active' : ''}" data-used-dealer="${id}">${d.icon} ${Util.esc(d.name)}</button>`;
            }).join('')}</div>
            <p class="muted">${dealer.icon} <strong>${Util.esc(dealer.name)}</strong> — ${Util.esc(dealer.tagline)}</p>
            <ul class="checkered-list" style="margin:.4rem 0 .9rem">
                <li>Mileage and wear are real: worn parts cost money to fix and raise the risk of a race-day failure.</li>
                <li>🔍 An inspection (a shop fee, or 1 ⏱ yourself with mechanical 40+) reveals any faults the seller didn't mention.</li>
                ${dealer.asIs ? '<li>Auction lots are sold as seen at the posted price.</li>' : `<li>🤝 Haggle: the salesman has patience for about ${dealer.patience} offers. Lowballs burn it faster.</li>`}
            </ul>
            ${lot.length ? `<div class="car-grid">${lot.map(card).join('')}</div>` : C.empty('🔑', 'Nothing on the lot', 'Check back next week.')}
        </section>`;
    },
    wireUsed(el) {
        Util.$$('[data-used-dealer]', el).forEach(b => b.addEventListener('click', () => { this._dealer = b.dataset.usedDealer; App.go('dealership'); }));
    },

    async inspect(listingId) {
        const PC = this.PC;
        const cfg = await Paddock.config();
        const l = await this.findListing(listingId, cfg);
        if (!l) { Util.notify('That car has left the lot.', 'error'); return; }
        const p = Paddock.stateOf(Auth.state.profile, cfg, Auth.uid());
        const fee = PC.quote(l.car, { service: 'inspect' }, PC.SHOPS.mainst, { econ: cfg.econ }).total;
        const mech = PC.skillValue(p.skills.mechanical);
        const diy = mech >= 40;
        const choice = diy ? confirm(`Inspect the ${l.car.name} yourself for 1 ⏱ (mechanical ${mech})?\n\nOK = do it yourself · Cancel = pay Main Street Auto Care ${Economy.fmt(fee)}`) : false;
        if (!diy && !confirm(`Pay Main Street Auto Care ${Economy.fmt(fee)} to inspect the ${l.car.name}?`)) return;
        await Paddock.act(async (pp) => {
            if (choice) { Paddock.useAP(pp, 1); await Paddock._gainXP(pp, { mechanical: 15 }); }
            else await Economy.spend(fee, `Pre-purchase inspection — ${l.car.name}`, '🔍');
            pp.inspected = { ...this._thisWeek(pp.inspected), [listingId]: true };
            PC.logLine(pp, '🔍', `Inspected a ${l.car.name} at ${PC.DEALERS[l.dealer].name}: ${l.car.hidden.length ? l.car.hidden.map(h => h.label).join(', ') : 'clean'}`);
            return l.car.hidden;
        }, { ok: (faults) => faults && faults.length ? `🔍 Found: ${faults.map(f => f.label).join(', ')}. Haggle accordingly!` : '🔍 Clean bill of health.' });
    },
    _thisWeek(map) {
        const wk = this.PC.weekKey();
        return Object.fromEntries(Object.entries(map || {}).filter(([k]) => k.includes(wk)));
    },

    async haggleModal(listingId) {
        const PC = this.PC;
        const cfg = await Paddock.config();
        const l = await this.findListing(listingId, cfg);
        if (!l) { Util.notify('That car has left the lot.', 'error'); return; }
        const p = Paddock.stateOf(Auth.state.profile, cfg, Auth.uid());
        const st = p.haggle?.[listingId] || {};
        const dealer = PC.DEALERS[l.dealer];
        const current = st.lastCounter || l.asking;
        Modal.open(`
            ${Modal.header(`🤝 Haggle — ${l.car.name}`, `${dealer.name} · sticker ${Economy.fmt(l.asking)}`)}
            <p class="muted small">The salesman's current number is <strong>${Economy.fmt(current)}</strong>. ${st.attempts ? `You've made ${Util.plural(st.attempts, 'offer')} so far.` : ''}
                Your media skill (${PC.skillValue(p.skills.media)}) helps. Market value of the car as advertised: ${Economy.fmt(PC.marketValue(l.car))}. Each offer costs 1 ⏱ (you have ${p.ap}).</p>
            <form id="pd-haggle" class="form-grid">
                <label class="field"><span>Your offer</span><input id="pd-h-offer" class="input" type="number" min="100" step="50" value="${Math.round(current * 0.85 / 50) * 50}"></label>
                <div id="pd-h-line" class="pd-quote muted"></div>
                <div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="Modal.close()">Walk away</button>
                    <button type="submit" class="btn btn-primary">Make the offer</button></div>
            </form>`);
        Util.$('#pd-haggle').addEventListener('submit', async (e) => {
            e.preventDefault();
            const offer = Math.round(Number(Util.$('#pd-h-offer').value) || 0);
            const res = await Paddock.act(async (pp) => {
                Paddock.useAP(pp, 1);
                const hs = pp.haggle?.[listingId] || {};
                const out = PC.haggle(l, offer, hs, { media: PC.skillValue(pp.skills.media) });
                const state = { ...out.state };
                if (out.outcome === 'accept') state.deal = out.price;
                pp.haggle = { ...this._thisWeek(pp.haggle), [listingId]: state };
                await Paddock._gainXP(pp, { media: 6 });
                return out;
            }, { rerender: false });
            if (!res) return;
            Util.$('#pd-h-line').innerHTML = `<strong>${Util.esc(res.line)}</strong>${res.outcome === 'accept' ? `<p>Agreed at ${Economy.fmt(res.price)} — press 🔑 Buy on the listing to close the deal.</p>` : ''}`;
            if (res.outcome === 'counter' || res.outcome === 'insulted') Util.$('#pd-h-offer').value = Math.round((res.price + offer) / 2 / 50) * 50;
            if (res.outcome === 'accept' || res.outcome === 'walk') {
                Util.$('#pd-haggle button[type=submit]').disabled = true;
                setTimeout(() => { Modal.close(); App.go('dealership'); }, 1400);
            }
        });
    },

    async buyUsedModal(listingId) {
        const PC = this.PC;
        const cfg = await Paddock.config(true);
        const l = await this.findListing(listingId, cfg);
        if (!l || cfg.usedSold?.[listingId]) { Util.notify('That car has already been sold.', 'error'); return; }
        const holders = await this.destinations();
        if (!holders.length) { Util.notify('Player accounts with a started career can buy cars.', 'error'); return; }
        const p = Paddock.stateOf(Auth.state.profile, cfg, Auth.uid());
        const st = p.haggle?.[listingId];
        const base = st?.deal || st?.lastCounter || l.asking;
        Modal.open(`
            ${Modal.header(`🔑 Buy the ${l.car.name}`, `${PC.DEALERS[l.dealer].name} · ${PC.TITLES[l.car.title].label} · ${l.car.races} races`)}
            <form id="pd-buy-used" class="form-grid">
                <label class="field"><span>Where does it go?</span>${this.destSelect('pd-bu-dest', holders)}</label>
                <div id="pd-bu-sum" class="pd-quote"></div>
                <p class="muted small">${p.inspected?.[listingId] ? '🔍 You inspected this car.' : '⚠️ Not inspected — any undisclosed faults show up after its first race.'} Used cars come with no warranty.</p>
                <div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Buy it 🔑</button></div>
            </form>`);
        const priceFor = (key) => key.startsWith('lot__') ? Math.round(base * (1 - PC.TRADE_DISCOUNT.used) / 50) * 50 : base;
        const upd = () => {
            const key = Util.$('#pd-bu-dest').value;
            Util.$('#pd-bu-sum').innerHTML = `<div class="pd-quote-total"><span>${key.startsWith('lot__') ? '🚘 Dealer trade price' : 'Price'}</span><strong>${Economy.fmt(priceFor(key))}</strong></div>`;
        };
        Util.$('#pd-bu-dest').addEventListener('change', upd);
        upd();
        Util.$('#pd-buy-used').addEventListener('submit', async (e) => {
            e.preventDefault();
            const key = Util.$('#pd-bu-dest').value;
            if (await this.buyUsed(listingId, key, priceFor(key))) Modal.close();
        });
    },

    // Reserve the listing in config/paddock (transaction), then pay. Undo the
    // reservation if the payment fails.
    async _reserve(listingId) {
        const uid = Auth.uid();
        const wk = this.PC.weekKey();
        await DB.runTransaction(async (tx) => {
            const ref = DB._c('config').doc('paddock');
            const snap = await tx.get(ref);
            const data = snap.exists ? snap.data() : {};
            const sold = Object.fromEntries(Object.entries(data.usedSold || {}).filter(([k]) => k.includes(wk)));
            if (sold[listingId]) throw new Error('Someone just bought that car.');
            sold[listingId] = uid;
            if (snap.exists) tx.update(ref, { usedSold: sold });
            else tx.set(ref, { usedSold: sold });
        });
        Paddock._cfg = null;
    },
    async _unreserve(listingId) {
        try {
            const doc = await DB.get('config', 'paddock', { force: true });
            const sold = { ...(doc?.usedSold || {}) };
            delete sold[listingId];
            await DB.update('config', 'paddock', { usedSold: sold });
            Paddock._cfg = null;
        } catch (e) { console.warn('Could not release the reservation:', e); }
    },

    async buyUsed(listingId, destKey, price) {
        const PC = this.PC;
        try {
            const cfg = await Paddock.config(true);
            const l = await this.findListing(listingId, cfg);
            if (!l) throw new Error('That car has left the lot.');
            const h = Paddock.parseKey(destKey);
            const { cars } = await Paddock.loadCars(h);
            if (Paddock.balanceFor(h) < price) throw new Error(`Not enough money — the car is ${Economy.fmt(price)}.`);
            if (h.type === 'lot') {
                const prof = await DB.get('roleProfiles', h.id, { force: true });
                if (cars.length >= PC.lotCapacity(Prestige.stored(prof))) throw new Error('Your lot is full — sell something first.');
            }
            await this._reserve(listingId);
            const dealer = PC.DEALERS[l.dealer];
            try {
                await Paddock.spendFor(h, price, `${l.car.name} (${dealer.name})`, '🔑');
            } catch (err) { await this._unreserve(listingId); throw err; }
            const p = Paddock.stateOf(Auth.state.profile, cfg, Auth.uid());
            const known = !!p.inspected?.[listingId];
            const entry = PC.ensureCar({
                ...(known ? PC.revealedCar(l.car, true) : l.car),
                id: Paddock.newCarId(), boughtAt: Util.todayISO(), paidPrice: price, condition: 'used',
                tag: `${dealer.name} · Used`, warranty: 0, forSale: null
            });
            PC.addHistory(entry, dealer.icon, `Bought from ${dealer.name} for ${Economy.fmt(price)} (${l.car.races} races on the clock)`);
            await Paddock.saveCars(h, [...cars, entry]);
            await Paddock.act(async (pp) => {
                pp.stats.carsBought += 1;
                if (!pp.raceCar && h.type === 'user') pp.raceCar = entry.id;
                PC.logLine(pp, '🔑', `Bought a used ${l.car.name} from ${dealer.name} for ${Economy.fmt(price)}`);
            }, { rerender: false });
            News.post('🔑', `${Auth.state.profile?.displayName || 'A player'} drove a used ${l.car.name} off ${dealer.name}'s lot`);
            Util.notify(`🔑 The ${l.car.name} is yours. ${known || !l.car.hidden.length ? '' : 'Fingers crossed…'}`);
            App.go(App.current.view, App.current.param);
            return true;
        } catch (e) { Util.notify(e.message, 'error'); return false; }
    },

    /* ---------------- 🏬 Phoenix Motors: finance & trade-in ---------------- */
    async dealModal(invId) {
        const PC = this.PC;
        const car = await DB.get('dealershipInventory', invId, { force: true });
        if (!car || car.available === false) { Util.notify('That car is no longer on the market.', 'error'); return; }
        const holders = await this.destinations();
        if (!holders.length || !Auth.state.profile?.walletInitialized) { Util.notify('Start your career (pick a difficulty) before buying cars.', 'error'); return; }
        const cfg = await Paddock.config();
        const p = Paddock.stateOf(Auth.state.profile, cfg, Auth.uid());
        const garages = {};
        for (const h of holders) garages[Paddock.key(h.type, h.id)] = (await Paddock.loadCars(h)).cars.filter(c => !c.job && !c.finance);
        Modal.open(`
            ${Modal.header(`🏬 ${car.name}`, `Phoenix Motors · ${Economy.fmt(car.price)} · ${car.condition === 'used' ? 'pre-owned' : 'brand new with a 5-race factory warranty'}`)}
            <form id="pd-deal" class="form-grid">
                <label class="field"><span>Where does it go?</span>${this.destSelect('pd-dl-dest', holders)}</label>
                <label class="field"><span>Trade in a car</span><select id="pd-dl-trade" class="input"></select></label>
                <label class="field"><span>Payment</span><select id="pd-dl-pay" class="input">
                    <option value="cash">💵 Pay in full</option>
                    <option value="finance">💳 Finance — 20% down, the rest over 12 races</option></select></label>
                <div id="pd-dl-sum" class="pd-quote"></div>
                <div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary" id="pd-dl-go">Sign the papers ✍️</button></div>
            </form>`, { wide: true });
        const calc = () => {
            const key = Util.$('#pd-dl-dest').value;
            const h = Paddock.parseKey(key);
            const tradeId = Util.$('#pd-dl-trade').value;
            const trade = (garages[key] || []).find(c => c.id === tradeId) || null;
            const pay = Util.$('#pd-dl-pay').value;
            const fleet = h.type === 'lot' ? PC.TRADE_DISCOUNT.new : 0;
            const price = Math.round(Number(car.price) * (1 - fleet));
            const tradeVal = trade ? PC.tradeInValue(trade) : 0;
            const due = price - tradeVal;
            const plan = pay === 'finance' && due > 0 ? PC.financePlan(due, { credit: p.credit }) : null;
            return { key, h, trade, tradeVal, price, due, plan, fleet, pay };
        };
        const fillTrades = () => {
            const key = Util.$('#pd-dl-dest').value;
            Util.$('#pd-dl-trade').innerHTML = `<option value="">— No trade-in —</option>` + (garages[key] || []).map(c =>
                `<option value="${Util.attr(c.id)}">${Util.esc(c.nick || c.name)} — trade-in ${Economy.fmt(PC.tradeInValue(c))} (dealer cash ${Economy.fmt(PC.sellBackValue(c))})</option>`).join('');
            const payEl = Util.$('#pd-dl-pay');
            payEl.querySelector('option[value=finance]').disabled = key.startsWith('team__') || key.startsWith('lot__');
            if (payEl.selectedOptions[0]?.disabled) payEl.value = 'cash';
        };
        const upd = () => {
            const x = calc();
            const bal = x.h.type === 'team' ? Wallet.teamBalance(x.h.id) : Economy.balance();
            const upfront = x.plan ? x.plan.down : Math.max(0, x.due);
            Util.$('#pd-dl-sum').innerHTML = `
                <div class="pd-quote-lines">
                    <div>Sticker ${Economy.fmt(car.price)}${x.fleet ? ` − ${Math.round(x.fleet * 100)}% dealer fleet discount = ${Economy.fmt(x.price)}` : ''}</div>
                    ${x.trade ? `<div>Trade-in: ${Util.esc(x.trade.name)} −${Economy.fmt(x.tradeVal)}</div>` : ''}
                    ${x.plan ? `<div>Finance ${Economy.fmt(x.plan.financed)} at ${Math.round(x.plan.rate * 100)}% (credit ${p.credit}): ${x.plan.races} × ${Economy.fmt(x.plan.perRace)}, paid on race day</div>` : ''}
                    ${x.due < 0 ? `<div>Phoenix Motors owes you ${Economy.fmt(-x.due)} on the trade.</div>` : ''}
                </div>
                <div class="pd-quote-total"><span>Due today</span><strong>${Economy.fmt(upfront)}</strong></div>
                ${upfront > bal ? `<p class="pd-bad-text small">Not enough money (${Economy.fmt(bal)} available).</p>` : ''}`;
            Util.$('#pd-dl-go').disabled = upfront > bal;
        };
        Util.$('#pd-dl-dest').addEventListener('change', () => { fillTrades(); upd(); });
        ['#pd-dl-trade', '#pd-dl-pay'].forEach(s => Util.$(s).addEventListener('change', upd));
        fillTrades(); upd();
        Util.$('#pd-deal').addEventListener('submit', async (e) => {
            e.preventDefault();
            const x = calc();
            Util.$('#pd-dl-go').disabled = true;
            try {
                const world = await DB.loadWorld();
                const entry = Dealership._garageEntryFrom({ ...car, gameName: world.gamesById[car.gameId]?.name });
                entry.paidPrice = x.price;
                const fresh = (await Paddock.loadCars(x.h)).cars;
                if (x.trade && !fresh.some(c => c.id === x.trade.id)) throw new Error('The trade-in car is gone.');
                if (x.plan) {
                    await Paddock.spendFor(x.h, x.plan.down, `${car.name} — finance down payment`, '💳');
                    entry.finance = { balance: x.plan.total, perRace: x.plan.perRace, racesLeft: x.plan.races, missed: 0, lender: 'Phoenix Motors Finance', rate: x.plan.rate };
                    PC.addHistory(entry, '💳', `Financed: ${Economy.fmt(x.plan.down)} down, ${x.plan.races} × ${Economy.fmt(x.plan.perRace)}`);
                } else if (x.due > 0) await Paddock.spendFor(x.h, x.due, `${car.name} (Phoenix Motors${x.trade ? `, ${x.trade.name} traded in` : ''})`, '🚗');
                else if (x.due < 0) await Paddock.creditFor(x.h, -x.due, `Trade-in balance: ${x.trade.name}`, '🔁');
                if (x.trade) PC.addHistory(entry, '🔁', `Part-exchanged a ${x.trade.name} for ${Economy.fmt(x.tradeVal)}`);
                const next = [...fresh.filter(c => !x.trade || c.id !== x.trade.id), entry];
                await Paddock.saveCars(x.h, next);
                await Paddock.act(async (pp) => {
                    pp.stats.carsBought += 1;
                    if (x.trade) pp.stats.carsSold += 1;
                    if (x.h.type === 'user' && (!pp.raceCar || (x.trade && pp.raceCar === x.trade.id))) pp.raceCar = entry.id;
                    PC.logLine(pp, '🏬', `Bought a ${car.name} from Phoenix Motors${x.trade ? ` (traded in the ${x.trade.name})` : ''}${x.plan ? ' on finance' : ''}`);
                }, { rerender: false });
                News.post('🚗', `${Auth.state.profile?.displayName || 'A player'} drove a new ${car.name} out of Phoenix Motors`);
                Modal.close();
                Util.notify(`${entry.emoji} ${car.name} is yours${x.plan ? ' — first installment due on race day' : ''}! 🏁`);
                App.go(App.current.view, App.current.param);
            } catch (err) { Util.notify(err.message, 'error'); Util.$('#pd-dl-go').disabled = false; }
        });
    },

    /* ---------------- 👥 Player Market ---------------- */
    async marketListings() {
        const [users, teams, profiles] = await Promise.all([
            DB.users({ force: true }).catch(() => []), DB.teams({ force: true }), DB.roleProfiles({ force: true }).catch(() => [])]);
        const out = [];
        users.forEach(u => (Array.isArray(u.garage) ? u.garage : []).filter(c => c.forSale?.price).forEach(c =>
            out.push({ sellerKey: Paddock.key('user', u.id), seller: u.displayName || 'A player', sellerUid: u.id, kind: 'private', car: c, price: c.forSale.price })));
        teams.filter(t => t.ownerUid).forEach(t => (Array.isArray(t.garage) ? t.garage : []).filter(c => c.forSale?.price).forEach(c =>
            out.push({ sellerKey: Paddock.key('team', t.id), seller: t.name, sellerUid: t.ownerUid, kind: 'team', car: c, price: c.forSale.price })));
        profiles.filter(rp => rp.role === 'car-dealer' && rp.uid).forEach(rp => (Array.isArray(rp.lot) ? rp.lot : []).filter(c => Number(c.retail) > 0).forEach(c =>
            out.push({ sellerKey: Paddock.key('lot', rp.id), seller: rp.dealer?.name || `${rp.name}'s Motors`, sellerUid: rp.uid, kind: 'dealer', car: c, price: Number(c.retail), stars: Prestige.stored(rp) })));
        return out;
    },

    async marketHtml() {
        const PC = this.PC;
        const listings = await this.marketListings();
        const me = Auth.uid();
        const canBuy = Auth.isPlayer() && Auth.state.profile?.walletInitialized;
        const card = (x) => {
            const value = PC.marketValue(x.car);
            const delta = value ? Math.round((x.price / value - 1) * 100) : 0;
            const mine = x.sellerUid === me;
            return `<div class="car-card pd-listing">
                ${CarImg.html(x.car.imageUrl, x.car.name)}
                <div class="checker-divider" role="separator">🏁</div>
                <div class="car-card-body">
                    <span class="race-title">${x.car.emoji || '🚗'} ${Util.esc(x.car.name)}
                        ${x.kind === 'dealer' ? `<span class="badge badge-purple">🚘 ${Util.esc(x.seller)} ${Prestige.stars(x.stars || 1)}</span>` : `<span class="badge badge-blue">${x.kind === 'team' ? '🏢' : '👤'} ${Util.esc(x.seller)}</span>`}
                        ${x.car.title && x.car.title !== 'clean' ? `<span class="badge badge-red">${PC.TITLES[x.car.title]?.label || ''}</span>` : ''}</span>
                    ${Paddock.carKpis(x.car)}
                    ${Paddock.condGrid(x.car)}
                    ${Paddock.partChips(x.car)}
                    <div class="pd-price-row"><span class="market-price">${Economy.fmt(x.price)}</span>
                        <span class="chip chip-dim" title="Against what the car is worth today">${delta <= 0 ? `💡 ${-delta}% under value` : `${delta}% over value`}</span></div>
                    <div class="btn-row">${mine ? '<span class="muted small">Your listing</span>'
                        : `<button class="btn btn-primary btn-sm" ${canBuy ? '' : 'disabled'} onclick="PaddockTrade.buyPrivateModal('${Util.attr(x.sellerKey)}','${Util.attr(x.car.id)}')">🤝 Buy</button>`}</div>
                </div>
            </div>`;
        };
        const dealers = listings.filter(x => x.kind === 'dealer');
        const priv = listings.filter(x => x.kind !== 'dealer');
        return `
        <section class="panel">
            <div class="panel-head"><h2>🚘 Player dealerships (${dealers.length})</h2></div>
            <p class="muted small">Cars stocked and priced by league Car Dealers. Want to run one? Pick the 🚘 Car Dealer role in My Career.</p>
            ${dealers.length ? `<div class="car-grid">${dealers.map(card).join('')}</div>` : C.empty('🚘', 'No player dealers yet', 'Be the first: switch role to Car Dealer and open your lot.')}
        </section>
        <section class="panel" style="margin-top:1.1rem">
            <div class="panel-head"><h2>🏷️ Private sales (${priv.length})</h2></div>
            <p class="muted small">Cars other players are selling. List your own from the Paddock garage (⋯ More → List on Player Market).</p>
            ${priv.length ? `<div class="car-grid">${priv.map(card).join('')}</div>` : C.empty('🏷️', 'Nothing for sale', 'When players list cars they show up here.')}
        </section>`;
    },

    async buyPrivateModal(sellerKey, carId) {
        const holders = await this.destinations();
        if (!holders.length) { Util.notify('Player accounts with a started career can buy cars.', 'error'); return; }
        const listing = (await this.marketListings()).find(x => x.sellerKey === sellerKey && x.car.id === carId);
        if (!listing) { Util.notify('That car is no longer for sale.', 'error'); return; }
        Modal.open(`
            ${Modal.header(`🤝 Buy ${listing.car.name}`, `From ${listing.seller} · ${Economy.fmt(listing.price)}`)}
            <form id="pd-bp" class="form-grid">
                <label class="field"><span>Where does it go?</span>${this.destSelect('pd-bp-dest', holders)}</label>
                <p class="muted small">The money goes straight to ${Util.esc(listing.seller)}. Private sales are sold as seen.</p>
                <div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Pay ${Economy.fmt(listing.price)}</button></div>
            </form>`);
        Util.$('#pd-bp').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (await this.buyPrivate(sellerKey, carId, Util.$('#pd-bp-dest').value)) Modal.close();
        });
    },

    async buyPrivate(sellerKey, carId, destKey) {
        const PC = this.PC;
        try {
            const seller = Paddock.parseKey(sellerKey);
            const dest = Paddock.parseKey(destKey);
            if (sellerKey === destKey) throw new Error('That\'s already yours.');
            const sellerDoc = await Paddock.holderDoc(seller);
            const sellerCars = Paddock.carsOf(seller, sellerDoc).slice();
            const car = sellerCars.find(c => c.id === carId);
            const price = seller.type === 'lot' ? Number(car?.retail) : Number(car?.forSale?.price);
            if (!car || !(price > 0)) throw new Error('That car is no longer for sale.');
            if (car.job) throw new Error('That car is in a shop right now.');
            if (Paddock.balanceFor(dest) < price) throw new Error(`Not enough money — it's ${Economy.fmt(price)}.`);
            const sellerUid = seller.type === 'user' ? seller.id : seller.type === 'team' ? sellerDoc.ownerUid : sellerDoc.uid;
            if (sellerUid === Auth.uid() && dest.type === seller.type) throw new Error('That\'s already yours.');
            const sellerName = seller.type === 'user' ? (sellerDoc.displayName || 'a player') : seller.type === 'team' ? sellerDoc.name : (sellerDoc.dealer?.name || sellerDoc.name);
            const toWallet = seller.type === 'team' ? { type: 'team', id: seller.id } : { type: 'player', id: sellerUid };
            await Wallet.executeRoleTransaction({
                from: Paddock.walletFor(dest), to: toWallet, amount: price, icon: '🤝',
                fromLabel: `Bought ${car.name} from ${sellerName}`, toLabel: `Sold ${car.name} to ${Auth.state.profile?.displayName || 'a player'}`
            });
            await Paddock.saveCars(seller, sellerCars.filter(c => c.id !== carId));
            const { cars } = await Paddock.loadCars(dest);
            const entry = PC.addHistory({ ...car, id: Paddock.newCarId(), forSale: null, retail: null, boughtAt: Util.todayISO(), paidPrice: price, assigned: null },
                '🤝', `Bought from ${sellerName} for ${Economy.fmt(price)}`);
            await Paddock.saveCars(dest, [...cars, entry]);
            if (seller.type === 'lot') await this._recordDealerSale(seller.id, car, price, Auth.state.profile?.displayName || 'a player');
            await Paddock.act(async (pp) => {
                pp.stats.carsBought += 1;
                if (!pp.raceCar && dest.type === 'user') pp.raceCar = entry.id;
                PC.logLine(pp, '🤝', `Bought a ${car.name} from ${sellerName} for ${Economy.fmt(price)}`);
            }, { rerender: false });
            News.post('🤝', `${Auth.state.profile?.displayName || 'A player'} bought a ${car.name} from ${sellerName} for ${Economy.fmt(price)}`);
            Util.notify(`🤝 Deal done — the ${car.name} is yours.`);
            App.go(App.current.view, App.current.param);
            return true;
        } catch (e) { Util.notify(e.message, 'error'); return false; }
    },

    /* ============================================================
       🚘 Car Dealer role (My Career workspace)
       ============================================================ */
    async _recordDealerSale(profileId, car, price, buyer) {
        try {
            const rp = await DB.get('roleProfiles', profileId, { force: true });
            if (!rp) return;
            const d = { name: '', sales: 0, revenue: 0, profit: 0, log: [], ...(rp.dealer || {}) };
            const cost = Number(car.paidPrice) || 0;
            d.sales += 1; d.revenue += price; d.profit += price - cost;
            d.log = [{ at: Util.todayISO(), car: car.name, price, profit: price - cost, buyer }, ...(d.log || [])].slice(0, 15);
            await DB.update('roleProfiles', profileId, { dealer: Paddock.json(d), prestigeXP: Math.round(Number(rp.prestigeXP) || 0) + 25 + Math.max(0, Math.round((price - cost) / 200)) });
        } catch (e) { console.warn('Dealer sale record failed:', e); }
    },

    async dealerPanel(profile, world) {
        const PC = this.PC;
        const stars = Prestige.stored(profile);
        // AI walk-in customers first, so the lot reflects any overnight sales.
        const sold = await this._aiWalkIns(profile);
        const rp = sold.length ? await DB.get('roleProfiles', profile.id, { force: true }) : profile;
        const lot = Array.isArray(rp.lot) ? rp.lot : [];
        const d = { name: '', sales: 0, revenue: 0, profit: 0, log: [], ...(rp.dealer || {}) };
        const cap = PC.lotCapacity(stars);
        const k = Util.attr(Paddock.key('lot', rp.id));
        const row = (c) => {
            const v = PC.marketValue(c);
            const chance = c.retail ? Math.round(PC.aiBuyerChance(c, c.retail, { stars }) * 100) : 0;
            return `<div class="race-row">
                ${Paddock.carThumb(c)}
                <div class="race-row-main"><span class="race-title">${Util.esc(c.name)} <span class="chip chip-dim">${PC.overall(c)}%</span></span>
                    <span class="race-sub">Paid ${Economy.fmt(c.paidPrice || c.price)} · worth ${Economy.fmt(v)}${c.retail ? ` · listed ${Economy.fmt(c.retail)} · ~${chance}% AI buyer chance a day` : ' · not listed'}</span></div>
                <div class="btn-row">
                    <button class="btn btn-secondary btn-sm" onclick="PaddockTrade.priceCar('${Util.attr(rp.id)}','${Util.attr(c.id)}')">🏷️ Price</button>
                    <button class="btn btn-ghost btn-sm" onclick="Paddock.bookModal('${k}','${Util.attr(c.id)}')">🔧 Recondition</button>
                    <button class="btn btn-ghost btn-sm" onclick="PaddockTrade.wholesale('${Util.attr(rp.id)}','${Util.attr(c.id)}')">📦 Wholesale ${Economy.fmt(Math.round(v * 0.75))}</button>
                </div>
            </div>`;
        };
        return `<section class="panel">
            <div class="panel-head"><h2>🚘 ${Util.esc(d.name || `${rp.name}'s Motors`)} — lot ${lot.length}/${cap}</h2>
                <button class="btn btn-secondary btn-sm" onclick="PaddockTrade.renameDealership('${Util.attr(rp.id)}')">✎ Name</button></div>
            <ul class="checkered-list">
                <li>Your dealer licence gets trade prices: ${Math.round(PC.TRADE_DISCOUNT.used * 100)}% off on the used lots, ${Math.round(PC.TRADE_DISCOUNT.new * 100)}% off at Phoenix Motors — choose your lot as the destination.</li>
                <li>Recondition stock at any shop, then price it. Players see it on the Dealership's Player Market.</li>
                <li>AI customers drop by every day. Price near what a car's worth and it moves; overprice and it sits.</li>
            </ul>
            ${sold.length ? `<div class="pd-request">🎉 ${sold.map(s => `AI customer bought the ${Util.esc(s.name)} for ${Economy.fmt(s.price)}`).join(' · ')}</div>` : ''}
            ${lot.length ? lot.map(row).join('') : C.empty('🚘', 'Your lot is empty', 'Buy stock on the used lots or at Phoenix Motors — pick your lot as the destination.',
                `<button class="btn btn-primary" onclick="Dealership._tab='used';App.go('dealership')">🔑 Go shopping</button>`)}
        </section>
        <section class="panel">
            <div class="panel-head"><h2>📈 Sales</h2></div>
            <div class="pd-mini-grid">
                <div class="mini-stat"><span class="mini-value">${d.sales}</span><span class="mini-label">Cars sold</span></div>
                <div class="mini-stat"><span class="mini-value">${Economy.fmt(d.revenue)}</span><span class="mini-label">Revenue</span></div>
                <div class="mini-stat"><span class="mini-value">${Economy.fmt(d.profit)}</span><span class="mini-label">Profit</span></div>
            </div>
            ${d.log?.length ? d.log.map(s => `<div class="race-row"><div class="race-row-main"><span class="race-title">${Util.esc(s.car)} → ${Util.esc(s.buyer)}</span>
                <span class="race-sub">${Util.esc(Util.fmtDateShort(s.at))} · ${Economy.fmt(s.price)} · profit ${Economy.fmt(s.profit)}</span></div></div>`).join('') : '<p class="muted">No sales yet.</p>'}
        </section>`;
    },

    // Days since each listed car was last offered to AI customers; one
    // seeded roll per day per car (capped at a week).
    async _aiWalkIns(profile) {
        const PC = this.PC;
        const lot = Array.isArray(profile.lot) ? profile.lot : [];
        if (!lot.some(c => c.retail)) return [];
        const today = Util.parseISODate(Util.todayISO());
        const stars = Prestige.stored(profile);
        const sold = [];
        let changed = false;
        const next = [];
        for (const c of lot) {
            if (!c.retail) { next.push(c); continue; }
            const last = Util.parseISODate(c.aiCheckedOn || c.listedOn || Util.todayISO());
            const days = Math.min(7, Math.max(0, Math.round((today - last) / 86400000)));
            let buyer = false;
            for (let i = 1; i <= days && !buyer; i++) {
                const r = PC.rng(`${profile.id}|${c.id}|${c.listedOn || ''}|${i}|${c.aiCheckedOn || ''}`);
                buyer = r() < PC.aiBuyerChance(c, c.retail, { stars });
            }
            if (days) changed = true;
            if (buyer) sold.push({ id: c.id, name: c.name, price: c.retail, car: c });
            else next.push(days ? { ...c, aiCheckedOn: Util.todayISO() } : c);
        }
        if (!changed) return [];
        await DB.update('roleProfiles', profile.id, { lot: Paddock.json(next) });
        for (const s of sold) {
            await Economy.adjustWallet(profile.uid, s.price, '🚘', `AI customer bought the ${s.name}`);
            await this._recordDealerSale(profile.id, s.car, s.price, 'an AI customer');
            News.post('🚘', `${profile.dealer?.name || profile.name} sold a ${s.name} to a walk-in customer`);
        }
        return sold;
    },

    async priceCar(profileId, carId) {
        const PC = this.PC;
        try {
            const rp = await DB.get('roleProfiles', profileId, { force: true });
            const lot = Array.isArray(rp?.lot) ? rp.lot : [];
            const c = lot.find(x => x.id === carId);
            if (!c) return;
            const v = PC.marketValue(c);
            const raw = prompt(`Retail price for the ${c.name}? (0 = take it off the market)\nWorth ${Economy.fmt(v)} · you paid ${Economy.fmt(c.paidPrice || c.price)}.\nAI buyers bite near value; players see every listed car.`, String(c.retail || Math.round(v * 1.1 / 100) * 100));
            if (raw === null) return;
            const retail = Math.max(0, Math.round(Number(String(raw).replace(/[^\d.]/g, '')) || 0));
            await DB.update('roleProfiles', profileId, { lot: Paddock.json(lot.map(x => x.id === carId ? { ...x, retail: retail || null, listedOn: retail ? Util.todayISO() : null, aiCheckedOn: retail ? Util.todayISO() : null } : x)) });
            Util.notify(retail ? `🏷️ ${c.name} listed at ${Economy.fmt(retail)}.` : `${c.name} taken off the market.`);
            App.go(App.current.view, App.current.param);
        } catch (e) { Util.notify(e.message, 'error'); }
    },
    async wholesale(profileId, carId) {
        const PC = this.PC;
        try {
            const rp = await DB.get('roleProfiles', profileId, { force: true });
            const lot = Array.isArray(rp?.lot) ? rp.lot : [];
            const c = lot.find(x => x.id === carId);
            if (!c) return;
            const pay = Math.round(PC.marketValue(c) * 0.75);
            if (!confirm(`Wholesale the ${c.name} to the trade for ${Economy.fmt(pay)}?`)) return;
            await DB.update('roleProfiles', profileId, { lot: Paddock.json(lot.filter(x => x.id !== carId)) });
            await Economy.adjustWallet(Auth.uid(), pay, '📦', `Wholesaled the ${c.name}`);
            Util.notify(`📦 Wholesaled for ${Economy.fmt(pay)}.`);
            App.go(App.current.view, App.current.param);
        } catch (e) { Util.notify(e.message, 'error'); }
    },
    async renameDealership(profileId) {
        try {
            const rp = await DB.get('roleProfiles', profileId, { force: true });
            const name = prompt('Dealership name?', rp?.dealer?.name || `${rp?.name || 'My'} Motors`);
            if (name === null) return;
            await DB.update('roleProfiles', profileId, { dealer: Paddock.json({ ...(rp.dealer || {}), name: name.trim().slice(0, 40) }) });
            App.go(App.current.view, App.current.param);
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    /* ============================================================
       🔧 Mechanic role — your own shop
       ============================================================ */
    async _shopQueue(profile) {
        const [users, teams, profiles] = await Promise.all([
            DB.users({ force: true }).catch(() => []), DB.teams({ force: true }), DB.roleProfiles({ force: true }).catch(() => [])]);
        const q = [];
        const scan = (key, cars) => (Array.isArray(cars) ? cars : []).filter(c => c.job?.shopProfileId === profile.id).forEach(c => q.push({ key, car: c }));
        users.forEach(u => scan(Paddock.key('user', u.id), u.garage));
        teams.forEach(t => scan(Paddock.key('team', t.id), t.garage));
        profiles.filter(p => p.role === 'car-dealer').forEach(p => scan(Paddock.key('lot', p.id), p.lot));
        return q;
    },

    async mechanicShopPanel(profile, world) {
        const PC = this.PC;
        const stars = Prestige.stored(profile);
        const shop = { name: '', open: false, laborMul: 1, specialty: 'repair', jobsDone: 0, walkIns: 0, ...(profile.shop || {}) };
        const cfg = await Paddock.config();
        const p = Auth.state.profile ? Paddock.stateOf(Auth.state.profile, cfg, Auth.uid()) : PC.newPaddock('x');
        const queue = await this._shopQueue(profile);
        const day = Util.todayISO();
        const doneToday = p.walkins?.day === day ? (p.walkins.done || []) : [];
        const jobs = PC.walkInJobs(`${Auth.uid()}|${day}`, { stars, econ: cfg.econ });
        const specialties = [['repair', 'General repairs'], ['service', 'Servicing'], ...Object.entries(PC.PARTS).map(([id, d]) => [id, d.label])];
        return `<section class="panel">
            <div class="panel-head"><h2>🔧 ${Util.esc(shop.name || `${profile.name}'s Garage`)} ${shop.open ? '<span class="badge badge-green">Open</span>' : '<span class="badge badge-dim">Closed</span>'}</h2>
                ${Paddock.apChip(p)}</div>
            <form id="pd-shop-form" class="form-grid">
                <div class="form-row">
                    <label class="field"><span>Shop name</span><input id="pd-sh-name" class="input" maxlength="40" value="${Util.esc(shop.name || `${profile.name}'s Garage`)}"></label>
                    <label class="field"><span>Speciality</span><select id="pd-sh-spec" class="input">${specialties.map(([id, l]) => `<option value="${id}" ${shop.specialty === id ? 'selected' : ''}>${Util.esc(l)}</option>`).join('')}</select></label>
                    <label class="field"><span>Labour rate ×</span><input id="pd-sh-rate" class="input" type="number" min="0.6" max="1.8" step="0.05" value="${Number(shop.laborMul) || 1}"></label>
                </div>
                <label class="check"><input type="checkbox" id="pd-sh-open" ${shop.open ? 'checked' : ''}> Open for bookings (players see you in the Paddock → Shops list)</label>
                <p class="muted small">Your work quality is ${Math.round(PC.playerShopQuality(stars) * 100)}% at ${Prestige.stars(stars)} — every job earns prestige XP. Customers pay your labour when they book; finish within 2 days or the job completes itself at standard quality.</p>
                <div class="btn-row"><button type="submit" class="btn btn-primary btn-sm">Save shop</button></div>
            </form>
            <h3 class="section-label pd-sec">📋 Bookings (${queue.length})</h3>
            ${queue.length ? queue.map(({ key, car }) => `<div class="race-row"><div class="race-row-main">
                    <span class="race-title">${Util.esc(car.name)} — ${Util.esc(PC.SERVICES[car.job.service]?.label || 'Job')}${car.job.part ? ` · ${PC.TIERS[car.job.tier]?.label || ''} ${Util.esc(PC.PARTS[car.job.part]?.label || '')}` : ''}</span>
                    <span class="race-sub">for ${Util.esc(car.job.customerName || 'a customer')} · labour ${Economy.fmt(car.job.labor)} paid · booked ${Util.esc(Util.fmtDateShort(car.job.bookedOn))}</span></div>
                <div class="btn-row">
                    <button class="btn btn-secondary btn-sm" onclick="PaddockTrade.completeJob('${Util.attr(key)}','${Util.attr(car.id)}',false)">Do it · 1 ⏱</button>
                    <button class="btn btn-primary btn-sm" onclick="PaddockTrade.completeJob('${Util.attr(key)}','${Util.attr(car.id)}',true)">Careful job · 3 ⏱</button></div></div>`).join('')
                : '<p class="muted">No bookings right now. Open the shop and set a fair rate.</p>'}
            <h3 class="section-label pd-sec">🚪 Walk-in customers today</h3>
            <p class="muted small">Diagnose the fault from the symptom. Right answer: full pay, a tip of XP and prestige. Wrong: they pay for your time and leave unhappy.${stars >= 3 ? ' At 3★ you can rule one answer out.' : ''}</p>
            ${jobs.map(j => {
                const done = doneToday.includes(j.id);
                const hint = PC.walkInHint(j, stars);
                return `<div class="pd-walkin ${done ? 'pd-locked' : ''}">
                    <div><strong>${Util.esc(j.owner)}</strong> brings in a ${Util.esc(j.car)}: <em>“${Util.esc(j.symptom)}”</em> <span class="chip chip-dim">${Economy.fmt(j.pay)} · ${j.ap} ⏱</span></div>
                    <div class="btn-row">${done ? '<span class="muted small">Done ✓</span>' : j.options.map(o => `<button class="btn ${o === hint ? 'btn-ghost' : 'btn-secondary'} btn-sm" ${o === hint ? 'disabled title="Ruled out"' : ''} onclick="PaddockTrade.diagnose('${Util.attr(j.id)}','${o}')">${PC.COMPONENTS[o].icon} ${PC.COMPONENTS[o].label}</button>`).join('')}</div>
                </div>`;
            }).join('')}
            <div class="pd-mini-grid" style="margin-top:.8rem">
                <div class="mini-stat"><span class="mini-value">${shop.jobsDone || 0}</span><span class="mini-label">Customer jobs</span></div>
                <div class="mini-stat"><span class="mini-value">${shop.walkIns || 0}</span><span class="mini-label">Walk-ins fixed</span></div>
                <div class="mini-stat"><span class="mini-value">${Math.round(PC.playerShopQuality(stars) * 100)}%</span><span class="mini-label">Work quality</span></div>
            </div>
        </section>`;
    },
    wireMechanicShop(el, profile) {
        const form = Util.$('#pd-shop-form', el);
        if (!form) return;
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const rate = Math.min(1.8, Math.max(0.6, Number(Util.$('#pd-sh-rate').value) || 1));
                await DB.update('roleProfiles', profile.id, {
                    shop: Paddock.json({ ...(profile.shop || {}), name: Util.$('#pd-sh-name').value.trim().slice(0, 40), specialty: Util.$('#pd-sh-spec').value, laborMul: rate, open: Util.$('#pd-sh-open').checked })
                });
                Util.notify('Shop saved. 🔧');
                App.go('career');
            } catch (err) { Util.notify(err.message, 'error'); }
        });
    },

    async _myMechanic() {
        const profiles = await DB.roleProfiles({ force: true }).catch(() => []);
        const rp = profiles.find(p => p.uid === Auth.uid() && p.role === 'mechanic');
        if (!rp) throw new Error('Set up your Mechanic profile first.');
        return rp;
    },

    async completeJob(holderKey, carId, careful) {
        const PC = this.PC;
        try {
            const rp = await this._myMechanic();
            const stars = Prestige.stored(rp);
            const h = Paddock.parseKey(holderKey);
            const ap = careful ? 3 : 1;
            let result = null;
            await Paddock.act(async (p) => {
                Paddock.useAP(p, ap);
                const doc = await Paddock.holderDoc(h);
                const cars = Paddock.carsOf(h, doc).slice();
                const car = cars.find(c => c.id === carId);
                if (!car?.job || car.job.shopProfileId !== rp.id) throw new Error('That job is no longer in your queue.');
                const { car: done, out } = Paddock._finishJob(car, stars, careful, `${Auth.uid()}|job|${car.job.id}`);
                await Paddock.saveCars(h, cars.map(c => c.id === carId ? done : c));
                await DB.update('roleProfiles', rp.id, {
                    shop: Paddock.json({ ...(rp.shop || {}), jobsDone: (Number(rp.shop?.jobsDone) || 0) + 1 }),
                    prestigeXP: Math.round(Number(rp.prestigeXP) || 0) + (careful ? 30 : 15)
                });
                await Paddock._gainXP(p, { mechanical: careful ? 50 : 25 });
                PC.logLine(p, '🔧', `Finished a ${PC.SERVICES[car.job.service]?.label || 'job'} on ${car.job.customerName}'s ${car.name}: ${out.text}`);
                result = out;
            }, { rerender: false });
            if (result) Util.notify(result.result === 'botched' ? `⚠️ ${result.text}` : `🔧 Job done: ${result.text}`);
            App.go('career');
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    async diagnose(jobId, answer) {
        const PC = this.PC;
        try {
            const rp = await this._myMechanic();
            const stars = Prestige.stored(rp);
            const cfg = await Paddock.config();
            const day = Util.todayISO();
            const job = PC.walkInJobs(`${Auth.uid()}|${day}`, { stars, econ: cfg.econ }).find(j => j.id === jobId);
            if (!job) throw new Error('That customer has gone home.');
            let right = false;
            await Paddock.act(async (p) => {
                const done = p.walkins?.day === day ? (p.walkins.done || []) : [];
                if (done.includes(jobId)) throw new Error('Already fixed.');
                Paddock.useAP(p, job.ap);
                right = answer === job.answer;
                const pay = right ? job.pay : Math.round(job.pay * 0.3 / 10) * 10;
                await Economy.adjustWallet(Auth.uid(), pay, '🔧', `Walk-in: ${job.car} (${right ? 'fixed' : 'misdiagnosed'})`);
                p.walkins = { day, done: [...done, jobId] };
                if (right) {
                    await Paddock._gainXP(p, { mechanical: 20 + job.xp });
                    await DB.update('roleProfiles', rp.id, {
                        shop: Paddock.json({ ...(rp.shop || {}), walkIns: (Number(rp.shop?.walkIns) || 0) + 1 }),
                        prestigeXP: Math.round(Number(rp.prestigeXP) || 0) + job.xp
                    });
                }
                PC.logLine(p, right ? '✅' : '❌', `Walk-in ${job.car}: ${right ? `fixed the ${PC.COMPONENTS[job.answer].label.toLowerCase()}` : `it was the ${PC.COMPONENTS[job.answer].label.toLowerCase()}, not the ${PC.COMPONENTS[answer].label.toLowerCase()}`} (${Economy.fmt(pay)})`);
            }, { rerender: false });
            Util.notify(right ? `✅ Spot on — ${Economy.fmt(job.pay)} and a happy customer.` : `❌ It was the ${PC.COMPONENTS[job.answer].label.toLowerCase()}. They paid for your time.`, right ? 'success' : 'info');
            App.go('career');
        } catch (e) { Util.notify(e.message, 'error'); }
    }
};
window.PaddockTrade = PaddockTrade;
