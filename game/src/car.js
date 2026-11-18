// The hero car's driving model: a kinematic arcade model (velocity vector +
// slip angle + grip), deterministic, no dependency. The car is plain data —
// x, z, heading, speed and slip — and this file only moves that data. render.js
// draws it; input.js feeds it.
import { CAR } from './config.js';

/** The car's sim state, fresh from a start pose. */
export function createCar(start) {
  return {
    x: start.x,
    z: start.z,
    heading: start.heading,
    speed: 0, // m/s along the heading; negative is reversing
    vx: 0, // the real velocity vector: it lags the heading when the tail slides
    vz: 0,
    steer: 0, // -1..1, smoothed
    slip: 0, // angle between the velocity and the heading, radians
    drifting: false,
    distance: 0, // metres driven, for the mission log
    health: 100, // 0 = wrecked or busted (Day 3: heli fire, hard rams)
    spin: 0, // rad/s of forced rotation: a PIT sets it, it decays away
  };
}

/** Forward vector of a heading, in the x/z plane. */
export function forwardOf(heading) {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/**
 * Advance the car one fixed step. `drive` is { throttle: 0..1, steer: -1..1,
 * brake: 0..1, handbrake: boolean }. `limits` is the Day 3 tyre state:
 * { maxSpeedMul, turnMul } — flat tyres cap the speed, damaged steering
 * dulls the turn. Steering bites harder the faster the car goes (up to full
 * speed); the handbrake drops the grip so the tail slides.
 */
export function driveCar(car, drive, dt, limits) {
  const maxSpeedMul = limits ? limits.maxSpeedMul : 1;
  const turnMul = limits ? limits.turnMul : 1;
  const grip = drive.handbrake ? CAR.handbrakeGrip : CAR.grip;
  const turn = (drive.handbrake ? CAR.handbrakeTurn : CAR.turnRate) * turnMul;
  // Smooth the steering toward the input: the wheel does not snap.
  const steerTarget = clamp(drive.steer, -1, 1);
  car.steer += (steerTarget - car.steer) * Math.min(1, 10 * dt);
  // Speed: engine, brake, drag. Reverse is capped low.
  if (drive.throttle > 0) car.speed += drive.throttle * CAR.accel * dt;
  if (drive.brake > 0) car.speed -= drive.brake * CAR.brake * dt;
  car.speed -= car.speed * CAR.drag * dt;
  car.speed = clamp(car.speed, -CAR.maxReverse, CAR.maxSpeed * maxSpeedMul);
  if (drive.throttle === 0 && drive.brake === 0 && Math.abs(car.speed) < 0.15) car.speed = 0;
  // Heading follows the steering, scaled by how fast the car is moving.
  const speedFactor = clamp(car.speed / CAR.maxSpeed, -1, 1);
  car.heading += car.steer * turn * speedFactor * dt;
  // The velocity vector chases the heading at the grip rate: full grip is no
  // slide at all, low grip (handbrake) leaves the tail out. Slip is the angle
  // between the two, and it is what the renderer turns into skid marks.
  const f = forwardOf(car.heading);
  const k = Math.min(1, grip * dt);
  car.vx += (f.x * car.speed - car.vx) * k;
  car.vz += (f.z * car.speed - car.vz) * k;
  const px = car.x + car.vx * dt;
  const pz = car.z + car.vz * dt;
  const moved = Math.hypot(px - car.x, pz - car.z);
  car.distance += moved;
  car.x = px;
  car.z = pz;
  const vSpeed = Math.hypot(car.vx, car.vz);
  if (vSpeed > 0.5) {
    const dot = clamp((car.vx * f.x + car.vz * f.z) / vSpeed, -1, 1);
    const cross = f.x * car.vz - f.z * car.vx;
    car.slip = Math.acos(dot) * (cross < 0 ? -1 : 1);
  } else {
    car.slip = 0;
  }
  car.drifting = drive.handbrake && Math.abs(car.speed) > 8;
  // A PIT spin: the heading is forced around and decays back to the driver.
  if (car.spin) {
    car.heading += car.spin * dt;
    car.spin *= Math.max(0, 1 - 3 * dt);
    if (Math.abs(car.spin) < 0.05) car.spin = 0;
  }
}

/** Speed in km/h, for the HUD. */
export function speedKmh(car) {
  return Math.round(Math.abs(car.speed) * 3.6);
}
