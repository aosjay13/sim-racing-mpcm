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
        // Staff: AI crew live in `staff`, player crew in `roleProfiles`.
        const person = await DB.get(neg.roleProfileId ? 'roleProfiles' : 'staff', neg.personId).catch(() => null);
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

    // Shared sign-on-bonus + clause-sheet validation for fresh-hire terms —
    // used both when a deal is opened (start) and whenever either side
    // counters with revised terms (counter), so the same rules apply no
    // matter which side is proposing the sheet.
    async _validateOfferTerms({ teamId, personKind, salary, agreement, signOnBonus, clauses }) {
        if (signOnBonus !== null && signOnBonus !== undefined) {
            signOnBonus = Math.round(Number(signOnBonus) || 0);
            if (signOnBonus < 0) throw new Error('Sign-on bonus cannot be negative.');
            if (signOnBonus > salary * Clauses.MAX_SINGLE_MULT)
                throw new Error(`Sign-on bonus is capped at 2× salary (${Economy.fmt(salary * Clauses.MAX_SINGLE_MULT)}) — pay is per-race in this league.`);
        } else signOnBonus = null;
        const world = await DB.loadWorld();
        clauses = Clauses.validate(clauses, { teamStars: Prestige.teamStars(teamId, world), salary, personKind, agreement });
        return { signOnBonus, clauses };
    },

    /* ---------------- Starting a negotiation ---------------- */
    // Creates the negotiation and, when the other side is AI, resolves their
    // answer immediately. Returns the negotiation doc (post-resolution).
    // sideAProxyUid lets the Game Master negotiate FOR an unowned team: the GM
    // drives the conversation, but the contract stays league-owned (no ownerUid,
    // no wallet debits from the GM).
    async start({ kind, teamId = null, teamName = '', ownerUid = null, sideAProxyUid = null,
        personId = null, personKind = null, personName = '', personUid = null, roleProfileId = null,
        sponsorProfileId = null, sponsorName = '', sponsorUid = null,
        targetDriverId = null, targetDriverName = '', targetDriverUid = null,
        contractId = null, salary, buyout = 0, exclusive = false, note = '',
        agreement = 'contracted', signOnBonus = null, clauses = null }) {

        salary = Math.round(Number(salary) || 0);
        if (salary <= 0) throw new Error('Offer a salary above zero.');

        // Advanced terms only exist on FRESH hires (not renegotiations,
        // sponsorships, or buyout talks) — validate them against the offering
        // team's prestige and the anti-laundering caps.
        agreement = agreement === 'open' ? 'open' : 'contracted';
        const isFreshHire = (kind === 'team-driver' || kind === 'team-staff') && !contractId;
        if (isFreshHire) {
            // An insolvent team is frozen from extending new offers / acquiring talent.
            if (teamId && ownerUid) await Insolvency.assertSolvent(teamId);
            ({ signOnBonus, clauses } = await this._validateOfferTerms({ teamId, personKind, salary, agreement, signOnBonus, clauses }));
        } else { signOnBonus = null; clauses = null; }

        const uid = Auth.uid();
        const myName = Auth.state.profile?.displayName || 'A player';
        // Paying side (A) = team owner / sponsor. Paid side (B) = talent / sponsorship target.
        const sideAUid = kind === 'sponsorship' ? sponsorUid : (ownerUid || sideAProxyUid);
        const sideBUid = kind === 'sponsorship' ? (teamId ? ownerUid : targetDriverUid) : personUid;
        const neg = {
            kind, status: 'open', contractId,
            teamId, teamName, ownerUid,
            personId, personKind, personName, personUid, roleProfileId,
            sponsorProfileId, sponsorName, sponsorUid,
            targetDriverId, targetDriverName, targetDriverUid,
            salary, buyout: Math.round(Number(buyout) || 0), exclusive: !!exclusive,
            agreement, signOnBonus, clauses,
            sideAUid, sideBUid,
            initiatorUid: uid,
            turnUid: (uid === sideAUid ? sideBUid : sideAUid) || null,
            history: [{ byUid: uid, byName: myName, action: 'offer', salary, note: note || '', at: Util.todayISO() }]
        };

        // Cap check up front (against the live cap). Buyout talks are exempt —
        // the figure on the table is an exit price, not pay.
        if (kind !== 'buyout') {
            const capInfo = await this.capForNeg(neg);
            if (salary > capInfo.cap) {
                throw new Error(`League rule: ${capInfo.who} is ${Prestige.stars(capInfo.stars)} ${Prestige.levelName(capInfo.stars)} — pay is capped at ${Economy.fmt(capInfo.cap)}/race.`);
            }
            neg.capStars = capInfo.stars;
            neg.capAmount = capInfo.cap;
        }

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
            await patchHistory({ byUid: null, byName: neg.personName, action: 'counter', salary: counter, note: `I know what I'm worth — ${Economy.fmt(counter)}/race and we have a deal.`, changes: this._termChanges(neg, { salary: counter }) },
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
            await patchHistory({ byUid: null, byName: principal, action: 'counter', salary: fair, note: this._principalLine('counter', fair), changes: this._termChanges(neg, { salary: fair }) }, { salary: fair, turnUid: neg.sideBUid });
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

    /* ---------------- Buyout negotiation ---------------- */
    // The middle path between paying the full buyout and begging for a free
    // release: the leaving driver proposes an exit figure, the owner counters
    // or accepts in a normal deal room. Accepting moves the agreed money and
    // ends the contract as 'bought-out'. You negotiate DOWN from the clause.
    async startBuyout(contractId, figure, note = '') {
        const contract = await DB.get('contracts', contractId);
        if (!contract || contract.status !== 'active') throw new Error('That contract is no longer active.');
        if (contract.personKind !== 'driver') throw new Error('Buyout talks are for driver contracts — crew ask the owner for a release.');
        if (contract.personUid !== Auth.uid()) throw new Error('Only the person on this contract can open buyout talks.');
        const payee = contract.ownerUid;
        if (!payee) throw new Error('This contract has nobody to pay — you can leave for free.');
        figure = Math.round(Number(figure) || 0);
        if (figure < 10) throw new Error('Propose a figure of at least $10 — or request a free release instead.');
        if (figure > contract.buyout) throw new Error(`The contractual buyout is ${Economy.fmt(contract.buyout)} — you negotiate DOWN from there.`);
        return this.start({
            kind: 'buyout', contractId,
            teamId: contract.teamId, teamName: contract.teamName, ownerUid: payee,
            personId: contract.personId, personKind: 'driver', personName: contract.personName,
            personUid: contract.personUid, buyout: contract.buyout,
            salary: figure, note
        });
    },

    /* ---------------- What changed in a counter? ---------------- */
    // Human-readable delta between the deal's previous terms and a counter's
    // patch — stored on the history entry so BOTH sides see exactly what moved,
    // forever, without replaying the thread.
    _termChanges(before, patch, unit = '/race') {
        const out = [];
        if (patch.salary !== undefined && patch.salary !== before.salary)
            out.push(`💰 ${Economy.fmt(before.salary)} → ${Economy.fmt(patch.salary)}${unit}`);
        if (patch.exclusive !== undefined && !!patch.exclusive !== !!before.exclusive)
            out.push(patch.exclusive ? '🔒 Now exclusive' : '🔓 Exclusivity dropped');
        if (patch.agreement !== undefined && patch.agreement !== (before.agreement || 'contracted'))
            out.push(patch.agreement === 'open' ? '🤝 Now an open agreement — no buyout' : '🔒 Now contracted — buyout applies');
        if (patch.signOnBonus !== undefined && (patch.signOnBonus ?? null) !== (before.signOnBonus ?? null)) {
            const show = (v) => v === null || v === undefined ? 'default (1× salary)' : Economy.fmt(v);
            out.push(`🎁 Sign-on ${show(before.signOnBonus)} → ${show(patch.signOnBonus)}`);
        }
        if (patch.clauses !== undefined) {
            const was = Clauses.flatten(before.clauses), now = Clauses.flatten(patch.clauses);
            const fmt = (e) => e.money ? Economy.fmt(e.value) : e.value;
            for (const k of new Set([...Object.keys(was), ...Object.keys(now)])) {
                if (!was[k]) out.push(`+ ${now[k].label} ${fmt(now[k])}`);
                else if (!now[k]) out.push(`− ${was[k].label} removed (was ${fmt(was[k])})`);
                else if (was[k].value !== now[k].value) out.push(`${now[k].label} ${fmt(was[k])} → ${fmt(now[k])}`);
            }
        }
        return out;
    },

    /* ---------------- Player actions ---------------- */
    // `terms` (optional): { exclusive, agreement, signOnBonus, clauses } — the
    // same menu offered on the initial offer form. Only applies to fresh-hire
    // negotiations (team-driver / team-staff, no contractId yet); ignored for
    // buyouts, sponsorships, and pay renegotiations on an already-signed
    // contract, none of which carry those fields.
    async counter(id, salary, note = '', terms = null) {
        const neg = await DB.get('negotiations', id);
        if (!neg || neg.status !== 'open') throw new Error('This negotiation is closed.');
        if (neg.turnUid !== Auth.uid()) throw new Error("It's not your turn — wait for their answer (you can still send a note).");
        salary = Math.round(Number(salary) || 0);
        if (salary <= 0) throw new Error('Counter with a salary above zero.');
        if (neg.kind !== 'buyout') {
            const capInfo = await this.capForNeg(neg);
            if (salary > capInfo.cap) throw new Error(`League rule: pay is capped at ${Economy.fmt(capInfo.cap)}/race (${capInfo.who} is ${Prestige.stars(capInfo.stars)} ${Prestige.levelName(capInfo.stars)}).`);
        } else if (salary > (neg.buyout || Infinity)) {
            throw new Error(`The contractual buyout is ${Economy.fmt(neg.buyout)} — you negotiate DOWN from there, not up.`);
        }

        const isFreshHire = (neg.kind === 'team-driver' || neg.kind === 'team-staff') && !neg.contractId;
        const patch = { salary };
        if (isFreshHire && terms) {
            const agreement = terms.agreement === 'open' ? 'open' : 'contracted';
            const validated = await this._validateOfferTerms({
                teamId: neg.teamId, personKind: neg.personKind, salary, agreement,
                signOnBonus: terms.signOnBonus, clauses: terms.clauses
            });
            patch.exclusive = neg.kind === 'team-driver' ? !!terms.exclusive : neg.exclusive;
            patch.agreement = agreement;
            patch.signOnBonus = validated.signOnBonus;
            patch.clauses = validated.clauses;
        }

        const changes = this._termChanges(neg, patch, neg.kind === 'buyout' ? ' one-time' : '/race');
        const other = neg.turnUid === neg.sideAUid ? neg.sideBUid : neg.sideAUid;
        const updated = {
            ...neg, ...patch, turnUid: other || null,
            history: [...neg.history, { byUid: Auth.uid(), byName: Auth.state.profile?.displayName || 'A player', action: 'counter', salary, note: note || '', changes, at: Util.todayISO() }]
        };
        await DB.update('negotiations', id, { ...patch, turnUid: updated.turnUid, history: updated.history });
        if (updated.turnUid === null) await this._npcRespond(updated);
        return DB.get('negotiations', id);
    },

    async sendNote(id, note) {
        const neg = await DB.get('negotiations', id);
        if (!neg || neg.status !== 'open') throw new Error('This negotiation is closed.');
        if (neg.sideAUid !== Auth.uid() && neg.sideBUid !== Auth.uid() && !Auth.isAdmin())
            throw new Error('Only the two parties can write in this negotiation.');
        if (!note?.trim()) return neg;
        await DB.update('negotiations', id, {
            history: [...neg.history, { byUid: Auth.uid(), byName: Auth.state.profile?.displayName || 'A player', action: 'message', note: note.trim(), at: Util.todayISO() }]
        });
        return DB.get('negotiations', id);
    },

    // seenSalary (optional): the number the user had on screen when they hit
    // Accept. If the deal moved under them (other side countered from another
    // device), refuse instead of silently signing a different amount.
    async accept(id, seenSalary = null) {
        const neg = await DB.get('negotiations', id, { force: true });
        if (!neg || neg.status !== 'open') throw new Error('This negotiation is closed.');
        if (neg.turnUid !== Auth.uid()) throw new Error('The current offer is yours — they have to answer it.');
        if (seenSalary !== null && Math.round(Number(seenSalary)) !== neg.salary) {
            throw new Error(`This deal has moved to ${Economy.fmt(neg.salary)}${neg.kind === 'buyout' ? '' : '/race'} since you last looked — review the updated offer before signing.`);
        }
        if (neg.kind !== 'buyout') {
            const capInfo = await this.capForNeg(neg);
            if (neg.salary > capInfo.cap) throw new Error(`This deal now exceeds the prestige pay cap (${Economy.fmt(capInfo.cap)}/race) — counter with a legal number.`);
        }
        await DB.update('negotiations', id, {
            status: 'accepted', turnUid: null,
            history: [...neg.history, { byUid: Auth.uid(), byName: Auth.state.profile?.displayName || 'A player', action: 'accept', salary: neg.salary, at: Util.todayISO() }]
        });
        await this.execute({ ...neg, status: 'accepted' });
        return DB.get('negotiations', id);
    },

    // Closing a negotiation is turn-gated, like every other move:
    //   decline  — answers the offer in front of you, so it needs to BE in
    //              front of you (your turn).
    //   withdraw — retracts your own un-answered offer. Once the other side
    //              counters, these are live talks: you exit by declining on
    //              your turn (or accepting), never by yanking the deal mid-
    //              conversation right after you countered.
    // The GM may always close (Global GM Override).
    async close(id, action) {
        const neg = await DB.get('negotiations', id);
        if (!neg || neg.status !== 'open') return;
        const uid = Auth.uid();
        if (!Auth.isAdmin()) {
            if (neg.sideAUid !== uid && neg.sideBUid !== uid)
                throw new Error('Only the two parties can close this negotiation.');
            if (action === 'decline' && neg.turnUid !== uid)
                throw new Error("You can only decline an offer that's in front of you — right now the move is theirs.");
            if (action === 'withdraw') {
                if (neg.initiatorUid !== uid)
                    throw new Error('Only the side that opened this negotiation can withdraw it.');
                if (neg.history.some(h => h.action === 'counter'))
                    throw new Error("They've countered — these are live talks now. Answer their number: accept, counter, or decline on your turn.");
            }
        }
        await DB.update('negotiations', id, {
            status: action === 'decline' ? 'declined' : 'withdrawn', turnUid: null,
            history: [...neg.history, { byUid: uid, byName: Auth.state.profile?.displayName || 'A player', action, at: Util.todayISO() }]
        });
    },

    /* ---------------- Executing an accepted deal ---------------- */
    async execute(neg) {
        const year = new Date().getFullYear();

        // Agreed buyout: move the negotiated figure, end the contract. The
        // leaving player pays personally; the money replenishes the TEAM's
        // budget (it funds the next hire), not the owner's personal pocket.
        if (neg.kind === 'buyout') {
            const contract = await DB.get('contracts', neg.contractId);
            if (!contract || contract.status !== 'active') throw new Error('That contract is no longer active.');
            await Wallet.executeRoleTransaction({
                from: { type: 'player', id: neg.personUid },
                to: neg.ownerUid ? { type: 'team', id: neg.teamId } : null,
                amount: neg.salary, icon: '💸',
                fromLabel: `Negotiated buyout paid: ${neg.teamName}`,
                toLabel: `Negotiated buyout received: ${neg.personName}`
            });
            await Hub._freeDriver(contract.personId, neg.personUid, 'bought-out', contract.id);
            News.post('💸', `${neg.personName} negotiated a ${Economy.fmt(neg.salary)} buyout to leave ${neg.teamName} (clause was ${Economy.fmt(contract.buyout)})`);
            Util.notify(`Buyout agreed at ${Economy.fmt(neg.salary)} — contract with ${neg.teamName} ended. 💸`);
            return;
        }

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
            const collection = neg.personKind === 'driver' ? 'drivers'
                : (neg.roleProfileId ? 'roleProfiles' : 'staff');
            const person = await DB.get(collection, neg.personId).catch(() => null);
            if (person?.teamId === neg.teamId) await DB.update(collection, neg.personId, { salary: neg.salary });
            News.post('✍️', `${neg.personName} renegotiated with ${neg.teamName}: now ${Economy.fmt(neg.salary)}/race`);
            Util.notify(`New terms locked in: ${neg.personName} at ${Economy.fmt(neg.salary)}/race. ✍️`);
            return;
        }

        // Fresh hire: a driver, an AI staff doc, or a PLAYER in a staff role
        // (crew chief / mechanic / agent), whose league identity lives in
        // roleProfiles rather than the staff collection.
        const collection = neg.personKind === 'driver' ? 'drivers'
            : (neg.roleProfileId ? 'roleProfiles' : 'staff');
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
        const agreement = neg.agreement === 'open' ? 'open' : 'contracted';
        // The sign-on bonus is the ONLY upfront payment the economy allows
        // (everything else settles per race). Default: one race of salary.
        const signOnBonus = Number.isFinite(neg.signOnBonus) ? Math.round(neg.signOnBonus) : neg.salary;
        await DB.create('contracts', {
            teamId: neg.teamId, teamName: neg.teamName, ownerUid: neg.ownerUid || null,
            personId: neg.personId, personKind: neg.personKind, personName: neg.personName,
            personUid: neg.personUid || null, // player talent — payroll credits their wallet
            roleProfileId: neg.roleProfileId || null,
            role: neg.personKind === 'driver' ? 'driver' : (person.role || 'staff'),
            salary: neg.salary, exclusive: !!neg.exclusive,
            agreement, buyout: agreement === 'open' ? 0 : Hub.buyoutFor(neg.salary),
            signOnBonus, clauses: neg.clauses || null,
            seasonYear: year, status: 'active', signedAt: Util.todayISO()
        });
        // The team's budget pays the bonus; the hire's PERSONAL wallet
        // collects it — two different documents, so this is a real transfer
        // even when the team owner is signing their own driver persona.
        if (signOnBonus) {
            await Wallet.executeRoleTransaction({
                from: neg.ownerUid ? { type: 'team', id: neg.teamId } : null,
                to: neg.personUid ? { type: 'player', id: neg.personUid } : null,
                amount: signOnBonus, icon: '🤝',
                fromLabel: `Sign-on bonus paid: ${neg.personName}`,
                toLabel: `Sign-on bonus from ${neg.teamName}`
            });
        }
        News.post('🤝', `${neg.personName} signed with ${neg.teamName} (${Economy.fmt(neg.salary)}/race${agreement === 'open' ? ', open agreement' : (neg.exclusive ? ', exclusive' : ', non-exclusive')})`);
        Util.notify(`Contract signed: ${neg.personName} ⇄ ${neg.teamName} at ${Economy.fmt(neg.salary)}/race. 🤝`);
    },

    /* ---------------- The negotiation room (modal) ---------------- */
    _label(n) {
        if (n.kind === 'sponsorship') return `${n.sponsorName} → ${n.teamName || n.targetDriverName}`;
        if (n.kind === 'buyout') return `${n.personName} ⇄ ${n.teamName} (buyout)`;
        return `${n.personName} ⇄ ${n.teamName}${n.contractId ? ' (new terms)' : ''}`;
    },

    // The room re-renders IN PLACE after every action (no page-refresh dance),
    // live-polls for the other side's moves while open, and always derives the
    // action buttons from the LATEST state — the accept button can never show
    // a stale number. The view behind refreshes when the room is dismissed.
    _roomTimer: null,

    async room(id, { poll = true } = {}) {
        const neg = await DB.get('negotiations', id, { force: true });
        if (!neg) { Util.notify('Negotiation not found.', 'error'); return; }
        const uid = Auth.uid();
        const myTurn = neg.status === 'open' && neg.turnUid === uid;
        const involved = neg.sideAUid === uid || neg.sideBUid === uid;
        const isBuyout = neg.kind === 'buyout';
        const perRace = isBuyout ? 'buyout figure' : (neg.kind === 'sponsorship' ? 'payout' : 'salary');
        const unit = isBuyout ? ' one-time' : '/race';
        // Fresh hires carry the full advanced-terms menu (exclusivity, agreement
        // type, sign-on bonus, clauses) — countering one should offer the same
        // menu the initial offer did, not just a bare salary field.
        const isFreshHire = (neg.kind === 'team-driver' || neg.kind === 'team-staff') && !neg.contractId;
        const teamStars = isFreshHire ? Prestige.teamStars(neg.teamId, await DB.loadWorld()) : null;
        // Withdraw = retracting your own un-answered offer. It disappears the
        // moment the other side counters (and never shows right after YOUR
        // counter) — mirrors the guards in close().
        const canWithdraw = !myTurn && neg.initiatorUid === uid && !neg.history.some(h => h.action === 'counter');

        // ---- Current state of the deal, front and center ----
        const lastMove = [...neg.history].reverse().find(h => h.action === 'offer' || h.action === 'counter');
        const closer = [...neg.history].reverse().find(h => ['accept', 'decline', 'withdraw'].includes(h.action));
        const proposedBy = lastMove ? (lastMove.byUid === uid ? 'you' : lastMove.byName) : '—';
        const statusBadge = neg.status === 'open'
            ? (myTurn ? '<span class="badge badge-amber">Your move</span>' : '<span class="badge badge-blue">Waiting on them</span>')
            : `<span class="badge ${neg.status === 'accepted' ? 'badge-green' : 'badge-dim'}">${Util.esc(neg.status)}</span>`;
        const clauseSummary = Clauses.summary(neg.clauses);
        const offerHero = `
            <div class="panel deal-offer-hero" style="padding:.7rem .9rem;margin-bottom:.7rem">
                <div class="chip-row" style="align-items:baseline">
                    <span class="market-price" style="font-size:1.25rem">${Economy.fmt(neg.salary)}${unit}</span>
                    <span class="muted small">on the table — ${neg.status === 'open'
                        ? `latest ${lastMove?.action === 'counter' ? 'counter' : 'offer'} by <strong>${Util.esc(proposedBy)}</strong>${lastMove?.at ? ` · ${Util.esc(Util.fmtDateShort(lastMove.at))}` : ''}`
                        : `${Util.esc(neg.status)}${closer ? ` by ${Util.esc(closer.byUid === uid ? 'you' : closer.byName)}` : ''}`}</span>
                </div>
                <div class="chip-row" style="margin-top:.35rem">
                    ${statusBadge}
                    ${isBuyout ? `<span class="chip chip-dim" title="You negotiate DOWN from the contractual buyout clause">💸 Contract clause ${Economy.fmt(neg.buyout)}</span>` : ''}
                    ${neg.kind === 'team-driver' && !neg.contractId ? `<span class="chip chip-dim">${neg.exclusive ? '🔒 Exclusive' : '🔓 Non-exclusive (multi-team OK)'}</span>` : ''}
                    ${!isBuyout && isFreshHire
                        ? `<span class="chip chip-dim">${neg.agreement === 'open' ? '🤝 Open agreement — leave anytime, no buyout' : `🔒 Contracted — buyout ${Economy.fmt(Hub.buyoutFor(neg.salary))}`}</span>
                           ${Number.isFinite(neg.signOnBonus) ? `<span class="chip chip-dim">🎁 Sign-on ${Economy.fmt(neg.signOnBonus)}</span>` : ''}` : ''}
                    ${isBuyout ? '' : `<span class="chip chip-dim" title="League rule: pay can never exceed the paid party's prestige level">⭐ Cap ${Economy.fmt(neg.capAmount || Economy.payCap(neg.capStars || 1))}/race</span>`}
                </div>
                ${clauseSummary ? `<div class="chip-row" style="margin-top:.35rem"><span class="chip chip-dim" title="Performance clauses — bonuses settle per race, ⚠️ stipulations are checked at season close">📜 ${Util.esc(clauseSummary)}</span></div>` : ''}
            </div>`;

        // ---- The thread: newest highlighted, counters spell out what changed ----
        // Modern counter entries carry `changes` (written by counter() at move
        // time) and render them as highlighted delta chips. Entries from before
        // that fall back to the old inline "(was $X)".
        const actionIcon = { offer: '✍️', counter: '↩️', message: '💬', accept: '✅', decline: '❌', withdraw: '🚫' };
        let prevSalary = null;
        const thread = neg.history.map((h, i) => {
            const latest = i === neg.history.length - 1;
            const was = h.action === 'counter' && !h.changes && prevSalary !== null && prevSalary !== h.salary
                ? ` <span class="muted">(was ${Economy.fmt(prevSalary)})</span>` : '';
            if (h.salary) prevSalary = h.salary;
            const deltas = (h.changes || []).length
                ? `<span class="chip-row" style="margin-top:.25rem">${h.changes.map(ch => `<span class="chip chip-delta">${Util.esc(ch)}</span>`).join('')}</span>`
                : (h.action === 'counter' && h.changes ? '<span class="race-sub muted">No terms changed — same deal, resent</span>' : '');
            return `
            <div class="race-row ${latest ? 'deal-latest' : ''}">
                <div class="driver-hero-num" style="font-size:1rem;min-width:2.4rem;height:2.4rem">${actionIcon[h.action] || '💬'}</div>
                <div class="race-row-main">
                    <span class="race-title">${Util.esc(h.byName || 'AI')}${h.byUid ? '' : ' <span class="chip chip-dim">🤖 AI</span>'}
                        <span class="muted">— ${h.action}${h.salary ? ` at ${Economy.fmt(h.salary)}/race` : ''}</span>${was}
                        ${latest ? '<span class="chip chip-dim">latest</span>' : ''}</span>
                    ${deltas}
                    ${h.note ? `<span class="race-sub">“${Util.esc(h.note)}”</span>` : ''}
                    <span class="race-sub muted">${Util.esc(Util.fmtDateShort(h.at))}</span>
                </div>
            </div>`;
        }).join('');

        Modal.open(`
            ${Modal.header(`🤝 ${Util.esc(this._label(neg))}`, 'Contract negotiation room — both sides see this thread, and it updates live')}
            ${offerHero}
            <div class="stack" style="max-height:220px;overflow-y:auto;gap:.15rem" id="deal-thread">${thread}</div>
            ${neg.status === 'open' && involved ? `
                <form id="deal-act" class="form-grid" style="margin-top:.8rem">
                    ${myTurn ? `
                        <div class="form-row">
                            <label class="field"><span>Counter ${perRace} ($${isBuyout ? ', one-time' : '/race'})</span>
                                <input id="deal-salary" class="input" type="number" min="10" step="10" value="${neg.salary}"></label>
                        </div>
                        ${isFreshHire ? `
                            ${neg.kind === 'team-driver' ? `<label class="check"><input id="deal-exclusive" type="checkbox" ${neg.exclusive ? 'checked' : ''}>
                                🔒 Exclusive contract — they drive for you and nobody else (uncheck to allow multi-team)</label>` : ''}
                            ${Clauses.formSection({
                                teamStars, salary: neg.salary, personKind: neg.personKind,
                                current: { agreement: neg.agreement, signOnBonus: neg.signOnBonus, clauses: neg.clauses }
                            })}` : ''}` : ''}
                    <label class="field"><span>Message ${myTurn ? '(sent with your counter)' : 'to the other side'}</span>
                        <input id="deal-note" class="input" maxlength="200" placeholder="e.g. Final offer — podium bonuses when we renegotiate next season."></label>
                    <div class="modal-actions">
                        ${myTurn ? `
                            <button type="button" class="btn btn-primary" id="deal-accept">✅ Accept ${Economy.fmt(neg.salary)}${unit}</button>
                            <button type="submit" class="btn btn-secondary">↩️ Send Counter</button>
                            <button type="button" class="btn btn-danger" id="deal-decline">❌ Decline</button>`
                        : `
                            <button type="submit" class="btn btn-secondary">💬 Send Note</button>
                            ${canWithdraw ? '<button type="button" class="btn btn-ghost" id="deal-withdraw">🚫 Withdraw offer</button>'
                                : '<span class="chip chip-dim" title="The ball is in their court — accept, counter, or decline happens on their turn. You can still talk.">⏳ Waiting on their answer</span>'}`}
                    </div>
                    <p id="deal-error" class="form-error"></p>
                </form>`
            : `<div class="modal-actions" style="margin-top:.8rem"><button class="btn btn-primary" onclick="Modal.close()">Close</button></div>`}
        `, { wide: true });
        // Refresh whatever is behind once the player dismisses the room.
        Modal.onClose(() => App.go(App.current.view, App.current.param));

        const errEl = () => Util.$('#deal-error');
        const busy = (on) => Util.$$('#deal-act button, #deal-accept').forEach(b => { b.disabled = on; });
        // Re-render this modal in place with fresh state — the room never
        // disappears out from under the player mid-conversation.
        const rerender = async (msg) => {
            if (msg) Util.notify(msg);
            await this.room(id, { poll });
        };

        Util.$('#deal-act')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            busy(true);
            try {
                const note = Util.$('#deal-note').value;
                if (myTurn) {
                    const terms = isFreshHire ? {
                        exclusive: neg.kind === 'team-driver' ? !!Util.$('#deal-exclusive')?.checked : neg.exclusive,
                        ...Clauses.readForm()
                    } : null;
                    const n = await this.counter(id, Util.$('#deal-salary').value, note, terms);
                    const sent = [...n.history].reverse().find(h => h.action === 'counter' && h.byUid === uid);
                    const what = (sent?.changes || []).slice(0, 3).join(' · ');
                    await rerender(n.status === 'accepted' ? null : `Counter sent${what ? ': ' + what : ''}. ↩️`);
                } else {
                    await this.sendNote(id, note);
                    await rerender('Note sent. 💬');
                }
            } catch (err) { busy(false); errEl().textContent = err.message; }
        });
        Util.$('#deal-accept')?.addEventListener('click', async () => {
            busy(true);
            try { await this.accept(id, neg.salary); await rerender(); }
            catch (err) {
                // The deal may have moved under us — surface why, then show
                // the room's fresh state so the buttons match reality again.
                Util.notify(err.message, 'error');
                await rerender();
            }
        });
        Util.$('#deal-decline')?.addEventListener('click', async () => {
            busy(true);
            try { await this.close(id, 'decline'); await rerender('Negotiation declined.'); }
            catch (err) { busy(false); errEl().textContent = err.message; }
        });
        Util.$('#deal-withdraw')?.addEventListener('click', async () => {
            busy(true);
            try { await this.close(id, 'withdraw'); await rerender('Offer withdrawn.'); }
            catch (err) { busy(false); errEl().textContent = err.message; }
        });

        // ---- Live updates: poll while the room is open so the other side's
        // counters appear without reopening (rooms are snapshots otherwise).
        clearInterval(this._roomTimer);
        if (!poll || neg.status !== 'open') return;
        const stamp = { history: neg.history.length, salary: neg.salary, status: neg.status };
        this._roomTimer = setInterval(async () => {
            const overlay = document.getElementById('active-modal');
            if (!overlay || !document.getElementById('deal-thread')) { clearInterval(this._roomTimer); return; }
            try {
                const fresh = await DB.get('negotiations', id, { force: true });
                if (!fresh) { clearInterval(this._roomTimer); return; }
                if (fresh.history.length !== stamp.history || fresh.salary !== stamp.salary || fresh.status !== stamp.status) {
                    clearInterval(this._roomTimer);
                    const typed = Util.$('#deal-note')?.value;
                    Util.notify(fresh.status === 'open' ? 'The deal moved — room updated. 🔄' : `Negotiation ${fresh.status}. 🔄`);
                    await this.room(id, { poll });
                    if (typed && Util.$('#deal-note')) Util.$('#deal-note').value = typed;
                }
            } catch (e) { /* transient read error — keep polling */ }
        }, 4000);
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
        // Player crew contracts point at roleProfiles, AI crew at staff.
        const person = await DB.get(isDriver ? 'drivers' : (contract.roleProfileId ? 'roleProfiles' : 'staff'), contract.personId).catch(() => null);
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
                <p class="muted small">${(person.ownerUid || person.uid) ? 'They are a player — this opens a negotiation they must accept.' : 'AI talent answers instantly: fair terms sign, lowballs get countered.'}</p>
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
                    personUid: person.ownerUid || person.uid || null,
                    roleProfileId: contract.roleProfileId || null,
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
