// The seeded city: a road graph (nodes + segments + lanes) that drives traffic, police
// routing, GPS and the minimap, plus the buildings, palms, lamps, parked cars, sea, sand,
// harbour, pier, island and lighthouse that sit on it. Pure data — no rendering in here.
// Blocks are 44–60 m, roads ~14 m; building footprints are clamped at least 10 m + half their
// size from every road centreline, so no wall ever stands in a lane.
import { CITY, PALETTE } from './config.js';
import { createRandom, intRange, pick, range } from './random.js';

export function createCity(seed) {
  const random = createRandom(seed);
  const nodes = [];
  const nodeByKey = new Map();
  const segments = [];

  function node(x, z) {
    const key = `${x},${z}`;
    let n = nodeByKey.get(key);
    if (!n) {
      n = { x, z, id: nodes.length };
      nodeByKey.set(key, n);
      nodes.push(n);
    }
    return n;
  }

  function segment(a, b, kind) {
    segments.push({ a, b, kind: kind || 'street', id: segments.length });
  }

  // Grid avenues (north-south) and streets (east-west).
  for (const x of CITY.avenues) {
    const zs = [...CITY.streets, CITY.beachfrontZ];
    for (let i = 0; i < zs.length - 1; i += 1) segment(node(x, zs[i]), node(x, zs[i + 1]), 'avenue');
  }
  for (const z of CITY.streets) {
    const xs = [...CITY.avenues, CITY.harbourX];
    for (let i = 0; i < xs.length - 1; i += 1) segment(node(xs[i], z), node(xs[i + 1], z), 'street');
  }
  // Beachfront along the sand, harbour road along the docks.
  for (let i = 0; i < CITY.avenues.length - 1; i += 1) {
    segment(node(CITY.avenues[i], CITY.beachfrontZ), node(CITY.avenues[i + 1], CITY.beachfrontZ), 'beachfront');
  }
  segment(node(CITY.avenues[CITY.avenues.length - 1], CITY.beachfrontZ), node(CITY.harbourX, CITY.beachfrontZ), 'beachfront');
  for (let i = 0; i < CITY.streets.length - 1; i += 1) {
    segment(node(CITY.harbourX, CITY.streets[i]), node(CITY.harbourX, CITY.streets[i + 1]), 'harbour');
  }
  segment(node(CITY.harbourX, CITY.streets[CITY.streets.length - 1]), node(CITY.harbourX, CITY.beachfrontZ), 'harbour');
  // Causeway out to the island, and the pier into the harbour water.
  const causewayA = node(-120, -100);
  const causewayB = node(-135, -150);
  const islandNode = node(CITY.island.x, CITY.island.z);
  segment(causewayA, causewayB, 'causeway');
  segment(causewayB, islandNode, 'causeway');
  segment(node(CITY.harbourX, 60), node(205, 60), 'pier');

  // Lanes: every segment carries two lanes, offset left/right of its centreline.
  for (const s of segments) {
    const dx = s.b.x - s.a.x;
    const dz = s.b.z - s.a.z;
    const len = Math.hypot(dx, dz);
    const nx = -dz / len;
    const nz = dx / len;
    const off = CITY.laneOffset;
    s.lanes = [
      { x1: s.a.x + nx * off, z1: s.a.z + nz * off, x2: s.b.x + nx * off, z2: s.b.z + nz * off },
      { x1: s.a.x - nx * off, z1: s.a.z - nz * off, x2: s.b.x - nx * off, z2: s.b.z - nz * off },
    ];
    s.length = len;
    s.angle = Math.atan2(dx, dz); // heading along the segment, 0 = south
  }

  // Buildings, one block at a time. A block is the ground between two neighbouring avenues
  // and two neighbouring streets; the beachfront row and the harbour column are blocks too.
  const buildings = [];
  const colEdges = [...CITY.avenues, CITY.harbourX];
  const rowEdges = [...CITY.streets, CITY.beachfrontZ];
  for (let c = 0; c < colEdges.length - 1; c += 1) {
    for (let r = 0; r < rowEdges.length - 1; r += 1) {
      const x0 = colEdges[c] + 11;
      const x1 = colEdges[c + 1] - 11;
      const z0 = rowEdges[r] + 11;
      const z1 = rowEdges[r + 1] - 11;
      if (x1 - x0 < 14 || z1 - z0 < 14) continue;
      const downtown = Math.abs((x0 + x1) / 2) <= 65 && z1 <= 25 && z0 >= -45;
      const count = intRange(random, 2, 4);
      for (let i = 0; i < count; i += 1) {
        const w = range(random, 10, 22);
        const d = range(random, 10, 20);
        const x = range(random, x0 + w / 2, x1 - w / 2);
        const z = range(random, z0 + d / 2, z1 - d / 2);
        // Keep footprints apart so walls never overlap each other.
        let clash = false;
        for (const other of buildings) {
          if (Math.abs(other.x - x) < (other.hw + w / 2 + 4) && Math.abs(other.z - z) < (other.hd + d / 2 + 4)) { clash = true; break; }
        }
        if (clash) continue;
        const h = downtown ? range(random, 16, 30) : range(random, 8, 18);
        buildings.push({
          x, z, hw: w / 2, hd: d / 2, h,
          color: pick(random, PALETTE.facades),
          district: r === rowEdges.length - 2 ? 'Pantai' : (c === colEdges.length - 2 ? 'Pelabuhan' : (x < -30 ? 'Kota Lama' : 'Pantai')),
        });
      }
    }
  }

  // Palms: a double row along the beachfront sand and sidewalk, plus scattered avenue palms.
  const palms = [];
  for (let x = -115; x <= 145; x += 11) {
    if (random() < 0.72) palms.push({ x: x + range(random, -2, 2), z: 137, s: range(random, 0.85, 1.25) });
    if (random() < 0.45) palms.push({ x: x + range(random, -2, 2), z: 123.5, s: range(random, 0.8, 1.15) });
  }
  for (const x of [-60, 60]) {
    for (let z = -95; z <= 125; z += 18) {
      if (random() < 0.5) palms.push({ x: x + (random() < 0.5 ? -8.5 : 8.5), z: z + range(random, -3, 3), s: range(random, 0.8, 1.2) });
    }
  }

  // Lamps along every street, alternating sides, and parked cars at the kerb.
  const lamps = [];
  const parked = [];
  for (const s of segments) {
    if (s.kind === 'pier' || s.kind === 'causeway') continue;
    const steps = Math.floor(s.length / 24);
    for (let i = 1; i <= steps; i += 1) {
      const t = i / (steps + 1);
      const side = i % 2 === 0 ? 1 : -1;
      const nx = Math.cos(s.angle) * side;
      const nz = -Math.sin(s.angle) * side;
      lamps.push({
        x: s.a.x + (s.b.x - s.a.x) * t + nx * 7.4,
        z: s.a.z + (s.b.z - s.a.z) * t + nz * 7.4,
      });
    }
    const carsHere = intRange(random, 0, 3);
    for (let i = 0; i < carsHere; i += 1) {
      const t = range(random, 0.12, 0.88);
      const side = random() < 0.5 ? 1 : -1;
      const nx = Math.cos(s.angle) * side;
      const nz = -Math.sin(s.angle) * side;
      parked.push({
        x: s.a.x + (s.b.x - s.a.x) * t + nx * 5.6,
        z: s.a.z + (s.b.z - s.a.z) * t + nz * 5.6,
        heading: s.angle + (side > 0 ? 0 : Math.PI),
        color: pick(random, PALETTE.parked),
      });
    }
  }

  // Harbour containers, stacked in the yard between the last avenue and the docks.
  const containers = [];
  for (let gx = 0; gx < 4; gx += 1) {
    for (let gz = 0; gz < 3; gz += 1) {
      if (random() < 0.2) continue;
      const stack = intRange(random, 1, 2);
      for (let level = 0; level < stack; level += 1) {
        containers.push({
          x: 130 + gx * 5.2, z: 46 + gz * 7.5, y: 1.3 + level * 2.6,
          color: pick(random, PALETTE.container),
        });
      }
    }
  }

  return { nodes, segments, buildings, palms, lamps, parked, containers, seed };
}

/** The segment whose centreline is nearest to (x, z), for the autopilot and the GPS. */
export function nearestSegment(city, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const s of city.segments) {
    const dx = s.b.x - s.a.x;
    const dz = s.b.z - s.a.z;
    const t = Math.max(0, Math.min(1, ((x - s.a.x) * dx + (z - s.a.z) * dz) / (dx * dx + dz * dz)));
    const px = s.a.x + dx * t;
    const pz = s.a.z + dz * t;
    const d = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d < bestD) { bestD = d; best = { segment: s, t }; }
  }
  return best;
}
