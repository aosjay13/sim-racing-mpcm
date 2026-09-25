/* ============================================================
   Phoenix SRMPC — Solo Career: game & series database
   Every supported sim, its track list, and the championship
   ladders a career can climb inside it.

   Series fields
     id, name, short        identity (ids unique within the game)
     ladder, tier           ladder id (see LADDERS) and rung: 1 = top
     car / makes            what you drive in-game (makes = team badges)
     grid                   default field size (clamped to game.maxGrid)
     teamSize               [min, max] cars per team
     points                 points-system id (SC.POINTS)
     budget                 typical team budget per season (USD) — the
                            one number the whole economy scales from
     spec                   0 = identical spec cars … 1 = full
                            constructor war (how much R&D matters)
     len                    default race length: {km}|{laps}|{mins}|{stages}
     cal                    real-style calendar ('Track' or 'Track|laps');
                            or pool + rounds to draw from game tracks
     format                 'race' | 'derby' | 'mixed' (race + derby) | 'rally'
     mod / dlc / note       content hints shown in the picker
   ============================================================ */
'use strict';

(function (root) {
    const SC = root.SC = root.SC || {};

    /* ---------------- Points systems ---------------- */
    SC.POINTS = {
        f1: { label: 'Formula 1 (25-18-15…)', table: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] },
        f1fl: { label: 'Formula 1 + fastest lap', table: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], fl: 1, flTop: 10 },
        f2: { label: 'Formula 2 feature race', table: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], pole: 2, fl: 1, flTop: 10 },
        indycar: { label: 'IndyCar (50-40-35…)', table: [50, 40, 35, 32, 30, 28, 26, 24, 22, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 5, 5, 5, 5, 5, 5, 5, 5], pole: 1, led: 1, mostLed: 2 },
        nascar: { label: 'NASCAR modern (40-35-34…)', table: [40, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 1, 1, 1, 1, 1, 1] },
        nascar_classic: { label: 'NASCAR 1975–2003 (175-170-165…)', table: [175, 170, 165, 160, 155, 150, 146, 142, 138, 134, 130, 127, 124, 121, 118, 115, 112, 109, 106, 103, 100, 97, 94, 91, 88, 85, 82, 79, 76, 73, 70, 67, 64, 61, 58, 55, 52, 49, 46, 43, 40, 37, 34], led: 5, mostLed: 5 },
        gt: { label: 'GT / MotoGP style (25-20-16…)', table: [25, 20, 16, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1] },
        wec: { label: 'WEC (25-18-15… + pole)', table: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], pole: 1 },
        btcc: { label: 'BTCC (20-17-15… + FL + led)', table: [20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], fl: 1, led: 1 },
        wtcc: { label: 'WTCC (10-8-6-5-4-3-2-1)', table: [10, 8, 6, 5, 4, 3, 2, 1] },
        dtm: { label: 'DTM (25-18-15… + pole 3)', table: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], pole: 3 },
        supergt: { label: 'Super GT (20-15-11…)', table: [20, 15, 11, 8, 6, 5, 4, 3, 2, 1] },
        arca: { label: 'ARCA / short track (50-45-43…)', table: [50, 45, 43, 42, 41, 40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10] },
        karting: { label: 'Karting (25-20-17…)', table: [25, 20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1] },
        rally: { label: 'Rally (25-18-15…)', table: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] },
        wreck: { label: 'Wreckfest (10-8-6… + 1 per wreck)', table: [10, 8, 6, 5, 4, 3, 2, 1], wreck: 1 },
        linear: { label: 'Simple (10-9-8…1)', table: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] }
    };

    /* ---------------- Ladders ---------------- */
    SC.LADDERS = {
        stock: { label: 'Stock Car Ladder', icon: '🏁' },
        modified: { label: 'Modifieds', icon: '🔧' },
        dirt: { label: 'Dirt Oval Ladder', icon: '🟤' },
        sprint: { label: 'Sprint Cars', icon: '🦅' },
        formula: { label: 'Open-Wheel Ladder', icon: '🏎️' },
        gt: { label: 'GT & Sports Car Ladder', icon: '🚗' },
        endurance: { label: 'Endurance Prototypes', icon: '⏱️' },
        touring: { label: 'Touring Car Ladder', icon: '🚙' },
        kart: { label: 'Karting', icon: '🛞' },
        rally: { label: 'Rally Ladder', icon: '🌲' },
        rx: { label: 'Rallycross', icon: '🪨' },
        derby: { label: 'Banger & Derby Ladder', icon: '💥' },
        historic: { label: 'Historic Racing', icon: '🏛️' },
        custom: { label: 'Custom Ladder', icon: '⭐' }
    };

    // AI-setting scales used by the Race Weekend "set this in-game" card.
    const AI = {
        isi: { label: 'AI Strength', kind: 'range', min: 70, max: 120, def: 98, unit: '%' },
        ams2: { label: 'Opponent Skill', kind: 'range', min: 70, max: 120, def: 95, unit: '' , extra: 'Opponent Aggression ≈ 50–70' },
        ac: { label: 'AI Level', kind: 'range', min: 70, max: 100, def: 92, unit: '%', extra: 'AI Aggression ≈ 30–50%' },
        acc: { label: 'AI Strength', kind: 'range', min: 80, max: 100, def: 92, unit: '', extra: 'AI Aggression ≈ 40–60' },
        rre: { label: 'AI Difficulty', kind: 'range', min: 80, max: 120, def: 100, unit: '%' },
        pc: { label: 'Opponent Skill', kind: 'range', min: 0, max: 120, def: 85, unit: '', extra: 'Opponent Aggression ≈ 40–60' },
        pc1: { label: 'Opponent Skill', kind: 'range', min: 0, max: 100, def: 80, unit: '', extra: 'Opponent Aggression ≈ 40–60' },
        f1: { label: 'AI Difficulty', kind: 'range', min: 0, max: 110, def: 80, unit: '' },
        nr2003: { label: 'Opponent Strength', kind: 'range', min: 80, max: 110, def: 97, unit: '%', extra: 'Aggression ≈ 90–100%' },
        iracing: { label: 'AI Skill', kind: 'range', min: 0, max: 125, def: 70, unit: '' },
        nascar: { label: 'AI Strength', kind: 'range', min: 0, max: 100, def: 75, unit: '' },
        wreck: { label: 'AI Difficulty', kind: 'steps', steps: ['Novice', 'Amateur', 'Expert'], def: 'Amateur' },
        gt7: { label: 'Difficulty', kind: 'steps', steps: ['Beginner', 'Intermediate', 'Professional'], def: 'Intermediate', extra: 'Boost: Off' },
        forza: { label: 'Drivatar Difficulty', kind: 'range', min: 1, max: 8, def: 5, unit: '' },
        beamng: { label: 'AI Risk / Aggression', kind: 'range', min: 0, max: 100, def: 60, unit: '' },
        rally: { label: 'AI Difficulty', kind: 'range', min: 0, max: 100, def: 70, unit: '' },
        generic: { label: 'AI Difficulty', kind: 'range', min: 0, max: 100, def: 75, unit: '' }
    };
    SC.AI_SCALES = AI;

    // Results-file formats the importer understands (sc-import.js).
    SC.RESULT_FORMATS = {
        'isi-xml': 'rFactor-family XML results (UserData/Log/Results/*.xml)',
        'isi-txt': 'GTR2 / RACE 07 results (UserData/Log/Results/*.txt)',
        'nr2003': 'NR2003 exported results (exports_imports/*.html)',
        'iracing-csv': 'iRacing results CSV (session results → export)',
        'ac-json': 'Assetto Corsa race_out.json (Documents/Assetto Corsa/out)',
        'acc-json': 'ACC server results JSON (results/*.json)',
        'csv': 'Any CSV/TSV with Position + Driver columns',
        'paste': 'Paste the finishing order, one driver per line'
    };

    const G = [];
    const game = (g) => { G.push(g); return g; };

    /* ============================================================
       NASCAR Racing 2003 Season
       ============================================================ */
    game({
        id: 'nr2003', name: 'NASCAR Racing 2003 Season', short: 'NR2003', dev: 'Papyrus', year: 2003, era: 2003,
        platform: 'PC', color: '#c8102e', icon: '🏁', ai: AI.nr2003, maxGrid: 43,
        formats: ['nr2003', 'csv', 'paste'],
        blurb: 'The Papyrus classic. The base game runs the Cup cars; the community mods (Late Models, ARCA, Trucks, Busch) turn it into a full stock-car ladder.',
        tracks: ['Atlanta Motor Speedway', 'Bristol Motor Speedway', 'California Speedway', "Lowe's Motor Speedway", 'Chicagoland Speedway',
            'Darlington Raceway', 'Daytona International Speedway', 'Dover International Speedway', 'Homestead-Miami Speedway',
            'Indianapolis Motor Speedway', 'Kansas Speedway', 'Las Vegas Motor Speedway', 'Martinsville Speedway',
            'Michigan International Speedway', 'New Hampshire International Speedway', 'North Carolina Speedway (Rockingham)',
            'Phoenix International Raceway', 'Pocono Raceway', 'Richmond International Raceway', 'Talladega Superspeedway',
            'Texas Motor Speedway', 'Infineon Raceway (Sears Point)', 'Watkins Glen',
            // popular add-on tracks
            'Iowa Speedway', 'Milwaukee Mile', 'Nashville Superspeedway', 'Gateway International Raceway', 'Memphis Motorsports Park',
            'Kentucky Speedway', 'Nashville Fairgrounds Speedway', 'South Boston Speedway', 'Hickory Motor Speedway',
            'Myrtle Beach Speedway', 'Irwindale Speedway', 'Lucas Oil Indianapolis Raceway Park', 'Toledo Speedway',
            'Salem Speedway', 'Berlin Raceway', 'Five Flags Speedway', 'Bowman Gray Stadium', 'North Wilkesboro Speedway',
            'Mesa Marin Raceway', 'Pikes Peak International Raceway', 'Langley Speedway', 'Stafford Motor Speedway',
            'Thompson Speedway', 'Oxford Plains Speedway', 'New Smyrna Speedway', 'Concord Speedway', 'Lanier National Speedway',
            'DuQuoin State Fairgrounds', 'Illinois State Fairgrounds (Springfield)'],
        series: [
            { id: 'lms', name: 'Late Model Stock Tour', short: 'LMS', ladder: 'stock', tier: 5, car: 'Late Model Stock', makes: ['Chevrolet', 'Ford', 'Dodge', 'Pontiac'],
                grid: 26, teamSize: [1, 2], points: 'arca', budget: 180000, spec: 0.45, len: { laps: 150 }, mod: 'Needs a Late Model Stock mod + short-track add-ons',
                cal: ['South Boston Speedway|200', 'Hickory Motor Speedway|200', 'Myrtle Beach Speedway|150', 'Langley Speedway|150', 'Bowman Gray Stadium|200',
                    'Nashville Fairgrounds Speedway|150', 'Concord Speedway|150', 'Five Flags Speedway|150', 'Lanier National Speedway|150',
                    'New Smyrna Speedway|150', 'Stafford Motor Speedway|150', 'Thompson Speedway|125', 'Martinsville Speedway|200', 'South Boston Speedway|200'] },
            { id: 'modified', name: 'Whelen Modified Tour', short: 'WMT', ladder: 'modified', tier: 3, car: 'Tour-type Modified', makes: ['Chevrolet', 'Ford', 'Pontiac'],
                grid: 30, teamSize: [1, 2], points: 'arca', budget: 450000, spec: 0.4, len: { laps: 150 }, mod: 'Needs a Modified mod',
                cal: ['Stafford Motor Speedway|150', 'Thompson Speedway|150', 'Martinsville Speedway|200', 'New Hampshire International Speedway|100',
                    'Oxford Plains Speedway|150', 'Bristol Motor Speedway|150', 'Richmond International Raceway|150', 'Myrtle Beach Speedway|150',
                    'Stafford Motor Speedway|150', 'Thompson Speedway|200', 'New Hampshire International Speedway|100', 'Martinsville Speedway|200'] },
            { id: 'arca', name: 'ARCA RE/MAX Series', short: 'ARCA', ladder: 'stock', tier: 4, car: 'ARCA stock car', makes: ['Chevrolet', 'Ford', 'Dodge', 'Pontiac'],
                grid: 34, teamSize: [1, 3], points: 'arca', budget: 1200000, spec: 0.55, len: { km: 240 }, mod: 'Needs an ARCA mod (+ add-on tracks)',
                cal: ['Daytona International Speedway|80', 'Nashville Superspeedway|150', 'Salem Speedway|200', 'Kentucky Speedway|100', 'Pocono Raceway|80',
                    'Talladega Superspeedway|80', 'Toledo Speedway|200', 'Michigan International Speedway|100', 'Milwaukee Mile|125',
                    'Berlin Raceway|200', 'Lucas Oil Indianapolis Raceway Park|200', 'Illinois State Fairgrounds (Springfield)|100',
                    'Gateway International Raceway|100', 'DuQuoin State Fairgrounds|100', 'Chicagoland Speedway|100', 'Iowa Speedway|200',
                    'Kansas Speedway|100', "Lowe's Motor Speedway|100"] },
            { id: 'cts', name: 'Craftsman Truck Series', short: 'Trucks', ladder: 'stock', tier: 3, car: 'Craftsman Truck', makes: ['Chevrolet', 'Ford', 'Dodge', 'Toyota'],
                grid: 36, teamSize: [1, 3], points: 'nascar_classic', budget: 4000000, spec: 0.6, len: { km: 320 }, mod: 'Needs a Truck mod',
                cal: ['Daytona International Speedway|100', 'Atlanta Motor Speedway|130', 'Martinsville Speedway|250', 'Kansas Speedway|167', 'Texas Motor Speedway|167',
                    'Mesa Marin Raceway|200', 'Memphis Motorsports Park|200', 'Milwaukee Mile|200', 'Kentucky Speedway|150', 'Gateway International Raceway|160',
                    'Lucas Oil Indianapolis Raceway Park|200', 'Nashville Superspeedway|150', 'Richmond International Raceway|200', 'New Hampshire International Speedway|200',
                    'Bristol Motor Speedway|200', 'Chicagoland Speedway|150', 'Las Vegas Motor Speedway|134', 'Dover International Speedway|200',
                    'Texas Motor Speedway|167', 'Martinsville Speedway|250', 'Phoenix International Raceway|150', 'Homestead-Miami Speedway|134'] },
            { id: 'busch', name: 'Busch Grand National Series', short: 'Busch', ladder: 'stock', tier: 2, car: 'Busch Series car', makes: ['Chevrolet', 'Ford', 'Dodge', 'Pontiac'],
                grid: 43, teamSize: [1, 3], points: 'nascar_classic', budget: 9000000, spec: 0.65, len: { km: 480 }, mod: 'Needs a Busch Series mod',
                cal: ['Daytona International Speedway|120', 'North Carolina Speedway (Rockingham)|197', 'Las Vegas Motor Speedway|200', 'Darlington Raceway|147',
                    'Bristol Motor Speedway|250', 'Texas Motor Speedway|200', 'Nashville Superspeedway|225', 'Talladega Superspeedway|117', 'California Speedway|150',
                    'Richmond International Raceway|250', "Lowe's Motor Speedway|200", 'Dover International Speedway|200', 'Nashville Superspeedway|225',
                    'Kentucky Speedway|200', 'Milwaukee Mile|250', 'Daytona International Speedway|100', 'Chicagoland Speedway|200', 'Gateway International Raceway|200',
                    'Pikes Peak International Raceway|250', 'Lucas Oil Indianapolis Raceway Park|200', 'Michigan International Speedway|125', 'Bristol Motor Speedway|250',
                    'Richmond International Raceway|250', 'Dover International Speedway|200', 'Kansas Speedway|200', "Lowe's Motor Speedway|200",
                    'Memphis Motorsports Park|250', 'Atlanta Motor Speedway|195', 'Phoenix International Raceway|200', 'Homestead-Miami Speedway|200'] },
            { id: 'cup', name: 'Winston Cup Series', short: 'Cup', ladder: 'stock', tier: 1, car: 'Cup car (base game)', makes: ['Chevrolet', 'Dodge', 'Ford', 'Pontiac'],
                grid: 43, teamSize: [1, 4], points: 'nascar_classic', budget: 22000000, spec: 0.7, len: { km: 640 },
                cal: ['Daytona International Speedway|200', 'North Carolina Speedway (Rockingham)|393', 'Las Vegas Motor Speedway|267', 'Atlanta Motor Speedway|325',
                    'Darlington Raceway|293', 'Bristol Motor Speedway|500', 'Texas Motor Speedway|334', 'Talladega Superspeedway|188', 'Martinsville Speedway|500',
                    'California Speedway|250', 'Richmond International Raceway|400', "Lowe's Motor Speedway|400", 'Dover International Speedway|400',
                    'Pocono Raceway|200', 'Michigan International Speedway|200', 'Infineon Raceway (Sears Point)|110', 'Daytona International Speedway|160',
                    'Chicagoland Speedway|267', 'New Hampshire International Speedway|300', 'Pocono Raceway|200', 'Indianapolis Motor Speedway|160',
                    'Watkins Glen|90', 'Michigan International Speedway|200', 'Bristol Motor Speedway|500', 'Darlington Raceway|367',
                    'Richmond International Raceway|400', 'New Hampshire International Speedway|300', 'Dover International Speedway|400',
                    'Talladega Superspeedway|188', 'Kansas Speedway|267', "Lowe's Motor Speedway|334", 'Martinsville Speedway|500',
                    'Atlanta Motor Speedway|325', 'Phoenix International Raceway|312', 'North Carolina Speedway (Rockingham)|393', 'Homestead-Miami Speedway|267'] }
        ]
    });

    /* ============================================================
       iRacing
       ============================================================ */
    game({
        id: 'iracing', name: 'iRacing', short: 'iRacing', dev: 'iRacing.com', year: 2008, era: 2026,
        platform: 'PC', color: '#0090d4', icon: '🌐', ai: AI.iracing, maxGrid: 60,
        formats: ['iracing-csv', 'csv', 'paste'],
        blurb: 'Every iRacing ladder in one place — oval, road, formula and dirt. Run the rounds as AI races (or join the official series) and log your finish.',
        tracks: ['Daytona International Speedway', 'Talladega Superspeedway', 'EchoPark Speedway (Atlanta)', 'Charlotte Motor Speedway', 'Texas Motor Speedway',
            'Las Vegas Motor Speedway', 'Kansas Speedway', 'Homestead-Miami Speedway', 'Chicagoland Speedway', 'Michigan International Speedway',
            'Pocono Raceway', 'Indianapolis Motor Speedway', 'Auto Club Speedway', 'Phoenix Raceway', 'Darlington Raceway', 'Dover Motor Speedway',
            'Bristol Motor Speedway', 'Martinsville Speedway', 'Richmond Raceway', 'New Hampshire Motor Speedway', 'Iowa Speedway',
            'World Wide Technology Raceway (Gateway)', 'Nashville Superspeedway', 'Nashville Fairgrounds Speedway', 'Kentucky Speedway',
            'Milwaukee Mile', 'Rockingham Speedway', 'North Wilkesboro Speedway', 'Irwindale Speedway', 'South Boston Speedway',
            'Langley Speedway', 'Lanier National Speedway', 'Oxford Plains Speedway', 'Thompson Speedway', 'Stafford Motor Speedway',
            'New Smyrna Speedway', 'Lucas Oil Indianapolis Raceway Park', 'Hickory Motor Speedway', 'Five Flags Speedway', 'Concord Speedway',
            'Kern County Raceway Park', 'Charlotte Roval', 'Daytona Road Course', 'Indianapolis Road Course', 'Chicago Street Course',
            'Watkins Glen', 'Road America', 'Road Atlanta', 'Laguna Seca', 'Sebring', 'Lime Rock Park', 'Mid-Ohio', 'Virginia International Raceway',
            'Summit Point', 'Barber Motorsports Park', 'Sonoma Raceway', 'Portland International Raceway', 'Circuit of the Americas', 'Long Beach', 'Detroit Street Circuit',
            'Canadian Tire Motorsport Park', 'Circuit Gilles Villeneuve', 'Spa-Francorchamps', 'Monza', 'Silverstone', 'Brands Hatch',
            'Donington Park', 'Oulton Park', 'Snetterton', 'Imola', 'Mugello', 'Misano', 'Red Bull Ring', 'Hockenheim', 'Nürburgring GP',
            'Nürburgring Nordschleife', 'Zandvoort', 'Barcelona-Catalunya', 'Suzuka', 'Fuji Speedway', 'Okayama', 'Tsukuba', 'Twin Ring Motegi',
            'Mount Panorama (Bathurst)', 'Phillip Island', 'Interlagos', 'Hungaroring', 'Portimão', 'Navarra', 'Jerez', 'Zolder', 'Circuit de la Sarthe (Le Mans)',
            'Eldora Speedway', 'Knoxville Raceway', 'Williams Grove Speedway', 'Volusia Speedway Park', 'Lincoln Speedway', 'Port Royal Speedway',
            'Weedsport Speedway', 'Cedar Lake Speedway', 'Fairbury Speedway', 'Kokomo Speedway', 'Limaland Motorsports Park', 'USA International Speedway',
            'Federated Auto Parts Raceway at I-55', 'Charlotte Dirt Track', 'Bristol Dirt', 'Atomic Speedway', 'Tulsa Expo Raceway (Chili Bowl)', "Huset's Speedway"],
        series: [
            // Oval ladder
            { id: 'streetstock', name: 'Rookie Street Stock Series', short: 'Street Stock', ladder: 'stock', tier: 7, car: 'Street Stock', grid: 22, teamSize: [1, 2],
                points: 'arca', budget: 45000, spec: 0.2, len: { laps: 50 }, pool: ['so'], rounds: 10 },
            { id: 'latemodel', name: 'Late Model Stock Tour', short: 'LMS', ladder: 'stock', tier: 6, car: 'Chevrolet Late Model Stock', grid: 26, teamSize: [1, 2],
                points: 'arca', budget: 180000, spec: 0.3, len: { laps: 100 }, pool: ['so'], rounds: 12 },
            { id: 'slm', name: 'Super Late Model Series', short: 'SLM', ladder: 'stock', tier: 5, car: 'Super Late Model', grid: 28, teamSize: [1, 2],
                points: 'arca', budget: 380000, spec: 0.35, len: { laps: 125 }, pool: ['so'], rounds: 12 },
            { id: 'arca', name: 'ARCA Menards Series', short: 'ARCA', ladder: 'stock', tier: 4, car: 'ARCA Menards car', makes: ['Chevrolet', 'Ford', 'Toyota'],
                grid: 30, teamSize: [1, 3], points: 'nascar', budget: 1300000, spec: 0.45, len: { km: 240 },
                cal: ['Daytona International Speedway|80', 'Phoenix Raceway|150', 'Talladega Superspeedway|76', 'Kansas Speedway|100', 'Charlotte Motor Speedway|80',
                    'Michigan International Speedway|100', 'Iowa Speedway|150', 'Pocono Raceway|80', 'Milwaukee Mile|100', 'Watkins Glen|30', 'Dover Motor Speedway|150',
                    'Lucas Oil Indianapolis Raceway Park|200', 'Bristol Motor Speedway|200', 'Kansas Speedway|100'] },
            { id: 'trucks', name: 'NASCAR Craftsman Truck Series', short: 'Trucks', ladder: 'stock', tier: 3, car: 'NASCAR Truck', makes: ['Chevrolet', 'Ford', 'Toyota'],
                grid: 36, teamSize: [1, 3], points: 'nascar', budget: 5000000, spec: 0.5, len: { km: 320 },
                cal: ['Daytona International Speedway|100', 'EchoPark Speedway (Atlanta)|135', 'Las Vegas Motor Speedway|134', 'Homestead-Miami Speedway|134',
                    'Martinsville Speedway|200', 'Bristol Motor Speedway|250', 'Texas Motor Speedway|167', 'Kansas Speedway|134', 'North Wilkesboro Speedway|250',
                    'Charlotte Motor Speedway|134', 'Nashville Superspeedway|150', 'Michigan International Speedway|100', 'Pocono Raceway|60',
                    'Lucas Oil Indianapolis Raceway Park|200', 'Richmond Raceway|250', 'Milwaukee Mile|200', 'Darlington Raceway|147', 'Bristol Motor Speedway|200',
                    'World Wide Technology Raceway (Gateway)|160', 'Talladega Superspeedway|94', 'Charlotte Roval|67', 'Martinsville Speedway|200', 'Phoenix Raceway|150'] },
            { id: 'xfinity', name: "NASCAR O'Reilly Auto Parts Series", short: 'OAP', ladder: 'stock', tier: 2, car: 'NASCAR Xfinity/OAP car', makes: ['Chevrolet', 'Ford', 'Toyota'],
                grid: 38, teamSize: [1, 3], points: 'nascar', budget: 10000000, spec: 0.55, len: { km: 480 },
                cal: ['Daytona International Speedway|120', 'EchoPark Speedway (Atlanta)|163', 'Circuit of the Americas|46', 'Phoenix Raceway|200', 'Las Vegas Motor Speedway|200',
                    'Homestead-Miami Speedway|200', 'Martinsville Speedway|250', 'Darlington Raceway|147', 'Bristol Motor Speedway|300', 'Talladega Superspeedway|113',
                    'Texas Motor Speedway|200', 'Charlotte Motor Speedway|200', 'Nashville Superspeedway|188', 'Pocono Raceway|90', 'Chicago Street Course|50',
                    'Sonoma Raceway|79', 'Dover Motor Speedway|200', 'Indianapolis Motor Speedway|100', 'Iowa Speedway|250', 'Watkins Glen|82', 'Daytona International Speedway|100',
                    'Darlington Raceway|147', 'Bristol Motor Speedway|300', 'Kansas Speedway|200', 'Charlotte Roval|67', 'Las Vegas Motor Speedway|200',
                    'Talladega Superspeedway|113', 'Martinsville Speedway|250', 'Phoenix Raceway|200'] },
            { id: 'cup', name: 'NASCAR Cup Series', short: 'Cup', ladder: 'stock', tier: 1, car: 'Next Gen Cup car', makes: ['Chevrolet', 'Ford', 'Toyota'],
                grid: 40, teamSize: [1, 4], points: 'nascar', budget: 25000000, spec: 0.6, len: { km: 640 },
                cal: ['Daytona International Speedway|200', 'EchoPark Speedway (Atlanta)|260', 'Circuit of the Americas|95', 'Phoenix Raceway|312', 'Las Vegas Motor Speedway|267',
                    'Homestead-Miami Speedway|267', 'Martinsville Speedway|400', 'Darlington Raceway|293', 'Bristol Motor Speedway|500', 'Talladega Superspeedway|188',
                    'Texas Motor Speedway|267', 'Kansas Speedway|267', 'Charlotte Motor Speedway|400', 'Nashville Superspeedway|300', 'Michigan International Speedway|200',
                    'Pocono Raceway|160', 'EchoPark Speedway (Atlanta)|260', 'Chicago Street Course|75', 'Sonoma Raceway|110', 'Dover Motor Speedway|400',
                    'Indianapolis Motor Speedway|160', 'Iowa Speedway|350', 'Watkins Glen|90', 'Richmond Raceway|400', 'Daytona International Speedway|160',
                    'Darlington Raceway|367', 'World Wide Technology Raceway (Gateway)|240', 'Bristol Motor Speedway|500', 'New Hampshire Motor Speedway|301',
                    'Kansas Speedway|267', 'Charlotte Roval|109', 'Las Vegas Motor Speedway|267', 'Talladega Superspeedway|188', 'Martinsville Speedway|500',
                    'Phoenix Raceway|312'] },
            // Road — sports cars
            { id: 'mx5', name: 'Global Mazda MX-5 Cup', short: 'MX-5 Cup', ladder: 'gt', tier: 6, car: 'Global Mazda MX-5 Cup', grid: 24, teamSize: [1, 2],
                points: 'gt', budget: 90000, spec: 0.1, len: { mins: 20 }, pool: ['rd'], rounds: 10 },
            { id: 'gr86', name: 'Toyota GR86 Cup', short: 'GR86', ladder: 'gt', tier: 5, car: 'Toyota GR86', grid: 24, teamSize: [1, 2],
                points: 'gt', budget: 140000, spec: 0.1, len: { mins: 25 }, pool: ['rd'], rounds: 10 },
            { id: 'gt4', name: 'GT4 Falken Tyre Challenge', short: 'GT4', ladder: 'gt', tier: 4, car: 'GT4 (BMW M4 / Porsche 718 / Mercedes-AMG / McLaren)',
                makes: ['BMW', 'Porsche', 'Mercedes-AMG', 'McLaren', 'Aston Martin'], grid: 30, teamSize: [1, 2], points: 'gt', budget: 700000, spec: 0.35, len: { mins: 40 }, pool: ['rd'], rounds: 12 },
            { id: 'porsche', name: 'Porsche Mobil 1 Supercup', short: 'Porsche Cup', ladder: 'gt', tier: 3, car: 'Porsche 911 GT3 Cup (992)', grid: 30, teamSize: [1, 3],
                points: 'gt', budget: 1100000, spec: 0.12, len: { mins: 30 }, pool: ['rd'], rounds: 10 },
            { id: 'gt3', name: 'GT3 Fanatec Challenge', short: 'GT3', ladder: 'gt', tier: 2, car: 'GT3 (Ferrari 296 / Porsche 992 R / BMW M4 / Mercedes / Audi / Lamborghini)',
                makes: ['Ferrari', 'Porsche', 'BMW', 'Mercedes-AMG', 'Audi', 'Lamborghini', 'Ford', 'McLaren'], grid: 36, teamSize: [1, 2], points: 'gt', budget: 3500000, spec: 0.35,
                len: { mins: 60 }, pool: ['rd'], rounds: 12 },
            { id: 'imsa', name: 'IMSA SportsCar Championship (GTP)', short: 'IMSA GTP', ladder: 'gt', tier: 1, car: 'GTP (Porsche 963 / BMW M Hybrid V8 / Cadillac / Acura)',
                makes: ['Porsche', 'BMW', 'Cadillac', 'Acura'], grid: 20, teamSize: [2, 2], points: 'wec', budget: 30000000, spec: 0.4, len: { mins: 120 },
                cal: ['Daytona Road Course', 'Sebring', 'Long Beach', 'Laguna Seca', 'Watkins Glen', 'Canadian Tire Motorsport Park', 'Road America', 'Virginia International Raceway', 'Indianapolis Road Course', 'Road Atlanta'] },
            // Formula ladder
            { id: 'vee', name: 'Formula Vee Series', short: 'F-Vee', ladder: 'formula', tier: 7, car: 'Formula Vee', grid: 24, teamSize: [1, 2], points: 'karting',
                budget: 70000, spec: 0.1, len: { mins: 20 }, pool: ['rd'], rounds: 10 },
            { id: 'ff1600', name: 'Ray FF1600 Championship', short: 'FF1600', ladder: 'formula', tier: 6, car: 'Ray FF1600', grid: 26, teamSize: [1, 2], points: 'karting',
                budget: 150000, spec: 0.15, len: { mins: 25 }, pool: ['rd'], rounds: 10 },
            { id: 'f4', name: 'FIA Formula 4 Challenge', short: 'F4', ladder: 'formula', tier: 5, car: 'FIA F4', grid: 26, teamSize: [2, 3], points: 'f1',
                budget: 550000, spec: 0.1, len: { mins: 30 }, pool: ['rd'], rounds: 10 },
            { id: 'sfl', name: 'Super Formula Lights', short: 'SF Lights', ladder: 'formula', tier: 4, car: 'Dallara 324 Super Formula Lights', grid: 22, teamSize: [2, 3],
                points: 'f1', budget: 1500000, spec: 0.1, len: { mins: 35 }, pool: ['rd'], rounds: 10 },
            { id: 'f3', name: 'Formula 3 Championship', short: 'F3', ladder: 'formula', tier: 3, car: 'Dallara F3', grid: 28, teamSize: [2, 3], points: 'f1',
                budget: 2500000, spec: 0.1, len: { mins: 40 }, pool: ['rd'], rounds: 10 },
            { id: 'indycar', name: 'NTT IndyCar Series', short: 'IndyCar', ladder: 'formula', tier: 2, car: 'Dallara IR18', makes: ['Chevrolet', 'Honda'],
                grid: 27, teamSize: [1, 4], points: 'indycar', budget: 14000000, spec: 0.3, len: { km: 320 },
                cal: ['Long Beach|90', 'Barber Motorsports Park|90', 'Indianapolis Road Course|85', 'Indianapolis Motor Speedway|200', 'Detroit Street Circuit|100',
                    'World Wide Technology Raceway (Gateway)|260', 'Road America|55', 'Mid-Ohio|80', 'Iowa Speedway|250', 'Canadian Tire Motorsport Park|80',
                    'Laguna Seca|95', 'Portland International Raceway|110', 'Milwaukee Mile|250', 'Nashville Superspeedway|225'] },
            { id: 'sf', name: 'Super Formula', short: 'Super Formula', ladder: 'formula', tier: 2, car: 'Super Formula SF23', makes: ['Toyota', 'Honda'],
                grid: 22, teamSize: [1, 2], points: 'f1', budget: 9000000, spec: 0.2, len: { km: 230 },
                cal: ['Suzuka', 'Fuji Speedway', 'Twin Ring Motegi', 'Okayama', 'Fuji Speedway', 'Twin Ring Motegi', 'Suzuka'] },
            { id: 'gp', name: 'iRacing Grand Prix Series', short: 'Grand Prix', ladder: 'formula', tier: 1, car: 'Mercedes-AMG W13 / Grand Prix car', grid: 20, teamSize: [2, 2],
                points: 'f1', budget: 140000000, spec: 0.9, len: { km: 305 },
                cal: ['Interlagos', 'Imola', 'Barcelona-Catalunya', 'Circuit Gilles Villeneuve', 'Red Bull Ring', 'Silverstone', 'Hungaroring', 'Spa-Francorchamps',
                    'Zandvoort', 'Monza', 'Suzuka', 'Circuit of the Americas', 'Mount Panorama (Bathurst)', 'Nürburgring GP'] },
            // Dirt oval ladder
            { id: 'dirtmini', name: 'Dirt Mini Stock Series', short: 'Mini Stock', ladder: 'dirt', tier: 5, car: 'Dirt Mini Stock', grid: 20, teamSize: [1, 1],
                points: 'arca', budget: 30000, spec: 0.2, len: { laps: 25 }, pool: ['dt'], rounds: 10 },
            { id: 'dirtstreet', name: 'Dirt Street Stock Series', short: 'Street Stock', ladder: 'dirt', tier: 4, car: 'Dirt Street Stock', grid: 22, teamSize: [1, 1],
                points: 'arca', budget: 55000, spec: 0.25, len: { laps: 25 }, pool: ['dt'], rounds: 10 },
            { id: 'ump', name: 'UMP Modified Series', short: 'UMP Mod', ladder: 'dirt', tier: 3, car: 'UMP Modified', grid: 24, teamSize: [1, 2],
                points: 'arca', budget: 110000, spec: 0.3, len: { laps: 30 }, pool: ['dt'], rounds: 12 },
            { id: 'dlmpro', name: 'Dirt Late Model Pro Series', short: 'DLM Pro', ladder: 'dirt', tier: 2, car: 'Dirt Late Model (Pro)', grid: 24, teamSize: [1, 2],
                points: 'arca', budget: 380000, spec: 0.35, len: { laps: 40 }, pool: ['dt'], rounds: 14 },
            { id: 'woolm', name: 'World of Outlaws Late Model Series', short: 'WoO LM', ladder: 'dirt', tier: 1, car: 'Super Dirt Late Model', grid: 26, teamSize: [1, 2],
                points: 'arca', budget: 900000, spec: 0.4, len: { laps: 50 }, pool: ['dt'], rounds: 16 },
            { id: 'sprint305', name: '305 Sprint Car Series', short: '305 Sprint', ladder: 'sprint', tier: 3, car: '305 Sprint Car', grid: 22, teamSize: [1, 1],
                points: 'arca', budget: 140000, spec: 0.3, len: { laps: 25 }, pool: ['dt'], rounds: 12 },
            { id: 'sprint360', name: '360 Sprint Car Series', short: '360 Sprint', ladder: 'sprint', tier: 2, car: '360 Sprint Car', grid: 24, teamSize: [1, 2],
                points: 'arca', budget: 300000, spec: 0.35, len: { laps: 30 }, pool: ['dt'], rounds: 14 },
            { id: 'woo410', name: 'World of Outlaws Sprint Car Series', short: 'WoO 410', ladder: 'sprint', tier: 1, car: '410 Sprint Car', grid: 26, teamSize: [1, 2],
                points: 'arca', budget: 1000000, spec: 0.4, len: { laps: 40 }, pool: ['dt'], rounds: 16 }
        ]
    });

    /* ============================================================
       Automobilista 2
       ============================================================ */
    game({
        id: 'ams2', name: 'Automobilista 2', short: 'AMS2', dev: 'Reiza Studios', year: 2020, era: 2026,
        platform: 'PC', color: '#f5c400', icon: '🇧🇷', ai: AI.ams2, maxGrid: 40,
        formats: ['csv', 'paste'],
        blurb: 'Reiza’s huge roster — Brazilian stock cars, a full open-wheel ladder, GT and endurance prototypes. Custom AI grids make it a perfect career sim.',
        tracks: ['Interlagos', 'Goiânia', 'Curitiba', 'Londrina', 'Cascavel', 'Velopark', 'Campo Grande', 'Santa Cruz do Sul', 'Tarumã', 'Guaporé',
            'Brasília', 'Jacarepaguá', 'Velo Città', 'Buenos Aires', 'Spa-Francorchamps', 'Silverstone', 'Brands Hatch', 'Donington Park', 'Oulton Park',
            'Cadwell Park', 'Snetterton', 'Imola', 'Monza', 'Nürburgring GP', 'Nürburgring Nordschleife', 'Hockenheim', 'Red Bull Ring', 'Salzburgring',
            'Jerez', 'Estoril', 'Portimão', 'Barcelona-Catalunya', 'Kyalami', 'Laguna Seca', 'Road America', 'Road Atlanta', 'Watkins Glen', 'Daytona Road Course',
            'Daytona International Speedway', 'Sebring', 'Long Beach', 'Indianapolis Road Course', 'Indianapolis Motor Speedway', 'Mount Panorama (Bathurst)',
            'Adelaide Street Circuit', 'Azure Circuit', 'Circuit Gilles Villeneuve', 'Circuit de la Sarthe (Le Mans)', 'Buskerud Kart', 'Granja Viana Kart', 'Speedland Kart'],
        series: [
            { id: 'kart', name: 'Kart Shifter Championship', short: 'Karting', ladder: 'kart', tier: 1, car: 'Kart 125cc Shifter', grid: 24, teamSize: [1, 2],
                points: 'karting', budget: 90000, spec: 0.15, len: { laps: 20 }, cal: ['Granja Viana Kart', 'Speedland Kart', 'Buskerud Kart', 'Granja Viana Kart', 'Speedland Kart', 'Buskerud Kart', 'Granja Viana Kart', 'Speedland Kart'] },
            { id: 'vee', name: 'Formula Vee Brasil', short: 'F-Vee', ladder: 'formula', tier: 6, car: 'Formula Vee Gen2', grid: 24, teamSize: [1, 2], points: 'karting',
                budget: 80000, spec: 0.1, len: { mins: 20 }, cal: ['Interlagos', 'Velopark', 'Tarumã', 'Curitiba', 'Londrina', 'Guaporé', 'Goiânia', 'Santa Cruz do Sul'] },
            { id: 'ftrainer', name: 'F-Trainer Championship', short: 'F-Trainer', ladder: 'formula', tier: 5, car: 'Formula Trainer Advanced', grid: 24, teamSize: [2, 2], points: 'f1',
                budget: 250000, spec: 0.1, len: { mins: 25 }, cal: ['Interlagos', 'Curitiba', 'Goiânia', 'Cascavel', 'Londrina', 'Santa Cruz do Sul', 'Campo Grande', 'Velo Città', 'Brasília'] },
            { id: 'finter', name: 'Formula Inter Series', short: 'F-Inter', ladder: 'formula', tier: 4, car: 'Formula Inter MG-15', grid: 24, teamSize: [2, 2], points: 'f1',
                budget: 700000, spec: 0.1, len: { mins: 30 }, pool: ['rd'], rounds: 10 },
            { id: 'f3', name: 'F-3 Championship', short: 'F-3', ladder: 'formula', tier: 3, car: 'F-3 (Dallara F309 / F301)', grid: 26, teamSize: [2, 3], points: 'f1',
                budget: 1800000, spec: 0.12, len: { mins: 35 }, pool: ['rd'], rounds: 10 },
            { id: 'freiza', name: 'Formula Reiza Championship', short: 'F-Reiza', ladder: 'formula', tier: 2, car: 'Formula Reiza', grid: 22, teamSize: [2, 2], points: 'f1',
                budget: 5000000, spec: 0.15, len: { km: 200 }, pool: ['rd', 'st'], rounds: 12 },
            { id: 'fusa', name: 'F-USA Championship', short: 'F-USA', ladder: 'formula', tier: 1, car: 'Formula USA (Indy-style)', makes: ['Chevrolet', 'Honda'], grid: 26, teamSize: [1, 4],
                points: 'indycar', budget: 14000000, spec: 0.3, len: { km: 300 },
                cal: ['Long Beach', 'Indianapolis Road Course', 'Indianapolis Motor Speedway|200', 'Road America', 'Laguna Seca', 'Watkins Glen', 'Daytona International Speedway|120', 'Road Atlanta', 'Sebring', 'Circuit Gilles Villeneuve'] },
            { id: 'fultimate', name: 'Formula Ultimate World Championship', short: 'F-Ultimate', ladder: 'formula', tier: 1, car: 'Formula Ultimate Gen2', grid: 20, teamSize: [2, 2],
                points: 'f1', budget: 140000000, spec: 0.9, len: { km: 305 },
                cal: ['Interlagos', 'Imola', 'Barcelona-Catalunya', 'Azure Circuit', 'Circuit Gilles Villeneuve', 'Red Bull Ring', 'Silverstone', 'Hockenheim', 'Spa-Francorchamps',
                    'Monza', 'Portimão', 'Jerez', 'Kyalami', 'Buenos Aires', 'Adelaide Street Circuit'] },
            { id: 'sprintrace', name: 'Sprint Race Brasil', short: 'Sprint Race', ladder: 'touring', tier: 3, car: 'Sprint Race (GT-style silhouette)', grid: 24, teamSize: [1, 2],
                points: 'gt', budget: 220000, spec: 0.15, len: { mins: 25 }, cal: ['Interlagos', 'Velopark', 'Curitiba', 'Londrina', 'Cascavel', 'Tarumã', 'Goiânia', 'Santa Cruz do Sul'] },
            { id: 'copatruck', name: 'Copa Truck', short: 'Copa Truck', ladder: 'touring', tier: 2, car: 'Copa Truck', makes: ['Iveco', 'Mercedes-Benz', 'Volkswagen', 'Volvo', 'Scania'],
                grid: 22, teamSize: [1, 2], points: 'gt', budget: 1200000, spec: 0.3, len: { mins: 30 }, cal: ['Interlagos', 'Goiânia', 'Curitiba', 'Cascavel', 'Londrina', 'Campo Grande', 'Santa Cruz do Sul', 'Brasília', 'Velo Città'] },
            { id: 'stockcar', name: 'Stock Car Pro Series', short: 'Stock Car', ladder: 'touring', tier: 1, car: 'Stock Car Pro (Chevrolet Cruze / Toyota Corolla / Mitsubishi Eclipse Cross)',
                makes: ['Chevrolet', 'Toyota', 'Mitsubishi'], grid: 32, teamSize: [2, 2], points: 'gt', budget: 4000000, spec: 0.2, len: { mins: 40 },
                cal: ['Goiânia', 'Interlagos', 'Velo Città', 'Cascavel', 'Curitiba', 'Santa Cruz do Sul', 'Londrina', 'Campo Grande', 'Buenos Aires', 'Brasília', 'Tarumã', 'Interlagos'] },
            { id: 'caterham', name: 'Caterham Academy', short: 'Caterham', ladder: 'gt', tier: 6, car: 'Caterham Academy', grid: 24, teamSize: [1, 2], points: 'gt',
                budget: 70000, spec: 0.05, len: { mins: 20 }, cal: ['Brands Hatch', 'Oulton Park', 'Snetterton', 'Cadwell Park', 'Donington Park', 'Silverstone', 'Brands Hatch'] },
            { id: 'ginetta', name: 'Ginetta G40 Cup', short: 'G40 Cup', ladder: 'gt', tier: 5, car: 'Ginetta G40', grid: 26, teamSize: [1, 2], points: 'gt',
                budget: 130000, spec: 0.05, len: { mins: 20 }, cal: ['Brands Hatch', 'Donington Park', 'Oulton Park', 'Snetterton', 'Cadwell Park', 'Silverstone'] },
            { id: 'gt4', name: 'GT4 Championship', short: 'GT4', ladder: 'gt', tier: 4, car: 'GT4 (Ginetta G55 / Porsche Cayman / McLaren 570S / Mercedes / BMW)', makes: ['Ginetta', 'Porsche', 'McLaren', 'Mercedes-AMG', 'BMW'],
                grid: 30, teamSize: [1, 2], points: 'gt', budget: 700000, spec: 0.3, len: { mins: 40 }, pool: ['rd'], rounds: 10 },
            { id: 'carrera', name: 'Porsche Carrera Cup', short: 'Carrera Cup', ladder: 'gt', tier: 3, car: 'Porsche 911 GT3 Cup (992)', grid: 28, teamSize: [1, 3], points: 'gt',
                budget: 1000000, spec: 0.08, len: { mins: 30 }, pool: ['rd'], rounds: 10 },
            { id: 'gt3', name: 'GT3 Championship', short: 'GT3', ladder: 'gt', tier: 2, car: 'GT3 Gen2 (Porsche 992 R / McLaren 720S / BMW M4 / Mercedes-AMG / Lamborghini)',
                makes: ['Porsche', 'McLaren', 'BMW', 'Mercedes-AMG', 'Lamborghini', 'Chevrolet'], grid: 32, teamSize: [1, 2], points: 'gt', budget: 3500000, spec: 0.3, len: { mins: 60 }, pool: ['rd'], rounds: 10 },
            { id: 'gt3endurance', name: 'GT3 Endurance Cup', short: 'GT3 Endurance', ladder: 'gt', tier: 1, car: 'GT3 Gen2', makes: ['Porsche', 'McLaren', 'BMW', 'Mercedes-AMG', 'Lamborghini', 'Chevrolet'],
                grid: 36, teamSize: [1, 3], points: 'wec', budget: 6000000, spec: 0.3, len: { mins: 180 },
                cal: ['Daytona Road Course', 'Sebring', 'Spa-Francorchamps', 'Nürburgring Nordschleife', 'Mount Panorama (Bathurst)', 'Kyalami', 'Road Atlanta', 'Interlagos'] },
            { id: 'lmp3', name: 'LMP3 Prototype Cup', short: 'LMP3', ladder: 'endurance', tier: 3, car: 'Ligier JS P320 / Ginetta G61 LMP3', makes: ['Ligier', 'Ginetta', 'Duqueine'],
                grid: 28, teamSize: [1, 2], points: 'wec', budget: 1200000, spec: 0.15, len: { mins: 60 }, pool: ['rd'], rounds: 8 },
            { id: 'lmp2', name: 'LMP2 Championship', short: 'LMP2', ladder: 'endurance', tier: 2, car: 'Oreca 07 / Ligier JS P217', makes: ['Oreca', 'Ligier'],
                grid: 26, teamSize: [1, 2], points: 'wec', budget: 4500000, spec: 0.15, len: { mins: 120 }, pool: ['rd'], rounds: 8 },
            { id: 'gtp', name: 'Endurance Hypercar / GTP Championship', short: 'Hypercar', ladder: 'endurance', tier: 1, car: 'LMDh (Porsche 963 / BMW M Hybrid V8 / Cadillac V-Series.R / Acura ARX-06)',
                makes: ['Porsche', 'BMW', 'Cadillac', 'Acura'], grid: 20, teamSize: [2, 2], points: 'wec', budget: 45000000, spec: 0.4, len: { mins: 240 },
                cal: ['Daytona Road Course', 'Sebring', 'Spa-Francorchamps', 'Circuit de la Sarthe (Le Mans)', 'Watkins Glen', 'Road America', 'Interlagos', 'Road Atlanta'] },
            { id: 'groupc', name: 'Group C World Sportscar Championship', short: 'Group C', ladder: 'historic', tier: 1, car: 'Group C (Porsche 962C / Nissan R89C / Mercedes C9 / Sauber)',
                makes: ['Porsche', 'Nissan', 'Mercedes-Benz', 'Jaguar'], grid: 24, teamSize: [1, 2], points: 'wec', budget: 25000000, spec: 0.6, len: { mins: 120 },
                cal: ['Jerez', 'Silverstone', 'Monza', 'Spa-Francorchamps', 'Nürburgring GP', 'Donington Park', 'Brands Hatch', 'Circuit de la Sarthe (Le Mans)'] }
        ]
    });

    /* ============================================================
       Assetto Corsa
       ============================================================ */
    game({
        id: 'ac', name: 'Assetto Corsa', short: 'AC', dev: 'Kunos Simulazioni', year: 2014, era: 2026,
        platform: 'PC / Console', color: '#e3262f', icon: '🇮🇹', ai: AI.ac, maxGrid: 32,
        formats: ['ac-json', 'csv', 'paste'],
        blurb: 'Kunos’ original — base content plus DLC cars. Mods are welcome: add any track to a calendar in the setup screen.',
        tracks: ['Monza', 'Imola', 'Mugello', 'Vallelunga', 'Magione', 'Spa-Francorchamps', 'Silverstone', 'Silverstone International', 'Brands Hatch', 'Brands Hatch Indy',
            'Nürburgring GP', 'Nürburgring Nordschleife', 'Red Bull Ring', 'Barcelona-Catalunya', 'Zandvoort', 'Laguna Seca', 'Black Cat County', 'Highlands', 'Trento-Bondone Hill Climb'],
        series: [
            { id: 'mx5', name: 'Mazda MX-5 Cup', short: 'MX-5 Cup', ladder: 'gt', tier: 6, car: 'Mazda MX-5 Cup', grid: 20, teamSize: [1, 2], points: 'gt', budget: 80000, spec: 0.05, len: { mins: 20 }, pool: ['rd'], rounds: 8 },
            { id: 'ttcup', name: 'Audi TT Cup', short: 'TT Cup', ladder: 'gt', tier: 5, car: 'Audi TT Cup', grid: 22, teamSize: [1, 2], points: 'gt', budget: 180000, spec: 0.05, len: { mins: 25 }, pool: ['rd'], rounds: 8 },
            { id: 'gt4', name: 'GT4 Series', short: 'GT4', ladder: 'gt', tier: 4, car: 'GT4 (Porsche Cayman GT4 Clubsport / Maserati / BMW / Ginetta)', makes: ['Porsche', 'Maserati', 'BMW', 'Ginetta'],
                grid: 24, teamSize: [1, 2], points: 'gt', budget: 600000, spec: 0.3, len: { mins: 35 }, pool: ['rd'], rounds: 10 },
            { id: 'carrera', name: 'Porsche Carrera Cup', short: 'Carrera Cup', ladder: 'gt', tier: 3, car: 'Porsche 911 GT3 Cup 2017', grid: 24, teamSize: [1, 3], points: 'gt', budget: 950000, spec: 0.08, len: { mins: 30 }, pool: ['rd'], rounds: 10 },
            { id: 'gt3', name: 'GT3 Sprint Series', short: 'GT3', ladder: 'gt', tier: 2, car: 'GT3 (Ferrari 488 / Lamborghini Huracán / McLaren 650S / Mercedes SLS / Nissan GT-R / BMW Z4 / Audi R8)',
                makes: ['Ferrari', 'Lamborghini', 'McLaren', 'Mercedes-AMG', 'Nissan', 'BMW', 'Audi'], grid: 26, teamSize: [1, 2], points: 'gt', budget: 3200000, spec: 0.35, len: { mins: 60 }, pool: ['rd'], rounds: 10 },
            { id: 'lmp1', name: 'LMP1 Hybrid Endurance', short: 'LMP1', ladder: 'gt', tier: 1, car: 'Porsche 919 Hybrid / Toyota TS040 / Audi R18', makes: ['Porsche', 'Toyota', 'Audi'],
                grid: 18, teamSize: [2, 3], points: 'wec', budget: 60000000, spec: 0.6, len: { mins: 120 }, cal: ['Silverstone', 'Spa-Francorchamps', 'Nürburgring GP', 'Monza', 'Barcelona-Catalunya', 'Red Bull Ring', 'Imola', 'Mugello'] },
            { id: 'fabarth', name: 'Formula Abarth (Tatuus FA01)', short: 'F-Abarth', ladder: 'formula', tier: 3, car: 'Tatuus FA01', grid: 24, teamSize: [2, 2], points: 'f1', budget: 500000, spec: 0.08, len: { mins: 25 }, pool: ['rd'], rounds: 10 },
            { id: 'exos', name: 'Exos 125 Formula Series', short: 'Exos 125', ladder: 'formula', tier: 2, car: 'Lotus Exos 125 S1', grid: 20, teamSize: [2, 2], points: 'f1', budget: 8000000, spec: 0.2, len: { km: 180 }, pool: ['rd'], rounds: 10 },
            { id: 'gp', name: 'Grand Prix Hybrid Era', short: 'Grand Prix', ladder: 'formula', tier: 1, car: 'Ferrari SF70H / SF15-T', grid: 20, teamSize: [2, 2], points: 'f1', budget: 140000000, spec: 0.9, len: { km: 305 },
                cal: ['Monza', 'Imola', 'Mugello', 'Spa-Francorchamps', 'Silverstone', 'Barcelona-Catalunya', 'Red Bull Ring', 'Nürburgring GP', 'Zandvoort', 'Laguna Seca', 'Vallelunga'] },
            { id: 'bmwcup', name: 'BMW M235i Racing Cup', short: 'M235i Cup', ladder: 'touring', tier: 2, car: 'BMW M235i Racing', grid: 22, teamSize: [1, 2], points: 'btcc', budget: 250000, spec: 0.05, len: { mins: 25 }, pool: ['rd'], rounds: 10 },
            { id: 'dtm90', name: 'Classic DTM (Group A)', short: 'DTM 90s', ladder: 'touring', tier: 1, car: 'Alfa 155 V6 TI / Mercedes 190E Evo II / BMW M3 E30', makes: ['Alfa Romeo', 'Mercedes-Benz', 'BMW'],
                grid: 22, teamSize: [2, 3], points: 'dtm', budget: 5000000, spec: 0.5, len: { mins: 40 }, cal: ['Nürburgring GP', 'Brands Hatch', 'Mugello', 'Monza', 'Spa-Francorchamps', 'Silverstone', 'Imola', 'Zandvoort', 'Red Bull Ring', 'Vallelunga'] }
        ]
    });

    /* ============================================================
       Assetto Corsa Competizione
       ============================================================ */
    game({
        id: 'acc', name: 'Assetto Corsa Competizione', short: 'ACC', dev: 'Kunos Simulazioni', year: 2019, era: 2026,
        platform: 'PC / Console', color: '#d71e2b', icon: '🏆', ai: AI.acc, maxGrid: 50,
        formats: ['acc-json', 'csv', 'paste'],
        blurb: 'The official GT World Challenge game. Climb from one-make cups through GT4 into the GT3 sprint and endurance championships.',
        tracks: ['Monza', 'Zolder', 'Brands Hatch', 'Silverstone', 'Paul Ricard', 'Misano', 'Spa-Francorchamps', 'Hungaroring', 'Nürburgring GP', 'Barcelona-Catalunya',
            'Zandvoort', 'Kyalami', 'Mount Panorama (Bathurst)', 'Suzuka', 'Laguna Seca', 'Imola', 'Oulton Park', 'Donington Park', 'Snetterton', 'Watkins Glen',
            'Circuit of the Americas', 'Indianapolis Road Course', 'Valencia (Ricardo Tormo)', 'Red Bull Ring', 'Nürburgring 24h Layout'],
        series: [
            { id: 'm2cup', name: 'BMW M2 Cup', short: 'M2 Cup', ladder: 'gt', tier: 6, car: 'BMW M2 CS Racing', grid: 26, teamSize: [1, 2], points: 'gt', budget: 250000, spec: 0.05, len: { mins: 25 },
                cal: ['Misano', 'Zandvoort', 'Brands Hatch', 'Red Bull Ring', 'Imola', 'Monza', 'Hungaroring', 'Barcelona-Catalunya'] },
            { id: 'carrera', name: 'Porsche Carrera Cup', short: 'Carrera Cup', ladder: 'gt', tier: 5, car: 'Porsche 911 GT3 Cup (992)', grid: 28, teamSize: [1, 3], points: 'gt', budget: 1000000, spec: 0.05, len: { mins: 30 },
                cal: ['Imola', 'Red Bull Ring', 'Zandvoort', 'Nürburgring GP', 'Spa-Francorchamps', 'Monza', 'Misano', 'Hungaroring'] },
            { id: 'supertrofeo', name: 'Lamborghini Super Trofeo', short: 'Super Trofeo', ladder: 'gt', tier: 5, car: 'Lamborghini Huracán Super Trofeo EVO2', grid: 28, teamSize: [1, 2], points: 'gt', budget: 1100000, spec: 0.05, len: { mins: 50 },
                cal: ['Monza', 'Misano', 'Imola', 'Spa-Francorchamps', 'Paul Ricard', 'Nürburgring GP', 'Valencia (Ricardo Tormo)', 'Barcelona-Catalunya'] },
            { id: 'ferrari', name: 'Ferrari Challenge Europe', short: 'Ferrari Challenge', ladder: 'gt', tier: 5, car: 'Ferrari 488 Challenge Evo', grid: 28, teamSize: [1, 2], points: 'gt', budget: 950000, spec: 0.05, len: { mins: 30 },
                cal: ['Valencia (Ricardo Tormo)', 'Imola', 'Barcelona-Catalunya', 'Misano', 'Spa-Francorchamps', 'Monza', 'Hungaroring', 'Paul Ricard'] },
            { id: 'gt4', name: 'GT4 European Series', short: 'GT4', ladder: 'gt', tier: 4, car: 'GT4 (Aston Martin / Audi R8 LMS GT4 / BMW M4 GT4 / Porsche 718 / Mercedes-AMG / McLaren 570S)',
                makes: ['Aston Martin', 'Audi', 'BMW', 'Porsche', 'Mercedes-AMG', 'McLaren', 'Ginetta', 'Maserati'], grid: 36, teamSize: [1, 2], points: 'gt', budget: 750000, spec: 0.3, len: { mins: 60 },
                cal: ['Monza', 'Paul Ricard', 'Spa-Francorchamps', 'Misano', 'Nürburgring GP', 'Zandvoort', 'Barcelona-Catalunya', 'Valencia (Ricardo Tormo)'] },
            { id: 'britgt', name: 'British GT Championship', short: 'British GT', ladder: 'gt', tier: 3, car: 'GT3', makes: ['Aston Martin', 'McLaren', 'Mercedes-AMG', 'BMW', 'Porsche', 'Lamborghini', 'Audi', 'Bentley'],
                grid: 30, teamSize: [1, 2], points: 'gt', budget: 2000000, spec: 0.35, len: { mins: 120 },
                cal: ['Oulton Park', 'Silverstone', 'Donington Park', 'Spa-Francorchamps', 'Snetterton', 'Brands Hatch', 'Donington Park'] },
            { id: 'sprint', name: 'GT World Challenge Europe Sprint Cup', short: 'GTWC Sprint', ladder: 'gt', tier: 2, car: 'GT3 (Ferrari 296 / Porsche 992 R / BMW M4 / Mercedes-AMG Evo / Audi Evo II / Lamborghini EVO2 / McLaren 720S Evo / Ford Mustang)',
                makes: ['Ferrari', 'Porsche', 'BMW', 'Mercedes-AMG', 'Audi', 'Lamborghini', 'McLaren', 'Ford', 'Aston Martin'], grid: 30, teamSize: [1, 3], points: 'gt', budget: 3500000, spec: 0.35, len: { mins: 60 },
                cal: ['Brands Hatch', 'Misano', 'Zandvoort', 'Valencia (Ricardo Tormo)', 'Red Bull Ring', 'Misano', 'Barcelona-Catalunya', 'Hungaroring', 'Valencia (Ricardo Tormo)', 'Monza'] },
            { id: 'endurance', name: 'GT World Challenge Europe Endurance Cup', short: 'GTWC Endurance', ladder: 'gt', tier: 1, car: 'GT3 (full Pro-class grid)',
                makes: ['Ferrari', 'Porsche', 'BMW', 'Mercedes-AMG', 'Audi', 'Lamborghini', 'McLaren', 'Ford', 'Aston Martin'], grid: 44, teamSize: [1, 3], points: 'wec', budget: 6000000, spec: 0.35, len: { mins: 180 },
                cal: ['Paul Ricard', 'Monza', 'Spa-Francorchamps', 'Nürburgring GP', 'Barcelona-Catalunya'] },
            { id: 'igtc', name: 'Intercontinental GT Challenge', short: 'IGTC', ladder: 'gt', tier: 1, car: 'GT3 (manufacturer works entries)',
                makes: ['Ferrari', 'Porsche', 'BMW', 'Mercedes-AMG', 'Audi', 'Lamborghini', 'McLaren', 'Ford', 'Aston Martin'], grid: 40, teamSize: [1, 2], points: 'wec', budget: 8000000, spec: 0.35, len: { mins: 180 },
                cal: ['Mount Panorama (Bathurst)', 'Nürburgring 24h Layout', 'Spa-Francorchamps', 'Suzuka', 'Indianapolis Road Course', 'Kyalami'] },
            { id: 'gtwca', name: 'GT World Challenge America', short: 'GTWC America', ladder: 'gt', tier: 2, car: 'GT3', makes: ['Ferrari', 'Porsche', 'BMW', 'Mercedes-AMG', 'Audi', 'Lamborghini', 'McLaren', 'Ford', 'Acura'],
                grid: 28, teamSize: [1, 2], points: 'gt', budget: 3000000, spec: 0.35, len: { mins: 90 }, dlc: 'American Track Pack',
                cal: ['Circuit of the Americas', 'Laguna Seca', 'Watkins Glen', 'Indianapolis Road Course', 'Circuit of the Americas', 'Laguna Seca', 'Watkins Glen'] }
        ]
    });

    /* ============================================================
       Project CARS
       ============================================================ */
    game({
        id: 'pcars1', name: 'Project CARS', short: 'PCARS', dev: 'Slightly Mad Studios', year: 2015, era: 2015,
        platform: 'PC / Console', color: '#1f7ac0', icon: '🎬', ai: AI.pc1, maxGrid: 32,
        formats: ['csv', 'paste'],
        blurb: 'The original community-funded sim — karting to LMP1, with an open career you can now actually keep score of.',
        tracks: ['Azure Coast', 'Azure Circuit', 'Bannochbrae Road Circuit', 'Brands Hatch', 'Brands Hatch Indy', 'Cadwell Park', 'California Highway', 'Barcelona-Catalunya',
            'Donington Park', 'Dubai Autodrome', 'Hockenheim', 'Imola', 'Laguna Seca', 'Circuit de la Sarthe (Le Mans)', 'Monza', 'Nürburgring GP', 'Nürburgring Nordschleife',
            'Oschersleben', 'Oulton Park', 'Road America', 'Sakitto', 'Silverstone', 'Snetterton', 'Sonoma Raceway', 'Spa-Francorchamps', 'Watkins Glen', 'Willow Springs',
            'Zolder', 'Glencairn', 'Summerton', 'Chesterfield Karting'],
        series: [
            { id: 'kart125', name: '125cc Kart Championship', short: '125cc Kart', ladder: 'kart', tier: 2, car: 'Kart 125cc', grid: 24, teamSize: [1, 2], points: 'karting', budget: 60000, spec: 0.1, len: { laps: 15 }, cal: ['Glencairn', 'Summerton', 'Chesterfield Karting', 'Glencairn', 'Summerton', 'Chesterfield Karting'] },
            { id: 'superkart', name: 'Superkart Series', short: 'Superkart', ladder: 'kart', tier: 1, car: 'Superkart 250cc', grid: 24, teamSize: [1, 2], points: 'karting', budget: 120000, spec: 0.15, len: { laps: 12 }, pool: ['rd'], rounds: 8 },
            { id: 'rookie', name: 'Formula Rookie', short: 'F-Rookie', ladder: 'formula', tier: 5, car: 'Formula Rookie', grid: 24, teamSize: [2, 2], points: 'f1', budget: 150000, spec: 0.05, len: { mins: 20 }, pool: ['rd'], rounds: 8 },
            { id: 'fgulf', name: 'Formula Gulf FG1000', short: 'F-Gulf', ladder: 'formula', tier: 4, car: 'Formula Gulf FG1000', grid: 24, teamSize: [2, 2], points: 'f1', budget: 350000, spec: 0.05, len: { mins: 25 }, pool: ['rd'], rounds: 8 },
            { id: 'fc', name: 'Formula C', short: 'F-C', ladder: 'formula', tier: 3, car: 'Formula C', grid: 24, teamSize: [2, 2], points: 'f1', budget: 900000, spec: 0.1, len: { mins: 30 }, pool: ['rd'], rounds: 10 },
            { id: 'fb', name: 'Formula B', short: 'F-B', ladder: 'formula', tier: 2, car: 'Formula B', grid: 22, teamSize: [2, 2], points: 'f1', budget: 3500000, spec: 0.12, len: { mins: 40 }, pool: ['rd'], rounds: 10 },
            { id: 'fa', name: 'Formula A', short: 'F-A', ladder: 'formula', tier: 1, car: 'Formula A', grid: 20, teamSize: [2, 2], points: 'f1', budget: 120000000, spec: 0.85, len: { km: 305 },
                cal: ['Monza', 'Silverstone', 'Spa-Francorchamps', 'Hockenheim', 'Barcelona-Catalunya', 'Azure Circuit', 'Dubai Autodrome', 'Imola', 'Nürburgring GP', 'Road America', 'Laguna Seca', 'Sonoma Raceway'] },
            { id: 'ginettajr', name: 'Ginetta Junior Championship', short: 'Ginetta Jr', ladder: 'gt', tier: 5, car: 'Ginetta G40 Junior', grid: 24, teamSize: [1, 2], points: 'gt', budget: 120000, spec: 0.05, len: { mins: 20 },
                cal: ['Brands Hatch Indy', 'Donington Park', 'Oulton Park', 'Snetterton', 'Cadwell Park', 'Silverstone', 'Brands Hatch'] },
            { id: 'gt5', name: 'GT5 Challenge', short: 'GT5', ladder: 'gt', tier: 4, car: 'Ginetta G40 GT5', grid: 24, teamSize: [1, 2], points: 'gt', budget: 250000, spec: 0.05, len: { mins: 25 }, pool: ['rd'], rounds: 8 },
            { id: 'gt4', name: 'Ginetta GT4 Supercup', short: 'GT4 Supercup', ladder: 'gt', tier: 3, car: 'Ginetta G55 GT4', grid: 26, teamSize: [1, 2], points: 'gt', budget: 600000, spec: 0.05, len: { mins: 30 }, pool: ['rd'], rounds: 10 },
            { id: 'gt3', name: 'GT3 Series', short: 'GT3', ladder: 'gt', tier: 2, car: 'GT3 (BMW Z4 / McLaren 12C / Mercedes SLS / Aston Martin Vantage)', makes: ['BMW', 'McLaren', 'Mercedes-AMG', 'Aston Martin', 'Audi'],
                grid: 26, teamSize: [1, 2], points: 'gt', budget: 3000000, spec: 0.35, len: { mins: 60 }, pool: ['rd'], rounds: 10 },
            { id: 'lmp1', name: 'LMP1 Endurance', short: 'LMP1', ladder: 'gt', tier: 1, car: 'LMP1 (Audi R18 e-tron / Oreca 03)', makes: ['Audi', 'Oreca'], grid: 20, teamSize: [2, 3], points: 'wec', budget: 40000000, spec: 0.55, len: { mins: 120 },
                cal: ['Silverstone', 'Spa-Francorchamps', 'Circuit de la Sarthe (Le Mans)', 'Nürburgring GP', 'Road America', 'Dubai Autodrome', 'Monza', 'Laguna Seca'] },
            { id: 'touring', name: 'Touring Car Championship', short: 'Touring', ladder: 'touring', tier: 1, car: 'BMW 320 TC / Touring cars', grid: 24, teamSize: [2, 3], points: 'btcc', budget: 2500000, spec: 0.3, len: { mins: 25 },
                cal: ['Brands Hatch Indy', 'Donington Park', 'Oulton Park', 'Snetterton', 'Cadwell Park', 'Silverstone', 'Oschersleben', 'Zolder', 'Brands Hatch'] }
        ]
    });

    /* ============================================================
       Project CARS 2
       ============================================================ */
    game({
        id: 'pcars2', name: 'Project CARS 2', short: 'PCARS 2', dev: 'Slightly Mad Studios', year: 2017, era: 2017,
        platform: 'PC / Console', color: '#0a64b0', icon: '🎬', ai: AI.pc, maxGrid: 32,
        formats: ['csv', 'paste'],
        blurb: 'Karting, IndyCar, rallycross, IMSA, GTs and LMPs across 140 layouts. The app handles the career the game never quite finished.',
        tracks: ['Azure Coast', 'Azure Circuit', 'Mount Panorama (Bathurst)', 'Brands Hatch', 'Brands Hatch Indy', 'Cadwell Park', 'California Highway', 'Barcelona-Catalunya',
            'Daytona Road Course', 'Daytona International Speedway', 'Donington Park', 'Dubai Autodrome', 'Fuji Speedway', 'Hockenheim', 'Imola', 'Indianapolis Motor Speedway',
            'Indianapolis Road Course', 'Interlagos', 'Knockhill', 'Laguna Seca', 'Circuit de la Sarthe (Le Mans)', 'Long Beach', 'Mojave Test Track', 'Monza', 'Nürburgring GP',
            'Nürburgring Nordschleife', 'Oschersleben', 'Oulton Park', 'Red Bull Ring', 'Road America', 'Road Atlanta', 'Sakitto', 'Silverstone', 'Snetterton', 'Sonoma Raceway',
            'Spa-Francorchamps', 'Texas Motor Speedway', 'Watkins Glen', 'Willow Springs', 'Zhuhai', 'Zolder', 'Autopolis', 'Sugo', 'Ruapuna', 'Hampton Downs', 'Rouen-les-Essarts',
            'Portimão', 'Canadian Tire Motorsport Park', 'Lydden Hill', 'Höljes', 'Lohéac', 'Hell (Lånkebanen)', 'Glencairn', 'Summerton', 'Chesterfield Karting'],
        series: [
            { id: 'kart', name: 'Karting Championship', short: 'Karting', ladder: 'kart', tier: 1, car: 'Kart 125cc / Superkart', grid: 24, teamSize: [1, 2], points: 'karting', budget: 80000, spec: 0.1, len: { laps: 15 },
                cal: ['Glencairn', 'Summerton', 'Chesterfield Karting', 'Glencairn', 'Summerton', 'Chesterfield Karting', 'Glencairn', 'Summerton'] },
            { id: 'rookie', name: 'Formula Rookie', short: 'F-Rookie', ladder: 'formula', tier: 6, car: 'Formula Rookie', grid: 24, teamSize: [2, 2], points: 'f1', budget: 140000, spec: 0.05, len: { mins: 20 }, pool: ['rd'], rounds: 8 },
            { id: 'fx', name: 'Formula X', short: 'F-X', ladder: 'formula', tier: 5, car: 'Formula X', grid: 24, teamSize: [2, 2], points: 'f1', budget: 350000, spec: 0.05, len: { mins: 25 }, pool: ['rd'], rounds: 8 },
            { id: 'fc', name: 'Formula C', short: 'F-C', ladder: 'formula', tier: 4, car: 'Formula C', grid: 24, teamSize: [2, 2], points: 'f1', budget: 900000, spec: 0.1, len: { mins: 30 }, pool: ['rd'], rounds: 10 },
            { id: 'fr35', name: 'Formula Renault 3.5', short: 'FR3.5', ladder: 'formula', tier: 3, car: 'Formula Renault 3.5', grid: 24, teamSize: [2, 2], points: 'f1', budget: 2800000, spec: 0.1, len: { mins: 40 }, pool: ['rd'], rounds: 10 },
            { id: 'indycar', name: 'IndyCar Series', short: 'IndyCar', ladder: 'formula', tier: 2, car: 'Dallara DW12', makes: ['Chevrolet', 'Honda'], grid: 26, teamSize: [1, 4], points: 'indycar', budget: 13000000, spec: 0.3, len: { km: 300 },
                cal: ['Long Beach', 'Indianapolis Road Course', 'Indianapolis Motor Speedway|200', 'Texas Motor Speedway|248', 'Road America', 'Watkins Glen', 'Sonoma Raceway', 'Road Atlanta', 'Canadian Tire Motorsport Park', 'Laguna Seca'] },
            { id: 'fa', name: 'Formula A', short: 'F-A', ladder: 'formula', tier: 1, car: 'Formula A', grid: 20, teamSize: [2, 2], points: 'f1', budget: 120000000, spec: 0.85, len: { km: 305 },
                cal: ['Interlagos', 'Monza', 'Silverstone', 'Spa-Francorchamps', 'Hockenheim', 'Barcelona-Catalunya', 'Azure Circuit', 'Red Bull Ring', 'Fuji Speedway', 'Zhuhai', 'Dubai Autodrome', 'Imola', 'Nürburgring GP', 'Road America'] },
            { id: 'ginettajr', name: 'Ginetta Junior Championship', short: 'Ginetta Jr', ladder: 'gt', tier: 6, car: 'Ginetta G40 Junior', grid: 24, teamSize: [1, 2], points: 'gt', budget: 120000, spec: 0.05, len: { mins: 20 },
                cal: ['Brands Hatch Indy', 'Donington Park', 'Oulton Park', 'Snetterton', 'Knockhill', 'Cadwell Park', 'Silverstone', 'Brands Hatch'] },
            { id: 'clio', name: 'Renault Clio Cup', short: 'Clio Cup', ladder: 'gt', tier: 5, car: 'Renault Clio Cup', grid: 26, teamSize: [1, 2], points: 'btcc', budget: 200000, spec: 0.05, len: { mins: 20 }, pool: ['rd'], rounds: 10 },
            { id: 'gt4', name: 'Ginetta GT4 Supercup', short: 'GT4', ladder: 'gt', tier: 4, car: 'Ginetta G55 GT4', grid: 26, teamSize: [1, 2], points: 'gt', budget: 600000, spec: 0.05, len: { mins: 30 }, pool: ['rd'], rounds: 10 },
            { id: 'supertrofeo', name: 'Lamborghini Super Trofeo', short: 'Super Trofeo', ladder: 'gt', tier: 3, car: 'Lamborghini Huracán Super Trofeo', grid: 26, teamSize: [1, 2], points: 'gt', budget: 1000000, spec: 0.05, len: { mins: 50 }, pool: ['rd'], rounds: 10 },
            { id: 'blancpain', name: 'Blancpain GT Series', short: 'Blancpain GT', ladder: 'gt', tier: 2, car: 'GT3 (Audi R8 LMS / Porsche 911 GT3 R / McLaren 720S / Mercedes-AMG / Lamborghini / Bentley)',
                makes: ['Audi', 'Porsche', 'McLaren', 'Mercedes-AMG', 'Lamborghini', 'Bentley', 'BMW', 'Nissan'], grid: 30, teamSize: [1, 2], points: 'gt', budget: 3500000, spec: 0.35, len: { mins: 60 },
                cal: ['Monza', 'Silverstone', 'Brands Hatch', 'Spa-Francorchamps', 'Nürburgring GP', 'Zolder', 'Hockenheim', 'Barcelona-Catalunya', 'Red Bull Ring', 'Imola'] },
            { id: 'imsa', name: 'IMSA WeatherTech SportsCar Championship', short: 'IMSA', ladder: 'gt', tier: 1, car: 'GTLM (Ford GT / Porsche 911 RSR / BMW M8 / Corvette C7.R)', makes: ['Ford', 'Porsche', 'BMW', 'Chevrolet'],
                grid: 24, teamSize: [2, 2], points: 'wec', budget: 15000000, spec: 0.4, len: { mins: 120 },
                cal: ['Daytona Road Course', 'Long Beach', 'Laguna Seca', 'Watkins Glen', 'Canadian Tire Motorsport Park', 'Road America', 'Laguna Seca', 'Road Atlanta'] },
            { id: 'lmp2', name: 'LMP2 Championship', short: 'LMP2', ladder: 'endurance', tier: 2, car: 'Oreca 07 / Ligier JS P2', makes: ['Oreca', 'Ligier'], grid: 24, teamSize: [1, 2], points: 'wec', budget: 4000000, spec: 0.2, len: { mins: 120 }, pool: ['rd'], rounds: 8 },
            { id: 'lmp1', name: 'World Endurance LMP1', short: 'LMP1', ladder: 'endurance', tier: 1, car: 'LMP1 (Porsche 919 Hybrid / Toyota / Audi)', makes: ['Porsche', 'Toyota', 'Audi'], grid: 18, teamSize: [2, 3], points: 'wec', budget: 60000000, spec: 0.6, len: { mins: 240 },
                cal: ['Silverstone', 'Spa-Francorchamps', 'Circuit de la Sarthe (Le Mans)', 'Nürburgring GP', 'Road America', 'Fuji Speedway', 'Zhuhai', 'Dubai Autodrome'] },
            { id: 'rx', name: 'World Rallycross Championship', short: 'World RX', ladder: 'rx', tier: 1, car: 'Rallycross Supercar', grid: 12, teamSize: [1, 2], points: 'gt', budget: 3000000, spec: 0.3, len: { laps: 6 },
                cal: ['Lydden Hill', 'Höljes', 'Lohéac', 'Hell (Lånkebanen)', 'Lydden Hill', 'Höljes'] }
        ]
    });

    /* ============================================================
       EA SPORTS F1 (Codemasters)
       ============================================================ */
    game({
        id: 'f1', name: 'EA SPORTS F1 (F1 22 / 23 / 24 / 25)', short: 'F1', dev: 'Codemasters / EA', year: 2025, era: 2026,
        platform: 'PC / Console', color: '#e10600', icon: '🏎️', ai: AI.f1, maxGrid: 22,
        formats: ['csv', 'paste'],
        blurb: 'Codemasters’ F1 series. Start in Formula 2 and fight for a Formula 1 seat — with money, sponsors and a team to run that the game never tracks.',
        tracks: ['Albert Park', 'Shanghai', 'Suzuka', 'Bahrain', 'Jeddah Corniche', 'Miami International Autodrome', 'Imola', 'Monaco', 'Barcelona-Catalunya', 'Circuit Gilles Villeneuve',
            'Red Bull Ring', 'Silverstone', 'Spa-Francorchamps', 'Hungaroring', 'Zandvoort', 'Monza', 'Baku City Circuit', 'Marina Bay', 'Circuit of the Americas',
            'Mexico City (Hermanos Rodríguez)', 'Interlagos', 'Las Vegas Strip Circuit', 'Lusail', 'Yas Marina', 'Paul Ricard', 'Portimão'],
        series: [
            { id: 'f2', name: 'FIA Formula 2 Championship', short: 'F2', ladder: 'formula', tier: 2, car: 'Dallara F2 2024', grid: 22, teamSize: [2, 2], points: 'f2', budget: 3500000, spec: 0.08, len: { km: 170 },
                cal: ['Albert Park', 'Bahrain', 'Jeddah Corniche', 'Imola', 'Monaco', 'Barcelona-Catalunya', 'Red Bull Ring', 'Silverstone', 'Spa-Francorchamps', 'Hungaroring', 'Monza', 'Baku City Circuit', 'Lusail', 'Yas Marina'] },
            { id: 'f1', name: 'FIA Formula One World Championship', short: 'F1', ladder: 'formula', tier: 1, car: 'Formula 1 car (your team’s chassis)', grid: 20, teamSize: [2, 2], points: 'f1', budget: 140000000, spec: 1, len: { km: 305 },
                cal: ['Albert Park|58', 'Shanghai|56', 'Suzuka|53', 'Bahrain|57', 'Jeddah Corniche|50', 'Miami International Autodrome|57', 'Imola|63', 'Monaco|78', 'Barcelona-Catalunya|66',
                    'Circuit Gilles Villeneuve|70', 'Red Bull Ring|71', 'Silverstone|52', 'Spa-Francorchamps|44', 'Hungaroring|70', 'Zandvoort|72', 'Monza|53', 'Baku City Circuit|51',
                    'Marina Bay|62', 'Circuit of the Americas|56', 'Mexico City (Hermanos Rodríguez)|71', 'Interlagos|71', 'Las Vegas Strip Circuit|50', 'Lusail|57', 'Yas Marina|58'] }
        ]
    });

    /* ============================================================
       NASCAR 26 (also fits NASCAR 25)
       ============================================================ */
    game({
        id: 'nascar26', name: 'NASCAR 26', short: 'NASCAR 26', dev: 'iRacing Studios', year: 2026, era: 2026,
        platform: 'PC / Console', color: '#ffd400', icon: '🏁', ai: AI.nascar, maxGrid: 40,
        formats: ['csv', 'paste'],
        blurb: 'The modern NASCAR console/PC game (works for NASCAR 25 too). ARCA to the Cup Series with real race lengths you can scale down.',
        tracks: ['Daytona International Speedway', 'EchoPark Speedway (Atlanta)', 'Circuit of the Americas', 'Phoenix Raceway', 'Las Vegas Motor Speedway', 'Homestead-Miami Speedway',
            'Martinsville Speedway', 'Darlington Raceway', 'Bristol Motor Speedway', 'Talladega Superspeedway', 'Texas Motor Speedway', 'Kansas Speedway', 'Charlotte Motor Speedway',
            'Nashville Superspeedway', 'Michigan International Speedway', 'Mexico City (Hermanos Rodríguez)', 'Pocono Raceway', 'San Diego Street Course', 'Chicago Street Course',
            'Sonoma Raceway', 'Dover Motor Speedway', 'Indianapolis Motor Speedway', 'Iowa Speedway', 'Watkins Glen', 'Richmond Raceway', 'World Wide Technology Raceway (Gateway)',
            'New Hampshire Motor Speedway', 'Charlotte Roval', 'Rockingham Speedway', 'North Wilkesboro Speedway', 'Bowman Gray Stadium', 'Milwaukee Mile', 'Lime Rock Park',
            'Portland International Raceway', 'Lucas Oil Indianapolis Raceway Park', 'Salem Speedway', 'Berlin Raceway', 'Toledo Speedway', 'Five Flags Speedway'],
        series: [
            { id: 'arca', name: 'ARCA Menards Series', short: 'ARCA', ladder: 'stock', tier: 4, car: 'ARCA Menards car', makes: ['Chevrolet', 'Ford', 'Toyota'], grid: 28, teamSize: [1, 3],
                points: 'nascar', budget: 1300000, spec: 0.45, len: { km: 240 },
                cal: ['Daytona International Speedway|80', 'Phoenix Raceway|150', 'Talladega Superspeedway|76', 'Kansas Speedway|100', 'Charlotte Motor Speedway|80', 'Michigan International Speedway|100',
                    'Iowa Speedway|150', 'Pocono Raceway|80', 'Berlin Raceway|200', 'Toledo Speedway|200', 'Lucas Oil Indianapolis Raceway Park|200', 'Milwaukee Mile|100',
                    'Watkins Glen|30', 'Dover Motor Speedway|150', 'Salem Speedway|200', 'Five Flags Speedway|200', 'Bristol Motor Speedway|200', 'Kansas Speedway|100', 'Phoenix Raceway|150'] },
            { id: 'trucks', name: 'NASCAR Craftsman Truck Series', short: 'Trucks', ladder: 'stock', tier: 3, car: 'NASCAR Truck', makes: ['Chevrolet', 'Ford', 'Toyota', 'Ram'], grid: 36, teamSize: [1, 3],
                points: 'nascar', budget: 5000000, spec: 0.5, len: { km: 320 },
                cal: ['Daytona International Speedway|100', 'EchoPark Speedway (Atlanta)|135', 'Circuit of the Americas|42', 'Las Vegas Motor Speedway|134', 'Homestead-Miami Speedway|134',
                    'Martinsville Speedway|200', 'Rockingham Speedway|250', 'Bristol Motor Speedway|250', 'Texas Motor Speedway|167', 'Kansas Speedway|134', 'North Wilkesboro Speedway|250',
                    'Charlotte Motor Speedway|134', 'Nashville Superspeedway|150', 'Michigan International Speedway|100', 'Pocono Raceway|60', 'Lime Rock Park|70',
                    'Lucas Oil Indianapolis Raceway Park|200', 'Richmond Raceway|250', 'Milwaukee Mile|200', 'Darlington Raceway|147', 'Bristol Motor Speedway|200',
                    'World Wide Technology Raceway (Gateway)|160', 'Talladega Superspeedway|94', 'Martinsville Speedway|200', 'Phoenix Raceway|150'] },
            { id: 'oap', name: "NASCAR O'Reilly Auto Parts Series", short: 'OAP Series', ladder: 'stock', tier: 2, car: "O'Reilly Series car", makes: ['Chevrolet', 'Ford', 'Toyota'], grid: 38, teamSize: [1, 3],
                points: 'nascar', budget: 10000000, spec: 0.55, len: { km: 480 },
                cal: ['Daytona International Speedway|120', 'EchoPark Speedway (Atlanta)|163', 'Circuit of the Americas|46', 'Phoenix Raceway|200', 'Las Vegas Motor Speedway|200',
                    'Homestead-Miami Speedway|200', 'Martinsville Speedway|250', 'Darlington Raceway|147', 'Rockingham Speedway|250', 'Bristol Motor Speedway|300', 'Talladega Superspeedway|113',
                    'Texas Motor Speedway|200', 'Charlotte Motor Speedway|200', 'Nashville Superspeedway|188', 'Mexico City (Hermanos Rodríguez)|65', 'Pocono Raceway|90',
                    'Chicago Street Course|50', 'Sonoma Raceway|79', 'Dover Motor Speedway|200', 'Indianapolis Motor Speedway|100', 'Iowa Speedway|250', 'Watkins Glen|82',
                    'Daytona International Speedway|100', 'Portland International Raceway|75', 'Darlington Raceway|147', 'Bristol Motor Speedway|300', 'Kansas Speedway|200',
                    'Charlotte Roval|67', 'Las Vegas Motor Speedway|200', 'Talladega Superspeedway|113', 'Martinsville Speedway|250', 'Phoenix Raceway|200'] },
            { id: 'cup', name: 'NASCAR Cup Series', short: 'Cup', ladder: 'stock', tier: 1, car: 'Next Gen Cup car', makes: ['Chevrolet', 'Ford', 'Toyota'], grid: 40, teamSize: [1, 4],
                points: 'nascar', budget: 25000000, spec: 0.6, len: { km: 640 },
                cal: ['Daytona International Speedway|200', 'EchoPark Speedway (Atlanta)|260', 'Circuit of the Americas|95', 'Phoenix Raceway|312', 'Las Vegas Motor Speedway|267',
                    'Darlington Raceway|293', 'Martinsville Speedway|400', 'Bristol Motor Speedway|500', 'Kansas Speedway|267', 'Talladega Superspeedway|188', 'Texas Motor Speedway|267',
                    'Watkins Glen|90', 'Charlotte Motor Speedway|400', 'Nashville Superspeedway|300', 'Michigan International Speedway|200', 'Pocono Raceway|160',
                    'San Diego Street Course|100', 'Sonoma Raceway|110', 'Chicago Street Course|75', 'EchoPark Speedway (Atlanta)|260', 'North Wilkesboro Speedway|400',
                    'Indianapolis Motor Speedway|160', 'Iowa Speedway|350', 'Richmond Raceway|400', 'New Hampshire Motor Speedway|301', 'Daytona International Speedway|160',
                    'Darlington Raceway|367', 'World Wide Technology Raceway (Gateway)|240', 'Bristol Motor Speedway|500', 'Kansas Speedway|267', 'Las Vegas Motor Speedway|267',
                    'Charlotte Roval|109', 'Phoenix Raceway|312', 'Talladega Superspeedway|188', 'Martinsville Speedway|500', 'Homestead-Miami Speedway|267'] }
        ]
    });

    /* ============================================================
       GTR 2
       ============================================================ */
    game({
        id: 'gtr2', name: 'GTR 2 — FIA GT Racing Game', short: 'GTR2', dev: 'SimBin', year: 2006, era: 2004,
        platform: 'PC', color: '#b4121b', icon: '🏆', ai: AI.isi, maxGrid: 44,
        formats: ['isi-txt', 'isi-xml', 'csv', 'paste'],
        blurb: 'SimBin’s 2003–04 FIA GT masterpiece. Start in N-GT Porsches and 360s, graduate to the GT-class Saleens, Vipers and Maranellos.',
        tracks: ['Anderstorp', 'Barcelona-Catalunya', 'Brno', 'Donington Park', 'Dubai Autodrome', 'Enna-Pergusa', 'Estoril', 'Hockenheim', 'Imola', 'Magny-Cours', 'Monza',
            'Oschersleben', 'Spa-Francorchamps', 'Valencia (Ricardo Tormo)', 'Vallelunga', 'Zhuhai', 'A1-Ring'],
        series: [
            { id: 'ngt', name: 'FIA GT Championship — N-GT', short: 'N-GT', ladder: 'gt', tier: 2, car: 'N-GT (Porsche 911 GT3-RS / RSR, Ferrari 360 Modena GTC, Nissan 350Z)', makes: ['Porsche', 'Ferrari', 'Nissan'],
                grid: 22, teamSize: [1, 2], points: 'wtcc', budget: 1800000, spec: 0.45, len: { mins: 60 },
                cal: ['Monza', 'Valencia (Ricardo Tormo)', 'Magny-Cours', 'Hockenheim', 'Brno', 'Donington Park', 'Spa-Francorchamps', 'Imola', 'Oschersleben', 'Dubai Autodrome', 'Zhuhai'] },
            { id: 'gt', name: 'FIA GT Championship — GT', short: 'GT', ladder: 'gt', tier: 1, car: 'GT (Saleen S7-R, Ferrari 550 Maranello, Chrysler Viper GTS-R, Lister Storm, Lamborghini Murciélago R-GT, Maserati MC12)',
                makes: ['Saleen', 'Ferrari', 'Chrysler', 'Lister', 'Lamborghini', 'Maserati', 'Chevrolet'], grid: 22, teamSize: [1, 2], points: 'wtcc', budget: 5000000, spec: 0.55, len: { mins: 90 },
                cal: ['Monza', 'Valencia (Ricardo Tormo)', 'Magny-Cours', 'Hockenheim', 'Brno', 'Donington Park', 'Spa-Francorchamps', 'Imola', 'Oschersleben', 'Dubai Autodrome', 'Zhuhai'] },
            { id: 'spa24', name: 'FIA GT Endurance Trophy', short: 'GT Endurance', ladder: 'gt', tier: 1, car: 'GT + N-GT (overall classification)', makes: ['Saleen', 'Ferrari', 'Chrysler', 'Porsche', 'Maserati'],
                grid: 40, teamSize: [1, 2], points: 'wec', budget: 5500000, spec: 0.55, len: { mins: 180 }, cal: ['Monza', 'Spa-Francorchamps', 'Donington Park', 'Estoril', 'Anderstorp', 'Enna-Pergusa'] }
        ]
    });

    /* ============================================================
       RACE 07 (+ GTR Evolution, STCC, Race On)
       ============================================================ */
    game({
        id: 'race07', name: 'RACE 07 (+ GTR Evolution / STCC)', short: 'RACE 07', dev: 'SimBin', year: 2007, era: 2007,
        platform: 'PC', color: '#1e5aa8', icon: '🏁', ai: AI.isi, maxGrid: 30,
        formats: ['isi-txt', 'csv', 'paste'],
        blurb: 'The WTCC game and its expansions: Formula BMW and F3000 single-seaters, Swedish touring cars, WTCC and GTR Evolution GTs.',
        tracks: ['Anderstorp', 'Brands Hatch', 'Brno', 'Curitiba', 'Istanbul Park', 'Macau (Guia Circuit)', 'Magny-Cours', 'Monza', 'Oschersleben', 'Pau', 'Porto (Boavista)',
            'Puebla', 'Valencia (Ricardo Tormo)', 'Zandvoort', 'Imola', 'Mantorp Park', 'Karlskoga', 'Knutstorp', 'Falkenberg', 'Jyllandsringen', 'Nürburgring GP',
            'Nürburgring Nordschleife', 'Donington Park', 'Estoril', 'Salzburgring'],
        series: [
            { id: 'fbmw', name: 'Formula BMW', short: 'F-BMW', ladder: 'formula', tier: 2, car: 'Formula BMW FB02', grid: 24, teamSize: [2, 2], points: 'f1', budget: 450000, spec: 0.05, len: { mins: 25 }, pool: ['rd'], rounds: 10 },
            { id: 'f3000', name: 'Formula 3000', short: 'F3000', ladder: 'formula', tier: 1, car: 'Formula 3000', grid: 24, teamSize: [2, 2], points: 'f1', budget: 3500000, spec: 0.1, len: { mins: 40 }, pool: ['rd'], rounds: 10 },
            { id: 'radical', name: 'Radical SR3 Challenge', short: 'Radical', ladder: 'gt', tier: 2, car: 'Radical SR3', grid: 24, teamSize: [1, 2], points: 'gt', budget: 250000, spec: 0.05, len: { mins: 25 }, pool: ['rd'], rounds: 8 },
            { id: 'gtrevo', name: 'GTR Evolution GT Championship', short: 'GTR Evo', ladder: 'gt', tier: 1, car: 'GT2/GT (Nissan GT-R, Koenigsegg CCGT, Porsche GT2, Gumpert Apollo, Ford GT)',
                makes: ['Nissan', 'Koenigsegg', 'Porsche', 'Gumpert', 'Ford', 'Chevrolet'], grid: 24, teamSize: [1, 2], points: 'gt', budget: 4000000, spec: 0.5, len: { mins: 60 },
                cal: ['Nürburgring GP', 'Monza', 'Anderstorp', 'Brands Hatch', 'Oschersleben', 'Valencia (Ricardo Tormo)', 'Nürburgring Nordschleife', 'Donington Park'] },
            { id: 'minichallenge', name: 'MINI Challenge', short: 'MINI', ladder: 'touring', tier: 3, car: 'MINI Cooper Challenge', grid: 24, teamSize: [1, 2], points: 'wtcc', budget: 150000, spec: 0.05, len: { mins: 20 }, pool: ['rd'], rounds: 8 },
            { id: 'stcc', name: 'Swedish Touring Car Championship', short: 'STCC', ladder: 'touring', tier: 2, car: 'STCC (Volvo S60, BMW 320si, SEAT León, Audi A4)', makes: ['Volvo', 'BMW', 'SEAT', 'Audi', 'Chevrolet'],
                grid: 24, teamSize: [1, 2], points: 'wtcc', budget: 1500000, spec: 0.35, len: { mins: 25 },
                cal: ['Knutstorp', 'Mantorp Park', 'Karlskoga', 'Falkenberg', 'Anderstorp', 'Jyllandsringen', 'Karlskoga', 'Mantorp Park'] },
            { id: 'wtcc', name: 'FIA World Touring Car Championship', short: 'WTCC', ladder: 'touring', tier: 1, car: 'WTCC (BMW 320si, SEAT León, Chevrolet Lacetti, Alfa Romeo 156, Honda Accord, Peugeot 407)',
                makes: ['BMW', 'SEAT', 'Chevrolet', 'Alfa Romeo', 'Honda', 'Peugeot'], grid: 26, teamSize: [2, 3], points: 'wtcc', budget: 5000000, spec: 0.4, len: { mins: 25 },
                cal: ['Curitiba', 'Puebla', 'Zandvoort', 'Valencia (Ricardo Tormo)', 'Pau', 'Brno', 'Oschersleben', 'Brands Hatch', 'Anderstorp', 'Monza', 'Macau (Guia Circuit)'] }
        ]
    });

    /* ============================================================
       RaceRoom Racing Experience
       ============================================================ */
    game({
        id: 'rre', name: 'RaceRoom Racing Experience', short: 'RaceRoom', dev: 'KW Studios', year: 2013, era: 2026,
        platform: 'PC', color: '#ff6a00', icon: '🇩🇪', ai: AI.rre, maxGrid: 32,
        formats: ['csv', 'paste'],
        blurb: 'DTM, ADAC GT Masters, WTCR and a stack of Porsche cups on laser-scanned German and Scandinavian circuits.',
        tracks: ['Hockenheim', 'Nürburgring GP', 'Nürburgring Nordschleife', 'Norisring', 'Lausitzring', 'Oschersleben', 'Sachsenring', 'Red Bull Ring', 'Zandvoort', 'Zolder',
            'Spa-Francorchamps', 'Brands Hatch', 'Silverstone', 'Donington Park', 'Monza', 'Imola', 'Mugello', 'Misano', 'Vallelunga', 'Hungaroring', 'Slovakia Ring',
            'Moscow Raceway', 'Salzburgring', 'Anderstorp', 'Knutstorp', 'Mantorp Park', 'Karlskoga', 'Falkenberg', 'Suzuka', 'Macau (Guia Circuit)', 'Portimão',
            'Paul Ricard', 'Barcelona-Catalunya', 'MotorLand Aragón', 'Laguna Seca', 'Road America', 'Sonoma Raceway', 'Watkins Glen', 'Mount Panorama (Bathurst)',
            'Shanghai', 'Bilster Berg', 'Chang International (Buriram)', 'Most'],
        series: [
            { id: 'frjunior', name: 'Formula RaceRoom Junior', short: 'FR Junior', ladder: 'formula', tier: 4, car: 'Formula RaceRoom Junior', grid: 24, teamSize: [2, 2], points: 'f1', budget: 200000, spec: 0.05, len: { mins: 20 }, pool: ['rd'], rounds: 8 },
            { id: 'fr2', name: 'FR2 Cup', short: 'FR2', ladder: 'formula', tier: 3, car: 'Formula RaceRoom 2', grid: 24, teamSize: [2, 2], points: 'f1', budget: 700000, spec: 0.05, len: { mins: 25 }, pool: ['rd'], rounds: 10 },
            { id: 'fr3', name: 'FR3 Cup', short: 'FR3', ladder: 'formula', tier: 2, car: 'Formula RaceRoom 3', grid: 24, teamSize: [2, 2], points: 'f1', budget: 2000000, spec: 0.08, len: { mins: 35 }, pool: ['rd'], rounds: 10 },
            { id: 'frx', name: 'FR X-22 Championship', short: 'FR X-22', ladder: 'formula', tier: 1, car: 'Formula RaceRoom X-22', grid: 20, teamSize: [2, 2], points: 'f1', budget: 90000000, spec: 0.8, len: { km: 300 },
                cal: ['Hockenheim', 'Silverstone', 'Spa-Francorchamps', 'Monza', 'Red Bull Ring', 'Hungaroring', 'Zandvoort', 'Suzuka', 'Shanghai', 'Barcelona-Catalunya', 'Portimão', 'Paul Ricard'] },
            { id: 'ttcup', name: 'Audi Sport TT Cup', short: 'TT Cup', ladder: 'gt', tier: 5, car: 'Audi TT Cup', grid: 24, teamSize: [1, 2], points: 'gt', budget: 200000, spec: 0.05, len: { mins: 25 },
                cal: ['Hockenheim', 'Lausitzring', 'Norisring', 'Zandvoort', 'Nürburgring GP', 'Oschersleben', 'Red Bull Ring', 'Hockenheim'] },
            { id: 'carrera', name: 'Porsche Carrera Cup Deutschland', short: 'Carrera Cup', ladder: 'gt', tier: 4, car: 'Porsche 911 GT3 Cup (992)', grid: 28, teamSize: [1, 3], points: 'gt', budget: 1000000, spec: 0.05, len: { mins: 30 },
                cal: ['Hockenheim', 'Lausitzring', 'Norisring', 'Zandvoort', 'Nürburgring GP', 'Sachsenring', 'Red Bull Ring', 'Hockenheim'] },
            { id: 'gtr4', name: 'GTR 4 Championship', short: 'GTR 4', ladder: 'gt', tier: 3, car: 'GT4 (BMW M4 GT4 / Audi R8 LMS GT4 / Porsche 718 / Mercedes-AMG / KTM X-Bow)', makes: ['BMW', 'Audi', 'Porsche', 'Mercedes-AMG', 'KTM'],
                grid: 30, teamSize: [1, 2], points: 'gt', budget: 700000, spec: 0.3, len: { mins: 45 }, pool: ['rd'], rounds: 10 },
            { id: 'gtmasters', name: 'ADAC GT Masters', short: 'GT Masters', ladder: 'gt', tier: 2, car: 'GT3', makes: ['Audi', 'BMW', 'Mercedes-AMG', 'Porsche', 'Lamborghini', 'Ferrari', 'McLaren', 'Chevrolet'],
                grid: 30, teamSize: [1, 2], points: 'gt', budget: 3000000, spec: 0.35, len: { mins: 60 },
                cal: ['Oschersleben', 'Zandvoort', 'Hockenheim', 'Nürburgring GP', 'Lausitzring', 'Sachsenring', 'Red Bull Ring', 'Hockenheim'] },
            { id: 'dtm', name: 'DTM', short: 'DTM', ladder: 'gt', tier: 1, car: 'DTM GT3 (Audi / BMW / Mercedes-AMG / Porsche / Lamborghini / Ferrari / McLaren)', makes: ['Audi', 'BMW', 'Mercedes-AMG', 'Porsche', 'Lamborghini', 'Ferrari', 'McLaren'],
                grid: 26, teamSize: [2, 2], points: 'dtm', budget: 6000000, spec: 0.35, len: { mins: 55 },
                cal: ['Oschersleben', 'Lausitzring', 'Zandvoort', 'Norisring', 'Nürburgring GP', 'Sachsenring', 'Red Bull Ring', 'Hockenheim'] },
            { id: 'tcr', name: 'TCR Europe', short: 'TCR', ladder: 'touring', tier: 2, car: 'TCR (Audi RS3 / Hyundai Elantra N / Cupra León / Honda Civic Type R)', makes: ['Audi', 'Hyundai', 'Cupra', 'Honda', 'Lynk & Co'],
                grid: 28, teamSize: [2, 2], points: 'wtcc', budget: 1000000, spec: 0.3, len: { mins: 25 }, pool: ['rd'], rounds: 10 },
            { id: 'wtcr', name: 'FIA WTCR', short: 'WTCR', ladder: 'touring', tier: 1, car: 'WTCR TCR', makes: ['Audi', 'Hyundai', 'Cupra', 'Honda', 'Lynk & Co', 'Alfa Romeo'],
                grid: 26, teamSize: [2, 3], points: 'wtcc', budget: 4000000, spec: 0.35, len: { mins: 30 },
                cal: ['Nürburgring Nordschleife', 'Zandvoort', 'Hungaroring', 'Slovakia Ring', 'MotorLand Aragón', 'Salzburgring', 'Portimão', 'Macau (Guia Circuit)'] }
        ]
    });

    /* ============================================================
       Wreckfest
       ============================================================ */
    const WF_RACE_TRACKS = ['Big Valley Speedway', 'Bloomfield Speedway', 'Drytown Desert Circuit', 'Eagles Peak Motorpark', 'Espedalen Raceway', 'Fire Rock Raceway',
        'Firwood Motocenter', 'Hillstreet Circuit', 'Kingston Raceway', 'Motorcity Circuit', 'Northland Raceway', 'Pinehills Raceway', 'Rattlesnake Racepark',
        'Rockfield Roughspot', 'Sandstone Raceway', 'Savolax Sandpit', 'Speedbowl', 'Vale Falls Circuit', 'Glendale Countryside', 'Maasten Motoring', 'Mudford Motorpark',
        'Deathloop', 'Madman Stadium'];
    const WF_ARENAS = ['Bonebreaker Valley', 'Crash Canyon', 'Thunderbowl Arena'];
    game({
        id: 'wreckfest', name: 'Wreckfest', short: 'Wreckfest', dev: 'Bugbear', year: 2018, era: 2026,
        platform: 'PC / Console', color: '#c8641e', icon: '💥', ai: AI.wreck, maxGrid: 24,
        formats: ['paste', 'csv'],
        blurb: 'Banger racing, figure-8 carnage and last-car-standing derbies. Mixed championships score races AND wrecks.',
        tracks: WF_RACE_TRACKS.concat(WF_ARENAS),
        series: [
            { id: 'amateur', name: 'Amateur Banger Championship', short: 'Amateur', ladder: 'derby', tier: 5, car: 'C-class bangers', grid: 20, teamSize: [1, 2], points: 'wreck', budget: 40000, spec: 0.35,
                len: { laps: 5 }, format: 'mixed', pool: ['so', 'dt', 'rd', 'f8', 'ar'], rounds: 10 },
            { id: 'regional', name: 'Regional Championship', short: 'Regional', ladder: 'derby', tier: 4, car: 'C/B-class', grid: 22, teamSize: [1, 2], points: 'wreck', budget: 90000, spec: 0.4,
                len: { laps: 6 }, format: 'mixed', pool: ['so', 'dt', 'rd', 'st', 'f8', 'ar'], rounds: 10 },
            { id: 'national', name: 'National Championship', short: 'National', ladder: 'derby', tier: 3, car: 'B-class', grid: 24, teamSize: [1, 2], points: 'wreck', budget: 200000, spec: 0.45,
                len: { laps: 6 }, format: 'mixed', pool: ['so', 'dt', 'rd', 'st', 'f8', 'ar'], rounds: 12 },
            { id: 'pro', name: 'Pro Championship', short: 'Pro', ladder: 'derby', tier: 2, car: 'A-class', grid: 24, teamSize: [1, 2], points: 'wreck', budget: 450000, spec: 0.5,
                len: { laps: 7 }, format: 'mixed', pool: ['so', 'dt', 'rd', 'st', 'f8', 'ar'], rounds: 12 },
            { id: 'world', name: 'World Wreckfest Championship', short: 'World', ladder: 'derby', tier: 1, car: 'Special / Super-class', grid: 24, teamSize: [1, 2], points: 'wreck', budget: 1000000, spec: 0.55,
                len: { laps: 8 }, format: 'mixed', pool: ['so', 'dt', 'rd', 'st', 'f8', 'ar'], rounds: 14 },
            { id: 'derbyleague', name: 'Demolition Derby League', short: 'Derby League', ladder: 'derby', tier: 2, car: 'Anything with wheels', grid: 24, teamSize: [1, 2], points: 'wreck', budget: 350000, spec: 0.5,
                len: { mins: 5 }, format: 'derby', cal: ['Bonebreaker Valley', 'Crash Canyon', 'Thunderbowl Arena', 'Bonebreaker Valley', 'Crash Canyon', 'Thunderbowl Arena', 'Crash Canyon', 'Bonebreaker Valley'] },
            { id: 'figure8', name: 'Figure-8 Masters', short: 'Figure-8', ladder: 'derby', tier: 3, car: 'B-class bangers', grid: 24, teamSize: [1, 2], points: 'wreck', budget: 180000, spec: 0.45,
                len: { laps: 8 }, cal: ['Deathloop', 'Madman Stadium', 'Deathloop', 'Madman Stadium', 'Deathloop', 'Madman Stadium', 'Deathloop', 'Madman Stadium'] }
        ]
    });

    /* ============================================================
       Wreckfest 2 (Early Access)
       ============================================================ */
    game({
        id: 'wreckfest2', name: 'Wreckfest 2', short: 'Wreckfest 2', dev: 'Bugbear', year: 2025, era: 2026,
        platform: 'PC (Early Access)', color: '#e0552b', icon: '🔥', ai: AI.wreck, maxGrid: 24,
        formats: ['paste', 'csv'],
        blurb: 'The sequel in Early Access. Venue names are generic placeholders — rename them in the calendar editor to match the tracks in your build.',
        tracks: ['WF2 Speedway Oval', 'WF2 Figure-8 Stadium', 'WF2 Dirt Circuit', 'WF2 Tarmac Circuit', 'WF2 Mixed-Surface Circuit', 'WF2 Demolition Arena', 'WF2 Gravel Pit',
            'WF2 Harbor Circuit', 'WF2 Forest Rallycross', 'WF2 Canyon Circuit'],
        series: [
            { id: 'rookie', name: 'Rookie Bangers Cup', short: 'Rookie', ladder: 'derby', tier: 4, car: 'Entry-class bangers', grid: 20, teamSize: [1, 2], points: 'wreck', budget: 50000, spec: 0.35, len: { laps: 5 }, format: 'mixed', pool: ['so', 'dt', 'rd', 'rx', 'f8', 'ar'], rounds: 10 },
            { id: 'contender', name: 'Contender Series', short: 'Contender', ladder: 'derby', tier: 3, car: 'Mid-class', grid: 22, teamSize: [1, 2], points: 'wreck', budget: 150000, spec: 0.4, len: { laps: 6 }, format: 'mixed', pool: ['so', 'dt', 'rd', 'st', 'rx', 'f8', 'ar'], rounds: 10 },
            { id: 'elite', name: 'Elite Championship', short: 'Elite', ladder: 'derby', tier: 2, car: 'Top-class', grid: 24, teamSize: [1, 2], points: 'wreck', budget: 400000, spec: 0.5, len: { laps: 7 }, format: 'mixed', pool: ['so', 'dt', 'rd', 'st', 'rx', 'f8', 'ar'], rounds: 12 },
            { id: 'legends', name: 'Wreckfest Legends', short: 'Legends', ladder: 'derby', tier: 1, car: 'Specials', grid: 24, teamSize: [1, 2], points: 'wreck', budget: 900000, spec: 0.55, len: { laps: 8 }, format: 'mixed', pool: ['so', 'dt', 'rd', 'st', 'rx', 'f8', 'ar'], rounds: 12 }
        ]
    });

    /* ============================================================
       Automobilista (1)
       ============================================================ */
    game({
        id: 'ams1', name: 'Automobilista', short: 'AMS1', dev: 'Reiza Studios', year: 2016, era: 2016,
        platform: 'PC', color: '#0f9d58', icon: '🇧🇷', ai: AI.isi, maxGrid: 36,
        formats: ['isi-xml', 'csv', 'paste'],
        blurb: 'Reiza’s rFactor-engine classic — Formula Vee to Formula Extreme, Brazilian stock cars, trucks and the Super V8s.',
        tracks: ['Interlagos', 'Curitiba', 'Goiânia', 'Londrina', 'Cascavel', 'Santa Cruz do Sul', 'Tarumã', 'Velopark', 'Brasília', 'Campo Grande', 'Guaporé', 'Jacarepaguá', 'Buenos Aires', 'Velo Città'],
        series: [
            { id: 'vee', name: 'Formula Vee', short: 'F-Vee', ladder: 'formula', tier: 3, car: 'Formula Vee', grid: 24, teamSize: [1, 2], points: 'karting', budget: 70000, spec: 0.05, len: { mins: 20 }, pool: ['rd'], rounds: 8 },
            { id: 'f3', name: 'Formula 3 Brasil', short: 'F3 Brasil', ladder: 'formula', tier: 2, car: 'Dallara F309', grid: 22, teamSize: [2, 2], points: 'f1', budget: 1200000, spec: 0.08, len: { mins: 30 }, pool: ['rd'], rounds: 10 },
            { id: 'fextreme', name: 'Formula Extreme', short: 'F-Extreme', ladder: 'formula', tier: 1, car: 'Formula Extreme', grid: 20, teamSize: [2, 2], points: 'f1', budget: 80000000, spec: 0.8, len: { km: 300 }, pool: ['rd'], rounds: 12 },
            { id: 'mini', name: 'Mini Challenge Brasil', short: 'Mini', ladder: 'touring', tier: 4, car: 'MINI Cooper Challenge', grid: 24, teamSize: [1, 2], points: 'gt', budget: 150000, spec: 0.05, len: { mins: 20 }, pool: ['rd'], rounds: 8 },
            { id: 'marcas', name: 'Copa Petrobras de Marcas', short: 'Marcas', ladder: 'touring', tier: 3, car: 'Marcas (Chevrolet Cruze / Toyota Corolla / Honda Civic / Ford Focus)', makes: ['Chevrolet', 'Toyota', 'Honda', 'Ford'],
                grid: 24, teamSize: [2, 2], points: 'gt', budget: 700000, spec: 0.25, len: { mins: 25 }, pool: ['rd'], rounds: 10 },
            { id: 'trucks', name: 'Formula Truck', short: 'Trucks', ladder: 'touring', tier: 2, car: 'Formula Truck', makes: ['Iveco', 'Mercedes-Benz', 'Volkswagen', 'Volvo', 'Scania'], grid: 22, teamSize: [1, 2], points: 'gt', budget: 1100000, spec: 0.3, len: { mins: 30 }, pool: ['rd'], rounds: 10 },
            { id: 'stockcar', name: 'Stock Car Brasil', short: 'Stock Car', ladder: 'touring', tier: 1, car: 'Stock Car V8 (Chevrolet Sonic / Peugeot 408)', makes: ['Chevrolet', 'Peugeot'], grid: 32, teamSize: [2, 2], points: 'gt', budget: 3500000, spec: 0.2, len: { mins: 40 }, pool: ['rd'], rounds: 12 },
            { id: 'superv8', name: 'Super V8', short: 'Super V8', ladder: 'touring', tier: 1, car: 'Super V8 (Aussie-style saloon)', makes: ['Holden-style', 'Ford-style'], grid: 26, teamSize: [2, 2], points: 'gt', budget: 5000000, spec: 0.35, len: { mins: 40 }, pool: ['rd'], rounds: 10 }
        ]
    });

    /* ============================================================
       rFactor 2
       ============================================================ */
    game({
        id: 'rf2', name: 'rFactor 2', short: 'rF2', dev: 'Studio 397', year: 2013, era: 2026,
        platform: 'PC', color: '#3a3f99', icon: '⚙️', ai: AI.isi, maxGrid: 50,
        formats: ['isi-xml', 'csv', 'paste'],
        blurb: 'The ISI-engine powerhouse: USF2000 up to IndyCar, BTCC, GTs and prototypes — plus any mod you throw at it.',
        tracks: ['Sebring', 'Road America', 'Silverstone', 'Spa-Francorchamps', 'Monza', 'Portimão', 'Imola', 'Barcelona-Catalunya', 'Circuit de la Sarthe (Le Mans)',
            'Mount Panorama (Bathurst)', 'Indianapolis Motor Speedway', 'Indianapolis Road Course', 'Mid-Ohio', 'Lime Rock Park', 'Brands Hatch', 'Donington Park',
            'Oulton Park', 'Snetterton', 'Thruxton', 'Knockhill', 'Croft', 'Daytona International Speedway', 'Daytona Road Course', 'Nürburgring GP', 'Mills Metropark',
            'Toban Raceway Park', 'Lienz Festival', 'Road Atlanta', 'Laguna Seca'],
        series: [
            { id: 'usf2000', name: 'USF2000 Championship', short: 'USF2000', ladder: 'formula', tier: 5, car: 'Tatuus USF-17', grid: 24, teamSize: [2, 3], points: 'indycar', budget: 450000, spec: 0.05, len: { mins: 25 },
                cal: ['Sebring', 'Road America', 'Indianapolis Road Course', 'Mid-Ohio', 'Lime Rock Park', 'Road Atlanta', 'Laguna Seca', 'Mills Metropark'] },
            { id: 'f3', name: 'Tatuus F.3 Championship', short: 'F.3', ladder: 'formula', tier: 4, car: 'Tatuus MSV F3-020', grid: 24, teamSize: [2, 3], points: 'f1', budget: 1400000, spec: 0.08, len: { mins: 30 }, pool: ['rd'], rounds: 10 },
            { id: 'fr35', name: 'Formula Renault 3.5', short: 'FR3.5', ladder: 'formula', tier: 3, car: 'Formula Renault 3.5', grid: 24, teamSize: [2, 2], points: 'f1', budget: 2800000, spec: 0.08, len: { mins: 40 }, pool: ['rd'], rounds: 10 },
            { id: 'indycar', name: 'IndyCar Series', short: 'IndyCar', ladder: 'formula', tier: 2, car: 'Dallara IR-18', makes: ['Chevrolet', 'Honda'], grid: 26, teamSize: [1, 4], points: 'indycar', budget: 14000000, spec: 0.3, len: { km: 300 },
                cal: ['Sebring', 'Indianapolis Road Course', 'Indianapolis Motor Speedway|200', 'Road America', 'Mid-Ohio', 'Laguna Seca', 'Road Atlanta', 'Portimão'] },
            { id: 'fpro', name: 'Formula Pro', short: 'F-Pro', ladder: 'formula', tier: 1, car: 'Formula Pro (modern GP car)', grid: 20, teamSize: [2, 2], points: 'f1', budget: 100000000, spec: 0.85, len: { km: 305 },
                cal: ['Silverstone', 'Spa-Francorchamps', 'Monza', 'Portimão', 'Imola', 'Barcelona-Catalunya', 'Nürburgring GP', 'Sebring', 'Road America', 'Mount Panorama (Bathurst)'] },
            { id: 'porsche', name: 'Porsche Carrera Cup', short: 'Carrera Cup', ladder: 'gt', tier: 4, car: 'Porsche 911 GT3 Cup', grid: 26, teamSize: [1, 3], points: 'gt', budget: 950000, spec: 0.05, len: { mins: 30 }, pool: ['rd'], rounds: 10 },
            { id: 'gt3', name: 'GT3 Challenge', short: 'GT3', ladder: 'gt', tier: 3, car: 'GT3', makes: ['Porsche', 'BMW', 'Mercedes-AMG', 'McLaren', 'Bentley', 'Aston Martin', 'Callaway'], grid: 30, teamSize: [1, 2], points: 'gt', budget: 3200000, spec: 0.35, len: { mins: 60 }, pool: ['rd'], rounds: 10 },
            { id: 'gte', name: 'GTE Pro Series', short: 'GTE', ladder: 'gt', tier: 2, car: 'GTE (Porsche RSR / Ferrari 488 GTE / Aston Martin / Corvette C8.R)', makes: ['Porsche', 'Ferrari', 'Aston Martin', 'Chevrolet', 'BMW'],
                grid: 22, teamSize: [2, 2], points: 'wec', budget: 12000000, spec: 0.4, len: { mins: 90 }, pool: ['rd'], rounds: 8 },
            { id: 'lmp2', name: 'LMP2 Championship', short: 'LMP2', ladder: 'endurance', tier: 2, car: 'Oreca 07', grid: 24, teamSize: [1, 2], points: 'wec', budget: 4500000, spec: 0.12, len: { mins: 120 }, pool: ['rd'], rounds: 8 },
            { id: 'hypercar', name: 'Hypercar World Endurance', short: 'Hypercar', ladder: 'endurance', tier: 1, car: 'Hypercar / LMDh', makes: ['Toyota', 'Ferrari', 'Porsche', 'Peugeot', 'Cadillac', 'BMW'], grid: 20, teamSize: [2, 2], points: 'wec', budget: 60000000, spec: 0.4, len: { mins: 240 },
                cal: ['Sebring', 'Portimão', 'Spa-Francorchamps', 'Circuit de la Sarthe (Le Mans)', 'Monza', 'Imola', 'Road America', 'Daytona Road Course'] },
            { id: 'btcc', name: 'British Touring Car Championship', short: 'BTCC', ladder: 'touring', tier: 1, car: 'BTCC NGTC (Toyota Corolla / BMW 330i / Honda Civic / Ford Focus / Hyundai i30N)', makes: ['Toyota', 'BMW', 'Honda', 'Ford', 'Hyundai', 'Cupra'],
                grid: 28, teamSize: [2, 3], points: 'btcc', budget: 2500000, spec: 0.25, len: { mins: 25 },
                cal: ['Donington Park', 'Brands Hatch', 'Thruxton', 'Oulton Park', 'Croft', 'Knockhill', 'Snetterton', 'Thruxton', 'Silverstone', 'Brands Hatch'] }
        ]
    });

    /* ============================================================
       Le Mans Ultimate
       ============================================================ */
    game({
        id: 'lmu', name: 'Le Mans Ultimate', short: 'LMU', dev: 'Studio 397 / Motorsport Games', year: 2024, era: 2026,
        platform: 'PC', color: '#0033a0', icon: '⏱️', ai: AI.isi, maxGrid: 60,
        formats: ['isi-xml', 'csv', 'paste'],
        blurb: 'The official WEC game — climb from the ELMS LMP3 class through LMGT3 and LMP2 to a factory Hypercar seat.',
        tracks: ['Lusail', 'Imola', 'Spa-Francorchamps', 'Circuit de la Sarthe (Le Mans)', 'Interlagos', 'Circuit of the Americas', 'Fuji Speedway', 'Bahrain', 'Monza', 'Sebring', 'Portimão', 'Barcelona-Catalunya', 'Paul Ricard', 'Silverstone'],
        series: [
            { id: 'lmp3', name: 'European Le Mans Series — LMP3', short: 'ELMS LMP3', ladder: 'endurance', tier: 4, car: 'Ligier JS P325 / Ginetta G61 / Duqueine D09', makes: ['Ligier', 'Ginetta', 'Duqueine'],
                grid: 24, teamSize: [1, 2], points: 'wec', budget: 1200000, spec: 0.12, len: { mins: 120 }, dlc: 'ELMS pack', cal: ['Barcelona-Catalunya', 'Paul Ricard', 'Imola', 'Spa-Francorchamps', 'Silverstone', 'Portimão'] },
            { id: 'lmgt3', name: 'FIA WEC — LMGT3', short: 'LMGT3', ladder: 'endurance', tier: 3, car: 'LMGT3 (Porsche 911 GT3 R / Ferrari 296 / BMW M4 / Corvette Z06 / Aston Martin / Lexus / McLaren / Ford Mustang)',
                makes: ['Porsche', 'Ferrari', 'BMW', 'Chevrolet', 'Aston Martin', 'Lexus', 'McLaren', 'Ford'], grid: 18, teamSize: [1, 2], points: 'wec', budget: 5000000, spec: 0.3, len: { mins: 180 },
                cal: ['Lusail', 'Imola', 'Spa-Francorchamps', 'Circuit de la Sarthe (Le Mans)', 'Interlagos', 'Circuit of the Americas', 'Fuji Speedway', 'Bahrain'] },
            { id: 'lmp2', name: 'European Le Mans Series — LMP2', short: 'LMP2', ladder: 'endurance', tier: 2, car: 'Oreca 07 Gibson', grid: 22, teamSize: [1, 2], points: 'wec', budget: 4500000, spec: 0.1, len: { mins: 180 },
                cal: ['Barcelona-Catalunya', 'Paul Ricard', 'Imola', 'Spa-Francorchamps', 'Silverstone', 'Portimão', 'Circuit de la Sarthe (Le Mans)'] },
            { id: 'hypercar', name: 'FIA WEC — Hypercar', short: 'Hypercar', ladder: 'endurance', tier: 1, car: 'Hypercar (Toyota GR010 / Ferrari 499P / Porsche 963 / Cadillac / BMW / Peugeot 9X8 / Alpine / Aston Martin Valkyrie)',
                makes: ['Toyota', 'Ferrari', 'Porsche', 'Cadillac', 'BMW', 'Peugeot', 'Alpine', 'Aston Martin'], grid: 20, teamSize: [2, 2], points: 'wec', budget: 70000000, spec: 0.35, len: { mins: 360 },
                cal: ['Lusail', 'Imola', 'Spa-Francorchamps', 'Circuit de la Sarthe (Le Mans)', 'Interlagos', 'Circuit of the Americas', 'Fuji Speedway', 'Bahrain'] }
        ]
    });

    /* ============================================================
       rFactor (1)
       ============================================================ */
    game({
        id: 'rf1', name: 'rFactor', short: 'rFactor', dev: 'Image Space Inc.', year: 2005, era: 2008,
        platform: 'PC', color: '#4b5bd4', icon: '⚙️', ai: AI.isi, maxGrid: 40,
        formats: ['isi-xml', 'csv', 'paste'],
        blurb: 'The ultimate mod platform. Series here are generic ladders — load whichever mod pack you race and rename tracks/cars to match.',
        tracks: ['Mills Metropark', 'Joesville Speedway', 'Toban Raceway Park', 'Lienz Festival', 'Orchard Lake', 'Essington Park', 'Silverstone', 'Spa-Francorchamps', 'Monza',
            'Barcelona-Catalunya', 'Hockenheim', 'Nürburgring GP', 'Interlagos', 'Suzuka', 'Imola', 'Magny-Cours', 'Hungaroring', 'Istanbul Park', 'Sepang', 'Bahrain',
            'Albert Park', 'Monaco', 'Circuit Gilles Villeneuve', 'Shanghai', 'Red Bull Ring', 'Daytona International Speedway', 'Talladega Superspeedway', 'Charlotte Motor Speedway',
            'Bristol Motor Speedway', 'Martinsville Speedway', 'Texas Motor Speedway', 'Phoenix International Raceway', 'Watkins Glen'],
        series: [
            { id: 'fr20', name: 'Formula Renault 2.0 (mod)', short: 'FR2.0', ladder: 'formula', tier: 4, car: 'Formula Renault 2.0', grid: 26, teamSize: [2, 2], points: 'f1', budget: 400000, spec: 0.05, len: { mins: 25 }, pool: ['rd'], rounds: 10, mod: 'Formula Renault mod' },
            { id: 'f3', name: 'Formula 3 Euroseries (mod)', short: 'F3', ladder: 'formula', tier: 3, car: 'F3 Dallara', grid: 26, teamSize: [2, 3], points: 'f1', budget: 1500000, spec: 0.08, len: { mins: 30 }, pool: ['rd'], rounds: 10, mod: 'F3 mod' },
            { id: 'gp2', name: 'GP2 Series (mod)', short: 'GP2', ladder: 'formula', tier: 2, car: 'GP2 Dallara', grid: 26, teamSize: [2, 2], points: 'f1', budget: 4000000, spec: 0.08, len: { km: 180 }, pool: ['rd', 'st'], rounds: 12, mod: 'GP2 mod' },
            { id: 'f1', name: 'Formula One (mod)', short: 'F1', ladder: 'formula', tier: 1, car: 'F1 mod of your choice', grid: 22, teamSize: [2, 2], points: 'f1', budget: 140000000, spec: 0.9, len: { km: 305 },
                cal: ['Bahrain', 'Albert Park', 'Sepang', 'Shanghai', 'Barcelona-Catalunya', 'Monaco', 'Istanbul Park', 'Circuit Gilles Villeneuve', 'Magny-Cours', 'Silverstone', 'Hockenheim', 'Hungaroring', 'Spa-Francorchamps', 'Monza', 'Suzuka', 'Interlagos'], mod: 'F1 mod' },
            { id: 'late', name: 'Late Model Series (mod)', short: 'Late Models', ladder: 'stock', tier: 3, car: 'Late Model mod', grid: 26, teamSize: [1, 2], points: 'arca', budget: 200000, spec: 0.3, len: { laps: 100 }, pool: ['so'], rounds: 10, mod: 'Late Model mod' },
            { id: 'stock', name: 'Stock Car Series (mod)', short: 'Stock', ladder: 'stock', tier: 2, car: 'NASCAR-style mod', grid: 36, teamSize: [1, 3], points: 'nascar', budget: 8000000, spec: 0.5, len: { km: 400 }, pool: ['ss', 'ov', 'so'], rounds: 14, mod: 'Stock car mod' },
            { id: 'cup', name: 'Cup Series (mod)', short: 'Cup', ladder: 'stock', tier: 1, car: 'Cup mod', grid: 40, teamSize: [1, 4], points: 'nascar', budget: 22000000, spec: 0.6, len: { km: 600 }, pool: ['ss', 'ov', 'so', 'rd'], rounds: 18, mod: 'Cup mod' },
            { id: 'fisi', name: 'Formula ISI', short: 'F-ISI', ladder: 'custom', tier: 1, car: 'Formula ISI (base content)', grid: 22, teamSize: [2, 2], points: 'f1', budget: 20000000, spec: 0.5, len: { mins: 40 }, pool: ['rd', 'st'], rounds: 10 }
        ]
    });

    /* ============================================================
       Gran Turismo 7
       ============================================================ */
    game({
        id: 'gt7', name: 'Gran Turismo 7', short: 'GT7', dev: 'Polyphony Digital', year: 2022, era: 2026,
        platform: 'PS5 / PS4', color: '#0070d1', icon: '🎮', ai: AI.gt7, maxGrid: 20,
        formats: ['paste'],
        blurb: 'Custom races with GT7’s AI — Sunday Cup bangers up to Gr.1 prototypes and Super Formula. The app keeps the career GT7 never had.',
        tracks: ['Suzuka', 'Fuji Speedway', 'Monza', 'Spa-Francorchamps', 'Nürburgring GP', 'Nürburgring Nordschleife', 'Circuit de la Sarthe (Le Mans)', 'Interlagos',
            'Mount Panorama (Bathurst)', 'Laguna Seca', 'Daytona Road Course', 'Daytona International Speedway', 'Watkins Glen', 'Willow Springs', 'Tsukuba', 'Brands Hatch',
            'Barcelona-Catalunya', 'Red Bull Ring', 'Road Atlanta', 'Autopolis', 'Autodrome Lago Maggiore', 'Dragon Trail', 'Trial Mountain Circuit', 'Deep Forest Raceway',
            'High Speed Ring', 'Grand Valley Highway', 'Tokyo Expressway', 'Kyoto Driving Park', 'Alsace Village', 'Sardegna Road Track', 'Special Stage Route X',
            "Fisherman's Ranch", 'Colorado Springs Lake', 'Yas Marina'],
        series: [
            { id: 'sunday', name: 'Sunday Cup', short: 'Sunday Cup', ladder: 'gt', tier: 6, car: 'N100–N300 road cars', grid: 16, teamSize: [1, 2], points: 'gt', budget: 30000, spec: 0.5, len: { laps: 5 }, pool: ['rd'], rounds: 8 },
            { id: 'clubman', name: 'Clubman Cup Plus', short: 'Clubman', ladder: 'gt', tier: 5, car: 'N400–N600 sports cars', grid: 16, teamSize: [1, 2], points: 'gt', budget: 90000, spec: 0.5, len: { laps: 8 }, pool: ['rd'], rounds: 8 },
            { id: 'gr4', name: 'Gr.4 Cup', short: 'Gr.4', ladder: 'gt', tier: 4, car: 'Gr.4 (GT4-class)', makes: ['Porsche', 'BMW', 'Mazda', 'Toyota', 'Mercedes-AMG', 'Nissan', 'Subaru', 'Ford'], grid: 20, teamSize: [1, 2], points: 'gt', budget: 600000, spec: 0.3, len: { laps: 10 }, pool: ['rd'], rounds: 10 },
            { id: 'gr3', name: 'Gr.3 World Series', short: 'Gr.3', ladder: 'gt', tier: 3, car: 'Gr.3 (GT3-class)', makes: ['Porsche', 'Ferrari', 'BMW', 'Mercedes-AMG', 'Nissan', 'Toyota', 'Honda', 'Lamborghini', 'Audi', 'McLaren'],
                grid: 20, teamSize: [1, 2], points: 'gt', budget: 3000000, spec: 0.35, len: { laps: 15 }, pool: ['rd'], rounds: 10 },
            { id: 'gt500', name: 'Gr.2 GT500 Series', short: 'GT500', ladder: 'gt', tier: 2, car: 'Super GT GT500', makes: ['Toyota', 'Nissan', 'Honda'], grid: 16, teamSize: [2, 2], points: 'supergt', budget: 12000000, spec: 0.35, len: { laps: 20 },
                cal: ['Fuji Speedway', 'Suzuka', 'Autopolis', 'Fuji Speedway', 'Suzuka', 'Autopolis', 'Fuji Speedway', 'Suzuka'] },
            { id: 'gr1', name: 'Gr.1 Prototype Series', short: 'Gr.1', ladder: 'gt', tier: 1, car: 'Gr.1 (LMP1 / Group C / Vision GT)', makes: ['Toyota', 'Porsche', 'Audi', 'Mazda', 'Nissan', 'Peugeot', 'Jaguar'],
                grid: 18, teamSize: [2, 2], points: 'wec', budget: 45000000, spec: 0.55, len: { laps: 20 }, cal: ['Circuit de la Sarthe (Le Mans)', 'Spa-Francorchamps', 'Fuji Speedway', 'Suzuka', 'Monza', 'Interlagos', 'Daytona Road Course', 'Nürburgring GP', 'Mount Panorama (Bathurst)'] },
            { id: 'sf', name: 'Super Formula', short: 'Super Formula', ladder: 'formula', tier: 2, car: 'Super Formula SF23', grid: 20, teamSize: [2, 2], points: 'f1', budget: 9000000, spec: 0.15, len: { laps: 20 }, cal: ['Suzuka', 'Autopolis', 'Fuji Speedway', 'Suzuka', 'Fuji Speedway', 'Autopolis'] },
            { id: 'fgt', name: 'Formula Gran Turismo', short: 'F-GT', ladder: 'formula', tier: 1, car: 'Gran Turismo F1500T-A', grid: 20, teamSize: [2, 2], points: 'f1', budget: 100000000, spec: 0.8, len: { laps: 25 },
                cal: ['Monza', 'Spa-Francorchamps', 'Suzuka', 'Interlagos', 'Red Bull Ring', 'Barcelona-Catalunya', 'Yas Marina', 'Laguna Seca', 'Autodrome Lago Maggiore', 'Dragon Trail'] }
        ]
    });

    /* ============================================================
       Forza Motorsport
       ============================================================ */
    game({
        id: 'forza', name: 'Forza Motorsport', short: 'Forza', dev: 'Turn 10', year: 2023, era: 2026,
        platform: 'Xbox / PC', color: '#e6b31e', icon: '🎮', ai: AI.forza, maxGrid: 24,
        formats: ['paste'],
        blurb: 'Free-play races against Drivatars, organised into proper touring, GT, prototype and open-wheel championships.',
        tracks: ['Maple Valley', 'Grand Oak Raceway', 'Hakone Circuit', 'Eaglerock Speedway', 'Spa-Francorchamps', 'Silverstone', 'Suzuka', 'Laguna Seca', 'Road America',
            'Watkins Glen', 'Circuit de la Sarthe (Le Mans)', 'Nürburgring GP', 'Nürburgring Nordschleife', 'Kyalami', 'Road Atlanta', 'Mid-Ohio', 'Virginia International Raceway',
            'Lime Rock Park', 'Hockenheim', 'Barcelona-Catalunya', 'Yas Marina', 'Mugello', 'Daytona International Speedway', 'Homestead-Miami Speedway', 'Indianapolis Motor Speedway', 'Mount Panorama (Bathurst)'],
        series: [
            { id: 'compact', name: 'Sport Compact Tour', short: 'Compact', ladder: 'touring', tier: 3, car: 'Hot hatches & compacts (E/D class)', grid: 20, teamSize: [1, 2], points: 'gt', budget: 60000, spec: 0.5, len: { laps: 5 }, pool: ['rd'], rounds: 8 },
            { id: 'tcr', name: 'Touring Car Tour', short: 'TCR', ladder: 'touring', tier: 2, car: 'TCR touring cars', makes: ['Audi', 'Honda', 'Hyundai', 'Volkswagen'], grid: 22, teamSize: [1, 2], points: 'btcc', budget: 800000, spec: 0.3, len: { laps: 8 }, pool: ['rd'], rounds: 10 },
            { id: 'gt4', name: 'GT4 Tour', short: 'GT4', ladder: 'gt', tier: 3, car: 'GT4', makes: ['Porsche', 'BMW', 'McLaren', 'Aston Martin', 'Toyota'], grid: 22, teamSize: [1, 2], points: 'gt', budget: 700000, spec: 0.3, len: { laps: 8 }, pool: ['rd'], rounds: 10 },
            { id: 'gt3', name: 'Forza GT Championship', short: 'Forza GT', ladder: 'gt', tier: 2, car: 'GT3', makes: ['Porsche', 'Ferrari', 'BMW', 'Mercedes-AMG', 'Audi', 'Lamborghini', 'McLaren', 'Chevrolet', 'Ford'], grid: 24, teamSize: [1, 2], points: 'gt', budget: 3200000, spec: 0.35, len: { laps: 12 }, pool: ['rd'], rounds: 10 },
            { id: 'proto', name: 'Prototype Championship', short: 'Prototype', ladder: 'gt', tier: 1, car: 'LMDh / LMP / DPi', makes: ['Porsche', 'Cadillac', 'Acura', 'Mazda', 'Audi'], grid: 20, teamSize: [2, 2], points: 'wec', budget: 30000000, spec: 0.4, len: { laps: 15 },
                cal: ['Road Atlanta', 'Laguna Seca', 'Watkins Glen', 'Road America', 'Circuit de la Sarthe (Le Mans)', 'Spa-Francorchamps', 'Suzuka', 'Kyalami'] },
            { id: 'fmazda', name: 'Formula Mazda Series', short: 'F-Mazda', ladder: 'formula', tier: 2, car: 'Formula Mazda', grid: 22, teamSize: [2, 2], points: 'indycar', budget: 400000, spec: 0.05, len: { laps: 10 }, pool: ['rd'], rounds: 8 },
            { id: 'indycar', name: 'IndyCar Series', short: 'IndyCar', ladder: 'formula', tier: 1, car: 'Dallara IR-18', makes: ['Chevrolet', 'Honda'], grid: 24, teamSize: [1, 3], points: 'indycar', budget: 13000000, spec: 0.3, len: { laps: 25 },
                cal: ['Indianapolis Motor Speedway', 'Road America', 'Mid-Ohio', 'Laguna Seca', 'Road Atlanta', 'Homestead-Miami Speedway', 'Watkins Glen', 'Virginia International Raceway'] }
        ]
    });

    /* ============================================================
       BeamNG.drive
       ============================================================ */
    game({
        id: 'beamng', name: 'BeamNG.drive', short: 'BeamNG', dev: 'BeamNG GmbH', year: 2015, era: 2026,
        platform: 'PC', color: '#ff7a00', icon: '🧪', ai: AI.beamng, maxGrid: 16,
        formats: ['paste'],
        blurb: 'Soft-body physics with AI traffic and racers — short-track stock cars, derbies and rally, all tracked here.',
        tracks: ['West Coast USA', 'Italy (BeamNG)', 'Utah', 'Jungle Rock Island', 'Automation Test Track', 'Hirochi Raceway', 'East Coast USA', 'Johnson Valley', 'Derby Arena', 'Gridmap Oval'],
        series: [
            { id: 'streetstock', name: 'Street Stock Nationals', short: 'Street Stock', ladder: 'stock', tier: 2, car: 'Bruckell / Gavril street stocks', grid: 12, teamSize: [1, 2], points: 'arca', budget: 60000, spec: 0.3, len: { laps: 20 }, pool: ['so', 'rd'], rounds: 8 },
            { id: 'touring', name: 'Hirochi Touring Cup', short: 'Touring', ladder: 'stock', tier: 1, car: 'Hirochi / ETK touring racers', grid: 14, teamSize: [1, 2], points: 'gt', budget: 250000, spec: 0.35, len: { laps: 10 }, pool: ['rd'], rounds: 8 },
            { id: 'derby', name: 'Demolition Derby Series', short: 'Derby', ladder: 'derby', tier: 1, car: 'Whatever survives', grid: 12, teamSize: [1, 2], points: 'wreck', budget: 40000, spec: 0.4, len: { mins: 5 }, format: 'derby', cal: ['Derby Arena', 'Derby Arena', 'Derby Arena', 'Derby Arena', 'Derby Arena', 'Derby Arena'] },
            { id: 'rally', name: 'Dirt Rally Cup', short: 'Rally', ladder: 'rally', tier: 1, car: 'Rally-prepped hatchbacks', grid: 12, teamSize: [1, 2], points: 'rally', budget: 150000, spec: 0.35, len: { stages: 4 }, format: 'rally', cal: ['Utah', 'Johnson Valley', 'Jungle Rock Island', 'Italy (BeamNG)', 'Utah', 'Johnson Valley'] }
        ]
    });

    /* ============================================================
       NASCAR Heat 5
       ============================================================ */
    game({
        id: 'heat5', name: 'NASCAR Heat 5', short: 'Heat 5', dev: '704Games', year: 2020, era: 2020,
        platform: 'PC / Console', color: '#1d4ed8', icon: '🏁', ai: AI.nascar, maxGrid: 40,
        formats: ['paste', 'csv'],
        blurb: 'Xtreme Dirt Tour through Trucks and Xfinity to the Cup Series — the Heat career, with real money and team management bolted on.',
        tracks: ['Daytona International Speedway', 'Las Vegas Motor Speedway', 'Auto Club Speedway', 'Phoenix Raceway', 'Atlanta Motor Speedway', 'Homestead-Miami Speedway',
            'Texas Motor Speedway', 'Bristol Motor Speedway', 'Richmond Raceway', 'Talladega Superspeedway', 'Dover International Speedway', 'Martinsville Speedway',
            'Charlotte Motor Speedway', 'Kansas Speedway', 'Michigan International Speedway', 'Sonoma Raceway', 'Chicagoland Speedway', 'Kentucky Speedway',
            'New Hampshire Motor Speedway', 'Pocono Raceway', 'Watkins Glen', 'Indianapolis Motor Speedway', 'Darlington Raceway', 'Charlotte Roval', 'Iowa Speedway',
            'World Wide Technology Raceway (Gateway)', 'Eldora Speedway', 'Canyon Ridge Dirt Oval', 'Riverbend Dirt Speedway'],
        series: [
            { id: 'xdt', name: 'Xtreme Dirt Tour', short: 'XDT', ladder: 'stock', tier: 4, car: 'Dirt super late model', grid: 20, teamSize: [1, 1], points: 'arca', budget: 150000, spec: 0.3, len: { laps: 30 },
                cal: ['Eldora Speedway', 'Canyon Ridge Dirt Oval', 'Riverbend Dirt Speedway', 'Eldora Speedway', 'Canyon Ridge Dirt Oval', 'Riverbend Dirt Speedway', 'Eldora Speedway', 'Canyon Ridge Dirt Oval'] },
            { id: 'trucks', name: 'Gander Outdoors Truck Series', short: 'Trucks', ladder: 'stock', tier: 3, car: 'NASCAR Truck', makes: ['Chevrolet', 'Ford', 'Toyota'], grid: 32, teamSize: [1, 3], points: 'nascar', budget: 4500000, spec: 0.5, len: { km: 300 },
                cal: ['Daytona International Speedway|100', 'Las Vegas Motor Speedway|134', 'Atlanta Motor Speedway|130', 'Homestead-Miami Speedway|134', 'Texas Motor Speedway|167', 'Kansas Speedway|167',
                    'Charlotte Motor Speedway|134', 'World Wide Technology Raceway (Gateway)|160', 'Iowa Speedway|200', 'Kentucky Speedway|150', 'Pocono Raceway|60', 'Eldora Speedway|150',
                    'Michigan International Speedway|100', 'Bristol Motor Speedway|200', 'Richmond Raceway|250', 'Talladega Superspeedway|94', 'Martinsville Speedway|200', 'Phoenix Raceway|150'] },
            { id: 'xfinity', name: 'Xfinity Series', short: 'Xfinity', ladder: 'stock', tier: 2, car: 'Xfinity car', makes: ['Chevrolet', 'Ford', 'Toyota'], grid: 38, teamSize: [1, 3], points: 'nascar', budget: 9000000, spec: 0.55, len: { km: 480 },
                cal: ['Daytona International Speedway|120', 'Las Vegas Motor Speedway|200', 'Auto Club Speedway|150', 'Phoenix Raceway|200', 'Atlanta Motor Speedway|163', 'Homestead-Miami Speedway|200',
                    'Texas Motor Speedway|200', 'Bristol Motor Speedway|300', 'Richmond Raceway|250', 'Talladega Superspeedway|113', 'Dover International Speedway|200', 'Charlotte Motor Speedway|200',
                    'Pocono Raceway|100', 'Michigan International Speedway|125', 'Iowa Speedway|250', 'Chicagoland Speedway|200', 'Daytona International Speedway|100', 'Kentucky Speedway|200',
                    'New Hampshire Motor Speedway|200', 'Watkins Glen|82', 'Indianapolis Motor Speedway|100', 'Darlington Raceway|147', 'Richmond Raceway|250', 'Las Vegas Motor Speedway|200',
                    'Charlotte Roval|67', 'Dover International Speedway|200', 'Kansas Speedway|200', 'Texas Motor Speedway|200', 'Martinsville Speedway|250', 'Phoenix Raceway|200'] },
            { id: 'cup', name: 'NASCAR Cup Series', short: 'Cup', ladder: 'stock', tier: 1, car: 'Gen-6 Cup car', makes: ['Chevrolet', 'Ford', 'Toyota'], grid: 40, teamSize: [1, 4], points: 'nascar', budget: 22000000, spec: 0.6, len: { km: 640 },
                cal: ['Daytona International Speedway|200', 'Las Vegas Motor Speedway|267', 'Auto Club Speedway|200', 'Phoenix Raceway|312', 'Atlanta Motor Speedway|325', 'Homestead-Miami Speedway|267',
                    'Texas Motor Speedway|334', 'Bristol Motor Speedway|500', 'Richmond Raceway|400', 'Talladega Superspeedway|188', 'Dover International Speedway|400', 'Martinsville Speedway|500',
                    'Charlotte Motor Speedway|400', 'Kansas Speedway|267', 'Michigan International Speedway|200', 'Sonoma Raceway|90', 'Chicagoland Speedway|267', 'Daytona International Speedway|160',
                    'Kentucky Speedway|267', 'New Hampshire Motor Speedway|301', 'Pocono Raceway|160', 'Watkins Glen|90', 'Indianapolis Motor Speedway|160', 'Darlington Raceway|367',
                    'Richmond Raceway|400', 'Las Vegas Motor Speedway|267', 'Charlotte Roval|109', 'Dover International Speedway|400', 'Talladega Superspeedway|188', 'Kansas Speedway|267',
                    'Texas Motor Speedway|334', 'Martinsville Speedway|500', 'Phoenix Raceway|312'] }
        ]
    });

    /* ============================================================
       EA SPORTS WRC
       ============================================================ */
    game({
        id: 'eawrc', name: 'EA SPORTS WRC', short: 'EA WRC', dev: 'Codemasters / EA', year: 2023, era: 2026,
        platform: 'PC / Console', color: '#00a3e0', icon: '🌲', ai: AI.rally, maxGrid: 30,
        formats: ['paste', 'csv'],
        blurb: 'Rally careers from Junior WRC to Rally1. Log your overall classification after each rally — the app runs the championship around it.',
        tracks: ['Rally Monte-Carlo', 'Rally Sweden', 'Rally Mexico', 'Croatia Rally', 'Rally de Portugal', 'Rally Italia Sardegna', 'Safari Rally Kenya', 'Rally Estonia', 'Rally Finland',
            'Acropolis Rally Greece', 'Rally Chile', 'Central European Rally', 'Rally Japan', 'Rally Poland', 'Rally Latvia', 'Rally Oceania', 'Rally Scandia', 'Rally Mediterraneo',
            'Rally Pacifico', 'Rally Iberia'],
        series: [
            { id: 'jwrc', name: 'Junior WRC (Rally4)', short: 'JWRC', ladder: 'rally', tier: 3, car: 'Ford Fiesta Rally4', grid: 16, teamSize: [1, 1], points: 'rally', budget: 350000, spec: 0.05, len: { stages: 6 }, format: 'rally',
                cal: ['Rally Sweden', 'Croatia Rally', 'Rally Italia Sardegna', 'Rally Estonia', 'Acropolis Rally Greece', 'Central European Rally'] },
            { id: 'wrc2', name: 'WRC2 (Rally2)', short: 'WRC2', ladder: 'rally', tier: 2, car: 'Rally2 (Škoda Fabia RS / Hyundai i20 N / Ford Fiesta / Citroën C3 / Toyota GR Yaris)', makes: ['Škoda', 'Hyundai', 'Ford', 'Citroën', 'Toyota'],
                grid: 24, teamSize: [1, 2], points: 'rally', budget: 1500000, spec: 0.25, len: { stages: 8 }, format: 'rally',
                cal: ['Rally Monte-Carlo', 'Rally Sweden', 'Safari Rally Kenya', 'Croatia Rally', 'Rally de Portugal', 'Rally Italia Sardegna', 'Acropolis Rally Greece', 'Rally Estonia', 'Rally Finland', 'Rally Chile', 'Central European Rally', 'Rally Japan'] },
            { id: 'wrc', name: 'FIA World Rally Championship (Rally1)', short: 'WRC', ladder: 'rally', tier: 1, car: 'Rally1 (Toyota GR Yaris / Hyundai i20 N / Ford Puma)', makes: ['Toyota', 'Hyundai', 'Ford'],
                grid: 12, teamSize: [2, 3], points: 'rally', budget: 25000000, spec: 0.5, len: { stages: 10 }, format: 'rally',
                cal: ['Rally Monte-Carlo', 'Rally Sweden', 'Safari Rally Kenya', 'Croatia Rally', 'Rally de Portugal', 'Rally Italia Sardegna', 'Acropolis Rally Greece', 'Rally Estonia', 'Rally Finland', 'Rally Chile', 'Central European Rally', 'Rally Japan', 'Rally Mexico'] }
        ]
    });

    /* ============================================================
       DiRT Rally 2.0
       ============================================================ */
    game({
        id: 'dr2', name: 'DiRT Rally 2.0', short: 'DR2.0', dev: 'Codemasters', year: 2019, era: 2019,
        platform: 'PC / Console', color: '#ef7d00', icon: '🌲', ai: AI.rally, maxGrid: 30,
        formats: ['paste', 'csv'],
        blurb: 'Rally and World RX. R2 hatchbacks to WRC cars across the classic DR2.0 locations.',
        tracks: ['Rally Argentina', 'Rally Australia', 'Rally New Zealand', 'Acropolis Rally Greece', 'Rally Monte-Carlo', 'Rally Poland', 'Rally Spain', 'Rally Sweden',
            'Rally USA (New England)', 'Wales Rally GB', 'Rally Finland', 'Rally Germany', 'Rally Scotland', 'Lydden Hill', 'Höljes', 'Lohéac', 'Hell (Lånkebanen)', 'Mettet',
            'Montalegre', 'Barcelona Rallycross', 'Riga (Biķernieki)', 'Silverstone Rallycross', 'Trois-Rivières'],
        series: [
            { id: 'r2', name: 'R2 Rally Championship', short: 'R2', ladder: 'rally', tier: 3, car: 'R2 (Ford Fiesta R2 / Opel Adam R2 / Peugeot 208 R2)', grid: 16, teamSize: [1, 1], points: 'rally', budget: 250000, spec: 0.1, len: { stages: 6 }, format: 'rally',
                cal: ['Wales Rally GB', 'Rally Poland', 'Rally Germany', 'Rally Spain', 'Rally Sweden', 'Rally Scotland'] },
            { id: 'r5', name: 'R5 Rally Championship', short: 'R5', ladder: 'rally', tier: 2, car: 'R5 (Škoda Fabia R5 / Ford Fiesta R5 / Citroën C3 R5 / VW Polo GTI R5)', makes: ['Škoda', 'Ford', 'Citroën', 'Volkswagen', 'Peugeot'],
                grid: 20, teamSize: [1, 2], points: 'rally', budget: 1200000, spec: 0.25, len: { stages: 8 }, format: 'rally',
                cal: ['Rally Monte-Carlo', 'Rally Sweden', 'Rally Argentina', 'Rally Australia', 'Acropolis Rally Greece', 'Rally Finland', 'Rally Germany', 'Rally Spain', 'Wales Rally GB'] },
            { id: 'wrc', name: 'World Rally Championship', short: 'WRC', ladder: 'rally', tier: 1, car: 'WRC 2017+ (Toyota Yaris / Hyundai i20 / Ford Fiesta / Citroën C3)', makes: ['Toyota', 'Hyundai', 'Ford', 'Citroën'],
                grid: 12, teamSize: [2, 3], points: 'rally', budget: 22000000, spec: 0.5, len: { stages: 10 }, format: 'rally',
                cal: ['Rally Monte-Carlo', 'Rally Sweden', 'Rally Argentina', 'Rally New Zealand', 'Rally Australia', 'Acropolis Rally Greece', 'Rally Poland', 'Rally Finland', 'Rally Germany', 'Rally Spain', 'Wales Rally GB', 'Rally USA (New England)'] },
            { id: 'wrx', name: 'FIA World Rallycross Championship', short: 'World RX', ladder: 'rx', tier: 1, car: 'RX Supercar', makes: ['Volkswagen', 'Peugeot', 'Audi', 'Ford', 'Renault', 'Mini'], grid: 16, teamSize: [1, 2], points: 'gt', budget: 3500000, spec: 0.35, len: { laps: 6 },
                cal: ['Barcelona Rallycross', 'Montalegre', 'Mettet', 'Lydden Hill', 'Hell (Lånkebanen)', 'Höljes', 'Trois-Rivières', 'Lohéac', 'Riga (Biķernieki)', 'Silverstone Rallycross'] }
        ]
    });

    /* ---------------- Lookups ---------------- */
    SC.GAMES = G;
    SC.game = (id) => G.find(g => g.id === id) || null;
    SC.seriesOf = (game, seriesId) => (game?.series || []).find(s => s.id === seriesId) || null;

    // Ladders in a game, entry rung first.
    SC.laddersOf = (game) => {
        const map = new Map();
        (game?.series || []).forEach(s => {
            if (!map.has(s.ladder)) map.set(s.ladder, []);
            map.get(s.ladder).push(s);
        });
        return Array.from(map.entries()).map(([id, series]) => ({
            id, ...(SC.LADDERS[id] || { label: id, icon: '🏁' }),
            series: series.slice().sort((a, b) => b.tier - a.tier)
        }));
    };

    // A blank, user-defined game (the "Custom game" option in the wizard).
    SC.blankCustomGame = () => ({
        id: 'custom', name: 'My Sim', short: 'Custom', dev: '', year: 2026, era: 2026, platform: 'Any', color: '#7c3aed', icon: '⭐',
        ai: { ...AI.generic }, maxGrid: 40, formats: ['csv', 'paste'], custom: true,
        blurb: 'Your own game, series and tracks.',
        tracks: [],
        series: []
    });
})(typeof window !== 'undefined' ? window : globalThis);
