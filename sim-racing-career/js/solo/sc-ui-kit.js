/* ============================================================
   Phoenix SRMPC — Solo Career: UI kit
   Escaping, formatting, toasts, modal, and small HTML
   components shared by every Solo Career screen. Reuses the
   league app's design system (css/style.css) + css/career.css.
   ============================================================ */
'use strict';

(function (root) {
    const SC = root.SC = root.SC || {};
    const K = {};

    K.esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    K.$ = (sel, rootEl) => (rootEl || document).querySelector(sel);
    K.$$ = (sel, rootEl) => Array.from((rootEl || document).querySelectorAll(sel));
    K.money = (n, opts) => SC.fmtMoney(n, opts);
    K.signed = (n) => (n > 0 ? '+' : '') + SC.fmtMoney(n);
    K.ord = (n) => { n = Number(n); if (!n) return '—'; const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
    K.plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    K.date = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
    K.pct = (v) => `${Math.round(v)}%`;

    /* ---------------- toasts ---------------- */
    K.toast = function (message, type = 'success') {
        let holder = document.getElementById('toast-holder');
        if (!holder) { holder = document.createElement('div'); holder.id = 'toast-holder'; holder.setAttribute('role', 'status'); document.body.appendChild(holder); }
        const t = document.createElement('div');
        t.className = `toast toast-${type}`;
        const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
        t.innerHTML = `<span class="toast-icon">${icon}</span><span>${K.esc(message)}</span>`;
        holder.appendChild(t);
        requestAnimationFrame(() => t.classList.add('show'));
        setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 350); }, type === 'error' ? 6500 : 3800);
    };

    /* ---------------- modal ---------------- */
    const Modal = {
        _onClose: null,
        open(html, { wide = false, onClose = null } = {}) {
            document.querySelectorAll('.modal-overlay').forEach(o => o.remove());
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.id = 'sc-modal';
            overlay.innerHTML = `<div class="modal-card ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
            overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) Modal.close(); });
            document.body.appendChild(overlay);
            document.body.style.overflow = 'hidden';
            this._onClose = onClose;
            requestAnimationFrame(() => overlay.classList.add('show'));
            const first = overlay.querySelector('[autofocus]');
            if (first) setTimeout(() => first.focus(), 60);
            return overlay;
        },
        close() {
            const overlay = document.getElementById('sc-modal');
            document.body.style.overflow = '';
            const fn = this._onClose; this._onClose = null;
            if (!overlay) return;
            overlay.id = '';
            overlay.classList.add('closing'); overlay.classList.remove('show');
            setTimeout(() => overlay.remove(), 220);
            if (fn) { try { fn(); } catch (e) { console.error(e); } }
        },
        head(title, sub = '') {
            return `<div class="modal-head"><div><h2>${K.esc(title)}</h2>${sub ? `<p class="muted">${K.esc(sub)}</p>` : ''}</div>
                <button class="icon-btn" data-close aria-label="Close">✕</button></div>`;
        },
        confirm(title, body, { ok = 'Confirm', danger = false } = {}) {
            return new Promise((resolve) => {
                let answered = false;
                Modal.open(`${Modal.head(title)}<p>${body}</p>
                    <div class="modal-actions"><button class="btn btn-ghost" data-no>Cancel</button>
                    <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes autofocus>${K.esc(ok)}</button></div>`,
                { onClose: () => { if (!answered) resolve(false); } });
                K.$('#sc-modal [data-yes]').onclick = () => { answered = true; Modal.close(); resolve(true); };
                K.$('#sc-modal [data-no]').onclick = () => { answered = true; Modal.close(); resolve(false); };
            });
        }
    };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.getElementById('sc-modal')) Modal.close(); });
    document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) Modal.close(); });
    K.Modal = Modal;

    /* ---------------- components ---------------- */
    K.panel = (title, body, { actions = '', cls = '', id = '' } = {}) => `
        <section class="panel ${cls}" ${id ? `id="${id}"` : ''}>
            ${title ? `<div class="panel-head"><h2>${title}</h2>${actions ? `<div class="btn-row">${actions}</div>` : ''}</div>` : ''}
            ${body}
        </section>`;
    K.stat = (value, label, cls = '') => `<div class="stat-chip ${cls}"><span class="stat-value">${value}</span><span class="stat-label">${K.esc(label)}</span></div>`;
    K.empty = (icon, title, body, cta = '') => `<div class="empty-state"><div class="empty-icon">${icon}</div><h3>${K.esc(title)}</h3><p>${K.esc(body)}</p>${cta}</div>`;
    K.badge = (text, cls = 'badge-dim') => `<span class="badge ${cls}">${K.esc(text)}</span>`;
    K.chip = (text, cls = '') => `<span class="chip ${cls}">${text}</span>`;
    K.flag = (nat) => `<span class="sc-flag" title="${K.esc(SC.nationName(nat))}">${SC.flag(nat)}</span>`;
    K.pos = (pos, dnf) => {
        if (dnf) return '<span class="pos pos-dnf">DNF</span>';
        const cls = pos === 1 ? 'pos-1' : pos === 2 ? 'pos-2' : pos === 3 ? 'pos-3' : '';
        return `<span class="pos ${cls}">P${pos || '—'}</span>`;
    };
    K.stars = (tier) => { const n = Math.max(1, 6 - Math.min(5, tier)); return '★'.repeat(n) + '☆'.repeat(5 - n); };
    K.tierLabel = (tier) => tier === 1 ? 'Top tier' : `Tier ${tier}`;
    // 0–100 rating bar, optional marker for a comparison value.
    K.bar = (value, { max = 100, mark = null, cls = '', label = '' } = {}) => {
        const w = Math.max(0, Math.min(100, value / max * 100));
        const m = mark != null ? `<span class="sc-bar-mark" style="left:${Math.max(0, Math.min(100, mark / max * 100))}%" title="${K.esc(label)}"></span>` : '';
        return `<div class="sc-bar ${cls}"><span class="sc-bar-fill" style="width:${w}%"></span>${m}</div>`;
    };
    K.rating = (label, value, { mark = null, markLabel = '', icon = '' } = {}) => `
        <div class="sc-rating">
            <div class="sc-rating-top"><span>${icon} ${K.esc(label)}</span><strong>${Math.round(value)}</strong></div>
            ${K.bar(value, { mark, label: markLabel })}
        </div>`;
    // One pip per race, coloured by where the car finished (same colours everywhere).
    K.resultPip = (pos, dnf, scored, title) => {
        const c = dnf ? 'dnf' : pos === 1 ? 'win' : pos <= 3 ? 'podium' : scored ? 'points' : 'out';
        return `<span class="pip pip-${c}" title="${K.esc(title)}"></span>`;
    };
    K.recentPips = (recent) => {
        if (!recent || !recent.length) return '<span class="muted small">—</span>';
        return `<span class="form-pips">${recent.map(x => K.resultPip(x.pos, x.dnf, x.pts > 0,
            `${x.y} R${x.r}: ${x.dnf ? 'DNF' : 'P' + x.pos}${x.perf != null ? ` · performance ${x.perf}/100 for the car` : ''}${x.sim ? ' (simulated)' : ''}`)).join('')}</span>`;
    };
    K.formPips = (perfs) => {
        if (!perfs || !perfs.length) return '<span class="muted small">—</span>';
        return `<span class="form-pips">${perfs.map(p => {
            const c = p >= 75 ? 'win' : p >= 60 ? 'podium' : p >= 45 ? 'points' : p >= 25 ? 'out' : 'dnf';
            return `<span class="pip pip-${c}" title="Performance ${p}"></span>`;
        }).join('')}</span>`;
    };
    K.progress = (pct, cls = '') => `<div class="progress ${cls}"><div class="progress-fill" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>`;
    K.tabs = (items, active, attr = 'data-tab') => `<div class="tab-row sc-tabs">${items.map(([id, label]) =>
        `<button class="tab ${id === active ? 'active' : ''}" ${attr}="${K.esc(id)}">${label}</button>`).join('')}</div>`;
    K.select = (id, options, value, attrs = '') => `<select id="${id}" class="input" ${attrs}>${options.map(o => {
        const [v, l] = Array.isArray(o) ? o : [o.v, o.label];
        return `<option value="${K.esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${K.esc(l)}</option>`;
    }).join('')}</select>`;
    K.moneyCls = (n) => n < 0 ? 'sc-neg' : n > 0 ? 'sc-pos' : '';

    /* ---------------- charts (inline SVG, both themes) ---------------- */
    // Line chart: series [{ name, color, values }], labels [], invert (for positions)
    K.lineChart = function (series, labels, { height = 190, invert = false, maxY = null, yLabel = '' } = {}) {
        series = series.filter(s => s.values.some(v => v != null));
        const n = labels.length;
        if (!series.length || n < 2) return '<p class="muted small sc-chart-empty">Needs at least two seasons of data.</p>';
        const W = 620, H = height, pl = 34, pr = 16, pt = 12, pb = 26;
        const vals = series.flatMap(s => s.values.filter(v => v != null));
        const top = maxY != null ? maxY : Math.max(1, ...vals);
        const bot = invert ? 1 : 0;
        const X = i => pl + i * (W - pl - pr) / (n - 1);
        const Y = v => invert ? pt + (v - 1) / Math.max(1, top - 1) * (H - pt - pb) : H - pb - (v - bot) / Math.max(1, top - bot) * (H - pt - pb);
        let grid = '';
        const steps = 4;
        for (let k = 0; k <= steps; k++) {
            const v = invert ? Math.round(1 + (top - 1) * k / steps) : Math.round(top * k / steps);
            const y = Y(v);
            grid += `<line x1="${pl}" x2="${W - pr}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--panel-border)"/>`;
            grid += `<text x="${pl - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text-faint)">${invert ? 'P' + v : v}</text>`;
        }
        const idx = n <= 8 ? labels.map((_, i) => i) : [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor(3 * n / 4), n - 1];
        const xl = idx.map(i => `<text x="${X(i).toFixed(1)}" y="${H - 7}" text-anchor="middle" font-size="10" fill="var(--text-faint)">${K.esc(labels[i])}</text>`).join('');
        const lines = series.map(s => {
            const pts = s.values.map((v, i) => v == null ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).filter(Boolean).join(' ');
            const dots = s.values.map((v, i) => v == null ? '' : `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3" fill="${s.color}"><title>${K.esc(s.name)} — ${K.esc(labels[i])}: ${invert ? 'P' + v : v}</title></circle>`).join('');
            return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>${dots}`;
        }).join('');
        const legend = series.length > 1 ? `<div class="sc-legend">${series.map(s => `<span><i style="background:${s.color}"></i>${K.esc(s.name)}</span>`).join('')}</div>` : '';
        return `<div class="sc-chart"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${K.esc(yLabel || 'chart')}">${grid}${xl}${lines}</svg>${legend}</div>`;
    };
    // Horizontal bars: [{ label, value, color }]
    K.hbars = function (rows, { fmt = (v) => v } = {}) {
        const max = Math.max(1, ...rows.map(r => Math.abs(r.value)));
        return `<div class="sc-hbars">${rows.map(r => `
            <div class="sc-hbar"><span class="sc-hbar-label">${K.esc(r.label)}</span>
                <span class="sc-hbar-track"><span class="sc-hbar-fill" style="width:${Math.abs(r.value) / max * 100}%;background:${r.color || 'var(--accent-2)'}"></span></span>
                <span class="sc-hbar-val">${fmt(r.value)}</span></div>`).join('')}</div>`;
    };

    K.download = function (blob, filename) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    };
    K.slug = (s) => String(s || 'career').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'career';

    SC.UI = K;
})(typeof window !== 'undefined' ? window : globalThis);
