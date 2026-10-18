(function () {
  'use strict';

  const Core = window.CityBackdropCore;
  const W = Core.W;
  const H = Core.H;
  const SCENARIOS = Core.SCENARIOS;
  const makeRng = Core.makeRng;
  const drawOverlays = Core.drawOverlays;

  const registry = window.CityBackdropOptions = window.CityBackdropOptions || {};

  const OPTION_META = [
    {
      id: 'biome-horizon',
      index: 1,
      name: 'Biome Horizon',
      tagline: 'Weighted biome horizon',
      description:
        'A soft watercolor horizon built from the settlement\u2019s terrain mix. Weighted biome bands roll behind the city, with the dominant terrain setting the sky and the neighbours tinting the ridges and fields. It keeps the calm, low-detail read of the current skyboxes while making every settlement palette its own.',
    },
    {
      id: 'map-true-panorama',
      index: 2,
      name: 'Map-True Panorama',
      tagline: 'Directional neighbours',
      description:
        'Every direction follows the actual map: the six neighbouring tiles become horizon wedges behind the city, so the view reads as a continuation of the world rather than a generic sky. Distant silhouettes, water bands and haze shift with the neighbours, giving each settlement a panorama you could match back to the map.',
    },
    {
      id: 'settlement-diorama',
      index: 3,
      name: 'Settlement Diorama',
      tagline: 'Floating terrain plate',
      description:
        'The city sits on a floating terrain plate with a painted cross-section edge and cloud banks below. The plate carries a miniature version of the surrounding biomes, giving the view a collectible diorama feel without changing the isometric city or the UI chrome.',
    },
    {
      id: 'painted-motif-kit',
      index: 4,
      name: 'Painted Motif Kit',
      tagline: 'Authored watercolor motifs',
      description:
        'A small kit of hand-authored watercolor motifs \u2014 tree clumps, rock stacks, hills and cloud bands \u2014 is composed procedurally per seed. The result keeps the loose painterly texture of the current art while varying composition from city to city, and the kit can grow without touching the renderer.',
    },
    {
      id: 'cartographers-table',
      index: 5,
      name: 'Cartographer\u2019s Table',
      tagline: 'Parchment map table',
      description:
        'The backdrop becomes a cartographer\u2019s table: aged parchment, inked coastlines, a compass rose and sketched terrain around the settlement. The city reads as a model placed on an old map of its territory, connecting the city view to the strategic map without repeating it literally.',
    },
  ];

  function scenarioById(id) {
    return SCENARIOS.find((scenario) => scenario.id === id) || SCENARIOS[0];
  }

  function optionById(id) {
    return OPTION_META.find((option) => option.id === id) || null;
  }

  function parseSeed(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, radius);
      return;
    }
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function drawPlaceholder(ctx, optionId, scenario, seed, error) {
    const meta = optionById(optionId);
    const name = meta ? meta.name : optionId;
    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, '#131b27');
    gradient.addColorStop(0.55, '#0d141e');
    gradient.addColorStop(1, '#0a0f17');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#5f6f83';
    ctx.lineWidth = 1;
    for (let x = -H; x < W; x += 56) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + H, H);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#d9cba8';
    ctx.font = '400 46px Georgia, "Times New Roman", serif';
    ctx.fillText(name, W / 2, 596);
    ctx.fillStyle = '#7f8896';
    ctx.font = '13px "Segoe UI", system-ui, sans-serif';
    const status = error ? 'renderer threw \u2014 see console' : 'renderer not loaded';
    ctx.fillText(status + ' \u00b7 ' + scenario.label + ' \u00b7 seed ' + seed, W / 2, 642);
    ctx.restore();
  }

  function renderOne(canvas, optionId, scenarioId, seed) {
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const scenario = scenarioById(scenarioId);
    const chosenSeed = parseSeed(seed, scenario.seed);
    const rng = makeRng(optionId, scenario.id, chosenSeed);
    const option = registry[optionId];

    ctx.clearRect(0, 0, W, H);
    if (typeof option === 'function') {
      ctx.save();
      try {
        option(ctx, W, H, scenario, rng, chosenSeed);
      } catch (error) {
        console.error('City backdrop option "' + optionId + '" failed:', error);
        drawPlaceholder(ctx, optionId, scenario, chosenSeed, error);
      } finally {
        ctx.restore();
      }
    } else {
      drawPlaceholder(ctx, optionId, scenario, chosenSeed, null);
    }
    drawOverlays(ctx, W, H, chosenSeed);
  }

  function drawCaption(ctx, scenario, seed) {
    const label = scenario.label + '  \u00b7  seed ' + seed;
    ctx.save();
    ctx.font = '600 32px "Segoe UI", system-ui, sans-serif';
    const padding = 22;
    const pillW = Math.ceil(ctx.measureText(label).width + padding * 2);
    const pillH = 58;
    roundRect(ctx, 24, 24, pillW, pillH, 9);
    ctx.fillStyle = 'rgba(8, 12, 18, 0.62)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(232, 224, 207, 0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#e8e0cf';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 24 + padding, 24 + pillH / 2 + 1);
    ctx.restore();
  }

  function makeCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    return canvas;
  }

  function initGallery() {
    const gallery = document.getElementById('gallery');
    if (!gallery) return;
    const select = document.getElementById('scenario-select');
    const seedInput = document.getElementById('seed-input');
    const shuffle = document.getElementById('shuffle');

    for (const scenario of SCENARIOS) {
      const option = document.createElement('option');
      option.value = scenario.id;
      option.textContent = scenario.label;
      select.appendChild(option);
    }
    select.value = SCENARIOS[0].id;
    seedInput.value = String(SCENARIOS[0].seed);

    const blocks = [];
    for (const meta of OPTION_META) {
      const section = document.createElement('section');
      section.className = 'option-section';

      const head = document.createElement('div');
      head.className = 'option-head';
      const index = document.createElement('span');
      index.className = 'option-index';
      index.textContent = String(meta.index).padStart(2, '0') + ' \u00b7 ' + meta.tagline.toUpperCase();
      const title = document.createElement('h2');
      title.textContent = meta.name;
      head.appendChild(index);
      head.appendChild(title);

      const description = document.createElement('p');
      description.className = 'option-desc';
      description.textContent = meta.description;

      const grid = document.createElement('div');
      grid.className = 'canvas-grid';
      const canvases = [];
      for (let i = 0; i < 4; i++) {
        const canvas = makeCanvas();
        grid.appendChild(canvas);
        canvases.push(canvas);
      }
      const note = document.createElement('div');
      note.className = 'canvas-note';
      grid.appendChild(note);

      section.appendChild(head);
      section.appendChild(description);
      section.appendChild(grid);
      gallery.appendChild(section);
      blocks.push({ meta, canvases, note });
    }

    let timer = 0;
    function renderAll() {
      const scenario = scenarioById(select.value);
      const baseSeed = parseSeed(seedInput.value, scenario.seed);
      for (const block of blocks) {
        for (let i = 0; i < block.canvases.length; i++) {
          renderOne(block.canvases[i], block.meta.id, scenario.id, baseSeed + i);
        }
        block.note.textContent =
          scenario.label + ' \u00b7 seeds ' + baseSeed + '\u2013' + (baseSeed + 3) +
          ' \u00b7 canvas 1280\u00d7800, displayed 640\u00d7400';
      }
      window.__ready = true;
    }

    select.addEventListener('change', renderAll);
    seedInput.addEventListener('input', function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(renderAll, 180);
    });
    shuffle.addEventListener('click', function () {
      seedInput.value = String(Math.floor(Math.random() * 9000) + 1);
      renderAll();
    });

    renderAll();
  }

  function initCapture(mode, params) {
    document.body.classList.add('capture');
    const stage = document.getElementById('stage');
    stage.replaceChildren();

    if (mode === 'hero') {
      stage.className = 'stage-hero';
      stage.style.display = 'block';
      const optionId = params.get('option') || OPTION_META[0].id;
      const scenario = scenarioById(params.get('scenario'));
      const seed = parseSeed(params.get('seed'), scenario.seed);
      const canvas = makeCanvas();
      stage.appendChild(canvas);
      renderOne(canvas, optionId, scenario.id, seed);
      window.__ready = true;
      return;
    }

    if (mode === 'option') {
      stage.className = 'stage-option';
      stage.style.display = 'grid';
      const optionId = params.get('option') || OPTION_META[0].id;
      for (const scenario of SCENARIOS) {
        const canvas = makeCanvas();
        stage.appendChild(canvas);
        renderOne(canvas, optionId, scenario.id, scenario.seed);
        drawCaption(canvas.getContext('2d'), scenario, scenario.seed);
      }
      window.__ready = true;
      return;
    }

    if (mode === 'all') {
      stage.className = 'stage-all';
      stage.style.display = 'grid';
      for (const meta of OPTION_META) {
        const label = document.createElement('div');
        label.className = 'all-label';
        const name = document.createElement('b');
        name.textContent = meta.name;
        const index = document.createElement('span');
        index.textContent = 'OPTION ' + String(meta.index).padStart(2, '0') + ' \u00b7 ' + meta.tagline.toUpperCase();
        label.appendChild(name);
        label.appendChild(index);
        stage.appendChild(label);
        for (const scenario of SCENARIOS) {
          const canvas = makeCanvas();
          stage.appendChild(canvas);
          renderOne(canvas, meta.id, scenario.id, scenario.seed);
        }
      }
      window.__ready = true;
      return;
    }

    initGallery();
  }

  const params = new URLSearchParams(window.location.search);
  const capture = params.get('capture');
  if (capture) {
    initCapture(capture, params);
  } else {
    initGallery();
  }

  window.CityBackdropRender = {
    OPTION_META,
    renderOne,
    scenarioById,
    optionById,
  };
})();
