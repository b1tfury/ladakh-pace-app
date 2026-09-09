(() => {
  const $ = (id) => document.getElementById(id);

  let courseData = null;
  let lastResult = null;
  let splitsExpanded = false;
  let guidanceExpanded = false;
  let calcTimer = null;
  let drawTimer = null;
  let inflight = 0;

  const GRADE_PUSH = -1.2;
  const GRADE_PULL = 1.5;

  function fmtPace(sec) {
    sec = Math.round(Number(sec));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }

  function paceAria(sec) {
    sec = Math.round(Number(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s ? m + ' minutes ' + s + ' seconds per kilometre' : m + ' minutes per kilometre';
  }

  function cueForSplit(sp) {
    const grade = Number(sp.grade_pct) || 0;
    if (grade <= GRADE_PUSH) {
      return { key: 'push', label: 'Push', tip: 'Gentle down (' + grade.toFixed(1) + '%) — open stride a touch' };
    }
    if (grade >= GRADE_PULL) {
      return { key: 'pull', label: 'Pull', tip: 'Climb (' + (grade > 0 ? '+' : '') + grade.toFixed(1) + '%) — ease and keep cadence' };
    }
    return { key: 'hold', label: 'Hold', tip: 'Near flat (' + (grade > 0 ? '+' : '') + grade.toFixed(1) + '%) — settle into rhythm' };
  }

  function shortSource(src) {
    if (!src) return 'Official Ladakh Marathon course geometry with DEM elevations.';
    const geo = src.geometry || '';
    const cleaned = geo.replace(/\(https?:\/\/[^)]+\)/g, '').replace(/\s{2,}/g, ' ').trim();
    const elev = src.elevation ? ' Elevations: ' + src.elevation + '.' : '';
    const official = src.official_distance_km ? ' Official distance ' + src.official_distance_km + ' km.' : '';
    return (cleaned || 'Course geometry from official race map.') + elev + official;
  }

  function mToFt(m) { return Math.round(Number(m) * 3.28084); }

  function renderStats(c) {
    $('subtitle').textContent = (c.location || 'Leh, Ladakh') + ' · ' + c.distance_km + ' km';
    $('elev-chip').textContent = Math.round(c.elev_min_ft) + '–' + Math.round(c.elev_max_ft) + ' ft';
    $('elev-range').textContent = Math.round(c.elev_min_m) + '–' + Math.round(c.elev_max_m) + ' m · zones follow your pace';
    const maxFt = Math.round(c.elev_max_ft);
    const maxM = Math.round(c.elev_max_m);
    const gainFt = mToFt(c.elev_gain_m);
    const lossFt = mToFt(c.elev_loss_m);
    $('stats').innerHTML = [
      ['Distance', c.distance_km + ' km', null],
      ['Gain', Math.round(c.elev_gain_m) + ' m', gainFt + ' ft'],
      ['Loss', Math.round(c.elev_loss_m) + ' m', lossFt + ' ft'],
      ['Max elev', maxM + ' m', maxFt + ' ft']
    ].map(function (row) {
      return '<div class="stat" role="listitem"><span>' + row[0] + '</span><strong>' + row[1] + '</strong>' +
        (row[2] ? '<span class="dual">' + row[2] + '</span>' : '') + '</div>';
    }).join('');
    $('source-hint').textContent = shortSource(c.source);
    $('model-note').textContent = c.model || '';
  }

  function zoneColor(grade, alphaFill) {
    if (grade <= GRADE_PUSH) return 'rgba(124, 188, 138, ' + alphaFill + ')';
    if (grade >= GRADE_PULL) return 'rgba(201, 164, 110, ' + alphaFill + ')';
    return 'rgba(143, 160, 180, ' + (alphaFill * 0.55) + ')';
  }

  function strokeForGrade(grade) {
    if (grade <= GRADE_PUSH) return '#7cbc8a';
    if (grade >= GRADE_PULL) return '#c9a46e';
    return '#6eb8c9';
  }

  function estimateGradeAt(profile, i) {
    const a = profile[Math.max(0, i - 1)];
    const b = profile[Math.min(profile.length - 1, i + 1)];
    const dd = (b.d_km - a.d_km) * 1000;
    if (Math.abs(dd) < 1) return 0;
    return ((b.ele_m - a.ele_m) / dd) * 100;
  }

  function drawElev(c, result) {
    const canvas = $('elevChart');
    if (!canvas) return;
    const parent = canvas.parentElement;
    const cssW = Math.max(1, Math.floor(parent ? parent.clientWidth : canvas.clientWidth || 320));
    const cssH = Math.max(1, Math.floor(parent ? parent.clientHeight : 180));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pts = c.profile || [];
    if (pts.length < 2) return;
    const xmin = pts[0].d_km;
    const xmax = pts[pts.length - 1].d_km;
    const ymin = Math.min.apply(null, pts.map(function (p) { return p.ele_m; }));
    const ymax = Math.max.apply(null, pts.map(function (p) { return p.ele_m; }));
    const padL = 34, padR = 12, padT = 16, padB = 26;
    const x = function (d) { return padL + ((d - xmin) / (xmax - xmin || 1)) * (cssW - padL - padR); };
    const y = function (e) { return padT + (1 - (e - ymin) / (ymax - ymin || 1)) * (cssH - padT - padB); };
    ctx.clearRect(0, 0, cssW, cssH);
    for (let i = 0; i < pts.length - 1; i++) {
      const g = estimateGradeAt(pts, i);
      const x0 = x(pts[i].d_km);
      const x1 = x(pts[i + 1].d_km);
      ctx.fillStyle = zoneColor(g, 0.16);
      ctx.fillRect(x0, padT, Math.max(1, x1 - x0), cssH - padT - padB);
    }
    ctx.strokeStyle = 'rgba(180, 200, 220, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, cssH - padB);
    ctx.lineTo(cssW - padR, cssH - padB);
    ctx.stroke();
    ctx.beginPath();
    pts.forEach(function (p, i) {
      const X = x(p.d_km), Y = y(p.ele_m);
      if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    });
    ctx.lineTo(x(xmax), cssH - padB);
    ctx.lineTo(x(xmin), cssH - padB);
    ctx.closePath();
    ctx.fillStyle = 'rgba(110, 184, 201, 0.12)';
    ctx.fill();
    for (let i = 0; i < pts.length - 1; i++) {
      const g = estimateGradeAt(pts, i);
      ctx.beginPath();
      ctx.moveTo(x(pts[i].d_km), y(pts[i].ele_m));
      ctx.lineTo(x(pts[i + 1].d_km), y(pts[i + 1].ele_m));
      ctx.strokeStyle = strokeForGrade(g);
      ctx.lineWidth = 2.25;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.fillStyle = '#93a4b8';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(Math.round(ymin) + ' m', 4, cssH - padB);
    ctx.fillText(Math.round(ymax) + ' m', 4, padT + 10);
    ctx.fillText(xmax.toFixed(1) + ' km', cssW - padR - 40, cssH - 8);
    if (result && Array.isArray(result.splits) && result.splits.length) {
      let maxPull = null, maxPush = null;
      result.splits.forEach(function (sp) {
        const g = Number(sp.grade_pct) || 0;
        if (!maxPull || g > Number(maxPull.grade_pct)) maxPull = sp;
        if (!maxPush || g < Number(maxPush.grade_pct)) maxPush = sp;
      });
      const mark = function (sp, label, color) {
        if (!sp || sp.partial) return;
        const d = Math.min(xmax, Math.max(xmin, Number(sp.km) - 0.5));
        let nearest = pts[0], best = Infinity;
        for (let pi = 0; pi < pts.length; pi++) {
          const p = pts[pi];
          const dd = Math.abs(p.d_km - d);
          if (dd < best) { best = dd; nearest = p; }
        }
        const mx = x(nearest.d_km), my = y(nearest.ele_m);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(mx, my, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillText(label, mx + 5, my - 6);
      };
      if (maxPull && Number(maxPull.grade_pct) >= GRADE_PULL) mark(maxPull, 'pull', '#c9a46e');
      if (maxPush && Number(maxPush.grade_pct) <= GRADE_PUSH) mark(maxPush, 'push', '#7cbc8a');
    }
  }

  function scheduleDraw() {
    clearTimeout(drawTimer);
    drawTimer = setTimeout(function () { if (courseData) drawElev(courseData, lastResult); }, 40);
  }

  function renderResult(r) {
    lastResult = r;
    const box = $('result');
    box.innerHTML =
      '<div class="result-hero"><span class="label">Estimated finish</span><span class="finish">' + r.estimated_finish + '</span></div>' +
      '<div class="result-grid">' +
      '<div><span>Clock avg</span><strong>' + r.avg_clock_pace + '/km</strong></div>' +
      '<div><span>Equiv flat</span><strong>' + r.equivalent_flat_km + ' km</strong></div>' +
      '<div><span>Flat effort</span><strong>' + r.flat_pace + '/km</strong></div>' +
      '<div><span>Distance</span><strong>' + r.distance_km + ' km</strong></div></div>' +
      '<p class="effort">' + (r.effort_note || '') + '</p>';
    renderGuidance(r.splits || []);
    renderSplits(r.splits || []);
    scheduleDraw();
  }

  function notableSplits(splits) {
    return (splits || []).filter(function (sp) { return cueForSplit(sp).key !== 'hold'; });
  }

  function renderGuidance(splits) {
    const card = $('guidance-card');
    const list = $('guidance-list');
    const toggle = $('guidance-toggle');
    const notable = notableSplits(splits);
    if (!notable.length) { card.hidden = true; return; }
    card.hidden = false;
    const rows = guidanceExpanded ? notable : notable.slice(0, 5);
    list.innerHTML = rows.map(function (sp) {
      const cue = cueForSplit(sp);
      const elev = (sp.delta_m > 0 ? '+' : '') + sp.delta_m + ' m · ' + (sp.split_pace || '—') + '/km';
      return '<li><span class="km">' + sp.km + '</span><span class="tip">' + cue.tip + '</span><span class="cue ' + cue.key + '">' + cue.label + '</span><span class="detail">' + elev + '</span></li>';
    }).join('');
    if (notable.length > 5) {
      toggle.hidden = false;
      toggle.textContent = guidanceExpanded ? 'Show less' : 'Show all (' + notable.length + ')';
    } else toggle.hidden = true;
  }

  function rankedHillSplits(splits) {
    const scored = (splits || []).map(function (sp, i) {
      return { sp: sp, i: i, abs: Math.abs(Number(sp.grade_pct) || 0), notable: cueForSplit(sp).key !== 'hold' };
    });
    const picks = scored.filter(function (x) { return x.notable; })
      .sort(function (a, b) { return b.abs - a.abs || a.i - b.i; })
      .slice(0, 5)
      .sort(function (a, b) { return a.i - b.i; })
      .map(function (x) { return x.sp; });
    return picks.length ? picks : (splits || []).slice(0, 5);
  }

  function renderSplits(splits) {
    const card = $('splits-card');
    const toggle = $('splits-toggle');
    const tb = $('splits-table').querySelector('tbody');
    if (!splits || !splits.length) { card.hidden = true; return; }
    card.hidden = false;
    const rows = splitsExpanded ? splits : rankedHillSplits(splits);
    tb.innerHTML = rows.map(function (sp) {
      const cue = cueForSplit(sp);
      const delta = (sp.delta_m > 0 ? '+' : '') + sp.delta_m + ' m';
      return '<tr><td>' + sp.km + '</td><td>' + delta + '</td><td><span class="mini-cue cue ' + cue.key + '">' + cue.label + '</span></td><td>' + sp.split_pace + '</td><td>' + sp.cum_time + '</td></tr>';
    }).join('');
    if (splits.length > rows.length || (splitsExpanded && splits.length > 5)) {
      toggle.hidden = false;
      toggle.textContent = splitsExpanded ? 'Show less' : 'Show all ' + splits.length + ' km';
    } else toggle.hidden = true;
  }

  async function calculate(paceSec) {
    const my = ++inflight;
    const box = $('result');
    box.classList.add('is-updating');
    const params = new URLSearchParams({ mode: 'pace', pace_sec: String(paceSec) });
    try {
      const res = await fetch('/api/calculate?' + params.toString());
      const data = await res.json();
      if (my !== inflight) return;
      if (!res.ok) {
        box.classList.remove('is-updating');
        box.innerHTML = '<p class="error">' + (typeof data.detail === 'string' ? data.detail : 'Could not calculate') + '</p>';
        return;
      }
      renderResult(data);
      box.classList.remove('is-updating');
    } catch (err) {
      if (my !== inflight) return;
      box.classList.remove('is-updating');
      box.innerHTML = '<p class="error">' + (err.message || err) + '</p>';
    }
  }

  function scheduleCalc(immediate) {
    const paceSec = Number($('pace-slider').value);
    $('pace-label').textContent = fmtPace(paceSec);
    $('pace-slider').setAttribute('aria-valuenow', String(paceSec));
    $('pace-slider').setAttribute('aria-valuetext', paceAria(paceSec));
    clearTimeout(calcTimer);
    calcTimer = setTimeout(function () { calculate(paceSec); }, immediate ? 0 : 120);
  }

  function bind() {
    const slider = $('pace-slider');
    slider.addEventListener('input', function () { scheduleCalc(false); });
    slider.addEventListener('change', function () { scheduleCalc(true); });
    $('splits-toggle').addEventListener('click', function () {
      splitsExpanded = !splitsExpanded;
      if (lastResult) renderSplits(lastResult.splits || []);
    });
    $('guidance-toggle').addEventListener('click', function () {
      guidanceExpanded = !guidanceExpanded;
      if (lastResult) renderGuidance(lastResult.splits || []);
    });
    const chartWrap = document.querySelector('.chart-wrap');
    if (chartWrap && typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(function () { scheduleDraw(); }).observe(chartWrap);
    }
    window.addEventListener('resize', scheduleDraw);
    window.addEventListener('orientationchange', function () { setTimeout(scheduleDraw, 200); });
  }

  async function boot() {
    bind();
    scheduleCalc(false);
    try {
      const res = await fetch('/api/course');
      const c = await res.json();
      if (!res.ok) throw new Error(c.detail || 'Course failed');
      courseData = c;
      renderStats(c);
      scheduleDraw();
      scheduleCalc(true);
    } catch (err) {
      $('stats').innerHTML = '<p class="error">' + (err.message || err) + '</p>';
      $('result').innerHTML = '<p class="error">Could not load course</p>';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
