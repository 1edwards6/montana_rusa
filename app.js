(() => {
  'use strict';

  const G = 9.81;
  const X_MAX = 100;
  const H_MAX = 50;
  const DEFAULT_POINTS = [
    { x: 0, y: 40 }, { x: 12, y: 11 }, { x: 27, y: 26 },
    { x: 44, y: 7 }, { x: 61, y: 22 }, { x: 78, y: 5 }, { x: 100, y: 3 }
  ];
  const COLORS = { track: '#2478b8', trackDark: '#174b72', grid: '#e8eef3', axis: '#8595a4', text: '#718292', potential: '#e29a48', kinetic: '#2489b5' };

  let points = DEFAULT_POINTS.map(p => ({ ...p }));
  let initialSpeed = 0;
  let model = null;
  let fullTrackCache = null;
  let selectedPoint = -1;
  let elapsed = 0;
  let running = false;
  let rafId = 0;
  let previousFrame = 0;
  let lastStatus = 'ready';

  const $ = id => document.getElementById(id);
  const designCanvas = $('designCanvas');
  const simulationCanvas = $('simulationCanvas');

  function plotRect(width, height) {
    return { left: 48, right: 18, top: 17, bottom: 34, width: width - 66, height: height - 51 };
  }

  function canvasContext(canvas) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(280, rect.width || 600);
    const height = Math.max(220, rect.height || 350);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width, height, plot: plotRect(width, height) };
  }

  function mapX(x, plot) { return plot.left + (x / X_MAX) * plot.width; }
  function mapY(y, plot) { return plot.top + ((H_MAX - y) / H_MAX) * plot.height; }

  function pchipSlopes(data) {
    const n = data.length;
    const h = [], d = [], m = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) {
      h[i] = data[i + 1].x - data[i].x;
      d[i] = (data[i + 1].y - data[i].y) / h[i];
    }
    if (n === 2) return [d[0], d[0]];
    const endpoint = (h0, h1, d0, d1) => {
      let value = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
      if (Math.sign(value) !== Math.sign(d0)) value = 0;
      else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(value) > 3 * Math.abs(d0)) value = 3 * d0;
      return value;
    };
    m[0] = endpoint(h[0], h[1], d[0], d[1]);
    m[n - 1] = endpoint(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] === 0 || d[i] === 0 || Math.sign(d[i - 1]) !== Math.sign(d[i])) {
        m[i] = 0;
      } else {
        const w1 = 2 * h[i] + h[i - 1];
        const w2 = h[i] + 2 * h[i - 1];
        m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
      }
    }
    return m;
  }

  function curveValue(data, slopes, x) {
    let i = 0;
    while (i < data.length - 2 && x > data[i + 1].x) i++;
    const p0 = data[i], p1 = data[i + 1];
    const dx = p1.x - p0.x;
    const t = Math.max(0, Math.min(1, (x - p0.x) / dx));
    const t2 = t * t, t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * p0.y
      + (t3 - 2 * t2 + t) * dx * slopes[i]
      + (-2 * t3 + 3 * t2) * p1.y
      + (t3 - t2) * dx * slopes[i + 1];
    const dydx = ((6 * t2 - 6 * t) * p0.y
      + (3 * t2 - 4 * t + 1) * dx * slopes[i]
      + (-6 * t2 + 6 * t) * p1.y
      + (3 * t2 - 2 * t) * dx * slopes[i + 1]) / dx;
    return { y: Math.max(0, Math.min(H_MAX, y)), dydx };
  }

  function makeTrackSamples() {
    const slopes = pchipSlopes(points);
    const count = 1400;
    const samples = [];
    let distance = 0;
    for (let i = 0; i <= count; i++) {
      const x = X_MAX * i / count;
      const value = curveValue(points, slopes, x);
      if (i > 0) {
        const prev = samples[i - 1];
        distance += Math.hypot(x - prev.x, value.y - prev.y);
      }
      samples.push({ x, y: value.y, dydx: value.dydx, s: distance });
    }
    return samples;
  }

  function buildModel() {
    const track = makeTrackSamples();
    fullTrackCache = track;
    const h0 = points[0].y;
    const samples = [];
    let stopped = false;
    let stalled = false;

    if (initialSpeed < 0.05 && track[1].y >= track[0].y - 0.0005) {
      const first = { ...track[0], v2: 0, v: 0, t: 0 };
      samples.push(first);
      stopped = true;
      stalled = true;
    } else {
      for (let i = 0; i < track.length; i++) {
        const p = track[i];
        let v2 = initialSpeed * initialSpeed + 2 * G * (h0 - p.y);
        if (v2 < -1e-8) {
          const prev = samples[samples.length - 1];
          const ratio = prev && (prev.v2 - v2) !== 0 ? prev.v2 / (prev.v2 - v2) : 0;
          const stop = {
            x: prev.x + (p.x - prev.x) * ratio,
            y: prev.y + (p.y - prev.y) * ratio,
            dydx: prev.dydx + (p.dydx - prev.dydx) * ratio,
            s: prev.s + (p.s - prev.s) * ratio,
            v2: 0, v: 0, t: 0
          };
          samples.push(stop);
          stopped = true;
          break;
        }
        v2 = Math.max(0, v2);
        samples.push({ ...p, v2, v: Math.sqrt(v2), t: 0 });
      }
    }

    let time = 0;
    for (let i = 0; i < samples.length; i++) {
      if (i === 0) { samples[i].t = 0; continue; }
      const prev = samples[i - 1];
      const current = samples[i];
      const ds = current.s - prev.s;
      const sumV = prev.v + current.v;
      if (sumV < 1e-7) {
        samples.splice(i);
        stopped = true;
        stalled = true;
        break;
      }
      time += (2 * ds) / sumV;
      current.t = time;
    }

    const duration = samples.length > 1 ? samples[samples.length - 1].t : 0;
    const distance = samples.length ? samples[samples.length - 1].s : 0;
    return { samples, duration, distance, h0, v0: initialSpeed, stopped, stalled, complete: !stopped };
  }

  function drawAxes(ctx, width, height, plot) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#fbfdff';
    ctx.fillRect(0, 0, width, height);
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let h = 0; h <= H_MAX; h += 10) {
      const y = mapY(h, plot);
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(plot.left, y); ctx.lineTo(plot.left + plot.width, y); ctx.stroke();
      ctx.fillStyle = COLORS.text;
      ctx.fillText(String(h), plot.left - 9, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let x = 0; x <= X_MAX; x += 20) {
      const px = mapX(x, plot);
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath(); ctx.moveTo(px, plot.top); ctx.lineTo(px, plot.top + plot.height); ctx.stroke();
      ctx.fillStyle = COLORS.text;
      ctx.fillText(String(x), px, plot.top + plot.height + 8);
    }
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(plot.left, plot.top); ctx.lineTo(plot.left, plot.top + plot.height); ctx.lineTo(plot.left + plot.width, plot.top + plot.height); ctx.stroke();
    ctx.fillStyle = '#607487';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Distancia horizontal (m)', plot.left + plot.width / 2, height - 15);
    ctx.save(); ctx.translate(13, plot.top + plot.height / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('Altura (m)', 0, 0); ctx.restore();
  }

  function drawTrack(canvas, editable, cartSample = null) {
    const { ctx, width, height, plot } = canvasContext(canvas);
    drawAxes(ctx, width, height, plot);
    // Draw the complete designed track, not only the part the cart can traverse.
    const fullTrack = fullTrackCache || makeTrackSamples();
    const gradient = ctx.createLinearGradient(0, plot.top, 0, plot.top + plot.height);
    gradient.addColorStop(0, 'rgba(49,183,200,.17)');
    gradient.addColorStop(1, 'rgba(49,183,200,.015)');
    ctx.beginPath();
    fullTrack.forEach((p, i) => {
      const x = mapX(p.x, plot), y = mapY(p.y, plot);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineTo(mapX(X_MAX, plot), mapY(0, plot));
    ctx.lineTo(mapX(0, plot), mapY(0, plot));
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    fullTrack.forEach((p, i) => {
      const x = mapX(p.x, plot), y = mapY(p.y, plot);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = COLORS.trackDark; ctx.lineWidth = 7; ctx.stroke();
    ctx.strokeStyle = COLORS.track; ctx.lineWidth = 4; ctx.stroke();

    if (editable) {
      points.forEach((p, i) => {
        const x = mapX(p.x, plot), y = mapY(p.y, plot);
        ctx.beginPath(); ctx.arc(x, y, i === selectedPoint ? 9 : 7, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? '#e5a34c' : '#ffffff';
        ctx.fill(); ctx.strokeStyle = i === selectedPoint ? '#e28c32' : COLORS.track; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.fillStyle = '#526b7e'; ctx.font = 'bold 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(`P${i + 1}`, x, y - 11);
      });
    }

    if (cartSample) drawCart(ctx, plot, cartSample);
    else if (!editable) drawCart(ctx, plot, fullTrack[0]);
    return { plot, width, height };
  }

  function drawCart(ctx, plot, sample) {
    const px = mapX(sample.x, plot);
    const py = mapY(sample.y, plot);
    const scaleX = plot.width / X_MAX;
    const scaleY = plot.height / H_MAX;
    const angle = Math.atan2(-sample.dydx * scaleY, scaleX);
    ctx.save();
    ctx.translate(px, py - 8);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(17,38,61,.16)';
    ctx.beginPath(); ctx.ellipse(0, 12, 18, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e69b43'; ctx.strokeStyle = '#9b6128'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(-14, -9, 28, 14, 5); else ctx.rect(-14, -9, 28, 14);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f3c77f';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(-9, -15, 18, 8, 4); else ctx.rect(-9, -15, 18, 8);
    ctx.fill();
    ctx.fillStyle = '#28475f';
    [-8, 8].forEach(x => { ctx.beginPath(); ctx.arc(x, 7, 4, 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
  }

  function nearestSampleAtTime(t) {
    if (!model || !model.samples.length) return null;
    const arr = model.samples;
    if (t <= 0 || arr.length === 1) return arr[0];
    if (t >= model.duration) return arr[arr.length - 1];
    let lo = 0, hi = arr.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].t < t) lo = mid; else hi = mid;
    }
    const a = arr[lo], b = arr[hi];
    const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    return {
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      s: a.s + (b.s - a.s) * f,
      v: a.v + (b.v - a.v) * f,
      dydx: a.dydx + (b.dydx - a.dydx) * f,
      t
    };
  }

  function updateReadouts(sample) {
    $('timeReadout').textContent = `${elapsed.toFixed(2)} s`;
    $('speedReadout').textContent = `${(sample ? sample.v : initialSpeed).toFixed(2)} m/s`;
    $('heightReadout').textContent = `${(sample ? sample.y : points[0].y).toFixed(2)} m`;
  }

  function updateStatus() {
    const status = $('simulationStatus');
    status.className = 'status-pill';
    if (running) {
      status.textContent = 'En movimiento'; status.classList.add('running');
    } else if (lastStatus === 'complete') {
      status.textContent = 'Recorrido completo'; status.classList.add('running');
    } else if (lastStatus === 'stopped') {
      status.textContent = model && model.stalled ? 'No logra iniciar' : 'Se detuvo en la subida'; status.classList.add('stopped');
    } else {
      status.textContent = 'Listo para iniciar';
    }
  }

  function updateResultMessage() {
    if (!model) return;
    const message = $('resultMessage');
    if (model.stalled) {
      message.textContent = 'El carrito no logra comenzar: desde el reposo necesita una pendiente inicial descendente para ponerse en movimiento.';
    } else if (model.stopped) {
      const last = model.samples[model.samples.length - 1];
      message.textContent = `El carrito se detiene cerca de los ${last.x.toFixed(1)} m horizontales porque no tiene energía suficiente para superar la siguiente subida.`;
    } else {
      message.textContent = '¡El carrito completa el recorrido! En el modelo ideal, la energía potencial se transforma en cinética y viceversa.';
    }
  }

  function chartSvg(container, series, opts = {}) {
    const W = 460, H = 205, L = 46, R = 14, T = 12, B = 34;
    const pw = W - L - R, ph = H - T - B;
    const allX = series.flatMap(s => s.data.map(p => p.x));
    const allY = series.flatMap(s => s.data.map(p => p.y));
    const minX = opts.minX !== undefined ? opts.minX : Math.min(...allX, 0);
    const maxX = opts.maxX !== undefined ? opts.maxX : Math.max(...allX, 1);
    const rawMinY = opts.minY !== undefined ? opts.minY : Math.min(...allY, 0);
    const rawMaxY = opts.maxY !== undefined ? opts.maxY : Math.max(...allY, 1);
    const spanY = Math.max(1, rawMaxY - rawMinY);
    const minY = Math.min(0, rawMinY);
    const maxY = rawMaxY + spanY * .08;
    const x = value => L + (value - minX) / Math.max(1e-9, maxX - minX) * pw;
    const y = value => T + (maxY - value) / (maxY - minY) * ph;
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${opts.aria || 'Gráfica de resultados'}">`;
    for (let k = 0; k <= 4; k++) {
      const val = minY + (maxY - minY) * k / 4;
      const py = y(val);
      svg += `<line x1="${L}" y1="${py}" x2="${W - R}" y2="${py}" stroke="#e9eef2"/><text x="${L - 8}" y="${py + 4}" text-anchor="end" font-size="10" fill="#81909c">${val.toFixed(0)}</text>`;
    }
    for (let k = 0; k <= 4; k++) {
      const val = minX + (maxX - minX) * k / 4;
      const px = x(val);
      svg += `<line x1="${px}" y1="${T}" x2="${px}" y2="${H - B}" stroke="#f0f3f6"/><text x="${px}" y="${H - 14}" text-anchor="middle" font-size="10" fill="#81909c">${val.toFixed(0)}</text>`;
    }
    svg += `<path d="M ${L} ${T} V ${H - B} H ${W - R}" fill="none" stroke="#9aa8b4" stroke-width="1.2"/>`;
    for (const s of series) {
      if (!s.data.length) continue;
      const d = s.data.map((p, i) => `${i ? 'L' : 'M'} ${x(p.x).toFixed(2)} ${y(p.y).toFixed(2)}`).join(' ');
      svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    svg += `<text x="${L + pw / 2}" y="${H - 1}" text-anchor="middle" font-size="10" fill="#718292">${opts.xLabel || 'Distancia'}</text>`;
    svg += `<text x="12" y="${T + ph / 2}" text-anchor="middle" font-size="10" fill="#718292" transform="rotate(-90 12 ${T + ph / 2})">${opts.yLabel || 'Valor'}</text>`;
    svg += '</svg>';
    container.innerHTML = svg;
  }

  function renderModel() {
    if (!model) return;
    const samples = model.samples;
    const full = fullTrackCache || makeTrackSamples();
    chartSvg($('heightChart'), [{ color: COLORS.track, data: full.map(p => ({ x: p.x, y: p.y })) }], { minX: 0, maxX: 100, minY: 0, maxY: 50, xLabel: 'Distancia horizontal (m)', yLabel: 'Altura (m)', aria: 'Altura de la pista respecto a la distancia horizontal' });
    chartSvg($('speedChart'), [{ color: COLORS.kinetic, data: samples.map(p => ({ x: p.s, y: p.v })) }], { minX: 0, maxX: Math.max(1, full[full.length - 1].s), minY: 0, xLabel: 'Distancia recorrida (m)', yLabel: 'Velocidad (m/s)', aria: 'Velocidad según la distancia recorrida' });
    chartSvg($('energyChart'), [
      { color: COLORS.potential, data: samples.map(p => ({ x: p.s, y: G * p.y })) },
      { color: COLORS.kinetic, data: samples.map(p => ({ x: p.s, y: p.v2 / 2 })) }
    ], { minX: 0, maxX: Math.max(1, full[full.length - 1].s), minY: 0, xLabel: 'Distancia recorrida (m)', yLabel: 'Energía por masa (J/kg)', aria: 'Energía potencial y cinética por unidad de masa' });
    renderTable(samples);
  }

  function renderTable(samples) {
    const body = $('resultsTable');
    if (samples.length < 2) {
      body.innerHTML = '<tr><td colspan="5">El carrito no inicia. Modifica la pendiente inicial o aumenta la velocidad.</td></tr>';
      return;
    }
    const maxS = samples[samples.length - 1].s;
    const rows = [];
    for (let i = 0; i <= 4; i++) {
      const target = maxS * i / 4;
      let nearest = samples[0];
      for (const p of samples) if (Math.abs(p.s - target) < Math.abs(nearest.s - target)) nearest = p;
      rows.push(`<tr><td>${i + 1}</td><td>${nearest.s.toFixed(1)} m</td><td>${nearest.y.toFixed(1)} m</td><td>${nearest.t.toFixed(2)} s</td><td>${nearest.v.toFixed(2)} m/s</td></tr>`);
    }
    body.innerHTML = rows.join('');
  }

  function rebuildModel() {
    stopAnimation(false);
    model = buildModel();
    elapsed = 0;
    lastStatus = model.stalled || model.stopped ? 'stopped' : 'ready';
    $('startHeight').innerHTML = `${points[0].y.toFixed(1)} <small>m</small>`;
    updateReadouts(model.samples[0]);
    updateStatus();
    updateResultMessage();
    drawTrack(designCanvas, true);
    drawTrack(simulationCanvas, false, model.samples[0]);
    renderModel();
    $('playPause').textContent = '▶ Iniciar';
  }

  function stopAnimation(cancel = true) {
    running = false;
    if (cancel && rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function animationFrame(timestamp) {
    if (!running || !model) return;
    if (!previousFrame) previousFrame = timestamp;
    const delta = Math.min((timestamp - previousFrame) / 1000, 0.05);
    previousFrame = timestamp;
    elapsed = Math.min(model.duration, elapsed + delta);
    const sample = nearestSampleAtTime(elapsed);
    drawTrack(simulationCanvas, false, sample);
    updateReadouts(sample);
    if (elapsed >= model.duration) {
      stopAnimation();
      lastStatus = model.stopped ? 'stopped' : 'complete';
      $('playPause').textContent = '▶ Repetir';
      updateStatus();
      updateResultMessage();
      return;
    }
    rafId = requestAnimationFrame(animationFrame);
  }

  function playPause() {
    if (!model) rebuildModel();
    if (running) {
      stopAnimation();
      $('playPause').textContent = '▶ Continuar';
      updateStatus();
      return;
    }
    if (model.duration <= 0.001) {
      lastStatus = 'stopped'; updateStatus(); updateResultMessage(); return;
    }
    if (elapsed >= model.duration) elapsed = 0;
    running = true;
    previousFrame = 0;
    $('playPause').textContent = 'Ⅱ Pausar';
    updateStatus();
    rafId = requestAnimationFrame(animationFrame);
  }

  function syncSpeed(value) {
    initialSpeed = Number(value);
    $('initialSpeed').value = String(initialSpeed);
    $('initialSpeedSim').value = String(initialSpeed);
    $('initialSpeedValue').textContent = `${initialSpeed.toFixed(1)} m/s`;
    $('initialSpeedSimValue').textContent = `${initialSpeed.toFixed(1)} m/s`;
    rebuildModel();
  }

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(tab => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.page').forEach(page => page.classList.toggle('active', page.id === `page-${name}`));
    if (name === 'design') drawTrack(designCanvas, true);
    if (name === 'simulate') drawTrack(simulationCanvas, false, nearestSampleAtTime(elapsed));
    if (name === 'model') renderModel();
  }

  function canvasToData(canvas, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width, height = rect.height;
    const plot = plotRect(width, height);
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    return {
      x: Math.max(0, Math.min(X_MAX, (px - plot.left) / plot.width * X_MAX)),
      y: Math.max(0, Math.min(H_MAX, H_MAX - (py - plot.top) / plot.height * H_MAX)),
      px, py, plot
    };
  }

  function onPointerDown(event) {
    const pos = canvasToData(designCanvas, event.clientX, event.clientY);
    const { plot } = pos;
    let nearest = -1, minDistance = 18;
    points.forEach((p, i) => {
      const dx = mapX(p.x, plot) - pos.px;
      const dy = mapY(p.y, plot) - pos.py;
      const distance = Math.hypot(dx, dy);
      if (distance < minDistance) { minDistance = distance; nearest = i; }
    });
    if (nearest !== -1) {
      selectedPoint = nearest;
      designCanvas.setPointerCapture(event.pointerId);
      drawTrack(designCanvas, true);
      event.preventDefault();
    }
  }

  function onPointerMove(event) {
    if (selectedPoint < 0) return;
    const pos = canvasToData(designCanvas, event.clientX, event.clientY);
    const index = selectedPoint;
    points[index].y = Math.round(pos.y * 2) / 2;
    if (index > 0 && index < points.length - 1) {
      const minX = points[index - 1].x + 4;
      const maxX = points[index + 1].x - 4;
      points[index].x = Math.round(Math.max(minX, Math.min(maxX, pos.x)) * 2) / 2;
    }
    $('startHeight').innerHTML = `${points[0].y.toFixed(1)} <small>m</small>`;
    fullTrackCache = makeTrackSamples();
    drawTrack(designCanvas, true);
    event.preventDefault();
  }

  function onPointerUp() {
    if (selectedPoint < 0) return;
    selectedPoint = -1;
    rebuildModel();
  }

  function addPoint() {
    if (points.length >= 10) return;
    const last = points.length - 1;
    const a = points[last - 1], b = points[last];
    const x = (a.x + b.x) / 2;
    const y = Math.max(2, Math.min(H_MAX - 2, (a.y + b.y) / 2 + (b.y < a.y ? 5 : -5)));
    points.splice(last, 0, { x, y });
    rebuildModel();
  }

  function removePoint() {
    if (points.length <= 4) return;
    points.splice(points.length - 2, 1);
    rebuildModel();
  }

  function resetTrack() {
    points = DEFAULT_POINTS.map(p => ({ ...p }));
    syncSpeed(0);
  }

  function resizeAll() {
    drawTrack(designCanvas, true);
    const sample = nearestSampleAtTime(elapsed) || model?.samples[0] || null;
    drawTrack(simulationCanvas, false, sample);
  }

  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
  $('initialSpeed').addEventListener('input', event => syncSpeed(event.target.value));
  $('initialSpeedSim').addEventListener('input', event => syncSpeed(event.target.value));
  $('addPoint').addEventListener('click', addPoint);
  $('removePoint').addEventListener('click', removePoint);
  $('resetTrack').addEventListener('click', resetTrack);
  $('tryDesign').addEventListener('click', () => { switchTab('simulate'); });
  $('playPause').addEventListener('click', playPause);
  $('restartSimulation').addEventListener('click', () => {
    stopAnimation(); elapsed = 0; lastStatus = model.stalled || model.stopped ? 'stopped' : 'ready';
    $('playPause').textContent = '▶ Iniciar';
    const first = model.samples[0]; drawTrack(simulationCanvas, false, first); updateReadouts(first); updateStatus(); updateResultMessage();
  });
  $('goToModel').addEventListener('click', () => switchTab('model'));
  designCanvas.addEventListener('pointerdown', onPointerDown);
  designCanvas.addEventListener('pointermove', onPointerMove);
  designCanvas.addEventListener('pointerup', onPointerUp);
  designCanvas.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('resize', resizeAll);

  // Initial render.
  model = buildModel();
  $('initialSpeedValue').textContent = '0.0 m/s';
  $('initialSpeedSimValue').textContent = '0.0 m/s';
  rebuildModel();
})();
