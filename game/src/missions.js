// Story jobs M1–M3, fail-forward by rule: failure is death or arrest ONLY.
// Being spotted, driving away, or running late is a context change, never a
// game over — the job adapts, the pay drops, the story continues. A checkpoint
// is saved after every COMPLETED objective (never per mission), so a bust
// costs one objective, not the whole job. Missions are open point-to-point
// jobs, not scripted corridors. Pure sim — plain data, seeded city, no DOM.

import { createWanted } from './wanted.js';
import { witnessEvent } from './peds.js';

const MARKER_RADIUS = 8;
const COLOR_NAMES = {
  '#E8E4DA': 'PUTIH', '#7FB3D5': 'BIRU', '#D9A441': 'KUNING', '#5B7A99': 'ABU',
  '#C96F4A': 'ORANYE', '#8FAE8B': 'HIJAU', '#C0C4C8': 'PERAK', '#A8544A': 'MERAH',
};

/** Mission definitions: objectives in order, each a place and a line. */
function missionDefs(city) {
  const start = city.start;
  const target = city.parkedCars.find((p) => Math.abs(p.x) < 120 && Math.abs(p.z) < 120)
    || city.parkedCars[0];
  return [
    {
      number: 1,
      title: 'Selamat Datang',
      pay: 150,
      objectives: [
        { text: 'Ikuti Rina ke Pantai — 0/1', stage: 'STAGE 1/3 · Rina menunjukkanmu berkeliling', marker: { x: start.x, z: 60 }, line: 'Ikuti aku ke selatan, Raka. Santai saja — kota ini milik kita kalau kau tahu jalannya.' },
        { text: 'Ke Kota Lama — persimpangan lampu merah', stage: 'STAGE 2/3 · Rina menunjukkanmu berkeliling', marker: { x: -33, z: 0 }, line: 'Itu Kota Lama. Lampu merah di sini sungguhan — DEPD suka menilang yang tidak sabar.' },
        { text: 'Ke Pelabuhan — ujung dermaga', stage: 'STAGE 3/3 · Rina menunjukkanmu berkeliling', marker: { x: 200, z: 0 }, line: 'Pelabuhan. Kalau kau butuh uang cepat, di sinilah orang mulai. Tapi jangan sentuh mobil pink itu dulu.' },
      ],
    },
    {
      number: 2,
      title: 'Paket Panas',
      pay: 200,
      objectives: [
        { text: 'Ambil paket di Kota Lama', stage: 'STAGE 1/2 · Paket harus sampai', marker: { x: -33, z: -66 }, line: 'Paketnya di Kota Lama. Ambil, jangan dibuka, jangan ditanya isinya.' },
        { text: 'Antar ke Pelabuhan — cepat!', stage: 'STAGE 2/2 · Paket harus sampai', marker: { x: 200, z: 0 }, timer: 75, line: '75 detik, Raka. Pelabuhan menunggu — dan klien ini tidak suka menunggu.' },
      ],
    },
    {
      number: 3,
      title: 'Mobil Pinjaman',
      pay: 250,
      objectives: [
        { text: 'Temui mobil pinjaman di Kota Lama', stage: 'STAGE 1/3 · Mobil baru, nama baru', marker: { x: target.x, z: target.z }, line: `Mobil pinjamanmu di Kota Lama — ${COLOR_NAMES[target.color] || 'abu-abu'}, parkir di tepi jalan. Jangan ribut saat mengambilnya.` },
        { text: 'Ambil mobilnya — sentuh untuk tukar', stage: 'STAGE 2/3 · Mobil baru, nama baru', marker: { x: target.x, z: target.z }, targetCar: target, line: 'Sentuh mobilnya dan kau jadi orang lain — setidaknya buat polisi.' },
        { text: 'Antar ke Rumah Rina', stage: 'STAGE 3/3 · Mobil baru, nama baru', marker: { x: -99, z: 66 }, line: 'Bawa ke Rumah Rina. Kalau ada yang melihatmu mengambilnya, mereka sudah menelepon.' },
      ],
    },
  ];
}

/** The mission state: the current job, its objective, and the last checkpoint. */
export function createMissions(city) {
  const defs = missionDefs(city);
  const first = defs[0].objectives[0];
  return {
    number: 1,
    title: 'Selamat Datang',
    objective: first.text,
    stage: first.stage,
    marker: first.marker,
    index: 0,
    timer: 0,
    late: false,
    defs,
    checkpoint: null,
  };
}

/** Save a checkpoint after a completed objective: position, cash, the job. */
export function saveCheckpoint(state) {
  const m = state.mission;
  state.mission.checkpoint = {
    number: m.number,
    index: m.index,
    x: state.car.x,
    z: state.car.z,
    heading: state.car.heading,
    cash: state.cash,
    clock: state.clock,
  };
}

/** A bust costs one objective, not the job: back to the checkpoint, clean. */
export function restoreCheckpoint(state) {
  const cp = state.mission.checkpoint;
  const car = state.car;
  if (cp) {
    car.x = cp.x;
    car.z = cp.z;
    car.heading = cp.heading;
    car.speed = 0;
    car.vx = 0;
    car.vz = 0;
    state.cash = cp.cash;
    state.clock = cp.clock;
    const def = state.mission.defs.find((d) => d.number === cp.number);
    state.mission.number = cp.number;
    state.mission.title = def.title;
    state.mission.index = cp.index;
    const obj = def.objectives[cp.index];
    state.mission.objective = obj.text;
    state.mission.stage = obj.stage;
    state.mission.marker = obj.marker;
    state.mission.timer = 0;
    state.mission.late = false;
  } else {
    car.x = state.city.start.x;
    car.z = state.city.start.z;
    car.heading = state.city.start.heading;
    car.speed = 0;
    car.vx = 0;
    car.vz = 0;
  }
  car.health = 100;
  car.spin = 0;
  state.wanted = createWanted();
  state.searchZone = null;
  state.police.units = [];
  state.police.spikes = [];
  state.police.roadblockSet = false;
  state.police.arrestTimer = 0;
  state.heli.active = false;
  state.heli.state = 'off';
  state.heli.lock = 0;
  state.tyres.flatUntil = 0;
  state.tyres.steeringDamaged = false;
  state.carColor = null;
  state.carName = 'KOMODO GT';
  state.busted = null;
  state.bustedTimer = 0;
  state.dialog = {
    who: 'RINA', role: 'WHEELWOMAN',
    line: 'Rina menarikmu keluar — coba lagi dari checkpoint. Satu objective saja yang hilang.',
  };
}

/** Move to the next objective (or the next mission) and pay for the last one. */
function advance(state, pay) {
  const m = state.mission;
  const def = m.defs.find((d) => d.number === m.number);
  if (pay) state.cash += pay;
  m.index += 1;
  if (m.index < def.objectives.length) {
    const obj = def.objectives[m.index];
    m.objective = obj.text;
    m.stage = obj.stage;
    m.marker = obj.marker;
    m.timer = 0;
    if (obj.timer) {
      m.timer = obj.timer;
      m.late = false;
    }
    state.dialog = { who: 'RINA', role: 'WHEELWOMAN', line: obj.line };
    saveCheckpoint(state);
    return;
  }
  // The job is done: pay, then the next job starts (Day 4 owns M4–M7).
  const next = m.defs.find((d) => d.number === m.number + 1);
  if (next) {
    const obj = next.objectives[0];
    m.number = next.number;
    m.title = next.title;
    m.index = 0;
    m.objective = obj.text;
    m.stage = obj.stage;
    m.marker = obj.marker;
    m.timer = 0;
    m.late = false;
    state.dialog = {
      who: 'RINA', role: 'WHEELWOMAN',
      line: `Misi selesai — $${pay} masuk. ${obj.line}`,
    };
    saveCheckpoint(state);
  } else {
    // M3 done: free roam until Day 4 builds M4–M7.
    m.number = 4;
    m.title = 'Ekor Panjang';
    m.index = 0;
    m.objective = 'Jelajahi kota — M4 menyusul di Day 4';
    m.stage = 'FREE ROAM · Dermaga Emas milikmu';
    m.marker = null;
    m.timer = 0;
    state.dialog = {
      who: 'RINA', role: 'WHEELWOMAN',
      line: `Misi selesai — $${pay} masuk. Kota ini milikmu sekarang, Raka.`,
    };
    saveCheckpoint(state);
  }
}

/** One fixed step of the missions: markers, the M2 timer, the M3 car swap. */
export function stepMissions(state, dt) {
  const m = state.mission;
  if (state.busted || m.number > 3) return;
  const def = m.defs.find((d) => d.number === m.number);
  if (!def) return;
  const obj = def.objectives[m.index];
  if (!obj) return;
  // The M2 delivery clock: running out costs pay, never the job.
  if (obj.timer && m.timer > 0) {
    m.timer -= dt;
    m.objective = `Antar ke Pelabuhan — ${Math.max(0, Math.ceil(m.timer))} detik!`;
    if (m.timer <= 0 && !m.late) {
      m.late = true;
      state.dialog = {
        who: 'RINA', role: 'WHEELWOMAN',
        line: 'Terlambat — bayaran dipotong setengah. Tapi barang tetap harus sampai.',
      };
    }
  }
  // The M3 car swap: touch the borrowed car and you become someone else.
  if (obj.targetCar) {
    const t = obj.targetCar;
    const dist = Math.hypot(state.car.x - t.x, state.car.z - t.z);
    if (dist < 4) {
      const colorName = COLOR_NAMES[t.color] || 'ABU';
      const modelName = `SEDAN ${colorName}`;
      state.carColor = t.color;
      state.carName = modelName;
      // Someone may have seen the theft: a 15 m witness radius, a 3–5 s call.
      witnessEvent(state.peds, 'car-theft', t.x, t.z, 15, {
        carColor: colorName.toLowerCase(), carModel: modelName, jacket: 'red', weapon: null,
      }, state.time);
      state.dialog = {
        who: 'RINA', role: 'WHEELWOMAN',
        line: `Kau sekarang ${modelName}. Kalau ada yang melihat, mereka sudah menelepon — cepat pergi.`,
      };
      advance(state, 0);
    }
    return;
  }
  // A marker reached completes the objective. The last objective of a job
  // pays the job (M2 pays half when late); earlier ones pay nothing.
  if (obj.marker) {
    const dist = Math.hypot(state.car.x - obj.marker.x, state.car.z - obj.marker.z);
    if (dist < MARKER_RADIUS) {
      const isLast = m.index === def.objectives.length - 1;
      const pay = !isLast ? 0 : m.number === 2 ? (m.late ? Math.floor(def.pay / 2) : def.pay) : def.pay;
      advance(state, pay);
    }
  }
}
