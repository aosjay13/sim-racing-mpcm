/* ============================================================
   Phoenix SRMPC — Solo Career: names, nations, brands
   Everything here is fictional flavour for the AI world:
   drivers, staff, team names and sponsor brands.
   ============================================================ */
'use strict';

(function (root) {
    const SC = root.SC = root.SC || {};

    const NATIONS = {
        USA: { name: 'United States', flag: '🇺🇸', first: ['Chase', 'Tyler', 'Cody', 'Austin', 'Blake', 'Dale', 'Ricky', 'Travis', 'Brandon', 'Kyle', 'Ryan', 'Jesse', 'Cole', 'Hunter', 'Wyatt', 'Logan', 'Bobby', 'Rusty', 'Casey', 'Justin', 'Carson', 'Brett', 'Tanner', 'Colton', 'Mason', 'Jordan', 'Kaylee', 'Morgan', 'Taylor', 'Danielle'], last: ['Walker', 'Harrison', 'Mercer', 'Dalton', 'Presley', 'Whitaker', 'Crawford', 'Holt', 'Barrett', 'Sutton', 'Keller', 'Dawson', 'Pruitt', 'Hollister', 'McCoy', 'Garrett', 'Beaumont', 'Tatum', 'Lockhart', 'Burnett', 'Maddox', 'Rowland', 'Callahan', 'Voss', 'Hendry', 'Colbert', 'Stroud', 'Easley', 'Bowers', 'Pickett'] },
        CAN: { name: 'Canada', flag: '🇨🇦', first: ['Liam', 'Nolan', 'Owen', 'Mathieu', 'Alexandre', 'Ethan', 'Connor', 'Julien', 'Brady', 'Gabriel'], last: ['Tremblay', 'Gagnon', 'MacLeod', 'Fraser', 'Bouchard', 'Lachance', 'Sinclair', 'Côté', 'Duguay', 'McKinnon'] },
        MEX: { name: 'Mexico', flag: '🇲🇽', first: ['Diego', 'Santiago', 'Mateo', 'Emiliano', 'Rodrigo', 'Andrés', 'Sebastián', 'Iker'], last: ['Salinas', 'Cortés', 'Villarreal', 'Garza', 'Montoya', 'Treviño', 'Ochoa', 'Delgado'] },
        GBR: { name: 'United Kingdom', flag: '🇬🇧', first: ['Oliver', 'Harry', 'George', 'Jack', 'Alfie', 'Callum', 'Rhys', 'Jamie', 'Ollie', 'Lewis', 'Toby', 'Archie', 'Ellis', 'Freddie', 'Isla', 'Georgia'], last: ['Hartley', 'Pemberton', 'Ashworth', 'Fairclough', 'Whitmore', 'Kingsley', 'Bramwell', 'Thornton', 'Ellison', 'Radcliffe', 'Cartwright', 'Holloway', 'Linfield', 'Sherwood', 'Waverley', 'Cotterill'] },
        IRL: { name: 'Ireland', flag: '🇮🇪', first: ['Cian', 'Oisín', 'Darragh', 'Sean', 'Eoin', 'Conor'], last: ['Byrne', 'Doyle', 'Kavanagh', "O'Driscoll", 'Brennan', 'Quinlan'] },
        GER: { name: 'Germany', flag: '🇩🇪', first: ['Lukas', 'Maximilian', 'Jonas', 'Felix', 'Niklas', 'Leon', 'Tim', 'Moritz', 'Jannik', 'Paul', 'Finn', 'Marco', 'Lena', 'Sophie'], last: ['Brenner', 'Kessler', 'Hartmann', 'Vogt', 'Lindner', 'Engel', 'Krämer', 'Winkler', 'Albrecht', 'Seidel', 'Brandt', 'Haas', 'Kühn', 'Roth', 'Fuchs', 'Stahl'] },
        AUT: { name: 'Austria', flag: '🇦🇹', first: ['Florian', 'Matthias', 'Dominik', 'Stefan', 'Thomas', 'Simon'], last: ['Gruber', 'Pichler', 'Steiner', 'Moser', 'Hofer', 'Leitner'] },
        SUI: { name: 'Switzerland', flag: '🇨🇭', first: ['Luca', 'Nico', 'Raphael', 'Fabio', 'Yannick'], last: ['Frey', 'Baumann', 'Keller', 'Suter', 'Gerber'] },
        FRA: { name: 'France', flag: '🇫🇷', first: ['Théo', 'Hugo', 'Louis', 'Lucas', 'Antoine', 'Pierre', 'Mathis', 'Enzo', 'Julien', 'Arthur', 'Clément', 'Léa'], last: ['Duval', 'Lefèvre', 'Moreau', 'Girard', 'Fontaine', 'Rousseau', 'Chevalier', 'Laurent', 'Marchand', 'Dubois', 'Perrin', 'Vasseur'] },
        BEL: { name: 'Belgium', flag: '🇧🇪', first: ['Maxime', 'Arnaud', 'Thomas', 'Wout', 'Jules', 'Bram'], last: ['Peeters', 'Janssens', 'Dewaele', 'Lambert', 'Maes', 'Wouters'] },
        NED: { name: 'Netherlands', flag: '🇳🇱', first: ['Daan', 'Sem', 'Jesse', 'Thijs', 'Ruben', 'Lars', 'Bas', 'Joost'], last: ['de Vries', 'van Dijk', 'Bakker', 'Visser', 'Smit', 'de Boer', 'Mulder', 'Hendriks'] },
        ITA: { name: 'Italy', flag: '🇮🇹', first: ['Luca', 'Matteo', 'Alessandro', 'Lorenzo', 'Andrea', 'Davide', 'Riccardo', 'Tommaso', 'Gabriele', 'Federico', 'Giulia', 'Marco'], last: ['Rossi', 'Marchetti', 'Bellini', 'Colombo', 'Ferrara', 'Galli', 'Rinaldi', 'Moretti', 'Barbieri', 'Fontana', 'Santoro', 'Vitale', 'Pellegrini', 'Caruso'] },
        ESP: { name: 'Spain', flag: '🇪🇸', first: ['Pablo', 'Álvaro', 'Hugo', 'Javier', 'Sergio', 'Daniel', 'Marc', 'Pau', 'Iván'], last: ['García', 'Navarro', 'Ruiz', 'Molina', 'Ortega', 'Castillo', 'Vidal', 'Serrano', 'Herrera'] },
        POR: { name: 'Portugal', flag: '🇵🇹', first: ['Tiago', 'Duarte', 'Rui', 'Miguel', 'Afonso'], last: ['Costa', 'Pereira', 'Ferreira', 'Carvalho', 'Almeida'] },
        BRA: { name: 'Brazil', flag: '🇧🇷', first: ['Felipe', 'Rafael', 'Gustavo', 'Thiago', 'Bruno', 'Lucas', 'Caio', 'Enzo', 'Pedro', 'Vinícius', 'Rubens', 'Gabriel', 'Nelsinho', 'Beatriz'], last: ['Silva', 'Oliveira', 'Santos', 'Souza', 'Barbosa', 'Moraes', 'Teixeira', 'Cardoso', 'Nogueira', 'Azevedo', 'Figueiredo', 'Pacheco', 'Rezende', 'Guimarães'] },
        ARG: { name: 'Argentina', flag: '🇦🇷', first: ['Facundo', 'Agustín', 'Nicolás', 'Franco', 'Joaquín', 'Tomás'], last: ['Fernández', 'Rossi', 'Pérez', 'Maldonado', 'Acosta', 'Benítez'] },
        FIN: { name: 'Finland', flag: '🇫🇮', first: ['Mikko', 'Kalle', 'Jari', 'Eetu', 'Joonas', 'Aleksi', 'Teemu', 'Valtteri'], last: ['Virtanen', 'Korhonen', 'Lahtinen', 'Mäkinen', 'Heikkinen', 'Laaksonen', 'Salonen', 'Rantala'] },
        SWE: { name: 'Sweden', flag: '🇸🇪', first: ['Oscar', 'Elias', 'William', 'Hugo', 'Axel', 'Linus', 'Emil', 'Viktor'], last: ['Lindqvist', 'Bergström', 'Nyström', 'Sandberg', 'Holmberg', 'Ekström', 'Forsberg', 'Wallin'] },
        NOR: { name: 'Norway', flag: '🇳🇴', first: ['Magnus', 'Sander', 'Henrik', 'Jakob', 'Kristian'], last: ['Hansen', 'Solberg', 'Nilsen', 'Berg', 'Haugen'] },
        DEN: { name: 'Denmark', flag: '🇩🇰', first: ['Mads', 'Frederik', 'Mikkel', 'Rasmus', 'Nikolaj'], last: ['Jensen', 'Nielsen', 'Kristensen', 'Mortensen', 'Lund'] },
        POL: { name: 'Poland', flag: '🇵🇱', first: ['Jakub', 'Kacper', 'Mateusz', 'Szymon', 'Filip'], last: ['Kowalczyk', 'Nowak', 'Wiśniewski', 'Zieliński', 'Kamiński'] },
        CZE: { name: 'Czechia', flag: '🇨🇿', first: ['Tomáš', 'Jakub', 'Ondřej', 'Petr', 'Adam'], last: ['Novák', 'Dvořák', 'Černý', 'Procházka', 'Kučera'] },
        JPN: { name: 'Japan', flag: '🇯🇵', first: ['Haruto', 'Yuki', 'Kazuki', 'Ren', 'Sota', 'Takumi', 'Daiki', 'Ryo', 'Kenta', 'Sho'], last: ['Takahashi', 'Nakamura', 'Yamamoto', 'Kobayashi', 'Sato', 'Watanabe', 'Matsuda', 'Inoue', 'Ishikawa', 'Fukuda'] },
        CHN: { name: 'China', flag: '🇨🇳', first: ['Wei', 'Hao', 'Jun', 'Yang', 'Chen', 'Lei'], last: ['Zhou', 'Li', 'Wang', 'Zhang', 'Liu', 'Huang'] },
        AUS: { name: 'Australia', flag: '🇦🇺', first: ['Jack', 'Lachlan', 'Cooper', 'Mitchell', 'Brodie', 'Kurt', 'Nick', 'Zane', 'Will'], last: ['Kelly', 'Mackenzie', 'Sheppard', 'Winslow', 'Hazelton', 'Brennan', 'Cowell', 'Stanford', 'Reynolds'] },
        NZL: { name: 'New Zealand', flag: '🇳🇿', first: ['Liam', 'Hayden', 'Marcus', 'Brendon', 'Shane'], last: ['Armstrong', 'Hartwell', 'Paterson', 'McLean', 'Rowe'] },
        RSA: { name: 'South Africa', flag: '🇿🇦', first: ['Kelvin', 'Jordan', 'Wian', 'Sheldon', 'Dean'], last: ['van der Merwe', 'Botha', 'Pretorius', 'Naidoo', 'Joubert'] }
    };

    // Nationality mix per game (weights). Anything not listed draws from all.
    const MIX = {
        nr2003: { USA: 90, CAN: 4, MEX: 2, AUS: 2, GBR: 2 },
        nascar26: { USA: 86, CAN: 4, MEX: 4, AUS: 3, BRA: 1, GBR: 2 },
        heat5: { USA: 90, CAN: 4, MEX: 3, AUS: 3 },
        iracing: { USA: 40, GBR: 10, GER: 8, NED: 5, BRA: 5, AUS: 5, CAN: 5, FRA: 4, ITA: 4, ESP: 3, JPN: 3, FIN: 3, SWE: 2, BEL: 2, MEX: 1 },
        ams2: { BRA: 40, GBR: 10, ARG: 8, ITA: 6, GER: 6, POR: 5, ESP: 5, USA: 5, FRA: 5, NED: 4, AUS: 3, JPN: 3 },
        ams1: { BRA: 55, ARG: 12, POR: 5, ITA: 6, GER: 6, GBR: 6, ESP: 5, USA: 5 },
        rre: { GER: 35, NED: 8, SWE: 8, AUT: 6, SUI: 5, GBR: 8, ITA: 6, FRA: 5, BEL: 6, DEN: 4, FIN: 4, POL: 3, CZE: 2 },
        race07: { SWE: 22, GER: 12, GBR: 12, ITA: 10, ESP: 8, FRA: 8, NED: 6, DEN: 6, NOR: 5, POR: 4, BRA: 4, BEL: 3 },
        gtr2: { GER: 16, ITA: 16, GBR: 14, FRA: 12, BEL: 8, NED: 8, ESP: 6, POR: 4, AUT: 4, SUI: 4, SWE: 4, CZE: 4 },
        wreckfest: { FIN: 20, USA: 30, GBR: 12, SWE: 8, GER: 8, AUS: 6, CAN: 6, NOR: 5, POL: 5 },
        wreckfest2: { FIN: 20, USA: 30, GBR: 12, SWE: 8, GER: 8, AUS: 6, CAN: 6, NOR: 5, POL: 5 },
        gt7: { JPN: 25, GBR: 10, GER: 10, FRA: 8, ITA: 8, USA: 10, BRA: 6, ESP: 6, AUS: 6, NED: 5, CHN: 6 },
        eawrc: { FIN: 16, FRA: 12, GBR: 10, SWE: 8, NOR: 8, ESP: 8, BEL: 6, GER: 6, POL: 6, CZE: 6, JPN: 6, IRL: 4, NZL: 4 },
        dr2: { FIN: 16, FRA: 12, GBR: 12, SWE: 8, NOR: 8, ESP: 8, BEL: 6, GER: 6, POL: 6, CZE: 6, IRL: 6, NZL: 6 },
        lmu: { FRA: 14, GBR: 14, GER: 10, ITA: 8, JPN: 8, USA: 8, NED: 6, BEL: 6, SUI: 6, DEN: 5, BRA: 5, POR: 5, AUS: 5 }
    };

    // Team naming styles by ladder.
    const WORDS = ['Apex', 'Vortex', 'Falcon', 'Titan', 'Crimson', 'Velocity', 'Nova', 'Summit', 'Ironclad', 'Redline', 'Horizon', 'Zenith', 'Cobalt',
        'Onyx', 'Sterling', 'Monarch', 'Stallion', 'Arrow', 'Comet', 'Halo', 'Kestrel', 'Raven', 'Viper', 'Blaze', 'Thunder', 'Storm', 'Atlas',
        'Orion', 'Pinnacle', 'Sentinel', 'Tempest', 'Vanguard', 'Maverick', 'Eclipse', 'Quantum', 'Spectre', 'Nitro', 'Torque', 'Piston',
        'Crossfire', 'Wildfire', 'Longhorn', 'Mustang', 'Trident', 'Aurora', 'Meridian', 'Northstar', 'Silverline', 'Blackwater', 'Granite'];
    const PLACES = ['Blue Ridge', 'Lone Star', 'Carolina', 'Great Lakes', 'Bayou', 'Sierra', 'Tidewater', 'Piedmont', 'Rocky Top', 'Delta', 'Heartland',
        'Gulf Coast', 'Mojave', 'Cascade', 'Ozark', 'Magnolia', 'Keystone', 'Big Sky', 'Chesapeake', 'Red River'];
    const ITAL = ['Scuderia', 'Squadra', 'Corse'];

    const TEAM_STYLE = {
        stock: [(w, s, p) => `${s} Motorsports`, (w, s, p) => `${p} Racing`, (w, s, p, s2) => `${s}-${s2} Racing`, (w, s, p) => `${w} Motorsports`, (w, s, p) => `${s} Racing Enterprises`, (w, s, p) => `${p} Speed Co.`],
        modified: [(w, s, p) => `${s} Racing`, (w, s, p) => `${p} Mod Squad`, (w, s, p) => `${s} Motorsports`],
        dirt: [(w, s, p) => `${s} Racing`, (w, s, p) => `${p} Dirt Works`, (w, s, p) => `${w} Motorsports`, (w, s, p) => `${s} Chassis Racing`],
        sprint: [(w, s, p) => `${s} Racing`, (w, s, p) => `${p} Sprint Team`, (w, s, p) => `${w} Motorsports`],
        formula: [(w, s, p) => `${w} Racing`, (w, s, p) => `${w} GP`, (w, s, p) => `${s} Motorsport`, (w, s, p) => `Team ${w}`, (w, s, p) => `Scuderia ${w}`, (w, s, p) => `${w} Formula Team`, (w, s, p) => `${s} Grand Prix`],
        gt: [(w, s, p) => `${w} Motorsport`, (w, s, p) => `${w} Racing Team`, (w, s, p) => `${s} Competition`, (w, s, p) => `Team ${w} GT`, (w, s, p) => `${w} Corse`, (w, s, p) => `${s} Performance`],
        endurance: [(w, s, p) => `${w} Endurance`, (w, s, p) => `${s} Racing`, (w, s, p) => `Team ${w}`, (w, s, p) => `${w} Motorsport`, (w, s, p) => `${s} Autosport`],
        touring: [(w, s, p) => `${w} Motorsport`, (w, s, p) => `Team ${w}`, (w, s, p) => `${s} Racing`, (w, s, p) => `${w} Touring`],
        kart: [(w, s, p) => `${w} Karting`, (w, s, p) => `${s} Kart Racing`, (w, s, p) => `Team ${w}`],
        rally: [(w, s, p) => `${w} Rally Team`, (w, s, p) => `${s} Rallysport`, (w, s, p) => `${w} WRT`],
        rx: [(w, s, p) => `${w} RX`, (w, s, p) => `${s} Rallycross`, (w, s, p) => `Team ${w}`],
        derby: [(w, s, p) => `${w} Wreckers`, (w, s, p) => `${s} Salvage`, (w, s, p) => `${p} Demolition`, (w, s, p) => `${w} Bangers`, (w, s, p) => `${s} Scrap & Race`],
        historic: [(w, s, p) => `${w} Historic Racing`, (w, s, p) => `${s} Classic Team`, (w, s, p) => `Team ${w}`],
        custom: [(w, s, p) => `${w} Racing`, (w, s, p) => `${s} Motorsport`, (w, s, p) => `Team ${w}`]
    };

    // Fictional sponsor brands.
    const BRANDS = [
        ['Velocity Energy', 'Energy drinks'], ['Apex Lubricants', 'Oil & fuel'], ['TurboByte Cloud', 'Technology'], ['IronGrip Tyres', 'Tyres'], ['Nova Financial', 'Banking'],
        ['Meteor Watches', 'Luxury'], ['Crossflow Airlines', 'Travel'], ['Blacksmith Tools', 'Hardware'], ['Quantum Telecom', 'Telecom'], ['Redline Apparel', 'Clothing'],
        ['Summit Insurance', 'Insurance'], ['Fusion Batteries', 'Automotive'], ['Golden Wing Brewery', 'Beverages'], ['Stormfront Gaming', 'Gaming'], ['Polar Freeze Cola', 'Beverages'],
        ['Kestrel Logistics', 'Logistics'], ['Northwind Hardware', 'Retail'], ['Sparkline Energy', 'Utilities'], ['Crestview Bank', 'Banking'], ['Hexa Robotics', 'Technology'],
        ['Blue Canyon Jerky', 'Food'], ['Diamondback Tools', 'Hardware'], ['Pioneer Seed Co.', 'Agriculture'], ['Harbor Freightways', 'Logistics'], ['Sunburst Solar', 'Energy'],
        ['Trailhead Outdoors', 'Retail'], ['Maxwell Motor Oil', 'Oil & fuel'], ['Riverside Casinos', 'Leisure'], ['PixelForge Studios', 'Gaming'], ['Atlas Construction', 'Construction'],
        ['Vantage Mobile', 'Telecom'], ['Everest Water', 'Beverages'], ['Copperhead Firearms Safety', 'Safety'], ['Gridline Sim Rigs', 'Sim racing'], ['Octane Headsets', 'Electronics'],
        ['Lumen Lighting', 'Electronics'], ['Paragon Watches', 'Luxury'], ['Rapid Pizza Co.', 'Food'], ['Cloudnine Mattresses', 'Retail'], ['Evergreen Pharmacy', 'Health'],
        ['Titan Trucking', 'Logistics'], ['Wildcat Energy Drink', 'Energy drinks'], ['Orbit Satellite TV', 'Media'], ['Beacon Credit Union', 'Banking'], ['Swift Couriers', 'Logistics'],
        ['Nordic Knives', 'Hardware'], ['Monarch Hotels', 'Travel'], ['Sable Coffee', 'Food'], ['Keystone Lumber', 'Construction'], ['Arcadia Resorts', 'Travel'],
        ['Fireline Brakes', 'Automotive'], ['Ridgeback Pickups', 'Automotive'], ['Pulse Fitness', 'Health'], ['Zephyr Air Filters', 'Automotive'], ['Crown Rock Salt', 'Food'],
        ['Cardinal Home Loans', 'Banking'], ['Echo Audio', 'Electronics'], ['Frontier Feed & Seed', 'Agriculture'], ['Glacier Ice Co.', 'Food'], ['Helix Biotech', 'Health'],
        ['Ironhorse Boots', 'Clothing'], ['Juniper Gin', 'Beverages'], ['Kodiak Coolers', 'Retail'], ['Legacy Auto Parts', 'Automotive'], ['Mariner Marine', 'Leisure'],
        ['Nimbus Drones', 'Technology'], ['Outpost Camping', 'Retail'], ['Prairie Fire BBQ', 'Food'], ['Quicksilver Payments', 'Finance'], ['Rover Pet Food', 'Retail'],
        ['Sentinel Security', 'Security'], ['Tundra Tyres', 'Tyres'], ['Uplink VPN', 'Technology'], ['Vulcan Welding', 'Industrial'], ['Waypoint GPS', 'Electronics']
    ];

    const STAFF_ROLES = {
        td: { label: 'Technical Director', icon: '🧠', desc: 'Leads car design. Boosts R&D gains and reliability.' },
        engineer: { label: 'Race Engineer', icon: '🎧', desc: 'Sets up your car. Better engineers = sharper setups (lower recommended AI) and faster teammates.' },
        crewchief: { label: 'Crew Chief / Team Manager', icon: '🧰', desc: 'Runs the pit crew and race strategy. Fewer pit mistakes, better strategy calls.' },
        commercial: { label: 'Commercial Director', icon: '💼', desc: 'Finds sponsors. More offers, bigger numbers.' }
    };

    SC.NATIONS = NATIONS;
    SC.NATION_MIX = MIX;
    SC.TEAM_WORDS = WORDS;
    SC.TEAM_PLACES = PLACES;
    SC.TEAM_STYLE = TEAM_STYLE;
    SC.ITAL = ITAL;
    SC.BRANDS = BRANDS.map(([name, industry]) => ({ name, industry }));
    SC.STAFF_ROLES = STAFF_ROLES;
    SC.flag = (code) => NATIONS[code]?.flag || '🏳️';
    SC.nationName = (code) => NATIONS[code]?.name || code || '—';
})(typeof window !== 'undefined' ? window : globalThis);
