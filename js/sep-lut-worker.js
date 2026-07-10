// SEP-LUT WORKER — forward-model-inverting separation LUT bake.
//
// For each RGB grid point, finds ink weights w ∈ [0,1]^k that minimize the
// OKLab error of the app's ACTUAL compositing chain (replicated below from
// the shader's getCoverage + calBlend) — instead of the shader NNLS's
// linear approximation. Output: N×N×N grid of vec4 weights, consumed as a
// 2D-packed LUT texture by the shader and directly by CPU separations.
//
// v3 — rebuilt after the adversarial model review + live validation
// (docs/SEP-LUT-PLAN.md). Confirmed corrections over v2:
//  • covOf(): the full weight→coverage tone chain — dens·0.01 BEFORE the
//    per-ink gamma, unconditional S-curve (mix 0.15), positional dot gain
//    (inkAbsorb = mix(0.9,1.2,slot/3)), cross-layer depletion
//    (×(1−layerDeplete·slot·simNoise)), sqrt absorption softening (mix 0.08).
//    LAYER POSITION (slot) is physics here, not bookkeeping.
//  • lutBlend is Fritsch-Carlson monotone cubic Hermite (exact GLSL
//    replica), not piecewise-linear.
//  • Composite: binary-area grain mix with the opaque crossfade INSIDE the
//    covered fraction driven by per-dot density d1 (not by area, and never
//    tinting uncovered paper).
//  • opts defaults match the LIVE shader sliders (dotMin .15, inkOpacity
//    .88, opacityCap .45); the bake site passes the actual cached values.
//  • Plates composite in SLOT order (the shader's layer loop order);
//    ink entries carry their slot for the positional terms.
//
// Classic-script worker (blob-loaded, CSP-safe — same pattern as riso-amt).

'use strict';

const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x-e0)/(e1-e0))); return t*t*(3-2*t); };

// ── Fritsch-Carlson monotone cubic through the 6 measured knots ──
// Exact replica of the shader's monoTangent/cubicHermite/lutBlend.
const LUT_X = [0.0, 0.10, 0.30, 0.50, 0.70, 1.00];
function monoTan(s0, s1, h0, h1) {
  if (s0 * s1 <= 0) return 0;
  return 3 * (h0 + h1) / ((2*h1 + h0) / s0 + (h0 + 2*h1) / s1);
}
function lutBlendCubic(d, paper, P) {
  d = Math.min(1, Math.max(0, d));
  const V = [paper, P[0], P[1], P[2], P[3], P[4]];   // knot values
  let seg = 4;
  for (let i = 1; i < 6; i++) { if (d < LUT_X[i]) { seg = i - 1; break; } }
  const h = LUT_X[seg+1] - LUT_X[seg];
  const t = (d - LUT_X[seg]) / h;
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    // tangents at the segment's two knots (endpoint rules match GLSL)
    const slope = i => (V[i+1][c] - V[i][c]) / (LUT_X[i+1] - LUT_X[i]);
    const tanAt = i => i === 0 ? slope(0)
                   : i === 5 ? slope(4)
                   : monoTan(slope(i-1), slope(i), LUT_X[i]-LUT_X[i-1], LUT_X[i+1]-LUT_X[i]);
    const m0 = tanAt(seg), m1 = tanAt(seg+1);
    const t2 = t*t, t3 = t2*t;
    out[c] = (2*t3 - 3*t2 + 1) * V[seg][c] + (t3 - 2*t2 + t) * h * m0
           + (-2*t3 + 3*t2) * V[seg+1][c] + (t3 - t2) * h * m1;
  }
  return out;
}

// ── weight → printed coverage (shader getCoverage, mean-field terms) ──
// ink: {gamma, dens (0..100), slot (0..3)}
function covOf(w, ink, opts) {
  let v = Math.min(1, Math.max(0, w)) * (ink.dens ?? 100) * 0.01;
  if (v <= 0) return 0;
  const gam = ink.gamma ?? 1.0;
  v = Math.pow(Math.min(1, v), gam + (1 - gam) * 0.45);
  // S-curve (unconditional in the shader)
  v = v + 0.15 * (v * v * (3 - 2 * v) - v);
  // Positional dot gain (mean field: pf = 1)
  const slot = ink.slot | 0;
  const dg = (opts.dotGain ?? 0) * (0.9 + 0.3 * slot / 3) * (opts.simNoise ?? 1) * 0.005;
  v = Math.min(1, Math.max(0, v + dg * v * (1 - v) * 4));
  // Cross-layer depletion: later slots print on already-wet paper
  v *= 1 - (opts.layerDeplete ?? 0) * slot * (opts.simNoise ?? 1);
  // Absorption softening
  v = v + 0.08 * (Math.sqrt(Math.max(v, 0)) - v);
  return Math.min(1, Math.max(0, v));
}

// ── forward composite: paper → plates in SLOT order ──
// inks: [{P:[p10..p100], transparent, gamma, dens, slot}] — array already in
// slot order (the shader's layer loop). Number of entries = active plates.
function forward(w, inks, paper, opts) {
  const dotMin = opts.dotMin ?? 0.15, inkOp = opts.inkOpacity ?? 0.88, opCap = opts.opacityCap ?? 0.45;
  const kA = opts.kA ?? 1.0;      // area-fraction calibration
  const kD = opts.kD ?? 1.0;      // per-dot density calibration
  let r = paper[0], g = paper[1], b = paper[2];
  for (let i = 0; i < inks.length; i++) {
    if (w[i] < 0.001) continue;
    const cov = opts.covDirect ? Math.min(1, Math.max(0, w[i])) : covOf(w[i], inks[i], opts);
    if (cov < 0.001) continue;
    const lm = smoothstep(0.3, 0.7, cov);
    const L = lutBlendCubic(cov, paper, inks[i].P);
    const ink = [
      inks[i].P[4][0] + (L[0] - inks[i].P[4][0]) * lm,
      inks[i].P[4][1] + (L[1] - inks[i].P[4][1]) * lm,
      inks[i].P[4][2] + (L[2] - inks[i].P[4][2]) * lm,
    ];
    // Per-dot density: shader clamps grain·inkOpacity BEFORE the dotMin mix
    const d1 = Math.min(1, Math.min(1, Math.max(0, inkOp)) * (dotMin + (1 - dotMin) * cov) * kD);
    // Covered AREA: measured per-ink as a smoothstep window over coverage —
    // the grain dither has a knee (Bright Red prints NOTHING below cov≈0.5,
    // saturates by 0.82; Blue ramps 0.24..1.11). Windows fitted from live
    // single-plate renders on Pure White (see docs/SEP-LUT-PLAN.md, 9-case
    // dataset, stack cross-check off by 1/255). Defaults for unmeasured
    // inks are a middle-ground window.
    const a = Math.min(1, smoothstep(inks[i].aT0 ?? 0.35, inks[i].aT1 ?? 1.0, cov) * kA);
    const prev = [r, g, b];
    const out = [0, 0, 0];
    const op = inks[i].transparent ? 0 : smoothstep(0.3, 0.85, d1) * opCap;
    for (let ch = 0; ch < 3; ch++) {
      const y = Math.sqrt(Math.max(prev[ch], 0.001)) * Math.pow(Math.sqrt(Math.max(ink[ch], 0.05)), d1);
      let dot = y * y;                        // Beer-Lambert YN n=2 inside the dot
      if (op > 0) {
        const opq = prev[ch] + (ink[ch] - prev[ch]) * d1;
        dot = dot + (opq - dot) * op;         // opaque crossfade INSIDE the dot only
      }
      out[ch] = prev[ch] * (1 - a) + dot * a; // area mix; uncovered paper untouched
    }
    r = out[0]; g = out[1]; b = out[2];
  }
  return [r, g, b];
}

// ── OKLab objective (linearize identically on both sides) ──
function lin2oklab(r, g, b) {
  const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
  const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
  const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
  return [0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
          1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
          0.0259040371*l + 0.7827717662*m - 0.8086757660*s];
}
const srgb2lin = v => v <= 0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
function dE2(rgbA, rgbB) {
  const A = lin2oklab(srgb2lin(rgbA[0]), srgb2lin(rgbA[1]), srgb2lin(rgbA[2]));
  const B = lin2oklab(srgb2lin(rgbB[0]), srgb2lin(rgbB[1]), srgb2lin(rgbB[2]));
  return (A[0]-B[0])**2 + (A[1]-B[1])**2 + (A[2]-B[2])**2;
}

// ── Solver: projected coordinate descent, multistart ──
// covOf is monotone in w (verified: the only non-monotone fold in v2 came
// from kD-scaled Beer-Lambert fighting the area term; v3's d1 uses the
// shader's clamp order and the fitted kD stays ~1 — but keep the multistart
// + fine final step as insurance against residual folds).
function solve(target, inks, paper, opts) {
  const k = inks.length;
  const starts = [new Array(k).fill(0)];
  let bg = null, bgE = Infinity;
  for (let i = 0; i < k; i++) for (let c = 0.25; c <= 1.001; c += 0.25) {
    const w = new Array(k).fill(0); w[i] = c;
    const e = dE2(forward(w, inks, paper, opts), target);
    if (e < bgE) { bgE = e; bg = w; }
  }
  if (bg) starts.push(bg);
  // dark-anchor start: all inks at 3/4 — helps deep neutrals where the
  // greedy single-ink start underestimates required total ink
  starts.push(new Array(k).fill(0.75));
  let best = null, bestE = Infinity;
  for (const s0 of starts) {
    const w = s0.slice();
    let e = dE2(forward(w, inks, paper, opts), target);
    let step = 0.25;
    while (step > 0.002) {
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
  } else if (m.cmd === 'forward') {    // harness: raw model evaluation
    self.postMessage({ fwd: forward(m.w, m.inks, m.paper, m.opts || {}), seq: m.seq });
  }
};
