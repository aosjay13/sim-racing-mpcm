// Database Operations for Sim Racing Career Mode

const Database = {
    // ===== DRIVERS =====
    drivers: {
        async create(driverData) {
            try {
                const driver = {
                    name: driverData.name,
                    number: driverData.number || null,
                    teamId: driverData.teamId || null,
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
                    sponsorships: []
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
                const team = {
                    name: teamData.name,
                    color: teamData.color || '#FF4444',
                    description: teamData.description || '',
                    logo: teamData.logo || '',
                    foundedDate: new Date(),
                    owner: teamData.owner || '',
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
                    partnerships: []
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
                .filter(r => new Date(r.date) > now && r.status === 'scheduled')
                .sort((a, b) => new Date(a.date) - new Date(b.date));
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
                    entries: [], // Array of { driverId, points, races, wins, podiums }
                    lastUpdated: new Date(),
                    description: standingsData.description || ''
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

        async getDriverSponsorships(driverId) {
            const sponsorships = await DatabaseHelper.getCollection('sponsorships', [['driverId', '==', driverId]]);
            return sponsorships.filter(s => s.status === 'active');
        },

        async getTeamSponsorships(teamId) {
            const sponsorships = await DatabaseHelper.getCollection('sponsorships', [['teamId', '==', teamId]]);
            return sponsorships.filter(s => s.status === 'active');
        }
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

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Database;
}
