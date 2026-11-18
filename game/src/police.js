// The DEPD: pursuit with real tactics, not a homing missile. Units lead the
// target, fan out, and pick a tactic by the situation — PIT (only under
// ~55 km/h, then two cars pin the player front and rear), box-in / rolling
// roadblock, ram from behind, roadblocks with spike strips at 2★+, and
// commandeer (a cop whose car is wrecked steals the nearest traffic car and
// keeps chasing). Search is map-wide with individual fields of view: no
// global observer cheat. Pure sim — plain data, seeded RNG, no DOM.

import { createRandom, range, rangeInt } from './random.js';
import { createCar, driveCar } from './car.js';
import { nearestRoadPoint, resolveCarCollision } from './collision.js';
import { hasLineOfSight, reportCrime } from './wanted.js';

const CALLSIGNS = ['TUNA', 'HIU', 'ELANG', 'MARLIN', 'GULL', 'BARONANG', 'KERAPU', 'CUMI'];
const OFFICERS = ['Ofc. Sari', 'Sgt. Made', 'Ofc. Putri', 'Ofc. Agus', 'Ofc. Dewi', 'Sgt. Rara'];
const PIT_MAX_SPEED = 15.3; // ~55 km/h: a PIT only works on a slow target
const SPAWN_INTERVAL = 1.2;
const DESIRED_COUNT = { 0: 1, 1: 2, 2: 3, 3: 4 };
const MAX_UNITS = 6;

/** The police state, fresh: one patrol car cruising, nothing chasing. */
export function createPolice(city, seed) {
  return {
    units: [],
    spikes: [],
    spawnTimer: 0,
    spikeCooldown: 0,
    pursuitTime: 0,
    roadblockSet: false,
    rng: createRandom(seed ^ 0x5011ce),
    nextId: 1,
  };
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Place a police unit at an exact pose (staging a scene, or a scripted spawn). */
export function placePoliceUnit(police, x, z, heading) {
  const id = police.nextId;
  police.nextId += 1;
  const car = createCar({ x, z, heading });
  const unit = {
    ...car,
    id,
    callsign: CALLSIGNS[(id - 1) % CALLSIGNS.length],
    officer: OFFICERS[(id - 1) % OFFICERS.length],
    state: 'pursue',
    health: 100,
    tacticTimer: 0,
    role: null,
    wreckTimer: 0,
    lastReport: -10,
    target: null,
  };
  police.units.push(unit);
  return unit;
}

/** A point on a random lane, 45–85 m from the player: where a unit appears. */
function spawnPoint(city, player, rng, ahead) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const lane = city.lanes[Math.floor(rng() * city.lanes.length)];
    const len = Math.hypot(lane.ex - lane.sx, lane.ez - lane.sz);
    const s = range(rng, 4, len - 4);
    const t = s / len;
    const x = lane.sx + (lane.ex - lane.sx) * t;
    const z = lane.sz + (lane.ez - lane.sz) * t;
    const dist = Math.hypot(x - player.x, z - player.z);
    if (dist < 45 || dist > 85) continue;
    if (ahead) {
      const fx = Math.sin(player.heading);
      const fz = Math.cos(player.heading);
      const dot = ((x - player.x) * fx + (z - player.z) * fz) / Math.max(dist, 0.01);
      if (dot < 0.2) continue;
    }
    return { x, z, heading: Math.atan2(lane.ex - lane.sx, lane.ez - lane.sz) };
  }
  const near = nearestRoadPoint(city, player.x + 60, player.z);
  return { x: near.x, z: near.z, heading: 0 };
}

function spawnUnit(police, city, player) {
  const pose = spawnPoint(city, player, police.rng, police.heliAhead);
  const id = police.nextId;
  police.nextId += 1;
  const car = createCar(pose);
  const unit = {
    ...car,
    id,
    callsign: CALLSIGNS[(id - 1) % CALLSIGNS.length],
    officer: OFFICERS[(id - 1) % OFFICERS.length],
    state: 'patrol',
    health: 100,
    tacticTimer: 0,
    role: null,
    wreckTimer: 0,
    lastReport: -10,
    target: null,
  };
  police.units.push(unit);
  return unit;
}

/** Drive input toward a point: pure pursuit, full throttle, brake when there. */
function driveTo(unit, tx, tz, dt, topSpeed) {
  const want = Math.atan2(tx - unit.x, tz - unit.z);
  const diff = wrapAngle(want - unit.heading);
  const dist = Math.hypot(tx - unit.x, tz - unit.z);
  const speed = Math.hypot(unit.vx, unit.vz);
  return {
    throttle: dist > 6 ? 1 : 0,
    steer: clamp(diff * 2.2, -1, 1),
    brake: dist < 4 && speed > 3 ? 1 : 0,
    handbrake: false,
  };
}

/** The player's predicted position, half a second ahead. */
function leadPoint(player) {
  return { x: player.x + player.vx * 0.5, z: player.z + player.vz * 0.5 };
}

/** Where a unit should be for its role, relative to the player's heading. */
function rolePoint(player, role, dist = 4.5) {
  const fx = Math.sin(player.heading);
  const fz = Math.cos(player.heading);
  const rx = fz;
  const rz = -fx;
  if (role === 'flank-left') return { x: player.x - rx * 3.5 + fx * 2, z: player.z - rz * 3.5 + fz * 2 };
  if (role === 'flank-right') return { x: player.x + rx * 3.5 + fx * 2, z: player.z + rz * 3.5 + fz * 2 };
  if (role === 'rear') return { x: player.x - fx * 7, z: player.z - fz * 7 };
  if (role === 'pin-front') return { x: player.x + fx * dist, z: player.z + fz * dist };
  if (role === 'pin-rear') return { x: player.x - fx * dist, z: player.z - fz * dist };
  return { x: player.x, z: player.z };
}

function stepUnit(unit, police, state, dt) {
  const { city, car: player, wanted } = state;
  const time = state.time;
  const dist = Math.hypot(player.x - unit.x, player.z - unit.z);
  const playerSpeed = Math.hypot(player.vx, player.vz);
  const sees = hasLineOfSight(unit.x, unit.z, player.x, player.z, city, 70);
  unit.tacticTimer -= dt;
  // DEPD cars are quicker than the player's in a straight line: a top-speed
  // player cannot just outrun them. The escape is corners and line of sight.
  const limits = { maxSpeedMul: 1.08, turnMul: 1 };
  if (unit.ramCooldown) unit.ramCooldown -= dt;

  // --- Wrecked: the car is dead. After a beat the cop takes a traffic car. ---
  if (unit.state === 'wrecked') {
    unit.wreckTimer += dt;
    if (unit.wreckTimer > 1.5) {
      let best = null;
      let bestDist = 70;
      for (const t of state.traffic.cars) {
        const d = Math.hypot(t.x - unit.x, t.z - unit.z);
        if (d < bestDist) { best = t; bestDist = d; }
      }
      if (best) {
        state.traffic.cars.splice(state.traffic.cars.indexOf(best), 1);
        const fresh = spawnUnit(police, city, player);
        fresh.x = best.x;
        fresh.z = best.z;
        fresh.heading = best.heading;
        fresh.state = 'pursue';
        spawnTrafficCar(state.traffic, city, player, police.rng);
        police.units.splice(police.units.indexOf(unit), 1);
        return;
      }
      if (unit.wreckTimer > 8) police.units.splice(police.units.indexOf(unit), 1);
    }
    return;
  }

  // --- No wanted level: cruise the lanes like a patrol car. ---
  if (wanted.stars === 0) {
    unit.state = 'patrol';
    if (!unit.target || Math.hypot(unit.target.x - unit.x, unit.target.z - unit.z) < 8) {
      const lane = city.lanes[Math.floor(police.rng() * city.lanes.length)];
      unit.target = { x: lane.ex, z: lane.ez };
    }
    const drive = driveTo(unit, unit.target.x, unit.target.z, dt);
    if (Math.hypot(unit.vx, unit.vz) > 8) drive.throttle = 0;
    driveCar(unit, drive, dt, limits);
    resolveCarCollision(unit, city);
    return;
  }

  // --- Wanted: pick a tactic. ---
  const pursuers = police.units.filter((u) => u.state !== 'wrecked' && u.state !== 'patrol');
  if (unit.state === 'pin' || unit.state === 'pin-front' || unit.state === 'pin-rear') {
    // The pin closes in: after two seconds the cars sit at 2.5 m, inside
    // arrest range — a pinned player gets busted, never soft-locked. The pin
    // holds until the player breaks free at speed for two seconds.
    unit.pinAge = (unit.pinAge || 0) + dt;
    const point = rolePoint(player, unit.role, unit.pinAge > 2 ? 2.5 : 4.5);
    // Full throttle into the point, no driveTo standoff: driveTo brakes
    // 4 m out and the pin would never reach the player.
    const want = Math.atan2(point.x - unit.x, point.z - unit.z);
    const diff = wrapAngle(want - unit.heading);
    driveCar(unit, { throttle: 1, steer: clamp(diff * 2.2, -1, 1), brake: 0, handbrake: false }, dt, limits);
    resolveCarCollision(unit, city);
    if (playerSpeed > 6) {
      unit.pinTimer = (unit.pinTimer || 0) + dt;
      if (unit.pinTimer > 2) {
        unit.state = 'pursue';
        unit.role = null;
        unit.pinTimer = 0;
        unit.pinAge = 0;
      }
    } else {
      unit.pinTimer = 0;
    }
    return;
  }
  if (unit.state === 'roadblock') {
    if (unit.target) {
      const drive = driveTo(unit, unit.target.x, unit.target.z, dt);
      driveCar(unit, drive, dt, limits);
      resolveCarCollision(unit, city);
      if (Math.hypot(unit.target.x - unit.x, unit.target.z - unit.z) < 5) {
        unit.heading = player.heading + Math.PI / 2;
        unit.speed = 0;
        unit.vx = 0;
        unit.vz = 0;
      }
    }
    return;
  }
  if (wanted.display === 'searching' || wanted.display === 'near' || wanted.display === 'reported') {
    // Lost the trail: drive to the last-known spot and orbit it.
    unit.state = 'search';
    const lk = wanted.lastKnown || { x: player.x, z: player.z };
    const angle = time * 0.25 + unit.id * 2.1;
    const point = { x: lk.x + Math.cos(angle) * 30, z: lk.z + Math.sin(angle) * 30 };
    const drive = driveTo(unit, point.x, point.z, dt);
    driveCar(unit, drive, dt, limits);
    resolveCarCollision(unit, city);
    return;
  }

  // --- Pursuit: lead the target, fan out, pick a tactic. ---
  // A PIT in progress is a state, not a one-frame event: never reset it
  // here, or the unit only ever spends a single step in 'pit' and the
  // contact never lands. (The pin branch above already returns early.)
  if (unit.state !== 'pit') unit.state = 'pursue';
  // Box-in: with three or more pursuers and a fast player, two flank and one trails.
  if (pursuers.length >= 3 && playerSpeed > 12 && unit.tacticTimer <= 0) {
    const sorted = [...pursuers].sort((a, b) => a.id - b.id);
    const slot = sorted.indexOf(unit);
    unit.role = slot === 0 ? 'flank-left' : slot === 1 ? 'flank-right' : 'rear';
    unit.tacticTimer = 4;
  }
  if (unit.role === 'flank-left' || unit.role === 'flank-right' || unit.role === 'rear') {
    const point = rolePoint(player, unit.role);
    const drive = driveTo(unit, point.x, point.z, dt);
    // Flankers match the player's speed instead of ramming through.
    if (Math.hypot(unit.vx, unit.vz) > playerSpeed + 2) drive.throttle = 0;
    driveCar(unit, drive, dt, limits);
    resolveCarCollision(unit, city);
    if (unit.tacticTimer <= 0) unit.role = null;
    return;
  }
  // PIT: close behind a slow-but-moving player, aim at the rear quarter,
  // make contact. It needs a 1.5 s tail first — the unit must sit on the
  // player's bumper — so a player who accelerates out of a corner escapes
  // the setup, and a stopped player is arrested instead of PIT again.
  const behind = (() => {
    const fx = Math.sin(player.heading);
    const fz = Math.cos(player.heading);
    const dot = ((unit.x - player.x) * fx + (unit.z - player.z) * fz) / Math.max(dist, 0.01);
    return dot < -0.3;
  })();
  const slowMoving = Math.abs(player.speed) > 3 && Math.abs(player.speed) < PIT_MAX_SPEED;
  if (dist < 12 && slowMoving && behind) {
    unit.pitSetup = (unit.pitSetup || 0) + dt;
  } else {
    unit.pitSetup = 0;
  }
  if (unit.pitSetup > 1.5 && unit.tacticTimer <= 0) {
    unit.state = 'pit';
    unit.tacticTimer = 5;
    unit.pitSetup = 0;
  }
  if (unit.state === 'pit') {
    const fx = Math.sin(player.heading);
    const fz = Math.cos(player.heading);
    const side = (unit.x - player.x) * fz - (unit.z - player.z) * fx > 0 ? 1 : -1;
    const point = { x: player.x - fx * 2.2 + fz * side * 2.0, z: player.z - fz * 2.2 - fx * side * 2.0 };
    // Full throttle into the contact point: no braking, or the PIT never lands.
    const want = Math.atan2(point.x - unit.x, point.z - unit.z);
    const diff = wrapAngle(want - unit.heading);
    driveCar(unit, { throttle: 1, steer: clamp(diff * 2.2, -1, 1), brake: 0, handbrake: false }, dt, limits);
    resolveCarCollision(unit, city);
    return;
  }
  // Ram: directly behind a fast player, hit the back of the car. A hard
  // contact starts a 2 s cooldown — without it the unit re-approaches and
  // rams every step, shoving the player off the road in one long push
  // instead of landing discrete hits.
  if (behind && dist < 15 && dist > 4 && playerSpeed > 10 && (unit.ramCooldown || 0) <= 0) {
    const point = { x: player.x - Math.sin(player.heading) * 2, z: player.z - Math.cos(player.heading) * 2 };
    const drive = driveTo(unit, point.x, point.z, dt);
    drive.throttle = 1;
    driveCar(unit, drive, dt, limits);
    resolveCarCollision(unit, city);
    return;
  }
  // Plain pursuit: lead the target; off-road, head for the player's road.
  let target = leadPoint(player);
  if (!sees || dist > 35) {
    const near = nearestRoadPoint(city, player.x, player.z);
    target = { x: near.x, z: near.z };
  }
  const drive = driveTo(unit, target.x, target.z, dt);
  driveCar(unit, drive, dt, limits);
  resolveCarCollision(unit, city);
}

/** Contact between the player and a police car: rams hurt, a PIT spins. */
function resolveUnitContact(unit, police, state, dt) {
  const player = state.car;
  const dx = player.x - unit.x;
  const dz = player.z - unit.z;
  const dist = Math.hypot(dx, dz);
  if (dist >= 4.4 || dist < 1e-6) return;
  const nx = dx / dist;
  const nz = dz / dist;
  const depth = 4.4 - dist;
  // The player is the ram: it keeps its line, the unit is shoved aside.
  unit.x -= nx * depth * 0.7;
  unit.z -= nz * depth * 0.7;
  player.x += nx * depth * 0.3;
  player.z += nz * depth * 0.3;
  const relSpeed = Math.abs((player.vx - unit.vx) * nx + (player.vz - unit.vz) * nz);
  // A hard contact only counts as the player's crime when the PLAYER is the
  // aggressor — faster than the unit and moving. A cop that drives into a
  // stopped player does not raise the player's wanted level.
  const playerSpeed = Math.hypot(player.vx, player.vz);
  const unitSpeed = Math.hypot(unit.vx, unit.vz);
  const playerRammed = playerSpeed > 6 && playerSpeed >= unitSpeed;
  if (relSpeed > 8 && playerRammed && state.time - unit.lastReport > 2) {
    unit.lastReport = state.time;
    unit.ramCooldown = 2;
    unit.health -= (relSpeed - 8) * 3;
    player.health -= 2;
    reportCrime(state.wanted, 'ram-police', player.x, player.z, {
      carColor: 'pink', carModel: 'KOMODO GT', jacket: 'red', weapon: null,
    }, state.time);
    state.dialog = {
      who: 'DEPD DISPATCH', role: 'RADIO',
      line: `${unit.callsign} melaporkan tabrakan — ${unit.officer} mengejar mobil pink itu.`,
    };
    if (unit.health <= 0 && unit.state !== 'wrecked') {
      unit.state = 'wrecked';
      unit.wreckTimer = 0;
      unit.speed = 0;
      unit.vx = 0;
      unit.vz = 0;
    }
  }
  // A PIT that makes contact spins the player out, then two cars pin it.
  if (unit.state === 'pit' && relSpeed > 3) {
    const fx = Math.sin(player.heading);
    const fz = Math.cos(player.heading);
    const side = (unit.x - player.x) * fz - (unit.z - player.z) * fx > 0 ? 1 : -1;
    player.spin = side * 3.2;
    player.speed *= 0.45;
    unit.speed *= 0.4;
    unit.state = 'pin-front';
    unit.role = 'pin-front';
    const other = police.units.find((u) => u !== unit && u.state !== 'wrecked' && u.state !== 'pin-rear');
    if (other) {
      other.state = 'pin-rear';
      other.role = 'pin-rear';
    }
    state.dialog = {
      who: 'RINA', role: 'WHEELWOMAN',
      line: 'PIT! Mereka memutar mobilmu — gas, Raka, jangan diam di sini!',
    };
  }
}

/** A spike strip on the predicted escape route: cross it and the tyres go. */
function placeSpikeStrip(police, state) {
  const player = state.car;
  const px = player.x + player.vx * 2.5;
  const pz = player.z + player.vz * 2.5;
  const near = nearestRoadPoint(state.city, px, pz);
  police.spikes.push({ x: near.x, z: near.z, heading: player.heading, placedAt: state.time });
}

function stepSpikes(police, state, dt) {
  const player = state.car;
  for (let i = police.spikes.length - 1; i >= 0; i -= 1) {
    const s = police.spikes[i];
    const dx = player.x - s.x;
    const dz = player.z - s.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 2.2) {
      police.spikes.splice(i, 1);
      state.tyres.flatUntil = state.time + 25;
      state.tyres.steeringDamaged = true;
      state.dialog = {
        who: 'RINA', role: 'WHEELWOMAN',
        line: 'Ban kempis! Spike strip — cari BENGKEL BUDI, cepat!',
      };
    } else if (state.time - s.placedAt > 30) {
      police.spikes.splice(i, 1);
    }
  }
}

/** One fixed step of the police: spawn, tactics, contact, spikes, arrest. */
export function stepPolice(police, state, dt) {
  const { wanted, car: player } = state;
  police.heliAhead = wanted.heliWatching;
  if (wanted.stars > 0) police.pursuitTime += dt;
  else police.pursuitTime = 0;
  police.spikeCooldown -= dt;

  // Spawn up to the level's count; leave when the level clears.
  const desired = DESIRED_COUNT[wanted.stars] ?? 0;
  police.spawnTimer -= dt;
  if (police.units.length < desired && police.units.length < MAX_UNITS && police.spawnTimer <= 0) {
    spawnUnit(police, state.city, player);
    police.spawnTimer = SPAWN_INTERVAL;
  }
  if (wanted.stars === 0) {
    for (let i = police.units.length - 1; i >= 0; i -= 1) {
      const u = police.units[i];
      if (Math.hypot(u.x - player.x, u.z - player.z) > 150) police.units.splice(i, 1);
    }
  }
  // Roadblock + spike strip at 2★+, once per pursuit.
  if (wanted.stars >= 2 && police.pursuitTime > 6 && !police.roadblockSet && police.units.length >= 2) {
    const far = [...police.units].sort((a, b) =>
      Math.hypot(b.x - player.x, b.z - player.z) - Math.hypot(a.x - player.x, a.z - player.z))[0];
    if (far) {
      const ahead = nearestRoadPoint(state.city, player.x + player.vx * 3, player.z + player.vz * 3);
      far.state = 'roadblock';
      far.target = { x: ahead.x, z: ahead.z };
      police.roadblockSet = true;
      if (police.spikeCooldown <= 0 && police.spikes.length < 2) {
        placeSpikeStrip(police, state);
        police.spikeCooldown = 12;
      }
    }
  }
  if (wanted.stars === 0) police.roadblockSet = false;

  for (const unit of [...police.units]) stepUnit(unit, police, state, dt);
  for (const unit of police.units) {
    if (unit.state !== 'wrecked') resolveUnitContact(unit, police, state, dt);
  }
  // Units never pass through traffic cars: shove the unit aside.
  for (const unit of police.units) {
    for (const t of state.traffic.cars) {
      const dx = unit.x - t.x;
      const dz = unit.z - t.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 4.4 && dist > 1e-6) {
        const push = (4.4 - dist) / 2;
        unit.x += (dx / dist) * push;
        unit.z += (dz / dist) * push;
      }
    }
  }
  stepSpikes(police, state, dt);

  // Arrest: a cop beside a stopped player for three seconds ends the run.
  // Range is 5 m, not 4: contact resolution keeps car centres at least
  // 4.4 m apart, so a 4 m check could never fire on a pinned player.
  let arrest = false;
  for (const unit of police.units) {
    if (unit.state === 'wrecked') continue;
    if (Math.hypot(unit.x - player.x, unit.z - player.z) < 5 && Math.abs(player.speed) < 0.5) {
      arrest = true;
      break;
    }
  }
  police.arrestTimer = arrest ? (police.arrestTimer || 0) + dt : 0;
  if (police.arrestTimer > 3 && !state.busted) {
    state.busted = 'arrested';
    state.bustedTimer = 0;
  }
}

/** Add one traffic car far from the player (replaces a commandeered one). */
export function spawnTrafficCar(traffic, city, player, rng) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const lane = city.lanes[Math.floor(rng() * city.lanes.length)];
    const len = Math.hypot(lane.ex - lane.sx, lane.ez - lane.sz);
    const s = range(rng, 4, len - 4);
    if (s > len - 14) continue;
    const t = s / len;
    const x = lane.sx + (lane.ex - lane.sx) * t;
    const z = lane.sz + (lane.ez - lane.sz) * t;
    if (Math.hypot(x - player.x, z - player.z) < 60) continue;
    if (traffic.cars.some((c) => c.lane === city.lanes.indexOf(lane) && Math.abs(c.s - s) < 10)) continue;
    traffic.cars.push({
      lane: city.lanes.indexOf(lane),
      s,
      x,
      z,
      heading: Math.atan2(lane.ex - lane.sx, lane.ez - lane.sz),
      speed: range(rng, 4, 9),
      targetSpeed: range(rng, 8, 13),
      lateral: 0,
      lateralTarget: 0,
      color: ['#E8E4DA', '#7FB3D5', '#D9A441', '#5B7A99', '#C96F4A', '#8FAE8B', '#C0C4C8', '#A8544A'][rangeInt(rng, 0, 7)],
      rng: createRandom(Math.floor(rng() * 2147483647)),
    });
    return true;
  }
  return false;
}
