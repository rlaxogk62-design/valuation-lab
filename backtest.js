/* TWO-TWO 백테스트 계산 (브라우저용)
 *
 * dashboard/engine.py 의 simulate() 와 summarize() 를 한 줄씩 옮겼다.
 * 재료(시세·변동성·펀딩비·모델 확률)와 엄격 체결 판정은 export_backtest.py 가 봉인 채점기 함수로 미리 만든다.
 * 파이썬 엔진 결과와 거래 단위로 같은지 tests/check_backtest.js 로 확인한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BT = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BAR_MS = 15 * 60 * 1000, TAIL_MS = 6 * 3600 * 1000;
  const STATUS = { f: 'filled', u: 'unfilled', r: 'rejected', k: 'unknown' };

  // 구간 [start, end) 를 볼 때 쓰는 봉 범위. 대시보드처럼 끝 뒤 6시간까지 쓴다.
  function windowOf(D, startMs, endMs) {
    const ts = D.ts;
    let i0 = 0, i1 = ts.length;
    while (i0 < ts.length && ts[i0] < Math.min(startMs, endMs)) i0++;
    while (i1 > 0 && ts[i1 - 1] >= endMs + TAIL_MS) i1--;
    return [i0, i1];
  }

  function predOf(row) {               // 넘파이 argmax 처럼 같은 값이면 앞쪽
    let a = 0;
    if (row[1] > row[a]) a = 1;
    if (row[2] > row[a]) a = 2;
    return a;
  }

  function simulate(D, model, startMs, endMs, rules, strict) {
    const w = windowOf(D, startMs, endMs), i0 = w[0], i1 = w[1];
    const P = D.probs[model], o = D.o, h = D.h, l = D.l, c = D.c, vol = D.vol4h, fund = D.fund, ts = D.ts;
    const trades = [], signals = [];
    const notes = { signals: 0, rejected: 0, unfilled: 0, filled: 0 };
    let side = 0, entryBar = -1, entryPx = 0, sigBar = -1;
    let i = i0;
    while (i < i1 - 1) {
      if (side !== 0) {
        const j = i;
        const liqPx = entryPx * (1 - side * (1.0 / rules.leverage - rules.mmr));
        const hitLiq = side === 1 ? l[j] <= liqPx : h[j] >= liqPx;
        const held = j - entryBar;
        const pj = predOf(P[j]), qj = Math.max(P[j][0], P[j][1], P[j][2]);
        const opp = (side === 1 && pj === 0) || (side === -1 && pj === 2);
        let exitPx = null, why = null;
        if (hitLiq) { exitPx = liqPx; why = '강제청산'; }
        else if (held >= rules.max_hold) { exitPx = o[j + 1]; why = '만료'; }
        else if (opp && qj >= rules.exit_th) { exitPx = o[j + 1]; why = '반대신호'; }
        if (exitPx !== null) {
          const ret = (exitPx / entryPx - 1) * side;
          const lastFund = why === '강제청산' ? j : j + 1;
          let fs = 0;
          for (let k = entryBar + 1; k <= lastFund; k++) fs += fund[k];
          const fd = fs * side;
          const pnl = why === '강제청산' ? -1.0 / rules.leverage - rules.fee_in
            : ret - fd - rules.fee_in - rules.fee_out;
          trades.push({ signal_bar: ts[sigBar], entry_bar: ts[entryBar], exit_bar: ts[j],
                        side: side === 1 ? 'LONG' : 'SHORT', entry_px: entryPx, exit_px: exitPx, held: held,
                        why: why, move: ret, funding: fd, pnl: pnl });
          side = 0;
          i = j + 1;                      // 청산한 판단에서는 진입하지 않는다
          continue;
        }
        i += 1;
        continue;
      }
      if (ts[i] >= endMs) break;
      const pi = predOf(P[i]), qi = Math.max(P[i][0], P[i][1], P[i][2]);
      if (ts[i] >= startMs && qi >= rules.entry_th && (pi === 0 || pi === 2) && vol[i] >= rules.vol_min) {
        notes.signals += 1;
        const s = pi === 2 ? 1 : -1, px = c[i], k = i + 1;
        let status;
        if (strict) {
          status = STATUS[(s === 1 ? D.fill_long : D.fill_short)[i]];
          if (status === 'unknown') notes.unknown = (notes.unknown || 0) + 1;
        } else status = 'filled';
        if (status === 'rejected') notes.rejected += 1;
        else if (status !== 'filled') notes.unfilled += 1;
        else { notes.filled += 1; side = s; entryBar = k; entryPx = px; sigBar = i; }
        signals.push({ bar: ts[i], side: s === 1 ? 'LONG' : 'SHORT', price: px, prob: qi, status: status, idx: i });
        i = k;                            // 다음 판단은 봉 i+1 에서
        continue;
      }
      i += 1;
    }
    let openPos = null;
    if (side !== 0) {
      const n1 = i1 - 1;
      openPos = { signal_bar: ts[sigBar], entry_bar: ts[entryBar], side: side === 1 ? 'LONG' : 'SHORT',
                  entry_px: entryPx, held: n1 - entryBar, last_close: c[n1], move: (c[n1] / entryPx - 1) * side };
    }
    return { trades: trades, notes: notes, signals: signals, openPos: openPos, i0: i0, i1: i1 };
  }

  function monthKey(ms) {              // 한국 시각 기준 달 (ts 는 UTC 밀리초)
    const d = new Date(ms + 9 * 3600 * 1000);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  }

  function summarize(trades, rules) {
    if (!trades.length) return null;
    const p = trades.map(function (t) { return t.pnl; });
    const size = trades.map(function (t) { return Math.abs(t.move); });
    const n = p.length;
    let wins = 0, wSum = 0, wN = 0, lSum = 0, lN = 0, mean = 0;
    for (let i = 0; i < n; i++) {
      mean += p[i];
      if (p[i] > 0) { wins++; wSum += size[i]; wN++; } else { lSum += size[i]; lN++; }
    }
    mean /= n;
    let ss = 0;
    for (let i = 0; i < n; i++) ss += (p[i] - mean) * (p[i] - mean);
    const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : NaN;
    const R = wN && lN ? (wSum / wN) / (lSum / lN) : NaN;
    const t = n > 1 ? mean / (sd / Math.sqrt(n)) : NaN;
    const k = rules.leverage * rules.invest_ratio;
    const eq = [];
    let e = 1, peak = 1, dd = 0;
    for (let i = 0; i < n; i++) {
      e *= 1 + k * p[i];
      eq.push(e);
      peak = Math.max(peak, e);
      dd = Math.min(dd, e / peak - 1);
    }
    const monthly = {}, reasons = {};
    trades.forEach(function (tr) {
      const m = monthKey(tr.signal_bar);
      monthly[m] = monthly[m] || { count: 0, sum: 0 };
      monthly[m].count += 1; monthly[m].sum += tr.pnl;
      reasons[tr.why] = (reasons[tr.why] || 0) + 1;
    });
    const months = Object.keys(monthly).sort();
    return { n: n, win: wins / n, R: R, per: mean, t: t, multiple: eq[n - 1], mdd: dd,
             liq: reasons['강제청산'] || 0, reasons: reasons, monthly: monthly, months: months.length,
             monthsPos: months.filter(function (m) { return monthly[m].sum > 0; }).length, monthList: months, equity: eq };
  }

  return { BAR_MS: BAR_MS, TAIL_MS: TAIL_MS, STATUS: STATUS, windowOf: windowOf, predOf: predOf,
           simulate: simulate, summarize: summarize, monthKey: monthKey };
}));
