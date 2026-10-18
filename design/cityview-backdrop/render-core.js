(function () {
  'use strict';

  const W = 1280;
  const H = 800;

  const BIOMES = {
    grass: { sky: '#dfe8d8', far: '#a9b9a2', mid: '#7d966f', near: '#5c7a4e', accent: '#e6d7a2', water: '#7fa7b5', ink: '#3f4a38', label: 'Grass' },
    dirt: { sky: '#e8e2d5', far: '#c0b39a', mid: '#9a8767', near: '#756148', accent: '#ddc690', water: '#7d9a9a', ink: '#4e4132', label: 'Dirt' },
    water: { sky: '#dbe7ea', far: '#a5bdc6', mid: '#7a9dac', near: '#587d90', accent: '#e8f3f5', water: '#5f8ea6', ink: '#35505c', label: 'Water' },
    forest: { sky: '#dbe5d8', far: '#94ac90', mid: '#5f815c', near: '#3f6044', accent: '#cad9a6', water: '#6f9a9a', ink: '#30452f', label: 'Forest' },
    desert: { sky: '#f0e6cf', far: '#d9c6a0', mid: '#c4a772', near: '#a58451', accent: '#f2dda9', water: '#6fa0b0', ink: '#5a4a32', label: 'Desert' },
    mountain: { sky: '#e5e7ea', far: '#b6bac3', mid: '#8b909d', near: '#666b78', accent: '#eef2f6', water: '#7492a6', ink: '#444a55', label: 'Mountain' },
    swamp: { sky: '#dfe4d4', far: '#a3ac94', mid: '#778764', near: '#58684a', accent: '#cec28c', water: '#607c70', ink: '#3d4632', label: 'Swamp' },
    snow: { sky: '#e9eef2', far: '#c7d3de', mid: '#a4b6c6', near: '#8095a8', accent: '#f5f9fc', water: '#8fb0c2', ink: '#4b5b68', label: 'Snow' },
  };

  const SCENARIOS = [
    { id: 'river-capital', label: 'River Capital', center: 'grass', neighbors: ['water', 'grass', 'forest', 'water', 'grass', 'forest'], seed: 7 },
    { id: 'highland-hold', label: 'Highland Hold', center: 'mountain', neighbors: ['mountain', 'snow', 'forest', 'mountain', 'grass', 'forest'], seed: 19 },
    { id: 'desert-crossroads', label: 'Desert Crossroads', center: 'desert', neighbors: ['desert', 'dirt', 'mountain', 'desert', 'grass', 'desert'], seed: 31 },
    { id: 'marsh-refuge', label: 'Marsh Refuge', center: 'swamp', neighbors: ['water', 'swamp', 'forest', 'water', 'grass', 'swamp'], seed: 43 },
  ];

  function hashString(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(optionId, scenarioId, seed) {
    const next = mulberry32(hashString(String(optionId) + '|' + String(scenarioId) + '|' + String(seed)));
    return {
      next,
      range(min, max) { return min + next() * (max - min); },
      int(min, max) { return min + Math.floor(next() * (max - min + 1)); },
      pick(arr) { return arr[Math.floor(next() * arr.length)]; },
      chance(p) { return next() < p; },
      sign() { return next() < 0.5 ? -1 : 1; },
    };
  }

  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0 || 1e-9), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function hexToRgb(hex) {
    let h = String(hex).replace('#', '').trim();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = Number.parseInt(h, 16);
    if (!Number.isFinite(n) || h.length !== 6) return { r: 0, g: 0, b: 0 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function channelHex(n) {
    return Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  }

  function rgbToHex(r, g, b) {
    return '#' + channelHex(r) + channelHex(g) + channelHex(b);
  }

  function mix(hexA, hexB, t) {
    const a = hexToRgb(hexA);
    const b = hexToRgb(hexB);
    const k = clamp(t, 0, 1);
    return rgbToHex(lerp(a.r, b.r, k), lerp(a.g, b.g, k), lerp(a.b, b.b, k));
  }

  function lighten(hex, t) {
    return mix(hex, '#ffffff', t);
  }

  function darken(hex, t) {
    return mix(hex, '#000000', t);
  }

  function alpha(hex, a) {
    const c = hexToRgb(hex);
    return 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + clamp(a, 0, 1) + ')';
  }

  function weightedBiomes(scenario) {
    const weights = {};
    for (const key of Object.keys(BIOMES)) weights[key] = 0;
    weights[scenario.center] = (weights[scenario.center] || 0) + 2;
    for (const terrain of scenario.neighbors) weights[terrain] = (weights[terrain] || 0) + 1;
    const total = 2 + scenario.neighbors.length;
    const entries = Object.entries(weights)
      .filter((entry) => entry[1] > 0)
      .sort((a, b) => b[1] - a[1]);
    const dominant = entries[0] ? entries[0][0] : scenario.center;
    const secondary = entries[1] ? entries[1][0] : dominant;
    const neighborWeights = scenario.neighbors.map((terrain) => ({
      terrain,
      weight: weights[terrain] / total,
    }));
    return { weights, total, dominant, secondary, neighborWeights };
  }

  function blendBiomeColor(scenario, key, extraMix) {
    const { weights, total, dominant } = weightedBiomes(scenario);
    let r = 0;
    let g = 0;
    let b = 0;
    for (const [biome, weight] of Object.entries(weights)) {
      if (!weight) continue;
      const entry = BIOMES[biome];
      const source = entry[key] || entry.mid;
      const c = hexToRgb(source);
      r += c.r * weight;
      g += c.g * weight;
      b += c.b * weight;
    }
    const blended = rgbToHex(r / total, g / total, b / total);
    if (extraMix) {
      const dominantEntry = BIOMES[dominant];
      return mix(blended, dominantEntry[key] || dominantEntry.mid, clamp(extraMix, 0, 1));
    }
    return blended;
  }

  function noise1D(x, seed) {
    const rnd = mulberry32(hashString('noise1d|' + seed));
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let norm = 0;
    for (let i = 0; i < 4; i++) {
      const phase = rnd() * Math.PI * 2;
      value += Math.sin(x * frequency * Math.PI * 2 + phase) * amplitude;
      norm += amplitude;
      amplitude *= 0.56;
      frequency *= 2.07;
    }
    return clamp(value / norm, -1, 1);
  }

  function ridged1D(x, seed, sharpness) {
    const sharp = sharpness === undefined ? 1 : sharpness;
    const ridge = 1 - Math.abs(noise1D(x, seed));
    return clamp(Math.pow(clamp(ridge, 0, 1), Math.max(0.001, sharp)), 0, 1);
  }

  function wash(ctx, pathFn, opts) {
    const options = opts || {};
    const color = options.color || '#888888';
    const strength = options.alpha === undefined ? 0.5 : options.alpha;
    const blur = options.blur === undefined ? 3 : options.blur;
    const passes = Math.max(1, options.passes === undefined ? 2 : options.passes);
    const dx = options.dx || 0;
    const dy = options.dy || 0;
    const canFilter = 'filter' in ctx;
    ctx.save();
    if (canFilter) ctx.filter = 'blur(' + Math.max(0, blur) + 'px)';
    for (let i = 0; i < passes; i++) {
      const p = passes === 1 ? 0.5 : i / (passes - 1);
      const wobble = (p - 0.5) * blur * 0.7;
      ctx.save();
      ctx.translate(dx * p + wobble, dy * p + wobble);
      ctx.globalAlpha = strength * (i === 0 ? 1 : 0.72);
      ctx.fillStyle = color;
      ctx.beginPath();
      pathFn(ctx);
      ctx.fill();
      ctx.restore();
    }
    if (canFilter) ctx.filter = 'none';
    ctx.restore();
  }

  let grainCanvas = null;
  const grainPatterns = new WeakMap();

  function grain(ctx, w, h, strength) {
    const amount = strength === undefined ? 0.05 : strength;
    if (!grainCanvas) {
      grainCanvas = document.createElement('canvas');
      grainCanvas.width = 512;
      grainCanvas.height = 512;
      const g = grainCanvas.getContext('2d');
      const image = g.createImageData(512, 512);
      const rnd = mulberry32(0x51ed270b);
      for (let i = 0; i < image.data.length; i += 4) {
        const value = 202 + Math.floor(rnd() * 54);
        image.data[i] = value;
        image.data[i + 1] = value;
        image.data[i + 2] = value;
        image.data[i + 3] = 255;
      }
      g.putImageData(image, 0, 0);
    }
    let pattern = grainPatterns.get(ctx);
    if (!pattern) {
      pattern = ctx.createPattern(grainCanvas, 'repeat');
      grainPatterns.set(ctx, pattern);
    }
    ctx.save();
    ctx.globalAlpha = clamp(amount, 0, 1);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function vignette(ctx, w, h, color, strength) {
    const shade = color || '#1a1620';
    const amount = strength === undefined ? 0.18 : strength;
    const cx = w * 0.5;
    const cy = h * 0.46;
    const inner = Math.min(w, h) * 0.32;
    const outer = Math.hypot(w, h) * 0.62;
    const gradient = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    gradient.addColorStop(0, alpha(shade, 0));
    gradient.addColorStop(0.62, alpha(shade, amount * 0.35));
    gradient.addColorStop(1, alpha(shade, amount));
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function diamondPath(ctx, x, y, halfW, halfH) {
    ctx.beginPath();
    ctx.moveTo(x, y - halfH);
    ctx.lineTo(x + halfW, y);
    ctx.lineTo(x, y + halfH);
    ctx.lineTo(x - halfW, y);
    ctx.closePath();
  }

  function roundRectPath(ctx, x, y, w, h, radius) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const CITY_CX = 640;
  const CITY_CY = 380;
  const CITY_N = 5;
  const CITY_TILE_W = 96;
  const CITY_TILE_H = 48;

  function cityCellCenter(i, j) {
    return {
      x: CITY_CX + (i - j) * (CITY_TILE_W / 2),
      y: CITY_CY + (i + j - (CITY_N - 1)) * (CITY_TILE_H / 2),
    };
  }

  function drawIsoWalls(ctx, x, y, w, d, h, wall, shade, ink) {
    ctx.lineJoin = 'miter';
    ctx.lineWidth = 1;
    ctx.strokeStyle = alpha(ink, 0.55);
    ctx.fillStyle = wall;
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.lineTo(x, y + d);
    ctx.lineTo(x, y + d - h);
    ctx.lineTo(x - w, y - h);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.moveTo(x, y + d);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y - h);
    ctx.lineTo(x, y + d - h);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawHipRoof(ctx, x, y, w, d, h, roof, roofShade, ink, rise) {
    const rx = w + 3;
    const rd = d + 3;
    const topY = y - h;
    const apexX = x;
    const apexY = topY - rd - rise;
    const L = { x: x - rx, y: topY };
    const T = { x: x, y: topY - rd };
    const R = { x: x + rx, y: topY };
    const B = { x: x, y: topY + rd };
    ctx.lineJoin = 'miter';
    ctx.lineWidth = 1;
    ctx.strokeStyle = alpha(ink, 0.6);
    const faces = [
      { points: [T, L, { x: apexX, y: apexY }], fill: darken(roofShade, 0.08) },
      { points: [R, T, { x: apexX, y: apexY }], fill: darken(roofShade, 0.18) },
      { points: [L, B, { x: apexX, y: apexY }], fill: roof },
      { points: [B, R, { x: apexX, y: apexY }], fill: roofShade },
    ];
    for (const face of faces) {
      ctx.beginPath();
      ctx.moveTo(face.points[0].x, face.points[0].y);
      for (let i = 1; i < face.points.length; i++) ctx.lineTo(face.points[i].x, face.points[i].y);
      ctx.closePath();
      ctx.fillStyle = face.fill;
      ctx.fill();
      ctx.stroke();
    }
  }

  function drawWallOpening(ctx, baseX, baseY, dirX, dirY, widthT, heightPx, fill, outline) {
    const p1x = baseX + dirX * widthT;
    const p1y = baseY + dirY * widthT;
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(p1x, p1y);
    ctx.lineTo(p1x, p1y - heightPx);
    ctx.lineTo(baseX, baseY - heightPx);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawBuilding(ctx, x, y, def, rng) {
    const wall = def.wall;
    const shade = def.shade;
    const ink = '#3f4a38';
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#182016';
    ctx.beginPath();
    ctx.ellipse(x, y + def.d * 0.7, def.w * 1.02, def.d * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawIsoWalls(ctx, x, y, def.w, def.d, def.h, wall, shade, ink);
    drawHipRoof(ctx, x, y, def.w, def.d, def.h, def.roof, def.roofShade, ink, def.rise);

    const leftBaseX = x - def.w;
    const leftBaseY = y;
    const leftDirX = def.w;
    const leftDirY = def.d;
    const rightBaseX = x;
    const rightBaseY = y + def.d;
    const rightDirX = def.w;
    const rightDirY = -def.d;

    if (def.kind === 'barn') {
      drawWallOpening(ctx, rightBaseX + rightDirX * 0.3, rightBaseY + rightDirY * 0.3, rightDirX, rightDirY, 0.22, def.h * 0.62, '#4f3826', alpha(ink, 0.7));
      ctx.strokeStyle = '#c9a46a';
      ctx.lineWidth = 1.4;
      const dx = rightDirX * 0.22;
      const dy = rightDirY * 0.22;
      const bx = rightBaseX + rightDirX * 0.3;
      const by = rightBaseY + rightDirY * 0.3;
      const doorH = def.h * 0.62;
      ctx.beginPath();
      ctx.moveTo(bx, by - 2);
      ctx.lineTo(bx + dx, by + dy - 2);
      ctx.moveTo(bx + dx, by - 2);
      ctx.lineTo(bx, by + dy - 2);
      ctx.moveTo(bx, by - doorH);
      ctx.lineTo(bx + dx, by + dy - doorH);
      ctx.moveTo(bx + dx, by - doorH);
      ctx.lineTo(bx, by + dy - doorH);
      ctx.stroke();
      drawWallOpening(ctx, leftBaseX + leftDirX * 0.62, leftBaseY + leftDirY * 0.62, leftDirX, leftDirY, 0.16, def.h * 0.34, '#e1c07c', alpha(ink, 0.6));
    } else {
      const lit = rng.chance(0.4);
      const pane = lit ? '#e6cc8e' : '#5a5850';
      const windows = def.kind === 'hall' ? 3 : 2;
      for (let i = 0; i < windows; i++) {
        const t = 0.18 + i * (0.64 / Math.max(1, windows - 1 || 1));
        drawWallOpening(ctx, leftBaseX + leftDirX * t, leftBaseY + leftDirY * t, leftDirX, leftDirY, 0.13, def.kind === 'hall' ? def.h * 0.3 : def.h * 0.34, pane, alpha(ink, 0.6));
      }
      drawWallOpening(ctx, rightBaseX + rightDirX * 0.36, rightBaseY + rightDirY * 0.36, rightDirX, rightDirY, 0.2, def.h * 0.48, '#4a3f33', alpha(ink, 0.7));
      drawWallOpening(ctx, rightBaseX + rightDirX * 0.68, rightBaseY + rightDirY * 0.68, rightDirX, rightDirY, 0.12, def.h * 0.3, pane, alpha(ink, 0.6));
    }

    if (def.kind === 'hall') {
      const apexY = y - def.h - (def.d + 3) - def.rise;
      ctx.strokeStyle = '#4b4338';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, apexY);
      ctx.lineTo(x, apexY - 22);
      ctx.stroke();
      ctx.fillStyle = '#c9a45c';
      ctx.beginPath();
      ctx.moveTo(x + 1, apexY - 22);
      ctx.lineTo(x + 15, apexY - 17);
      ctx.lineTo(x + 1, apexY - 12);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = alpha(ink, 0.5);
      ctx.beginPath();
      ctx.arc(x, apexY, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCityMock(ctx, w, h, seed) {
    const rng = makeRng('city-mock', 'city', seed);
    const ink = '#3f4a38';

    ctx.save();
    ctx.shadowColor = 'rgba(12, 16, 20, 0.38)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 14;
    ctx.fillStyle = '#4d5c42';
    diamondPath(ctx, CITY_CX, CITY_CY, 240, 120);
    ctx.fill();
    ctx.restore();

    const farmCandidates = [
      [0, 1], [4, 1], [1, 4], [3, 4], [4, 3], [0, 3],
    ];
    for (let i = farmCandidates.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      const tmp = farmCandidates[i];
      farmCandidates[i] = farmCandidates[j];
      farmCandidates[j] = tmp;
    }
    const farmCount = rng.int(4, 6);
    const farmCells = new Set(farmCandidates.slice(0, farmCount).map((cell) => cell[0] + ',' + cell[1]));

    const grassTones = ['#94ad76', '#8ba36e', '#9db37f', '#90a972'];
    const dirtTones = ['#bda77d', '#b49e74', '#c4ad84', '#b9a278'];
    const farmTones = ['#d7b86b', '#cfad60', '#dfc177', '#d3b265'];

    for (let i = 0; i < CITY_N; i++) {
      for (let j = 0; j < CITY_N; j++) {
        const p = cityCellCenter(i, j);
        const isFarm = farmCells.has(i + ',' + j);
        const isGrass = (i + j) % 2 === 0;
        const palette = isFarm ? farmTones : isGrass ? grassTones : dirtTones;
        const fill = palette[rng.int(0, palette.length - 1)];

        diamondPath(ctx, p.x, p.y, 48, 24);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = fill;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.fillStyle = alpha(ink, 0.1);
        for (let t = 0; t < 3; t++) {
          const u = rng.range(-0.62, 0.62);
          const v = rng.range(-0.55, 0.55) * (1 - Math.abs(u));
          ctx.beginPath();
          ctx.arc(p.x + u * 76, p.y + v * 38, isFarm ? 1.7 : 1.2, 0, Math.PI * 2);
          ctx.fill();
        }

        if (isFarm) {
          ctx.fillStyle = 'rgba(122, 98, 46, 0.72)';
          for (let row = -1; row <= 1; row++) {
            for (let col = -2; col <= 2; col++) {
              const u = col * 11 + row * 5.5;
              const v = row * 8;
              ctx.beginPath();
              ctx.arc(p.x + u, p.y + v, 1.8, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        } else {
          ctx.strokeStyle = alpha(isGrass ? '#5f7a4e' : '#8b7754', 0.5);
          ctx.lineWidth = 1;
          for (let t = 0; t < 2; t++) {
            const u = rng.range(-0.4, 0.4);
            const v = rng.range(-0.32, 0.32);
            ctx.beginPath();
            ctx.moveTo(p.x + u * 76, p.y + v * 38);
            ctx.lineTo(p.x + u * 76 + 2, p.y + v * 38 - 3);
            ctx.stroke();
          }
        }

        diamondPath(ctx, p.x, p.y, 48, 24);
        ctx.strokeStyle = alpha(ink, 0.3);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    diamondPath(ctx, CITY_CX, CITY_CY, 240, 120);
    ctx.strokeStyle = alpha(ink, 0.55);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const buildings = [
      { i: 1, j: 1, kind: 'house', w: 24, d: 12, h: 22, rise: 7, wall: '#e0d3b5', shade: '#c5b696', roof: '#a65e49', roofShade: '#874838' },
      { i: 2, j: 1, kind: 'barn', w: 30, d: 14, h: 20, rise: 6, wall: '#b0865a', shade: '#916c47', roof: '#8c4f3f', roofShade: '#6e3c31' },
      { i: 1, j: 2, kind: 'house', w: 26, d: 13, h: 24, rise: 7, wall: '#dccfb0', shade: '#c0b191', roof: '#6f6b74', roofShade: '#56525b' },
      { i: 3, j: 1, kind: 'house', w: 24, d: 12, h: 20, rise: 6, wall: '#e4d8ba', shade: '#c9bb9b', roof: '#a85c46', roofShade: '#884836' },
      { i: 2, j: 2, kind: 'hall', w: 46, d: 23, h: 52, rise: 16, wall: '#d8d0bc', shade: '#b9b09a', roof: '#7d6c74', roofShade: '#61545d' },
      { i: 1, j: 3, kind: 'barn', w: 32, d: 15, h: 22, rise: 6, wall: '#ac8156', shade: '#8d6944', roof: '#8a4d3d', roofShade: '#6c3b30' },
      { i: 3, j: 3, kind: 'house', w: 26, d: 13, h: 24, rise: 7, wall: '#e2d5b6', shade: '#c6b797', roof: '#9c5642', roofShade: '#7d4232' },
    ];

    buildings.sort((a, b) => a.i + a.j - (b.i + b.j) || a.i - b.i);
    for (const def of buildings) {
      const p = cityCellCenter(def.i, def.j);
      drawBuilding(ctx, p.x, p.y, def, rng);
    }
  }

  function drawTopButton(ctx, x, y, w, h, fill, stroke, textColor, label) {
    roundRectPath(ctx, x, y, w, h, 6);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = textColor;
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
  }

  function drawGear(ctx, cx, cy, radius, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * (radius - 1), cy + Math.sin(angle) * (radius - 1));
      ctx.lineTo(cx + Math.cos(angle) * (radius + 5), cy + Math.sin(angle) * (radius + 5));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawChrome(ctx, w, h) {
    ctx.save();

    const bar = '#182338';
    ctx.fillStyle = bar;
    ctx.fillRect(0, 0, w, 72);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
    ctx.fillRect(0, 0, w, 1);
    ctx.fillStyle = 'rgba(201, 164, 92, 0.85)';
    ctx.fillRect(0, 71, w, 1);

    drawTopButton(ctx, 20, 18, 104, 36, '#c9a45c', '#e0c07a', '#1a1c22', 'END TURN');
    const labels = ['Heroes', 'Settlements', 'Logistics', 'Diplomacy'];
    for (let i = 0; i < labels.length; i++) {
      drawTopButton(ctx, 140 + i * 108, 18, 100, 36, '#223049', 'rgba(140, 160, 190, 0.35)', '#c6d0e0', labels[i]);
    }
    drawGear(ctx, 1240, 36, 14, '#b8a36a');

    roundRectPath(ctx, 14, 96, 236, 688, 10);
    ctx.fillStyle = 'rgba(12, 16, 22, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(201, 164, 92, 0.28)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#c9a45c';
    ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('SETTLEMENT', 30, 128);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#7f8794';
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Player 1', 234, 128);
    ctx.fillStyle = 'rgba(201, 164, 92, 0.35)';
    ctx.fillRect(30, 140, 204, 1);

    const rows = [
      ['Population', '500'],
      ['Income / turn', '300g'],
      ['Morale', '100%'],
      ['Food', '0 / 5'],
      ['Wood', '300'],
      ['Stone', '300'],
      ['Iron', '300'],
      ['Arcane', '300'],
      ['Garrison', '12'],
    ];
    const startY = 172;
    const step = 52;
    for (let i = 0; i < rows.length; i++) {
      const y = startY + i * step;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#8d8f96';
      ctx.font = '11px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(rows[i][0], 30, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#d8d0bc';
      ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(rows[i][1], 234, y);
      ctx.fillStyle = 'rgba(201, 164, 92, 0.1)';
      ctx.fillRect(30, y + 16, 204, 1);
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(140, 140, 132, 0.62)';
    ctx.font = '9px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('CITY VIEW · BACKDROP STUDY', 30, 760);

    ctx.restore();
  }

  function drawOverlays(ctx, w, h, seed) {
    grain(ctx, w, h);
    vignette(ctx, w, h);
    drawCityMock(ctx, w, h, seed);
    drawChrome(ctx, w, h);
  }

  window.CityBackdropCore = {
    W,
    H,
    BIOMES,
    SCENARIOS,
    hashString,
    mulberry32,
    makeRng,
    clamp,
    lerp,
    smoothstep,
    mix,
    lighten,
    darken,
    alpha,
    weightedBiomes,
    blendBiomeColor,
    noise1D,
    ridged1D,
    wash,
    grain,
    vignette,
    drawCityMock,
    drawChrome,
    drawOverlays,
  };
})();
