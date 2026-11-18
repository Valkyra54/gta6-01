// Seeded city generation: a road GRAPH (nodes + segments + lanes) on a grid,
// three districts with an explicit build policy, and every prop placed by a
// seeded generator — the same seed gives the same city on every load. This file
// holds plain data only; render.js turns it into three.js meshes. The graph is
// what later drives traffic, police routing, GPS and the minimap.
import { CITY, DISTRICTS, DISTRICT_OF_COLUMN, PALETTE } from './config.js';
import { chance, createRandom, pick, range, rangeInt } from './random.js';

const LANE_OFFSET = 3.5; // half a 7 m lane: right-hand traffic, one lane each way
const PALM_SPACING = 12;
const PARKED_COLORS = ['#E8E4DA', '#7FB3D5', '#D9A441', '#5B7A99', '#C96F4A', '#8FAE8B'];

/** The district name at a world position (for the HUD and the minimap label). */
export function districtAt(x, z) {
  if (z > 190) return 'Pelabuhan';
  if (x < -66) return DISTRICTS[0];
  if (x > 66) return DISTRICTS[2];
  return DISTRICTS[1];
}

/** Node coordinates: the grid is centred on the origin. */
function nodeX(i) {
  return (i - (CITY.nodesX - 1) / 2) * CITY.pitch;
}
function nodeZ(j) {
  return (j - (CITY.nodesZ - 1) / 2) * CITY.pitch;
}

function buildRoadGraph(random) {
  const nodes = [];
  for (let j = 0; j < CITY.nodesZ; j += 1) {
    for (let i = 0; i < CITY.nodesX; i += 1) {
      nodes.push({ id: j * CITY.nodesX + i, i, j, x: nodeX(i), z: nodeZ(j) });
    }
  }
  const nodeAt = (i, j) => nodes[j * CITY.nodesX + i];
  const segments = [];
  function addSegment(a, b) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    segments.push({
      a: a.id, b: b.id, ax: a.x, az: a.z, bx: b.x, bz: b.z,
      dx: dx / length, dz: dz / length, length,
      horizontal: Math.abs(dz) < 0.01,
    });
  }
  for (let j = 0; j < CITY.nodesZ; j += 1) {
    for (let i = 0; i < CITY.nodesX - 1; i += 1) addSegment(nodeAt(i, j), nodeAt(i + 1, j));
  }
  for (let i = 0; i < CITY.nodesX; i += 1) {
    for (let j = 0; j < CITY.nodesZ - 1; j += 1) addSegment(nodeAt(i, j), nodeAt(i, j + 1));
  }
  // The causeway: a road segment from the south-east corner node to the island.
  const islandNode = { id: nodes.length, i: 7, j: 6, x: 300, z: 250 };
  nodes.push(islandNode);
  addSegment(nodeAt(CITY.nodesX - 1, CITY.nodesZ - 1), islandNode);

  // Two lanes per segment, right-hand traffic: each lane is an offset centreline.
  // Traffic also reads the lane's direction (horizontal) and the node it ends
  // at (for the traffic lights), so those ride along on the lane.
  const lanes = [];
  for (const s of segments) {
    const rx = -s.dz; // right of the travel direction, in the x/z plane
    const rz = s.dx;
    lanes.push({
      sx: s.ax + rx * LANE_OFFSET, sz: s.az + rz * LANE_OFFSET,
      ex: s.bx + rx * LANE_OFFSET, ez: s.bz + rz * LANE_OFFSET,
      horizontal: s.horizontal, startNode: { x: s.ax, z: s.az }, endNode: { x: s.bx, z: s.bz },
    });
    lanes.push({
      sx: s.bx - rx * LANE_OFFSET, sz: s.bz - rz * LANE_OFFSET,
      ex: s.ax - rx * LANE_OFFSET, ez: s.az - rz * LANE_OFFSET,
      horizontal: s.horizontal, startNode: { x: s.bx, z: s.bz }, endNode: { x: s.ax, z: s.az },
    });
  }
  return { nodes, segments, lanes };
}

function buildBuildings(random) {
  const buildings = [];
  const windows = [];
  for (let col = 0; col < CITY.nodesX - 1; col += 1) {
    for (let row = 0; row < CITY.nodesZ - 1; row += 1) {
      const district = DISTRICT_OF_COLUMN[col];
      const cx = (nodeX(col) + nodeX(col + 1)) / 2;
      const cz = (nodeZ(row) + nodeZ(row + 1)) / 2;
      // Two rows of plots per block, facing the horizontal roads.
      for (const side of [-1, 1]) {
        const count = rangeInt(random, 3, 4);
        for (let k = 0; k < count; k += 1) {
          if (!chance(random, 0.85)) continue;
          const w = range(random, 12, Math.min(20, CITY.pitch / count - 2));
          const d = range(random, 10, 14);
          // Keep every footprint clear of the roads and their 3 m sidewalks:
          // a plot may only sit where its whole footprint is at least 10 m
          // from the nearest road centreline. (The west-edge plots used to
          // spill 5 m into the beach road — the car drove into a wall.)
          const xMin = nodeX(col) + 10 + w / 2;
          const xMax = nodeX(col + 1) - 10 - w / 2;
          const zMin = nodeZ(row) + 10 + d / 2;
          const zMax = nodeZ(row + 1) - 10 - d / 2;
          const x = Math.max(xMin, Math.min(xMax,
            cx + (k - (count - 1) / 2) * (CITY.pitch / count) + range(random, -2, 2)));
          const z = Math.max(zMin, Math.min(zMax, cz + side * 14 + range(random, -2, 2)));
          let h;
          let color;
          if (district === 0) { // Pantai: pastel Art Deco, 3–4 floors, stepped top
            h = range(random, 10, 16);
            color = pick(random, PALETTE.facades);
          } else if (district === 1) { // Kota Lama: warm mid-rise
            h = range(random, 8, 14);
            color = pick(random, ['#F7D774', '#E8B48C', '#D9A441', '#C98A6B', '#FFF3E0']);
          } else { // Pelabuhan: grey industrial, some with a red roof accent
            h = range(random, 6, 12);
            color = chance(random, 0.3) ? PALETTE.craneRed : pick(random, ['#8A8D90', '#6E7276', '#A8A29A']);
          }
          const stepped = district === 0 && chance(random, 0.7);
          buildings.push({ x, z, w, d, h, color, district, stepped });
          // Windows on the two street-facing sides, a seeded lit subset.
          const cols = Math.max(2, Math.floor(w / 4));
          const rows = Math.max(2, Math.floor(h / 3.4));
          for (const face of [-1, 1]) {
            for (let c = 0; c < cols; c += 1) {
              for (let r = 0; r < rows; r += 1) {
                const wx = x + (c - (cols - 1) / 2) * (w / cols);
                const wy = 2.2 + r * 3.2;
                const wz = z + face * (d / 2 + 0.06);
                windows.push({ x: wx, y: wy, z: wz, lit: chance(random, 0.35) });
              }
            }
          }
        }
      }
    }
  }
  return { buildings, windows };
}

function buildProps(random, graph, buildings) {
  const palms = [];
  // Palms line the beach strip road (the west edge), both sides, every ~12 m.
  const beachX = nodeX(0);
  for (let z = -120; z <= 120; z += PALM_SPACING) {
    for (const side of [-1, 1]) {
      if (!chance(random, 0.9)) continue;
      palms.push({ x: beachX + side * 9.5 + range(random, -1, 1), z: z + range(random, -3, 3), h: range(random, 5, 7.5), lean: range(random, -0.08, 0.08) });
    }
  }
  // A few palms scattered through the Pantai blocks — never inside a building.
  const insideBuilding = (x, z) => buildings.some(
    (b) => Math.abs(x - b.x) < b.w / 2 + 1 && Math.abs(z - b.z) < b.d / 2 + 1,
  );
  for (let k = 0; k < 14; k += 1) {
    const x = range(random, -150, -70);
    const z = range(random, -120, 120);
    if (insideBuilding(x, z)) continue;
    palms.push({ x, z, h: range(random, 4.5, 7), lean: range(random, -0.1, 0.1) });
  }
  const lamps = [];
  for (const n of graph.nodes) {
    if (n.i === 7) continue; // the island node gets the lighthouse, not a lamp
    lamps.push({ x: n.x + 8.5, z: n.z + 8.5 });
  }
  const parkedCars = [];
  const parkedSegments = graph.segments.filter((s) => s.horizontal && s.az > -100);
  for (let k = 0; k < 12; k += 1) {
    const s = pick(random, parkedSegments);
    const t = range(random, 0.15, 0.85);
    // Parked at the road's outer edge (6.2 m from the centreline), parallel
    // to the road: the long axis lies along the segment, so traffic in the
    // lane beside it passes with room to spare.
    const heading = s.horizontal
      ? (chance(random, 0.5) ? Math.PI / 2 : -Math.PI / 2)
      : (chance(random, 0.5) ? 0 : Math.PI);
    parkedCars.push({
      x: s.ax + (s.bx - s.ax) * t + (s.horizontal ? 0 : 6.2),
      z: s.az + (s.bz - s.az) * t + (s.horizontal ? 6.2 : 0),
      heading,
      color: pick(random, PARKED_COLORS),
    });
  }
  // Containers stacked on the pier, not floating in the harbour water.
  const containers = [];
  for (let k = 0; k < 9; k += 1) {
    containers.push({
      x: 185 + k * 12, z: range(random, -3, 3),
      w: 12, d: 2.6, h: 2.6,
      color: pick(random, [PALETTE.craneRed, '#2E6E8E', '#D9A441', '#5B7A99']),
    });
  }
  return { palms, lamps, parkedCars, containers };
}

/**
 * Build the whole city from a seed. Returns plain data: the road graph, the
 * buildings and windows, the props, the water, the island and the causeway,
 * and the hero car's start pose on the beach strip road, heading south into
 * the low sun.
 */
export function buildCity(seed) {
  const random = createRandom(seed);
  const graph = buildRoadGraph(random);
  const { buildings, windows } = buildBuildings(random);
  const props = buildProps(random, graph, buildings);
  const bounds = {
    minX: nodeX(0) - CITY.pitch / 2,
    maxX: nodeX(CITY.nodesX - 1) + CITY.pitch / 2,
    minZ: nodeZ(0) - CITY.pitch / 2,
    maxZ: nodeZ(CITY.nodesZ - 1) + CITY.pitch / 2,
  };
  // Traffic lights on the four central junctions (Kota Lama), each with a
  // seeded phase offset so they do not all change at once.
  const lights = [];
  for (const [i, j] of [[2, 1], [3, 1], [2, 2], [3, 2]]) {
    lights.push({ x: nodeX(i), z: nodeZ(j), offset: range(random, 0, 22) });
  }
  return {
    seed,
    ...graph,
    buildings,
    windows,
    ...props,
    lights,
    causeway: { x0: nodeX(CITY.nodesX - 1), z0: nodeZ(CITY.nodesZ - 1), x1: 300, z1: 250 },
    sea: { x0: -620, z0: -260, x1: -186, z1: 260 },
    sand: { x0: -186, z0: -260, x1: -172, z1: 260 },
    harbour: { x0: 186, z0: -132, x1: 430, z1: 132 },
    pier: { x0: 172, z0: -5, x1: 300, z1: 5 },
    island: { x: 300, z: 250, radius: 42 },
    lighthouse: { x: 300, z: 250, height: 26 },
    bounds,
    // Beach strip road, heading south: the sun (south-west) sits ahead-left.
    // The southbound lane is the west side (right-hand traffic), so the start
    // sits at nodeX(0) MINUS the lane offset — the east side is oncoming.
    start: { x: nodeX(0) - LANE_OFFSET, z: -100, heading: 0 },
  };
}
