(function () {
  'use strict';

  const Core = window.CityBackdropCore;
  const W = Core.W;
  const H = Core.H;
  const BIOMES = Core.BIOMES;
  const clamp = Core.clamp;
  const lerp = Core.lerp;
  const mix = Core.mix;
  const lighten = Core.lighten;
  const darken = Core.darken;
  const alpha = Core.alpha;
  const weightedBiomes = Core.weightedBiomes;
  const blendBiomeColor = Core.blendBiomeColor;
  const wash = Core.wash;

  const registry = window.CityBackdropOptions = window.CityBackdropOptions || {};

  function channelHex(n) {
    return Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  }

  function shiftHue(hex, degrees) {
    const h = String(hex).replace('#', '').trim();
    const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
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

  function setBlur(ctx, px) {
    if ('filter' in ctx) ctx.filter = 'blur(' + Math.max(0, px) + 'px)';
  }

  function clearBlur(ctx) {
    if ('filter' in ctx) ctx.filter = 'none';
  }

  function familyFor(biome) {
    if (biome === 'forest') return 'forest';
    if (biome === 'mountain' || biome === 'snow') return 'mountain';
    if (biome === 'water') return 'water';
    if (biome === 'desert') return 'desert';
    if (biome === 'swamp') return 'swamp';
    return 'grass';
  }

  function buildPalette(scenario, rng) {
    const center = BIOMES[scenario.center] || BIOMES.grass;
    const hue = rng.range(-5, 5);
    function tone(key) {
      const centerColor = center[key] || center.mid;
      return shiftHue(mix(centerColor, blendBiomeColor(scenario, key), 0.2), hue);
    }
    const sky = tone('sky');
    const far = tone('far');
    const mid = tone('mid');
    const near = tone('near');
    const accent = tone('accent');
    const water = tone('water');
    const ink = shiftHue(mix(center.ink, blendBiomeColor(scenario, 'ink'), 0.2), hue * 0.5);
    const horizon = lighten(mix(sky, accent, 0.22), 0.16);
    const paper = mix(lighten(accent, 0.55), '#f6f1e4', 0.6);
    return { sky, far, mid, near, accent, water, ink, horizon, paper, hue };
  }

  function familyPalette(family, p) {
    if (family === 'forest') {
      return { main: p.mid, light: lighten(p.mid, 0.22), dark: darken(p.mid, 0.2), accent: p.accent, ink: p.ink };
    }
    if (family === 'mountain') {
      return {
        main: mix(p.mid, p.far, 0.3),
        light: lighten(p.far, 0.24),
        dark: darken(p.mid, 0.16),
        accent: mix(lighten(p.accent, 0.45), '#ffffff', 0.4),
        ink: p.ink,
      };
    }
    if (family === 'water') {
      return { main: p.water, light: lighten(p.water, 0.3), dark: darken(p.water, 0.14), accent: lighten(p.water, 0.55), ink: p.ink };
    }
    if (family === 'desert') {
      return {
        main: mix(p.mid, p.accent, 0.32),
        light: lighten(p.accent, 0.06),
        dark: darken(p.mid, 0.14),
        accent: lighten(p.accent, 0.25),
        ink: p.ink,
      };
    }
    if (family === 'swamp') {
      return { main: mix(p.near, p.water, 0.2), light: lighten(p.mid, 0.12), dark: darken(p.near, 0.2), accent: p.accent, ink: p.ink };
    }
    return { main: p.near, light: lighten(p.near, 0.22), dark: darken(p.near, 0.16), accent: p.accent, ink: p.ink };
  }

  function softBlob(ctx, x, y, rx, ry, color, strength, blur) {
    wash(ctx, function (c) {
      c.beginPath();
      c.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
    }, { color, alpha: strength, blur: blur === undefined ? 4 : blur, passes: 1 });
  }

  function dab(ctx, x, y, rx, ry, rot, color, strength, blur) {
    ctx.save();
    if (blur) setBlur(ctx, blur);
    ctx.translate(x, y);
    ctx.rotate(rot || 0);
    ctx.globalAlpha = strength;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.max(0.4, rx), Math.max(0.4, ry), 0, 0, Math.PI * 2);
    ctx.fill();
    clearBlur(ctx);
    ctx.restore();
  }

  function softPoly(ctx, points, color, strength, blur, passes) {
    wash(ctx, function (c) {
      c.beginPath();
      c.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) c.lineTo(points[i][0], points[i][1]);
      c.closePath();
    }, { color, alpha: strength, blur: blur === undefined ? 2 : blur, passes: passes === undefined ? 1 : passes });
  }

  function softStroke(ctx, draw, color, width, strength, blur) {
    ctx.save();
    if (blur) setBlur(ctx, blur);
    ctx.globalAlpha = strength;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    draw(ctx);
    ctx.stroke();
    clearBlur(ctx);
    ctx.restore();
  }

  function traceSmoothLine(ctx, points) {
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i === 0 ? 0 : i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2 < points.length ? i + 2 : points.length - 1];
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
    }
  }

  function traceSmooth(ctx, points, bottomY) {
    ctx.beginPath();
    traceSmoothLine(ctx, points);
    if (bottomY !== undefined) {
      ctx.lineTo(points[points.length - 1].x, bottomY);
      ctx.lineTo(points[0].x, bottomY);
      ctx.closePath();
    }
  }

  function strokeSmooth(ctx, points, color, width, strength, blur) {
    softStroke(ctx, function (c) {
      traceSmoothLine(c, points);
    }, color, width, strength, blur);
  }

  function paintSky(ctx, p, rng) {
    const top = mix(lighten(p.sky, 0.66), '#fbfcf8', 0.4);
    const upper = lighten(p.sky, 0.42);
    const low = mix(lighten(p.sky, 0.18), p.horizon, 0.3);
    const gradient = ctx.createLinearGradient(0, 0, 0, H * 0.62);
    gradient.addColorStop(0, top);
    gradient.addColorStop(0.46, upper);
    gradient.addColorStop(1, low);
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    const warm = ctx.createLinearGradient(0, H * 0.4, 0, H * 0.58);
    warm.addColorStop(0, alpha(lighten(p.horizon, 0.35), 0));
    warm.addColorStop(0.54, alpha(lighten(p.horizon, 0.38), 0.14));
    warm.addColorStop(1, alpha(lighten(p.horizon, 0.32), 0));
    ctx.save();
    ctx.fillStyle = warm;
    ctx.fillRect(0, H * 0.4, W, H * 0.18);
    ctx.restore();

    if (rng.chance(0.5)) {
      softBlob(ctx, rng.range(0.1, 0.9) * W, rng.range(0.08, 0.24) * H, rng.range(0.16, 0.3) * W, rng.range(0.02, 0.05) * H, mix(p.paper, '#ffffff', 0.4), 0.06, 44);
    }
  }

  function paintSun(ctx, p, rng) {
    const x = W * rng.range(0.68, 0.8);
    const y = H * rng.range(0.26, 0.34);
    const radius = Math.min(W, H) * rng.range(0.2, 0.27);
    const warm = mix(p.accent, '#fff3da', 0.55);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, alpha(lighten(warm, 0.4), 0.36));
    gradient.addColorStop(0.2, alpha(warm, 0.19));
    gradient.addColorStop(0.55, alpha(mix(warm, p.horizon, 0.45), 0.07));
    gradient.addColorStop(1, alpha(warm, 0));
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = lighten(warm, 0.65);
    ctx.beginPath();
    ctx.arc(x, y, rng.range(9, 14), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return { x, y };
  }

  function paintCloudBand(ctx, x, y, width, height, lean, color, strength) {
    wash(ctx, function (c) {
      c.beginPath();
      c.ellipse(x, y, width, height, 0, 0, Math.PI * 2);
      c.ellipse(x + lean, y + height * 0.4, width * 0.6, height * 1.5, 0, 0, Math.PI * 2);
      c.ellipse(x - width * 0.15, y - height * 0.55, width * 0.42, height * 0.9, 0, 0, Math.PI * 2);
    }, { color, alpha: strength, blur: Math.min(38, 20 + height * 0.5), passes: 1 });
  }

  function paintClouds(ctx, p, rng) {
    const count = rng.int(2, 3);
    for (let i = 0; i < count; i++) {
      const x = rng.range(-0.08, 1.02) * W;
      const y = rng.range(0.1, 0.34) * H;
      const width = rng.range(0.2, 0.36) * W;
      const height = rng.range(0.012, 0.028) * H;
      const lean = rng.range(-0.3, 0.3) * width;
      const light = mix('#ffffff', p.accent, rng.range(0.05, 0.18));
      paintCloudBand(ctx, x, y, width, height, lean, light, rng.range(0.08, 0.15));
      if (rng.chance(0.62)) {
        paintCloudBand(
          ctx,
          x + rng.range(-0.08, 0.08) * W,
          y + height * rng.range(1.4, 2.2),
          width * rng.range(0.55, 0.75),
          height * rng.range(0.55, 0.8),
          lean * 0.5,
          mix(p.horizon, '#d9dde0', 0.35),
          rng.range(0.04, 0.075)
        );
      }
    }
  }

  function farStyle(center) {
    if (center === 'mountain' || center === 'snow') {
      return { base: 0.555, range: [0.2, 0.27], spread: [0.15, 0.22], profile: 'peak', snow: true };
    }
    if (center === 'desert') {
      return { base: 0.55, range: [0.085, 0.125], spread: [0.22, 0.32], profile: 'mesa', snow: false };
    }
    if (center === 'water') {
      return { base: 0.548, range: [0.05, 0.08], spread: [0.24, 0.34], profile: 'rolling', snow: false };
    }
    if (center === 'forest') {
      return { base: 0.552, range: [0.07, 0.105], spread: [0.22, 0.31], profile: 'forest', snow: false };
    }
    if (center === 'swamp') {
      return { base: 0.552, range: [0.055, 0.085], spread: [0.24, 0.33], profile: 'rolling', snow: false };
    }
    return { base: 0.552, range: [0.075, 0.115], spread: [0.22, 0.31], profile: 'rolling', snow: false };
  }

  function makeFarPoints(style, rng) {
    const count = rng.int(6, 8);
    const baseY = H * style.base + rng.range(-6, 6);
    const crest = rng.range(0.60, 0.72);
    const spread = rng.range(style.spread[0], style.spread[1]);
    const amplitude = H * rng.range(style.range[0], style.range[1]) * 1.18;
    const xs = [-0.06];
    for (let i = 1; i < count - 1; i++) {
      xs.push((i + rng.range(-0.22, 0.22)) / (count - 1));
    }
    xs.push(1.06);
    xs.sort(function (a, b) { return a - b; });
    const points = [];
    for (let i = 0; i < xs.length; i++) {
      const f = xs[i];
      const envelope = Math.exp(-Math.pow((f - crest) / spread, 2));
      let height = amplitude * envelope * rng.range(0.55, 1);
      if (i === 0 || i === xs.length - 1) height *= 0.2;
      if (style.profile === 'mesa') {
        height = Math.round(height / (amplitude * 0.24)) * (amplitude * 0.24);
      }
      if (style.profile === 'peak' && i > 0 && i < xs.length - 1 && rng.chance(0.35)) {
        height *= 1.12;
      }
      points.push({ x: f * W, y: baseY - height, baseY });
    }
    return { points, baseY, amplitude };
  }

  function paintFarMass(ctx, p, scenario, rng) {
    const style = farStyle(scenario.center);
    const ridge = makeFarPoints(style, rng);
    const baseColor = mix(lighten(p.far, 0.02), p.horizon, 0.10);
    const lightColor = lighten(mix(p.far, p.accent, 0.18), 0.3);
    const shadowColor = darken(mix(p.far, p.mid, 0.4), 0.12);
    const bottomY = H * 0.72;

    const backPoints = ridge.points.map(pt => ({ x: pt.x, y: pt.baseY - (pt.baseY - pt.y) * 0.72 - H * 0.02, baseY: pt.baseY }));
    wash(ctx, function (c) {
      traceSmooth(c, backPoints, H * 0.68);
    }, { color: mix(lighten(p.far, 0.28), p.horizon, 0.35), alpha: 0.35, blur: 7, passes: 2 });

    wash(ctx, function (c) {
      traceSmooth(c, ridge.points, bottomY);
    }, { color: baseColor, alpha: 0.72, blur: 4, passes: 2, dy: 2 });

    const sorted = ridge.points.slice(1, -1).slice().sort(function (a, b) { return a.y - b.y; });
    const peak = sorted[0] || ridge.points[Math.floor(ridge.points.length / 2)];

    ctx.save();
    ctx.beginPath();
    traceSmooth(ctx, ridge.points, bottomY);
    ctx.clip();
    softBlob(ctx, peak.x - W * 0.04, peak.y + H * 0.06, W * 0.22, H * 0.07, lightColor, 0.30, 18);
    softBlob(ctx, peak.x + W * 0.08, peak.y + H * 0.1, W * 0.18, H * 0.09, shadowColor, 0.22, 20);
    if (style.profile === 'mesa') {
      softBlob(ctx, peak.x + W * 0.02, ridge.baseY - H * 0.045, W * 0.26, H * 0.02, lighten(lightColor, 0.1), 0.14, 12);
    }
    if (style.profile === 'forest' || scenario.center === 'swamp') {
      const clumps = rng.int(4, 6);
      for (let i = 0; i < clumps; i++) {
        const index = 1 + ((i * 2) % Math.max(1, ridge.points.length - 2));
        const pt = ridge.points[index];
        softBlob(ctx, pt.x + rng.range(-10, 10), pt.y + rng.range(4, 12), rng.range(13, 22), rng.range(5, 9), shadowColor, 0.16, 7);
      }
    }
    if (style.snow) {
      const candidates = ridge.points.slice(1, -1).filter(function (pt) {
        return pt.y < ridge.baseY - ridge.amplitude * 0.5;
      }).sort(function (a, b) { return a.y - b.y; });
      const capCount = Math.min(candidates.length, rng.int(2, 4));
      for (let i = 0; i < capCount; i++) {
        const cap = candidates[i];
        const capW = rng.range(0.018, 0.038) * W;
        const capD = rng.range(0.024, 0.05) * H;
        softPoly(ctx, [
          [cap.x, cap.y + 2],
          [cap.x - capW * 0.55, cap.y + capD * 0.7],
          [cap.x - capW * 0.22, cap.y + capD * 0.55],
          [cap.x + capW * 0.02, cap.y + capD * 0.98],
          [cap.x + capW * 0.3, cap.y + capD * 0.5],
          [cap.x + capW * 0.58, cap.y + capD * 0.75],
        ], mix(lighten(p.accent, 0.4), '#ffffff', 0.35), 0.5, 1.6, 1);
      }
    }
    ctx.restore();

    strokeSmooth(ctx, ridge.points, mix(shadowColor, p.ink, 0.2), 1.5, 0.28, 1.4);
    return ridge;
  }

  function paintHorizonHaze(ctx, p, rng) {
    const color = lighten(p.horizon, 0.22);
    const y0 = H * rng.range(0.44, 0.47);
    const y1 = H * rng.range(0.56, 0.59);
    const gradient = ctx.createLinearGradient(0, y0, 0, y1);
    gradient.addColorStop(0, alpha(color, 0));
    gradient.addColorStop(0.5, alpha(color, 0.07));
    gradient.addColorStop(1, alpha(color, 0));
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, y0, W, y1 - y0);
    ctx.restore();
    softBlob(ctx, W * rng.range(0.35, 0.65), H * 0.535, W * 0.55, H * 0.018, color, 0.06, 16);
  }

  function paintGround(ctx, p, rng, sun) {
    const meadow = mix(mix(p.mid, p.near, 0.55), p.horizon, 0.08);
    const y = H * 0.55;
    wash(ctx, function (c) {
      c.beginPath();
      c.moveTo(-60, y);
      c.bezierCurveTo(W * 0.22, y - 14, W * 0.4, y + 8, W * 0.55, y - 2);
      c.bezierCurveTo(W * 0.72, y - 12, W * 0.86, y + 10, W + 60, y - 4);
      c.lineTo(W + 60, H + 60);
      c.lineTo(-60, H + 60);
      c.closePath();
    }, { color: meadow, alpha: 0.36, blur: 14, passes: 2 });

    wash(ctx, function (c) {
      c.beginPath();
      c.moveTo(-60, H * 0.66);
      c.bezierCurveTo(W * 0.25, H * 0.65, W * 0.5, H * 0.69, W * 0.7, H * 0.67);
      c.bezierCurveTo(W * 0.86, H * 0.65, W + 60, H * 0.68, W + 60, H * 0.68);
      c.lineTo(W + 60, H + 60);
      c.lineTo(-60, H + 60);
      c.closePath();
    }, { color: mix(p.near, p.mid, 0.35), alpha: 0.26, blur: 18, passes: 1 });

    wash(ctx, function (c) {
      c.beginPath();
      c.moveTo(-60, H * 0.70);
      c.bezierCurveTo(W * 0.3, H * 0.67, W * 0.65, H * 0.73, W + 60, H * 0.69);
      c.lineTo(W + 60, H + 60);
      c.lineTo(-60, H + 60);
      c.closePath();
    }, { color: darken(p.near, 0.18), alpha: 0.22, blur: 22, passes: 1 });

    softBlob(ctx, sun.x, H * 0.585, W * 0.09, H * 0.022, lighten(mix(p.accent, '#fff4dc', 0.5), 0.2), 0.07, 22);
    if (rng.chance(0.6)) {
      softBlob(ctx, W * 0.84, H * 0.685, W * 0.16, H * 0.06, lighten(p.near, 0.3), 0.1, 26);
    }
  }

  function paintLake(ctx, p, rng, strength) {
    const y = H * rng.range(0.56, 0.585);
    const color = mix(p.water, p.horizon, 0.25);
    wash(ctx, function (c) {
      c.beginPath();
      c.moveTo(-40, y + rng.range(-6, 6));
      c.bezierCurveTo(W * 0.2, y - 8, W * 0.34, y + 6, W * 0.5, y - 2);
      c.bezierCurveTo(W * 0.66, y - 8, W * 0.82, y + 8, W + 40, y - 4);
      c.lineTo(W + 40, y + 34);
      c.lineTo(-40, y + 34);
      c.closePath();
    }, { color, alpha: strength, blur: 9, passes: 2, dy: 2 });

    wash(ctx, function (c) {
      c.beginPath();
      c.ellipse(W * rng.range(0.2, 0.8), y + rng.range(8, 18), W * 0.3, 4, 0, 0, Math.PI * 2);
    }, { color: lighten(p.water, 0.35), alpha: strength * 0.45, blur: 6, passes: 1 });

    const glints = rng.int(4, 7);
    for (let i = 0; i < glints; i++) {
      dab(
        ctx,
        rng.range(0.02, 0.98) * W,
        y + rng.range(2, 24),
        rng.range(8, 26),
        rng.range(0.8, 2),
        0,
        lighten(p.water, 0.55),
        rng.range(0.14, 0.26),
        1
      );
    }
  }

  function stampDeciduous(ctx, rng, p) {
    dab(ctx, 0, 0, 26, 5, 0, p.dark, 0.12, 5);
    softStroke(ctx, function (c) {
      c.moveTo(0, 0);
      c.quadraticCurveTo(-3, -14, -2, -30);
    }, mix(p.ink, p.dark, 0.35), 3, 0.5, 0.6);
    softBlob(ctx, -2, -42, 21, 17, p.main, 0.4, 4);
    softBlob(ctx, 12, -35, 13, 12, p.main, 0.28, 4);
    softBlob(ctx, -11, -47, 12, 10, p.light, 0.26, 4);
    softBlob(ctx, 3, -31, 14, 7, p.dark, 0.16, 5);
    for (let i = 0; i < 3; i++) {
      dab(ctx, rng.range(-20, 18), rng.range(-52, -34), rng.range(2.4, 4.2), rng.range(1.6, 2.8), 0, p.dark, 0.14, 1.6);
    }
  }

  function stampConifer(ctx, rng, p) {
    dab(ctx, 0, 0, 22, 4.5, 0, p.dark, 0.12, 5);
    softStroke(ctx, function (c) {
      c.moveTo(0, 0);
      c.lineTo(0, -16);
    }, p.ink, 2.4, 0.45, 0.5);
    const layers = [
      { y: -12, w: 22, h: 24 },
      { y: -30, w: 17, h: 22 },
      { y: -45, w: 12, h: 19 },
    ];
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      softPoly(ctx, [[0, layer.y - layer.h], [-layer.w, layer.y], [layer.w, layer.y]], i === 0 ? p.dark : p.main, 0.32, 2.2, 1);
      softPoly(ctx, [[0, layer.y - layer.h + 3], [-layer.w * 0.55, layer.y - 1], [layer.w * 0.2, layer.y - 1]], p.light, 0.14, 2.2, 1);
    }
  }

  function stampHedge(ctx, rng, p) {
    dab(ctx, 0, 0, 30, 4, 0, p.dark, 0.12, 5);
    softBlob(ctx, -14, -9, 15, 9, p.dark, 0.3, 4);
    softBlob(ctx, 8, -10, 17, 10, p.main, 0.34, 4);
    softBlob(ctx, -2, -14, 13, 7, p.main, 0.24, 4);
    softBlob(ctx, -6, -17, 10, 5, p.light, 0.2, 4);
    for (let i = 0; i < 4; i++) {
      dab(ctx, rng.range(-22, 22), rng.range(-15, -7), 2.2, 1.5, 0, p.dark, 0.14, 1);
    }
  }

  function stampRidgeMini(ctx, rng, p) {
    const w = rng.range(30, 42);
    const h = rng.range(30, 46);
    softPoly(ctx, [
      [-w, 0],
      [-w * 0.55, -h * 0.55],
      [-w * 0.22, -h * 0.72],
      [0, -h],
      [w * 0.34, -h * 0.6],
      [w * 0.62, -h * 0.4],
      [w, 0],
    ], p.main, 0.36, 3, 2);
    softPoly(ctx, [
      [-w, 0],
      [-w * 0.5, -h * 0.5],
      [-w * 0.18, -h * 0.66],
      [0, -h * 0.55],
      [w * 0.2, 0],
    ], p.light, 0.16, 3, 1);
    softPoly(ctx, [
      [w * 0.1, 0],
      [w * 0.3, -h * 0.5],
      [w * 0.55, -h * 0.35],
      [w, 0],
    ], p.dark, 0.14, 3, 1);
  }

  function stampSnowCap(ctx, rng, p) {
    const h = rng.range(34, 48);
    softPoly(ctx, [
      [-24, 0],
      [-10, -h * 0.55],
      [0, -h],
      [13, -h * 0.62],
      [26, 0],
    ], p.main, 0.38, 2.6, 2);
    softPoly(ctx, [
      [0, -h + 2],
      [-12, -h * 0.5],
      [-4, -h * 0.42],
      [3, -h * 0.62],
      [10, -h * 0.4],
      [15, -h * 0.55],
    ], mix(p.light, p.accent, 0.5), 0.3, 2, 1);
    dab(ctx, 0, -h + 4, 9, 11, 0, p.accent, 0.4, 2.4);
    softPoly(ctx, [[-24, 0], [24, 0], [19, -5], [-18, -5]], p.dark, 0.16, 2, 1);
    for (let i = 0; i < 3; i++) {
      dab(ctx, rng.range(-24, 24), rng.range(-4, 1), rng.range(2.2, 4), rng.range(1.4, 2.2), 0, p.dark, 0.18, 1);
    }
  }

  function stampTalus(ctx, rng, p) {
    dab(ctx, 0, 0, 28, 4, 0, p.dark, 0.12, 5);
    const count = rng.int(4, 6);
    for (let i = 0; i < count; i++) {
      const x = rng.range(-24, 24);
      const y = rng.range(-14, -3);
      const r = rng.range(4, 8);
      softPoly(ctx, [
        [x - r, y],
        [x - r * 0.55, y - r * 0.9],
        [x + r * 0.3, y - r],
        [x + r, y - r * 0.2],
        [x + r * 0.6, y + r * 0.5],
      ], i % 2 ? p.main : p.dark, 0.34, 1.6, 1);
      dab(ctx, x - r * 0.2, y - r * 0.45, r * 0.5, r * 0.35, -0.4, p.light, 0.16, 1.2);
    }
  }

  function stampLakeShore(ctx, rng, p) {
    softBlob(ctx, 0, -7, 42, 12, p.main, 0.32, 4);
    softBlob(ctx, -3, -4, 36, 8, p.light, 0.18, 4);
    softBlob(ctx, 0, -12, 38, 5, mix(p.main, p.dark, 0.4), 0.16, 4);
    for (let i = 0; i < 4; i++) {
      dab(ctx, rng.range(-28, 28), rng.range(-10, -3), rng.range(5, 14), rng.range(0.7, 1.5), 0, mix(p.accent, '#ffffff', 0.3), rng.range(0.16, 0.3), 1);
    }
    dab(ctx, -30, -12, 6, 2.5, 0.2, p.dark, 0.22, 1.5);
    dab(ctx, 27, -11, 5, 2.2, -0.2, p.dark, 0.2, 1.5);
  }

  function stampReeds(ctx, rng, p) {
    softBlob(ctx, 0, -2, 18, 4, p.dark, 0.14, 4);
    const count = rng.int(5, 8);
    for (let i = 0; i < count; i++) {
      const x = rng.range(-18, 18);
      const h = rng.range(16, 34);
      const bend = rng.range(-7, 7);
      softStroke(ctx, function (c) {
        c.moveTo(x, 0);
        c.quadraticCurveTo(x + bend * 0.4, -h * 0.55, x + bend, -h);
      }, mix(p.dark, p.ink, 0.3), 1.5, 0.4, 0.3);
      dab(ctx, x + bend, -h - 1, 1.8, 3.4, rng.range(-0.4, 0.4), mix(p.accent, p.ink, 0.25), 0.34, 0.8);
    }
  }

  function stampIsland(ctx, rng, p) {
    softBlob(ctx, 0, -5, 40, 11, p.main, 0.28, 4);
    softBlob(ctx, 0, -10, 27, 7, p.dark, 0.28, 4);
    softStroke(ctx, function (c) {
      c.moveTo(1, -12);
      c.quadraticCurveTo(2, -20, 0, -27);
    }, p.ink, 2, 0.45, 0.4);
    softBlob(ctx, 0, -31, 11, 8, p.light, 0.3, 3);
    softBlob(ctx, -4, -34, 7, 5, p.accent, 0.16, 3);
    for (let i = 0; i < 3; i++) {
      dab(ctx, rng.range(-24, 24), rng.range(-7, -2), rng.range(4, 8), rng.range(0.8, 1.4), 0, mix(p.accent, '#ffffff', 0.3), 0.18, 1);
    }
  }

  function stampMesa(ctx, rng, p) {
    const w = rng.range(34, 48);
    const h = rng.range(30, 44);
    softPoly(ctx, [
      [-w, 0],
      [-w * 0.86, -h * 0.5],
      [-w * 0.62, -h * 0.92],
      [-w * 0.2, -h],
      [w * 0.3, -h * 0.96],
      [w * 0.62, -h * 0.55],
      [w * 0.92, 0],
    ], p.main, 0.38, 2.4, 2);
    softPoly(ctx, [
      [-w, 0],
      [-w * 0.78, -h * 0.55],
      [-w * 0.5, -h * 0.86],
      [-w * 0.12, -h * 0.94],
      [-w * 0.05, -h * 0.5],
    ], p.light, 0.18, 2.4, 1);
    softPoly(ctx, [
      [w * 0.25, 0],
      [w * 0.42, -h * 0.6],
      [w * 0.7, -h * 0.7],
      [w * 0.9, 0],
    ], p.dark, 0.14, 2.4, 1);
    softStroke(ctx, function (c) {
      c.moveTo(-w * 0.55, -h * 0.94);
      c.lineTo(w * 0.28, -h * 0.9);
    }, p.light, 1.4, 0.25, 1);
    for (let i = 0; i < 3; i++) {
      dab(ctx, rng.range(-w * 0.7, w * 0.7), rng.range(-h * 0.5, -h * 0.2), rng.range(3, 7), rng.range(1, 2), 0, p.dark, 0.12, 2);
    }
  }

  function stampDune(ctx, rng, p) {
    const w = rng.range(34, 46);
    const h = rng.range(18, 30);
    softBlob(ctx, -w * 0.15, -h * 0.35, w * 0.85, h * 0.55, p.main, 0.26, 4);
    softBlob(ctx, w * 0.2, -h * 0.5, w * 0.6, h * 0.5, p.light, 0.24, 4);
    softStroke(ctx, function (c) {
      c.moveTo(-w, 0);
      c.quadraticCurveTo(-w * 0.4, -h * 0.95, w * 0.1, -h * 0.62);
      c.quadraticCurveTo(w * 0.55, -h * 0.35, w, 0);
    }, p.light, 1.6, 0.28, 2);
    softBlob(ctx, w * 0.25, -2, w * 0.55, 4, p.dark, 0.12, 4);
  }

  function stampCactusRock(ctx, rng, p) {
    dab(ctx, 0, 0, 26, 4, 0, p.dark, 0.12, 5);
    if (rng.chance(0.62)) {
      const h = rng.range(28, 42);
      softStroke(ctx, function (c) {
        c.moveTo(0, 0);
        c.quadraticCurveTo(-2, -h * 0.5, 0, -h);
      }, p.dark, 7, 0.5, 0.5);
      softStroke(ctx, function (c) {
        c.moveTo(0, -h * 0.55);
        c.quadraticCurveTo(-9, -h * 0.6, -10, -h * 0.78);
      }, p.dark, 4.5, 0.45, 0.5);
      softStroke(ctx, function (c) {
        c.moveTo(0, -h * 0.42);
        c.quadraticCurveTo(8, -h * 0.5, 9, -h * 0.62);
      }, p.dark, 4, 0.42, 0.5);
      softStroke(ctx, function (c) {
        c.moveTo(-1.5, -h * 0.92);
        c.lineTo(-1.5, -h * 0.2);
      }, p.light, 1.2, 0.25, 0.4);
    } else {
      for (let i = 0; i < 3; i++) {
        const x = rng.range(-18, 18);
        const r = rng.range(5, 10);
        softPoly(ctx, [
          [x - r, 0],
          [x - r * 0.6, -r * 1.4],
          [x + r * 0.4, -r * 1.5],
          [x + r, -r * 0.2],
        ], i % 2 ? p.main : p.dark, 0.34, 1.6, 1);
      }
    }
    dab(ctx, 16, -3, 7, 2.5, 0, p.light, 0.2, 2);
  }

  function stampWillow(ctx, rng, p) {
    dab(ctx, 0, 0, 28, 5, 0, p.dark, 0.14, 5);
    softStroke(ctx, function (c) {
      c.moveTo(0, 0);
      c.quadraticCurveTo(-8, -16, -4, -32);
    }, mix(p.ink, p.dark, 0.3), 4.5, 0.5, 0.6);
    softStroke(ctx, function (c) {
      c.moveTo(-3, -18);
      c.quadraticCurveTo(-16, -24, -20, -34);
    }, mix(p.ink, p.dark, 0.3), 2.4, 0.4, 0.6);
    softBlob(ctx, -8, -40, 20, 13, p.main, 0.34, 4);
    softBlob(ctx, 7, -36, 13, 10, p.main, 0.24, 4);
    softBlob(ctx, -12, -44, 11, 8, p.light, 0.22, 4);
    for (let i = 0; i < 5; i++) {
      const x = rng.range(-22, 16);
      const len = rng.range(12, 26);
      const sway = rng.range(-4, 4);
      const tip = rng.range(1, 6);
      softStroke(ctx, function (c) {
        c.moveTo(x, -38);
        c.quadraticCurveTo(x + sway, -38 + len * 0.55, x - tip, -38 + len);
      }, p.dark, 1.1, 0.24, 0.5);
    }
  }

  function stampPool(ctx, rng, p) {
    softBlob(ctx, 0, -5, 36, 10, p.main, 0.32, 4);
    softBlob(ctx, 0, -8, 30, 6, p.light, 0.16, 4);
    softBlob(ctx, 0, -1, 26, 4, p.dark, 0.14, 4);
    dab(ctx, -12, -9, 10, 1.2, 0, mix(p.accent, '#ffffff', 0.3), 0.2, 1);
    for (let i = 0; i < 3; i++) {
      const x = rng.range(-20, 20);
      const bend = rng.range(1, 3);
      softStroke(ctx, function (c) {
        c.moveTo(x, -6);
        c.quadraticCurveTo(x + bend, -14, x - 1, -22);
      }, p.dark, 1.2, 0.3, 0.4);
    }
  }

  function stampLoneTree(ctx, rng, p) {
    dab(ctx, 0, 0, 24, 5, 0, p.dark, 0.12, 5);
    softStroke(ctx, function (c) {
      c.moveTo(0, 0);
      c.quadraticCurveTo(-4, -18, -1, -36);
    }, mix(p.ink, p.dark, 0.35), 3.4, 0.5, 0.6);
    softStroke(ctx, function (c) {
      c.moveTo(-1, -22);
      c.quadraticCurveTo(-9, -26, -13, -32);
    }, mix(p.ink, p.dark, 0.35), 1.6, 0.4, 0.5);
    softBlob(ctx, -6, -44, 16, 12, p.main, 0.36, 4);
    softBlob(ctx, 6, -40, 12, 10, p.main, 0.26, 4);
    softBlob(ctx, -10, -48, 9, 7, p.light, 0.24, 4);
    softBlob(ctx, 1, -44, 8, 5, p.dark, 0.12, 4);
  }

  function stampShrubLine(ctx, rng, p) {
    dab(ctx, 0, 0, 32, 4, 0, p.dark, 0.1, 5);
    for (let i = 0; i < 3; i++) {
      const x = -22 + i * 21 + rng.range(-4, 4);
      const r = rng.range(9, 13);
      softBlob(ctx, x, -r * 0.7, r, r * 0.72, i === 1 ? p.main : p.dark, 0.26, 4);
      softBlob(ctx, x - 2, -r * 0.95, r * 0.55, r * 0.45, p.light, 0.16, 4);
    }
    for (let i = 0; i < 4; i++) {
      dab(ctx, rng.range(-28, 28), rng.range(-6, -1), 1.8, 1.3, 0, mix(p.accent, '#ffffff', 0.3), 0.3, 0.8);
    }
  }

  function stampBoulderFlowers(ctx, rng, p) {
    dab(ctx, 0, 0, 26, 4, 0, p.dark, 0.12, 5);
    for (let i = 0; i < 2; i++) {
      const x = i === 0 ? -8 : 9;
      const r = i === 0 ? rng.range(8, 11) : rng.range(5, 8);
      softPoly(ctx, [
        [x - r, 0],
        [x - r * 0.6, -r * 1.3],
        [x + r * 0.35, -r * 1.45],
        [x + r, -r * 0.15],
      ], i === 0 ? p.main : p.dark, 0.4, 1.8, 1);
      dab(ctx, x - r * 0.25, -r * 0.95, r * 0.5, r * 0.3, -0.3, p.light, 0.2, 1);
    }
    const flowerColor = mix(p.accent, '#e3c3ae', 0.35);
    for (let i = 0; i < 7; i++) {
      dab(ctx, rng.range(-26, 26), rng.range(-10, 0), rng.range(1.4, 2.4), rng.range(1, 1.7), rng.range(0, 3), flowerColor, rng.range(0.3, 0.5), 0.4);
    }
    softStroke(ctx, function (c) {
      c.moveTo(-20, 0);
      c.quadraticCurveTo(-22, -6, -24, -9);
      c.moveTo(20, 0);
      c.quadraticCurveTo(22, -5, 24, -8);
    }, p.dark, 1.1, 0.3, 0.4);
  }

  const STAMPS = {
    forest: [stampDeciduous, stampConifer, stampHedge],
    mountain: [stampRidgeMini, stampSnowCap, stampTalus],
    water: [stampLakeShore, stampReeds, stampIsland],
    desert: [stampMesa, stampDune, stampCactusRock],
    swamp: [stampWillow, stampPool, stampReeds],
    grass: [stampLoneTree, stampShrubLine, stampBoulderFlowers],
  };

  function paintCluster(ctx, family, x, y, scale, rng, p) {
    const palette = familyPalette(family, p);
    const stamps = STAMPS[family];
    softBlob(ctx, x, y + 2, 34 * scale, 8 * scale, mix(palette.dark, p.near, 0.35), 0.14, 10);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rng.range(-8, 8) * Math.PI / 180);
    ctx.scale(scale * (rng.chance(0.5) ? -1 : 1), scale);
    stamps[rng.int(0, stamps.length - 1)](ctx, rng, palette);
    if (rng.chance(0.52)) {
      ctx.save();
      ctx.translate(rng.range(-34, 22), rng.range(-8, 2));
      ctx.rotate(rng.range(-10, 10) * Math.PI / 180);
      const second = rng.range(0.45, 0.7);
      ctx.scale(second, second);
      stamps[rng.int(0, stamps.length - 1)](ctx, rng, palette);
      ctx.restore();
    }
    ctx.restore();
  }

  function paintRidgeTreeLine(ctx, p, ridge, rng) {
    const points = ridge.points;
    const color = mix(p.mid, p.ink, 0.22);
    const count = rng.int(14, 22);
    for (let i = 0; i < count; i++) {
      const f = rng.range(0.04, 0.96);
      const x = f * W;
      if (x > 380 && x < 910) continue;
      let y = ridge.baseY;
      for (let k = 0; k < points.length - 1; k++) {
        const a = points[k], b = points[k + 1];
        if (x >= a.x && x <= b.x) { const t = (x - a.x) / (b.x - a.x || 1); y = lerp(a.y, b.y, t); break; }
      }
      const h = rng.range(12, 30);
      const w = rng.range(7, 16);
      ctx.save();
      ctx.globalAlpha = rng.range(0.16, 0.30);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y - h);
      ctx.lineTo(x + w * 0.5, y);
      ctx.lineTo(x - w * 0.5, y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function paintMid(ctx, p, scenario, rng) {
    const info = weightedBiomes(scenario);
    const primary = familyFor(scenario.center);
    const weighted = Object.keys(info.weights)
      .filter(function (key) { return info.weights[key] > 0; })
      .sort(function (a, b) { return info.weights[b] - info.weights[a]; });
    let secondary = primary;
    for (let i = 0; i < weighted.length; i++) {
      const candidate = familyFor(weighted[i]);
      if (candidate !== primary) { secondary = candidate; break; }
    }
    const count = rng.int(8, 10);
    const altCount = secondary === primary ? 0 : clamp(Math.round(count * rng.range(0.25, 0.35)), 1, count - 1);
    const flags = [];
    for (let i = 0; i < count; i++) flags.push(i < altCount);
    for (let i = flags.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      const tmp = flags[i];
      flags[i] = flags[j];
      flags[j] = tmp;
    }

    const spots = [];
    for (let i = 0; i < count; i++) {
      let placed = null;
      for (let tries = 0; tries < 36 && !placed; tries++) {
        const preferRight = i < Math.ceil(count * 0.7) ? rng.chance(0.8) : rng.chance(0.65);
        const x = preferRight ? rng.range(W * 0.71, W * 0.965) : rng.range(W * 0.235, W * 0.305);
        const y = preferRight ? rng.range(H * 0.575, H * 0.75) : rng.range(H * 0.595, H * 0.76);
        if (x > 380 && x < 910) continue;
        if (spots.some(function (spot) { return Math.abs(spot.x - x) < 104 && Math.abs(spot.y - y) < 58; })) continue;
        placed = { x, y };
      }
      if (!placed) placed = { x: W * 0.75, y: H * (0.64 + 0.02 * i) };
      spots.push(placed);
    }

    for (let i = 0; i < spots.length; i++) {
      const family = flags[i] ? secondary : primary;
      const scale = rng.range(1.45, 2.05) * (spots[i].y > H * 0.72 ? 1.12 : 1);
      paintCluster(ctx, family, spots[i].x, spots[i].y, scale, rng, p);
    }
  }

  function paintRuin(ctx, p, ridge, rng) {
    const rightSide = rng.chance(0.7);
    const x = rightSide ? rng.range(W * 0.74, W * 0.9) : rng.range(W * 0.235, W * 0.29);
    let y = ridge.baseY;
    for (let i = 0; i < ridge.points.length - 1; i++) {
      const a = ridge.points[i];
      const b = ridge.points[i + 1];
      if (x >= a.x && x <= b.x) {
        const t = (x - a.x) / (b.x - a.x || 1);
        y = lerp(a.y, b.y, t);
        break;
      }
    }
    const height = rng.range(12, 22);
    const color = mix(p.ink, p.far, 0.35);
    softPoly(ctx, [
      [x - 6, y],
      [x - 5, y - height],
      [x + 1, y - height - 3],
      [x + 5, y - height * 0.8],
      [x + 6, y],
    ], color, 0.3, 1.5, 1);
    const x2 = x + rng.range(10, 18);
    softPoly(ctx, [
      [x2 - 4, y + 1],
      [x2 - 3, y - height * 0.5],
      [x2 + 2, y - height * 0.45],
      [x2 + 4, y + 1],
    ], color, 0.26, 1.5, 1);
    if (rng.chance(0.5)) {
      const span = rng.range(10, 16);
      softStroke(ctx, function (c) {
        c.moveTo(x - 3, y - height * 0.9);
        c.lineTo(x + span, y - height * 0.9);
      }, color, 3, 0.28, 1.2);
    }
    dab(ctx, x, y + 2, 12, 2.5, 0, p.dark, 0.14, 2);
  }

  function paintBank(ctx, p, rng, x0, x1, y0, strength) {
    const color = mix(p.near, p.mid, 0.45);
    wash(ctx, function (c) {
      c.beginPath();
      c.moveTo(x0, H + 20);
      c.bezierCurveTo(x0, y0 + 20, x0 + (x1 - x0) * 0.25, y0 - 14, (x0 + x1) * 0.5, y0 + 6);
      c.bezierCurveTo(x1 - (x1 - x0) * 0.2, y0 + 20, x1, y0 - 6, x1, H + 20);
      c.closePath();
    }, { color, alpha: strength, blur: 12, passes: 2, dy: 2 });
  }

  function paintGrassClump(ctx, x, y, size, p, rng) {
    const bladeColor = mix(p.near, p.ink, 0.22);
    const bladeColor2 = mix(p.near, p.dark, 0.1);
    const blades = rng.int(12, 18);
    for (let i = 0; i < blades; i++) {
      const spread = rng.range(-0.85, 0.85);
      const height = size * rng.range(0.55, 1);
      const bend = rng.range(-0.3, 0.3) * size;
      const width = rng.range(2.2, 4.2);
      const strength = rng.range(0.38, 0.58);
      softStroke(ctx, function (c) {
        c.moveTo(x + spread * size * 0.35, y);
        c.quadraticCurveTo(x + spread * size * 0.8 + bend * 0.4, y - height * 0.55, x + spread * size + bend, y - height);
      }, i % 3 === 0 ? bladeColor2 : bladeColor, width, strength, 0.6);
    }
    for (let i = 0; i < 3; i++) {
      dab(
        ctx,
        x + rng.range(-0.5, 0.5) * size,
        y - rng.range(0.1, 0.55) * size,
        rng.range(2, 3.6),
        rng.range(1.2, 2),
        0,
        mix(p.accent, '#efe3c4', 0.3),
        rng.range(0.45, 0.62),
        0.5
      );
    }
    dab(ctx, x, y, size * 0.6, size * 0.08, 0, p.dark, 0.12, 4);
  }

  function paintForeground(ctx, p, rng) {
    paintBank(ctx, p, rng, W * 0.165, W * 0.345, H * 0.895, 0.28);
    paintBank(ctx, p, rng, W * 0.7, W * 1.05, H * 0.845, 0.34);

    const leftTreeX = W * rng.range(0.25, 0.3);
    const leftTreeY = H * rng.range(0.68, 0.74);
    ctx.save();
    ctx.translate(leftTreeX, leftTreeY);
    const leftTreeScale = rng.range(1.9, 2.2);
    ctx.scale(leftTreeScale, leftTreeScale);
    stampDeciduous(ctx, rng, familyPalette('grass', p));
    ctx.restore();

    const rightTreeX = W * rng.range(0.83, 0.9);
    const rightTreeY = H * rng.range(0.68, 0.74);
    ctx.save();
    ctx.translate(rightTreeX, rightTreeY);
    const rightTreeScale = rng.range(1.7, 2.0);
    ctx.scale(rightTreeScale, rightTreeScale);
    stampConifer(ctx, rng, familyPalette('forest', p));
    ctx.restore();

    const clumps = [];
    const leftCount = rng.int(2, 3);
    for (let i = 0; i < leftCount; i++) {
      clumps.push({
        x: rng.range(W * 0.23, W * 0.3),
        y: rng.range(H * 0.88, H * 0.98),
        size: rng.range(85, 120),
      });
    }
    const rightCount = rng.int(4, 6);
    for (let i = 0; i < rightCount; i++) {
      clumps.push({
        x: rng.range(W * 0.735, W * 0.965),
        y: rng.range(H * 0.88, H * 0.98),
        size: rng.range(95, 145),
      });
    }
    for (let i = 0; i < clumps.length; i++) {
      paintGrassClump(ctx, clumps[i].x, clumps[i].y, clumps[i].size, p, rng);
    }

    const flowerColor = mix(p.accent, '#e3c9b0', 0.3);
    const flowers = rng.int(5, 9);
    for (let i = 0; i < flowers; i++) {
      dab(
        ctx,
        rng.range(W * 0.72, W * 0.97),
        rng.range(H * 0.9, H * 0.975),
        rng.range(1.2, 2.6),
        rng.range(0.9, 1.8),
        rng.range(0, 3),
        flowerColor,
        rng.range(0.3, 0.5),
        0.4
      );
    }
  }

  function paintUnifyingWash(ctx, p, rng) {
    const warm = mix(p.horizon, p.accent, 0.25);
    const gradient = ctx.createLinearGradient(0, 0, W * 0.4, H);
    gradient.addColorStop(0, alpha(lighten(warm, 0.4), 0.05));
    gradient.addColorStop(0.55, alpha(warm, 0.035));
    gradient.addColorStop(1, alpha(mix(warm, p.ink, 0.1), 0.05));
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    for (let i = 0; i < 3; i++) {
      softBlob(
        ctx,
        rng.range(0, W),
        rng.range(0, H),
        rng.range(0.15, 0.3) * W,
        rng.range(0.05, 0.12) * H,
        i === 0 ? lighten(p.paper, 0.1) : mix(p.paper, p.horizon, 0.4),
        rng.range(0.02, 0.04),
        40
      );
    }
  }

  function paintPaperEdge(ctx, p, rng) {
    const paper = p.paper;
    const top = ctx.createLinearGradient(0, 0, 0, 54);
    top.addColorStop(0, alpha(paper, 0.16));
    top.addColorStop(1, alpha(paper, 0));
    ctx.save();
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, W, 54);

    const left = ctx.createLinearGradient(0, 0, 46, 0);
    left.addColorStop(0, alpha(paper, 0.12));
    left.addColorStop(1, alpha(paper, 0));
    ctx.fillStyle = left;
    ctx.fillRect(0, 0, 46, H);

    const right = ctx.createLinearGradient(W, 0, W - 46, 0);
    right.addColorStop(0, alpha(paper, 0.12));
    right.addColorStop(1, alpha(paper, 0));
    ctx.fillStyle = right;
    ctx.fillRect(W - 46, 0, 46, H);

    const bottom = ctx.createLinearGradient(0, H, 0, H - 48);
    bottom.addColorStop(0, alpha(paper, 0.15));
    bottom.addColorStop(1, alpha(paper, 0));
    ctx.fillStyle = bottom;
    ctx.fillRect(0, H - 48, W, 48);
    ctx.restore();

    ctx.save();
    if ('filter' in ctx) ctx.filter = 'blur(3px)';
    ctx.strokeStyle = alpha(paper, 0.2);
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false;
    for (let x = -8; x <= W + 8; x += 58) {
      const y = 11 + rng.range(-5, 5);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    for (let y = 69; y < H - 11; y += 58) {
      ctx.lineTo(W - 11 + rng.range(-5, 5), y);
    }
    for (let x = W - 11; x >= 11; x -= 58) {
      ctx.lineTo(x, H - 11 + rng.range(-5, 5));
    }
    for (let y = H - 69; y > 11; y -= 58) {
      ctx.lineTo(11 + rng.range(-5, 5), y);
    }
    ctx.closePath();
    ctx.stroke();
    clearBlur(ctx);
    ctx.restore();
  }

  registry['painted-motif-kit'] = function (ctx, w, h, scenario, rng, seed) {
    const p = buildPalette(scenario, rng);
    paintSky(ctx, p, rng);
    const sun = paintSun(ctx, p, rng);
    paintClouds(ctx, p, rng);
    const ridge = paintFarMass(ctx, p, scenario, rng);
    paintRidgeTreeLine(ctx, p, ridge, rng);
    paintHorizonHaze(ctx, p, rng);
    paintGround(ctx, p, rng, sun);
    const info = weightedBiomes(scenario);
    const waterWeight = (info.weights.water || 0) / info.total;
    if (scenario.center === 'water' || scenario.center === 'swamp' || waterWeight >= 0.18) {
      paintLake(ctx, p, rng, scenario.center === 'water' ? 0.34 : 0.2);
    }
    paintMid(ctx, p, scenario, rng);
    if (rng.chance(0.28)) paintRuin(ctx, p, ridge, rng);
    paintForeground(ctx, p, rng);
    paintUnifyingWash(ctx, p, rng);
    paintPaperEdge(ctx, p, rng);
  };
})();
