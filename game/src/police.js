// The DEPD in pursuit: pure-pursuit units on the road graph, with PIT, box-in, rolling
// roadblock, spike strip and commandeer. A unit is a kinematic car (the same bicycle
// model as the player, capped at 1.08x the player's top speed) — no pathfinding, just
// pursuit steering, which is how the real chases in this build work. A cop ramming the
// player never raises the wanted level. A wrecked cop steals the nearest traffic car and
// keeps chasing. Pure simulation, deterministic from the seed.
import { CAR, POLICE } from './config.js';
import { createRandom } from './random.js';
import { stepCar } from './car.js';
import { nearestSegment } from './city.js';
import { applySpike } from './wanted.js';

const CALLSIGNS = ['TUNA', 'HIU', 'ELANG', 'MARLIN', 'GULL'];
const OFFICERS = ['Ofc. Sari', 'Sgt. Made', 'Ofc. Putri', 'Ofc. Agus'];

/** Player-unit contact distance: contact resolution keeps cars ≥4.4 m apart. */
const PLAYER_UNIT_MIN = 3.8;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function wrapAngle(angle) {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function playerForward(player) {
  return { x: Math.sin(player.heading), z: Math.cos(player.heading) };
}

export function createPolice(city, seed) {
  return {
    units: [],
    random: createRandom(seed + 303),
    spike: null, // { x, z } — a live spike strip on the road, or null
    boxinT: 0, // cooldown before the next box-in assignment
    stats: { pits: 0, rams: 0, spikes: 0, commandeers: 0, arrests: 0 },
  };
}

/** How many units hunt at each wanted tier: 1 star brings 2 cars, 3 stars bring 4. */
export function unitsForStars(stars) {
  return POLICE.unitsForStars[Math.max(0, Math.min(3, stars))];
}

/** The road node nearest a point, at least `minFar` from the player. */
function nodeNear(city, x, z, player, minFar) {
  let best = null;
  let bestD = Infinity;
  for (const n of city.nodes) {
    if (Math.hypot(n.x - player.x, n.z - player.z) < minFar) continue;
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

/** Drop one unit onto the road at a node, facing the player. */
function spawnUnit(police, city, player, node) {
  const near = nearestSegment(city, node.x, node.z);
  const s = near.segment;
  const dx = s.b.x - s.a.x;
  const dz = s.b.z - s.a.z;
  const x = s.a.x + dx * near.t;
  const z = s.a.z + dz * near.t;
  const n = police.units.length;
  police.units.push({
    x, z,
    heading: Math.atan2(player.x - x, player.z - z),
    vx: 0, vz: 0, steer: 0, bump: 0, distance: 0,
    callsign: CALLSIGNS[n % CALLSIGNS.length],
    officer: OFFICERS[n % OFFICERS.length],
    state: 'pursue',
    tailT: 0, ramCd: 0, wrecked: false, wreckT: 0, pinT: 0, arrestT: 0,
    targetX: 0, targetZ: 0, holdT: 0,
  });
}

/**
 * Top the pursuit up to the tier's unit count. New units appear AHEAD of the player —
 * the heli feeds positions, so ground units keep arriving in front, not behind.
 */
export function spawnPolice(police, city, player, stars) {
  const want = unitsForStars(stars);
  while (police.units.length < want) {
    const fwd = playerForward(player);
    const aheadX = player.x + fwd.x * 90;
    const aheadZ = player.z + fwd.z * 90;
    let node = nodeNear(city, aheadX, aheadZ, player, 25);
    if (!node) node = nodeNear(city, player.x - fwd.x * 60, player.z - fwd.z * 60, player, 10);
    if (!node) return;
    spawnUnit(police, city, player, node);
  }
}

/** Drive one unit toward (tx, tz) with the kinematic car model. */
function driveToward(unit, city, tx, tz, dt, throttle, cap) {
  const desired = Math.atan2(tx - unit.x, tz - unit.z);
  const diff = wrapAngle(desired - unit.heading);
  const steer = clamp(diff * 1.6, -1, 1);
  stepCar(unit, { steer, throttle, handbrake: false }, city, dt, cap);
}

/**
 * Player vs police cars (circle vs circle). The player is the ram here too: the player
 * keeps 94% of its speed and the unit is shoved. A hard hit (relative speed over 20 m/s)
 * wrecks the unit's car — it will commandeer a traffic car and keep chasing.
 * Returns how many units were wrecked by this step.
 */
export function resolvePlayerPolice(player, units) {
  const playerSpeed = Math.hypot(player.vx, player.vz);
  let wrecks = 0;
  for (let i = 0; i < units.length; i += 1) {
    const u = units[i];
    if (u.wrecked) continue;
    const dx = u.x - player.x;
    const dz = u.z - player.z;
    const d = Math.hypot(dx, dz);
    if (d >= PLAYER_UNIT_MIN || d < 0.0001) continue;
    const nx = dx / d;
    const nz = dz / d;
    const overlap = PLAYER_UNIT_MIN - d;
    u.x += nx * overlap;
    u.z += nz * overlap;
    const rel = Math.hypot(player.vx - u.vx, player.vz - u.vz);
    u.vx += nx * (2 + playerSpeed * 0.35) + player.vx * 0.25;
    u.vz += nz * (2 + playerSpeed * 0.35) + player.vz * 0.25;
    player.vx *= 0.94;
    player.vz *= 0.94;
    player.bump = 6;
    if (rel > 20) {
      u.wrecked = true;
      u.wreckT = POLICE.commandeerSeconds;
      u.state = 'wrecked';
      u.vx = 0;
      u.vz = 0;
      wrecks += 1;
    }
  }
  return wrecks;
}

/** One fixed step for every pursuit unit. */
export function stepPolice(police, city, player, wanted, traffic, dt, time) {
  if (wanted.stars === 0) {
    police.units.length = 0;
    police.spike = null;
    return;
  }
  spawnPolice(police, city, player, wanted.stars);

  const playerSpeed = Math.hypot(player.vx, player.vz);
  const fwd = playerForward(player);

  // At 2 stars and up, one unit holds a roadblock on the predicted escape route — the
  // player 3 seconds ahead — and drops a spike strip there with it.
  if (wanted.stars >= 2) {
    const hasRoadblock = police.units.some((u) => u.state === 'roadblock');
    if (!hasRoadblock) {
      let far = null;
      let farD = -1;
      for (const u of police.units) {
        if (u.wrecked || u.state === 'pin') continue;
        const d = Math.hypot(u.x - player.x, u.z - player.z);
        if (d > farD) { farD = d; far = u; }
      }
      if (far) {
        const node = nodeNear(city, player.x + player.vx * POLICE.roadblockAheadSeconds,
          player.z + player.vz * POLICE.roadblockAheadSeconds, player, 10);
        if (node) {
          far.state = 'roadblock';
          far.targetX = node.x;
          far.targetZ = node.z;
          far.holdT = POLICE.roadblockHoldSeconds;
          if (!police.spike) police.spike = { x: node.x, z: node.z };
        }
      }
    }
  } else {
    police.spike = null;
    for (const u of police.units) if (u.state === 'roadblock') u.state = 'pursue';
  }

  // Box-in: at 2 stars and up with three units, the third flanks the player and caps its
  // speed for a few seconds, then falls back to pursuit. 6 s on, 6 s off.
  if (wanted.stars >= 2 && police.units.length >= 3) {
    police.boxinT -= dt;
    if (police.boxinT <= 0) {
      const third = police.units[2];
      if (third && !third.wrecked && third.state === 'pursue') {
        third.state = 'boxin';
        third.holdT = POLICE.boxinSeconds;
        police.boxinT = POLICE.boxinSeconds * 2;
      } else if (third && third.state === 'boxin') {
        police.boxinT = POLICE.boxinSeconds;
      }
    }
  }

  for (const u of police.units) {
    if (u.ramCd > 0) u.ramCd -= dt;

    // Wrecked: wait, then steal the nearest traffic car and keep chasing.
    if (u.wrecked) {
      u.wreckT -= dt;
      if (u.wreckT <= 0) {
        let best = -1;
        let bestD = Infinity;
        for (let i = 0; i < traffic.cars.length; i += 1) {
          const c = traffic.cars[i];
          const d = Math.hypot(c.x - u.x, c.z - u.z);
          if (d < bestD) { bestD = d; best = i; }
        }
        if (best >= 0 && bestD < POLICE.commandeerRange) {
          const stolen = traffic.cars.splice(best, 1)[0];
          u.x = stolen.x;
          u.z = stolen.z;
          u.heading = stolen.heading;
          u.vx = 0;
          u.vz = 0;
          u.wrecked = false;
          u.state = 'pursue';
          police.stats.commandeers += 1;
        } else {
          u.wreckT = 1; // no car close enough yet — try again in a second
        }
      }
      continue;
    }

    const dist = Math.hypot(u.x - player.x, u.z - player.z);
    const behind = (u.x - player.x) * fwd.x + (u.z - player.z) * fwd.z < 0;

    if (u.state === 'pit') {
      // Align to the player's rear quarter; contact spins the player.
      const side = ((u.x - player.x) * -fwd.z + (u.z - player.z) * fwd.x) >= 0 ? 1 : -1;
      const tx = player.x - fwd.x * 2.5 + -fwd.z * side * 2.2;
      const tz = player.z - fwd.z * 2.5 + fwd.x * side * 2.2;
      driveToward(u, city, tx, tz, dt, 1, POLICE.topSpeed);
      if (dist < POLICE.pitContact) {
        player.heading += 1.1;
        player.vx *= 0.4;
        player.vz *= 0.4;
        player.bump = 6;
        u.state = 'pin';
        u.pinT = POLICE.pinSeconds;
        police.stats.pits += 1;
      }
      continue;
    }

    if (u.state === 'pin') {
      // Two cars pin the player front-back after the spin.
      driveToward(u, city, player.x + fwd.x * 4, player.z + fwd.z * 4, dt, 1, POLICE.topSpeed);
      u.pinT -= dt;
      if (u.pinT <= 0) u.state = 'pursue';
      continue;
    }

    if (u.state === 'roadblock') {
      const nodeD = Math.hypot(u.targetX - u.x, u.targetZ - u.z);
      if (nodeD < 6) {
        // Hold the node, parked across the road.
        const seg = nearestSegment(city, u.targetX, u.targetZ).segment;
        u.heading += wrapAngle((seg.angle + Math.PI / 2) - u.heading) * Math.min(1, 4 * dt);
        u.vx *= 0.9;
        u.vz *= 0.9;
        u.holdT -= dt;
      } else {
        driveToward(u, city, u.targetX, u.targetZ, dt, 1, POLICE.topSpeed);
      }
      if (u.holdT <= 0 || Math.hypot(player.x - u.targetX, player.z - u.targetZ) > 60) {
        u.state = 'pursue';
      }
      continue;
    }

    if (u.state === 'boxin') {
      // Flank the player's right side and match speed, capping the escape.
      const tx = player.x - fwd.z * 6;
      const tz = player.z + fwd.x * 6;
      const unitSpeed = Math.hypot(u.vx, u.vz);
      const throttle = unitSpeed > playerSpeed + 1 ? -0.5 : 1;
      driveToward(u, city, tx, tz, dt, throttle, Math.max(playerSpeed + 2, 12));
      u.holdT -= dt;
      if (u.holdT <= 0) u.state = 'pursue';
      continue;
    }

    // Pursue: chase the player, ram when close, track the tail for a PIT. A unit on the
    // tail MATCHES the player's speed instead of charging in — that is what lets a 1.5 s
    // tail build up at all. A ram never fires while the unit is tailing (the tail is for
    // the PIT); rams come from the side or the front.
    const tailCap = behind && dist < 15 ? Math.max(playerSpeed + 2, 12) : POLICE.topSpeed;
    driveToward(u, city, player.x, player.z, dt, 1, tailCap);
    if (dist < POLICE.ramRange && u.ramCd <= 0 && !(behind && u.tailT > 0.5)) {
      const nx = (player.x - u.x) / (dist || 1);
      const nz = (player.z - u.z) / (dist || 1);
      player.vx += nx * 6;
      player.vz += nz * 6;
      player.bump = 6;
      u.ramCd = POLICE.ramCooldown;
      police.stats.rams += 1;
      // A ram never raises the wanted level — only witness reports do.
    }
    if (behind && dist < POLICE.pitRange) u.tailT += dt;
    else u.tailT = 0;
    if (u.tailT >= POLICE.pitTailSeconds && playerSpeed < POLICE.pitSpeed) {
      u.state = 'pit';
    }

    // Arrest: slow and close for two seconds, and the chase ends at the checkpoint.
    if (dist < POLICE.arrestRange && playerSpeed < 2) {
      u.arrestT += dt;
      if (u.arrestT >= POLICE.arrestSeconds && !wanted.arrested) {
        wanted.arrested = true;
        police.stats.arrests += 1;
      }
    } else {
      u.arrestT = 0;
    }
  }

  // The spike strip: crossing it at speed means flat tyres until repaired.
  if (police.spike) {
    const d = Math.hypot(player.x - police.spike.x, player.z - police.spike.z);
    if (d < 3 && playerSpeed > 5) {
      applySpike(wanted);
      police.spike = null;
      police.stats.spikes += 1;
    }
  }
}
