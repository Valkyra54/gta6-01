// The renderer: three.js only, drawing what the simulation says. The sim owns
// the state (plain data); this file owns the scene, the golden-hour light rig,
// the instanced city meshes and the chase camera. Nothing here steps the game.
import * as THREE from 'three';
import { CITY, PALETTE, SUN } from './config.js';
import { createRandom } from './random.js';
import { signalPhase } from './traffic.js';

const SKY_RADIUS = 900;

function hexColor(hex) {
  return new THREE.Color(hex);
}

/** The sky dome: a gradient from peach horizon through pink to dusty blue. */
function buildSky(scene) {
  const geo = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      horizon: { value: hexColor(PALETTE.skyHorizon) },
      mid: { value: new THREE.Color('#FF6B9D') },
      zenith: { value: hexColor(PALETTE.skyZenith) },
    },
    vertexShader: 'varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'varying vec3 vPos;',
      'uniform vec3 horizon; uniform vec3 mid; uniform vec3 zenith;',
      'void main() {',
      '  float h = normalize(vPos).y;',
      '  vec3 c = mix(horizon, mid, smoothstep(0.02, 0.16, h));',
      '  c = mix(c, zenith, smoothstep(0.12, 0.55, h));',
      '  gl_FragColor = vec4(c, 1.0);',
      '}',
    ].join('\n'),
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.frustumCulled = false;
  scene.add(dome);
}

/** A radial-gradient canvas texture, for the sun disc and the god-ray sprite. */
function glowTexture(inner, outer) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The low sun: a blown-out disc in the south-west sky, plus a god-ray streak. */
function buildSunDisc(scene) {

  const sunDir = new THREE.Vector3(SUN.dir.x, SUN.dir.y, SUN.dir.z).normalize();
  const disc = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture('rgba(255,240,200,1)', 'rgba(255,160,80,0)'),
    transparent: true, depthWrite: false, fog: false,
  }));
  disc.scale.set(180, 180, 1);
  disc.position.copy(sunDir).multiplyScalar(820);
  disc.position.y = Math.max(disc.position.y, 60);
  scene.add(disc);
  const ray = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture('rgba(255,200,120,0.85)', 'rgba(255,160,80,0)'),
    transparent: true, depthWrite: false, fog: false, rotation: -0.6, opacity: 0.55,
  }));
  ray.scale.set(420, 90, 1);
  ray.position.copy(sunDir).multiplyScalar(780);
  ray.position.y = Math.max(ray.position.y, 45);
  scene.add(ray);
}

/** One directional light low on the horizon + hemisphere fill + peach fog. */
function buildLights(scene) {
  const sun = new THREE.DirectionalLight(SUN.keyColor, SUN.keyIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SUN.shadowMap, SUN.shadowMap);
  sun.shadow.camera.left = -SUN.shadowRange;
  sun.shadow.camera.right = SUN.shadowRange;
  sun.shadow.camera.top = SUN.shadowRange;
  sun.shadow.camera.bottom = -SUN.shadowRange;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 500;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(SUN.skyColor, SUN.groundColor, SUN.hemiIntensity);
  scene.add(hemi);
  scene.fog = new THREE.FogExp2(SUN.fogColor, SUN.fogDensity);
  return sun;
}

function box(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true }),
  );
  m.position.set(x, y, z);
  return m;
}

/** Ground, roads, sidewalks and centre dashes, straight from the road graph. */
function buildGround(scene, city) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1500, 1000),
    new THREE.MeshStandardMaterial({ color: 0x5a4f45, roughness: 1, flatShading: true }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.05, 0);
  ground.receiveShadow = true;
  scene.add(ground);

  const roadMat = new THREE.MeshStandardMaterial({ color: PALETTE.road, roughness: 0.95, flatShading: true });
  const walkMat = new THREE.MeshStandardMaterial({ color: PALETTE.sidewalk, roughness: 1, flatShading: true });
  for (const s of city.segments) {
    const midX = (s.ax + s.bx) / 2;
    const midZ = (s.az + s.bz) / 2;
    const angle = s.horizontal ? 0 : Math.PI / 2;
    const len = s.length + CITY.roadWidth;
    const road = new THREE.Mesh(new THREE.PlaneGeometry(len, CITY.roadWidth), roadMat);
    road.rotation.x = -Math.PI / 2;
    road.rotation.z = angle;
    road.position.set(midX, 0.02, midZ);
    road.receiveShadow = true;
    scene.add(road);
    for (const side of [-1, 1]) {
      const walk = new THREE.Mesh(new THREE.PlaneGeometry(len, 3), walkMat);
      walk.rotation.x = -Math.PI / 2;
      walk.rotation.z = angle;
      const off = (CITY.roadWidth / 2 + 1.5) * side;
      walk.position.set(midX + (s.horizontal ? 0 : off), 0.04, midZ + (s.horizontal ? off : 0));
      walk.receiveShadow = true;
      scene.add(walk);
    }
  }
  // Centre dashes: one instanced mesh for every dash in the city.
  const dashGeo = new THREE.BoxGeometry(2.2, 0.06, 0.28);
  const dashMat = new THREE.MeshStandardMaterial({ color: PALETTE.roadDash, roughness: 0.8 });
  const dashes = [];
  for (const s of city.segments) {
    for (let d = 3; d < s.length - 3; d += 6) {
      dashes.push({ x: s.ax + s.dx * d, z: s.az + s.dz * d, horizontal: s.horizontal });
    }
  }
  const dashMesh = new THREE.InstancedMesh(dashGeo, dashMat, dashes.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const eul = new THREE.Euler();
  dashes.forEach((d, i) => {
    eul.set(0, d.horizontal ? 0 : Math.PI / 2, 0);
    q.setFromEuler(eul);
    m4.compose(new THREE.Vector3(d.x, 0.05, d.z), q, new THREE.Vector3(1, 1, 1));
    dashMesh.setMatrixAt(i, m4);
  });
  dashMesh.instanceMatrix.needsUpdate = true;
  scene.add(dashMesh);
}

/** Buildings as two instanced meshes (boxes + Art Deco roof steps), windows as a third. */
function buildBuildings(scene, city) {
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
  const mesh = new THREE.InstancedMesh(unit, mat, city.buildings.length);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  city.buildings.forEach((b, i) => {
    m4.makeScale(b.w, b.h, b.d);
    m4.setPosition(b.x, b.h / 2, b.z);
    mesh.setMatrixAt(i, m4);
    mesh.setColorAt(i, col.set(b.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const stepped = city.buildings.filter((b) => b.stepped);
  if (stepped.length > 0) {
    const steps = new THREE.InstancedMesh(unit, mat.clone(), stepped.length);
    stepped.forEach((b, i) => {
      m4.makeScale(b.w * 0.68, 1.4, b.d * 0.68);
      m4.setPosition(b.x, b.h + 0.7, b.z);
      steps.setMatrixAt(i, m4);
      steps.setColorAt(i, col.set(b.color));
    });
    steps.instanceMatrix.needsUpdate = true;
    steps.castShadow = true;
    scene.add(steps);
  }

  const winGeo = new THREE.BoxGeometry(1.1, 1.6, 0.1);
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const wins = new THREE.InstancedMesh(winGeo, winMat, city.windows.length);
  city.windows.forEach((w, i) => {
    m4.identity();
    m4.setPosition(w.x, w.y, w.z);
    wins.setMatrixAt(i, m4);
    wins.setColorAt(i, col.set(w.lit ? PALETTE.windowLit : PALETTE.windowDark));
  });
  wins.instanceMatrix.needsUpdate = true;
  scene.add(wins);
}

/** A palm frond: a tapered blade that droops toward its tip, built by hand
 *  so it reads as a frond from the chase camera, not a flat dark umbrella. */
function makeFrondGeometry() {
  const segments = 6;
  const length = 2.6;
  const positions = [];
  const indices = [];
  for (let i = 0; i <= segments; i += 1) {
    const u = i / segments;
    const x = u * length;
    const y = -u * u * 0.9; // the tip droops
    const half = 0.28 * (1 - u * 0.65); // the blade tapers
    positions.push(x, y, -half, x, y, half);
  }
  for (let i = 0; i < segments; i += 1) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Palms (instanced trunks + frond crowns), lamps (instanced poles + glowing heads). */
function buildStreetProps(scene, city) {
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 1, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: PALETTE.palmTrunk, roughness: 1, flatShading: true });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, city.palms.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const eul = new THREE.Euler();
  // Fronds: seven drooping blades per palm, fanned around the crown top,
  // so a palm reads as a palm at a glance instead of a flat dark umbrella.
  const FRONDS_PER_PALM = 7;
  const frondGeo = makeFrondGeometry();
  const frondMat = new THREE.MeshStandardMaterial({ color: PALETTE.palm, roughness: 1, flatShading: true, side: THREE.DoubleSide });
  const fronds = new THREE.InstancedMesh(frondGeo, frondMat, city.palms.length * FRONDS_PER_PALM);
  const heartGeo = new THREE.IcosahedronGeometry(0.45, 0);
  const hearts = new THREE.InstancedMesh(heartGeo, frondMat, city.palms.length);
  const frondRandom = createRandom(11);
  const up = new THREE.Vector3(1, 0, 0);
  const dir = new THREE.Vector3();
  city.palms.forEach((p, i) => {
    eul.set(0, 0, p.lean);
    q.setFromEuler(eul);
    m4.compose(new THREE.Vector3(p.x, p.h / 2, p.z), q, new THREE.Vector3(1, p.h, 1));
    trunks.setMatrixAt(i, m4);
    m4.identity();
    m4.setPosition(p.x, p.h + 0.7, p.z);
    hearts.setMatrixAt(i, m4);
    for (let k = 0; k < FRONDS_PER_PALM; k += 1) {
      const yaw = (k / FRONDS_PER_PALM) * Math.PI * 2 + (frondRandom() - 0.5) * 0.5;
      dir.set(Math.cos(yaw), -0.15 - frondRandom() * 0.2, Math.sin(yaw)).normalize();
      q.setFromUnitVectors(up, dir);
      const scale = 0.85 + frondRandom() * 0.3;
      m4.compose(new THREE.Vector3(p.x, p.h + 0.7, p.z), q, new THREE.Vector3(scale, scale, scale));
      fronds.setMatrixAt(i * FRONDS_PER_PALM + k, m4);
    }
  });
  trunks.instanceMatrix.needsUpdate = true;
  fronds.instanceMatrix.needsUpdate = true;
  hearts.instanceMatrix.needsUpdate = true;
  trunks.castShadow = true;
  fronds.castShadow = true;
  scene.add(trunks);
  scene.add(fronds);
  scene.add(hearts);

  const poleGeo = new THREE.CylinderGeometry(0.07, 0.09, 5, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2e3438, roughness: 0.8 });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, city.lamps.length);
  const headGeo = new THREE.SphereGeometry(0.22, 8, 6);
  const headMat = new THREE.MeshBasicMaterial({ color: PALETTE.windowLit });
  const heads = new THREE.InstancedMesh(headGeo, headMat, city.lamps.length);
  city.lamps.forEach((l, i) => {
    m4.identity();
    m4.setPosition(l.x, 2.5, l.z);
    poles.setMatrixAt(i, m4);
    m4.setPosition(l.x, 5.1, l.z);
    heads.setMatrixAt(i, m4);
  });
  poles.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  scene.add(poles);
  scene.add(heads);
}

/** Parked cars, harbour containers, sea + harbour water, pier, island, lighthouse. */
function buildHarbour(scene, city) {
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const parked = new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ roughness: 0.7, flatShading: true }), city.parkedCars.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const eul = new THREE.Euler();
  const col = new THREE.Color();
  city.parkedCars.forEach((c, i) => {
    eul.set(0, c.heading, 0);
    q.setFromEuler(eul);
    m4.compose(new THREE.Vector3(c.x, 0.35, c.z), q, new THREE.Vector3(1.9, 0.7, 4.2));
    parked.setMatrixAt(i, m4);
    parked.setColorAt(i, col.set(c.color));
  });
  parked.instanceMatrix.needsUpdate = true;
  parked.castShadow = true;
  scene.add(parked);

  const boxes = new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), city.containers.length);
  city.containers.forEach((c, i) => {
    m4.makeScale(c.w, c.h, c.d);
    m4.setPosition(c.x, c.h / 2, c.z);
    boxes.setMatrixAt(i, m4);
    boxes.setColorAt(i, col.set(c.color));
  });
  boxes.instanceMatrix.needsUpdate = true;
  boxes.castShadow = true;
  scene.add(boxes);

  const waterMat = new THREE.MeshStandardMaterial({ color: PALETTE.water, roughness: 0.15, metalness: 0.55, flatShading: true });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(city.sea.x1 - city.sea.x0, city.sea.z1 - city.sea.z0), waterMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set((city.sea.x0 + city.sea.x1) / 2, 0.06, 0);
  scene.add(sea);
  const harbour = new THREE.Mesh(new THREE.PlaneGeometry(city.harbour.x1 - city.harbour.x0, city.harbour.z1 - city.harbour.z0), waterMat.clone());
  harbour.rotation.x = -Math.PI / 2;
  harbour.position.set((city.harbour.x0 + city.harbour.x1) / 2, 0.06, 0);
  scene.add(harbour);
  // The sun's gold streak on the sea, pointing at the low sun.
  const streak = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 26),
    new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.5 }),
  );
  streak.rotation.x = -Math.PI / 2;
  streak.rotation.z = Math.atan2(SUN.dir.z, SUN.dir.x);
  streak.position.set(-330, 0.09, 40);
  scene.add(streak);
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(city.sand.x1 - city.sand.x0, city.sand.z1 - city.sand.z0),
    new THREE.MeshStandardMaterial({ color: PALETTE.sand, roughness: 1, flatShading: true }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set((city.sand.x0 + city.sand.x1) / 2, 0.03, 0);
  sand.receiveShadow = true;
  scene.add(sand);

  const pier = box(city.pier.x1 - city.pier.x0, 1.2, city.pier.z1 - city.pier.z0, PALETTE.concrete, (city.pier.x0 + city.pier.x1) / 2, 0.4, 0);
  pier.receiveShadow = true;
  scene.add(pier);
  const causewayLen = Math.hypot(city.island.x - 165, city.island.z - 132);
  const causeway = box(causewayLen, 0.8, 10, PALETTE.road, (165 + city.island.x) / 2, 0.2, (132 + city.island.z) / 2);
  causeway.rotation.y = -Math.atan2(city.island.z - 132, city.island.x - 165);
  causeway.receiveShadow = true;
  scene.add(causeway);
  const island = new THREE.Mesh(
    new THREE.CylinderGeometry(city.island.radius, city.island.radius * 1.05, 2.4, 24),
    new THREE.MeshStandardMaterial({ color: PALETTE.sand, roughness: 1, flatShading: true }),
  );
  island.position.set(city.island.x, 0.8, city.island.z);
  island.receiveShadow = true;
  scene.add(island);
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 3, city.lighthouse.height, 10),
    new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.8, flatShading: true }),
  );
  tower.position.set(city.lighthouse.x, city.lighthouse.height / 2 + 2, city.lighthouse.z);
  tower.castShadow = true;
  scene.add(tower);
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(2.35, 2.35, 3, 10),
    new THREE.MeshStandardMaterial({ color: PALETTE.craneRed, roughness: 0.8, flatShading: true }),
  );
  band.position.set(city.lighthouse.x, city.lighthouse.height - 4, city.lighthouse.z);
  scene.add(band);
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(1.4, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xfff2b0 }),
  );
  lamp.position.set(city.lighthouse.x, city.lighthouse.height + 2.6, city.lighthouse.z);
  scene.add(lamp);
}

/** The hero car: one saturated pink KOMODO GT, one yellow stripe, big wheels. */
function buildHeroCar() {
  const group = new THREE.Group();
  const pink = new THREE.MeshStandardMaterial({ color: PALETTE.hero, emissive: PALETTE.hero, emissiveIntensity: 0.3, roughness: 0.45, metalness: 0.25, flatShading: true });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1a2230, roughness: 0.2, metalness: 0.6, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.9, flatShading: true });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.2), pink);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.0), glass);
  cabin.position.set(0, 1.05, -0.2);
  cabin.castShadow = true;
  group.add(cabin);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 4.0), new THREE.MeshStandardMaterial({ color: PALETTE.heroStripe, roughness: 0.6 }));
  stripe.position.set(0, 0.85, 0);
  group.add(stripe);
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.4), dark);
  spoiler.position.set(0, 1.0, -2.0);
  group.add(spoiler);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [x, z] of [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]]) {
    const wheel = new THREE.Mesh(wheelGeo, dark);
    wheel.position.set(x, 0.36, z);
    wheel.castShadow = true;
    group.add(wheel);
  }
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
  for (const x of [-0.6, 0.6]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.06), headMat);
    head.position.set(x, 0.62, 2.12);
    group.add(head);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 0.06), new THREE.MeshBasicMaterial({ color: 0xff2233 }));
  tail.position.set(0, 0.72, -2.12);
  group.add(tail);
  // The body material rides on the group so the M3 car swap can repaint it.
  group.userData.bodyMat = pink;
  return group;
}

/** Dust motes drifting in the light, one draw call. */
function buildDust(scene) {
  const random = createRandom(7);
  const count = 220;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    pos[i * 3] = (random() - 0.5) * 90;
    pos[i * 3 + 1] = random() * 10 + 0.5;
    pos[i * 3 + 2] = (random() - 0.5) * 90;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xffd9a0, size: 0.14, transparent: true, opacity: 0.55, depthWrite: false,
  }));
  scene.add(points);
  return points;
}

/**
 * Build the renderer for a city. Returns draw(state, screen): state is the sim
 * state ({ city, car, time }), screen is 'title' | 'play' | 'paused'.
 */
export function createRenderer(container, city) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  buildSky(scene);
  buildSunDisc(scene);
  const sun = buildLights(scene);
  buildGround(scene, city);
  buildBuildings(scene, city);
  buildStreetProps(scene, city);
  buildHarbour(scene, city);
  const heroCar = buildHeroCar();
  scene.add(heroCar);
  const dust = buildDust(scene);

  // Police, helicopter, spike strips and the search zone are drawn from the
  // sim state, built once here (fixed maximums; unused slots hide at scale 0).
  const MAX_POLICE = 6;
  const policeGroup = new THREE.Group();
  scene.add(policeGroup);
  const policeBodies = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.9, 0.65, 4.2),
    new THREE.MeshStandardMaterial({ color: PALETTE.policeBody, roughness: 0.6, flatShading: true }),
    MAX_POLICE,
  );
  const policeCabins = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.6, 0.5, 2.0),
    new THREE.MeshStandardMaterial({ color: PALETTE.policeTrim, roughness: 0.2, metalness: 0.6, flatShading: true }),
    MAX_POLICE,
  );
  const policeRed = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.5, 0.16, 0.3),
    new THREE.MeshBasicMaterial({ color: 0xff2233 }),
    MAX_POLICE,
  );
  const policeBlue = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.5, 0.16, 0.3),
    new THREE.MeshBasicMaterial({ color: 0x2e6bff }),
    MAX_POLICE,
  );
  policeBodies.castShadow = true;
  policeCabins.castShadow = true;
  policeGroup.add(policeBodies);
  policeGroup.add(policeCabins);
  policeGroup.add(policeRed);
  policeGroup.add(policeBlue);

  // AIR-1: white body, tail, a spinning rotor, a spotlight cone and the
  // light pool it throws on the street below.
  const heliGroup = new THREE.Group();
  const heliBodyMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.6, flatShading: true });
  const heliBody = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 5.2), heliBodyMat);
  heliBody.castShadow = true;
  heliGroup.add(heliBody);
  const heliTail = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 4.6), heliBodyMat);
  heliTail.position.set(0, 0.2, -4.4);
  heliGroup.add(heliTail);
  const heliRotor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x1c2230, roughness: 0.7 }));
  heliRotor.position.y = 1.0;
  heliGroup.add(heliRotor);
  const heliSpot = new THREE.Mesh(
    new THREE.ConeGeometry(7, 42, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }),
  );
  heliSpot.rotation.x = Math.PI;
  heliSpot.position.y = -21;
  heliGroup.add(heliSpot);
  const heliPool = new THREE.Mesh(
    new THREE.CircleGeometry(7, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  heliPool.rotation.x = -Math.PI / 2;
  heliPool.position.y = -41.5;
  heliGroup.add(heliPool);
  heliGroup.visible = false;
  scene.add(heliGroup);

  // Spike strips: two dark bars with teeth, placed by the police.
  const spikeMeshes = [];
  for (let i = 0; i < 2; i += 1) {
    const strip = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.12, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x1c2230, roughness: 0.9 }));
    strip.add(bar);
    for (let k = -2; k <= 2; k += 1) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.35, 4),
        new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.5, metalness: 0.7 }));
      tooth.position.set(k * 0.9, 0.2, 0);
      strip.add(tooth);
    }
    strip.visible = false;
    scene.add(strip);
    spikeMeshes.push(strip);
  }

  // The search zone: a pulsing red ring and disc on the street, at the last
  // place the police saw the player.
  const zoneRing = new THREE.Mesh(
    new THREE.RingGeometry(0.96, 1, 48),
    new THREE.MeshBasicMaterial({ color: 0xff2e63, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
  );
  zoneRing.rotation.x = -Math.PI / 2;
  zoneRing.position.y = 0.12;
  zoneRing.visible = false;
  scene.add(zoneRing);
  const zoneDisc = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48),
    new THREE.MeshBasicMaterial({ color: 0xff2e63, transparent: true, opacity: 0.08, depthWrite: false }),
  );
  zoneDisc.rotation.x = -Math.PI / 2;
  zoneDisc.position.y = 0.1;
  zoneDisc.visible = false;
  scene.add(zoneDisc);

  // Traffic, peds and traffic lights are drawn from the sim state, built once
  // on the first frame that has them (the counts are fixed at state creation).
  let trafficMeshes = null;
  let pedMeshes = null;
  let lightMeshes = null;

  /** Two instanced meshes for the traffic cars: coloured bodies + dark cabins. */
  function buildTrafficMeshes(state) {
    const count = state.traffic.cars.length;
    const bodies = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.9, 0.65, 4.2),
      new THREE.MeshStandardMaterial({ roughness: 0.7, flatShading: true }),
      count,
    );
    const cabins = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.6, 0.5, 2.0),
      new THREE.MeshStandardMaterial({ color: 0x1a2230, roughness: 0.2, metalness: 0.6, flatShading: true }),
      count,
    );
    const col = new THREE.Color();
    state.traffic.cars.forEach((c, i) => bodies.setColorAt(i, col.set(c.color)));
    bodies.instanceColor.needsUpdate = true;
    bodies.castShadow = true;
    cabins.castShadow = true;
    scene.add(bodies);
    scene.add(cabins);
    return { bodies, cabins };
  }

  function updateTrafficMeshes(state) {
    if (!trafficMeshes) trafficMeshes = buildTrafficMeshes(state);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eul = new THREE.Euler();
    state.traffic.cars.forEach((c, i) => {
      eul.set(0, c.heading, 0);
      q.setFromEuler(eul);
      m4.compose(new THREE.Vector3(c.x, 0.5, c.z), q, new THREE.Vector3(1, 1, 1));
      trafficMeshes.bodies.setMatrixAt(i, m4);
      // The cabin sits a little behind the body's centre, in the car's frame.
      m4.compose(
        new THREE.Vector3(c.x - 0.2 * Math.sin(c.heading), 1.05, c.z - 0.2 * Math.cos(c.heading)),
        q, new THREE.Vector3(1, 1, 1),
      );
      trafficMeshes.cabins.setMatrixAt(i, m4);
    });
    trafficMeshes.bodies.instanceMatrix.needsUpdate = true;
    trafficMeshes.cabins.instanceMatrix.needsUpdate = true;
  }

  /** Three instanced meshes for the peds: shirt bodies, heads, and phones. */
  function buildPedMeshes(state) {
    const count = state.peds.list.length;
    const bodies = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.45, 1.05, 0.28),
      new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }),
      count,
    );
    const heads = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.16, 8, 6),
      new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }),
      count,
    );
    const phones = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.06, 0.2, 0.03),
      new THREE.MeshBasicMaterial({ color: 0x11131a }),
      count,
    );
    const col = new THREE.Color();
    state.peds.list.forEach((p, i) => {
      bodies.setColorAt(i, col.set(p.color));
      heads.setColorAt(i, col.set(p.skin));
    });
    bodies.instanceColor.needsUpdate = true;
    heads.instanceColor.needsUpdate = true;
    scene.add(bodies);
    scene.add(heads);
    scene.add(phones);
    return { bodies, heads, phones };
  }

  function updatePedMeshes(state) {
    if (!pedMeshes) pedMeshes = buildPedMeshes(state);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eul = new THREE.Euler();
    const zero = new THREE.Vector3(0, 0, 0);
    state.peds.list.forEach((p, i) => {
      const bobY = p.kind === 'idle' ? 0.01 : Math.abs(Math.sin(p.bob)) * 0.06;
      eul.set(0, p.heading, 0);
      q.setFromEuler(eul);
      m4.compose(new THREE.Vector3(p.x, 0.85 + bobY, p.z), q, new THREE.Vector3(1, 1, 1));
      pedMeshes.bodies.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(p.x, 1.55 + bobY, p.z), q, new THREE.Vector3(1, 1, 1));
      pedMeshes.heads.setMatrixAt(i, m4);
      if (p.call || (p.kind === 'idle' && p.activity === 'phone')) {
        // The phone in front of the face, at chest-to-face height. A ped on a
        // witness call holds it up the same way — that is how the player
        // knows a report is being made.
        m4.compose(
          new THREE.Vector3(p.x + Math.sin(p.heading) * 0.2, 1.35 + bobY, p.z + Math.cos(p.heading) * 0.2),
          q, new THREE.Vector3(1, 1, 1),
        );
      } else {
        m4.compose(zero, q, new THREE.Vector3(0, 0, 0));
      }
      pedMeshes.phones.setMatrixAt(i, m4);
    });
    pedMeshes.bodies.instanceMatrix.needsUpdate = true;
    pedMeshes.heads.instanceMatrix.needsUpdate = true;
    pedMeshes.phones.instanceMatrix.needsUpdate = true;
  }

  /** Traffic lights: two heads per junction, one for each street, lamps coloured per frame. */
  function buildLightMeshes(state) {
    const lights = state.city.lights || [];
    const count = lights.length * 2;
    const poles = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.08, 0.1, 5.5, 6),
      new THREE.MeshStandardMaterial({ color: 0x2e3438, roughness: 0.8 }),
      count,
    );
    const heads = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.5, 1.1, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x1c2230, roughness: 0.8 }),
      count,
    );
    const lamps = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.17, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      count,
    );
    const m4 = new THREE.Matrix4();
    lights.forEach((light, i) => {
      const corners = [
        { x: light.x - 8.5, z: light.z + 8.5 },
        { x: light.x + 8.5, z: light.z - 8.5 },
      ];
      corners.forEach((c, k) => {
        const idx = i * 2 + k;
        m4.identity();
        m4.setPosition(c.x, 2.75, c.z);
        poles.setMatrixAt(idx, m4);
        m4.setPosition(c.x, 5.6, c.z);
        heads.setMatrixAt(idx, m4);
      });
    });
    poles.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    scene.add(poles);
    scene.add(heads);
    scene.add(lamps);
    return { lamps, lights };
  }

  function updateLightMeshes(state) {
    if (!lightMeshes) lightMeshes = buildLightMeshes(state);
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    lightMeshes.lights.forEach((light, i) => {
      const phase = signalPhase(state.time, light.offset);
      const colours = [
        phase.ns === 'green' ? '#37d67a' : phase.ns === 'yellow' ? '#ffd166' : '#ff2e63',
        phase.ew === 'green' ? '#37d67a' : phase.ew === 'yellow' ? '#ffd166' : '#ff2e63',
      ];
      const corners = [
        { x: light.x - 8.5, z: light.z + 8.5 },
        { x: light.x + 8.5, z: light.z - 8.5 },
      ];
      colours.forEach((c, k) => {
        const idx = i * 2 + k;
        // The lamp sits on the head's face toward the junction.
        const lx = corners[k].x + Math.sign(light.x - corners[k].x) * 0.18;
        const lz = corners[k].z + Math.sign(light.z - corners[k].z) * 0.18;
        m4.identity();
        m4.setPosition(lx, 5.6, lz);
        lightMeshes.lamps.setMatrixAt(idx, m4);
        lightMeshes.lamps.setColorAt(idx, col.set(c));
      });
    });
    lightMeshes.lamps.instanceMatrix.needsUpdate = true;
    if (lightMeshes.lamps.instanceColor) lightMeshes.lamps.instanceColor.needsUpdate = true;
  }

  /** Police cars: white bodies, dark cabins, red/blue light bars flashing in
   *  turn on the sim clock. Wrecked units lie where they died, dark. */
  function updatePoliceMeshes(state) {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eul = new THREE.Euler();
    const zero = new THREE.Vector3(0, 0, 0);
    const phase = Math.floor(state.time * 4) % 2 === 0;
    policeRed.material.color.set(phase ? 0xff2233 : 0x4a0d16);
    policeBlue.material.color.set(phase ? 0x12224a : 0x2e6bff);
    for (let i = 0; i < MAX_POLICE; i += 1) {
      const u = state.police.units[i];
      if (!u) {
        m4.compose(zero, q, new THREE.Vector3(0, 0, 0));
        policeBodies.setMatrixAt(i, m4);
        policeCabins.setMatrixAt(i, m4);
        policeRed.setMatrixAt(i, m4);
        policeBlue.setMatrixAt(i, m4);
        continue;
      }
      eul.set(0, u.heading, 0);
      q.setFromEuler(eul);
      m4.compose(new THREE.Vector3(u.x, 0.5, u.z), q, new THREE.Vector3(1, 1, 1));
      policeBodies.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(u.x - 0.2 * Math.sin(u.heading), 1.05, u.z - 0.2 * Math.cos(u.heading)),
        q, new THREE.Vector3(1, 1, 1));
      policeCabins.setMatrixAt(i, m4);
      const barY = u.state === 'wrecked' ? -1 : 1.32;
      m4.compose(new THREE.Vector3(u.x - 0.45 * Math.cos(u.heading), barY, u.z + 0.45 * Math.sin(u.heading)),
        q, new THREE.Vector3(1, 1, 1));
      policeRed.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(u.x + 0.45 * Math.cos(u.heading), barY, u.z - 0.45 * Math.sin(u.heading)),
        q, new THREE.Vector3(1, 1, 1));
      policeBlue.setMatrixAt(i, m4);
    }
    policeBodies.instanceMatrix.needsUpdate = true;
    policeCabins.instanceMatrix.needsUpdate = true;
    policeRed.instanceMatrix.needsUpdate = true;
    policeBlue.instanceMatrix.needsUpdate = true;
  }

  /** AIR-1: hover above the player, rotor spinning, spotlight locked on. */
  function updateHeliMesh(state) {
    const heli = state.heli;
    heliGroup.visible = heli.active;
    if (!heli.active) return;
    heliGroup.position.set(heli.x, heli.y, heli.z);
    heliGroup.rotation.y = heli.heading;
    heliRotor.rotation.y = heli.rotor;
    // The lock is telegraphed: the light pool tightens and brightens.
    const lockPulse = heli.lock > 0 ? 0.22 + Math.min(0.3, heli.lock * 0.1) : 0.22;
    heliPool.material.opacity = lockPulse;
  }

  /** Spike strips where the police left them; the rest hide. */
  function updateSpikeMeshes(state) {
    spikeMeshes.forEach((strip, i) => {
      const s = state.police.spikes[i];
      if (!s) {
        strip.visible = false;
        return;
      }
      strip.visible = true;
      strip.position.set(s.x, 0.08, s.z);
      strip.rotation.y = s.heading;
    });
  }

  /** The search zone ring on the street, pulsing while the hunt is on. */
  function updateSearchZone(state) {
    const zone = state.searchZone;
    zoneRing.visible = !!zone;
    zoneDisc.visible = !!zone;
    if (!zone) return;
    zoneRing.position.set(zone.x, 0.12, zone.z);
    zoneDisc.position.set(zone.x, 0.1, zone.z);
    zoneRing.scale.set(zone.radius, zone.radius, 1);
    zoneDisc.scale.set(zone.radius, zone.radius, 1);
    const pulse = 0.5 + 0.3 * Math.sin(state.time * 3);
    zoneRing.material.opacity = pulse;
    zoneDisc.material.opacity = 0.06 + 0.04 * Math.sin(state.time * 3);
  }

  const sunDir = new THREE.Vector3(SUN.dir.x, SUN.dir.y, SUN.dir.z).normalize();
  const camPos = new THREE.Vector3(city.start.x, 4, city.start.z - 10);
  const camLook = new THREE.Vector3(city.start.x, 1, city.start.z + 8);
  let camFov = 70;

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  /** Chase camera: behind the car, lagging on turns, FOV widening with speed.
   *  `snap` puts it straight on the chase position (deterministic screenshots). */
  function updateChaseCamera(car, dt, snap) {
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    const wantPos = new THREE.Vector3(car.x - fx * 9.5, 3.4, car.z - fz * 9.5);
    const wantLook = new THREE.Vector3(car.x + fx * 10, 1.2, car.z + fz * 10);
    if (snap) {
      camPos.copy(wantPos);
      camLook.copy(wantLook);
    } else {
      const k = Math.min(1, 5 * dt);
      camPos.lerp(wantPos, k);
      camLook.lerp(wantLook, Math.min(1, 7 * dt));
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    const wantFov = 70 + Math.min(1, Math.abs(car.speed) / 38) * 9;
    if (Math.abs(wantFov - camFov) > 0.05) {
      camFov += (wantFov - camFov) * Math.min(1, 3 * dt);
      camera.fov = camFov;
      camera.updateProjectionMatrix();
    }
  }

  return {
    draw(state, screen, snap, dt) {
      const car = state.car;
      heroCar.position.set(car.x, 0, car.z);
      heroCar.rotation.y = car.heading;
      heroCar.rotation.z = -car.steer * 0.05;
      heroCar.rotation.x = car.speed > 1 ? -0.012 : 0;
      // The M3 car swap repaints the hero car: it stops being the pink KOMODO GT.
      heroCar.userData.bodyMat.color.set(state.carColor || PALETTE.hero);
      updateTrafficMeshes(state);
      updatePedMeshes(state);
      updateLightMeshes(state);
      updatePoliceMeshes(state);
      updateHeliMesh(state);
      updateSpikeMeshes(state);
      updateSearchZone(state);
      updateChaseCamera(car, dt, snap);
      // The shadow camera follows the player: one shadow map, re-centred.
      sun.position.set(car.x + sunDir.x * 200, sunDir.y * 200, car.z + sunDir.z * 200);
      sun.target.position.set(car.x, 0, car.z);
      sun.target.updateMatrixWorld();
      // Dust drifts slowly around the player.
      dust.position.set(car.x, 0, car.z);
      dust.rotation.y = state.time * 0.01;
      renderer.render(scene, camera);
    },
    /** How many draw calls the last frame took, for the performance budget. */
    drawCalls() {
      return renderer.info.render.calls;
    },
    camera,
    scene,
  };
}
