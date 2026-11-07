/* 가치평가 실습실 화면
 *
 * 계산은 calc.js(평가)와 backtest.js(자동매매)가 하고, 이 파일은 입력과 표시만 맡는다.
 * 입력이 바뀌면 가벼운 계산은 바로, 무거운 계산(민감도·역산·주가별 가치)은 입력이 멈춘 뒤 다시 한다.
 */
(function () {
  'use strict';
  const C = window.VCalc, B = window.BT;

  // ------------------------------------------------------------ 표기
  const fmt = (x, d) => (isFinite(x) ? x.toLocaleString('ko-KR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }) : '-');
  const won = x => fmt(Math.round(x));
  const pct = (x, d, sign) => (isFinite(x) ? (sign && x > 0 ? '+' : '') + (x * 100).toFixed(d == null ? 1 : d) + '%' : '-');
  const pp = (x, d) => (isFinite(x) ? (x > 0 ? '+' : '') + (x * 100).toFixed(d == null ? 1 : d) + '%p' : '-');
  const signed = (x, d) => (isFinite(x) ? (x > 0 ? '+' : '') + fmt(x, d) : '-');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  // 백테스트 시각은 실제 UTC 밀리초. 9시간을 더해 UTC 로 읽으면 한국 시각이 된다
  const KST_MS = 9 * 3600 * 1000;
  const kst = (ms, short) => {
    const d = new Date(ms + KST_MS);
    const md = pad(d.getUTCMonth() + 1) + '/' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
    return short ? md : d.getUTCFullYear() + '-' + md.replace('/', '-');
  };
  const $ = id => document.getElementById(id);
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  function kpi(label, value, unit, sub, main) {
    return '<div class="kpi' + (main ? ' main' : '') + '"><div class="kpi-label">' + label + '</div>' +
      '<div class="kpi-value">' + value + (unit ? '<span class="u">' + unit + '</span>' : '') + '</div>' +
      (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') + '</div>';
  }
  function note(level, title, body) {
    const name = { good: '양호', warn: '주의', bad: '확인 필요', info: '참고', ask: '질문' }[level] || level;
    const cls = level === 'ask' ? 'muted' : level;
    return '<li class="note"><span class="chip ' + cls + '">' + name + '</span><div><b>' + title + '</b>' +
      (body ? '<p>' + body + '</p>' : '') + '</div></li>';
  }
  function table(head, rows, opts) {
    opts = opts || {};
    let h = '<table class="tbl"><thead><tr>' + head.map(x => '<th>' + x + '</th>').join('') + '</tr></thead><tbody>';
    rows.forEach((r, i) => {
      const cls = opts.rowClass ? opts.rowClass(i) : '';
      const attr = opts.rowAttr ? opts.rowAttr(i) : '';
      h += '<tr' + (cls ? ' class="' + cls + '"' : '') + attr + '>' + r.map(c => '<td' + (typeof c === 'object' && c && c.cls ? ' class="' + c.cls + '"' : '') + '>' +
        (typeof c === 'object' && c ? c.v : c) + '</td>').join('') + '</tr>';
    });
    return h + '</tbody></table>';
  }

  // ------------------------------------------------------------ 입력 패널
  // 숫자 입력은 슬라이더와 숫자 칸이 함께 움직인다. scale 은 화면 단위 ÷ 계산 단위 (예: 퍼센트는 100).
  function makePanel(root, groups, onChange) {
    const vals = {}, setters = {}, rows = [];
    root.innerHTML = '';
    const decimals = s => { const t = String(s); return t.indexOf('.') < 0 ? 0 : t.length - t.indexOf('.') - 1; };
    function refresh() {
      rows.forEach(r => {
        if (r.it.showIf) r.node.hidden = !r.it.showIf(vals);
        if (r.it.enabledIf) {
          const on = r.it.enabledIf(vals);
          r.node.querySelectorAll('input,select,button').forEach(x => { x.disabled = !on; });
          r.node.style.opacity = on ? '' : '0.45';
        }
      });
    }
    function changed(id) { refresh(); onChange(id, vals); }
    function item(it) {
      const box = document.createElement('div');
      box.className = 'ctl';
      if (it.type === 'switch') {
        vals[it.id] = !!it.value;
        box.innerHTML = '<label class="switch"><input type="checkbox" id="' + it.id + '"' + (it.value ? ' checked' : '') + '><span>' + it.label + '</span></label>';
        const cb = box.querySelector('input');
        cb.addEventListener('change', () => { vals[it.id] = cb.checked; changed(it.id); });
        setters[it.id] = v => { vals[it.id] = !!v; cb.checked = !!v; };
      } else if (it.type === 'seg') {
        vals[it.id] = it.value;
        box.innerHTML = (it.label ? '<label>' + it.label + '</label>' : '') + '<div class="seg" role="group" aria-label="' + esc(it.label || '') + '">' +
          it.options.map(o => '<button type="button" data-v="' + esc(o[0]) + '" aria-pressed="' + (String(o[0]) === String(it.value)) + '">' + o[1] + '</button>').join('') + '</div>';
        const bs = box.querySelectorAll('button');
        const pick = v => bs.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
        bs.forEach(b => b.addEventListener('click', () => {
          const o = it.options.find(x => String(x[0]) === b.dataset.v);
          vals[it.id] = o[0]; pick(o[0]); changed(it.id);
        }));
        setters[it.id] = v => { vals[it.id] = v; pick(v); };
      } else if (it.type === 'date') {
        vals[it.id] = it.value;
        box.innerHTML = '<label for="' + it.id + '">' + it.label + '</label><input type="date" id="' + it.id + '" value="' + it.value + '" min="' + it.min + '" max="' + it.max + '">';
        const d = box.querySelector('input');
        d.addEventListener('change', () => { if (d.value) { vals[it.id] = d.value; changed(it.id); } });
        setters[it.id] = v => { vals[it.id] = v; d.value = v; };
      } else if (it.type === 'note') {
        box.innerHTML = '<p class="subtle">' + it.text + '</p>';
      } else if (it.type === 'html') {
        box.innerHTML = it.html;
        if (it.mount) it.mount(box);
      } else {
        const sc = it.scale || 1, dg = it.digits == null ? decimals(it.step) : it.digits;
        vals[it.id] = it.value;
        box.innerHTML = '<label for="' + it.id + '">' + it.label + (it.hint ? '<span class="hint">' + it.hint + '</span>' : '') + '</label>' +
          '<div class="ctl-row"><input type="range" aria-label="' + esc(it.label) + '" min="' + it.min + '" max="' + it.max + '" step="' + it.step + '">' +
          '<input type="number" id="' + it.id + '" step="' + it.step + '"><span class="unit">' + (it.unit || '') + '</span></div>';
        const r = box.querySelector('input[type=range]'), n = box.querySelector('input[type=number]');
        const show = v => { const dv = +(v * sc).toFixed(dg); r.value = dv; n.value = dv; };
        show(it.value);
        r.addEventListener('input', () => { vals[it.id] = +r.value / sc; n.value = r.value; changed(it.id); });
        n.addEventListener('input', () => {
          const x = parseFloat(n.value);
          if (!isFinite(x)) return;
          if (it.minHard != null && x < it.minHard) return;
          vals[it.id] = x / sc; r.value = x; changed(it.id);
        });
        setters[it.id] = v => { vals[it.id] = v; show(v); };
      }
      rows.push({ it: it, node: box });
      return box;
    }
    groups.forEach(g => {
      const fs = document.createElement('fieldset');
      fs.className = 'group';
      if (g.legend) { const lg = document.createElement('legend'); lg.textContent = g.legend; fs.appendChild(lg); }
      g.items.forEach(it => fs.appendChild(item(it)));
      if (g.showIf) rows.push({ it: { showIf: g.showIf }, node: fs });
      root.appendChild(fs);
    });
    refresh();
    return { vals: vals, set: (k, v) => setters[k] && setters[k](v), refresh: refresh };
  }

  // ------------------------------------------------------------ 차트
  const charts = {};
  function chart(id) {
    const node = $(id);
    if (!charts[id] || charts[id].getDom() !== node) charts[id] = echarts.init(node, null, { renderer: 'canvas' });
    return charts[id];
  }
  function axis(extra) {
    return Object.assign({
      axisLine: { lineStyle: { color: css('--line-2') } }, axisTick: { show: false },
      axisLabel: { color: css('--muted'), fontSize: 11.5 },
      splitLine: { lineStyle: { color: css('--line') } }, nameTextStyle: { color: css('--muted'), fontSize: 11.5 },
    }, extra || {});
  }
  function base(extra) {
    return Object.assign({
      animation: false, useUTC: true,
      textStyle: { fontFamily: "'Noto Sans KR', sans-serif", color: css('--text') },
      grid: { left: 64, right: 20, top: 34, bottom: 34 },
      tooltip: { trigger: 'axis', backgroundColor: css('--surface'), borderColor: css('--line-2'), textStyle: { color: css('--ink'), fontSize: 12.5 } },
      legend: { top: 0, right: 0, textStyle: { color: css('--muted'), fontSize: 12 }, itemWidth: 14, itemHeight: 8 },
    }, extra || {});
  }
  function resizeVisible() {
    Object.keys(charts).forEach(k => { const d = charts[k].getDom(); if (d && d.offsetParent) charts[k].resize(); });
  }
  window.addEventListener('resize', () => requestAnimationFrame(resizeVisible));

  // 같은 프레임에 여러 번 바뀌면 한 번만 계산
  function throttle(fn) {
    let queued = false;
    return function () { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fn(); }); };
  }
  function later(fn, ms) {
    let t = null;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  // ============================================================ 1. 복합금융상품
  // 기본값은 tests/defaults.json 과 같다 (검증에 쓴 입력).
  const CB_PRESETS = {
    rcps: { label: '상환전환우선주 예시', S0: 18500, sigma: 0.45, r: 0.028, q: 0, cs: 0.08, F: 20000, T: 9, elapsed: 1,
            convOn: true, convPrice: 20000, convStart: 0, coupon: 0, couponFreq: 1, ytm: 0.07, ytmFreq: 1,
            putOn: true, putStart: 2, putFreq: 4, putYield: 0.07, callOn: false, callStart: 0, callEnd: 1, callYield: 0.07, N: 300,
            reported: 28400, desc: '비상장 가상회사 A의 상환전환우선주. 발행가 20,000원, 1주당 보통주 1주로 전환, 발행 3년 후부터 연 7% 복리로 상환 청구 가능, 존속기간 10년.' },
    cb: { label: '전환사채 예시', S0: 4800, sigma: 0.5, r: 0.027, q: 0, cs: 0.06, F: 10000, T: 2.5, elapsed: 0.5,
          convOn: true, convPrice: 5000, convStart: 0.5, coupon: 0.01, couponFreq: 4, ytm: 0.03, ytmFreq: 4,
          putOn: true, putStart: 1.0, putFreq: 4, putYield: 0.03, callOn: false, callStart: 0, callEnd: 1, callYield: 0.03, N: 250,
          reported: 12900, desc: '코스닥 가상회사 B의 3년 만기 전환사채. 액면 1만원당 2주로 전환(전환가격 5,000원), 표면이자 1%, 만기 보장수익률 3%, 발행 1년 6개월 후부터 분기마다 조기상환 청구.' },
  };
  let cbPanel = null, cbPreset = 'rcps';
  const FREQ = [[12, '매월'], [4, '분기'], [2, '반기'], [1, '매년']];

  function cbGroups(P) {
    const F = P.F;
    return [
      { legend: '예시', items: [
        { type: 'seg', id: 'preset', value: cbPreset, options: [['rcps', '상환전환우선주'], ['cb', '전환사채']] },
        { type: 'note', text: P.desc } ] },
      { legend: '기초자산', items: [
        { id: 'S0', label: '주가', hint: '평가기준일 보통주 1주 가치', min: Math.round(F * 0.2 / 100) * 100, max: Math.round(F * 3 / 100) * 100, step: 50, value: P.S0, unit: '원' },
        { id: 'sigma', label: '변동성', hint: '연', min: 10, max: 120, step: 0.5, scale: 100, value: P.sigma, unit: '%' },
        { id: 'q', label: '배당수익률', min: 0, max: 6, step: 0.1, scale: 100, value: P.q, unit: '%' } ] },
      { legend: '할인율', items: [
        { id: 'r', label: '무위험이자율', hint: '국고채, 연복리', min: 0, max: 8, step: 0.05, scale: 100, value: P.r, unit: '%' },
        { id: 'cs', label: '신용스프레드', hint: '등급별 회사채 − 국고채', min: 0, max: 20, step: 0.1, scale: 100, value: P.cs, unit: '%' } ] },
      { legend: '증권 조건', items: [
        { id: 'F', label: '발행가·액면', min: 1000, max: 100000, step: 100, value: F, unit: '원' },
        { id: 'convPrice', label: '전환가격', min: Math.round(F * 0.3 / 100) * 100, max: Math.round(F * 2 / 100) * 100, step: 50, value: P.convPrice, unit: '원' },
        { id: 'T', label: '잔존만기', min: 0.25, max: 15, step: 0.25, value: P.T, unit: '년' },
        { id: 'elapsed', label: '발행 후 경과', min: 0, max: 10, step: 0.25, value: P.elapsed, unit: '년' },
        { id: 'convStart', label: '전환 가능 시점', hint: '평가일로부터', min: 0, max: 10, step: 0.25, value: P.convStart, unit: '년' },
        { id: 'coupon', label: '표면이자율', min: 0, max: 8, step: 0.25, scale: 100, value: P.coupon, unit: '%' },
        { type: 'seg', id: 'couponFreq', label: '이자 지급', value: P.couponFreq, options: FREQ },
        { id: 'ytm', label: '만기 보장수익률', min: 0, max: 15, step: 0.25, scale: 100, value: P.ytm, unit: '%' },
        { type: 'seg', id: 'ytmFreq', label: '보장수익률 복리', value: P.ytmFreq, options: FREQ } ] },
      { legend: '조기상환 청구 · 상환권', items: [
        { type: 'switch', id: 'putOn', label: '보유자가 상환을 청구할 수 있음', value: P.putOn },
        { id: 'putStart', label: '첫 청구 가능 시점', hint: '평가일로부터', min: 0, max: 10, step: 0.25, value: P.putStart, unit: '년', enabledIf: v => v.putOn },
        { type: 'seg', id: 'putFreq', label: '청구 주기', value: P.putFreq, options: FREQ, enabledIf: v => v.putOn },
        { id: 'putYield', label: '조기상환 수익률', min: 0, max: 15, step: 0.25, scale: 100, value: P.putYield, unit: '%', enabledIf: v => v.putOn } ] },
      { legend: '매도청구 · 콜옵션', items: [
        { type: 'switch', id: 'callOn', label: '발행회사가 매도를 청구할 수 있음', value: P.callOn },
        { id: 'callStart', label: '청구 시작', hint: '평가일로부터', min: 0, max: 10, step: 0.25, value: P.callStart, unit: '년', enabledIf: v => v.callOn },
        { id: 'callEnd', label: '청구 끝', min: 0, max: 15, step: 0.25, value: P.callEnd, unit: '년', enabledIf: v => v.callOn },
        { id: 'callYield', label: '매도청구 수익률', min: 0, max: 15, step: 0.25, scale: 100, value: P.callYield, unit: '%', enabledIf: v => v.callOn } ] },
      { legend: '계산', items: [
        { id: 'N', label: '격자 수', hint: '많을수록 정밀', min: 100, max: 800, step: 50, value: P.N, unit: '개' } ] },
      { legend: '리뷰 대상', items: [
        { id: 'reported', label: '평가인 보고 공정가치', hint: '보고서의 숫자', min: Math.round(F * 0.3 / 100) * 100, max: Math.round(F * 3 / 100) * 100, step: 10, value: P.reported, unit: '원' },
        { type: 'note', text: '보고값을 넣으면 그 숫자를 맞추는 변동성과 신용스프레드를 거꾸로 찾습니다.' } ] },
    ];
  }

  function cbParams() {
    const v = cbPanel.vals;
    return { S0: v.S0, sigma: v.sigma, r: v.r, q: v.q, cs: v.cs, F: v.F, T: v.T, elapsed: v.elapsed,
             convOn: true, convPrice: v.convPrice, convStart: v.convStart, coupon: v.coupon, couponFreq: +v.couponFreq,
             ytm: v.ytm, ytmFreq: +v.ytmFreq, putOn: v.putOn, putStart: v.putStart, putFreq: +v.putFreq, putYield: v.putYield,
             callOn: v.callOn, callStart: v.callStart, callEnd: v.callEnd, callYield: v.callYield, N: v.N, reported: v.reported };
  }

  function cbInit() {
    const build = () => {
      cbPanel = makePanel($('cb-panel'), cbGroups(CB_PRESETS[cbPreset]), id => {
        if (id === 'preset') { cbPreset = cbPanel.vals.preset; build(); cbRun(); cbExtras(); return; }
        cbRun(); cbExtrasLater();
      });
    };
    build();
    cbRun(); cbExtras();
  }

  let cbLast = null;
  const cbRun = throttle(function () {
    const p = cbParams();
    const r = C.convertible(p, { map: true });
    if (r.error) { $('cb-kpis').innerHTML = '<div class="callout">' + r.error + '</div>'; return; }
    cbLast = { p: p, r: r };
    const diff = p.reported > 0 ? p.reported / r.value - 1 : NaN;
    const dcls = Math.abs(diff) > 0.05 ? 'down' : Math.abs(diff) > 0.02 ? '' : 'up';
    $('cb-kpis').innerHTML =
      kpi('재계산 공정가치', won(r.value), '원', '발행가 대비 ' + pct(r.value / p.F) + ' · 격자 ' + p.N + '개', true) +
      kpi('평가인 보고값', p.reported > 0 ? won(p.reported) : '-', '원', p.reported > 0 ? '재계산 대비 <b class="' + dcls + '">' + pct(diff, 1, true) + '</b>' : '보고값을 넣으세요') +
      kpi('주식으로 받을 몫', won(r.equity), '원', '현금으로 받을 몫 ' + won(r.debt) + '원') +
      kpi('델타', r.delta.toFixed(3), '', '주가 1원 상승 시 가치 변화 · 전환주식 수 대비 ' + pct(r.delta / r.CR, 0));
    cbMap(p, r);
    $('cb-method').innerHTML = '쓰베리오티스-페르난데스 방식 이항모형입니다. 격자의 각 지점에서 보유·전환·조기상환 청구·매도청구 가운데 유리한 선택을 만기부터 거꾸로 따져 가치를 구합니다. ' +
      '전환으로 받을 몫은 무위험이자율로, 현금으로 받을 몫은 신용스프레드를 더한 이자율로 할인해 발행회사 신용위험을 반영합니다. ' +
      '입력 금리는 연복리이고 계산에서는 연속복리로 바꿉니다. 격자 간격 ' + r.dt.toFixed(4) + '년, 한 칸 상승 배수 ' + r.u.toFixed(4) +
      ', 위험중립 상승 확률 ' + r.pu.toFixed(4) + ', 만기 상환액 ' + won(r.redeemAtT) + '원.';
  });

  const ACT_STYLE = [
    ['보유', '--c5'], ['전환', '--c2'], ['상환 청구', '--c1'], ['매도청구로 상환', '--c3'], ['매도청구 때 전환', '--c4'], ['만기 상환', '--c6'],
  ];
  function cbMap(p, r) {
    const N = r.N, every = Math.max(1, Math.ceil(N / 120)), lo = Math.log(p.S0 / 5), hi = Math.log(p.S0 * 5);
    const lu = Math.log(r.u), series = ACT_STYLE.map(a => ({ name: a[0], type: 'scatter', symbolSize: 4, data: [], itemStyle: { color: css(a[1]) } }));
    // 일정 간격으로 고르되, 조기상환·매도청구처럼 보유 말고 다른 선택이 나온 시점은 모두 넣는다
    for (let i = 0; i <= N; i++) {
      const acts = r.map[i], t = i * r.dt;
      if (i % every !== 0 && i !== N && !acts.some(a => a !== 0)) continue;
      for (let j = 0; j <= i; j++) {
        const y = Math.log(p.S0) + (2 * j - i) * lu;
        if (y < lo || y > hi) continue;
        series[acts[j]].data.push([+t.toFixed(4), y]);
      }
    }
    chart('cb-map').setOption(base({
      grid: { left: 70, right: 20, top: 34, bottom: 40 },
      tooltip: { trigger: 'item', backgroundColor: css('--surface'), borderColor: css('--line-2'), textStyle: { color: css('--ink'), fontSize: 12.5 },
                 formatter: q => q.seriesName + '<br>' + q.value[0].toFixed(2) + '년 · 주가 ' + won(Math.exp(q.value[1])) + '원' },
      xAxis: axis({ type: 'value', name: '평가일로부터 (년)', nameLocation: 'middle', nameGap: 26, min: 0, max: p.T }),
      yAxis: axis({ type: 'value', min: lo, max: hi, splitNumber: 6, axisLabel: { color: css('--muted'), fontSize: 11.5, formatter: v => fmt(Math.round(Math.exp(v) / 100) * 100) } }),
      series: series.filter(s => s.data.length),
    }), true);
  }

  const cbExtrasLater = later(() => cbExtras(), 140);
  function cbExtras() {
    const p = cbParams();
    const rep = C.convertibleReport(p);
    if (rep.error) return;
    // 역산
    const box = $('cb-implied');
    if (p.reported > 0) {
      const diff = p.reported / rep.value - 1;
      const is = rep.impliedSigma, ic = rep.impliedCs;
      let msg;
      if (Math.abs(diff) < 0.01) msg = '재계산과 보고값이 1% 안에서 맞습니다. 보고서 가정을 그대로 쓰면 계산 방식도 같다고 볼 수 있습니다.';
      else {
        msg = '보고값이 재계산보다 ' + pct(Math.abs(diff)) + (diff > 0 ? ' 높습니다. ' : ' 낮습니다. ');
        msg += (is != null ? '변동성 하나로 설명하려면 ' + pp(is - p.sigma) + ', ' : '변동성만으로는 설명되지 않고, ') +
          (ic != null ? '신용스프레드 하나로는 ' + pp(ic - p.cs) + ' 바뀌어야 합니다. ' : '신용스프레드만으로도 설명되지 않습니다. ');
        msg += '보고서의 변동성 산정 기간과 비교기업, 신용등급 근거, 격자 수와 상환 조건 반영 방식을 차례로 확인합니다.';
      }
      box.innerHTML = '<div class="card-head"><h3>보고값을 맞추는 가정</h3><span class="subtle">다른 입력은 그대로 두고 하나만 움직여 찾은 값</span></div>' +
        '<div class="kpis">' +
        kpi('역산 변동성', is != null ? pct(is) : '범위 밖', '', '입력 ' + pct(p.sigma) + (is != null ? ' · 차이 ' + pp(is - p.sigma) : '')) +
        kpi('역산 신용스프레드', ic != null ? pct(ic, 2) : '범위 밖', '', '입력 ' + pct(p.cs, 2) + (ic != null ? ' · 차이 ' + pp(ic - p.cs, 2) : '')) +
        kpi('일반사채 가치', won(rep.straight), '원', '전환권 가치 ' + won(rep.option) + '원') +
        '</div><p class="callout" style="margin-top:12px">' + msg + '</p>';
    } else box.innerHTML = '<p class="subtle">평가인 보고값을 넣으면 그 값을 맞추는 가정을 찾습니다.</p>';

    // 민감도
    const t = rep.tornado.slice().reverse();
    chart('cb-tornado').setOption(base({
      grid: { left: 128, right: 24, top: 34, bottom: 30 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: css('--surface'), borderColor: css('--line-2'), textStyle: { color: css('--ink'), fontSize: 12.5 },
                 valueFormatter: v => signed(v) + '원' },
      xAxis: axis({ type: 'value', axisLabel: { color: css('--muted'), fontSize: 11.5, formatter: v => signed(v) } }),
      yAxis: axis({ type: 'category', data: t.map(x => x.name), axisLabel: { color: css('--text'), fontSize: 12 } }),
      series: [
        { name: '입력을 낮출 때', type: 'bar', data: t.map(x => Math.round(x.dn - rep.value)), itemStyle: { color: css('--c3') }, barGap: '15%' },
        { name: '입력을 높일 때', type: 'bar', data: t.map(x => Math.round(x.up - rep.value)), itemStyle: { color: css('--c2') } },
      ],
    }), true);

    // 주가에 따른 가치
    const xs = [], vs = [], parity = [];
    for (let k = 0; k <= 22; k++) {
      const s = p.S0 * (0.3 + k * 0.1);
      xs.push(Math.round(s));
      vs.push(Math.round(C.convertible(Object.assign({}, p, { S0: s })).value));
      parity.push(Math.round(rep.CR * s));
    }
    const pts = [{ name: '오늘 주가 · 재계산', value: [p.S0, rep.value], itemStyle: { color: css('--c2') } }];
    if (p.reported > 0) pts.push({ name: '평가인 보고값', value: [p.S0, p.reported], itemStyle: { color: css('--bad') }, symbol: 'diamond' });
    chart('cb-profile').setOption(base({
      grid: { left: 64, right: 20, top: 34, bottom: 40 },
      tooltip: { trigger: 'axis', backgroundColor: css('--surface'), borderColor: css('--line-2'), textStyle: { color: css('--ink'), fontSize: 12.5 }, valueFormatter: v => won(v) + '원' },
      xAxis: axis({ type: 'value', name: '주가 (원)', nameLocation: 'middle', nameGap: 26, min: xs[0], max: xs[xs.length - 1], axisLabel: { color: css('--muted'), fontSize: 11.5, formatter: v => fmt(v) } }),
      yAxis: axis({ type: 'value', scale: true, axisLabel: { color: css('--muted'), fontSize: 11.5, formatter: v => fmt(v) } }),
      series: [
        { name: '공정가치', type: 'line', data: xs.map((x, i) => [x, vs[i]]), showSymbol: false, lineStyle: { width: 2.5, color: css('--c1') }, itemStyle: { color: css('--c1') } },
        { name: '전환가치', type: 'line', data: xs.map((x, i) => [x, parity[i]]), showSymbol: false, lineStyle: { type: 'dashed', color: css('--c2') }, itemStyle: { color: css('--c2') } },
        { name: '일반사채 가치', type: 'line', data: xs.map(x => [x, Math.round(rep.straight)]), showSymbol: false, lineStyle: { type: 'dotted', color: css('--c3') }, itemStyle: { color: css('--c3') } },
        { name: '현재', type: 'scatter', data: pts, symbolSize: 11, tooltip: { trigger: 'item', formatter: q => q.name + ' ' + won(q.value[1]) + '원' } },
      ],
    }), true);

    // 체크리스트
    const items = [];
    const gapRel = Math.abs(rep.gridGap) / rep.value;
    items.push(note(gapRel < 0.002 ? 'good' : 'warn', '격자 수렴',
      '격자 ' + p.N + '개와 ' + (2 * Math.round(p.N)) + '개 결과 차이 ' + won(Math.abs(rep.gridGap)) + '원 (' + pct(gapRel, 2) + '). ' +
      (gapRel < 0.002 ? '격자 수에 따른 오차는 무시할 만합니다.' : '격자를 늘려 결과가 안정되는지 봅니다.')));
    if (p.reported > 0) {
      const d = Math.abs(p.reported / rep.value - 1);
      items.push(note(d < 0.02 ? 'good' : d < 0.05 ? 'warn' : 'bad', '보고값과 재계산 차이 ' + pct(d),
        d < 0.02 ? '같은 가정에서 2% 안으로 맞습니다.' : '같은 가정을 넣었는데도 차이가 납니다. 위의 역산 결과로 어떤 가정이 다른지 좁혀 갑니다.'));
    }
    if (rep.impliedSigma != null && p.reported > 0) {
      const g = Math.abs(rep.impliedSigma - p.sigma);
      items.push(note(g < 0.03 ? 'good' : 'warn', '변동성 근거', '보고값을 맞추는 변동성 ' + pct(rep.impliedSigma) + ', 보고서 변동성 ' + pct(p.sigma) + '. ' +
        '비교기업 선정, 산정 기간(잔존만기와 같은 길이인지), 일간·주간 수익률 중 무엇을 썼는지 확인합니다.'));
    }
    if (p.convStart <= 0 && !p.callOn) {
      items.push(note(rep.value >= rep.parity - 1e-6 ? 'good' : 'bad', '전환가치 이상인지',
        '지금 바로 전환할 수 있으면 공정가치가 전환가치(' + won(rep.parity) + '원)보다 낮을 수 없습니다. ' + (rep.value >= rep.parity - 1e-6 ? '충족합니다.' : '충족하지 않습니다.')));
    }
    items.push(note('ask', '리픽싱 조항', '주가 하락 시 전환가격을 낮추는 조항이 있으면 가치가 경로에 따라 달라져 이항모형에 그대로 넣을 수 없습니다. 몬테카를로로 따로 평가했는지 확인합니다.'));
    items.push(note('ask', '상환 재원', '상환전환우선주의 상환은 배당가능이익 범위에서만 가능합니다. 이익잉여금이 부족한 초기 기업이면 상환권 가치를 그대로 인정할지 따져 봅니다.'));
    items.push(note('ask', '신용스프레드', '발행회사 신용등급과 잔존만기에 맞는 회사채 수익률을 썼는지, 비상장사라면 등급을 어떻게 추정했는지 확인합니다.'));
    items.push(note('ask', '기초자산 가치', '비상장 주식이면 주가 자체가 별도 평가의 결과입니다. 최근 거래가격이나 DCF 결과와 맞는지 봅니다.'));
    items.push(note('ask', '회계 분류', '전환권이 확정 수량 조건을 충족하면 발행회사는 자본으로, 리픽싱처럼 전환 주식 수가 바뀌면 파생상품부채로 분류합니다. 평가 대상이 어느 쪽인지 보고서와 맞춰 봅니다.'));
    $('cb-check').innerHTML = items.join('');
  }

  // ============================================================ 2. 주주간 계약
  const SHA_DEFAULT = { S0: 23000, P0: 25000, elapsed: 2, shares: 400000, sigma: 0.4, r: 0.028, q: 0, putOn: true, putIrr: 0.08,
                        putStart: 1, putEnd: 3, callOn: true, callIrr: 0.15, callStart: 0, callEnd: 2, callShare: 0.5,
                        ipoProb: 0.3, ipoHorizon: 1, pd: 0.1, recovery: 0.4, paths: 20000, stepsPerYear: 12, seed: 20261107 };
  let shaPanel = null;
  function shaInit() {
    const P = SHA_DEFAULT;
    shaPanel = makePanel($('sha-panel'), [
      { legend: '투자 조건', items: [
        { type: 'note', text: '재무적 투자자가 비상장 가상회사 D의 보통주를 2년 전에 주당 25,000원에 샀고, 3년 안에 상장하지 못하면 최대주주에게 되팔 수 있는 조건입니다.' },
        { id: 'P0', label: '투자 단가', min: 1000, max: 100000, step: 100, value: P.P0, unit: '원' },
        { id: 'elapsed', label: '투자 후 경과', min: 0, max: 10, step: 0.25, value: P.elapsed, unit: '년' },
        { id: 'shares', label: '보유 주식 수', min: 10000, max: 2000000, step: 10000, value: P.shares, unit: '주' } ] },
      { legend: '기초자산', items: [
        { id: 'S0', label: '현재 주당 가치', min: 1000, max: 100000, step: 100, value: P.S0, unit: '원' },
        { id: 'sigma', label: '변동성', min: 10, max: 100, step: 0.5, scale: 100, value: P.sigma, unit: '%' },
        { id: 'r', label: '무위험이자율', min: 0, max: 8, step: 0.05, scale: 100, value: P.r, unit: '%' },
        { id: 'q', label: '배당수익률', min: 0, max: 6, step: 0.1, scale: 100, value: P.q, unit: '%' } ] },
      { legend: '투자자 풋옵션', items: [
        { type: 'switch', id: 'putOn', label: '최대주주에게 되팔 권리', value: P.putOn },
        { id: 'putIrr', label: '보장 내부수익률', hint: '투자일부터 연복리', min: 0, max: 20, step: 0.25, scale: 100, value: P.putIrr, unit: '%', enabledIf: v => v.putOn },
        { id: 'putStart', label: '행사 시작', hint: '평가일로부터', min: 0, max: 8, step: 0.25, value: P.putStart, unit: '년', enabledIf: v => v.putOn },
        { id: 'putEnd', label: '행사 끝', min: 0.25, max: 10, step: 0.25, value: P.putEnd, unit: '년', enabledIf: v => v.putOn } ] },
      { legend: '최대주주 콜옵션', items: [
        { type: 'switch', id: 'callOn', label: '최대주주가 사 올 권리', value: P.callOn },
        { id: 'callIrr', label: '콜 행사가격 수익률', min: 0, max: 30, step: 0.25, scale: 100, value: P.callIrr, unit: '%', enabledIf: v => v.callOn },
        { id: 'callStart', label: '행사 시작', min: 0, max: 8, step: 0.25, value: P.callStart, unit: '년', enabledIf: v => v.callOn },
        { id: 'callEnd', label: '행사 끝', min: 0.25, max: 10, step: 0.25, value: P.callEnd, unit: '년', enabledIf: v => v.callOn },
        { id: 'callShare', label: '콜 대상 비율', min: 0, max: 100, step: 5, scale: 100, value: P.callShare, unit: '%', enabledIf: v => v.callOn } ] },
      { legend: '상장 가정', items: [
        { id: 'ipoProb', label: '상장 확률', hint: '아래 기간 안에', min: 0, max: 95, step: 1, scale: 100, value: P.ipoProb, unit: '%' },
        { id: 'ipoHorizon', label: '확률 기준 기간', min: 0.25, max: 5, step: 0.25, value: P.ipoHorizon, unit: '년' },
        { type: 'note', text: '상장되면 두 옵션 모두 사라진다고 봅니다. 일정한 위험률로 경로마다 상장 시점을 뽑습니다.' } ] },
      { legend: '풋옵션 의무자 신용위험', items: [
        { id: 'pd', label: '최대주주 부도확률', min: 0, max: 60, step: 1, scale: 100, value: P.pd, unit: '%' },
        { id: 'recovery', label: '회수율', min: 0, max: 100, step: 5, scale: 100, value: P.recovery, unit: '%' } ] },
      { legend: '계산', items: [
        { type: 'seg', id: 'paths', label: '경로 수', value: P.paths, options: [[5000, '5천'], [20000, '2만'], [50000, '5만']] },
        { id: 'seed', label: '난수 씨앗', min: 1, max: 99999999, step: 1, value: P.seed, unit: '' } ] },
    ], () => shaRun());
    shaRun();
  }
  function shaParams() {
    const v = shaPanel.vals;
    return Object.assign({}, v, { paths: +v.paths, stepsPerYear: 12, bands: true, bandSample: 4000, seed: Math.round(v.seed) });
  }
  const shaRun = throttle(function () {
    const p = shaParams();
    const t0 = performance.now();
    const r = C.shareholderOptions(p);
    const ms = performance.now() - t0;
    const put = r.put, call = r.call, sh = p.shares;
    const net = (put ? put.value : 0) - (call ? call.value : 0);
    const eok = x => fmt(x * sh / 1e8, 1);
    $('sha-kpis').innerHTML =
      kpi('풋옵션 가치 · 주당', put ? won(put.value) : '-', put ? '원' : '', put ? '총 ' + eok(put.value) + '억원 · 신용위험 조정 전 ' + won(put.raw) + '원' : '꺼짐', true) +
      kpi('콜옵션 가치 · 주당', call ? won(call.value) : '-', call ? '원' : '', call ? '총 ' + eok(call.value) + '억원 · 대상 ' + pct(p.callShare, 0) : '꺼짐') +
      kpi('투자자 입장 순가치', won(net), '원', '풋옵션 자산 − 콜옵션 부채 · 총 ' + eok(net) + '억원') +
      kpi('풋 행사 확률', put ? pct(put.exerciseRate) : '-', '', put ? '행사가격 ' + won(put.strikeStart) + ' → ' + won(put.strikeEnd) + '원' : '');
    // 경로 띠
    const M = r.M, dt = r.dt, x = [];
    for (let k = 0; k <= M; k++) x.push(+(k * dt).toFixed(4));
    const b = r.bands, band = (lo, hi) => b[hi].map((v, i) => v - b[lo][i]);
    const strike = (irr, a, z) => x.map(t => (t >= a - 1e-9 && t <= z + 1e-9 ? Math.round(p.P0 * Math.pow(1 + irr, p.elapsed + t)) : null));
    // 띠는 같은 가로축 칸에 차례로 쌓아야 해서 가로축을 범주로 둔다
    const series = [
      { name: '5%', type: 'line', data: b[0], stack: 'b', lineStyle: { opacity: 0 }, showSymbol: false, areaStyle: { opacity: 0 }, tooltip: { show: false } },
      { name: '5~95% 구간', type: 'line', data: band(0, 1), stack: 'b', lineStyle: { opacity: 0 }, showSymbol: false, areaStyle: { color: css('--c3'), opacity: 0.16 }, itemStyle: { color: css('--c3') } },
      { name: '25~75% 구간', type: 'line', data: band(1, 3), stack: 'b', lineStyle: { opacity: 0 }, showSymbol: false, areaStyle: { color: css('--c3'), opacity: 0.34 }, itemStyle: { color: css('--c3') } },
      { name: '상단', type: 'line', data: band(3, 4), stack: 'b', lineStyle: { opacity: 0 }, showSymbol: false, areaStyle: { color: css('--c3'), opacity: 0.16 }, tooltip: { show: false } },
      { name: '중앙값', type: 'line', data: b[2], showSymbol: false, lineStyle: { color: css('--c1'), width: 2 }, itemStyle: { color: css('--c1') } },
    ];
    if (p.putOn) series.push({ name: '풋 행사가격', type: 'line', data: strike(p.putIrr, p.putStart, p.putEnd), showSymbol: false, lineStyle: { type: 'dashed', width: 2, color: css('--c2') }, itemStyle: { color: css('--c2') } });
    if (p.callOn) series.push({ name: '콜 행사가격', type: 'line', data: strike(p.callIrr, p.callStart, p.callEnd), showSymbol: false, lineStyle: { type: 'dashed', width: 2, color: css('--c4') }, itemStyle: { color: css('--c4') } });
    chart('sha-fan').setOption(base({
      grid: { left: 70, right: 20, top: 40, bottom: 40 },
      legend: { top: 0, right: 0, data: ['25~75% 구간', '5~95% 구간', '중앙값', '풋 행사가격', '콜 행사가격'], textStyle: { color: css('--muted'), fontSize: 12 } },
      tooltip: { trigger: 'axis', backgroundColor: css('--surface'), borderColor: css('--line-2'), textStyle: { color: css('--ink'), fontSize: 12.5 },
                 formatter: qs => {
                   const i = qs[0].dataIndex;
                   let s = x[i].toFixed(2) + '년<br>중앙값 ' + won(b[2][i]) + '원 · 25~75% ' + won(b[1][i]) + '~' + won(b[3][i]) + '원';
                   qs.forEach(q => { if (q.seriesName.indexOf('행사가격') >= 0 && q.value != null) s += '<br>' + q.seriesName + ' ' + won(q.value) + '원'; });
                   return s;
                 } },
      xAxis: axis({ type: 'category', data: x, boundaryGap: false, name: '평가일로부터 (년)', nameLocation: 'middle', nameGap: 26,
                    axisLabel: { color: css('--muted'), fontSize: 11.5, interval: k => k % 6 === 0, formatter: t => (+t).toFixed(1) } }),
      yAxis: axis({ type: 'value', scale: true, axisLabel: { color: css('--muted'), fontSize: 11.5, formatter: v => fmt(v) } }),
      series: series,
    }), true);
    // 행사 시점
    const yrs = Math.ceil(x[x.length - 1] - 1e-9), cats = [], pv = [], cv = [];
    for (let y = 0; y < Math.max(1, yrs); y++) {
      cats.push(y + '~' + (y + 1) + '년');
      pv.push(put ? (put.byYear[y] || 0) : 0);
      cv.push(call ? (call.byYear[y] || 0) : 0);
    }
    chart('sha-when').setOption(base({
      grid: { left: 56, right: 16, top: 34, bottom: 30 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: css('--surface'), borderColor: css('--line-2'), textStyle: { color: css('--ink'), fontSize: 12.5 }, valueFormatter: v => fmt(v) + '개 경로' },
      xAxis: axis({ type: 'category', data: cats }),
      yAxis: axis({ type: 'value' }),
      series: [
        { name: '풋 행사', type: 'bar', data: pv, itemStyle: { color: css('--c2') } },
        { name: '콜 행사', type: 'bar', data: cv, itemStyle: { color: css('--c4') } },
      ],
    }), true);
    const rows = [];
    if (put) rows.push(['풋옵션', won(put.raw), won(put.se), won(put.raw - 1.96 * put.se) + ' ~ ' + won(put.raw + 1.96 * put.se)]);
    if (call) rows.push(['콜옵션 (전체 지분 기준)', won(call.raw), won(call.se), won(call.raw - 1.96 * call.se) + ' ~ ' + won(call.raw + 1.96 * call.se)]);
    $('sha-precision').innerHTML = table(['구분', '주당 가치', '표준오차', '95% 범위'], rows) +
      '<p class="subtle" style="margin-top:10px">경로 ' + fmt(r.n) + '개(대칭 경로 쌍), 매달 행사 판단, 계산 ' + fmt(ms) + '밀리초. 같은 씨앗을 쓰므로 입력을 바꿔도 같은 난수로 비교됩니다. ' +
      '상장 확률 0%·행사일 하나로 두면 블랙-숄즈 공식과 표준오차 안에서 맞는 것을 검증 탭에서 확인했습니다.</p>';
    $('sha-acct').innerHTML = [
      note('info', '투자자', '풋옵션은 파생상품자산, 최대주주에게 준 콜옵션은 파생상품부채로 보고 공정가치 변동을 당기손익에 반영합니다. 보유 주식과 묶어 하나의 금융상품으로 볼지 먼저 판단합니다.'),
      note('info', '회사가 매수 의무를 지는 경우', '회사가 자기 주식을 현금으로 사 줄 의무를 지면 옵션 공정가치가 아니라 상환금액의 현재가치로 금융부채를 인식합니다.'),
      note('ask', '보고서에서 볼 것', '행사가격 산식(배당 차감 여부), 행사 조건(상장 기한·기업가치 조건), 의무자 지급 능력, 상장 확률의 근거, 두 옵션의 상호작용 반영 여부.'),
    ].join('');
  });

  // ============================================================ 3. DCF
  const DCF_DEFAULT = { rev0: 100000, g1: 0.08, g5: 0.04, m0: 0.10, m1: 0.10, m5: 0.12, tax: 0.22, da: 0.04, capex: 0.05, nwc: 0.15,
                        gT: 0.015, rf: 0.028, mrp: 0.07, betaU: 0.9, de: 0.4, size: 0.025, alpha: 0, kd: 0.05,
                        nonOp: 5000, netDebt: 20000, shares: 10000000, unit: 1000000, midYear: true, peerLo: 6, peerHi: 9, years: 5 };
  let dcfPanel = null;
  function dcfInit() {
    const P = DCF_DEFAULT;
    dcfPanel = makePanel($('dcf-panel'), [
      { legend: '매출과 이익', items: [
        { type: 'note', text: '가상 제조회사 E. 금액은 억원으로 입력합니다.' },
        { id: 'rev0', label: '기준연도 매출', min: 100, max: 10000, step: 10, scale: 0.01, value: P.rev0, unit: '억원' },
        { id: 'g1', label: '1년차 매출 성장률', min: -10, max: 30, step: 0.5, scale: 100, value: P.g1, unit: '%' },
        { id: 'g5', label: '5년차 매출 성장률', min: -10, max: 30, step: 0.5, scale: 100, value: P.g5, unit: '%' },
        { id: 'm0', label: '기준연도 영업이익률', min: -10, max: 40, step: 0.5, scale: 100, value: P.m0, unit: '%' },
        { id: 'm1', label: '1년차 영업이익률', min: -10, max: 40, step: 0.5, scale: 100, value: P.m1, unit: '%' },
        { id: 'm5', label: '5년차 영업이익률', min: -10, max: 40, step: 0.5, scale: 100, value: P.m5, unit: '%' },
        { id: 'tax', label: '법인세율', min: 0, max: 30, step: 0.1, scale: 100, value: P.tax, unit: '%' } ] },
      { legend: '투자 · 매출 대비', items: [
        { id: 'da', label: '감가상각비', min: 0, max: 15, step: 0.25, scale: 100, value: P.da, unit: '%' },
        { id: 'capex', label: '설비투자', min: 0, max: 20, step: 0.25, scale: 100, value: P.capex, unit: '%' },
        { id: 'nwc', label: '운전자본', hint: '매출 증가분에 곱함', min: 0, max: 50, step: 0.5, scale: 100, value: P.nwc, unit: '%' } ] },
      { legend: '할인율', items: [
        { id: 'rf', label: '무위험이자율', hint: '국고채 10년', min: 0, max: 8, step: 0.05, scale: 100, value: P.rf, unit: '%' },
        { id: 'mrp', label: '시장위험프리미엄', min: 3, max: 12, step: 0.1, scale: 100, value: P.mrp, unit: '%' },
        { id: 'betaU', label: '무부채 베타', hint: '비교회사 평균', min: 0.3, max: 2, step: 0.01, value: P.betaU, unit: '' },
        { id: 'de', label: '목표 부채비율', hint: '타인자본 ÷ 자기자본', min: 0, max: 200, step: 1, scale: 100, value: P.de, unit: '%' },
        { id: 'size', label: '규모위험프리미엄', min: 0, max: 8, step: 0.1, scale: 100, value: P.size, unit: '%' },
        { id: 'alpha', label: '기업고유위험', min: 0, max: 8, step: 0.1, scale: 100, value: P.alpha, unit: '%' },
        { id: 'kd', label: '세전 타인자본비용', min: 0, max: 15, step: 0.05, scale: 100, value: P.kd, unit: '%' } ] },
      { legend: '영구가치', items: [
        { id: 'gT', label: '영구성장률', min: -2, max: 5, step: 0.1, scale: 100, value: P.gT, unit: '%' },
        { type: 'switch', id: 'midYear', label: '현금흐름이 연중 고르게 생긴다고 보고 반년 할인', value: P.midYear } ] },
      { legend: '지분가치', items: [
        { id: 'netDebt', label: '순차입금', min: -2000, max: 5000, step: 10, scale: 0.01, value: P.netDebt, unit: '억원' },
        { id: 'nonOp', label: '비영업자산', min: 0, max: 2000, step: 10, scale: 0.01, value: P.nonOp, unit: '억원' },
        { id: 'shares', label: '발행주식 수', min: 1000000, max: 100000000, step: 100000, value: P.shares, unit: '주' } ] },
      { legend: '비교회사 배수 · 기업가치 ÷ EBITDA', items: [
        { id: 'peerLo', label: '하단', min: 1, max: 30, step: 0.5, value: P.peerLo, unit: '배' },
        { id: 'peerHi', label: '상단', min: 1, max: 30, step: 0.5, value: P.peerHi, unit: '배' } ] },
    ], () => dcfRun());
    dcfRun();
  }
  const dcfRun = throttle(function () {
    const p = Object.assign({}, DCF_DEFAULT, dcfPanel.vals);
    const r = C.dcf(p);
    const e = x => fmt(x / 100, 1);              // 백만원 → 억원
    $('dcf-kpis').innerHTML =
      kpi('주당 가치', isFinite(r.perShare) ? won(r.perShare) : '-', '원', '발행주식 ' + fmt(p.shares) + '주', true) +
      kpi('지분가치', e(r.equity), '억원', '기업가치 + 비영업자산 − 순차입금') +
      kpi('기업가치', e(r.ev), '억원', '영구가치 비중 ' + pct(r.tvShare, 0)) +
      kpi('가중평균자본비용', pct(r.wacc, 2), '', '자기자본비용 ' + pct(r.w.ke, 2) + ' · 베타 ' + r.w.betaL.toFixed(2)) +
      kpi('내재 EBITDA 배수', isFinite(r.impliedExit) ? r.impliedExit.toFixed(1) : '-', '배', '영구가치 ÷ 5년차 EBITDA · 비교 ' + p.peerLo + '~' + p.peerHi + '배');
    $('dcf-flags').innerHTML = r.flags.length ? r.flags.map(f => note(f.level === 'bad' ? 'bad' : f.level, f.title, f.body)).join('')
      : note('good', '자동 점검 항목에 걸린 것이 없습니다', '영구가치 비중, 성장률과 재투자의 일관성, 비교회사 배수, 할인율 구성이 모두 통상 범위 안입니다.');
    // 가치 구성 (억원)
    const cats = r.rows.map(x => (2025 + x.k) + '년').concat(['영구가치', '기업가치', '비영업자산', '순차입금', '지분가치']);
    const vals = r.rows.map(x => x.pv / 100).concat([r.pvTV / 100]);
    const baseS = [], valS = [];
    let run = 0;
    vals.forEach(v => { baseS.push(v >= 0 ? run : run + v); valS.push({ value: Math.abs(v), itemStyle: { color: css(v >= 0 ? '--c3' : '--bad') } }); run += v; });
    baseS.push(0); valS.push({ value: r.ev / 100, itemStyle: { color: css('--c1') } });
    baseS.push(run); valS.push({ value: p.nonOp / 100, itemStyle: { color: css('--c4') } }); run += p.nonOp / 100;
    const nd = p.netDebt / 100;
    baseS.push(nd >= 0 ? run - nd : run); valS.push({ value: Math.abs(nd), itemStyle: { color: css(nd >= 0 ? '--bad' : '--c4') } }); run -= nd;
    baseS.push(0); valS.push({ value: r.equity / 100, itemStyle: { color: css('--c2') } });
    chart('dcf-bridge').setOption(base({
      grid: { left: 56, right: 12, top: 20, bottom: 54 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: css('--surface'), borderColor: css('--line-2'), textStyle: { color: css('--ink'), fontSize: 12.5 },
                 formatter: qs => { const q = qs.find(x => x.seriesName === '값'); return q.name + ' ' + fmt(q.value, 1) + '억원'; } },
      legend: { show: false },
      xAxis: axis({ type: 'category', data: cats, axisLabel: { color: css('--muted'), fontSize: 11, interval: 0, rotate: 35 } }),
      yAxis: axis({ type: 'value' }),
      series: [
        { name: '바닥', type: 'bar', stack: 'w', data: baseS, itemStyle: { color: 'transparent' }, emphasis: { disabled: true } },
        { name: '값', type: 'bar', stack: 'w', data: valS, label: { show: true, position: 'top', color: css('--muted'), fontSize: 10.5, formatter: q => fmt(q.value, 0) } },
      ],
    }), true);
    // 민감도
    const S = r.sens, data = [];
    let mn = Infinity, mx = -Infinity;
    S.grid.forEach((row, i) => row.forEach((v, j) => {
      const cell = [j, i, isFinite(v) ? Math.round(v) : '-'];
      data.push(i === 2 && j === 2 ? { value: cell, itemStyle: { borderColor: css('--accent'), borderWidth: 3 } } : cell);   // 가운데가 지금 입력
      if (isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
    }));
    chart('dcf-heat').setOption(base({
      grid: { left: 70, right: 16, top: 16, bottom: 48 },
      tooltip: { trigger: 'item', backgroundColor: css('--surface'), borderColor: css('--line-2'), textStyle: { color: css('--ink'), fontSize: 12.5 },
                 formatter: q => '할인율 ' + pct(S.waccs[q.value[1]], 2) + ' · 영구성장률 ' + pct(S.gs[q.value[0]]) + '<br>주당 ' + won(q.value[2]) + '원' },
      xAxis: axis({ type: 'category', data: S.gs.map(g => pct(g)), name: '영구성장률', nameLocation: 'middle', nameGap: 28, splitArea: { show: false } }),
      yAxis: axis({ type: 'category', data: S.waccs.map(w => pct(w, 2)), name: '할인율', nameLocation: 'end', splitArea: { show: false } }),
      visualMap: { show: false, min: mn, max: mx, inRange: { color: [css('--surface-2'), css('--c3')] } },
      series: [{ type: 'heatmap', data: data, itemStyle: { borderColor: css('--surface'), borderWidth: 2 },
                 label: { show: true, color: css('--ink'), fontSize: 11.5, fontFamily: 'IBM Plex Mono, monospace', textBorderColor: css('--surface'), textBorderWidth: 2, formatter: q => fmt(q.value[2]) } }],
    }), true);
    // 추정 현금흐름 표
    const yrs = r.rows, T = r.terminal;
    const head = ['억원', '2025 실적'].concat(yrs.map(x => String(2025 + x.k))).concat(['영구']);
    const row = (name, f0, f, fT, isPct) => [name, f0 == null ? '' : (isPct ? pct(f0) : e(f0))].concat(yrs.map(x => isPct ? pct(f(x)) : e(f(x)))).concat([fT == null ? '' : (isPct ? pct(fT) : e(fT))]);
    $('dcf-table').innerHTML = table(head, [
      row('매출', p.rev0, x => x.rev, T.rev),
      row('성장률', null, x => x.growth, p.gT, true),
      row('영업이익', p.rev0 * p.m0, x => x.ebit, T.ebit),
      row('영업이익률', p.m0, x => x.margin, yrs[yrs.length - 1].margin, true),
      row('세후영업이익', null, x => x.nopat, T.nopat),
      row('+ 감가상각비', null, x => x.da, T.da),
      row('− 설비투자', null, x => x.capex, T.capex),
      row('− 운전자본 증가', null, x => x.dnwc, T.dnwc),
      row('잉여현금흐름', null, x => x.fcff, T.fcff),
      ['할인계수', ''].concat(yrs.map(x => x.df.toFixed(4))).concat([(r.pvTV / r.tv).toFixed(4)]),
      row('현재가치', null, x => x.pv, r.pvTV),
    ], { rowClass: i => (i === 8 || i === 10 ? 'sum' : '') });
    const w = r.w;
    $('dcf-wacc').innerHTML = table(['항목', '값', '설명'], [
      ['무위험이자율', pct(p.rf, 2), { v: '국고채 10년 수익률 (예시 값)', cls: 'txt' }],
      ['무부채 베타', p.betaU.toFixed(2), { v: '비교회사 베타에서 부채 효과를 뺀 값', cls: 'txt' }],
      ['부채 반영 베타', w.betaL.toFixed(3), { v: '무부채 베타 × (1 + (1 − 법인세율) × 부채비율)', cls: 'txt' }],
      ['시장위험프리미엄', pct(p.mrp, 2), { v: '시장 기대수익률 − 무위험이자율', cls: 'txt' }],
      ['규모·고유위험', pct(p.size + p.alpha, 2), { v: '규모위험프리미엄 + 기업고유위험', cls: 'txt' }],
      ['자기자본비용', pct(w.ke, 2), { v: '무위험이자율 + 베타 × 시장위험프리미엄 + 규모·고유위험', cls: 'txt' }],
      ['세후 타인자본비용', pct(w.kdAfter, 2), { v: '세전 ' + pct(p.kd, 2) + ' × (1 − 법인세율)', cls: 'txt' }],
      ['자기자본 : 타인자본', pct(w.we, 1) + ' : ' + pct(w.wd, 1), { v: '목표 부채비율 ' + pct(p.de, 0) + '에서', cls: 'txt' }],
      ['가중평균자본비용', pct(r.wacc, 2), { v: '가중평균', cls: 'txt' }],
    ], { rowClass: i => (i === 5 || i === 8 ? 'sum' : '') });
  });

  // ============================================================ 4. 파생상품
  const DV_DEFAULT = { cd: 0.0275, s1: 0.0272, s2: 0.0268, s3: 0.0270, s5: 0.0278, s10: 0.0292, spot: 1420, usdRate: 0.039, vol: 0.09,
                       inst: 'irs', notional: 10000, fixed: 0.034, payFixed: 'pay', T: 2.6, stub: 0.1, fixing: 0.028,
                       usd: 10000000, fwdK: 1385, fwdDir: 'sell', fwdT: 0.5,
                       optK: 1400, optType: 'put', optPos: 'long', optT: 0.5, csCpty: 0.008, csOwn: 0.02 };
  let dvPanel = null;
  function dvInit() {
    const P = DV_DEFAULT;
    const isI = v => v.inst === 'irs', isF = v => v.inst === 'fxf', isO = v => v.inst === 'fxo';
    dvPanel = makePanel($('deriv-panel'), [
      { legend: '시장 자료 · 예시 값', items: [
        { id: 'cd', label: 'CD 91일물', min: 0, max: 8, step: 0.01, scale: 100, value: P.cd, unit: '%' },
        { id: 's1', label: '이자율스왑 1년', min: 0, max: 8, step: 0.01, scale: 100, value: P.s1, unit: '%' },
        { id: 's2', label: '이자율스왑 2년', min: 0, max: 8, step: 0.01, scale: 100, value: P.s2, unit: '%' },
        { id: 's3', label: '이자율스왑 3년', min: 0, max: 8, step: 0.01, scale: 100, value: P.s3, unit: '%' },
        { id: 's5', label: '이자율스왑 5년', min: 0, max: 8, step: 0.01, scale: 100, value: P.s5, unit: '%' },
        { id: 's10', label: '이자율스왑 10년', min: 0, max: 8, step: 0.01, scale: 100, value: P.s10, unit: '%' },
        { id: 'spot', label: '원/달러 현물환율', min: 1000, max: 1800, step: 1, value: P.spot, unit: '원' },
        { id: 'usdRate', label: '달러 금리', min: 0, max: 8, step: 0.05, scale: 100, value: P.usdRate, unit: '%' } ] },
      { legend: '평가 대상', items: [
        { type: 'seg', id: 'inst', value: P.inst, options: [['irs', '이자율스왑'], ['fxf', '통화선도'], ['fxo', '통화옵션']] } ] },
      { legend: '이자율스왑', showIf: isI, items: [
        { type: 'note', text: '변동금리 차입금을 고정금리로 바꾸려고 2024년에 맺은 스왑. 3개월마다 CD 91일물과 고정금리를 교환합니다.' },
        { id: 'notional', label: '명목금액', min: 10, max: 2000, step: 10, scale: 0.01, value: P.notional, unit: '억원' },
        { id: 'fixed', label: '고정금리', min: 0, max: 8, step: 0.01, scale: 100, value: P.fixed, unit: '%' },
        { type: 'seg', id: 'payFixed', label: '방향', value: P.payFixed, options: [['pay', '고정 지급·변동 수취'], ['recv', '고정 수취·변동 지급']] },
        { id: 'T', label: '잔존만기', min: 0.25, max: 10, step: 0.05, value: P.T, unit: '년' },
        { id: 'stub', label: '다음 이자 교환까지', min: 0.01, max: 0.25, step: 0.01, value: P.stub, unit: '년' },
        { id: 'fixing', label: '이번 기간 확정 CD금리', min: 0, max: 8, step: 0.01, scale: 100, value: P.fixing, unit: '%' } ] },
      { legend: '통화선도', showIf: isF, items: [
        { type: 'note', text: '수출기업이 6개월 뒤 받을 달러를 미리 정한 환율에 팔기로 한 계약.' },
        { id: 'usd', label: '계약 금액', min: 10, max: 10000, step: 10, scale: 0.0001, value: P.usd, unit: '만달러' },
        { id: 'fwdK', label: '약정환율', min: 1000, max: 1800, step: 1, value: P.fwdK, unit: '원' },
        { type: 'seg', id: 'fwdDir', label: '방향', value: P.fwdDir, options: [['sell', '달러 매도'], ['buy', '달러 매입']] },
        { id: 'fwdT', label: '잔존만기', min: 0.05, max: 3, step: 0.05, value: P.fwdT, unit: '년' } ] },
      { legend: '통화옵션', showIf: isO, items: [
        { type: 'note', text: '환율 하락에 대비해 달러를 행사가격에 팔 권리(달러 풋)를 산 경우.' },
        { id: 'usd', label: '계약 금액', min: 10, max: 10000, step: 10, scale: 0.0001, value: P.usd, unit: '만달러' },
        { id: 'optK', label: '행사가격', min: 1000, max: 1800, step: 1, value: P.optK, unit: '원' },
        { type: 'seg', id: 'optType', label: '종류', value: P.optType, options: [['put', '달러 풋'], ['call', '달러 콜']] },
        { type: 'seg', id: 'optPos', label: '포지션', value: P.optPos, options: [['long', '매입'], ['short', '매도']] },
        { id: 'optT', label: '만기', min: 0.05, max: 3, step: 0.05, value: P.optT, unit: '년' },
        { id: 'vol', label: '환율 변동성', min: 2, max: 30, step: 0.25, scale: 100, value: P.vol, unit: '%' } ] },
      { legend: '신용위험 조정', showIf: v => !isO(v), items: [
        { id: 'csCpty', label: '거래상대방 신용스프레드', hint: '받을 돈에 적용', min: 0, max: 10, step: 0.05, scale: 100, value: P.csCpty, unit: '%' },
        { id: 'csOwn', label: '자기 신용스프레드', hint: '줄 돈에 적용', min: 0, max: 10, step: 0.05, scale: 100, value: P.csOwn, unit: '%' } ] },
    ], () => dvRun());
    dvRun();
  }
  const dvRun = throttle(function () {
    const v = dvPanel.vals;
    const curve = { cd: v.cd, tenors: [1, 2, 3, 5, 10], rates: [v.s1, v.s2, v.s3, v.s5, v.s10] };
    const cv = C.bootstrap(curve);
    // 곡선 그림
    const tz = [], zr = [], fw = [];
    for (let k = 1; k < cv.t.length; k++) {
      const t = cv.t[k];
      tz.push(t); zr.push([t, (Math.exp(-Math.log(cv.df[k]) / t) - 1) * 100]);
      fw.push([t, (cv.df[k - 1] / cv.df[k] - 1) / 0.25 * 100]);
    }
    const mk = [[0.25, v.cd], [1, v.s1], [2, v.s2], [3, v.s3], [5, v.s5], [10, v.s10]].map(a => [a[0], a[1] * 100]);
    chart('deriv-curve').setOption(base({
      grid: { left: 52, right: 16, top: 34, bottom: 40 },
      tooltip: { trigger: 'axis', backgroundColor: css('--surface'), borderColor: css('--line-2'), textStyle: { color: css('--ink'), fontSize: 12.5 }, valueFormatter: x => (x == null ? '-' : x.toFixed(3) + '%') },
      xAxis: axis({ type: 'value', name: '만기 (년)', nameLocation: 'middle', nameGap: 26, min: 0, max: 10 }),
      yAxis: axis({ type: 'value', scale: true, axisLabel: { color: css('--muted'), fontSize: 11.5, formatter: x => x.toFixed(2) + '%' } }),
      series: [
        { name: '시장 금리', type: 'scatter', data: mk, symbolSize: 9, itemStyle: { color: css('--c2') } },
        { name: '무이표 금리', type: 'line', data: zr, showSymbol: false, lineStyle: { color: css('--c1'), width: 2 }, itemStyle: { color: css('--c1') } },
        { name: '3개월 선도금리', type: 'line', step: 'end', data: fw, showSymbol: false, lineStyle: { color: css('--c3'), width: 1.5 }, itemStyle: { color: css('--c3') } },
      ],
    }), true);

    const csAdj = { csCpty: v.csCpty, csOwn: v.csOwn };
    const mil = x => fmt(x / 1e6, 1);           // 원 → 백만원
    if (v.inst === 'irs') {
      const p = Object.assign({ notional: v.notional, fixed: v.fixed, payFixed: v.payFixed === 'pay', T: v.T, stub: Math.min(v.stub, v.T), fixing: v.fixing }, csAdj);
      const r = C.irs(p, curve);
      $('deriv-kpis').innerHTML =
        kpi('공정가치', signed(r.value, 1), '백만원', (p.payFixed ? '고정 지급' : '고정 수취') + ' 쪽에서 본 값', true) +
        kpi('신용위험 조정 후', signed(r.valueAdj, 1), '백만원', '조정액 ' + signed(r.creditAdj, 2) + '백만원') +
        kpi('금리 1bp 상승 시', signed(r.dv01, 2), '백만원', '곡선 전체를 0.01%p 올려 다시 계산') +
        kpi('같은 만기 공정 고정금리', pct(r.parRate, 3), '', '약정 ' + pct(p.fixed, 3) + ' · 차이 ' + pp(p.fixed - r.parRate, 3));
      $('deriv-chart2-title').textContent = '이자 교환 현금흐름';
      $('deriv-chart2-sub').textContent = '백만원, 받을 돈은 위로 줄 돈은 아래로';
      chart('deriv-chart2').setOption(base({
        grid: { left: 56, right: 16, top: 34, bottom: 40 },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: css('--surface'), borderColor: css('--line-2'), textStyle: { color: css('--ink'), fontSize: 12.5 }, valueFormatter: x => signed(x, 2) + '백만원' },
        xAxis: axis({ type: 'category', data: r.rows.map(x => x.t.toFixed(2) + '년'), axisLabel: { color: css('--muted'), fontSize: 11 } }),
        yAxis: axis({ type: 'value' }),
        series: [
          { name: '순현금흐름', type: 'bar', itemStyle: { color: css('--c2') }, data: r.rows.map(x => ({ value: +x.net.toFixed(3), itemStyle: { color: css(x.net >= 0 ? '--c4' : '--c2') } })) },
          { name: '현재가치', type: 'line', data: r.rows.map(x => +x.pv.toFixed(3)), showSymbol: true, symbolSize: 5, lineStyle: { color: css('--c1') }, itemStyle: { color: css('--c1') } },
        ],
      }), true);
      $('deriv-detail-title').textContent = '이자 교환 내역 · 백만원';
      $('deriv-detail').innerHTML = table(['교환 시점', '할인계수', '변동금리', '고정 이자', '변동 이자', '순현금흐름', '현재가치', '신용 조정 현재가치'],
        r.rows.map((x, i) => [x.t.toFixed(2) + '년', x.df.toFixed(6), pct(x.fwd, 3) + (i === 0 ? ' 확정' : ''), fmt(x.fixed, 2), fmt(x.floating, 2), signed(x.net, 2), signed(x.pv, 2), signed(x.pvAdj, 2)]));
      $('deriv-notes').innerHTML = [
        note('info', '이번 기간 변동금리', '이미 확정된 이번 기간 CD금리는 곡선의 선도금리가 아니라 확정 금리로 계산합니다.'),
        note('info', '공정가치 서열', '시장에서 관측되는 금리로 평가하므로 공정가치 서열체계 수준 2에 해당합니다.'),
        note('ask', '평가사 방식과 맞춰 볼 것', '곡선 보간 방식(여기서는 할인계수 로그 선형), 일수 계산 관행, 신용위험 조정을 간편법으로 했는지 기대노출 방식으로 했는지.'),
        note(Math.abs(r.creditAdj) > Math.abs(r.value) * 0.05 ? 'warn' : 'good', '신용위험 조정 크기', '조정액 ' + signed(r.creditAdj, 2) + '백만원, 조정 전 가치의 ' + pct(Math.abs(r.creditAdj / r.value), 1) + '. 가치가 음수(부채)면 자기 신용위험이, 양수(자산)면 거래상대방 신용위험이 반영됩니다.'),
      ].join('');
    } else if (v.inst === 'fxf') {
      const p = Object.assign({ usd: v.usd, strike: v.fwdK, spot: v.spot, T: v.fwdT, usdRate: v.usdRate, sellUsd: v.fwdDir === 'sell' }, csAdj);
      const r = C.fxForward(p, curve);
      $('deriv-kpis').innerHTML =
        kpi('공정가치', signed(r.value / 1e6, 1), '백만원', (p.sellUsd ? '달러 매도' : '달러 매입') + ' 쪽에서 본 값', true) +
        kpi('신용위험 조정 후', signed(r.valueAdj / 1e6, 1), '백만원', '조정액 ' + signed(r.creditAdj / 1e6, 2) + '백만원') +
        kpi('공정 선도환율', fmt(r.fwd, 2), '원', '스왑포인트 ' + signed(r.points, 2) + '원') +
        kpi('환율 1원 상승 시', signed(r.deltaPerWon / 1e6, 2), '백만원', '현물환율만 1원 올려 계산');
      $('deriv-chart2-title').textContent = '현물환율에 따른 공정가치';
      $('deriv-chart2-sub').textContent = '백만원';
      const xs = [], ys = [];
      for (let s = v.spot - 150; s <= v.spot + 150; s += 10) { xs.push(s); ys.push(+(C.fxForward(Object.assign({}, p, { spot: s }), curve).value / 1e6).toFixed(2)); }
      chart('deriv-chart2').setOption(base({
        grid: { left: 64, right: 16, top: 34, bottom: 40 },
        tooltip: { trigger: 'axis', backgroundColor: css('--surface'), borderColor: css('--line-2'), textStyle: { color: css('--ink'), fontSize: 12.5 }, valueFormatter: x => signed(x, 1) + '백만원' },
        xAxis: axis({ type: 'value', name: '현물환율 (원)', nameLocation: 'middle', nameGap: 26, min: xs[0], max: xs[xs.length - 1] }),
        yAxis: axis({ type: 'value' }),
        series: [{ name: '공정가치', type: 'line', data: xs.map((x, i) => [x, ys[i]]), showSymbol: false, lineStyle: { color: css('--c1'), width: 2 }, itemStyle: { color: css('--c1') },
                   markPoint: { symbolSize: 10, symbol: 'circle', itemStyle: { color: css('--c2') }, label: { show: false }, data: [{ coord: [v.spot, +(r.value / 1e6).toFixed(2)], name: '현재' }] },
                   markLine: { silent: true, symbol: 'none', lineStyle: { color: css('--line-2') }, label: { show: false }, data: [{ yAxis: 0 }] } }],
      }), true);
      $('deriv-detail-title').textContent = '계산 과정';
      $('deriv-detail').innerHTML = table(['단계', '값', '설명'], [
        ['현물환율', fmt(p.spot, 2) + '원', { v: '평가일 매매기준율 (예시 값)', cls: 'txt' }],
        ['원화 할인계수', r.dfKrw.toFixed(6), { v: '할인곡선에서 만기 ' + p.T + '년', cls: 'txt' }],
        ['달러 할인계수', r.dfUsd.toFixed(6), { v: '달러 금리 ' + pct(p.usdRate, 2), cls: 'txt' }],
        ['공정 선도환율', fmt(r.fwd, 2) + '원', { v: '현물환율 × 달러 할인계수 ÷ 원화 할인계수', cls: 'txt' }],
        ['약정환율', fmt(p.strike, 2) + '원', { v: '계약에서 정한 환율', cls: 'txt' }],
        ['공정가치', signed(r.value / 1e6, 2) + '백만원', { v: '(선도환율 − 약정환율) × 금액 × 원화 할인계수, 방향 반영', cls: 'txt' }],
        ['신용위험 조정 후', signed(r.valueAdj / 1e6, 2) + '백만원', { v: (r.value >= 0 ? '거래상대방' : '자기') + ' 스프레드로 추가 할인', cls: 'txt' }],
      ], { rowClass: i => (i === 5 ? 'sum' : '') });
      $('deriv-notes').innerHTML = [
        note('info', '금리평형', '선도환율은 두 통화 금리 차이만큼 현물환율에서 벌어집니다. 원화 금리가 달러 금리보다 낮으면 선도환율이 현물보다 낮습니다.'),
        note('ask', '평가사 방식과 맞춰 볼 것', '현물환율 기준 시각, 만기까지 기간 계산, 원화·달러 할인곡선 출처, 신용위험 조정 방법.'),
        note('info', '헤지회계', '위험회피회계를 적용한다면 위험회피수단의 공정가치 변동 중 효과적인 부분의 처리와 지정 문서를 함께 검토합니다.'),
      ].join('');
    } else {
      const p = { usd: v.usd, strike: v.optK, spot: v.spot, T: v.optT, usdRate: v.usdRate, vol: v.vol, isCall: v.optType === 'call', long: v.optPos === 'long' };
      const r = C.fxOption(p, curve);
      $('deriv-kpis').innerHTML =
        kpi('옵션 가치', signed(r.value / 1e6, 1), '백만원', '1달러당 ' + fmt(r.unit, 2) + '원 · ' + (p.long ? '매입' : '매도') + ' 쪽', true) +
        kpi('델타', signed(r.delta / 1e4, 0), '만달러', '환율 1원 상승 시 ' + signed(r.delta / 1e6, 2) + '백만원') +
        kpi('베가', signed(r.vega / 1e6, 2), '백만원', '변동성 1%p 상승 시') +
        kpi('세타', signed(r.theta / 1e6, 2), '백만원', '하루 지날 때') +
        kpi('내재가치 · 시간가치', mil(r.intrinsic) + ' · ' + mil(r.timeValue), '백만원', '선도환율 ' + fmt(r.fwd, 2) + '원');
      $('deriv-chart2-title').textContent = '현물환율에 따른 옵션 가치';
      $('deriv-chart2-sub').textContent = '백만원, 실선 오늘 · 점선 만기';
      const xs = [], now = [], exp = [];
      for (let s = v.spot - 150; s <= v.spot + 150; s += 5) {
        xs.push(s);
        now.push(+(C.fxOption(Object.assign({}, p, { spot: s }), curve).value / 1e6).toFixed(2));
        const intr = Math.max(p.isCall ? s - p.strike : p.strike - s, 0) * p.usd * (p.long ? 1 : -1);
        exp.push(+(intr / 1e6).toFixed(2));
      }
      chart('deriv-chart2').setOption(base({
        grid: { left: 64, right: 16, top: 34, bottom: 40 },
        tooltip: { trigger: 'axis', backgroundColor: css('--surface'), borderColor: css('--line-2'), textStyle: { color: css('--ink'), fontSize: 12.5 }, valueFormatter: x => signed(x, 1) + '백만원' },
        xAxis: axis({ type: 'value', name: '현물환율 (원)', nameLocation: 'middle', nameGap: 26, min: xs[0], max: xs[xs.length - 1] }),
        yAxis: axis({ type: 'value' }),
        series: [
          { name: '오늘 가치', type: 'line', data: xs.map((x, i) => [x, now[i]]), showSymbol: false, lineStyle: { color: css('--c1'), width: 2 }, itemStyle: { color: css('--c1') },
            markPoint: { symbolSize: 10, symbol: 'circle', itemStyle: { color: css('--c2') }, label: { show: false }, data: [{ coord: [v.spot, +(r.value / 1e6).toFixed(2)], name: '현재' }] } },
          { name: '만기 가치', type: 'line', data: xs.map((x, i) => [x, exp[i]]), showSymbol: false, lineStyle: { color: css('--c2'), type: 'dashed' }, itemStyle: { color: css('--c2') } },
        ],
      }), true);
      $('deriv-detail-title').textContent = '민감도 · 전체 계약 기준';
      $('deriv-detail').innerHTML = table(['지표', '값', '뜻'], [
        ['원화 무이표 금리', pct(r.rK, 3), { v: '할인곡선에서 만기 ' + p.T + '년, 연속복리', cls: 'txt' }],
        ['달러 금리', pct(r.rU, 3), { v: '연속복리', cls: 'txt' }],
        ['델타', signed(r.delta, 0) + '달러', { v: '같은 위험을 지려면 사고팔아야 할 달러 금액', cls: 'txt' }],
        ['감마', fmt(r.gamma, 1) + '달러', { v: '환율 1원 변화당 델타 변화', cls: 'txt' }],
        ['베가', signed(r.vega / 1e6, 3) + '백만원', { v: '변동성 1%p 상승 시 가치 변화', cls: 'txt' }],
        ['세타', signed(r.theta / 1e6, 3) + '백만원', { v: '하루 경과 시 가치 변화', cls: 'txt' }],
        ['로', signed(r.rho / 1e6, 3) + '백만원', { v: '원화 금리 1%p 상승 시 가치 변화', cls: 'txt' }],
      ]);
      $('deriv-notes').innerHTML = [
        note('info', '가먼-콜하겐 공식', '통화옵션은 달러 금리를 배당수익률 자리에 넣은 블랙-숄즈 공식으로 평가합니다. 검증 탭에서 풋-콜 패리티를 확인했습니다.'),
        note('ask', '평가사 방식과 맞춰 볼 것', '변동성 출처(시장 내재변동성인지 과거 변동성인지), 행사가격과 만기에 맞는 변동성을 골랐는지, 낙아웃 같은 이색 조건이 있는지.'),
      ].join('');
    }
  });

  // ============================================================ 5. XBRL
  let xbPanel = null, xbPick = 'ifrs-full_Inventories';
  function xbInit() {
    const sc = C.XB.scenarios;
    xbPanel = makePanel($('xbrl-panel'), [
      { legend: '넣어 볼 오류', items: sc.map(s => ({ type: 'switch', id: 'e_' + s.id, label: s.name + '<br><span class="subtle">' + s.desc + '</span>', value: s.id === 'sign' || s.id === 'dup' }))
        .concat([{ type: 'html', html: '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="button" data-all="1">모두 넣기</button><button class="btn" type="button" data-all="0">모두 빼기</button></div>',
                   mount: box => box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
                     sc.forEach(s => xbPanel.set('e_' + s.id, b.dataset.all === '1')); xbRun();
                   })) }]) },
      { legend: '표본', items: [{ type: 'note', text: C.XB.company + ' 2025년 별도 재무제표. 금액은 원 단위 사실값으로 저장하고 백만원 정밀도로 공시한다고 봅니다.' }] },
    ], () => xbRun());
    xbRun();
  }
  function xbRun() {
    const errs = {};
    C.XB.scenarios.forEach(s => { errs[s.id] = !!xbPanel.vals['e_' + s.id]; });
    const facts = C.xbrlFacts(errs);
    const res = C.xbrlCheck(facts);
    const bad = res.issues.filter(i => i.level === 'bad').length, warn = res.issues.length - bad;
    $('xbrl-kpis').innerHTML =
      kpi('오류', bad, '건', bad ? '공시 전에 고쳐야 할 것' : '없음', true) +
      kpi('주의', warn, '건', '근거를 확인할 것') +
      kpi('사실값', facts.length, '개', '당기·전기, 맥락별') +
      kpi('넣은 오류', Object.values(errs).filter(Boolean).length, '가지', '왼쪽에서 고름');
    // 셀 표시
    const flagged = {};
    res.issues.forEach(i => i.cells.forEach(c => { const el = c.split('|')[0]; flagged[el] = flagged[el] === 'bad' ? 'bad' : i.level; }));
    const extOf = { 'ifrs-full_TradeAndOtherCurrentReceivables': 'entity00999999_TradeReceivablesNet' };
    $('xbrl-issues').innerHTML = res.issues.length ? res.issues.map((i, k) =>
      '<li class="note click" data-cell="' + esc(i.cells[0] || '') + '" style="cursor:pointer"><span class="chip ' + (i.level === 'bad' ? 'bad' : 'warn') + '">' + (i.level === 'bad' ? '오류' : '주의') + '</span><div><b>' + i.rule + ' · ' + i.where + '</b><p>' + i.msg + '</p><p class="subtle">' + i.fix + '</p></div></li>').join('')
      : note('good', '걸린 규칙이 없습니다', '계산 관계, 부호, 정밀도, 기간 맥락, 중복값, 재무제표 간 연계, 전기 금액, 요소 선택이 모두 맞습니다.');
    $('xbrl-issues').querySelectorAll('[data-cell]').forEach(li => li.addEventListener('click', () => {
      let el = li.dataset.cell.split('|')[0];
      Object.keys(extOf).forEach(k => { if (extOf[k] === el) el = k; });
      if (el) { xbPick = el; xbRun(); }
    }));
    const val = (el, period, dupOnly) => {
      const list = facts.filter(f => (f.el === el || f.el === extOf[el]) && f.period === period && (dupOnly ? f.dupOf === 'CF' : !f.dupOf));
      return list.length ? list[0] : null;
    };
    const mk = (stmt, cols) => {
      const els = C.XB.elements.filter(e => e[2] === stmt);
      const subtotal = new Set(C.XB.calc.map(c => c[0]));
      const rows = els.map(e => [e[1] + (val(e[0], 'CY') && val(e[0], 'CY').el !== e[0] ? ' <span class="chip warn">확장</span>' : '')]
        .concat(cols.map(pp2 => { const f = val(e[0], pp2); return f ? fmt(f.value / 1e6, f.value !== 0 && Math.abs(f.value) < 1e6 ? 6 : 0) : ''; })));
      if (stmt === 'CF') {
        const d = val('ifrs-full_ProfitLoss', 'CY', true) || val('ifrs-full_ProfitLoss', 'CY');
        rows.unshift(['당기순이익 (출발점)', fmt(d.value / 1e6)]);
        els.unshift(['ifrs-full_ProfitLoss']);
      }
      return table(['계정'].concat(cols.map(c => (c === 'CY' ? '2025 당기' : '2024 전기'))), rows, {
        rowClass: i => {
          const el = els[i][0];
          const c = [];
          if (subtotal.has(el)) c.push('sum');
          if (flagged[el] || (el === 'ifrs-full_TradeAndOtherCurrentReceivables' && flagged[extOf[el]])) c.push((flagged[el] || flagged[extOf[el]]) === 'bad' ? 'flag' : 'flag-warn');
          if (el === xbPick) c.push('pick');
          return c.join(' ') + ' click';
        },
        rowAttr: i => ' data-el="' + els[i][0] + '"',
      });
    };
    $('xbrl-bs').innerHTML = mk('BS', ['CY', 'PY']);
    $('xbrl-is').innerHTML = mk('IS', ['CY', 'PY']);
    $('xbrl-cf').innerHTML = mk('CF', ['CY']);
    document.querySelectorAll('#xbrl-bs tr[data-el], #xbrl-is tr[data-el], #xbrl-cf tr[data-el]').forEach(tr => tr.addEventListener('click', () => { xbPick = tr.dataset.el; xbRun(); }));
    const picked = facts.filter(f => f.el === xbPick || f.el === extOf[xbPick]);
    const lab = (C.XB.elements.find(e => e[0] === xbPick) || [xbPick, xbPick])[1];
    $('xbrl-pick-sub').textContent = lab + ' · ' + picked.length + '개 사실값';
    $('xbrl-xml').textContent = '<!-- CFY2025eFY: 2025-12-31 시점, CFY2025dFY: 2025년 한 해 기간, PFY2024: 전기 -->\n' + picked.map(C.xbrlXml).join('\n');
  }

  // ============================================================ 6. 자동매매 백테스트
  let BD = null, btPanel = null;
  const SIDE_KO = { LONG: '롱', SHORT: '숏' }, WHY_KO = { '만료': '기간 만료', '반대신호': '반대 신호', '강제청산': '강제청산' };
  const STATUS_KO = { rejected: '거부', unfilled: '미체결', unknown: '체결 기록 없음', filled: '체결' };
  const PRESETS = [['primary', '주 구간 · 봉인 검증'], ['aux', '보조 구간 · 봉인 전'], ['d30', '최근 30일'], ['d90', '최근 90일'], ['custom', '직접 지정']];
  function btInit() {
    fetch('bt_data.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(d => {
      BD = d;
      const S = d.sealed_rules;
      const day = ms => { const x = new Date(ms + KST_MS); return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate()); };
      btPanel = makePanel($('bt-panel'), [
        { legend: '모델', items: [{ type: 'seg', id: 'model', value: 'ver_4_4', options: Object.keys(d.models).map(k => [k, k]) },
                                  { type: 'note', text: '' }] },
        { legend: '기간', items: [
          { type: 'seg', id: 'preset', value: 'primary', options: PRESETS },
          { type: 'date', id: 'from', label: '시작일', value: day(d.data_end - 14 * 86400000), min: day(d.data_start), max: day(d.data_end), showIf: v => v.preset === 'custom' },
          { type: 'date', id: 'to', label: '끝일', value: day(d.data_end - 1), min: day(d.data_start), max: day(d.data_end), showIf: v => v.preset === 'custom' } ] },
        { legend: '체결 방식', items: [
          { type: 'seg', id: 'fill', value: 'strict', options: [['strict', '엄격'], ['opt', '낙관']] },
          { type: 'note', text: '엄격: 바이낸스 공개 체결 기록으로 지정가 주문이 실제로 체결됐을지 판정합니다(봉인 판정 기준). 낙관: 신호마다 체결된다고 봅니다.' } ] },
        { legend: '봉인 설정', items: [
          { type: 'switch', id: 'custom', label: '봉인 설정 바꿔 보기', value: false },
          { id: 'entry_th', label: '진입 확률 하한', min: 0.35, max: 0.8, step: 0.01, value: S.entry_th, unit: '', showIf: v => v.custom },
          { id: 'vol_min', label: '4시간 변동성 하한', min: 0, max: 0.4, step: 0.002, scale: 100, value: S.vol_min, unit: '%', showIf: v => v.custom },
          { id: 'exit_th', label: '반대 신호 청산 확률', min: 0.3, max: 0.8, step: 0.01, value: S.exit_th, unit: '', showIf: v => v.custom },
          { id: 'max_hold', label: '최대 보유', min: 4, max: 64, step: 1, value: S.max_hold, unit: '봉', showIf: v => v.custom },
          { id: 'leverage', label: '레버리지', min: 1, max: 50, step: 1, value: S.leverage, unit: '배', showIf: v => v.custom },
          { id: 'invest_ratio', label: '1회 증거금 비중', min: 5, max: 100, step: 5, scale: 100, value: S.invest_ratio, unit: '%', showIf: v => v.custom },
          { id: 'fee_in', label: '진입 수수료', min: 0, max: 0.1, step: 0.001, scale: 100, value: S.fee_in, unit: '%', showIf: v => v.custom },
          { id: 'fee_out', label: '청산 수수료', min: 0, max: 0.1, step: 0.001, scale: 100, value: S.fee_out, unit: '%', showIf: v => v.custom } ] },
        { legend: '계좌', items: [{ id: 'capital', label: '시작 자본', min: 100, max: 100000, step: 100, value: 10000, unit: 'USDT' }] },
      ], () => btRun());
      btRun();
      footBuild();
    }).catch(err => {
      $('bt-panel').innerHTML = '<p class="callout">백테스트 재료를 불러오지 못했습니다 (' + esc(err.message) + '). 새로 고침해 보세요.</p>';
    });
  }
  function btPeriod(v) {
    const d = BD, end = d.data_end, DAY = 86400000;
    if (v.preset === 'primary') return [d.primary[0], Math.min(d.primary[1], end)];
    if (v.preset === 'aux') return [d.aux[0], d.aux[1]];
    if (v.preset === 'd30') return [end - 30 * DAY, end];
    if (v.preset === 'd90') return [end - 90 * DAY, end];
    const a = Date.parse(v.from + 'T00:00:00+09:00'), b = Date.parse(v.to + 'T00:00:00+09:00') + DAY;
    return [Math.max(a, d.data_start), Math.min(b, end)];
  }
  const btRun = throttle(function () {
    const v = btPanel.vals, d = BD, S = d.sealed_rules;
    const rules = v.custom ? { entry_th: v.entry_th, vol_min: v.vol_min, exit_th: v.exit_th, max_hold: Math.round(v.max_hold), leverage: v.leverage,
                               invest_ratio: v.invest_ratio, fee_in: v.fee_in, fee_out: v.fee_out, mmr: S.mmr } : S;
    const sealed = !v.custom || Object.keys(S).every(k => Math.abs(rules[k] - S[k]) < 1e-12);
    const strict = v.fill === 'strict';
    const per = btPeriod(v), start = per[0], end = per[1];
    if (!(start < end)) { $('bt-info').innerHTML = '<p class="callout">기간을 다시 골라 주세요. 시작이 끝보다 앞서야 합니다.</p>'; return; }
    const res = B.simulate(d, v.model, start, end, rules, strict);
    const sum = B.summarize(res.trades, rules);
    const meta = d.models[v.model];
    const days = (end - start) / 86400000;
    // 안내
    let info = '<p><b>기간</b> ' + kst(start) + ' ~ ' + kst(end) + ' (한국 시각, ' + days.toFixed(1) + '일) · <b>모델</b> ' + esc(meta.label) + ' · <b>체결</b> ' + (strict ? '엄격' : '낙관') + '</p>';
    const ts0 = Date.parse(meta.train_start.replace(' ', 'T') + '+09:00');
    const lo = Math.max(start, ts0), hi = Math.min(end, meta.seen_until);
    if (lo < hi) info += '<p class="callout" style="margin-top:8px">선택한 기간의 ' + Math.round((hi - lo) / (end - start) * 100) + '% (' + kst(lo) + ' ~ ' + kst(hi) + ')는 이 모델이 학습 때 정답까지 본 구간입니다. 그 부분 성적은 실제보다 좋게 나옵니다. 학습 기간 ' + meta.train_start.slice(0, 10) + ' ~ ' + meta.train_end.slice(0, 16) + '.</p>';
    const judged = v.preset === 'primary' && v.model === 'ver_4_4' && sealed && strict;
    if (judged) info += '<p class="subtle" style="margin-top:8px">봉인 판정과 같은 조건입니다 (주 구간 · 봉인 모델 · 봉인 설정 · 엄격 체결). 지금 숫자는 중간 집계이고, 판정은 2027-04-23 이후 한 번만 합니다.</p>';
    else if (!sealed) info += '<p class="subtle" style="margin-top:8px">봉인 설정과 다른 규칙입니다. 이 결과는 봉인 판정과 관계없습니다. 주 구간 중에는 중간 집계를 보고 봉인 규칙이나 모델을 바꾸지 않기로 했습니다.</p>';
    const n = res.notes;
    info += '<p class="subtle" style="margin-top:6px">신호 ' + n.signals + '개 → 거부 ' + n.rejected + ' · 미체결 ' + n.unfilled + ' · 체결 ' + n.filled +
      (n.unknown ? ' (미체결 중 ' + n.unknown + '개는 체결 기록 파일이 없어 판정 못 함)' : '') + ' · 재료 기준 ' + esc(d.generated_at) + '</p>';
    $('bt-info').innerHTML = info;
    // 숫자 카드
    const cap = v.capital;
    if (!sum) {
      $('bt-kpis').innerHTML = kpi('거래', '0', '건', '이 기간에는 끝까지 마친 거래가 없습니다', true);
    } else {
      $('bt-kpis').innerHTML =
        kpi('최종 자산', fmt(cap * sum.multiple, 0), 'USDT', '시작 ' + fmt(cap) + ' · ' + pct(sum.multiple - 1, 2, true), true) +
        kpi('거래', sum.n, '건', '승률 ' + pct(sum.win, 1)) +
        kpi('건당 순수익', pct(sum.per, 3, true), '', '수수료·펀딩비 반영, 레버리지 전') +
        kpi('최대 낙폭', pct(sum.mdd, 2), '', '시작 자본을 고점에 넣어 계산') +
        kpi('수익 크기 비 · t값', (isFinite(sum.R) ? sum.R.toFixed(2) : '-') + ' · ' + (isFinite(sum.t) ? sum.t.toFixed(2) : '-'), '', '이긴 거래 평균 크기 ÷ 진 거래 · 건당 수익 ÷ 표준오차') +
        kpi('강제청산', sum.liq, '회', Object.keys(sum.reasons).map(k => WHY_KO[k] + ' ' + sum.reasons[k]).join(' · '));
    }
    // 판정 기준 중간 집계
    const vc = $('bt-verdict-card');
    if (judged && sum) {
      vc.hidden = false;
      $('bt-verdict').innerHTML = [
        ['거래 30건 이상 (판정 가능 조건)', sum.n >= d.min_trades, sum.n + '건'],
        ['건당 순수익 > 0', sum.per > 0, pct(sum.per, 4, true)],
        ['플러스인 달이 절반 이상', sum.monthsPos * 2 >= sum.months, sum.monthsPos + '/' + sum.months + '달'],
        ['강제청산 0회', sum.liq === 0, sum.liq + '회'],
      ].map(x => note(x[1] ? 'good' : 'info', x[0], '지금 ' + x[2])).join('');
    } else vc.hidden = true;
    // 자산 변화
    const eqData = [[start, cap]];
    if (sum) res.trades.forEach((t, i) => eqData.push([t.exit_bar + B.BAR_MS, cap * sum.equity[i]]));
    eqData.push([end, eqData[eqData.length - 1][1]]);
    chart('bt-equity').setOption(base({
      grid: { left: 64, right: 16, top: 20, bottom: 30 },
      legend: { show: false },
      tooltip: { trigger: 'axis', backgroundColor: css('--surface'), borderColor: css('--line-2'), textStyle: { color: css('--ink'), fontSize: 12.5 },
                 formatter: qs => kst(qs[0].value[0]) + '<br>' + fmt(qs[0].value[1], 1) + ' USDT' },
      xAxis: axis({ type: 'time', min: start, max: end, axisLabel: { color: css('--muted'), fontSize: 11.5, formatter: x => kst(x, true).slice(0, 5) } }),
      yAxis: axis({ type: 'value', scale: true, axisLabel: { color: css('--muted'), fontSize: 11.5, formatter: x => fmt(x) } }),
      series: [{ type: 'line', step: 'end', data: eqData, showSymbol: false, lineStyle: { color: css('--c2'), width: 2 }, areaStyle: { color: css('--c2'), opacity: 0.08 } }],
    }), true);
    // 가격과 매매
    const i0 = res.i0, i1 = res.i1, cats = [], ohlc = [];
    for (let i = i0; i < i1; i++) { cats.push(kst(d.ts[i], true)); ohlc.push([d.o[i], d.c[i], d.l[i], d.h[i]]); }
    const pos = ms => Math.round((ms - d.ts[i0]) / B.BAR_MS);
    const ent = [], ext = [], miss = [];
    res.trades.forEach(t => {
      ent.push({ value: [pos(t.entry_bar), t.entry_px], side: t.side, itemStyle: { color: css(t.side === 'LONG' ? '--good' : '--bad') }, symbol: t.side === 'LONG' ? 'triangle' : 'path://M0,0 L10,0 L5,10 Z', t: t });
      ext.push({ value: [pos(t.exit_bar) + 1, t.exit_px], itemStyle: { color: css('--ink') }, t: t });
    });
    res.signals.forEach(s => { if (s.status !== 'filled') miss.push({ value: [pos(s.bar), s.price], s: s }); });
    const up = css('--good'), dn = css('--bad');
    chart('bt-price').setOption(base({
      grid: { left: 64, right: 16, top: 34, bottom: 70 },
      tooltip: { trigger: 'item', backgroundColor: css('--surface'), borderColor: css('--line-2'), textStyle: { color: css('--ink'), fontSize: 12.5 },
                 formatter: q => {
                   if (q.seriesType === 'candlestick') { const x = q.data; return cats[q.dataIndex] + '<br>시가 ' + fmt(x[1], 1) + ' · 종가 ' + fmt(x[2], 1) + '<br>저가 ' + fmt(x[3], 1) + ' · 고가 ' + fmt(x[4], 1); }
                   if (q.data.t) { const t = q.data.t; return (q.seriesName === '진입' ? SIDE_KO[t.side] + ' 진입 ' + kst(t.entry_bar) + ' · ' + fmt(t.entry_px, 1) : '청산 ' + kst(t.exit_bar) + ' · ' + WHY_KO[t.why] + ' · ' + fmt(t.exit_px, 1)) + '<br>순손익 ' + pct(t.pnl, 3, true); }
                   if (q.data.s) { const s = q.data.s; return SIDE_KO[s.side] + ' 신호 ' + kst(s.bar) + ' · ' + STATUS_KO[s.status] + '<br>확률 ' + pct(s.prob, 1) + ' · 지정가 ' + fmt(s.price, 1); }
                   return '';
                 } },
      legend: { top: 0, right: 0, data: ['진입', '청산', '체결 안 된 신호'], textStyle: { color: css('--muted'), fontSize: 12 } },
      xAxis: axis({ type: 'category', data: cats, boundaryGap: true, axisLabel: { color: css('--muted'), fontSize: 11 } }),
      yAxis: axis({ type: 'value', scale: true, axisLabel: { color: css('--muted'), fontSize: 11.5, formatter: x => fmt(x) } }),
      dataZoom: [{ type: 'inside', start: Math.max(0, 100 - 100 * 600 / Math.max(600, cats.length)), end: 100 },
                 { type: 'slider', height: 22, bottom: 14, start: Math.max(0, 100 - 100 * 600 / Math.max(600, cats.length)), end: 100,
                   borderColor: css('--line'), textStyle: { color: css('--muted') }, fillerColor: 'rgba(91,125,177,0.15)' }],
      series: [
        { name: '가격', type: 'candlestick', data: ohlc, itemStyle: { color: up, color0: dn, borderColor: up, borderColor0: dn }, large: true },
        { name: '진입', type: 'scatter', data: ent, symbolSize: 12, z: 5 },
        { name: '청산', type: 'scatter', data: ext, symbol: 'diamond', symbolSize: 9, z: 5, itemStyle: { color: css('--ink') } },
        { name: '체결 안 된 신호', type: 'scatter', data: miss, symbolSize: 7, itemStyle: { color: css('--c5') }, z: 4 },
      ],
    }), true);
    // 표
    $('bt-trades').innerHTML = res.trades.length ? table(['신호', '방향', '진입가', '청산가', '보유', '사유', '가격 변화', '펀딩비 손익', '순손익'],
      res.trades.slice().reverse().map(t => [kst(t.signal_bar), SIDE_KO[t.side], fmt(t.entry_px, 1), fmt(t.exit_px, 1), t.held + '봉', WHY_KO[t.why],
        pct(t.move, 3, true), pct(-t.funding, 4, true), { v: pct(t.pnl, 3, true), cls: t.pnl > 0 ? 'up' : 'down' }]))
      + (res.openPos ? '<p class="subtle" style="margin-top:8px">구간 끝에 열려 있는 가상 포지션: ' + SIDE_KO[res.openPos.side] + ' · 진입 ' + kst(res.openPos.entry_bar) + ' · ' + res.openPos.held + '봉 보유 · 가격 변화 ' + pct(res.openPos.move, 3, true) + '</p>' : '')
      : '<p class="subtle">끝까지 마친 거래가 없습니다.</p>';
    $('bt-monthly').innerHTML = sum ? table(['달', '거래', '손익 합계 (레버리지 전)'],
      sum.monthList.map(m => [m, sum.monthly[m].count + '건', { v: pct(sum.monthly[m].sum, 3, true), cls: sum.monthly[m].sum > 0 ? 'up' : 'down' }])) : '<p class="subtle">-</p>';
    $('bt-how').innerHTML = [
      note('info', '서버 없이 브라우저에서 계산', '도쿄 서버가 해지돼 계산을 브라우저로 옮겼습니다. 재료(시세·4시간 변동성·펀딩비·모델 확률)와 엄격 체결 판정은 봉인 채점기 함수로 미리 만들어 두었습니다. 기준 ' + esc(d.generated_at) + '.'),
      note('good', '파이썬 엔진과 거래 단위로 일치', '모델 3개, 기간 4개, 설정 10가지를 엄격·낙관 체결로 돌린 128가지 경우에서 거래 4,206건과 신호 6,951개가 파이썬 대시보드 엔진과 같습니다. 대시보드 결과 지문 da3bb5d9도 같게 나옵니다.'),
      note('info', '체결 기록이 없는 날', '바이낸스 공개 저장소에 2026-10-28 체결 기록 파일이 없고, 오늘 것은 다음 날 올라옵니다. 그날 신호는 체결 기록 없음(미체결)으로 셉니다.'),
      note('info', '봉인 규칙', '봉인 커밋 9595d23, 지문 ' + d.seal.files + '개 일치 확인 후 재료를 만들었습니다. 주 구간 2026-10-23 ~ 2027-04-23 결과는 끝난 뒤 한 번만 판정합니다.'),
    ].join('');
  });

  // ============================================================ 7. 검증
  let VR = null;
  function loadVerification() {
    return fetch('verification.json').then(r => r.json()).then(v => { VR = v; return v; }).catch(() => null);
  }
  function verifyInit() {
    const render = v => {
      if (!v) { $('verify-groups').innerHTML = '<p class="callout">검증 기록을 불러오지 못했습니다.</p>'; return; }
      const groups = {};
      v.checks.forEach(c => { (groups[c.group] = groups[c.group] || []).push(c); });
      const cnt = g => (groups[g] || []).length;
      $('verify-kpis').innerHTML =
        kpi('통과', v.passed + ' / ' + v.total, '건', '파이썬 검증 ' + esc(v.generated_at), true) +
        kpi('화면·파이썬 대조', cnt('화면·파이썬 대조'), '건', '같은 입력, 같은 값') +
        kpi('교과서·공식·항등식', cnt('교과서·공식') + cnt('항등식'), '건', '헐 예제, 닫힌 해') +
        kpi('XBRL 규칙', cnt('XBRL 검토 규칙'), '건', '넣은 오류를 모두 잡는지') +
        kpi('백테스트 거래 일치', '4,206', '건', '파이썬 대시보드 엔진과');
      $('verify-groups').innerHTML = Object.keys(groups).map(g => {
        const rows = groups[g].map(c => c.js != null
          ? [{ v: esc(c.name), cls: 'txt' }, fmtNum(c.js), fmtNum(c.ref), c.diff.toExponential(1), { v: '<span class="chip ' + (c.pass ? 'good' : 'bad') + '">' + (c.pass ? '통과' : '실패') + '</span>', cls: 'txt' }]
          : [{ v: esc(c.name), cls: 'txt' }, { v: esc(c.note), cls: 'txt' }, '', '', { v: '<span class="chip ' + (c.pass ? 'good' : 'bad') + '">' + (c.pass ? '통과' : '실패') + '</span>', cls: 'txt' }]);
        return '<div class="card"><div class="card-head"><h3>' + esc(g) + '</h3><span class="subtle">' + groups[g].length + '건</span></div><div class="tbl-wrap">' +
          table(['항목', '화면 계산', '기준값', '차이', '결과'], rows) + '</div></div>';
      }).join('');
    };
    (VR ? Promise.resolve(VR) : loadVerification()).then(render);
    $('verify-run').addEventListener('click', liveCheck);
  }
  function fmtNum(x) {
    if (x === 0) return '0';
    const a = Math.abs(x);
    if (a >= 1e6) return fmt(x, 0);
    if (a >= 100) return fmt(x, 3);
    if (a >= 1e-3) return x.toPrecision(8);
    return x.toExponential(3);
  }
  function liveCheck() {
    const out = [], t0 = performance.now();
    const ok = (name, pass, body) => out.push(note(pass ? 'good' : 'bad', name, body));
    const hc = C.bsGreeks(42, 40, 0.5, 0.1, 0, 0.2, true).value;
    ok('블랙-숄즈 헐 예제', Math.abs(hc - 4.76) < 0.005, '콜 ' + hc.toFixed(4) + ' (교재 4.76)');
    const ap = C.crrOption(50, 50, 5 / 12, 0.1, 0, 0.4, 5, false, true);
    ok('미국형 풋 5단계 헐 예제', Math.abs(ap - 4.49) < 0.005, ap.toFixed(4) + ' (교재 4.49)');
    const curve = { cd: 0.0275, tenors: [1, 2, 3, 5, 10], rates: [0.0272, 0.0268, 0.0270, 0.0278, 0.0292] };
    const par = C.irs({ notional: 10000, fixed: 0, payFixed: true, T: 5, stub: 0.25, fixing: 0.0275, csCpty: 0, csOwn: 0 }, curve).parRate;
    const z = C.irs({ notional: 10000, fixed: par, payFixed: true, T: 5, stub: 0.25, fixing: 0.0275, csCpty: 0, csOwn: 0 }, curve).value;
    ok('공정금리 스왑 가치 0', Math.abs(z) < 1e-9, '공정금리 ' + pct(par, 4) + ', 가치 ' + z.toExponential(2) + '백만원');
    const e = { S0: 4800, sigma: 0.5, r: 0.027, q: 0, cs: 0, F: 10000, T: 2.5, elapsed: 0.5, convOn: true, convPrice: 5000, convStart: 2.5,
                coupon: 0, couponFreq: 4, ytm: 0.03, ytmFreq: 4, putOn: false, callOn: false, N: 1000 };
    const Rm = C.redemptionAmount(10000, 0.03, 4, 0, 1, 3), rc = Math.log(1.027);
    const closed = Rm * Math.exp(-rc * 2.5) + 2 * C.bsGreeks(4800, Rm / 2, 2.5, rc, 0, 0.5, true).value;
    const tree = C.convertible(e).value;
    ok('전환사채 이항모형 → 닫힌 해', Math.abs(tree / closed - 1) < 0.001, '이항 ' + fmt(tree, 2) + ' · 닫힌 해 ' + fmt(closed, 2) + '원');
    const mc = C.shareholderOptions({ S0: 23000, P0: 25000, elapsed: 2, sigma: 0.4, r: 0.028, q: 0, putOn: true, putIrr: 0.08, putStart: 3, putEnd: 3,
                                       callOn: false, ipoProb: 0, ipoHorizon: 1, pd: 0, paths: 20000, seed: 7 });
    ok('몬테카를로 → 블랙-숄즈', Math.abs(mc.put.value - mc.bsPutAtEnd) < 3 * mc.put.se, '몬테카를로 ' + fmt(mc.put.value, 1) + ' ± ' + fmt(mc.put.se, 1) + ' · 공식 ' + fmt(mc.bsPutAtEnd, 1) + '원');
    const bad = C.XB.scenarios.filter(s => { const o = {}; o[s.id] = true; const rules = C.xbrlCheck(C.xbrlFacts(o)).issues.map(i => i.rule); return !s.expect.every(x => rules.indexOf(x) >= 0); });
    ok('XBRL 오류 8가지 탐지', bad.length === 0 && C.xbrlCheck(C.xbrlFacts({})).issues.length === 0, bad.length ? '못 잡은 것: ' + bad.map(s => s.name).join(', ') : '깨끗한 표본 0건, 넣은 오류 모두 탐지');
    out.push('<li class="subtle">이 브라우저에서 ' + fmt(performance.now() - t0) + '밀리초 걸렸습니다.</li>');
    $('verify-live').innerHTML = out.join('');
  }

  function footBuild() {
    const parts = [];
    if (BD) parts.push('백테스트 재료 ' + BD.generated_at);
    if (VR) parts.push('검증 ' + VR.generated_at);
    $('foot-build').textContent = parts.join(' · ');
  }

  // ============================================================ 화면 전환
  const INIT = { cb: cbInit, sha: shaInit, dcf: dcfInit, deriv: dvInit, xbrl: xbInit, bt: btInit, verify: verifyInit };
  const RERENDER = { cb: () => { cbRun(); cbExtras(); }, sha: () => shaRun(), dcf: () => dcfRun(), deriv: () => dvRun(), xbrl: () => xbRun(), bt: () => BD && btRun(), verify: () => {} };
  const done = {};
  let current = null;
  function show(tab) {
    if (!INIT[tab] && tab !== 'home') tab = 'home';
    current = tab;
    document.querySelectorAll('.page').forEach(p => { p.hidden = p.dataset.page !== tab; });
    document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    const btn = document.querySelector('.tab[data-tab="' + tab + '"]');
    if (btn && btn.scrollIntoView) btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (INIT[tab] && !done[tab]) { done[tab] = true; INIT[tab](); }
    requestAnimationFrame(resizeVisible);
  }
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
    if (location.hash !== '#' + b.dataset.tab) location.hash = b.dataset.tab; else show(b.dataset.tab);
    window.scrollTo({ top: 0 });
  }));
  window.addEventListener('hashchange', () => { show(location.hash.slice(1)); window.scrollTo({ top: 0 }); });
  // 테마가 바뀌면 차트 색을 다시 칠한다
  const retheme = () => Object.keys(done).forEach(k => { if (done[k] && RERENDER[k]) RERENDER[k](); });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  loadVerification().then(v => {
    if (v) $('home-verify-count').textContent = v.passed + '/' + v.total + ' 통과';
    footBuild();
  });
  show(location.hash.slice(1) || 'home');
})();
