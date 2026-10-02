/* Pure-logic soak for js/paddock-core.js (shared by the league app and the
   Solo Career). No browser: wear, repairs, upgrades, used lots, haggling,
   finance, skills, side events, decision cards, sponsors, loans, walk-ins.
   Every output is scanned for NaN / undefined leaks.
   Run: node paddock-core-test.js */
const path = require('path');
const PC = require(path.join(__dirname, '../../../../sim-racing-career/js/paddock-core.js'));

const steps = [];
const log = (ok, msg) => { steps.push(`${ok ? '✅' : '❌'} ${msg}`); console.log(ok ? '✅' : '❌', msg); };
const leaks = (obj, at = '') => {
    const bad = [];
    const walk = (v, p) => {
        if (typeof v === 'number' && !Number.isFinite(v)) bad.push(p);
        else if (v === undefined) bad.push(p);
        else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
        else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, `${p}.${k}`));
    };
    walk(obj, at);
    return bad;
};

const model = { id: 'm1', name: 'Phoenix GT-R', carId: 'phoenix-gt-r', price: 50000, stats: { performance: 7, durability: 6 }, emoji: '🏎️' };
const models = [model,
    { id: 'm2', name: 'Rocket RX', carId: 'rocket-rx', price: 9500, stats: { performance: 7, durability: 6 } },
    { id: 'm3', name: 'Dallara P217', carId: 'dallara-p217', price: 140000, stats: { performance: 10, durability: 6 } }];

/* ---- 1. Legacy entries keep their value; fresh cars sell back at 60% ---- */
{
    const legacy = { id: 'c1', name: 'Old', price: 32000, stats: { performance: 6, durability: 7 } };
    const fresh = PC.ensureCar({ ...legacy, cond: PC.fullCond(100), races: 0 });
    log(PC.marketValue(legacy) === 32000 && PC.sellBackValue(legacy) === 19200 && PC.sellBackValue(fresh) === 19200
        && PC.overall(legacy) === 100 && PC.pi(legacy) === 15 + 6 * 7,
        `Legacy garage entries keep their price (sell-back $${PC.sellBackValue(legacy)}), PI ${PC.pi(legacy)}`);
}

/* ---- 2. Race wear: every component drops, odometer moves, value falls ---- */
let worn;
{
    const r = PC.rng('wear-1');
    const car = PC.ensureCar({ ...model });
    const out = PC.applyRaceWear(car, { km: 160, type: 'rd', result: { position: 5, incidents: 1 }, skills: {} }, r);
    worn = out.car;
    const allDown = PC.COMP_KEYS.every(k => out.car.cond[k] < 100);
    log(allDown && out.car.races === 1 && out.car.km === 160 && out.car.cond.tyres < out.car.cond.engine
        && PC.marketValue(out.car) < model.price && !leaks(out).length,
        `One road-course race: tyres ${out.car.cond.tyres}%, engine ${out.car.cond.engine}%, body ${out.car.cond.body}% · value $${PC.marketValue(out.car)}`);
    // A season of abuse.
    let c = car;
    const rr = PC.rng('season');
    for (let i = 0; i < 12; i++) c = PC.applyRaceWear(c, { laps: 60, type: 'st', result: { position: 10, incidents: 2, dnf: i === 5 }, skills: {} }, rr).car;
    log(PC.overall(c) < 40 && PC.failRisk(c) > PC.failRisk(car) && PC.pi(c) < PC.pi(car) && PC.reliability(c) < 95,
        `12 street races unrepaired: overall ${PC.overall(c)}%, reliability ${PC.reliability(c)}%, PI ${PC.pi(c)} (was ${PC.pi(car)})`);
    // Skills cut tyre wear.
    const a = PC.applyRaceWear(car, { km: 150, type: 'rd', result: {}, skills: {} }, PC.rng('t')).car.cond.tyres;
    const b = PC.applyRaceWear(car, { km: 150, type: 'rd', result: {}, skills: { tyres: 100, mechanical: 100 } }, PC.rng('t')).car.cond.tyres;
    log(b > a, `Tyre management + mechanical skill save rubber (${a}% → ${b}% left)`);
    // Side-event wear doesn't count as a race start.
    const side = PC.applyRaceWear(car, { km: 75, type: 'rd', result: {}, skills: {}, countRace: false, extraTyres: 40 }, PC.rng('s')).car;
    log(side.races === 0 && side.km === 75 && side.cond.tyres < 60, `Side-event wear: no race start counted, tyres ${side.cond.tyres}%`);
}

/* ---- 3. Hidden faults surface after the first race ---- */
{
    const car = PC.ensureCar({ ...model, cond: PC.fullCond(90), races: 20, hidden: [{ comp: 'engine', drop: 25, label: 'head-gasket weep' }] });
    const out = PC.applyRaceWear(car, { km: 150, type: 'rd', result: {}, skills: {} }, PC.rng('h'));
    log(out.car.cond.engine < 70 && !out.car.hidden.length && out.notes.some(n => /Hidden fault/.test(n)),
        `Undisclosed fault surfaced: engine ${out.car.cond.engine}% (${out.notes.join('; ')})`);
}

/* ---- 4. Shops: quotes, DIY, warranty, repairs, installs, tune, inspect ---- */
{
    const shop = PC.SHOPS.mainst;
    const q = PC.quote(worn, { service: 'service' }, shop);
    const diy = PC.quote(worn, { service: 'service' }, null, { diy: { level: 3, mechanical: 40 } });
    const precision = PC.quote(worn, { service: 'service' }, PC.SHOPS.precision);
    const warr = PC.quote(worn, { service: 'service' }, PC.SHOPS.factory, { warranty: true });
    log(q.total > 0 && diy.labor === 0 && diy.parts > 0 && diy.ap >= 1 && precision.total > q.total && warr.total === 0,
        `Full service quotes — Main Street $${q.total}, Precision $${precision.total}, DIY parts $${diy.parts} + ${diy.ap} paddock time, warranty $${warr.total}`);
    const fixed = PC.performJob(worn, { service: 'service' }, PC.jobQuality(shop, 'service'), 0, PC.rng('fix')).car;
    log(['tyres', 'brakes', 'gearbox', 'suspension'].every(k => fixed.cond[k] >= 85) && fixed.cond.engine === worn.cond.engine,
        `Main Street service restored tyres ${fixed.cond.tyres}%, brakes ${fixed.cond.brakes}% (engine untouched ${fixed.cond.engine}%)`);
    const before = PC.pi(fixed);
    const up = PC.performJob(fixed, { service: 'install', part: 'intake', tier: 3 }, 0.9, 0, PC.rng('i')).car;
    const tuned = PC.performJob(up, { service: 'tune' }, 0.9, 0, PC.rng('tu')).car;
    log(up.parts.intake?.tier === 3 && PC.pi(up) > before && tuned.tune === 1 && PC.pi(tuned) > PC.pi(up)
        && PC.marketValue(up) > PC.marketValue(fixed) && PC.partWearMult(up, 'engine') > 1,
        `Race intake fitted: PI ${before} → ${PC.pi(up)} → tuned ${PC.pi(tuned)}; engine wear ×${PC.partWearMult(up, 'engine').toFixed(2)}`);
    const botched = PC.performJob(fixed, { service: 'install', part: 'ecu', tier: 2 }, 0.6, 1, PC.rng('b'));
    log(botched.result === 'botched' && botched.car.parts.ecu.eff < 0.7 && botched.car.cond.engine < fixed.cond.engine,
        `Botched install: ECU fitted at ${Math.round(botched.car.parts.ecu.eff * 100)}%, engine knocked to ${botched.car.cond.engine}%`);
    const hiddenCar = PC.ensureCar({ ...model, hidden: [{ comp: 'brakes', drop: 20, label: 'warped rotors' }] });
    const insp = PC.performJob(hiddenCar, { service: 'inspect' }, 0.8, 0, PC.rng('in'));
    log(insp.revealed.length === 1 && /warped rotors/.test(insp.text), `Inspection: ${insp.text}`);
    log(PC.diyAllowed({ service: 'tyres' }, 1) && !PC.diyAllowed({ service: 'engine' }, 3) && PC.diyAllowed({ service: 'engine' }, 4)
        && !PC.diyAllowed({ service: 'install', part: 'aero', tier: 1 }, 3) && PC.diyAllowed({ service: 'tune' }, 5) && !PC.diyAllowed({ service: 'tune' }, 4),
        'Garage levels gate DIY work (tyres on the driveway, engines at the Race Shop, dyno at the Pro Facility)');
}

/* ---- 5. Gremlins: deterministic, likelier on a wreck ---- */
{
    const wreck = PC.ensureCar({ ...model, cond: { engine: 8, gearbox: 15, suspension: 20, brakes: 10, tyres: 5, body: 30 } });
    const healthy = PC.ensureCar({ ...model });
    let fails = 0, healthyFails = 0;
    for (let i = 0; i < 200; i++) {
        if (PC.gremlinCheck(wreck, { seed: 'race' + i, laps: 50 }).fails) fails++;
        if (PC.gremlinCheck(healthy, { seed: 'race' + i, laps: 50 }).fails) healthyFails++;
    }
    const g1 = PC.gremlinCheck(wreck, { seed: 'fixed', laps: 50 });
    const g2 = PC.gremlinCheck(wreck, { seed: 'fixed', laps: 50 });
    log(fails > 100 && healthyFails < 10 && JSON.stringify(g1) === JSON.stringify(g2) && (!g1.fails || (g1.lap >= 1 && g1.lap <= 50 && PC.COMPONENTS[g1.comp])),
        `Mechanical gremlins: wreck fails ${fails}/200, healthy ${healthyFails}/200, same seed → same order (${g1.fails ? `${g1.comp} on lap ${g1.lap}` : 'no failure'})`);
    log(PC.aiOffset(wreck) < 0 && PC.aiOffset(PC.performJob(healthy, { service: 'install', part: 'engine', tier: 4 }, 1, 0, PC.rng('x')).car) > PC.aiOffset(healthy),
        `AI offset follows the car: wreck ${PC.aiOffset(wreck)}, healthy ${PC.aiOffset(healthy)}`);
}

/* ---- 6. Used lots: deterministic, honest vs shady, haggling ---- */
{
    const lotA = PC.usedLot('lucky', { week: '2026-W40', models });
    const lotB = PC.usedLot('lucky', { week: '2026-W40', models });
    const lotC = PC.usedLot('lucky', { week: '2026-W41', models });
    const honest = [], shady = [];
    for (let w = 1; w <= 30; w++) {
        honest.push(...PC.usedLot('secondgear', { week: 'W' + w, models }));
        shady.push(...PC.usedLot('lucky', { week: 'W' + w, models }));
    }
    const faultRate = (l) => l.filter(x => x.car.hidden.length).length / l.length;
    const sane = [...honest, ...shady].every(l => l.asking >= l.floor && l.asking > 0 && l.car.races > 0 && !leaks(l).length);
    log(JSON.stringify(lotA) === JSON.stringify(lotB) && JSON.stringify(lotA) !== JSON.stringify(lotC) && lotA.length === 6 && sane
        && faultRate(shady) > faultRate(honest) + 0.2,
        `Used lots restock weekly and deterministically; hidden faults: Second Gear ${Math.round(faultRate(honest) * 100)}% vs Lucky Lou ${Math.round(faultRate(shady) * 100)}%`);
    const ex = PC.usedLot('exchange', { week: 'W3', models });
    log(ex.filter(l => Object.keys(l.car.parts).length).length >= 3, `Race Car Exchange cars come upgraded (${ex.filter(l => Object.keys(l.car.parts).length).length}/${ex.length})`);
    const auction = PC.usedLot('auction', { week: 'W3', models });
    log(auction.some(l => l.car.title === 'salvage') && PC.haggle(auction[0], 1, {}).outcome === 'walk',
        'Salvage auction: write-offs with salvage titles, no haggling');

    const L = honest[0];
    const ok = PC.haggle(L, L.floor, {});
    let st = {};
    const c1 = PC.haggle(L, Math.round(L.floor * 0.9), st); st = c1.state;
    const c2 = PC.haggle(L, Math.round(L.floor * 0.92), st); st = c2.state;
    const c3 = PC.haggle(L, Math.round(L.floor * 0.93), st); st = c3.state;
    const c4 = PC.haggle(L, Math.round(L.floor * 0.94), st);
    log(ok.outcome === 'accept' && ok.price <= L.asking && c1.outcome === 'counter' && c1.price < L.asking && c4.outcome === 'walk',
        `Haggling: floor offer accepted ($${ok.price}), lowballs countered ($${c1.price}), dealer walks after ${L && PC.DEALERS.secondgear.patience} tries`);
    const insult = PC.haggle(L, Math.round(L.floor * 0.5), {});
    log(insult.outcome === 'insulted' || insult.outcome === 'walk', `Insulting offer: ${insult.line}`);
}

/* ---- 7. Finance & loans ---- */
{
    const good = PC.financePlan(50000, { credit: 800 });
    const bad = PC.financePlan(50000, { credit: 400 });
    log(good.down === 10000 && good.perRace * good.races >= good.financed && bad.rate > good.rate,
        `Finance: $${good.down} down, ${good.races} × $${good.perRace} (good credit ${Math.round(good.rate * 100)}% vs poor ${Math.round(bad.rate * 100)}%)`);
    const t = PC.loanTerms('starter', { credit: 650 });
    log(t.amount === 15000 && t.perRace * t.races >= t.total && PC.creditLimit({ stars: 3, fans: 2000 }) > PC.creditLimit({ stars: 1 })
        && PC.creditAfterPayment(650, 100) > 650 && PC.creditAfterPayment(650, -5) < 650,
        `Loans: starter ${t.races} × $${t.perRace}; credit limit grows with stars; credit score moves with on-time payments`);
}

/* ---- 8. Skills, XP, perks, rating ---- */
{
    let s = PC.newSkills(PC.rng('sk'));
    const base = PC.ratingFromSkills(s);
    for (let i = 0; i < 40; i++) s = PC.gainXP(s, PC.raceXP({ position: 2, start: 8, incidents: 0, pole: i % 4 === 0 })).skills;
    const trained = PC.gainXP(s, PC.runTraining('coach', PC.rng('c')));
    log(PC.ratingFromSkills(trained.skills) > base && base >= 55 && base <= 70 && PC.skillValue(s.pace) > 30
        && PC.apMax(trained.skills) >= 10,
        `Skills: rating ${base} → ${PC.ratingFromSkills(trained.skills)} after 40 strong races + a coach; pace L${s.pace.lvl}`);
    const maxed = PC.gainXP(PC.newSkills(), { fitness: 99999, tyres: 99999 });
    log(maxed.skills.fitness.lvl === 20 && PC.apMax(maxed.skills) === 14 && PC.hasPerk(maxed.skills, 'tyres', 16) && maxed.levelUps.length === 28,
        'Level cap 20; Marathon Runner perk gives +4 paddock time');
    const regen = PC.regenAP(2, Date.now() - 3 * 86400000 - 1000, { max: 10, perDay: 4 });
    log(regen.ap === 10 && PC.regenAP(5, Date.now(), { max: 10 }).ap === 5, 'Paddock time regenerates daily up to the cap');
}

/* ---- 9. Side events and decision cards never leak ---- */
{
    const ctx = { car: worn, skills: PC.newSkills(), fans: 1200, econ: 1, rating: 70 };
    const outs = Object.keys(PC.SIDE_EVENTS).map(k => [k, PC.runSideEvent(k, ctx, PC.rng('se-' + k))]);
    const bad = outs.flatMap(([k, o]) => leaks(o, k));
    log(PC.merchFor(999) === 0 && PC.merchFor(1000) === 20 && PC.merchFor(20000, 2) === 800, 'Merch stand opens at 1,000 fans, then pays per fan');
    log(!bad.length && outs.every(([k, o]) => o.text && o.fans >= 0), `All ${outs.length} side events resolve cleanly: ${outs.map(([k, o]) => `${k} +${o.fans} fans${o.money ? ` $${o.money}` : ''}`).join(', ')}`);
    const wearOut = PC.applyRaceWear(worn, outs.find(([k]) => k === 'drift')[1].wear.ctx, PC.rng('dw'));
    log(wearOut.car.cond.tyres < worn.cond.tyres && wearOut.car.races === worn.races, `Drift exhibition shreds tyres (${worn.cond.tyres}% → ${wearOut.car.cond.tyres}%) without a race start`);

    let cardBad = [];
    let resolved = 0;
    for (const card of PC.CARDS) {
        for (const ch of card.choices) {
            for (let i = 0; i < 5; i++) {
                const o = PC.resolveCard(card.id, ch.id, PC.rng(card.id + ch.id + i), { carPrice: 50000, model });
                cardBad.push(...leaks(o, `${card.id}.${ch.id}`));
                resolved++;
            }
        }
    }
    const draws = new Set();
    for (let i = 0; i < 300; i++) draws.add(PC.drawCard(PC.rng('d' + i), { hasCar: true, hasSponsor: true }));
    const noCar = new Set();
    for (let i = 0; i < 300; i++) noCar.add(PC.drawCard(PC.rng('n' + i), { hasCar: false, hasSponsor: false }));
    const barn = PC.resolveCard('barnfind', 'buy', PC.rng('barn'), { model });
    log(!cardBad.length && draws.size === PC.CARDS.length && ![...noCar].some(id => PC.cardById(id).requires)
        && barn.giftCar && barn.money < 0 && barn.giftCar.paid === -barn.money,
        `${PC.CARDS.length} decision cards × every choice (${resolved} resolutions) clean; requirements respected; barn find costs $${-barn.money}`);
}

/* ---- 10. Sponsors: offers, push, a full contract ---- */
{
    const offers = PC.sponsorOffers(PC.rng('sp'), { kind: 'driver', stars: 2, fans: 3000, media: 50, count: 5 });
    const team = PC.sponsorOffers(PC.rng('spt'), { kind: 'team', stars: 4, fans: 0, media: 40, count: 6 });
    const indOk = new Set(offers.map(o => o.industry)).size === offers.length;
    log(offers.length === 5 && team.length === 6 && indOk && offers.every(o => o.perRace >= 50 && o.obj.target <= o.races && PC.DRIVER_SLOTS[o.slot])
        && team.every(o => PC.TEAM_SLOTS[o.slot]) && Math.max(...team.map(o => o.perRace)) > Math.max(...offers.map(o => o.perRace)) && !leaks([offers, team]).length,
        `Sponsor offers: driver ${offers.map(o => `${o.brand} $${o.perRace}/race (${PC.objLabel(o.obj)})`).join('; ')}`);
    const excluded = PC.sponsorOffers(PC.rng('sp'), { kind: 'driver', stars: 2, count: 6, taken: [offers[0].brand], industries: [offers[1].industry] });
    log(!excluded.some(o => o.brand === offers[0].brand || o.industry === offers[1].industry), 'Industry exclusivity: no two sponsors from the same industry');

    let pushes = 0, wins = 0;
    for (let i = 0; i < 100; i++) { const p = PC.pushOffer(offers[0], PC.rng('p' + i), { media: 60, stars: 3 }); pushes++; if (p.ok) wins++; }
    log(wins > 30 && wins < 90 && PC.pushOffer({ ...offers[0], pushed: true }, PC.rng('x')).ok === false, `Pushing for more works ${wins}% of the time at media 60, once per offer`);

    let deal = PC.signDeal({ ...offers[0], obj: { kind: 'top10', target: 2, hits: 0 }, races: 4 });
    let total = 0, bonus = 0, ended = false, renew = null;
    const rr = PC.rng('season');
    for (let i = 0; i < 4 && !ended; i++) {
        const o = PC.sponsorRace(deal, { position: 4, start: 9, incidents: 0 }, rr);
        deal = o.deal; total += o.pay; bonus += o.bonus; ended = o.ended; renew = o.renew;
    }
    log(ended && bonus === offers[0].bonus && total === offers[0].perRace * 4 && deal.happy > 60 && renew && renew.perRace > deal.perRace,
        `Contract run: 4 races paid $${total}, objective met → bonus $${bonus}, happiness ${deal.happy}, renewal at $${renew?.perRace}/race`);
    let bad = PC.signDeal({ ...offers[0], races: 10 });
    let walked = false;
    for (let i = 0; i < 10 && !walked; i++) { const o = PC.sponsorRace(bad, { dnf: true, incidents: 4 }, rr); bad = o.deal; walked = o.walked; }
    log(walked, `A string of crashes makes the sponsor walk (happiness ${bad.happy})`);
    const ren = PC.renewalOffer(deal, renew, PC.rng('ren'));
    log(ren.renewal && ren.brand === deal.brand && ren.perRace === renew.perRace && !leaks(ren).length, `Renewal offer from ${ren.brand}: $${ren.perRace}/race for ${ren.races} races`);
}

/* ---- 11. Mechanic walk-ins & dealer AI buyers ---- */
{
    const jobs = PC.walkInJobs('uid|2026-10-02', { stars: 3 });
    const again = PC.walkInJobs('uid|2026-10-02', { stars: 3 });
    log(jobs.length === 3 && JSON.stringify(jobs) === JSON.stringify(again) && jobs.every(j => j.options.includes(j.answer) && j.options.length === 3 && j.pay > 0)
        && PC.walkInHint(jobs[0], 3) !== jobs[0].answer && PC.walkInHint(jobs[0], 1) === null,
        `Walk-in jobs: "${jobs[0].symptom}" → ${jobs[0].answer} ($${jobs[0].pay}); 3★ mechanics get a hint`);
    const car = PC.ensureCar({ ...model, races: 10, cond: PC.fullCond(80) });
    const v = PC.marketValue(car);
    log(PC.aiBuyerChance(car, v * 0.9) > PC.aiBuyerChance(car, v * 1.3) && PC.aiBuyerChance(car, v * 1.6) === 0,
        `AI buyers: priced at 90% of value ${Math.round(PC.aiBuyerChance(car, v * 0.9) * 100)}%/day, at 130% ${Math.round(PC.aiBuyerChance(car, v * 1.3) * 100)}%/day, at 160% never`);
    const ps = PC.playerShop({ id: 'rp1', name: 'Ann', uid: 'u1', shop: { name: "Ann's Speed Shop", laborMul: 1.2, specialty: 'engine' } }, 4);
    log(ps.quality > PC.SHOPS.mainst.quality && ps.priceMul === 1.2 && PC.shopFits(ps, 'engine'), `Player shop: ${ps.name}, quality ${Math.round(ps.quality * 100)}%`);
}

/* ---- 12. Paddock state ---- */
{
    const p = PC.ensurePaddock(null, 'u1');
    const q = PC.ensurePaddock({ fans: 900, skills: { pace: { lvl: 12, xp: 3 } } }, 'u1');
    log(p.ap === 10 && p.skills.pace.lvl >= 6 && q.fans === 900 && q.skills.pace.lvl === 12 && q.skills.media && Array.isArray(q.sponsors) && !leaks(p).length,
        'Paddock state initialises and back-fills partial saves');
}

const fails = steps.filter(s => s.startsWith('❌'));
console.log(`\n${steps.length - fails.length}/${steps.length} steps passed`);
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
