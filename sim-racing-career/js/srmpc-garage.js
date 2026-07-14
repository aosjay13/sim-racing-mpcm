/* ============================================================
   Phoenix SRMPC — Garage & Vehicle Ownership
   One unified garage model on BOTH kinds of profile:
     users/{uid}.garage  — the Player Garage (personal cars,
                           already used by the Dealership)
     teams/{id}.garage   — the Team Garage (organizational cars,
                           bought from the team budget)
   Every garage entry carries a normalized `carId` token — the SAME
   nomenclature the GM types into the Schedule Builder's
   space-delimited "Eligible cars" list (race.carChoices, falling
   back to series.carChoices). Alongside each garage array we keep a
   flat `garageCarIds` string array on the same document, purely so
   firestore.rules can check ownership with `in` (rules can't scan
   an array of objects for a nested field).

   Eligibility (the Series Registration gatekeeper):
     1. Independent entry — the player's own garage has an eligible car.
     2. Team entry — a team the player is linked to (primary teamId,
        owned team, or active contract) has an eligible car.
     3. Support staff for an independent driver — the hiring driver's
        owner has an eligible car in their personal garage.
   An event with NO carChoices is open entry — no car required.
   ============================================================ */
'use strict';

const Garage = {
    /* ---------------- Car-ID nomenclature ---------------- */
    // "Phoenix GT-R Street Spec" → "phoenix-gt-r-street-spec". This is the
    // canonical token: the GM's space-delimited carChoices are single tokens
    // (dashes, no spaces), and garage entries store the same slug, so the
    // two sides always compare in one nomenclature.
    carId(name) {
        return String(name || '').toLowerCase().trim()
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    },

    // The GM's raw "Eligible cars" input — space-delimited tokens.
    parseChoices(raw) {
        const seen = new Set();
        String(raw || '').split(/\s+/).forEach(t => { const id = this.carId(t); if (id) seen.add(id); });
        return Array.from(seen);
    },

    // Effective car requirement for an event: the race's own carChoices win;
    // otherwise the series-wide list; empty = open entry.
    choicesFor(race, series) {
        const raw = (Array.isArray(race?.carChoices) && race.carChoices.length)
            ? race.carChoices
            : (Array.isArray(series?.carChoices) ? series.carChoices : []);
        return this.parseChoices(raw.join(' '));
    },

    /* ---------------- Garage reads (users AND teams) ---------------- */
    garageOf(doc) { return Array.isArray(doc?.garage) ? doc.garage : []; },

    // Every id an entry answers to: its stored carId plus the slug of its
    // display name (covers cars bought before carId existed).
    _entryIds(entry) {
        const ids = new Set();
        if (entry?.carId) ids.add(this.carId(entry.carId));
        const fromName = this.carId(entry?.name);
        if (fromName) ids.add(fromName);
        return Array.from(ids);
    },

    // Flat id list for a garage — persisted as `garageCarIds` next to the
    // garage array so firestore.rules can check membership with `in`.
    flatIds(garage) {
        const seen = new Set();
        (garage || []).forEach(e => this._entryIds(e).forEach(id => seen.add(id)));
        return Array.from(seen);
    },

    // First entry in `doc.garage` matching any of `choices` (else null).
    findEligibleCar(doc, choices) {
        return this.garageOf(doc).find(e => this._entryIds(e).some(id => choices.includes(id))) || null;
    },

    /* ---------------- Garage writes (keep garageCarIds in sync) ---------------- */
    async persistPlayerGarage(garage) {
        await Auth.updateProfile({ garage, garageCarIds: this.flatIds(garage) });
    },
    async persistTeamGarage(teamId, garage) {
        await DB.update('teams', teamId, { garage, garageCarIds: this.flatIds(garage) });
    },

    /* ============================================================
       validateSeriesEligibility — THE gatekeeper.
       Returns { eligible, via, reason, carId, carName, teamId, choices }.
       via: 'open' | 'personal' | 'team' | 'staff-driver' | null
       role: 'driver' (default) or a staff role — staff get path 3.
       ============================================================ */
    async validateSeriesEligibility(uid, seriesId, { raceId = null, role = 'driver' } = {}) {
        const world = await DB.loadWorld();
        const series = world.seriesById[seriesId] || null;
        const race = raceId ? world.races.find(r => r.id === raceId) : null;
        const choices = this.choicesFor(race, series);
        const base = { carId: null, carName: null, teamId: null, choices };

        if (!choices.length) {
            return { ...base, eligible: true, via: 'open', reason: 'Open entry — no specific car required for this event.' };
        }

        const user = (uid === Auth.uid() && Auth.state.profile)
            ? Auth.state.profile
            : await DB.get('users', uid).catch(() => null);

        // Path 1: independent entry — the personal Player Garage.
        let car = this.findEligibleCar(user, choices);
        if (car) {
            return {
                ...base, eligible: true, via: 'personal',
                carId: this._entryIds(car).find(id => choices.includes(id)), carName: car.name,
                reason: `Eligible — your garage has the ${car.name}.`
            };
        }

        // Path 2: team entry — every team this player is linked to.
        const contracts = await DB.contracts().catch(() => []);
        const myActive = contracts.filter(c => c.status === 'active' && c.personUid === uid);
        const teamIds = new Set();
        if (user?.teamId) teamIds.add(user.teamId);
        world.drivers.filter(d => d.ownerUid === uid && d.teamId).forEach(d => teamIds.add(d.teamId));
        world.teams.filter(t => t.ownerUid === uid).forEach(t => teamIds.add(t.id));
        myActive.filter(c => c.teamId).forEach(c => teamIds.add(c.teamId));

        for (const tid of teamIds) {
            const team = world.teamsById[tid];
            if (!team) continue;
            car = this.findEligibleCar(team, choices);
            if (car) {
                return {
                    ...base, eligible: true, via: 'team', teamId: tid,
                    carId: this._entryIds(car).find(id => choices.includes(id)), carName: car.name,
                    reason: `Eligible — your team ${team.name} owns the ${car.name}.`
                };
            }
        }

        // Path 3: support staff hired directly by an independent driver
        // (active contract with a player owner but no team) — the supported
        // driver must own the car personally.
        if (role !== 'driver') {
            for (const c of myActive.filter(c => !c.teamId && c.ownerUid)) {
                const owner = await DB.get('users', c.ownerUid).catch(() => null);
                car = this.findEligibleCar(owner, choices);
                if (car) {
                    return {
                        ...base, eligible: true, via: 'staff-driver',
                        carId: this._entryIds(car).find(id => choices.includes(id)), carName: car.name,
                        reason: `Eligible — the driver you support owns the ${car.name}.`
                    };
                }
            }
        }

        return {
            ...base, eligible: false, via: null,
            reason: `Ineligible — missing a required vehicle from your Garage. Eligible cars: ${choices.join(', ')}. Buy one at the Dealership, or race for a team that owns one.`
        };
    },

    // Self-heal: legacy docs have garage entries but no garageCarIds field,
    // which would make the firestore.rules ownership check fail even for a
    // legitimate owner. Called right before a gated signup write.
    async ensureFlatIds(elig) {
        try {
            if (elig.via === 'personal') {
                const g = this.garageOf(Auth.state.profile);
                const flat = this.flatIds(g);
                const have = Auth.state.profile?.garageCarIds || [];
                if (flat.some(id => !have.includes(id))) await Auth.updateProfile({ garageCarIds: flat });
            } else if (elig.via === 'team' && elig.teamId) {
                const team = await DB.get('teams', elig.teamId, { force: true }).catch(() => null);
                if (!team) return;
                const flat = this.flatIds(this.garageOf(team));
                const have = team.garageCarIds || [];
                if (flat.some(id => !have.includes(id))) await DB.update('teams', elig.teamId, { garageCarIds: flat });
            }
        } catch (e) { console.warn('garageCarIds sync failed:', e); }
    },

    /* ---------------- UI: eligibility badge ---------------- */
    eligibilityHtml(elig) {
        if (elig.via === 'open') return '';
        return elig.eligible
            ? `<p class="small" style="margin-top:.6rem;color:var(--good)">✅ ${Util.esc(elig.reason)}</p>`
            : `<p class="small" style="margin-top:.6rem;color:var(--bad)">🚫 ${Util.esc(elig.reason)}</p>`;
    },

    /* ============================================================
       Team Garage — sell on the TEAM budget (Wallet). Team PURCHASES
       happen at the Dealership storefront's "For team" button
       (Dealership.buy in js/srmpc-dealership.js).
       ============================================================ */
    async sellTeamCar(teamId, entryId) {
        try {
            const team = await DB.get('teams', teamId, { force: true });
            if (!team || team.ownerUid !== Auth.uid()) throw new Error('Only the team owner can sell team cars.');
            const garage = this.garageOf(team);
            const car = garage.find(c => c.id === entryId);
            if (!car) return;
            const back = Math.round((Number(car.price) || 0) * Market.SELL_RATIO);
            if (!confirm(`Sell the team's ${car.name} back to the Dealership for ${Economy.fmt(back)}?`)) return;
            await this.persistTeamGarage(teamId, garage.filter(c => c.id !== entryId));
            await Wallet.adjustTeamWallet(teamId, back, '🚗', `Sold ${car.name} (Team Garage)`);
            Util.notify(`Sold the ${car.name} for ${Economy.fmt(back)} — credited to the team budget. 💵`);
            App.go(App.current.view, App.current.param);
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    // Team Garage panel — rendered in the Team Owner workspace. Buying
    // happens at the Dealership storefront ("For team" button).
    teamGaragePanel(team) {
        const cars = this.garageOf(team);
        return `<section class="panel">
            <div class="panel-head"><h2>🚗 Team Garage (${cars.length})</h2>
                <button class="btn btn-primary btn-sm" onclick="App.go('dealership')">🏬 Buy Car</button></div>
            <p class="muted small">Team cars unlock series entry for every driver contracted to this team — a series only accepts cars on its GM-set eligible list.</p>
            ${cars.length ? cars.map(c => `
                <div class="race-row">
                    ${CarImg.normalize(c.imageUrl) ? CarImg.thumb(c.imageUrl, c.name)
                        : `<div class="driver-hero-num" style="font-size:1.2rem;min-width:2.8rem;height:2.8rem">${c.emoji || '🚗'}</div>`}
                    <div class="race-row-main">
                        <span class="race-title">${Util.esc(c.name)} <span class="chip chip-dim">${Util.esc(c.carId || this.carId(c.name))}</span></span>
                        <span class="race-sub">${Util.esc(c.tag || '')} · bought ${Util.esc(Util.fmtDateShort(c.boughtAt))} for ${Economy.fmt(c.price)}</span>
                    </div>
                    <button class="btn btn-ghost btn-sm" onclick="Garage.sellTeamCar('${Util.attr(team.id)}','${Util.attr(c.id)}')">Sell ${Economy.fmt(Math.round((Number(c.price) || 0) * Market.SELL_RATIO))}</button>
                </div>`).join('')
            : C.empty('🏚', 'The team garage is empty', 'Buy cars from the team budget — they make the whole roster eligible for series that require them.')}
        </section>`;
    }
};
window.Garage = Garage;
