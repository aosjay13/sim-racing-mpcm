/* ============================================================
   Phoenix SRMPC — Vehicle images (Dealership & Garage)
   One shared pipeline for the 2D promo shots the GM attaches to
   dealership vehicles.

   A vehicle's `imageUrl` is ONE string, in one of two forms:
     'https://…'        — a direct link the GM pasted (hotlinked)
     'img://<docId>'    — a GM file upload, stored in Firestore

   Firebase Storage is NOT provisioned on this project (the default
   bucket 404s), so file uploads are downscaled + compressed in the
   browser (canvas → JPEG, capped well under Firestore's 1MB doc
   limit) and saved as a data URL in their own `vehicleImages` doc:
     { data: 'data:image/jpeg;base64,…', w, h, bytes, uploadedBy, at }
   The vehicle doc — and every garage COPY made at purchase — only
   ever carries the tiny 'img://<id>' reference, so user/team docs
   never bloat and one image is shared by every owner of that car.
   Image docs are immutable and never deleted with the catalog entry:
   garage copies keep rendering after a GM delists or deletes the car.

   Rendering is strictly flat 2D: hairline border, fixed 16:9 crop
   (object-fit: cover), checkered placeholder — no shadows, no 3D.
   Templates are synchronous strings, so `img://` refs render as
   <img data-carimg> stubs and a self-scheduled microtask hydrates
   them right after the view lands in the DOM.
   ============================================================ */
'use strict';

const CarImg = {
    REF_PREFIX: 'img://',
    MAX_W: 1280, MAX_H: 720,        // promo shots never need more than 720p
    MAX_DATAURL: 480 * 1024,        // hard cap per upload — half the doc limit
    QUALITY_STEPS: [0.85, 0.7, 0.55, 0.4, 0.3],

    isRef(u) { return typeof u === 'string' && u.startsWith(this.REF_PREFIX); },
    isDirect(u) { return typeof u === 'string' && (/^https?:\/\/\S+$/i.test(u) || u.startsWith('data:image/')); },
    // Anything else (javascript:, relative paths, garbage) is dropped.
    normalize(u) { u = String(u || '').trim(); return this.isRef(u) || this.isDirect(u) ? u : ''; },

    /* ---------------- GM upload: file → 'img://<docId>' ---------------- */
    // One-shot: compress + persist. Forms that want to preview first (and only
    // persist on submit) call _compress themselves, then persistShot.
    async upload(file) {
        if (!file || !String(file.type).startsWith('image/')) throw new Error('Pick an image file (PNG / JPG / WebP).');
        const shot = await this._compress(file);
        return this.persistShot(shot);
    },

    // Compressed shot → immutable vehicleImages doc → 'img://<docId>'.
    async persistShot(shot) {
        if (shot.data.length > this.MAX_DATAURL) throw new Error('That image is too detailed to compress under the storage cap — paste a hosted URL instead.');
        const id = await DB.create('vehicleImages', {
            data: shot.data, w: shot.w, h: shot.h, bytes: shot.data.length,
            uploadedBy: Auth.uid() || null, at: Util.todayISO()
        });
        this._cache.set(id, shot.data); // previews shouldn't refetch what we just wrote
        return this.REF_PREFIX + id;
    },

    // Downscale to ≤1280×720, then walk JPEG quality down until under the cap.
    _compress(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                URL.revokeObjectURL(url);
                const scale = Math.min(1, this.MAX_W / img.naturalWidth, this.MAX_H / img.naturalHeight);
                const w = Math.max(1, Math.round(img.naturalWidth * scale));
                const h = Math.max(1, Math.round(img.naturalHeight * scale));
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                let data = '';
                for (const q of this.QUALITY_STEPS) {
                    data = canvas.toDataURL('image/jpeg', q);
                    if (data.length <= this.MAX_DATAURL) break;
                }
                resolve({ data, w, h });
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image.')); };
            img.src = url;
        });
    },

    /* ---------------- Resolving img:// refs ---------------- */
    _cache: new Map(),

    async resolve(ref) {
        if (this.isDirect(ref)) return ref;
        if (!this.isRef(ref)) return '';
        const id = ref.slice(this.REF_PREFIX.length);
        if (this._cache.has(id)) return this._cache.get(id);
        const doc = await DB.get('vehicleImages', id).catch(() => null);
        const data = doc?.data && String(doc.data).startsWith('data:image/') ? doc.data : '';
        this._cache.set(id, data);
        return data;
    },

    /* ---------------- Flat 2D containers (16:9, cover-cropped) ---------------- */
    // Card banner for storefront-style grids. Always renders SOMETHING:
    // missing/broken images fall back to the branded checkered placeholder.
    html(imageUrl, name = '', cls = 'car-media') {
        const u = this.normalize(imageUrl);
        if (!u) return this.placeholder(name, cls);
        // NOTE: Util.esc, not Util.attr — attr() strips URL characters; esc()
        // HTML-escapes safely inside a quoted attribute (normalize() already
        // guarantees u is http(s)/data/img:// — never javascript:).
        const img = this.isRef(u)
            ? `<img class="car-img" data-carimg="${Util.esc(u.slice(this.REF_PREFIX.length))}" alt="${Util.esc(name)}" onerror="CarImg.fail(this)">`
            : `<img class="car-img" src="${Util.esc(u)}" alt="${Util.esc(name)}" loading="lazy" referrerpolicy="no-referrer" onerror="CarImg.fail(this)">`;
        if (this.isRef(u)) this._scheduleHydrate();
        return `<div class="${cls}">${img}</div>`;
    },

    // Small square-ish row thumbnail (garage lists, admin catalog).
    thumb(imageUrl, name = '') { return this.html(imageUrl, name, 'car-media car-media-thumb'); },

    placeholder(name = '', cls = 'car-media') {
        return `<div class="${cls}"><div class="car-img car-img-ph" role="img" aria-label="${Util.esc(name || 'No vehicle photo')}">
            <span class="car-img-ph-flag">🏁</span><span class="car-img-ph-brand">PHOENIX SRMPC</span>
        </div></div>`;
    },

    // A hotlinked URL that 404s (or an img:// doc that vanished) swaps to the
    // placeholder in place — the grid never shows a broken-image glyph.
    fail(imgEl) {
        const holder = imgEl.closest('.car-media');
        if (holder) holder.outerHTML = this.placeholder(imgEl.alt || '', holder.className);
    },

    /* ---------------- Self-scheduled hydration ---------------- */
    // html() runs while a view is still a string; by the time this microtask
    // fires the innerHTML assignment is done, so every <img data-carimg> stub
    // in the document gets its data URL. Debounced to one pass per render.
    _hydrateQueued: false,
    _scheduleHydrate() {
        if (this._hydrateQueued) return;
        this._hydrateQueued = true;
        setTimeout(() => { this._hydrateQueued = false; this.hydrate(); }, 0);
    },
    async hydrate(root = document) {
        const stubs = [...root.querySelectorAll('img[data-carimg]')];
        await Promise.all(stubs.map(async (el) => {
            const id = el.getAttribute('data-carimg');
            el.removeAttribute('data-carimg');
            const src = await this.resolve(this.REF_PREFIX + id);
            if (src) el.src = src;
            else this.fail(el);
        }));
    }
};
window.CarImg = CarImg;
