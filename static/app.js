(() => {
  const $ = (id) => document.getElementById(id);
  let mode = 'pace';
  function fmtPace(sec) {
    sec = Math.round(sec);
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }
  function setMode(next) {
    mode = next;
    $('tab-pace').classList.toggle('active', mode === 'pace');
    $('tab-finish').classList.toggle('active', mode === 'finish');
    $('pane-pace').classList.toggle('hidden', mode !== 'pace');
    $('pane-finish').classList.toggle('hidden', mode !== 'finish');
  }
  function renderStats(c) {
    $('subtitle').textContent = c.location + ' · ' + c.distance_km + ' km';
    $('elev-chip').textContent = Math.round(c.elev_min_ft) + '-' + Math.round(c.elev_max_ft) + ' ft';
    $('stats').innerHTML = [
      ['Distance', c.distance_km + ' km'],
      ['Gain', Math.round(c.elev_gain_m) + ' m'],
      ['Loss', Math.round(c.elev_loss_m) + ' m'],
      ['Max elev', Math.round(c.elev_max_m) + ' m']
    ].map(([k,v]) => '<div class="stat"><span>' + k + '</span><strong>' + v + '</strong></div>').join('');
    const src = c.source || {};
    $('source-hint').textContent = src.geometry ? ('Route: ' + src.geometry) : '';
    $('model-note').textContent = c.model || '';
  }
  function drawElev(c) {
    const canvas = $('elevChart');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 320;
    const h = 180;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    const pts = c.profile;
    const xmin = pts[0].d_km, xmax = pts[pts.length-1].d_km;
    const ymin = Math.min(...pts.map(p => p.ele_m));
    const ymax = Math.max(...pts.map(p => p.ele_m));
    const pad = 28;
    const x = (d) => pad + (d - xmin) / (xmax - xmin || 1) * (w - pad * 2);
    const y = (e) => h - pad - (e - ymin) / (ymax - ymin || 1) * (h - pad * 2);
    ctx.clearRect(0,0,w,h);
    ctx.strokeStyle = 'rgba(120,200,255,0.15)';
    ctx.beginPath(); ctx.moveTo(pad, pad); ctx.lineTo(pad, h-pad); ctx.lineTo(w-pad, h-pad); ctx.stroke();
    ctx.beginPath();
    pts.forEach((p,i) => { const X=x(p.d_km), Y=y(p.ele_m); if(i===0) ctx.moveTo(X,Y); else ctx.lineTo(X,Y); });
    ctx.strokeStyle = '#3ee0ff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.lineTo(x(xmax), h-pad); ctx.lineTo(x(xmin), h-pad); ctx.closePath();
    ctx.fillStyle = 'rgba(62,224,255,0.12)'; ctx.fill();
    ctx.fillStyle = '#8aa0b8'; ctx.font = '11px sans-serif';
    ctx.fillText(Math.round(ymin) + 'm', 2, h-pad); ctx.fillText(Math.round(ymax) + 'm', 2, pad+8);
    ctx.fillText(xmax.toFixed(1) + 'km', w-pad-28, h-8);
  }
  function renderResult(r) {
    const box = $('result'); box.hidden = false;
    if (r.mode === 'pace') {
      box.innerHTML = '<div class="result-grid">'
        + '<div><span>Finish</span><strong>' + r.estimated_finish + '</strong></div>'
        + '<div><span>Clock pace</span><strong>' + r.avg_clock_pace + '/km</strong></div>'
        + '<div><span>Flat effort</span><strong>' + r.flat_pace + '/km</strong></div>'
        + '<div><span>Equiv flat</span><strong>' + r.equivalent_flat_km + ' km</strong></div></div>'
        + '<p class="effort">' + r.effort_note + '</p>';
    } else {
      box.innerHTML = '<div class="result-grid">'
        + '<div><span>Target</span><strong>' + r.target_finish + '</strong></div>'
        + '<div><span>Need flat</span><strong>' + r.required_flat_pace + '/km</strong></div>'
        + '<div><span>Clock pace</span><strong>' + r.avg_clock_pace + '/km</strong></div>'
        + '<div><span>Equiv flat</span><strong>' + r.equivalent_flat_km + ' km</strong></div></div>'
        + '<p class="effort">' + r.effort_note + '</p>';
    }
    const tb = $('splits-table').querySelector('tbody');
    tb.innerHTML = (r.splits || []).map(s => '<tr><td>' + s.km + '</td><td>' + (s.delta_m>0?'+':'') + s.delta_m + ' m</td><td>' + s.split_pace + '</td><td>' + s.cum_time + '</td></tr>').join('');
    $('splits-card').hidden = !(r.splits && r.splits.length);
  }
  async function calculate() {
    const params = new URLSearchParams({ mode });
    if (mode === 'pace') params.set('pace_sec', String($('pace-slider').value));
    else params.set('target_finish', $('finish-input').value.trim());
    const res = await fetch('/api/calculate?' + params);
    const data = await res.json();
    if (!res.ok) { $('result').hidden = false; $('result').innerHTML = '<p class="error">' + (data.detail || 'failed') + '</p>'; return; }
    renderResult(data);
  }
  $('pace-slider').addEventListener('input', (e) => { $('pace-label').textContent = fmtPace(Number(e.target.value)); });
  $('tab-pace').addEventListener('click', () => setMode('pace'));
  $('tab-finish').addEventListener('click', () => setMode('finish'));
  $('calc-btn').addEventListener('click', () => calculate().catch(console.error));
  $('pace-label').textContent = fmtPace(Number($('pace-slider').value));
  fetch('/api/course').then(r => r.json()).then(c => { renderStats(c); drawElev(c); return calculate(); }).catch(err => { $('stats').innerHTML = '<p class="error">' + err + '</p>'; });
})();
