/* 가치평가 실습실 계산 모듈
 *
 * 화면(index.html)과 검증 스크립트(노드)가 같은 파일을 쓴다.
 * 같은 계산을 파이썬(reference.py)으로 따로 짜서 결과를 대조했다 (verify.py).
 *
 * 금리는 모두 연복리로 받아 연속복리로 바꿔 쓴다. 기간 단위는 년.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VCalc = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------ 기본 함수
  // 표준정규 누적분포. 하트(1968) 배정밀도 근사, 웨스트(2005) 정리판. 오차 1e-14 수준.
  function normCdf(x) {
    const a = Math.abs(x);
    let c;
    if (a > 37) c = 0;
    else {
      const e = Math.exp(-a * a / 2);
      if (a < 7.07106781186547) {
        let b = 3.52624965998911e-02 * a + 0.700383064443688;
        b = b * a + 6.37396220353165;
        b = b * a + 33.912866078383;
        b = b * a + 112.079291497871;
        b = b * a + 221.213596169931;
        b = b * a + 220.206867912376;
        c = e * b;
        b = 8.83883476483184e-02 * a + 1.75566716318264;
        b = b * a + 16.064177579207;
        b = b * a + 86.7807322029461;
        b = b * a + 296.564248779674;
        b = b * a + 637.333633378831;
        b = b * a + 793.826512519948;
        b = b * a + 440.413735824752;
        c = c / b;
      } else {
        let b = a + 0.65;
        b = a + 4 / b;
        b = a + 3 / b;
        b = a + 2 / b;
        b = a + 1 / b;
        c = e / b / 2.506628274631;
      }
    }
    return x > 0 ? 1 - c : c;
  }

  function normPdf(x) { return Math.exp(-0.5 * x * x) / 2.5066282746310002; }

  function cont(rAnnual) { return Math.log(1 + rAnnual); }

  // 난수. 같은 씨앗이면 브라우저·노드·파이썬에서 같은 수열이 나온다.
  function mulberry32(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 박스-뮬러. 두 개씩 만들고 하나는 다음 호출에 쓴다.
  function normalSource(rng) {
    let spare = null;
    return function () {
      if (spare !== null) { const z = spare; spare = null; return z; }
      const u1 = 1 - rng(), u2 = rng();
      const rad = Math.sqrt(-2 * Math.log(u1)), th = 2 * Math.PI * u2;
      spare = rad * Math.sin(th);
      return rad * Math.cos(th);
    };
  }

  // 구간 안의 근 찾기 (일리노이 방식 가위치법). f(lo), f(hi) 부호가 같으면 null.
  function bisect(f, lo, hi, tol) {
    let flo = f(lo), fhi = f(hi), side = 0;
    if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return null;
    tol = tol || 1e-7;
    for (let k = 0; k < 60; k++) {
      const x = (lo * fhi - hi * flo) / (fhi - flo), fx = f(x);
      if (Math.abs(fx) < tol || Math.abs(hi - lo) < 1e-12) return x;
      if (fx * fhi > 0) { hi = x; fhi = fx; if (side === -1) flo /= 2; side = -1; }
      else { lo = x; flo = fx; if (side === 1) fhi /= 2; side = 1; }
    }
    return 0.5 * (lo + hi);
  }

  // ------------------------------------------------------------ 옵션 공식
  // 블랙-숄즈 (배당수익률 q). 통화옵션은 q 자리에 외화 금리를 넣으면 가먼-콜하겐 공식이 된다.
  // 금리는 연속복리로 받는다.
  function bsGreeks(S, K, T, r, q, sigma, isCall) {
    const sq = Math.sqrt(T), d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sq);
    const d2 = d1 - sigma * sq, dq = Math.exp(-q * T), dr = Math.exp(-r * T), pdf = normPdf(d1);
    const out = { d1: d1, d2: d2 };
    if (isCall) {
      out.value = S * dq * normCdf(d1) - K * dr * normCdf(d2);
      out.delta = dq * normCdf(d1);
      out.theta = -S * dq * pdf * sigma / (2 * sq) - r * K * dr * normCdf(d2) + q * S * dq * normCdf(d1);
      out.rho = K * T * dr * normCdf(d2);
    } else {
      out.value = K * dr * normCdf(-d2) - S * dq * normCdf(-d1);
      out.delta = -dq * normCdf(-d1);
      out.theta = -S * dq * pdf * sigma / (2 * sq) + r * K * dr * normCdf(-d2) - q * S * dq * normCdf(-d1);
      out.rho = -K * T * dr * normCdf(-d2);
    }
    out.gamma = dq * pdf / (S * sigma * sq);
    out.vega = S * dq * pdf * sq;
    return out;
  }

  // 이항모형(콕스-로스-루빈스타인). 유럽형·미국형 확인용.
  function crrOption(S, K, T, r, q, sigma, N, isCall, american) {
    const dt = T / N, u = Math.exp(sigma * Math.sqrt(dt)), d = 1 / u;
    const p = (Math.exp((r - q) * dt) - d) / (u - d), disc = Math.exp(-r * dt);
    const V = new Float64Array(N + 1);
    for (let j = 0; j <= N; j++) {
      const s = S * Math.pow(u, 2 * j - N);
      V[j] = Math.max(isCall ? s - K : K - s, 0);
    }
    for (let i = N - 1; i >= 0; i--) {
      for (let j = 0; j <= i; j++) {
        let h = disc * (p * V[j + 1] + (1 - p) * V[j]);
        if (american) {
          const s = S * Math.pow(u, 2 * j - i);
          h = Math.max(h, isCall ? s - K : K - s);
        }
        V[j] = h;
      }
    }
    return V[0];
  }

  // ------------------------------------------------------------ 1. 복합금융상품 (전환사채·상환전환우선주)
  // 발행 후 tau년에 상환·조기상환할 때 받는 금액.
  // 보장수익률 y(연 m회 복리)를 맞추도록, 그때까지 받은 이자(연 c, 연 mc회 지급)를 이자율 y로 불려 뺀다.
  function redemptionAmount(F, y, m, c, mc, tau) {
    if (tau <= 0) return F;
    const g = 1 + y / m;
    let R = F * Math.pow(g, m * tau);
    if (c > 0 && mc > 0) {
      const cp = F * c / mc, paid = Math.floor(tau * mc + 1e-9);
      for (let k = 1; k <= paid; k++) R -= cp * Math.pow(g, m * (tau - k / mc));
    }
    return R;
  }

  const ACT = { HOLD: 0, CONV: 1, PUT: 2, CALL: 3, CALLCONV: 4, REDEEM: 5 };

  // 쓰베리오티스-페르난데스 방식 이항모형.
  // 노드 가치를 주식 부분(전환으로 받을 몫, 무위험이자율로 할인)과
  // 채권 부분(현금으로 받을 몫, 무위험+신용스프레드로 할인)으로 나눠 거꾸로 계산한다.
  //
  // p: S0 주가, sigma, r 무위험(연복리), q 배당수익률, cs 신용스프레드, F 액면(발행가),
  //    T 잔존만기, elapsed 발행 후 경과, convOn/convPrice/convStart,
  //    coupon/couponFreq 표면이자, ytm/ytmFreq 만기 보장수익률,
  //    putOn/putStart/putFreq/putYield 조기상환청구(상환권), callOn/callStart/callEnd/callYield 매도청구,
  //    N 격자 수
  function convertible(p, opts) {
    opts = opts || {};
    const N = Math.max(4, Math.round(p.N || 200)), T = p.T, dt = T / N;
    const r = cont(p.r), q = cont(p.q || 0), rd = cont(p.r + p.cs);
    const u = Math.exp(p.sigma * Math.sqrt(dt)), d = 1 / u;
    const pu = (Math.exp((r - q) * dt) - d) / (u - d), pd = 1 - pu;
    if (!(pu > 0 && pu < 1)) return { error: '격자가 너무 성깁니다. 격자 수를 늘리세요.' };
    const dfR = Math.exp(-r * dt), dfD = Math.exp(-rd * dt);
    const F = p.F, e0 = p.elapsed || 0, m = p.ytmFreq || 1;
    const c = p.coupon || 0, mc = p.couponFreq || 1;
    const CR = p.convOn ? F / p.convPrice : 0;
    const convFrom = p.convOn ? Math.max(0, Math.round((p.convStart || 0) / dt)) : N + 1;

    const coupon = new Float64Array(N + 1);
    if (c > 0) {
      for (let k = 1; k / mc <= e0 + T + 1e-9; k++) {
        const t = k / mc - e0;
        if (t > 1e-9) coupon[Math.min(N, Math.round(t / dt))] += F * c / mc;
      }
    }
    const putAt = new Uint8Array(N + 1);
    if (p.putOn) {
      for (let k = 0; ; k++) {
        const t = (p.putStart || 0) + (p.putFreq > 0 ? k / p.putFreq : 0);
        if (t > T + 1e-9) break;
        if (t >= -1e-9) putAt[Math.min(N, Math.round(t / dt))] = 1;
        if (!(p.putFreq > 0)) break;
      }
    }
    const putYield = p.putYield == null ? p.ytm : p.putYield;
    const callYield = p.callYield == null ? p.ytm : p.callYield;

    const keep = opts.map ? [] : null;
    let E = new Float64Array(N + 1), D = new Float64Array(N + 1);
    const Rm = redemptionAmount(F, p.ytm, m, c, mc, e0 + T) + coupon[N];
    const lastAct = keep ? new Uint8Array(N + 1) : null;
    const pw = new Float64Array(2 * N + 1);           // pw[k + N] = u^k
    for (let k = -N; k <= N; k++) pw[k + N] = Math.pow(u, k);
    for (let j = 0; j <= N; j++) {
      const cv = N >= convFrom ? CR * p.S0 * pw[2 * j] : 0;
      if (cv > Rm) { E[j] = cv; D[j] = 0; if (lastAct) lastAct[j] = ACT.CONV; }
      else { E[j] = 0; D[j] = Rm; if (lastAct) lastAct[j] = ACT.REDEEM; }
    }
    if (keep) keep[N] = lastAct;

    let v1 = null, v2 = null;
    for (let i = N - 1; i >= 0; i--) {
      const t = i * dt, canConv = i >= convFrom, canPut = putAt[i] === 1;
      const canCall = !!p.callOn && t >= p.callStart - 1e-9 && t <= p.callEnd + 1e-9;
      const putPx = canPut ? redemptionAmount(F, putYield, m, c, mc, e0 + t) + coupon[i] : 0;
      const callPx = canCall ? redemptionAmount(F, callYield, m, c, mc, e0 + t) + coupon[i] : 0;
      const acts = keep ? new Uint8Array(i + 1) : null;
      for (let j = 0; j <= i; j++) {
        let e = dfR * (pu * E[j + 1] + pd * E[j]);
        let dd = dfD * (pu * D[j + 1] + pd * D[j]) + coupon[i];
        let v = e + dd, act = ACT.HOLD;
        const cv = canConv ? CR * p.S0 * pw[2 * j - i + N] : 0;
        if (canCall && v > Math.max(callPx, cv)) {
          if (cv >= callPx) { e = cv; dd = 0; act = ACT.CALLCONV; } else { e = 0; dd = callPx; act = ACT.CALL; }
          v = e + dd;
        }
        if (canPut && putPx > v) { e = 0; dd = putPx; v = putPx; act = ACT.PUT; }
        if (canConv && cv > v) { e = cv; dd = 0; v = cv; act = ACT.CONV; }
        E[j] = e; D[j] = dd;
        if (acts) acts[j] = act;
      }
      if (keep) keep[i] = acts;
      if (i === 2) v2 = [E[0] + D[0], E[1] + D[1], E[2] + D[2]];
      if (i === 1) v1 = [E[0] + D[0], E[1] + D[1]];
    }
    const S0 = p.S0, value = E[0] + D[0];
    const delta = v1 ? (v1[1] - v1[0]) / (S0 * u - S0 * d) : NaN;
    let gamma = NaN;
    if (v2) {
      const suu = S0 * u * u, sud = S0, sdd = S0 * d * d;
      gamma = ((v2[2] - v2[1]) / (suu - sud) - (v2[1] - v2[0]) / (sud - sdd)) / (0.5 * (suu - sdd));
    }
    const out = { value: value, equity: E[0], debt: D[0], delta: delta, gamma: gamma, N: N, dt: dt, u: u,
                  pu: pu, CR: CR, parity: CR * S0, redeemAtT: Rm };
    if (keep) out.map = keep;
    return out;
  }

  // 화면용 묶음: 전환권 없는 채권 가치, 민감도, 역산.
  function convertibleReport(p) {
    const base = convertible(p, { map: true });
    if (base.error) return base;
    const straight = convertible(Object.assign({}, p, { convOn: false }));
    const fine = convertible(Object.assign({}, p, { N: 2 * Math.round(p.N) }));
    const bump = function (patch) { return convertible(Object.assign({}, p, patch)).value; };
    const vega = (bump({ sigma: p.sigma + 0.01 }) - bump({ sigma: p.sigma - 0.01 })) / 2;
    const csSens = (bump({ cs: p.cs + 0.01 }) - bump({ cs: p.cs - 0.01 })) / 2;
    // dn: 입력을 낮췄을 때 가치, up: 높였을 때 가치
    const py = p.putYield == null ? p.ytm : p.putYield;
    const tornado = [
      { key: 'S0', name: '기초자산 가치 ±10%', dn: bump({ S0: p.S0 * 0.9 }), up: bump({ S0: p.S0 * 1.1 }) },
      { key: 'sigma', name: '변동성 ±5%p', dn: bump({ sigma: Math.max(0.01, p.sigma - 0.05) }), up: bump({ sigma: p.sigma + 0.05 }) },
      { key: 'cs', name: '신용스프레드 ±1%p', dn: bump({ cs: Math.max(0, p.cs - 0.01) }), up: bump({ cs: p.cs + 0.01 }) },
      { key: 'r', name: '무위험이자율 ±0.5%p', dn: bump({ r: Math.max(0, p.r - 0.005) }), up: bump({ r: p.r + 0.005 }) },
      { key: 'convPrice', name: '전환가격 ±10%', dn: bump({ convPrice: p.convPrice * 0.9 }), up: bump({ convPrice: p.convPrice * 1.1 }) },
      { key: 'ytm', name: '보장수익률 ±1%p', dn: bump({ ytm: Math.max(0, p.ytm - 0.01), putYield: Math.max(0, py - 0.01) }),
        up: bump({ ytm: p.ytm + 0.01, putYield: py + 0.01 }) },
    ];
    tornado.forEach(function (x) { x.range = Math.abs(x.up - x.dn); });
    tornado.sort(function (a, b) { return b.range - a.range; });
    let impliedSigma = null, impliedCs = null;
    if (p.reported > 0) {
      impliedSigma = bisect(function (s) { return bump({ sigma: s }) - p.reported; }, 0.01, 2.5, 1e-6 * p.reported);
      impliedCs = bisect(function (x) { return bump({ cs: x }) - p.reported; }, 0, 0.6, 1e-6 * p.reported);
    }
    return Object.assign(base, {
      straight: straight.value, option: base.value - straight.value,
      fineValue: fine.value, gridGap: fine.value - base.value,
      vega: vega, csSens: csSens, tornado: tornado,
      impliedSigma: impliedSigma, impliedCs: impliedCs,
    });
  }

  // ------------------------------------------------------------ 2. 주주간 계약 옵션 (최소제곱 몬테카를로)
  // 투자자 풋옵션: 상장이 안 되면 투자 단가에 연 irr 복리를 붙인 값에 최대주주에게 팔 권리.
  // 최대주주 콜옵션: 투자자 지분 일부를 연 irr 복리 가격에 사 올 권리.
  // 상장은 기간 내 확률을 받아 일정한 위험률로 바꿔 경로마다 뽑는다. 상장되면 두 옵션 모두 사라진다.
  function simulatePaths(p) {
    const steps = Math.max(1, Math.round(p.stepsPerYear || 12)), dt = 1 / steps;
    const horizon = Math.max(p.putOn ? p.putEnd : 0, p.callOn ? p.callEnd : 0, dt);
    const M = Math.max(1, Math.ceil(horizon * steps - 1e-9));
    const nPairs = Math.max(1, Math.round((p.paths || 20000) / 2)), n = 2 * nPairs;
    const r = cont(p.r), q = cont(p.q || 0);
    const drift = (r - q - 0.5 * p.sigma * p.sigma) * dt, vol = p.sigma * Math.sqrt(dt);
    const rng = mulberry32(p.seed == null ? 20261107 : p.seed);
    const z = normalSource(rng);
    const S = new Float64Array((M + 1) * n);
    for (let i = 0; i < n; i++) S[i] = p.S0;
    for (let k = 1; k <= M; k++) {
      const b = k * n, a = (k - 1) * n;
      for (let i = 0; i < nPairs; i++) {
        const x = vol * z();
        S[b + 2 * i] = S[a + 2 * i] * Math.exp(drift + x);
        S[b + 2 * i + 1] = S[a + 2 * i + 1] * Math.exp(drift - x);
      }
    }
    const ipo = new Float64Array(n);
    const lam = p.ipoProb > 0 ? -Math.log(1 - Math.min(p.ipoProb, 0.999999)) / Math.max(p.ipoHorizon, 1e-6) : 0;
    for (let i = 0; i < n; i++) ipo[i] = lam > 0 ? -Math.log(1 - rng()) / lam : Infinity;
    return { S: S, n: n, nPairs: nPairs, M: M, dt: dt, r: r, ipo: ipo };
  }

  // 3x3 연립방정식 (정규방정식). 풀리지 않으면 null.
  function solve3(A, y) {
    const M = [[A[0], A[1], A[2], y[0]], [A[3], A[4], A[5], y[1]], [A[6], A[7], A[8], y[2]]];
    for (let c = 0; c < 3; c++) {
      let piv = c;
      for (let r2 = c + 1; r2 < 3; r2++) if (Math.abs(M[r2][c]) > Math.abs(M[piv][c])) piv = r2;
      if (Math.abs(M[piv][c]) < 1e-300) return null;
      const tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
      for (let r2 = 0; r2 < 3; r2++) {
        if (r2 === c) continue;
        const f = M[r2][c] / M[c][c];
        for (let k = c; k < 4; k++) M[r2][k] -= f * M[c][k];
      }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  }

  // 롱스태프-슈워츠. 행사일마다 내가격 경로의 '앞으로 받을 돈'을 1, x, x² 로 회귀해 계속 보유 가치를 어림한다.
  function lsmc(sim, isPut, K0, irr, e0, start, end) {
    const S = sim.S, n = sim.n, M = sim.M, dt = sim.dt, r = sim.r;
    const cf = new Float64Array(n), at = new Int32Array(n).fill(-1);
    const kFrom = Math.max(0, Math.ceil(start / dt - 1e-9)), kTo = Math.min(M, Math.floor(end / dt + 1e-9));
    const strike = function (k) { return K0 * Math.pow(1 + irr, e0 + k * dt); };
    for (let k = kTo; k >= Math.max(1, kFrom); k--) {
      const K = strike(k), t = k * dt, b = k * n;
      const idx = [];
      let s00 = 0, s01 = 0, s02 = 0, s03 = 0, s04 = 0, y0 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < n; i++) {
        if (sim.ipo[i] <= t) continue;
        const s = S[b + i], pay = isPut ? K - s : s - K;
        if (pay <= 0) continue;
        idx.push(i);
        const x = s / K, y = at[i] >= 0 ? cf[i] * Math.exp(-r * (at[i] - k) * dt) : 0;
        const x2 = x * x;
        s00 += 1; s01 += x; s02 += x2; s03 += x2 * x; s04 += x2 * x2;
        y0 += y; y1 += y * x; y2 += y * x2;
      }
      if (idx.length === 0) continue;
      const beta = idx.length >= 6 ? solve3([s00, s01, s02, s01, s02, s03, s02, s03, s04], [y0, y1, y2]) : null;
      for (let m2 = 0; m2 < idx.length; m2++) {
        const i = idx[m2], s = S[b + i], pay = isPut ? K - s : s - K, x = s / K;
        const contv = beta ? beta[0] + beta[1] * x + beta[2] * x * x
          : (at[i] >= 0 ? cf[i] * Math.exp(-r * (at[i] - k) * dt) : 0);
        if (pay > contv) { cf[i] = pay; at[i] = k; }
      }
    }
    // 기준일(0)에 바로 행사할 수 있으면 즉시 행사와 비교
    let sum = 0, sumSq = 0, exercised = 0;
    const byYear = [];
    for (let i = 0; i < sim.nPairs; i++) {
      let pair = 0;
      for (let h = 0; h < 2; h++) {
        const j = 2 * i + h;
        if (at[j] >= 0) {
          pair += cf[j] * Math.exp(-r * at[j] * dt);
          exercised++;
          const yr = Math.floor(at[j] * dt + 1e-9);
          byYear[yr] = (byYear[yr] || 0) + 1;
        }
      }
      pair /= 2;
      sum += pair; sumSq += pair * pair;
    }
    const np = sim.nPairs;
    let value = sum / np;
    const se = np > 1 ? Math.sqrt(Math.max(0, sumSq / np - value * value) / (np - 1)) : 0;
    let now = false;
    if (kFrom === 0) {
      const pay0 = isPut ? strike(0) - S[0] : S[0] - strike(0);
      if (pay0 > value) { value = pay0; now = true; }
    }
    return { value: value, se: se, exerciseRate: now ? 1 : exercised / n, byYear: byYear, now: now,
             strikeStart: strike(kFrom), strikeEnd: strike(kTo) };
  }

  function percentileBands(sim, qs, sample) {
    const n = sim.n, take = Math.min(n, sample || 4000), out = qs.map(function () { return []; });
    const buf = new Float64Array(take);
    for (let k = 0; k <= sim.M; k++) {
      for (let i = 0; i < take; i++) buf[i] = sim.S[k * n + i];
      buf.sort();
      qs.forEach(function (qq, a) { out[a].push(buf[Math.min(take - 1, Math.floor(qq * (take - 1) + 0.5))]); });
    }
    return out;
  }

  function shareholderOptions(p) {
    const sim = simulatePaths(p);
    const e0 = p.elapsed || 0;
    const res = { M: sim.M, dt: sim.dt, n: sim.n };
    if (p.putOn) {
      const put = lsmc(sim, true, p.P0, p.putIrr, e0, p.putStart, p.putEnd);
      put.raw = put.value;
      put.value = put.raw * (1 - (p.pd || 0) * (1 - (p.recovery == null ? 1 : p.recovery)));
      res.put = put;
    }
    if (p.callOn) {
      const call = lsmc(sim, false, p.P0, p.callIrr, e0, p.callStart, p.callEnd);
      call.raw = call.value;
      call.value = call.raw * (p.callShare == null ? 1 : p.callShare);
      res.call = call;
    }
    if (p.bands) res.bands = percentileBands(sim, [0.05, 0.25, 0.5, 0.75, 0.95], p.bandSample);
    // 유럽형 확인값: 풋 행사일이 하나이고 상장·신용 조정이 없을 때 블랙-숄즈와 같아야 한다
    if (p.putOn) {
      const T = p.putEnd, K = p.P0 * Math.pow(1 + p.putIrr, e0 + T);
      res.bsPutAtEnd = bsGreeks(p.S0, K, T, cont(p.r), cont(p.q || 0), p.sigma, false).value;
    }
    return res;
  }

  // ------------------------------------------------------------ 3. DCF
  function lerp(a, b, k, n) { return n <= 1 ? b : a + (b - a) * k / (n - 1); }

  function dcfCore(p, wacc, g) {
    const n = p.years || 5, t = p.tax;
    const rows = [];
    let rev = p.rev0, pv = 0;
    for (let k = 1; k <= n; k++) {
      const gr = lerp(p.g1, p.g5, k - 1, n), mg = lerp(p.m1, p.m5, k - 1, n);
      const prev = rev;
      rev = prev * (1 + gr);
      const ebit = rev * mg, nopat = ebit * (1 - t), da = rev * p.da, capex = rev * p.capex;
      const dnwc = p.nwc * (rev - prev), fcff = nopat + da - capex - dnwc;
      const when = p.midYear ? k - 0.5 : k, df = 1 / Math.pow(1 + wacc, when);
      pv += fcff * df;
      rows.push({ k: k, growth: gr, margin: mg, rev: rev, ebit: ebit, nopat: nopat, da: da, capex: capex,
                  dnwc: dnwc, fcff: fcff, df: df, pv: fcff * df, ebitda: ebit + da });
    }
    const last = rows[n - 1], revT = last.rev * (1 + g);
    const ebitT = revT * last.margin, nopatT = ebitT * (1 - t);
    const daT = revT * p.da, capexT = revT * p.capex, dnwcT = p.nwc * (revT - last.rev);
    const fcffT = nopatT + daT - capexT - dnwcT;
    const tv = wacc > g ? fcffT / (wacc - g) : NaN;
    const tvWhen = p.midYear ? n - 0.5 : n, tvDf = 1 / Math.pow(1 + wacc, tvWhen);
    const pvTV = tv * tvDf, ev = pv + pvTV;
    const equity = ev + p.nonOp - p.netDebt;
    return { rows: rows, pvSum: pv, tv: tv, pvTV: pvTV, ev: ev, equity: equity, perShare: equity * (p.unit || 1) / p.shares,
             terminal: { rev: revT, ebit: ebitT, nopat: nopatT, da: daT, capex: capexT, dnwc: dnwcT, fcff: fcffT,
                         reinvest: capexT - daT + dnwcT } };
  }

  function waccOf(p) {
    const de = p.de, t = p.tax;
    const betaL = p.betaU * (1 + (1 - t) * de);
    const ke = p.rf + betaL * p.mrp + p.size + (p.alpha || 0);
    const kdAfter = p.kd * (1 - t), wd = de / (1 + de), we = 1 - wd;
    return { betaL: betaL, ke: ke, kdAfter: kdAfter, wd: wd, we: we, wacc: we * ke + wd * kdAfter };
  }

  function dcf(p) {
    const w = waccOf(p);
    const wacc = p.waccOverride > 0 ? p.waccOverride : w.wacc;
    const core = dcfCore(p, wacc, p.gT);
    const last = core.rows[core.rows.length - 1];
    const T = core.terminal;
    const rr = T.nopat > 0 ? T.reinvest / T.nopat : NaN;
    const impliedRoic = rr > 0 ? p.gT / rr : Infinity;
    const impliedExit = core.tv / last.ebitda;
    const tvShare = core.pvTV / core.ev;
    const waccs = [-0.01, -0.005, 0, 0.005, 0.01].map(function (x) { return wacc + x; });
    const gs = [-0.01, -0.005, 0, 0.005, 0.01].map(function (x) { return p.gT + x; });
    const grid = waccs.map(function (ww) {
      return gs.map(function (gg) { return ww > gg ? dcfCore(p, ww, gg).perShare : NaN; });
    });
    const flags = [];
    const add = function (level, title, body) { flags.push({ level: level, title: title, body: body }); };
    if (!(wacc > p.gT)) add('bad', '할인율이 영구성장률보다 낮습니다', '영구가치 공식의 분모가 0 이하라 값을 낼 수 없습니다.');
    if (w.ke < p.kd) add('bad', '자기자본비용이 세전 타인자본비용보다 낮습니다', '주주가 채권자보다 낮은 수익률을 요구한다는 뜻이라 입력을 다시 봐야 합니다.');
    if (tvShare > 0.75) add('warn', '영구가치 비중 ' + Math.round(tvShare * 100) + '%', '가치 대부분이 추정기간 이후에서 나옵니다. 추정기간을 늘리거나 장기 가정의 근거를 확인합니다.');
    if (p.gT > p.rf) add('warn', '영구성장률이 무위험이자율보다 높습니다', '경제 전체 성장률을 넘는 영구성장을 가정한 셈입니다.');
    if (isFinite(impliedRoic) && impliedRoic > 0.5) add('warn', '재투자가 너무 적습니다 (내재 투하자본수익률 ' + Math.round(impliedRoic * 100) + '%)', '영구성장률을 내려면 그만큼 투자가 필요합니다. 설비투자·운전자본 가정이 성장률과 맞는지 봅니다.');
    if (!isFinite(impliedRoic) && p.gT > 0) add('warn', '성장에 필요한 재투자가 없습니다', '영구기간 설비투자가 감가상각 이하이고 운전자본 증가도 없는데 성장을 가정했습니다.');
    if (isFinite(impliedRoic) && impliedRoic > 0 && impliedRoic < wacc && p.gT > 0) add('info', '성장이 가치를 깎습니다', '내재 투하자본수익률이 할인율보다 낮아 성장할수록 가치가 줄어듭니다.');
    if (p.peerLo > 0 && (impliedExit < p.peerLo || impliedExit > p.peerHi)) add('warn', '영구가치가 비교회사 배수 범위를 벗어납니다', '영구가치 ÷ 마지막 해 EBITDA = ' + impliedExit.toFixed(1) + '배, 비교회사 ' + p.peerLo + '~' + p.peerHi + '배.');
    if (p.m5 - p.m0 > 0.05) add('warn', '이익률이 ' + ((p.m5 - p.m0) * 100).toFixed(1) + '%p 개선된다고 가정했습니다', '과거 실적과 사업계획에서 개선 근거를 확인합니다.');
    if (wacc - p.gT < 0.03 && wacc > p.gT) add('info', '할인율과 영구성장률 차이가 3%p 미만', '분모가 작아 작은 가정 변화에도 결과가 크게 움직입니다.');
    return Object.assign(core, { wacc: wacc, w: w, tvShare: tvShare, impliedExit: impliedExit, impliedRoic: impliedRoic,
                                 reinvestRate: rr, sens: { waccs: waccs, gs: gs, grid: grid }, flags: flags });
  }

  // ------------------------------------------------------------ 4. 파생상품: 할인곡선, 이자율스왑, 통화선도, 통화옵션
  // 3개월 CD 금리와 이자율스왑 고정금리(분기 지급)로 할인계수를 분기마다 구한다.
  function bootstrap(curve) {
    const tenors = [0.25].concat(curve.tenors), rates = [curve.cd].concat(curve.rates);
    const last = tenors[tenors.length - 1], n = Math.round(last / 0.25);
    const t = [0], df = [1], par = [NaN];
    let annuity = 0;
    for (let k = 1; k <= n; k++) {
      const tk = k * 0.25;
      let s;
      if (tk <= tenors[0]) s = rates[0];
      else {
        let a = 0;
        while (a < tenors.length - 2 && tenors[a + 1] < tk - 1e-9) a++;
        const w = (tk - tenors[a]) / (tenors[a + 1] - tenors[a]);
        s = rates[a] + w * (rates[a + 1] - rates[a]);
      }
      const d = (1 - s * 0.25 * annuity) / (1 + s * 0.25);
      annuity += d;
      t.push(tk); df.push(d); par.push(s);
    }
    return { t: t, df: df, par: par };
  }

  // 할인계수 사이는 로그 선형 (구간 내 선도금리 일정). 곡선 끝 뒤는 마지막 구간 기울기로 연장.
  function dfAt(cv, x) {
    if (x <= 0) return 1;
    const t = cv.t, n = t.length;
    let k = Math.min(n - 1, Math.max(1, Math.ceil(x / 0.25 - 1e-12)));
    const t0 = t[k - 1], t1 = t[k], l0 = Math.log(cv.df[k - 1]), l1 = Math.log(cv.df[k]);
    return Math.exp(l0 + (l1 - l0) * (x - t0) / (t1 - t0));
  }

  function zeroRate(cv, x) { return -Math.log(dfAt(cv, x)) / x; }

  function shiftCurve(curve, bp) {
    return { cd: curve.cd + bp, tenors: curve.tenors, rates: curve.rates.map(function (r) { return r + bp; }) };
  }

  // 이자율스왑. 고정금리 지급·변동금리 수취(payFixed) 기준 가치.
  // 이번 이자 기간의 변동금리는 이미 정해졌다(fixing). 이후는 곡선의 선도금리.
  // 신용위험 조정(간편법): 받을 현금흐름은 거래상대방 스프레드, 줄 현금흐름은 자기 스프레드를 더해 할인한다.
  function irs(p, curve) {
    const cv = bootstrap(curve);
    const pay = [];
    for (let k = 0; ; k++) {
      const tk = p.stub + 0.25 * k;
      if (tk > p.T + 1e-9) break;
      pay.push(tk);
    }
    const sgn = p.payFixed ? 1 : -1;
    const rows = [];
    let pvFix = 0, pvFlt = 0, adj = 0;
    for (let k = 0; k < pay.length; k++) {
      const tk = pay[k], d = dfAt(cv, tk);
      const fwd = k === 0 ? p.fixing : (dfAt(cv, pay[k - 1]) / d - 1) / 0.25;
      const fix = p.notional * p.fixed * 0.25, flt = p.notional * fwd * 0.25;
      const net = sgn * (flt - fix);
      const spread = net >= 0 ? p.csCpty : p.csOwn;
      const dAdj = d * Math.exp(-cont(spread) * tk);
      pvFix += fix * d; pvFlt += flt * d; adj += net * dAdj;
      rows.push({ t: tk, df: d, fwd: fwd, fixed: fix, floating: flt, net: net, pv: net * d, pvAdj: net * dAdj });
    }
    const value = sgn * (pvFlt - pvFix);
    const annuity = pay.reduce(function (s, tk) { return s + 0.25 * dfAt(cv, tk); }, 0);
    // 같은 기간 신규 스왑의 공정 고정금리 (첫 기간 변동금리는 확정치 사용)
    const parRate = (p.fixing * 0.25 * dfAt(cv, pay[0]) + dfAt(cv, pay[0]) - dfAt(cv, pay[pay.length - 1])) / annuity;
    const valueAt = function (crv) {
      const c2 = bootstrap(crv);
      let a = 0, b = 0;
      for (let k = 0; k < pay.length; k++) {
        const d = dfAt(c2, pay[k]);
        const fwd = k === 0 ? p.fixing : (dfAt(c2, pay[k - 1]) / d - 1) / 0.25;
        a += p.notional * fwd * 0.25 * d; b += p.notional * p.fixed * 0.25 * d;
      }
      return sgn * (a - b);
    };
    const dv01 = valueAt(shiftCurve(curve, 0.0001)) - value;
    return { curve: cv, rows: rows, value: value, valueAdj: adj, creditAdj: adj - value, pvFixed: pvFix,
             pvFloat: pvFlt, parRate: parRate, dv01: dv01 };
  }

  // 통화선도. sellUsd 이면 달러를 정해진 환율에 파는 쪽(수출기업 환헤지).
  function fxForward(p, curve) {
    const cv = bootstrap(curve);
    const dK = dfAt(cv, p.T), dU = Math.exp(-cont(p.usdRate) * p.T);
    const fwd = p.spot * dU / dK;
    const sgn = p.sellUsd ? -1 : 1;
    const value = sgn * p.usd * (fwd - p.strike) * dK;
    const spread = value >= 0 ? p.csCpty : p.csOwn;
    const valueAdj = value * Math.exp(-cont(spread) * p.T);
    const at = function (spot) { return sgn * p.usd * (spot * dU / dK - p.strike) * dK; };
    return { fwd: fwd, points: fwd - p.spot, value: value, valueAdj: valueAdj, creditAdj: valueAdj - value,
             dfKrw: dK, dfUsd: dU, deltaPerWon: at(p.spot + 1) - value };
  }

  // 통화옵션 (가먼-콜하겐). 달러 1단위당 값에 수량을 곱한다.
  function fxOption(p, curve) {
    const cv = bootstrap(curve);
    const rK = zeroRate(cv, p.T), rU = cont(p.usdRate);
    const g = bsGreeks(p.spot, p.strike, p.T, rK, rU, p.vol, p.isCall);
    const sgn = p.long ? 1 : -1, N = p.usd * sgn;
    const intrinsic = Math.max(p.isCall ? p.spot - p.strike : p.strike - p.spot, 0);
    return { value: g.value * N, unit: g.value, delta: g.delta * N, gamma: g.gamma * N, vega: g.vega * N / 100,
             theta: g.theta * N / 365, rho: g.rho * N / 100, intrinsic: intrinsic * N, timeValue: (g.value - intrinsic) * N,
             rK: rK, rU: rU, fwd: p.spot * Math.exp((rK - rU) * p.T) };
  }

  // ------------------------------------------------------------ 5. XBRL 검토
  // 가상회사 재무제표 (단위 원, 백만원 단위로 반올림해 공시 = decimals -6).
  const XB = {
    company: '가상회사 C', unitLabel: '백만원',
    elements: [
      // [요소, 이름, 재무제표, 기간형, 음수 불가]
      ['ifrs-full_CashAndCashEquivalents', '현금및현금성자산', 'BS', 'instant', true],
      ['ifrs-full_TradeAndOtherCurrentReceivables', '매출채권및기타채권', 'BS', 'instant', true],
      ['ifrs-full_Inventories', '재고자산', 'BS', 'instant', true],
      ['ifrs-full_OtherCurrentAssets', '기타유동자산', 'BS', 'instant', true],
      ['ifrs-full_CurrentAssets', '유동자산', 'BS', 'instant', true],
      ['ifrs-full_PropertyPlantAndEquipment', '유형자산', 'BS', 'instant', true],
      ['ifrs-full_IntangibleAssetsOtherThanGoodwill', '무형자산', 'BS', 'instant', true],
      ['ifrs-full_OtherNoncurrentAssets', '기타비유동자산', 'BS', 'instant', true],
      ['ifrs-full_NoncurrentAssets', '비유동자산', 'BS', 'instant', true],
      ['ifrs-full_Assets', '자산총계', 'BS', 'instant', true],
      ['ifrs-full_TradeAndOtherCurrentPayables', '매입채무및기타채무', 'BS', 'instant', true],
      ['ifrs-full_ShorttermBorrowings', '단기차입금', 'BS', 'instant', true],
      ['ifrs-full_OtherCurrentLiabilities', '기타유동부채', 'BS', 'instant', true],
      ['ifrs-full_CurrentLiabilities', '유동부채', 'BS', 'instant', true],
      ['ifrs-full_LongtermBorrowings', '장기차입금', 'BS', 'instant', true],
      ['ifrs-full_OtherNoncurrentLiabilities', '기타비유동부채', 'BS', 'instant', true],
      ['ifrs-full_NoncurrentLiabilities', '비유동부채', 'BS', 'instant', true],
      ['ifrs-full_Liabilities', '부채총계', 'BS', 'instant', true],
      ['ifrs-full_IssuedCapital', '자본금', 'BS', 'instant', true],
      ['ifrs-full_SharePremium', '자본잉여금', 'BS', 'instant', true],
      ['ifrs-full_RetainedEarnings', '이익잉여금', 'BS', 'instant', false],
      ['ifrs-full_OtherReserves', '기타자본구성요소', 'BS', 'instant', false],
      ['ifrs-full_Equity', '자본총계', 'BS', 'instant', false],
      ['ifrs-full_EquityAndLiabilities', '부채와자본총계', 'BS', 'instant', true],
      ['ifrs-full_Revenue', '매출액', 'IS', 'duration', true],
      ['ifrs-full_CostOfSales', '매출원가', 'IS', 'duration', true],
      ['ifrs-full_GrossProfit', '매출총이익', 'IS', 'duration', false],
      ['ifrs-full_SellingGeneralAndAdministrativeExpense', '판매비와관리비', 'IS', 'duration', true],
      ['dart_OperatingIncomeLoss', '영업이익', 'IS', 'duration', false],
      ['ifrs-full_OtherIncome', '기타수익', 'IS', 'duration', true],
      ['ifrs-full_OtherExpenseByFunction', '기타비용', 'IS', 'duration', true],
      ['ifrs-full_FinanceIncome', '금융수익', 'IS', 'duration', true],
      ['ifrs-full_FinanceCosts', '금융비용', 'IS', 'duration', true],
      ['ifrs-full_ProfitLossBeforeTax', '법인세비용차감전순이익', 'IS', 'duration', false],
      ['ifrs-full_IncomeTaxExpenseContinuingOperations', '법인세비용', 'IS', 'duration', false],
      ['ifrs-full_ProfitLoss', '당기순이익', 'IS', 'duration', false],
      ['ifrs-full_CashFlowsFromUsedInOperatingActivities', '영업활동현금흐름', 'CF', 'duration', false],
      ['ifrs-full_CashFlowsFromUsedInInvestingActivities', '투자활동현금흐름', 'CF', 'duration', false],
      ['ifrs-full_DividendsPaidClassifiedAsFinancingActivities', '배당금 지급', 'CF', 'duration', true],
      ['ifrs-full_CashFlowsFromUsedInFinancingActivities', '재무활동현금흐름', 'CF', 'duration', false],
      ['ifrs-full_IncreaseDecreaseInCashAndCashEquivalents', '현금및현금성자산의 증감', 'CF', 'duration', false],
    ],
    // 백만원. [당기, 전기]. 현금흐름표는 당기만.
    values: {
      'ifrs-full_CashAndCashEquivalents': [18420, 15310],
      'ifrs-full_TradeAndOtherCurrentReceivables': [24860, 22140],
      'ifrs-full_Inventories': [19530, 18020],
      'ifrs-full_OtherCurrentAssets': [2190, 1980],
      'ifrs-full_CurrentAssets': [65000, 57450],
      'ifrs-full_PropertyPlantAndEquipment': [71240, 68900],
      'ifrs-full_IntangibleAssetsOtherThanGoodwill': [6380, 6010],
      'ifrs-full_OtherNoncurrentAssets': [4880, 4640],
      'ifrs-full_NoncurrentAssets': [82500, 79550],
      'ifrs-full_Assets': [147500, 137000],
      'ifrs-full_TradeAndOtherCurrentPayables': [17640, 16230],
      'ifrs-full_ShorttermBorrowings': [12000, 14500],
      'ifrs-full_OtherCurrentLiabilities': [5360, 4770],
      'ifrs-full_CurrentLiabilities': [35000, 35500],
      'ifrs-full_LongtermBorrowings': [21000, 22000],
      'ifrs-full_OtherNoncurrentLiabilities': [3500, 3300],
      'ifrs-full_NoncurrentLiabilities': [24500, 25300],
      'ifrs-full_Liabilities': [59500, 60800],
      'ifrs-full_IssuedCapital': [10000, 10000],
      'ifrs-full_SharePremium': [22000, 22000],
      'ifrs-full_RetainedEarnings': [54800, 43000],
      'ifrs-full_OtherReserves': [1200, 1200],
      'ifrs-full_Equity': [88000, 76200],
      'ifrs-full_EquityAndLiabilities': [147500, 137000],
      'ifrs-full_Revenue': [182000, 168500],
      'ifrs-full_CostOfSales': [138320, 129745],
      'ifrs-full_GrossProfit': [43680, 38755],
      'ifrs-full_SellingGeneralAndAdministrativeExpense': [25480, 23590],
      'dart_OperatingIncomeLoss': [18200, 15165],
      'ifrs-full_OtherIncome': [1150, 980],
      'ifrs-full_OtherExpenseByFunction': [760, 820],
      'ifrs-full_FinanceIncome': [640, 510],
      'ifrs-full_FinanceCosts': [2030, 2235],
      'ifrs-full_ProfitLossBeforeTax': [17200, 13600],
      'ifrs-full_IncomeTaxExpenseContinuingOperations': [3900, 3050],
      'ifrs-full_ProfitLoss': [13300, 10550],
      'ifrs-full_CashFlowsFromUsedInOperatingActivities': [19860, null],
      'ifrs-full_CashFlowsFromUsedInInvestingActivities': [-11450, null],
      'ifrs-full_DividendsPaidClassifiedAsFinancingActivities': [1500, null],
      'ifrs-full_CashFlowsFromUsedInFinancingActivities': [-5300, null],
      'ifrs-full_IncreaseDecreaseInCashAndCashEquivalents': [3110, null],
    },
    // 작년 사업보고서에 공시했던 전기 금액
    filedPrior: { 'ifrs-full_Revenue': 168500, 'ifrs-full_ProfitLoss': 10550, 'ifrs-full_Assets': 137000,
                  'ifrs-full_CostOfSales': 129745, 'ifrs-full_Equity': 76200 },
    calc: [
      ['ifrs-full_CurrentAssets', [['ifrs-full_CashAndCashEquivalents', 1], ['ifrs-full_TradeAndOtherCurrentReceivables', 1], ['ifrs-full_Inventories', 1], ['ifrs-full_OtherCurrentAssets', 1]]],
      ['ifrs-full_NoncurrentAssets', [['ifrs-full_PropertyPlantAndEquipment', 1], ['ifrs-full_IntangibleAssetsOtherThanGoodwill', 1], ['ifrs-full_OtherNoncurrentAssets', 1]]],
      ['ifrs-full_Assets', [['ifrs-full_CurrentAssets', 1], ['ifrs-full_NoncurrentAssets', 1]]],
      ['ifrs-full_CurrentLiabilities', [['ifrs-full_TradeAndOtherCurrentPayables', 1], ['ifrs-full_ShorttermBorrowings', 1], ['ifrs-full_OtherCurrentLiabilities', 1]]],
      ['ifrs-full_NoncurrentLiabilities', [['ifrs-full_LongtermBorrowings', 1], ['ifrs-full_OtherNoncurrentLiabilities', 1]]],
      ['ifrs-full_Liabilities', [['ifrs-full_CurrentLiabilities', 1], ['ifrs-full_NoncurrentLiabilities', 1]]],
      ['ifrs-full_Equity', [['ifrs-full_IssuedCapital', 1], ['ifrs-full_SharePremium', 1], ['ifrs-full_RetainedEarnings', 1], ['ifrs-full_OtherReserves', 1]]],
      ['ifrs-full_EquityAndLiabilities', [['ifrs-full_Liabilities', 1], ['ifrs-full_Equity', 1]]],
      ['ifrs-full_GrossProfit', [['ifrs-full_Revenue', 1], ['ifrs-full_CostOfSales', -1]]],
      ['dart_OperatingIncomeLoss', [['ifrs-full_GrossProfit', 1], ['ifrs-full_SellingGeneralAndAdministrativeExpense', -1]]],
      ['ifrs-full_ProfitLossBeforeTax', [['dart_OperatingIncomeLoss', 1], ['ifrs-full_OtherIncome', 1], ['ifrs-full_OtherExpenseByFunction', -1], ['ifrs-full_FinanceIncome', 1], ['ifrs-full_FinanceCosts', -1]]],
      ['ifrs-full_ProfitLoss', [['ifrs-full_ProfitLossBeforeTax', 1], ['ifrs-full_IncomeTaxExpenseContinuingOperations', -1]]],
      ['ifrs-full_IncreaseDecreaseInCashAndCashEquivalents', [['ifrs-full_CashFlowsFromUsedInOperatingActivities', 1], ['ifrs-full_CashFlowsFromUsedInInvestingActivities', 1], ['ifrs-full_CashFlowsFromUsedInFinancingActivities', 1]]],
    ],
    standardFor: { entity00999999_TradeReceivablesNet: 'ifrs-full_TradeAndOtherCurrentReceivables' },
    scenarios: [
      { id: 'sign', name: '부호 오류', desc: '매출원가를 음수로 입력', expect: ['계산 관계', '부호'] },
      { id: 'unit', name: '단위 착오', desc: '기타유동자산을 원 단위로 착각해 2,190원으로 입력', expect: ['계산 관계', '단위·정밀도'] },
      { id: 'omit', name: '합계 누락', desc: '비유동자산 합계에서 기타비유동자산을 빠뜨림', expect: ['계산 관계'] },
      { id: 'cash', name: '현금 증감 오류', desc: '현금흐름표의 현금 증감을 3,290으로 입력', expect: ['계산 관계', '재무제표 간 연계'] },
      { id: 'dup', name: '중복 값 불일치', desc: '현금흐름표 출발점 당기순이익을 13,030으로 따로 입력', expect: ['중복 사실값'] },
      { id: 'prior', name: '전기 금액 불일치', desc: '비교 표시 전기 매출을 168,050으로 입력', expect: ['계산 관계', '전기 금액'] },
      { id: 'ext', name: '불필요한 확장 요소', desc: '매출채권을 회사 자체 요소로 태깅', expect: ['요소 선택'] },
      { id: 'ctx', name: '기간 맥락 오류', desc: '재고자산(시점 항목)에 기간 맥락을 씀', expect: ['기간 맥락'] },
    ],
  };

  // 오류를 골라 넣은 사실값 목록을 만든다. 값은 원 단위.
  function xbrlFacts(errs) {
    errs = errs || {};
    const M = 1e6, facts = [];
    XB.elements.forEach(function (row) {
      const el = row[0], v = XB.values[el];
      [0, 1].forEach(function (pi) {
        if (v[pi] == null) return;
        facts.push({ el: el, period: pi === 0 ? 'CY' : 'PY', type: row[3], value: v[pi] * M, decimals: -6 });
      });
    });
    const find = function (el, period) {
      return facts.filter(function (f) { return f.el === el && f.period === period; })[0];
    };
    if (errs.sign) find('ifrs-full_CostOfSales', 'CY').value = -138320 * M;
    if (errs.unit) find('ifrs-full_OtherCurrentAssets', 'CY').value = 2190;
    if (errs.omit) find('ifrs-full_NoncurrentAssets', 'CY').value = (71240 + 6380) * M;
    if (errs.cash) find('ifrs-full_IncreaseDecreaseInCashAndCashEquivalents', 'CY').value = 3290 * M;
    if (errs.dup) facts.push({ el: 'ifrs-full_ProfitLoss', period: 'CY', type: 'duration', value: 13030 * M, decimals: -6, dupOf: 'CF' });
    if (errs.prior) find('ifrs-full_Revenue', 'PY').value = 168050 * M;
    if (errs.ext) facts.forEach(function (f) { if (f.el === 'ifrs-full_TradeAndOtherCurrentReceivables' && f.period === 'CY') f.el = 'entity00999999_TradeReceivablesNet'; });
    if (errs.ctx) find('ifrs-full_Inventories', 'CY').type = 'duration';
    return facts;
  }

  function xbrlCheck(facts) {
    const M = 1e6, issues = [];
    const label = {}, meta = {};
    XB.elements.forEach(function (r) { label[r[0]] = r[1]; meta[r[0]] = { stmt: r[2], type: r[3], nonneg: r[4] }; });
    label.entity00999999_TradeReceivablesNet = '매출채권(회사 확장 요소)';
    meta.entity00999999_TradeReceivablesNet = { stmt: 'BS', type: 'instant', nonneg: true };
    const pname = { CY: '당기', PY: '전기' };
    const by = {};
    facts.forEach(function (f, i) { const k = f.el + '|' + f.period; (by[k] = by[k] || []).push(i); });
    const val = function (el, period) {
      let ids = by[el + '|' + period];
      if (!ids && XB.standardFor) {
        Object.keys(XB.standardFor).forEach(function (ext) {
          if (XB.standardFor[ext] === el && by[ext + '|' + period]) ids = by[ext + '|' + period];
        });
      }
      return ids ? facts[ids[0]] : null;
    };
    const keyOf = function (f) { return f.el + '|' + f.period; };
    const fmt = function (x) { return (x / M).toLocaleString('ko-KR', { maximumFractionDigits: 3 }); };
    const round6 = function (x) { return Math.round(x / M) * M; };
    const add = function (level, rule, where, msg, fix, cells) {
      issues.push({ level: level, rule: rule, where: where, msg: msg, fix: fix, cells: cells || [] });
    };
    // 1) 계산 관계: 부모 = 자식 × 가중치의 합 (decimals -6 에 맞춰 반올림해 비교)
    XB.calc.forEach(function (rel) {
      ['CY', 'PY'].forEach(function (pp) {
        const parent = val(rel[0], pp);
        if (!parent) return;
        let sum = 0, cells = [keyOf(parent)], ok = true;
        rel[1].forEach(function (c) {
          const f = val(c[0], pp);
          if (!f) { ok = false; return; }
          sum += c[1] * round6(f.value); cells.push(keyOf(f));
        });
        if (!ok) return;
        const diff = round6(parent.value) - sum;
        if (Math.abs(diff) >= 0.5 * M) {
          add('bad', '계산 관계', label[rel[0]] + ' (' + pname[pp] + ')',
              '보고값 ' + fmt(parent.value) + ' ≠ 하위 항목 합계 ' + fmt(sum) + ' (차이 ' + fmt(diff) + ')',
              '하위 항목 값이나 부호, 합계 금액을 원본 재무제표와 대사합니다.', cells);
        }
      });
    });
    // 2) 부호
    facts.forEach(function (f) {
      const m = meta[f.el];
      if (m && m.nonneg && f.value < 0) {
        add('bad', '부호', label[f.el] + ' (' + pname[f.period] + ')', '음수가 들어갈 수 없는 요소에 ' + fmt(f.value) + '이 입력되었습니다.',
            '비용은 양수로 입력하고 계산 관계의 가중치(-1)로 빼야 합니다.', [keyOf(f)]);
      }
    });
    // 3) 단위·정밀도: decimals -6 인데 백만 원보다 작은 값
    facts.forEach(function (f) {
      if (f.decimals === -6 && f.value !== 0 && Math.abs(f.value) < M) {
        add('bad', '단위·정밀도', label[f.el] + ' (' + pname[f.period] + ')',
            '정밀도가 백만 원(decimals=-6)인데 값이 ' + f.value.toLocaleString('ko-KR') + '원입니다. 백만원 단위 숫자를 원 단위 자리에 넣은 것으로 보입니다.',
            '원 단위로 환산해 ' + (f.value * M).toLocaleString('ko-KR') + '원으로 입력합니다.', [keyOf(f)]);
      }
    });
    // 4) 기간 맥락
    facts.forEach(function (f) {
      const m = meta[f.el];
      if (m && m.type !== f.type) {
        add('bad', '기간 맥락', label[f.el] + ' (' + pname[f.period] + ')',
            m.type === 'instant' ? '보고기간 말 시점 요소에 기간 맥락이 쓰였습니다.' : '기간 요소에 시점 맥락이 쓰였습니다.',
            '재무상태표 항목은 시점 맥락, 손익·현금흐름 항목은 기간 맥락을 씁니다.', [keyOf(f)]);
      }
    });
    // 5) 중복 사실값: 같은 요소·같은 맥락에 다른 값
    Object.keys(by).forEach(function (k) {
      const ids = by[k];
      if (ids.length < 2) return;
      const vals = ids.map(function (i) { return round6(facts[i].value); });
      if (vals.some(function (v) { return v !== vals[0]; })) {
        const f = facts[ids[0]];
        add('bad', '중복 사실값', label[f.el] + ' (' + pname[f.period] + ')',
            '같은 요소·같은 맥락에 값이 ' + vals.map(fmt).join(', ') + '으로 다르게 들어 있습니다. 손익계산서와 현금흐름표가 같은 사실값을 써야 합니다.',
            '한 값으로 통일합니다. 현금흐름표 출발점 당기순이익은 손익계산서 값과 같아야 합니다.', [k]);
      }
    });
    // 6) 재무제표 간 연계
    ['CY', 'PY'].forEach(function (pp) {
      const a = val('ifrs-full_Assets', pp), b = val('ifrs-full_EquityAndLiabilities', pp);
      if (a && b && round6(a.value) !== round6(b.value)) {
        add('bad', '재무제표 간 연계', '자산총계와 부채와자본총계 (' + pname[pp] + ')', fmt(a.value) + ' ≠ ' + fmt(b.value), '재무상태표 합계를 원본과 대사합니다.', [keyOf(a), keyOf(b)]);
      }
    });
    const c1 = val('ifrs-full_CashAndCashEquivalents', 'CY'), c0 = val('ifrs-full_CashAndCashEquivalents', 'PY');
    const inc = val('ifrs-full_IncreaseDecreaseInCashAndCashEquivalents', 'CY');
    if (c1 && c0 && inc && round6(c0.value) + round6(inc.value) !== round6(c1.value)) {
      add('bad', '재무제표 간 연계', '기초 현금 + 증감 ≠ 기말 현금',
          fmt(c0.value) + ' + ' + fmt(inc.value) + ' = ' + fmt(c0.value + inc.value) + ', 재무상태표 기말 현금 ' + fmt(c1.value),
          '현금흐름표 증감액과 재무상태표 현금을 맞춥니다.', [keyOf(c0), keyOf(inc), keyOf(c1)]);
    }
    const re1 = val('ifrs-full_RetainedEarnings', 'CY'), re0 = val('ifrs-full_RetainedEarnings', 'PY');
    const ni = val('ifrs-full_ProfitLoss', 'CY'), dv = val('ifrs-full_DividendsPaidClassifiedAsFinancingActivities', 'CY');
    if (re1 && re0 && ni && dv && round6(re0.value) + round6(ni.value) - round6(dv.value) !== round6(re1.value)) {
      add('warn', '재무제표 간 연계', '이익잉여금 변동',
          '전기말 ' + fmt(re0.value) + ' + 당기순이익 ' + fmt(ni.value) + ' - 배당 ' + fmt(dv.value) + ' ≠ 당기말 ' + fmt(re1.value),
          '자본변동표의 다른 변동 요인(재측정 등)이 있는지 확인합니다.', [keyOf(re0), keyOf(ni), keyOf(dv), keyOf(re1)]);
    }
    // 7) 전기 금액: 작년 공시값과 비교
    Object.keys(XB.filedPrior).forEach(function (el) {
      const f = val(el, 'PY');
      if (f && round6(f.value) !== XB.filedPrior[el] * M) {
        add('warn', '전기 금액', label[el] + ' (전기)',
            '이번 공시 비교 금액 ' + fmt(f.value) + ', 작년 공시 ' + XB.filedPrior[el].toLocaleString('ko-KR'),
            '재작성(회계정책 변경·오류 수정)이면 주석 공시를 확인하고, 아니면 입력 오류를 고칩니다.', [keyOf(f)]);
      }
    });
    // 8) 요소 선택: 표준 요소가 있는데 확장 요소를 씀
    facts.forEach(function (f) {
      if (XB.standardFor[f.el]) {
        add('warn', '요소 선택', label[f.el],
            '회사 확장 요소 ' + f.el + ' 를 썼지만 같은 뜻의 표준 요소 ' + XB.standardFor[f.el] + ' 가 있습니다.',
            '표준 요소로 바꿔야 다른 회사와 비교·집계가 됩니다.', [keyOf(f)]);
      }
    });
    return { issues: issues, label: label, meta: meta };
  }

  function xbrlXml(f) {
    const pre = f.el.indexOf('ifrs-full_') === 0 ? 'ifrs-full' : f.el.indexOf('dart_') === 0 ? 'dart' : f.el.split('_')[0];
    const name = f.el.slice(pre.length + 1);
    const yr = f.period === 'CY' ? 'CFY2025' : 'PFY2024';
    const ctx = yr + (f.type === 'instant' ? 'eFY' : 'dFY');
    return '<' + pre + ':' + name + ' contextRef="' + ctx + '" unitRef="KRW" decimals="' + f.decimals + '">' +
      Math.round(f.value) + '</' + pre + ':' + name + '>';
  }

  return {
    normCdf: normCdf, normPdf: normPdf, cont: cont, mulberry32: mulberry32, normalSource: normalSource, bisect: bisect,
    bsGreeks: bsGreeks, crrOption: crrOption,
    redemptionAmount: redemptionAmount, ACT: ACT, convertible: convertible, convertibleReport: convertibleReport,
    simulatePaths: simulatePaths, lsmc: lsmc, shareholderOptions: shareholderOptions,
    waccOf: waccOf, dcfCore: dcfCore, dcf: dcf,
    bootstrap: bootstrap, dfAt: dfAt, zeroRate: zeroRate, irs: irs, fxForward: fxForward, fxOption: fxOption,
    XB: XB, xbrlFacts: xbrlFacts, xbrlCheck: xbrlCheck, xbrlXml: xbrlXml,
  };
}));
