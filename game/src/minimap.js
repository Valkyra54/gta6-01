// The round minimap, bottom-left: NORTH-UP with a rotating player arrow, an "N" indicator,
// the mission diamond, a thin GPS route line to the objective, and the pale red search zone
// (Day 3). Exactly four blip types, per the top-10 cover grammar: white triangle (player),
// yellow diamond (mission), red/blue dot (police — Day 3), thin white route line.
import { CITY, MISSIONS } from './config.js';

const WORLD = { minX: -195, maxX: 215, minZ: -230, maxZ: 155 };

export function createMinimap(canvas) {
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const scale = size / (WORLD.maxX - WORLD.minX);

  function toX(x) {
    return (x - WORLD.minX) * scale;
  }
  function toY(z) {
    return (z - WORLD.minZ) * scale;
  }

  return {
    draw(state) {
      const city = state.city;
      const car = state.car;
      ctx.clearRect(0, 0, size, size);
      // Sea, then land.
      ctx.fillStyle = '#0e4d5c';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#3a3f46';
      ctx.fillRect(toX(-180), toY(-222), (210 - -180) * scale, (152 - -222) * scale);
      ctx.fillStyle = '#c9b083';
      ctx.beginPath();
      ctx.arc(toX(CITY.island.x), toY(CITY.island.z), CITY.island.radius * scale, 0, Math.PI * 2);
      ctx.fill();
      // Roads.
      ctx.strokeStyle = '#c8c8d0';
      ctx.lineWidth = 2.5;
      for (const s of city.segments) {
        ctx.beginPath();
        ctx.moveTo(toX(s.a.x), toY(s.a.z));
        ctx.lineTo(toX(s.b.x), toY(s.b.z));
        ctx.stroke();
      }
      // GPS route line: a thin white line from the player to the mission objective.
      const target = state.missionTarget || MISSIONS[state.missionIndex].target;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(toX(car.x), toY(car.z));
      ctx.lineTo(toX(target.x), toY(target.z));
      ctx.stroke();
      // Search zone (Day 3): a pale red circle around the last known position.
      if (state.searchZone) {
        ctx.fillStyle = 'rgba(255, 46, 46, 0.18)';
        ctx.strokeStyle = 'rgba(255, 46, 46, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(toX(state.searchZone.x), toY(state.searchZone.z), state.searchZone.r * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      // Police blips (Day 3): red/blue dots, flashing with the light bars.
      if (state.police) {
        const flashRed = Math.floor(state.time * 2) % 2 === 0;
        for (let i = 0; i < state.police.units.length; i += 1) {
          const u = state.police.units[i];
          if (u.wrecked) continue;
          ctx.fillStyle = (i + (flashRed ? 0 : 1)) % 2 === 0 ? '#ff2e2e' : '#2e7dff';
          ctx.beginPath();
          ctx.arc(toX(u.x), toY(u.z), 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Mission diamond (yellow).
      ctx.fillStyle = '#ffd166';
      const mx = toX(target.x);
      const my = toY(target.z);
      ctx.beginPath();
      ctx.moveTo(mx, my - 6);
      ctx.lineTo(mx + 6, my);
      ctx.lineTo(mx, my + 6);
      ctx.lineTo(mx - 6, my);
      ctx.closePath();
      ctx.fill();
      // Player arrow (white triangle, rotated by heading; heading 0 faces south = down).
      ctx.save();
      ctx.translate(toX(car.x), toY(car.z));
      ctx.rotate(Math.PI - car.heading);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(5.5, 6);
      ctx.lineTo(-5.5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
  };
}
