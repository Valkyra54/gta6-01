// The 3 story jobs — fail-forward, always. Failure is death or arrest ONLY; being spotted
// or driving away is a context change, never a game over. A checkpoint is saved at every
// completed stage, and a bust or a wreck restores the checkpoint, not the whole job.
// M1 "Selamat Datang" $150 (diegetic tutorial, near-impossible to fail), M2 "Paket Panas"
// $200 on time ($100 late — late never fails), M3 "Mobil Pinjaman" $250 (the swap changes
// the car identity to SEDAN BIRU, and the old description goes cold). Pure simulation,
// deterministic from the seed.
import {
  HEALTH_START, MISSIONS, MISSION_ARRIVE_RANGE, MISSION_LATE_PAY,
  MISSION_PAYOUTS, MISSION_TIME_LIMIT, PLAYER_START,
} from './config.js';
import { swapCarIdentity } from './wanted.js';

/** Stage targets per job: each job is 3 stages of open point-to-point driving. */
const STAGES = [
  // M1: meet Rina at the beach end, cruise the beachfront, come back to the start.
  [{ x: -63.5, z: 118 }, { x: -120, z: 130 }, { x: -63.5, z: -20 }],
  // M2: pick the package up in Kota Lama, rush it to the harbour, report back to Rina.
  [{ x: -60, z: 20 }, { x: 144, z: 20 }, { x: -63.5, z: 118 }],
  // M3: reach the swap point, take the sedan to the docks gate, drop it at the pier.
  [{ x: 3.5, z: -40 }, { x: 144, z: 20 }, { x: 198, z: 60 }],
];

const STAGE_TEXT = [
  ['Temui Rina di ujung jalan', 'Ikuti Rina menyusuri Pantai', 'Kembali ke titik awal'],
  ['Ambil paket di Kota Lama', 'Antar paket ke Pelabuhan — cepat!', 'Lapor ke Rina di Pantai'],
  ['Tukar KOMODO GT dengan sedan biru', 'Bawa sedan ke gerbang Pelabuhan', 'Serahkan sedan di dermaga'],
];

export function createMissions() {
  return {
    index: 0,
    stage: 1,
    timer: 0,
    checkpoint: null, // { x, z, heading, cash, index, stage }
    earned: 0,
    done: [false, false, false],
    swapped: false,
  };
}

/** The target the GPS line and the minimap diamond point at right now. */
export function missionTarget(missions) {
  if (missions.index >= MISSIONS.length) return MISSIONS[MISSIONS.length - 1].target;
  return STAGES[missions.index][missions.stage - 1];
}

/** The objective line for the current stage. */
export function missionStageText(missions) {
  if (missions.index >= MISSIONS.length) return 'Semua job selesai — Legenda Dermaga';
  return STAGE_TEXT[missions.index][missions.stage - 1];
}

function saveCheckpoint(missions, state) {
  missions.checkpoint = {
    x: state.car.x,
    z: state.car.z,
    heading: state.car.heading,
    cash: state.cash,
    index: missions.index,
    stage: missions.stage,
  };
}

/** One fixed step: arrive at a stage target, get paid, move on. Never fails a job. */
export function stepMissions(missions, state, dt) {
  if (missions.index >= MISSIONS.length) return;
  if (missions.index === 1) missions.timer += dt; // M2's rush clock runs while it is active

  const target = missionTarget(missions);
  const d = Math.hypot(state.car.x - target.x, state.car.z - target.z);
  if (d > MISSION_ARRIVE_RANGE) return;

  // The M3 swap happens on arriving at the swap point: the car becomes a blue sedan and
  // the description the police hold goes cold.
  if (missions.index === 2 && missions.stage === 1 && !missions.swapped) {
    missions.swapped = true;
    state.carIdentity = 'SEDAN BIRU';
    swapCarIdentity(state.wanted, { carColor: 'blue', carModel: 'SEDAN BIRU', jacket: 'red', weapon: null });
    state.dialog = 'RINA — WHEELWOMAN: Sedan biru, plat baru. DEPD tidak kenal mobil ini.';
  }

  missions.stage += 1;

  if (missions.stage > 3) {
    // Job complete: pay out. M2 late pays half, never nothing.
    let pay = MISSION_PAYOUTS[missions.index];
    if (missions.index === 1 && missions.timer > MISSION_TIME_LIMIT) pay = MISSION_LATE_PAY;
    state.cash += pay;
    missions.earned += pay;
    missions.done[missions.index] = true;
    state.dialog = `MISSION PASSED — ${MISSIONS[missions.index].name} +$${pay}`;
    missions.index += 1;
    missions.stage = 1;
    missions.timer = 0;
    if (missions.index < MISSIONS.length) {
      state.dialog += ` · Job berikutnya: ${MISSIONS[missions.index].name}`;
    } else {
      state.dialog = `SEMUA JOB SELESAI — Legenda Dermaga · +$${missions.earned} total`;
    }
  } else {
    state.dialog = `STAGE ${missions.stage} / 3 — ${missionStageText(missions)}`;
  }
  // The checkpoint is the stage just entered, at the arrival point — a bust during the
  // next stage resumes there, never replays the stage just finished.
  saveCheckpoint(missions, state);
}

/**
 * Busted or wrecked: restore the last stage checkpoint (or the start if there is none),
 * full health, the trail cold. The job is never lost — only the drive since the
 * checkpoint is. Returns true when a respawn happened.
 */
export function stepBusted(missions, state) {
  if (state.health > 0 && !state.wanted.arrested) return false;
  const busted = state.wanted.arrested;
  const cp = missions.checkpoint;
  if (cp) {
    state.car.x = cp.x;
    state.car.z = cp.z;
    state.car.heading = cp.heading;
    state.car.vx = 0;
    state.car.vz = 0;
    state.cash = cp.cash;
    missions.index = cp.index;
    missions.stage = cp.stage;
  } else {
    state.car.x = PLAYER_START.x;
    state.car.z = PLAYER_START.z;
    state.car.heading = PLAYER_START.heading;
    state.car.vx = 0;
    state.car.vz = 0;
  }
  state.health = HEALTH_START;
  state.wanted.arrested = false;
  state.wanted.stars = 0;
  state.wanted.state = 'none';
  state.wanted.description = null;
  state.wanted.lastKnown = null;
  state.wanted.zone = null;
  state.wanted.flatT = 0;
  state.dialog = busted
    ? 'DITANGKAP DEPD — kembali ke checkpoint terakhir. Job tidak hilang.'
    : 'MOBIL HANCUR — kembali ke checkpoint terakhir. Job tidak hilang.';
  return true;
}
