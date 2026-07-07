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
    await page.addInitScript(() => { window.confirm = () => true; window.prompt = () => 'x'; });
    page.on('pageerror', e => log('❌', 'pageerror: ' + e.message));
    const toast = async (re) => {
        await page.waitForFunction(s => new RegExp(s, 'i').test(document.getElementById('toast-holder')?.innerText || ''), re.source, { timeout: 20000 });
        await page.evaluate(() => document.querySelectorAll('#toast-holder .toast').forEach(t => t.remove()));
    };

    // Register a player.
    await page.goto('http://localhost:8317/sim-racing-career/app.html');
    await page.click('.gate-tab[data-pane="player"]');
    if (await page.locator('#gate-name-field.hidden').count()) await page.click('#gate-mode-toggle');
    await page.fill('#gate-name', 'Justin May');
    await page.fill('#gate-email', 'justin@example.com');
    await page.fill('#gate-password', 'secret1');
    await page.click('#gate-player-submit');
    await page.waitForSelector('#app-shell:not(.hidden)');
    await page.evaluate(() => Modal.close()); // difficulty picker not needed here

    // Open own profile via header name → Edit Profile.
    await page.click('#header-username');
    await page.waitForSelector('.profile-avatar');
    const nudge = await page.evaluate(() => document.getElementById('view-root').innerText);
    log(/add a bio and photo/i.test(nudge) ? '✅' : '❌', 'Own empty profile nudges toward ✎ Edit Profile');
    await page.click('button:has-text("✎ Edit Profile")');
    await page.waitForSelector('#profile-form');
    log('✅', 'Edit Profile modal opens from the profile page');

    // Change name, country, bio + upload an avatar photo.
    await page.fill('#pf-name', 'Phoenix Justin');
    await page.fill('#pf-country', 'USA');
    await page.fill('#pf-bio', 'League founder. Fear the #13.');
    // Tiny valid PNG (2x2 red) as the avatar upload.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP8z8Dwn4EIwEiMIgDw3gP+ULLtUAAAAABJRU5ErkJggg==', 'base64');
    await page.setInputFiles('#pf-avatar', { name: 'me.png', mimeType: 'image/png', buffer: png });
    await page.click('#profile-form button[type=submit]');
    await toast(/Profile saved/);
    await page.waitForSelector('.profile-avatar img');
    const after = await page.evaluate(() => ({
        page: document.getElementById('view-root').innerText,
        header: document.getElementById('header-username').textContent,
        avatar: !!document.querySelector('.driver-hero .profile-avatar img')
    }));
    log(/Phoenix Justin/.test(after.page) ? '✅' : '❌', 'Hero shows new display name');
    log(/USA/.test(after.page) ? '✅' : '❌', 'Country chip shows');
    log(/Fear the #13/.test(after.page) ? '✅' : '❌', 'Bio shows');
    log(after.avatar ? '✅' : '❌', 'Uploaded photo replaces the initials avatar');
    log(after.header === 'Phoenix Justin' ? '✅' : '❌', `Header username updated live ("${after.header}")`);
    await page.screenshot({ path: path.join(__dirname, '14-edited-profile.png') });

    // Probes.
    await page.click('button:has-text("✎ Edit Profile")');
    await page.waitForSelector('#profile-form');
    await page.fill('#pf-name', '   ');
    await page.click('#profile-form button[type=submit]');
    await toast(/required/);
    log('🔍', 'Blank display name rejected with a clear error');
    await page.click('#pf-remove-avatar');
    await page.fill('#pf-name', 'Phoenix Justin');
    await page.click('#profile-form button[type=submit]');
    await toast(/Profile saved/);
    const initialsBack = await page.evaluate(() => !document.querySelector('.driver-hero .profile-avatar img')
        && /PJ/.test(document.querySelector('.driver-hero .profile-avatar').textContent));
    log(initialsBack ? '🔍' : '❌', 'Remove photo falls back to initials (PJ)');

    // Second player must NOT see an Edit button on Justin's profile.
    await page.click('#signout-btn');
    await page.waitForSelector('#auth-gate:not(.hidden)');
    await page.click('.gate-tab[data-pane="player"]');
    if (await page.locator('#gate-name-field.hidden').count()) await page.click('#gate-mode-toggle');
    await page.fill('#gate-name', 'Rival Guy');
    await page.fill('#gate-email', 'rival@example.com');
    await page.fill('#gate-password', 'secret1');
    await page.click('#gate-player-submit');
    await page.waitForSelector('#app-shell:not(.hidden)');
    await page.evaluate(() => Modal.close());
    const justinUid = await page.evaluate(async () => (await DB.users({ force: true })).find(u => u.displayName === 'Phoenix Justin').id);
    await page.evaluate((id) => App.go('profile', id), justinUid);
    await page.waitForSelector('.profile-avatar');
    const rivalSees = await page.evaluate(() => document.getElementById('view-root').innerText);
    log(!/Edit Profile/i.test(rivalSees) ? '🔍' : '❌', "No Edit button on someone else's profile");
    // …and the API path is blocked too, not just the button.
    const guard = await page.evaluate(async (id) => { try { await Profile.editModal(id); return !document.getElementById('profile-form'); } catch { return true; } }, justinUid);
    log(guard ? '🔍' : '❌', 'Profile.editModal refuses to edit another player (non-GM)');

    console.log('\n=== STEPS ===\n' + steps.join('\n'));
    await browser.close();
    process.exit(steps.some(s => s.startsWith('❌')) ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
