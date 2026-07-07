const { chromium } = require('playwright');
const path = require('path');
const steps = [];
const log = (m, s) => { steps.push(`${m} ${s}`); console.log(m, s); };
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.route('**/*', r => r.request().url().startsWith('http://localhost:8317')
        ? r.continue() : r.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.addInitScript({ path: path.join(__dirname, 'firebase-shim.js') });
    await page.addInitScript(() => { window.confirm = () => true; window.prompt = () => 'RESET'; });
    page.on('pageerror', e => log('❌', 'pageerror: ' + e.message));
    const toast = async (re) => {
        await page.waitForFunction(s => new RegExp(s, 'i').test(document.getElementById('toast-holder')?.innerText || ''), re.source, { timeout: 20000 });
        await page.evaluate(() => document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove()));
    };

    // Register with NO display name typed -> reproduces the "Player"-ish default.
    await page.goto('http://localhost:8317/sim-racing-career/app.html');
    await page.click('.gate-tab[data-pane="player"]');
    if (await page.locator('#gate-name-field.hidden').count()) await page.click('#gate-mode-toggle');
    await page.fill('#gate-email', 'justin@example.com');
    await page.fill('#gate-password', 'secret1');
    await page.click('#gate-player-submit');
    await page.waitForSelector('#app-shell:not(.hidden)');
    // pick difficulty like a real first login (Grassroots to match the report)
    await page.waitForSelector('.modal-card .role-card');
    await page.click('.modal-card .role-card:has-text("Grassroots")');
    await toast(/starting budget/);
    await page.waitForSelector('.role-grid .role-card');
    await page.click('.role-card:has-text("Driver")');
    await toast(/now playing as/);

    // Profile: click the NAME PENCIL to edit.
    await page.click('#header-username');
    await page.waitForSelector('.profile-avatar.editable');
    const hero = await page.evaluate(() => document.querySelector('.driver-hero').innerText.replace(/\n/g, ' | '));
    log('✅', 'Hero (before): ' + hero.slice(0, 140));
    await page.click('.edit-pencil');
    await page.waitForSelector('#profile-form');
    log('✅', 'Pencil next to name opens the editor');
    await page.fill('#pf-name', 'Justin May');
    await page.fill('#pf-country', 'USA');
    await page.click('#profile-form button[type=submit]');
    await toast(/Profile saved/);
    await page.waitForSelector('.driver-hero h2:has-text("Justin May")');
    log('✅', 'Name changed via pencil: hero now "Justin May"');

    // Avatar circle also opens the editor.
    await page.click('.profile-avatar.editable');
    await page.waitForSelector('#profile-form');
    log('✅', 'Clicking the avatar circle opens the editor too');
    await page.evaluate(() => Modal.close());

    // Role chip opens the role switcher.
    await page.click('.driver-hero .chip-btn:has-text("Driver")');
    await page.waitForSelector('.modal-card .role-grid');
    log('✅', 'Role chip opens the role switcher');
    await page.evaluate(() => Modal.close());

    // Difficulty chip opens the difficulty picker (with restart warning).
    await page.click('.driver-hero .chip-btn:has-text("Grassroots")');
    await page.waitForSelector('.modal-card .role-card:has-text("Semi-Pro")');
    const warn = await page.evaluate(() => document.querySelector('.modal-card').innerText);
    log(/RESTARTS your career/i.test(warn) ? '🔍' : '❌', 'Difficulty chip opens picker WITH the restart warning');
    await page.evaluate(() => Modal.close());

    // Rival view: no pencil, chips are inert text.
    await page.click('#signout-btn');
    await page.waitForSelector('#auth-gate:not(.hidden)');
    if (await page.locator('#gate-name-field.hidden').count()) await page.click('#gate-mode-toggle');
    await page.fill('#gate-name', 'Rival');
    await page.fill('#gate-email', 'rival@example.com');
    await page.fill('#gate-password', 'secret1');
    await page.click('#gate-player-submit');
    await page.waitForSelector('#app-shell:not(.hidden)');
    await page.evaluate(() => Modal.close());
    const uid = await page.evaluate(async () => (await DB.users({ force: true })).find(u => u.displayName === 'Justin May').id);
    await page.evaluate((id) => App.go('profile', id), uid);
    await page.waitForSelector('.profile-avatar');
    const rival = await page.evaluate(() => ({
        pencil: !!document.querySelector('.edit-pencil'),
        editableAvatar: !!document.querySelector('.profile-avatar.editable'),
        chipBtns: document.querySelectorAll('.driver-hero .chip-btn').length
    }));
    log(!rival.pencil && !rival.editableAvatar && rival.chipBtns === 0 ? '🔍' : '❌',
        `Someone else's profile: no pencil, no editable avatar, no switcher chips (${JSON.stringify(rival)})`);

    await page.evaluate((id) => App.go('profile', id), uid);
    console.log('\n=== STEPS ===\n' + steps.join('\n'));
    await browser.close();
    process.exit(steps.some(s => s.startsWith('❌')) ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
