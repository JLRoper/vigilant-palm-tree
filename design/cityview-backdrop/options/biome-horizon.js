(function () {
  'use strict';

  const Core = window.CityBackdropCore;
  const W = Core.W;
  const H = Core.H;
  const BIOMES = Core.BIOMES;
  const clamp = Core.clamp;
  const smoothstep = Core.smoothstep;
  const mix = Core.mix;
  const lighten = Core.lighten;
  const darken = Core.darken;
  const alpha = Core.alpha;
  const weightedBiomes = Core.weightedBiomes;
  const blendBiomeColor = Core.blendBiomeColor;
  const noise1D = Core.noise1D;
  const ridged1D = Core.ridged1D;
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

  function gaussian(x, center, width) {
    const d = (x - center) / width;
    return Math.exp(-d * d * 1.35);
  }

  function sideDamp(x) {
    const dx = Math.abs(x - W / 2);
    return 0.5 + 0.5 * smoothstep(W * 0.08, W * 0.3, dx);
  }

  function makeShape(terrain, rng, layer) {
    const localLayer = layer || 0;
    const seedValue = rng.int(1, 1000000);
    const microSeed = rng.int(1, 1000000);
    const freq = (1.9 + localLayer * 0.55) * rng.range(0.82, 1.18);

    if (terrain === 'mountain' || terrain === 'snow') {
      const mains = [];
      const leftCount = rng.int(1, localLayer === 0 ? 2 : 1);
      const rightCount = localLayer === 0 ? rng.int(1, 2) : rng.int(1, 2);
      for (let i = 0; i < leftCount; i++) {
        mains.push({ x: rng.range(0.07, 0.29) * W, w: rng.range(0.032, 0.072) * W });
      }
      for (let i = 0; i < rightCount; i++) {
        mains.push({ x: rng.range(0.72, 0.94) * W, w: rng.range(0.036, 0.08) * W });
      }
      if (localLayer === 0 && rng.chance(0.55)) {
        mains.push({ x: rng.range(0.74, 0.95) * W, w: rng.range(0.026, 0.055) * W });
      }
      const peaks = [];
      for (let i = 0; i < mains.length; i++) {
        const main = mains[i];
        peaks.push({ x: main.x, w: main.w, h: 1 });
        const shoulders = rng.int(0, 2);
        for (let j = 0; j < shoulders; j++) {
          peaks.push({
            x: main.x + rng.sign() * main.w * rng.range(0.55, 1.15),
            w: main.w * rng.range(0.32, 0.55),
            h: rng.range(0.38, 0.68),
          });
        }
      }
      const sharp = rng.range(2, 3.2);
      const valley = rng.range(0.05, 0.12);
      const jagSeed = rng.int(1, 1000000);
      return {
        peaks,
        value(x) {
          const u = x / W;
          let env = 0;
          for (let i = 0; i < peaks.length; i++) {
            const d = Math.abs(x - peaks[i].x) / peaks[i].w;
            const tri = d < 1 ? 1 - d : 0;
            const peak = peaks[i].h * (tri * 0.9 + gaussian(x, peaks[i].x, peaks[i].w) * 0.1);
            env = Math.max(env, peak);
          }
          const jag = ridged1D(u * freq + 0.37, jagSeed, sharp);
          const jag2 = ridged1D(u * freq * 3.1 + 0.11, jagSeed + 17, sharp * 1.15);
          const grain = noise1D(u * freq * 6.3, microSeed);
          const roll = 0.5 + 0.5 * noise1D(u * freq * 0.6, microSeed + 31);
          return clamp(valley + roll * 0.05 + env * (0.8 + 0.12 * jag + 0.06 * jag2 + 0.03 * grain), 0, 1);
        },
      };
    }

    if (terrain === 'forest') {
      return {
        peaks: [],
        value(x) {
          const u = x / W;
          const roll = 0.5 + 0.5 * noise1D(u * freq, seedValue);
          const bump = 0.5 + 0.5 * noise1D(u * freq * 3.1, microSeed);
          return clamp(0.3 + roll * 0.46 + bump * 0.1, 0, 1);
        },
      };
    }

    if (terrain === 'water') {
      return {
        peaks: [],
        value(x) {
          const u = x / W;
          const roll = 0.5 + 0.5 * noise1D(u * freq * 0.62, seedValue);
          return clamp(0.08 + roll * 0.11, 0, 1);
        },
      };
    }

    if (terrain === 'desert') {
      const phase = rng.range(0, Math.PI * 2);
      return {
        peaks: [],
        value(x) {
          const u = x / W;
          const dune = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * freq + phase);
          const grain = 0.5 + 0.5 * noise1D(u * freq * 1.7, seedValue);
          return clamp(0.18 + dune * 0.36 + grain * 0.14, 0, 1);
        },
      };
    }

    if (terrain === 'swamp') {
      const raggedSeed = rng.int(1, 1000000);
      return {
        peaks: [],
        value(x) {
          const u = x / W;
          const roll = 0.5 + 0.5 * noise1D(u * freq * 0.78, seedValue);
          const ragged = ridged1D(u * freq * 1.9, raggedSeed, 2.4);
          return clamp(0.1 + roll * 0.17 + ragged * 0.13, 0, 1);
        },
      };
    }

    return {
      peaks: [],
      value(x) {
        const u = x / W;
        const roll = 0.5 + 0.5 * noise1D(u * freq * 0.9, seedValue);
        const grain = 0.5 + 0.5 * noise1D(u * freq * 2.2, microSeed);
        return clamp(0.32 + roll * 0.48 + grain * 0.06, 0, 1);
      },
    };
  }

  function combineShapes(primary, secondary, blend) {
    const peaks = primary.peaks || [];
    if (!secondary || blend <= 0) {
      return { peaks, value: primary.value };
    }
    return {
      peaks,
      value(x) {
        return primary.value(x) * (1 - blend) + secondary.value(x) * blend;
      },
    };
  }

  function makeRidge(shape, base, amp) {
    return {
      shape,
      base,
      amp,
      yAt(x) {
        return base - amp * shape.value(x) * sideDamp(x);
      },
    };
  }

  function drawRidge(ctx, ridge, color, strength, blur) {
    const points = [];
    for (let x = -40; x <= W + 40; x += 7) points.push({ x, y: ridge.yAt(x) });
    wash(ctx, function (c) {
      c.beginPath();
      c.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) c.lineTo(points[i].x, points[i].y);
      c.lineTo(W + 50, H + 50);
      c.lineTo(-50, H + 50);
      c.closePath();
    }, { color, alpha: strength, blur, passes: 2, dy: 2 });
  }

  function drawCrestShade(ctx, ridge, color, strength, width) {
    ctx.save();
    if ('filter' in ctx) ctx.filter = 'blur(3px)';
    ctx.globalAlpha = strength;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let x = -20; x <= W + 20; x += 10) {
      const y = ridge.yAt(x) + width * 0.35;
      if (x === -20) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if ('filter' in ctx) ctx.filter = 'none';
    ctx.restore();
  }

  function drawClouds(ctx, horizonColor, rng) {
    const count = rng.int(6, 9);
    const cloudTint = mix(horizonColor, '#c2cbd0', 0.26);
    for (let i = 0; i < count; i++) {
      const cx = rng.range(-0.1, 1.08) * W;
      const cy = rng.range(0.11, 0.34) * H;
      const cw = rng.range(0.1, 0.34) * W;
      const ch = rng.range(0.008, 0.026) * H;
      const lightCloud = rng.chance(0.5);
      const color = lightCloud
        ? mix(lighten(horizonColor, rng.range(0.2, 0.5)), '#ffffff', 0.3)
        : lighten(cloudTint, rng.range(0.05, 0.24));
      const strength = lightCloud ? rng.range(0.1, 0.18) : rng.range(0.14, 0.24);
      const blur = rng.range(16, 30);
      const lean = rng.range(-0.35, 0.35) * cw;
      wash(ctx, function (c) {
        c.beginPath();
        c.ellipse(cx, cy, cw, ch, 0, 0, Math.PI * 2);
        c.ellipse(cx + lean, cy + ch * 0.55, cw * 0.55, ch * 1.4, 0, 0, Math.PI * 2);
      }, { color, alpha: strength, blur, passes: 1 });
      if (!lightCloud) {
        wash(ctx, function (c) {
          c.beginPath();
          c.ellipse(cx + lean * 0.4, cy + ch * 1.15, cw * 0.68, ch * 0.6, 0, 0, Math.PI * 2);
        }, { color: darken(cloudTint, 0.06), alpha: strength * 0.5, blur: 18, passes: 1 });
      }
    }
  }

  function drawSun(ctx, horizonColor, dominantEntry, warm, rng) {
    const sunX = W * rng.range(0.66, 0.78);
    const sunY = H * rng.range(0.26, 0.34);
    const glowColor = warm
      ? mix(dominantEntry.accent, '#fff4dc', 0.6)
      : mix('#e9f1f6', dominantEntry.accent, 0.3);
    const radius = Math.min(W, H) * rng.range(0.2, 0.29);
    const gradient = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, radius);
    gradient.addColorStop(0, alpha(lighten(glowColor, 0.4), 0.43));
    gradient.addColorStop(0.16, alpha(glowColor, 0.24));
    gradient.addColorStop(0.52, alpha(mix(glowColor, horizonColor, 0.4), 0.08));
    gradient.addColorStop(1, alpha(glowColor, 0));
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = lighten(glowColor, 0.55);
    ctx.beginPath();
    ctx.arc(sunX, sunY, rng.range(10, 16), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return { x: sunX, y: sunY };
  }

  function drawSnowCap(ctx, ridge, peak, color, depth, strength) {
    const half = Math.min(peak.w * 0.33, 32);
    const cx = peak.x;
    const crest = [];
    for (let i = 0; i <= 12; i++) {
      const x = cx - half + (i / 12) * half * 2;
      crest.push({ x, y: ridge.yAt(x) });
    }
    const bottomY = ridge.yAt(cx) + depth;
    const bottom = [];
    const teeth = 6;
    for (let i = 0; i <= teeth; i++) {
      const t = i / teeth;
      const x = cx - half + t * half * 2;
      const dip = i % 2 === 0 ? depth * 0.08 : depth * 0.62;
      bottom.push({ x, y: bottomY + dip });
    }
    wash(ctx, function (c) {
      c.beginPath();
      c.moveTo(crest[0].x, crest[0].y);
      for (let i = 1; i < crest.length; i++) c.lineTo(crest[i].x, crest[i].y);
      for (let i = bottom.length - 1; i >= 0; i--) c.lineTo(bottom[i].x, bottom[i].y);
      c.closePath();
    }, { color, alpha: strength, blur: 1.6, passes: 1 });
  }

  function drawMesa(ctx, x, baseY, width, height, color, rim) {
    const topW = width * 0.46;
    wash(ctx, function (c) {
      c.beginPath();
      c.moveTo(x - width * 0.5, baseY + 18);
      c.lineTo(x - width * 0.4, baseY - height * 0.62);
      c.lineTo(x - topW * 0.5, baseY - height);
      c.lineTo(x + topW * 0.5, baseY - height);
      c.lineTo(x + width * 0.38, baseY - height * 0.6);
      c.lineTo(x + width * 0.5, baseY + 18);
      c.closePath();
    }, { color, alpha: 0.45, blur: 1.2, passes: 1 });
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x - topW * 0.5, baseY - height + 1);
    ctx.lineTo(x + topW * 0.5, baseY - height + 1);
    ctx.stroke();
    ctx.restore();
  }

  function drawTreeCluster(ctx, ridge, centerX, count, color, strength, scale, rng) {
    const spread = scale * rng.range(48, 115);
    const trees = [];
    for (let i = 0; i < count; i++) {
      const x = centerX + rng.range(-spread, spread);
      if (x < 18 || x > W - 18) continue;
      if (x > W * 0.36 && x < W * 0.64) continue;
      const baseY = ridge.yAt(x) + 1.5;
      const height = scale * rng.range(4.5, 12);
      const round = rng.chance(0.36);
      trees.push({ x, baseY, height, round });
    }
    if (!trees.length) return;
    ctx.save();
    ctx.globalAlpha = strength;
    ctx.fillStyle = color;
    if ('filter' in ctx) ctx.filter = 'blur(0.7px)';
    ctx.beginPath();
    for (let i = 0; i < trees.length; i++) {
      const tree = trees[i];
      if (tree.round) {
        ctx.moveTo(tree.x + tree.height * 0.36, tree.baseY - tree.height * 0.5);
        ctx.arc(tree.x, tree.baseY - tree.height * 0.55, tree.height * 0.36, 0, Math.PI * 2);
      } else {
        ctx.moveTo(tree.x, tree.baseY - tree.height);
        ctx.lineTo(tree.x - tree.height * 0.3, tree.baseY);
        ctx.lineTo(tree.x + tree.height * 0.3, tree.baseY);
        ctx.closePath();
        ctx.moveTo(tree.x, tree.baseY - tree.height * 0.55);
        ctx.lineTo(tree.x - tree.height * 0.38, tree.baseY - tree.height * 0.16);
        ctx.lineTo(tree.x + tree.height * 0.38, tree.baseY - tree.height * 0.16);
        ctx.closePath();
      }
    }
    ctx.fill();
    if ('filter' in ctx) ctx.filter = 'none';
    ctx.restore();
  }

  function drawHedge(ctx, ridge, centerX, width, color, strength, rng) {
    ctx.save();
    ctx.globalAlpha = strength;
    ctx.fillStyle = color;
    if ('filter' in ctx) ctx.filter = 'blur(0.6px)';
    ctx.beginPath();
    const end = centerX + width * 0.5;
    for (let x = centerX - width * 0.5; x <= end; x += rng.range(6, 9)) {
      const y = ridge.yAt(x) + 1;
      const r = rng.range(3, 5.5);
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
    if ('filter' in ctx) ctx.filter = 'none';
    ctx.restore();
  }

  function drawLoneTree(ctx, ridge, x, height, color, strength, rng) {
    const baseY = ridge.yAt(x) + 2;
    ctx.save();
    ctx.globalAlpha = strength;
    ctx.strokeStyle = darken(color, 0.15);
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(x + rng.range(-1.5, 1.5), baseY - height * 0.52);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, baseY - height * 0.62, height * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - height * 0.16, baseY - height * 0.48, height * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawRidgeGlints(ctx, color, rng, top, bottom, strength) {
    const count = rng.int(16, 26);
    ctx.save();
    if ('filter' in ctx) ctx.filter = 'blur(0.8px)';
    for (let i = 0; i < count; i++) {
      const x = rng.range(0.03, 0.97) * W;
      const y = rng.range(top + 5, bottom - 4);
      const len = rng.range(7, 38);
      ctx.globalAlpha = strength * rng.range(0.5, 1);
      ctx.strokeStyle = color;
      ctx.lineWidth = rng.range(0.8, 1.8);
      ctx.beginPath();
      ctx.moveTo(x - len * 0.5, y);
      ctx.lineTo(x + len * 0.5, y);
      ctx.stroke();
    }
    if ('filter' in ctx) ctx.filter = 'none';
    ctx.restore();
  }

  function drawLakeBand(ctx, waterColor, horizonColor, rng, strength, sunX) {
    const top = H * 0.596;
    const bottom = H * 0.664;
    const gradient = ctx.createLinearGradient(0, top, 0, bottom);
    gradient.addColorStop(0, alpha(lighten(waterColor, 0.35), 0));
    gradient.addColorStop(0.18, alpha(lighten(waterColor, 0.16), strength));
    gradient.addColorStop(0.6, alpha(waterColor, strength));
    gradient.addColorStop(1, alpha(darken(waterColor, 0.04), 0));
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(-20, top, W + 40, bottom - top);
    ctx.restore();

    ctx.save();
    if ('filter' in ctx) ctx.filter = 'blur(2.5px)';
    ctx.globalAlpha = strength * 0.7;
    ctx.strokeStyle = mix(lighten(waterColor, 0.45), horizonColor, 0.25);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let x = -10; x <= W + 10; x += 10) {
      const y = top + 4 + noise1D((x / W) * 3.2, 8128 + Math.round(rng.range(0, 40))) * 2.4;
      if (x === -10) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if ('filter' in ctx) ctx.filter = 'none';
    ctx.restore();

    drawRidgeGlints(ctx, lighten(waterColor, 0.55), rng, top, bottom, strength * 0.78);

    if (sunX !== undefined) {
      ctx.save();
      if ('filter' in ctx) ctx.filter = 'blur(1.2px)';
      for (let i = 0; i < 8; i++) {
        const x = sunX + rng.range(-95, 95);
        const y = rng.range(top + 4, bottom - 3);
        const len = rng.range(10, 34);
        ctx.globalAlpha = strength * rng.range(0.45, 0.8);
        ctx.strokeStyle = lighten(waterColor, 0.62);
        ctx.lineWidth = rng.range(1, 2);
        ctx.beginPath();
        ctx.moveTo(x - len * 0.5, y);
        ctx.lineTo(x + len * 0.5, y);
        ctx.stroke();
      }
      if ('filter' in ctx) ctx.filter = 'none';
      ctx.restore();
    }
  }

  function drawReedClump(ctx, x, baseY, count, height, color, headColor, strength, rng) {
    ctx.save();
    ctx.globalAlpha = strength;
    ctx.strokeStyle = color;
    ctx.fillStyle = headColor;
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const sx = x + rng.range(-8, 8);
      const sy = baseY + rng.range(-2, 3);
      const h = height * rng.range(0.65, 1.25);
      const lean = rng.range(-5, 5);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(sx + lean * 0.3, sy - h * 0.55, sx + lean, sy - h);
      ctx.stroke();
      ctx.save();
      ctx.globalAlpha = strength * 0.8;
      ctx.beginPath();
      ctx.ellipse(sx + lean, sy - h, 1.1, 2.2, lean * 0.02, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawTrunk(ctx, x, baseY, height, color, strength, rng) {
    const lean = rng.range(-9, 9);
    ctx.save();
    ctx.globalAlpha = strength;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineWidth = rng.range(1.1, 2.1);
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.bezierCurveTo(x + lean * 0.35, baseY - height * 0.38, x - lean * 0.2, baseY - height * 0.72, x + lean, baseY - height);
    ctx.stroke();
    ctx.lineWidth = Math.max(0.8, ctx.lineWidth * 0.7);
    for (let i = 0; i < 2; i++) {
      const t = rng.range(0.45, 0.8);
      const bx = x + lean * t * 0.8;
      const by = baseY - height * t;
      const dir = rng.sign();
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx + dir * 7, by - 4, bx + dir * rng.range(8, 17), by - rng.range(3, 9));
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTuft(ctx, x, baseY, color, strength, rng) {
    ctx.save();
    ctx.globalAlpha = strength;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    const blades = rng.int(3, 5);
    for (let i = 0; i < blades; i++) {
      const sx = x + rng.range(-5, 5);
      const h = rng.range(10, 23);
      const lean = rng.range(-7, 7);
      ctx.beginPath();
      ctx.moveTo(sx, baseY);
      ctx.quadraticCurveTo(sx + lean * 0.4, baseY - h * 0.55, sx + lean, baseY - h);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRock(ctx, x, y, width, height, color, highlight, strength) {
    ctx.save();
    ctx.globalAlpha = strength;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, width * 0.5, height * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = strength * 0.5;
    ctx.fillStyle = highlight;
    ctx.beginPath();
    ctx.ellipse(x - width * 0.12, y - height * 0.22, width * 0.3, height * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawWildflowers(ctx, x, baseY, color, strength, rng) {
    const count = rng.int(4, 8);
    ctx.save();
    ctx.globalAlpha = strength;
    for (let i = 0; i < count; i++) {
      const fx = x + rng.range(-15, 15);
      const fy = baseY - rng.range(1, 12);
      ctx.fillStyle = rng.chance(0.35) ? lighten(color, 0.25) : color;
      ctx.beginPath();
      ctx.arc(fx, fy, rng.range(1.4, 2.7), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawRollingHighlights(ctx, ridge, color, rng, strength) {
    const clusters = [
      { x: rng.range(0.74, 0.9), len: rng.range(70, 150) },
      { x: rng.range(0.23, 0.31), len: rng.range(45, 90) },
    ];
    ctx.save();
    ctx.globalAlpha = strength;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    if ('filter' in ctx) ctx.filter = 'blur(2px)';
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      const cx = c.x * W;
      ctx.lineWidth = rng.range(2.5, 5);
      ctx.beginPath();
      for (let t = 1; t <= 8; t++) {
        const x = cx - c.len * 0.5 + (t / 8) * c.len;
        const y = ridge.yAt(x) + 7 + Math.sin(t * 1.8) * 2;
        if (t === 1) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    if ('filter' in ctx) ctx.filter = 'none';
    ctx.restore();
  }

  function drawDuneHighlights(ctx, ridge, color, rng, strength) {
    ctx.save();
    ctx.globalAlpha = strength;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    if ('filter' in ctx) ctx.filter = 'blur(2px)';
    for (let i = 0; i < 5; i++) {
      const cx = (i < 3 ? rng.range(0.74, 0.92) : rng.range(0.22, 0.31)) * W;
      const len = rng.range(60, 150);
      ctx.lineWidth = rng.range(2, 5);
      ctx.beginPath();
      for (let t = 0; t <= 6; t++) {
        const x = cx - len * 0.5 + (t / 6) * len;
        const y = ridge.yAt(x) + 4 + Math.sin((t / 6) * Math.PI) * rng.range(0, 4);
        if (t === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    if ('filter' in ctx) ctx.filter = 'none';
    ctx.restore();
  }

  function drawLandmark(ctx, type, x, baseY, height, color, strength, rng) {
    ctx.save();
    ctx.globalAlpha = strength;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    if (type === 'windmill') {
      ctx.beginPath();
      ctx.moveTo(x - 1.4, baseY);
      ctx.lineTo(x - 0.8, baseY - height * 0.62);
      ctx.lineTo(x + 0.8, baseY - height * 0.62);
      ctx.lineTo(x + 1.4, baseY);
      ctx.closePath();
      ctx.fill();
      const hubY = baseY - height * 0.7;
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2 + rng.range(-0.1, 0.1);
        ctx.beginPath();
        ctx.moveTo(x, hubY);
        ctx.lineTo(x + Math.cos(angle) * height * 0.4, hubY + Math.sin(angle) * height * 0.4);
        ctx.stroke();
      }
    } else if (type === 'stones') {
      for (let i = 0; i < 3; i++) {
        const sx = x + (i - 1) * height * 0.32;
        const sh = height * rng.range(0.45, 0.75);
        ctx.beginPath();
        ctx.ellipse(sx, baseY - sh * 0.5, height * 0.08, sh * 0.5, rng.range(-0.12, 0.12), 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (type === 'ruin') {
      ctx.beginPath();
      ctx.moveTo(x - height * 0.16, baseY);
      ctx.lineTo(x - height * 0.16, baseY - height * 0.66);
      ctx.lineTo(x - height * 0.02, baseY - height * 0.55);
      ctx.lineTo(x + height * 0.08, baseY - height * 0.72);
      ctx.lineTo(x + height * 0.16, baseY - height * 0.6);
      ctx.lineTo(x + height * 0.16, baseY);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(x - height * 0.14, baseY);
      ctx.lineTo(x - height * 0.14, baseY - height * 0.68);
      ctx.lineTo(x - height * 0.06, baseY - height * 0.68);
      ctx.lineTo(x - height * 0.06, baseY - height * 0.62);
      ctx.lineTo(x + height * 0.02, baseY - height * 0.62);
      ctx.lineTo(x + height * 0.02, baseY - height * 0.7);
      ctx.lineTo(x + height * 0.1, baseY - height * 0.7);
      ctx.lineTo(x + height * 0.1, baseY - height * 0.6);
      ctx.lineTo(x + height * 0.16, baseY - height * 0.6);
      ctx.lineTo(x + height * 0.16, baseY);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - height * 0.17, baseY - height * 0.7);
      ctx.lineTo(x, baseY - height * 0.92);
      ctx.lineTo(x + height * 0.17, baseY - height * 0.7);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBirds(ctx, color, rng) {
    const count = rng.int(3, 5);
    const baseX = W * rng.range(0.55, 0.75);
    const baseY = H * rng.range(0.2, 0.28);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const x = baseX + rng.range(-34, 34);
      const y = baseY + rng.range(-14, 14);
      const size = rng.range(3.5, 6.5);
      ctx.globalAlpha = rng.range(0.18, 0.32);
      ctx.beginPath();
      ctx.moveTo(x - size, y);
      ctx.quadraticCurveTo(x - size * 0.45, y - size * 0.7, x, y);
      ctx.quadraticCurveTo(x + size * 0.45, y - size * 0.7, x + size, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawForeground(ctx, palette, dominant, rng) {
    const near = palette.near;
    const accent = palette.accent;
    const horizon = palette.horizon;
    const ink = palette.ink;

    const groundMist = ctx.createLinearGradient(0, H * 0.63, 0, H * 0.8);
    groundMist.addColorStop(0, alpha(lighten(horizon, 0.42), 0));
    groundMist.addColorStop(0.42, alpha(lighten(horizon, 0.5), 0.15));
    groundMist.addColorStop(1, alpha(lighten(horizon, 0.45), 0));
    ctx.save();
    ctx.fillStyle = groundMist;
    ctx.fillRect(0, H * 0.63, W, H * 0.17);
    ctx.restore();

    wash(ctx, function (c) {
      c.beginPath();
      c.moveTo(W * 0.66, H + 30);
      c.lineTo(W * 0.695, H * 0.905);
      c.quadraticCurveTo(W * 0.72, H * 0.825, W * 0.78, H * 0.795);
      c.quadraticCurveTo(W * 0.86, H * 0.762, W * 0.93, H * 0.752);
      c.quadraticCurveTo(W * 0.98, H * 0.748, W + 30, H * 0.755);
      c.lineTo(W + 30, H + 30);
      c.closePath();
    }, { color: darken(near, 0.18), alpha: 0.5, blur: 7, passes: 2, dy: 3 });

    wash(ctx, function (c) {
      c.beginPath();
      c.moveTo(W * 0.18, H + 30);
      c.lineTo(W * 0.215, H * 0.9);
      c.quadraticCurveTo(W * 0.25, H * 0.845, W * 0.3, H * 0.83);
      c.quadraticCurveTo(W * 0.33, H * 0.822, W * 0.355, H * 0.84);
      c.lineTo(W * 0.36, H + 30);
      c.closePath();
    }, { color: darken(near, 0.15), alpha: 0.4, blur: 8, passes: 2, dy: 3 });

    ctx.save();
    if ('filter' in ctx) ctx.filter = 'blur(2px)';
    ctx.globalAlpha = 0.24;
    ctx.strokeStyle = darken(near, 0.26);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(W * 0.705, H * 0.9);
    ctx.quadraticCurveTo(W * 0.79, H * 0.793, W * 0.89, H * 0.761);
    ctx.quadraticCurveTo(W * 0.96, H * 0.747, W, H * 0.752);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(W * 0.215, H * 0.9);
    ctx.quadraticCurveTo(W * 0.26, H * 0.842, W * 0.31, H * 0.83);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    if ('filter' in ctx) ctx.filter = 'blur(3px)';
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = lighten(near, 0.18);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(W * 0.71, H * 0.86);
    ctx.quadraticCurveTo(W * 0.79, H * 0.792, W * 0.89, H * 0.762);
    ctx.quadraticCurveTo(W * 0.96, H * 0.748, W, H * 0.752);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(W * 0.22, H * 0.9);
    ctx.quadraticCurveTo(W * 0.26, H * 0.84, W * 0.31, H * 0.827);
    ctx.stroke();
    if ('filter' in ctx) ctx.filter = 'none';
    ctx.restore();

    wash(ctx, function (c) {
      c.beginPath();
      c.ellipse(W * 0.52, H * 0.79, W * 0.33, H * 0.035, 0, 0, Math.PI * 2);
    }, { color: lighten(near, 0.12), alpha: 0.09, blur: 30, passes: 1 });

    wash(ctx, function (c) {
      c.beginPath();
      c.ellipse(W * 0.82, H * 0.92, W * 0.18, H * 0.055, 0, 0, Math.PI * 2);
    }, { color: darken(near, 0.08), alpha: 0.1, blur: 26, passes: 1 });

    wash(ctx, function (c) {
      c.beginPath();
      c.ellipse(W * 0.29, H * 0.94, W * 0.11, H * 0.045, 0, 0, Math.PI * 2);
    }, { color: lighten(near, 0.16), alpha: 0.08, blur: 22, passes: 1 });

    wash(ctx, function (c) {
      c.beginPath();
      c.ellipse(W * 0.52, H * 0.9, W * 0.24, H * 0.055, 0, 0, Math.PI * 2);
    }, { color: lighten(near, 0.14), alpha: 0.1, blur: 24, passes: 1 });

    const grassColor = mix(darken(near, 0.24), ink, 0.22);
    const rockColor = mix(near, ink, 0.34);
    const rockLight = lighten(near, 0.34);

    const rightCount = dominant === 'desert' ? 10 : 18;
    for (let i = 0; i < rightCount; i++) {
      drawTuft(ctx, rng.range(0.7, 0.975) * W, rng.range(0.79, 0.985) * H, grassColor, rng.range(0.28, 0.46), rng);
    }
    const leftCount = dominant === 'desert' ? 6 : 10;
    for (let i = 0; i < leftCount; i++) {
      drawTuft(ctx, rng.range(0.2, 0.335) * W, rng.range(0.81, 0.985) * H, grassColor, rng.range(0.24, 0.4), rng);
    }

    const rockCount = dominant === 'mountain' || dominant === 'desert' ? 6 : 4;
    for (let i = 0; i < rockCount; i++) {
      drawRock(ctx, rng.range(0.72, 0.96) * W, rng.range(0.8, 0.96) * H, rng.range(12, 32), rng.range(6, 14), rockColor, rockLight, rng.range(0.34, 0.5));
    }
    for (let i = 0; i < 3; i++) {
      drawRock(ctx, rng.range(0.225, 0.325) * W, rng.range(0.83, 0.97) * H, rng.range(8, 20), rng.range(4, 11), rockColor, rockLight, rng.range(0.3, 0.44));
    }

    const flowerClusters = dominant === 'desert' ? 2 : 5;
    for (let i = 0; i < flowerClusters; i++) {
      drawWildflowers(ctx, rng.range(0.74, 0.955) * W, rng.range(0.8, 0.96) * H, accent, rng.range(0.36, 0.52), rng);
    }
    if (dominant !== 'desert') {
      drawWildflowers(ctx, rng.range(0.22, 0.32) * W, rng.range(0.84, 0.97) * H, accent, rng.range(0.3, 0.44), rng);
    }

    const reedClumps = dominant === 'swamp' ? 6 : dominant === 'water' ? 4 : 2;
    for (let i = 0; i < reedClumps; i++) {
      drawReedClump(ctx, rng.range(0.71, 0.88) * W, rng.range(0.82, 0.96) * H, rng.int(8, 14), rng.range(26, 48), grassColor, accent, rng.range(0.38, 0.52), rng);
    }
    drawReedClump(ctx, rng.range(0.23, 0.31) * W, rng.range(0.85, 0.97) * H, rng.int(6, 10), rng.range(20, 38), grassColor, accent, rng.range(0.3, 0.42), rng);

    if (dominant === 'swamp') {
      for (let i = 0; i < 5; i++) {
        drawTrunk(ctx, rng.range(0.72, 0.93) * W, rng.range(0.82, 0.95) * H, rng.range(38, 78), darken(near, 0.28), rng.range(0.3, 0.42), rng);
      }
      drawTrunk(ctx, rng.range(0.24, 0.32) * W, rng.range(0.86, 0.95) * H, rng.range(26, 48), darken(near, 0.26), rng.range(0.24, 0.34), rng);
    }

    if (dominant === 'forest' || dominant === 'mountain' || dominant === 'snow') {
      const pseudoRidge = { yAt() { return H * 0.88; } };
      drawTreeCluster(ctx, pseudoRidge, rng.range(0.76, 0.9) * W, rng.int(4, 7), darken(near, 0.26), rng.range(0.38, 0.5), 1.85, rng);
    }

    if (dominant === 'mountain' || dominant === 'snow') {
      const pseudoRidge = { yAt() { return H * 0.9; } };
      drawTreeCluster(ctx, pseudoRidge, rng.range(0.25, 0.31) * W, rng.int(3, 5), darken(near, 0.26), rng.range(0.3, 0.42), 1.7, rng);
    }

    if (dominant === 'grass' || dominant === 'dirt' || dominant === 'forest') {
      const pseudoRidge = { yAt() { return H * 0.91; } };
      drawLoneTree(ctx, pseudoRidge, rng.range(0.91, 0.965) * W, rng.range(40, 58), darken(near, 0.3), rng.range(0.4, 0.5), rng);
      drawLoneTree(ctx, pseudoRidge, rng.range(0.26, 0.31) * W, rng.range(28, 40), darken(near, 0.26), rng.range(0.32, 0.42), rng);
    }

    if (dominant === 'swamp') {
      for (let i = 0; i < 7; i++) {
        drawReedClump(ctx, rng.range(0.79, 0.985) * W, rng.range(0.85, 0.97) * H, rng.int(10, 16), rng.range(26, 46), grassColor, accent, rng.range(0.38, 0.52), rng);
      }
      drawTrunk(ctx, rng.range(0.94, 0.985) * W, rng.range(0.9, 0.96) * H, rng.range(66, 100), darken(near, 0.3), rng.range(0.4, 0.5), rng);
      drawTrunk(ctx, rng.range(0.26, 0.31) * W, rng.range(0.9, 0.96) * H, rng.range(46, 68), darken(near, 0.28), rng.range(0.32, 0.42), rng);
    }

    if (dominant === 'desert') {
      ctx.save();
      if ('filter' in ctx) ctx.filter = 'blur(2px)';
      ctx.strokeStyle = lighten(accent, 0.16);
      ctx.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const x = (i < 3 ? rng.range(0.71, 0.96) : rng.range(0.21, 0.32)) * W;
        const y = rng.range(0.82, 0.96) * H;
        const len = rng.range(70, 150);
        ctx.globalAlpha = rng.range(0.1, 0.2);
        ctx.lineWidth = rng.range(1.5, 3);
        ctx.beginPath();
        ctx.moveTo(x - len * 0.5, y);
        ctx.quadraticCurveTo(x, y - 9, x + len * 0.5, y - 1);
        ctx.stroke();
      }
      if ('filter' in ctx) ctx.filter = 'none';
      ctx.restore();
    }

    const mist = ctx.createLinearGradient(0, H * 0.7, 0, H);
    mist.addColorStop(0, alpha(lighten(horizon, 0.35), 0));
    mist.addColorStop(0.64, alpha(lighten(horizon, 0.42), 0.08));
    mist.addColorStop(1, alpha(lighten(horizon, 0.48), 0.18));
    ctx.save();
    ctx.fillStyle = mist;
    ctx.fillRect(0, H * 0.7, W, H * 0.3);
    ctx.restore();
  }

  registry['biome-horizon'] = function (ctx, w, h, scenario, rng, seed) {
    const biomeInfo = weightedBiomes(scenario);
    const dominant = biomeInfo.dominant;
    const secondary = biomeInfo.secondary;
    const dominantEntry = BIOMES[dominant];
    const centerEntry = BIOMES[scenario.center];
    const hueShift = rng.range(-5, 5);
    const warm = dominant === 'desert' || dominant === 'dirt' || dominant === 'grass';

    const skyTop = lighten(shiftHue(centerEntry.sky, hueShift * 0.6), 0.46);
    const skyBlend = shiftHue(blendBiomeColor(scenario, 'sky'), hueShift);
    const horizonColor = mix(skyBlend, lighten(centerEntry.sky, 0.16), 0.3);
    const skyGradient = ctx.createLinearGradient(0, 0, 0, h * 0.55);
    skyGradient.addColorStop(0, skyTop);
    skyGradient.addColorStop(0.62, mix(skyTop, horizonColor, 0.62));
    skyGradient.addColorStop(1, horizonColor);
    ctx.save();
    ctx.fillStyle = skyGradient;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    const sunPos = drawSun(ctx, horizonColor, dominantEntry, warm, rng);
    drawClouds(ctx, horizonColor, rng);
    const farHaze = dominant === 'mountain' || dominant === 'snow' ? 0.17 : dominant === 'desert' ? 0.21 : 0.26;
    let farColor = mix(lighten(shiftHue(blendBiomeColor(scenario, 'far'), hueShift), 0.04), horizonColor, farHaze);
    let midColor = mix(mix(shiftHue(blendBiomeColor(scenario, 'mid'), hueShift), dominantEntry.mid, 0.3), horizonColor, 0.08);
    let nearColor = darken(mix(shiftHue(blendBiomeColor(scenario, 'near'), hueShift), dominantEntry.near, 0.33), 0.04);
    if (dominant === 'mountain' || dominant === 'snow') {
      farColor = mix(farColor, '#9fadbd', 0.38);
      midColor = mix(midColor, '#7d8b9a', 0.28);
      nearColor = mix(nearColor, mix(midColor, horizonColor, 0.38), 0.22);
    }
    if (dominant === 'desert') {
      farColor = mix(farColor, lighten(dominantEntry.far, 0.08), 0.28);
      midColor = mix(midColor, dominantEntry.mid, 0.18);
    }
    const accentColor = shiftHue(dominantEntry.accent, hueShift);
    const waterColor = mix(shiftHue(blendBiomeColor(scenario, 'water'), hueShift * 0.7), BIOMES.water.water, 0.42);
    const inkColor = mix(dominantEntry.ink, centerEntry.ink, 0.35);

    const layerShapes = [];
    for (let layer = 0; layer < 3; layer++) {
      const primaryShape = makeShape(dominant, rng, layer);
      const secondaryShape = secondary !== dominant ? makeShape(secondary, rng, layer) : null;
      const blend = secondaryShape ? rng.range(0.25, 0.35) : 0;
      layerShapes.push(combineShapes(primaryShape, secondaryShape, blend));
    }

    const farRidge = makeRidge(layerShapes[0], h * 0.47, h * (dominant === 'mountain' || dominant === 'snow' ? 0.108 : 0.1));
    const midRidge = makeRidge(layerShapes[1], h * 0.56, h * (dominant === 'mountain' || dominant === 'snow' ? 0.086 : 0.08));
    const nearRidge = makeRidge(layerShapes[2], h * 0.66, h * 0.055);

    drawRidge(ctx, farRidge, farColor, rng.range(0.5, 0.64), rng.range(5, 8));
    if (dominant === 'mountain' || dominant === 'snow') {
      drawRidge(ctx, farRidge, mix(darken(farColor, 0.22), inkColor, 0.1), 0.2, 2.6);
    }
    drawCrestShade(ctx, farRidge, darken(farColor, 0.12), 0.2, 7);

    if (dominant === 'mountain' || dominant === 'snow') {
      const peaks = (farRidge.shape.peaks || []).filter(function (p) {
        return (p.h || 1) >= 0.9;
      }).sort(function (a, b) {
        return farRidge.yAt(a.x) - farRidge.yAt(b.x);
      });
      const capCount = Math.min(peaks.length, rng.int(2, 4));
      for (let i = 0; i < capCount; i++) {
        drawSnowCap(ctx, farRidge, peaks[i], accentColor, h * rng.range(0.018, 0.026), rng.range(0.55, 0.68));
      }
    }

    if (dominant === 'desert') {
      const mesaCount = rng.int(1, 2);
      for (let i = 0; i < mesaCount; i++) {
        const side = i === 0 || rng.chance(0.68) ? rng.range(0.76, 0.92) : rng.range(0.2, 0.3);
        const x = side * W;
        drawMesa(ctx, x, farRidge.yAt(x) + rng.range(4, 14), rng.range(70, 130), rng.range(26, 42), mix(dominantEntry.mid, dominantEntry.ink, 0.22), lighten(accentColor, 0.24));
      }
    }

    const horizonHaze = ctx.createLinearGradient(0, h * 0.385, 0, h * 0.56);
    horizonHaze.addColorStop(0, alpha(lighten(horizonColor, 0.3), 0));
    horizonHaze.addColorStop(0.46, alpha(lighten(horizonColor, 0.34), 0.12));
    horizonHaze.addColorStop(1, alpha(lighten(horizonColor, 0.3), 0.03));
    ctx.save();
    ctx.fillStyle = horizonHaze;
    ctx.fillRect(0, h * 0.385, w, h * 0.175);
    ctx.restore();

    drawRidge(ctx, midRidge, midColor, rng.range(0.7, 0.82), rng.range(3, 5));
    if (dominant === 'mountain' || dominant === 'snow') {
      drawRidge(ctx, midRidge, mix(darken(midColor, 0.2), inkColor, 0.1), 0.18, 2.2);
    }
    drawCrestShade(ctx, midRidge, darken(midColor, 0.14), 0.2, 9);

    if (dominant === 'mountain' || dominant === 'snow') {
      const peaks = (midRidge.shape.peaks || []).filter(function (p) {
        return (p.h || 1) >= 0.9;
      }).sort(function (a, b) {
        return midRidge.yAt(a.x) - midRidge.yAt(b.x);
      });
      const capCount = Math.min(peaks.length, rng.int(1, 2));
      for (let i = 0; i < capCount; i++) {
        drawSnowCap(ctx, midRidge, peaks[i], accentColor, h * rng.range(0.014, 0.021), rng.range(0.42, 0.55));
      }
    }

    const treeColor = mix(darken(midColor, 0.06), dominantEntry.ink, 0.34);
    if (dominant === 'forest') {
      for (let i = 0; i < 3; i++) {
        const cx = (i === 0 || rng.chance(0.7) ? rng.range(0.73, 0.92) : rng.range(0.22, 0.3)) * W;
        drawTreeCluster(ctx, midRidge, cx, rng.int(8, 13), treeColor, rng.range(0.44, 0.58), rng.range(1.1, 1.5), rng);
      }
    } else if (dominant !== 'mountain' && dominant !== 'snow') {
      drawTreeCluster(ctx, midRidge, rng.range(0.74, 0.9) * W, rng.int(6, 10), treeColor, rng.range(0.3, 0.42), rng.range(1, 1.3), rng);
    }

    if (dominant === 'grass' || dominant === 'dirt') {
      drawHedge(ctx, midRidge, rng.range(0.75, 0.9) * W, rng.range(70, 130), darken(midColor, 0.16), 0.3, rng);
      drawLoneTree(ctx, midRidge, rng.range(0.76, 0.88) * W, rng.range(22, 32), treeColor, rng.range(0.4, 0.5), rng);
      if (rng.chance(0.6)) {
        drawHedge(ctx, midRidge, rng.range(0.22, 0.29) * W, rng.range(34, 64), darken(midColor, 0.14), 0.22, rng);
      }
    }

    if (dominant === 'swamp') {
      const mist = ctx.createLinearGradient(0, h * 0.46, 0, h * 0.65);
      mist.addColorStop(0, alpha(lighten(horizonColor, 0.42), 0));
      mist.addColorStop(0.52, alpha(lighten(horizonColor, 0.5), 0.26));
      mist.addColorStop(1, alpha(lighten(horizonColor, 0.4), 0));
      ctx.save();
      ctx.fillStyle = mist;
      ctx.fillRect(0, h * 0.46, w, h * 0.19);
      ctx.restore();
      for (let i = 0; i < 5; i++) {
        const x = rng.chance(0.72) ? rng.range(0.73, 0.91) : rng.range(0.22, 0.3);
        drawTrunk(ctx, x * W, midRidge.yAt(x * W) + rng.range(0, 4), rng.range(26, 48), darken(midColor, 0.22), rng.range(0.26, 0.36), rng);
      }
    }

    const neighbors = Object.keys(biomeInfo.weights).filter(function (key) {
      return biomeInfo.weights[key] / biomeInfo.total >= 0.15;
    });
    for (let i = 0; i < neighbors.length; i++) {
      const terrain = neighbors[i];
      const useRight = rng.chance(0.7);
      const x = (useRight ? rng.range(0.74, 0.92) : rng.range(0.22, 0.3)) * W;
      if (terrain === 'forest') {
        drawTreeCluster(ctx, midRidge, x, rng.int(7, 11), treeColor, rng.range(0.36, 0.48), rng.range(1, 1.35), rng);
      } else if (terrain === 'mountain' || terrain === 'snow') {
        const peaks = (farRidge.shape.peaks || []).slice();
        if (peaks.length) {
          const peak = peaks[rng.int(0, peaks.length - 1)];
          drawSnowCap(ctx, farRidge, peak, terrain === 'snow' ? lighten(accentColor, 0.12) : accentColor, h * rng.range(0.018, 0.026), 0.42);
        }
      } else if (terrain === 'water') {
        ctx.save();
        ctx.globalAlpha = 0.34;
        ctx.fillStyle = lighten(waterColor, 0.15);
        ctx.beginPath();
        ctx.ellipse(x, h * 0.625, rng.range(60, 110), rng.range(7, 12), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        drawRidgeGlints(ctx, lighten(waterColor, 0.5), rng, h * 0.6, h * 0.655, 0.28);
      } else if (terrain === 'desert') {
        if (dominant !== 'desert') {
          drawMesa(ctx, x, farRidge.yAt(x) + 6, rng.range(45, 80), rng.range(14, 24), mix(farColor, dominantEntry.mid, 0.15), lighten(accentColor, 0.15));
        }
        drawDuneHighlights(ctx, nearRidge, lighten(accentColor, 0.18), rng, 0.16);
      } else if (terrain === 'swamp') {
        drawReedClump(ctx, x, midRidge.yAt(x) + 4, rng.int(6, 9), rng.range(12, 22), mix(midColor, inkColor, 0.28), accentColor, 0.24, rng);
        drawTrunk(ctx, x + rng.range(-24, 24), midRidge.yAt(x) + 6, rng.range(16, 30), darken(midColor, 0.2), 0.22, rng);
      } else {
        drawHedge(ctx, midRidge, x, rng.range(50, 100), darken(midColor, 0.14), 0.22, rng);
        drawRollingHighlights(ctx, nearRidge, lighten(nearColor, 0.3), rng, 0.16);
      }
    }

    drawRidge(ctx, nearRidge, nearColor, rng.range(0.87, 0.95), rng.range(1, 3));
    drawCrestShade(ctx, nearRidge, darken(nearColor, 0.14), 0.2, 12);

    const hasWater = biomeInfo.weights.water / biomeInfo.total >= 0.15 || dominant === 'water';
    if (hasWater) {
      drawLakeBand(ctx, waterColor, horizonColor, rng, dominant === 'water' ? 0.4 : dominant === 'swamp' ? 0.36 : 0.32, sunPos.x);
    }

    if (dominant === 'desert') {
      drawDuneHighlights(ctx, nearRidge, lighten(accentColor, 0.22), rng, 0.28);
    }
    if (dominant === 'grass' || dominant === 'dirt' || dominant === 'forest') {
      drawRollingHighlights(ctx, nearRidge, lighten(nearColor, 0.28), rng, 0.2);
    }

    if (dominant === 'swamp') {
      drawReedClump(ctx, W * 0.78, nearRidge.yAt(W * 0.78) + 6, 8, 18, mix(nearColor, inkColor, 0.2), accentColor, 0.26, rng);
      drawReedClump(ctx, W * 0.27, nearRidge.yAt(W * 0.27) + 6, 6, 15, mix(nearColor, inkColor, 0.2), accentColor, 0.2, rng);
    }

    if (rng.chance(0.26)) {
      const types = ['tower', 'ruin', 'windmill', 'stones'];
      const preferred = dominant === 'desert' ? 'stones' : dominant === 'grass' ? 'windmill' : dominant === 'mountain' || dominant === 'snow' ? 'tower' : null;
      const type = preferred || rng.pick(types);
      const x = rng.range(0.8, 0.9) * W;
      drawLandmark(ctx, type, x, farRidge.yAt(x) + 2, rng.range(11, 19), mix(darken(farColor, 0.18), inkColor, 0.25), rng.range(0.24, 0.34), rng);
    }

    drawForeground(ctx, {
      near: nearColor,
      accent: accentColor,
      horizon: horizonColor,
      ink: inkColor,
    }, dominant, rng);

    const finalHaze = ctx.createLinearGradient(0, h * 0.36, 0, h * 0.59);
    finalHaze.addColorStop(0, alpha(lighten(horizonColor, 0.34), 0));
    finalHaze.addColorStop(0.45, alpha(lighten(horizonColor, 0.4), 0.11));
    finalHaze.addColorStop(1, alpha(lighten(horizonColor, 0.32), 0));
    ctx.save();
    ctx.fillStyle = finalHaze;
    ctx.fillRect(0, h * 0.36, w, h * 0.23);
    ctx.restore();

    if (rng.chance(0.3)) {
      drawBirds(ctx, alpha(inkColor, 0.6), rng);
    }

    const bottomMist = ctx.createLinearGradient(0, h * 0.7, 0, h);
    bottomMist.addColorStop(0, alpha(lighten(horizonColor, 0.42), 0));
    bottomMist.addColorStop(1, alpha(lighten(horizonColor, 0.5), 0.17));
    ctx.save();
    ctx.fillStyle = bottomMist;
    ctx.fillRect(0, h * 0.7, w, h * 0.3);
    ctx.restore();
  };
})();
