/* ============================================================
   Phoenix SRMPC — Player Profile
   The complete page for a REAL player: every driver they've run,
   full race history, career stats, achievements, championships,
   teams owned & driven for, contracts, challenges, press mentions.
   AI people never get this — they only carry the hire-decision
   basics (rating, prestige, asking salary) in the driver modal.
   ============================================================ */
'use strict';

const Profile = {
    /* Every driver id this account has ever raced with — current drivers by
       ownerUid, plus ids recovered from race signups and recruitment docs so
       careers deleted by a restart still count toward the full history. */
    driverIdsFor(uid, world, signups, recruitment) {
        const ids = new Set(world.drivers.filter(d => d.ownerUid === uid).map(d => d.id));
        signups.filter(s => s.uid === uid && s.driverId).forEach(s => ids.add(s.driverId));
        recruitment.filter(r => r.driverUid === uid && r.driverId).forEach(r => ids.add(r.driverId));
        return ids;
    },

    // Sum per-driver career rows into one combined career line.
    combineRows(rows) {
        const sum = {
            starts: 0, wins: 0, podiums: 0, top5: 0, poles: 0, fastestLaps: 0,
            dnfs: 0, points: 0, finishSum: 0, finishCount: 0, bestFinish: null
        };
        for (const r of rows) {
            for (const k of ['starts', 'wins', 'podiums', 'top5', 'poles', 'fastestLaps', 'dnfs', 'points', 'finishSum', 'finishCount']) {
                sum[k] += r[k] || 0;
            }
            if (r.bestFinish != null && (sum.bestFinish === null || r.bestFinish < sum.bestFinish)) sum.bestFinish = r.bestFinish;
        }
        sum.avgFinish = sum.finishCount ? sum.finishSum / sum.finishCount : null;
        sum.winPct = sum.starts ? (sum.wins / sum.starts * 100) : 0;
        return sum;
    },

    async render(el, uid) {
        if (!Auth.isSignedIn()) {
            el.innerHTML = C.empty('🔒', 'Sign in to view player profiles', 'Profiles are for league members.');
            return;
        }
        uid = uid || Auth.uid();
        const isSelf = uid === Auth.uid();
        const isAdmin = Auth.isAdmin();

        const [user, world, contracts, claims, challenges, roleProfiles, signups, recruitment, news] = await Promise.all([
            DB.get('users', uid).catch(() => null),
            DB.loadWorld(),
            DB.contracts({ force: true }).catch(() => []),
            DB.claims({ force: true }).catch(() => []),
            DB.challenges().catch(() => []),
            DB.roleProfiles({ force: true }).catch(() => []),
            DB.signups({ force: true }).catch(() => []),
            DB.recruitment({ force: true }).catch(() => []),
            DB.news().catch(() => [])
        ]);
        if (!user) {
            el.innerHTML = C.empty('❓', 'Player not found', 'This account may have been deleted.');
            return;
        }

        const name = user.displayName || 'Player';
        const driverIds = this.driverIdsFor(uid, world, signups, recruitment);
        const allRows = Stats.driverTable(world.races, world);
        const myRows = allRows.filter(r => driverIds.has(r.driverId));
        const career = this.combineRows(myRows);

        // Full race-by-race history across every driver identity, oldest data kept.
        const history = Array.from(driverIds)
            .flatMap(id => Stats.driverHistory(id, world.races, world))
            .sort((a, b) => (b.race.date || '').localeCompare(a.race.date || ''));

        // Championships: driver titles + constructor titles for owned teams.
        const ownedTeams = world.teams.filter(t => t.ownerUid === uid);
        const ownedTeamIds = new Set(ownedTeams.map(t => t.id));
        const completedSeasons = (world.seasons || []).filter(se => se.status === 'completed');
        const driverTitles = completedSeasons.filter(se => driverIds.has(se.championDriverId));
        const teamTitles = completedSeasons.filter(se => ownedTeamIds.has(se.championTeamId));

        // Prestige from the combined career + titles.
        const stars = Prestige.starsFromScore(Prestige.driverScore(career, driverTitles.length));

        // Achievements against the combined career line.
        const earned = ACHIEVEMENTS.filter(a => a.check(career));
        if (driverTitles.length) earned.unshift(ACH_CHAMPION);

        // Challenge points.
        const ptsByChallenge = Object.fromEntries(challenges.map(c => [c.id, Number(c.points) || 1]));
        const myClaims = claims.filter(c => c.uid === uid)
            .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        const challengePoints = myClaims.filter(c => c.status === 'approved')
            .reduce((s, c) => s + (ptsByChallenge[c.challengeId] ?? 1), 0);

        // Contracts: as a driver (their driver ids) and as an owner (their signing).
        const driveContracts = contracts.filter(c => driverIds.has(c.personId))
            .sort((a, b) => (b.signedAt || '').localeCompare(a.signedAt || ''));
        const ownerContracts = contracts.filter(c => c.ownerUid === uid && !driverIds.has(c.personId))
            .sort((a, b) => (b.signedAt || '').localeCompare(a.signedAt || ''));

        // Roles this player has set up.
        const myRoleProfiles = roleProfiles.filter(p => p.uid === uid);
        const activeRole = Career.roleInfo(user.activeRole);

        // Press clippings: news lines mentioning any of their identities.
        const aliases = [name, ...world.drivers.filter(d => d.ownerUid === uid).map(d => d.name),
            ...ownedTeams.map(t => t.name)].filter(n => n && n.length > 3).map(n => n.toLowerCase());
        const mentions = news
            .filter(n => aliases.some(a => (n.message || '').toLowerCase().includes(a)))
            .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
            .slice(0, 12);

        // Points progression across every driver identity with results.
        const chartIds = myRows.map(r => r.driverId);
        const prog = chartIds.length ? Stats.pointsProgression(world.races, world, {}, chartIds) : { labels: [], series: [] };

        const joined = user.createdAt?.seconds ? new Date(user.createdAt.seconds * 1000)
            .toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : null;
        const diff = Economy.difficultyInfo(user.difficulty);
        const initials = name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
        const teamStandings = Stats.teamTable(world.races, world);

        const posOf = (h) => h.result.dnf ? 'DNF' : (h.result.position ? 'P' + h.result.position : '—');
        const contractRow = (c, showTeamSide) => `
            <div class="race-row">
                <div class="race-row-main">
                    <span class="race-title">${Util.esc(showTeamSide ? c.personName : c.teamName)}
                        <span class="chip chip-dim">${Util.esc(showTeamSide ? (c.personKind === 'driver' ? 'Driver' : staffRoleInfo(c.role).label) : 'Driver seat')}</span></span>
                    <span class="race-sub">${Economy.fmt(c.salary)}/race${Number(c.buyout) ? ` · buyout ${Economy.fmt(c.buyout)}` : ''} · ${Util.esc(String(c.seasonYear || ''))}${c.signedAt ? ` · signed ${Util.esc(Util.fmtDateShort(c.signedAt))}` : ''}${c.endedAt ? ` → ${Util.esc(Util.fmtDateShort(c.endedAt))}` : ''}</span>
                </div>
                <span class="badge ${c.status === 'active' ? 'badge-green' : 'badge-dim'}">${Util.esc(c.status)}</span>
            </div>`;

        el.innerHTML = `
        <div class="view-head">
            <div><h1>👤 Player Profile</h1><p class="muted">The complete career record — every race, team, and title since day one.</p></div>
            <div class="btn-row">
                ${isSelf || isAdmin ? `<button class="btn btn-secondary" onclick="Profile.editModal('${Util.attr(uid)}')">✎ Edit Profile</button>` : ''}
                ${isSelf ? `<button class="btn btn-ghost" onclick="App.go('career')">🏎 My Career</button>` : ''}
                ${isAdmin && !isSelf ? `<button class="btn btn-ghost" onclick="App.go('admin','players')">👥 All Players</button>` : ''}
            </div>
        </div>

        <div class="driver-hero panel">
            ${user.avatar
                ? `<div class="driver-hero-num profile-avatar"><img src="${user.avatar}" alt="${Util.esc(name)}"></div>`
                : `<div class="driver-hero-num profile-avatar">${Util.esc(initials)}</div>`}
            <div class="driver-hero-info">
                <h2>${Util.esc(name)} <span class="badge badge-blue">Player</span></h2>
                <div class="chip-row">
                    ${Prestige.chip(stars, 'Career prestige')}
                    ${activeRole ? `<span class="chip">${activeRole.icon} ${Util.esc(activeRole.label)}</span>` : ''}
                    ${user.country ? `<span class="chip chip-dim">📍 ${Util.esc(user.country)}</span>` : ''}
                    ${diff ? `<span class="chip chip-dim">${diff.icon} ${Util.esc(diff.label)}</span>` : ''}
                    ${joined ? `<span class="chip chip-dim">📅 Member since ${Util.esc(joined)}</span>` : ''}
                    ${(isSelf || isAdmin) && user.walletInitialized ? `<span class="chip wallet-chip">💵 ${Economy.fmt(user.balance)}</span>` : ''}
                    ${isAdmin ? `<span class="chip chip-dim">✉️ ${Util.esc(user.email || '—')}</span>` : ''}
                </div>
                ${user.bio ? `<p class="muted" style="margin-top:.45rem">${Util.esc(user.bio)}</p>` : (isSelf ? `<p class="muted small" style="margin-top:.45rem">Add a bio and photo with ✎ Edit Profile — make this page yours.</p>` : '')}
                ${driverTitles.length || teamTitles.length ? `<div class="chip-row" style="margin-top:.4rem">
                    ${driverTitles.map(se => `<span class="chip rating-chip" title="Drivers' champion">🏆 ${Util.esc(se.name)}</span>`).join('')}
                    ${teamTitles.map(se => `<span class="chip rating-chip" title="Constructors' champion (team owner)">🛠🏆 ${Util.esc(se.name)}</span>`).join('')}
                </div>` : ''}
            </div>
        </div>

        <div class="stat-strip">
            ${C.statChip(career.starts, 'Starts')}
            ${C.statChip(career.wins, 'Wins')}
            ${C.statChip(career.podiums, 'Podiums')}
            ${C.statChip(career.poles, 'Poles')}
            ${C.statChip(career.points, 'Career pts')}
            ${C.statChip(career.avgFinish ? career.avgFinish.toFixed(1) : '—', 'Avg finish')}
            ${C.statChip(driverTitles.length + teamTitles.length, 'Titles')}
            ${C.statChip(challengePoints, 'Challenge pts')}
        </div>

        ${prog.labels.length >= 2 ? `<section class="panel" style="margin-bottom:1.1rem">
            <div class="panel-head"><h2>📈 Career Points Progression</h2></div>
            ${C.lineChart(prog.series, prog.labels, { height: 190 })}
        </section>` : ''}

        <div class="grid-2">
            <section class="panel">
                <div class="panel-head"><h2>🏅 Achievements (${earned.length}/${ACHIEVEMENTS.length + 1})</h2></div>
                ${earned.length ? `<div class="chip-row">${earned.map(a =>
                    `<span class="chip rating-chip" title="${Util.esc(a.desc)}">${a.icon} ${Util.esc(a.label)}</span>`).join('')}</div>`
                    : '<p class="muted">No achievements yet — the first race start unlocks the first one.</p>'}
                ${myRoleProfiles.length ? `<h3 class="section-label" style="margin-top:1rem">🎭 Roles Played</h3>
                    <div class="chip-row">${myRoleProfiles.map(p => {
                        const info = Career.roleInfo(p.role);
                        return `<span class="chip" title="${Util.esc(p.bio || '')}">${info?.icon || '🎭'} ${Util.esc(info?.label || p.role)} · ${Prestige.stars(Prestige.stored(p))}</span>`;
                    }).join('')}</div>` : ''}
            </section>

            <section class="panel">
                <div class="panel-head"><h2>🏎 Driver Identities (${myRows.length ? myRows.length : world.drivers.filter(d => d.ownerUid === uid).length})</h2></div>
                ${(() => {
                    const current = world.drivers.filter(d => d.ownerUid === uid);
                    const pastIds = Array.from(driverIds).filter(id => !current.some(d => d.id === id));
                    const rowFor = (id) => myRows.find(r => r.driverId === id);
                    const line = (id, d) => {
                        const r = rowFor(id);
                        return `<div class="race-row" ${d ? `onclick="Views.showDriver('${Util.attr(id)}')"` : ''}>
                            <div class="driver-hero-num" style="font-size:1rem;min-width:2.6rem;height:2.6rem">${d?.number ? '#' + Util.esc(String(d.number)) : '🏎️'}</div>
                            <div class="race-row-main">
                                <span class="race-title">${Util.esc(d?.name || r?.driver?.name || 'Retired driver')}${d ? '' : ' <span class="badge badge-dim">retired</span>'}</span>
                                <span class="race-sub">${d ? Util.esc(world.teamsById[d.teamId]?.name || 'Free agent') : 'From a previous career'}${r ? ` · ${r.points} pts · ${r.wins}W · ${r.starts} starts` : ' · no recorded results'}</span>
                            </div>
                            ${d ? `<div class="race-row-side">${C.formPips(Stats.driverForm(id, world.races, world))}</div>` : ''}
                        </div>`;
                    };
                    const html = [...current.map(d => line(d.id, d)), ...pastIds.map(id => line(id, null))].join('');
                    return html || C.empty('🏎', 'No driver career yet', 'This player hasn’t created a driver profile.');
                })()}
            </section>

            <section class="panel">
                <div class="panel-head"><h2>🏢 Teams Owned</h2></div>
                ${ownedTeams.length ? ownedTeams.map(t => {
                    const row = teamStandings.find(x => x.teamId === t.id);
                    return `<div class="race-row" onclick="Views.showTeam('${Util.attr(t.id)}')">
                        ${C.logoBox(t)}
                        <div class="race-row-main">
                            <span class="race-title">${Util.esc(t.name)} ${Prestige.chip(Prestige.teamStars(t.id, world, teamStandings), 'Team prestige')}</span>
                            <span class="race-sub">${row ? `#${row.rank} · ${row.points} pts · ${row.wins} wins` : 'No results yet'}${t.seriesId && world.seriesById[t.seriesId] ? ` · ${Util.esc(world.seriesById[t.seriesId].name)}` : ''}</span>
                        </div>
                    </div>`;
                }).join('') : '<p class="muted">No teams currently owned.</p>'}
                ${ownerContracts.length ? `<h3 class="section-label" style="margin-top:1rem">✍️ Signings as Owner (${ownerContracts.length})</h3>
                    <div class="scroll-list">${ownerContracts.map(c => contractRow(c, true)).join('')}</div>` : ''}
            </section>

            <section class="panel">
                <div class="panel-head"><h2>📜 Driving Contracts (${driveContracts.length})</h2></div>
                ${driveContracts.length ? `<div class="scroll-list">${driveContracts.map(c => contractRow(c, false)).join('')}</div>`
                    : '<p class="muted">No driving contracts on record.</p>'}
            </section>

            <section class="panel">
                <div class="panel-head"><h2>📊 Full Race History (${history.length})</h2></div>
                ${history.length ? `<div class="scroll-list"><table class="table table-tight">
                    <thead><tr><th></th><th>Race</th><th>Series</th><th>Date</th><th class="num">Pts</th></tr></thead>
                    <tbody>${history.map(h => `
                        <tr onclick="Views.showRace('${Util.attr(h.race.id)}')">
                            <td>${C.posBadge(h.result)}</td>
                            <td>${Util.esc(h.race.name || h.race.track || 'Race')}${h.result.pole ? ' 🅿️' : ''}${h.result.fastestLap ? ' ⚡' : ''}</td>
                            <td class="muted">${Util.esc(h.series?.name || '—')}</td>
                            <td class="muted">${Util.esc(Util.fmtDateShort(h.race.date))}</td>
                            <td class="num strong">${h.points}</td>
                        </tr>`).join('')}</tbody>
                </table></div>`
                    : C.empty('🏁', 'No races yet', 'Every race this player ever runs will be recorded here — forever.')}
            </section>

            <section class="panel">
                <div class="panel-head"><h2>🎯 Challenge Record</h2>
                    <span class="chip chip-dim">${challengePoints} pts · ${myClaims.filter(c => c.status === 'approved').length} completed</span></div>
                ${myClaims.length ? `<div class="scroll-list">${myClaims.map(cl => {
                    const ch = challenges.find(c => c.id === cl.challengeId);
                    return `<div class="race-row">
                        <div class="race-row-main">
                            <span class="race-title">${Util.esc(ch?.title || 'Challenge')}</span>
                            ${cl.note ? `<span class="race-sub">${Util.esc(cl.note)}</span>` : ''}
                        </div>
                        <span class="badge ${cl.status === 'approved' ? 'badge-green' : cl.status === 'rejected' ? 'badge-red' : 'badge-amber'}">${Util.esc(cl.status)}</span>
                    </div>`;
                }).join('')}</div>` : '<p class="muted">No challenge claims yet.</p>'}
            </section>

            <section class="panel">
                <div class="panel-head"><h2>🗞 Press Clippings</h2><span class="chip chip-dim">From the league news feed</span></div>
                ${mentions.length ? mentions.map(n => `
                    <div class="race-row">
                        <div class="driver-hero-num" style="font-size:1rem;min-width:2.4rem;height:2.4rem">${n.icon || '📣'}</div>
                        <div class="race-row-main">
                            <span class="race-title">${Util.esc(n.message)}</span>
                            <span class="race-sub">${Util.esc(Util.fmtDate(n.date))}</span>
                        </div>
                    </div>`).join('')
                    : '<p class="muted">No headlines yet — win something. 📰</p>'}
            </section>
        </div>`;
    },

    /* ---------------- Edit profile (self, or GM on anyone) ---------------- */
    async editModal(uid) {
        uid = uid || Auth.uid();
        const isSelf = uid === Auth.uid();
        if (!isSelf && !Auth.isAdmin()) { Util.notify('You can only edit your own profile.', 'error'); return; }
        const user = await DB.get('users', uid);
        if (!user) { Util.notify('Player not found.', 'error'); return; }

        Modal.open(`
            ${Modal.header('✎ Edit Player Profile', isSelf ? 'How the league sees you — everywhere in the app' : `Editing ${Util.esc(user.displayName || 'player')} as Game Master`)}
            <form id="profile-form" class="form-grid">
                <label class="field"><span>Display name *</span>
                    <input id="pf-name" class="input" required maxlength="40" value="${Util.esc(user.displayName || '')}"></label>
                <label class="field"><span>Country</span>
                    <input id="pf-country" class="input" maxlength="30" placeholder="e.g. USA" value="${Util.esc(user.country || '')}"></label>
                <label class="field"><span>Bio</span>
                    <textarea id="pf-bio" class="input" rows="3" maxlength="300" placeholder="Your story in the league — rivals, wins, ambitions…">${Util.esc(user.bio || '')}</textarea></label>
                <label class="field"><span>Profile photo ${user.avatar ? '(current photo kept unless you choose a new one)' : '(optional — initials otherwise)'}</span>
                    <input id="pf-avatar" class="input" type="file" accept="image/*"></label>
                <div class="modal-actions">
                    ${user.avatar ? `<button type="button" class="btn btn-ghost" id="pf-remove-avatar">Remove photo</button>` : ''}
                    <button type="button" class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save Profile</button>
                </div>
            </form>
        `);

        let removeAvatar = false;
        Util.$('#pf-remove-avatar')?.addEventListener('click', (e) => {
            removeAvatar = true;
            e.target.textContent = 'Photo will be removed';
            e.target.disabled = true;
        });

        Util.$('#profile-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type=submit]');
            btn.disabled = true;
            try {
                const patch = {
                    displayName: Util.$('#pf-name').value.trim(),
                    country: Util.$('#pf-country').value.trim(),
                    bio: Util.$('#pf-bio').value.trim()
                };
                if (!patch.displayName) throw new Error('Display name is required.');
                const file = Util.$('#pf-avatar').files[0];
                if (file) patch.avatar = await Util.compressImage(file, 256);
                else if (removeAvatar) patch.avatar = null;

                if (isSelf) await Auth.updateProfile(patch); // refreshes the header too
                else await DB.update('users', uid, patch);
                DB.invalidate('users');
                Modal.close();
                if (isSelf) App.updateHeader();
                Util.notify('Profile saved. Looking sharp. ✨');
                App.go('profile', uid);
            } catch (err) {
                Util.notify(err.message, 'error');
                btn.disabled = false;
            }
        });
    },

    /* ---------------- Players directory (League Hub tab) ---------------- */
    async directory(el) {
        const [users, world, claims, challenges] = await Promise.all([
            DB.users({ force: true }).catch(() => []),
            DB.loadWorld(),
            DB.claims().catch(() => []),
            DB.challenges().catch(() => [])
        ]);
        if (!users.length) {
            el.innerHTML = C.empty('👥', 'No players yet', 'Share the app link — everyone who registers gets a full career profile.');
            return;
        }
        const rows = Stats.driverTable(world.races, world);
        const ptsByChallenge = Object.fromEntries(challenges.map(c => [c.id, Number(c.points) || 1]));
        const titles = Prestige._titleCounts(world, 'championDriverId');

        const cards = users.map(u => {
            const role = Career.roleInfo(u.activeRole);
            const myDrivers = world.drivers.filter(d => d.ownerUid === u.id);
            const myRows = rows.filter(r => myDrivers.some(d => d.id === r.driverId));
            const career = Profile.combineRows(myRows);
            const titleCount = myDrivers.reduce((s, d) => s + (titles[d.id] || 0), 0);
            const stars = Prestige.starsFromScore(Prestige.driverScore(career, titleCount));
            const cPts = claims.filter(c => c.uid === u.id && c.status === 'approved')
                .reduce((s, c) => s + (ptsByChallenge[c.challengeId] ?? 1), 0);
            const team = world.teams.find(t => t.ownerUid === u.id);
            return { u, role, career, stars, cPts, team, driver: myDrivers[0] || null };
        }).sort((a, b) => b.career.points - a.career.points || b.cPts - a.cPts);

        el.innerHTML = `
        <section class="panel">
            <div class="panel-head"><h2>👥 Player Directory (${users.length})</h2>
                <span class="chip chip-dim">Real people only — AI stays in the hire market</span></div>
            ${cards.map(({ u, role, career, stars, cPts, team, driver }) => `
                <div class="race-row" onclick="App.go('profile','${Util.attr(u.id)}')">
                    <div class="driver-hero-num profile-avatar" style="font-size:.95rem;min-width:2.8rem;height:2.8rem">${u.avatar
                        ? `<img src="${u.avatar}" alt="">`
                        : Util.esc((u.displayName || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())}</div>
                    <div class="race-row-main">
                        <span class="race-title">${Util.esc(u.displayName || 'Player')} ${Prestige.chip(stars)}</span>
                        <span class="race-sub">${role ? `${role.icon} ${role.label}` : 'No role yet'}${driver ? ` · 🏎 ${Util.esc(driver.name)}` : ''}${team ? ` · 🏢 ${Util.esc(team.name)}` : ''}</span>
                    </div>
                    <div class="race-row-side">
                        <span class="chip chip-dim">${career.points} pts</span>
                        <span class="chip chip-dim">${career.wins}W</span>
                        <span class="chip chip-dim">🎯 ${cPts}</span>
                        <span class="btn btn-ghost btn-sm">Profile →</span>
                    </div>
                </div>`).join('')}
        </section>`;
    }
};
window.Profile = Profile;
