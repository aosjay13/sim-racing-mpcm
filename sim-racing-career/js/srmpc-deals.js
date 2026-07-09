/* ============================================================
   Phoenix SRMPC — Deals & Contract Negotiations
   One negotiation engine for every signing in the league:
   team ⇄ driver, team ⇄ staff, sponsor ⇄ team/driver, and
   pay renegotiations on existing contracts.

   Player vs player: offers, counters, and notes travel through
   a negotiation "room" (a message thread both sides can read),
   and nothing signs until someone accepts.
   Player vs AI: the AI answers instantly — accepts fair offers,
   counters lowballs, walks away from insults.

   League rule enforced everywhere: pay can never exceed the
   paid party's prestige level (Economy.payCap).
   ============================================================ */
'use strict';

const Deals = {
    MIN_SPONSOR_PAYOUT: 50,   // NPC teams/drivers take any sponsorship at/above this
    INSULT_RATIO: 0.4,        // offers below 40% of the minimum make the AI walk
    AGENT_COMMISSION: 0.10,   // player agents earn 10% of client race salaries

    /* ---------------- Prestige pay caps ---------------- */
    // The cap always follows the party being PAID — talent for hires, and
    // for sponsorships the SPONSOR's own prestige (their brand can only
    // credibly spend at its level).
    async capForNeg(neg, world = null) {
        world = world || await DB.loadWorld();
        if (neg.kind === 'sponsorship') {
            const sp = await DB.get('roleProfiles', neg.sponsorProfileId).catch(() => null);
            const stars = Prestige.stored(sp || { prestige: 1 });
            return { stars, cap: Economy.payCap(stars), who: neg.sponsorName };
        }
        if (neg.personKind === 'driver') {
            const stars = Prestige.driverStars(neg.personId, world);
            return { stars, cap: Economy.payCap(stars), who: neg.personName };
        }
        const person = await DB.get('staff', neg.personId).catch(() => null);
        const stars = Prestige.stored(person || { prestige: 1 });
        return { stars, cap: Economy.payCap(stars), who: neg.personName };
    },

    /* ---------------- Multi-team exclusivity rules ---------------- */
    // A driver may hold contracts with several teams as long as no ACTIVE
    // contract is exclusive. Contracts from before the multi-team era have
    // no `exclusive` field — they were single-team deals, so they count as
    // exclusive.
    async canSignWithTeam(driverId, teamId, incomingExclusive, contracts = null) {
        contracts = contracts || await DB.contracts({ force: true }).catch(() => []);
        const active = contracts.filter(c => c.status === 'active' && c.type !== 'sponsorship'
            && c.personKind === 'driver' && c.personId === driverId);
        if (active.some(c => c.teamId === teamId)) {
            return { ok: false, reason: 'They already have an active contract with this team.' };
        }
        const exclusiveWith = active.find(c => c.exclusive !== false);
        if (exclusiveWith) {
            return { ok: false, reason: `They are under an EXCLUSIVE contract with ${exclusiveWith.teamName || 'another team'} — it must end before they can sign elsewhere.` };
        }
        if (incomingExclusive && active.length) {
            return { ok: false, reason: `An exclusive contract requires no other team deals — they currently drive for ${active.map(c => c.teamName).join(', ')}.` };
        }
        return { ok: true };
    },

    /* ---------------- Starting a negotiation ---------------- */
    // Creates the negotiation and, when the other side is AI, resolves their
    // answer immediately. Returns the negotiation doc (post-resolution).
    // sideAProxyUid lets the Game Master negotiate FOR an unowned team: the GM
    // drives the conversation, but the contract stays league-owned (no ownerUid,
    // no wallet debits from the GM).
    async start({ kind, teamId = null, teamName = '', ownerUid = null, sideAProxyUid = null,
        personId = null, personKind = null, personName = '', personUid = null,
        sponsorProfileId = null, sponsorName = '', sponsorUid = null,
        targetDriverId = null, targetDriverName = '', targetDriverUid = null,
        contractId = null, salary, buyout = 0, exclusive = false, note = '' }) {

        salary = Math.round(Number(salary) || 0);
        if (salary <= 0) throw new Error('Offer a salary above zero.');

        const uid = Auth.uid();
        const myName = Auth.state.profile?.displayName || 'A player';
        // Paying side (A) = team owner / sponsor. Paid side (B) = talent / sponsorship target.
        const sideAUid = kind === 'sponsorship' ? sponsorUid : (ownerUid || sideAProxyUid);
        const sideBUid = kind === 'sponsorship' ? (teamId ? ownerUid : targetDriverUid) : personUid;
        const neg = {
            kind, status: 'open', contractId,
            teamId, teamName, ownerUid,
            personId, personKind, personName, personUid,
            sponsorProfileId, sponsorName, sponsorUid,
            targetDriverId, targetDriverName, targetDriverUid,
            salary, buyout: Math.round(Number(buyout) || 0), exclusive: !!exclusive,
            sideAUid, sideBUid,
            initiatorUid: uid,
            turnUid: (uid === sideAUid ? sideBUid : sideAUid) || null,
            history: [{ byUid: uid, byName: myName, action: 'offer', salary, note: note || '', at: Util.todayISO() }]
        };

        // Cap check up front (against the live cap).
        const capInfo = await this.capForNeg(neg);
        if (salary > capInfo.cap) {
            throw new Error(`League rule: ${capInfo.who} is ${Prestige.stars(capInfo.stars)} ${Prestige.levelName(capInfo.stars)} — pay is capped at ${Economy.fmt(capInfo.cap)}/race.`);
        }
        neg.capStars = capInfo.stars;
        neg.capAmount = capInfo.cap;

        // No duplicate open negotiations for the same subject.
        const existing = (await DB.list('negotiations', { force: true }).catch(() => []))
            .find(n => n.status === 'open' && n.kind === kind && n.teamId === teamId &&
                n.personId === personId && n.sponsorProfileId === sponsorProfileId &&
                n.targetDriverId === targetDriverId);
        if (existing) throw new Error('A negotiation for this deal is already open — continue it from your Deals panel.');

        // Multi-team sanity before wasting anyone's time.
        if (kind === 'team-driver' && !contractId) {
            const can = await this.canSignWithTeam(personId, teamId, neg.exclusive);
            if (!can.ok) throw new Error(can.reason);
        }

        neg.id = await DB.create('negotiations', neg);
        if (neg.turnUid === null) await this._npcRespond(neg);
        return DB.get('negotiations', neg.id);
    },

    /* ---------------- The AI across the table ---------------- */
    // Generated dialogue for AI team principals (unowned teams).
    PRINCIPAL_LINES: {
        offer: [
            'Our scouts have had eyes on you for a while. The board approved {SALARY}/race for your signature.',
            'We like what you bring to the grid. The seat pays {SALARY}/race — fair money for where you are.',
            'The garage is ready and the budget is signed off: {SALARY}/race. Interested?'
        ],
        accept: [
            'Deal. The seat is yours — don\'t make the board regret it.',
            'Fair number. Welcome to the team — the car\'s waiting.',
            'Agreed. Legal will draw the papers up today. Welcome aboard.'
        ],
        counter: [
            'That\'s above our valuation. {SALARY}/race is where the budget lands — take it and let\'s go racing.',
            'The board won\'t sign off on that. We can do {SALARY}/race — strong money for your record.',
            'Ambitious, I\'ll give you that. Our ceiling for this seat is {SALARY}/race.'
        ],
        decline: [
            'That number is fantasy at your prestige. The board is walking away — good luck out there.',
            'We\'re done here. Come back when your asking price matches your record.'
        ]
    },
    _principalLine(action, salary) {
        const pool = this.PRINCIPAL_LINES[action] || [];
        const line = pool[Math.floor(Math.random() * pool.length)] || '';
        return line.replaceAll('{SALARY}', Economy.fmt(salary) + '');
    },

    async _npcRespond(neg) {
        const patchHistory = async (entry, patch = {}) => {
            await DB.update('negotiations', neg.id, { ...patch, history: [...neg.history, { ...entry, at: Util.todayISO() }] });
        };

        // The AI can sit on either side of a hire: an unowned team's principal
        // (side A) answering a player's terms, or AI talent (side B) answering
        // a team's offer. Sponsorships keep their own branch below.
        if (neg.kind !== 'sponsorship' && !neg.sideAUid) return this._npcTeamRespond(neg, patchHistory);

        if (neg.kind === 'sponsorship') {
            // NPC teams/drivers happily take real money.
            if (neg.salary >= this.MIN_SPONSOR_PAYOUT) {
                await patchHistory({ byUid: null, byName: neg.teamName || neg.targetDriverName, action: 'accept', salary: neg.salary, note: 'Deal — put the logo on the car.' }, { status: 'accepted', turnUid: null });
                neg.status = 'accepted';
                await this.execute({ ...neg });
            } else {
                await patchHistory({ byUid: null, byName: neg.teamName || neg.targetDriverName, action: 'decline', note: `Not worth the decal space under ${Economy.fmt(this.MIN_SPONSOR_PAYOUT)}/race.` }, { status: 'declined', turnUid: null });
            }
            return;
        }

        // Hires & renegotiations: fair market logic.
        const world = await DB.loadWorld();
        const collection = neg.personKind === 'driver' ? 'drivers' : 'staff';
        const person = await DB.get(collection, neg.personId).catch(() => null);
        if (!person) { await DB.update('negotiations', neg.id, { status: 'declined' }); return; }
        const stars = neg.personKind === 'driver' ? Prestige.driverStars(neg.personId, world) : Prestige.stored(person);
        const cap = Economy.payCap(stars);
        const asking = Market.askingFor(person, neg.personKind === 'driver' ? 'driver' : 'staff', stars);
        const minAccept = Math.min(Math.ceil(asking * Market.MIN_OFFER_RATIO / 10) * 10, cap);

        if (neg.salary >= minAccept) {
            await patchHistory({ byUid: null, byName: neg.personName, action: 'accept', salary: neg.salary, note: 'Fair terms. Where do I sign?' }, { status: 'accepted', turnUid: null });
            neg.status = 'accepted';
            await this.execute({ ...neg });
        } else if (neg.salary < minAccept * this.INSULT_RATIO) {
            await patchHistory({ byUid: null, byName: neg.personName, action: 'decline', note: 'That offer is an insult. Lose my number.' }, { status: 'declined', turnUid: null });
        } else {
            const counter = Math.min(asking, cap);
            await patchHistory({ byUid: null, byName: neg.personName, action: 'counter', salary: counter, note: `I know what I'm worth — ${Economy.fmt(counter)}/race and we have a deal.` },
                { salary: counter, turnUid: neg.sideAUid });
        }
    },

    // An unowned team's AI principal answering the player across the table.
    // Fair asks (at or under market value) sign on the spot; greedy asks get
    // countered at market value; fantasy numbers end the meeting.
    async _npcTeamRespond(neg, patchHistory) {
        const world = await DB.loadWorld();
        const collection = neg.personKind === 'driver' ? 'drivers' : 'staff';
        const person = await DB.get(collection, neg.personId).catch(() => null);
        if (!person) { await DB.update('negotiations', neg.id, { status: 'declined', turnUid: null }); return; }
        const stars = neg.personKind === 'driver' ? Prestige.driverStars(neg.personId, world) : Prestige.stored(person);
        const cap = Economy.payCap(stars);
        const fair = Math.max(10, Math.min(Math.round(Market.askingFor(person, neg.personKind === 'driver' ? 'driver' : 'staff', stars) / 10) * 10, cap));
        const principal = `${neg.teamName} — Team Principal`;

        if (neg.salary <= fair) {
            await patchHistory({ byUid: null, byName: principal, action: 'accept', salary: neg.salary, note: this._principalLine('accept', neg.salary) }, { status: 'accepted', turnUid: null });
            neg.status = 'accepted';
            await this.execute({ ...neg });
        } else if (neg.salary > Math.min(cap, Math.round(fair / this.INSULT_RATIO))) {
            await patchHistory({ byUid: null, byName: principal, action: 'decline', note: this._principalLine('decline', fair) }, { status: 'declined', turnUid: null });
        } else {
            await patchHistory({ byUid: null, byName: principal, action: 'counter', salary: fair, note: this._principalLine('counter', fair) }, { salary: fair, turnUid: neg.sideBUid });
        }
    },

    // GM hands a pending application to the AI: the unowned team's principal
    // opens the deal room with a market-rate offer and generated dialogue, and
    // the player accepts / counters / declines like any other negotiation.
    async aiPrincipalOffer(recruitmentId) {
        if (!Auth.isAdmin()) throw new Error('Only the Game Master can send in the AI principal.');
        const app = await DB.get('recruitment', recruitmentId);
        if (!app || app.status !== 'pending') throw new Error('That application is no longer pending.');
        if (!app.driverUid) throw new Error('Only player applications can go to the AI principal.');
        const [world, person] = await Promise.all([DB.loadWorld(), DB.get('drivers', app.driverId)]);
        if (!person) throw new Error('That driver no longer exists.');
        const can = await this.canSignWithTeam(app.driverId, app.teamId, false);
        if (!can.ok) throw new Error(can.reason);
        const dup = (await DB.list('negotiations', { force: true }).catch(() => []))
            .find(n => n.status === 'open' && n.kind === 'team-driver' && n.teamId === app.teamId && n.personId === app.driverId && !n.contractId);
        if (dup) throw new Error('A negotiation for this signing is already open.');

        const stars = Prestige.driverStars(app.driverId, world);
        const cap = Economy.payCap(stars);
        const salary = Math.max(10, Math.min(Math.round(Market.askingFor(person, 'driver', stars) / 10) * 10, cap));
        const neg = {
            kind: 'team-driver', status: 'open', contractId: null,
            teamId: app.teamId, teamName: app.teamName, ownerUid: null,
            personId: app.driverId, personKind: 'driver', personName: app.driverName, personUid: app.driverUid,
            sponsorProfileId: null, sponsorName: '', sponsorUid: null,
            targetDriverId: null, targetDriverName: '', targetDriverUid: null,
            salary, buyout: Hub.buyoutFor(salary), exclusive: false,
            sideAUid: null, sideBUid: app.driverUid,
            initiatorUid: null, turnUid: app.driverUid,
            capStars: stars, capAmount: cap,
            history: [{ byUid: null, byName: `${app.teamName} — Team Principal`, action: 'offer', salary, note: this._principalLine('offer', salary), at: Util.todayISO() }]
        };
        neg.id = await DB.create('negotiations', neg);
        await DB.update('recruitment', recruitmentId, { status: 'accepted' });
        News.post('🤖', `${app.teamName}'s team principal opened contract talks with ${app.driverName}`);
        return DB.get('negotiations', neg.id);
    },

    /* ---------------- Player actions ---------------- */
    async counter(id, salary, note = '') {
        const neg = await DB.get('negotiations', id);
        if (!neg || neg.status !== 'open') throw new Error('This negotiation is closed.');
        if (neg.turnUid !== Auth.uid()) throw new Error("It's not your turn — wait for their answer (you can still send a note).");
        salary = Math.round(Number(salary) || 0);
        if (salary <= 0) throw new Error('Counter with a salary above zero.');
        const capInfo = await this.capForNeg(neg);
        if (salary > capInfo.cap) throw new Error(`League rule: pay is capped at ${Economy.fmt(capInfo.cap)}/race (${capInfo.who} is ${Prestige.stars(capInfo.stars)} ${Prestige.levelName(capInfo.stars)}).`);

        const other = neg.turnUid === neg.sideAUid ? neg.sideBUid : neg.sideAUid;
        const updated = {
            ...neg, salary, turnUid: other || null,
            history: [...neg.history, { byUid: Auth.uid(), byName: Auth.state.profile?.displayName || 'A player', action: 'counter', salary, note: note || '', at: Util.todayISO() }]
        };
        await DB.update('negotiations', id, { salary, turnUid: updated.turnUid, history: updated.history });
        if (updated.turnUid === null) await this._npcRespond(updated);
        return DB.get('negotiations', id);
    },

    async sendNote(id, note) {
        const neg = await DB.get('negotiations', id);
        if (!neg || neg.status !== 'open') throw new Error('This negotiation is closed.');
        if (!note?.trim()) return neg;
        await DB.update('negotiations', id, {
            history: [...neg.history, { byUid: Auth.uid(), byName: Auth.state.profile?.displayName || 'A player', action: 'message', note: note.trim(), at: Util.todayISO() }]
        });
        return DB.get('negotiations', id);
    },

    async accept(id) {
        const neg = await DB.get('negotiations', id);
        if (!neg || neg.status !== 'open') throw new Error('This negotiation is closed.');
        if (neg.turnUid !== Auth.uid()) throw new Error('The current offer is yours — they have to answer it.');
        const capInfo = await this.capForNeg(neg);
        if (neg.salary > capInfo.cap) throw new Error(`This deal now exceeds the prestige pay cap (${Economy.fmt(capInfo.cap)}/race) — counter with a legal number.`);
        await DB.update('negotiations', id, {
            status: 'accepted', turnUid: null,
            history: [...neg.history, { byUid: Auth.uid(), byName: Auth.state.profile?.displayName || 'A player', action: 'accept', salary: neg.salary, at: Util.todayISO() }]
        });
        await this.execute({ ...neg, status: 'accepted' });
        return DB.get('negotiations', id);
    },

    async close(id, action) { // 'decline' (my turn) or 'withdraw' (any time)
        const neg = await DB.get('negotiations', id);
        if (!neg || neg.status !== 'open') return;
        await DB.update('negotiations', id, {
            status: action === 'decline' ? 'declined' : 'withdrawn', turnUid: null,
            history: [...neg.history, { byUid: Auth.uid(), byName: Auth.state.profile?.displayName || 'A player', action, at: Util.todayISO() }]
        });
    },

    /* ---------------- Executing an accepted deal ---------------- */
    async execute(neg) {
        const year = new Date().getFullYear();

        if (neg.kind === 'sponsorship') {
            await DB.create('contracts', {
                type: 'sponsorship',
                sponsorProfileId: neg.sponsorProfileId, sponsorName: neg.sponsorName, sponsorUid: neg.sponsorUid,
                teamId: neg.teamId || null, teamName: neg.teamName || '',
                driverId: neg.targetDriverId || null, driverName: neg.targetDriverName || '',
                ownerUid: neg.sideBUid || null,
                personName: neg.teamName || neg.targetDriverName || '', // for generic contract lists
                salary: neg.salary, seasonYear: year, status: 'active', signedAt: Util.todayISO()
            });
            News.post('🤝', `${neg.sponsorName} sponsors ${neg.teamName || neg.targetDriverName} — ${Economy.fmt(neg.salary)}/race`);
            Util.notify(`Sponsorship live: ${neg.sponsorName} backs ${neg.teamName || neg.targetDriverName} for ${Economy.fmt(neg.salary)}/race. 🤝`);
            return;
        }

        // Pay renegotiation on an existing contract.
        if (neg.contractId) {
            const contract = await DB.get('contracts', neg.contractId);
            if (!contract || contract.status !== 'active') throw new Error('That contract is no longer active.');
            await DB.update('contracts', neg.contractId, { salary: neg.salary });
            const collection = neg.personKind === 'driver' ? 'drivers' : 'staff';
            const person = await DB.get(collection, neg.personId).catch(() => null);
            if (person?.teamId === neg.teamId) await DB.update(collection, neg.personId, { salary: neg.salary });
            News.post('✍️', `${neg.personName} renegotiated with ${neg.teamName}: now ${Economy.fmt(neg.salary)}/race`);
            Util.notify(`New terms locked in: ${neg.personName} at ${Economy.fmt(neg.salary)}/race. ✍️`);
            return;
        }

        // Fresh hire (driver or staff).
        const collection = neg.personKind === 'driver' ? 'drivers' : 'staff';
        const person = await DB.get(collection, neg.personId);
        if (!person) throw new Error('That person no longer exists.');
        if (neg.personKind === 'driver') {
            const can = await this.canSignWithTeam(neg.personId, neg.teamId, neg.exclusive);
            if (!can.ok) throw new Error(can.reason);
        } else if (person.teamId && person.teamId !== neg.teamId) {
            throw new Error(`${person.name} already works for another team.`);
        }

        // Primary team: only claimed if they don't have one yet.
        const becomesPrimary = !person.teamId;
        await DB.update(collection, neg.personId, becomesPrimary ? { teamId: neg.teamId, salary: neg.salary } : {});
        if (neg.personKind === 'driver' && becomesPrimary && person.ownerUid) {
            if (person.ownerUid === Auth.uid()) await Auth.updateProfile({ teamId: neg.teamId });
            else await DB.update('users', person.ownerUid, { teamId: neg.teamId }).catch(() => {});
        }
        await DB.create('contracts', {
            teamId: neg.teamId, teamName: neg.teamName, ownerUid: neg.ownerUid || null,
            personId: neg.personId, personKind: neg.personKind, personName: neg.personName,
            role: neg.personKind === 'driver' ? 'driver' : (person.role || 'staff'),
            salary: neg.salary, buyout: Hub.buyoutFor(neg.salary), exclusive: !!neg.exclusive,
            seasonYear: year, status: 'active', signedAt: Util.todayISO()
        });
        // Signing bonus (one race of salary): player owner pays it, player talent pockets it.
        if (neg.ownerUid) await Economy.adjustWallet(neg.ownerUid, -neg.salary, '🤝', `Signing bonus paid: ${neg.personName}`);
        if (neg.personUid) await Economy.adjustWallet(neg.personUid, neg.salary, '🤝', `Signing bonus from ${neg.teamName}`);
        News.post('🤝', `${neg.personName} signed with ${neg.teamName} (${Economy.fmt(neg.salary)}/race${neg.exclusive ? ', exclusive' : ', non-exclusive'})`);
        Util.notify(`Contract signed: ${neg.personName} ⇄ ${neg.teamName} at ${Economy.fmt(neg.salary)}/race. 🤝`);
    },

    /* ---------------- The negotiation room (modal) ---------------- */
    _label(n) {
        if (n.kind === 'sponsorship') return `${n.sponsorName} → ${n.teamName || n.targetDriverName}`;
        return `${n.personName} ⇄ ${n.teamName}${n.contractId ? ' (new terms)' : ''}`;
    },

    async room(id) {
        const neg = await DB.get('negotiations', id);
        if (!neg) { Util.notify('Negotiation not found.', 'error'); return; }
        const uid = Auth.uid();
        const myTurn = neg.status === 'open' && neg.turnUid === uid;
        const involved = neg.sideAUid === uid || neg.sideBUid === uid;
        const perRace = neg.kind === 'sponsorship' ? 'payout' : 'salary';

        const actionIcon = { offer: '✍️', counter: '↩️', message: '💬', accept: '✅', decline: '❌', withdraw: '🚫' };
        const thread = neg.history.map(h => `
            <div class="race-row">
                <div class="driver-hero-num" style="font-size:1rem;min-width:2.4rem;height:2.4rem">${actionIcon[h.action] || '💬'}</div>
                <div class="race-row-main">
                    <span class="race-title">${Util.esc(h.byName || 'AI')}${h.byUid ? '' : ' <span class="chip chip-dim">🤖 AI</span>'}
                        <span class="muted">— ${h.action}${h.salary ? ` at ${Economy.fmt(h.salary)}/race` : ''}</span></span>
                    ${h.note ? `<span class="race-sub">“${Util.esc(h.note)}”</span>` : ''}
                    <span class="race-sub muted">${Util.esc(Util.fmtDateShort(h.at))}</span>
                </div>
            </div>`).join('');

        const statusBadge = neg.status === 'open'
            ? (myTurn ? '<span class="badge badge-amber">Your move</span>' : '<span class="badge badge-blue">Waiting on them</span>')
            : `<span class="badge ${neg.status === 'accepted' ? 'badge-green' : 'badge-dim'}">${Util.esc(neg.status)}</span>`;

        Modal.open(`
            ${Modal.header(`🤝 ${Util.esc(this._label(neg))}`, 'Contract negotiation room — both sides see this thread')}
            <div class="chip-row" style="margin-bottom:.6rem">
                <span class="market-price">${Economy.fmt(neg.salary)}/race on the table</span>
                ${neg.kind === 'team-driver' && !neg.contractId ? `<span class="chip chip-dim">${neg.exclusive ? '🔒 Exclusive' : '🔓 Non-exclusive (multi-team OK)'}</span>` : ''}
                <span class="chip chip-dim" title="League rule: pay can never exceed the paid party's prestige level">⭐ Cap ${Economy.fmt(neg.capAmount || Economy.payCap(neg.capStars || 1))}/race</span>
                ${statusBadge}
            </div>
            <div class="stack" style="max-height:240px;overflow-y:auto;gap:.15rem" id="deal-thread">${thread}</div>
            ${neg.status === 'open' && involved ? `
                <form id="deal-act" class="form-grid" style="margin-top:.8rem">
                    ${myTurn ? `
                        <div class="form-row">
                            <label class="field"><span>Counter ${perRace} ($/race)</span>
                                <input id="deal-salary" class="input" type="number" min="10" step="10" value="${neg.salary}"></label>
                        </div>` : ''}
                    <label class="field"><span>Message ${myTurn ? '(sent with your counter)' : 'to the other side'}</span>
                        <input id="deal-note" class="input" maxlength="200" placeholder="e.g. Final offer — podium bonuses when we renegotiate next season."></label>
                    <div class="modal-actions">
                        ${myTurn ? `
                            <button type="button" class="btn btn-primary" id="deal-accept">✅ Accept ${Economy.fmt(neg.salary)}/race</button>
                            <button type="submit" class="btn btn-secondary">↩️ Send Counter</button>
                            <button type="button" class="btn btn-danger" id="deal-decline">❌ Decline</button>`
                        : `
                            <button type="submit" class="btn btn-secondary">💬 Send Note</button>
                            <button type="button" class="btn btn-ghost" id="deal-withdraw">🚫 Withdraw offer</button>`}
                    </div>
                    <p id="deal-error" class="form-error"></p>
                </form>`
            : `<div class="modal-actions" style="margin-top:.8rem"><button class="btn btn-primary" onclick="Modal.close()">Close</button></div>`}
        `, { wide: true });

        const errEl = () => Util.$('#deal-error');
        // Refresh the view behind first (App.go closes any modal), THEN reopen
        // the room on top so the thread stays in front of the player.
        const rerender = async (msg) => {
            if (msg) Util.notify(msg);
            await App.go(App.current.view, App.current.param);
            await this.room(id);
        };

        Util.$('#deal-act')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const note = Util.$('#deal-note').value;
                if (myTurn) {
                    const n = await this.counter(id, Util.$('#deal-salary').value, note);
                    await rerender(n.status === 'accepted' ? null : 'Counter sent. ↩️');
                } else {
                    await this.sendNote(id, note);
                    Util.$('#deal-note').value = '';
                    await rerender('Note sent. 💬');
                }
            } catch (err) { errEl().textContent = err.message; }
        });
        Util.$('#deal-accept')?.addEventListener('click', async () => {
            try { await this.accept(id); await rerender(); }
            catch (err) { errEl().textContent = err.message; }
        });
        Util.$('#deal-decline')?.addEventListener('click', async () => {
            try { await this.close(id, 'decline'); await rerender('Negotiation declined.'); }
            catch (err) { errEl().textContent = err.message; }
        });
        Util.$('#deal-withdraw')?.addEventListener('click', async () => {
            try { await this.close(id, 'withdraw'); await rerender('Offer withdrawn.'); }
            catch (err) { errEl().textContent = err.message; }
        });
    },

    /* ---------------- Workspace panel + inbox count ---------------- */
    async mine() {
        const uid = Auth.uid();
        if (!uid) return [];
        return (await DB.list('negotiations', { force: true }).catch(() => []))
            .filter(n => n.sideAUid === uid || n.sideBUid === uid)
            .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    },

    async myTurnCount() {
        return (await this.mine()).filter(n => n.status === 'open' && n.turnUid === Auth.uid()).length;
    },

    async panel(title = '🤝 My Deals') {
        const uid = Auth.uid();
        const all = await this.mine();
        const open = all.filter(n => n.status === 'open');
        const closed = all.filter(n => n.status !== 'open').slice(0, 3);
        const row = (n) => `
            <div class="race-row">
                <div class="race-row-main">
                    <span class="race-title">${Util.esc(this._label(n))}
                        ${n.status === 'open' ? (n.turnUid === uid ? '<span class="badge badge-amber">Your move</span>' : '<span class="badge badge-blue">Waiting</span>')
                            : `<span class="badge ${n.status === 'accepted' ? 'badge-green' : 'badge-dim'}">${Util.esc(n.status)}</span>`}</span>
                    <span class="race-sub">${Economy.fmt(n.salary)}/race on the table · ${Util.plural((n.history || []).length, 'note')} in the thread</span>
                </div>
                <button class="btn btn-secondary btn-sm" onclick="Deals.room('${Util.attr(n.id)}')">Open room</button>
            </div>`;
        return `<section class="panel">
            <div class="panel-head"><h2>${title}${open.length ? ` (${open.length})` : ''}</h2></div>
            ${open.length || closed.length
                ? `${open.map(row).join('')}${closed.length ? `<h3 class="section-label" style="margin-top:.8rem">Recently closed</h3>${closed.map(row).join('')}` : ''}`
                : C.empty('🤝', 'No negotiations yet', 'Contract offers, counters, and sponsorship deals all run through negotiation rooms — offers you send or receive appear here.')}
        </section>`;
    },

    /* ---------------- Entry point: renegotiate an existing contract ---------------- */
    async adjustPay(contractId) {
        const contract = await DB.get('contracts', contractId);
        if (!contract || contract.status !== 'active') { Util.notify('That contract is no longer active.', 'info'); return; }
        const world = await DB.loadWorld(true);
        const isDriver = contract.personKind === 'driver';
        const person = await DB.get(isDriver ? 'drivers' : 'staff', contract.personId).catch(() => null);
        if (!person) { Util.notify('That person no longer exists.', 'error'); return; }
        const stars = isDriver ? Prestige.driverStars(person.id, world) : Prestige.stored(person);
        const cap = Economy.payCap(stars);

        Modal.open(`
            ${Modal.header(`✍️ New Terms — ${Util.esc(contract.personName)}`, `Currently ${Economy.fmt(contract.salary)}/race with ${Util.esc(contract.teamName)}`)}
            <form id="adjust-form" class="form-grid">
                <div class="chip-row">${Prestige.chip(stars)}<span class="chip chip-dim">⭐ ${Economy.capLine(stars)}</span></div>
                <div class="form-row">
                    <label class="field"><span>New salary per race</span>
                        <input id="aj-salary" class="input" type="number" min="10" max="${cap}" step="10" value="${Math.min(contract.salary, cap)}" required></label>
                </div>
                <label class="field"><span>Message</span><input id="aj-note" class="input" maxlength="200" placeholder="Why the new number?"></label>
                <p class="muted small">${person.ownerUid ? 'They are a player — this opens a negotiation they must accept.' : 'AI talent answers instantly: fair terms sign, lowballs get countered.'}</p>
                <p id="aj-error" class="form-error"></p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Propose Terms ✍️</button>
                </div>
            </form>
        `);
        Util.$('#adjust-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const n = await this.start({
                    kind: isDriver ? 'team-driver' : 'team-staff',
                    contractId, teamId: contract.teamId, teamName: contract.teamName, ownerUid: Auth.uid(),
                    personId: contract.personId, personKind: contract.personKind, personName: contract.personName,
                    personUid: person.ownerUid || null,
                    salary: Util.$('#aj-salary').value, exclusive: contract.exclusive !== false,
                    note: Util.$('#aj-note').value
                });
                Modal.close();
                if (n.status === 'accepted') Util.notify(`${contract.personName} accepted the new terms. ✍️`);
                else if (n.status === 'declined') Util.notify(`${contract.personName} declined — terms unchanged.`, 'info');
                else if (n.turnUid === Auth.uid()) this.room(n.id); // AI countered
                else Util.notify(`Proposal sent — ${contract.personName} will answer in their Deals panel. 📨`);
                App.go('career');
            } catch (err) { Util.$('#aj-error').textContent = err.message; }
        });
    },

    /* ---------------- Entry point: sponsor offers a deal ---------------- */
    async sponsorOfferForm(profileId) {
        const [profile, world] = await Promise.all([DB.get('roleProfiles', profileId), DB.loadWorld(true)]);
        if (!profile) { Util.notify('Sponsor profile not found.', 'error'); return; }
        const stars = Prestige.stored(profile);
        const cap = Economy.payCap(stars);
        const teams = world.teams.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        const drivers = world.drivers.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        Modal.open(`
            ${Modal.header('💰 Offer a Sponsorship', `From ${Util.esc(profile.name)} — you pay them every race they run`)}
            <form id="spo-form" class="form-grid">
                <div class="chip-row">${Prestige.chip(stars)}<span class="chip chip-dim" title="Your brand can only spend at its prestige level">⭐ Your ${Economy.capLine(stars)}</span></div>
                <div class="form-row">
                    <label class="field"><span>Sponsor a team</span>
                        <select id="spo-team" class="input"><option value="">— pick a team —</option>
                            ${teams.map(t => `<option value="${Util.attr(t.id)}">${Util.esc(t.name)}${t.ownerUid ? ' 👤' : ' 🤖'}</option>`).join('')}
                        </select></label>
                    <label class="field"><span>…or a driver</span>
                        <select id="spo-driver" class="input"><option value="">— pick a driver —</option>
                            ${drivers.map(d => `<option value="${Util.attr(d.id)}">${Util.esc(d.name)}${d.ownerUid ? ' 👤' : ' 🤖'}</option>`).join('')}
                        </select></label>
                </div>
                <div class="form-row">
                    <label class="field"><span>Payout per race</span>
                        <input id="spo-pay" class="input" type="number" min="${this.MIN_SPONSOR_PAYOUT}" max="${cap}" step="10" value="${Math.min(300, cap)}" required></label>
                </div>
                <label class="field"><span>Pitch</span><input id="spo-note" class="input" maxlength="200" placeholder="What does your brand want in return?"></label>
                <p class="muted small">👤 player-owned targets negotiate in a deal room; 🤖 AI targets answer instantly. Payouts leave your wallet after every race they run.</p>
                <p id="spo-error" class="form-error"></p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Send Offer 💰</button>
                </div>
            </form>
        `);
        Util.$('#spo-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const teamId = Util.$('#spo-team').value || null;
                const driverId = Util.$('#spo-driver').value || null;
                if (!teamId && !driverId) throw new Error('Pick a team or a driver to sponsor.');
                if (teamId && driverId) throw new Error('One target per deal — team OR driver.');
                const team = teamId ? world.teamsById[teamId] : null;
                const driver = driverId ? world.driversById[driverId] : null;
                const n = await this.start({
                    kind: 'sponsorship',
                    sponsorProfileId: profile.id, sponsorName: profile.name, sponsorUid: Auth.uid(),
                    teamId, teamName: team?.name || '', ownerUid: team?.ownerUid || null,
                    targetDriverId: driverId, targetDriverName: driver?.name || '', targetDriverUid: driver?.ownerUid || null,
                    salary: Util.$('#spo-pay').value, note: Util.$('#spo-note').value
                });
                Modal.close();
                if (n.status === 'accepted') { /* execute() already toasted */ }
                else if (n.status === 'declined') Util.notify('They passed on the deal.', 'info');
                else Util.notify(`Offer sent — ${team?.name || driver?.name} will answer in their Deals panel. 📨`);
                App.go('career');
            } catch (err) { Util.$('#spo-error').textContent = err.message; }
        });
    },

    /* ---------------- Ending contracts from management ---------------- */
    async endSponsorship(contractId) {
        const c = await DB.get('contracts', contractId);
        if (!c) return;
        if (!confirm(`End the sponsorship between ${c.sponsorName} and ${c.teamName || c.driverName}?`)) return;
        await DB.update('contracts', contractId, { status: 'ended', endedAt: Util.todayISO() });
        News.post('👋', `${c.sponsorName} and ${c.teamName || c.driverName} end their sponsorship`);
        Util.notify('Sponsorship ended.');
        App.go(App.current.view, App.current.param);
    }
};
window.Deals = Deals;
