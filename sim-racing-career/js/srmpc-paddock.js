/* ============================================================
   Phoenix SRMPC — The Paddock (league app)
   Everything players do BETWEEN races, on top of the shared
   rules in js/paddock-core.js (PaddockCore):

     🅿️ Overview   paddock time, decision cards, next race, log
     🚗 Garage     condition, upgrades, race car, DIY work, selling
     🔧 Shops      NPC mechanic shops + player-run shops
     💰 Sponsors   personal + team sponsor offers, objectives,
                   happiness, appearance requests, renewals
     🏋️ Training   eight RPG skills with XP, levels and perks
     🎪 Events     track days, club races, shows, streams…
     🏦 Bank       loans, credit score, car finance

   Storage — no new Firestore collections (so nothing needs a
   rules deploy):
     users/{uid}.paddock        the player's paddock state
     users/{uid}.garage[]       personal cars (extended entries)
     teams/{id}.garage[]        team cars;  teams/{id}.paddock
                                (team sponsors + workshop level)
     roleProfiles/{id}.lot[]    a Car Dealer's stock
     roleProfiles/{id}.shop     a Mechanic's shop
     config/paddock             GM knobs + the used-lot sold list
   Paddock state is written with DB.update (whole-field replace)
   so deleted map keys never linger the way a deep set-merge
   would leave them. Wallet changes always go through Economy /
   Wallet in their own writes (firestore.rules userWriteOk).

   Race day: Sim.payoutRace calls Paddock.settleRace — car wear,
   sponsor pay + objectives, loan and finance installments, merch,
   storage fees, XP, fans and a paddock-time refill for everyone
   who raced.
   ============================================================ */
'use strict';

const Paddock = {
    PC: window.PaddockCore,
    _tab: 'overview',
    _holder: null,           // garage tab: which holder key is open
    _cfg: null, _cfgAt: 0,

    DEFAULTS: {
        enabled: true,       // master switch
        apBase: 10,          // paddock time cap (before fitness perks)
        apPerDay: 4,         // daily regeneration
        wearMult: 1,         // car wear per race
        econ: 1,             // money scale for sponsors, events, shops
        gremlins: true,      // pre-race mechanical failure orders
        storageFee: 100,     // per extra car over garage capacity, per race
        lotSalt: 0,          // bump to restock every used lot immediately
        usedSold: {}         // { listingId: uid } — this week's sold used cars
    },

    /* ============================================================
       Config
       ============================================================ */
    async config(force = false) {
        if (!force && this._cfg && Date.now() - this._cfgAt < 30000) return this._cfg;
        let doc = null;
        try { doc = await DB.get('config', 'paddock', { force: true }); } catch (e) { /* defaults */ }
        this._cfg = { ...this.DEFAULTS, ...(doc || {}) };
        this._cfgAt = Date.now();
        return this._cfg;
    },
    async saveConfig(patch) {
        await DB.set('config', 'paddock', patch);
        this._cfg = null;
    },

    /* ============================================================
       My paddock state
       ============================================================ */
    stateOf(userDoc, cfg = this._cfg || this.DEFAULTS, uid = userDoc?.id) {
        const PC = this.PC;
        const p = PC.ensurePaddock(userDoc?.paddock, uid || 'anon');
        const max = PC.apMax(p.skills, Number(cfg.apBase) || PC.AP_BASE);
        const regen = PC.regenAP(p.ap, p.apAt, { max, perDay: Number(cfg.apPerDay) || 4 });
        p.ap = regen.ap; p.apAt = regen.apAt; p.apMax = max;
        return p;
    },
    // Firestore rejects undefined field values (the test shim silently drops
    // them) — every map we write whole goes through a JSON round-trip first.
    json(o) { return JSON.parse(JSON.stringify(o ?? null)); },
    _clean(p) {
        const out = { ...p };
        delete out.apMax;
        return JSON.parse(JSON.stringify(out));
    },
    async save(p) {
        await DB.update('users', Auth.uid(), { paddock: this._clean(p) });
        await Auth.reloadProfile();
    },
    useAP(p, n) {
        n = Math.max(0, Math.round(Number(n) || 0));
        if (p.ap < n) throw new Error(`Not enough paddock time — that takes ${n} ⏱ and you have ${p.ap}. It refills after every race you run (and ${this._cfg?.apPerDay ?? 4} a day).`);
        p.ap -= n;
    },
    rngFor(p, tag) { return this.PC.nextRng(p, Auth.uid(), tag); },
    // A paddock "week" ends with the calendar week or the next race you run.
    weekId(p) { return `${this.PC.weekKey()}|${Number(p.raceWeek) || 0}`; },

    // Run a mutation against fresh state: reload, mutate, save, re-render.
    async act(fn, { ok = null, rerender = true } = {}) {
        try {
            const cfg = await this.config();
            await Auth.reloadProfile();
            const p = this.stateOf(Auth.state.profile, cfg, Auth.uid());
            const res = await fn(p, cfg);
            if (res !== false) await this.save(p);
            if (ok) Util.notify(typeof ok === 'function' ? ok(res) : ok);
            if (rerender) this.refresh();
            return res;
        } catch (e) {
            Util.notify(e.message || String(e), 'error');
            return undefined;
        }
    },
    refresh() {
        if (App.current.view === 'paddock') App.go('paddock', this._tab);
        else if (App.current.view === 'dealership' || App.current.view === 'career') App.go(App.current.view, App.current.param);
        App.refreshPaddockBadge?.();
    },

    /* ============================================================
       Car holders — personal garage, team garage, dealer lot
       key: 'user__<uid>' | 'team__<id>' | 'lot__<roleProfileId>'
       ============================================================ */
    key(type, id) { return `${type}__${id}`; },
    parseKey(k) { const i = String(k).indexOf('__'); return { type: k.slice(0, i), id: k.slice(i + 2) }; },

    async holderDoc(h) {
        if (h.type === 'user') return h.id === Auth.uid() ? Auth.state.profile : DB.get('users', h.id, { force: true });
        if (h.type === 'team') return DB.get('teams', h.id, { force: true });
        return DB.get('roleProfiles', h.id, { force: true });
    },
    carsOf(h, doc) {
        if (!doc) return [];
        return Array.isArray(h.type === 'lot' ? doc.lot : doc.garage) ? (h.type === 'lot' ? doc.lot : doc.garage) : [];
    },
    async loadCars(h) {
        if (h.type === 'user' && h.id === Auth.uid()) await Auth.reloadProfile();
        const doc = await this.holderDoc(h);
        return { doc, cars: this.carsOf(h, doc).slice() };
    },
    async saveCars(h, cars) {
        cars = JSON.parse(JSON.stringify(cars));
        if (h.type === 'user') {
            if (h.id === Auth.uid()) await Garage.persistPlayerGarage(cars);
            else await DB.update('users', h.id, { garage: cars, garageCarIds: Garage.flatIds(cars) });
        } else if (h.type === 'team') await Garage.persistTeamGarage(h.id, cars);
        else await DB.update('roleProfiles', h.id, { lot: cars });
    },
    // Pay from the holder's wallet (throws on insufficient funds).
    async spendFor(h, amount, label, icon = '💸') {
        amount = Math.round(Number(amount) || 0);
        if (amount <= 0) return;
        if (h.type === 'team') return Wallet.teamSpend(h.id, amount, label, icon);
        return Economy.spend(amount, label, icon);
    },
    async creditFor(h, amount, label, icon = '💵') {
        amount = Math.round(Number(amount) || 0);
        if (!amount) return;
        if (h.type === 'team') return Wallet.adjustTeamWallet(h.id, amount, icon, label);
        return Economy.adjustWallet(Auth.uid(), amount, icon, label);
    },
    walletFor(h) { return h.type === 'team' ? { type: 'team', id: h.id } : { type: 'player', id: Auth.uid() }; },
    balanceFor(h) { return h.type === 'team' ? Wallet.teamBalance(h.id) : Economy.balance(); },

    // Every holder the signed-in player manages.
    async myHolders(world) {
        const out = [];
        if (!Auth.isPlayer() && !(Auth.isAdmin() && Auth.state.profile)) return out;
        const uid = Auth.uid();
        if (!uid) return out;
        out.push({ type: 'user', id: uid, label: 'My garage', icon: '🏠' });
        const team = (world || await DB.loadWorld()).teams.find(t => t.ownerUid === uid);
        if (team) out.push({ type: 'team', id: team.id, label: team.name, icon: '🏢', team });
        const profiles = await DB.roleProfiles().catch(() => []);
        const dealer = profiles.find(p => p.uid === uid && p.role === 'car-dealer');
        if (dealer) out.push({ type: 'lot', id: dealer.id, label: dealer.dealer?.name || `${dealer.name}'s lot`, icon: '🚘', profile: dealer });
        return out;
    },

    // Garage capacity for a holder (personal level, team workshop ×2, dealer lot).
    capacity(h, doc, ctx = {}) {
        const PC = this.PC;
        if (h.type === 'team') return PC.garageLevel(doc?.paddock?.garageLevel || 1).slots * 2;
        if (h.type === 'lot') return PC.lotCapacity(ctx.stars || Prestige.stored(doc || {}));
        return PC.garageLevel(ctx.p?.garageLevel || doc?.paddock?.garageLevel || 1).slots;
    },
    levelOf(h, doc, p) {
        if (h.type === 'team') return Number(doc?.paddock?.garageLevel) || 1;
        if (h.type === 'user') return Number((p || doc?.paddock)?.garageLevel) || 1;
        return 3; // dealers recondition stock in a basic workshop
    },

    /* ============================================================
       Shared bits of UI
       ============================================================ */
    bar(v, { label = '', compact = false } = {}) {
        v = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
        return `<span class="pd-bar ${compact ? 'pd-bar-sm' : ''}" title="${Util.esc(label)} ${v}% — ${this.PC.condLabel(v)}"><span class="pd-bar-fill pd-${this.PC.condTone(v)}" style="width:${v}%"></span></span>`;
    },
    condGrid(car) {
        const PC = this.PC;
        const c = PC.ensureCar(car);
        return `<div class="pd-cond-grid">${PC.COMP_KEYS.map(k => `
            <div class="pd-cond-row"><span class="pd-cond-label">${PC.COMPONENTS[k].icon} ${PC.COMPONENTS[k].label}</span>
                ${this.bar(c.cond[k], { label: PC.COMPONENTS[k].label })}<span class="pd-cond-val pd-${PC.condTone(c.cond[k])}-text">${c.cond[k]}%</span></div>`).join('')}
        </div>`;
    },
    partChips(car) {
        const PC = this.PC;
        const parts = Object.entries(car.parts || {});
        const chips = parts.map(([pid, p]) => `<span class="chip chip-dim" title="${Util.esc(PC.PARTS[pid]?.desc || '')}">${PC.PARTS[pid]?.icon || '🧩'} ${PC.TIERS[p.tier]?.label || ''} ${Util.esc(PC.PARTS[pid]?.label || pid)}${p.eff && p.eff < 0.95 ? ` (${Math.round(p.eff * 100)}%)` : ''}</span>`);
        if (Number(car.tune)) chips.push(`<span class="chip chip-dim">📈 Dyno tune ${car.tune}/3</span>`);
        return chips.length ? `<div class="chip-row pd-parts">${chips.join('')}</div>` : '';
    },
    carThumb(car) {
        return CarImg.normalize(car.imageUrl) ? CarImg.thumb(car.imageUrl, car.name)
            : `<div class="driver-hero-num pd-car-emoji">${car.emoji || '🚗'}</div>`;
    },
    apChip(p) {
        return `<span class="chip pd-ap-chip" title="Paddock time — spent on training, events and DIY work. Refills after every race you run.">⏱ ${p.ap}/${p.apMax ?? this.PC.AP_BASE}</span>`;
    },
    carKpis(car) {
        const PC = this.PC;
        const c = PC.ensureCar(car);
        return `<span class="pd-kpis">
            <span title="Performance index (1–100)">⚡ PI <strong>${PC.pi(c)}</strong></span>
            <span title="Chance of finishing a race without a mechanical failure">🛡️ ${PC.reliability(c)}% reliable</span>
            <span title="What a buyer would pay today">💵 ${Economy.fmt(PC.marketValue(car))}</span>
            <span>🏁 ${c.races} race${c.races === 1 ? '' : 's'}${c.km ? ` · ${c.km.toLocaleString('en-US')} km` : ''}</span>
        </span>`;
    },

    /* ============================================================
       Main view
       ============================================================ */
    TABS: [['overview', '🅿️ Overview'], ['garage', '🚗 Garage'], ['shops', '🔧 Shops'], ['sponsors', '💰 Sponsors'],
        ['training', '🏋️ Training'], ['events', '🎪 Events'], ['bank', '🏦 Bank']],

    async render(el, tab) {
        if (tab) this._tab = tab;
        if (!this.TABS.some(([id]) => id === this._tab)) this._tab = 'overview';
        if (!Auth.isSignedIn()) { el.innerHTML = C.empty('🔒', 'Sign in to enter the paddock', 'Players spend the time between races here.'); return; }
        const profile = Auth.state.profile;
        if (!profile || Auth.state.user?.isAnonymous) {
            el.innerHTML = `<div class="view-head"><div><h1>🅿️ Paddock</h1></div></div>
                ${C.empty('🅿️', 'The paddock is for players', 'Game Masters tune it from Admin → 🅿️ Paddock. Sign in with a player account to use it.',
                    Auth.isAdmin() ? `<button class="btn btn-primary" onclick="App.go('admin','paddock')">Open Admin → Paddock</button>` : '')}`;
            return;
        }
        const cfg = await this.config(true);
        if (!cfg.enabled) {
            el.innerHTML = `<div class="view-head"><div><h1>🅿️ Paddock</h1></div></div>${C.empty('🚧', 'The paddock is closed', 'The Game Master has switched the between-race paddock off for this league.')}`;
            return;
        }
        if (!profile.walletInitialized) {
            el.innerHTML = `<div class="view-head"><div><h1>🅿️ Paddock</h1></div></div>${C.empty('🎮', 'Start your career first', 'Pick a difficulty (it sets your starting money), then come back to the paddock.',
                `<button class="btn btn-primary" onclick="App.go('career')">Go to My Career</button>`)}`;
            return;
        }
        const world = await DB.loadWorld();
        await Auth.reloadProfile();
        const p = this.stateOf(Auth.state.profile, cfg, Auth.uid());
        const ctx = await this._ctx(world, cfg, p);
        // First visit: from now on the garage's capacity (and storage fees)
        // apply — the player has seen them.
        const firstVisit = !p.seen;
        p.seen = true;
        if (await this._housekeeping(ctx) || firstVisit) await this.save(p);

        const t = this._tab;
        let body = '';
        try { body = await this['tab_' + t](ctx); }
        catch (e) { console.error(e); body = C.empty('⚠️', 'Could not load this part of the paddock', e.message); }

        el.innerHTML = `
        <div class="view-head">
            <div><h1>🅿️ Paddock</h1><p class="muted">Between races: fix and upgrade your cars, chase sponsors, train, and make your name.</p></div>
            <div class="btn-row">${Economy.walletChip()}${ctx.team ? `<span class="chip wallet-chip wallet-chip-team">🏢 ${Economy.fmt(Wallet.teamBalance(ctx.team.id))}</span>` : ''}
                ${this.apChip(p)}<span class="chip" title="Fans — they buy merch and attract sponsors">📣 ${p.fans.toLocaleString('en-US')} fans</span>
                ${ctx.driver ? `<span class="chip rating-chip" title="Driver rating from your skills">⭐ ${this.PC.ratingFromSkills(p.skills)}</span>` : ''}</div>
        </div>
        <div class="tab-row tab-row-wrap pd-tabs">
            ${this.TABS.map(([id, label]) => `<button class="tab ${t === id ? 'active' : ''}" data-pd-tab="${id}">${label}${id === 'overview' && p.card ? ' <span class="pd-dot"></span>' : ''}${id === 'sponsors' && p.sponsors.some(s => s.request) ? ' <span class="pd-dot"></span>' : ''}</button>`).join('')}
        </div>
        ${body}`;
        Util.$$('[data-pd-tab]', el).forEach(b => b.addEventListener('click', () => App.go('paddock', b.dataset.pdTab)));
        this['wire_' + t]?.(el, ctx);
    },

    async _ctx(world, cfg, p) {
        const profile = Auth.state.profile;
        const uid = Auth.uid();
        const driver = profile.driverId ? world.driversById[profile.driverId] || null : null;
        const team = world.teams.find(t => t.ownerUid === uid) || null;
        const profiles = await DB.roleProfiles({ force: true }).catch(() => []);
        const mine = profiles.filter(rp => rp.uid === uid);
        const stars = driver ? Prestige.driverStars(driver.id, world) : Math.max(1, ...mine.map(rp => Prestige.stored(rp)), 1);
        return {
            world, cfg, p, profile, uid, driver, team, profiles,
            dealer: mine.find(rp => rp.role === 'car-dealer') || null,
            mechanic: mine.find(rp => rp.role === 'mechanic') || null,
            stars, teamStars: team ? Prestige.teamStars(team.id, world) : 1,
            holders: await this.myHolders(world)
        };
    },

    // Lazy upkeep on every visit: a fresh decision card, sponsor offers,
    // finishing player-shop jobs that have waited too long.
    async _housekeeping(ctx) {
        const PC = this.PC, p = ctx.p;
        let changed = false;
        const now = Date.now();
        // Decision card: one after every race you run, or every 2 days.
        if (!p.card && (p.cardReady || now - (Number(p.cardAt) || 0) > 2 * 86400000)) {
            const garage = Market.myGarage();
            const r = this.rngFor(p, 'card');
            p.card = PC.drawCard(r, { hasCar: garage.length > 0, hasSponsor: p.sponsors.length > 0, recent: p.recentCards });
            p.cardAt = now; p.cardReady = false;
            changed = true;
        }
        // Sponsor offers refresh after each race (offersAt reset) or every 3 days.
        if (ctx.driver && (!p.offersAt || now - p.offersAt > 3 * 86400000)) {
            this._refreshOffers(p, ctx);
            changed = true;
        }
        // Player-shop jobs that sat 48h finish at standard quality (writes the
        // cars itself; the paddock state is untouched).
        try { await this._autoCompleteMyJobs(ctx); } catch (e) { console.warn('Job auto-complete failed:', e); }
        return changed;
    },

    _refreshOffers(p, ctx) {
        const PC = this.PC;
        const brands = this._brandPool(ctx);
        const keep = p.offers.filter(o => o.renewal);
        const fresh = PC.sponsorOffers(this.rngFor(p, 'offers'), {
            kind: 'driver', stars: ctx.stars, fans: p.fans, media: PC.skillValue(p.skills.media), econ: ctx.cfg.econ,
            brands, skills: p.skills, count: 3 + (PC.hasPerk(p.skills, 'media', 10) ? 1 : 0),
            taken: [...p.sponsors.map(s => s.brand), ...keep.map(o => o.brand)], industries: p.sponsors.map(s => s.industry)
        });
        p.offers = [...keep, ...fresh];
        p.offersAt = Date.now();
    },
    _brandPool(ctx) {
        const pool = [];
        const seen = new Set();
        const push = (b) => { const k = String(b.name || '').toLowerCase(); if (k && !seen.has(k)) { seen.add(k); pool.push({ name: b.name, industry: b.industry || 'General', minStars: Number(b.minStars) || 1 }); } };
        (typeof SPONSOR_BRANDS !== 'undefined' ? SPONSOR_BRANDS : []).forEach(push);
        (window.SC?.BRANDS || []).forEach(push);
        this.PC.FALLBACK_BRANDS.forEach(push);
        return pool;
    },

    /* ============================================================
       🅿️ Overview
       ============================================================ */
    async tab_overview(ctx) {
        const PC = this.PC, p = ctx.p;
        const card = p.card ? PC.cardById(p.card) : null;
        const garage = Market.myGarage();
        const raceCar = garage.find(c => c.id === p.raceCar) || garage[0] || null;
        let next = null;
        try {
            const mine = (await DB.signups()).filter(s => s.uid === ctx.uid);
            next = ctx.world.races.filter(r => r.status !== 'completed' && r.status !== 'cancelled' && mine.some(s => s.raceId === r.id))
                .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))[0] || null;
        } catch (e) { /* signups need auth */ }
        const income = p.sponsors.reduce((s, d) => s + (Number(d.perRace) || 0), 0);
        const loanDue = p.loans.reduce((s, l) => s + (Number(l.perRace) || 0), 0);
        const financeDue = garage.reduce((s, c) => s + (Number(c.finance?.perRace) || 0), 0);
        const vals = PC.skillValues(p.skills);

        const cardHtml = card ? `
            <section class="panel pd-card">
                <div class="panel-head"><h2>${card.icon} ${Util.esc(card.title)}</h2><span class="chip chip-dim">Paddock event</span></div>
                <p>${Util.esc(card.text)}</p>
                <div class="pd-choices">${card.choices.map(ch => {
                    const cost = ch.money ? Economy.fmt(-ch.money) : ch.moneyShare ? `≈${Economy.fmt(-ch.moneyShare * PC.costBase(raceCar || {}))}` : '';
                    const ap = ch.effects?.ap ? `${-ch.effects.ap} ⏱` : '';
                    const sub = [Util.esc(ch.note || ''), cost, ap].filter(Boolean).join(' · ');
                    return `<button class="btn btn-secondary pd-choice" onclick="Paddock.playCard('${Util.attr(card.id)}','${Util.attr(ch.id)}')">
                        <strong>${Util.esc(ch.label)}</strong>${sub ? `<span class="muted small">${sub}</span>` : ''}</button>`;
                }).join('')}</div>
            </section>` : `
            <section class="panel pd-card pd-card-empty">
                <div class="panel-head"><h2>🃏 Paddock events</h2></div>
                <p class="muted">Nothing happening right now. A new paddock event turns up after every race you run (or every couple of days).</p>
            </section>`;

        return `
        <div class="grid-2">
            ${cardHtml}
            <section class="panel">
                <div class="panel-head"><h2>🏁 Next race</h2>${next ? `<button class="btn btn-ghost btn-sm" onclick="Views.showRace('${Util.attr(next.id)}')">Briefing →</button>` : ''}</div>
                ${next ? `<div class="race-row" onclick="Views.showRace('${Util.attr(next.id)}')"><div class="race-row-main">
                        <span class="race-title">${Util.esc(next.name || next.track || 'Race')}</span>
                        <span class="race-sub">${Util.esc(Util.fmtDate(next.date))}${next.track ? ' · ' + Util.esc(next.track) : ''}</span></div></div>`
                    : `<p class="muted">You're not entered in anything yet. <a href="#" onclick="App.go('races');return false">Find a race →</a></p>`}
                ${raceCar ? `
                    <h3 class="section-label pd-sec">⭐ Race car — ${Util.esc(raceCar.nick || raceCar.name)}</h3>
                    ${this.carKpis(raceCar)}
                    ${this.condGrid(raceCar)}
                    <div class="btn-row" style="margin-top:.6rem">
                        <button class="btn btn-primary btn-sm" onclick="Paddock.bookModal('${Util.attr(this.key('user', ctx.uid))}','${Util.attr(raceCar.id)}')">🔧 Service it</button>
                        <button class="btn btn-ghost btn-sm" onclick="App.go('paddock','garage')">Garage →</button>
                    </div>`
                    : `<p class="muted small" style="margin-top:.6rem">No car in your garage. <a href="#" onclick="App.go('dealership');return false">Visit the Dealership →</a></p>`}
            </section>
            <section class="panel">
                <div class="panel-head"><h2>📋 Your paddock</h2></div>
                <div class="pd-mini-grid">
                    <div class="mini-stat"><span class="mini-value">${p.ap}/${p.apMax}</span><span class="mini-label">⏱ Paddock time</span></div>
                    <div class="mini-stat"><span class="mini-value">${p.fans.toLocaleString('en-US')}</span><span class="mini-label">📣 Fans</span></div>
                    <div class="mini-stat"><span class="mini-value">${p.fans >= PC.MERCH_FANS ? Economy.fmt(PC.merchFor(p.fans, ctx.cfg.econ)) : '—'}</span><span class="mini-label">🧢 Merch / race${p.fans < PC.MERCH_FANS ? ` (opens at ${PC.MERCH_FANS.toLocaleString('en-US')} fans)` : ''}</span></div>
                    <div class="mini-stat"><span class="mini-value">${Economy.fmt(income)}</span><span class="mini-label">💰 Sponsors / race</span></div>
                    <div class="mini-stat"><span class="mini-value">${Economy.fmt(loanDue + financeDue)}</span><span class="mini-label">🏦 Repayments / race</span></div>
                    <div class="mini-stat"><span class="mini-value">${p.credit}</span><span class="mini-label">📊 Credit score</span></div>
                </div>
                <h3 class="section-label pd-sec">Skills</h3>
                <div class="pd-skill-strip">${PC.SKILL_KEYS.map(k => `<span class="chip chip-dim" title="${Util.esc(PC.SKILLS[k].desc)}">${PC.SKILLS[k].icon} ${vals[k]}</span>`).join('')}</div>
                <div class="btn-row" style="margin-top:.6rem">
                    <button class="btn btn-secondary btn-sm" onclick="App.go('paddock','training')">🏋️ Train</button>
                    <button class="btn btn-secondary btn-sm" onclick="App.go('paddock','events')">🎪 Side events</button>
                    <button class="btn btn-secondary btn-sm" onclick="App.go('paddock','sponsors')">💰 Sponsors</button>
                </div>
            </section>
            <section class="panel">
                <div class="panel-head"><h2>📜 Paddock log</h2></div>
                ${p.log.length ? `<div class="pd-log">${p.log.slice(0, 14).map(l => `<div class="pd-log-row"><span>${l.icon || '•'}</span><span>${Util.esc(l.text)}</span><span class="muted small">${Util.esc(Util.fmtDateShort(l.at))}</span></div>`).join('')}</div>`
                    : C.empty('📜', 'Nothing yet', 'Training, side events, shop visits and race-day paddock news land here.')}
            </section>
        </div>`;
    },

    async playCard(cardId, choiceId) {
        const PC = this.PC;
        await this.act(async (p) => {
            if (p.card !== cardId) throw new Error('That event has already passed.');
            const garage = Market.myGarage();
            const car = garage.find(c => c.id === p.raceCar) || garage[0] || null;
            const card = PC.cardById(cardId);
            const choice = card.choices.find(c => c.id === choiceId);
            // Price the barn-find model from the catalog when there is one.
            let model = null;
            if (choice?.effects?.giftCar) {
                const inv = await Dealership.availableInventory().catch(() => []);
                const m = inv.length ? inv[Math.floor(this.rngFor(p, 'barn-model')() * inv.length)] : null;
                if (m) model = { id: m.id, name: m.name, carId: m.carId || Garage.carId(m.name), emoji: m.emoji, price: m.price, stats: m.stats, gameId: m.gameId, imageUrl: m.imageUrl };
            }
            const out = PC.resolveCard(cardId, choiceId, this.rngFor(p, 'card-resolve'), { carPrice: car?.price, model });
            if (out.ap < 0) this.useAP(p, -out.ap);
            if (out.money < 0) await Economy.spend(-out.money, `${card.title}`, card.icon);
            else if (out.money > 0) await Economy.adjustWallet(Auth.uid(), out.money, card.icon, card.title);
            p.fans = Math.max(0, p.fans + out.fans);
            p.credit = PC.util.clamp(p.credit + out.credit, 300, 850);
            if (Object.keys(out.xp).length) await this._gainXP(p, out.xp);
            if (out.sponsorHappy) p.sponsors = p.sponsors.map(s => ({ ...s, happy: PC.util.clamp(s.happy + out.sponsorHappy, 0, 100) }));
            if (car && (Object.keys(out.carDamage).length || Object.keys(out.carRepair).length)) {
                const cars = Market.myGarage().map(c => {
                    if (c.id !== car.id) return c;
                    const e = PC.ensureCar(c);
                    for (const [k, v] of Object.entries(out.carDamage)) e.cond[k] = PC.util.clamp(e.cond[k] - v, 0, 100);
                    for (const [k, v] of Object.entries(out.carRepair)) e.cond[k] = PC.util.clamp(Math.max(e.cond[k], v === 100 ? 100 : e.cond[k] + v), 0, 100);
                    return PC.addHistory(e, card.icon, `${card.title}: ${choice.label}`);
                });
                await this.saveCars({ type: 'user', id: Auth.uid() }, cars);
            }
            if (out.giftCar) {
                const entry = { ...out.giftCar, id: this.newCarId(), price: out.giftCar.price, boughtAt: Util.todayISO(), paidPrice: out.giftCar.paid };
                delete entry.paid;
                PC.addHistory(entry, '🏚️', `Bought as a barn find for ${Economy.fmt(out.giftCar.paid)}`);
                await this.saveCars({ type: 'user', id: Auth.uid() }, [...Market.myGarage(), entry]);
                p.stats.carsBought += 1;
            }
            p.card = null;
            p.recentCards = [cardId, ...(p.recentCards || [])].slice(0, 5);
            p.stats.cardsPlayed += 1;
            const bits = [out.money ? `${out.money > 0 ? '+' : '−'}${Economy.fmt(Math.abs(out.money))}` : '', out.fans ? `${out.fans > 0 ? '+' : ''}${out.fans} fans` : '',
                out.giftCar ? `${out.giftCar.name} is in your garage` : ''].filter(Boolean).join(' · ');
            PC.logLine(p, card.icon, `${out.text}${bits ? ` (${bits})` : ''}`);
            return { text: out.text, bits };
        }, { ok: (r) => r ? `${r.text}${r.bits ? ' — ' + r.bits : ''}` : 'Done.' });
    },

    newCarId() { return 'car-' + Date.now() + '-' + Math.floor(Math.random() * 100000); },

    // Add XP, log level-ups, and keep the driver's sim rating in step.
    async _gainXP(p, gains) {
        const PC = this.PC;
        const res = PC.gainXP(p.skills, gains);
        p.skills = res.skills;
        res.levelUps.forEach(u => PC.logLine(p, PC.SKILLS[u.key].icon, `${PC.SKILLS[u.key].label} reached level ${u.lvl}${(PC.SKILLS[u.key].perks || []).filter(([lvl]) => lvl === u.lvl).map(([, name]) => ` — perk unlocked: ${name}`).join('')}`));
        await this.syncRating(p);
        return res.levelUps;
    },
    async syncRating(p, driverId = Auth.state.profile?.driverId) {
        if (!driverId) return;
        const rating = this.PC.ratingFromSkills(p.skills);
        try {
            const d = await DB.get('drivers', driverId);
            if (d && Number(d.rating) !== rating) await DB.update('drivers', driverId, { rating });
        } catch (e) { console.warn('Rating sync failed:', e); }
    },

    /* ============================================================
       🚗 Garage
       ============================================================ */
    async tab_garage(ctx) {
        const PC = this.PC, p = ctx.p;
        const holders = ctx.holders;
        if (!this._holder || !holders.some(h => this.key(h.type, h.id) === this._holder)) this._holder = this.key('user', ctx.uid);
        const h = this.parseKey(this._holder);
        const { doc, cars } = await this.loadCars(h);
        const level = this.levelOf(h, doc, p);
        const lvl = PC.garageLevel(level);
        const cap = this.capacity(h, doc, { p, stars: ctx.stars });
        const next = PC.garageLevel(level + 1);
        const isUser = h.type === 'user';
        const key = this._holder;

        const holderTabs = holders.length > 1 ? `<div class="chip-row" style="margin-bottom:.8rem">${holders.map(x => {
            const k = this.key(x.type, x.id);
            return `<button class="chip chip-btn ${k === key ? 'chip-active' : ''}" data-pd-holder="${Util.attr(k)}">${x.icon} ${Util.esc(x.label)}</button>`;
        }).join('')}</div>` : '';

        const carHtml = (car) => {
            const c = PC.ensureCar(car);
            const k = Util.attr(key), id = Util.attr(car.id);
            const isRace = isUser && p.raceCar === car.id;
            const job = car.job;
            const chips = [
                isRace ? '<span class="badge badge-amber">⭐ Race car</span>' : '',
                c.title !== 'clean' ? `<span class="badge badge-red">${PC.TITLES[c.title].label}</span>` : '',
                Number(car.warranty) > 0 ? `<span class="badge badge-green" title="Free repairs at the Factory Works Service Centre">🛡️ Warranty ${car.warranty} races</span>` : '',
                car.finance ? `<span class="badge badge-blue" title="Paid automatically on race day">💳 ${Economy.fmt(car.finance.balance)} owed · ${Economy.fmt(car.finance.perRace)}/race</span>` : '',
                car.forSale ? `<span class="badge badge-purple">🏷️ For sale ${Economy.fmt(car.forSale.price)}</span>` : '',
                h.type === 'lot' && car.retail ? `<span class="badge badge-purple">🏷️ Retail ${Economy.fmt(car.retail)}</span>` : '',
                job ? `<span class="badge badge-amber">🔧 At ${Util.esc(job.shopName)} — ${Util.esc(PC.SERVICES[job.service]?.label || 'job')}</span>` : '',
                h.type === 'team' && car.assigned ? `<span class="chip chip-dim">🏎️ ${Util.esc(ctx.world.driversById[car.assigned]?.name || 'Assigned')}</span>` : ''
            ].filter(Boolean).join(' ');
            return `
            <div class="pd-car" data-car="${id}">
                <div class="pd-car-media">${CarImg.html(car.imageUrl, car.name)}</div>
                <div class="pd-car-body">
                    <div class="pd-car-title"><span class="race-title">${car.emoji || '🚗'} ${Util.esc(car.nick ? `“${car.nick}” · ${car.name}` : car.name)}</span> ${chips}</div>
                    ${this.carKpis(car)}
                    ${this.condGrid(car)}
                    ${this.partChips(car)}
                    <div class="btn-row pd-car-actions">
                        ${isUser && !isRace ? `<button class="btn btn-ghost btn-sm" onclick="Paddock.setRaceCar('${id}')">⭐ Race car</button>` : ''}
                        <button class="btn btn-primary btn-sm" ${job ? 'disabled' : ''} onclick="Paddock.bookModal('${k}','${id}')">🔧 Service</button>
                        <button class="btn btn-secondary btn-sm" ${job ? 'disabled' : ''} onclick="Paddock.bookModal('${k}','${id}',null,'install')">🧩 Upgrades</button>
                        <button class="btn btn-secondary btn-sm" ${job ? 'disabled' : ''} onclick="Paddock.diyModal('${k}','${id}')">🪛 DIY</button>
                        <button class="btn btn-ghost btn-sm" onclick="Paddock.carMenu('${k}','${id}')">⋯ More</button>
                    </div>
                </div>
            </div>`;
        };

        return `
        ${holderTabs}
        <section class="panel pd-garage-head">
            <div class="panel-head"><h2>${lvl.icon} ${Util.esc(h.type === 'lot' ? 'Dealer lot' : lvl.name)} — ${cars.length}/${cap} spaces</h2>
                ${h.type !== 'lot' && next ? `<button class="btn btn-secondary btn-sm" onclick="Paddock.upgradeGarage('${Util.attr(key)}')">⬆️ ${Util.esc(next.name)} · ${Economy.fmt(next.cost * (h.type === 'team' ? 2 : 1))}</button>` : ''}</div>
            <p class="muted small">${h.type === 'lot' ? 'Stock you have bought to sell. Price it in My Career → Car Dealer.'
                : `${Util.esc(lvl.desc)} DIY here: ${lvl.diy.map(k => PC.COMPONENTS[k].label.toLowerCase()).join(', ')}${lvl.installs ? ', part installs' : ''}${lvl.tune ? ', dyno tunes' : ''}.
                   ${cars.length > cap ? `<strong class="pd-bad-text">${cars.length - cap} car${cars.length - cap > 1 ? 's' : ''} in rented storage (${Economy.fmt(ctx.cfg.storageFee)}/race each).</strong>` : ''}`}</p>
        </section>
        ${cars.length ? `<div class="pd-car-list">${cars.map(carHtml).join('')}</div>`
            : C.empty('🏚', 'No cars here yet', 'Buy new at Phoenix Motors, hunt bargains on the used lots, or pick one up from another player.',
                `<button class="btn btn-primary" onclick="App.go('dealership')">🏬 Dealership</button>`)}`;
    },
    wire_garage(el) {
        Util.$$('[data-pd-holder]', el).forEach(b => b.addEventListener('click', () => { this._holder = b.dataset.pdHolder; App.go('paddock', 'garage'); }));
    },

    async setRaceCar(carId) {
        await this.act(async (p) => {
            p.raceCar = carId;
            const car = Market.myGarage().find(c => c.id === carId);
            return car?.name || 'Car';
        }, { ok: (n) => `⭐ ${n} is your race car — it takes the wear on race day.` });
    },

    async upgradeGarage(holderKey) {
        const PC = this.PC;
        const h = this.parseKey(holderKey);
        await this.act(async (p) => {
            const doc = await this.holderDoc(h);
            const level = this.levelOf(h, doc, p);
            const next = PC.garageLevel(level + 1);
            if (!next || next.level === level) throw new Error('Your garage is already a Pro Facility.');
            const cost = next.cost * (h.type === 'team' ? 2 : 1);
            if (!confirm(`Upgrade to ${next.name} for ${Economy.fmt(cost)}?\n\n${next.desc}\nSpaces: ${next.slots * (h.type === 'team' ? 2 : 1)}`)) return false;
            await this.spendFor(h, cost, `Garage upgrade: ${next.name}`, '🏗️');
            if (h.type === 'team') {
                await DB.update('teams', h.id, { paddock: this.json({ ...(doc.paddock || {}), garageLevel: next.level }) });
            } else p.garageLevel = next.level;
            PC.logLine(p, next.icon, `Upgraded ${h.type === 'team' ? 'the team workshop' : 'your garage'} to ${next.name}`);
            return next.name;
        }, { ok: (n) => `🏗️ Welcome to your ${n}!` });
    },

    async carMenu(holderKey, carId) {
        const PC = this.PC;
        const h = this.parseKey(holderKey);
        const { cars } = await this.loadCars(h);
        const car = cars.find(c => c.id === carId);
        if (!car) return;
        const c = PC.ensureCar(car);
        const world = await DB.loadWorld();
        const roster = h.type === 'team' ? world.drivers.filter(d => d.teamId === h.id) : [];
        const back = PC.sellBackValue(car);
        const k = Util.attr(holderKey), id = Util.attr(carId);
        Modal.open(`
            ${Modal.header(`${car.emoji || '🚗'} ${car.nick || car.name}`, `${car.name} · bought ${Util.fmtDateShort(car.boughtAt)} for ${Economy.fmt(car.paidPrice ?? car.price)}`)}
            ${CarImg.html(car.imageUrl, car.name)}
            <div style="margin:.8rem 0">${this.carKpis(car)}</div>
            <div class="form-row">
                <label class="field"><span>Nickname</span><input id="pd-nick" class="input" maxlength="24" value="${Util.esc(car.nick || '')}" placeholder="e.g. Old Faithful"></label>
                ${h.type === 'team' ? `<label class="field"><span>Assigned driver</span><select id="pd-assign" class="input">
                    <option value="">— Any team driver —</option>
                    ${roster.map(d => `<option value="${Util.attr(d.id)}" ${car.assigned === d.id ? 'selected' : ''}>${Util.esc(d.name)}</option>`).join('')}</select></label>` : ''}
            </div>
            <div class="btn-row"><button class="btn btn-secondary btn-sm" id="pd-save-meta">Save</button></div>
            <h3 class="section-label pd-sec">Sell</h3>
            <p class="muted small">Market value ${Economy.fmt(PC.marketValue(car))}. The dealer pays ${Economy.fmt(back)} straight away${car.finance ? `, and ${Economy.fmt(car.finance.balance)} of it clears your finance` : ''}. Listing it on the Player Market can get you more.</p>
            <div class="btn-row">
                <button class="btn btn-danger btn-sm" ${car.job ? 'disabled' : ''} onclick="Paddock.sellToDealer('${k}','${id}')">Sell to dealer · ${Economy.fmt(back)}</button>
                ${h.type !== 'lot' ? (car.forSale
                    ? `<button class="btn btn-ghost btn-sm" onclick="Paddock.unlist('${k}','${id}')">Take off the market</button>`
                    : `<button class="btn btn-secondary btn-sm" ${car.job || car.finance ? 'disabled title="Clear the finance first"' : ''} onclick="Paddock.listForSale('${k}','${id}')">🏷️ List on Player Market</button>`) : ''}
            </div>
            <h3 class="section-label pd-sec">History</h3>
            ${c.history.length ? `<div class="pd-log">${c.history.slice(0, 12).map(l => `<div class="pd-log-row"><span>${l.icon || '•'}</span><span>${Util.esc(l.text)}</span><span class="muted small">${Util.esc(Util.fmtDateShort(l.at))}</span></div>`).join('')}</div>` : '<p class="muted small">No history yet.</p>'}
            <div class="modal-actions"><button class="btn btn-ghost" onclick="Modal.close()">Close</button></div>
        `, { wide: true });
        Util.$('#pd-save-meta').addEventListener('click', async () => {
            try {
                const fresh = (await this.loadCars(h)).cars;
                const nick = Util.$('#pd-nick').value.trim().slice(0, 24);
                const assigned = Util.$('#pd-assign')?.value ?? car.assigned ?? null;
                await this.saveCars(h, fresh.map(x => x.id === carId ? { ...x, nick, assigned: assigned || null } : x));
                Modal.close();
                Util.notify('Saved. 🏁');
                this.refresh();
            } catch (e) { Util.notify(e.message, 'error'); }
        });
    },

    async sellToDealer(holderKey, carId) {
        const PC = this.PC;
        const h = this.parseKey(holderKey);
        try {
            const { cars } = await this.loadCars(h);
            const car = cars.find(c => c.id === carId);
            if (!car) return;
            if (car.job) throw new Error('That car is in a shop — collect it first.');
            const back = PC.sellBackValue(car);
            const owed = Number(car.finance?.balance) || 0;
            if (!confirm(`Sell the ${car.name} to the dealer for ${Economy.fmt(back)}?${owed ? `\n${Economy.fmt(Math.min(owed, back))} of it pays off your finance.` : ''}`)) return;
            if (owed > back && h.type !== 'team') {
                const short = owed - back;
                if (Economy.balance() < short) throw new Error(`The car is worth less than you owe — you need ${Economy.fmt(short)} to clear the finance.`);
            }
            await this.saveCars(h, cars.filter(c => c.id !== carId));
            const net = back - owed;
            if (net > 0) await this.creditFor(h, net, `Sold ${car.name} to the dealer${owed ? ' (finance cleared)' : ''}`, '🚗');
            else if (net < 0) await this.spendFor(h, -net, `Finance shortfall on ${car.name}`, '💳');
            await this._bumpStat('carsSold');
            Modal.close();
            Util.notify(`Sold the ${car.name} for ${Economy.fmt(back)}. 💵`);
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },
    async _bumpStat(key, n = 1) {
        try {
            const p = this.stateOf(Auth.state.profile, await this.config(), Auth.uid());
            p.stats[key] = (Number(p.stats[key]) || 0) + n;
            await this.save(p);
        } catch (e) { /* stats are cosmetic */ }
    },

    async listForSale(holderKey, carId) {
        const PC = this.PC;
        const h = this.parseKey(holderKey);
        try {
            const { cars } = await this.loadCars(h);
            const car = cars.find(c => c.id === carId);
            if (!car) return;
            const suggest = Math.round(PC.marketValue(car) / 100) * 100;
            const raw = prompt(`Asking price for your ${car.name}?\nMarket value: ${Economy.fmt(PC.marketValue(car))}. Other players see it on the Dealership's Player Market.`, String(suggest));
            if (raw === null) return;
            const price = Math.round(Number(String(raw).replace(/[^\d.]/g, '')));
            if (!(price > 0)) throw new Error('Enter a price above zero.');
            await this.saveCars(h, cars.map(c => c.id === carId ? { ...c, forSale: { price, at: Util.todayISO() } } : c));
            Modal.close();
            Util.notify(`🏷️ Listed at ${Economy.fmt(price)} on the Player Market.`);
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },
    async unlist(holderKey, carId) {
        const h = this.parseKey(holderKey);
        try {
            const { cars } = await this.loadCars(h);
            await this.saveCars(h, cars.map(c => c.id === carId ? { ...c, forSale: null } : c));
            Modal.close();
            Util.notify('Taken off the market.');
            this.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    /* ============================================================
       🔧 Shops — booking (NPC: done on the spot; player: queued)
       ============================================================ */
    async allShops(ctx) {
        const PC = this.PC;
        const shops = Object.values(PC.SHOPS).map(s => ({ ...s }));
        const profiles = ctx?.profiles || await DB.roleProfiles({ force: true }).catch(() => []);
        profiles.filter(rp => rp.role === 'mechanic' && rp.uid && rp.shop?.open).forEach(rp => {
            if (rp.uid === Auth.uid()) return; // your own shop isn't a customer option
            shops.push(PC.playerShop(rp, Prestige.stored(rp)));
        });
        return shops;
    },
    shopById(shops, id) { return shops.find(s => s.id === id) || null; },

    async tab_shops(ctx) {
        const PC = this.PC;
        const shops = await this.allShops(ctx);
        const garage = Market.myGarage();
        const inShop = [];
        for (const h of ctx.holders) {
            const { cars } = await this.loadCars(h);
            cars.filter(c => c.job).forEach(c => inShop.push({ h, c }));
        }
        const card = (s) => {
            const locked = (s.minStars || 1) > ctx.stars;
            const sp = s.specialties.includes('all') ? 'Everything' : s.specialties.map(x => PC.PARTS[x]?.label || PC.SERVICES[x]?.label || x).join(', ');
            return `<div class="pd-shop ${locked ? 'pd-locked' : ''}">
                <div class="pd-shop-head"><span class="pd-shop-icon">${s.icon}</span>
                    <div><strong>${Util.esc(s.name)}</strong> ${s.player ? '<span class="badge badge-blue">Player shop</span>' : ''}
                        <div class="muted small">${Util.esc(s.boss)} — ${Util.esc(s.tagline)}</div></div></div>
                <div class="chip-row">
                    <span class="chip chip-dim" title="How close to factory-fresh their repairs come out">🎯 Quality ${Math.round(s.quality * 100)}%</span>
                    <span class="chip chip-dim" title="Labour price multiplier">💵 ×${s.priceMul.toFixed(2)}</span>
                    <span class="chip chip-dim" title="Chance a job goes wrong">⚠️ ${(s.botch * 100).toFixed(s.botch < 0.01 ? 1 : 0)}% botch</span>
                    ${s.warranty ? '<span class="chip chip-dim">🛡️ Warranty work free</span>' : ''}
                    ${s.player ? '<span class="chip chip-dim">⏳ Queued — done within 2 days</span>' : '<span class="chip chip-dim">⚡ Same-day</span>'}
                </div>
                <p class="muted small">Specialises in: ${Util.esc(sp)}${locked ? ` · 🔒 needs ${Prestige.stars(s.minStars)} prestige` : ''}</p>
                <button class="btn btn-primary btn-sm" ${locked || !garage.length && ctx.holders.length < 2 ? 'disabled' : ''} onclick="Paddock.bookModal(null,null,'${Util.attr(s.id.replace(':', '__'))}')">Book a job</button>
            </div>`;
        };
        return `
        ${inShop.length ? `<section class="panel"><div class="panel-head"><h2>⏳ In the shop</h2></div>
            ${inShop.map(({ h, c }) => `<div class="race-row"><div class="race-row-main"><span class="race-title">${Util.esc(c.name)}</span>
                <span class="race-sub">${Util.esc(c.job.shopName)} · ${Util.esc(PC.SERVICES[c.job.service]?.label || 'Job')} · booked ${Util.esc(Util.fmtDateShort(c.job.bookedOn))} — finishes automatically after 2 days if the mechanic is busy</span></div></div>`).join('')}</section>` : ''}
        <section class="panel">
            <div class="panel-head"><h2>🔧 Mechanic shops</h2></div>
            <p class="muted small">NPC shops do the work on the spot. Player-run shops queue the job for their mechanic (they get paid the labour). Better shops cost more but leave your car closer to factory fresh — and botch fewer jobs.</p>
            <div class="pd-shop-grid">${shops.map(card).join('')}</div>
        </section>`;
    },

    // Booking modal. holderKey/carId may be null (picked in the modal);
    // shopKey may be null (picked in the modal). mode: 'install' opens on parts.
    async bookModal(holderKey = null, carId = null, shopKey = null, mode = null) {
        const PC = this.PC;
        const ctx = { cfg: await this.config(), stars: 1 };
        const world = await DB.loadWorld();
        const holders = await this.myHolders(world);
        if (!holders.length) { Util.notify('Sign in as a player to book shop work.', 'error'); return; }
        const driverId = Auth.state.profile?.driverId;
        ctx.stars = driverId ? Prestige.driverStars(driverId, world) : 1;
        const shops = (await this.allShops()).filter(s => (s.minStars || 1) <= ctx.stars);
        const allCars = [];
        for (const h of holders) {
            const { cars } = await this.loadCars(h);
            cars.filter(c => !c.job).forEach(c => allCars.push({ key: this.key(h.type, h.id), h, car: c }));
        }
        if (!allCars.length) { Util.notify('No cars free for shop work — buy one at the Dealership first.', 'info'); return; }
        const shopId = shopKey ? shopKey.replace('__', ':') : (mode === 'install' ? 'apex' : 'mainst');
        let sel = allCars.find(x => x.key === holderKey && x.car.id === carId) || allCars[0];
        const services = Object.entries(PC.SERVICES);
        const partOpts = Object.entries(PC.PARTS).map(([id, d]) => `<option value="${id}">${d.icon} ${Util.esc(d.label)}</option>`).join('');
        Modal.open(`
            ${Modal.header('🔧 Book shop work', 'Pick the car, the shop and the job — the quote updates as you go')}
            <form id="pd-book" class="form-grid">
                <label class="field"><span>Car</span><select id="pd-b-car" class="input">
                    ${allCars.map((x, i) => `<option value="${i}" ${x === sel ? 'selected' : ''}>${x.h.icon} ${Util.esc(x.car.nick || x.car.name)} — ${PC.overall(x.car)}% · ${Util.esc(x.h.label)}</option>`).join('')}</select></label>
                <label class="field"><span>Shop</span><select id="pd-b-shop" class="input">
                    ${shops.map(s => `<option value="${Util.attr(s.id.replace(':', '__'))}" ${s.id === shopId ? 'selected' : ''}>${s.icon} ${Util.esc(s.name)} — quality ${Math.round(s.quality * 100)}%, ×${s.priceMul.toFixed(2)}</option>`).join('')}</select></label>
                <label class="field"><span>Job</span><select id="pd-b-svc" class="input">
                    ${services.map(([id, s]) => `<option value="${id}" ${(mode === 'install' ? id === 'install' : id === 'service') ? 'selected' : ''}>${s.icon} ${Util.esc(s.label)}</option>`).join('')}</select></label>
                <div class="form-row" id="pd-b-partrow">
                    <label class="field"><span>Part</span><select id="pd-b-part" class="input">${partOpts}</select></label>
                    <label class="field"><span>Tier</span><select id="pd-b-tier" class="input">${[1, 2, 3, 4].map(t => `<option value="${t}">${PC.TIERS[t].stars} ${PC.TIERS[t].label}</option>`).join('')}</select></label>
                </div>
                <div id="pd-b-car-now" class="pd-quote-car"></div>
                <div id="pd-b-quote" class="pd-quote"></div>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary" id="pd-b-go">Book it 🔧</button>
                </div>
            </form>`, { wide: true });

        const read = () => {
            sel = allCars[Number(Util.$('#pd-b-car').value)] || allCars[0];
            const shop = this.shopById(shops, Util.$('#pd-b-shop').value.replace('__', ':'));
            const service = Util.$('#pd-b-svc').value;
            const job = { service, part: Util.$('#pd-b-part').value, tier: Number(Util.$('#pd-b-tier').value) };
            return { sel, shop, job };
        };
        const update = () => {
            const { sel, shop, job } = read();
            Util.$('#pd-b-partrow').style.display = job.service === 'install' ? '' : 'none';
            const q = PC.quote(sel.car, job, shop, { econ: ctx.cfg.econ, warranty: Number(sel.car.warranty) > 0 });
            const c = PC.ensureCar(sel.car);
            const fits = PC.shopFits(shop, PC.SERVICES[job.service]?.cat || job.part);
            const existing = job.service === 'install' ? c.parts[job.part] : null;
            const after = job.service === 'install' ? PC.performJob(c, { ...job }, PC.jobQuality(shop, job.part), 0, PC.rng('preview')).car : null;
            Util.$('#pd-b-car-now').innerHTML = `${this.carKpis(sel.car)}${job.service === 'install' ? '' : this.condGrid(sel.car)}`;
            Util.$('#pd-b-quote').innerHTML = `
                <div class="pd-quote-lines">${q.lines.length ? q.lines.map(l => `<div>${Util.esc(l)}</div>`).join('') : '<div class="muted">Nothing to fix there — that part is already at 100%.</div>'}</div>
                ${existing ? `<p class="muted small">Replaces the fitted ${PC.TIERS[existing.tier]?.label} ${PC.PARTS[job.part].label}.</p>` : ''}
                ${after ? `<p class="small">⚡ PI ${PC.pi(c)} → <strong>${PC.pi(after)}</strong> · ${Util.esc(PC.PARTS[job.part].desc)}</p>` : ''}
                <div class="pd-quote-total"><span>Parts ${Economy.fmt(q.parts)} · Labour ${Economy.fmt(q.labor)}${fits ? ' · ✅ shop speciality' : ''}</span>
                    <strong>${Economy.fmt(q.total)}</strong></div>
                <p class="muted small">Paid from ${sel.h.type === 'team' ? `the team budget (${Economy.fmt(Wallet.teamBalance(sel.h.id))})` : `your wallet (${Economy.fmt(Economy.balance())})`}.
                    ${shop?.player ? `The labour goes to ${Util.esc(shop.boss)}, who finishes the job within 2 days.` : 'Done while you wait.'}</p>`;
            Util.$('#pd-b-go').disabled = !q.lines.length || (job.service !== 'install' && q.total === 0 && !q.lines.some(l => /warranty/i.test(l)));
        };
        ['#pd-b-car', '#pd-b-shop', '#pd-b-svc', '#pd-b-part', '#pd-b-tier'].forEach(s => Util.$(s).addEventListener('change', update));
        update();
        Util.$('#pd-book').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = Util.$('#pd-b-go');
            btn.disabled = true;
            const { sel, shop, job } = read();
            const ok = await this.bookJob(sel.key, sel.car.id, shop, job);
            if (ok) Modal.close(); else btn.disabled = false;
        });
    },

    async bookJob(holderKey, carId, shop, job) {
        const PC = this.PC;
        const h = this.parseKey(holderKey);
        const cfg = await this.config();
        try {
            const { cars } = await this.loadCars(h);
            const car = cars.find(c => c.id === carId);
            if (!car) throw new Error('That car is gone.');
            if (car.job) throw new Error('That car is already booked in.');
            const warranty = Number(car.warranty) > 0;
            const q = PC.quote(car, job, shop, { econ: cfg.econ, warranty });
            if (!q.lines.length) throw new Error('Nothing to do on that car.');
            if (this.balanceFor(h) < q.total) throw new Error(`Not enough money — the job is ${Economy.fmt(q.total)}.`);
            const label = `${PC.SERVICES[job.service]?.label || 'Shop job'}: ${car.name} @ ${shop.name}`;
            if (shop.player) {
                // Parts are bought in (a sink); labour goes to the player mechanic.
                await this.spendFor(h, q.parts, `Parts — ${label}`, '🔩');
                if (q.labor > 0) {
                    await Wallet.executeRoleTransaction({
                        from: this.walletFor(h), to: { type: 'player', id: shop.uid }, amount: q.labor, icon: '🔧',
                        fromLabel: `Labour — ${label}`, toLabel: `Shop job: ${car.name} (${PC.SERVICES[job.service]?.label || 'job'})`
                    });
                }
                const queued = cars.map(c => c.id === carId ? {
                    ...c, job: {
                        id: 'job-' + Date.now(), shopId: shop.id, shopProfileId: shop.profileId, shopUid: shop.uid, shopName: shop.name,
                        service: job.service, part: job.part || null, tier: job.tier || null, comps: job.comps || null,
                        labor: q.labor, parts: q.parts, bookedAt: Date.now(), bookedOn: Util.todayISO(),
                        holder: holderKey, customerUid: Auth.uid(), customerName: Auth.state.profile?.displayName || 'A player'
                    }
                } : c);
                await this.saveCars(h, queued);
                Util.notify(`🔧 Booked in at ${shop.name}. ${shop.boss} has 2 days to finish it.`);
            } else {
                await this.spendFor(h, q.total, label, '🔧');
                const quality = PC.jobQuality(shop, PC.SERVICES[job.service]?.cat || job.part);
                const r = PC.rng(`${Auth.uid()}|shop|${carId}|${Date.now()}`);
                const out = PC.performJob(car, { ...job, shopName: shop.name }, quality, shop.botch, r);
                const done = PC.addHistory(out.car, out.result === 'botched' ? '⚠️' : '🔧', `${shop.name}: ${out.text} (${Economy.fmt(q.total)})`);
                await this.saveCars(h, cars.map(c => c.id === carId ? done : c));
                await this.act(async (p) => {
                    p.stats.shopJobs += 1;
                    PC.logLine(p, '🔧', `${shop.name}: ${out.text}`);
                }, { rerender: false });
                Util.notify(out.result === 'botched' ? `⚠️ ${shop.name} botched it: ${out.text}` : `🔧 ${out.text}`, out.result === 'botched' ? 'error' : 'success');
            }
            this.refresh();
            return true;
        } catch (e) { Util.notify(e.message, 'error'); return false; }
    },

    // Your cars waiting at a player shop for more than 48h finish at standard quality.
    async _autoCompleteMyJobs(ctx) {
        let any = false;
        for (const h of ctx.holders) {
            const { cars } = await this.loadCars(h);
            const stale = cars.filter(c => c.job && Date.now() - (Number(c.job.bookedAt) || 0) > 48 * 3600000);
            if (!stale.length) continue;
            const profiles = ctx.profiles || [];
            const next = cars.map(c => {
                if (!stale.includes(c)) return c;
                const rp = profiles.find(x => x.id === c.job.shopProfileId);
                const stars = rp ? Prestige.stored(rp) : 1;
                return this._finishJob(c, stars, false, `${c.job.customerUid}|auto|${c.job.id}`).car;
            });
            await this.saveCars(h, next);
            any = true;
        }
        return any;
    },
    // Complete a queued player-shop job on a car entry (pure on the entry).
    _finishJob(car, stars, careful, seed) {
        const PC = this.PC;
        const job = car.job;
        const shop = { quality: PC.playerShopQuality(stars), botch: Math.max(0.005, 0.08 - 0.015 * stars), specialties: [] };
        const q = PC.jobQuality(shop, null, { careful });
        const out = PC.performJob({ ...car, job: null }, { service: job.service, part: job.part, tier: job.tier, comps: job.comps, shopName: job.shopName }, q, careful ? shop.botch / 2 : shop.botch, PC.rng(seed));
        const done = PC.addHistory({ ...out.car, job: null }, out.result === 'botched' ? '⚠️' : '🔧', `${job.shopName}: ${out.text}${careful ? ' (careful job)' : ''}`);
        return { car: done, out };
    },

    /* ---------------- 🪛 DIY ---------------- */
    async diyModal(holderKey, carId) {
        const PC = this.PC;
        const h = this.parseKey(holderKey);
        if (h.type === 'lot') { Util.notify('Recondition dealer stock at a shop, or move it to your garage first.', 'info'); return; }
        const cfg = await this.config();
        const { doc, cars } = await this.loadCars(h);
        const car = cars.find(c => c.id === carId);
        if (!car) return;
        const p = this.stateOf(Auth.state.profile, cfg, Auth.uid());
        const level = this.levelOf(h, doc, p);
        const mech = PC.skillValue(p.skills.mechanical);
        const services = Object.entries(PC.SERVICES).filter(([id]) => id !== 'inspect' || true);
        Modal.open(`
            ${Modal.header('🪛 Do it yourself', `${car.nick || car.name} · ${PC.garageLevel(level).name} · mechanical skill ${mech}`)}
            <p class="muted small">You pay for parts only and spend paddock time instead of labour. Quality depends on your mechanical skill and garage. You have <strong>${p.ap} ⏱</strong>.</p>
            <form id="pd-diy" class="form-grid">
                <label class="field"><span>Job</span><select id="pd-d-svc" class="input">
                    ${services.map(([id, s]) => `<option value="${id}">${s.icon} ${Util.esc(s.label)}</option>`).join('')}</select></label>
                <div class="form-row" id="pd-d-partrow">
                    <label class="field"><span>Part</span><select id="pd-d-part" class="input">${Object.entries(PC.PARTS).map(([id, d]) => `<option value="${id}">${d.icon} ${Util.esc(d.label)}</option>`).join('')}</select></label>
                    <label class="field"><span>Tier</span><select id="pd-d-tier" class="input">${[1, 2, 3, 4].map(t => `<option value="${t}">${PC.TIERS[t].stars} ${PC.TIERS[t].label}</option>`).join('')}</select></label>
                </div>
                <label class="check"><input type="checkbox" id="pd-d-careful"> Take your time (+1 ⏱, better result)</label>
                <div id="pd-d-quote" class="pd-quote"></div>
                <div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary" id="pd-d-go">Get the spanners out 🪛</button></div>
            </form>`, { wide: true });
        const read = () => ({ service: Util.$('#pd-d-svc').value, part: Util.$('#pd-d-part').value, tier: Number(Util.$('#pd-d-tier').value), careful: Util.$('#pd-d-careful').checked });
        const update = () => {
            const job = read();
            Util.$('#pd-d-partrow').style.display = job.service === 'install' ? '' : 'none';
            const allowed = PC.diyAllowed(job, level);
            const q = PC.quote(car, job, null, { diy: { level, mechanical: mech }, econ: cfg.econ });
            const ap = q.ap + (job.careful ? 1 : 0);
            const quality = PC.jobQuality(null, null, { diy: { level, mechanical: mech }, careful: job.careful });
            Util.$('#pd-d-quote').innerHTML = allowed ? `
                <div class="pd-quote-lines">${q.lines.map(l => `<div>${Util.esc(l)}</div>`).join('') || '<div class="muted">Nothing to do there.</div>'}</div>
                <div class="pd-quote-total"><span>Parts ${Economy.fmt(q.parts)} · ${ap} ⏱ · expected quality ${Math.round(quality * 100)}%</span><strong>${Economy.fmt(q.parts)}</strong></div>`
                : `<p class="pd-bad-text small">Your ${PC.garageLevel(level).name} isn't equipped for that. Upgrade the garage, or book it at a shop.</p>`;
            Util.$('#pd-d-go').disabled = !allowed || !q.lines.length || ap > p.ap;
        };
        ['#pd-d-svc', '#pd-d-part', '#pd-d-tier', '#pd-d-careful'].forEach(s => Util.$(s).addEventListener('change', update));
        update();
        Util.$('#pd-diy').addEventListener('submit', async (e) => {
            e.preventDefault();
            const job = read();
            const res = await this.act(async (pp) => {
                const fresh = (await this.loadCars(h));
                const c = fresh.cars.find(x => x.id === carId);
                if (!c) throw new Error('That car is gone.');
                const lv = this.levelOf(h, fresh.doc, pp);
                if (!PC.diyAllowed(job, lv)) throw new Error('Your garage isn\'t equipped for that job.');
                const m = PC.skillValue(pp.skills.mechanical);
                const q = PC.quote(c, job, null, { diy: { level: lv, mechanical: m }, econ: cfg.econ });
                this.useAP(pp, q.ap + (job.careful ? 1 : 0));
                await this.spendFor(h, q.parts, `DIY parts: ${PC.SERVICES[job.service].label} — ${c.name}`, '🪛');
                const quality = PC.jobQuality(null, null, { diy: { level: lv, mechanical: m }, careful: job.careful });
                const botch = Math.max(0, 0.12 - m / 1000 - (job.careful ? 0.04 : 0));
                const out = PC.performJob(c, { ...job, shopName: 'your garage' }, quality, botch, this.rngFor(pp, 'diy'));
                const done = PC.addHistory(out.car, out.result === 'botched' ? '⚠️' : '🪛', `DIY: ${out.text}`);
                await this.saveCars(h, fresh.cars.map(x => x.id === carId ? done : x));
                await this._gainXP(pp, { mechanical: 15 + q.ap * 8 });
                pp.stats.diyJobs += 1;
                PC.logLine(pp, '🪛', `DIY on the ${c.name}: ${out.text}`);
                return out;
            }, { ok: (o) => o ? (o.result === 'botched' ? `⚠️ ${o.text}` : `🪛 ${o.text} (+mechanical XP)`) : 'Done.' });
            if (res) Modal.close();
        });
    },

    /* ============================================================
       💰 Sponsors
       ============================================================ */
    async tab_sponsors(ctx) {
        const PC = this.PC, p = ctx.p;
        const dealRow = (d, scope) => {
            const pct = Math.min(100, Math.round(d.obj.hits / Math.max(1, d.obj.target) * 100));
            return `<div class="pd-deal">
                <div class="pd-deal-head"><strong>${Util.esc(d.brand)}</strong> <span class="chip chip-dim">${Util.esc(d.industry)}</span> <span class="chip chip-dim">${Util.esc(d.slotLabel || d.slot)}</span>
                    <span class="market-price">${Economy.fmt(d.perRace)}/race</span></div>
                <div class="pd-deal-grid">
                    <span class="muted small">😊 Happiness</span>${this.bar(d.happy, { label: 'Happiness' })}<span class="small">${d.happy}</span>
                    <span class="muted small">🎯 ${Util.esc(PC.objLabel(d.obj))}</span>${this.bar(pct, { label: 'Objective' })}<span class="small">${d.obj.hits}/${d.obj.target}</span>
                </div>
                <p class="muted small">${d.racesLeft} of ${d.races} races left · bonus ${Economy.fmt(d.bonus)} if the objective is met · ${Economy.fmt(d.paid || 0)} paid so far</p>
                ${d.request ? `<div class="pd-request">📣 ${Util.esc(d.brand)} wants you at a <strong>${Util.esc(d.request.label)}</strong> (${d.request.ap} ⏱, ${d.request.racesLeft} race${d.request.racesLeft === 1 ? '' : 's'} left to go)
                    <button class="btn btn-primary btn-sm" onclick="Paddock.attendRequest('${scope}','${Util.attr(d.id)}')">Attend</button></div>` : ''}
                <div class="btn-row"><button class="btn btn-ghost btn-sm" onclick="Paddock.endDeal('${scope}','${Util.attr(d.id)}')">End deal early</button></div>
            </div>`;
        };
        const offerRow = (o, scope, free) => `<div class="pd-offer">
            <div class="pd-deal-head"><strong>${Util.esc(o.brand)}</strong> ${o.renewal ? '<span class="badge badge-green">Renewal</span>' : ''}
                <span class="chip chip-dim">${Util.esc(o.industry)}</span> <span class="chip chip-dim">${Util.esc(o.slotLabel)}</span></div>
            <div class="chip-row">
                <span class="chip">💵 ${Economy.fmt(o.perRace)}/race × ${o.races}</span>
                <span class="chip chip-dim">✍️ ${Economy.fmt(o.signing)} signing</span>
                <span class="chip chip-dim">🎯 ${Util.esc(PC.objLabel(o.obj))} → ${Economy.fmt(o.bonus)}</span>
            </div>
            <div class="btn-row">
                <button class="btn btn-primary btn-sm" ${free ? '' : 'disabled title="That slot is full — end a deal first"'} onclick="Paddock.signOffer('${scope}','${Util.attr(o.id)}')">✍️ Sign</button>
                <button class="btn btn-secondary btn-sm" ${o.pushed ? 'disabled' : ''} onclick="Paddock.pushOffer('${scope}','${Util.attr(o.id)}')">📈 Push for more</button>
                <button class="btn btn-ghost btn-sm" onclick="Paddock.declineOffer('${scope}','${Util.attr(o.id)}')">Decline</button>
            </div></div>`;
        const freeSlot = (kind, deals, slot) => PC.slotCount(kind, slot, { skills: p.skills }) - deals.filter(d => d.slot === slot).length > 0;

        let html = '';
        if (ctx.driver) {
            const slots = PC.DRIVER_SLOTS;
            html += `<div class="grid-2">
                <section class="panel">
                    <div class="panel-head"><h2>💰 Personal sponsors (${p.sponsors.length})</h2></div>
                    <p class="muted small">They pay after every race you start, judge your results, and pay a bonus if you hit their objective. Unhappy sponsors walk.</p>
                    <div class="chip-row" style="margin-bottom:.6rem">${Object.entries(slots).map(([id, s]) => `<span class="chip chip-dim">${Util.esc(s.label)} ${p.sponsors.filter(d => d.slot === id).length}/${PC.slotCount('driver', id, { skills: p.skills })}</span>`).join('')}</div>
                    ${p.sponsors.length ? p.sponsors.map(d => dealRow(d, 'me')).join('') : C.empty('💰', 'No personal sponsors yet', 'Sign one from the offers board.')}
                </section>
                <section class="panel">
                    <div class="panel-head"><h2>📨 Offers board</h2><span class="chip chip-dim">New offers after every race</span></div>
                    <p class="muted small">Offers grow with your prestige (${Prestige.stars(ctx.stars)}), fans and media skill. One sponsor per industry.</p>
                    ${p.offers.length ? p.offers.map(o => offerRow(o, 'me', freeSlot('driver', p.sponsors, o.slot))).join('') : C.empty('📨', 'No offers right now', 'Race, raise your profile, and check back after the next round.')}
                </section>
            </div>`;
        } else {
            html += `<section class="panel">${C.empty('🪖', 'Personal sponsors back drivers', 'Create your driver in My Career to start attracting personal sponsors.', `<button class="btn btn-primary" onclick="App.go('career')">My Career</button>`)}</section>`;
        }
        if (ctx.team) {
            const tp = ctx.team.paddock || {};
            const deals = Array.isArray(tp.sponsors) ? tp.sponsors : [];
            const offers = Array.isArray(tp.offers) ? tp.offers : [];
            html += `<div class="grid-2" style="margin-top:1.1rem">
                <section class="panel">
                    <div class="panel-head"><h2>🏢 ${Util.esc(ctx.team.name)} — team sponsors (${deals.length})</h2></div>
                    <p class="muted small">Paid into the team budget every race the team runs, judged on the team's best finisher.</p>
                    <div class="chip-row" style="margin-bottom:.6rem">${Object.entries(PC.TEAM_SLOTS).map(([id, s]) => `<span class="chip chip-dim">${Util.esc(s.label)} ${deals.filter(d => d.slot === id).length}/${s.count}</span>`).join('')}</div>
                    ${deals.length ? deals.map(d => dealRow(d, 'team')).join('') : C.empty('🏢', 'No team sponsors yet', 'Sign the team\'s first backer from the offers.')}
                </section>
                <section class="panel">
                    <div class="panel-head"><h2>📨 Team offers</h2><button class="btn btn-ghost btn-sm" onclick="Paddock.refreshTeamOffers()">↻ Shop the team around</button></div>
                    <p class="muted small">Team prestige ${Prestige.stars(ctx.teamStars)}. New offers arrive after every race; shopping around costs 1 ⏱.</p>
                    ${offers.length ? offers.map(o => offerRow(o, 'team', freeSlot('team', deals, o.slot))).join('') : C.empty('📨', 'No team offers', 'Shop the team around to brands.')}
                </section>
            </div>`;
        }
        return html;
    },

    // scope: 'me' (personal, users/{uid}.paddock) or 'team' (teams/{id}.paddock).
    async _teamPaddock() {
        const world = await DB.loadWorld(true);
        const team = world.teams.find(t => t.ownerUid === Auth.uid());
        if (!team) throw new Error('You don\'t own a team.');
        const tp = { sponsors: [], offers: [], ...(team.paddock || {}) };
        return { team, tp, world };
    },
    async refreshTeamOffers() {
        const PC = this.PC;
        await this.act(async (p, cfg) => {
            const { team, tp, world } = await this._teamPaddock();
            this.useAP(p, 1);
            const ctx = { cfg };
            tp.offers = [...(tp.offers || []).filter(o => o.renewal), ...PC.sponsorOffers(this.rngFor(p, 'team-offers'), {
                kind: 'team', stars: Prestige.teamStars(team.id, world), fans: p.fans, media: PC.skillValue(p.skills.media), econ: cfg.econ,
                brands: this._brandPool(ctx), count: 3, taken: (tp.sponsors || []).map(s => s.brand), industries: (tp.sponsors || []).map(s => s.industry)
            })];
            tp.offersAt = Date.now();
            await DB.update('teams', team.id, { paddock: this.json(tp) });
        }, { ok: '📨 Fresh team offers are in.' });
    },

    async signOffer(scope, offerId) {
        const PC = this.PC;
        await this.act(async (p) => {
            if (scope === 'team') {
                const { team, tp } = await this._teamPaddock();
                const o = (tp.offers || []).find(x => x.id === offerId);
                if (!o) throw new Error('That offer has gone.');
                if (PC.slotCount('team', o.slot) - (tp.sponsors || []).filter(d => d.slot === o.slot).length <= 0) throw new Error('That sponsor slot is full.');
                tp.sponsors = [...(tp.sponsors || []), PC.signDeal(o, Util.todayISO())];
                tp.offers = tp.offers.filter(x => x.id !== offerId);
                await DB.update('teams', team.id, { paddock: this.json(tp) });
                if (o.signing) await Wallet.adjustTeamWallet(team.id, o.signing, '✍️', `Signing fee — ${o.brand}`);
                News.post('🤝', `${o.brand} signs as ${o.slotLabel.toLowerCase()} of ${team.name}`);
                PC.logLine(p, '🤝', `${team.name} signed ${o.brand} (${Economy.fmt(o.perRace)}/race)`);
                return o.brand;
            }
            const o = p.offers.find(x => x.id === offerId);
            if (!o) throw new Error('That offer has gone.');
            if (PC.slotCount('driver', o.slot, { skills: p.skills }) - p.sponsors.filter(d => d.slot === o.slot).length <= 0) throw new Error('That sponsor slot is full — end a deal first.');
            if (p.sponsors.some(s => s.industry === o.industry)) throw new Error(`You already have a ${o.industry} sponsor.`);
            p.sponsors.push(PC.signDeal(o, Util.todayISO()));
            p.offers = p.offers.filter(x => x.id !== offerId);
            if (o.signing) await Economy.adjustWallet(Auth.uid(), o.signing, '✍️', `Signing fee — ${o.brand}`);
            PC.logLine(p, '🤝', `Signed ${o.brand}: ${Economy.fmt(o.perRace)}/race for ${o.races} races`);
            News.post('🤝', `${Auth.state.profile?.displayName || 'A driver'} lands a personal deal with ${o.brand}`);
            return o.brand;
        }, { ok: (b) => `✍️ ${b} is on board!` });
    },
    async pushOffer(scope, offerId) {
        const PC = this.PC;
        await this.act(async (p) => {
            const media = PC.skillValue(p.skills.media);
            const driverId = Auth.state.profile?.driverId;
            const world = await DB.loadWorld();
            const stars = driverId ? Prestige.driverStars(driverId, world) : 1;
            const apply = (list) => {
                const o = list.find(x => x.id === offerId);
                if (!o) throw new Error('That offer has gone.');
                const res = PC.pushOffer(o, this.rngFor(p, 'push'), { media, stars });
                return { res, list: res.withdrawn ? list.filter(x => x.id !== offerId) : list.map(x => x.id === offerId ? res.offer : x) };
            };
            let res;
            if (scope === 'team') {
                const { team, tp } = await this._teamPaddock();
                const out = apply(tp.offers || []);
                res = out.res;
                tp.offers = out.list;
                await DB.update('teams', team.id, { paddock: this.json(tp) });
            } else {
                const out = apply(p.offers);
                res = out.res;
                p.offers = out.list;
            }
            if (res.ok) PC.logLine(p, '📈', `${res.offer.brand} raised their offer to ${Economy.fmt(res.offer.perRace)}/race`);
            return res;
        }, { ok: (r) => !r ? 'Done.' : r.ok ? `📈 ${r.offer.brand} agreed: ${Economy.fmt(r.offer.perRace)}/race.` : r.withdrawn ? `😬 ${r.offer.brand} walked away from the table.` : `${r.offer.brand} won't budge.` });
    },
    async declineOffer(scope, offerId) {
        await this.act(async (p) => {
            if (scope === 'team') {
                const { team, tp } = await this._teamPaddock();
                tp.offers = (tp.offers || []).filter(o => o.id !== offerId);
                await DB.update('teams', team.id, { paddock: this.json(tp) });
            } else p.offers = p.offers.filter(o => o.id !== offerId);
        }, { ok: 'Offer declined.' });
    },
    async endDeal(scope, dealId) {
        const PC = this.PC;
        if (!confirm('End this sponsorship early? You pay a termination fee of 2 races\' money.')) return;
        await this.act(async (p) => {
            if (scope === 'team') {
                const { team, tp } = await this._teamPaddock();
                const d = (tp.sponsors || []).find(x => x.id === dealId);
                if (!d) throw new Error('Deal not found.');
                await Wallet.teamSpend(team.id, d.perRace * 2, `Early termination — ${d.brand}`, '✂️');
                tp.sponsors = tp.sponsors.filter(x => x.id !== dealId);
                await DB.update('teams', team.id, { paddock: this.json(tp) });
                PC.logLine(p, '✂️', `${team.name} ended its deal with ${d.brand}`);
                return d.brand;
            }
            const d = p.sponsors.find(x => x.id === dealId);
            if (!d) throw new Error('Deal not found.');
            await Economy.spend(d.perRace * 2, `Early termination — ${d.brand}`, '✂️');
            p.sponsors = p.sponsors.filter(x => x.id !== dealId);
            PC.logLine(p, '✂️', `Ended the deal with ${d.brand}`);
            return d.brand;
        }, { ok: (b) => `Deal with ${b} ended.` });
    },
    async attendRequest(scope, dealId) {
        const PC = this.PC;
        await this.act(async (p) => {
            const fix = (d) => {
                if (!d?.request) throw new Error('No request pending.');
                this.useAP(p, d.request.ap);
                const label = d.request.label;
                return { ...d, request: null, happy: PC.util.clamp(d.happy + 12, 0, 100), label };
            };
            let label = '';
            if (scope === 'team') {
                const { team, tp } = await this._teamPaddock();
                tp.sponsors = (tp.sponsors || []).map(d => { if (d.id !== dealId) return d; const x = fix(d); label = `${d.brand} ${x.label}`; delete x.label; return x; });
                await DB.update('teams', team.id, { paddock: this.json(tp) });
            } else {
                p.sponsors = p.sponsors.map(d => { if (d.id !== dealId) return d; const x = fix(d); label = `${d.brand} ${x.label}`; delete x.label; return x; });
            }
            p.fans += 25;
            await this._gainXP(p, { media: 30 });
            PC.logLine(p, '📣', `Showed up for the ${label}`);
            return label;
        }, { ok: (l) => `📣 ${l}: sponsor delighted (+happiness, +fans, +media XP).` });
    },

    /* ============================================================
       🏋️ Training
       ============================================================ */
    async tab_training(ctx) {
        const PC = this.PC, p = ctx.p;
        const vals = PC.skillValues(p.skills);
        return `<div class="grid-2">
            <section class="panel">
                <div class="panel-head"><h2>🧠 Skills</h2><span class="chip rating-chip">⭐ Rating ${PC.ratingFromSkills(p.skills)}</span></div>
                <p class="muted small">Racing, training, events and DIY all earn XP. Skills set your driver rating (used when races are simulated), cut car wear, and unlock perks at levels 10 and 16.</p>
                ${PC.SKILL_KEYS.map(k => {
                    const s = p.skills[k];
                    const need = PC.xpToNext(s.lvl);
                    return `<div class="pd-skill">
                        <div class="pd-skill-head"><span>${PC.SKILLS[k].icon} <strong>${PC.SKILLS[k].label}</strong> <span class="muted small">${Util.esc(PC.SKILLS[k].desc)}</span></span><span>L${s.lvl} · ${vals[k]}</span></div>
                        <div class="progress"><div class="progress-fill" style="width:${s.lvl >= PC.MAX_LEVEL ? 100 : Math.round(s.xp / need * 100)}%"></div></div>
                        <div class="chip-row">${(PC.SKILLS[k].perks || []).map(([lvl, name, desc]) => `<span class="chip ${s.lvl >= lvl ? '' : 'chip-dim'}" title="${Util.esc(desc)}">${s.lvl >= lvl ? '✅' : '🔒'} L${lvl} ${Util.esc(name)}</span>`).join('')}</div>
                    </div>`;
                }).join('')}
            </section>
            <section class="panel">
                <div class="panel-head"><h2>🏋️ Training sessions</h2>${this.apChip(p)}</div>
                ${Object.entries(PC.TRAINING).map(([id, t]) => {
                    const cost = PC.trainingCost(id, ctx.cfg.econ);
                    return `<div class="race-row">
                        <div class="driver-hero-num pd-car-emoji">${t.icon}</div>
                        <div class="race-row-main"><span class="race-title">${Util.esc(t.label)}</span>
                            <span class="race-sub">${Util.esc(t.desc)} · ${Object.entries(t.xp).map(([k, v]) => `${PC.SKILLS[k].icon} +${v}`).join(' ')}</span></div>
                        <button class="btn btn-primary btn-sm" ${p.ap < t.ap ? 'disabled' : ''} onclick="Paddock.train('${id}')">${t.ap} ⏱ · ${Economy.fmt(cost)}</button>
                    </div>`;
                }).join('')}
            </section>
        </div>`;
    },
    async train(key) {
        const PC = this.PC;
        await this.act(async (p, cfg) => {
            const t = PC.TRAINING[key];
            if (!t) throw new Error('Unknown session.');
            this.useAP(p, t.ap);
            await Economy.spend(PC.trainingCost(key, cfg.econ), t.label, t.icon);
            const gains = PC.runTraining(key, this.rngFor(p, 'train'));
            const ups = await this._gainXP(p, gains);
            p.stats.trainings += 1;
            PC.logLine(p, t.icon, `${t.label}: ${Object.entries(gains).map(([k, v]) => `${PC.SKILLS[k].label} +${v} XP`).join(', ')}`);
            return { t, gains, ups };
        }, { ok: (r) => r ? `${r.t.icon} ${r.t.label} done — ${Object.entries(r.gains).map(([k, v]) => `+${v} ${PC.SKILLS[k].label}`).join(', ')}${r.ups.length ? ` · ⬆️ ${r.ups.map(u => `${PC.SKILLS[u.key].label} L${u.lvl}`).join(', ')}` : ''}` : 'Done.' });
    },

    /* ============================================================
       🎪 Side events
       ============================================================ */
    async tab_events(ctx) {
        const PC = this.PC, p = ctx.p;
        const garage = Market.myGarage();
        const carOpts = garage.map(c => `<option value="${Util.attr(c.id)}" ${c.id === p.raceCar ? 'selected' : ''}>${Util.esc(c.nick || c.name)} — PI ${PC.pi(c)} · ${PC.overall(c)}%</option>`).join('');
        return `<section class="panel">
            <div class="panel-head"><h2>🎪 Side events</h2>${this.apChip(p)}</div>
            <p class="muted small">Make money and fans between rounds — each event once per race week (they open again after your next race, or next week). Events with your car wear it like a short race (no race start is added to the odometer).</p>
            ${garage.length ? `<label class="field" style="max-width:24rem"><span>Car to take</span><select id="pd-ev-car" class="input">${carOpts}</select></label>` : ''}
            <div class="pd-event-grid">${Object.entries(PC.SIDE_EVENTS).map(([id, ev]) => {
                const done = PC.eventDone(p, id, this.weekId(p));
                const blocked = done || (ev.needsCar && !garage.length) || (ev.needsSponsor && !p.sponsors.length);
                const fee = Math.round((ev.fee || 0) * ctx.cfg.econ);
                return `<div class="pd-event ${blocked ? 'pd-locked' : ''}">
                    <div class="pd-shop-head"><span class="pd-shop-icon">${ev.icon}</span><div><strong>${Util.esc(ev.label)}</strong><div class="muted small">${Util.esc(ev.desc)}</div></div></div>
                    <div class="chip-row"><span class="chip chip-dim">${ev.ap} ⏱</span>${fee ? `<span class="chip chip-dim">${Economy.fmt(fee)} entry</span>` : ''}
                        ${ev.needsCar ? '<span class="chip chip-dim">🚗 Your car</span>' : ''}${ev.needsSponsor ? '<span class="chip chip-dim">💰 Needs a sponsor</span>' : ''}</div>
                    <button class="btn btn-primary btn-sm" ${blocked || p.ap < ev.ap ? 'disabled' : ''} onclick="Paddock.runEvent('${id}')">${done ? 'Done this week ✓' : 'Go'}</button>
                </div>`;
            }).join('')}</div>
        </section>`;
    },
    async runEvent(key) {
        const PC = this.PC;
        const carId = Util.$('#pd-ev-car')?.value || null;
        await this.act(async (p, cfg) => {
            const ev = PC.SIDE_EVENTS[key];
            if (!ev) throw new Error('Unknown event.');
            const garage = Market.myGarage();
            const car = ev.needsCar ? garage.find(c => c.id === carId) || garage.find(c => c.id === p.raceCar) || garage[0] : null;
            if (ev.needsCar && !car) throw new Error('This one needs a car — buy one at the Dealership.');
            if (ev.needsSponsor && !p.sponsors.length) throw new Error('You need a sponsor for a photo shoot.');
            if (PC.eventDone(p, key, this.weekId(p))) throw new Error(`You've already done a ${ev.label.toLowerCase()} this week — it opens again after your next race.`);
            this.useAP(p, ev.ap);
            PC.markEvent(p, key, this.weekId(p));
            const fee = Math.round((ev.fee || 0) * cfg.econ);
            if (fee) await Economy.spend(fee, `${ev.label} entry`, ev.icon);
            const world = await DB.loadWorld();
            const driver = world.driversById[Auth.state.profile?.driverId];
            const out = PC.runSideEvent(key, { car, skills: p.skills, fans: p.fans, econ: cfg.econ, rating: driver?.rating || PC.ratingFromSkills(p.skills) }, this.rngFor(p, 'event-' + key));
            if (out.money > 0) await Economy.adjustWallet(Auth.uid(), out.money, ev.icon, `${ev.label}${out.place ? ` — P${out.place}` : ''}`);
            p.fans += out.fans;
            if (Object.keys(out.xp).length) await this._gainXP(p, out.xp);
            if (out.sponsorHappy) p.sponsors = p.sponsors.map(s => ({ ...s, happy: PC.util.clamp(s.happy + out.sponsorHappy, 0, 100) }));
            if (car && out.wear) {
                const w = PC.applyRaceWear(car, out.wear.ctx, this.rngFor(p, 'event-wear'));
                const done = PC.addHistory(w.car, ev.icon, `${ev.label}: ${out.text}`);
                await this.saveCars({ type: 'user', id: Auth.uid() }, Market.myGarage().map(c => c.id === car.id ? done : c));
            }
            p.stats.sideEvents += 1;
            p.stats.earned += out.money;
            PC.logLine(p, ev.icon, `${ev.label}: ${out.text} (+${out.fans} fans${out.money ? `, +${Economy.fmt(out.money)}` : ''})`);
            return { ev, out };
        }, { ok: (r) => r ? `${r.ev.icon} ${r.out.text} +${r.out.fans} fans${r.out.money ? ` · +${Economy.fmt(r.out.money)}` : ''}` : 'Done.' });
    },

    /* ============================================================
       🏦 Bank
       ============================================================ */
    async tab_bank(ctx) {
        const PC = this.PC, p = ctx.p;
        const limit = PC.creditLimit({ stars: ctx.stars, fans: p.fans, credit: p.credit });
        const owed = p.loans.reduce((s, l) => s + (Number(l.balance) || 0), 0);
        const financed = Market.myGarage().filter(c => c.finance);
        return `<div class="grid-2">
            <section class="panel">
                <div class="panel-head"><h2>🏦 Your credit</h2><span class="chip">📊 ${p.credit}</span></div>
                <div class="pd-mini-grid">
                    <div class="mini-stat"><span class="mini-value">${p.credit}</span><span class="mini-label">Credit score</span></div>
                    <div class="mini-stat"><span class="mini-value">${Economy.fmt(limit)}</span><span class="mini-label">Credit limit</span></div>
                    <div class="mini-stat"><span class="mini-value">${Economy.fmt(owed)}</span><span class="mini-label">Loans owed</span></div>
                </div>
                <p class="muted small">Repayments come out on race day, after every race you start. Paying while you're in credit builds your score; going into the red hurts it — and better scores mean cheaper loans and finance.</p>
                <h3 class="section-label pd-sec">Loans</h3>
                ${p.loans.length ? p.loans.map(l => `<div class="race-row"><div class="race-row-main"><span class="race-title">${Util.esc(l.label)}</span>
                    <span class="race-sub">${Economy.fmt(l.balance)} left · ${Economy.fmt(l.perRace)}/race · ${l.racesLeft} races</span></div>
                    <button class="btn btn-secondary btn-sm" onclick="Paddock.repayLoan('${Util.attr(l.id)}')">Repay now</button></div>`).join('')
                    : '<p class="muted">No loans. Nice.</p>'}
                ${financed.length ? `<h3 class="section-label pd-sec">Car finance</h3>${financed.map(c => `<div class="race-row"><div class="race-row-main"><span class="race-title">${Util.esc(c.name)}</span>
                    <span class="race-sub">${Economy.fmt(c.finance.balance)} left · ${Economy.fmt(c.finance.perRace)}/race${c.finance.missed ? ` · ⚠️ ${c.finance.missed} missed` : ''}</span></div>
                    <button class="btn btn-secondary btn-sm" onclick="Paddock.payOffFinance('${Util.attr(c.id)}')">Pay off</button></div>`).join('')}` : ''}
            </section>
            <section class="panel">
                <div class="panel-head"><h2>💵 Borrow</h2></div>
                ${Object.values(PC.LOANS).map(L => {
                    const t = PC.loanTerms(L.id, { credit: p.credit, econ: ctx.cfg.econ });
                    const has = p.loans.some(l => l.product === L.id);
                    const locked = L.minStars > ctx.stars;
                    const over = owed + t.amount > limit;
                    return `<div class="race-row"><div class="driver-hero-num pd-car-emoji">${L.icon}</div>
                        <div class="race-row-main"><span class="race-title">${Util.esc(L.label)} — ${Economy.fmt(t.amount)}</span>
                            <span class="race-sub">${Math.round(t.rate * 100)}% · ${t.races} × ${Economy.fmt(t.perRace)} = ${Economy.fmt(t.total)}${locked ? ` · 🔒 ${Prestige.stars(L.minStars)}` : ''}${over && !locked ? ' · over your limit' : ''}</span></div>
                        <button class="btn btn-primary btn-sm" ${has || locked || over ? 'disabled' : ''} onclick="Paddock.takeLoan('${L.id}')">${has ? 'Active' : 'Borrow'}</button></div>`;
                }).join('')}
            </section>
        </div>`;
    },
    async takeLoan(id) {
        const PC = this.PC;
        await this.act(async (p, cfg) => {
            const world = await DB.loadWorld();
            const driverId = Auth.state.profile?.driverId;
            const stars = driverId ? Prestige.driverStars(driverId, world) : 1;
            const t = PC.loanTerms(id, { credit: p.credit, econ: cfg.econ });
            if (!t) throw new Error('Unknown loan.');
            if (t.minStars > stars) throw new Error('The bank wants more prestige for that one.');
            if (p.loans.some(l => l.product === id)) throw new Error('You already have that loan.');
            const owed = p.loans.reduce((s, l) => s + l.balance, 0);
            if (owed + t.amount > PC.creditLimit({ stars, fans: p.fans, credit: p.credit })) throw new Error('That would take you over your credit limit.');
            p.loans.push({ id: 'loan-' + Date.now(), product: id, label: t.label, principal: t.amount, balance: t.total, perRace: t.perRace, racesLeft: t.races, rate: t.rate, takenAt: Util.todayISO() });
            await Economy.adjustWallet(Auth.uid(), t.amount, '🏦', `${t.label} (${Math.round(t.rate * 100)}%)`);
            PC.logLine(p, '🏦', `Borrowed ${Economy.fmt(t.amount)} — ${t.races} × ${Economy.fmt(t.perRace)}`);
            return t;
        }, { ok: (t) => t ? `🏦 ${Economy.fmt(t.amount)} is in your account.` : 'Done.' });
    },
    async repayLoan(loanId) {
        const PC = this.PC;
        await this.act(async (p) => {
            const l = p.loans.find(x => x.id === loanId);
            if (!l) throw new Error('Loan not found.');
            // Early payoff: a 5% rebate on the interest you haven't paid yet.
            const pay = Math.round(l.balance * 0.97);
            await Economy.spend(pay, `Repaid ${l.label}`, '🏦');
            p.loans = p.loans.filter(x => x.id !== loanId);
            p.credit = PC.util.clamp(p.credit + 15, 300, 850);
            PC.logLine(p, '🏦', `Paid off the ${l.label} early (${Economy.fmt(pay)})`);
            return pay;
        }, { ok: (n) => `🏦 Loan cleared for ${Economy.fmt(n)}. Credit score up.` });
    },
    async payOffFinance(carId) {
        const PC = this.PC;
        await this.act(async (p) => {
            const cars = Market.myGarage();
            const car = cars.find(c => c.id === carId);
            if (!car?.finance) throw new Error('No finance on that car.');
            await Economy.spend(car.finance.balance, `Paid off finance — ${car.name}`, '💳');
            await this.saveCars({ type: 'user', id: Auth.uid() }, cars.map(c => c.id === carId ? PC.addHistory({ ...c, finance: null }, '💳', 'Finance paid off') : c));
            p.credit = PC.util.clamp(p.credit + 10, 300, 850);
            PC.logLine(p, '💳', `The ${car.name} is all yours — finance cleared`);
            return car.name;
        }, { ok: (n) => `💳 The ${n} is fully yours.` });
    },

    /* ============================================================
       Race day — called from Sim.payoutRace (any client that saves
       results). helpers: { add(uid, amount, icon, label),
       addTeam(teamId, …), netFor(type, id) }
       ============================================================ */
    async settleRace(race, world, helpers) {
        const PC = this.PC;
        const cfg = await this.config(true);
        if (!cfg.enabled) return;
        const results = race.results || [];
        const raceName = race.name || race.track || 'race';
        let signups = [];
        try { signups = (await DB.signups({ force: true })).filter(s => s.raceId === race.id); } catch (e) { /* */ }
        const tr = window.Library?.track ? Library.track(race.track) : null;
        const wx = window.Library?.conditions ? Library.conditions(race) : null;
        const wet = !!wx && /rain|wet|storm|drizzle|shower/i.test(wx.cond || '');
        const km = tr?.km && race.laps ? Math.round(tr.km * race.laps) : 0;
        const teamCarsDirty = new Map(); // teamId → cars array

        for (const res of results) {
            const driver = world.driversById[res.driverId];
            const uid = driver?.ownerUid;
            if (!uid) continue;
            try {
                const user = await DB.get('users', uid, { force: true });
                if (!user) continue;
                const p = this.stateOf(user, cfg, uid);
                const r = PC.rng(`${uid}|race|${race.id}`);
                const lines = [];

                // XP, rating, fans, merch, paddock time.
                const xp = PC.gainXP(p.skills, PC.raceXP(res, { wet }));
                p.skills = xp.skills;
                xp.levelUps.forEach(u => PC.logLine(p, PC.SKILLS[u.key].icon, `${PC.SKILLS[u.key].label} reached level ${u.lvl}`));
                const rating = PC.ratingFromSkills(p.skills);
                if (Number(driver.rating) !== rating) await DB.update('drivers', driver.id, { rating }).catch(() => {});
                const fans = PC.raceFans(res, { wet, wetPerk: PC.hasPerk(p.skills, 'wet', 10) });
                p.fans += fans;
                helpers.add(uid, PC.merchFor(p.fans, cfg.econ), '🧢', `Merch sales — ${raceName}`);
                p.ap = p.apMax;
                p.apAt = Date.now();
                p.raceWeek = (Number(p.raceWeek) || 0) + 1;
                p.cardReady = true;
                p.offersAt = 0;

                // Personal sponsors.
                const keep = [];
                for (const d of p.sponsors) {
                    const o = PC.sponsorRace(d, res, r, { cleanPerk: PC.hasPerk(p.skills, 'consistency', 16) });
                    helpers.add(uid, o.pay, '💰', `Sponsor: ${d.brand} — ${raceName}`);
                    if (o.bonus) helpers.add(uid, o.bonus, '🎯', `Sponsor bonus: ${d.brand} objective met`);
                    o.lines.forEach(l => lines.push(['💰', l]));
                    if (o.walked) News.post('💔', `${d.brand} pulls its backing from ${driver.name}`);
                    if (o.renew) p.offers.push(PC.renewalOffer(o.deal, o.renew, r));
                    if (!o.ended) keep.push(o.deal);
                }
                p.sponsors = keep;

                // Loans: an installment per race started.
                let projected = (Number(user.balance) || 0) + helpers.netFor('player', uid);
                const loans = [];
                for (const l of p.loans) {
                    const pay = Math.min(l.perRace, l.balance);
                    helpers.add(uid, -pay, '🏦', `Loan repayment: ${l.label}`);
                    projected -= pay;
                    p.credit = PC.creditAfterPayment(p.credit, projected);
                    const next = { ...l, balance: l.balance - pay, racesLeft: l.racesLeft - 1 };
                    if (next.balance > 0) loans.push(next); else lines.push(['🏦', `${l.label} fully repaid`]);
                }
                p.loans = loans;

                // The car that raced (personal or team garage).
                const signup = signups.find(s => s.driverId === driver.id) || null;
                const viaTeam = signup?.via === 'team' && signup.teamId;
                const h = viaTeam ? { type: 'team', id: signup.teamId } : { type: 'user', id: uid };
                let cars;
                if (viaTeam) cars = teamCarsDirty.get(h.id) || (await DB.get('teams', h.id, { force: true }))?.garage || [];
                else cars = Array.isArray(user.garage) ? user.garage.slice() : [];
                const entry = this.resolveRaceEntry(cars, { signup, raceCarId: viaTeam ? null : p.raceCar, driverId: driver.id, personal: !viaTeam });
                if (entry) {
                    const g = cfg.gremlins ? PC.gremlinCheck(entry, { seed: `${race.id}|${entry.id}`, laps: race.laps }) : { fails: false };
                    const wear = PC.applyRaceWear(entry, {
                        km, laps: race.laps, type: tr?.type || 'rd', result: res, wearMult: cfg.wearMult,
                        skills: { tyres: PC.skillValue(p.skills.tyres) * (PC.hasPerk(p.skills, 'tyres', 16) ? 1.75 : PC.hasPerk(p.skills, 'tyres', 10) ? 1.4 : 1), mechanical: PC.skillValue(p.skills.mechanical) * (PC.hasPerk(p.skills, 'mechanical', 10) ? 1.4 : 1) },
                        failComp: res.dnf && g.fails ? g.comp : null
                    }, r);
                    const done = PC.addHistory(wear.car, res.dnf ? '💥' : '🏁', `${raceName}: ${res.dnf ? 'DNF' : `P${res.position}`}${wear.notes.length ? ' — ' + wear.notes.join(', ') : ''}`, Util.todayISO());
                    cars = cars.map(c => c.id === entry.id ? done : c);
                    lines.push(['🔧', `${entry.name}: ${PC.overall(done)}% after ${raceName}${wear.notes.length ? ` (${wear.notes.join(', ')})` : ''}`]);
                    if (viaTeam) teamCarsDirty.set(h.id, cars);
                }
                // Personal garage: finance installments + storage over capacity.
                {
                    let garage = viaTeam ? (Array.isArray(user.garage) ? user.garage.slice() : []) : cars;
                    let repo = null;
                    garage = garage.map(c => {
                        if (!c.finance) return c;
                        const f = { ...c.finance };
                        const pay = Math.min(f.perRace, f.balance);
                        helpers.add(uid, -pay, '💳', `Finance: ${c.name}`);
                        projected -= pay;
                        f.balance -= pay; f.racesLeft = Math.max(0, f.racesLeft - 1);
                        f.missed = projected < 0 ? (Number(f.missed) || 0) + 1 : 0;
                        p.credit = PC.creditAfterPayment(p.credit, projected);
                        if (f.missed >= 3) { repo = c; return null; }
                        return { ...c, finance: f.balance > 0 ? f : null };
                    }).filter(Boolean);
                    if (repo) { lines.push(['🚨', `${repo.name} repossessed after 3 missed finance payments`]); News.post('🚨', `The finance company repossessed ${driver.name}'s ${repo.name}`); }
                    const cap = PC.garageLevel(p.garageLevel).slots;
                    if (p.seen && garage.length > cap && cfg.storageFee) helpers.add(uid, -(garage.length - cap) * cfg.storageFee, '📦', `Car storage (${garage.length - cap} over capacity)`);
                    await DB.update('users', uid, { garage, garageCarIds: Garage.flatIds(garage) });
                }
                lines.forEach(([icon, text]) => PC.logLine(p, icon, text));
                PC.logLine(p, '🏁', `${raceName}: ${res.dnf ? 'DNF' : `P${res.position}`} · +${fans} fans`);
                await DB.update('users', uid, { paddock: this._clean(p) });
            } catch (e) { console.warn('Paddock settlement failed for', res.driverId, e); }
        }
        for (const [teamId, cars] of teamCarsDirty) {
            try { await DB.update('teams', teamId, { garage: cars, garageCarIds: Garage.flatIds(cars) }); } catch (e) { console.warn('Team car wear write failed:', e); }
        }

        // Team sponsors, judged on each team's best finisher.
        const byTeam = {};
        for (const res of results) {
            const t = world.driversById[res.driverId]?.teamId;
            if (!t) continue;
            const pos = res.dnf ? 999 : Number(res.position) || 999;
            if (!byTeam[t] || pos < (byTeam[t].dnf ? 999 : Number(byTeam[t].position) || 999)) byTeam[t] = res;
        }
        for (const [teamId, best] of Object.entries(byTeam)) {
            const team = world.teamsById[teamId];
            if (!team?.ownerUid || !Array.isArray(team.paddock?.sponsors) || !team.paddock.sponsors.length) continue;
            try {
                const tp = { ...team.paddock };
                const r = PC.rng(`${teamId}|race|${race.id}`);
                const keep = [];
                for (const d of tp.sponsors) {
                    const o = PC.sponsorRace(d, best, r);
                    helpers.addTeam(teamId, o.pay, '💰', `Team sponsor: ${d.brand} — ${raceName}`);
                    if (o.bonus) helpers.addTeam(teamId, o.bonus, '🎯', `Team sponsor bonus: ${d.brand}`);
                    if (o.walked) News.post('💔', `${d.brand} pulls out of its deal with ${team.name}`);
                    if (o.renew) tp.offers = [...(tp.offers || []), PC.renewalOffer(o.deal, o.renew, r)];
                    if (!o.ended) keep.push(o.deal);
                }
                tp.sponsors = keep;
                await DB.update('teams', teamId, { paddock: this.json(tp) });
            } catch (e) { console.warn('Team sponsor settlement failed:', e); }
        }
    },

    // Which garage entry raced: the signup's recorded entry, else the
    // designated race car / assigned team car matching the signup's carId.
    // personal: a player's own garage — with no car named anywhere, the
    // first car in it is the race car (a team garage needs an assignment).
    resolveRaceEntry(cars, { signup, raceCarId, driverId, personal = false }) {
        if (!cars?.length) return null;
        if (signup?.garageEntryId) { const e = cars.find(c => c.id === signup.garageEntryId); if (e) return e; }
        const carId = signup?.carId ? Garage.carId(signup.carId) : null;
        if (carId) {
            const matches = cars.filter(c => Garage._entryIds(c).includes(carId));
            return matches.find(c => c.id === raceCarId) || matches.find(c => c.assigned === driverId) || matches[0] || null;
        }
        return cars.find(c => c.id === raceCarId) || cars.find(c => c.assigned === driverId) || (personal ? cars[0] : null);
    },

    // The garage entry a signup should record (called by Views.toggleSignup).
    async raceEntryFor(elig) {
        try {
            const cfg = await this.config();
            const p = this.stateOf(Auth.state.profile, cfg, Auth.uid());
            if (elig.via === 'team' && elig.teamId) {
                const team = await DB.get('teams', elig.teamId, { force: true });
                return this.resolveRaceEntry(team?.garage || [], { signup: { carId: elig.carId }, driverId: Auth.state.profile?.driverId })?.id || null;
            }
            return this.resolveRaceEntry(Market.myGarage(), { signup: { carId: elig.carId }, raceCarId: p.raceCar, personal: true })?.id || null;
        } catch (e) { return null; }
    },

    /* ---------------- Race window: your car for this race ---------------- */
    async raceCardHtml(race, world, mySignup, elig) {
        const PC = this.PC;
        try {
            if (!Auth.isPlayer() || !Auth.state.profile?.driverId) return '';
            if (race.status === 'completed' || race.status === 'cancelled') return '';
            const cfg = await this.config();
            if (!cfg.enabled) return '';
            const p = this.stateOf(Auth.state.profile, cfg, Auth.uid());
            let cars = Market.myGarage();
            let where = 'your garage';
            const viaTeam = mySignup ? (mySignup.via === 'team' && mySignup.teamId) : (elig?.via === 'team' && elig.teamId);
            if (viaTeam) {
                const team = await DB.get('teams', viaTeam, { force: true });
                cars = team?.garage || [];
                where = team?.name || 'the team';
            }
            const entry = this.resolveRaceEntry(cars, {
                signup: mySignup || (elig?.carId ? { carId: elig.carId } : null),
                raceCarId: viaTeam ? null : p.raceCar, driverId: Auth.state.profile.driverId, personal: !viaTeam
            });
            if (!entry) return '';
            const lg = window.Library?.libGameFor ? Library.libGameFor(world.gamesById[race.gameId]) : null;
            const off = PC.aiOffset(entry);
            const aiLabel = lg?.ai?.label || 'AI strength';
            const g = cfg.gremlins && mySignup ? PC.gremlinCheck(entry, { seed: `${race.id}|${entry.id}`, laps: race.laps }) : null;
            return `<section class="pd-race-car">
                <h3 class="section-label pd-sec">🔧 Your car — ${Util.esc(entry.nick || entry.name)} <span class="muted small">(${Util.esc(where)})</span></h3>
                ${this.carKpis(entry)}
                ${this.condGrid(entry)}
                <p class="small" style="margin-top:.5rem">🎚️ Car vs an average field: ${off === 0 ? `leave ${Util.esc(aiLabel)} at your usual level` : `${off > 0 ? 'raise' : 'lower'} ${Util.esc(aiLabel)} about <strong>${Math.abs(off)}</strong> step${Math.abs(off) === 1 ? '' : 's'} from your usual level`} (PI ${PC.pi(entry)}).</p>
                ${g ? (g.fails
                    ? `<div class="warn-banner pd-gremlin">⚠️ <strong>Mechanical gremlin:</strong> your ${Util.esc(PC.COMPONENTS[g.comp].label.toLowerCase())} won't make the distance. ${g.lap ? `Retire on <strong>lap ${g.lap}</strong>` : `Retire at about <strong>${g.pct}%</strong> race distance`} and report a DNF. Fix the car in the Paddock before the race to clear this.</div>`
                    : `<p class="small pd-good-text">✅ Pre-race inspection passed (${PC.reliability(entry)}% reliability).</p>`) : ''}
                <div class="btn-row"><button class="btn btn-secondary btn-sm" onclick="Modal.close();App.go('paddock','garage')">🔧 Prep the car in the Paddock</button></div>
            </section>`;
        } catch (e) { console.warn('Race car card failed:', e); return ''; }
    },

    /* ---------------- Simulated races: car + skill pace ---------------- */
    // driverId → pace bonus for human drivers in a simulated race (their
    // car's PI and Qualifying Ace perk). Reads at most one doc per human.
    async simPaceMap(race, world, grid) {
        const PC = this.PC;
        const out = {};
        try {
            const cfg = await this.config();
            if (!cfg.enabled) return out;
            let signups = [];
            try { signups = (await DB.signups()).filter(s => s.raceId === race.id); } catch (e) { /* */ }
            for (const d of grid.filter(x => x.ownerUid)) {
                const user = await DB.get('users', d.ownerUid).catch(() => null);
                if (!user) continue;
                const p = PC.ensurePaddock(user.paddock, d.ownerUid);
                const signup = signups.find(s => s.driverId === d.id);
                const viaTeam = signup?.via === 'team' && signup.teamId;
                const cars = viaTeam ? world.teamsById[signup.teamId]?.garage || [] : user.garage || [];
                const entry = this.resolveRaceEntry(cars, { signup, raceCarId: viaTeam ? null : p.raceCar, driverId: d.id, personal: !viaTeam });
                let bonus = entry ? (PC.pi(entry) - 55) * 0.15 : 0;
                if (PC.hasPerk(p.skills, 'pace', 16)) bonus += 2;
                out[d.id] = bonus;
            }
        } catch (e) { console.warn('Sim pace map failed:', e); }
        return out;
    },

    /* ---------------- Nav badge ---------------- */
    badgeCount() {
        const p = Auth.state.profile?.paddock;
        if (!p || !Auth.isPlayer()) return 0;
        return (p.card ? 1 : 0) + (Array.isArray(p.sponsors) ? p.sponsors.filter(s => s.request).length : 0);
    },

    /* ============================================================
       Admin → 🅿️ Paddock
       ============================================================ */
    async adminPanel(body) {
        const PC = this.PC;
        const cfg = await this.config(true);
        const [users, world] = await Promise.all([DB.users({ force: true }).catch(() => []), DB.loadWorld()]);
        const players = users.filter(u => u.walletInitialized);
        const rows = players.map(u => {
            const p = PC.ensurePaddock(u.paddock, u.id);
            const g = Array.isArray(u.garage) ? u.garage : [];
            const avg = g.length ? Math.round(g.reduce((s, c) => s + PC.overall(c), 0) / g.length) : null;
            return `<tr><td>${Util.esc(u.displayName || u.email || u.id)}</td><td class="num">${p.fans.toLocaleString('en-US')}</td>
                <td class="num">${PC.ratingFromSkills(p.skills)}</td><td class="num">${p.ap}</td><td class="num">${p.sponsors.length}</td>
                <td class="num">${Economy.fmt(p.loans.reduce((s, l) => s + l.balance, 0))}</td><td class="num">${g.length}${avg !== null ? ` · ${avg}%` : ''}</td><td class="num">${p.credit}</td></tr>`;
        }).join('');
        const num = (id, label, v, step, min, max, hint) => `<label class="field"><span>${label}</span><input id="${id}" class="input" type="number" step="${step}" min="${min}" max="${max}" value="${v}"><span class="muted small">${hint}</span></label>`;
        body.innerHTML = `
        <section class="panel">
            <div class="panel-head"><h2>🅿️ Paddock settings</h2></div>
            <p class="muted small">The between-race RPG layer: car wear and shops, used lots, sponsors with objectives, training, side events, loans. Every player's state lives on their own profile; nothing here needs a new database collection.</p>
            <form id="pd-admin" class="form-grid">
                <label class="check"><input type="checkbox" id="pda-enabled" ${cfg.enabled ? 'checked' : ''}> Paddock open for players</label>
                <label class="check"><input type="checkbox" id="pda-gremlins" ${cfg.gremlins ? 'checked' : ''}> Mechanical gremlins (worn cars get "retire on lap N" orders)</label>
                <div class="form-row">
                    ${num('pda-apbase', '⏱ Paddock time cap', cfg.apBase, 1, 4, 30, 'Before fitness perks')}
                    ${num('pda-apday', '⏱ Regen per day', cfg.apPerDay, 1, 0, 30, 'Plus a full refill after every race a player runs')}
                </div>
                <div class="form-row">
                    ${num('pda-wear', '🔧 Wear multiplier', cfg.wearMult, 0.1, 0, 3, '1 = normal, 0 = cars never wear')}
                    ${num('pda-econ', '💵 Money multiplier', cfg.econ, 0.1, 0.2, 5, 'Sponsors, events, shop prices, training')}
                    ${num('pda-storage', '📦 Storage fee', cfg.storageFee, 10, 0, 5000, 'Per car over garage capacity, per race')}
                </div>
                <div class="btn-row"><button type="submit" class="btn btn-primary">Save settings</button></div>
            </form>
        </section>
        <section class="panel" style="margin-top:1.1rem">
            <div class="panel-head"><h2>🧰 Tools</h2></div>
            <div class="btn-row">
                <button class="btn btn-secondary btn-sm" onclick="Paddock.adminRestock()">🔄 Restock every used lot now</button>
                <button class="btn btn-secondary btn-sm" onclick="Paddock.adminRefillAP()">⏱ Refill everyone's paddock time</button>
                <button class="btn btn-secondary btn-sm" onclick="Paddock.adminRepairAll()">🔧 Free repairs for every car</button>
            </div>
            <p class="muted small">Used lots restock every Monday on their own (this week: ${Util.esc(PC.weekKey())}, ${Object.keys(cfg.usedSold || {}).length} sold).</p>
        </section>
        <section class="panel" style="margin-top:1.1rem">
            <div class="panel-head"><h2>👥 Players in the paddock (${players.length})</h2></div>
            ${players.length ? `<div class="scroll-list"><table class="table table-tight"><thead><tr><th>Player</th><th class="num">Fans</th><th class="num">Rating</th><th class="num">⏱</th><th class="num">Sponsors</th><th class="num">Loans</th><th class="num">Cars · cond</th><th class="num">Credit</th></tr></thead>
                <tbody>${rows}</tbody></table></div>` : C.empty('👥', 'No players yet', 'Players show up here once they start a career.')}
        </section>`;
        Util.$('#pd-admin', body).addEventListener('submit', async (e) => {
            e.preventDefault();
            const n = (id, lo, hi, d) => { const v = Number(Util.$('#' + id).value); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
            try {
                await this.saveConfig({
                    enabled: Util.$('#pda-enabled').checked, gremlins: Util.$('#pda-gremlins').checked,
                    apBase: Math.round(n('pda-apbase', 4, 30, 10)), apPerDay: Math.round(n('pda-apday', 0, 30, 4)),
                    wearMult: n('pda-wear', 0, 3, 1), econ: n('pda-econ', 0.2, 5, 1), storageFee: Math.round(n('pda-storage', 0, 5000, 100))
                });
                Util.notify('Paddock settings saved. 🅿️');
                Admin.refresh();
            } catch (err) { Util.notify(err.message, 'error'); }
        });
    },
    async adminRestock() {
        if (!Admin.guard()) return;
        const cfg = await this.config(true);
        await this.saveConfig({ lotSalt: (Number(cfg.lotSalt) || 0) + 1, usedSold: {} });
        Util.notify('Every used lot has fresh stock. 🔄');
        Admin.refresh();
    },
    async adminRefillAP() {
        if (!Admin.guard()) return;
        const cfg = await this.config(true);
        const users = await DB.users({ force: true }).catch(() => []);
        let n = 0;
        for (const u of users.filter(x => x.paddock)) {
            const p = this.stateOf(u, cfg, u.id);
            p.ap = p.apMax; p.apAt = Date.now();
            await DB.update('users', u.id, { paddock: this._clean(p) }).catch(() => {});
            n++;
        }
        Util.notify(`Refilled paddock time for ${Util.plural(n, 'player')}. ⏱`);
        Admin.refresh();
    },
    async adminRepairAll() {
        if (!Admin.guard()) return;
        if (!confirm('Restore every player and team car to 100%? Upgrades are kept.')) return;
        const PC = this.PC;
        const fix = (g) => (Array.isArray(g) ? g : []).map(c => c.cond ? { ...c, cond: PC.fullCond(100), hidden: [] } : c);
        const [users, teams] = await Promise.all([DB.users({ force: true }).catch(() => []), DB.teams({ force: true })]);
        for (const u of users.filter(x => Array.isArray(x.garage) && x.garage.length)) await DB.update('users', u.id, { garage: fix(u.garage) }).catch(() => {});
        for (const t of teams.filter(x => Array.isArray(x.garage) && x.garage.length)) await DB.update('teams', t.id, { garage: fix(t.garage) }).catch(() => {});
        Util.notify('Every car is fresh from the workshop. 🔧');
        Admin.refresh();
    }
};
window.Paddock = Paddock;
