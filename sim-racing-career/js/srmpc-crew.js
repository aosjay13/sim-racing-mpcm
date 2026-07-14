/* ============================================================
   Phoenix SRMPC — Immersive Crew Chief & Mechanic Roles
   • Crew event registration: crew chiefs / mechanics enter a race
     under their role (crewSignups — separate from raceSignups so
     the vehicle-ownership gate never applies to pit-lane staff).
   • Crew Chief Pre-Race Pit Wall: setup advice, pit strategy, and
     telemetry notes transmitted to each contracted driver's race
     screen before the session (races/{id}.crewChiefNotes).
   • Mechanic prestige buffs: the mechanic's star level scales a
     per-game modifier — direct performance/repair buffs for titles
     whose cars we can touch (Wreckfest, GT, Forza, AMS2, BeamNG…),
     or a legal AI-difficulty offset for hardcore sims (iRacing,
     NR2003) where car files are off-limits.
   • Lock-in + ledger: modifiers only activate when the crew member
     is REGISTERED for the event under the role AND attached to the
     team/driver. Everything applied is frozen into the post-race
     ledger and races/{id}.crewLog to justify race-day payouts.
   ============================================================ */
'use strict';

const Crew = {
    /* ============================================================
       Game paradigms — how a mechanic's prestige touches the car.
       Matched against the game's name, case-insensitive substring.
       ============================================================ */
    DIRECT_TITLES: ['wreckfest', 'gran turismo', 'forza', 'automobilista', 'beamng', 'need for speed', 'grid'],
    DIFFICULTY_TITLES: ['iracing', 'nascar racing 2003', 'nr2003', 'rfactor', 'assetto corsa', 'le mans ultimate'],

    paradigmFor(gameTitle) {
        const t = String(gameTitle || '').toLowerCase();
        if (this.DIFFICULTY_TITLES.some(k => t.includes(k))) return 'difficulty';
        if (this.DIRECT_TITLES.some(k => t.includes(k))) return 'direct';
        // Unknown titles default to direct — the league can always tune the car.
        return 'direct';
    },

    /* The one robust modifier function. mechanicLevel is the prestige star
       count (1–5). Returns either a direct performance-buff payload or a
       legal AI-difficulty reduction the driver may apply locally. */
    calculateMechanicBuff(mechanicLevel, gameTitle) {
        const level = Prestige.clamp(mechanicLevel);
        const paradigm = this.paradigmFor(gameTitle);
        if (paradigm === 'difficulty') {
            // −1% … −5% AI opponent strength, one point per star.
            const offset = -level;
            return {
                paradigm, level, game: gameTitle || null,
                aiDifficultyOffsetPct: offset,
                summary: `${offset}% AI difficulty offset (driver may lower local AI strength by ${Math.abs(offset)}%)`
            };
        }
        // Direct paradigm: baseline performance + repair efficiency in the DB.
        return {
            paradigm, level, game: gameTitle || null,
            performanceBuffPct: level,          // +1% … +5% baseline performance
            repairEfficiencyPct: level * 4,     // +4% … +20% repair efficiency
            summary: `+${level}% car performance · +${level * 4}% repair efficiency`
        };
    },

    // The full tier ladder for the upgrades panel (per game paradigm).
    tierTable(gameTitle) {
        return Prestige.LEVELS.map(l => ({
            ...l, buff: this.calculateMechanicBuff(l.stars, gameTitle)
        }));
    },

    /* ============================================================
       Crew event registration (crewSignups)
       Doc: { raceId, uid, role: 'crew-chief'|'mechanic', name,
              roleProfileId, teamId, clientDriverIds, buff }
       ============================================================ */
    async signups(raceId = null) {
        const all = await DB.list('crewSignups', { force: true }).catch(() => []);
        return raceId ? all.filter(s => s.raceId === raceId) : all;
    },

    async myProfile(role) {
        const profiles = await DB.roleProfiles().catch(() => []);
        return profiles.find(p => p.uid === Auth.uid() && p.role === role) || null;
    },

    // Lock-in rule: a crew member only counts when registered for the event
    // under the role AND attached — a mechanic to the team, a crew chief to
    // at least one contracted client driver.
    attachmentFor(profile, world) {
        if (!profile) return { attached: false, reason: 'No role profile yet.' };
        if (profile.role === 'mechanic') {
            const team = world.teamsById[profile.teamId];
            return team
                ? { attached: true, teamId: team.id, label: `wrenching for ${team.name}` }
                : { attached: false, reason: 'Join a team first — buffs only lock in for your contracted team.' };
        }
        const clients = (profile.clientDriverIds || []).filter(id => world.driversById[id]);
        return clients.length
            ? { attached: true, clientDriverIds: clients, label: `${clients.length} contracted driver${clients.length === 1 ? '' : 's'}` }
            : { attached: false, reason: 'Add drivers to your book first — strategy notes go to contracted drivers only.' };
    },

    async toggleCrewSignup(raceId, role) {
        try {
            const uid = Auth.uid();
            const mine = (await this.signups(raceId)).filter(s => s.uid === uid && s.role === role);
            if (mine.length) {
                for (const s of mine) await DB.remove('crewSignups', s.id);
                Util.notify('Crew entry withdrawn.');
            } else {
                const world = await DB.loadWorld();
                const race = world.races.find(r => r.id === raceId);
                if (!race || race.status === 'completed') throw new Error('This event is no longer open.');
                const profile = await this.myProfile(role);
                const att = this.attachmentFor(profile, world);
                if (!att.attached) throw new Error(att.reason);
                const game = world.gamesById[race.gameId];
                await DB.create('crewSignups', {
                    raceId, uid, role,
                    roleProfileId: profile.id, name: profile.name || 'Crew',
                    teamId: att.teamId || null,
                    clientDriverIds: att.clientDriverIds || [],
                    buff: role === 'mechanic'
                        ? this.calculateMechanicBuff(Prestige.stored(profile), game?.name) : null
                });
                Util.notify(role === 'mechanic'
                    ? 'You are on the pit crew — your prestige buff is locked in for this event. 🔧'
                    : 'You are on the pit wall — open the Pre-Race Dashboard to brief your drivers. 📋');
            }
            Views.showRace(raceId);
        } catch (e) { Util.notify('Could not update crew entry: ' + e.message, 'error'); }
    },

    /* ============================================================
       Crew Chief Pre-Race Dashboard
       Notes live on the race doc, keyed by the driver's entry:
       races/{id}.crewChiefNotes[driverId] =
         { chiefUid, chiefName, setup, strategy, telemetry,
           checklist: [{ item, done }], updatedAt }
       ============================================================ */
    CHECKLIST: ['Setup sheet transmitted', 'Fuel & tire plan agreed', 'Pit window confirmed', 'Telemetry review done'],

    async chiefDashboard(raceId) {
        const world = await DB.loadWorld();
        const race = world.races.find(r => r.id === raceId);
        if (!race) { Util.notify('Race not found.', 'error'); return; }
        const profile = await this.myProfile('crew-chief');
        const att = this.attachmentFor(profile, world);
        if (!att.attached) { Util.notify(att.reason, 'error'); return; }

        // Only clients actually ENTERED in this event get a briefing card.
        let entries = [];
        try { entries = (await DB.signups({ force: true })).filter(s => s.raceId === raceId); } catch (e) { /* */ }
        const enteredIds = new Set(entries.map(s => s.driverId));
        const clients = att.clientDriverIds.map(id => world.driversById[id]).filter(Boolean);
        const briefed = clients.filter(d => enteredIds.has(d.id));
        const notes = race.crewChiefNotes || {};

        const card = (d) => {
            const n = notes[d.id] || {};
            const checklist = this.CHECKLIST.map((item, i) => {
                const done = (n.checklist || []).find(c => c.item === item)?.done;
                return `<label class="check crew-flag-item"><input type="checkbox" data-check="${i}" ${done ? 'checked' : ''}> ${Util.esc(item)}</label>`;
            }).join('');
            return `<div class="crew-card" data-driver="${Util.attr(d.id)}">
                <div class="crew-card-head"><span class="crew-flag">🏁</span><strong>${Util.esc(d.name)}</strong>
                    <span class="chip chip-dim">${Util.esc(world.teamsById[d.teamId]?.name || 'Privateer')}</span></div>
                <label class="field"><span>Setup advice</span>
                    <textarea class="input" data-note="setup" rows="2" maxlength="500" placeholder="Wing, gearing, tire pressures…">${Util.esc(n.setup || '')}</textarea></label>
                <label class="field"><span>Pit strategy</span>
                    <textarea class="input" data-note="strategy" rows="2" maxlength="500" placeholder="Stops, fuel loads, undercut windows…">${Util.esc(n.strategy || '')}</textarea></label>
                <label class="field"><span>Telemetry notes</span>
                    <textarea class="input" data-note="telemetry" rows="2" maxlength="500" placeholder="Brake points, sector deltas, traffic…">${Util.esc(n.telemetry || '')}</textarea></label>
                <div class="crew-checklist">${checklist}</div>
            </div>`;
        };

        Modal.open(`
            ${Modal.header('📋 Pre-Race Pit Wall', `${Util.esc(race.name || race.track || 'Race')} · notes transmit straight to each driver's race screen`)}
            ${briefed.length ? briefed.map(card).join('')
                : C.empty('📋', 'None of your drivers are entered yet',
                    'Briefing cards appear here for every contracted driver on this event\'s entry list.')}
            <div class="modal-actions">
                <button class="btn btn-ghost" onclick="Modal.close()">Close</button>
                ${briefed.length ? '<button class="btn btn-primary" id="crew-transmit">🏁 Transmit to drivers</button>' : ''}
            </div>
        `, { wide: true });

        document.getElementById('crew-transmit')?.addEventListener('click', async () => {
            try {
                const patch = {};
                Util.$$('.crew-card').forEach(cardEl => {
                    const driverId = cardEl.dataset.driver;
                    const val = (k) => cardEl.querySelector(`[data-note="${k}"]`).value.trim();
                    patch[`crewChiefNotes.${driverId}`] = {
                        chiefUid: Auth.uid(), chiefName: profile.name || 'Crew Chief',
                        setup: val('setup'), strategy: val('strategy'), telemetry: val('telemetry'),
                        checklist: this.CHECKLIST.map((item, i) => ({
                            item, done: cardEl.querySelector(`[data-check="${i}"]`).checked
                        })),
                        updatedAt: Util.todayISO()
                    };
                });
                await DB.update('races', raceId, patch);
                Modal.close();
                Util.notify('Strategy transmitted to your drivers. 🏁');
            } catch (e) { Util.notify('Transmit failed: ' + e.message, 'error'); }
        });
    },

    // The driver's side: their crew chief's briefing on the race screen.
    pitWallHtml(race, driverId) {
        const n = race?.crewChiefNotes?.[driverId];
        if (!n) return '';
        const line = (icon, label, text) => text
            ? `<div class="crew-note-line"><span class="crew-flag">🏁</span><strong>${label}:</strong> ${Util.esc(text)}</div>` : '';
        const done = (n.checklist || []).filter(c => c.done).length;
        return `<div class="crew-pitwall">
            <div class="crew-card-head"><span class="crew-flag">🏁</span><strong>Pit Wall — ${Util.esc(n.chiefName || 'Crew Chief')}</strong>
                <span class="chip chip-dim">${done}/${this.CHECKLIST.length} checks · ${Util.esc(Util.fmtDateShort(n.updatedAt))}</span></div>
            ${line('🔧', 'Setup', n.setup)}
            ${line('⛽', 'Strategy', n.strategy)}
            ${line('📊', 'Telemetry', n.telemetry)}
        </div>`;
    },

    /* ============================================================
       Race modal section — crew entries + register buttons + the
       driver's pit-wall briefing (pre-race) or crew log (post-race).
       ============================================================ */
    async raceSection(race, world) {
        let crew = [];
        try { crew = await this.signups(race.id); } catch (e) { /* member-only */ }

        // Post-race: show the frozen crew log (what was actually applied).
        if (race.status === 'completed') {
            const log = race.crewLog || [];
            if (!log.length) return '';
            return `<h3 class="section-label">Crew Contributions</h3>
                <div class="crew-panel">${log.map(l =>
                    `<div class="crew-note-line"><span class="crew-flag">🏁</span><strong>${Util.esc(l.name)}</strong> (${l.role === 'mechanic' ? '🔧 Mechanic' : '📋 Crew Chief'}) — ${Util.esc(l.applied)}</div>`).join('')}
                </div>`;
        }

        const uid = Auth.uid();
        const myRole = Auth.state.profile?.activeRole;
        const myDriverId = Auth.state.profile?.driverId;
        let html = '';

        if (crew.length) {
            html += `<h3 class="section-label">Pit Lane (${crew.length})</h3><div class="chip-row">${crew.map(s =>
                `<span class="chip" title="${s.buff ? Util.esc(s.buff.summary) : 'Crew Chief'}">${s.role === 'mechanic' ? '🔧' : '📋'} ${Util.esc(s.name)}</span>`).join('')}</div>`;
        }

        // My driver's briefing from the pit wall.
        if (myDriverId) html += this.pitWallHtml(race, myDriverId);

        // Register / manage buttons for crew roles.
        if ((myRole === 'crew-chief' || myRole === 'mechanic') && uid) {
            const mine = crew.find(s => s.uid === uid && s.role === myRole);
            const label = myRole === 'mechanic' ? '🔧 Join as Mechanic' : '📋 Join as Crew Chief';
            html += `<div class="btn-row" style="margin-top:.75rem">
                ${mine
                    ? `<button class="btn btn-secondary" onclick="Crew.toggleCrewSignup('${Util.attr(race.id)}','${myRole}')">Withdraw crew entry</button>`
                    : `<button class="btn btn-primary" onclick="Crew.toggleCrewSignup('${Util.attr(race.id)}','${myRole}')">${label}</button>`}
                ${mine && myRole === 'crew-chief'
                    ? `<button class="btn btn-primary" onclick="Crew.chiefDashboard('${Util.attr(race.id)}')">🏁 Pre-Race Dashboard</button>` : ''}
            </div>`;
            if (mine?.buff) html += `<p class="muted small" style="margin-top:.35rem">🏁 Locked in: ${Util.esc(mine.buff.summary)}</p>`;
        }
        return html;
    },

    /* ============================================================
       Career-workspace panels (flat 2D, checkered-flag bullets)
       ============================================================ */
    _upcoming(world, days = 30) {
        const today = Util.todayISO();
        return world.races
            .filter(r => r.status !== 'completed' && (r.date || '') >= today)
            .sort((a, b) => (a.date || '').localeCompare(b.date || '')).slice(0, 6);
    },

    async chiefPanel(profile, world) {
        const upcoming = this._upcoming(world);
        let crew = [];
        try { crew = await this.signups(); } catch (e) { /* */ }
        const mineByRace = new Set(crew.filter(s => s.uid === Auth.uid() && s.role === 'crew-chief').map(s => s.raceId));
        return `<section class="panel crew-panel">
            <div class="panel-head"><h2>📋 Pre-Race Pit Wall</h2></div>
            <p class="muted small">Register for an event as Crew Chief, then transmit setup advice, pit strategy,
                and telemetry notes straight to your contracted drivers before the session.</p>
            <ul class="crew-flag-list">
                <li>Register for the event under your Crew Chief role</li>
                <li>Brief every contracted driver on the entry list</li>
                <li>Transmit — notes land on their race screen instantly</li>
                <li>Your inputs are frozen into the post-race ledger</li>
            </ul>
            ${upcoming.length ? upcoming.map(r => `
                <div class="race-row">
                    <div class="race-row-main"><span class="race-title">${Util.esc(r.name || r.track || 'Race')}</span>
                        <span class="race-sub">${Util.esc(Util.fmtDateShort(r.date))}${mineByRace.has(r.id) ? ' · ✅ on the pit wall' : ''}</span></div>
                    ${mineByRace.has(r.id)
                        ? `<button class="btn btn-primary btn-sm" onclick="Crew.chiefDashboard('${Util.attr(r.id)}')">🏁 Dashboard</button>`
                        : `<button class="btn btn-secondary btn-sm" onclick="Views.showRace('${Util.attr(r.id)}')">Register →</button>`}
                </div>`).join('')
                : C.empty('📋', 'No upcoming events', 'When races are scheduled, register here to run the pit wall.')}
        </section>`;
    },

    async mechanicPanel(profile, world) {
        const team = world.teamsById[profile.teamId];
        const series = team?.seriesId ? world.seriesById[team.seriesId] : null;
        const game = series?.gameId ? world.gamesById[series.gameId] : null;
        const gameName = game?.name || null;
        const level = Prestige.stored(profile);
        const current = this.calculateMechanicBuff(level, gameName);
        const tiers = this.tierTable(gameName);
        let crew = [];
        try { crew = await this.signups(); } catch (e) { /* */ }
        const mineByRace = new Set(crew.filter(s => s.uid === Auth.uid() && s.role === 'mechanic').map(s => s.raceId));
        const upcoming = this._upcoming(world);

        return `<section class="panel crew-panel">
            <div class="panel-head"><h2>🔧 Mechanic Upgrades</h2>
                <span class="chip">${Prestige.stars(level)} ${Prestige.levelName(level)}</span></div>
            <p class="muted small">${gameName
                ? `Series title: <strong>${Util.esc(gameName)}</strong> — ${current.paradigm === 'difficulty'
                    ? 'a hardcore sim: your prestige grants your drivers a legal AI-difficulty offset instead of touching car files.'
                    : 'your prestige applies a direct buff to the car\'s baseline performance and repair efficiency.'}`
                : 'Join a team in a series to see which buff paradigm its game uses.'}</p>
            <ul class="crew-flag-list crew-tiers">
                ${tiers.map(t => `<li class="${t.stars === level ? 'crew-tier-active' : ''}">
                    <strong>${Prestige.stars(t.stars)} ${t.name}</strong> — ${Util.esc(t.buff.summary)}</li>`).join('')}
            </ul>
            <div class="crew-current">🏁 <strong>Your locked-in buff:</strong> ${Util.esc(current.summary)}</div>
            <h3 class="section-label" style="margin-top:1rem">Race-Day Activation</h3>
            <p class="muted small">Buffs only apply when you're registered for the event as Mechanic and contracted to the team fielding the car.</p>
            ${upcoming.length ? upcoming.map(r => `
                <div class="race-row">
                    <div class="race-row-main"><span class="race-title">${Util.esc(r.name || r.track || 'Race')}</span>
                        <span class="race-sub">${Util.esc(Util.fmtDateShort(r.date))}${mineByRace.has(r.id) ? ' · ✅ buff locked in' : ''}</span></div>
                    <button class="btn ${mineByRace.has(r.id) ? 'btn-secondary' : 'btn-primary'} btn-sm" onclick="Views.showRace('${Util.attr(r.id)}')">${mineByRace.has(r.id) ? 'Manage' : 'Register →'}</button>
                </div>`).join('')
                : C.empty('🔧', 'No upcoming events', 'When races are scheduled, register here to lock your buff onto the car.')}
        </section>`;
    },

    /* ============================================================
       Race-day settlement — called from Sim.payoutRace.
       Pays registered, attached crew (base + level bonus) and returns
       the frozen crewLog persisted onto the race doc, so the ledger
       always justifies the payout with the modifier actually applied.
       ============================================================ */
    STIPEND_BASE: 100,
    STIPEND_PER_STAR: 25,

    async settleRace(race, world, addLine) {
        const log = [];
        let crew = [];
        try { crew = await this.signups(race.id); } catch (e) { return log; }
        let profiles = [];
        try { profiles = await DB.roleProfiles({ force: true }); } catch (e) { /* */ }
        const racedTeams = new Set((race.results || []).map(r => world.driversById[r.driverId]?.teamId).filter(Boolean));
        const racedDrivers = new Set((race.results || []).map(r => r.driverId));
        const raceName = race.name || race.track || 'race';
        const game = world.gamesById[race.gameId];

        for (const s of crew.filter(s => s.uid)) {
            const profile = profiles.find(p => p.id === s.roleProfileId) || null;
            const level = Prestige.stored(profile || { prestige: 1 });
            let applied = null;
            if (s.role === 'mechanic') {
                // Lock-in: registered AND their team actually fielded a car.
                if (!s.teamId || !racedTeams.has(s.teamId)) continue;
                const buff = this.calculateMechanicBuff(level, game?.name);
                applied = buff.summary;
                log.push({ uid: s.uid, name: s.name, role: 'mechanic', teamId: s.teamId, modifier: buff, applied });
                // Persist the applied buff onto the team doc — the "car in the
                // database" the direct paradigm modifies between events.
                try { await DB.update('teams', s.teamId, { mechanicBuff: { ...buff, raceId: race.id, appliedAt: Util.todayISO() } }); } catch (e) { /* */ }
            } else {
                // Crew chief: registered AND at least one briefed client raced.
                const briefed = (s.clientDriverIds || []).filter(id =>
                    racedDrivers.has(id) && race.crewChiefNotes?.[id]);
                const racedClients = (s.clientDriverIds || []).filter(id => racedDrivers.has(id));
                if (!racedClients.length) continue;
                applied = briefed.length
                    ? `pre-race briefing transmitted to ${briefed.length} driver${briefed.length === 1 ? '' : 's'}`
                    : `on the pit wall for ${racedClients.length} driver${racedClients.length === 1 ? '' : 's'} (no briefing filed)`;
                log.push({
                    uid: s.uid, name: s.name, role: 'crew-chief', clientDriverIds: racedClients,
                    notes: Object.fromEntries(briefed.map(id => [id, race.crewChiefNotes[id]])), applied
                });
            }
            const pay = this.STIPEND_BASE + this.STIPEND_PER_STAR * level;
            addLine(s.uid, pay, s.role === 'mechanic' ? '🔧' : '📋',
                `${s.role === 'mechanic' ? 'Mechanic' : 'Crew chief'} race-day payout (${applied}) — ${raceName}`);
        }

        if (log.length) {
            try { await DB.update('races', race.id, { crewLog: log }); } catch (e) { console.warn('Crew log write failed:', e); }
        }
        return log;
    }
};
window.Crew = Crew;
