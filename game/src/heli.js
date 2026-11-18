// AIR-1, the DEPD helicopter at 3★. Three jobs: it never loses contact (the
// ground pursuit never resets while it watches), it feeds positions so
// ground units keep appearing AHEAD of the player, and it denies vertical
// escapes. The spotlight is the weapon, not gunfire: about three seconds of
// continuous lock before the gunner fires — a telegraphed danger. Moving or
// changing direction breaks the lock. While AIR-1 watches, laundry (car,
// clothes, plate changes) does NOT work: the helicopter is the hard counter
// to description-escape. Pure sim — plain data, seeded RNG, no DOM.

const ALTITUDE = 42;
const APPROACH_SPEED = 45;
const WATCH_SPEED = 40;
const LOCK_TIME = 3;
const LOCK_RANGE = 150; // the gunner only fires inside this range
const LOCK_BREAK_TURN = 0.3; // rad/s of heading change that breaks the lock

/** The helicopter state, fresh: on the ground, off. */
export function createHeli() {
  return {
    active: false,
    x: 0,
    z: 0,
    y: 0,
    heading: 0,
    lock: 0,
    cooldown: 0, // seconds after a shot before the gunner can re-acquire
    state: 'off', // 'off' | 'approach' | 'watch' | 'leave'
    rotor: 0,
    shotsFired: 0,
    lastHeading: 0,
  };
}

/** One fixed step of the helicopter. `state` is the whole game state. */
export function stepHeli(heli, state, dt) {
  const { wanted, car: player } = state;
  heli.rotor += dt * 18;

  if (!heli.active && wanted.stars >= 3) {
    // Scramble: appear 150 m off, high, and come in fast.
    heli.active = true;
    heli.state = 'approach';
    heli.x = player.x + 120;
    heli.z = player.z - 90;
    heli.y = ALTITUDE;
    heli.lock = 0;
    state.dialog = {
      who: 'DEPD DISPATCH', role: 'RADIO',
      line: 'AIR-1 di udara — helikopter mengunci posisimu, Raka. Jangan berhenti.',
    };
  }
  if (!heli.active) {
    wanted.heliWatching = false;
    return;
  }
  if (wanted.stars < 3 && heli.state !== 'leave') {
    heli.state = 'leave';
  }
  if (heli.state === 'leave') {
    heli.y = Math.min(ALTITUDE + 40, heli.y + 20 * dt);
    heli.x += (heli.x - player.x) * 0.2 * dt;
    heli.z += (heli.z - player.z) * 0.2 * dt;
    wanted.heliWatching = false;
    if (Math.hypot(heli.x - player.x, heli.z - player.z) > 250) {
      heli.active = false;
      heli.state = 'off';
    }
    return;
  }

  // Hover above the player: approach fast, then settle into a watch orbit.
  const hx = player.x + player.vx * 0.3;
  const hz = player.z + player.vz * 0.3;
  const dx = hx - heli.x;
  const dz = hz - heli.z;
  const dist = Math.hypot(dx, dz);
  const speed = heli.state === 'approach' ? APPROACH_SPEED : WATCH_SPEED;
  if (dist > 1) {
    const step = Math.min(dist, speed * dt);
    heli.x += (dx / dist) * step;
    heli.z += (dz / dist) * step;
  }
  heli.heading = Math.atan2(player.x - heli.x, player.z - heli.z);
  if (heli.state === 'approach' && dist < 15) heli.state = 'watch';

  // While it watches, the ground pursuit never resets and laundry is dead.
  wanted.heliWatching = heli.state === 'watch';

  // The lock: it only builds while the player holds a straight course and
  // the helicopter is close enough to shoot. Any real turn breaks it at
  // once — the gunner never fires at a swerver. After a shot the gunner
  // needs five seconds to re-acquire, and a shot stings (6) rather than
  // shreds: the helicopter is pressure that forces evasion, not a death
  // sentence for driving straight. The watch itself (laundry block, ground
  // pursuit never resetting) does not need range — from 42 m up, AIR-1 can
  // see the player from far away; only the gunfire needs to be close.
  if (heli.state === 'watch') {
    if (heli.cooldown > 0) {
      heli.cooldown -= dt;
      heli.lock = 0;
    } else {
      const headingRate = Math.abs(player.heading - heli.lastHeading) / dt;
      const speed = Math.hypot(player.vx, player.vz);
      const inRange = Math.hypot(heli.x - player.x, heli.z - player.z) < LOCK_RANGE;
      if (headingRate < LOCK_BREAK_TURN && speed > 5 && inRange) {
        heli.lock += dt;
      } else {
        heli.lock = 0;
      }
      if (heli.lock >= LOCK_TIME) {
        heli.lock = 0;
        heli.cooldown = 5;
        heli.shotsFired += 1;
        player.health -= 6;
        state.dialog = {
          who: 'AIR-1', role: 'HELICOPTER',
          line: 'Tembakan dari udara! Belok, Raka — jangan lurus terus!',
        };
      }
    }
  } else {
    heli.lock = 0;
  }
  heli.lastHeading = player.heading;
}
