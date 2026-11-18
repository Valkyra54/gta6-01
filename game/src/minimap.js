// The minimap: a 2D canvas in the HUD's round frame, drawn from the road
// graph. North-up, the player arrow rotates, and exactly four blip types live
// inside the circle: white player triangle, yellow mission diamond, red/blue
// police dots, and the thin white GPS route line. Nothing else.

const RANGE = 260; // metres shown across the minimap's diameter

/** Draw the minimap for a state: roads, water, the player, the mission marker. */
export function drawMinimap(canvas, state) {
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const centre = size / 2;
  const scale = size / RANGE;
  const toMap = (x, z) => [centre + (x - state.car.x) * scale, centre + (z - state.car.z) * scale];
  ctx.clearRect(0, 0, size, size);

  // The round frame clips everything to the circle.
  ctx.save();
  ctx.beginPath();
  ctx.arc(centre, centre, centre - 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#0a1220';
  ctx.fillRect(0, 0, size, size);

  // Water: the sea to the west, the harbour basin to the east.
  ctx.fillStyle = '#0e4d5c';
  const [seaX0, seaZ0] = toMap(state.city.sea.x0, state.city.sea.z0);
  const [seaX1, seaZ1] = toMap(state.city.sea.x1, state.city.sea.z1);
  ctx.fillRect(seaX0, seaZ0, seaX1 - seaX0, seaZ1 - seaZ0);
  const [hbX0, hbZ0] = toMap(state.city.harbour.x0, state.city.harbour.z0);
  const [hbX1, hbZ1] = toMap(state.city.harbour.x1, state.city.harbour.z1);
  ctx.fillRect(hbX0, hbZ0, hbX1 - hbX0, hbZ1 - hbZ0);
  // Sand strip along the beach.
  ctx.fillStyle = '#e8c98f';
  const [saX0, saZ0] = toMap(state.city.sand.x0, state.city.sand.z0);
  const [saX1, saZ1] = toMap(state.city.sand.x1, state.city.sand.z1);
  ctx.fillRect(saX0, saZ0, saX1 - saX0, saZ1 - saZ0);

  // Roads: every segment of the graph, in warm grey.
  ctx.strokeStyle = '#5a5a66';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  for (const s of state.city.segments) {
    const [ax, az] = toMap(s.ax, s.az);
    const [bx, bz] = toMap(s.bx, s.bz);
    ctx.beginPath();
    ctx.moveTo(ax, az);
    ctx.lineTo(bx, bz);
    ctx.stroke();
  }
  // The causeway and the island.
  ctx.strokeStyle = '#5a5a66';
  ctx.beginPath();
  const [cx0, cz0] = toMap(165, 132);
  const [cx1, cz1] = toMap(state.city.island.x, state.city.island.z);
  ctx.moveTo(cx0, cz0);
  ctx.lineTo(cx1, cz1);
  ctx.stroke();
  ctx.fillStyle = '#e8c98f';
  ctx.beginPath();
  ctx.arc(cx1, cz1, state.city.island.radius * scale, 0, Math.PI * 2);
  ctx.fill();

  // The GPS route: a thin white line from the player to the mission marker.
  if (state.mission.marker) {
    const [mx, mz] = toMap(state.mission.marker.x, state.mission.marker.z);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(centre, centre);
    ctx.lineTo(mx, mz);
    ctx.stroke();
    ctx.setLineDash([]);
    // The mission diamond, yellow, with a white edge.
    ctx.save();
    ctx.translate(mx, mz);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#ffd166';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.fillRect(-7, -7, 14, 14);
    ctx.strokeRect(-7, -7, 14, 14);
    ctx.restore();
  }

  // Police: red/blue dots, one per unit, with a short tick for the direction
  // it faces (its field of view). The helicopter is a bigger red dot.
  for (const u of state.police.units) {
    if (u.state === 'wrecked') continue;
    const [ux, uz] = toMap(u.x, u.z);
    ctx.fillStyle = '#2e6bff';
    ctx.strokeStyle = '#ff2e63';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ux, uz, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ux, uz);
    ctx.lineTo(ux + Math.sin(u.heading) * 10, uz + Math.cos(u.heading) * 10);
    ctx.stroke();
  }
  if (state.heli.active) {
    const [hx, hz] = toMap(state.heli.x, state.heli.z);
    ctx.fillStyle = '#ff2e63';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hx, hz, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // The player: a white triangle, rotated to the heading. Heading 0 is south
  // (+z), which is DOWN on a north-up map, so the triangle turns by heading + PI.
  ctx.save();
  ctx.translate(centre, centre);
  ctx.rotate(state.car.heading + Math.PI);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -11);
  ctx.lineTo(8, 9);
  ctx.lineTo(-8, 9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // The pale red search zone, when the police are hunting.
  if (state.searchZone) {
    const [sx, sz] = toMap(state.searchZone.x, state.searchZone.z);
    ctx.fillStyle = 'rgba(255,46,99,0.18)';
    ctx.strokeStyle = 'rgba(255,46,99,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sz, state.searchZone.radius * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  // "N": north is up, always.
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', centre, 26);
}
