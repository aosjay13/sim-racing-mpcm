/* Drive Custom Vehicle Images (v3.28.0) through the real UI on the shim:
   GM form URL + file-upload inputs with instant 2D preview, vehicleImages
   docs for uploads (img:// refs), storefront card grid with 16:9 media +
   checkered placeholder + broken-hotlink fallback, strict imageUrl
   inheritance into player AND team garages, and hydrated garage thumbnails. */
const { chromium } = require('playwright');
const path = require('path');
const steps = [];
const log = (m, s) => { steps.push(`${m} ${s}`); console.log(m, s); };

// A tiny valid 1×1 PNG, enough for the canvas compressor to chew on.
const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.route('**/*', r => r.request().url().startsWith('http://localhost:8317')
        ? r.continue() : r.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.addInitScript({ path: path.join(__dirname, 'firebase-shim.js') });
    await page.addInitScript(() => { window.confirm = () => true; window.prompt = () => 'Test'; window.alert = () => {}; });
    page.on('pageerror', e => log('❌', 'pageerror: ' + e.message));
    const toast = async (re, timeout = 30000) => {
        await page.waitForFunction(s => new RegExp(s).test(document.getElementById('toast-holder')?.innerText || ''), re.source, { timeout });
        const t = await page.evaluate(() => document.getElementById('toast-holder').innerText.replace(/\n+/g, ' · '));
        await page.evaluate(() => document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove()));
        return t.trim();
    };
    const shot = async (n) => { await page.waitForTimeout(800); await page.screenshot({ path: path.join(__dirname, n + '.png') }); };

    // GM at the gate; seed a buyer + a team directly on the shim.
    await page.goto('http://localhost:8317/sim-racing-career/app.html');
    await page.click('.gate-tab[data-pane="admin"]');
    await page.fill('#gate-passcode', 'phoenix13!');
    await page.click('#gate-admin-submit');
    await page.waitForSelector('#app-shell:not(.hidden)');
    await toast(/Welcome back/).catch(() => {});
    await page.evaluate(async () => {
        const db = SRMPC.db;
        await db.collection('users').doc('u-rich').set({ displayName: 'Rich', balance: 60000, walletInitialized: true });
        await db.collection('teams').doc('t-fast').set({ name: 'Fast Co', ownerUid: 'u-rich', budget: 50000 });
        DB.invalidate();
    });
    const LOGO = 'http://localhost:8317/Phoenix%20SRMPCM%20Logo.png';

    /* ---- 1. GM creates a car with a PASTED URL — instant preview ---- */
    await page.evaluate(() => Dealership.gmForm());
    await page.waitForSelector('#deal-form');
    log(await page.evaluate(() => !!document.querySelector('#df-img-preview .car-img-ph')) ? '✅' : '❌',
        'New-vehicle form opens with the branded checkered placeholder in the preview');
    await page.fill('#df-name', 'Photon GT');
    await page.fill('#df-price', '9000');
    await page.fill('#df-img-url', LOGO);
    await page.waitForFunction(() => document.querySelector('#df-img-preview img.car-img')?.src.includes('Phoenix'));
    log('✅', 'Typing a URL instantly swaps the preview to the pasted image (before any save)');
    await shot('35-carimg-admin-preview');
    await page.click('#deal-form button[type=submit]');
    await toast(/on the market/);
    const urlCar = await page.evaluate(async () =>
        (await Dealership.inventory({ force: true })).find(c => c.name === 'Photon GT'));
    log(urlCar?.imageUrl === LOGO ? '✅' : '❌', `dealershipInventory doc stores the pasted imageUrl (${(urlCar?.imageUrl || '').slice(0, 50)}…)`);

    /* ---- 2. GM creates a car with a FILE UPLOAD → img:// ref + vehicleImages doc ---- */
    await page.evaluate(() => Dealership.gmForm());
    await page.waitForSelector('#deal-form');
    await page.fill('#df-name', 'Quantum RS');
    await page.fill('#df-price', '12000');
    await page.setInputFiles('#df-img-file', { name: 'quantum.png', mimeType: 'image/png', buffer: PNG_1PX });
    await page.waitForFunction(() => document.querySelector('#df-img-preview img.car-img')?.src.startsWith('data:image/'));
    log('✅', 'Choosing a file compresses it in-browser and previews the result instantly');
    const orphanCheck = await page.evaluate(async () => (await DB.list('vehicleImages', { force: true }).catch(() => [])).length);
    log(orphanCheck === 0 ? '✅' : '❌', 'No vehicleImages doc exists yet — uploads only persist on submit (cancel never orphans)');
    await page.click('#deal-form button[type=submit]');
    await toast(/on the market/);
    const upCar = await page.evaluate(async () =>
        (await Dealership.inventory({ force: true })).find(c => c.name === 'Quantum RS'));
    const imgDocs = await page.evaluate(async () => (await DB.list('vehicleImages', { force: true })));
    log(upCar?.imageUrl?.startsWith('img://') && imgDocs.length === 1
        && imgDocs[0].data.startsWith('data:image/jpeg') && imgDocs[0].bytes <= 480 * 1024 ? '✅' : '❌',
        `Upload saved as ${upCar?.imageUrl} → one vehicleImages doc (${imgDocs[0]?.bytes} bytes, compressed JPEG)`);

    /* ---- 3. A car with NO image, and one with a BROKEN hotlink ---- */
    await page.evaluate(async () => {
        await DB.create('dealershipInventory', { name: 'Plain Jane', carId: 'plain-jane', emoji: '🚗', gameId: null,
            seriesIds: [], condition: 'used', price: 3000, stats: { performance: 3, durability: 5 }, notes: '', available: true, imageUrl: '' });
        await DB.create('dealershipInventory', { name: 'Broken Bolt', carId: 'broken-bolt', emoji: '🔩', gameId: null,
            seriesIds: [], condition: 'used', price: 3500, stats: { performance: 3, durability: 5 }, notes: '', available: true,
            imageUrl: 'http://localhost:8317/does-not-exist.png' });
    });

    /* ---- 4. Storefront: card grid, hydrated images, placeholder, fallback ---- */
    await page.evaluate(() => App.go('dealership'));
    await page.waitForSelector('.car-grid .car-card');
    await page.waitForFunction(() => { // img:// stub hydrated to a data URL
        const imgs = [...document.querySelectorAll('.car-card img.car-img')];
        return imgs.some(i => i.src.startsWith('data:image/'));
    });
    await page.waitForFunction(() => document.querySelectorAll('.car-card .car-img-ph').length >= 2); // no-image + broken hotlink
    const store = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.car-grid .car-card')];
        const by = (name) => cards.find(c => c.innerText.includes(name));
        const css = (el) => el ? getComputedStyle(el.querySelector('.car-img')) : null;
        const photon = css(by('Photon GT'));
        return {
            cards: cards.length,
            dividers: document.querySelectorAll('.car-card .checker-divider').length,
            photonSrc: by('Photon GT')?.querySelector('img.car-img')?.src || '',
            quantumData: by('Quantum RS')?.querySelector('img.car-img')?.src.startsWith('data:image/') || false,
            plainPh: !!by('Plain Jane')?.querySelector('.car-img-ph'),
            brokenPh: !!by('Broken Bolt')?.querySelector('.car-img-ph'),
            cover: photon?.objectFit, shadow: photon?.boxShadow
        };
    });
    log(store.cards === 4 && store.dividers === 4 ? '✅' : '❌',
        `Storefront renders a ${store.cards}-card grid, every card with a 🏁 checkered divider`);
    log(store.photonSrc.includes('Phoenix') && store.quantumData ? '✅' : '❌',
        'URL car shows its hotlinked image; uploaded car hydrated from its img:// vehicleImages doc');
    log(store.plainPh && store.brokenPh ? '✅' : '❌',
        'Imageless car AND broken-hotlink car both render the branded checkered placeholder (no broken-image glyph)');
    log(store.cover === 'cover' && (store.shadow === 'none' || !store.shadow) ? '✅' : '❌',
        `Flat 2D rules enforced by CSS: object-fit ${store.cover}, box-shadow ${store.shadow || 'none'}`);
    await shot('36-carimg-storefront');

    /* ---- 5. Purchases inherit imageUrl STRICTLY (player + team garages) ---- */
    await page.evaluate(async () => { // impersonate the seeded buyer on the shim
        Auth.state.user = { uid: 'u-rich', isAnonymous: false };
        Auth.state.mode = 'player';
        Auth.state.profile = await DB.get('users', 'u-rich', { force: true });
    });
    const quantumId = upCar.id, photonId = urlCar.id;
    await page.evaluate((id) => Dealership.buy(id), quantumId);           // personal
    await toast(/is yours/);
    await page.evaluate(({ id, teamId }) => Dealership.buy(id, teamId), { id: photonId, teamId: 't-fast' }); // team
    await toast(/Fast Co garage/);
    const owned = await page.evaluate(async () => ({
        mine: (await DB.get('users', 'u-rich', { force: true })).garage,
        team: (await DB.get('teams', 't-fast', { force: true })).garage
    }));
    log(owned.mine.length === 1 && owned.mine[0].imageUrl === upCar.imageUrl ? '✅' : '❌',
        `Player garage entry inherited the exact imageUrl (${owned.mine[0]?.imageUrl})`);
    log(owned.team.length === 1 && owned.team[0].imageUrl === LOGO ? '✅' : '❌',
        'Team garage entry inherited the exact hotlink imageUrl');

    /* ---- 6. Garage UIs render the inherited images as flat thumbnails ---- */
    await page.evaluate(async () => { // refresh profile so the garage panel sees the new car
        Auth.state.profile = await DB.get('users', 'u-rich', { force: true });
        App.go('dealership');
    });
    await page.waitForFunction(() =>
        [...document.querySelectorAll('.race-row .car-media-thumb img.car-img')].some(i => i.src.startsWith('data:image/')));
    log('✅', 'My Garage panel shows the uploaded car as a hydrated 16:9 thumbnail');
    const teamPanel = await page.evaluate(async () => {
        const team = await DB.get('teams', 't-fast', { force: true });
        document.getElementById('view-root').insertAdjacentHTML('beforeend', Garage.teamGaragePanel(team));
        await new Promise(res => setTimeout(res, 50)); // let the self-hydrator pass run
        const imgs = [...document.querySelectorAll('#view-root .car-media-thumb img.car-img')];
        return imgs.some(i => i.src.includes('Phoenix'));
    });
    log(teamPanel ? '✅' : '❌', 'Team Garage panel renders the inherited hotlink image thumbnail');
    await shot('37-carimg-garage');

    /* ---- 7. Edit form: clearing the image saves imageUrl:'' ---- */
    await page.evaluate(async () => {
        Auth.state.mode = 'admin';
        Auth.state.profile = null;
    });
    await page.evaluate((id) => Dealership.gmForm(id), photonId);
    await page.waitForSelector('#deal-form');
    log(await page.evaluate(() => document.getElementById('df-img-url').value.includes('Phoenix')) ? '✅' : '❌',
        'Edit form pre-fills the stored URL and previews it');
    await page.click('#df-img-clear');
    log(await page.evaluate(() => !!document.querySelector('#df-img-preview .car-img-ph')) ? '✅' : '❌',
        'Remove image instantly swaps the preview back to the placeholder');
    await page.click('#deal-form button[type=submit]');
    await toast(/Vehicle updated/);
    const cleared = await page.evaluate(async (id) => DB.get('dealershipInventory', id, { force: true }), photonId);
    log(cleared.imageUrl === '' ? '✅' : '❌', 'Cleared image persists as an empty imageUrl (placeholder in the showroom)');

    /* ---- 8. Unsafe strings never reach an <img src> ---- */
    const unsafe = await page.evaluate(() =>
        [CarImg.normalize('javascript:alert(1)'), CarImg.normalize('img://x'), CarImg.normalize(' https://ok.example/a.png ')]);
    log(unsafe[0] === '' && unsafe[1] === 'img://x' && unsafe[2] === 'https://ok.example/a.png' ? '✅' : '❌',
        'normalize() drops non-http(s)/non-ref strings (javascript: URLs can never render)');

    await browser.close();
    const fails = steps.filter(s => s.startsWith('❌'));
    console.log(`\n${steps.length - fails.length}/${steps.length} steps passed`);
    if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
})().catch(e => { console.error('❌ DRIVE CRASHED:', e); process.exit(1); });
