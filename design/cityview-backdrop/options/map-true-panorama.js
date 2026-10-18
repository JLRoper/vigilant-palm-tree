(function () {
  'use strict';

  const Core = window.CityBackdropCore;
  const W = Core.W;
  const H = Core.H;
  const BIOMES = Core.BIOMES;
  const clamp = Core.clamp;
  const lerp = Core.lerp;
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

  window.CityBackdropOptions = window.CityBackdropOptions || {};

  const SECTOR_POS = [0.2, 0.34, 0.48, 0.62, 0.76, 0.9];
  const PRIORITY = ['mountain', 'snow', 'water', 'forest', 'desert', 'swamp'];
  const LAYER_BASE = [0.47, 0.55, 0.64];
  const LAYER_HEIGHT = [0.18, 0.135, 0.085];
  const LAYER_BLUR = [7, 3.6, 1.2];
  const LAYER_ALPHA = [0.58, 0.74, 0.9];
  const STEP = 5;

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
    const d = (x - center) / (width || 1);
    return Math.exp(-d * d * 1.4);
  }

  function makeBounds() {
    const bounds = [0];
    for (let i = 1; i < SECTOR_POS.length; i++) {
      bounds.push((SECTOR_POS[i - 1] + SECTOR_POS[i]) * 0.5 * W);
    }
    bounds.push(W);
    return bounds;
  }

  function buildSectors(scenario, rng) {
    const rotation = rng.chance(0.5) ? 1 : 0;
    const sectors = [];
    for (let i = 0; i < 6; i++) {
      const terrain = scenario.neighbors[(i + rotation) % 6] || scenario.center;
      const biome = BIOMES[terrain] || BIOMES.grass;
      const centerX = SECTOR_POS[i] * W;
      const peaks = [];
      if (terrain === 'mountain' || terrain === 'snow') {
        const count = rng.int(1, 2);
        for (let k = 0; k < count; k++) {
          peaks.push({
            x: centerX + (k === 0 ? rng.range(-0.055, -0.004) : rng.range(0.015, 0.06)) * W,
            w: (terrain === 'mountain' ? rng.range(0.036, 0.062) : rng.range(0.045, 0.078)) * W,
            h: rng.range(0.68, 1),
          });
        }
      }
      sectors.push({
        index: i,
        terrain,
        biome,
        centerX,
        phase: rng.range(0, Math.PI * 2),
        noiseSeed: rng.int(1, 999999),
        chips: rng.range(0.86, 1.16),
        peaks,
      });
    }
    return sectors;
  }

  function pickDramatic(sectors) {
    for (let p = 0; p < PRIORITY.length; p++) {
      const matches = sectors.filter(function (sector) {
        return sector.terrain === PRIORITY[p];
      });
      if (matches.length) {
        matches.sort(function (a, b) {
          return Math.abs(b.centerX - W * 0.5) - Math.abs(a.centerX - W * 0.5);
        });
        return matches[0];
      }
    }
    return null;
  }

  function peakEnvelope(sector, x) {
    let peak = 0;
    for (let i = 0; i < sector.peaks.length; i++) {
      const p = sector.peaks[i];
      peak = Math.max(peak, gaussian(x, p.x, p.w) * p.h);
    }
    return peak;
  }

  function profileY(sector, x, layer) {
    const base = LAYER_BASE[layer] * H;
    const scale = LAYER_HEIGHT[layer] * H * sector.chips;
    const terrain = sector.terrain;
    const u = x / W * (2 + layer * 0.45) + sector.phase;

    if (terrain === 'mountain') {
      const ridge = ridged1D(u * 1.7, sector.noiseSeed + layer * 37, 2);
      const macro = 0.5 + 0.5 * noise1D(u * 0.5 + 2.2, sector.noiseSeed + 13);
      const h = scale * (0.22 * macro + 0.62 * ridge * (0.6 + 0.4 * macro) + 0.55 * peakEnvelope(sector, x));
      return base - h;
    }
    if (terrain === 'snow') {
      const ridge = ridged1D(u * 1.25, sector.noiseSeed + layer * 41, 1.25);
      const macro = 0.5 + 0.5 * noise1D(u * 0.42 + 4.1, sector.noiseSeed + 19);
      const h = scale * (0.26 * macro + 0.54 * ridge + 0.5 * peakEnvelope(sector, x));
      return base - h;
    }
    if (terrain === 'water') {
      const ripple = noise1D(u * 1.6 + 1.3, sector.noiseSeed + layer * 7);
      return base - scale * (0.04 + 0.05 * (0.5 + 0.5 * ripple));
    }
    if (terrain === 'forest') {
      const roll = 0.5 + 0.5 * noise1D(u * 0.9 + 0.6, sector.noiseSeed + layer * 23);
      const canopy = ridged1D(u * 3.4, sector.noiseSeed + layer * 29, 0.85);
      return base - scale * (0.24 * roll + 0.16 * canopy + 0.05);
    }
    if (terrain === 'desert') {
      const swell = 0.5 + 0.5 * Math.sin(u * 1.7 + 0.8);
      const smooth = 0.5 + 0.5 * noise1D(u * 0.7, sector.noiseSeed + layer * 17);
      const dune = Math.pow(0.5 + 0.5 * Math.sin(u * 2.3 + sector.phase), 1.6);
      return base - scale * (0.06 + 0.2 * (0.55 * swell * smooth + 0.45 * dune));
    }
    if (terrain === 'swamp') {
      const ragged = ridged1D(u * 4.2, sector.noiseSeed + layer * 31, 0.6);
      const low = 0.5 + 0.5 * noise1D(u * 0.8, sector.noiseSeed + layer * 11);
      return base - scale * (0.05 + 0.13 * low + 0.09 * ragged);
    }
    const roll = 0.5 + 0.5 * noise1D(u * 0.8 + 0.4, sector.noiseSeed + layer * 19);
    const bump = 0.5 + 0.5 * noise1D(u * 2.1, sector.noiseSeed + layer * 27);
    return base - scale * (0.16 + 0.2 * roll + 0.06 * bump);
  }

  function ridgeYAt(sectors, bounds, x, layer) {
    const cx = clamp(x, 0, W);
    let index = 0;
    while (index < 5 && cx >= bounds[index + 1]) index++;
    let sum = profileY(sectors[index], cx, layer);
    let weight = 1;
    if (index > 0) {
      const wCurrent = bounds[index + 1] - bounds[index];
      const wPrevious = bounds[index] - bounds[index - 1];
      const k = 0.125 * Math.min(wCurrent, wPrevious);
      const t = 1 - smoothstep(bounds[index] - k, bounds[index] + k, cx);
      if (t > 0.001) {
        sum += profileY(sectors[index - 1], cx, layer) * t;
        weight += t;
      }
    }
    if (index < 5) {
      const wCurrent = bounds[index + 1] - bounds[index];
      const wNext = bounds[index + 2] - bounds[index + 1];
      const k = 0.125 * Math.min(wCurrent, wNext);
      const t = smoothstep(bounds[index + 1] - k, bounds[index + 1] + k, cx);
      if (t > 0.001) {
        sum += profileY(sectors[index + 1], cx, layer) * t;
        weight += t;
      }
    }
    return sum / weight;
  }

  function sectorGradient(ctx, colorAt) {
    const gradient = ctx.createLinearGradient(0, 0, W, 0);
    gradient.addColorStop(0.001, colorAt(0));
    for (let i = 0; i < 6; i++) {
      gradient.addColorStop(SECTOR_POS[i], colorAt(i));
    }
    gradient.addColorStop(0.999, colorAt(5));
    return gradient;
  }

  function layerColor(sector, layer, horizonColor, hueShift) {
    const key = layer === 0 ? 'far' : layer === 1 ? 'mid' : 'near';
    let color = shiftHue(sector.biome[key] || sector.biome.mid, hueShift);
    if (sector.terrain === 'snow') {
      color = mix(color, shiftHue(sector.biome.accent, hueShift), layer === 0 ? 0.42 : layer === 1 ? 0.28 : 0.18);
    } else if (sector.terrain === 'mountain') {
      color = mix(color, shiftHue(sector.biome.mid, hueShift), 0.16);
    } else if (sector.terrain === 'water') {
      color = mix(color, shiftHue(sector.biome.water, hueShift), 0.3);
    } else if (sector.terrain === 'desert') {
      color = mix(color, shiftHue(sector.biome.accent, hueShift), 0.14);
    }
    const haze = layer === 0 ? 0.18 : layer === 1 ? 0.08 : 0.02;
    color = mix(color, horizonColor, haze);
    if (layer === 0) return lighten(color, 0.0);
    if (layer === 2) return darken(color, 0.03);
    return color;
  }

  function softFill(ctx, color, strength, blur, build) {
    ctx.save();
    if ('filter' in ctx) ctx.filter = 'blur(' + Math.max(0, blur) + 'px)';
    ctx.globalAlpha = clamp(strength, 0, 1);
    ctx.fillStyle = color;
    ctx.beginPath();
    build(ctx);
    ctx.fill();
    if ('filter' in ctx) ctx.filter = 'none';
    ctx.restore();
  }

  function softStroke(ctx, color, strength, blur, width, build) {
    ctx.save();
    if ('filter' in ctx) ctx.filter = 'blur(' + Math.max(0, blur) + 'px)';
    ctx.globalAlpha = clamp(strength, 0, 1);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    build(ctx);
    ctx.stroke();
    if ('filter' in ctx) ctx.filter = 'none';
    ctx.restore();
  }

  function drawSky(ctx, centerEntry, horizonColor, skyTop) {
    const gradient = ctx.createLinearGradient(0, 0, 0, H * 0.56);
    gradient.addColorStop(0, skyTop);
    gradient.addColorStop(0.55, mix(skyTop, horizonColor, 0.62));
    gradient.addColorStop(1, horizonColor);
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    const upper = ctx.createLinearGradient(0, 0, 0, H * 0.2);
    upper.addColorStop(0, alpha(lighten(mix(skyTop, centerEntry.accent, 0.12), 0.2), 0.16));
    upper.addColorStop(1, alpha(lighten(skyTop, 0.24), 0));
    ctx.save();
    ctx.fillStyle = upper;
    ctx.fillRect(0, 0, W, H * 0.2);
    ctx.restore();
  }

  function drawSunGlow(ctx, x, y, horizonColor, accentColor) {
    const glow = mix(lighten(horizonColor, 0.52), accentColor, 0.3);
    const rings = [
      [230, 0.08],
      [150, 0.15],
      [92, 0.16],
      [48, 0.16],
    ];
    for (let i = 0; i < rings.length; i++) {
      const radius = rings[i][0];
      const strength = rings[i][1];
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, alpha(glow, strength));
      gradient.addColorStop(0.52, alpha(glow, strength * 0.55));
      gradient.addColorStop(1, alpha(glow, 0));
      ctx.save();
      ctx.fillStyle = gradient;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      ctx.restore();
    }
    ctx.save();
    ctx.fillStyle = alpha(lighten(glow, 0.24), 0.16);
    ctx.beginPath();
    ctx.ellipse(x, y, 17, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawClouds(ctx, horizonColor, rng) {
    const count = rng.int(4, 6);
    const cloudColor = mix(lighten(horizonColor, 0.5), '#ffffff', 0.18);
    const shadowColor = mix(horizonColor, '#8a94a0', 0.3);
    for (let i = 0; i < count; i++) {
      const x = rng.range(0.05, 0.95) * W;
      const y = rng.range(0.1, 0.31) * H;
      const width = rng.range(0.07, 0.16) * W;
      const height = rng.range(0.012, 0.03) * H;
      wash(ctx, function (c) {
        c.beginPath();
        c.ellipse(x, y, width, height, 0, 0, Math.PI * 2);
        c.ellipse(x + width * 0.36, y - height * 0.3, width * 0.58, height * 0.8, 0, 0, Math.PI * 2);
        c.ellipse(x - width * 0.4, y + height * 0.12, width * 0.44, height * 0.62, 0, 0, Math.PI * 2);
      }, {
        color: cloudColor,
        alpha: rng.range(0.08, 0.14),
        blur: rng.range(9, 16),
        passes: 1,
      });
      if (rng.chance(0.5)) {
        wash(ctx, function (c) {
          c.beginPath();
          c.ellipse(x + width * 0.12, y + height * 0.5, width * 0.66, height * 0.35, 0, 0, Math.PI * 2);
        }, {
          color: shadowColor,
          alpha: 0.05,
          blur: 10,
          passes: 1,
        });
      }
    }
  }

  function drawSectorTintBand(ctx, sectors, colorAt, y0, y1, peakAlpha) {
    const strips = 18;
    const height = (y1 - y0) / strips;
    for (let k = 0; k < strips; k++) {
      const t = (k + 0.5) / strips;
      const fade = smoothstep(0, 0.36, t) * (1 - smoothstep(0.64, 1, t));
      const gradient = sectorGradient(ctx, function (i) {
        return alpha(colorAt(sectors[i], i), peakAlpha * fade);
      });
      ctx.save();
      ctx.fillStyle = gradient;
      ctx.fillRect(0, y0 + k * height - 0.5, W, height + 1);
      ctx.restore();
    }
  }

  function drawHorizonTint(ctx, sectors, horizonColor, hueShift) {
    drawSectorTintBand(ctx, sectors, function (sector) {
      return mix(lighten(shiftHue(sector.biome.far, hueShift), 0.08), horizonColor, 0.24);
    }, H * 0.34, H * 0.46, 0.17);
    drawSectorTintBand(ctx, sectors, function (sector) {
      return mix(shiftHue(sector.biome.mid, hueShift), horizonColor, 0.34);
    }, H * 0.43, H * 0.55, 0.11);
  }

  function drawHazeBand(ctx, y0, y1, color, strength) {
    const gradient = ctx.createLinearGradient(0, y0, 0, y1);
    gradient.addColorStop(0, alpha(color, 0));
    gradient.addColorStop(0.48, alpha(color, strength));
    gradient.addColorStop(1, alpha(color, 0));
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, y0 - 1, W, y1 - y0 + 2);
    ctx.restore();
  }

  function drawLayer(ctx, sectors, bounds, layer, horizonColor, hueShift) {
    const fill = sectorGradient(ctx, function (i) {
      return layerColor(sectors[i], layer, horizonColor, hueShift);
    });
    const crest = sectorGradient(ctx, function (i) {
      return darken(layerColor(sectors[i], layer, horizonColor, hueShift), layer === 0 ? 0.1 : 0.15);
    });

    wash(ctx, function (c) {
      c.fillStyle = fill;
      c.beginPath();
      c.moveTo(-60, H * 0.75);
      c.lineTo(-60, ridgeYAt(sectors, bounds, -20, layer));
      for (let x = -20; x <= W + 20; x += STEP) {
        c.lineTo(x, ridgeYAt(sectors, bounds, x, layer));
      }
      c.lineTo(W + 60, ridgeYAt(sectors, bounds, W + 20, layer));
      c.lineTo(W + 60, H * 0.75);
      c.closePath();
    }, {
      color: layerColor(sectors[0], layer, horizonColor, hueShift),
      alpha: LAYER_ALPHA[layer],
      blur: LAYER_BLUR[layer],
      passes: 2,
    });

    ctx.save();
    if ('filter' in ctx) ctx.filter = 'blur(' + (layer === 0 ? 3 : layer === 1 ? 1.6 : 0.8) + 'px)';
    ctx.globalAlpha = layer === 0 ? 0.3 : 0.36;
    ctx.strokeStyle = crest;
    ctx.lineWidth = layer === 0 ? 3 : 2;
    ctx.beginPath();
    for (let x = -20; x <= W + 20; x += STEP) {
      const y = ridgeYAt(sectors, bounds, x, layer);
      if (x === -20) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if ('filter' in ctx) ctx.filter = 'none';
    ctx.restore();
  }

  function drawSnowCaps(ctx, sectors, bounds, layer, horizonColor, hueShift, rng) {
    if (layer > 1) return;
    for (let i = 0; i < sectors.length; i++) {
      const sector = sectors[i];
      if (sector.terrain !== 'mountain' && sector.terrain !== 'snow') continue;
      for (let p = 0; p < sector.peaks.length; p++) {
        const peak = sector.peaks[p];
        if (peak.h < 0.76) continue;
        const scan0 = clamp(peak.x - peak.w * 0.8, 0, W);
        const scan1 = clamp(peak.x + peak.w * 0.8, 0, W);
        let topX = peak.x;
        let topY = Infinity;
        for (let x = scan0; x <= scan1; x += 4) {
          const y = ridgeYAt(sectors, bounds, x, layer);
          if (y < topY) {
            topY = y;
            topX = x;
          }
        }
        if (!Number.isFinite(topY)) continue;
        const width = (layer === 0 ? 30 : 22) * (0.9 + peak.h * 0.55) * (sector.terrain === 'snow' ? 1.15 : 1);
        const height = (layer === 0 ? 16 : 12) * rng.range(0.8, 1.2);
        const color = mix(
          lighten(shiftHue(sector.biome.accent, hueShift), sector.terrain === 'snow' ? 0.12 : 0.04),
          horizonColor,
          layer === 0 ? 0.28 : 0.14
        );
        wash(ctx, function (c) {
          c.beginPath();
          c.moveTo(topX, topY - 1);
          c.lineTo(topX + width * 0.52, topY + height * 0.3);
          c.lineTo(topX + width * 0.68, topY + height * 0.62);
          c.lineTo(topX + width * 0.34, topY + height * 0.48);
          c.lineTo(topX + width * 0.1, topY + height * 0.78);
          c.lineTo(topX - width * 0.16, topY + height * 0.5);
          c.lineTo(topX - width * 0.44, topY + height * 0.66);
          c.lineTo(topX - width * 0.54, topY + height * 0.28);
          c.closePath();
        }, {
          color: color,
          alpha: layer === 0 ? 0.32 : 0.26,
          blur: layer === 0 ? 2.4 : 1.5,
          passes: 1,
        });
      }
    }
  }

  function drawWaterGlints(ctx, sectors, bounds, layer, horizonColor, hueShift, rng) {
    for (let i = 0; i < sectors.length; i++) {
      const sector = sectors[i];
      if (sector.terrain !== 'water') continue;
      const baseY = ridgeYAt(sectors, bounds, sector.centerX, layer);
      const glint = mix(lighten(shiftHue(sector.biome.water, hueShift), 0.48), horizonColor, 0.2);
      const count = layer === 0 ? 3 : 2;
      for (let k = 0; k < count; k++) {
        const gx = sector.centerX + rng.range(-0.07, 0.07) * W;
        const gy = baseY + rng.range(0, 8);
        const gw = rng.range(0.012, 0.036) * W;
        softFill(ctx, glint, layer === 0 ? 0.24 : 0.17, 1.1, function (c) {
          c.ellipse(gx, gy, gw, rng.range(1.5, 3.6), 0, 0, Math.PI * 2);
        });
      }
      if (layer === 0) {
        softFill(ctx, glint, 0.16, 3, function (c) {
          c.ellipse(sector.centerX, baseY + 12, (bounds[i + 1] - bounds[i]) * 0.26, 4.2, 0, 0, Math.PI * 2);
        });
      }
    }
  }

  function drawSectorMist(ctx, sectors, bounds, layer, horizonColor, rng) {
    for (let i = 0; i < sectors.length; i++) {
      const sector = sectors[i];
      if (sector.terrain !== 'swamp') continue;
      const y = ridgeYAt(sectors, bounds, sector.centerX, layer) + (layer === 0 ? 6 : 3);
      const width = (bounds[i + 1] - bounds[i]) * rng.range(0.26, 0.4);
      softFill(ctx, lighten(horizonColor, 0.38), 0.12, 10, function (c) {
        c.ellipse(sector.centerX + rng.range(-30, 30), y, width, rng.range(5, 9), 0, 0, Math.PI * 2);
      });
    }
  }

  function drawMesas(ctx, sectors, bounds, layer, horizonColor, hueShift, rng) {
    if (layer !== 0) return;
    for (let i = 0; i < sectors.length; i++) {
      const sector = sectors[i];
      if (sector.terrain !== 'desert') continue;
      const count = rng.int(1, 2);
      for (let k = 0; k < count; k++) {
        const x = clamp(sector.centerX + rng.range(-0.05, 0.05) * W, bounds[i] + 22, bounds[i + 1] - 22);
        const y = ridgeYAt(sectors, bounds, x, layer) + rng.range(2, 7);
        const width = rng.range(34, 72);
        const height = rng.range(11, 22);
        const color = mix(layerColor(sector, layer, horizonColor, hueShift), shiftHue(sector.biome.ink, hueShift), 0.14);
        softFill(ctx, darken(color, 0.04), 0.24, 2, function (c) {
          c.moveTo(x - width * 0.5, y);
          c.lineTo(x - width * 0.42, y - height * 0.72);
          c.lineTo(x - width * 0.3, y - height);
          c.lineTo(x + width * 0.28, y - height);
          c.lineTo(x + width * 0.42, y - height * 0.7);
          c.lineTo(x + width * 0.5, y);
          c.closePath();
        });
        softStroke(ctx, lighten(shiftHue(sector.biome.accent, hueShift), 0.14), 0.16, 1.6, 1.6, function (c) {
          c.moveTo(x - width * 0.32, y - height + 2);
          c.lineTo(x + width * 0.3, y - height + 2);
        });
      }
    }
  }

  function drawTreeCluster(ctx, x, y, count, size, color, strength, rng) {
    const trees = [];
    for (let i = 0; i < count; i++) {
      trees.push({
        x: x + rng.range(-size * 2.1, size * 2.1),
        y: y + rng.range(-2, 3),
        s: size * rng.range(0.66, 1.12),
      });
    }
    softFill(ctx, color, strength, 1.3, function (c) {
      for (let i = 0; i < trees.length; i++) {
        const t = trees[i];
        c.moveTo(t.x + t.s * 0.62, t.y - t.s * 0.5);
        c.ellipse(t.x, t.y - t.s * 0.55, t.s * 0.62, t.s * 0.78, 0, 0, Math.PI * 2);
      }
    });
  }

  function drawPines(ctx, x, y, count, size, color, strength, snowColor, rng) {
    const trees = [];
    for (let i = 0; i < count; i++) {
      trees.push({
        x: x + rng.range(-size * 2.3, size * 2.3),
        y: y + rng.range(-1, 3),
        s: size * rng.range(0.68, 1.16),
      });
    }
    softFill(ctx, color, strength, 1.1, function (c) {
      for (let i = 0; i < trees.length; i++) {
        const t = trees[i];
        c.moveTo(t.x - t.s * 0.5, t.y);
        c.lineTo(t.x, t.y - t.s);
        c.lineTo(t.x + t.s * 0.5, t.y);
        c.closePath();
        c.moveTo(t.x - t.s * 0.4, t.y - t.s * 0.42);
        c.lineTo(t.x, t.y - t.s * 1.32);
        c.lineTo(t.x + t.s * 0.4, t.y - t.s * 0.42);
        c.closePath();
      }
    });
    if (snowColor) {
      softFill(ctx, snowColor, strength * 0.8, 1.2, function (c) {
        for (let i = 0; i < trees.length; i += 2) {
          const t = trees[i];
          c.moveTo(t.x - t.s * 0.2, t.y - t.s * 1.08);
          c.lineTo(t.x, t.y - t.s * 1.33);
          c.lineTo(t.x + t.s * 0.2, t.y - t.s * 1.08);
          c.lineTo(t.x, t.y - t.s * 0.98);
          c.closePath();
        }
      });
    }
  }

  function drawReeds(ctx, x, y, count, size, color, accent, strength, rng) {
    const blades = [];
    for (let i = 0; i < count; i++) {
      blades.push({
        x: x + rng.range(-size * 1.7, size * 1.7),
        y: y + rng.range(-1, 3),
        h: size * rng.range(0.7, 1.4),
        lean: rng.range(-6, 6),
      });
    }
    softStroke(ctx, color, strength, 0.6, 1.2, function (c) {
      for (let i = 0; i < blades.length; i++) {
        const b = blades[i];
        c.moveTo(b.x, b.y);
        c.quadraticCurveTo(b.x + b.lean * 0.25, b.y - b.h * 0.6, b.x + b.lean, b.y - b.h);
      }
    });
    softFill(ctx, accent, strength * 0.7, 1, function (c) {
      for (let i = 0; i < blades.length; i += 3) {
        const b = blades[i];
        c.moveTo(b.x + b.lean + 1.4, b.y - b.h);
        c.ellipse(b.x + b.lean, b.y - b.h, 1.4, 2.8, 0, 0, Math.PI * 2);
      }
    });
  }

  function drawCacti(ctx, x, y, count, size, color, strength, rng) {
    const cacti = [];
    for (let i = 0; i < count; i++) {
      cacti.push({
        x: x + rng.range(-size * 2.2, size * 2.2),
        y: y + rng.range(-1, 3),
        s: size * rng.range(0.7, 1.15),
        arm: rng.chance(0.7),
      });
    }
    softStroke(ctx, color, strength, 0.8, 2.6, function (c) {
      for (let i = 0; i < cacti.length; i++) {
        const t = cacti[i];
        c.moveTo(t.x, t.y);
        c.lineTo(t.x, t.y - t.s);
        if (t.arm) {
          c.moveTo(t.x, t.y - t.s * 0.52);
          c.lineTo(t.x - t.s * 0.32, t.y - t.s * 0.52);
          c.lineTo(t.x - t.s * 0.32, t.y - t.s * 0.76);
          c.moveTo(t.x, t.y - t.s * 0.38);
          c.lineTo(t.x + t.s * 0.3, t.y - t.s * 0.38);
          c.lineTo(t.x + t.s * 0.3, t.y - t.s * 0.6);
        }
      }
    });
  }

  function drawHedge(ctx, x, y, width, color, strength, rng) {
    const bumps = [];
    for (let i = 0; i < 7; i++) {
      bumps.push({
        x: x + rng.range(-width * 0.5, width * 0.5),
        y: y + rng.range(-1, 2),
        r: rng.range(5, 10),
      });
    }
    softFill(ctx, color, strength, 1.6, function (c) {
      for (let i = 0; i < bumps.length; i++) {
        const b = bumps[i];
        c.moveTo(b.x + b.r, b.y - b.r * 0.35);
        c.ellipse(b.x, b.y - b.r * 0.35, b.r, b.r * 0.75, 0, 0, Math.PI * 2);
      }
    });
  }

  function drawWildflowers(ctx, x, y, color, strength, rng) {
    const dots = [];
    for (let i = 0; i < 8; i++) {
      dots.push({
        x: x + rng.range(-30, 30),
        y: y - rng.range(0, 8),
      });
    }
    softFill(ctx, color, strength, 0.5, function (c) {
      for (let i = 0; i < dots.length; i++) {
        c.moveTo(dots[i].x + 1.3, dots[i].y);
        c.ellipse(dots[i].x, dots[i].y, 1.3, 1.3, 0, 0, Math.PI * 2);
      }
    });
  }

  function drawDuneHighlights(ctx, x, y, width, color, strength, rng) {
    const curves = [];
    for (let i = 0; i < 2; i++) {
      curves.push({
        x0: x + rng.range(-width * 0.4, width * 0.1),
        x1: x + rng.range(width * 0.1, width * 0.4),
        y0: y - rng.range(2, 5),
        drop: rng.range(3, 8),
      });
    }
    softStroke(ctx, color, strength, 2, 2, function (c) {
      for (let i = 0; i < curves.length; i++) {
        const k = curves[i];
        c.moveTo(k.x0, k.y0);
        c.quadraticCurveTo((k.x0 + k.x1) * 0.5, k.y0 - k.drop, k.x1, k.y0 - 1);
      }
    });
  }

  function drawScree(ctx, x, y, color, strength, rng) {
    const rocks = [];
    for (let i = 0; i < 4; i++) {
      rocks.push({
        x: x + rng.range(-34, 34),
        y: y + rng.range(-2, 3),
        w: rng.range(4, 9),
        h: rng.range(3, 6),
      });
    }
    softFill(ctx, color, strength, 1, function (c) {
      for (let i = 0; i < rocks.length; i++) {
        const r = rocks[i];
        c.moveTo(r.x - r.w, r.y);
        c.lineTo(r.x - r.w * 0.2, r.y - r.h);
        c.lineTo(r.x + r.w, r.y);
        c.closePath();
      }
    });
  }

  function drawForestLine(ctx, sectors, bounds, layer, color, strength, rng) {
    for (let i = 0; i < sectors.length; i++) {
      if (sectors[i].terrain !== 'forest') continue;
      const x0 = bounds[i] + 8;
      const x1 = bounds[i + 1] - 8;
      const trees = [];
      for (let x = x0; x <= x1; x += 9) {
        trees.push({
          x: x + rng.range(-2, 2),
          y: ridgeYAt(sectors, bounds, x, layer) + rng.range(0, 2),
          h: rng.range(6, 13),
          w: rng.range(3, 6),
        });
      }
      softFill(ctx, color, strength, 1.4, function (c) {
        for (let t = 0; t < trees.length; t++) {
          const tree = trees[t];
          c.moveTo(tree.x - tree.w, tree.y);
          c.lineTo(tree.x, tree.y - tree.h);
          c.lineTo(tree.x + tree.w, tree.y);
          c.closePath();
        }
      });
    }
  }

  function drawSwampLine(ctx, sectors, bounds, layer, color, strength, rng) {
    for (let i = 0; i < sectors.length; i++) {
      if (sectors[i].terrain !== 'swamp') continue;
      const x0 = bounds[i] + 10;
      const x1 = bounds[i + 1] - 10;
      const tufts = [];
      for (let x = x0; x <= x1; x += 11) {
        tufts.push({
          x: x + rng.range(-3, 3),
          y: ridgeYAt(sectors, bounds, x, layer) + rng.range(0, 2),
          h: rng.range(4, 10),
        });
      }
      softFill(ctx, color, strength, 1.5, function (c) {
        for (let t = 0; t < tufts.length; t++) {
          const tuft = tufts[t];
          c.moveTo(tuft.x - 3, tuft.y);
          c.lineTo(tuft.x, tuft.y - tuft.h);
          c.lineTo(tuft.x + 3, tuft.y);
          c.closePath();
          c.moveTo(tuft.x + 5, tuft.y);
          c.lineTo(tuft.x + 7, tuft.y - tuft.h * 0.7);
          c.lineTo(tuft.x + 9, tuft.y);
          c.closePath();
        }
      });
    }
  }

  function drawLandmark(ctx, kind, x, y, size, color, accent, strength, rng) {
    if (kind === 'tower') {
      softFill(ctx, color, strength, 1.1, function (c) {
        c.moveTo(x - size * 0.13, y);
        c.lineTo(x - size * 0.09, y - size * 0.9);
        c.lineTo(x - size * 0.2, y - size * 0.94);
        c.lineTo(x - size * 0.2, y - size * 1.06);
        c.lineTo(x + size * 0.2, y - size * 1.06);
        c.lineTo(x + size * 0.2, y - size * 0.94);
        c.lineTo(x + size * 0.09, y - size * 0.9);
        c.lineTo(x + size * 0.13, y);
        c.closePath();
      });
      softFill(ctx, accent, strength * 0.7, 1, function (c) {
        c.moveTo(x + size * 0.07, y - size * 1.03);
        c.lineTo(x + size * 0.62, y - size * 0.92);
        c.lineTo(x + size * 0.07, y - size * 0.81);
        c.closePath();
      });
      return;
    }
    if (kind === 'arch') {
      softFill(ctx, accent, strength, 1.7, function (c) {
        c.moveTo(x - size * 0.42, y);
        c.lineTo(x - size * 0.34, y - size * 0.7);
        c.quadraticCurveTo(x, y - size * 1.25, x + size * 0.34, y - size * 0.7);
        c.lineTo(x + size * 0.42, y);
        c.lineTo(x + size * 0.18, y);
        c.lineTo(x + size * 0.16, y - size * 0.55);
        c.quadraticCurveTo(x, y - size * 0.85, x - size * 0.16, y - size * 0.55);
        c.lineTo(x - size * 0.18, y);
        c.closePath();
      });
      return;
    }
    if (kind === 'lighthouse') {
      softFill(ctx, color, strength, 1, function (c) {
        c.moveTo(x - size * 0.19, y);
        c.lineTo(x - size * 0.1, y - size * 0.9);
        c.lineTo(x + size * 0.1, y - size * 0.9);
        c.lineTo(x + size * 0.19, y);
        c.closePath();
        c.moveTo(x - size * 0.16, y - size * 0.92);
        c.lineTo(x + size * 0.16, y - size * 0.92);
        c.lineTo(x + size * 0.12, y - size * 1.02);
        c.lineTo(x - size * 0.12, y - size * 1.02);
        c.closePath();
      });
      softFill(ctx, accent, strength * 0.8, 2.8, function (c) {
        c.moveTo(x + size * 0.13, y - size * 0.98);
        c.lineTo(x + size * 0.95, y - size * 1.14);
        c.lineTo(x + size * 0.95, y - size * 0.8);
        c.closePath();
      });
      return;
    }
    if (kind === 'boat') {
      softFill(ctx, color, strength, 1.2, function (c) {
        c.moveTo(x - size * 0.55, y - 3);
        c.quadraticCurveTo(x, y + size * 0.22, x + size * 0.55, y - 3);
        c.lineTo(x + size * 0.34, y + size * 0.1);
        c.lineTo(x - size * 0.34, y + size * 0.1);
        c.closePath();
        c.moveTo(x, y - 3);
        c.lineTo(x, y - size * 0.8);
        c.lineTo(x + size * 0.42, y - size * 0.14);
        c.lineTo(x, y - size * 0.22);
        c.closePath();
      });
      return;
    }
    if (kind === 'tree') {
      softFill(ctx, color, strength, 1.4, function (c) {
        c.moveTo(x - size * 0.09, y);
        c.lineTo(x - size * 0.05, y - size * 0.8);
        c.lineTo(x + size * 0.05, y - size * 0.8);
        c.lineTo(x + size * 0.09, y);
        c.closePath();
        c.moveTo(x + size * 0.5, y - size * 0.95);
        c.ellipse(x, y - size * 1.02, size * 0.48, size * 0.34, 0, 0, Math.PI * 2);
        c.moveTo(x + size * 0.34, y - size * 1.16);
        c.ellipse(x - size * 0.26, y - size * 1.18, size * 0.3, size * 0.24, 0, 0, Math.PI * 2);
      });
      return;
    }
    if (kind === 'ruin') {
      softFill(ctx, color, strength, 1.2, function (c) {
        c.moveTo(x - size * 0.46, y);
        c.lineTo(x - size * 0.39, y - size * 0.66);
        c.lineTo(x - size * 0.16, y - size * 0.9);
        c.lineTo(x - size * 0.05, y - size * 0.72);
        c.lineTo(x - size * 0.12, y);
        c.closePath();
        c.moveTo(x + size * 0.2, y);
        c.lineTo(x + size * 0.18, y - size * 0.55);
        c.lineTo(x + size * 0.41, y - size * 0.62);
        c.lineTo(x + size * 0.45, y);
        c.closePath();
      });
      softFill(ctx, accent, strength * 0.6, 1.4, function (c) {
        c.moveTo(x - size * 0.3, y - 1);
        c.lineTo(x + size * 0.02, y - size * 0.12);
        c.lineTo(x + size * 0.24, y - 1);
        c.closePath();
      });
      return;
    }
    const stones = [];
    for (let i = 0; i < 5; i++) {
      stones.push({
        x: x + (i - 2) * size * 0.34 + rng.range(-2, 2),
        h: size * rng.range(0.42, 0.95),
        w: size * rng.range(0.09, 0.15),
        lean: rng.range(-0.14, 0.14),
      });
    }
    softFill(ctx, color, strength, 1.2, function (c) {
      for (let i = 0; i < stones.length; i++) {
        const s = stones[i];
        c.moveTo(s.x - s.w, y);
        c.lineTo(s.x - s.w * 0.7 + s.lean * s.h, y - s.h);
        c.lineTo(s.x + s.w * 0.7 + s.lean * s.h, y - s.h);
        c.lineTo(s.x + s.w, y);
        c.closePath();
      }
      c.moveTo(stones[1].x + stones[1].w, y - stones[1].h + 2);
      c.lineTo(stones[2].x - stones[2].w, y - stones[2].h + 1);
      c.lineTo(stones[2].x - stones[2].w, y - stones[2].h - 4);
      c.lineTo(stones[1].x + stones[1].w, y - stones[1].h - 3);
      c.closePath();
    });
  }

  function drawRiver(ctx, startX, startY, side, waterColor, horizonColor, rng) {
    const endX = side < 0 ? rng.range(0.05, 0.13) * W : rng.range(0.87, 0.95) * W;
    const p0 = { x: startX, y: startY };
    const p1 = { x: startX + side * rng.range(18, 46), y: H * rng.range(0.57, 0.63) };
    const p2 = { x: endX - side * rng.range(30, 90), y: H * rng.range(0.72, 0.8) };
    const p3 = { x: endX, y: H * 1.03 };
    const samples = 44;
    const left = [];
    const right = [];
    const centers = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const it = 1 - t;
      const x = it * it * it * p0.x + 3 * it * it * t * p1.x + 3 * it * t * t * p2.x + t * t * t * p3.x;
      const y = it * it * it * p0.y + 3 * it * it * t * p1.y + 3 * it * t * t * p2.y + t * t * t * p3.y;
      const dx = 3 * it * it * (p1.x - p0.x) + 6 * it * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
      const dy = 3 * it * it * (p1.y - p0.y) + 6 * it * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y);
      const length = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / length;
      const ny = dx / length;
      const width = lerp(3.5, 17, smoothstep(0, 1, t)) * (1 + 0.16 * Math.sin(t * 13 + rng.range(0, 0.2)));
      left.push({ x: x + nx * width, y: y + ny * width });
      right.push({ x: x - nx * width, y: y - ny * width });
      centers.push({ x: x, y: y, w: width });
    }
    const color = mix(waterColor, horizonColor, 0.24);
    softFill(ctx, color, 0.16, 2.6, function (c) {
      c.moveTo(left[0].x, left[0].y);
      for (let i = 1; i < left.length; i++) c.lineTo(left[i].x, left[i].y);
      for (let i = right.length - 1; i >= 0; i--) c.lineTo(right[i].x, right[i].y);
      c.closePath();
    });
    softFill(ctx, lighten(waterColor, 0.24), 0.10, 3.4, function (c) {
      for (let i = 3; i < centers.length; i += 5) {
        const p = centers[i];
        c.moveTo(p.x + p.w * 0.45, p.y);
        c.ellipse(p.x, p.y, p.w * 0.42, 1.2, 0, 0, Math.PI * 2);
      }
    });
    softFill(ctx, lighten(waterColor, 0.4), 0.15, 1.6, function (c) {
      for (let i = 0; i < 5; i++) {
        const gx = startX + rng.range(-70, 70);
        const gy = startY + rng.range(2, 16);
        c.ellipse(gx, gy, rng.range(7, 18), rng.range(1.2, 2.4), 0, 0, Math.PI * 2);
      }
    });
  }

  function drawMotifs(ctx, sectors, bounds, hueShift, horizonColor, inkColor, rng) {
    const lineColor = mix(darken(inkColor, 0.05), horizonColor, 0.2);
    drawForestLine(ctx, sectors, bounds, 1, lineColor, 0.30, rng);
    drawSwampLine(ctx, sectors, bounds, 2, darken(lineColor, 0.04), 0.18, rng);
    for (let i = 0; i < sectors.length; i++) {
      const sector = sectors[i];
      const x0 = bounds[i];
      const x1 = bounds[i + 1];
      const width = x1 - x0;
      const outward = sector.centerX < W * 0.5 ? -1 : 1;
      const ax = clamp(sector.centerX + outward * width * 0.26, x0 + 10, x1 - 10);
      const bx = clamp(sector.centerX - outward * width * 0.26, x0 + 10, x1 - 10);
      const nearY = ridgeYAt(sectors, bounds, ax, 2) + 2;
      const nearYB = ridgeYAt(sectors, bounds, bx, 2) + 2;
      const midY = ridgeYAt(sectors, bounds, ax, 1) + 1;
      const dark = mix(darken(shiftHue(sector.biome.near, hueShift), 0.06), inkColor, 0.28);
      const accent = lighten(shiftHue(sector.biome.accent, hueShift), 0.1);

      if (sector.terrain === 'forest') {
        drawTreeCluster(ctx, ax, nearY, 8, 10, dark, 0.32, rng);
        drawTreeCluster(ctx, bx, nearYB, 6, 8, dark, 0.24, rng);
      } else if (sector.terrain === 'snow') {
        drawPines(ctx, ax, nearY, 7, 9, dark, 0.32, lighten(accent, 0.2), rng);
        drawPines(ctx, bx, nearYB, 5, 7, dark, 0.22, lighten(accent, 0.2), rng);
      } else if (sector.terrain === 'mountain') {
        drawScree(ctx, ax, nearY + 1, dark, 0.26, rng);
        drawPines(ctx, bx, nearYB, 4, 7, dark, 0.18, null, rng);
      } else if (sector.terrain === 'water') {
        drawReeds(ctx, ax, nearY, 6, 14, dark, accent, 0.26, rng);
        drawReeds(ctx, bx, nearYB + 1, 5, 12, dark, accent, 0.2, rng);
      } else if (sector.terrain === 'desert') {
        drawCacti(ctx, ax, nearY, 4, 12, mix(dark, sector.biome.ink, 0.3), 0.3, rng);
        drawDuneHighlights(ctx, ax, nearY, width * 0.42, lighten(accent, 0.18), 0.16, rng);
        drawDuneHighlights(ctx, bx, nearYB, width * 0.3, lighten(accent, 0.18), 0.12, rng);
      } else if (sector.terrain === 'swamp') {
        drawReeds(ctx, ax, nearY, 7, 13, dark, accent, 0.28, rng);
        drawReeds(ctx, bx, nearYB + 1, 5, 11, dark, accent, 0.2, rng);
      } else {
        drawHedge(ctx, ax, nearY, width * 0.34, dark, 0.26, rng);
        drawWildflowers(ctx, bx, nearYB, accent, 0.32, rng);
        if (midY < nearY - 20) {
          drawHedge(ctx, bx, midY, width * 0.22, dark, 0.14, rng);
        }
      }
    }
  }

  function drawBank(ctx, side, color, rng) {
    const phase = rng.range(0, Math.PI * 2);
    const edge = W * 0.32;
    const x0 = side < 0 ? -50 : W - edge;
    const x1 = side < 0 ? edge : W + 50;
    const points = [];
    const steps = 26;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = lerp(x0, x1, t);
      const fade = side < 0 ? t : 1 - t;
      const y = H * (0.815 + fade * 0.235) +
        Math.sin(t * 9 + phase) * H * 0.012 +
        Math.sin(t * 21 + phase * 1.7) * H * 0.006;
      points.push({ x: x, y: y });
    }
    softFill(ctx, color, 0.3, 8, function (c) {
      c.moveTo(points[0].x, H + 40);
      for (let i = 0; i < points.length; i++) c.lineTo(points[i].x, points[i].y);
      c.lineTo(points[points.length - 1].x, H + 40);
      c.closePath();
    });
  }

  function drawCornerMist(ctx, cx, cy, rx, ry, color, strength) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    gradient.addColorStop(0, alpha(color, strength));
    gradient.addColorStop(0.58, alpha(color, strength * 0.5));
    gradient.addColorStop(1, alpha(color, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawForegroundTexture(ctx, scenario, rng, horizonColor) {
    const near = blendBiomeColor(scenario, 'near');
    const ink = blendBiomeColor(scenario, 'ink');
    const tuft = mix(near, ink, 0.35);
    const zones = [[W * 0.255, W * 0.32], [W * 0.69, W * 0.985]];
    for (let z = 0; z < zones.length; z++) {
      const count = z === 0 ? 16 : 34;
      for (let i = 0; i < count; i++) {
        const x = rng.range(zones[z][0], zones[z][1]);
        const y = rng.range(H * 0.80, H * 0.985);
        const h = rng.range(8, 26);
        const bend = rng.range(-8, 8);
        ctx.save();
        ctx.globalAlpha = rng.range(0.10, 0.22);
        ctx.strokeStyle = tuft;
        ctx.lineWidth = rng.range(1, 2.2);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + bend * 0.4, y - h * 0.55, x + bend, y - h);
        ctx.stroke();
        ctx.restore();
      }
    }
    for (let i = 0; i < 8; i++) {
      const x = rng.chance(0.5) ? rng.range(W * 0.26, W * 0.33) : rng.range(W * 0.70, W * 0.97);
      const y = rng.range(H * 0.82, H * 0.97);
      ctx.save();
      ctx.globalAlpha = rng.range(0.08, 0.16);
      ctx.fillStyle = mix(ink, horizonColor, 0.35);
      ctx.beginPath();
      ctx.ellipse(x, y, rng.range(4, 12), rng.range(2, 5), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawBirds(ctx, color, rng) {
    if (!rng.chance(0.55)) return;
    const count = rng.int(3, 5);
    const rightSide = rng.chance(0.5);
    const baseX = rightSide ? W * rng.range(0.58, 0.68) : W * rng.range(0.2, 0.3);
    for (let i = 0; i < count; i++) {
      const x = baseX + rng.range(0, 0.18) * W;
      const y = H * rng.range(0.16, 0.3);
      const s = rng.range(3, 6);
      softStroke(ctx, color, 0.2, 0.5, 1, function (c) {
        c.moveTo(x - s, y);
        c.quadraticCurveTo(x - s * 0.4, y - s * 0.55, x, y);
        c.quadraticCurveTo(x + s * 0.4, y - s * 0.55, x + s, y);
      });
    }
  }

  window.CityBackdropOptions['map-true-panorama'] = function (ctx, w, h, scenario, rng, seed) {
    const info = weightedBiomes(scenario);
    const centerEntry = BIOMES[scenario.center] || BIOMES.grass;
    const hueShift = rng.range(-5, 5);
    const sectors = buildSectors(scenario, rng);
    const bounds = makeBounds();
    const dramatic = pickDramatic(sectors);
    const dominantEntry = BIOMES[info.dominant] || centerEntry;

    const skyTop = lighten(shiftHue(centerEntry.sky, hueShift * 0.5), 0.44);
    const skyBlend = shiftHue(blendBiomeColor(scenario, 'sky'), hueShift);
    const horizonColor = mix(skyBlend, lighten(shiftHue(centerEntry.sky, hueShift), 0.14), 0.32);
    const accentColor = mix(shiftHue(centerEntry.accent, hueShift), shiftHue(dominantEntry.accent, hueShift), 0.32);
    const inkColor = mix(shiftHue(centerEntry.ink, hueShift), shiftHue(dominantEntry.ink, hueShift), 0.36);
    const waterColor = mix(shiftHue(blendBiomeColor(scenario, 'water'), hueShift * 0.7), BIOMES.water.water, 0.4);

    let sunX;
    if (dramatic) {
      sunX = dramatic.centerX < W * 0.5 ? W * rng.range(0.68, 0.86) : W * rng.range(0.14, 0.32);
    } else {
      sunX = W * (rng.chance(0.5) ? rng.range(0.13, 0.3) : rng.range(0.7, 0.87));
    }
    const sunY = H * rng.range(0.2, 0.3);

    drawSky(ctx, centerEntry, horizonColor, skyTop);
    drawSunGlow(ctx, sunX, sunY, horizonColor, accentColor);
    drawClouds(ctx, horizonColor, rng);
    drawHorizonTint(ctx, sectors, horizonColor, hueShift);

    drawLayer(ctx, sectors, bounds, 0, horizonColor, hueShift);
    drawSnowCaps(ctx, sectors, bounds, 0, horizonColor, hueShift, rng);
    drawMesas(ctx, sectors, bounds, 0, horizonColor, hueShift, rng);
    drawWaterGlints(ctx, sectors, bounds, 0, horizonColor, hueShift, rng);
    drawSectorMist(ctx, sectors, bounds, 0, horizonColor, rng);
    drawHazeBand(ctx, H * 0.39, H * 0.57, lighten(horizonColor, 0.24), 0.06);

    drawLayer(ctx, sectors, bounds, 1, horizonColor, hueShift);
    drawSnowCaps(ctx, sectors, bounds, 1, horizonColor, hueShift, rng);
    drawWaterGlints(ctx, sectors, bounds, 1, horizonColor, hueShift, rng);
    drawSectorMist(ctx, sectors, bounds, 1, horizonColor, rng);
    drawHazeBand(ctx, H * 0.47, H * 0.63, lighten(horizonColor, 0.24), 0.05);

    if (dramatic) {
      const left = dramatic.centerX < W * 0.5;
      const lx = left
        ? clamp(dramatic.centerX - rng.range(0.02, 0.06) * W, W * 0.14, W * 0.29)
        : clamp(dramatic.centerX + rng.range(0.02, 0.06) * W, W * 0.71, W * 0.86);
      const layer = dramatic.terrain === 'mountain' || dramatic.terrain === 'snow' ? 0 : 1;
      const ly = ridgeYAt(sectors, bounds, lx, layer) + 1;
      const size = rng.range(26, 38);
      const kind = dramatic.terrain === 'mountain' ? 'tower'
        : dramatic.terrain === 'snow' ? 'arch'
          : dramatic.terrain === 'water' ? (rng.chance(0.55) ? 'lighthouse' : 'boat')
            : dramatic.terrain === 'forest' ? 'tree'
              : dramatic.terrain === 'desert' ? 'ruin'
                : 'stones';
      const color = mix(darken(shiftHue(dramatic.biome.ink, hueShift), 0.04), layerColor(dramatic, layer, horizonColor, hueShift), 0.4);
      const accent = mix(lighten(shiftHue(dramatic.biome.accent, hueShift), 0.12), horizonColor, 0.26);
      drawLandmark(ctx, kind, lx, ly, size, color, accent, 0.4, rng);
    }

    drawLayer(ctx, sectors, bounds, 2, horizonColor, hueShift);

    const floorColor = mix(blendBiomeColor(scenario, 'near'), horizonColor, 0.28);
    const floor = ctx.createLinearGradient(0, H * 0.72, 0, H);
    floor.addColorStop(0, alpha(floorColor, 0));
    floor.addColorStop(0.55, alpha(floorColor, 0.22));
    floor.addColorStop(1, alpha(floorColor, 0.26));
    ctx.save();
    ctx.fillStyle = floor;
    ctx.fillRect(0, H * 0.72, W, H * 0.30);
    ctx.restore();

    let waterSector = null;
    for (let i = 0; i < sectors.length; i++) {
      if (sectors[i].terrain !== 'water') continue;
      if (!waterSector || Math.abs(sectors[i].centerX - W * 0.5) > Math.abs(waterSector.centerX - W * 0.5)) {
        waterSector = sectors[i];
      }
    }
    if (waterSector && (scenario.center === 'water' || (info.weights.water || 0) / info.total >= 0.33)) {
      const startX = waterSector.centerX + rng.range(-0.03, 0.03) * W;
      const startY = ridgeYAt(sectors, bounds, startX, 0) + H * 0.012;
      const side = startX < W * 0.5 ? -1 : 1;
      drawRiver(ctx, startX, startY, side, waterColor, horizonColor, rng);
    }

    const midBand = ctx.createLinearGradient(0, H * 0.60, 0, H * 0.75);
    midBand.addColorStop(0, alpha(blendBiomeColor(scenario, 'mid'), 0));
    midBand.addColorStop(0.55, alpha(blendBiomeColor(scenario, 'mid'), 0.12));
    midBand.addColorStop(1, alpha(blendBiomeColor(scenario, 'mid'), 0));
    ctx.save(); ctx.fillStyle = midBand; ctx.fillRect(0, H * 0.60, W, H * 0.15); ctx.restore();

    drawMotifs(ctx, sectors, bounds, hueShift, horizonColor, inkColor, rng);

    drawForegroundTexture(ctx, scenario, rng, horizonColor);

    const leftBankColor = mix(
      layerColor(sectors[0], 2, horizonColor, hueShift),
      layerColor(sectors[1], 2, horizonColor, hueShift),
      0.55
    );
    const rightBankColor = mix(
      layerColor(sectors[5], 2, horizonColor, hueShift),
      layerColor(sectors[4], 2, horizonColor, hueShift),
      0.55
    );
    drawBank(ctx, -1, mix(leftBankColor, inkColor, 0.18), rng);
    drawBank(ctx, 1, mix(rightBankColor, inkColor, 0.18), rng);

    drawCornerMist(ctx, W * 0.06, H * 0.85, W * 0.24, H * 0.15, lighten(horizonColor, 0.42), 0.16);
    drawCornerMist(ctx, W * 0.94, H * 0.85, W * 0.24, H * 0.15, lighten(horizonColor, 0.42), 0.16);

    const bottomMist = ctx.createLinearGradient(0, H * 0.72, 0, H);
    bottomMist.addColorStop(0, alpha(lighten(horizonColor, 0.42), 0));
    bottomMist.addColorStop(0.64, alpha(lighten(horizonColor, 0.46), 0.06));
    bottomMist.addColorStop(1, alpha(lighten(horizonColor, 0.52), 0.13));
    ctx.save();
    ctx.fillStyle = bottomMist;
    ctx.fillRect(0, H * 0.72, W, H * 0.28);
    ctx.restore();

    drawBirds(ctx, mix(inkColor, horizonColor, 0.25), rng);
  };
})();
