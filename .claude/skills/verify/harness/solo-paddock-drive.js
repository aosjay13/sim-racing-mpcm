/* Drive the Solo Career Paddock (js/solo/sc-paddock.js) in the real UI:
   the nav entry, a decision card, Phoenix Motors (cash + finance with a
   trade-in), a used lot (inspect, haggle, buy), the garage (shop service,
   part install, DIY, nickname, garage upgrade, sell), side events with the
   once-per-round limit, loans, a simulated round (paddock time refill, new
   card, finance + loan repayments, merch, the round report), undo-safe
   saves (reload keeps everything), every tab leak-free, phone width.
   Needs `python3 -m http.server 8317` from the repo root. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:8317/sim-racing-career/career.html';
const SHOTS = path.join(__dirname, 'solo-paddock-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const steps = [];
const log = (ok, msg) => { const line = `${ok ? '✅' : '❌'} ${msg}`; steps.push(line); console.log(line); };

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route('**/*', r => r.request().url().startsWith('http://localhost:8317') ? r.continue() : r.fulfill({ contentType: 'text/css', body: '' }));
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    const settle = (ms = 350) => page.waitForTimeout(ms);
    const BAD = /\bNaN\b|\bundefined\b|\[object |\bInfinity\b|\bnull\b/;
    const scan = async () => {
        const txt = await page.evaluate(() => [document.getElementById('sc-app')?.innerText || '', document.getElementById('sc-modal')?.innerText || ''].join('\n'));
        return txt.split('\n').filter(l => BAD.test(l));
    };
    const toasts = async () => { const t = await page.evaluate(() => document.getElementById('toast-holder')?.innerText || ''); await page.evaluate(() => document.querySelectorAll('#toast-holder .toast').forEach(x => x.remove())); return t.replace(/\n+/g, ' · '); };
    const go = async (tab) => { await page.evaluate((t) => SC.App.go('paddock', t), tab); await page.waitForSelector('#sc-view .view-head'); await settle(); };
    const PD = (fn) => page.evaluate(fn);
    const submit = async (sel) => { await page.evaluate((s) => document.querySelector(s).dispatchEvent(new Event('submit', { cancelable: true })), sel); await settle(500); };

    await page.goto(BASE);
    await page.waitForSelector('.sc-hero');
    // A GT career in Assetto Corsa Competizione with some money to play with.
    const id = await page.evaluate(async () => {
        const g = SC.game('acc');
        const sd = g.series.find(s => s.tier >= 5) || g.series[0];
        const S = SC.Engine.newCareer({ gameId: 'acc', seriesId: sd.id, role: 'driver', difficulty: 'normal', seed: 4242, character: { first: 'Pat', last: 'Paddock', nat: 'GBR', age: 20, num: 44 } });
        SC.Engine._ledger(S, 'p', 120000, 'Test float', 'bonus');
        await SC.Store.save(S);
        return S.id;
    });
    await page.goto(`${BASE}#/c/${id}/paddock`);
    await page.waitForSelector('#sc-view .view-head');
    await settle(600);

    /* 1 · Nav + overview + a decision card */
    const ov = await PD(() => ({
        nav: !!document.querySelector('[data-go="paddock"]'),
        card: !!SC.App.S.paddock.card, choices: document.querySelectorAll('[data-card]').length,
        ap: SC.App.S.paddock.ap, max: SC.Paddock.apMax(SC.App.S), tabs: document.querySelectorAll('[data-pdtab]').length
    }));
    log(ov.nav && ov.card && ov.choices >= 2 && ov.ap === ov.max && ov.ap >= 10 && ov.tabs === 6, `Paddock in the Solo nav: 6 tabs, ⏱ ${ov.ap}, a decision card with ${ov.choices} choices`);
    await page.screenshot({ path: path.join(SHOTS, '01-overview.png'), fullPage: true });
    const cardBefore = await PD(() => SC.App.S.paddock.card);
    await page.click('[data-card]:last-of-type');
    await settle(500);
    const cardAfter = await PD(() => ({ card: SC.App.S.paddock.card, played: SC.App.S.paddock.stats.cardsPlayed }));
    log(!cardAfter.card && cardAfter.played === 1, `Played the "${cardBefore}" card: ${await toasts()}`);

    /* 2 · Phoenix Motors: buy a hot hatch, then finance a coupé with it as trade-in */
    await go('dealers');
    const money0 = await PD(() => SC.App.S.player.money);
    await page.click('[data-pdnew="rc-hothatch"]:not([data-deal])');
    await settle(500);
    const bought = await PD(() => ({ n: SC.App.S.paddock.garage.length, car: SC.App.S.paddock.garage[0], money: SC.App.S.player.money }));
    log(bought.n === 1 && bought.car.name === 'Hot Hatch' && money0 - bought.money === 32000 && bought.car.warranty === 5, `Bought a Hot Hatch for $${money0 - bought.money} with a 5-round warranty`);
    await toasts();
    await page.click('[data-pdnew="rc-coupe"][data-deal]');
    await page.waitForSelector('#pd-deal-form');
    await page.selectOption('#pd-dl-trade', bought.car.id);
    await page.selectOption('#pd-dl-pay', 'finance');
    const sum = await page.innerText('#pd-dl-sum');
    await submit('#pd-deal-form');
    const fin = await PD(() => ({ g: SC.App.S.paddock.garage.map(c => c.name), car: SC.App.S.paddock.garage.find(c => c.name === 'Track-day Coupé'), money: SC.App.S.player.money }));
    log(fin.g.length === 1 && fin.car?.finance?.perRace > 0 && /Due today/i.test(sum), `Financed a Track-day Coupé with the hatch traded in: ${fin.car?.finance?.racesLeft} × $${fin.car?.finance?.perRace}`);
    await toasts();

    /* 3 · Used lot: inspect, haggle, buy */
    await page.click('[data-pddealer="secondgear"]');
    await settle(400);
    const lot = await PD(() => SC.Paddock.lot(SC.App.S, 'secondgear').map(l => ({ id: l.id, asking: l.asking, floor: l.floor, name: l.car.name })));
    const cheap = lot.slice().sort((a, b) => a.asking - b.asking)[0];
    await page.click(`[data-pdinspect="${cheap.id}"]`);
    await page.waitForSelector('#sc-modal [data-no], #sc-modal [data-yes]', { timeout: 3000 }).catch(() => {});
    if (await page.$('#sc-modal [data-no]')) await page.click('#sc-modal [data-no]');
    await settle(600);
    const insp = await PD(() => Object.keys(SC.App.S.paddock.inspected || {}).length);
    await toasts();
    await page.click(`[data-pdhaggle="${cheap.id}"]`);
    await page.waitForSelector('#pd-hg-form');
    await page.fill('#pd-hg-offer', String(Math.round(cheap.floor * 0.9)));
    await submit('#pd-hg-form');
    const hg = await toasts();
    await page.click(`[data-pdused="${cheap.id}"]`);
    await settle(500);
    const usedBuy = await PD(() => ({ n: SC.App.S.paddock.garage.length, sold: Object.keys(SC.App.S.paddock.lotSold).length }));
    log(insp === 1 && hg.length > 3 && usedBuy.n === 2 && usedBuy.sold === 1, `Second Gear: inspected, haggled ("${hg.slice(0, 50)}"), bought the ${cheap.name}`);
    await toasts();

    /* 4 · Garage: shop service, install, DIY, nickname, upgrade */
    await go('garage');
    const carId = await PD(() => SC.App.S.paddock.garage.find(c => c.name === 'Track-day Coupé').id);
    await PD(() => { const c = SC.App.S.paddock.garage.find(x => x.name === 'Track-day Coupé'); c.cond = { engine: 60, gearbox: 55, suspension: 50, brakes: 30, tyres: 20, body: 80 }; });
    await page.click(`[data-pdshop="${carId}"]:not([data-install])`);
    await page.waitForSelector('#pd-sh-form');
    await page.selectOption('#pd-sh-shop', 'factory');
    const q = await page.innerText('#pd-sh-q');
    await submit('#pd-sh-form');
    const svc = await PD(() => SC.App.S.paddock.garage.find(c => c.name === 'Track-day Coupé').cond);
    log(svc.tyres >= 90 && svc.brakes >= 90 && /warranty/i.test(q), `Factory Works serviced the coupé under warranty (tyres ${svc.tyres}%, brakes ${svc.brakes}%)`);
    await toasts();
    const pi0 = await PD(() => PaddockCore.pi(SC.App.S.paddock.garage.find(c => c.name === 'Track-day Coupé')));
    await page.click(`[data-pdshop="${carId}"][data-install]`);
    await page.waitForSelector('#pd-sh-form');
    await page.selectOption('#pd-sh-part', 'suspension');
    await page.selectOption('#pd-sh-tier', '2');
    await submit('#pd-sh-form');
    const pi1 = await PD(() => PaddockCore.pi(SC.App.S.paddock.garage.find(c => c.name === 'Track-day Coupé')));
    log(pi1 > pi0, `Apex fitted Sport coilovers: PI ${pi0} → ${pi1}`);
    await toasts();
    await PD(() => { const c = SC.App.S.paddock.garage.find(x => x.name === 'Track-day Coupé'); c.cond.tyres = 15; });
    const ap0 = await PD(() => SC.App.S.paddock.ap);
    await page.click(`[data-pddiy="${carId}"]`);
    await page.waitForSelector('#pd-diy-form');
    await submit('#pd-diy-form');
    const diy = await PD(() => ({ tyres: SC.App.S.paddock.garage.find(c => c.name === 'Track-day Coupé').cond.tyres, ap: SC.App.S.paddock.ap }));
    log(diy.tyres >= 60 && diy.ap < ap0, `DIY tyres on the driveway: ${diy.tyres}%, ${ap0 - diy.ap} ⏱`);
    await toasts();
    await page.click(`[data-pdnick="${carId}"]`);
    await page.waitForSelector('#pd-nick-form');
    await page.fill('#pd-nick', 'Silver Arrow');
    await submit('#pd-nick-form');
    await page.click('#pd-up');
    await settle(500);
    const gar = await PD(() => ({ nick: SC.App.S.paddock.garage.find(c => c.name === 'Track-day Coupé').nick, lvl: SC.App.S.paddock.garageLevel }));
    log(gar.nick === 'Silver Arrow' && gar.lvl === 2, `Nicknamed "${gar.nick}" and upgraded to a Lock-up Garage`);
    await toasts();
    await page.screenshot({ path: path.join(SHOTS, '02-garage.png'), fullPage: true });

    /* 5 · Side events: once per round */
    await go('events');
    await page.selectOption('#pd-ev-car', carId);
    await page.click('[data-pdevent="trackday"]');
    await settle(500);
    const ev1 = await toasts();
    await page.click('[data-pdevent="stream"]');
    await settle(500);
    await toasts();
    const evState = await PD(() => ({ events: SC.App.S.paddock.stats.sideEvents, fans: SC.App.S.paddock.fans, doneBtn: [...document.querySelectorAll('[data-pdevent="trackday"]')].every(b => b.disabled && /done/i.test(b.innerText)) }));
    const again = await PD(() => { try { SC.Paddock.sideEvent(SC.App.S, 'trackday', null); return 'ran'; } catch (e) { return e.message; } });
    log(evState.events === 2 && evState.doneBtn && /already done/i.test(again), `Track day ("${ev1.slice(0, 50)}") and a stream; the track day is locked until next round`);

    /* 6 · Bank: borrow */
    await go('bank');
    await page.click('[data-pdloan="micro"]');
    await settle(500);
    const loan = await PD(() => SC.App.S.paddock.loans[0]);
    log(loan && loan.perRace > 0, `Borrowed a quick cash loan: ${loan?.racesLeft} × $${loan?.perRace} (scaled to the series)`);
    await toasts();

    /* 7 · A round: refill, new card, repayments, merch, report, persistence */
    const before = await PD(() => ({ ap: SC.App.S.paddock.ap, loan: SC.App.S.paddock.loans[0].balance, fin: SC.App.S.paddock.garage.find(c => c.finance)?.finance.balance }));
    const report = await PD(async () => {
        const r = await SC.App.act((S) => SC.Engine.completeRound(S, { mode: 'sim' }), { undo: 'Round' });
        return { lines: r?.lines || [] };
    });
    await settle(600);
    const after = await PD(() => ({ ap: SC.App.S.paddock.ap, max: SC.Paddock.apMax(SC.App.S), card: !!SC.App.S.paddock.card, loan: SC.App.S.paddock.loans[0]?.balance, fin: SC.App.S.paddock.garage.find(c => c.finance)?.finance.balance,
        ledger: SC.App.S.ledger.filter(l => l.c === 'paddock').map(l => l.l) }));
    log(after.ap === after.max && before.ap < after.max && after.card && after.loan < before.loan && after.fin < before.fin
        && after.ledger.some(l => /Loan repayment/.test(l)) && after.ledger.some(l => /Finance:/.test(l)),
        `After a round: ⏱ ${before.ap} → ${after.ap}, a new card, loan $${before.loan} → $${after.loan}, finance $${before.fin} → $${after.fin}`);
    await go('events');
    const reopened = await PD(() => !document.querySelector('[data-pdevent="trackday"]').disabled);
    log(reopened, 'Side events open again in the new round');
    await page.reload();
    await page.waitForSelector('#sc-view .view-head');
    await settle(600);
    const persisted = await PD(() => ({ n: SC.App.S.paddock.garage.length, nick: SC.App.S.paddock.garage.find(c => c.nick)?.nick, lvl: SC.App.S.paddock.garageLevel }));
    log(persisted.n === 2 && persisted.nick === 'Silver Arrow' && persisted.lvl === 2, 'Reload keeps the paddock (cars, nickname, garage level)');

    /* 8 · Sell a car */
    await go('garage');
    const used = await PD(() => SC.App.S.paddock.garage.find(c => !c.finance));
    const m0 = await PD(() => SC.App.S.player.money);
    await page.click(`[data-pdsell="${used.id}"]`);
    await page.waitForSelector('#sc-modal [data-yes]');
    await page.click('#sc-modal [data-yes]');
    await settle(600);
    const sold = await PD(() => ({ n: SC.App.S.paddock.garage.length, money: SC.App.S.player.money }));
    log(sold.n === 1 && sold.money > m0, `Sold the ${used.name} back for $${sold.money - m0}`);
    await toasts();

    /* 9 · Every tab leak-free; finances label; phone width */
    const leaks = [];
    for (const t of ['overview', 'garage', 'dealers', 'shops', 'events', 'bank']) {
        await go(t);
        const hits = await scan();
        if (hits.length) leaks.push(`${t}: ${hits.slice(0, 2).join(' | ')}`);
        await page.screenshot({ path: path.join(SHOTS, `10-${t}.png`), fullPage: true });
    }
    for (const d of ['lucky', 'exchange', 'auction']) {
        await page.evaluate((d) => { SC.Paddock._dealer = d; }, d);
        await go('dealers');
        const hits = await scan();
        if (hits.length) leaks.push(`dealers/${d}: ${hits.slice(0, 2).join(' | ')}`);
    }
    await page.evaluate(() => SC.App.go('finances', 'p:1'));
    await settle(500);
    const finTxt = await page.innerText('#sc-view');
    log(!leaks.length && /Paddock \(cars, events, loans\)/i.test(finTxt), `All paddock tabs and lots leak-free; Finances shows the Paddock category${leaks.length ? ' — ' + leaks.join(' || ') : ''}`);
    await page.setViewportSize({ width: 390, height: 844 });
    const wide = [];
    for (const t of ['overview', 'garage', 'dealers', 'events', 'bank']) {
        await go(t);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (over > 2) wide.push(`${t} +${over}px`);
    }
    await page.screenshot({ path: path.join(SHOTS, '20-phone-garage.png'), fullPage: true });
    log(!wide.length, `Phone width: no sideways scroll${wide.length ? ' — ' + wide.join(', ') : ''}`);

    log(!errors.length, `No page or console errors${errors.length ? ' — ' + errors.slice(0, 3).join(' | ') : ''}`);
    await browser.close();
    const fails = steps.filter(s => s.startsWith('❌'));
    console.log(`\n${steps.length - fails.length}/${steps.length} steps passed`);
    if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
})().catch(e => { console.error('❌ DRIVE CRASHED:', e); process.exit(1); });
