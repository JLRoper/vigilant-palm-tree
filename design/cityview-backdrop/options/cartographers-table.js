(function () {
  'use strict';

  const Core = window.CityBackdropCore;
  const registry = window.CityBackdropOptions = window.CityBackdropOptions || {};

  const INK = '#5a4a32';
  const INK_DEEP = '#4a3a27';
  const INK_SOFT = '#6b5738';
  const WATER_INK = '#5b7480';
  const SEAL_RED = '#8b3a30';
  const SNOW = '#f8f3e8';
  const PAPER = '#efe2c2';

  const clamp = Core.clamp;
  const mix = Core.mix;
  const lighten = Core.lighten;
  const darken = Core.darken;
  const alpha = Core.alpha;
  const weightedBiomes = Core.weightedBiomes;
  const wash = Core.wash;

  const SECTORS = [
    { fx: 0.805, fy: 0.445, sx: 0.07, sy: 0.085, size: 1, minX: 900 },
    { fx: 0.72, fy: 0.245, sx: 0.06, sy: 0.07, size: 1, minX: 800 },
    { fx: 0.285, fy: 0.235, sx: 0.05, sy: 0.07, size: 0.9, minX: 330 },
    { fx: 0.235, fy: 0.43, sx: 0.022, sy: 0.07, size: 0.58, minX: 318, compact: true },
    { fx: 0.3, fy: 0.745, sx: 0.055, sy: 0.075, size: 0.95, minX: 350 },
    { fx: 0.625, fy: 0.775, sx: 0.07, sy: 0.06, size: 1, minX: 600 },
  ];

  function tracePath(c, pts, close) {
    if (!pts.length) return;
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
    if (close) c.closePath();
  }

  function inkLine(ctx, pts, rng, opts) {
    if (!pts || pts.length < 2) return;
    const o = opts || {};
    const width = o.width === undefined ? 1.1 : o.width;
    const baseAlpha = o.alpha === undefined ? 0.62 : o.alpha;
    const amp = o.jitter === undefined ? 0.8 : o.jitter;
    const passes = o.passes === undefined ? 2 : o.passes;
    const color = o.color || INK;
    const close = !!o.close;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (o.dash) ctx.setLineDash(o.dash);
    for (let pass = 0; pass < passes; pass++) {
      ctx.globalAlpha = pass === 0 ? baseAlpha : baseAlpha * 0.66;
      ctx.strokeStyle = pass === 0 ? color : mix(color, INK_SOFT, 0.35);
      ctx.lineWidth = width * (pass === 0 ? 1 : 0.74);
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const x = pts[i].x + rng.range(-amp, amp);
        const y = pts[i].y + rng.range(-amp, amp);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      if (close) ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  function blobRing(cx, cy, rx, ry, rng, count, ampX, ampY) {
    const n = count || 32;
    const ax = ampX === undefined ? 0.08 : ampX;
    const ay = ampY === undefined ? 0.05 : ampY;
    const p1 = rng.range(0, Math.PI * 2);
    const p2 = rng.range(0, Math.PI * 2);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      const k = 1 + Math.sin(t * 2 + p1) * ax + Math.sin(t * 3 + p2) * ay;
      pts.push({ x: cx + Math.cos(t) * rx * k, y: cy + Math.sin(t) * ry * k });
    }
    return pts;
  }

  function scaleRing(pts, cx, cy, s) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      out.push({ x: cx + (pts[i].x - cx) * s, y: cy + (pts[i].y - cy) * s });
    }
    return out;
  }

  function sampleCurve(ctrl, steps) {
    const pts = [];
    for (let seg = 0; seg < ctrl.length - 1; seg++) {
      const p0 = ctrl[Math.max(0, seg - 1)];
      const p1 = ctrl[seg];
      const p2 = ctrl[seg + 1];
      const p3 = ctrl[Math.min(ctrl.length - 1, seg + 2)];
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const t2 = t * t;
        const t3 = t2 * t;
        pts.push({
          x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        });
      }
    }
    const last = ctrl[ctrl.length - 1];
    pts.push({ x: last.x, y: last.y });
    return pts;
  }

  function offsetPts(pts, dist) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      out.push({ x: pts[i].x - (dy / len) * dist, y: pts[i].y + (dx / len) * dist });
    }
    return out;
  }

  function washShape(ctx, pts, color, a, blur, passes) {
    wash(ctx, function (c) {
      tracePath(c, pts, true);
    }, { color, alpha: a, blur: blur === undefined ? 4 : blur, passes: passes === undefined ? 1 : passes });
  }

  function softStroke(ctx, pts, rng, color, width, a, blur) {
    ctx.save();
    const canFilter = 'filter' in ctx;
    if (canFilter) ctx.filter = 'blur(' + Math.max(0, blur) + 'px)';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.globalAlpha = a * (pass === 0 ? 1 : 0.6);
      ctx.strokeStyle = color;
      ctx.lineWidth = width * (pass === 0 ? 1 : 1.12);
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const x = pts[i].x + rng.range(-0.8, 0.8);
        const y = pts[i].y + rng.range(-0.8, 0.8);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    if (canFilter) ctx.filter = 'none';
    ctx.restore();
  }

  function drawParchment(ctx, W, H, center, rng) {
    let tint = PAPER;
    if (center === 'desert' || center === 'dirt') tint = mix(tint, '#eeddb6', 0.45);
    else if (center === 'snow' || center === 'mountain') tint = mix(tint, '#eee7cf', 0.35);
    else if (center === 'water' || center === 'swamp') tint = mix(tint, '#e9dfc2', 0.4);
    else if (center === 'forest') tint = mix(tint, '#ebdfba', 0.3);
    tint = mix(tint, rng.pick(['#f0e4c6', '#ece0bf', '#f2e6ca', '#eee2c1']), rng.range(0.12, 0.35));

    const grad = ctx.createRadialGradient(W * 0.45, H * 0.4, Math.min(W, H) * 0.04, W * 0.5, H * 0.5, Math.max(W, H) * 0.74);
    grad.addColorStop(0, lighten(tint, 0.12));
    grad.addColorStop(0.62, tint);
    grad.addColorStop(1, mix(tint, '#c9b285', 0.14));
    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    const fiberColor = mix(INK, '#b49b6d', 0.55);
    const fiberCount = Math.round((W * H) / 2800);
    ctx.save();
    ctx.strokeStyle = fiberColor;
    ctx.lineWidth = 1;
    for (let i = 0; i < fiberCount; i++) {
      const x = rng.range(-10, W + 10);
      const y = rng.range(-10, H + 10);
      const len = rng.range(1.5, 7);
      ctx.globalAlpha = rng.range(0.02, 0.055);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y + rng.range(-0.7, 0.7));
      ctx.stroke();
    }
    for (let i = 0; i < 90; i++) {
      ctx.globalAlpha = rng.range(0.04, 0.11);
      ctx.fillStyle = rng.chance(0.5) ? fiberColor : mix(INK, '#7c6440', 0.4);
      ctx.beginPath();
      ctx.arc(rng.range(0, W), rng.range(0, H), rng.range(0.4, 1.1), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const stainCount = rng.int(6, 10);
    for (let i = 0; i < stainCount; i++) {
      const cx = rng.range(-0.04, 1.04) * W;
      const cy = rng.range(-0.04, 1.04) * H;
      const rx = rng.range(0.09, 0.27) * W;
      const ry = rng.range(0.05, 0.18) * H;
      const color = rng.pick(['#d8c39a', '#c9b285', '#d3bd92']);
      const ring = blobRing(cx, cy, rx, ry, rng, 26, 0.11, 0.07);
      washShape(ctx, ring, color, rng.range(0.06, 0.1), rng.range(14, 28), 1);
      if (rng.chance(0.45)) {
        inkLine(ctx, scaleRing(ring, cx, cy, 0.92), rng, {
          color: mix(color, INK, 0.2),
          width: 0.8,
          alpha: 0.035,
          jitter: 2.4,
          passes: 1,
          close: true,
        });
      }
    }

    const gridColor = mix(INK_SOFT, '#9a835c', 0.4);
    const step = Math.min(W, H) * 0.105;
    for (let x = step * 0.72; x < W + step; x += step) {
      if (rng.chance(0.1)) continue;
      const pts = [];
      for (let y = -20; y <= H + 20; y += 42) pts.push({ x: x + Math.sin(y * 0.017 + rng.range(0, 6.28)) * 1.4, y });
      inkLine(ctx, pts, rng, { color: gridColor, width: 0.7, alpha: rng.range(0.04, 0.07), jitter: 0.55, passes: 1 });
    }
    for (let y = step * 0.68; y < H + step; y += step) {
      if (rng.chance(0.1)) continue;
      const pts = [];
      for (let x = -20; x <= W + 20; x += 42) pts.push({ x, y: y + Math.sin(x * 0.015 + rng.range(0, 6.28)) * 1.3 });
      inkLine(ctx, pts, rng, { color: gridColor, width: 0.7, alpha: rng.range(0.04, 0.07), jitter: 0.55, passes: 1 });
    }
  }

  function drawSplatters(ctx, W, H, infos, rng) {
    ctx.save();
    for (let i = 0; i < 10; i++) {
      const base = infos.length
        ? infos[rng.int(0, infos.length - 1)]
        : { x: rng.range(0.3, 0.95) * W, y: rng.range(0.2, 0.9) * H };
      const x = base.x + rng.range(-70, 70);
      const y = base.y + rng.range(-60, 60);
      ctx.globalAlpha = rng.range(0.08, 0.2);
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(x, y, rng.range(0.5, 1.7), 0, Math.PI * 2);
      ctx.fill();
    }
    if (infos.length && rng.chance(0.6)) {
      const bleed = infos[rng.int(0, infos.length - 1)];
      const ring = blobRing(
        bleed.x + rng.range(-40, 40),
        bleed.y + rng.range(-30, 30),
        rng.range(7, 13),
        rng.range(4, 8),
        rng,
        14,
        0.2,
        0.14
      );
      washShape(ctx, ring, INK, 0.09, 5, 1);
    }
    ctx.restore();
  }

  function drawParcel(ctx, cx, cy, w, h, rot, rng, opts) {
    const o = opts || {};
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    function at(dx, dy) {
      return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
    }
    const hw = w / 2;
    const hh = h / 2;
    const pts = [at(-hw, -hh), at(hw, -hh), at(hw, hh), at(-hw, hh)];
    const hatchAlpha = o.hatchAlpha === undefined ? rng.range(0.2, 0.34) : o.hatchAlpha;
    const dir = o.dir === undefined ? (rng.chance(0.5) ? 1 : -1) : o.dir;
    ctx.save();
    tracePath(ctx, pts, true);
    ctx.clip();
    const stepX = rng.range(4.5, 7);
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = o.color || INK;
      ctx.lineWidth = pass === 0 ? rng.range(0.55, 0.8) : 0.6;
      ctx.globalAlpha = hatchAlpha * (pass === 0 ? 1 : 0.55);
      ctx.beginPath();
      for (let x = -w; x <= w; x += stepX) {
        const off = pass === 0 ? 0 : rng.range(-1.2, 1.2);
        ctx.moveTo(x + off, -h);
        ctx.lineTo(x + off + dir * 3.2, h);
      }
      ctx.stroke();
    }
    ctx.restore();
    inkLine(ctx, pts, rng, {
      color: o.color || INK,
      width: o.width === undefined ? 0.9 : o.width,
      alpha: o.alpha === undefined ? 0.48 : o.alpha,
      jitter: 0.7,
      close: true,
    });
  }

  function drawHedgerow(ctx, x0, x1, y, rng, opts) {
    const o = opts || {};
    const step = o.step === undefined ? rng.range(7, 10) : o.step;
    ctx.save();
    ctx.fillStyle = o.color || INK;
    for (let x = x0; x <= x1; x += step) {
      ctx.globalAlpha = rng.range(0.24, 0.46);
      ctx.beginPath();
      ctx.arc(x + rng.range(-1, 1), y + rng.range(-1.6, 1.6), rng.range(1, 2.2), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawStarSpike(ctx, cx, cy, ang, len, halfWidth, rng) {
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const px = -sin;
    const py = cos;
    const tip = { x: cx + cos * len, y: cy + sin * len };
    const sideA = { x: cx + cos * len * 0.4 + px * halfWidth, y: cy + sin * len * 0.4 + py * halfWidth };
    const sideB = { x: cx + cos * len * 0.4 - px * halfWidth, y: cy + sin * len * 0.4 - py * halfWidth };
    const center = { x: cx, y: cy };
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = INK;
    tracePath(ctx, [tip, sideA, center], true);
    ctx.fill();
    ctx.globalAlpha = 0.14;
    tracePath(ctx, [tip, sideB, center], true);
    ctx.fill();
    ctx.restore();
    inkLine(ctx, [tip, sideA], rng, { width: 0.85, alpha: 0.52, passes: 1, jitter: 0.45 });
    inkLine(ctx, [tip, sideB], rng, { width: 0.85, alpha: 0.52, passes: 1, jitter: 0.45 });
  }

  function drawCompassRose(ctx, cx, cy, r, rng) {
    const outer = blobRing(cx, cy, r, r, rng, 42, 0.01, 0.007);
    inkLine(ctx, outer, rng, { width: 1.1, alpha: 0.56, jitter: 0.55, close: true });
    inkLine(ctx, blobRing(cx, cy, r * 0.73, r * 0.73, rng, 34, 0.008, 0.006), rng, {
      width: 0.75,
      alpha: 0.3,
      jitter: 0.45,
      passes: 1,
      close: true,
    });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r0 = r * (i % 4 === 0 ? 0.84 : 0.9);
      const r1 = r * 0.97;
      inkLine(
        ctx,
        [
          { x: cx + Math.cos(a) * r0, y: cy + Math.sin(a) * r0 },
          { x: cx + Math.cos(a) * r1, y: cy + Math.sin(a) * r1 },
        ],
        rng,
        { width: 0.7, alpha: 0.34, passes: 1, jitter: 0.35 }
      );
    }
    for (let i = 0; i < 4; i++) {
      drawStarSpike(ctx, cx, cy, -Math.PI / 2 + (i * Math.PI) / 2, r * 0.93, r * 0.16, rng);
    }
    for (let i = 0; i < 4; i++) {
      drawStarSpike(ctx, cx, cy, -Math.PI / 4 + (i * Math.PI) / 2, r * 0.58, r * 0.09, rng);
    }
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.075, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = INK_DEEP;
    ctx.font = '600 ' + Math.round(r * 0.34) + 'px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', cx, cy - r - r * 0.4);
    ctx.restore();
  }

  function drawWaxSeal(ctx, cx, cy, r, rng) {
    const ring = blobRing(cx, cy, r, r * 0.97, rng, 22, 0.06, 0.045);
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#3a1611';
    ctx.beginPath();
    ctx.ellipse(cx + 1.8, cy + 2.2, r * 1.05, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = SEAL_RED;
    tracePath(ctx, ring, true);
    ctx.fill();
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = darken(SEAL_RED, 0.28);
    ctx.lineWidth = 0.9;
    tracePath(ctx, ring, true);
    ctx.stroke();
    ctx.restore();

    const inner = blobRing(cx, cy, r * 0.72, r * 0.7, rng, 20, 0.035, 0.03);
    inkLine(ctx, inner, rng, { color: '#62251e', width: 0.9, alpha: 0.55, jitter: 0.5, close: true, passes: 1 });

    const mark = [
      { x: cx - r * 0.42, y: cy + r * 0.26 },
      { x: cx - r * 0.36, y: cy - r * 0.06 },
      { x: cx - r * 0.14, y: cy + r * 0.12 },
      { x: cx, y: cy - r * 0.22 },
      { x: cx + r * 0.14, y: cy + r * 0.12 },
      { x: cx + r * 0.36, y: cy - r * 0.06 },
      { x: cx + r * 0.42, y: cy + r * 0.26 },
    ];
    inkLine(ctx, mark, rng, { color: darken(SEAL_RED, 0.42), width: 1.5, alpha: 0.62, jitter: 0.35, passes: 1 });
    ctx.save();
    ctx.translate(-0.8, -0.8);
    inkLine(ctx, mark, rng, { color: lighten(SEAL_RED, 0.32), width: 1, alpha: 0.5, jitter: 0.3, passes: 1 });
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = lighten(SEAL_RED, 0.42);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.84, Math.PI * 1.05, Math.PI * 1.5);
    ctx.stroke();
    ctx.restore();
  }

  function drawBanner(ctx, x, y, flip, rng) {
    const dir = flip ? -1 : 1;
    const poleTop = y - 34;
    inkLine(ctx, [{ x, y }, { x, y: poleTop }], rng, { width: 1.25, alpha: 0.6, jitter: 0.5 });
    inkLine(
      ctx,
      [
        { x: x - 3, y: poleTop - 4 },
        { x, y: poleTop - 8 },
        { x: x + 3, y: poleTop - 4 },
      ],
      rng,
      { width: 0.8, alpha: 0.5, passes: 1, jitter: 0.3 }
    );
    const w = 22;
    const h = 13;
    const pts = [
      { x, y: poleTop + 1 },
      { x: x + dir * w, y: poleTop + 3 },
      { x: x + dir * (w - 5), y: poleTop + h * 0.5 },
      { x: x + dir * w, y: poleTop + h },
      { x, y: poleTop + h - 1 },
    ];
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = mix(SEAL_RED, '#c9a45c', 0.12);
    tracePath(ctx, pts, true);
    ctx.fill();
    ctx.restore();
    inkLine(ctx, pts, rng, { width: 0.85, alpha: 0.55, jitter: 0.45, close: true });
    inkLine(
      ctx,
      [
        { x: x + dir * 4, y: poleTop + 5.5 },
        { x: x + dir * (w - 6), y: poleTop + 6.5 },
      ],
      rng,
      { color: lighten(SEAL_RED, 0.5), width: 0.7, alpha: 0.55, passes: 1, jitter: 0.3 }
    );
  }

  function drawEdgeVignette(ctx, W, H, rng) {
    const edge = Math.min(W, H) * 0.1;
    const color = '#6b5738';
    ctx.save();
    let g = ctx.createLinearGradient(0, 0, 0, edge);
    g.addColorStop(0, alpha(color, 0.14));
    g.addColorStop(1, alpha(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, edge);
    g = ctx.createLinearGradient(0, H, 0, H - edge);
    g.addColorStop(0, alpha(color, 0.15));
    g.addColorStop(1, alpha(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, H - edge, W, edge);
    g = ctx.createLinearGradient(0, 0, edge, 0);
    g.addColorStop(0, alpha(color, 0.12));
    g.addColorStop(1, alpha(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, edge, H);
    g = ctx.createLinearGradient(W, 0, W - edge, 0);
    g.addColorStop(0, alpha(color, 0.12));
    g.addColorStop(1, alpha(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(W - edge, 0, edge, H);
    ctx.restore();

    for (let pass = 0; pass < 2; pass++) {
      const inset = Math.min(W, H) * (pass === 0 ? 0.014 : 0.028);
      const amp = pass === 0 ? 2.2 : 3.4;
      const stepLen = 46;
      const pts = [];
      for (let x = inset; x < W - inset; x += stepLen) pts.push({ x, y: inset + rng.range(-amp, amp) });
      for (let y = inset + stepLen; y < H - inset; y += stepLen) pts.push({ x: W - inset + rng.range(-amp, amp), y });
      for (let x = W - inset; x > inset; x -= stepLen) pts.push({ x, y: H - inset + rng.range(-amp, amp) });
      for (let y = H - inset - stepLen; y > inset; y -= stepLen) pts.push({ x: inset + rng.range(-amp, amp), y });
      ctx.save();
      ctx.globalAlpha = pass === 0 ? 0.22 : 0.1;
      ctx.strokeStyle = color;
      ctx.lineWidth = pass === 0 ? 1.1 : 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        if (i === 0) ctx.moveTo(pts[i].x, pts[i].y);
        else ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawCandleGlow(ctx, W, H, side, rng) {
    let gx;
    let gy;
    if (side === 'bottom') {
      gx = W * rng.range(0.5, 0.78);
      gy = H * 1.04;
    } else if (side === 'left') {
      gx = -W * 0.04;
      gy = H * rng.range(0.25, 0.6);
    } else {
      gx = W * 1.03;
      gy = H * rng.range(0.3, 0.55);
    }
    const radius = Math.max(W, H) * rng.range(0.46, 0.62);
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, radius);
    g.addColorStop(0, alpha('#ffe2b4', 0.2));
    g.addColorStop(0.32, alpha('#ffd9a2', 0.1));
    g.addColorStop(0.7, alpha('#f5c88a', 0.035));
    g.addColorStop(1, alpha('#f5c88a', 0));
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function drawClearedPatch(ctx, patch, rng) {
    const ring = blobRing(patch.cx, patch.cy, patch.rx, patch.ry, rng, 40, 0.02, 0.015);
    washShape(ctx, ring, lighten(PAPER, 0.55), 0.6, 18, 2);
    const g = ctx.createRadialGradient(patch.cx, patch.cy, 0, patch.cx, patch.cy, Math.max(patch.rx, patch.ry));
    g.addColorStop(0, alpha('#fffdf4', 0.3));
    g.addColorStop(0.72, alpha('#fffdf4', 0.14));
    g.addColorStop(1, alpha('#fffdf4', 0));
    ctx.save();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(patch.cx, patch.cy, patch.rx, patch.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCityBoundary(ctx, patch, rng) {
    const ring = blobRing(patch.cx, patch.cy, patch.rx * 0.985, patch.ry * 0.985, rng, 48, 0.012, 0.01);
    inkLine(ctx, ring, rng, { width: 1, alpha: 0.42, jitter: 1.1, close: true, dash: [6, 7] });
    if (rng.chance(0.45)) {
      inkLine(ctx, scaleRing(ring, patch.cx, patch.cy, 0.985), rng, {
        width: 0.8,
        alpha: 0.22,
        jitter: 0.9,
        close: true,
        dash: [3, 10],
        passes: 1,
      });
    }
  }

  function buildFeatureInfos(scenario, biome, W, H, rng) {
    const infos = [];
    for (let i = 0; i < scenario.neighbors.length; i++) {
      const terrain = scenario.neighbors[i];
      const s = SECTORS[i % SECTORS.length];
      const x = clamp(s.fx * W + rng.range(-s.sx * W, s.sx * W), s.minX, W - 74);
      const y = clamp(s.fy * H + rng.range(-s.sy * H, s.sy * H), 136, H - 66);
      const weight = biome.weights[terrain] || 1;
      const emphasis = clamp(0.8 + (weight / (biome.total || 1)) * 0.55, 0.8, 1.2);
      infos.push({ terrain, x, y, size: s.size * emphasis, compact: !!s.compact });
    }
    return infos;
  }

  function drawRoads(ctx, W, H, patch, infos, rng) {
    const land = [];
    const water = [];
    for (let i = 0; i < infos.length; i++) {
      if (infos[i].terrain === 'water') water.push(i);
      else land.push(i);
    }
    function shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
    }
    shuffle(land);
    shuffle(water);
    const order = land.concat(water);
    const count = rng.int(1, 3);
    let drawn = 0;
    for (let k = 0; k < order.length && drawn < count; k++) {
      const info = infos[order[k]];
      const dx = info.x - patch.cx;
      const dy = info.y - patch.cy;
      const t = Math.atan2(dy / patch.ry, dx / patch.rx);
      const start = {
        x: patch.cx + Math.cos(t) * patch.rx * 0.94,
        y: patch.cy + Math.sin(t) * patch.ry * 0.94,
      };
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const end = { x: info.x - (dx / dist) * 68, y: info.y - (dy / dist) * 52 };
      if (Math.abs(end.x - start.x) < 20) continue;
      const mx = (start.x + end.x) / 2 + rng.range(-34, 34);
      const my = (start.y + end.y) / 2 + rng.range(-28, 28);
      const pts = sampleCurve([start, { x: mx, y: my }, end], 16);
      inkLine(ctx, offsetPts(pts, 3.1), rng, { width: 0.9, alpha: 0.5, jitter: 0.6 });
      inkLine(ctx, offsetPts(pts, -3.1), rng, { width: 0.9, alpha: 0.5, jitter: 0.6 });
      inkLine(ctx, pts, rng, { width: 0.65, alpha: 0.18, jitter: 0.5, passes: 1, dash: [4, 9] });
      drawn++;
    }
  }

  function drawCityFields(ctx, patch, biome, rng) {
    const spots = [
      { x: patch.cx - patch.rx * 0.66, y: patch.cy + patch.ry * 0.56, rot: rng.range(-0.35, 0.1) },
      { x: patch.cx + patch.rx * 0.66, y: patch.cy + patch.ry * 0.56, rot: rng.range(-0.1, 0.35) },
      { x: patch.cx - patch.rx * 0.62, y: patch.cy - patch.ry * 0.56, rot: rng.range(-0.4, 0) },
      { x: patch.cx + patch.rx * 0.62, y: patch.cy - patch.ry * 0.56, rot: rng.range(0, 0.4) },
    ];
    for (let i = spots.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      const tmp = spots[i];
      spots[i] = spots[j];
      spots[j] = tmp;
    }
    const count = rng.int(2, 3);
    const hatchColor = biome.dominant === 'desert' || biome.dominant === 'dirt' ? mix(INK, '#8a704a', 0.4) : INK;
    for (let i = 0; i < count && i < spots.length; i++) {
      drawParcel(ctx, spots[i].x, spots[i].y, rng.range(30, 44), rng.range(16, 24), spots[i].rot, rng, {
        hatchAlpha: rng.range(0.24, 0.36),
        color: hatchColor,
      });
    }
    if (biome.dominant === 'grass' || biome.dominant === 'forest' || biome.dominant === 'dirt') {
      drawHedgerow(ctx, patch.cx - patch.rx * 0.55, patch.cx - patch.rx * 0.15, patch.cy + patch.ry * 0.78, rng);
    }
  }

  function drawRivers(ctx, W, H, patch, spots, rng) {
    if (!spots.length) return;
    const spot = spots[rng.int(0, spots.length - 1)];
    const dx = spot.x - patch.cx;
    const dy = spot.y - patch.cy;
    const t = Math.atan2(dy / patch.ry, dx / patch.rx);
    const start = {
      x: patch.cx + Math.cos(t) * patch.rx * 0.98,
      y: patch.cy + Math.sin(t) * patch.ry * 0.98,
    };
    const back = Math.atan2(-dy / spot.ry, -dx / spot.rx);
    const end = {
      x: spot.x + Math.cos(back) * spot.rx * 0.88,
      y: spot.y + Math.sin(back) * spot.ry * 0.88,
    };
    const mx = (start.x + end.x) / 2 + rng.range(-34, 34);
    const my = (start.y + end.y) / 2 + rng.range(-26, 26);
    const pts = sampleCurve([start, { x: mx, y: my }, end], 18);
    softStroke(ctx, pts, rng, WATER_INK, 9.5, 0.2, 3);
    inkLine(ctx, offsetPts(pts, 4.8), rng, { color: mix(INK, WATER_INK, 0.55), width: 0.9, alpha: 0.5, jitter: 0.5 });
    inkLine(ctx, offsetPts(pts, -4.8), rng, { color: mix(INK, WATER_INK, 0.55), width: 0.9, alpha: 0.5, jitter: 0.5 });
    for (let i = 3; i < pts.length - 3; i += 4) {
      const a = pts[i - 1];
      const b = pts[i + 1];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const nx = -Math.sin(ang);
      const ny = Math.cos(ang);
      inkLine(
        ctx,
        [
          { x: pts[i].x - nx * 2 + rng.range(-1, 1), y: pts[i].y - ny * 2 },
          { x: pts[i].x + nx * 2 + rng.range(-1, 1), y: pts[i].y + ny * 2 },
        ],
        rng,
        { color: mix(INK, WATER_INK, 0.5), width: 0.6, alpha: 0.28, passes: 1, jitter: 0.3 }
      );
    }
    if (spots.length > 1 && rng.chance(0.45)) {
      const forkAt = pts[Math.floor(pts.length * rng.range(0.4, 0.7))];
      const side = rng.sign();
      const forkEnd = { x: forkAt.x + rng.range(40, 90), y: forkAt.y + side * rng.range(35, 70) };
      const fork = sampleCurve(
        [
          forkAt,
          {
            x: (forkAt.x + forkEnd.x) / 2 + rng.range(-15, 15),
            y: (forkAt.y + forkEnd.y) / 2 + rng.range(-15, 15),
          },
          forkEnd,
        ],
        10
      );
      softStroke(ctx, fork, rng, WATER_INK, 5.5, 0.15, 2.5);
      inkLine(ctx, offsetPts(fork, 2.8), rng, {
        color: mix(INK, WATER_INK, 0.55),
        width: 0.65,
        alpha: 0.34,
        passes: 1,
        jitter: 0.4,
      });
    }
  }

  registry['cartographers-table'] = function (ctx, W, H, scenario, rng, seed) {
    const biome = weightedBiomes(scenario);
    const decor = Core.makeRng('cartographers-table|decor', scenario.id, seed);
    const city = { cx: W * 0.5, cy: H * 0.475, rx: W * 0.1875, ry: H * 0.15 };
    const patch = { cx: city.cx, cy: city.cy, rx: W * 0.232, ry: H * 0.21 };

    drawParchment(ctx, W, H, scenario.center, rng);
    drawClearedPatch(ctx, patch, rng);

    const infos = buildFeatureInfos(scenario, biome, W, H, rng);
    const waterSpots = [];
    for (let i = 0; i < infos.length; i++) drawFeature(ctx, W, H, infos[i], rng, waterSpots);
    drawRivers(ctx, W, H, patch, waterSpots, rng);

    drawCandleGlow(ctx, W, H, decor.pick(['right', 'bottom', 'left', 'right']), rng);

    drawCityBoundary(ctx, patch, rng);
    drawRoads(ctx, W, H, patch, infos, rng);
    drawCityFields(ctx, patch, biome, rng);
    drawCenterExtra(ctx, W, H, scenario.center, rng);
    drawSplatters(ctx, W, H, infos, rng);
    drawEdgeVignette(ctx, W, H, rng);

    const compassX = W * decor.range(0.82, 0.915);
    const compassY = H * decor.range(0.725, 0.855);
    const compassR = Math.min(W, H) * decor.range(0.046, 0.058);
    drawCompassRose(ctx, compassX, compassY, compassR, rng);

    const sealOrder = [
      { x: W - 46, y: H * 0.17 },
      { x: 298, y: H - 50 },
      { x: W - 50, y: H - 50 },
      { x: 300, y: H * 0.17 },
    ];
    for (let i = sealOrder.length - 1; i > 0; i--) {
      const j = decor.int(0, i);
      const tmp = sealOrder[i];
      sealOrder[i] = sealOrder[j];
      sealOrder[j] = tmp;
    }
    let sealSpot = sealOrder[0];
    for (let i = 0; i < sealOrder.length; i++) {
      const d = Math.sqrt(Math.pow(sealOrder[i].x - compassX, 2) + Math.pow(sealOrder[i].y - compassY, 2));
      if (d > compassR + 62) {
        sealSpot = sealOrder[i];
        break;
      }
    }
    drawWaxSeal(ctx, sealSpot.x, sealSpot.y, decor.range(16, 19.5), rng);

    const bannerSpots = [
      { x: city.cx, y: city.cy - city.ry - 26, flip: false },
      { x: city.cx + city.rx + 30, y: city.cy - 4, flip: true },
      { x: city.cx - city.rx - 30, y: city.cy + 4, flip: false },
      { x: city.cx, y: city.cy + city.ry + 30, flip: true },
    ];
    for (let i = bannerSpots.length - 1; i > 0; i--) {
      const j = decor.int(0, i);
      const tmp = bannerSpots[i];
      bannerSpots[i] = bannerSpots[j];
      bannerSpots[j] = tmp;
    }
    let banner = bannerSpots[0];
    for (let i = 0; i < bannerSpots.length; i++) {
      const cand = bannerSpots[i];
      let clear = true;
      for (let w = 0; w < waterSpots.length; w++) {
        const dx = cand.x - waterSpots[w].x;
        const dy = cand.y - waterSpots[w].y;
        if (Math.sqrt(dx * dx + dy * dy) < Math.max(waterSpots[w].rx, waterSpots[w].ry) + 30) {
          clear = false;
          break;
        }
      }
      if (clear) {
        banner = cand;
        break;
      }
    }
    drawBanner(ctx, banner.x, banner.y, banner.flip, rng);
  };

  function drawFeature(ctx, W, H, info, rng, spots) {
    if (info.terrain === 'water') drawWaterFeature(ctx, W, H, info, rng, spots);
    else if (info.terrain === 'forest') drawForestFeature(ctx, info, rng);
    else if (info.terrain === 'mountain') drawMountainFeature(ctx, info, rng, false);
    else if (info.terrain === 'snow') drawMountainFeature(ctx, info, rng, true);
    else if (info.terrain === 'desert') drawDesertFeature(ctx, info, rng);
    else if (info.terrain === 'swamp') drawSwampFeature(ctx, info, rng);
    else drawFieldFeature(ctx, info, rng, info.terrain === 'dirt');
  }

  function drawWaterFeature(ctx, W, H, info, rng, spots) {
    const s = info.size;
    let rx = (info.compact ? 44 : rng.range(70, 100)) * s;
    let ry = (info.compact ? 26 : rng.range(46, 62)) * s;
    rx = Math.max(17, Math.min(rx, info.x - 272, W - info.x - 24));
    ry = Math.max(14, Math.min(ry, info.y - 100, H - info.y - 42));
    const cx = info.x;
    const cy = info.y;
    const ring = blobRing(cx, cy, rx, ry, rng, 34, 0.1, 0.06);
    washShape(ctx, ring, WATER_INK, rng.range(0.13, 0.18), 6, 2);
    inkLine(ctx, ring, rng, { width: 1.15, alpha: 0.66, jitter: 0.7, close: true });
    inkLine(ctx, scaleRing(ring, cx, cy, 0.955), rng, {
      width: 0.85,
      alpha: 0.36,
      jitter: 0.6,
      close: true,
      passes: 1,
    });
    inkLine(ctx, scaleRing(ring, cx, cy, 0.9), rng, {
      width: 0.75,
      alpha: 0.24,
      jitter: 0.55,
      close: true,
      passes: 1,
    });

    const hatchColor = mix(INK, WATER_INK, 0.5);
    for (let i = 0; i < ring.length; i += 2) {
      if (rng.chance(0.34)) continue;
      const inner = {
        x: cx + (ring[i].x - cx) * 0.9,
        y: cy + (ring[i].y - cy) * 0.9,
      };
      const outer = {
        x: cx + (ring[i].x - cx) * 0.78,
        y: cy + (ring[i].y - cy) * 0.78,
      };
      inkLine(ctx, [inner, outer], rng, {
        color: hatchColor,
        width: 0.65,
        alpha: 0.24,
        passes: 1,
        jitter: 0.4,
      });
    }

    const waves = rng.int(5, 9);
    for (let i = 0; i < waves; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = Math.sqrt(rng.next()) * 0.5;
      const wx = cx + Math.cos(a) * rx * d;
      const wy = cy + Math.sin(a) * ry * d;
      const wl = rng.range(4, 8);
      inkLine(
        ctx,
        [
          { x: wx - wl, y: wy },
          { x: wx - wl * 0.5, y: wy - 2 },
          { x: wx, y: wy },
          { x: wx + wl * 0.5, y: wy - 2 },
          { x: wx + wl, y: wy },
        ],
        rng,
        {
          color: mix(INK, WATER_INK, 0.45),
          width: 0.7,
          alpha: 0.42,
          passes: 1,
          jitter: 0.35,
        }
      );
    }

    if (rx > 40 && rng.chance(0.75)) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(0.15, 0.42);
      const ix = cx + Math.cos(a) * rx * d;
      const iy = cy + Math.sin(a) * ry * d;
      const island = blobRing(ix, iy, rng.range(8, 13) * s, rng.range(4.5, 7) * s, rng, 14, 0.16, 0.1);
      washShape(ctx, island, '#e6d7b4', 0.55, 2, 1);
      inkLine(ctx, island, rng, { width: 0.8, alpha: 0.5, jitter: 0.5, close: true, passes: 1 });
      for (let k = 0; k < 3; k++) {
        const px = ix + rng.range(-6, 6);
        const py = iy + rng.range(-3, 3);
        inkLine(ctx, [{ x: px, y: py }, { x: px + 4, y: py + 2 }], rng, {
          color: INK,
          width: 0.6,
          alpha: 0.28,
          passes: 1,
          jitter: 0.3,
        });
      }
    }

    spots.push({ x: cx, y: cy, rx, ry });
  }

  function drawTreeGlyph(ctx, x, baseY, h, rng, color, a) {
    const lean = rng.range(-1.2, 1.2);
    inkLine(ctx, [{ x, y: baseY }, { x: x + lean, y: baseY - h * 0.36 }], rng, {
      color,
      width: 0.9,
      alpha: a,
      passes: 1,
      jitter: 0.35,
    });
    const apex = { x: x + lean * 1.4, y: baseY - h };
    const left = { x: x - h * 0.32, y: baseY - h * 0.34 };
    const right = { x: x + h * 0.32, y: baseY - h * 0.34 };
    ctx.save();
    ctx.globalAlpha = a * 0.14;
    ctx.fillStyle = color;
    tracePath(ctx, [left, apex, right], true);
    ctx.fill();
    ctx.restore();
    inkLine(ctx, [left, apex, right], rng, { color, width: 0.95, alpha: a, jitter: 0.45 });
    inkLine(
      ctx,
      [
        { x: x - h * 0.38, y: baseY - h * 0.14 },
        { x: x + h * 0.38, y: baseY - h * 0.14 },
      ],
      rng,
      { color, width: 0.7, alpha: a * 0.8, passes: 1, jitter: 0.35 }
    );
    for (let k = 0; k < 2; k++) {
      const yy = baseY - h * rng.range(0.32, 0.62);
      const hw = h * 0.2 * (1 - (baseY - yy) / h);
      inkLine(ctx, [{ x: x - hw, y: yy }, { x: x + hw * 0.8, y: yy - 2.4 }], rng, {
        color,
        width: 0.55,
        alpha: a * 0.55,
        passes: 1,
        jitter: 0.3,
      });
    }
  }

  function drawPineGlyph(ctx, x, baseY, h, rng, color, a) {
    inkLine(ctx, [{ x, y: baseY }, { x, y: baseY - h * 0.2 }], rng, {
      color,
      width: 0.85,
      alpha: a,
      passes: 1,
      jitter: 0.3,
    });
    for (let tier = 0; tier < 3; tier++) {
      const topY = baseY - h * (0.32 + tier * 0.22);
      const bottomY = baseY - h * (0.12 + tier * 0.22);
      const half = h * (0.3 - tier * 0.05);
      inkLine(
        ctx,
        [
          { x, y: topY },
          { x: x - half, y: bottomY },
          { x: x + half, y: bottomY },
        ],
        rng,
        { color, width: 0.8, alpha: a, jitter: 0.35, close: true, passes: 1 }
      );
    }
  }

  function drawForestFeature(ctx, info, rng) {
    const s = info.size;
    const sx = (info.compact ? 26 : 62) * s;
    const sy = (info.compact ? 26 : 42) * s;
    const count = rng.int(8, 14);
    const trees = [];
    for (let i = 0; i < count; i++) {
      const x = info.x + rng.range(-sx, sx);
      const y = info.y + rng.range(-sy, sy) * 0.7 + sy * 0.25;
      trees.push({ x, y, h: rng.range(8, 15) * s });
    }
    trees.sort(function (a, b) {
      return a.y - b.y;
    });
    for (let i = 0; i < trees.length; i++) {
      drawTreeGlyph(ctx, trees[i].x, trees[i].y, trees[i].h, rng, INK, rng.range(0.5, 0.68));
    }
    for (let i = 0; i < 5; i++) {
      const y = info.y + sy + rng.range(-2, 6);
      inkLine(
        ctx,
        [
          { x: info.x + rng.range(-sx, 0), y },
          { x: info.x + rng.range(0, sx), y: y + rng.range(-2, 2) },
        ],
        rng,
        { color: INK, width: 0.6, alpha: 0.22, passes: 1, jitter: 0.8 }
      );
    }
    drawHedgerow(ctx, info.x - sx, info.x + sx, info.y + sy * 0.85, rng, { step: rng.range(6, 9) });
    if (rng.chance(0.55)) {
      drawHedgerow(ctx, info.x - sx * 0.8, info.x + sx * 0.5, info.y + sy * 0.45, rng, {
        step: rng.range(8, 12),
        color: mix(INK, '#8a744f', 0.3),
      });
    }
  }

  function drawSnowCap(ctx, px, py, ph, rng) {
    const depth = ph * rng.range(0.24, 0.34);
    const half = ph * rng.range(0.13, 0.18);
    const pts = [
      { x: px, y: py + 1 },
      { x: px + half, y: py + depth * 0.9 },
      { x: px + half * 0.35, y: py + depth * 0.72 },
      { x: px + half * 0.12, y: py + depth },
      { x: px - half * 0.12, y: py + depth * 0.7 },
      { x: px - half * 0.5, y: py + depth * 0.92 },
      { x: px - half, y: py + depth * 0.62 },
    ];
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = SNOW;
    tracePath(ctx, pts, true);
    ctx.fill();
    ctx.restore();
    inkLine(ctx, [pts[0], pts[1], pts[3], pts[5], pts[6]], rng, {
      width: 0.65,
      alpha: 0.35,
      passes: 1,
      jitter: 0.35,
    });
  }

  function drawMountainFeature(ctx, info, rng, snowy) {
    const s = info.size;
    const width = (snowy ? 168 : 150) * s;
    const height = (snowy ? 72 : 58) * s;
    const count = rng.int(3, 5);
    const baseY = info.y + height * 0.32;
    const x0 = info.x - width / 2;
    inkLine(
      ctx,
      [
        { x: x0 - 4, y: baseY + rng.range(0, 2) },
        { x: x0 + width + 4, y: baseY + rng.range(-1, 2) },
      ],
      rng,
      { width: 0.8, alpha: 0.32, passes: 1, jitter: 0.6 }
    );
    for (let i = 0; i < count; i++) {
      const px =
        x0 + (i + 0.5) * (width / count) + rng.range((-width / count) * 0.16, (width / count) * 0.16);
      const ph = height * rng.range(0.68, 1);
      const py = baseY - ph;
      const spread = ph * rng.range(0.74, 0.96);
      const leftBase = { x: px - spread, y: baseY + rng.range(-1.5, 2) };
      const rightBase = { x: px + spread, y: baseY + rng.range(-1.5, 2) };
      inkLine(ctx, [leftBase, { x: px + rng.range(-1.2, 1.2), y: py }, rightBase], rng, {
        width: 1.25,
        alpha: 0.64,
        jitter: 0.9,
      });
      for (let k = 0; k < 2; k++) {
        const t = rng.range(0.28, 0.6);
        const sx = px + (rightBase.x - px) * t;
        const sy = py + (rightBase.y - py) * t;
        inkLine(ctx, [{ x: sx, y: sy }, { x: sx - rng.range(3, 6), y: sy + rng.range(2, 4) }], rng, {
          color: mix(INK, '#8a7550', 0.3),
          width: 0.55,
          alpha: 0.26,
          passes: 1,
          jitter: 0.35,
        });
      }
      if (snowy || rng.chance(0.75)) drawSnowCap(ctx, px, py, ph, rng);
      if (snowy && rng.chance(0.6)) {
        const pineX = px + rng.range(-spread * 0.8, spread * 0.8);
        drawPineGlyph(ctx, pineX, baseY + rng.range(2, 8), rng.range(9, 14) * s, rng, INK, rng.range(0.4, 0.56));
      }
    }
    if (snowy) {
      for (let i = 0; i < 2; i++) {
        drawPineGlyph(
          ctx,
          info.x + rng.range(-width * 0.45, width * 0.45),
          baseY + rng.range(5, 11),
          rng.range(8, 13) * s,
          rng,
          INK,
          0.46
        );
      }
    }
    for (let i = 0; i < 24; i++) {
      const sx = info.x + rng.range(-width * 0.55, width * 0.55);
      const sy = baseY + rng.range(2, height * 0.42);
      ctx.save();
      ctx.globalAlpha = rng.range(0.1, 0.24);
      ctx.fillStyle = mix(INK, '#8a7550', 0.4);
      ctx.beginPath();
      ctx.arc(sx, sy, rng.range(0.5, 1.4), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawCactusGlyph(ctx, x, baseY, h, rng) {
    const a = rng.range(0.46, 0.6);
    inkLine(ctx, [{ x, y: baseY }, { x: x + rng.range(-0.8, 0.8), y: baseY - h }], rng, {
      color: INK,
      width: 1.3,
      alpha: a,
      jitter: 0.4,
    });
    const armY1 = baseY - h * rng.range(0.38, 0.5);
    const armY2 = baseY - h * rng.range(0.52, 0.66);
    inkLine(
      ctx,
      [
        { x, y: armY1 },
        { x: x - h * 0.32, y: armY1 },
        { x: x - h * 0.32, y: armY1 - h * 0.22 },
      ],
      rng,
      { color: INK, width: 1, alpha: a, passes: 1, jitter: 0.35 }
    );
    inkLine(
      ctx,
      [
        { x, y: armY2 },
        { x: x + h * 0.34, y: armY2 },
        { x: x + h * 0.34, y: armY2 - h * 0.2 },
      ],
      rng,
      { color: INK, width: 1, alpha: a, passes: 1, jitter: 0.35 }
    );
    for (let i = 0; i < 3; i++) {
      const yy = baseY - rng.range(h * 0.25, h * 0.8);
      inkLine(ctx, [{ x: x + 1.3, y: yy }, { x: x + 3, y: yy - 1 }], rng, {
        color: INK,
        width: 0.45,
        alpha: a * 0.6,
        passes: 1,
        jitter: 0.2,
      });
    }
  }

  function drawDesertFeature(ctx, info, rng) {
    const s = info.size;
    const width = (info.compact ? 44 : 150) * s;
    const baseY = info.y + 10 * s;
    const dunes = rng.int(4, 6);
    for (let i = 0; i < dunes; i++) {
      const dy = (i - (dunes - 1) / 2) * 11 * s + rng.range(-3, 3);
      const x0 = info.x - width * 0.5 + rng.range(-6, 6);
      const x1 = info.x + width * 0.5 + rng.range(-6, 6);
      const ctrl = { x: info.x + rng.range(-18, 18), y: baseY + dy - rng.range(9, 16) * s };
      const pts = sampleCurve([{ x: x0, y: baseY + dy }, ctrl, { x: x1, y: baseY + dy + 2 }], 12);
      inkLine(ctx, pts, rng, {
        color: INK,
        width: rng.range(0.7, 0.95),
        alpha: rng.range(0.32, 0.46),
        passes: 1,
      });
      if (i % 2 === 0) {
        inkLine(ctx, [{ x: x0 + 8, y: baseY + dy + 2 }, { x: x0 + 2, y: baseY + dy + 7 }], rng, {
          color: INK,
          width: 0.6,
          alpha: 0.28,
          passes: 1,
          jitter: 0.4,
        });
      }
    }
    const cacti = rng.int(2, 3);
    for (let i = 0; i < cacti; i++) {
      drawCactusGlyph(
        ctx,
        info.x + rng.range(-width * 0.42, width * 0.42),
        info.y + rng.range(-2, 28) * s,
        rng.range(12, 19) * s,
        rng
      );
    }
    for (let i = 0; i < 7; i++) {
      const rx = info.x + rng.range(-width * 0.5, width * 0.5);
      const ry = info.y + rng.range(-12, 26) * s;
      const rw = rng.range(3, 7) * s;
      ctx.save();
      ctx.globalAlpha = rng.range(0.12, 0.24);
      ctx.fillStyle = mix(INK, '#8a704a', 0.4);
      ctx.beginPath();
      ctx.ellipse(rx, ry, rw, rw * 0.55, rng.range(-0.2, 0.2), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      inkLine(ctx, [{ x: rx - rw, y: ry + rw * 0.3 }, { x: rx + rw, y: ry + rw * 0.15 }], rng, {
        color: INK,
        width: 0.5,
        alpha: 0.25,
        passes: 1,
        jitter: 0.4,
      });
    }
  }

  function drawTuftGlyph(ctx, x, baseY, h, rng) {
    const blades = rng.int(3, 5);
    for (let i = 0; i < blades; i++) {
      const sx = x + rng.range(-3, 3);
      const lean = rng.range(-5, 5);
      inkLine(
        ctx,
        [
          { x: sx, y: baseY },
          { x: sx + lean * 0.5, y: baseY - h * 0.55 },
          { x: sx + lean, y: baseY - h * rng.range(0.8, 1.1) },
        ],
        rng,
        { color: INK, width: 0.65, alpha: rng.range(0.34, 0.5), passes: 1, jitter: 0.35 }
      );
    }
  }

  function drawWillowGlyph(ctx, x, baseY, h, rng) {
    const lean = rng.range(-2.5, 2.5);
    const topX = x + lean;
    const topY = baseY - h * 0.72;
    washShape(
      ctx,
      blobRing(topX, topY + 2, h * 0.3, h * 0.16, rng, 16, 0.14, 0.1),
      mix(INK, '#7d8a63', 0.4),
      0.07,
      4,
      1
    );
    inkLine(
      ctx,
      [
        { x, y: baseY },
        { x: x + lean * 0.5, y: baseY - h * 0.5 },
        { x: topX, y: topY },
      ],
      rng,
      { color: INK, width: 1.15, alpha: 0.55, jitter: 0.4 }
    );
    for (let i = 0; i < 6; i++) {
      const spread = rng.range(-h * 0.34, h * 0.34);
      const drop = rng.range(h * 0.3, h * 0.55);
      inkLine(
        ctx,
        [
          { x: topX, y: topY },
          { x: topX + spread * 0.75, y: topY + drop * 0.4 },
          { x: topX + spread, y: topY + drop },
        ],
        rng,
        {
          color: mix(INK, '#7d8a63', 0.25),
          width: 0.55,
          alpha: rng.range(0.26, 0.4),
          passes: 1,
          jitter: 0.35,
        }
      );
    }
  }

  function drawSwampFeature(ctx, info, rng) {
    const s = info.size;
    const width = (info.compact ? 44 : 120) * s;
    const height = (info.compact ? 44 : 78) * s;
    const pools = rng.int(2, 3);
    for (let i = 0; i < pools; i++) {
      const px = info.x + rng.range(-width * 0.4, width * 0.4);
      const py = info.y + rng.range(-height * 0.25, height * 0.28);
      const prx = rng.range(13, 25) * s;
      const pry = rng.range(7, 13) * s;
      const ring = blobRing(px, py, prx, pry, rng, 20, 0.13, 0.09);
      washShape(ctx, ring, WATER_INK, 0.13, 4, 1);
      inkLine(ctx, ring, rng, {
        color: mix(INK, WATER_INK, 0.45),
        width: 0.8,
        alpha: 0.4,
        jitter: 0.5,
        close: true,
        passes: 1,
      });
      for (let k = 0; k < 10; k++) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(0.75, 1.1);
        ctx.save();
        ctx.globalAlpha = rng.range(0.14, 0.28);
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(px + Math.cos(a) * prx * d, py + Math.sin(a) * pry * d, rng.range(0.5, 1.2), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    const tufts = rng.int(6, 10);
    for (let i = 0; i < tufts; i++) {
      drawTuftGlyph(
        ctx,
        info.x + rng.range(-width * 0.5, width * 0.5),
        info.y + rng.range(0, height * 0.6),
        rng.range(8, 15) * s,
        rng
      );
    }
    const willows = rng.int(1, 2);
    for (let i = 0; i < willows; i++) {
      drawWillowGlyph(
        ctx,
        info.x + rng.range(-width * 0.4, width * 0.4),
        info.y + rng.range(height * 0.1, height * 0.45),
        rng.range(28, 42) * s,
        rng
      );
    }
    for (let i = 0; i < 9; i++) {
      const mx = info.x + rng.range(-width * 0.55, width * 0.55);
      const my = info.y + rng.range(-height * 0.3, height * 0.45);
      const len = rng.range(6, 15);
      inkLine(ctx, [{ x: mx - len / 2, y: my }, { x: mx + len / 2, y: my + rng.range(-1, 1) }], rng, {
        color: INK,
        width: 0.6,
        alpha: 0.12,
        passes: 1,
        jitter: 0.3,
      });
    }
  }

  function drawFieldFeature(ctx, info, rng, dry) {
    const s = info.size;
    const count = dry ? rng.int(3, 4) : rng.int(2, 3);
    for (let i = 0; i < count; i++) {
      drawParcel(
        ctx,
        info.x + rng.range(-55 * s, 55 * s),
        info.y + rng.range(-34 * s, 34 * s),
        rng.range(26, 46) * s,
        rng.range(13, 24) * s,
        rng.range(-0.55, 0.55),
        rng,
        { hatchAlpha: rng.range(0.2, 0.34) }
      );
    }
    drawHedgerow(ctx, info.x - 62 * s, info.x + 62 * s, info.y + 38 * s, rng, {
      step: rng.range(6.5, 9.5),
    });
    const trees = dry ? 1 : rng.int(2, 3);
    for (let i = 0; i < trees; i++) {
      drawTreeGlyph(
        ctx,
        info.x + rng.range(-58 * s, 58 * s),
        info.y + rng.range(-30 * s, 34 * s),
        rng.range(9, 15) * s,
        rng,
        INK,
        rng.range(0.42, 0.58)
      );
    }
    for (let i = 0; i < 5; i++) {
      drawTuftGlyph(
        ctx,
        info.x + rng.range(-60 * s, 60 * s),
        info.y + rng.range(8 * s, 42 * s),
        rng.range(6, 11) * s,
        rng
      );
    }
    if (dry) {
      for (let i = 0; i < 6; i++) {
        const x = info.x + rng.range(-60 * s, 60 * s);
        const y = info.y + rng.range(-20 * s, 30 * s);
        inkLine(ctx, [{ x: x - 5, y }, { x: x + 5, y: y + 1 }], rng, {
          color: INK,
          width: 0.5,
          alpha: 0.2,
          passes: 1,
          jitter: 0.4,
        });
      }
    }
  }

  function drawCenterExtra(ctx, W, H, center, rng) {
    const spotX = W * rng.range(0.42, 0.56);
    const spotY = H * rng.range(0.9, 0.94);
    if (center === 'desert') {
      for (let i = 0; i < 3; i++) {
        const y = spotY + i * 7 + rng.range(-2, 2);
        const pts = sampleCurve(
          [
            { x: spotX - 50, y },
            { x: spotX, y: y - rng.range(8, 13) },
            { x: spotX + 50, y: y + 1 },
          ],
          10
        );
        inkLine(ctx, pts, rng, { color: INK, width: 0.75, alpha: 0.3, passes: 1 });
      }
      return;
    }
    if (center === 'forest') {
      for (let i = 0; i < 5; i++) {
        drawTreeGlyph(
          ctx,
          spotX + rng.range(-34, 34),
          spotY + rng.range(-14, 10),
          rng.range(8, 14),
          rng,
          INK,
          0.46
        );
      }
      drawHedgerow(ctx, spotX - 36, spotX + 36, spotY + 8, rng);
      return;
    }
    if (center === 'mountain' || center === 'snow') {
      const baseY = H * 0.19;
      const cx = W * rng.range(0.44, 0.56);
      for (let i = 0; i < 3; i++) {
        const px = cx + (i - 1) * 26 + rng.range(-5, 5);
        const ph = rng.range(18, 30);
        inkLine(
          ctx,
          [
            { x: px - ph * 0.8, y: baseY + 4 },
            { x: px, y: baseY - ph },
            { x: px + ph * 0.8, y: baseY + 4 },
          ],
          rng,
          { color: INK, width: 0.9, alpha: 0.4, passes: 1, jitter: 0.6 }
        );
        if (center === 'snow') drawSnowCap(ctx, px, baseY - ph, ph, rng);
      }
      return;
    }
    if (center === 'swamp') {
      for (let i = 0; i < 3; i++) {
        const px = spotX + rng.range(-44, 44);
        const py = spotY + rng.range(-10, 8);
        const ring = blobRing(px, py, rng.range(10, 18), rng.range(5, 9), rng, 16, 0.12, 0.08);
        washShape(ctx, ring, WATER_INK, 0.1, 4, 1);
        inkLine(ctx, ring, rng, {
          color: mix(INK, WATER_INK, 0.45),
          width: 0.65,
          alpha: 0.3,
          passes: 1,
          jitter: 0.4,
          close: true,
        });
      }
      drawTuftGlyph(ctx, spotX + rng.range(-30, 30), spotY + 10, 13, rng);
      return;
    }
    if (center === 'water') {
      const ring = blobRing(spotX, spotY, rng.range(28, 40), rng.range(10, 14), rng, 22, 0.16, 0.1);
      washShape(ctx, ring, WATER_INK, 0.12, 5, 1);
      inkLine(ctx, ring, rng, {
        color: mix(INK, WATER_INK, 0.4),
        width: 0.8,
        alpha: 0.36,
        passes: 1,
        jitter: 0.5,
        close: true,
      });
      return;
    }
    const count = rng.int(1, 2);
    for (let i = 0; i < count; i++) {
      drawParcel(
        ctx,
        spotX + (i - 0.5) * 44 + rng.range(-8, 8),
        spotY + rng.range(-8, 8),
        rng.range(24, 36),
        rng.range(12, 18),
        rng.range(-0.5, 0.5),
        rng,
        { hatchAlpha: 0.28 }
      );
    }
    drawHedgerow(ctx, spotX - 48, spotX + 48, spotY + 12, rng);
  }
})();
