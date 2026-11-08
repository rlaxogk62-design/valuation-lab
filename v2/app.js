/* 가치평가 실습실 화면
 *
 * 계산은 calc.js(평가)와 backtest.js(자동매매)가 하고, 이 파일은 입력과 표시만 맡는다.
 * 입력이 바뀌면 가벼운 계산은 바로, 무거운 계산(민감도·역산·주가별 가치)은 입력이 멈춘 뒤 다시 한다.
 */
(function () {
  'use strict';
  const C = window.VCalc, B = window.BT;
  let SAM = null;                    // samsung.json (실제 자료)

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
  let CB_PRESETS = null, cbPanel = null, cbPreset = 'samsung';
  // 실제 값: 주가·과거 3년 변동성·배당·국고채 3년·회사채 AA- 스프레드. 사채 조건은 가정.
  function cbPresets() {
    const m = SAM.market, r = m.rates, S = m.price_common.close, X = Math.round(S * 1.3 / 100) * 100;
    const cs = +(r.aa3.value - r.ktb3.value).toFixed(5), q = +(m.dps_2025 / S).toFixed(5);
    return { samsung: { S0: S, sigma: +m.vol_3y.toFixed(4), r: r.ktb3.value, q: q, cs: cs, F: X, T: 3, elapsed: 0,
      convOn: true, convPrice: X, convStart: 0.25, coupon: 0, couponFreq: 4, ytm: 0, ytmFreq: 4,
      putOn: true, putStart: 2, putFreq: 4, putYield: 0, callOn: false, callStart: 0, callEnd: 1, callYield: 0, N: 300, reported: 0,
      desc: '가정한 조건: 3년 만기, 이자 없음, 교환가격 ' + fmt(X) + '원(현재가 대비 30% 할증), 사채 1장당 1주로 교환, 3개월 뒤부터 교환 가능, 2년 뒤부터 분기마다 액면으로 조기상환 청구. ' +
            '실제 값: 주가 ' + fmt(S) + '원(' + m.price_common.date + ' 종가), 변동성 ' + pct(m.vol_3y) + '(과거 3년, 1년은 ' + pct(m.vol_1y) + '), 배당수익률 ' + pct(q, 2) +
            '(2025년 배당 ÷ 주가), 국고채 3년 ' + pct(r.ktb3.value, 3) + ', 신용스프레드 ' + pct(cs, 2) + '(회사채 AA- 3년 − 국고채 3년).' } };
  }
  const FREQ = [[12, '매월'], [4, '분기'], [2, '반기'], [1, '매년']];

  function cbGroups(P) {
    const F = P.F;
    return [
      { legend: '평가 대상', items: [
        { type: 'note', text: P.desc } ] },
      { legend: '기초자산', items: [
        { id: 'S0', label: '주가', hint: '삼성전자 보통주 종가', min: Math.round(F * 0.2 / 100) * 100, max: Math.round(F * 3 / 100) * 100, step: 50, value: P.S0, unit: '원' },
        { id: 'sigma', label: '변동성', hint: '연', min: 10, max: 120, step: 0.5, scale: 100, value: P.sigma, unit: '%' },
        { id: 'q', label: '배당수익률', min: 0, max: 6, step: 0.1, scale: 100, value: P.q, unit: '%' } ] },
      { legend: '할인율', items: [
        { id: 'r', label: '무위험이자율', hint: '국고채, 연복리', min: 0, max: 8, step: 0.05, scale: 100, value: P.r, unit: '%' },
        { id: 'cs', label: '신용스프레드', hint: '등급별 회사채 − 국고채', min: 0, max: 20, step: 0.1, scale: 100, value: P.cs, unit: '%' } ] },
      { legend: '증권 조건', items: [
        { id: 'F', label: '액면 (1장)', min: 1000, max: 100000, step: 100, value: F, unit: '원' },
        { id: 'convPrice', label: '교환가격', min: Math.round(F * 0.3 / 100) * 100, max: Math.round(F * 2 / 100) * 100, step: 50, value: P.convPrice, unit: '원' },
        { id: 'T', label: '잔존만기', min: 0.25, max: 15, step: 0.25, value: P.T, unit: '년' },
        { id: 'elapsed', label: '발행 후 경과', min: 0, max: 10, step: 0.25, value: P.elapsed, unit: '년' },
        { id: 'convStart', label: '교환 가능 시점', hint: '평가일로부터', min: 0, max: 10, step: 0.25, value: P.convStart, unit: '년' },
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
        { type: 'note', text: '평가인이 낸 값이 있다면 넣어 보세요. 그 숫자를 맞추는 변동성과 신용스프레드를 거꾸로 찾습니다. 이 예시는 가정한 사채라 보고값이 없습니다.' } ] },
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
    CB_PRESETS = cbPresets();
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
    items.push(note('ask', '변동성 기간', '삼성전자 주가 변동성은 과거 1년 ' + pct(SAM.market.vol_1y) + ', 과거 3년 ' + pct(SAM.market.vol_3y) + '로 크게 다릅니다. 잔존만기와 같은 기간을 썼는지, 최근 급등락을 어떻게 다뤘는지가 가치를 크게 바꿉니다.'));
    items.push(note('ask', '신용스프레드', '여기서는 회사채 AA- 3년과 국고채 3년의 차이를 썼습니다. 실제 발행회사의 신용등급과 만기에 맞는 스프레드를 썼는지 확인합니다.'));
    items.push(note('ask', '교환 대상 주식', '발행회사가 교환 대상 삼성전자 주식을 실제로 갖고 있는지, 예탁·담보 조건이 있는지 확인합니다.'));
    items.push(note('info', '회계 분류', '교환권은 발행회사 자신의 지분이 아니라 다른 회사 주식에 대한 권리라 자본으로 분류할 수 없습니다. 내재파생상품으로 분리하거나 사채 전체를 당기손익 공정가치로 측정합니다.'));
    $('cb-check').innerHTML = items.join('');
  }

  // ============================================================ 2. 성과연동 주식보상 (삼성전자 공시)
  let psuPanel = null;
  function psuInit() {
    const d = SAM.psu;
    psuPanel = makePanel($('psu-panel'), [
      { legend: '공시된 입력값 · 2025 사업보고서 주석 20', items: [
        { type: 'note', text: '부여일 ' + d.grant + ', 확정일 ' + d.vest + ', 총 약정 ' + fmt(d.units / 1e4) + '만 단위, 평가 방법 ' + d.model + '. 아래 기본값은 모두 공시값입니다.' },
        { id: 'S0', label: '부여일 주가', hint: '공시 기초자산 공정가치', min: 50000, max: 200000, step: 100, value: d.spot, unit: '원' },
        { id: 'sigma', label: '기대 변동성', hint: '공시, 과거 3년', min: 5, max: 80, step: 0.01, scale: 100, value: d.vol, unit: '%' },
        { id: 'q', label: '기대 배당수익률', min: 0, max: 5, step: 0.01, scale: 100, value: d.div, unit: '%' },
        { id: 'r', label: '무위험이자율', min: 0, max: 6, step: 0.01, scale: 100, value: d.rf, unit: '%' } ] },
      { legend: '공시에 없는 가정', items: [
        { id: 'B', label: '기준주가', hint: '상승률을 재는 출발점', min: 50000, max: 150000, step: 100, value: d.spot, unit: '원' },
        { type: 'note', text: '회사 발표에 따르면 기준주가는 기준일 전 1주·1개월·2개월 거래량 가중평균 주가의 산술평균입니다. 공시값은 기준주가를 부여일 주가와 같게 볼 때 맞습니다.' },
        { type: 'switch', id: 'installments', label: '확정 뒤 3년 나눠 받는 동안 배당을 못 받는 효과 반영', value: false },
        { id: 'N', label: '이항모형 격자 수', min: 50, max: 2000, step: 50, value: 500, unit: '개' } ] },
      { legend: '지급배수표 · 회사 발표', items: [
        { type: 'note', text: '확정일 주가가 기준주가보다 20% 미만 오르면 0배, 20% 이상 0.5배, 40% 이상 1배, 60% 이상 1.3배, 80% 이상 1.7배, 100% 이상 2배.' } ] },
    ], () => psuRun());
    psuRun();
  }
  const psuRun = throttle(function () {
    const v = psuPanel.vals, d = SAM.psu;
    const p = { S0: v.S0, B: v.B, sigma: v.sigma, q: v.q, r: v.r, T: 3.0, installments: v.installments, N: v.N, disclosed: d.fair_value };
    const r = C.psuReport(p);
    const diff = r.value / d.fair_value - 1;
    $('psu-kpis').innerHTML =
      kpi('재계산 공정가치 · 1단위', won(r.value), '원', '닫힌 해 · 이항모형 ' + fmt(r.N) + '단계 ' + won(r.binomial) + '원', true) +
      kpi('공시 공정가치', won(d.fair_value), '원', '재계산 대비 <b class="' + (Math.abs(diff) < 0.01 ? 'up' : 'down') + '">' + pct(-diff / (1 + diff), 2, true) + '</b>') +
      kpi('총 공정가치', fmt(r.value * d.units / 1e12, 2), '조원', '약정 ' + fmt(d.units / 1e4) + '만 단위 × 1단위 가치') +
      kpi('예상 지급배수', r.expMult.toFixed(2), '배', '위험중립 확률로 가중한 값') +
      kpi('지금 주가로 보면', fmt(SAM.market.price_common.close), '원', '기준주가 대비 ' + pct(SAM.market.price_common.close / v.B - 1, 0, true) + ' → 지금 끝나면 ' + C.psuMultiplier(SAM.market.price_common.close / v.B, C.PSU_STEPS) + '배');
    // 리뷰
    let msg;
    if (Math.abs(diff) < 0.002) msg = '공시된 입력값과 기준주가 ' + won(v.B) + '원으로 다시 계산하면 공시값과 ' + pct(Math.abs(diff), 2) + ' 안에서 맞습니다. 남는 차이는 회사가 쓴 이항모형의 격자 수 차이로 설명되는 수준입니다.';
    else msg = '재계산이 공시값과 ' + pct(Math.abs(diff), 1) + ' 다릅니다. ' + (r.impliedB ? '다른 입력은 그대로 두면 기준주가가 ' + won(r.impliedB) + '원일 때 공시값이 나옵니다. ' : '') +
      (r.impliedSigma ? '변동성으로 맞추려면 ' + pct(r.impliedSigma, 2) + '가 필요합니다. ' : '') + '공시에 기준주가가 없으므로 회사에 산정 근거를 묻겠습니다.';
    $('psu-review').innerHTML = '<div class="card-head"><h3>공시값과 대조</h3><span class="subtle">다른 입력은 그대로 두고 하나만 움직여 찾은 값</span></div><div class="kpis">' +
      kpi('공시값이 나오는 기준주가', r.impliedB ? won(r.impliedB) : '범위 밖', '원', '부여일 주가 ' + won(v.S0) + '원') +
      kpi('공시값이 나오는 변동성', r.impliedSigma ? pct(r.impliedSigma, 2) : '범위 밖', '', '공시 ' + pct(d.vol, 2)) +
      kpi('분할 지급 반영 시', won(C.psuClosed(Object.assign({}, p, { installments: true })).value), '원', '나눠 받는 동안 배당을 못 받는 효과') +
      '</div><p class="callout" style="margin-top:12px">' + msg + '</p>';
    // 지급 가치와 확률
    const xs = [], pay = [];
    for (let k = 0; k <= 60; k++) { const s = v.B * (0.6 + k * 0.03); xs.push(Math.round(s)); pay.push(Math.round(C.psuMultiplier(s / v.B, C.PSU_STEPS) * s)); }
    chart('psu-payoff').setOption(base({
      grid: { left: 70, right: 56, top: 34, bottom: 40 },
      tooltip: { trigger: 'axis', backgroundColor: css('--surface'), borderColor: css('--line-2'), textStyle: { color: css('--ink'), fontSize: 12.5 } },
      xAxis: axis({ type: 'value', name: '확정일 주가 (원)', nameLocation: 'middle', nameGap: 26, min: xs[0], max: xs[xs.length - 1], axisLabel: { color: css('--muted'), fontSize: 11.5, formatter: x => fmt(x) } }),
      yAxis: [axis({ type: 'value', axisLabel: { color: css('--muted'), fontSize: 11.5, formatter: x => fmt(x) } }),
              axis({ type: 'value', max: 1, splitLine: { show: false }, axisLabel: { color: css('--muted'), fontSize: 11.5, formatter: x => Math.round(x * 100) + '%' } })],
      series: [
        { name: '지급 가치', type: 'line', step: 'end', data: xs.map((x, i) => [x, pay[i]]), showSymbol: false, lineStyle: { color: css('--c1'), width: 2 }, itemStyle: { color: css('--c1') }, tooltip: { valueFormatter: x => won(x) + '원' } },
        { name: '확률', type: 'bar', yAxisIndex: 1, barWidth: '60%', data: r.probs.map(b => {
            const lo = b.from == null ? xs[0] : v.B * (1 + b.from), hi = b.to == null ? xs[xs.length - 1] : v.B * (1 + b.to);
            return [(lo + hi) / 2, b.prob];
          }), itemStyle: { color: css('--c3'), opacity: 0.45 }, tooltip: { valueFormatter: x => pct(x, 1) } },
      ],
    }), true);
    // 격자 수와 결과
    const Ns = [], bv = [];
    for (let n = 50; n <= 2000; n += 50) { Ns.push(n); bv.push(Math.round(C.psuBinomial(p, n))); }
    chart('psu-conv').setOption(base({
      grid: { left: 64, right: 16, top: 34, bottom: 40 },
      tooltip: { trigger: 'axis', backgroundColor: css('--surface'), borderColor: css('--line-2'), textStyle: { color: css('--ink'), fontSize: 12.5 }, valueFormatter: x => won(x) + '원' },
      xAxis: axis({ type: 'value', name: '격자 수', nameLocation: 'middle', nameGap: 26, min: 50, max: 2000 }),
      yAxis: axis({ type: 'value', scale: true, axisLabel: { color: css('--muted'), fontSize: 11.5, formatter: x => fmt(x) } }),
      series: [
        { name: '이항모형', type: 'line', data: Ns.map((n, i) => [n, bv[i]]), showSymbol: false, lineStyle: { color: css('--c3'), width: 1.5 }, itemStyle: { color: css('--c3') } },
        { name: '닫힌 해', type: 'line', data: [[50, Math.round(r.value)], [2000, Math.round(r.value)]], showSymbol: false, lineStyle: { color: css('--c1'), width: 2 }, itemStyle: { color: css('--c1') } },
        { name: '공시값', type: 'line', data: [[50, d.fair_value], [2000, d.fair_value]], showSymbol: false, lineStyle: { color: css('--c2'), type: 'dashed', width: 2 }, itemStyle: { color: css('--c2') } },
      ],
    }), true);
    // 민감도
    const t = r.tornado.slice().reverse();
    chart('psu-tornado').setOption(base({
      grid: { left: 130, right: 24, top: 34, bottom: 30 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: css('--surface'), borderColor: css('--line-2'), textStyle: { color: css('--ink'), fontSize: 12.5 }, valueFormatter: x => signed(x) + '원' },
      xAxis: axis({ type: 'value', axisLabel: { color: css('--muted'), fontSize: 11.5, formatter: x => signed(x) } }),
      yAxis: axis({ type: 'category', data: t.map(x => x.name), axisLabel: { color: css('--text'), fontSize: 12 } }),
      series: [
        { name: '입력을 낮출 때', type: 'bar', data: t.map(x => Math.round(x.dn - r.value)), itemStyle: { color: css('--c3') }, barGap: '15%' },
        { name: '입력을 높일 때', type: 'bar', data: t.map(x => Math.round(x.up - r.value)), itemStyle: { color: css('--c2') } },
      ],
    }), true);
    $('psu-probs').innerHTML = table(['확정일 주가 상승률', '지급배수', '위험중립 확률'],
      r.probs.map(b => [(b.from == null ? '' : pct(b.from, 0) + ' 이상 ') + (b.to == null ? '' : pct(b.to, 0) + ' 미만'), b.mult + '배', pct(b.prob, 1)]));
    $('psu-notes').innerHTML = [
      note('ask', '기준주가 산정 근거', '공시에는 기초자산 공정가치(부여일 주가)만 있고 기준주가가 없습니다. 기준주가가 부여일 주가보다 낮으면 공정가치는 크게 올라갑니다(위 민감도). 회사가 어떤 값을 썼는지 확인합니다.'),
      note('ask', '분할 지급 반영 여부', '확정 뒤 3년에 나눠 지급하면 늦게 받는 몫은 그동안 배당을 받지 못합니다. 이 효과를 넣으면 약 ' + pct(1 - C.psuClosed(Object.assign({}, p, { installments: true })).value / C.psuClosed(Object.assign({}, p, { installments: false })).value, 1) + ' 낮아집니다. 반영했는지 확인합니다.'),
      note('ask', '1년 보유 시 15% 추가 지급', '회사 발표에는 받은 주식을 1년 보유하면 15%를 더 준다는 조건이 있습니다. 별도 약정으로 봤는지, 이 공정가치에 넣었는지 확인합니다.'),
      note('info', '이항모형 격자 수', '지급배수가 계단처럼 바뀌는 구조라 이항모형 결과가 격자 수에 따라 ±1~2% 출렁입니다. 닫힌 해로 검산하거나 격자 수를 충분히 늘렸는지 봅니다.'),
      note('info', '회계 처리', '삼성전자 본사 분은 자기주식을 주는 주식결제형이라 부여일 공정가치로 고정하고 3년에 걸쳐 비용으로 나눕니다. 주가가 올라도 다시 평가하지 않습니다. 삼성디스플레이 분은 현금결제형이라 매 결산일 공정가치로 다시 측정합니다(공시 기초자산 공정가치 119,900원).'),
      note('info', '2025년 비용', '공시된 2025년 주식보상비용은 ' + fmt(d.expense_2025) + '백만원입니다. 부여 후 약 2.5개월분입니다.'),
    ].join('');
  });

  // ============================================================ 3. DCF (삼성전자)
  let DCF_BASE = null, dcfPanel = null;
  const YEARS = [2026, 2027, 2028, 2029, 2030];
  // 실제 값으로 기준을 만든다. 1년차는 2026년 상반기 실적의 연 환산, 2년차 이후는 가정.
  function dcfBase() {
    const S = SAM, BS = S.statements.BS, IS = S.statements.IS, CF = S.statements.CF, m = S.market, r = m.rates;
    const v = k => BS[k][0];
    const rev0 = IS['매출액'][0];
    const cash = v('현금및현금성자산') + v('단기금융상품') + v('단기상각후원가금융자산') + v('단기당기손익-공정가치금융자산');
    const debt = v('단기차입금') + v('유동성장기부채') + v('사채') + v('장기차입금');
    const nonOp = v('기타포괄손익-공정가치금융자산') + v('당기손익-공정가치금융자산') + v('관계기업 및 공동기업 투자');
    const shares = S.notes.shares_common + S.notes.shares_pref;
    const mcap = (m.price_common.close * S.notes.shares_common + m.price_pref.close * S.notes.shares_pref) / 1e6;
    const de = debt / mcap, tax = 0.15;
    const h1r = S.h1['매출액'].h1_2026, h1o = S.h1['영업이익'].h1_2026;
    return {
      rev0: rev0, m0: IS['영업이익'][0] / rev0, cash: cash, debt: debt, netDebt: debt - cash, nonOp: nonOp, nci: v('비지배지분'),
      shares: shares, unit: 1e6, mcap: mcap, years: 5, peerLo: 0, peerHi: 0,
      g1real: h1r * 2 / rev0 - 1, m1real: h1o / h1r,
      daReal: (S.notes.depreciation + S.notes.amortization) / rev0,
      capexReal: (-CF['유형자산의 취득'][0] - CF['무형자산의 취득'][0]) / rev0,
      nwcReal: (v('매출채권') + v('재고자산') - v('매입채무')) / rev0,
      taxReal: IS['법인세비용(수익)'][0] / IS['법인세비용차감전순이익'][0],
      rf: r.ktb10.value, kd: r.aa3.value, betaL: m.beta_2y_weekly, de: de, tax: tax,
      betaU: m.beta_2y_weekly / (1 + (1 - tax) * de),
    };
  }
  function dcfInit() {
    const P = DCF_BASE = dcfBase();
    const G = [+P.g1real.toFixed(3), 0.05, -0.15, -0.05, 0.03], Mg = [+P.m1real.toFixed(3), 0.40, 0.28, 0.22, 0.20];
    dcfPanel = makePanel($('dcf-panel'), [
      { legend: '매출 성장률 · 1년차는 실제, 이후 가정', items: YEARS.map((y, i) => (
        { id: 'g' + i, label: y + '년', hint: i === 0 ? '2026 상반기 × 2 ÷ 2025' : '가정', min: -40, max: 100, step: 0.5, scale: 100, value: G[i], unit: '%' })) },
      { legend: '영업이익률 · 1년차는 실제, 이후 가정', items: YEARS.map((y, i) => (
        { id: 'm' + i, label: y + '년', hint: i === 0 ? '2026 상반기 실적' : '가정', min: -10, max: 70, step: 0.5, scale: 100, value: Mg[i], unit: '%' })) },
      { legend: '투자와 세금 · 매출 대비', items: [
        { id: 'da', label: '감가상각비', hint: '2025 실제 ' + pct(P.daReal), min: 0, max: 25, step: 0.25, scale: 100, value: 0.10, unit: '%' },
        { id: 'capex', label: '설비투자', hint: '2025 실제 ' + pct(P.capexReal), min: 0, max: 30, step: 0.25, scale: 100, value: 0.12, unit: '%' },
        { id: 'nwc', label: '운전자본', hint: '2025 실제 ' + pct(P.nwcReal), min: 0, max: 50, step: 0.5, scale: 100, value: +P.nwcReal.toFixed(3), unit: '%' },
        { id: 'tax', label: '법인세율', hint: '2025 실효 ' + pct(P.taxReal), min: 0, max: 30, step: 0.5, scale: 100, value: P.tax, unit: '%' },
        { type: 'note', text: '매출이 크게 늘어나는 해에는 감가상각·설비투자 비율이 2025년보다 낮아지므로 10%, 12%로 낮춰 가정했습니다. 2026 상반기 설비투자는 매출의 ' + pct(SAM.h1.capex.h1_2026 / SAM.h1['매출액'].h1_2026) + '였습니다.' } ] },
      { legend: '할인율', items: [
        { id: 'rf', label: '무위험이자율', hint: '국고채 10년 실제', min: 0, max: 8, step: 0.01, scale: 100, value: P.rf, unit: '%' },
        { id: 'mrp', label: '시장위험프리미엄', hint: '가정', min: 3, max: 12, step: 0.1, scale: 100, value: 0.07, unit: '%' },
        { id: 'betaU', label: '무부채 베타', hint: '2년 주간 베타 ' + P.betaL.toFixed(2) + '에서', min: 0.3, max: 2.5, step: 0.01, value: +P.betaU.toFixed(3), unit: '' },
        { id: 'de', label: '부채비율', hint: '시가총액 대비 실제', min: 0, max: 50, step: 0.1, scale: 100, value: +P.de.toFixed(4), unit: '%' },
        { id: 'size', label: '규모위험프리미엄', hint: '대형주라 0', min: 0, max: 8, step: 0.1, scale: 100, value: 0, unit: '%' },
        { id: 'alpha', label: '기업고유위험', min: 0, max: 8, step: 0.1, scale: 100, value: 0, unit: '%' },
        { id: 'kd', label: '세전 타인자본비용', hint: '회사채 AA- 3년', min: 0, max: 10, step: 0.01, scale: 100, value: P.kd, unit: '%' } ] },
      { legend: '영구가치', items: [
        { id: 'gT', label: '영구성장률', min: -2, max: 5, step: 0.1, scale: 100, value: 0.02, unit: '%' },
        { type: 'switch', id: 'midYear', label: '현금흐름이 연중 고르게 생긴다고 보고 반년 할인', value: true } ] },
    ], () => dcfRun());
    dcfRun();
  }
  function dcfParams() {
    const v = dcfPanel.vals, P = DCF_BASE;
    return Object.assign({}, P, v, { gs: YEARS.map((y, i) => v['g' + i]), ms: YEARS.map((y, i) => v['m' + i]), g1: v.g0, g5: v.g4, m1: v.m0, m5: v.m4, m0: P.m0 });
  }
  const dcfRun = throttle(function () {
    const p = dcfParams(), P = DCF_BASE, px = SAM.market.price_common;
    const r = C.dcf(p);
    const e = x => fmt(x / 1e6, 1);              // 백만원 → 조원
    const gap = r.perShare / px.close - 1;
    $('dcf-kpis').innerHTML =
      kpi('주당 가치', isFinite(r.perShare) ? won(r.perShare) : '-', '원', '보통주·우선주 유통주식 ' + fmt(p.shares / 1e8, 2) + '억 주', true) +
      kpi('시장 주가', won(px.close), '원', px.date.slice(0, 4) + '-' + px.date.slice(4, 6) + '-' + px.date.slice(6) + ' 종가 · DCF 대비 ' + pct(-gap / (1 + gap), 1, true)) +
      kpi('기업가치', e(r.ev), '조원', '영구가치 비중 ' + pct(r.tvShare, 0)) +
      kpi('지분가치', e(r.equity), '조원', '+ 비영업자산 ' + e(p.nonOp) + ' + 순현금 ' + e(-p.netDebt) + ' − 비지배 ' + e(p.nci)) +
      kpi('가중평균자본비용', pct(r.wacc, 2), '', '자기자본비용 ' + pct(r.w.ke, 2) + ' · 베타 ' + r.w.betaL.toFixed(2));
    const im = C.dcfImpliedMargin(p, px.close);
    const avg = p.ms.slice(1).reduce((a, b) => a + b, 0) / 4;
    $('dcf-market').innerHTML = '<div class="card-head"><h3>지금 주가가 말하는 것</h3><span class="subtle">2027~2030년 영업이익률만 같은 값으로 바꿔 시장 주가에 맞춘 결과</span></div><div class="kpis">' +
      kpi('주가를 설명하는 영업이익률', im != null ? pct(im, 1) : '범위 밖', '', '2027~2030년 매년') +
      kpi('지금 가정의 평균', pct(avg, 1), '', p.ms.slice(1).map(x => pct(x, 0)).join(' → ')) +
      kpi('2026 상반기 실제', pct(P.m1real, 1), '', '2025년 ' + pct(P.m0, 1)) +
      '</div><p class="callout" style="margin-top:12px">' + (im != null
        ? '시장 주가 ' + won(px.close) + '원은 2027년 이후에도 영업이익률이 평균 ' + pct(im, 1) + '로 유지된다고 보는 셈입니다. 2025년 ' + pct(P.m0, 1) + '와 2026년 상반기 ' + pct(P.m1real, 1) + ' 사이 어디에 둘지가 가치 판단의 핵심이고, 반도체 가격 사이클을 어떻게 볼지의 문제입니다.'
        : '영업이익률만으로는 시장 주가를 설명할 수 없습니다. 성장률이나 할인율 가정을 함께 봐야 합니다.') + '</p>';
    $('dcf-flags').innerHTML = r.flags.length ? r.flags.map(f => note(f.level === 'bad' ? 'bad' : f.level, f.title, f.body)).join('')
      : note('good', '자동 점검 항목에 걸린 것이 없습니다', '영구가치 비중, 성장률과 재투자의 일관성, 할인율 구성이 모두 통상 범위 안입니다.');
    // 가치 구성 (조원)
    const cats = r.rows.map(x => (2025 + x.k) + '년').concat(['영구가치', '기업가치', '비영업자산', '순현금', '비지배지분', '지분가치']);
    const vals = r.rows.map(x => x.pv / 1e6).concat([r.pvTV / 1e6]);
    const baseS = [], valS = [];
    let run = 0;
    vals.forEach(v => { baseS.push(v >= 0 ? run : run + v); valS.push({ value: Math.abs(v), itemStyle: { color: css(v >= 0 ? '--c3' : '--bad') } }); run += v; });
    baseS.push(0); valS.push({ value: r.ev / 1e6, itemStyle: { color: css('--c1') } });
    [[p.nonOp, '--c4'], [-p.netDebt, '--c4'], [-p.nci, '--bad']].forEach(a => {
      const x = a[0] / 1e6;
      baseS.push(x >= 0 ? run : run + x); valS.push({ value: Math.abs(x), itemStyle: { color: css(x >= 0 ? a[1] : '--bad') } }); run += x;
    });
    baseS.push(0); valS.push({ value: r.equity / 1e6, itemStyle: { color: css('--c2') } });
    chart('dcf-bridge').setOption(base({
      grid: { left: 56, right: 12, top: 20, bottom: 58 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: css('--surface'), borderColor: css('--line-2'), textStyle: { color: css('--ink'), fontSize: 12.5 },
                 formatter: qs => { const q = qs.find(x => x.seriesName === '값'); return q.name + ' ' + fmt(q.value, 1) + '조원'; } },
      legend: { show: false },
      xAxis: axis({ type: 'category', data: cats, axisLabel: { color: css('--muted'), fontSize: 11, interval: 0, rotate: 35 } }),
      yAxis: axis({ type: 'value' }),
      series: [
        { name: '바닥', type: 'bar', stack: 'w', data: baseS, itemStyle: { color: 'transparent' }, emphasis: { disabled: true } },
        { name: '값', type: 'bar', stack: 'w', data: valS, label: { show: true, position: 'top', color: css('--muted'), fontSize: 10.5, formatter: q => fmt(q.value, 0) } },
      ],
    }), true);
    const S = r.sens, data = [];
    let mn = Infinity, mx = -Infinity;
    S.grid.forEach((row, i) => row.forEach((v, j) => {
      const cell = [j, i, isFinite(v) ? Math.round(v) : '-'];
      data.push(i === 2 && j === 2 ? { value: cell, itemStyle: { borderColor: css('--accent'), borderWidth: 3 } } : cell);
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
    const yrs = r.rows, T = r.terminal;
    const head = ['조원', '2025 실적'].concat(yrs.map(x => String(2025 + x.k))).concat(['영구']);
    const row = (name, f0, f, fT, isPct) => [name, f0 == null ? '' : (isPct ? pct(f0) : e(f0))].concat(yrs.map(x => isPct ? pct(f(x)) : e(f(x)))).concat([fT == null ? '' : (isPct ? pct(fT) : e(fT))]);
    $('dcf-table').innerHTML = table(head, [
      row('매출', p.rev0, x => x.rev, T.rev),
      row('성장률', SAM.statements.IS['매출액'][0] / SAM.statements.IS['매출액'][1] - 1, x => x.growth, p.gT, true),
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
      ['무위험이자율', pct(p.rf, 3), { v: '국고채 10년, 한국은행 ' + SAM.market.rates.ktb10.date, cls: 'txt' }],
      ['무부채 베타', p.betaU.toFixed(3), { v: '삼성전자 2년 주간 베타 ' + P.betaL.toFixed(3) + '(코스피 대비)에서 부채 효과를 뺌', cls: 'txt' }],
      ['부채 반영 베타', w.betaL.toFixed(3), { v: '무부채 베타 × (1 + (1 − 법인세율) × 부채비율)', cls: 'txt' }],
      ['시장위험프리미엄', pct(p.mrp, 2), { v: '가정', cls: 'txt' }],
      ['자기자본비용', pct(w.ke, 2), { v: '무위험이자율 + 베타 × 시장위험프리미엄 + 규모·고유위험', cls: 'txt' }],
      ['세후 타인자본비용', pct(w.kdAfter, 2), { v: '회사채 AA- 3년 ' + pct(p.kd, 3) + ' × (1 − 법인세율). 삼성전자는 더 높은 등급이라 보수적', cls: 'txt' }],
      ['자기자본 : 타인자본', pct(w.we, 1) + ' : ' + pct(w.wd, 1), { v: '시가총액 ' + e(P.mcap) + '조원, 차입금 ' + e(P.debt) + '조원', cls: 'txt' }],
      ['가중평균자본비용', pct(r.wacc, 2), { v: '가중평균', cls: 'txt' }],
    ], { rowClass: i => (i === 4 || i === 7 ? 'sum' : '') });
    $('dcf-src').innerHTML = table(['기준값', '값', '출처'], [
      ['2025 매출 · 영업이익', e(p.rev0) + ' · ' + e(p.rev0 * p.m0) + '조원', { v: '사업보고서 연결 손익계산서', cls: 'txt' }],
      ['2026 상반기 매출 · 영업이익', e(SAM.h1['매출액'].h1_2026) + ' · ' + e(SAM.h1['영업이익'].h1_2026) + '조원', { v: '반기보고서 연결 손익계산서 (2025 상반기 ' + e(SAM.h1['매출액'].h1_2025) + ' · ' + e(SAM.h1['영업이익'].h1_2025) + ')', cls: 'txt' }],
      ['현금성 자산', e(P.cash) + '조원', { v: '현금및현금성자산 + 단기금융상품 + 단기상각후원가·당기손익 금융자산', cls: 'txt' }],
      ['차입금', e(P.debt) + '조원', { v: '단기차입금 + 유동성장기부채 + 사채 + 장기차입금', cls: 'txt' }],
      ['비영업자산', e(P.nonOp) + '조원', { v: '기타포괄손익·당기손익 공정가치 금융자산 + 관계기업 투자', cls: 'txt' }],
      ['비지배지분', e(P.nci) + '조원', { v: '연결 재무상태표', cls: 'txt' }],
      ['유통주식 수', fmt(SAM.notes.shares_common) + ' + ' + fmt(SAM.notes.shares_pref) + '주', { v: '주석 18. 보통주 + 우선주(같은 가치로 단순화)', cls: 'txt' }],
      ['감가상각·무형상각', e(SAM.notes.depreciation + SAM.notes.amortization) + '조원', { v: '주석 21 비용의 성격별 분류', cls: 'txt' }],
    ]);
  });

  // ============================================================ 4. 파생상품
  let DV_DEFAULT = null;
  const DV_DEFAULT0 = { cd: 0.0275, s1: 0.0272, s3: 0.0270, s5: 0.0278, s10: 0.0292, s20: 0.03, spot: 1420, usdRate: 0.039, vol: 0.09,
                       inst: 'irs', notional: 10000, fixed: 0.034, payFixed: 'pay', T: 2.6, stub: 0.1, fixing: 0.028,
                       usd: 10000000, fwdK: 1385, fwdDir: 'sell', fwdT: 0.5,
                       optK: 1400, optType: 'put', optPos: 'long', optT: 0.5, csCpty: 0.008, csOwn: 0.02 };
  let dvPanel = null;
  function dvInit() {
    const m = SAM.market, r = m.rates, sp = m.rates.usdkrw.value;
    DV_DEFAULT = Object.assign({}, DV_DEFAULT0, { cd: r.cd91.value, s1: r.ktb1.value, s3: r.ktb3.value, s5: r.ktb5.value, s10: r.ktb10.value, s20: r.ktb20.value,
      spot: sp, usdRate: m.ust.m6, notional: 10000, fixed: 0.032, fixing: r.cd91.value, fwdK: Math.round(sp - 25), optK: Math.round(sp - 10),
      csOwn: +(r.aa3.value - r.ktb3.value).toFixed(4), csCpty: 0.005 });
    const P = DV_DEFAULT;
    const isI = v => v.inst === 'irs', isF = v => v.inst === 'fxf', isO = v => v.inst === 'fxo';
    dvPanel = makePanel($('deriv-panel'), [
      { legend: '시장 자료 · 실제 ' + SAM.market.rates.cd91.date.slice(0, 4) + '-' + SAM.market.rates.cd91.date.slice(4, 6) + '-' + SAM.market.rates.cd91.date.slice(6), items: [
        { id: 'cd', label: 'CD 91일물', min: 0, max: 8, step: 0.01, scale: 100, value: P.cd, unit: '%' },
        { id: 's1', label: '국고채 1년', min: 0, max: 8, step: 0.01, scale: 100, value: P.s1, unit: '%' },
        { id: 's3', label: '국고채 3년', min: 0, max: 8, step: 0.01, scale: 100, value: P.s3, unit: '%' },
        { id: 's5', label: '국고채 5년', min: 0, max: 8, step: 0.01, scale: 100, value: P.s5, unit: '%' },
        { id: 's10', label: '국고채 10년', min: 0, max: 8, step: 0.01, scale: 100, value: P.s10, unit: '%' },
        { id: 's20', label: '국고채 20년', min: 0, max: 8, step: 0.01, scale: 100, value: P.s20, unit: '%' },
        { id: 'spot', label: '원/달러 매매기준율', min: 1000, max: 1800, step: 1, value: P.spot, unit: '원' },
        { id: 'usdRate', label: '달러 금리', hint: '미국 국채 6개월', min: 0, max: 8, step: 0.05, scale: 100, value: P.usdRate, unit: '%' } ] },
      { legend: '평가 대상', items: [
        { type: 'seg', id: 'inst', value: P.inst, options: [['irs', '이자율스왑'], ['fxf', '통화선도'], ['fxo', '통화옵션']] } ] },
      { legend: '이자율스왑', showIf: isI, items: [
        { type: 'note', text: '가정한 계약: 변동금리 차입금 100억원을 고정금리로 바꾸려고 맺은 스왑. 3개월마다 CD 91일물과 고정 3.20%를 교환합니다.' },
        { id: 'notional', label: '명목금액', min: 10, max: 2000, step: 10, scale: 0.01, value: P.notional, unit: '억원' },
        { id: 'fixed', label: '고정금리', min: 0, max: 8, step: 0.01, scale: 100, value: P.fixed, unit: '%' },
        { type: 'seg', id: 'payFixed', label: '방향', value: P.payFixed, options: [['pay', '고정 지급·변동 수취'], ['recv', '고정 수취·변동 지급']] },
        { id: 'T', label: '잔존만기', min: 0.25, max: 10, step: 0.05, value: P.T, unit: '년' },
        { id: 'stub', label: '다음 이자 교환까지', min: 0.01, max: 0.25, step: 0.01, value: P.stub, unit: '년' },
        { id: 'fixing', label: '이번 기간 확정 CD금리', min: 0, max: 8, step: 0.01, scale: 100, value: P.fixing, unit: '%' } ] },
      { legend: '통화선도', showIf: isF, items: [
        { type: 'note', text: '가정한 계약: 삼성전자처럼 달러 매출이 큰 수출기업이 6개월 뒤 받을 달러를 미리 정한 환율에 팔기로 한 계약.' },
        { id: 'usd', label: '계약 금액', min: 10, max: 10000, step: 10, scale: 0.0001, value: P.usd, unit: '만달러' },
        { id: 'fwdK', label: '약정환율', min: 1000, max: 1800, step: 1, value: P.fwdK, unit: '원' },
        { type: 'seg', id: 'fwdDir', label: '방향', value: P.fwdDir, options: [['sell', '달러 매도'], ['buy', '달러 매입']] },
        { id: 'fwdT', label: '잔존만기', min: 0.05, max: 3, step: 0.05, value: P.fwdT, unit: '년' } ] },
      { legend: '통화옵션', showIf: isO, items: [
        { type: 'note', text: '가정한 계약: 환율 하락에 대비해 달러를 행사가격에 팔 권리(달러 풋)를 산 경우. 변동성은 시장 자료를 구하지 못해 가정입니다.' },
        { id: 'usd', label: '계약 금액', min: 10, max: 10000, step: 10, scale: 0.0001, value: P.usd, unit: '만달러' },
        { id: 'optK', label: '행사가격', min: 1000, max: 1800, step: 1, value: P.optK, unit: '원' },
        { type: 'seg', id: 'optType', label: '종류', value: P.optType, options: [['put', '달러 풋'], ['call', '달러 콜']] },
        { type: 'seg', id: 'optPos', label: '포지션', value: P.optPos, options: [['long', '매입'], ['short', '매도']] },
        { id: 'optT', label: '만기', min: 0.05, max: 3, step: 0.05, value: P.optT, unit: '년' },
        { id: 'vol', label: '환율 변동성', min: 2, max: 30, step: 0.25, scale: 100, value: P.vol, unit: '%' } ] },
      { legend: '신용위험 조정', showIf: v => !isO(v), items: [
        { id: 'csCpty', label: '거래상대방 신용스프레드', hint: '은행, 가정', min: 0, max: 10, step: 0.05, scale: 100, value: P.csCpty, unit: '%' },
        { id: 'csOwn', label: '자기 신용스프레드', hint: 'AA- 3년 − 국고채 3년', min: 0, max: 10, step: 0.05, scale: 100, value: P.csOwn, unit: '%' } ] },
    ], () => dvRun());
    dvRun();
  }
  const dvRun = throttle(function () {
    const v = dvPanel.vals;
    const curve = { cd: v.cd, tenors: [1, 3, 5, 10, 20], rates: [v.s1, v.s3, v.s5, v.s10, v.s20] };
    const cv = C.bootstrap(curve);
    // 곡선 그림
    const tz = [], zr = [], fw = [];
    for (let k = 1; k < cv.t.length; k++) {
      const t = cv.t[k];
      tz.push(t); zr.push([t, (Math.exp(-Math.log(cv.df[k]) / t) - 1) * 100]);
      fw.push([t, (cv.df[k - 1] / cv.df[k] - 1) / 0.25 * 100]);
    }
    const mk = [[0.25, v.cd], [1, v.s1], [3, v.s3], [5, v.s5], [10, v.s10], [20, v.s20]].map(a => [a[0], a[1] * 100]);
    chart('deriv-curve').setOption(base({
      grid: { left: 52, right: 16, top: 34, bottom: 40 },
      tooltip: { trigger: 'axis', backgroundColor: css('--surface'), borderColor: css('--line-2'), textStyle: { color: css('--ink'), fontSize: 12.5 }, valueFormatter: x => (x == null ? '-' : x.toFixed(3) + '%') },
      xAxis: axis({ type: 'value', name: '만기 (년)', nameLocation: 'middle', nameGap: 26, min: 0, max: 20 }),
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
        note('warn', '곡선 대체', '실무에서는 이자율스왑 금리로 할인곡선을 만듭니다. 공개 자료를 구하지 못해 국고채 금리로 대신했으므로 스왑 가치가 실제와 다를 수 있습니다.'),
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

  // ============================================================ 5. XBRL (삼성전자)
  let xbPanel = null, xbPick = 'ifrs-full_Inventories';
  function xbInit() {
    const sc = C.XB.scenarios;
    xbPanel = makePanel($('xbrl-panel'), [
      { legend: '넣어 볼 오류', items: sc.map(s => ({ type: 'switch', id: 'e_' + s.id, label: s.name + '<br><span class="subtle">' + s.desc + '</span>', value: false }))
        .concat([{ type: 'html', html: '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="button" data-all="1">모두 넣기</button><button class="btn" type="button" data-all="0">모두 빼기</button></div>',
                   mount: box => box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
                     sc.forEach(s => xbPanel.set('e_' + s.id, b.dataset.all === '1')); xbRun();
                   })) }]) },
      { legend: '자료', items: [{ type: 'note', text: C.XB.company + ' 2025 사업보고서 연결재무제표 금액 그대로입니다(전기는 2024 사업보고서와 일치 확인). 요소 이름은 표준 분류체계 대응이며 회사가 실제로 쓴 태그와 다를 수 있습니다.' }] },
    ], () => xbRun());
    xbRun();
  }
  function xbRun() {
    const XB = C.XB, errs = {};
    XB.scenarios.forEach(s => { errs[s.id] = !!xbPanel.vals['e_' + s.id]; });
    const facts = C.xbrlFacts(errs);
    const res = C.xbrlCheck(facts);
    const bad = res.issues.filter(i => i.level === 'bad').length, warn = res.issues.length - bad;
    $('xbrl-kpis').innerHTML =
      kpi('오류', bad, '건', bad ? '공시 전에 고쳐야 할 것' : '실제 공시 숫자는 모두 맞습니다', true) +
      kpi('주의', warn, '건', '근거를 확인할 것') +
      kpi('사실값', facts.length, '개', '당기·전기, 맥락별') +
      kpi('계산 관계', XB.calc.length, '개', '합계 검산 규칙') +
      kpi('넣은 오류', Object.values(errs).filter(Boolean).length, '가지', '왼쪽에서 고름');
    const extOf = {};
    Object.keys(XB.standardFor).forEach(ext => { extOf[XB.standardFor[ext]] = ext; });
    const flagged = {};
    res.issues.forEach(i => i.cells.forEach(c => {
      let el = c.split('|')[0];
      if (XB.standardFor[el]) el = XB.standardFor[el];
      flagged[el] = flagged[el] === 'bad' ? 'bad' : i.level;
    }));
    $('xbrl-issues').innerHTML = res.issues.length ? res.issues.map(i =>
      '<li class="note click" data-cell="' + esc(i.cells[0] || '') + '" style="cursor:pointer"><span class="chip ' + (i.level === 'bad' ? 'bad' : 'warn') + '">' + (i.level === 'bad' ? '오류' : '주의') + '</span><div><b>' + i.rule + ' · ' + i.where + '</b><p>' + i.msg + '</p><p class="subtle">' + i.fix + '</p></div></li>').join('')
      : note('good', '걸린 규칙이 없습니다', '삼성전자 실제 숫자는 계산 관계 ' + XB.calc.length + '개, 자산과 부채·자본 합계, 현금 증감, 이익잉여금 변동, 작년 공시값과 모두 맞습니다. 왼쪽에서 오류를 넣어 보세요.');
    $('xbrl-issues').querySelectorAll('[data-cell]').forEach(li => li.addEventListener('click', () => {
      let el = li.dataset.cell.split('|')[0];
      if (XB.standardFor[el]) el = XB.standardFor[el];
      if (el) { xbPick = el; xbRun(); }
    }));
    const val = (el, period, dupOnly) => {
      const list = facts.filter(f => (f.el === el || f.el === extOf[el]) && f.period === period && (dupOnly ? f.dupOf === 'CF' : !f.dupOf));
      return list.length ? list[0] : null;
    };
    const subtotal = new Set(XB.calc.map(c => c[0]));
    const label = el => (XB.elements.find(e => e[0] === el) || [el, el])[1];
    const mk = (view, cols) => {
      const els = XB.views[view];
      const rows = els.map(el => {
        const isStart = view === 'CF' && el === 'ifrs-full_ProfitLoss';
        const f0 = isStart ? (val(el, 'CY', true) || val(el, 'CY')) : val(el, 'CY');
        const name = (isStart ? '당기순이익 (출발점)' : label(el)) + (f0 && f0.el !== el ? ' <span class="chip warn">확장</span>' : '');
        return [name].concat(cols.map(pp2 => {
          const f = isStart ? (pp2 === 'CY' ? f0 : val(el, pp2)) : val(el, pp2);
          return f ? fmt(f.value / 1e6, f.value !== 0 && Math.abs(f.value) < 1e6 ? 6 : 0) : '';
        }));
      });
      return table(['계정'].concat(cols.map(c => (c === 'CY' ? XB.years[0] + ' 당기' : XB.years[1] + ' 전기'))), rows, {
        rowClass: i => {
          const el = els[i], c = [];
          if (subtotal.has(el)) c.push('sum');
          if (flagged[el]) c.push(flagged[el] === 'bad' ? 'flag' : 'flag-warn');
          if (el === xbPick) c.push('pick');
          return c.join(' ') + ' click';
        },
        rowAttr: i => ' data-el="' + els[i] + '"',
      });
    };
    $('xbrl-bs').innerHTML = mk('BS', ['CY', 'PY']);
    $('xbrl-is').innerHTML = mk('IS', ['CY', 'PY']);
    $('xbrl-cf').innerHTML = mk('CF', ['CY', 'PY']);
    $('xbrl-re').innerHTML = mk('RE', ['CY']);
    document.querySelectorAll('#xbrl-bs tr[data-el], #xbrl-is tr[data-el], #xbrl-cf tr[data-el], #xbrl-re tr[data-el]').forEach(tr => tr.addEventListener('click', () => { xbPick = tr.dataset.el; xbRun(); }));
    const picked = facts.filter(f => f.el === xbPick || f.el === extOf[xbPick]);
    $('xbrl-pick-sub').textContent = label(xbPick) + ' · ' + picked.length + '개 사실값';
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
        kpi('삼성전자 공시 재현', cnt('삼성전자 공시 재현'), '건', '공시값·재무제표 검산') +
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
    const psu = C.psuClosed({ S0: 91600, B: 91600, sigma: 0.2784, q: 0.0158, r: 0.0253, T: 3 }).value;
    ok('삼성전자 주식보상 공시값 재현', Math.abs(psu / 51760 - 1) < 0.002, '재계산 ' + fmt(psu, 1) + '원 · 공시 51,760원');
    const bad = C.XB.scenarios.filter(s => { const o = {}; o[s.id] = true; const rules = C.xbrlCheck(C.xbrlFacts(o)).issues.map(i => i.rule); return !s.expect.every(x => rules.indexOf(x) >= 0); });
    ok('삼성전자 XBRL 오류 8가지 탐지', bad.length === 0 && C.xbrlCheck(C.xbrlFacts({})).issues.length === 0, bad.length ? '못 잡은 것: ' + bad.map(s => s.name).join(', ') : '깨끗한 표본 0건, 넣은 오류 모두 탐지');
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
  const INIT = { cb: cbInit, psu: psuInit, dcf: dcfInit, deriv: dvInit, xbrl: xbInit, bt: btInit, verify: verifyInit };
  const RERENDER = { cb: () => { cbRun(); cbExtras(); }, psu: () => psuRun(), dcf: () => dcfRun(), deriv: () => dvRun(), xbrl: () => xbRun(), bt: () => BD && btRun(), verify: () => {} };
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

  function homeInit() {
    const m = SAM.market, r = m.rates, d = x => x.slice(0, 4) + '-' + x.slice(4, 6) + '-' + x.slice(6);
    $('home-asof').textContent = '자료 정리 ' + SAM.asof;
    $('home-sources').innerHTML = table(['자료', '값', '출처'], [
      ['2025 연결재무제표·주석', '매출 ' + fmt(SAM.statements.IS['매출액'][0] / 1e6, 1) + '조원 · 영업이익 ' + fmt(SAM.statements.IS['영업이익'][0] / 1e6, 1) + '조원', { v: SAM.sources.fy2025, cls: 'txt' }],
      ['2026 상반기 실적', '매출 ' + fmt(SAM.h1['매출액'].h1_2026 / 1e6, 1) + '조원 · 영업이익 ' + fmt(SAM.h1['영업이익'].h1_2026 / 1e6, 1) + '조원', { v: SAM.sources.h1_2026, cls: 'txt' }],
      ['주식보상 공정가치', fmt(SAM.psu.fair_value) + '원 (' + fmt(SAM.psu.units / 1e4) + '만 단위)', { v: '2025 사업보고서 주석 20', cls: 'txt' }],
      ['국고채 3년 · 10년, CD 91일', pct(r.ktb3.value, 3) + ' · ' + pct(r.ktb10.value, 3) + ', ' + pct(r.cd91.value, 2), { v: SAM.sources.rates + ', ' + d(r.ktb3.date), cls: 'txt' }],
      ['원/달러 매매기준율', fmt(r.usdkrw.value, 1) + '원', { v: '한국은행, ' + d(r.usdkrw.date), cls: 'txt' }],
      ['미국 국채 6개월', pct(m.ust.m6, 2), { v: SAM.sources.ust + ', ' + m.ust.date, cls: 'txt' }],
      ['삼성전자 주가 · 우선주', fmt(m.price_common.close) + '원 · ' + fmt(m.price_pref.close) + '원', { v: SAM.sources.prices + ', ' + d(m.price_common.date) + ' 종가', cls: 'txt' }],
      ['변동성 · 베타', '1년 ' + pct(m.vol_1y) + ' · 3년 ' + pct(m.vol_3y) + ' · 베타 ' + m.beta_2y_weekly.toFixed(2), { v: '위 주가로 계산 (일간 로그수익률, 2년 주간 코스피 대비)', cls: 'txt' }],
    ]);
  }

  Promise.all([fetch('samsung.json').then(r => r.json()), fetch('samsung_xbrl.json').then(r => r.json())]).then(a => {
    SAM = a[0];
    C.useXbrl(a[1]);
    homeInit();
    show(location.hash.slice(1) || 'home');
  }).catch(err => { document.querySelector('main').insertAdjacentHTML('afterbegin', '<p class="callout">삼성전자 자료를 불러오지 못했습니다 (' + esc(err.message) + ').</p>'); });
  loadVerification().then(v => {
    if (v) $('home-verify-count').textContent = v.passed + '/' + v.total + ' 통과';
    footBuild();
  });
})();
