// Every tuning number, name and colour in one place. Nothing here depends on the screen size:
// the renderer scales a fixed logical view to the window, and the simulation only ever reads
// these values plus the seeded generator.

// The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate.
export const STEP = 1 / 60;

// DERMAGA EMAS (Golden Wharf): a sun-soaked coastal city on a peninsula. Districts: Pantai
// (beach strip, south), Kota Lama (old town, centre-west), Pelabuhan (harbour, east), plus a
// causeway north-west to an island with a lighthouse.
export const CITY = {
  name: 'DERMAGA EMAS',
  tagline: 'GOLDEN WHARF · AN OPEN-WORLD CRIME GAME',
  // Road centrelines. Avenues run north-south, streets east-west, the beachfront runs along
  // the sand, the harbour road runs along the docks, the causeway reaches the island.
  avenues: [-120, -60, 0, 60, 120],
  streets: [-100, -40, 20, 80],
  beachfrontZ: 130,
  harbourX: 150,
  island: { x: -150, z: -195, radius: 26 },
  // The drivable world, in metres. South and east are sea; the island sits north-west.
  bounds: { minX: -178, maxX: 208, minZ: -222, maxZ: 150 },
  roadWidth: 14,
  laneOffset: 3.5,
};

export const NAMES = {
  hero: 'Raka',
  wheelwoman: 'Rina',
  police: 'DEPD',
  heroCar: 'KOMODO GT',
  radioMusic: 'OMBAY 92.5',
  radioTalk: 'SUARA TELUK',
  tagline: 'Di Dermaga Emas, polisi tidak mengejar mobil — mereka mengejar deskripsinya.',
};

// The game as built has 3 story jobs (M1–M3). Nothing in the game claims more.
export const MISSIONS = [
  { id: 1, name: 'Selamat Datang', objective: 'Ikuti Rina ke Pantai — temui dia di ujung jalan', stages: 3, target: { x: -63.5, z: 118 } },
  { id: 2, name: 'Paket Panas', objective: 'Antar paket ke Pelabuhan sebelum waktu habis', stages: 3, target: { x: 144, z: 20 } },
  { id: 3, name: 'Mobil Pinjaman', objective: 'Tukar KOMODO GT dengan sedan biru di Kota Lama', stages: 3, target: { x: 3.5, z: -40 } },
];

export const PLAYER_START = { x: -63.5, z: -20, heading: 0 };

export const CAR = {
  // Kinematic arcade tuning: velocity vector + slip angle + grip, deterministic.
  accel: 16,
  brake: 30,
  reverseAccel: 10,
  maxSpeed: 38, // ~137 km/h
  maxReverse: 12,
  wheelbase: 2.8,
  maxSteerLow: 0.62,
  maxSteerHigh: 0.16,
  steerRate: 6,
  maxTurnRate: 1.9,
  grip: 8, // how fast lateral slide is eaten on normal grip
  handbrakeGrip: 2.2,
  drag: 0.12,
  radius: 1.6, // collision circle around the car centre
  bumpKeep: 0.55, // speed kept after a wall hit
};

export const CAMERA = {
  distance: 11,
  height: 4.0,
  lookAhead: 6,
  fov: 62,
};

// Golden hour, from the research: sun low in the south-west, a wedge of light, not warm light
// everywhere. Key #ffcf8a, hemisphere sky #9ecbff / ground #d7a26a, fog peach #f7c9a0.
export const LIGHT = {
  sunColor: 0xffcf8a,
  sunIntensity: 2.6,
  sunElevation: 23, // degrees above the horizon
  sunFromSouthwest: true,
  hemiSky: 0x9ecbff,
  hemiGround: 0xd7a26a,
  hemiIntensity: 0.9,
  fogColor: 0xf7c9a0,
  fogDensity: 0.0075,
  exposure: 1.1,
};

// Locked palette (PINTEREST.md §3): pastel facades, turquoise and cream, downtown blue-grey
// glass with lit gold windows, warm grey roads with yellow dashes, palms dark green, the hero
// car the most saturated thing in frame.
export const PALETTE = {
  skyTop: 0x7fb2e8,
  skyMid: 0xff9e5e,
  skyHorizon: 0xffc98a,
  facades: [0xf2a7b8, 0x7fd4d0, 0xfff3e0, 0xf7d774, 0x5b7a99, 0xe8b4a0, 0x9fc8c0],
  windowLit: 0xffd166,
  windowDark: 0x2a3442,
  road: 0x4a4a52,
  dash: 0xffd166,
  sidewalk: 0xb8a88f,
  ground: 0xc2a878,
  sand: 0xe8d5a8,
  sea: 0x0e4d5c,
  palm: 0x1e5c3a,
  trunk: 0x6b4a2f,
  heroCar: 0xff2e63, // saturated pink/red — the most saturated thing in frame
  policeWhite: 0xf2f2f2,
  neonCyan: 0x00e5ff,
  neonMagenta: 0xff2e88,
  container: [0xb5533c, 0x2e7d7a, 0xc9a227, 0x5b7a99, 0x7a4a3a],
  parked: [0xd8d3c8, 0x3a5a7a, 0xc96a3a, 0x7a8a9a, 0xe8e0d0, 0x4a6b4a],
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Cash the player starts with (top-5 norm: money in $). */
export const START_CASH = 1250;

/** Traffic tuning (Day 2): IDM car-following, lights, stop lines. */
export const TRAFFIC = {
  count: 20,
  cruise: 10, // m/s free-flow cruise (~36 km/h)
  cruiseNearEnd: 7, // m/s cap within 25 m of a lane end
  accel: 2.5, // IDM a
  brake: 3.0, // IDM b
  timeHeadway: 1.2, // IDM T (seconds)
  minGap: 3, // IDM s0 (metres, bumper to bumper)
  carLength: 4.3,
  carWidth: 1.9,
  stopLine: 11, // metres before the lane end
  lightCycle: 22, // seconds: green 8 / yellow 2 / all-red 1 per phase, two phases
  green: 8,
  yellow: 2,
  allRed: 1,
  nearEndDist: 25,
};

/** Pedestrian tuning (Day 2): groups, flee, witness. */
export const PEDS = {
  walkers: 36,
  idlers: 10,
  walkSpeed: 1.35, // m/s
  fleeSpeed: 3.6, // m/s
  fleeRadius: 8, // m — a car this close is a threat
  closingRadius: 14, // m — a fast car this close is a threat
  closingSpeed: 15, // m/s — above this, a closing car is a threat
  reactiveShare: 0.83, // ~83% of peds react; the rest keep walking
  fleeSeconds: 3, // how long a ped runs before it stops to report
  reportSeconds: 4, // how long the phone call lasts (Day 3 interrupts it)
  calmSeconds: 6, // after a report, a ped ignores threats this long
  sidewalkOffset: 8.5, // metres from the road centreline (matches the renderer)
};

/** The in-world clock shown on the HUD: M1 runs at golden hour, 17:30. */
export const CLOCK = 'HARI 1 · 17:30';

/** Wanted tuning (Day 3): the DEPD hunts by description, not just by sight. */
export const WANTED = {
  losRange: 55, // metres — a police unit this close has line of sight
  searchBaseR: 60, // search-zone radius at 1 star, +20 per extra star
  clearSeconds: 4, // outside the zone this long, with no contact, the trail goes cold
  retellFalloff: 0.6, // a description's match after each retelling (1 → 0.6 → 0.36)
  matchFloor: 0.3, // below this the description matches nothing and the trail dies
  flatSeconds: 25, // flat tyres after a spike strip: top speed ~40% until repaired
  flatSpeed: 15.3, // m/s — ~55 km/h, about 40% of the 137 km/h top speed
  reportInterruptRange: 10, // metres — this close to a reporting witness, the call is stopped
};

/** Police tuning (Day 3): pursuit, PIT, roadblock, spike strip, commandeer. */
export const POLICE = {
  topSpeed: 41, // m/s — 1.08x the player's 38 m/s top speed
  pitSpeed: 15.3, // m/s — PIT only works under ~55 km/h
  pitTailSeconds: 1.5, // a unit must sit on the player's tail this long before a PIT
  pitRange: 12, // metres behind the player to count as "on the tail"
  pitContact: 4.6, // metres — contact that spins the player
  pinSeconds: 3, // after a spin, two cars pin the player front-back this long
  ramRange: 6.5, // metres — a unit this close rams
  ramCooldown: 2, // seconds between rams per unit
  arrestRange: 5, // metres — arrest needs a unit this close (contact keeps cars ≥4.4 m apart)
  arrestSeconds: 2, // seconds slow and close before the arrest lands
  roadblockAheadSeconds: 3, // a roadblock is placed this far ahead on the escape route
  roadblockHoldSeconds: 10, // a roadblock holds its node this long
  boxinSeconds: 6, // a flanking unit holds the box-in this long
  commandeerSeconds: 2, // a wrecked cop steals the nearest traffic car after this long
  commandeerRange: 80, // metres — the nearest traffic car must be this close to steal
  unitsForStars: [0, 2, 3, 4], // pursuit units by wanted tier
};

/** Helicopter tuning (Day 3): AIR-1 watches from 3 stars up. */
export const HELI = {
  minStars: 3,
  height: 42, // metres above the ground
  followSpeed: 40, // m/s — how fast it closes on the player
  lockSeconds: 3, // continuous steady lock before the gunner fires
  lockRange: 150, // metres — gunfire only inside this range
  damage: 6, // health lost per hit
  reacquireSeconds: 5, // after a shot, the gunner needs this long to lock again
  steadyTurn: 0.3, // rad/s — turning faster than this breaks the lock
};

/** Mission payouts (Day 3): M1 $150, M2 $200 on time ($100 late), M3 $250. */
export const MISSION_PAYOUTS = [150, 200, 250];
export const MISSION_LATE_PAY = 100;
export const MISSION_TIME_LIMIT = 90; // seconds for M2's rush delivery
export const MISSION_ARRIVE_RANGE = 8; // metres — close enough to complete a stage
export const HEALTH_START = 100;
