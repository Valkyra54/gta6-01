// Drawing only: the simulation's state in, pixels out. Three.js renders the golden-hour city;
// the HUD is DOM (hud.js) and the minimap is a 2D canvas (minimap.js). The renderer never
// touches simulation state — it only reads it — so a screenshot scene is reproducible from a seed.
import * as THREE from 'three';
import { CAMERA, LIGHT, PALETTE, PEDS, TRAFFIC } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const SUN_DIR = (() => {
  const elev = (LIGHT.sunElevation * Math.PI) / 180;
  const horiz = Math.cos(elev) / Math.SQRT2;
  // Sun low in the south-west: light comes from -x (west) and +z (south).
  return new THREE.Vector3(-horiz, Math.sin(elev), horiz).normalize();
})();

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255, 243, 196, 1)');
  grad.addColorStop(0.25, 'rgba(255, 207, 138, 0.55)');
  grad.addColorStop(1, 'rgba(255, 207, 138, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}

/**
 * The heli spotlight's pool on the ground: a warm radial gradient, bright core fading to
 * nothing at the rim. The flat pale disc it replaced read as a grey concrete pad on the
 * dark asphalt (a 0.35-opacity solid over 0x4a4a52 blends to mid-grey) — light needs a
 * gradient, not a hard edge.
 */
function spotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255, 238, 175, 0.95)');
  grad.addColorStop(0.45, 'rgba(255, 216, 130, 0.55)');
  grad.addColorStop(1, 'rgba(255, 216, 130, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}

function skyDome() {
  const geo = new THREE.SphereGeometry(850, 24, 12);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color(PALETTE.skyTop);
  const mid = new THREE.Color(PALETTE.skyMid);
  const horizon = new THREE.Color(PALETTE.skyHorizon);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    const y = pos.getY(i) / 850;
    if (y < 0.08) c.copy(horizon);
    else if (y < 0.5) c.copy(horizon).lerp(mid, (y - 0.08) / 0.42);
    else c.copy(mid).lerp(top, (y - 0.5) / 0.5);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
  mesh.frustumCulled = false;
  return mesh;
}

/** Fill one InstancedMesh from a list of {x, y, z, ry, sx, sy, sz, color}. */
function fillInstances(mesh, items, dummy) {
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    dummy.position.set(it.x, it.y || 0, it.z);
    dummy.rotation.set(0, it.ry || 0, 0);
    dummy.scale.set(it.sx || 1, it.sy || 1, it.sz || 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (it.color !== undefined) mesh.setColorAt(i, new THREE.Color(it.color));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

export function createRenderer(canvas, city) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = LIGHT.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(LIGHT.fogColor, LIGHT.fogDensity);

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, 0.1, 1200);

  const sun = new THREE.DirectionalLight(LIGHT.sunColor, LIGHT.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -55;
  sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55;
  sun.shadow.camera.bottom = -55;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 260;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  scene.add(sun.target);
  scene.add(new THREE.HemisphereLight(LIGHT.hemiSky, LIGHT.hemiGround, LIGHT.hemiIntensity));

  const sky = skyDome();
  scene.add(sky);
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(30, 24), // bigger disc: at 16 it washed out against the peach sky
    new THREE.MeshBasicMaterial({ color: 0xffb03d, fog: false }), // deep orange-gold: pale gold washed out against the peach sky
  );
  scene.add(sunDisc);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffcf8a, fog: false, transparent: true, opacity: 0.45, depthWrite: false }));
  sunGlow.scale.set(110, 110, 1); // small halo: at 260 its bright core swallowed the sun disc
  scene.add(sunGlow);

  const dummy = new THREE.Object3D();
  const std = (color, opts) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0, ...(opts || {}) });

  // Land, sand and sea.
  const land = new THREE.Mesh(new THREE.PlaneGeometry(390, 380).rotateX(-Math.PI / 2), std(PALETTE.ground));
  land.position.set(15, -0.05, -35);
  land.receiveShadow = true;
  scene.add(land);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(345, 24).rotateX(-Math.PI / 2), std(PALETTE.sand));
  sand.position.set(-7.5, 0.02, 152); // the beach starts south of the beachfront's south sidewalk (z 140); at 141 it buried the road's south half and the car read as off-road
  sand.receiveShadow = true;
  scene.add(sand);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(760, 760).rotateX(-Math.PI / 2), std(PALETTE.sea, { roughness: 0.32, metalness: 0.25 }));
  sea.position.set(0, -0.6, 0);
  scene.add(sea);
  const island = new THREE.Mesh(new THREE.CircleGeometry(26, 24).rotateX(-Math.PI / 2), std(0xc9b083));
  island.position.set(-150, 0.05, -195);
  island.receiveShadow = true;
  scene.add(island);
  // Gold specular streaks on the harbour water.
  const streaks = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(14, 0.9).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.45 }),
    6,
  );
  fillInstances(streaks, [
    { x: 175, y: -0.5, z: 20, ry: 0.5 }, { x: 182, y: -0.5, z: 45, ry: 0.5 },
    { x: 170, y: -0.5, z: 70, ry: 0.5 }, { x: 190, y: -0.5, z: 95, ry: 0.5 },
    { x: 178, y: -0.5, z: 120, ry: 0.5 }, { x: 165, y: -0.5, z: 140, ry: 0.5 },
  ], dummy);
  scene.add(streaks);

  // Roads, sidewalks and centre dashes, one InstancedMesh each.
  const roadGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const roadItems = [];
  const walkItems = [];
  const dashItems = [];
  for (const s of city.segments) {
    const mx = (s.a.x + s.b.x) / 2;
    const mz = (s.a.z + s.b.z) / 2;
    roadItems.push({ x: mx, y: 0, z: mz, ry: s.angle, sx: 14, sz: s.length });
    const px = Math.cos(s.angle);
    const pz = -Math.sin(s.angle);
    walkItems.push({ x: mx + px * 8.5, y: 0.01, z: mz + pz * 8.5, ry: s.angle, sx: 3, sz: s.length });
    walkItems.push({ x: mx - px * 8.5, y: 0.01, z: mz - pz * 8.5, ry: s.angle, sx: 3, sz: s.length });
    const steps = Math.floor(s.length / 6);
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      const distToEnd = Math.min(t, 1 - t) * s.length;
      if (distToEnd < 9) continue;
      dashItems.push({ x: s.a.x + (s.b.x - s.a.x) * t, y: 0.02, z: s.a.z + (s.b.z - s.a.z) * t, ry: s.angle, sx: 0.3, sz: 3 });
    }
  }
  const roads = new THREE.InstancedMesh(roadGeo, std(PALETTE.road, { roughness: 1 }), roadItems.length);
  fillInstances(roads, roadItems, dummy);
  roads.receiveShadow = true;
  scene.add(roads);
  const walks = new THREE.InstancedMesh(roadGeo, std(PALETTE.sidewalk), walkItems.length);
  fillInstances(walks, walkItems, dummy);
  walks.receiveShadow = true;
  scene.add(walks);
  const dashes = new THREE.InstancedMesh(roadGeo, new THREE.MeshBasicMaterial({ color: PALETTE.dash }), dashItems.length);
  fillInstances(dashes, dashItems, dummy);
  scene.add(dashes);

  // Buildings: one instanced box per building, windows as instanced planes on all four faces.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  const buildingsMesh = new THREE.InstancedMesh(boxGeo, std(0xffffff), city.buildings.length);
  fillInstances(buildingsMesh, city.buildings.map((b) => ({
    x: b.x, y: 0, z: b.z, sx: b.hw * 2, sy: b.h, sz: b.hd * 2, color: b.color,
  })), dummy);
  buildingsMesh.castShadow = true;
  buildingsMesh.receiveShadow = true;
  scene.add(buildingsMesh);

  const windowItems = [];
  for (const b of city.buildings) {
    const rows = Math.max(1, Math.floor(b.h / 3.4));
    const faces = [
      { along: b.hw * 2, fixed: b.hd, axis: 'x', sign: 1 },
      { along: b.hw * 2, fixed: b.hd, axis: 'x', sign: -1 },
      { along: b.hd * 2, fixed: b.hw, axis: 'z', sign: 1 },
      { along: b.hd * 2, fixed: b.hw, axis: 'z', sign: -1 },
    ];
    for (const f of faces) {
      const cols = Math.max(1, Math.floor(f.along / 3.5));
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const alongPos = -f.along / 2 + (c + 0.5) * (f.along / cols);
          const lit = ((r * 7 + c * 3 + Math.floor(b.x) + Math.floor(b.z)) % 9) < 4;
          const item = {
            y: 2.4 + r * 3.4,
            color: lit ? PALETTE.windowLit : PALETTE.windowDark,
          };
          if (f.axis === 'x') {
            item.x = b.x + alongPos;
            item.z = b.z + f.sign * (f.fixed + 0.06);
            item.ry = f.sign > 0 ? 0 : Math.PI;
          } else {
            item.x = b.x + f.sign * (f.fixed + 0.06);
            item.z = b.z + alongPos;
            item.ry = f.sign > 0 ? Math.PI / 2 : -Math.PI / 2;
          }
          windowItems.push(item);
        }
      }
    }
  }
  const windows = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1.1, 1.5),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    windowItems.length,
  );
  fillInstances(windows, windowItems, dummy);
  scene.add(windows);

  // Palms: instanced trunks, instanced frond spikes (7 per palm, tipped outward).
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.28, 5.5, 6);
  trunkGeo.translate(0, 2.75, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, std(PALETTE.trunk), city.palms.length);
  fillInstances(trunks, city.palms.map((p) => ({ x: p.x, y: 0, z: p.z, sx: p.s, sy: p.s, sz: p.s })), dummy);
  trunks.castShadow = true;
  scene.add(trunks);
  const frondGeo = new THREE.CylinderGeometry(0.02, 0.32, 3.6, 4);
  frondGeo.translate(0, 1.8, 0);
  const frondItems = [];
  for (const p of city.palms) {
    for (let f = 0; f < 7; f += 1) {
      frondItems.push({ x: p.x, y: 5.1 * p.s, z: p.z, ry: (f / 7) * Math.PI * 2, tilt: 1.05, s: p.s });
    }
  }
  const fronds = new THREE.InstancedMesh(frondGeo, std(PALETTE.palm), frondItems.length);
  for (let i = 0; i < frondItems.length; i += 1) {
    const it = frondItems[i];
    dummy.position.set(it.x, it.y, it.z);
    dummy.rotation.set(0, it.ry, it.tilt);
    dummy.scale.set(it.s, it.s, it.s);
    dummy.updateMatrix();
    fronds.setMatrixAt(i, dummy.matrix);
  }
  fronds.instanceMatrix.needsUpdate = true;
  fronds.castShadow = true;
  scene.add(fronds);

  // Lamps: instanced poles, instanced warm heads.
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 5, 6);
  poleGeo.translate(0, 2.5, 0);
  const poles = new THREE.InstancedMesh(poleGeo, std(0x3a3f46), city.lamps.length);
  fillInstances(poles, city.lamps.map((l) => ({ x: l.x, y: 0, z: l.z })), dummy);
  scene.add(poles);
  const heads = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.26, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffe0a0 }),
    city.lamps.length,
  );
  fillInstances(heads, city.lamps.map((l) => ({ x: l.x, y: 5.1, z: l.z })), dummy);
  scene.add(heads);

  // Parked cars: instanced bodies and cabins.
  const parkedBodyGeo = new THREE.BoxGeometry(1, 1, 1);
  parkedBodyGeo.translate(0, 0.55, 0);
  const parkedBody = new THREE.InstancedMesh(parkedBodyGeo, std(0xffffff, { metalness: 0.3, roughness: 0.4 }), city.parked.length);
  fillInstances(parkedBody, city.parked.map((p) => ({
    x: p.x, y: 0, z: p.z, ry: p.heading, sx: 1.9, sy: 0.7, sz: 4.3, color: p.color,
  })), dummy);
  parkedBody.castShadow = true;
  scene.add(parkedBody);
  const parkedCabinGeo = new THREE.BoxGeometry(1, 1, 1);
  parkedCabinGeo.translate(0, 1.05, 0);
  const parkedCabin = new THREE.InstancedMesh(parkedCabinGeo, std(0x1c2733, { metalness: 0.2, roughness: 0.25 }), city.parked.length);
  fillInstances(parkedCabin, city.parked.map((p) => ({
    x: p.x, y: 0, z: p.z, ry: p.heading, sx: 1.65, sy: 0.55, sz: 2.1,
  })), dummy);
  scene.add(parkedCabin);

  // Harbour containers.
  const containers = new THREE.InstancedMesh(new THREE.BoxGeometry(6, 2.6, 2.4), std(0xffffff), city.containers.length);
  fillInstances(containers, city.containers.map((c) => ({ x: c.x, y: c.y, z: c.z, color: c.color })), dummy);
  containers.castShadow = true;
  scene.add(containers);

  // Pier deck and posts, lighthouse on the island.
  const pierDeck = new THREE.Mesh(new THREE.BoxGeometry(58, 0.5, 8), std(0x8a6f4d));
  pierDeck.position.set(177, 0.4, 60);
  pierDeck.receiveShadow = true;
  scene.add(pierDeck);
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.35, 2.4, 6), std(0x5a4632), 8);
  fillInstances(posts, [158, 168, 178, 188, 198, 204].flatMap((x) => [{ x, y: -0.6, z: 57 }, { x, y: -0.6, z: 63 }]).slice(0, 8), dummy);
  scene.add(posts);
  const lighthouse = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.6, 20, 10), std(0xf2ede2));
  tower.position.y = 10;
  tower.castShadow = true;
  lighthouse.add(tower);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.25, 3, 10), std(0xc23b2e));
  band.position.y = 12;
  lighthouse.add(band);
  const lampRoom = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 3, 8), std(0x2a3442));
  lampRoom.position.y = 21.5;
  lighthouse.add(lampRoom);
  const lampGlobe = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }));
  lampGlobe.position.y = 21.5;
  lighthouse.add(lampGlobe);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.9, 2.2, 8), std(0xc23b2e));
  roof.position.y = 24;
  lighthouse.add(roof);
  lighthouse.position.set(-150, 0, -195);
  scene.add(lighthouse);

  // The hero car: pink KOMODO GT, built from boxes — the most saturated thing in frame.
  const hero = new THREE.Group();
  const bodyMat = std(PALETTE.heroCar, { metalness: 0.35, roughness: 0.35 });
  const glassMat = std(0x1c2733, { metalness: 0.2, roughness: 0.2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62, 4.4), bodyMat);
  body.position.y = 0.62;
  body.castShadow = true;
  hero.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.0), glassMat);
  cabin.position.set(0, 1.15, -0.25);
  cabin.castShadow = true;
  hero.add(cabin);
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.4), bodyMat);
  spoiler.position.set(0, 1.05, -2.05);
  hero.add(spoiler);
  const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
  for (const side of [-0.65, 0.65]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.1), headlightMat);
    lamp.position.set(side, 0.72, 2.21);
    hero.add(lamp);
  }
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2e2e });
  for (const side of [-0.65, 0.65]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.1), tailMat);
    lamp.position.set(side, 0.72, -2.21);
    hero.add(lamp);
  }
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = std(0x14161a, { roughness: 0.9 });
  const wheels = [];
  for (const [wx, wz, front] of [[-0.85, 1.45, true], [0.85, 1.45, true], [-0.85, -1.45, false], [0.85, -1.45, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, 0.36, wz);
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.castShadow = true;
    pivot.add(wheel);
    hero.add(pivot);
    wheels.push({ pivot, wheel, front });
  }
  scene.add(hero);

  // Traffic cars (20) and pedestrians (36 walkers + 10 idlers): instanced bodies, cabins
  // and heads, updated from simulation state every frame in draw().
  const trafficBodyGeo = new THREE.BoxGeometry(1, 1, 1);
  trafficBodyGeo.translate(0, 0.55, 0);
  const trafficBody = new THREE.InstancedMesh(trafficBodyGeo, std(0xffffff, { metalness: 0.3, roughness: 0.4 }), TRAFFIC.count);
  trafficBody.castShadow = true;
  scene.add(trafficBody);
  const trafficCabinGeo = new THREE.BoxGeometry(1, 1, 1);
  trafficCabinGeo.translate(0, 1.05, 0);
  const trafficCabin = new THREE.InstancedMesh(trafficCabinGeo, std(0x1c2733, { metalness: 0.2, roughness: 0.25 }), TRAFFIC.count);
  scene.add(trafficCabin);
  const pedBodyGeo = new THREE.BoxGeometry(0.55, 1.15, 0.4);
  pedBodyGeo.translate(0, 0.575, 0);
  const pedBody = new THREE.InstancedMesh(pedBodyGeo, std(0xffffff), PEDS.walkers + PEDS.idlers);
  pedBody.castShadow = true;
  scene.add(pedBody);
  const pedHead = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 8, 6), std(0xffffff), PEDS.walkers + PEDS.idlers);
  scene.add(pedHead);

  // DEPD pursuit cars (4): white bodies, dark cabins, red/blue light bars that flash.
  const policeBodyGeo = new THREE.BoxGeometry(1, 1, 1);
  policeBodyGeo.translate(0, 0.55, 0);
  const policeBody = new THREE.InstancedMesh(policeBodyGeo, std(PALETTE.policeWhite, { metalness: 0.3, roughness: 0.4 }), 4);
  policeBody.castShadow = true;
  scene.add(policeBody);
  const policeCabinGeo = new THREE.BoxGeometry(1, 1, 1);
  policeCabinGeo.translate(0, 1.05, 0);
  const policeCabin = new THREE.InstancedMesh(policeCabinGeo, std(0x1c2733, { metalness: 0.2, roughness: 0.25 }), 4);
  scene.add(policeCabin);
  const policeBar = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.2, 0.14, 0.4),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    4,
  );
  scene.add(policeBar);

  // AIR-1: a dark helicopter with a spinning rotor and a spotlight cone down to the player.
  const heliGroup = new THREE.Group();
  const heliBody = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 4.2), std(0x2a3442, { metalness: 0.4, roughness: 0.5 }));
  heliBody.castShadow = true;
  heliGroup.add(heliBody);
  const heliTail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 3.4), std(0x2a3442));
  heliTail.position.set(0, 0.2, -3.6);
  heliGroup.add(heliTail);
  const heliRotor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 0.5), std(0x14161a));
  heliRotor.position.y = 0.8;
  heliGroup.add(heliRotor);
  const heliSkid = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 3.0), std(0x14161a));
  heliSkid.position.y = -0.75;
  heliGroup.add(heliSkid);
  heliGroup.visible = false;
  scene.add(heliGroup);
  const beamGeo = new THREE.ConeGeometry(6, 42, 12, 1, true);
  const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
    color: 0xfff3c4, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
  }));
  beam.visible = false;
  scene.add(beam);
  const spotDisc = new THREE.Mesh(
    new THREE.CircleGeometry(3.5, 24).rotateX(-Math.PI / 2), // warm pool of light under the car
    new THREE.MeshBasicMaterial({ map: spotTexture(), transparent: true, opacity: 0.9, depthWrite: false }),
  );
  spotDisc.visible = false;
  scene.add(spotDisc);

  // The search zone, drawn in the world as a pulsing red ring around the last known spot.
  const zoneRing = new THREE.Mesh(
    new THREE.RingGeometry(0.96, 1.0, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xff2e2e, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }),
  );
  zoneRing.visible = false;
  scene.add(zoneRing);

  // A live spike strip on the road.
  const spikeMesh = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.14, 0.7),
    new THREE.MeshBasicMaterial({ color: 0x1a1a1a }),
  );
  spikeMesh.visible = false;
  scene.add(spikeMesh);

  // The witness phone call, made visible: a floating "!" over a reporting ped.
  const bangCanvas = document.createElement('canvas');
  bangCanvas.width = 64;
  bangCanvas.height = 64;
  const bangCtx = bangCanvas.getContext('2d');
  bangCtx.font = '900 56px system-ui, sans-serif';
  bangCtx.textAlign = 'center';
  bangCtx.textBaseline = 'middle';
  bangCtx.lineWidth = 8;
  bangCtx.strokeStyle = '#ffffff';
  bangCtx.strokeText('!', 32, 34);
  bangCtx.fillStyle = '#ff2e2e';
  bangCtx.fillText('!', 32, 34);
  const bang = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(bangCanvas), transparent: true, depthWrite: false }));
  bang.scale.set(1.6, 1.6, 1);
  bang.visible = false;
  scene.add(bang);

  // Dust motes drifting in the light, one draw call.
  const DUST_COUNT = 220;  const dustBase = new Float32Array(DUST_COUNT * 3);
  const dustPhase = new Float32Array(DUST_COUNT);
  {
    let s = 1234567;
    const rnd = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < DUST_COUNT; i += 1) {
      dustBase[i * 3] = (rnd() - 0.5) * 70;
      dustBase[i * 3 + 1] = rnd() * 9 + 0.5;
      dustBase[i * 3 + 2] = (rnd() - 0.5) * 70;
      dustPhase[i] = rnd() * Math.PI * 2;
    }
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST_COUNT * 3), 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xffe0b0, size: 0.18, transparent: true, opacity: 0.55 }));
  dust.frustumCulled = false;
  scene.add(dust);

  const camPos = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  let fixedCamera = null;
  let smoothed = false;
  let trafficColored = false; // instance colours are set once, from the first state drawn

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onResize);

  return {
    setFixedCamera(pos, lookAt) {
      fixedCamera = { pos: new THREE.Vector3(pos.x, pos.y, pos.z), lookAt: new THREE.Vector3(lookAt.x, lookAt.y, lookAt.z) };
      smoothed = false;
    },
    clearFixedCamera() {
      fixedCamera = null;
      smoothed = false;
    },
    draw(state, screen, dt) {
      const wantedFov = state.fov || CAMERA.fov;
      if (camera.fov !== wantedFov) {
        camera.fov = wantedFov;
        camera.updateProjectionMatrix();
      }
      const car = state.car;
      const fwdX = Math.sin(car.heading);
      const fwdZ = Math.cos(car.heading);
      hero.position.set(car.x, 0, car.z);
      hero.rotation.y = car.heading;
      // The M3 swap changes the car identity: the hero car turns into a blue sedan.
      bodyMat.color.set(state.carIdentity === 'SEDAN BIRU' ? 0x3a5a7a : PALETTE.heroCar);
      for (const w of wheels) {
        if (w.front) w.pivot.rotation.y = car.steer * 0.9;
        w.wheel.rotation.x += (Math.hypot(car.vx, car.vz) * dt) / 0.36;
      }

      // Traffic cars and pedestrians, from simulation state.
      if (state.traffic) {
        if (!trafficColored) {
          for (let i = 0; i < state.traffic.cars.length; i += 1) {
            trafficBody.setColorAt(i, new THREE.Color(state.traffic.cars[i].color));
          }
          const allPeds = state.peds ? state.peds.walkers.concat(state.peds.idlers) : [];
          for (let i = 0; i < allPeds.length; i += 1) {
            pedBody.setColorAt(i, new THREE.Color(allPeds[i].color));
            pedHead.setColorAt(i, new THREE.Color(allPeds[i].skin));
          }
          if (trafficBody.instanceColor) trafficBody.instanceColor.needsUpdate = true;
          if (pedBody.instanceColor) pedBody.instanceColor.needsUpdate = true;
          if (pedHead.instanceColor) pedHead.instanceColor.needsUpdate = true;
          trafficColored = true;
        }
        for (let i = 0; i < state.traffic.cars.length; i += 1) {
          const c = state.traffic.cars[i];
          dummy.position.set(c.x, 0, c.z);
          dummy.rotation.set(0, c.heading, 0);
          dummy.scale.set(1.9, 0.7, 4.3);
          dummy.updateMatrix();
          trafficBody.setMatrixAt(i, dummy.matrix);
          dummy.scale.set(1.65, 0.55, 2.1);
          dummy.updateMatrix();
          trafficCabin.setMatrixAt(i, dummy.matrix);
        }
        trafficBody.instanceMatrix.needsUpdate = true;
        trafficCabin.instanceMatrix.needsUpdate = true;
      }
      if (state.peds) {
        const allPeds = state.peds.walkers.concat(state.peds.idlers);
        for (let i = 0; i < allPeds.length; i += 1) {
          const p = allPeds[i];
          dummy.position.set(p.x, 0, p.z);
          dummy.rotation.set(0, p.heading, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          pedBody.setMatrixAt(i, dummy.matrix);
          dummy.position.set(p.x, 1.32, p.z);
          dummy.updateMatrix();
          pedHead.setMatrixAt(i, dummy.matrix);
          // A reporting witness flashes yellow — the phone call is visible.
          pedBody.setColorAt(i, new THREE.Color(p.state === 'report' ? 0xffe14d : p.color));
        }
        pedBody.instanceMatrix.needsUpdate = true;
        pedHead.instanceMatrix.needsUpdate = true;
        if (pedBody.instanceColor) pedBody.instanceColor.needsUpdate = true;
        // The floating "!" sits over the nearest reporting witness.
        let reporting = null;
        for (const p of allPeds) {
          if (p.state === 'report') { reporting = p; break; }
        }
        if (reporting) {
          bang.position.set(reporting.x, 2.4, reporting.z);
          bang.visible = true;
        } else {
          bang.visible = false;
        }
      }

      // DEPD pursuit cars, with flashing red/blue light bars.
      if (state.police) {
        const units = state.police.units;
        for (let i = 0; i < 4; i += 1) {
          const u = units[i];
          if (!u || u.wrecked) {
            dummy.position.set(0, -50, 0);
            dummy.scale.set(0.001, 0.001, 0.001);
          } else {
            dummy.position.set(u.x, 0, u.z);
            dummy.rotation.set(0, u.heading, 0);
            dummy.scale.set(1.9, 0.7, 4.3);
          }
          dummy.updateMatrix();
          policeBody.setMatrixAt(i, dummy.matrix);
          dummy.scale.set(1.65, 0.55, 2.1);
          dummy.updateMatrix();
          policeCabin.setMatrixAt(i, dummy.matrix);
          if (!u || u.wrecked) {
            dummy.position.set(0, -50, 0);
            dummy.scale.set(0.001, 0.001, 0.001);
          } else {
            dummy.position.set(u.x, 1.32, u.z);
            dummy.rotation.set(0, u.heading, 0);
            dummy.scale.set(1, 1, 1);
          }
          dummy.updateMatrix();
          policeBar.setMatrixAt(i, dummy.matrix);
          const barRed = (i + Math.floor(state.time * 2)) % 2 === 0;
          policeBar.setColorAt(i, new THREE.Color(barRed ? 0xff2e2e : 0x2e7dff));
        }
        policeBody.instanceMatrix.needsUpdate = true;
        policeCabin.instanceMatrix.needsUpdate = true;
        policeBar.instanceMatrix.needsUpdate = true;
        if (policeBar.instanceColor) policeBar.instanceColor.needsUpdate = true;
        // The spike strip, live on the road.
        if (state.police.spike) {
          spikeMesh.position.set(state.police.spike.x, 0.08, state.police.spike.z);
          spikeMesh.visible = true;
        } else {
          spikeMesh.visible = false;
        }
      }

      // AIR-1 overhead: the helicopter, its spotlight cone, and the lit disc on the ground.
      if (state.heli && state.heli.active) {
        heliGroup.position.set(state.heli.x, state.heli.y, state.heli.z);
        heliGroup.rotation.y = Math.atan2(car.x - state.heli.x, car.z - state.heli.z);
        heliRotor.rotation.y = state.time * 20;
        heliGroup.visible = true;
        beam.position.set(car.x, state.heli.y / 2, car.z);
        beam.visible = true;
        spotDisc.position.set(car.x, 0.06, car.z);
        spotDisc.visible = true;
      } else {
        heliGroup.visible = false;
        beam.visible = false;
        spotDisc.visible = false;
      }

      // The search zone ring, pulsing red around the last known position.
      if (state.searchZone) {
        zoneRing.position.set(state.searchZone.x, 0.06, state.searchZone.z);
        zoneRing.scale.set(state.searchZone.r, state.searchZone.r, 1);
        zoneRing.material.opacity = 0.3 + 0.18 * Math.sin(state.time * 3);
        zoneRing.visible = true;
      } else {
        zoneRing.visible = false;
      }

      // The sun, its shadow camera, the sky and the dust all follow the player.
      const px = car.x;
      const pz = car.z;
      sun.position.set(px + SUN_DIR.x * 120, SUN_DIR.y * 120, pz + SUN_DIR.z * 120);
      sun.target.position.set(px, 0, pz);
      sun.target.updateMatrixWorld();
      sky.position.set(px, 0, pz);
      sunDisc.position.set(px + SUN_DIR.x * 780, SUN_DIR.y * 780, pz + SUN_DIR.z * 780);
      sunDisc.lookAt(px, 0, pz);
      sunGlow.position.set(px + SUN_DIR.x * 760, SUN_DIR.y * 760, pz + SUN_DIR.z * 760);
      const dustPos = dustGeo.attributes.position.array;
      for (let i = 0; i < DUST_COUNT; i += 1) {
        dustPos[i * 3] = px + dustBase[i * 3] + Math.sin(state.time * 0.2 + dustPhase[i]) * 2;
        dustPos[i * 3 + 1] = dustBase[i * 3 + 1];
        dustPos[i * 3 + 2] = pz + dustBase[i * 3 + 2] + Math.cos(state.time * 0.17 + dustPhase[i]) * 2;
      }
      dustGeo.attributes.position.needsUpdate = true;

      if (fixedCamera) {
        camera.position.copy(fixedCamera.pos);
        camera.lookAt(fixedCamera.lookAt);
      } else {
        const yaw = state.cameraYaw || 0;
        const cosY = Math.cos(yaw);
        const sinY = Math.sin(yaw);
        // Chase camera: behind the car, yawed a little by mouse drag.
        const bx = -fwdX * cosY - fwdZ * sinY;
        const bz = -fwdZ * cosY + fwdX * sinY;
        // Chase camera: behind the car, yawed a little by mouse drag. A staged shot may
        // pull in closer (state.camDistance) — the hero car read small at 11 m.
        const camDist = state.camDistance || CAMERA.distance;
        camTarget.set(car.x + fwdX * CAMERA.lookAhead, 1.2 + (state.cameraPitch || 0), car.z + fwdZ * CAMERA.lookAhead);
        camPos.set(car.x + bx * camDist, CAMERA.height, car.z + bz * camDist);
        if (!smoothed) {
          camera.position.copy(camPos);
          smoothed = true;
        } else {
          const k = 1 - Math.exp(-5 * dt);
          camera.position.lerp(camPos, k);
        }
        camera.lookAt(camTarget);
      }

      renderer.render(scene, camera);
    },
  };
}
