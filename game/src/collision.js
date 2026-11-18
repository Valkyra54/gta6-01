// Collision between the moving bodies: the player against traffic cars and parked cars,
// and traffic cars against each other. Pure simulation, no rendering. The player is the ram:
// ramming a traffic car keeps the player's speed (a small loss and a hit flash) and shoves
// the other car instead of stopping the player dead.
import { CAR } from './config.js';

/** The player's collision circle plus a traffic car's half-diagonal, in metres. */
const PLAYER_TRAFFIC_MIN = CAR.radius + 2.2;

/** Two traffic cars, bumper to bumper, must stay this far apart centre to centre. */
const TRAFFIC_TRAFFIC_MIN = 4.4;

function knock(car, nx, nz, strength, pvx, pvz) {
  car.knockX += nx * strength + pvx * 0.25;
  car.knockZ += nz * strength + pvz * 0.25;
}

/**
 * Player vs traffic cars (circle vs circle). The traffic car is displaced out of the
 * overlap and knocked along the push plus a share of the player's velocity; the player
 * keeps 94% of its speed and takes a hit flash the HUD can read.
 */
export function resolvePlayerTraffic(player, cars) {
  const playerSpeed = Math.hypot(player.vx, player.vz);
  for (let i = 0; i < cars.length; i += 1) {
    const c = cars[i];
    const dx = c.x - player.x;
    const dz = c.z - player.z;
    const d = Math.hypot(dx, dz);
    if (d >= PLAYER_TRAFFIC_MIN || d < 0.0001) continue;
    const nx = dx / d;
    const nz = dz / d;
    const overlap = PLAYER_TRAFFIC_MIN - d;
    c.x += nx * overlap;
    c.z += nz * overlap;
    knock(c, nx, nz, 2 + playerSpeed * 0.35, player.vx, player.vz);
    player.vx *= 0.94;
    player.vz *= 0.94;
    player.bump = 6;
  }
}

/**
 * Traffic cars against each other (circle vs circle). Only matters when a rammed car is
 * shoved into a neighbour — the IDM gap already keeps them apart while driving.
 */
export function resolveTrafficTraffic(cars) {
  for (let i = 0; i < cars.length; i += 1) {
    for (let j = i + 1; j < cars.length; j += 1) {
      const a = cars[i];
      const b = cars[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d >= TRAFFIC_TRAFFIC_MIN || d < 0.0001) continue;
      const nx = dx / d;
      const nz = dz / d;
      const push = (TRAFFIC_TRAFFIC_MIN - d) / 2;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
      knock(a, -nx, -nz, 1, 0, 0);
      knock(b, nx, nz, 1, 0, 0);
    }
  }
}

/**
 * OBB vs OBB (separating axis test): the world-frame push that moves box `a` out of box
 * `b`, or null when they do not overlap. Each box is {x, z, heading, hw, hd} — half width
 * across the car, half length along it. A car's true half width is 0.95 m, so a car
 * centred in its lane (3.5 m from the road centreline) clears a parked car (5.6 m out)
 * by 0.2 m — a circle big enough to cover the car's corners would scrape it instead.
 */
export function obbPush(a, b) {
  const aX = { x: Math.cos(a.heading), z: -Math.sin(a.heading) };
  const aZ = { x: Math.sin(a.heading), z: Math.cos(a.heading) };
  const bX = { x: Math.cos(b.heading), z: -Math.sin(b.heading) };
  const bZ = { x: Math.sin(b.heading), z: Math.cos(b.heading) };
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  let minOverlap = Infinity;
  let minAxis = null;
  let minSign = 1;
  for (const u of [aX, aZ, bX, bZ]) {
    const rA = a.hw * Math.abs(u.x * aX.x + u.z * aX.z) + a.hd * Math.abs(u.x * aZ.x + u.z * aZ.z);
    const rB = b.hw * Math.abs(u.x * bX.x + u.z * bX.z) + b.hd * Math.abs(u.x * bZ.x + u.z * bZ.z);
    const dist = Math.abs(dx * u.x + dz * u.z);
    const overlap = rA + rB - dist;
    if (overlap <= 0) return null;
    if (overlap < minOverlap) {
      minOverlap = overlap;
      minAxis = u;
      minSign = (dx * u.x + dz * u.z) >= 0 ? 1 : -1;
    }
  }
  return { x: minAxis.x * minOverlap * minSign, z: minAxis.z * minOverlap * minSign };
}

/** Do two boxes overlap? (For tests.) */
export function boxesOverlap(a, b) {
  return obbPush(a, b) !== null;
}

/**
 * Player vs parked cars (oriented box vs oriented box). The parked car is a solid kerb
 * obstacle: push the player out along the shallowest axis and remove only the speed
 * into the box, keeping the slide along it — so the player slides around a parked car
 * instead of sticking to it. (Scaling the whole velocity, as a wall hit does, wedges
 * the car against the box's face: every step re-enters it and re-zeroes the speed.)
 */
export function resolvePlayerParked(player, city) {
  const p = { x: player.x, z: player.z, heading: player.heading, hw: 0.95, hd: 2.2 };
  for (let i = 0; i < city.parked.length; i += 1) {
    const parked = city.parked[i];
    const q = { x: parked.x, z: parked.z, heading: parked.heading, hw: 0.95, hd: 2.15 };
    const push = obbPush(p, q);
    if (!push) continue;
    player.x += push.x;
    player.z += push.z;
    p.x = player.x;
    p.z = player.z;
    const pushLen = Math.hypot(push.x, push.z);
    if (pushLen < 0.0001) continue;
    const nx = push.x / pushLen;
    const nz = push.z / pushLen;
    const dot = player.vx * nx + player.vz * nz;
    if (dot < -0.5) {
      player.vx -= dot * nx;
      player.vz -= dot * nz;
      player.bump = 6;
    }
  }
}
