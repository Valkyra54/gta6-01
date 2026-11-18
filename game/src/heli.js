// AIR-1, the DEPD helicopter: it arrives at 3 stars and does three jobs — it never loses
// contact (the ground pursuit never resets while it watches), it feeds positions so ground
// units keep appearing ahead of the player, and it denies escapes. The spotlight is the
// weapon, not gunfire: ~3 s of continuous steady lock, telegraphed, before the gunner
// fires. Turning or changing direction breaks the lock. While AIR-1 watches, laundry
// (car/clothes/plate changes) does NOT work — the heli is the hard counter to
// description-escape. Pure simulation, deterministic from the seed.
import { HELI } from './config.js';

export function createHeli() {
  return {
    active: false,
    x: 0,
    z: 0,
    y: HELI.height,
    lockT: 0,
    shots: 0,
    reacquireT: 0,
    prevHeading: 0,
    headingRate: 0,
  };
}

/**
 * One fixed step. Returns the damage dealt to the player this step (0 or 6). While the
 * heli is active the caller must treat the player as watched (laundry blocked, search
 * zone pinned on the player).
 */
export function stepHeli(heli, player, wanted, dt, time) {
  heli.active = wanted.stars >= HELI.minStars;
  if (!heli.active) {
    heli.lockT = 0;
    heli.reacquireT = 0;
    return 0;
  }

  // Hover above the player, circling slowly — the spotlight stays on the car.
  const angle = time * 0.15;
  const tx = player.x + Math.cos(angle) * 12;
  const tz = player.z + Math.sin(angle) * 12;
  const dx = tx - heli.x;
  const dz = tz - heli.z;
  const d = Math.hypot(dx, dz);
  const step = Math.min(d, HELI.followSpeed * dt);
  if (d > 0.001) {
    heli.x += (dx / d) * step;
    heli.z += (dz / d) * step;
  }
  heli.y = HELI.height;

  // Steady lock: the player driving straight and fast, inside gun range. Turning faster
  // than the threshold, stopping, or leaving range all bleed the lock away.
  const dist = Math.hypot(heli.x - player.x, heli.z - player.z);
  const speed = Math.hypot(player.vx, player.vz);
  let rate = Math.abs(player.heading - heli.prevHeading) / dt;
  if (rate > Math.PI / dt) rate = 0; // heading wrapped — not a real turn
  heli.headingRate = rate;
  heli.prevHeading = player.heading;
  if (heli.reacquireT > 0) heli.reacquireT -= dt;

  const steady = rate < HELI.steadyTurn && speed > 5 && dist < HELI.lockRange;
  if (steady && heli.reacquireT <= 0) heli.lockT += dt;
  else heli.lockT = Math.max(0, heli.lockT - dt * 2);

  if (heli.lockT >= HELI.lockSeconds) {
    heli.shots += 1;
    heli.lockT = 0;
    heli.reacquireT = HELI.reacquireSeconds;
    return HELI.damage;
  }
  return 0;
}
