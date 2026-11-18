// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s steps
// (several in a slow frame, none in a fast one), and the renderer paints what is there. The game
// moves between three screens: title, play and paused. There is no save, no garage, no on-foot
// and no map screen in this build — the title screen only lists keys that actually work.
//
// ?seed=N fixes the city. ?shot=start|play|chase|street|end (with &seed=N) stages that scene
// instead of running the loop, paints it twice and sets window.__shotReady for a screenshot.
import { HEALTH_START, PLAYER_START, START_CASH, STEP, WANTED } from './config.js';
import { createRandom } from './random.js';
import { createCity } from './city.js';
import { createCar, stepCar } from './car.js';
import { createTraffic, stepTraffic } from './traffic.js';
import { createPeds, stepPeds } from './peds.js';
import { resolvePlayerParked, resolvePlayerTraffic, resolveTrafficTraffic } from './collision.js';
import { createWanted, interruptReports, reportCrime, stepWanted } from './wanted.js';
import { createPolice, resolvePlayerPolice, spawnPolice, stepPolice } from './police.js';
import { createHeli, stepHeli } from './heli.js';
import { createMissions, missionTarget, stepBusted, stepMissions } from './missions.js';
import { ACTION_CONFIRM, ACTION_PAUSE, createInput } from './input.js';
import { createRenderer, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { createMinimap } from './minimap.js';
import { createHud, fillTitleScreen } from './hud.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1;

const canvas = document.getElementById('game');
const status = document.getElementById('status');

function createSim(seedValue) {
  const city = createCity(seedValue);
  const state = {
    city,
    car: createCar(PLAYER_START),
    traffic: createTraffic(city, seedValue),
    peds: createPeds(city, seedValue),
    wanted: createWanted(),
    police: createPolice(city, seedValue),
    heli: createHeli(),
    missions: createMissions(),
    time: 0,
    missionIndex: 0,
    stage: 1,
    missionTarget: { x: -63.5, z: 118 },
    cash: START_CASH,
    health: HEALTH_START,
    carIdentity: 'KOMODO GT',
    stars: 0,
    searchZone: null,
    cameraYaw: 0,
    dialog: 'RINA — WHEELWOMAN: Ikuti aku, Raka — jangan ngebut di Kota Lama, DEPD lagi rajin.',
    prompt: 'WASD drive · SPACE handbrake · P pause',
  };
  return {
    state,
    reset() {
      state.car = createCar(PLAYER_START);
      state.traffic = createTraffic(state.city, seedValue);
      state.peds = createPeds(state.city, seedValue);
      state.wanted = createWanted();
      state.police = createPolice(state.city, seedValue);
      state.heli = createHeli();
      state.missions = createMissions();
      state.time = 0;
      state.missionIndex = 0;
      state.stage = 1;
      state.missionTarget = { x: -63.5, z: 118 };
      state.cash = START_CASH;
      state.health = HEALTH_START;
      state.carIdentity = 'KOMODO GT';
      state.stars = 0;
      state.searchZone = null;
      state.cameraPitch = 0;
      state.fov = 0;
    },
    place(x, z, heading) {
      state.car = createCar({ x, z, heading });
    },
    step(drive) {
      stepCar(state.car, drive, state.city, STEP);
      // Flat tyres after a spike strip: top speed ~40% until repaired.
      if (state.wanted.flatT > 0) {
        const sp = Math.hypot(state.car.vx, state.car.vz);
        if (sp > WANTED.flatSpeed) {
          state.car.vx *= WANTED.flatSpeed / sp;
          state.car.vz *= WANTED.flatSpeed / sp;
        }
      }
      stepTraffic(state.traffic, state.city, state.car, STEP, state.time);
      resolvePlayerTraffic(state.car, state.traffic.cars);
      resolveTrafficTraffic(state.traffic.cars);
      resolvePlayerParked(state.car, state.city);
      spawnPolice(state.police, state.city, state.car, state.wanted.stars);
      stepPolice(state.police, state.city, state.car, state.wanted, state.traffic, STEP, state.time);
      resolvePlayerPolice(state.car, state.police.units);
      // AIR-1: while it watches, the player is watched — laundry does not work.
      state.health -= stepHeli(state.heli, state.car, state.wanted, STEP, state.time);
      state.wanted.heliWatching = state.heli.active;
      // A witness phone call only becomes stars if it finishes: get close and stop it.
      interruptReports(state.peds, state.car);
      stepPeds(state.peds, state.city, state.car, STEP, state.time, (ped) => {
        // The call got through: the witness files what it saw.
        reportCrime(state.wanted, {
          kind: 'reckless',
          x: ped.x,
          z: ped.z,
          description: ped.sawIt
            ? { carColor: ped.sawIt.carColor, carModel: ped.sawIt.carModel, jacket: 'red', weapon: null }
            : null,
        });
      });
      stepWanted(state.wanted, state.car, state.police.units, STEP);
      stepMissions(state.missions, state, STEP);
      stepBusted(state.missions, state);
      state.stars = state.wanted.stars;
      state.searchZone = state.wanted.zone;
      state.missionIndex = state.missions.index;
      state.stage = state.missions.stage;
      state.missionTarget = missionTarget(state.missions);
      state.time += STEP;
    },
  };
}

const sim = createSim(seed);
const renderer = createRenderer(canvas, sim.state.city);
const minimap = createMinimap(document.getElementById('minimap'));
const hud = createHud(document, minimap);
fillTitleScreen(document);

function runShot(name) {
  const scene = stageShot(name, sim, renderer);
  let painted = 0;
  function paint() {
    renderer.draw(sim.state, scene.screen, STEP);
    hud.update(sim.state);
    if (scene.screen === SCREEN_TITLE) hud.showTitle();
    else hud.showPlay();
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let accumulator = 0;
  let last = performance.now();

  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    sim.reset();
    accumulator = 0;
    screen = SCREEN_PLAY;
    hud.showPlay();
    announce('Playing. Follow Rina to the beach.');
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_CONFIRM && screen === SCREEN_TITLE) startGame();
    else if (actions & ACTION_PAUSE && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      hud.showPaused();
      announce('Paused.');
    } else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && screen === SCREEN_PAUSED) {
      screen = SCREEN_PLAY;
      hud.showPlay();
      announce('Playing.');
    }
  }

  function step() {
    if (screen === SCREEN_TITLE) return;
    const drive = {
      steer: input.direction(),
      throttle: input.throttle(),
      handbrake: input.handbrake(),
    };
    sim.state.cameraYaw = input.cameraYaw();
    sim.step(drive);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    accumulator += dt;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    renderer.draw(sim.state, screen, dt);
    hud.update(sim.state);
  }

  // Leaving the tab pauses a running game rather than letting the car drive unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      hud.showPaused();
      announce('Paused.');
    }
  });

  hud.showTitle();
  announce('DERMAGA EMAS. Press Space or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
