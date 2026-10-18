(function () {
  'use strict';

  const Core = window.CityBackdropCore;
  const BIOMES = Core.BIOMES;
  const TAU = Math.PI * 2;
  const clamp = Core.clamp;
  const lerp = Core.lerp;
  const mix = Core.mix;
  const lighten = Core.lighten;
  const darken = Core.darken;
  const alpha = Core.alpha;
  const smoothstep = Core.smoothstep;
  const weightedBiomes = Core.weightedBiomes;
  const blendBiomeColor = Core.blendBiomeColor;
  const noise1D = Core.noise1D;
  const wash = Core.wash;

  const registry = window.CityBackdropOptions = window.CityBackdropOptions || {};

  function channelHex(n) {
    return Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  }

  function shiftHue(hex, degrees) {
    const raw = String(hex).replace('#', '').trim();
    const full = raw.length === 3 ? raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2] : raw;
    const n = Number.parseInt(full, 16);
    if (!Number.isFinite(n) || full.length !== 6) return hex;
    const r = ((n >> 16) & 255) / 255;
    const g = ((n >> 8) & 255) / 255;
    const b = (n & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let s = 0;
    let hue = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) hue = (b - r) / d + 2;
      else hue = (r - g) / d + 4;
      hue *= 60;
    }
    hue = (hue + degrees + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = l - c / 2;
    let rr = 0;
    let gg = 0;
    let bb = 0;
    if (hue < 60) { rr = c; gg = x; }
    else if (hue < 120) { rr = x; gg = c; }
    else if (hue < 180) { gg = c; bb = x; }
    else if (hue < 240) { gg = x; bb = c; }
    else if (hue < 300) { rr = x; bb = c; }
    else { rr = c; bb = x; }
    return '#' + channelHex((rr + m) * 255) + channelHex((gg + m) * 255) + channelHex((bb + m) * 255);
  }

  function softEllipse(ctx, x, y, rx, ry, color, strength, inner) {
    const inStop = clamp(inner === undefined ? 0.42 : inner, 0.05, 0.88);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(Math.max(1, rx), Math.max(1, ry));
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, alpha(color, strength));
    g.addColorStop(inStop, alpha(color, strength * 0.72));
    g.addColorStop(inStop + (1 - inStop) * 0.55, alpha(color, strength * 0.3));
    g.addColorStop(1, alpha(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function ringEllipse(ctx, x, y, rx, ry, color, strength) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(Math.max(1, rx), Math.max(1, ry));
    const g = ctx.createRadialGradient(0, 0, 0.5, 0, 0, 1);
    g.addColorStop(0, alpha(color, 0));
    g.addColorStop(0.58, alpha(color, strength * 0.22));
    g.addColorStop(0.84, alpha(color, strength));
    g.addColorStop(1, alpha(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function closedSmoothPath(ctx, pts) {
    const n = pts.length;
    if (!n) return;
    const first = pts[0];
    const last = pts[n - 1];
    ctx.beginPath();
    ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % n];
      ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
    }
    ctx.closePath();
  }

  function ribbonPoints(pts, widthScale) {
    const left = [];
    const right = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const w = p.w * widthScale;
      left.push({ x: p.x + nx * w, y: p.y + ny * w });
      right.push({ x: p.x - nx * w, y: p.y - ny * w });
    }
    return left.concat(right.reverse());
  }

  function makeBlob(cx, cy, rx, ry, rotation, rng, count) {
    const n = count || rng.int(9, 13);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = rotation + (i / n) * TAU;
      const jitter = rng.range(0.78, 1.18);
      pts.push({ x: cx + Math.cos(a) * rx * jitter, y: cy + Math.sin(a) * ry * jitter });
    }
    return { x: cx, y: cy, rx, ry, rotation, pts, n };
  }

  function makeOutline(cx, cy, rx, ry, rng, seed) {
    const count = rng.int(24, 32);
    const phase = rng.range(0, TAU);
    const pts = [];
    for (let i = 0; i < count; i++) {
      const a = phase + (i / count) * TAU;
      const n1 = noise1D((i / count) * 2.2, seed + 17) * 7;
      const n2 = noise1D((i / count) * 5.4, seed + 41) * 4;
      const jitter = rng.range(-14, 14);
      const radial = n1 + n2 + jitter;
      pts.push({
        x: cx + Math.cos(a) * (rx + radial),
        y: cy + Math.sin(a) * (ry + radial * 0.62),
      });
    }
    return pts;
  }

  function distanceToPath(x, y, paths) {
    let best = Infinity;
    for (const pts of paths) {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy || 1;
        const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / len2, 0, 1);
        const d = Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
        if (d < best) best = d;
      }
    }
    return best;
  }

  function underCity(x, y, zone) {
    const dx = (x - zone.x) / zone.rx;
    const dy = (y - zone.y) / zone.ry;
    return dx * dx + dy * dy < 1;
  }

  function blocked(env, x, y, margin) {
    if (underCity(x, y, env.cityZone)) return true;
    if (env.paths.length && distanceToPath(x, y, env.paths) < (margin === undefined ? 18 : margin)) return true;
    return false;
  }

  function drawBroadleaf(ctx, x, y, size, color, env, rng) {
    const trunk = mix(color, env.ink, 0.55);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = alpha(trunk, 0.6);
    ctx.lineWidth = Math.max(1, size * 0.07);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-1.2, 1.2), y - size * 0.4);
    ctx.stroke();
    const rx = size * rng.range(0.24, 0.34);
    const ry = rx * rng.range(0.82, 1.12);
    const cx = x + rng.range(-1.5, 1.5);
    const cy = y - size * 0.6;
    ctx.fillStyle = alpha(mix(color, env.mist, 0.1), 0.75);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 1.12, ry, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = alpha(mix(lighten(color, 0.18), env.mist, 0.08), 0.5);
    ctx.beginPath();
    ctx.ellipse(cx - rx * 0.28, cy - ry * 0.32, rx * 0.72, ry * 0.66, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawConifer(ctx, x, y, size, color, env, rng) {
    const trunk = mix(color, env.ink, 0.5);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = alpha(trunk, 0.55);
    ctx.lineWidth = Math.max(1, size * 0.06);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-0.8, 0.8), y - size * 0.22);
    ctx.stroke();
    for (let layer = 0; layer < 3; layer++) {
      const ly = y - size * (0.18 + 0.22 * layer);
      const half = size * (0.3 - 0.07 * layer);
      ctx.fillStyle = alpha(mix(lighten(color, layer * 0.035), env.mist, 0.1), 0.78);
      ctx.beginPath();
      ctx.moveTo(x - half, ly);
      ctx.lineTo(x + half, ly);
      ctx.lineTo(x, ly - size * 0.34);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawReedClump(ctx, x, y, count, h, env, rng) {
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const lean = rng.range(-3, 3);
      const hh = h * rng.range(0.6, 1.1);
      const bx = x + (i - count / 2) * 1.6;
      ctx.strokeStyle = alpha(mix(env.tint(BIOMES.swamp.near), env.ink, 0.35), 0.45);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx, y);
      ctx.quadraticCurveTo(bx + lean * 0.4, y - hh * 0.6, bx + lean, y - hh);
      ctx.stroke();
      ctx.fillStyle = alpha(env.tint(BIOMES.swamp.accent), 0.4);
      ctx.beginPath();
      ctx.ellipse(bx + lean, y - hh, 1.2, 2, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawTuft(ctx, x, y, h, color, env, rng) {
    ctx.save();
    ctx.strokeStyle = alpha(mix(color, env.mist, 0.15), 0.5);
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    const blades = rng.int(3, 5);
    for (let i = 0; i < blades; i++) {
      const lean = rng.range(-4, 4);
      const bx = x + (i - blades / 2) * 1.2;
      ctx.beginPath();
      ctx.moveTo(bx, y);
      ctx.quadraticCurveTo(bx + lean * 0.5, y - h * 0.55, bx + lean, y - h * rng.range(0.6, 1.05));
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFlower(ctx, x, y, r, color, env) {
    ctx.save();
    ctx.strokeStyle = alpha(mix(BIOMES.grass.near, env.mist, 0.2), 0.4);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + r * 0.4, y - r * 3);
    ctx.stroke();
    ctx.fillStyle = alpha(mix(color, env.mist, 0.08), 0.62);
    ctx.beginPath();
    ctx.arc(x + r * 0.4, y - r * 3, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawBoulder(ctx, x, y, r, color, env, rng) {
    softEllipse(ctx, x, y + r * 0.28, r * 1.15, r * 0.38, env.ink, 0.12);
    const pts = [];
    const n = rng.int(6, 8);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const rr = r * rng.range(0.68, 1.02);
      pts.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr * 0.7 });
    }
    closedSmoothPath(ctx, pts);
    ctx.fillStyle = alpha(mix(color, env.mist, 0.12), 0.72);
    ctx.fill();
    ctx.strokeStyle = alpha(darken(color, 0.3), 0.2);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = alpha(mix(lighten(color, 0.2), env.mist, 0.1), 0.4);
    ctx.beginPath();
    ctx.ellipse(x - r * 0.16, y - r * 0.28, r * 0.48, r * 0.26, -0.2, 0, TAU);
    ctx.fill();
  }

  function drawCactus(ctx, x, y, h, color, env, rng) {
    ctx.save();
    ctx.strokeStyle = alpha(mix(color, env.mist, 0.1), 0.68);
    ctx.lineWidth = Math.max(1.5, h * 0.14);
    ctx.lineCap = 'round';
    const lean = rng.range(-2.5, 2.5);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + lean * 0.5, y - h * 0.5, x + lean, y - h);
    ctx.stroke();
    const side = rng.sign();
    const armY = y - h * rng.range(0.35, 0.6);
    ctx.beginPath();
    ctx.moveTo(x + lean * 0.3, armY);
    ctx.quadraticCurveTo(x + side * h * 0.3, armY + h * 0.02, x + side * h * 0.28, armY - h * 0.22);
    ctx.stroke();
    ctx.restore();
  }

  registry['settlement-diorama'] = function (ctx, W, H, scenario, rng, seed) {
    renderSettlement(ctx, W, H, scenario, rng, seed);
  };

  function renderSettlement(ctx, W, H, scenario, rng, seed) {
    const info = weightedBiomes(scenario);
    const hueShift = rng.range(-5, 5);
    const tint = (hex) => shiftHue(hex, hueShift);
    const centerBiome = BIOMES[scenario.center] || BIOMES.grass;
    const sky = mix(tint(centerBiome.sky), blendBiomeColor(scenario, 'sky', 0.3), 0.5);
    const mist = mix(lighten(sky, 0.32), tint(BIOMES[info.dominant].far), 0.18);
    const ink = tint(BIOMES[info.dominant].ink);
    const baseMid = mix(blendBiomeColor(scenario, 'mid', 0.25), mix(tint(BIOMES.grass.mid), tint(BIOMES.dirt.mid), 0.4), 0.42);
    const baseNear = mix(blendBiomeColor(scenario, 'near', 0.2), mix(tint(BIOMES.grass.near), tint(BIOMES.dirt.near), 0.42), 0.45);
    const baseFar = mix(blendBiomeColor(scenario, 'far', 0.2), tint(BIOMES.grass.far), 0.4);

    const cx = W / 2 + rng.range(-12, 12);
    const cy = 430 + rng.range(-10, 10);
    const rx = 550 * rng.range(0.97, 1.02);
    const ry = 310 * rng.range(0.97, 1.02);

    const env = {
      tint,
      mist,
      ink,
      sky,
      base: baseMid,
      baseNear,
      baseFar,
      paths: [],
      plate: { cx, cy, rx, ry },
      cityZone: { x: 640, y: 398, rx: 286, ry: 168 },
    };

    drawBackground(ctx, W, H, env, rng);

    const outline = makeOutline(cx, cy, rx, ry, rng, seed);
    const neighborBase = rng.range(0, TAU);
    const wedges = buildWedges(env, scenario, neighborBase, rng);
    const paths = buildPaths(env, neighborBase, rng);
    env.paths = paths.map((path) => path.pts);
    const blobs = buildBlobs(env, wedges, rng);

    softEllipse(ctx, cx, cy + ry * 0.58, rx * 0.9, ry * 0.6, darken(ink, 0.1), 0.18, 0.2);
    softEllipse(ctx, cx, cy + ry * 0.24, rx * 0.78, ry * 0.46, ink, 0.1, 0.2);

    const plate = document.createElement('canvas');
    plate.width = W;
    plate.height = H;
    const pctx = plate.getContext('2d');
    if (!pctx) return;

    drawPlateUnderside(pctx, outline, env, rng);
    drawPlateTop(pctx, outline, env, rng);

    pctx.save();
    closedSmoothPath(pctx, outline);
    pctx.clip();
    drawSectors(pctx, env, wedges, rng);
    drawCalmCenter(pctx, env, rng);
    for (const blob of blobs) drawBlobGround(pctx, blob, env, rng);
    for (const path of paths) drawPath(pctx, path, env, rng);
    for (const blob of blobs) drawBlobProps(pctx, blob, env, rng);
    drawRim(pctx, outline, env);
    pctx.restore();

    const mask = document.createElement('canvas');
    mask.width = W;
    mask.height = H;
    const mctx = mask.getContext('2d');
    if (!mctx) return;
    mctx.save();
    mctx.translate(cx, cy + 4);
    mctx.scale(rx * 1.03, ry * 1.03);
    const mg = mctx.createRadialGradient(0, 0, 0.55, 0, 0, 1);
    mg.addColorStop(0, 'rgba(255, 255, 255, 1)');
    mg.addColorStop(0.78, 'rgba(255, 255, 255, 1)');
    mg.addColorStop(0.92, 'rgba(255, 255, 255, 0.55)');
    mg.addColorStop(1, 'rgba(255, 255, 255, 0)');
    mctx.fillStyle = mg;
    mctx.beginPath();
    mctx.arc(0, 0, 1, 0, TAU);
    mctx.fill();
    mctx.restore();

    pctx.save();
    pctx.globalCompositeOperation = 'destination-in';
    pctx.drawImage(mask, 0, 0);
    pctx.restore();

    ctx.save();
    ctx.drawImage(plate, 0, 0);
    ctx.restore();

    ringEllipse(ctx, cx, cy + 6, rx * 1.08, ry * 1.06, mist, 0.3);
    drawEdgeWisps(ctx, env, rng);
    drawFloatingRocks(ctx, env, rng);
    drawBottomHaze(ctx, W, H, env, rng);
  }

  function drawBackground(ctx, W, H, env, rng) {
    const top = lighten(env.sky, 0.22);
    const mid = env.sky;
    const bottom = mix(env.sky, env.baseFar, 0.32);
    const g = ctx.createLinearGradient(0, 0, W * 0.18, H);
    g.addColorStop(0, top);
    g.addColorStop(0.45, mid);
    g.addColorStop(0.76, mix(mid, bottom, 0.55));
    g.addColorStop(1, darken(bottom, 0.06));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    softEllipse(ctx, W / 2, H * 0.48, 560, 360, lighten(env.sky, 0.34), 0.4, 0.3);
    softEllipse(ctx, W / 2, H * 0.56, 300, 220, lighten(env.mist, 0.1), 0.25, 0.2);

    drawCornerMist(ctx, W, env, rng);

    const lower = ctx.createLinearGradient(0, H * 0.7, 0, H);
    lower.addColorStop(0, alpha(env.mist, 0));
    lower.addColorStop(1, alpha(env.mist, 0.16));
    ctx.fillStyle = lower;
    ctx.fillRect(0, H * 0.7, W, H * 0.3);
  }

  function drawCornerMist(ctx, W, env, rng) {
    const bands = rng.int(2, 3);
    for (let i = 0; i < bands; i++) {
      const left = i % 2 === 0;
      const x = left ? rng.range(-40, 300) : W - rng.range(-40, 300);
      const y = rng.range(10, 130);
      const rx = rng.range(170, 330);
      const ry = rng.range(55, 115);
      const color = mix(env.mist, lighten(env.sky, 0.4), 0.5);
      softEllipse(ctx, x, y, rx, ry, color, rng.range(0.12, 0.2), 0.2);
      wash(ctx, (c) => {
        c.ellipse(x + (left ? 60 : -60), y + 12, rx * 1.25, ry * 0.5, 0, 0, TAU);
      }, { color, alpha: 0.07, blur: 26, passes: 2, dx: left ? 12 : -12, dy: 5 });
    }
  }

  function drawPlateUnderside(ctx, outline, env, rng) {
    const depth = rng.range(18, 24);
    const bottom = outline.map((p) => ({
      x: p.x + rng.range(-1.5, 1.5),
      y: p.y + depth + rng.range(-1.5, 1.5),
    }));
    closedSmoothPath(ctx, bottom);
    const g = ctx.createLinearGradient(0, env.plate.cy - env.plate.ry, 0, env.plate.cy + env.plate.ry + depth);
    g.addColorStop(0, darken(env.base, 0.42));
    g.addColorStop(0.55, darken(env.base, 0.6));
    g.addColorStop(1, darken(env.ink, 0.32));
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    closedSmoothPath(ctx, bottom);
    ctx.clip();
    for (let i = 0; i < rng.int(22, 34); i++) {
      const p = outline[rng.int(0, outline.length - 1)];
      const len = rng.range(9, depth + 10);
      ctx.strokeStyle = alpha(darken(env.ink, 0.45), rng.range(0.12, 0.28));
      ctx.lineWidth = rng.range(1, 2.4);
      ctx.beginPath();
      ctx.moveTo(p.x + rng.range(-3, 3), p.y + rng.range(0, 5));
      ctx.lineTo(p.x + rng.range(-4, 4), p.y + len);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlateTop(ctx, outline, env, rng) {
    const p = env.plate;
    closedSmoothPath(ctx, outline);
    const g = ctx.createRadialGradient(p.cx - p.rx * 0.18, p.cy - p.ry * 0.4, 80, p.cx, p.cy, p.rx * 1.08);
    g.addColorStop(0, lighten(env.base, 0.14));
    g.addColorStop(0.5, env.base);
    g.addColorStop(0.82, mix(env.base, env.baseNear, 0.55));
    g.addColorStop(1, darken(env.baseNear, 0.18));
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    closedSmoothPath(ctx, outline);
    ctx.clip();
    for (let i = 0; i < 3; i++) {
      const m = makeBlob(
        p.cx + rng.range(-0.55, 0.55) * p.rx,
        p.cy + rng.range(-0.4, 0.5) * p.ry,
        p.rx * rng.range(0.14, 0.3),
        p.ry * rng.range(0.12, 0.26),
        rng.range(0, TAU),
        rng,
        10
      );
      closedSmoothPath(ctx, m.pts);
      ctx.fillStyle = alpha(i % 2 === 0 ? lighten(env.base, 0.08) : darken(env.base, 0.08), 0.1);
      ctx.fill();
    }
    ctx.restore();

    closedSmoothPath(ctx, outline);
    ctx.strokeStyle = alpha(darken(env.base, 0.4), 0.28);
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function buildWedges(env, scenario, neighborBase, rng) {
    const n = 8;
    const weights = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const w = rng.range(0.75, 1.35);
      weights.push(w);
      total += w;
    }
    const wedges = [];
    let cursor = neighborBase + rng.range(0, 0.2);
    for (let i = 0; i < n; i++) {
      const span = (weights[i] / total) * TAU;
      const a0 = cursor;
      const a1 = cursor + span;
      const mid = (a0 + a1) / 2;
      const slot = Math.floor((((mid - neighborBase) % TAU) + TAU) % TAU / (TAU / 6)) % 6;
      wedges.push({
        a0,
        a1,
        mid,
        span,
        biomeKey: scenario.neighbors[slot],
        weight: weights[i],
      });
      cursor = a1;
    }
    return wedges;
  }

  function drawSectors(ctx, env, wedges, rng) {
    const p = env.plate;
    const radius = Math.hypot(p.rx, p.ry) * 1.08;
    ctx.save();
    if ('filter' in ctx) ctx.filter = 'blur(12px)';
    for (const wedge of wedges) {
      const b = BIOMES[wedge.biomeKey] || BIOMES.grass;
      const col = env.tint(mix(b.mid, b.far, 0.22));
      const strength = rng.range(0.12, 0.24) * (0.85 + wedge.weight * 0.15);
      const g = ctx.createRadialGradient(p.cx, p.cy, 40, p.cx, p.cy, radius);
      g.addColorStop(0, alpha(col, 0.015));
      g.addColorStop(0.42, alpha(col, strength * 0.35));
      g.addColorStop(0.82, alpha(col, strength));
      g.addColorStop(1, alpha(col, strength * 0.7));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(p.cx, p.cy);
      ctx.arc(p.cx, p.cy, radius, wedge.a0 - 0.025, wedge.a1 + 0.025);
      ctx.closePath();
      ctx.fill();
    }
    if ('filter' in ctx) ctx.filter = 'none';
    ctx.restore();
  }

  function drawCalmCenter(ctx, env, rng) {
    const p = env.plate;
    softEllipse(ctx, p.cx, p.cy - 10, p.rx * 0.56, p.ry * 0.56, env.baseNear, 0.42, 0.32);
    softEllipse(ctx, p.cx - 20, p.cy - 30, p.rx * 0.3, p.ry * 0.32, lighten(env.base, 0.22), 0.22, 0.2);
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = darken(env.base, 0.18);
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const a = rng.range(0, TAU);
      const r = rng.range(0.2, 0.5);
      ctx.beginPath();
      ctx.moveTo(p.cx + Math.cos(a) * p.rx * r, p.cy + Math.sin(a) * p.ry * r);
      ctx.quadraticCurveTo(
        p.cx + Math.cos(a + 0.4) * p.rx * (r + 0.08),
        p.cy + Math.sin(a + 0.4) * p.ry * (r + 0.08),
        p.cx + Math.cos(a + 0.2) * p.rx * (r + 0.16),
        p.cy + Math.sin(a + 0.2) * p.ry * (r + 0.16)
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  function buildPaths(env, neighborBase, rng) {
    const p = env.plate;
    const count = rng.chance(0.58) ? 2 : 1;
    const slots = [];
    let guard = 0;
    while (slots.length < count && guard < 12) {
      const s = rng.int(0, 5);
      if (!slots.includes(s)) slots.push(s);
      guard++;
    }
    const out = [];
    for (const slot of slots) {
      const angle = neighborBase + slot * (TAU / 6) + rng.range(-0.18, 0.18);
      const steps = 10;
      const startT = rng.range(0.34, 0.42);
      const endT = rng.range(0.9, 1.01);
      const bend = rng.range(-0.16, 0.16);
      const w0 = rng.range(10, 13);
      const w1 = rng.range(5, 8);
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const t = lerp(startT, endT, u);
        const a = angle + Math.sin(u * Math.PI) * bend + rng.range(-0.018, 0.018);
        pts.push({
          x: p.cx + Math.cos(a) * p.rx * t,
          y: p.cy + Math.sin(a) * p.ry * t,
          w: lerp(w0, w1, smoothstep(0, 1, u)) * rng.range(0.85, 1.15),
        });
      }
      out.push({ angle, pts });
    }
    return out;
  }

  function drawPath(ctx, path, env, rng) {
    const pts = path.pts;
    const tan = mix(env.tint(BIOMES.dirt.accent), env.tint(BIOMES.dirt.mid), 0.48);
    ctx.save();
    closedSmoothPath(ctx, ribbonPoints(pts, 1.22));
    ctx.fillStyle = alpha(darken(tan, 0.32), 0.24);
    ctx.fill();
    closedSmoothPath(ctx, ribbonPoints(pts, 0.95));
    ctx.fillStyle = alpha(tan, 0.58);
    ctx.fill();
    closedSmoothPath(ctx, ribbonPoints(pts, 0.45));
    ctx.fillStyle = alpha(lighten(tan, 0.16), 0.16);
    ctx.fill();

    ctx.strokeStyle = alpha(darken(tan, 0.28), 0.16);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pts[1].x, pts[1].y);
    for (let i = 2; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

    for (let i = 0; i < rng.int(5, 10); i++) {
      const idx = rng.int(1, pts.length - 2);
      const q = pts[idx];
      const off = rng.range(0.55, 1.15) * q.w;
      const side = rng.sign();
      const x = q.x + side * off + rng.range(-2, 2);
      const y = q.y + side * off * 0.8 + rng.range(-2, 2);
      ctx.fillStyle = alpha(mix(darken(tan, 0.3), env.ink, 0.3), 0.45);
      ctx.beginPath();
      ctx.ellipse(x, y, rng.range(1.4, 3), rng.range(0.9, 1.8), rng.range(0, TAU), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function buildBlobs(env, wedges, rng) {
    const p = env.plate;
    const spec = {
      water: [58, 96],
      forest: [96, 150],
      mountain: [82, 122],
      desert: [92, 142],
      swamp: [86, 126],
      snow: [80, 118],
      grass: [76, 122],
      dirt: [80, 126],
    };
    const blobs = [];
    for (const wedge of wedges) {
      const count = rng.int(2, 4);
      for (let k = 0; k < count; k++) {
        const u = (k + 0.5) / count;
        const angle = lerp(wedge.a0 + 0.05, wedge.a1 - 0.05, u) + rng.range(-0.05, 0.05);
        const t = rng.range(0.58, 0.94);
        let x = p.cx + Math.cos(angle) * p.rx * t;
        let y = p.cy + Math.sin(angle) * p.ry * t;
        for (let push = 0; push < 12 && underCity(x, y, env.cityZone); push++) {
          x = p.cx + (x - p.cx) * 1.06;
          y = p.cy + (y - p.cy) * 1.06;
        }
        const range = spec[wedge.biomeKey] || spec.grass;
        const sizeBoost = lerp(0.82, 1.2, t);
        const rx = rng.range(range[0], range[1]) * sizeBoost;
        const ry = rx * rng.range(0.55, 0.88);
        const blob = makeBlob(
          x + rng.range(-10, 10),
          y + rng.range(-8, 8),
          rx,
          ry,
          rng.range(0, TAU),
          rng,
          rng.int(9, 13)
        );
        blob.biomeKey = wedge.biomeKey;
        blob.scale = clamp(rx / 105, 0.78, 1.3);
        blob.wedge = wedge;
        blobs.push(blob);
      }
    }
    return blobs;
  }

  function groundColor(key, env) {
    const b = BIOMES[key] || BIOMES.grass;
    switch (key) {
      case 'water': return mix(env.tint(b.water), env.base, 0.4);
      case 'forest': return mix(env.tint(b.near), env.base, 0.35);
      case 'mountain': return mix(env.tint(b.mid), env.base, 0.3);
      case 'desert': return mix(env.tint(b.mid), env.base, 0.28);
      case 'swamp': return mix(env.tint(b.near), env.tint(b.water), 0.35);
      case 'snow': return mix(env.tint(b.far), env.base, 0.25);
      case 'dirt': return mix(env.tint(b.mid), env.base, 0.35);
      default: return mix(env.tint(BIOMES.grass.near), env.base, 0.4);
    }
  }

  function drawBlobGround(ctx, blob, env, rng) {
    if (blob.biomeKey === 'water') {
      drawWaterGround(ctx, blob, env, rng, false);
      return;
    }
    if (blob.biomeKey === 'swamp') {
      drawWaterGround(ctx, blob, env, rng, true);
      return;
    }
    const base = groundColor(blob.biomeKey, env);
    closedSmoothPath(ctx, blob.pts);
    ctx.fillStyle = alpha(base, 0.5);
    ctx.fill();
    ctx.strokeStyle = alpha(darken(base, 0.3), 0.14);
    ctx.lineWidth = 2.4;
    ctx.stroke();
    for (let i = 0; i < 2; i++) {
      const m = makeBlob(
        blob.x + rng.range(-0.4, 0.4) * blob.rx,
        blob.y + rng.range(-0.4, 0.4) * blob.ry,
        blob.rx * rng.range(0.18, 0.38),
        blob.ry * rng.range(0.18, 0.38),
        rng.range(0, TAU),
        rng,
        8
      );
      closedSmoothPath(ctx, m.pts);
      ctx.fillStyle = alpha(darken(base, 0.16), 0.08);
      ctx.fill();
    }
  }

  function drawWaterGround(ctx, blob, env, rng, murky) {
    const b = BIOMES.swamp;
    const water = murky
      ? mix(env.tint(b.water), env.tint(b.near), 0.4)
      : env.tint(BIOMES.water.water);
    const bank = mix(water, env.base, 0.46);
    closedSmoothPath(ctx, blob.pts);
    ctx.fillStyle = alpha(bank, 0.48);
    ctx.fill();

    const rim = makeBlob(blob.x, blob.y + blob.ry * 0.04, blob.rx * 0.82, blob.ry * 0.78, blob.rotation, rng, 11);
    closedSmoothPath(ctx, rim.pts);
    ctx.fillStyle = alpha(darken(water, 0.42), 0.5);
    ctx.fill();

    const inner = makeBlob(blob.x, blob.y + blob.ry * 0.04, blob.rx * 0.7, blob.ry * 0.66, blob.rotation, rng, 11);
    const g = ctx.createLinearGradient(blob.x - blob.rx, blob.y - blob.ry, blob.x + blob.rx, blob.y + blob.ry);
    g.addColorStop(0, alpha(lighten(water, murky ? 0.12 : 0.26), 0.75));
    g.addColorStop(0.46, alpha(water, 0.78));
    g.addColorStop(1, alpha(darken(water, 0.22), 0.8));
    closedSmoothPath(ctx, inner.pts);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = alpha(darken(water, 0.3), 0.25);
    ctx.lineWidth = 1.2;
    ctx.stroke();

    if (murky) {
      softEllipse(ctx, blob.x, blob.y - blob.ry * 0.12, blob.rx * 0.7, blob.ry * 0.3, lighten(env.mist, 0.15), 0.1, 0.2);
    }
  }

  function drawBlobProps(ctx, blob, env, rng) {
    switch (blob.biomeKey) {
      case 'water': drawWaterProps(ctx, blob, env, rng); break;
      case 'forest': drawForestProps(ctx, blob, env, rng); break;
      case 'mountain': drawMountainProps(ctx, blob, env, rng); break;
      case 'desert': drawDesertProps(ctx, blob, env, rng); break;
      case 'swamp': drawSwampProps(ctx, blob, env, rng); break;
      case 'snow': drawSnowProps(ctx, blob, env, rng); break;
      case 'dirt': drawDirtProps(ctx, blob, env, rng); break;
      default: drawGrassProps(ctx, blob, env, rng); break;
    }
  }

  function drawWaterProps(ctx, blob, env, rng) {
    const water = env.tint(BIOMES.water.water);
    ctx.save();
    ctx.strokeStyle = alpha(lighten(water, 0.55), 0.42);
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    for (let i = 0; i < rng.int(2, 3); i++) {
      const gx = blob.x + rng.range(-0.5, 0.5) * blob.rx;
      const gy = blob.y + rng.range(-0.5, 0.2) * blob.ry;
      ctx.beginPath();
      ctx.moveTo(gx - rng.range(6, 14), gy);
      ctx.quadraticCurveTo(gx, gy - rng.range(2, 5), gx + rng.range(5, 12), gy);
      ctx.stroke();
    }
    ctx.restore();

    for (let i = 0; i < rng.int(1, 3); i++) {
      const a = rng.range(0, TAU);
      const r = rng.range(0.1, 0.55);
      const x = blob.x + Math.cos(a) * blob.rx * r;
      const y = blob.y + Math.sin(a) * blob.ry * r;
      ctx.fillStyle = alpha(mix(env.tint(BIOMES.grass.mid), env.mist, 0.15), 0.3);
      ctx.beginPath();
      ctx.ellipse(x, y, rng.range(3, 6), rng.range(1.5, 3), rng.range(0, TAU), 0, TAU);
      ctx.fill();
    }

    for (let i = 0; i < rng.int(3, 5); i++) {
      const a = rng.range(0, TAU);
      const x = blob.x + Math.cos(a) * blob.rx * rng.range(0.75, 0.95);
      const y = blob.y + Math.sin(a) * blob.ry * rng.range(0.68, 0.9);
      if (blocked(env, x, y, 12)) continue;
      drawReedClump(ctx, x, y, rng.int(3, 5), rng.range(8, 15), env, rng);
    }
  }

  function drawForestProps(ctx, blob, env, rng) {
    const count = rng.int(8, 18);
    const palette = [BIOMES.forest.near, BIOMES.forest.mid, BIOMES.forest.far];
    for (let i = 0; i < count; i++) {
      const a = rng.range(0, TAU);
      const r = Math.sqrt(rng.next()) * 0.8;
      const x = blob.x + Math.cos(a) * blob.rx * r;
      const y = blob.y + Math.sin(a) * blob.ry * r;
      const size = rng.range(12, 21) * blob.scale;
      if (blocked(env, x, y, 18) || blocked(env, x, y - size * 0.6, 8)) continue;
      const color = mix(env.tint(rng.pick(palette)), env.mist, 0.1 + rng.range(0, 0.08));
      if (rng.chance(0.32)) drawConifer(ctx, x, y, size, color, env, rng);
      else drawBroadleaf(ctx, x, y, size, color, env, rng);
    }
    for (let i = 0; i < rng.int(2, 4); i++) {
      const x = blob.x + rng.range(-0.5, 0.5) * blob.rx;
      const y = blob.y + rng.range(-0.35, 0.6) * blob.ry;
      if (blocked(env, x, y, 14)) continue;
      ctx.fillStyle = alpha(mix(env.tint(BIOMES.forest.near), env.mist, 0.2), 0.28);
      ctx.beginPath();
      ctx.ellipse(x, y, rng.range(4, 9), rng.range(2, 4), rng.range(0, TAU), 0, TAU);
      ctx.fill();
    }
  }

  function drawMountainProps(ctx, blob, env, rng) {
    const peaks = [];
    const num = rng.int(3, 5);
    for (let i = 0; i < num; i++) {
      const x = blob.x + rng.range(-0.55, 0.55) * blob.rx;
      const y = blob.y + rng.range(-0.3, 0.52) * blob.ry;
      if (blocked(env, x, y, 16)) continue;
      peaks.push({
        x,
        y,
        w: rng.range(20, 38) * blob.scale,
        h: rng.range(22, 48) * blob.scale,
      });
    }
    peaks.sort((a, b) => (a.y - a.h) - (b.y - b.h));
    for (const peak of peaks) drawPeak(ctx, peak, env, rng);
    for (let i = 0; i < rng.int(8, 14); i++) {
      const x = blob.x + rng.range(-0.75, 0.75) * blob.rx;
      const y = blob.y + rng.range(-0.1, 0.75) * blob.ry;
      if (blocked(env, x, y, 10)) continue;
      ctx.fillStyle = alpha(mix(env.tint(BIOMES.mountain.far), env.mist, 0.15), 0.35);
      ctx.beginPath();
      ctx.ellipse(x, y, rng.range(1.2, 3.2), rng.range(0.8, 2.2), rng.range(0, TAU), 0, TAU);
      ctx.fill();
    }
  }

  function drawPeak(ctx, peak, env, rng) {
    const gray = env.tint(BIOMES.mountain.mid);
    const light = env.tint(BIOMES.mountain.far);
    const dark = env.tint(BIOMES.mountain.near);
    const g = ctx.createLinearGradient(peak.x - peak.w, peak.y, peak.x + peak.w, peak.y - peak.h);
    g.addColorStop(0, alpha(mix(light, env.mist, 0.12), 0.72));
    g.addColorStop(0.55, alpha(mix(gray, env.mist, 0.14), 0.78));
    g.addColorStop(1, alpha(mix(dark, env.mist, 0.1), 0.78));
    ctx.beginPath();
    ctx.moveTo(peak.x - peak.w, peak.y);
    ctx.lineTo(peak.x - peak.w * 0.55, peak.y - peak.h * 0.34);
    ctx.lineTo(peak.x - peak.w * 0.22, peak.y - peak.h * 0.62);
    ctx.lineTo(peak.x + rng.range(-peak.w * 0.06, peak.w * 0.06), peak.y - peak.h);
    ctx.lineTo(peak.x + peak.w * 0.32, peak.y - peak.h * 0.55);
    ctx.lineTo(peak.x + peak.w * 0.7, peak.y - peak.h * 0.2);
    ctx.lineTo(peak.x + peak.w, peak.y);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = alpha(darken(dark, 0.2), 0.2);
    ctx.lineWidth = 1;
    ctx.stroke();

    const capH = peak.h * rng.range(0.2, 0.32);
    ctx.beginPath();
    ctx.moveTo(peak.x, peak.y - peak.h);
    ctx.lineTo(peak.x + peak.w * 0.2, peak.y - peak.h + capH);
    ctx.lineTo(peak.x + peak.w * 0.07, peak.y - peak.h + capH * 0.66);
    ctx.lineTo(peak.x - peak.w * 0.02, peak.y - peak.h + capH * 1.02);
    ctx.lineTo(peak.x - peak.w * 0.17, peak.y - peak.h + capH * 0.58);
    ctx.closePath();
    ctx.fillStyle = alpha(mix(lighten(BIOMES.snow.accent, 0.1), env.mist, 0.06), 0.72);
    ctx.fill();
  }

  function drawDesertProps(ctx, blob, env, rng) {
    const sand = env.tint(BIOMES.desert.mid);
    ctx.save();
    closedSmoothPath(ctx, blob.pts);
    ctx.clip();
    for (let i = 0; i < rng.int(2, 3); i++) {
      const y = blob.y + rng.range(-0.45, 0.42) * blob.ry;
      const x0 = blob.x - blob.rx * 1.05;
      const x1 = blob.x + blob.rx * 1.05;
      const lift = rng.range(14, 32);
      const mid = blob.x + rng.range(-0.25, 0.25) * blob.rx;
      const y1 = y + rng.range(-6, 10);
      ctx.beginPath();
      ctx.moveTo(x0, y + lift * 0.4);
      ctx.quadraticCurveTo(mid, y - lift, x1, y1);
      ctx.quadraticCurveTo(mid, y - lift + rng.range(8, 16), x0, y + lift * 0.4 + rng.range(4, 8));
      ctx.closePath();
      ctx.fillStyle = alpha(lighten(sand, 0.18), 0.3);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x0, y + lift * 0.4);
      ctx.quadraticCurveTo(mid, y - lift, x1, y1);
      ctx.strokeStyle = alpha(darken(sand, 0.15), 0.22);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();

    if (rng.chance(0.62)) drawMesa(ctx, blob, env, rng);
    for (let i = 0; i < rng.int(1, 3); i++) {
      const x = blob.x + rng.range(-0.55, 0.55) * blob.rx;
      const y = blob.y + rng.range(-0.15, 0.55) * blob.ry;
      if (blocked(env, x, y, 14)) continue;
      drawCactus(
        ctx,
        x,
        y,
        rng.range(12, 22) * blob.scale,
        mix(env.tint(BIOMES.grass.near), env.mist, 0.18),
        env,
        rng
      );
    }
    for (let i = 0; i < rng.int(2, 4); i++) {
      const x = blob.x + rng.range(-0.6, 0.6) * blob.rx;
      const y = blob.y + rng.range(-0.2, 0.6) * blob.ry;
      if (blocked(env, x, y, 10)) continue;
      drawBoulder(ctx, x, y, rng.range(2.5, 6) * blob.scale, mix(env.tint(BIOMES.desert.near), env.mist, 0.15), env, rng);
    }
  }

  function drawMesa(ctx, blob, env, rng) {
    const mx = blob.x + rng.range(-0.4, 0.4) * blob.rx;
    const my = blob.y + rng.range(-0.15, 0.45) * blob.ry;
    if (blocked(env, mx, my, 16)) return;
    const mw = rng.range(16, 30) * blob.scale;
    const mh = rng.range(12, 24) * blob.scale;
    const col = mix(env.tint(BIOMES.desert.near), env.tint(BIOMES.mountain.mid), 0.35);
    ctx.beginPath();
    ctx.moveTo(mx - mw, my);
    ctx.lineTo(mx - mw * 0.72, my - mh);
    ctx.lineTo(mx + mw * 0.62, my - mh);
    ctx.lineTo(mx + mw, my);
    ctx.closePath();
    ctx.fillStyle = alpha(mix(col, env.mist, 0.15), 0.68);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(mx - mw * 0.72, my - mh);
    ctx.lineTo(mx - mw * 0.5, my - mh - mh * 0.18);
    ctx.lineTo(mx + mw * 0.7, my - mh - mh * 0.18);
    ctx.lineTo(mx + mw * 0.62, my - mh);
    ctx.closePath();
    ctx.fillStyle = alpha(mix(lighten(col, 0.18), env.mist, 0.1), 0.55);
    ctx.fill();
    ctx.strokeStyle = alpha(darken(col, 0.25), 0.18);
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const x = mx + (i - 1) * mw * 0.4;
      ctx.beginPath();
      ctx.moveTo(x, my - mh + 2);
      ctx.lineTo(x + rng.range(-2, 2), my);
      ctx.stroke();
    }
  }

  function drawSwampProps(ctx, blob, env, rng) {
    const pool = env.tint(BIOMES.swamp.water);
    ctx.save();
    ctx.strokeStyle = alpha(lighten(pool, 0.35), 0.3);
    ctx.lineWidth = 1.1;
    for (let i = 0; i < 2; i++) {
      const gx = blob.x + rng.range(-0.4, 0.4) * blob.rx;
      const gy = blob.y + rng.range(-0.4, 0.1) * blob.ry;
      ctx.beginPath();
      ctx.moveTo(gx - rng.range(4, 10), gy);
      ctx.quadraticCurveTo(gx, gy - 2, gx + rng.range(4, 9), gy);
      ctx.stroke();
    }
    ctx.restore();

    for (let i = 0; i < rng.int(2, 4); i++) {
      const x = blob.x + rng.range(-0.5, 0.5) * blob.rx;
      const y = blob.y + rng.range(-0.1, 0.55) * blob.ry;
      if (blocked(env, x, y, 16)) continue;
      const th = rng.range(16, 32) * blob.scale;
      const lean = rng.range(-10, 10);
      ctx.strokeStyle = alpha(mix(env.tint(BIOMES.swamp.ink), '#2f2b24', 0.3), 0.6);
      ctx.lineWidth = rng.range(1.5, 2.8);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + lean * 0.3, y - th * 0.35, x + lean * 0.7, y - th * 0.6, x + lean, y - th);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + lean * 0.45, y - th * 0.5);
      ctx.quadraticCurveTo(
        x + lean * 0.45 + rng.range(4, 10),
        y - th * 0.66,
        x + lean * 0.45 + rng.range(6, 12),
        y - th * rng.range(0.6, 0.8)
      );
      ctx.stroke();
    }

    for (let i = 0; i < rng.int(2, 3); i++) {
      const a = rng.range(0, TAU);
      const x = blob.x + Math.cos(a) * blob.rx * rng.range(0.6, 0.9);
      const y = blob.y + Math.sin(a) * blob.ry * rng.range(0.55, 0.85);
      if (blocked(env, x, y, 12)) continue;
      drawReedClump(ctx, x, y, rng.int(4, 6), rng.range(10, 17), env, rng);
    }

    for (let i = 0; i < rng.int(1, 3); i++) {
      const a = rng.range(0, TAU);
      const x = blob.x + Math.cos(a) * blob.rx * rng.range(0.1, 0.5);
      const y = blob.y + Math.sin(a) * blob.ry * rng.range(0.1, 0.5);
      ctx.fillStyle = alpha(mix(env.tint(BIOMES.swamp.mid), env.mist, 0.2), 0.25);
      ctx.beginPath();
      ctx.ellipse(x, y, rng.range(3, 7), rng.range(1.5, 3), rng.range(0, TAU), 0, TAU);
      ctx.fill();
    }
  }

  function drawSnowProps(ctx, blob, env, rng) {
    const snow = env.tint(BIOMES.snow.accent);
    for (let i = 0; i < rng.int(2, 4); i++) {
      const patch = makeBlob(
        blob.x + rng.range(-0.4, 0.4) * blob.rx,
        blob.y + rng.range(-0.4, 0.4) * blob.ry,
        blob.rx * rng.range(0.2, 0.45),
        blob.ry * rng.range(0.18, 0.4),
        rng.range(0, TAU),
        rng,
        9
      );
      closedSmoothPath(ctx, patch.pts);
      ctx.fillStyle = alpha(mix(snow, env.mist, 0.08), 0.5);
      ctx.fill();
    }
    for (let i = 0; i < rng.int(3, 6); i++) {
      const x = blob.x + rng.range(-0.55, 0.55) * blob.rx;
      const y = blob.y + rng.range(-0.2, 0.55) * blob.ry;
      const size = rng.range(9, 16) * blob.scale;
      if (blocked(env, x, y, 16) || blocked(env, x, y - size * 0.6, 8)) continue;
      drawConifer(
        ctx,
        x,
        y,
        size,
        mix(env.tint(BIOMES.forest.near), env.tint(BIOMES.snow.near), 0.35),
        env,
        rng
      );
    }
    for (let i = 0; i < rng.int(2, 4); i++) {
      const x = blob.x + rng.range(-0.6, 0.6) * blob.rx;
      const y = blob.y + rng.range(-0.2, 0.6) * blob.ry;
      if (blocked(env, x, y, 10)) continue;
      drawBoulder(ctx, x, y, rng.range(3, 6) * blob.scale, mix(env.tint(BIOMES.snow.far), env.mist, 0.1), env, rng);
    }
  }

  function drawGrassProps(ctx, blob, env, rng) {
    const ground = env.tint(BIOMES.grass.mid);
    for (let i = 0; i < rng.int(6, 11); i++) {
      const x = blob.x + rng.range(-0.55, 0.55) * blob.rx;
      const y = blob.y + rng.range(-0.2, 0.6) * blob.ry;
      if (blocked(env, x, y, 12)) continue;
      drawTuft(ctx, x, y, rng.range(4, 9) * blob.scale, ground, env, rng);
    }
    for (let i = 0; i < rng.int(3, 6); i++) {
      const x = blob.x + rng.range(-0.5, 0.5) * blob.rx;
      const y = blob.y + rng.range(-0.1, 0.55) * blob.ry;
      if (blocked(env, x, y, 10)) continue;
      drawFlower(
        ctx,
        x,
        y,
        rng.range(1, 2.2),
        rng.pick([BIOMES.grass.accent, BIOMES.desert.accent, BIOMES.water.accent]),
        env
      );
    }
    for (let i = 0; i < rng.int(1, 3); i++) {
      const x = blob.x + rng.range(-0.5, 0.5) * blob.rx;
      const y = blob.y + rng.range(-0.1, 0.55) * blob.ry;
      if (blocked(env, x, y, 12)) continue;
      drawBoulder(ctx, x, y, rng.range(3, 6.5) * blob.scale, mix(env.tint(BIOMES.mountain.far), env.mist, 0.18), env, rng);
    }
    if (rng.chance(0.6)) {
      const hx = blob.x + rng.range(-0.35, 0.35) * blob.rx;
      const hy = blob.y + rng.range(-0.05, 0.4) * blob.ry;
      if (!blocked(env, hx, hy, 16)) {
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = alpha(mix(env.tint(BIOMES.forest.near), env.mist, 0.15), 0.35);
          ctx.beginPath();
          ctx.ellipse(hx + (i - 1) * 5, hy - rng.range(0, 2), rng.range(5, 8), rng.range(2.5, 4), 0, 0, TAU);
          ctx.fill();
        }
      }
    }
  }

  function drawDirtProps(ctx, blob, env, rng) {
    const dirt = env.tint(BIOMES.dirt.mid);
    for (let i = 0; i < rng.int(4, 8); i++) {
      const x = blob.x + rng.range(-0.55, 0.55) * blob.rx;
      const y = blob.y + rng.range(-0.2, 0.6) * blob.ry;
      if (blocked(env, x, y, 12)) continue;
      drawTuft(ctx, x, y, rng.range(3, 7) * blob.scale, mix(dirt, env.tint(BIOMES.grass.near), 0.35), env, rng);
    }
    for (let i = 0; i < rng.int(2, 5); i++) {
      const x = blob.x + rng.range(-0.55, 0.55) * blob.rx;
      const y = blob.y + rng.range(-0.2, 0.6) * blob.ry;
      if (blocked(env, x, y, 10)) continue;
      drawBoulder(ctx, x, y, rng.range(3.5, 8) * blob.scale, mix(env.tint(BIOMES.mountain.far), dirt, 0.35), env, rng);
    }
    ctx.save();
    ctx.strokeStyle = alpha(darken(dirt, 0.3), 0.18);
    ctx.lineWidth = 1;
    for (let i = 0; i < rng.int(2, 4); i++) {
      const x = blob.x + rng.range(-0.4, 0.4) * blob.rx;
      const y = blob.y + rng.range(-0.2, 0.4) * blob.ry;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rng.range(-8, 8), y + rng.range(2, 7));
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRim(ctx, outline, env) {
    const inset = outline.map((p) => ({
      x: env.plate.cx + (p.x - env.plate.cx) * 0.972,
      y: env.plate.cy + (p.y - env.plate.cy) * 0.972,
    }));
    closedSmoothPath(ctx, inset);
    ctx.strokeStyle = alpha(lighten(env.sky, 0.45), 0.24);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = alpha(lighten(env.base, 0.5), 0.12);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawEdgeWisps(ctx, env, rng) {
    const p = env.plate;
    for (let i = 0; i < rng.int(4, 6); i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = p.cx + side * p.rx * rng.range(0.85, 1.15);
      const y = p.cy + Math.sin(rng.range(0, TAU)) * p.ry * rng.range(0.4, 0.9);
      softEllipse(ctx, x, y, rng.range(60, 130), rng.range(18, 42), env.mist, rng.range(0.1, 0.18), 0.2);
    }
  }

  function drawFloatingRocks(ctx, env, rng) {
    const count = rng.int(2, 3);
    for (let i = 0; i < count; i++) {
      const left = i % 2 === 0;
      const x = left ? rng.range(50, 120) : rng.range(1160, 1230);
      const y = rng.range(430, 650);
      drawFloatingRock(ctx, x, y, rng.range(11, 22), env, rng);
    }
    for (let i = 0; i < rng.int(2, 3); i++) {
      const left = i % 2 === 0;
      const x = left ? rng.range(40, 180) : rng.range(1100, 1240);
      const y = rng.range(320, 560);
      softEllipse(ctx, x, y, rng.range(80, 160), rng.range(20, 44), lighten(env.mist, 0.12), 0.16, 0.2);
    }
  }

  function drawFloatingRock(ctx, x, y, s, env, rng) {
    softEllipse(ctx, x, y + s * 0.55, s * 1.2, s * 0.4, env.ink, 0.12);
    const under = makeBlob(x, y + s * 0.45, s * 0.72, s * 0.68, rng.range(0, TAU), rng, 7);
    closedSmoothPath(ctx, under.pts);
    ctx.fillStyle = alpha(darken(env.base, 0.55), 0.85);
    ctx.fill();
    const top = makeBlob(x, y, s, s * 0.4, rng.range(0, TAU), rng, 8);
    closedSmoothPath(ctx, top.pts);
    ctx.fillStyle = alpha(mix(env.base, env.mist, 0.12), 0.85);
    ctx.fill();
    ctx.strokeStyle = alpha(lighten(env.sky, 0.4), 0.2);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = alpha(mix(env.tint(BIOMES.grass.mid), env.mist, 0.15), 0.4);
    ctx.beginPath();
    ctx.ellipse(x - s * 0.1, y - s * 0.12, s * 0.6, s * 0.2, rng.range(0, TAU), 0, TAU);
    ctx.fill();
  }

  function drawBottomHaze(ctx, W, H, env, rng) {
    const g = ctx.createLinearGradient(0, H * 0.78, 0, H);
    g.addColorStop(0, alpha(env.mist, 0));
    g.addColorStop(1, alpha(env.mist, 0.18));
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.78, W, H * 0.22);
    for (let i = 0; i < rng.int(2, 3); i++) {
      const x = rng.range(0, W);
      const y = rng.range(H * 0.8, H * 0.96);
      softEllipse(ctx, x, y, rng.range(120, 260), rng.range(20, 50), lighten(env.mist, 0.08), 0.14, 0.2);
    }
  }
})();
