/* ============================================================
   Phoenix SRMPC — Solo Career: the Paddock
   The between-rounds RPG layer, on the same rules as the league
   app (js/paddock-core.js → PaddockCore):
     • a personal garage of road, club and race cars that wear,
       break and get upgraded (separate from your team's race car)
     • new cars, four used lots (hidden faults, inspections,
       haggling), trade-ins and car finance
     • mechanic shops, DIY work and a garage you can build up
     • side events (track days, club races, shows, streams…)
     • paddock decision cards, fans, merch, loans and credit
   Paddock time refills after every round. Money scales with the
   series you race in, so a club racer and a Cup star both feel
   the same pressure. Paddock XP feeds the career's existing
   off-track attributes (marketability, feedback, fitness).

   State: S.paddock (created lazily). All randomness comes from
   PaddockCore.rng seeded by the save id + a paddock sequence, so
   the engine's own seeded RNG (S.rng) is never disturbed.
   Engine hooks: SC.Paddock.afterRound / newSeason (sc-engine.js).
   ============================================================ */
'use strict';

(function (root) {
    const SC = root.SC = root.SC || {};
    const PC = root.PaddockCore;
    const E = () => SC.Engine;
    const PD = {};

    /* ============================================================
       State & helpers
       ============================================================ */
    PD.state = function (S) {
        if (!S.paddock || S.paddock.solo !== 1) {
            const base = PC.ensurePaddock(S.paddock, `solo|${S.id}`);
            S.paddock = {
                ...base, solo: 1, garage: Array.isArray(S.paddock?.garage) ? S.paddock.garage : [],
                lotSalt: 0, lotSold: {}, fanMilestone: 1000, xpBank: { media: 0, mechanical: 0, fitness: 0 },
                cardReady: true
            };
            delete S.paddock.skills; // skills come from the career's attributes
            delete S.paddock.apAt;
            delete S.paddock.sponsors; delete S.paddock.offers; delete S.paddock.offersAt;
            S.paddock.ap = PD.apMax(S);
        }
        const pd = S.paddock;
        if (!Array.isArray(pd.garage)) pd.garage = [];
        if (!pd.xpBank) pd.xpBank = { media: 0, mechanical: 0, fitness: 0 };
        if (!pd.lotSold) pd.lotSold = {};
        if (!pd.card && pd.cardReady) PD._drawCard(S);
        return pd;
    };

    PD.series = (S) => E().seriesDef(S, S.season?.sid || S.player.sid);
    PD.tierSalary = (S) => Math.max(1500, (PD.series(S)?.budget || 50000) * 0.08);
    // Money scale: 1.0 ≈ a mid-level club series. Rewards, fees and card
    // costs scale; car prices are real numbers of their own.
    PD.econ = (S) => PC.util.clamp(PD.tierSalary(S) / 25000, 0.15, 40);
    PD.money = (S, n) => Math.round(n * PD.econ(S) / 10) * 10;

    // Paddock skills derived from the career (driver rating + attributes).
    PD.skills = function (S) {
        const P = S.player;
        const a = P.attrs || {};
        const drive = { lvl: Math.round((Number(P.dr) || 50) / 5), xp: 0 };
        return {
            pace: drive, racecraft: drive, consistency: drive, tyres: drive, wet: drive,
            fitness: { lvl: Math.round((a.fitness || 50) / 5), xp: 0 },
            media: { lvl: Math.round((a.marketability || 40) / 5), xp: 0 },
            mechanical: { lvl: Math.round((a.feedback || 40) / 5), xp: 0 }
        };
    };
    PD.apMax = (S) => PC.apMax(PD.skills(S));
    PD.stars = (S) => PC.util.clamp(1 + Math.floor((Number(S.player.rep) || 0) / 20), 1, 5);
    PD.rng = (S, tag) => { const pd = S.paddock; pd.seq = (Number(pd.seq) || 0) + 1; return PC.rng(`${S.id}|${tag}|${pd.seq}`); };
    PD.when = (S) => `${S.year} · ${S.phase === 'season' ? `R${(S.season?.round || 0) + 1}` : S.phase === 'preseason' ? 'pre-season' : 'off-season'}`;
    PD.log = (S, icon, text) => PC.logLine(S.paddock, icon, text, PD.when(S));
    PD.useAP = function (S, n) {
        const pd = S.paddock;
        if (pd.ap < n) throw new Error(`Not enough paddock time — that takes ${n} ⏱ and you have ${pd.ap}. It refills after every round.`);
        pd.ap -= n;
    };
    const ledger = (S, amount, label) => E()._ledger(S, 'p', amount, label, 'paddock');
    PD.spend = function (S, amount, label) {
        amount = Math.round(Number(amount) || 0);
        if (amount <= 0) return;
        if (S.player.money < amount) throw new Error(`Not enough personal money — ${label} costs ${SC.fmtMoney(amount)} and you have ${SC.fmtMoney(S.player.money)}.`);
        ledger(S, -amount, label);
    };
    PD.earn = (S, amount, label) => { amount = Math.round(Number(amount) || 0); if (amount) ledger(S, amount, label); };

    // Paddock XP nudges the career's attributes: 100 XP = +1 (max 99).
    const XP_ATTR = { media: 'marketability', mechanical: 'feedback', fitness: 'fitness' };
    PD.gainXP = function (S, gains) {
        const pd = S.paddock, P = S.player;
        const ups = [];
        for (const [k, v] of Object.entries(gains || {})) {
            const attr = XP_ATTR[k];
            if (!attr) continue;
            pd.xpBank[k] = (Number(pd.xpBank[k]) || 0) + Math.round(Number(v) || 0);
            while (pd.xpBank[k] >= 100 && (P.attrs[attr] || 0) < 99) {
                pd.xpBank[k] -= 100;
                P.attrs[attr] = Math.min(99, (P.attrs[attr] || 0) + 1);
                ups.push(attr);
            }
            if ((P.attrs[attr] || 0) >= 99) pd.xpBank[k] = 0;
        }
        if (ups.length) PD.log(S, '⬆️', `${[...new Set(ups)].map(a => a[0].toUpperCase() + a.slice(1)).join(', ')} improved`);
        return ups;
    };

    /* ============================================================
       Catalog: road & club cars + this game's series cars
       ============================================================ */
    const ROAD_CARS = [
        { id: 'rc-hatch', name: 'Budget Hatchback', price: 4500, perf: 3, dur: 8, emoji: '🚗' },
        { id: 'rc-roadster', name: 'Used Roadster', price: 9000, perf: 4, dur: 7, emoji: '🚗' },
        { id: 'rc-legends', name: 'Legends Car', price: 16000, perf: 5, dur: 6, emoji: '🏁' },
        { id: 'rc-hothatch', name: 'Hot Hatch', price: 32000, perf: 6, dur: 7, emoji: '🚙' },
        { id: 'rc-coupe', name: 'Track-day Coupé', price: 58000, perf: 7, dur: 7, emoji: '🏎️' },
        { id: 'rc-gt4', name: 'Club GT4 Car', price: 140000, perf: 8, dur: 6, emoji: '🏎️' },
        { id: 'rc-super', name: 'Supercar', price: 320000, perf: 9, dur: 6, emoji: '🏎️' },
        { id: 'rc-hyper', name: 'Hypercar', price: 1800000, perf: 10, dur: 5, emoji: '🏎️' }
    ];
    PD.ROAD_CARS = ROAD_CARS;
    PD.models = function (S) {
        const models = ROAD_CARS.map(m => ({ id: m.id, name: m.name, carId: m.id, price: m.price, stats: { performance: m.perf, durability: m.dur }, emoji: m.emoji }));
        const g = E().gameOf(S);
        const tier = PD.series(S)?.tier || 5;
        (g?.series || []).filter(sd => Math.abs((sd.tier || 5) - tier) <= 1).slice(0, 4).forEach(sd => {
            const make = (sd.makes || [])[0];
            models.push({
                id: `sc-${sd.id}`, name: `${make ? make + ' ' : ''}${sd.car || sd.name}`.slice(0, 60), carId: `sc-${sd.id}`,
                price: PC.util.clamp(Math.round((sd.budget || 100000) * 0.1 / 500) * 500, 6000, 4000000),
                stats: { performance: PC.util.clamp(11 - (sd.tier || 5), 3, 10), durability: 6 }, emoji: g.icon || '🏁', series: sd.name
            });
        });
        return models.sort((a, b) => a.price - b.price);
    };
    PD.lotKey = (S) => `s${S.seasonNo}-r${S.season?.round || 0}-${S.phase === 'postseason' ? 'off' : 'on'}`;
    PD.lot = (S, dealerId) => PC.usedLot(dealerId, { week: PD.lotKey(S), salt: S.paddock.lotSalt || 0, models: PD.models(S) });
    PD.findListing = (S, id) => PD.lot(S, String(id).split('-')[0]).find(l => l.id === id) || null;
    PD.capacity = (S) => PC.garageLevel(S.paddock.garageLevel).slots;
    const newId = (S) => 'pc' + (S.seq++).toString(36);
    const findCar = (S, id) => { const c = S.paddock.garage.find(x => x.id === id); if (!c) throw new Error('That car is gone.'); return c; };
    const replaceCar = (S, car) => { S.paddock.garage = S.paddock.garage.map(c => c.id === car.id ? car : c); };
    const roomCheck = (S) => { if (S.paddock.garage.length >= PD.capacity(S) + 2) throw new Error('No room — sell a car or upgrade your garage first.'); };

    /* ============================================================
       Buying & selling
       ============================================================ */
    PD.buyNew = function (S, modelId, { finance = false, tradeInId = null } = {}) {
        const pd = PD.state(S);
        const m = PD.models(S).find(x => x.id === modelId);
        if (!m) throw new Error('That model is not on sale.');
        const trade = tradeInId ? findCar(S, tradeInId) : null;
        if (trade?.finance) throw new Error('Clear the finance on your trade-in first.');
        if (!trade) roomCheck(S);
        const tradeVal = trade ? PC.tradeInValue(trade) : 0;
        const due = m.price - tradeVal;
        const car = PC.ensureCar({ ...m, id: newId(S), condition: 'new', cond: PC.fullCond(100), races: 0, warranty: 5, boughtAt: PD.when(S), paidPrice: m.price, tag: 'New' });
        if (finance && due > 0) {
            const plan = PC.financePlan(due, { credit: pd.credit, races: 12 });
            PD.spend(S, plan.down, `${m.name} — finance down payment`);
            car.finance = { balance: plan.total, perRace: plan.perRace, racesLeft: plan.races, missed: 0, lender: 'Phoenix Motors Finance', rate: plan.rate };
            PC.addHistory(car, '💳', `Financed: ${SC.fmtMoney(plan.down)} down, ${plan.races} × ${SC.fmtMoney(plan.perRace)}`, PD.when(S));
        } else if (due > 0) PD.spend(S, due, `${m.name} (Phoenix Motors)`);
        else if (due < 0) PD.earn(S, -due, `Trade-in balance: ${trade.name}`);
        PC.addHistory(car, '🏬', `Bought new for ${SC.fmtMoney(m.price)}${trade ? ` (traded in the ${trade.name})` : ''}`, PD.when(S));
        if (trade) pd.garage = pd.garage.filter(c => c.id !== trade.id);
        pd.garage.push(car);
        pd.stats.carsBought += 1;
        PD.log(S, '🏬', `Bought a new ${m.name}${trade ? ` (traded in the ${trade.name})` : ''}${car.finance ? ' on finance' : ''}`);
        return car;
    };

    PD.inspect = function (S, listingId, { diy = false } = {}) {
        const pd = PD.state(S);
        const l = PD.findListing(S, listingId);
        if (!l) throw new Error('That car has left the lot.');
        if (diy) {
            if ((S.player.attrs.feedback || 0) < 40) throw new Error('You need feedback 40+ to inspect a car yourself.');
            PD.useAP(S, 1);
            PD.gainXP(S, { mechanical: 15 });
        } else PD.spend(S, PC.quote(l.car, { service: 'inspect' }, PC.SHOPS.mainst).total, `Pre-purchase inspection — ${l.car.name}`);
        pd.inspected = { ...thisLot(S, pd.inspected), [listingId]: true };
        PD.log(S, '🔍', `Inspected a ${l.car.name}: ${l.car.hidden.length ? l.car.hidden.map(h => h.label).join(', ') : 'clean'}`);
        return l.car.hidden;
    };
    const thisLot = (S, map) => { const k = PD.lotKey(S); return Object.fromEntries(Object.entries(map || {}).filter(([id]) => id.includes(k))); };

    PD.haggle = function (S, listingId, offer) {
        const pd = PD.state(S);
        const l = PD.findListing(S, listingId);
        if (!l) throw new Error('That car has left the lot.');
        if (pd.lotSold[listingId]) throw new Error('Already sold.');
        PD.useAP(S, 1);
        const out = PC.haggle(l, offer, pd.haggle?.[listingId] || {}, { media: S.player.attrs.marketability || 0 });
        const st = { ...out.state };
        if (out.outcome === 'accept') st.deal = out.price;
        pd.haggle = { ...thisLot(S, pd.haggle), [listingId]: st };
        PD.gainXP(S, { media: 6 });
        return out;
    };
    PD.priceFor = (S, l) => { const st = S.paddock.haggle?.[l.id]; return st?.deal || st?.lastCounter || l.asking; };

    PD.buyUsed = function (S, listingId) {
        const pd = PD.state(S);
        const l = PD.findListing(S, listingId);
        if (!l) throw new Error('That car has left the lot.');
        if (pd.lotSold[listingId]) throw new Error('Already sold.');
        roomCheck(S);
        const price = PD.priceFor(S, l);
        const dealer = PC.DEALERS[l.dealer];
        PD.spend(S, price, `${l.car.name} (${dealer.name})`);
        const known = !!pd.inspected?.[listingId];
        const car = PC.ensureCar({ ...(known ? PC.revealedCar(l.car, true) : l.car), id: newId(S), boughtAt: PD.when(S), paidPrice: price, warranty: 0, tag: `${dealer.name} · Used` });
        PC.addHistory(car, dealer.icon, `Bought from ${dealer.name} for ${SC.fmtMoney(price)} (${l.car.races} races on the clock)`, PD.when(S));
        pd.garage.push(car);
        pd.lotSold = { ...thisLot(S, pd.lotSold), [listingId]: true };
        pd.stats.carsBought += 1;
        PD.log(S, '🔑', `Bought a used ${l.car.name} from ${dealer.name} for ${SC.fmtMoney(price)}`);
        return car;
    };

    PD.sellCar = function (S, carId) {
        const pd = PD.state(S);
        const car = findCar(S, carId);
        const back = PC.sellBackValue(car);
        const owed = Number(car.finance?.balance) || 0;
        if (owed > back && S.player.money < owed - back) throw new Error(`You owe ${SC.fmtMoney(owed)} on it — you need ${SC.fmtMoney(owed - back)} more to clear the finance.`);
        pd.garage = pd.garage.filter(c => c.id !== carId);
        PD.earn(S, back - owed, `Sold the ${car.name}${owed ? ' (finance cleared)' : ''}`);
        pd.stats.carsSold += 1;
        PD.log(S, '💵', `Sold the ${car.name} for ${SC.fmtMoney(back)}`);
        return back;
    };
    PD.rename = function (S, carId, nick) { const car = findCar(S, carId); replaceCar(S, { ...car, nick: String(nick || '').trim().slice(0, 24) }); };

    /* ============================================================
       Garage, shops, DIY
       ============================================================ */
    PD.upgradeGarage = function (S) {
        const pd = PD.state(S);
        const next = PC.garageLevel(pd.garageLevel + 1);
        if (next.level === pd.garageLevel) throw new Error('Your garage is already a Pro Facility.');
        PD.spend(S, PD.money(S, next.cost), `Garage upgrade: ${next.name}`);
        pd.garageLevel = next.level;
        PD.log(S, next.icon, `Upgraded your garage to ${next.name}`);
        return next;
    };
    PD.garageCost = (S) => { const n = PC.garageLevel(S.paddock.garageLevel + 1); return n.level === S.paddock.garageLevel ? null : PD.money(S, n.cost); };

    PD.shopJob = function (S, carId, shopId, job) {
        PD.state(S);
        const car = findCar(S, carId);
        const shop = PC.SHOPS[shopId];
        if (!shop) throw new Error('Unknown shop.');
        if ((shop.minStars || 1) > PD.stars(S)) throw new Error(`${shop.name} only works for ${'★'.repeat(shop.minStars)} names.`);
        const q = PC.quote(car, job, shop, { warranty: Number(car.warranty) > 0 });
        if (!q.lines.length) throw new Error('Nothing to do on that car.');
        PD.spend(S, q.total, `${PC.SERVICES[job.service]?.label || 'Shop job'}: ${car.name} @ ${shop.name}`);
        const out = PC.performJob(car, { ...job, shopName: shop.name }, PC.jobQuality(shop, PC.SERVICES[job.service]?.cat || job.part), shop.botch, PD.rng(S, 'shop'));
        replaceCar(S, PC.addHistory(out.car, out.result === 'botched' ? '⚠️' : '🔧', `${shop.name}: ${out.text} (${SC.fmtMoney(q.total)})`, PD.when(S)));
        S.paddock.stats.shopJobs += 1;
        PD.log(S, '🔧', `${shop.name}: ${out.text}`);
        return { ...out, cost: q.total };
    };

    PD.diyJob = function (S, carId, job, careful = false) {
        const pd = PD.state(S);
        const car = findCar(S, carId);
        if (!PC.diyAllowed(job, pd.garageLevel)) throw new Error(`Your ${PC.garageLevel(pd.garageLevel).name} isn't equipped for that.`);
        const mech = S.player.attrs.feedback || 0;
        const q = PC.quote(car, job, null, { diy: { level: pd.garageLevel, mechanical: mech } });
        if (!q.lines.length) throw new Error('Nothing to do there.');
        PD.useAP(S, q.ap + (careful ? 1 : 0));
        PD.spend(S, q.parts, `DIY parts: ${PC.SERVICES[job.service].label} — ${car.name}`);
        const quality = PC.jobQuality(null, null, { diy: { level: pd.garageLevel, mechanical: mech }, careful });
        const out = PC.performJob(car, { ...job, shopName: 'your garage' }, quality, Math.max(0, 0.12 - mech / 1000 - (careful ? 0.04 : 0)), PD.rng(S, 'diy'));
        replaceCar(S, PC.addHistory(out.car, out.result === 'botched' ? '⚠️' : '🪛', `DIY: ${out.text}`, PD.when(S)));
        PD.gainXP(S, { mechanical: 15 + q.ap * 8 });
        pd.stats.diyJobs += 1;
        PD.log(S, '🪛', `DIY on the ${car.name}: ${out.text}`);
        return out;
    };

    /* ============================================================
       Side events & decision cards
       ============================================================ */
    PD.sideEvent = function (S, key, carId) {
        const pd = PD.state(S);
        const ev = PC.SIDE_EVENTS[key];
        if (!ev) throw new Error('Unknown event.');
        if (ev.needsSponsor && !S.player.sponsors.length) throw new Error('You need a personal sponsor for a photo shoot.');
        const car = ev.needsCar ? (pd.garage.find(c => c.id === carId) || pd.garage[0]) : null;
        if (ev.needsCar && !car) throw new Error('This one needs a car from your personal garage.');
        if (PC.eventDone(pd, key, PD.lotKey(S))) throw new Error(`You've already done a ${ev.label.toLowerCase()} this round.`);
        PD.useAP(S, ev.ap);
        PC.markEvent(pd, key, PD.lotKey(S));
        if (ev.fee) PD.spend(S, PD.money(S, ev.fee), `${ev.label} entry`);
        const econ = PD.econ(S);
        const out = PC.runSideEvent(key, { car, skills: PD.skills(S), fans: pd.fans, econ, rating: S.player.dr }, PD.rng(S, 'event-' + key));
        if (out.money > 0) PD.earn(S, out.money, `${ev.label}${out.place ? ` — P${out.place}` : ''}`);
        pd.fans += out.fans;
        PD.gainXP(S, out.xp);
        if (out.sponsorHappy) S.player.sponsors.forEach(sp => { sp.happy = PC.util.clamp((Number(sp.happy) || 60) + out.sponsorHappy, 0, 100); });
        if (car && out.wear) {
            const w = PC.applyRaceWear(car, out.wear.ctx, PD.rng(S, 'event-wear'));
            replaceCar(S, PC.addHistory(w.car, ev.icon, `${ev.label}: ${out.text}`, PD.when(S)));
        }
        pd.stats.sideEvents += 1;
        pd.stats.earned += out.money;
        PD.log(S, ev.icon, `${ev.label}: ${out.text} (+${out.fans} fans${out.money ? `, +${SC.fmtMoney(out.money)}` : ''})`);
        return { ev, out };
    };

    PD._drawCard = function (S) {
        const pd = S.paddock;
        pd.card = PC.drawCard(PD.rng(S, 'card'), { hasCar: pd.garage.length > 0, hasSponsor: (S.player.sponsors || []).length > 0, recent: pd.recentCards });
        pd.cardReady = false;
    };

    PD.playCard = function (S, cardId, choiceId) {
        const pd = PD.state(S);
        if (pd.card !== cardId) throw new Error('That event has already passed.');
        const card = PC.cardById(cardId);
        const choice = card.choices.find(c => c.id === choiceId);
        const car = pd.garage[0] || null;
        const models = PD.models(S).filter(m => m.price <= Math.max(20000, S.player.money * 3));
        const model = choice?.effects?.giftCar ? (models.length ? models[Math.floor(PD.rng(S, 'barn')() * models.length)] : PD.models(S)[0]) : null;
        if (choice?.effects?.giftCar) roomCheck(S);
        const out = PC.resolveCard(cardId, choiceId, PD.rng(S, 'card-resolve'), { carPrice: car?.price || PD.tierSalary(S), model });
        // Cash amounts scale with your series; a barn find is priced off the model.
        const giftPaid = out.giftCar ? out.giftCar.paid : 0;
        const cash = Math.round((out.money + giftPaid) * PD.econ(S) / 10) * 10 - giftPaid;
        if (out.ap < 0) PD.useAP(S, -out.ap);
        if (cash < 0) PD.spend(S, -cash, card.title); else if (cash > 0) PD.earn(S, cash, card.title);
        pd.fans = Math.max(0, pd.fans + out.fans);
        pd.credit = PC.util.clamp(pd.credit + out.credit, 300, 850);
        PD.gainXP(S, out.xp);
        if (out.sponsorHappy) S.player.sponsors.forEach(sp => { sp.happy = PC.util.clamp((Number(sp.happy) || 60) + out.sponsorHappy, 0, 100); });
        if (car && (Object.keys(out.carDamage).length || Object.keys(out.carRepair).length)) {
            const e = PC.ensureCar(car);
            for (const [k, v] of Object.entries(out.carDamage)) e.cond[k] = PC.util.clamp(e.cond[k] - v, 0, 100);
            for (const [k, v] of Object.entries(out.carRepair)) e.cond[k] = PC.util.clamp(v === 100 ? 100 : e.cond[k] + v, 0, 100);
            replaceCar(S, PC.addHistory(e, card.icon, `${card.title}: ${choice.label}`, PD.when(S)));
        }
        if (out.giftCar) {
            const g = PC.addHistory({ ...out.giftCar, id: newId(S), boughtAt: PD.when(S), paidPrice: giftPaid }, '🏚️', `Bought as a barn find for ${SC.fmtMoney(giftPaid)}`, PD.when(S));
            delete g.paid;
            pd.garage.push(g);
        }
        pd.card = null;
        pd.recentCards = [cardId, ...(pd.recentCards || [])].slice(0, 5);
        pd.stats.cardsPlayed += 1;
        PD.log(S, card.icon, `${out.text}${cash ? ` (${cash > 0 ? '+' : '−'}${SC.fmtMoney(Math.abs(cash))})` : ''}`);
        return { ...out, cash };
    };

    /* ============================================================
       Bank
       ============================================================ */
    PD.creditLimit = (S) => Math.round(PC.creditLimit({ stars: PD.stars(S), fans: S.paddock.fans, credit: S.paddock.credit }) * PD.econ(S) / 100) * 100;
    PD.loanTerms = (S, id) => PC.loanTerms(id, { credit: S.paddock.credit, econ: PD.econ(S) });
    PD.takeLoan = function (S, id) {
        const pd = PD.state(S);
        const t = PD.loanTerms(S, id);
        if (!t) throw new Error('Unknown loan.');
        if (t.minStars > PD.stars(S)) throw new Error('The bank wants a bigger name for that one.');
        if (pd.loans.some(l => l.product === id)) throw new Error('You already have that loan.');
        if (pd.loans.reduce((s, l) => s + l.balance, 0) + t.amount > PD.creditLimit(S)) throw new Error('That would take you over your credit limit.');
        pd.loans.push({ id: 'loan' + (S.seq++).toString(36), product: id, label: t.label, principal: t.amount, balance: t.total, perRace: t.perRace, racesLeft: t.races, rate: t.rate });
        PD.earn(S, t.amount, `${t.label} (${Math.round(t.rate * 100)}%)`);
        PD.log(S, '🏦', `Borrowed ${SC.fmtMoney(t.amount)} — ${t.races} × ${SC.fmtMoney(t.perRace)}`);
        return t;
    };
    PD.repayLoan = function (S, loanId) {
        const pd = PD.state(S);
        const l = pd.loans.find(x => x.id === loanId);
        if (!l) throw new Error('Loan not found.');
        const pay = Math.round(l.balance * 0.97);
        PD.spend(S, pay, `Repaid ${l.label}`);
        pd.loans = pd.loans.filter(x => x.id !== loanId);
        pd.credit = PC.util.clamp(pd.credit + 15, 300, 850);
        PD.log(S, '🏦', `Paid off the ${l.label} early`);
        return pay;
    };
    PD.payOffFinance = function (S, carId) {
        PD.state(S);
        const car = findCar(S, carId);
        if (!car.finance) throw new Error('No finance on that car.');
        PD.spend(S, car.finance.balance, `Paid off finance — ${car.name}`);
        replaceCar(S, PC.addHistory({ ...car, finance: null }, '💳', 'Finance paid off', PD.when(S)));
        S.paddock.credit = PC.util.clamp(S.paddock.credit + 10, 300, 850);
        return car.name;
    };

    /* ============================================================
       Engine hooks
       ============================================================ */
    // After every round: paddock time, a new card, merch, repayments,
    // storage, fan milestones. Lines go into the round report.
    PD.afterRound = function (S, report) {
        const pd = PD.state(S);
        const lines = report?.lines || [];
        pd.ap = PD.apMax(S);
        if (!pd.card) PD._drawCard(S);
        // Merch from fans beyond the starting 50.
        const merch = PC.merchFor(pd.fans, PD.econ(S));
        if (merch) PD.earn(S, merch, 'Merch sales');
        // Loans.
        const loans = [];
        for (const l of pd.loans) {
            const pay = Math.min(l.perRace, l.balance);
            ledger(S, -pay, `Loan repayment: ${l.label}`);
            pd.credit = PC.creditAfterPayment(pd.credit, S.player.money);
            const next = { ...l, balance: l.balance - pay, racesLeft: l.racesLeft - 1 };
            if (next.balance > 0) loans.push(next); else { lines.push(`🏦 ${l.label} fully repaid.`); PD.log(S, '🏦', `${l.label} fully repaid`); }
        }
        pd.loans = loans;
        // Car finance, repossession after three missed payments.
        pd.garage = pd.garage.map(c => {
            if (!c.finance) return c;
            const f = { ...c.finance };
            const pay = Math.min(f.perRace, f.balance);
            ledger(S, -pay, `Finance: ${c.name}`);
            f.balance -= pay; f.racesLeft = Math.max(0, f.racesLeft - 1);
            f.missed = S.player.money < 0 ? (Number(f.missed) || 0) + 1 : 0;
            pd.credit = PC.creditAfterPayment(pd.credit, S.player.money);
            if (f.missed >= 3) { lines.push(`🚨 The finance company repossessed your ${c.name}.`); PD.log(S, '🚨', `${c.name} repossessed`); return null; }
            return { ...c, finance: f.balance > 0 ? f : null };
        }).filter(Boolean);
        // Storage for cars beyond the garage's spaces.
        const extra = pd.garage.length - PD.capacity(S);
        if (extra > 0) ledger(S, -PD.money(S, 100) * extra, `Car storage (${extra} over capacity)`);
        // Fan milestones build your reputation.
        while (pd.fans >= (pd.fanMilestone || 1000)) {
            S.player.rep = Math.min(100, (Number(S.player.rep) || 0) + 1);
            lines.push(`📣 ${pd.fanMilestone.toLocaleString('en-US')} fans — your reputation grows.`);
            PD.log(S, '📣', `Fan milestone: ${pd.fanMilestone.toLocaleString('en-US')} fans (+1 reputation)`);
            pd.fanMilestone = (pd.fanMilestone || 1000) * 2;
        }
    };
    PD.newSeason = function (S) {
        const pd = PD.state(S);
        pd.ap = PD.apMax(S);
        if (!pd.card) PD._drawCard(S);
    };

    /* ============================================================
       View — 🅿️ Paddock
       ============================================================ */
    const K = () => SC.UI;
    const App = () => SC.App;
    const esc = (v) => K().esc(v);
    const fmt = (n) => SC.fmtMoney(n);
    const bar = (v) => { v = Math.max(0, Math.min(100, Math.round(Number(v) || 0))); return `<span class="pd-bar"><span class="pd-bar-fill pd-${PC.condTone(v)}" style="width:${v}%"></span></span>`; };
    const condGrid = (car) => { const c = PC.ensureCar(car); return `<div class="pd-cond-grid">${PC.COMP_KEYS.map(k => `<div class="pd-cond-row"><span class="pd-cond-label">${PC.COMPONENTS[k].icon} ${PC.COMPONENTS[k].label}</span>${bar(c.cond[k])}<span class="pd-cond-val pd-${PC.condTone(c.cond[k])}-text">${c.cond[k]}%</span></div>`).join('')}</div>`; };
    const kpis = (car) => { const c = PC.ensureCar(car); return `<span class="pd-kpis"><span>⚡ PI <strong>${PC.pi(c)}</strong></span><span>🛡️ ${PC.reliability(c)}% reliable</span><span>💵 ${fmt(PC.marketValue(car))}</span><span>🏁 ${c.km.toLocaleString('en-US')} km</span></span>`; };
    const parts = (car) => { const p = Object.entries(car.parts || {}); return p.length || car.tune ? `<div class="chip-row pd-parts">${p.map(([id, x]) => `<span class="chip chip-dim">${PC.PARTS[id]?.icon || '🧩'} ${PC.TIERS[x.tier]?.label || ''} ${esc(PC.PARTS[id]?.label || id)}</span>`).join('')}${car.tune ? `<span class="chip chip-dim">📈 Tune ${car.tune}/3</span>` : ''}</div>` : ''; };

    PD._tab = 'overview';
    const TABS = [['overview', '🅿️ Overview'], ['garage', '🚗 Garage'], ['dealers', '🏬 Dealers'], ['shops', '🔧 Shops'], ['events', '🎪 Events'], ['bank', '🏦 Bank']];

    SC.Views = SC.Views || {};
    SC.Views.paddock = async function (el, tab) {
        const S = App().S;
        const pd = PD.state(S);
        tab = TABS.some(t => t[0] === tab) ? tab : (TABS.some(t => t[0] === PD._tab) ? PD._tab : 'overview');
        PD._tab = tab;
        const body = TAB[tab](S, pd);
        el.innerHTML = `<div class="view-head"><div><h1>🅿️ Paddock</h1><p class="muted">Life between rounds: your own cars, side events, the bank — and whatever the paddock throws at you.</p></div>
            <div class="btn-row"><span class="chip sc-money-chip ${K().moneyCls(S.player.money)}">👤 ${fmt(S.player.money)}</span><span class="chip pd-ap-chip" title="Refills after every round">⏱ ${pd.ap}/${PD.apMax(S)}</span><span class="chip">📣 ${pd.fans.toLocaleString('en-US')} fans</span></div></div>
            ${K().tabs(TABS.map(([id, l]) => [id, `${l}${id === 'overview' && pd.card ? ' <span class="pd-dot"></span>' : ''}`]), tab, 'data-pdtab')}
            <div class="sc-tab-body">${body}</div>`;
        K().$$('[data-pdtab]', el).forEach(b => b.addEventListener('click', () => App().go('paddock', b.dataset.pdtab)));
        WIRE(el, S);
    };

    const act = (fn, ok) => App().act(fn, { ok });

    const TAB = {
        overview(S, pd) {
            const card = pd.card ? PC.cardById(pd.card) : null;
            const P = S.player;
            return `<div class="grid-2">
                ${card ? K().panel(`${card.icon} ${esc(card.title)}`, `<p>${esc(card.text)}</p><div class="pd-choices">${card.choices.map(ch => {
                    const cost = ch.money ? fmt(-ch.money * PD.econ(S)) : '';
                    const ap = ch.effects?.ap ? `${-ch.effects.ap} ⏱` : '';
                    const sub = [esc(ch.note || ''), cost, ap].filter(Boolean).join(' · ');
                    return `<button class="btn btn-secondary pd-choice" data-card="${esc(card.id)}" data-choice="${esc(ch.id)}"><strong>${esc(ch.label)}</strong>${sub ? `<span class="muted small">${sub}</span>` : ''}</button>`;
                }).join('')}</div>`, { cls: 'pd-card' })
                    : K().panel('🃏 Paddock events', '<p class="muted">Nothing happening right now — something always turns up after the next round.</p>')}
                ${K().panel('📋 Your paddock', `<div class="pd-mini-grid">
                    <div class="mini-stat"><span class="mini-value">${pd.ap}/${PD.apMax(S)}</span><span class="mini-label">⏱ Paddock time</span></div>
                    <div class="mini-stat"><span class="mini-value">${pd.fans.toLocaleString('en-US')}</span><span class="mini-label">📣 Fans (next milestone ${(pd.fanMilestone || 1000).toLocaleString('en-US')})</span></div>
                    <div class="mini-stat"><span class="mini-value">${pd.fans >= PC.MERCH_FANS ? fmt(PC.merchFor(pd.fans, PD.econ(S))) : '—'}</span><span class="mini-label">🧢 Merch / round${pd.fans < PC.MERCH_FANS ? ` (opens at ${PC.MERCH_FANS.toLocaleString('en-US')} fans)` : ''}</span></div>
                    <div class="mini-stat"><span class="mini-value">${pd.garage.length}/${PD.capacity(S)}</span><span class="mini-label">🚗 Garage</span></div>
                    <div class="mini-stat"><span class="mini-value">${pd.credit}</span><span class="mini-label">📊 Credit score</span></div>
                    <div class="mini-stat"><span class="mini-value">${fmt(pd.loans.reduce((s, l) => s + l.balance, 0))}</span><span class="mini-label">🏦 Owed</span></div>
                </div>
                <p class="muted small">Paddock work trains your off-track attributes: media → marketability ${Math.round(P.attrs.marketability)}, spanners → feedback ${Math.round(P.attrs.feedback)}, events → fitness ${Math.round(P.attrs.fitness)}. Fan milestones raise your reputation.</p>
                <div class="btn-row"><button class="btn btn-secondary btn-sm" data-pdgo="events">🎪 Side events</button><button class="btn btn-secondary btn-sm" data-pdgo="dealers">🏬 Dealers</button><button class="btn btn-ghost btn-sm" data-pdgo-market="training">🏋️ Training</button></div>`)}
                ${K().panel('📜 Paddock log', pd.log.length ? `<div class="pd-log">${pd.log.slice(0, 14).map(l => `<div class="pd-log-row"><span>${l.icon || '•'}</span><span>${esc(l.text)}</span><span class="muted small">${esc(l.at)}</span></div>`).join('')}</div>` : '<p class="muted">Nothing yet.</p>')}
            </div>`;
        },
        garage(S, pd) {
            const lvl = PC.garageLevel(pd.garageLevel);
            const cost = PD.garageCost(S);
            const cars = pd.garage.map(car => {
                const c = PC.ensureCar(car);
                return `<div class="pd-car"><div class="pd-car-media"><div class="driver-hero-num pd-car-emoji" style="font-size:2.4rem;width:100%;height:7rem">${car.emoji || '🚗'}</div></div>
                    <div class="pd-car-body">
                        <div class="pd-car-title"><span class="race-title">${esc(car.nick ? `“${car.nick}” · ${car.name}` : car.name)}</span>
                            ${c.title !== 'clean' ? K().badge(PC.TITLES[c.title].label, 'badge-red') : ''}
                            ${Number(car.warranty) > 0 ? K().badge(`🛡️ Warranty ${car.warranty}`, 'badge-green') : ''}
                            ${car.finance ? K().badge(`💳 ${fmt(car.finance.balance)} owed`, 'badge-blue') : ''}</div>
                        ${kpis(car)}${condGrid(car)}${parts(car)}
                        <div class="btn-row pd-car-actions">
                            <button class="btn btn-primary btn-sm" data-pdshop="${esc(car.id)}">🔧 Service</button>
                            <button class="btn btn-secondary btn-sm" data-pdshop="${esc(car.id)}" data-install="1">🧩 Upgrades</button>
                            <button class="btn btn-secondary btn-sm" data-pddiy="${esc(car.id)}">🪛 DIY</button>
                            <button class="btn btn-ghost btn-sm" data-pdnick="${esc(car.id)}">✎ Name</button>
                            <button class="btn btn-ghost btn-sm" data-pdsell="${esc(car.id)}">Sell ${fmt(PC.sellBackValue(car))}</button>
                        </div></div></div>`;
            }).join('');
            return `${K().panel(`${lvl.icon} ${esc(lvl.name)} — ${pd.garage.length}/${lvl.slots} spaces`, `<p class="muted small">${esc(lvl.desc)} DIY here: ${lvl.diy.map(k => PC.COMPONENTS[k].label.toLowerCase()).join(', ')}${lvl.installs ? ', part installs' : ''}${lvl.tune ? ', dyno tunes' : ''}. Your personal cars are yours — separate from the team's race car — for side events, collecting and flipping.</p>`,
                { actions: cost ? `<button class="btn btn-secondary btn-sm" id="pd-up">⬆️ ${esc(PC.garageLevel(pd.garageLevel + 1).name)} · ${fmt(cost)}</button>` : '' })}
                ${pd.garage.length ? `<div class="pd-car-list">${cars}</div>` : K().empty('🏚', 'No personal cars yet', 'Buy one from the dealers — a cheap hatchback is enough for track days.', '<button class="btn btn-primary" data-pdgo="dealers">🏬 Dealers</button>')}`;
        },
        dealers(S, pd) {
            const dealer = PC.DEALERS[PD._dealer] ? PD._dealer : 'phoenix';
            const pick = `<div class="chip-row" style="margin-bottom:.8rem">${['phoenix', ...PC.USED_DEALERS].map(id => `<button class="chip chip-btn ${id === dealer ? 'chip-active' : ''}" data-pddealer="${id}">${PC.DEALERS[id].icon} ${esc(PC.DEALERS[id].name)}</button>`).join('')}</div>`;
            if (dealer === 'phoenix') {
                const models = PD.models(S);
                return `${pick}${K().panel('🏬 Phoenix Motors', `<p class="muted small">New cars with a 5-round warranty. Finance: 20% down, 12 rounds of payments. Trade in a car for ${Math.round(PC.TRADE_RATIO * 100)}% of its value.</p>
                    <div class="car-grid">${models.map(m => `<div class="car-card"><div class="car-card-body">
                        <span class="race-title">${m.emoji || '🚗'} ${esc(m.name)}</span>
                        <span class="race-sub">${m.series ? `As raced in the ${esc(m.series)}` : 'Road & club car'} · ⚡ PI ${PC.basePI(m)}</span>
                        <span class="market-price">${fmt(m.price)}</span>
                        <div class="btn-row"><button class="btn btn-primary btn-sm" data-pdnew="${esc(m.id)}">🔑 Buy</button><button class="btn btn-ghost btn-sm" data-pdnew="${esc(m.id)}" data-deal="1">💳 Finance / trade</button></div>
                    </div></div>`).join('')}</div>`)}`;
            }
            const d = PC.DEALERS[dealer];
            const lot = PD.lot(S, dealer);
            return `${pick}${K().panel(`${d.icon} ${esc(d.name)}`, `<p class="muted small">${esc(d.tagline)} New stock every round.</p>
                <div class="car-grid">${lot.map(l => {
                    const known = !!pd.inspected?.[l.id];
                    const car = known ? PC.revealedCar(l.car, true) : l.car;
                    const sold = !!pd.lotSold[l.id];
                    const st = pd.haggle?.[l.id];
                    const price = PD.priceFor(S, l);
                    return `<div class="car-card pd-listing ${sold ? 'pd-sold' : ''}"><div class="car-card-body">
                        <span class="race-title">${car.emoji || '🚗'} ${esc(car.name)} ${car.title !== 'clean' ? K().badge(PC.TITLES[car.title].label, 'badge-red') : ''}${sold ? K().badge('SOLD') : ''}</span>
                        <span class="race-sub">“${esc(l.history)}” · ${car.races} races</span>
                        ${kpis(car)}${condGrid(car)}${parts(car)}
                        ${known ? `<p class="small ${l.car.hidden.length ? 'pd-bad-text' : 'pd-good-text'}">🔍 ${l.car.hidden.length ? 'Found: ' + l.car.hidden.map(h => esc(h.label)).join(', ') : 'No hidden faults'}</p>` : ''}
                        <div class="pd-price-row"><span class="market-price">${fmt(price)}</span>${price < l.asking ? `<s class="muted small">${fmt(l.asking)}</s>` : ''}</div>
                        <div class="btn-row">
                            <button class="btn btn-primary btn-sm" data-pdused="${esc(l.id)}" ${sold ? 'disabled' : ''}>🔑 Buy</button>
                            ${d.asIs ? '' : `<button class="btn btn-secondary btn-sm" data-pdhaggle="${esc(l.id)}" ${sold || st?.walked || st?.deal ? 'disabled' : ''}>🤝 Haggle</button>`}
                            ${known ? '' : `<button class="btn btn-ghost btn-sm" data-pdinspect="${esc(l.id)}" ${sold ? 'disabled' : ''}>🔍 Inspect</button>`}
                        </div></div></div>`;
                }).join('')}</div>`)}`;
        },
        shops(S, pd) {
            const stars = PD.stars(S);
            return K().panel('🔧 Mechanic shops', `<p class="muted small">Book work from the Garage tab. Better shops cost more, botch less and leave the car closer to factory fresh. Your reputation (${'★'.repeat(stars)}) opens the exclusive ones.</p>
                <div class="pd-shop-grid">${Object.values(PC.SHOPS).map(s => `<div class="pd-shop ${(s.minStars || 1) > stars ? 'pd-locked' : ''}">
                    <div class="pd-shop-head"><span class="pd-shop-icon">${s.icon}</span><div><strong>${esc(s.name)}</strong><div class="muted small">${esc(s.boss)} — ${esc(s.tagline)}</div></div></div>
                    <div class="chip-row"><span class="chip chip-dim">🎯 ${Math.round(s.quality * 100)}%</span><span class="chip chip-dim">💵 ×${s.priceMul.toFixed(2)}</span><span class="chip chip-dim">⚠️ ${(s.botch * 100).toFixed(1)}% botch</span>${(s.minStars || 1) > stars ? `<span class="chip chip-dim">🔒 ${'★'.repeat(s.minStars)}</span>` : ''}</div>
                </div>`).join('')}</div>`);
        },
        events(S, pd) {
            return K().panel('🎪 Side events', `<p class="muted small">Make money and fans between rounds — each event once per round. Prize money scales with the series you race in. Events with a car wear it.</p>
                ${pd.garage.length ? `<label class="field sc-narrow"><span>Car to take</span>${K().select('pd-ev-car', pd.garage.map(c => [c.id, `${c.nick || c.name} — PI ${PC.pi(c)} · ${PC.overall(c)}%`]), pd.garage[0].id)}</label>` : ''}
                <div class="pd-event-grid">${Object.entries(PC.SIDE_EVENTS).map(([id, ev]) => {
                    const done = PC.eventDone(pd, id, PD.lotKey(S));
                    const blocked = done || (ev.needsCar && !pd.garage.length) || (ev.needsSponsor && !S.player.sponsors.length);
                    return `<div class="pd-event ${blocked ? 'pd-locked' : ''}"><div class="pd-shop-head"><span class="pd-shop-icon">${ev.icon}</span><div><strong>${esc(ev.label)}</strong><div class="muted small">${esc(ev.desc)}</div></div></div>
                        <div class="chip-row"><span class="chip chip-dim">${ev.ap} ⏱</span>${ev.fee ? `<span class="chip chip-dim">${fmt(PD.money(S, ev.fee))} entry</span>` : ''}${ev.needsCar ? '<span class="chip chip-dim">🚗 Your car</span>' : ''}</div>
                        <button class="btn btn-primary btn-sm" data-pdevent="${id}" ${blocked || pd.ap < ev.ap ? 'disabled' : ''}>${done ? 'Done this round ✓' : 'Go'}</button></div>`;
                }).join('')}</div>`);
        },
        bank(S, pd) {
            const owed = pd.loans.reduce((s, l) => s + l.balance, 0);
            const limit = PD.creditLimit(S);
            const fin = pd.garage.filter(c => c.finance);
            return `<div class="grid-2">
                ${K().panel('🏦 Your credit', `<div class="pd-mini-grid"><div class="mini-stat"><span class="mini-value">${pd.credit}</span><span class="mini-label">Credit score</span></div>
                    <div class="mini-stat"><span class="mini-value">${fmt(limit)}</span><span class="mini-label">Credit limit</span></div><div class="mini-stat"><span class="mini-value">${fmt(owed)}</span><span class="mini-label">Owed</span></div></div>
                    <p class="muted small">Repayments come out after every round. Staying in credit builds your score.</p>
                    ${pd.loans.map(l => `<div class="sc-line"><div><strong>${esc(l.label)}</strong><p class="muted small">${fmt(l.balance)} left · ${fmt(l.perRace)}/round · ${l.racesLeft} rounds</p></div><button class="btn btn-secondary btn-sm" data-pdrepay="${esc(l.id)}">Repay now</button></div>`).join('')}
                    ${fin.map(c => `<div class="sc-line"><div><strong>💳 ${esc(c.name)}</strong><p class="muted small">${fmt(c.finance.balance)} left · ${fmt(c.finance.perRace)}/round</p></div><button class="btn btn-secondary btn-sm" data-pdpayoff="${esc(c.id)}">Pay off</button></div>`).join('')}`)}
                ${K().panel('💵 Borrow', Object.values(PC.LOANS).map(L => {
                    const t = PD.loanTerms(S, L.id);
                    const has = pd.loans.some(l => l.product === L.id);
                    const locked = L.minStars > PD.stars(S);
                    const over = owed + t.amount > limit;
                    return `<div class="sc-line"><div><strong>${L.icon} ${esc(L.label)} — ${fmt(t.amount)}</strong><p class="muted small">${Math.round(t.rate * 100)}% · ${t.races} × ${fmt(t.perRace)}${locked ? ` · 🔒 ${'★'.repeat(L.minStars)}` : ''}${over && !locked ? ' · over your limit' : ''}</p></div>
                        <button class="btn btn-primary btn-sm" data-pdloan="${L.id}" ${has || locked || over ? 'disabled' : ''}>${has ? 'Active' : 'Borrow'}</button></div>`;
                }).join(''))}
            </div>`;
        }
    };
    PD._dealer = 'phoenix';

    function WIRE(el, S) {
        const $$ = (s) => K().$$(s, el);
        $$('[data-pdgo]').forEach(b => b.addEventListener('click', () => App().go('paddock', b.dataset.pdgo)));
        $$('[data-pdgo-market]').forEach(b => b.addEventListener('click', () => App().go('market', b.dataset.pdgoMarket)));
        $$('[data-card]').forEach(b => b.addEventListener('click', () => act((S2) => PD.playCard(S2, b.dataset.card, b.dataset.choice),
            (o) => `${o.text}${o.cash ? ` (${o.cash > 0 ? '+' : '−'}${fmt(Math.abs(o.cash))})` : ''}`)));
        K().$('#pd-up', el)?.addEventListener('click', () => act((S2) => PD.upgradeGarage(S2), (n) => `🏗️ Welcome to your ${n.name}!`));
        $$('[data-pddealer]').forEach(b => b.addEventListener('click', () => { PD._dealer = b.dataset.pddealer; App().go('paddock', 'dealers'); }));
        $$('[data-pdnew]').forEach(b => b.addEventListener('click', () => b.dataset.deal ? dealModal(S, b.dataset.pdnew) : act((S2) => PD.buyNew(S2, b.dataset.pdnew), (c) => `🔑 The ${c.name} is yours!`)));
        $$('[data-pdused]').forEach(b => b.addEventListener('click', () => act((S2) => PD.buyUsed(S2, b.dataset.pdused), (c) => `🔑 The ${c.name} is yours.`)));
        $$('[data-pdinspect]').forEach(b => b.addEventListener('click', async () => {
            const diy = (S.player.attrs.feedback || 0) >= 40 && await K().Modal.confirm('Inspect it yourself?', `Use 1 ⏱ of paddock time (feedback ${Math.round(S.player.attrs.feedback)}), or cancel to pay Main Street Auto Care.`, { ok: 'Do it myself' });
            act((S2) => PD.inspect(S2, b.dataset.pdinspect, { diy }), (f) => f.length ? `🔍 Found: ${f.map(x => x.label).join(', ')}` : '🔍 Clean bill of health.');
        }));
        $$('[data-pdhaggle]').forEach(b => b.addEventListener('click', () => haggleModal(S, b.dataset.pdhaggle)));
        $$('[data-pdsell]').forEach(b => b.addEventListener('click', async () => {
            const car = S.paddock.garage.find(c => c.id === b.dataset.pdsell);
            if (await K().Modal.confirm(`Sell the ${esc(car.name)}?`, `The dealer pays ${fmt(PC.sellBackValue(car))}.`, { ok: 'Sell' }))
                act((S2) => PD.sellCar(S2, b.dataset.pdsell), (v) => `Sold for ${fmt(v)}. 💵`);
        }));
        $$('[data-pdnick]').forEach(b => b.addEventListener('click', () => nickModal(S, b.dataset.pdnick)));
        $$('[data-pdshop]').forEach(b => b.addEventListener('click', () => shopModal(S, b.dataset.pdshop, !!b.dataset.install)));
        $$('[data-pddiy]').forEach(b => b.addEventListener('click', () => diyModal(S, b.dataset.pddiy)));
        $$('[data-pdevent]').forEach(b => b.addEventListener('click', () => act((S2) => PD.sideEvent(S2, b.dataset.pdevent, K().$('#pd-ev-car', el)?.value),
            (r) => `${r.ev.icon} ${r.out.text} +${r.out.fans} fans${r.out.money ? ` · +${fmt(r.out.money)}` : ''}`)));
        $$('[data-pdloan]').forEach(b => b.addEventListener('click', () => act((S2) => PD.takeLoan(S2, b.dataset.pdloan), (t) => `🏦 ${fmt(t.amount)} is in your account.`)));
        $$('[data-pdrepay]').forEach(b => b.addEventListener('click', () => act((S2) => PD.repayLoan(S2, b.dataset.pdrepay), (n) => `🏦 Loan cleared for ${fmt(n)}.`)));
        $$('[data-pdpayoff]').forEach(b => b.addEventListener('click', () => act((S2) => PD.payOffFinance(S2, b.dataset.pdpayoff), (n) => `💳 The ${n} is all yours.`)));
    }

    function nickModal(S, carId) {
        const car = S.paddock.garage.find(c => c.id === carId);
        K().Modal.open(`${K().Modal.head(`Name your ${car.name}`)}<form id="pd-nick-form" class="form-grid">
            <label class="field"><span>Nickname</span><input id="pd-nick" class="input" maxlength="24" value="${esc(car.nick || '')}" autofocus></label>
            <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save</button></div></form>`);
        K().$('#pd-nick-form').addEventListener('submit', (e) => { e.preventDefault(); const v = K().$('#pd-nick').value; K().Modal.close(); act((S2) => PD.rename(S2, carId, v), 'Named. 🏁'); });
    }

    function dealModal(S, modelId) {
        const m = PD.models(S).find(x => x.id === modelId);
        const pd = S.paddock;
        K().Modal.open(`${K().Modal.head(`🏬 ${m.name}`, `Phoenix Motors · ${fmt(m.price)} · 5-round warranty`)}
            <form id="pd-deal-form" class="form-grid">
                <label class="field"><span>Trade in</span>${K().select('pd-dl-trade', [['', '— No trade-in —'], ...pd.garage.filter(c => !c.finance).map(c => [c.id, `${c.nick || c.name} — ${fmt(PC.tradeInValue(c))}`])], '')}</label>
                <label class="field"><span>Payment</span>${K().select('pd-dl-pay', [['cash', '💵 Pay in full'], ['finance', '💳 Finance — 20% down, 12 rounds']], 'cash')}</label>
                <div id="pd-dl-sum" class="pd-quote"></div>
                <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">Sign ✍️</button></div></form>`);
        const upd = () => {
            const trade = pd.garage.find(c => c.id === K().$('#pd-dl-trade').value);
            const due = m.price - (trade ? PC.tradeInValue(trade) : 0);
            const plan = K().$('#pd-dl-pay').value === 'finance' && due > 0 ? PC.financePlan(due, { credit: pd.credit }) : null;
            K().$('#pd-dl-sum').innerHTML = `<div class="pd-quote-lines">${trade ? `<div>Trade-in −${fmt(PC.tradeInValue(trade))}</div>` : ''}${plan ? `<div>${plan.races} × ${fmt(plan.perRace)} at ${Math.round(plan.rate * 100)}% (credit ${pd.credit})</div>` : ''}</div>
                <div class="pd-quote-total"><span>Due today</span><strong>${fmt(plan ? plan.down : Math.max(0, due))}</strong></div>`;
        };
        ['#pd-dl-trade', '#pd-dl-pay'].forEach(s => K().$(s).addEventListener('change', upd));
        upd();
        K().$('#pd-deal-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const opts = { tradeInId: K().$('#pd-dl-trade').value || null, finance: K().$('#pd-dl-pay').value === 'finance' };
            K().Modal.close();
            act((S2) => PD.buyNew(S2, modelId, opts), (c) => `🔑 The ${c.name} is yours!`);
        });
    }

    function haggleModal(S, listingId) {
        const l = PD.findListing(S, listingId);
        const cur = PD.priceFor(S, l);
        K().Modal.open(`${K().Modal.head(`🤝 Haggle — ${l.car.name}`, `${PC.DEALERS[l.dealer].name} · current number ${fmt(cur)}`)}
            <form id="pd-hg-form" class="form-grid"><p class="muted small">Each offer takes 1 ⏱. Marketability ${Math.round(S.player.attrs.marketability)} helps.</p>
                <label class="field"><span>Your offer</span><input id="pd-hg-offer" class="input" type="number" min="100" step="50" value="${Math.round(cur * 0.85 / 50) * 50}" autofocus></label>
                <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Walk away</button><button class="btn btn-primary" type="submit">Make the offer</button></div></form>`);
        K().$('#pd-hg-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const offer = Number(K().$('#pd-hg-offer').value);
            K().Modal.close();
            act((S2) => PD.haggle(S2, listingId, offer), (o) => o.outcome === 'accept' ? `${o.line} Agreed at ${fmt(o.price)} — press Buy.` : o.line);
        });
    }

    function shopModal(S, carId, install) {
        const car = S.paddock.garage.find(c => c.id === carId);
        const stars = PD.stars(S);
        const shops = Object.values(PC.SHOPS).filter(s => (s.minStars || 1) <= stars);
        K().Modal.open(`${K().Modal.head(`🔧 Shop work — ${car.nick || car.name}`, 'The quote updates as you pick')}
            <form id="pd-sh-form" class="form-grid">
                <label class="field"><span>Shop</span>${K().select('pd-sh-shop', shops.map(s => [s.id, `${s.icon} ${s.name} — ${Math.round(s.quality * 100)}%, ×${s.priceMul.toFixed(2)}`]), install ? 'apex' : 'mainst')}</label>
                <label class="field"><span>Job</span>${K().select('pd-sh-svc', Object.entries(PC.SERVICES).filter(([id]) => id !== 'inspect').map(([id, s]) => [id, `${s.icon} ${s.label}`]), install ? 'install' : 'service')}</label>
                <div class="form-row" id="pd-sh-partrow">
                    <label class="field"><span>Part</span>${K().select('pd-sh-part', Object.entries(PC.PARTS).map(([id, p]) => [id, `${p.icon} ${p.label}`]), 'intake')}</label>
                    <label class="field"><span>Tier</span>${K().select('pd-sh-tier', [1, 2, 3, 4].map(t => [t, `${PC.TIERS[t].stars} ${PC.TIERS[t].label}`]), 1)}</label></div>
                <div id="pd-sh-q" class="pd-quote"></div>
                <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" id="pd-sh-go">Book it 🔧</button></div></form>`, { wide: true });
        const read = () => ({ shop: PC.SHOPS[K().$('#pd-sh-shop').value], job: { service: K().$('#pd-sh-svc').value, part: K().$('#pd-sh-part').value, tier: Number(K().$('#pd-sh-tier').value) } });
        const upd = () => {
            const { shop, job } = read();
            K().$('#pd-sh-partrow').style.display = job.service === 'install' ? '' : 'none';
            const q = PC.quote(car, job, shop, { warranty: Number(car.warranty) > 0 });
            const after = job.service === 'install' ? PC.performJob(car, job, PC.jobQuality(shop, job.part), 0, PC.rng('preview')).car : null;
            K().$('#pd-sh-q').innerHTML = `<div class="pd-quote-lines">${q.lines.map(l => `<div>${esc(l)}</div>`).join('') || '<div class="muted">Nothing to fix there.</div>'}</div>
                ${after ? `<p class="small">⚡ PI ${PC.pi(car)} → <strong>${PC.pi(after)}</strong></p>` : ''}
                <div class="pd-quote-total"><span>Parts ${fmt(q.parts)} · Labour ${fmt(q.labor)}</span><strong>${fmt(q.total)}</strong></div>`;
            K().$('#pd-sh-go').disabled = !q.lines.length;
        };
        ['#pd-sh-shop', '#pd-sh-svc', '#pd-sh-part', '#pd-sh-tier'].forEach(s => K().$(s).addEventListener('change', upd));
        upd();
        K().$('#pd-sh-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const { shop, job } = read();
            K().Modal.close();
            act((S2) => PD.shopJob(S2, carId, shop.id, job), (o) => `${o.result === 'botched' ? '⚠️' : '🔧'} ${o.text}`);
        });
    }

    function diyModal(S, carId) {
        const car = S.paddock.garage.find(c => c.id === carId);
        const pd = S.paddock;
        const mech = S.player.attrs.feedback || 0;
        K().Modal.open(`${K().Modal.head(`🪛 DIY — ${car.nick || car.name}`, `${PC.garageLevel(pd.garageLevel).name} · feedback ${Math.round(mech)} · ${pd.ap} ⏱`)}
            <form id="pd-diy-form" class="form-grid">
                <label class="field"><span>Job</span>${K().select('pd-dy-svc', Object.entries(PC.SERVICES).filter(([id]) => id !== 'inspect').map(([id, s]) => [id, `${s.icon} ${s.label}`]), 'tyres')}</label>
                <div class="form-row" id="pd-dy-partrow">
                    <label class="field"><span>Part</span>${K().select('pd-dy-part', Object.entries(PC.PARTS).map(([id, p]) => [id, `${p.icon} ${p.label}`]), 'intake')}</label>
                    <label class="field"><span>Tier</span>${K().select('pd-dy-tier', [1, 2, 3, 4].map(t => [t, `${PC.TIERS[t].stars} ${PC.TIERS[t].label}`]), 1)}</label></div>
                <label class="check"><input type="checkbox" id="pd-dy-careful"> Take your time (+1 ⏱, better result)</label>
                <div id="pd-dy-q" class="pd-quote"></div>
                <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" id="pd-dy-go">Get the spanners out 🪛</button></div></form>`, { wide: true });
        const read = () => ({ job: { service: K().$('#pd-dy-svc').value, part: K().$('#pd-dy-part').value, tier: Number(K().$('#pd-dy-tier').value) }, careful: K().$('#pd-dy-careful').checked });
        const upd = () => {
            const { job, careful } = read();
            K().$('#pd-dy-partrow').style.display = job.service === 'install' ? '' : 'none';
            const ok = PC.diyAllowed(job, pd.garageLevel);
            const q = PC.quote(car, job, null, { diy: { level: pd.garageLevel, mechanical: mech } });
            const ap = q.ap + (careful ? 1 : 0);
            K().$('#pd-dy-q').innerHTML = ok ? `<div class="pd-quote-lines">${q.lines.map(l => `<div>${esc(l)}</div>`).join('') || '<div class="muted">Nothing to do.</div>'}</div>
                <div class="pd-quote-total"><span>Parts ${fmt(q.parts)} · ${ap} ⏱</span><strong>${fmt(q.parts)}</strong></div>` : '<p class="pd-bad-text small">Your garage isn\'t equipped for that — upgrade it or book a shop.</p>';
            K().$('#pd-dy-go').disabled = !ok || !q.lines.length || ap > pd.ap;
        };
        ['#pd-dy-svc', '#pd-dy-part', '#pd-dy-tier', '#pd-dy-careful'].forEach(s => K().$(s).addEventListener('change', upd));
        upd();
        K().$('#pd-diy-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const { job, careful } = read();
            K().Modal.close();
            act((S2) => PD.diyJob(S2, carId, job, careful), (o) => `${o.result === 'botched' ? '⚠️' : '🪛'} ${o.text}`);
        });
    }

    SC.Paddock = PD;
})(typeof window !== 'undefined' ? window : globalThis);
