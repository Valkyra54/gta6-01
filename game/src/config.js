// Every tuning number and colour in one place. The world is metres, the
// simulation steps at a fixed 1/60 s, and no rule below depends on the screen size.

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** The seed every visit uses when the URL names none: the same city, every load. */
export const DEFAULT_SEED = 20261118;

/** City layout: a seeded grid of blocks, roads ~14 m, 5–8 blocks across. */
export const CITY = {
  pitch: 66, // node spacing, metres
  roadWidth: 14,
  nodesX: 6, // 6 nodes -> 5 block columns
  nodesZ: 5, // 5 nodes -> 4 block rows
  blockInset: 8, // road half-width + sidewalk, metres from a node line to a plot edge
};

/** Districts, west to east: beach strip, old town, harbour. */
export const DISTRICTS = ['Pantai', 'Kota Lama', 'Pelabuhan'];

/** Which block column belongs to which district (0 = Pantai, 1 = Kota Lama, 2 = Pelabuhan). */
export const DISTRICT_OF_COLUMN = [0, 1, 1, 2, 2];

/** The hero car: a pink/red KOMODO GT, the most saturated thing in the frame. */
export const CAR = {
  length: 4.2,
  width: 1.9,
  height: 0.55,
  cabinLength: 2.0,
  cabinWidth: 1.6,
  cabinHeight: 0.5,
  wheelRadius: 0.36,
  wheelWidth: 0.28,
  maxSpeed: 38, // m/s, ~137 km/h
  maxReverse: 10,
  accel: 14,
  brake: 30,
  drag: 0.35,
  grip: 8.5, // how fast the velocity vector aligns to the heading (per second)
  turnRate: 1.9, // rad/s at full lock and full speed
  handbrakeGrip: 2.2, // grip while drifting: the car slides
  handbrakeTurn: 2.6,
};

/** Golden-hour rig: sun ~23° from the south-west, key warm, fog peach. */
export const SUN = {
  // Direction TO the sun, unit-ish: west (-x), low (+y), south (+z).
  dir: { x: -0.68, y: 0.38, z: 0.60 },
  keyColor: 0xffcf8a,
  keyIntensity: 2.6,
  skyColor: 0x9ecbff,
  groundColor: 0xd7a26a,
  hemiIntensity: 0.85,
  fogColor: 0xf7c9a0,
  fogDensity: 0.011,
  shadowRange: 90, // the shadow camera box, metres, re-centred on the player
  shadowMap: 1024,
};

/** Locked palette (PINTEREST.md §3): pastel facades, gold windows, teal water. */
export const PALETTE = {
  skyHorizon: '#FF9E5E',
  skyZenith: '#7FB3D5',
  fog: '#FFB38A',
  facades: ['#F2A7B8', '#7FD4D0', '#FFF3E0', '#F7D774', '#E8B4C8', '#9FD8CF'],
  downtownGlass: '#5B7A99',
  windowLit: '#FFD166',
  windowDark: '#2A3442',
  neonCyan: '#00E5FF',
  neonMagenta: '#FF2E88',
  road: '#55565E',
  roadDash: '#FFD166',
  sidewalk: '#B8A894',
  sand: '#E8C98F',
  water: '#0E4D5C',
  palm: '#1E5C3A',
  palmTrunk: '#7A5C3E',
  hero: '#FF2E63',
  heroStripe: '#FFD166',
  policeBody: '#F2F4F6',
  policeTrim: '#1C2230',
  concrete: '#8A8D90',
  craneRed: '#D93A2B',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'dermaga-emas.best';
