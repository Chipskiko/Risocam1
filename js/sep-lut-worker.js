// SEP-LUT WORKER — forward-model-inverting separation LUT bake.
//
// For each RGB grid point, finds ink weights w ∈ [0,1]^k that minimize the
// OKLab error of the app's ACTUAL compositing chain (replicated below from
// the shader's calBlend, mean-field form) — instead of the shader NNLS's
// linear approximation. Output: N×N×N grid of vec4 weights, consumed as a
// 2D-packed LUT texture by the shader and directly by CPU separations
// (flat/RISO projection, stipple luma) for true multi-ink accuracy.
//
// See docs/SEP-LUT-PLAN.md for the wiring plan, invalidation, and the
// round-trip harness protocol (baseline to beat: mean OKLab ΔE·100 = 14.75
// on the 24-patch target, CMYK inks, Blank/Pure-White paper).
//
// Classic-script worker (blob-loaded, CSP-safe — same pattern as riso-amt).

'use strict';

// ── Forward model: mean-field replica of shader calBlend (index.html) ──
// Per plate, in layer order, starting from paper:
//   d        = c · inkOpacity · mix(dotMin, 1, c)   (grain/riso; screen: d = c)
//   ink      = mix(p100, lutBlend(c), smoothstep(0.3, 0.7, c))
//   transp   = ( sqrt(prev) · sqrt(max(ink, .05))^d )²          (Beer-Lambert, YN n=2)
//   if transparentInk: blended = transp
//   else: blended = mix(transp, mix(prev, ink, d), smoothstep(0.3,0.85,d)·opacityCap)
//   (contamination term is u_simNoise-scaled — 0 in clean/mean field; omitted)
function lutBlend(c, paper, P) {
  // Piecewise-linear through paper, p10, p30, p50, p70, p100 (P = [[r,g,b]×5])
  const K = [[0, paper], [0.10, P[0]], [0.30, P[1]], [0.50, P[2]], [0.70, P[3]], [1.0, P[4]]];
  for (let i = 1; i < K.length; i++) {
    if (c <= K[i][0]) {
      const t = (c - K[i-1][0]) / (K[i][0] - K[i-1][0]);
      const a = K[i-1][1], b = K[i][1];
      return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
    }
  }
  return P[4];
}
const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x-e0)/(e1-e0))); return t*t*(3-2*t); };

function forward(w, inks, paper, opts) {
  // w: weights per ink (coverage 0..1); inks: [{P:[p10,p30,p50,p70,p100], transparent}]
  const dotMin = opts.dotMin ?? 0.25, inkOp = opts.inkOpacity ?? 1.0, opCap = opts.opacityCap ?? 1.0;
  const meanField = opts.meanField !== false;   // d = c (grain averages to coverage)
  let r = paper[0], g = paper[1], b = paper[2];
  for (let i = 0; i < inks.length; i++) {
    const c = w[i];
    if (c < 0.001) continue;
    let d = c * inkOp;
    if (!meanField) d *= dotMin + (1 - dotMin) * c;
    const lm = smoothstep(0.3, 0.7, c);
    const L = lutBlend(c, paper, inks[i].P);
    const ink = [
      inks[i].P[4][0] + (L[0] - inks[i].P[4][0]) * lm,
      inks[i].P[4][1] + (L[1] - inks[i].P[4][1]) * lm,
      inks[i].P[4][2] + (L[2] - inks[i].P[4][2]) * lm,
    ];
    // Beer-Lambert YN n=2: transp = prev · ink^d  (in sqrt space, squared back)
    const tr = [0, 0, 0];
    const prev = [r, g, b];
    for (let ch = 0; ch < 3; ch++) {
      const si = Math.sqrt(Math.max(ink[ch], 0.05));
      const sp = Math.sqrt(Math.max(prev[ch], 0.001));
      const y = sp * Math.pow(si, d);
      tr[ch] = y * y;
    }
    if (inks[i].transparent) { r = tr[0]; g = tr[1]; b = tr[2]; }
    else {
      const op = smoothstep(0.3, 0.85, d) * opCap;
      for (let ch = 0; ch < 3; ch++) {
        const opq = prev[ch] + (ink[ch] - prev[ch]) * d;
        tr[ch] = tr[ch] + (opq - tr[ch]) * op;
      }
      r = tr[0]; g = tr[1]; b = tr[2];
    }
  }
  return [r, g, b];
}

// ── OKLab (inputs are LINEAR-light 0..1; callers convert from sRGB once) ──
function lin2oklab(r, g, b) {
  const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
  const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
  const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
  return [0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
          1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
          0.0259040371*l + 0.7827717662*m - 0.8086757660*s];
}
const srgb2lin = v => v <= 0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);

// NOTE: the forward model runs in the shader's working space (sRGB-encoded
// values, same as calBlend which never linearizes). Error is measured by
// linearizing the forward OUTPUT and target identically — consistent metric.
function dE2(rgbA, rgbB) {
  const A = lin2oklab(srgb2lin(rgbA[0]), srgb2lin(rgbA[1]), srgb2lin(rgbA[2]));
  const B = lin2oklab(srgb2lin(rgbB[0]), srgb2lin(rgbB[1]), srgb2lin(rgbB[2]));
  return (A[0]-B[0])**2 + (A[1]-B[1])**2 + (A[2]-B[2])**2;
}

// ── Solver: projected coordinate descent with shrinking step + multistart ──
function solve(target, inks, paper, opts) {
  const k = inks.length;
  const starts = [new Array(k).fill(0)];
  // Greedy start: single best ink at its best coverage (coarse scan)
  let bg = null, bgE = Infinity;
  for (let i = 0; i < k; i++) for (let c = 0.25; c <= 1.001; c += 0.25) {
    const w = new Array(k).fill(0); w[i] = c;
    const e = dE2(forward(w, inks, paper, opts), target);
    if (e < bgE) { bgE = e; bg = w; }
  }
  if (bg) starts.push(bg);
  let best = null, bestE = Infinity;
  for (const s0 of starts) {
    const w = s0.slice();
    let e = dE2(forward(w, inks, paper, opts), target);
    let step = 0.25;
    while (step > 0.004) {
      let improved = false;
      for (let i = 0; i < k; i++) {
        for (const dir of [1, -1]) {
          const nv = Math.min(1, Math.max(0, w[i] + dir * step));
          if (nv === w[i]) continue;
          const old = w[i]; w[i] = nv;
          const ne = dE2(forward(w, inks, paper, opts), target);
          if (ne < e - 1e-9) { e = ne; improved = true; }
          else w[i] = old;
        }
      }
      if (!improved) step *= 0.5;
    }
    if (e < bestE) { bestE = e; best = w; }
  }
  return { w: best, dE: Math.sqrt(bestE) * 100 };
}

// ── Bake: N³ grid over sRGB-encoded target space ──
function bake(msg) {
  const { N, paper, inks, opts } = msg;
  const out = new Float32Array(N * N * N * 4);
  const errs = new Float32Array(N * N * N);
  let idx = 0;
  for (let bi = 0; bi < N; bi++) for (let gi = 0; gi < N; gi++) for (let ri = 0; ri < N; ri++) {
    const target = [ri/(N-1), gi/(N-1), bi/(N-1)];
    const { w, dE } = solve(target, inks, paper, opts || {});
    for (let i = 0; i < 4; i++) out[idx*4 + i] = i < w.length ? w[i] : 0;
    errs[idx] = dE;
    idx++;
    if ((idx & 1023) === 0) self.postMessage({ progress: idx / (N*N*N) });
  }
  return { weights: out, errs, N };
}

self.onmessage = e => {
  const m = e.data;
  if (m.cmd === 'bake') {
    const t0 = Date.now();
    const res = bake(m);
    self.postMessage({ done: true, weights: res.weights.buffer, errs: res.errs.buffer,
                       N: res.N, ms: Date.now() - t0, seq: m.seq },
                     [res.weights.buffer, res.errs.buffer]);
  } else if (m.cmd === 'solveOne') {   // debug/harness: single target
    self.postMessage({ one: solve(m.target, m.inks, m.paper, m.opts || {}), seq: m.seq });
  }
};
