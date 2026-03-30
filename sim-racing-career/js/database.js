// Database Operations for Sim Racing Career Mode

const Database = {
    // ===== DRIVERS =====
    drivers: {
        async create(driverData) {
            try {
                const user = window.AuthService?.getCurrentUser?.() || null;
                const driver = {
                    name: driverData.name,
                    number: driverData.number || null,
                    teamId: driverData.teamId || null,
                    ownerUid: driverData.ownerUid || user?.uid || null,
                    country: driverData.country || '',
                    bio: driverData.bio || '',
                    avatar: driverData.avatar || '',
                    joinDate: new Date(),
                    isActive: true,
                    // Stats
                    stats: {
                        racesEntered: 0,
                        racesCompleted: 0,
                        wins: 0,
                        podiums: 0,
                        polePositions: 0,
                        dnf: 0, // Did Not Finish
                        totalPoints: 0,
                        averageFinish: 0,
                        bestFinish: 0,
                        worstFinish: 0
                    },
                    // Career History
                    careerHistory: [],
                    // Current Season
                    currentSeasonPoints: 0,
                    currentSeasonRaces: 0,
                    currentSeasonWins: 0,
                    // Sponsorships
                    sponsorships: [],
                    status: driverData.status || 'approved',
                    moderationNotes: driverData.moderationNotes || '',
                    createdByUid: driverData.createdByUid || user?.uid || null,
                    createdByEmail: driverData.createdByEmail || user?.email || null,
                    approvedAt: driverData.status === 'approved' ? new Date() : null,
                    approvedByUid: driverData.approvedByUid || null,
                    rejectedAt: null,
                    rejectedByUid: null
                };
                return await DatabaseHelper.addDocument('drivers', driver);
            } catch (error) {
                console.error('Error creating driver:', error);
                throw error;
            }
        },

        async getAll() {
            return await DatabaseHelper.getCollection('drivers');
        },

        async getById(driverId) {
            return await DatabaseHelper.getDocument('drivers', driverId);
        },

        async update(driverId, updates) {
            return await DatabaseHelper.updateDocument('drivers', driverId, updates);
        },

        async delete(driverId) {
            return await DatabaseHelper.deleteDocument('drivers', driverId);
        },

        async getByTeam(teamId) {
            return await DatabaseHelper.getCollection('drivers', [['teamId', '==', teamId]]);
        },

        async getPending() {
            return await DatabaseHelper.getCollection('drivers', [['status', '==', 'pending']]);
        },

        async approve(driverId, approvedByUid) {
            return await this.update(driverId, {
                status: 'approved',
                approvedAt: new Date(),
                approvedByUid: approvedByUid || null,
                rejectedAt: null,
                rejectedByUid: null
            });
        },

        async reject(driverId, rejectedByUid, moderationNotes = '') {
            return await this.update(driverId, {
                status: 'rejected',
                rejectedAt: new Date(),
                rejectedByUid: rejectedByUid || null,
                moderationNotes
            });
        },

        async updateStats(driverId, statsUpdate) {
            const driver = await this.getById(driverId);
            if (driver) {
                const newStats = { ...driver.stats, ...statsUpdate };
                await this.update(driverId, { stats: newStats });
            }
        }
    },

    // ===== TEAMS =====
    teams: {
        async create(teamData) {
            try {
                const user = window.AuthService?.getCurrentUser?.() || null;
                const team = {
                    name: teamData.name,
                    color: teamData.color || '#FF4444',
                    description: teamData.description || '',
                    logo: teamData.logo || '',
                    foundedDate: new Date(),
                    owner: teamData.owner || '',
                    ownerUid: teamData.ownerUid || user?.uid || null,
                    // Stats
                    stats: {
                        drivers: 0,
                        racesEntered: 0,
                        totalWins: 0,
                        totalPodiums: 0,
                        totalPoints: 0,
                        champyonships: 0
                    },
                    // Sponsors
                    sponsors: [],
                    // Team Members
                    members: [],
                    // Affiliations
                    partnerships: [],
                    status: teamData.status || 'approved',
                    moderationNotes: teamData.moderationNotes || '',
                    createdByUid: teamData.createdByUid || user?.uid || null,
                    createdByEmail: teamData.createdByEmail || user?.email || null,
                    approvedAt: teamData.status === 'approved' ? new Date() : null,
                    approvedByUid: teamData.approvedByUid || null,
                    rejectedAt: null,
                    rejectedByUid: null
                };
                return await DatabaseHelper.addDocument('teams', team);
            } catch (error) {
                console.error('Error creating team:', error);
                throw error;
            }
        },

        async getAll() {
            return await DatabaseHelper.getCollection('teams');
        },

        async getById(teamId) {
            return await DatabaseHelper.getDocument('teams', teamId);
        },

        async update(teamId, updates) {
            return await DatabaseHelper.updateDocument('teams', teamId, updates);
        },

        async delete(teamId) {
            return await DatabaseHelper.deleteDocument('teams', teamId);
        },

        async getPending() {
            return await DatabaseHelper.getCollection('teams', [['status', '==', 'pending']]);
        },

        async approve(teamId, approvedByUid) {
            return await this.update(teamId, {
                status: 'approved',
                approvedAt: new Date(),
                approvedByUid: approvedByUid || null,
                rejectedAt: null,
                rejectedByUid: null
            });
        },

        async reject(teamId, rejectedByUid, moderationNotes = '') {
            return await this.update(teamId, {
                status: 'rejected',
                rejectedAt: new Date(),
                rejectedByUid: rejectedByUid || null,
                moderationNotes
            });
        },

        async addSponsor(teamId, sponsorData) {
            const team = await this.getById(teamId);
            if (team) {
                const sponsors = team.sponsors || [];
                sponsors.push({
                    id: Date.now().toString(),
                    ...sponsorData
                });
                await this.update(teamId, { sponsors });
            }
        }
    },

    // ===== RACES =====
    races: {
        async create(raceData) {
            try {
                const race = {
                    name: raceData.name,
                    date: new Date(raceData.date),
                    game: raceData.game,
                    track: raceData.track || '',
                    description: raceData.description || '',
                    status: 'scheduled', // scheduled, active, completed
                    // Participants
                    participants: [],
                    // Results
                    results: [],
                    // Points system
                    pointsSystem: raceData.pointsSystem || getDefaultPointsSystem(),
                    // Broadcast
                    streamLink: raceData.streamLink || '',
                    recordedLink: raceData.recordedLink || ''
                };
                return await DatabaseHelper.addDocument('races', race);
            } catch (error) {
                console.error('Error creating race:', error);
                throw error;
            }
        },

        async getAll() {
            return await DatabaseHelper.getCollection('races');
        },

        async getById(raceId) {
            return await DatabaseHelper.getDocument('races', raceId);
        },

        async update(raceId, updates) {
            return await DatabaseHelper.updateDocument('races', raceId, updates);
        },

        async delete(raceId) {
            return await DatabaseHelper.deleteDocument('races', raceId);
        },

        async getUpcoming() {
            const now = new Date();
            const races = await this.getAll();
            return races
                .filter(r => getDateValue(r.date) > now && r.status === 'scheduled')
                .sort((a, b) => getDateValue(a.date) - getDateValue(b.date));
        },

        async getByGame(game) {
            const races = await this.getAll();
            return races.filter(r => r.game === game);
        },

        async setResults(raceId, results) {
            return await this.update(raceId, {
                results,
                status: 'completed'
            });
        },

        async processResults(raceId, rawResults, completedByUid = null) {
            const race = await this.getById(raceId);
            if (!race) {
                throw new Error('Race not found.');
            }

            if (race.status === 'completed') {
                throw new Error('Race is already completed. Use Edit Results for completed races.');
            }

            const sortedResults = await this.validateAndScoreResults(raceId, rawResults, race);

            const previousResults = Array.isArray(race.results) ? race.results : [];
            const nextVersion = Number(race.resultsVersion || 0) + 1;

            await this.update(raceId, {
                results: sortedResults,
                status: 'completed',
                completedAt: new Date(),
                completedByUid: completedByUid || null,
                resultsVersion: nextVersion,
                resultsUpdatedAt: new Date(),
                resultsUpdatedByUid: completedByUid || null,
                reopenedAt: null,
                reopenedByUid: null
            });

            await Database.integrity.logRaceAudit({
                raceId,
                action: 'submit',
                actorUid: completedByUid || null,
                previousResults,
                nextResults: sortedResults,
                resultsVersion: nextVersion
            });

            await Database.economy.applyRacePayouts(raceId, sortedResults);
            await Database.integrity.rebuildAllAggregates(completedByUid || null);
            return sortedResults;
        },

        async updateResults(raceId, rawResults, editedByUid = null) {
            const race = await this.getById(raceId);
            if (!race) {
                throw new Error('Race not found.');
            }

            if (race.status !== 'completed') {
                throw new Error('Race must be completed before results can be edited.');
            }

            const sortedResults = await this.validateAndScoreResults(raceId, rawResults, race);
            const previousResults = Array.isArray(race.results) ? race.results : [];
            const nextVersion = Number(race.resultsVersion || 0) + 1;

            await this.update(raceId, {
                results: sortedResults,
                resultsVersion: nextVersion,
                resultsUpdatedAt: new Date(),
                resultsUpdatedByUid: editedByUid || null
            });

            await Database.integrity.logRaceAudit({
                raceId,
                action: 'edit',
                actorUid: editedByUid || null,
                previousResults,
                nextResults: sortedResults,
                resultsVersion: nextVersion
            });

            await Database.economy.applyRacePayouts(raceId, sortedResults);
            await Database.integrity.rebuildAllAggregates(editedByUid || null);
            return sortedResults;
        },

        async reopenRace(raceId, reopenedByUid = null) {
            const race = await this.getById(raceId);
            if (!race) {
                throw new Error('Race not found.');
            }

            if (race.status !== 'completed') {
                throw new Error('Only completed races can be reopened.');
            }

            const previousResults = Array.isArray(race.results) ? race.results : [];
            const nextVersion = Number(race.resultsVersion || 0) + 1;

            await this.update(raceId, {
                status: 'scheduled',
                results: [],
                completedAt: null,
                completedByUid: null,
                reopenedAt: new Date(),
                reopenedByUid: reopenedByUid || null,
                resultsVersion: nextVersion,
                resultsUpdatedAt: new Date(),
                resultsUpdatedByUid: reopenedByUid || null
            });

            await Database.integrity.logRaceAudit({
                raceId,
                action: 'reopen',
                actorUid: reopenedByUid || null,
                previousResults,
                nextResults: [],
                resultsVersion: nextVersion
            });

            await Database.economy.removeRacePayouts(raceId);
            await Database.integrity.rebuildAllAggregates(reopenedByUid || null);
        },

        async validateAndScoreResults(raceId, rawResults, raceOverride = null) {
            const race = raceOverride || await this.getById(raceId);
            if (!race) {
                throw new Error('Race not found.');
            }

            if (!Array.isArray(rawResults) || rawResults.length === 0) {
                throw new Error('At least one result entry is required.');
            }

            const signups = await Database.raceSignups.getByRace(raceId);
            const signedDriverIds = new Set(signups.map((signup) => signup.driverId));

            const parsedResults = rawResults.map((entry) => ({
                driverId: entry.driverId,
                finishPosition: Number(entry.finishPosition),
                dnf: Boolean(entry.dnf)
            }));

            parsedResults.forEach((entry) => {
                if (!entry.driverId) {
                    throw new Error('Every result must include a driver.');
                }

                if (!Number.isInteger(entry.finishPosition) || entry.finishPosition < 1) {
                    throw new Error('Finish positions must be positive integers.');
                }

                if (!signedDriverIds.has(entry.driverId)) {
                    throw new Error('Results can only be submitted for signed-up drivers.');
                }
            });

            const uniquePositions = new Set(parsedResults.map((entry) => entry.finishPosition));
            if (uniquePositions.size !== parsedResults.length) {
                throw new Error('Finish positions must be unique.');
            }

            const sortedResults = parsedResults
                .sort((a, b) => a.finishPosition - b.finishPosition)
                .map((entry) => ({
                    ...entry,
                    pointsAwarded: entry.dnf ? 0 : calculateRacePoints(entry.finishPosition, race.pointsSystem)
                }));
            return sortedResults;
        },

        async addParticipant(raceId, driverId) {
            const race = await this.getById(raceId);
            if (race) {
                const participants = race.participants || [];
                if (!participants.includes(driverId)) {
                    participants.push(driverId);
                    await this.update(raceId, { participants });
                }
            }
        }
    },

    // ===== STANDINGS =====
    standings: {
        async create(standingsData) {
            try {
                const standings = {
                    season: standingsData.season || new Date().getFullYear(),
                    game: standingsData.game || 'mixed',
                    entries: standingsData.entries || [], // Array of { driverId, points, races, wins, podiums }
                    teamEntries: standingsData.teamEntries || [],
                    lastUpdated: new Date(),
                    description: standingsData.description || '',
                    rebuiltAt: standingsData.rebuiltAt || null,
                    rebuiltByUid: standingsData.rebuiltByUid || null
                };
                return await DatabaseHelper.addDocument('standings', standings);
            } catch (error) {
                console.error('Error creating standings:', error);
                throw error;
            }
        },

        async getAll() {
            return await DatabaseHelper.getCollection('standings');
        },

        async getById(standingsId) {
            return await DatabaseHelper.getDocument('standings', standingsId);
        },

        async update(standingsId, updates) {
            return await DatabaseHelper.updateDocument('standings', standingsId, updates);
        },

        async getCurrentSeasonStandings() {
            const currentYear = new Date().getFullYear();
            const standings = await this.getAll();
            return standings.find(s => s.season === currentYear) || null;
        },

        async updateDriverStanding(standingsId, driverId, points) {
            const standings = await this.getById(standingsId);
            if (standings) {
                let entry = standings.entries.find(e => e.driverId === driverId);
                if (!entry) {
                    entry = { driverId, points: 0, races: 0, wins: 0, podiums: 0 };
                    standings.entries.push(entry);
                }
                entry.points += points;
                standings.entries.sort((a, b) => b.points - a.points);
                await this.update(standingsId, { entries: standings.entries });
            }
        },

        async ensureCurrentSeasonStandings() {
            const currentYear = new Date().getFullYear();
            let standings = await this.getCurrentSeasonStandings();
            if (standings) return standings;

            const standingsId = await this.create({ season: currentYear, game: 'mixed' });
            standings = await this.getById(standingsId);
            return standings;
        },

        async applyRaceResults(race, sortedResults) {
            const standings = await this.ensureCurrentSeasonStandings();
            const entries = [...(standings.entries || [])];
            const teamEntries = [...(standings.teamEntries || [])];
            const raceTeamAggregate = new Map();

            for (const result of sortedResults) {
                let driverEntry = entries.find((entry) => entry.driverId === result.driverId);
                if (!driverEntry) {
                    driverEntry = { driverId: result.driverId, points: 0, races: 0, wins: 0, podiums: 0 };
                    entries.push(driverEntry);
                }

                driverEntry.points += Number(result.pointsAwarded || 0);
                driverEntry.races += 1;
                driverEntry.wins += result.finishPosition === 1 && !result.dnf ? 1 : 0;
                driverEntry.podiums += result.finishPosition <= 3 && !result.dnf ? 1 : 0;

                const driver = await Database.drivers.getById(result.driverId);
                if (!driver?.teamId) continue;

                if (!raceTeamAggregate.has(driver.teamId)) {
                    raceTeamAggregate.set(driver.teamId, { points: 0, wins: 0, podiums: 0 });
                }

                const aggregate = raceTeamAggregate.get(driver.teamId);
                aggregate.points += Number(result.pointsAwarded || 0);
                aggregate.wins += result.finishPosition === 1 && !result.dnf ? 1 : 0;
                aggregate.podiums += result.finishPosition <= 3 && !result.dnf ? 1 : 0;
            }

            for (const [teamId, aggregate] of raceTeamAggregate.entries()) {
                let teamEntry = teamEntries.find((entry) => entry.teamId === teamId);
                if (!teamEntry) {
                    teamEntry = { teamId, points: 0, races: 0, wins: 0, podiums: 0 };
                    teamEntries.push(teamEntry);
                }

                teamEntry.points += aggregate.points;
                teamEntry.races += 1;
                teamEntry.wins += aggregate.wins;
                teamEntry.podiums += aggregate.podiums;
            }

            entries.sort((a, b) => b.points - a.points);
            teamEntries.sort((a, b) => b.points - a.points);

            await this.update(standings.id, {
                season: standings.season,
                game: race?.game || standings.game || 'mixed',
                entries,
                teamEntries,
                lastUpdated: new Date()
            });
        }
    },

    // ===== CAREER HISTORY =====
    careerHistory: {
        async addEntry(driverId, entry) {
            try {
                const driver = await Database.drivers.getById(driverId);
                if (driver) {
                    const history = driver.careerHistory || [];
                    history.push({
                        date: new Date(),
                        ...entry
                    });
                    await Database.drivers.update(driverId, { careerHistory: history });
                }
            } catch (error) {
                console.error('Error adding career history:', error);
                throw error;
            }
        }
    },

    // ===== SPONSORSHIPS =====
    sponsorships: {
        async create(sponsorshipData) {
            try {
                const sponsorship = {
                    driverId: sponsorshipData.driverId,
                    teamId: sponsorshipData.teamId || null,
                    companyName: sponsorshipData.companyName,
                    dealAmount: sponsorshipData.dealAmount || 0,
                    startDate: new Date(sponsorshipData.startDate),
                    endDate: new Date(sponsorshipData.endDate),
                    status: 'active', // active, expired, pending, terminated
                    description: sponsorshipData.description || '',
                    logo: sponsorshipData.logo || '',
                    terms: sponsorshipData.terms || ''
                };
                return await DatabaseHelper.addDocument('sponsorships', sponsorship);
            } catch (error) {
                console.error('Error creating sponsorship:', error);
                throw error;
            }
        },

        normalizeStatus(status) {
            const allowed = new Set(['active', 'pending', 'paused', 'expired', 'terminated']);
            const normalized = String(status || 'active').toLowerCase();
            return allowed.has(normalized) ? normalized : 'active';
        },

        calculateContractPayout(contract, raceResult) {
            if (!contract || !raceResult) return 0;

            const model = contract.payoutModel || {};
            const basePerRace = Number(model.basePerRace || 0);
            const winBonus = Number(model.winBonus || 0);
            const podiumBonus = Number(model.podiumBonus || 0);
            const dnfPenalty = Number(model.dnfPenalty || 0);

            let payout = basePerRace;
            if (raceResult.dnf) {
                payout -= Math.abs(dnfPenalty);
            } else {
                if (Number(raceResult.finishPosition) === 1) {
                    payout += winBonus;
                }
                if (Number(raceResult.finishPosition) <= 3) {
                    payout += podiumBonus;
                }
            }

            return Math.max(0, Math.round(payout));
        },

        async createContract(contractData) {
            if (!contractData?.driverId) {
                throw new Error('Driver ID is required for sponsorship contracts.');
            }

            if (!contractData?.companyName) {
                throw new Error('Company name is required.');
            }

            const sponsorship = {
                driverId: contractData.driverId,
                teamId: contractData.teamId || null,
                companyName: contractData.companyName.trim(),
                status: this.normalizeStatus(contractData.status),
                description: contractData.description || '',
                terms: contractData.terms || '',
                startDate: contractData.startDate ? new Date(contractData.startDate) : null,
                endDate: contractData.endDate ? new Date(contractData.endDate) : null,
                payoutModel: {
                    basePerRace: Math.max(0, Number(contractData.basePerRace || 0)),
                    winBonus: Math.max(0, Number(contractData.winBonus || 0)),
                    podiumBonus: Math.max(0, Number(contractData.podiumBonus || 0)),
                    dnfPenalty: Math.max(0, Number(contractData.dnfPenalty || 0))
                },
                dealAmount: Math.max(0, Number(contractData.dealAmount || 0))
            };

            return await DatabaseHelper.addDocument('sponsorships', sponsorship);
        },

        async updateContract(contractId, updates = {}) {
            if (!contractId) {
                throw new Error('Contract ID is required.');
            }

            const payload = {
                ...updates
            };

            if (updates.status !== undefined) {
                payload.status = this.normalizeStatus(updates.status);
            }

            if (updates.startDate !== undefined) {
                payload.startDate = updates.startDate ? new Date(updates.startDate) : null;
            }

            if (updates.endDate !== undefined) {
                payload.endDate = updates.endDate ? new Date(updates.endDate) : null;
            }

            if (
                updates.basePerRace !== undefined ||
                updates.winBonus !== undefined ||
                updates.podiumBonus !== undefined ||
                updates.dnfPenalty !== undefined
            ) {
                const existing = await DatabaseHelper.getDocument('sponsorships', contractId);
                const currentModel = existing?.payoutModel || {};
                payload.payoutModel = {
                    basePerRace: Math.max(0, Number(updates.basePerRace ?? currentModel.basePerRace ?? 0)),
                    winBonus: Math.max(0, Number(updates.winBonus ?? currentModel.winBonus ?? 0)),
                    podiumBonus: Math.max(0, Number(updates.podiumBonus ?? currentModel.podiumBonus ?? 0)),
                    dnfPenalty: Math.max(0, Number(updates.dnfPenalty ?? currentModel.dnfPenalty ?? 0))
                };
            }

            await DatabaseHelper.updateDocument('sponsorships', contractId, payload);
        },

        async getAll() {
            const sponsorships = await DatabaseHelper.getCollection('sponsorships');
            return sponsorships.sort((a, b) => getDateValue(b.updatedAt || b.createdAt) - getDateValue(a.updatedAt || a.createdAt));
        },

        async getDriverContracts(driverId, { includeInactive = false, referenceDate = null } = {}) {
            if (!driverId) return [];

            const dateRef = referenceDate ? new Date(referenceDate) : null;
            const sponsorships = await DatabaseHelper.getCollection('sponsorships', [['driverId', '==', driverId]]);

            return sponsorships.filter((contract) => {
                const status = this.normalizeStatus(contract.status);
                if (!includeInactive && status !== 'active') {
                    return false;
                }

                if (!dateRef) return true;

                const startTime = contract.startDate ? getDateValue(contract.startDate) : Number.NEGATIVE_INFINITY;
                const endTime = contract.endDate ? getDateValue(contract.endDate) : Number.POSITIVE_INFINITY;
                const refTime = dateRef.getTime();

                return refTime >= startTime && refTime <= endTime;
            });
        },

        async getTeamContracts(teamId, { includeInactive = false } = {}) {
            if (!teamId) return [];
            const sponsorships = await DatabaseHelper.getCollection('sponsorships', [['teamId', '==', teamId]]);
            return sponsorships.filter((contract) => includeInactive || this.normalizeStatus(contract.status) === 'active');
        },

        async getDriverSponsorships(driverId) {
            return await this.getDriverContracts(driverId, { includeInactive: false });
        },

        async getTeamSponsorships(teamId) {
            return await this.getTeamContracts(teamId, { includeInactive: false });
        }
    },

    // ===== USER PROFILES =====
    users: {
        async upsertProfile(userId, profileData) {
            if (!userId) throw new Error('User ID is required');

            const existing = await DatabaseHelper.getDocument('users', userId);
            const payload = {
                displayName: profileData.displayName || '',
                email: profileData.email || '',
                primaryTeam: profileData.primaryTeam || '',
                primaryDriver: profileData.primaryDriver || '',
                updatedAt: new Date()
            };

            if (existing) {
                await DatabaseHelper.updateDocument('users', userId, payload);
                return userId;
            }

            await DatabaseHelper.batchWrite([
                {
                    type: 'set',
                    collection: 'users',
                    id: userId,
                    data: {
                        ...payload,
                        createdAt: new Date()
                    }
                }
            ]);
            return userId;
        },

        async getProfile(userId) {
            if (!userId) return null;
            return await DatabaseHelper.getDocument('users', userId);
        }
    },

    // ===== RACE SIGNUPS =====
    raceSignups: {
        async create({ raceId, driverId, userId, selectedCarId }) {
            if (!raceId || !driverId || !userId || !selectedCarId) {
                throw new Error('raceId, driverId, userId, and selectedCarId are required');
            }

            const existing = (await this.getByRace(raceId)).filter((signup) => signup.driverId === driverId);

            if (existing.length > 0) {
                return existing[0].id;
            }

            const race = await Database.races.getById(raceId);
            if (!race || race.status !== 'scheduled') {
                throw new Error('Race is not open for sign-up.');
            }

            const driver = await Database.drivers.getById(driverId);
            if (!driver) {
                throw new Error('Driver not found.');
            }

            if ((driver.status || 'approved') !== 'approved') {
                throw new Error('Driver must be approved before race sign-up.');
            }

            const car = await Database.cars.getById(selectedCarId);
            if (!car || car.isActive === false) {
                throw new Error('Selected car is not available.');
            }

            if (car.gameKey !== race.game) {
                throw new Error('Selected car is not compatible with this race game.');
            }

            const ownsCar = await Database.garage.hasCar(userId, selectedCarId);
            if (!ownsCar) {
                throw new Error('You must own the selected car to sign up.');
            }

            return await DatabaseHelper.addDocument('raceSignups', {
                raceId,
                driverId,
                userId,
                selectedCarId,
                status: 'signed-up'
            });
        },

        async remove({ raceId, driverId, userId }) {
            if (!raceId || !driverId || !userId) {
                throw new Error('raceId, driverId, and userId are required');
            }

            const signups = (await this.getByRace(raceId)).filter(
                (signup) => signup.driverId === driverId && signup.userId === userId
            );

            if (signups.length === 0) return;

            await Promise.all(signups.map((signup) =>
                DatabaseHelper.deleteDocument('raceSignups', signup.id)
            ));
        },

        async getByRace(raceId) {
            return await DatabaseHelper.getCollection('raceSignups', [['raceId', '==', raceId]]);
        },

        async isSignedUp({ raceId, driverId, userId }) {
            const signups = (await this.getByRace(raceId)).filter(
                (signup) => signup.driverId === driverId && signup.userId === userId
            );

            return signups.length > 0;
        }
    },

    // ===== GAMES =====
    games: {
        async getAll() {
            return await DatabaseHelper.getCollection('games');
        },

        async upsert(gameKey, gameData) {
            if (!gameKey) throw new Error('gameKey is required');
            const normalizedKey = gameKey.trim().toLowerCase();
            const payload = {
                key: normalizedKey,
                name: gameData.name || normalizedKey,
                isActive: gameData.isActive !== false,
                updatedAt: new Date()
            };

            await DatabaseHelper.updateDocument('games', normalizedKey, payload).catch(async () => {
                await DatabaseHelper.batchWrite([
                    {
                        type: 'set',
                        collection: 'games',
                        id: normalizedKey,
                        data: {
                            ...payload,
                            createdAt: new Date()
                        }
                    }
                ]);
            });

            return normalizedKey;
        },

        async remove(gameKey) {
            if (!gameKey) throw new Error('gameKey is required');
            await DatabaseHelper.deleteDocument('games', gameKey);
        }
    },

    // ===== CARS =====
    cars: {
        async create(carData) {
            if (!carData?.name || !carData?.gameKey) {
                throw new Error('Car name and game key are required');
            }

            return await DatabaseHelper.addDocument('cars', {
                name: carData.name,
                gameKey: carData.gameKey.trim().toLowerCase(),
                price: Number(carData.price || 0),
                isActive: carData.isActive !== false
            });
        },

        async getAll() {
            return await DatabaseHelper.getCollection('cars');
        },

        async getById(carId) {
            return await DatabaseHelper.getDocument('cars', carId);
        },

        async getByGame(gameKey) {
            return await DatabaseHelper.getCollection('cars', [['gameKey', '==', (gameKey || '').toLowerCase()]]);
        },

        async update(carId, updates) {
            return await DatabaseHelper.updateDocument('cars', carId, updates);
        },

        async remove(carId) {
            return await DatabaseHelper.deleteDocument('cars', carId);
        }
    },

    // ===== GARAGE =====
    garage: {
        buildGarageId(userId, carId) {
            return `${userId}_${carId}`;
        },

        async getByUser(userId) {
            if (!userId) return [];
            return await DatabaseHelper.getCollection('garage', [['userId', '==', userId]]);
        },

        async hasCar(userId, carId) {
            if (!userId || !carId) return false;
            const docId = this.buildGarageId(userId, carId);
            const record = await DatabaseHelper.getDocument('garage', docId);
            return Boolean(record);
        },

        async addCar(userId, carId) {
            if (!userId || !carId) {
                throw new Error('userId and carId are required');
            }

            const existing = await this.hasCar(userId, carId);
            if (existing) {
                return this.buildGarageId(userId, carId);
            }

            const docId = this.buildGarageId(userId, carId);
            await DatabaseHelper.batchWrite([
                {
                    type: 'set',
                    collection: 'garage',
                    id: docId,
                    data: {
                        userId,
                        carId,
                        acquiredAt: new Date()
                    }
                }
            ]);

            return docId;
        },

        async removeCar(userId, carId) {
            if (!userId || !carId) {
                throw new Error('userId and carId are required');
            }

            const docId = this.buildGarageId(userId, carId);
            await DatabaseHelper.deleteDocument('garage', docId);
        },

        async getCompatibleOwnedCars(userId, gameKey) {
            const [owned, cars] = await Promise.all([
                this.getByUser(userId),
                Database.cars.getByGame((gameKey || '').toLowerCase())
            ]);

            const ownedIds = new Set(owned.map((record) => record.carId));
            return cars.filter((car) => ownedIds.has(car.id) && car.isActive !== false);
        }
    },

    // ===== ECONOMY =====
    economy: {
        STARTING_BUDGET: 200000,

        getRacePayoutAmount(finishPosition, dnf) {
            if (dnf) return 2000;
            const payoutTable = {
                1: 50000,
                2: 35000,
                3: 25000,
                4: 18000,
                5: 12000
            };

            return payoutTable[finishPosition] || 7000;
        },

        async getTransactions(userId) {
            if (!userId) return [];
            const transactions = await DatabaseHelper.getCollection('walletTransactions', [['userId', '==', userId]]);
            return transactions.sort((a, b) => getDateValue(b.createdAt) - getDateValue(a.createdAt));
        },

        async getBalance(userId) {
            const transactions = await this.getTransactions(userId);
            const delta = transactions.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
            return this.STARTING_BUDGET + delta;
        },

        async addTransaction({ userId, amount, type, note, raceId = null, driverId = null }) {
            if (!userId || !Number.isFinite(Number(amount))) {
                throw new Error('userId and numeric amount are required');
            }

            return await DatabaseHelper.addDocument('walletTransactions', {
                userId,
                amount: Number(amount),
                type: type || 'manual',
                note: note || '',
                raceId,
                driverId
            });
        },

        async addManualAdjustment({ actorUid = null, userId, amount, note, driverId = null }) {
            if (!userId) {
                throw new Error('User ID is required for manual adjustments.');
            }

            const normalizedAmount = Number(amount || 0);
            if (!Number.isFinite(normalizedAmount) || normalizedAmount === 0) {
                throw new Error('Amount must be a non-zero number.');
            }

            const type = normalizedAmount > 0 ? 'manual-bonus' : 'manual-penalty';

            const transactionId = await this.addTransaction({
                userId,
                amount: normalizedAmount,
                type,
                note: note || (type === 'manual-bonus' ? 'Manual admin bonus' : 'Manual admin penalty'),
                driverId
            });

            await Database.payoutAudits.logManualAdjustment({
                actorUid,
                userId,
                amount: normalizedAmount,
                reason: note || '',
                driverId,
                transactionId,
                adjustmentType: type
            });

            return transactionId;
        },

        async upsertTransactionWithId(transactionId, data) {
            if (!transactionId) throw new Error('transactionId is required');

            await DatabaseHelper.batchWrite([
                {
                    type: 'set',
                    collection: 'walletTransactions',
                    id: transactionId,
                    data
                }
            ]);
        },

        async removeRacePayouts(raceId) {
            if (!raceId) return;

            const payouts = await DatabaseHelper.getCollection('walletTransactions', [
                ['raceId', '==', raceId]
            ]);

            const generatedTypes = new Set(['race-payout', 'sponsor-payout']);
            const raceGeneratedPayouts = payouts.filter((tx) => generatedTypes.has(tx.type));

            await Promise.all(raceGeneratedPayouts.map((tx) =>
                DatabaseHelper.deleteDocument('walletTransactions', tx.id)
            ));
        },

        async clearAllRacePayouts() {
            const [racePayouts, sponsorPayouts] = await Promise.all([
                DatabaseHelper.getCollection('walletTransactions', [['type', '==', 'race-payout']]),
                DatabaseHelper.getCollection('walletTransactions', [['type', '==', 'sponsor-payout']])
            ]);

            const payouts = [...racePayouts, ...sponsorPayouts];

            await Promise.all(payouts.map((tx) =>
                DatabaseHelper.deleteDocument('walletTransactions', tx.id)
            ));
        },

        async applyRacePayouts(raceId, sortedResults) {
            if (!raceId || !Array.isArray(sortedResults) || sortedResults.length === 0) {
                return;
            }

            await this.removeRacePayouts(raceId);

            const [race, signups] = await Promise.all([
                Database.races.getById(raceId),
                Database.raceSignups.getByRace(raceId)
            ]);
            const raceDate = race?.date ? new Date(getDateValue(race.date)) : new Date();
            const userByDriver = new Map(signups.map((signup) => [signup.driverId, signup.userId]));

            for (const result of sortedResults) {
                const userId = userByDriver.get(result.driverId);
                if (!userId) continue;

                const amount = this.getRacePayoutAmount(result.finishPosition, result.dnf);
                const transactionId = `payout_${raceId}_${userId}`;

                await this.upsertTransactionWithId(transactionId, {
                    userId,
                    amount,
                    type: 'race-payout',
                    note: `Race payout - finish P${result.finishPosition}${result.dnf ? ' (DNF)' : ''}`,
                    raceId,
                    driverId: result.driverId,
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
            }

            await this.applySponsorshipPayouts({
                raceId,
                raceDate,
                sortedResults,
                userByDriver
            });
        },

        async applySponsorshipPayouts({ raceId, raceDate, sortedResults, userByDriver }) {
            for (const result of sortedResults) {
                const userId = userByDriver.get(result.driverId);
                if (!userId) continue;

                const contracts = await Database.sponsorships.getDriverContracts(result.driverId, {
                    includeInactive: false,
                    referenceDate: raceDate
                });

                for (const contract of contracts) {
                    const amount = Database.sponsorships.calculateContractPayout(contract, result);
                    if (amount <= 0) continue;

                    const transactionId = `sponsor_${raceId}_${contract.id}_${userId}`;
                    const label = contract.companyName || 'Sponsor';
                    const finishText = result.dnf ? 'DNF' : `P${result.finishPosition}`;

                    await this.upsertTransactionWithId(transactionId, {
                        userId,
                        amount,
                        type: 'sponsor-payout',
                        note: `${label} contract payout (${finishText})`,
                        raceId,
                        driverId: result.driverId,
                        sponsorshipId: contract.id,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    });
                }
            }
        },

        async purchaseCar({ userId, carId }) {
            if (!userId || !carId) {
                throw new Error('userId and carId are required');
            }

            const car = await Database.cars.getById(carId);
            if (!car || car.isActive === false) {
                throw new Error('Car is not available for purchase.');
            }

            const alreadyOwned = await Database.garage.hasCar(userId, carId);
            if (alreadyOwned) {
                throw new Error('You already own this car.');
            }

            const balance = await this.getBalance(userId);
            const price = Number(car.price || 0);

            if (price > balance) {
                throw new Error('Insufficient balance for this purchase.');
            }

            await this.addTransaction({
                userId,
                amount: -price,
                type: 'purchase',
                note: `Purchased ${car.name}`
            });

            await Database.garage.addCar(userId, carId);

            return {
                car,
                newBalance: balance - price
            };
        }
    }
};

Database.admins = {
    async isAdmin(uid) {
        if (!uid) return false;
        const adminDoc = await DatabaseHelper.getDocument('admins', uid);
        return Boolean(adminDoc && adminDoc.isActive !== false);
    },

    async upsert(uid, data = {}) {
        if (!uid) throw new Error('Admin UID is required');
        await DatabaseHelper.updateDocument('admins', uid, {
            isActive: data.isActive !== false,
            email: data.email || '',
            displayName: data.displayName || '',
            role: data.role || 'admin',
            updatedAt: new Date()
        }).catch(async () => {
            await DatabaseHelper.batchWrite([
                {
                    type: 'set',
                    collection: 'admins',
                    id: uid,
                    data: {
                        isActive: data.isActive !== false,
                        email: data.email || '',
                        displayName: data.displayName || '',
                        role: data.role || 'admin',
                        createdAt: new Date(),
                        updatedAt: new Date()
                    }
                }
            ]);
        });
    },

    async getAll() {
        return await DatabaseHelper.getCollection('admins');
    },

    async setActive(uid, isActive) {
        if (!uid) throw new Error('Admin UID is required');
        await DatabaseHelper.updateDocument('admins', uid, {
            isActive: Boolean(isActive),
            updatedAt: new Date()
        });
    },

    async remove(uid) {
        if (!uid) throw new Error('Admin UID is required');
        await DatabaseHelper.deleteDocument('admins', uid);
    }
};

Database.integrity = {
    createDefaultDriverStats() {
        return {
            racesEntered: 0,
            racesCompleted: 0,
            wins: 0,
            podiums: 0,
            polePositions: 0,
            dnf: 0,
            totalPoints: 0,
            averageFinish: 0,
            bestFinish: 0,
            worstFinish: 0
        };
    },

    createDefaultTeamStats(driverCount = 0) {
        return {
            drivers: Number(driverCount || 0),
            racesEntered: 0,
            totalWins: 0,
            totalPodiums: 0,
            totalPoints: 0,
            champyonships: 0
        };
    },


Database.payoutAudits = {
    async logManualAdjustment({ actorUid, userId, amount, reason, driverId, transactionId, adjustmentType }) {
        return await DatabaseHelper.addDocument('payoutAudits', {
            actorUid: actorUid || null,
            userId,
            amount: Number(amount || 0),
            reason: reason || '',
            driverId: driverId || null,
            transactionId: transactionId || null,
            adjustmentType: adjustmentType || 'manual'
        });
    },

    async getAll() {
        const audits = await DatabaseHelper.getCollection('payoutAudits');
        return audits.sort((a, b) => getDateValue(b.createdAt) - getDateValue(a.createdAt));
    }
};
    async logRaceAudit({ raceId, action, actorUid, previousResults, nextResults, resultsVersion }) {
        await DatabaseHelper.addDocument('raceResultAudits', {
            raceId,
            action,
            actorUid: actorUid || null,
            previousResults: Array.isArray(previousResults) ? previousResults : [],
            nextResults: Array.isArray(nextResults) ? nextResults : [],
            resultsVersion: Number(resultsVersion || 0),
            loggedAt: new Date()
        });
    },

    async rebuildAllAggregates(actorUid = null) {
        const [drivers, teams, races] = await Promise.all([
            Database.drivers.getAll(),
            Database.teams.getAll(),
            Database.races.getAll()
        ]);

        const driversById = new Map(drivers.map((driver) => [driver.id, driver]));
        const teamDrivers = new Map();

        drivers.forEach((driver) => {
            if (!driver.teamId) return;
            if (!teamDrivers.has(driver.teamId)) {
                teamDrivers.set(driver.teamId, 0);
            }
            teamDrivers.set(driver.teamId, teamDrivers.get(driver.teamId) + 1);
        });

        const driverAgg = new Map();
        drivers.forEach((driver) => {
            driverAgg.set(driver.id, {
                id: driver.id,
                stats: this.createDefaultDriverStats(),
                totalFinish: 0,
                finishSamples: 0,
                currentSeasonPoints: 0,
                currentSeasonRaces: 0,
                currentSeasonWins: 0
            });
        });

        const teamAgg = new Map();
        teams.forEach((team) => {
            teamAgg.set(team.id, {
                id: team.id,
                stats: this.createDefaultTeamStats(teamDrivers.get(team.id) || 0)
            });
        });

        const currentYear = new Date().getFullYear();
        const standingsByDriver = new Map();
        const standingsByTeam = new Map();

        const completedRaces = races
            .filter((race) => race.status === 'completed' && Array.isArray(race.results) && race.results.length > 0)
            .sort((a, b) => getDateValue(a.date) - getDateValue(b.date));

        await Database.economy.clearAllRacePayouts();

        for (const race of completedRaces) {
            await Database.economy.applyRacePayouts(race.id, race.results);
        }

        completedRaces.forEach((race) => {
            const raceYear = getDateValue(race.date).getFullYear();
            const raceTeamSeen = new Set();

            race.results.forEach((result) => {
                const driverId = result.driverId;
                const finishPosition = Number(result.finishPosition || 0);
                const dnf = Boolean(result.dnf);
                if (!driverId || !driverAgg.has(driverId) || !Number.isInteger(finishPosition) || finishPosition < 1) {
                    return;
                }

                const pointsAwarded = dnf ? 0 : Number(result.pointsAwarded ?? calculateRacePoints(finishPosition, race.pointsSystem));
                const driverTotals = driverAgg.get(driverId);
                const driverStats = driverTotals.stats;

                driverStats.racesEntered += 1;
                driverStats.racesCompleted += dnf ? 0 : 1;
                driverStats.wins += finishPosition === 1 && !dnf ? 1 : 0;
                driverStats.podiums += finishPosition <= 3 && !dnf ? 1 : 0;
                driverStats.dnf += dnf ? 1 : 0;
                driverStats.totalPoints += pointsAwarded;
                driverStats.bestFinish = driverStats.bestFinish ? Math.min(driverStats.bestFinish, finishPosition) : finishPosition;
                driverStats.worstFinish = Math.max(driverStats.worstFinish, finishPosition);
                if (!dnf) {
                    driverTotals.totalFinish += finishPosition;
                    driverTotals.finishSamples += 1;
                }

                if (raceYear === currentYear) {
                    driverTotals.currentSeasonPoints += pointsAwarded;
                    driverTotals.currentSeasonRaces += 1;
                    driverTotals.currentSeasonWins += finishPosition === 1 && !dnf ? 1 : 0;

                    if (!standingsByDriver.has(driverId)) {
                        standingsByDriver.set(driverId, {
                            driverId,
                            points: 0,
                            races: 0,
                            wins: 0,
                            podiums: 0
                        });
                    }

                    const standing = standingsByDriver.get(driverId);
                    standing.points += pointsAwarded;
                    standing.races += 1;
                    standing.wins += finishPosition === 1 && !dnf ? 1 : 0;
                    standing.podiums += finishPosition <= 3 && !dnf ? 1 : 0;
                }

                const driver = driversById.get(driverId);
                if (!driver?.teamId || !teamAgg.has(driver.teamId)) {
                    return;
                }

                const teamTotals = teamAgg.get(driver.teamId).stats;
                teamTotals.totalPoints += pointsAwarded;
                teamTotals.totalWins += finishPosition === 1 && !dnf ? 1 : 0;
                teamTotals.totalPodiums += finishPosition <= 3 && !dnf ? 1 : 0;

                if (!raceTeamSeen.has(driver.teamId)) {
                    teamTotals.racesEntered += 1;
                    raceTeamSeen.add(driver.teamId);
                }

                if (raceYear === currentYear) {
                    if (!standingsByTeam.has(driver.teamId)) {
                        standingsByTeam.set(driver.teamId, {
                            teamId: driver.teamId,
                            points: 0,
                            races: 0,
                            wins: 0,
                            podiums: 0
                        });
                    }

                    const teamStanding = standingsByTeam.get(driver.teamId);
                    teamStanding.points += pointsAwarded;
                    teamStanding.wins += finishPosition === 1 && !dnf ? 1 : 0;
                    teamStanding.podiums += finishPosition <= 3 && !dnf ? 1 : 0;
                }
            });

            if (raceYear === currentYear) {
                raceTeamSeen.forEach((teamId) => {
                    if (!standingsByTeam.has(teamId)) {
                        standingsByTeam.set(teamId, {
                            teamId,
                            points: 0,
                            races: 0,
                            wins: 0,
                            podiums: 0
                        });
                    }
                    standingsByTeam.get(teamId).races += 1;
                });
            }
        });

        await Promise.all(Array.from(driverAgg.values()).map((entry) => {
            const stats = {
                ...entry.stats,
                averageFinish: entry.finishSamples > 0 ? Number((entry.totalFinish / entry.finishSamples).toFixed(2)) : 0
            };

            return Database.drivers.update(entry.id, {
                stats,
                currentSeasonPoints: entry.currentSeasonPoints,
                currentSeasonRaces: entry.currentSeasonRaces,
                currentSeasonWins: entry.currentSeasonWins
            });
        }));

        await Promise.all(Array.from(teamAgg.values()).map((entry) =>
            Database.teams.update(entry.id, { stats: entry.stats })
        ));

        const standingsEntries = Array.from(standingsByDriver.values()).sort((a, b) => b.points - a.points);
        const standingsTeamEntries = Array.from(standingsByTeam.values()).sort((a, b) => b.points - a.points);
        const existingStandings = await Database.standings.getCurrentSeasonStandings();

        if (existingStandings) {
            await Database.standings.update(existingStandings.id, {
                entries: standingsEntries,
                teamEntries: standingsTeamEntries,
                lastUpdated: new Date(),
                rebuiltAt: new Date(),
                rebuiltByUid: actorUid || null
            });
        } else {
            await Database.standings.create({
                season: currentYear,
                game: 'mixed',
                description: 'Auto-generated standings',
                entries: standingsEntries,
                teamEntries: standingsTeamEntries,
                rebuiltAt: new Date(),
                rebuiltByUid: actorUid || null
            });

            const created = await Database.standings.getCurrentSeasonStandings();
            if (created) {
                await Database.standings.update(created.id, {
                    entries: standingsEntries,
                    teamEntries: standingsTeamEntries,
                    lastUpdated: new Date(),
                    rebuiltAt: new Date(),
                    rebuiltByUid: actorUid || null
                });
            }
        }

        await this.logRaceAudit({
            raceId: null,
            action: 'rebuild',
            actorUid: actorUid || null,
            previousResults: [],
            nextResults: [],
            resultsVersion: 0
        });
    }
};

// ===== UTILITY FUNCTIONS =====

function getDefaultPointsSystem() {
    return {
        1: 25,  // 1st place
        2: 18,  // 2nd place
        3: 15,
        4: 12,
        5: 10,
        6: 8,
        7: 6,
        8: 4,
        9: 2,
        10: 1
    };
}

function calculateRacePoints(position, pointsSystem = null) {
    const system = pointsSystem || getDefaultPointsSystem();
    return system[position] || 0;
}

function calculateAverageFinish(races, finishes) {
    if (races === 0) return 0;
    const totalPosition = finishes.reduce((sum, f) => sum + f, 0);
    return (totalPosition / races).toFixed(2);
}

function getDateValue(value) {
    if (!value) return new Date(0);
    if (value?.toDate && typeof value.toDate === 'function') {
        return value.toDate();
    }
    return new Date(value);
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Database;
}
