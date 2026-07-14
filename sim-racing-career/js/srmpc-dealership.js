/* ============================================================
   Phoenix SRMPC — Dealership & GM Vehicle Creation
   A GM-curated global inventory replaces the old hardcoded
   Market.STOCK trio.

   Collection: dealershipInventory — one doc per purchasable car:
   {
     name:      'Toyota GR Supra RZ',        // display name
     carId:     'toyota-gr-supra-rz',        // Garage.carId(name) — the SAME
                                             // token nomenclature the GM types
                                             // into Schedule Builder carChoices
     emoji:     '🏎️',
     gameId:    <games doc id> | null,       // which sim it lives in
     seriesIds: ['<series id>', …],          // eligible series (informational
                                             // link to the Schedule Builder;
                                             // race entry is still gated by
                                             // carChoices via js/srmpc-garage.js)
     condition: 'new' | 'used',
     price:     42000,
     stats:     { performance: 1–10, durability: 1–10 },  // base stats for the
                                             // future Mechanic upgrade system
     available: true | false,                // GM shelf toggle (hidden ≠ deleted)
     notes:     '',                          // optional GM flavor line
     imageUrl:  ''                           // 2D promo shot: 'https://…' (GM-pasted
                                             // link) or 'img://<vehicleImages doc>'
                                             // (GM file upload) — see js/srmpc-carimg.js.
                                             // Copied verbatim onto every garage entry.
   }

   Purchases COPY a reference of the doc into the buyer's garage
   (users/{uid}.garage or teams/{id}.garage — js/srmpc-garage.js keeps
   the rules-facing garageCarIds mirror in sync) and debit the exact
   price from the matching wallet with an immutable ledger row
   (Economy.spend / Wallet.teamSpend).

   UI is strictly flat 2D — panels, race-rows and chips only, with 🏁
   checkered markers on every data point. No 3D cards, no shadows.
   ============================================================ */
'use strict';

const Dealership = {
    CONDITIONS: { new: { label: 'New', icon: '✨' }, used: { label: 'Used', icon: '🔑' } },

    /* ---------------- Starter pack: realistic cars per sim ---------------- */
    // One-click GM seed. Game titles are created (or reused by name) so every
    // car lands properly linked. Prices roughly scale with performance.
    STARTER_PACK: [
        { game: 'Wreckfest', cars: [
            { name: 'Roadslayer GT', emoji: '🚗', condition: 'new', price: 24000, performance: 6, durability: 9 },
            { name: 'Hammerhead RS', emoji: '🛻', condition: 'new', price: 21000, performance: 5, durability: 10 },
            { name: 'Rocket RX', emoji: '🚙', condition: 'used', price: 9500, performance: 7, durability: 6 }
        ] },
        { game: 'Gran Turismo 7', cars: [
            { name: 'Toyota GR Supra RZ', emoji: '🏎️', condition: 'new', price: 54000, performance: 7, durability: 8 },
            { name: 'Nissan GT-R NISMO', emoji: '🏎️', condition: 'new', price: 88000, performance: 9, durability: 7 },
            { name: 'Porsche 911 GT3 RS', emoji: '🏎️', condition: 'new', price: 115000, performance: 10, durability: 7 },
            { name: 'Mazda MX-5 ND', emoji: '🚗', condition: 'used', price: 14000, performance: 4, durability: 9 }
        ] },
        { game: 'Forza Motorsport', cars: [
            { name: 'Ford Mustang GT', emoji: '🚗', condition: 'new', price: 38000, performance: 6, durability: 8 },
            { name: 'Chevrolet Corvette C8', emoji: '🏎️', condition: 'new', price: 72000, performance: 8, durability: 7 },
            { name: 'BMW M4 Competition', emoji: '🚗', condition: 'used', price: 33000, performance: 7, durability: 7 }
        ] },
        { game: 'iRacing', cars: [
            { name: 'Porsche 992 GT3 Cup', emoji: '🏁', condition: 'new', price: 98000, performance: 9, durability: 6 },
            { name: 'Dallara P217 LMP2', emoji: '🏎️', condition: 'new', price: 140000, performance: 10, durability: 6 },
            { name: 'ARCA Menards Chevrolet', emoji: '🚗', condition: 'used', price: 26000, performance: 5, durability: 8 }
        ] },
        { game: 'NASCAR Racing 2003 Season', cars: [
            { name: 'Chevrolet Monte Carlo Cup', emoji: '🏁', condition: 'new', price: 45000, performance: 7, durability: 8 },
            { name: 'Ford Taurus Cup', emoji: '🏁', condition: 'new', price: 45000, performance: 7, durability: 8 },
            { name: 'Dodge Intrepid Cup', emoji: '🏁', condition: 'used', price: 19000, performance: 6, durability: 7 }
        ] },
        { game: 'Automobilista 2', cars: [
            { name: 'Stock Car Pro Cruze', emoji: '🚗', condition: 'new', price: 52000, performance: 7, durability: 8 },
            { name: 'Formula Trainer', emoji: '🏎️', condition: 'used', price: 16000, performance: 5, durability: 6 }
        ] },
        { game: 'BeamNG.drive', cars: [
            { name: 'Gavril D-Series', emoji: '🛻', condition: 'used', price: 7500, performance: 3, durability: 9 },
            { name: 'Ibishu 200BX', emoji: '🚗', condition: 'used', price: 8900, performance: 5, durability: 6 }
        ] }
    ],

    /* ---------------- Reads ---------------- */
    async inventory(opts) { return DB.list('dealershipInventory', opts); },
    async availableInventory() { return (await this.inventory({ force: true })).filter(c => c.available !== false); },

    _statBar(label, v) {
        v = Math.max(0, Math.min(10, Number(v) || 0));
        return `<span class="chip chip-dim" title="${label} ${v}/10">🏁 ${label} ${v}/10</span>`;
    },

    /* ============================================================
       Public storefront — flat 2D, checkered markers, dynamic filters.
       ============================================================ */
    _filters: { gameId: '', seriesId: '', condition: '', sort: 'price-desc' },

    async storefront(el) {
        if (!Auth.isSignedIn()) {
            el.innerHTML = C.empty('🔒', 'Sign in to visit the Dealership', 'Every player can buy cars here — drivers keep their own garage and can bring cars to a new team.');
            return;
        }
        const [inv, world] = await Promise.all([this.availableInventory(), DB.loadWorld()]);
        const f = this._filters;
        const canBuy = Auth.isPlayer() && Auth.state.profile?.walletInitialized;
        const myTeam = world.teams.find(t => t.ownerUid === Auth.uid()) || null;

        let cars = inv.filter(c =>
            (!f.gameId || c.gameId === f.gameId) &&
            (!f.seriesId || (Array.isArray(c.seriesIds) && c.seriesIds.includes(f.seriesId))) &&
            (!f.condition || (c.condition || 'new') === f.condition));
        cars.sort((a, b) => f.sort === 'price-asc' ? (a.price || 0) - (b.price || 0)
            : f.sort === 'name' ? String(a.name).localeCompare(String(b.name))
            : (b.price || 0) - (a.price || 0));

        const gamesInStock = [...new Set(inv.map(c => c.gameId).filter(Boolean))]
            .map(id => world.gamesById[id]).filter(Boolean);
        const seriesInStock = [...new Set(inv.flatMap(c => c.seriesIds || []))]
            .map(id => world.seriesById[id]).filter(Boolean);

        // Flat 2D listing card: promo shot on top (fixed 16:9 crop, branded
        // checkered placeholder when the GM hasn't attached one), a checkered
        // divider, then the same stat chips as before. No shadows, no 3D.
        const row = (c) => {
            const cond = this.CONDITIONS[c.condition] || this.CONDITIONS.new;
            const game = world.gamesById[c.gameId];
            const series = (c.seriesIds || []).map(id => world.seriesById[id]?.name).filter(Boolean);
            return `
            <div class="car-card">
                ${CarImg.html(c.imageUrl, c.name)}
                <div class="checker-divider" role="separator">🏁</div>
                <div class="car-card-body">
                    <span class="race-title">${c.emoji || '🚗'} ${Util.esc(c.name)}
                        <span class="chip chip-dim">${cond.icon} ${cond.label}</span>
                        <span class="chip chip-dim">${Util.esc(c.carId || Garage.carId(c.name))}</span></span>
                    <span class="race-sub">🏁 ${Util.esc(game?.name || 'Any sim')}${series.length ? ` · 🏁 ${Util.esc(series.join(', '))}` : ''}</span>
                    <span class="chip-row" style="margin-top:.25rem">
                        ${this._statBar('Perf', c.stats?.performance)} ${this._statBar('Durab', c.stats?.durability)}
                        <span class="chip chip-dim">🏁 <span class="market-price">${Economy.fmt(c.price)}</span></span>
                    </span>
                    <div class="btn-row" style="margin-top:.5rem">
                        <button class="btn btn-primary btn-sm" ${canBuy ? '' : 'disabled title="Player accounts with a started career can buy"'}
                            onclick="Dealership.buy('${Util.attr(c.id)}')">🔑 Buy</button>
                        ${myTeam ? `<button class="btn btn-secondary btn-sm" onclick="Dealership.buy('${Util.attr(c.id)}','${Util.attr(myTeam.id)}')">🛠 For team</button>` : ''}
                    </div>
                </div>
            </div>`;
        };

        el.innerHTML = `
        <div class="view-head">
            <div><h1>🏬 Dealership</h1><p class="muted">🏁 The league's global inventory — curated by the Game Master. Cars bought here unlock series entry (Garage rules apply).</p></div>
            <div class="btn-row">${Economy.walletChip()}${myTeam ? `<span class="chip wallet-chip">🛠 ${Util.esc(myTeam.name)}: ${Economy.fmt(Wallet.teamBalance(myTeam.id))}</span>` : ''}</div>
        </div>

        <section class="panel" style="margin-bottom:1.1rem">
            <div class="panel-head"><h2>🏁 Showroom (${cars.length})</h2><span class="chip chip-dim">🏁 ${inv.length} in the league catalog</span></div>
            <div class="form-row" style="margin-bottom:.8rem;flex-wrap:wrap;gap:.5rem">
                <select id="deal-f-game" class="input" style="max-width:14rem">
                    <option value="">🏁 All games</option>
                    ${gamesInStock.map(g => `<option value="${Util.attr(g.id)}" ${f.gameId === g.id ? 'selected' : ''}>${Util.esc(g.name)}</option>`).join('')}
                </select>
                <select id="deal-f-series" class="input" style="max-width:14rem">
                    <option value="">🏁 All series</option>
                    ${seriesInStock.map(s => `<option value="${Util.attr(s.id)}" ${f.seriesId === s.id ? 'selected' : ''}>${Util.esc(s.name)}</option>`).join('')}
                </select>
                <select id="deal-f-cond" class="input" style="max-width:10rem">
                    <option value="">🏁 New & used</option>
                    <option value="new" ${f.condition === 'new' ? 'selected' : ''}>✨ New only</option>
                    <option value="used" ${f.condition === 'used' ? 'selected' : ''}>🔑 Used only</option>
                </select>
                <select id="deal-f-sort" class="input" style="max-width:12rem">
                    <option value="price-desc" ${f.sort === 'price-desc' ? 'selected' : ''}>🏁 Price: high → low</option>
                    <option value="price-asc" ${f.sort === 'price-asc' ? 'selected' : ''}>🏁 Price: low → high</option>
                    <option value="name" ${f.sort === 'name' ? 'selected' : ''}>🏁 Name A–Z</option>
                </select>
            </div>
            ${cars.length ? `<div class="car-grid">${cars.map(row).join('')}</div>`
                : C.empty('🏬', inv.length ? 'No cars match those filters' : 'The showroom is empty',
                    inv.length ? 'Clear a filter or two — the catalog has more in stock.'
                        : 'The Game Master stocks this dealership from Admin → Dealership.')}
        </section>

        ${Market.garagePanel()}`;

        [['deal-f-game', 'gameId'], ['deal-f-series', 'seriesId'], ['deal-f-cond', 'condition'], ['deal-f-sort', 'sort']]
            .forEach(([id, key]) => Util.$('#' + id, el)?.addEventListener('change', (e) => {
                this._filters[key] = e.target.value;
                this.storefront(el);
            }));
    },

    /* ============================================================
       Purchase execution — exact price, wallet-matched, ledger-paired,
       then a copy/reference of the doc lands in the buyer's garage.
       forTeamId: null → personal wallet; a team id → that TEAM's budget
       (owner only).
       ============================================================ */
    _garageEntryFrom(car) {
        return {
            id: 'car-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
            sourceId: car.id,                          // reference back to the inventory doc
            carId: car.carId || Garage.carId(car.name),
            name: car.name, emoji: car.emoji || '🚗',
            tag: [car.gameName, this.CONDITIONS[car.condition]?.label].filter(Boolean).join(' · '),
            gameId: car.gameId || null, condition: car.condition || 'new',
            stats: { performance: Number(car.stats?.performance) || 5, durability: Number(car.stats?.durability) || 5 },
            price: Number(car.price) || 0, boughtAt: Util.todayISO(),
            // The promo shot travels with the sale — garages render the same
            // image (or reference) the showroom listing carried, forever.
            imageUrl: CarImg.normalize(car.imageUrl)
        };
    },

    async buy(invId, forTeamId = null) {
        try {
            const car = await DB.get('dealershipInventory', invId, { force: true });
            if (!car || car.available === false) throw new Error('That car is no longer on the market.');
            const world = await DB.loadWorld();
            const entry = this._garageEntryFrom({ ...car, gameName: world.gamesById[car.gameId]?.name });

            if (forTeamId) {
                const team = await DB.get('teams', forTeamId, { force: true });
                if (!team || team.ownerUid !== Auth.uid()) throw new Error('Only the team owner can buy cars for the team.');
                // Team wallet: teamSpend enforces funds and writes the ledger row.
                await Wallet.teamSpend(forTeamId, entry.price, `${car.name} (Dealership)`, '🚗');
                await Garage.persistTeamGarage(forTeamId, [...Garage.garageOf(team), entry]);
                News.post('🚗', `${team.name} bought a ${car.name} from the Dealership`);
                Util.notify(`${entry.emoji} ${car.name} is in the ${team.name} garage. 🏁`);
            } else {
                if (!Auth.isPlayer() || !Auth.state.profile?.walletInitialized) {
                    throw new Error('Start your career (pick a difficulty) before buying cars.');
                }
                // Player wallet: Economy.spend enforces funds and writes the ledger row.
                await Economy.spend(entry.price, `${car.name} (Dealership)`, '🚗');
                await Garage.persistPlayerGarage([...Market.myGarage(), entry]);
                News.post('🚗', `${Auth.state.profile?.displayName || 'A player'} bought a ${car.name} from the Dealership`);
                Util.notify(`${entry.emoji} ${car.name} is yours! It's parked in your garage. 🏁`);
            }
            App.go(App.current.view, App.current.param);
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    /* ============================================================
       GM Vehicle Creation & Management (Admin → Dealership tab body).
       ============================================================ */
    async adminPanel(el) {
        const [inv, world] = await Promise.all([this.inventory({ force: true }), DB.loadWorld()]);
        const rows = inv.slice().sort((a, b) => String(a.name).localeCompare(String(b.name))).map(c => {
            const cond = this.CONDITIONS[c.condition] || this.CONDITIONS.new;
            const off = c.available === false;
            return `
            <div class="race-row" style="${off ? 'opacity:.55' : ''}">
                ${CarImg.normalize(c.imageUrl) ? CarImg.thumb(c.imageUrl, c.name)
                    : `<div class="driver-hero-num" style="font-size:1.1rem;min-width:2.6rem;height:2.6rem">${c.emoji || '🚗'}</div>`}
                <div class="race-row-main">
                    <span class="race-title">${Util.esc(c.name)}
                        <span class="chip chip-dim">${Util.esc(c.carId || Garage.carId(c.name))}</span>
                        ${off ? '<span class="badge badge-dim">Off market</span>' : '<span class="badge badge-green">Listed</span>'}</span>
                    <span class="race-sub">🏁 ${Util.esc(world.gamesById[c.gameId]?.name || 'Any sim')} · 🏁 ${cond.icon} ${cond.label} · 🏁 ${Economy.fmt(c.price)}
                        · 🏁 Perf ${Number(c.stats?.performance) || 0}/10 · 🏁 Durab ${Number(c.stats?.durability) || 0}/10
                        ${(c.seriesIds || []).length ? ` · 🏁 ${Util.esc((c.seriesIds || []).map(id => world.seriesById[id]?.name).filter(Boolean).join(', '))}` : ''}</span>
                </div>
                <div class="btn-row">
                    <button class="btn btn-secondary btn-sm" onclick="Dealership.gmForm('${Util.attr(c.id)}')">✎ Edit</button>
                    <button class="btn btn-ghost btn-sm" onclick="Dealership.gmToggle('${Util.attr(c.id)}')">${off ? 'Relist' : 'Unlist'}</button>
                    <button class="btn btn-danger btn-sm" onclick="Dealership.gmDelete('${Util.attr(c.id)}')">Delete</button>
                </div>
            </div>`;
        });

        el.innerHTML = `
        <section class="panel">
            <div class="panel-head"><h2>🏬 Dealership Inventory (${inv.length})</h2>
                <div class="btn-row">
                    <button class="btn btn-secondary btn-sm" onclick="Dealership.installStarterPack()">📦 Load Starter Pack</button>
                    <button class="btn btn-primary btn-sm" onclick="Dealership.gmForm()">＋ Add Car</button>
                </div></div>
            <ul class="checkered-list" style="margin-bottom:.9rem">
                <li>Every car you list here is instantly buyable by players (personal wallet) and team owners (team budget).</li>
                <li>The car's ID token is what you paste into a series' <strong>Eligible cars</strong> list in the Schedule Builder.</li>
                <li>Unlist to pull a car off the market without deleting it — owned copies stay in garages either way.</li>
            </ul>
            ${rows.length ? rows.join('') : C.empty('🏬', 'No cars in the catalog yet', 'Add cars one at a time, or load the realistic starter pack (Wreckfest, GT7, Forza, iRacing, NR2003, AMS2, BeamNG).')}
        </section>`;
    },

    async gmForm(invId = null) {
        if (!Admin.guard()) return;
        const [car, world] = await Promise.all([
            invId ? DB.get('dealershipInventory', invId, { force: true }) : null,
            DB.loadWorld()
        ]);
        const activeSeries = world.series.filter(s => (s.status || 'active') === 'active');
        const sel = (v, cur) => v === cur ? 'selected' : '';
        Modal.open(`
            ${Modal.header(car ? '✎ Edit Vehicle' : '＋ Create Vehicle', 'Cars listed here appear in the public Dealership for players and teams')}
            <form id="deal-form" class="form-grid">
                <div class="form-row">
                    <label class="field"><span>🏁 Vehicle name *</span><input id="df-name" class="input" required maxlength="60" value="${Util.esc(car?.name || '')}" placeholder="e.g. Toyota GR Supra RZ"></label>
                    <label class="field"><span>🏁 Emoji</span><input id="df-emoji" class="input" maxlength="4" value="${Util.esc(car?.emoji || '🚗')}"></label>
                </div>
                <div class="form-row">
                    <label class="field"><span>🏁 Game title</span>
                        <select id="df-game" class="input">
                            <option value="">— Any sim —</option>
                            ${world.games.map(g => `<option value="${Util.attr(g.id)}" ${sel(g.id, car?.gameId)}>${Util.esc(g.name)}</option>`).join('')}
                        </select></label>
                    <label class="field"><span>🏁 Condition</span>
                        <select id="df-cond" class="input">
                            <option value="new" ${sel('new', car?.condition || 'new')}>✨ New</option>
                            <option value="used" ${sel('used', car?.condition)}>🔑 Used</option>
                        </select></label>
                </div>
                <div class="form-row">
                    <label class="field"><span>🏁 Market price *</span><input id="df-price" class="input" type="number" min="1" required value="${Number(car?.price) || 25000}"></label>
                    <label class="field"><span>🏁 Performance (1–10)</span><input id="df-perf" class="input" type="number" min="1" max="10" value="${Number(car?.stats?.performance) || 5}"></label>
                    <label class="field"><span>🏁 Durability (1–10)</span><input id="df-durab" class="input" type="number" min="1" max="10" value="${Number(car?.stats?.durability) || 5}"></label>
                </div>
                <label class="field"><span>🏁 Eligible series (hold Ctrl/Cmd to pick several)</span>
                    <select id="df-series" class="input" multiple size="${Math.min(6, Math.max(3, activeSeries.length))}">
                        ${activeSeries.map(s => `<option value="${Util.attr(s.id)}" ${(car?.seriesIds || []).includes(s.id) ? 'selected' : ''}>${Util.esc(s.name)}</option>`).join('')}
                    </select>
                    <span class="muted small">Informational link for storefront filtering. Race entry itself is enforced by the series/race <strong>Eligible cars</strong> token list.</span></label>
                <label class="field"><span>🏁 Notes (optional)</span><input id="df-notes" class="input" maxlength="140" value="${Util.esc(car?.notes || '')}" placeholder="e.g. ex-league car, one careful owner"></label>
                <div class="form-row">
                    <label class="field" style="flex:2"><span>🏁 Vehicle image — paste a URL…</span>
                        <input id="df-img-url" class="input" type="url" maxlength="500" placeholder="https://…  (leave blank for the checkered placeholder)"
                            value="${CarImg.isDirect(CarImg.normalize(car?.imageUrl)) ? Util.esc(car.imageUrl) : ''}"></label>
                    <label class="field"><span>🏁 …or upload a file</span>
                        <input id="df-img-file" class="input" type="file" accept="image/*"></label>
                </div>
                <div id="df-img-preview" class="car-media-preview-wrap">${CarImg.html(car?.imageUrl, car?.name || 'New vehicle')}</div>
                <p class="muted small">Flat 2D promo shot, cropped to 16:9 in every grid. Uploads are compressed in your browser (max ~480 KB) and stored with the league data — no external hosting needed. <button type="button" id="df-img-clear" class="btn btn-ghost btn-sm">Remove image</button></p>
                <p class="muted small">ID token (auto): <strong id="df-carid">${Util.esc(car ? (car.carId || Garage.carId(car.name)) : '—')}</strong> — paste this into a series' Eligible cars list to require it.</p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">${car ? 'Save' : 'Create Vehicle'} 🏁</button>
                </div>
            </form>
        `, { wide: true });

        Util.$('#df-name').addEventListener('input', (e) => {
            Util.$('#df-carid').textContent = Garage.carId(e.target.value) || '—';
        });

        // ---- Image field: URL ⊕ file upload, with an instant 2D preview ----
        // The preview always shows exactly what will save: a pasted URL renders
        // live as typed; a chosen file is compressed in-browser immediately and
        // previewed from the result. The vehicleImages doc is only created on
        // SUBMIT, so cancelling the form never orphans an upload.
        // pendingImage: undefined = keep the car's current image;
        //               '' = cleared; 'https://…' = pasted; {data} = file shot.
        let pendingImage = undefined;
        const preview = (u) => { Util.$('#df-img-preview').innerHTML = CarImg.html(u, Util.$('#df-name').value || 'Vehicle'); };
        Util.$('#df-img-url').addEventListener('input', (e) => {
            Util.$('#df-img-file').value = '';
            pendingImage = CarImg.normalize(e.target.value);
            preview(pendingImage);
        });
        Util.$('#df-img-file').addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                const shot = await CarImg._compress(file);
                if (shot.data.length > CarImg.MAX_DATAURL) throw new Error('That image is too detailed to compress under the storage cap — paste a hosted URL instead.');
                pendingImage = shot;
                Util.$('#df-img-url').value = '';
                preview(shot.data);
            } catch (err) {
                e.target.value = '';
                Util.notify(err.message, 'error');
            }
        });
        Util.$('#df-img-clear').addEventListener('click', () => {
            pendingImage = '';
            Util.$('#df-img-url').value = '';
            Util.$('#df-img-file').value = '';
            preview('');
        });
        Util.$('#deal-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type=submit]');
            btn.disabled = true;
            try {
                const name = Util.$('#df-name').value.trim();
                if (!name) throw new Error('Vehicle name is required.');
                const price = Math.round(Number(Util.$('#df-price').value));
                if (!(price > 0)) throw new Error('Enter a market price above zero.');
                const clamp10 = (v) => Math.min(10, Math.max(1, Math.round(Number(v)) || 5));
                const data = {
                    name, carId: Garage.carId(name),
                    emoji: Util.$('#df-emoji').value.trim() || '🚗',
                    gameId: Util.$('#df-game').value || null,
                    seriesIds: [...Util.$('#df-series').selectedOptions].map(o => o.value),
                    condition: Util.$('#df-cond').value === 'used' ? 'used' : 'new',
                    price,
                    stats: { performance: clamp10(Util.$('#df-perf').value), durability: clamp10(Util.$('#df-durab').value) },
                    notes: Util.$('#df-notes').value.trim(),
                    available: car ? car.available !== false : true
                };
                // Resolve the image LAST: a file shot becomes a vehicleImages
                // doc now (submit time), a pasted URL saves as-is, cleared
                // saves '', and an untouched field keeps the existing value.
                if (pendingImage === undefined) data.imageUrl = CarImg.normalize(car?.imageUrl);
                else if (typeof pendingImage === 'string') data.imageUrl = pendingImage;
                else data.imageUrl = await CarImg.persistShot(pendingImage);
                if (car) await DB.update('dealershipInventory', car.id, data);
                else await DB.create('dealershipInventory', data);
                Modal.close();
                Util.notify(car ? 'Vehicle updated. 🏁' : `${data.emoji} ${data.name} is on the market. 🏁`);
                Admin.refresh();
            } catch (err) {
                Util.notify(err.message, 'error');
                btn.disabled = false;
            }
        });
    },

    async gmToggle(invId) {
        if (!Admin.guard()) return;
        try {
            const car = await DB.get('dealershipInventory', invId, { force: true });
            if (!car) return;
            await DB.update('dealershipInventory', invId, { available: car.available === false });
            Util.notify(car.available === false ? `${car.name} relisted. 🏁` : `${car.name} pulled off the market.`);
            Admin.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    async gmDelete(invId) {
        if (!Admin.guard()) return;
        try {
            const car = await DB.get('dealershipInventory', invId, { force: true });
            if (!car) return;
            if (!confirm(`Delete ${car.name} from the catalog? Copies already in player/team garages are unaffected.`)) return;
            await DB.remove('dealershipInventory', invId);
            Util.notify(`${car.name} removed from the market.`);
            Admin.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    },

    // One-click realistic catalog. Idempotent per car name — re-running skips
    // anything already in the inventory, and reuses existing game docs by name.
    async installStarterPack() {
        if (!Admin.guard()) return;
        try {
            const [inv, games] = await Promise.all([this.inventory({ force: true }), DB.games({ force: true })]);
            const haveCar = new Set(inv.map(c => c.carId || Garage.carId(c.name)));
            const gameIdByName = {};
            games.forEach(g => { gameIdByName[String(g.name).toLowerCase()] = g.id; });

            let added = 0;
            for (const pack of this.STARTER_PACK) {
                let gid = gameIdByName[pack.game.toLowerCase()];
                if (!gid) {
                    gid = await DB.create('games', { name: pack.game, platform: 'PC / Console' });
                    gameIdByName[pack.game.toLowerCase()] = gid;
                }
                const items = pack.cars
                    .filter(c => !haveCar.has(Garage.carId(c.name)))
                    .map(c => ({
                        name: c.name, carId: Garage.carId(c.name), emoji: c.emoji,
                        gameId: gid, seriesIds: [], condition: c.condition, price: c.price,
                        stats: { performance: c.performance, durability: c.durability },
                        notes: '', available: true
                    }));
                if (items.length) { await DB.batchCreate('dealershipInventory', items); added += items.length; }
            }
            Util.notify(added ? `Starter pack loaded — ${Util.plural(added, 'car')} across ${this.STARTER_PACK.length} sims. 🏁` : 'Starter pack already loaded — nothing new to add.');
            Admin.refresh();
        } catch (e) { Util.notify(e.message, 'error'); }
    }
};
window.Dealership = Dealership;
