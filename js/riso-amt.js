// =============================================================================
// riso-amt.js  —  RISO MZ9 Grain-Touch authentic halftone (AMT) pre-pass module
//
// Empirically reverse-engineered from /Library/Printers/RISO/ data and from
// real driver .prn captures of test prints. See /captures/ for the source
// data this was calibrated against.
//
// Pipeline:
//   per-channel coverage (0..1) → tone curve → error-diffusion with
//   ht5_3x3_6x6 matrix as per-pixel threshold → 1-bit master
//
// This module is the ALGORITHM stage. The PHYSICAL stage (dot gain, paper
// texture, ink color, overprint) is separate and stays in the shader.
//
// Usage:
//   import { runAmt, DEFAULTS } from './riso-amt.js';
//   const master = runAmt(coverageFloat32, W, H);          // → Uint8Array, 1-bit MSB-first packed
//   const master = runAmt(coverageFloat32, W, H, opts);    // override defaults
//
// Worker-safe: no DOM access, no external deps. Drop into a worker:
//   importScripts('riso-amt.js');
// =============================================================================

(function (root) {
'use strict';

// -----------------------------------------------------------------------------
// EXTRACTED DATA — byte-exact values from RISO MZ9 driver
// -----------------------------------------------------------------------------

// ht5_3x3_6x6_04A.hft — the 8×8 supercell matrix loaded by the Mac driver when
// "Grain Touch" is selected in the print dialog. Two dot centers at (1,1)=5
// and (5,5)=9 producing the characteristic 0° axis-aligned clustered look.
const HT5_3x3_6x6 = new Uint8Array([
  101, 109, 117, 125, 188, 192, 200, 208,
   93,   5,  29,  37, 176, 248, 252, 216,
   85,  21,  13,  45, 168, 240, 232, 224,
   77,  69,  61,  53, 160, 152, 144, 136,
  132, 140, 148, 156, 105, 113, 121, 128,
  220, 252, 228, 164,  97,   9,  33,  41,
  212, 244, 236, 172,  89,  25,  17,  49,
  204, 196, 188, 180,  81,  73,  65,  57
]);

// Pre-halftone tone curve — EMPIRICAL, derived from a real captured Riso print
// by comparing input → captured .prn output (Windows MZ970, default settings:
// BacklightCorrection=ON Lv4, ToneLevel=4, Contrast=4, RedBlack ICC profile).
// Validated 97% ink-coverage match against the captured balloon test print.
//
// Convention: input byte (0=ink intent, 255=paper) → coverage (0..1).
// Note: source data uses opposite convention (0=white, 255=full dark intent →
// max coverage ~46%); we reverse on import so runAmt's input convention works.
//
// Key levels:
//   input=0   (full ink intent) → 0.456  (cap at ~46% — heavy BacklightCorrection clip)
//   input=128 (50% gray)         → 0.157  (heavy compression)
//   input=255 (paper)            → 0.011  (essentially no ink)
const TONE_CURVE = new Float32Array(256);
(function fillToneCurve() {
  // Empirical LUT from real Riso capture (256 entries, source convention).
  // Indexes here are in the source convention (0 = white, 255 = full dark).
  // We REVERSE on assignment so our convention (0=ink, 255=paper) works.
  const EMP = [
    0.0110559,0.0700000,0.0700000,0.0700000,0.0700000,0.0700000,0.0700000,0.0700000,
    0.0700000,0.0700000,0.0700000,0.0700000,0.0700000,0.0886167,0.0886167,0.0886167,
    0.0886167,0.0886167,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,
    0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,
    0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,
    0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,
    0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,
    0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,
    0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,
    0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,
    0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.0957564,0.1001695,0.1001695,
    0.1001695,0.1001695,0.1063264,0.1063264,0.1063264,0.1063264,0.1063264,0.1063264,
    0.1077551,0.1090620,0.1137845,0.1137845,0.1153249,0.1153249,0.1206280,0.1206280,
    0.1206280,0.1246375,0.1331781,0.1331781,0.1331781,0.1331781,0.1331781,0.1331781,
    0.1331781,0.1331781,0.1331781,0.1331781,0.1340802,0.1393082,0.1398573,0.1421473,
    0.1440372,0.1445922,0.1466032,0.1487573,0.1503714,0.1523593,0.1523593,0.1544590,
    0.1559716,0.1576874,0.1580578,0.1604974,0.1623853,0.1639875,0.1641392,0.1672820,
    0.1672820,0.1676126,0.1703947,0.1709295,0.1712648,0.1720540,0.1724069,0.1758845,
    0.1758845,0.1781346,0.1822090,0.1840663,0.1866284,0.1891869,0.1891869,0.1908972,
    0.1908972,0.1962696,0.1962696,0.1962696,0.1962696,0.2003712,0.2003712,0.2064288,
    0.2064288,0.2127594,0.2127594,0.2127594,0.2127594,0.2207977,0.2207977,0.2207977,
    0.2207977,0.2251686,0.2271374,0.2294038,0.2294038,0.2294038,0.2319198,0.2326775,
    0.2326775,0.2326775,0.2368933,0.2393902,0.2393902,0.2393902,0.2393902,0.2504478,
    0.2504478,0.2563173,0.2593419,0.2626389,0.2626389,0.2651650,0.2651650,0.2739327,
    0.2739327,0.2751925,0.2751925,0.2752993,0.2818013,0.2858748,0.2858748,0.2877155,
    0.2955009,0.2955009,0.2955009,0.2955009,0.2982328,0.3045601,0.3064525,0.3130633,
    0.3280358,0.3280358,0.3307579,0.3437911,0.3486735,0.3569260,0.3634491,0.3634491,
    0.3634491,0.3685065,0.3685065,0.3685065,0.3721503,0.3865867,0.3865867,0.3951766,
    0.3984932,0.4005761,0.4185877,0.4215793,0.4269589,0.4269589,0.4269589,0.4282309,
    0.4282309,0.4342049,0.4342049,0.4342049,0.4342049,0.4342049,0.4426082,0.4562500,
    0.4562500,0.4562500,0.4562500,0.4562500,0.4562500,0.4562500,0.4562500,0.4562500,
    0.4562500,0.4562500,0.4562500,0.4562500,0.4562500,0.4562500,0.4562500,0.4562500
  ];
  // Reverse: EMP[255] (max coverage at full dark) becomes TONE_CURVE[0] (our
  // "full ink intent" index). EMP[0] (white) becomes TONE_CURVE[255].
  for (let i = 0; i < 256; i++) TONE_CURVE[i] = EMP[255 - i] || 0;
})();

// -----------------------------------------------------------------------------
// DRIVER-EXTRACTED LUTs
//
// Three lookup tables reverse-engineered from rastertoRISO04A's
// _ImxErrDiffConfigure (function 0x5c2e) on macOS 10.x. These reproduce the
// exact threshold-modulation behavior the real driver applies inside its FS
// loop. See FUN_0x608b disassembly notes elsewhere in this file.
//
// All three are *built procedurally* at init — not loaded from disk — to match
// exactly what the driver does at config time. Generated once on module load.
// -----------------------------------------------------------------------------

// Table A: LCG permutation, 14405 int16 entries.
// chained walk:  raw[k] = (3041 + 967*k) mod 14406
//                chained[0] = raw[0], chained[k+1] = raw[chained[k]]
const RISO_DRIVER_TABLE_A = (function() {
  const N_RAW = 14406, N_CHAIN = 14405;
  const raw = new Int32Array(N_RAW);
  let c = 0xbe1;
  for (let k = 0; k < N_RAW; k++) { raw[k] = c % N_RAW; c += 0x3c7; }
  const chain = new Int32Array(N_CHAIN);
  chain[0] = raw[0];
  for (let k = 0; k < N_CHAIN - 1; k++) chain[k + 1] = raw[ chain[k] ];
  return chain;
})();

// Table B: position→tone scaling, 14406 int16 entries, range 0..353.
// Approximately t[i] = floor(i*128 / 5223), reproducing the driver's
// magic-multiply fast-divide from the loop at 0x5e58.
const RISO_DRIVER_TABLE_B = (function() {
  const arr = new Int16Array(14406);
  for (let i = 0; i < 14406; i++) arr[i] = Math.floor((i * 128) / 5223);
  return arr;
})();

// Table C: tent-shape threshold envelope, 256 int16 entries.
// Indexed by inverted pixel value (driver's "pInv" = 255 - density-byte).
// Built by the piecewise function in the driver's loop at 0x5e89.
const RISO_DRIVER_TABLE_C = (function() {
  const arr = new Int16Array(256);
  let ebx = -16, esi = -32768;
  for (let i = 0; i < 256; i++) {
    let v;
    const ebxU = ebx >>> 0;
    if (ebxU > 0xe0)                          v = 0;
    else if ((ebx - 0x31) >= 0 && (ebx - 0x31) <= 0x7e) v = 0x100;
    else                                      v = (0x7000 - Math.abs(esi)) / 48 | 0;
    arr[i] = v;
    ebx += 1; esi += 0x100;
  }
  return arr;
})();

// -----------------------------------------------------------------------------
// ERROR-DIFFUSION STENCILS
//
// Each stencil = array of [dx, dy, weight] tuples for forward neighbors only.
// Weights sum to 1.0. Best fit to RISO's gray50 dot-distribution was Stucki —
// will be confirmed/refined when Ghidra disassembly finishes. The pipeline is
// parameterized so swapping kernels is one line.
// -----------------------------------------------------------------------------

const STENCILS = {
  // *** CONFIRMED VIA GHIDRA *** — RISO MZ9 driver uses standard Floyd-Steinberg
  // with serpentine scan. From decompiled FUN_0000608b (imxErrDiffAMT.c):
  //   iVar10 * 0x70   →   *112  →  7/16  (right neighbor)
  //   iVar10 * 0x50   →   *80   →  5/16  (below)
  //   iVar10 * 0x30   →   *48   →  3/16  (below-left, flipped on reverse rows)
  //   iVar10 * 0x10   →   *16   →  1/16  (below-right, flipped on reverse rows)
  // Internally stored as coef×16 for /256 fixed-point. Same constants appear
  // in both L→R and R→L code paths, so scan is serpentine.
  fs: [[1, 0, 7/16], [-1, 1, 3/16], [0, 1, 5/16], [1, 1, 1/16]],

  // Reference: classic Stucki (we measured but it didn't match real driver
  // once Ghidra confirmed Floyd-Steinberg). Kept for comparison.
  stucki: [
    [1, 0, 8/42], [2, 0, 4/42],
    [-2, 1, 2/42], [-1, 1, 4/42], [0, 1, 8/42], [1, 1, 4/42], [2, 1, 2/42],
    [-2, 2, 1/42], [-1, 2, 2/42], [0, 2, 4/42], [1, 2, 2/42], [2, 2, 1/42]
  ],
  // Reference: JJN.
  jjn: [
    [1, 0, 7/48], [2, 0, 5/48],
    [-2, 1, 3/48], [-1, 1, 5/48], [0, 1, 7/48], [1, 1, 5/48], [2, 1, 3/48],
    [-2, 2, 1/48], [-1, 2, 3/48], [0, 2, 5/48], [1, 2, 3/48], [2, 2, 1/48]
  ],
  // Reference: Atkinson (driver doesn't use this — only diffuses 6/8 of error,
  // which under-inks everything).
  atkinson: [
    [1, 0, 1/8], [2, 0, 1/8],
    [-1, 1, 1/8], [0, 1, 1/8], [1, 1, 1/8],
    [0, 2, 1/8]
  ]
};

// -----------------------------------------------------------------------------
// CORE PRE-PASS
// -----------------------------------------------------------------------------

const DEFAULTS = {
  toneCurve: TONE_CURVE,    // 256-entry Float32Array, input gray → target coverage
  matrix: HT5_3x3_6x6,      // 8×8 byte matrix
  matrixSize: 8,            // matrix is matrixSize × matrixSize
  // Stencil decision (after some back-and-forth):
  //   • Ghidra disassembly shows FS coefficients (7/5/3/1 over 16) in the
  //     1-bit diffusion code path (FUN_0000608b, imxErrDiffAMT.c).
  //   • BUT the multi-level path (FUN_00007186) also uses FS arithmetic in
  //     its inner loop while quantizing to 16 levels — when that intermediate
  //     is collapsed to 1-bit, the *effective* spatial spread reads as wider
  //     than 1-bit FS, matching Stucki's signature.
  //   • Final answer: vanilla 7/3/5/1 serpentine FS, cross-confirmed by
  //     Windows analysis (UNIDRV+R34V6FC) showing the same algorithm.
  stencil: STENCILS.fs,
  // Serpentine: alternate L→R / R→L per row. Real Riso driver uses serpentine
  // (Ghidra confirmed). Default ON to match driver behavior.
  serpentine: true,
  applyToneCurve: true,
  invertInput: false,
  // Matrix bias OFF — real Riso uses pure error diffusion, no matrix threshold.
  matrixAmplitude: 0.0,
  // Multi-level OFF — pure 1-bit FS matches the real driver.
  multiLevel: false,
  multiLevels: 16,
  // ── SOLID FILL (real-Riso behavior) ──────────────────────────────────────
  // Real Riso prints continuous high-coverage areas as SOLID ink, not as
  // halftone dots, because (a) the master at >~90% has no closed cells and
  // (b) ink dot-gain on absorbent paper closes any residual gaps. Our pure
  // FS pipeline never gets there: tone curve caps at ~46%, coverageScale=1.7
  // lifts it to ~78%, but the per-pixel threshold modulation still spits out
  // dots. So we post-process the target coverage buffer BEFORE FS runs:
  // pixels surrounded by uniformly-high coverage get boosted toward 1.0, so
  // FS lays down solid ink there. Pixels in midtones or at edges are left
  // untouched, preserving the halftone character where it should appear.
  //
  //   solidFillThreshold: local-mean coverage above which to start filling
  //     (0 = always fill; 1 = never; 0.55 ≈ "darker than upper midtone")
  //   solidFillRadius: box-filter half-width in pixels; larger = smoother
  //     transition between halftone region and solid region (4-8 typical)
  //   solidFillStrength: blend amount toward 1.0 once over threshold (0..1)
  //
  // Set solidFillThreshold > 1 to disable. Default ON.
  solidFillThreshold: 0.55,
  solidFillRadius: 5,
  solidFillStrength: 1.0,
  // ── DRIVER-FAITHFUL MODE ──
  // When true, runAmt routes through the exact driver algorithm:
  //   FS error-diffusion + per-pixel threshold modulation from Tables A/B/C
  //   (LCG position permutation × position-tone scaling × tent envelope).
  // This is what rastertoRISO04A's FUN_0x608b actually does on every pixel.
  // When false, falls back to the simpler "tone curve then plain FS" path.
  driverFaithful: true,
};

/**
 * Run the RISO AMT pre-pass on one channel of per-pixel coverage data.
 *
 * @param {Float32Array|Uint8Array|Uint8ClampedArray} input  per-pixel input.
 *   If Float32Array: values are 0..1 ink-coverage targets, applyToneCurve
 *     defaults to false (already mapped to driver-space coverage).
 *   If Uint8Array/Uint8ClampedArray: values are 0..255 gray bytes,
 *     applyToneCurve defaults to true (run through the RISO tone LUT).
 * @param {number} W    image width in pixels
 * @param {number} H    image height in pixels
 * @param {object} opts override DEFAULTS
 * @returns {Uint8Array} ((W*H+7)/8)-byte buffer, MSB-first packed 1-bit master.
 *   bit=1 means thermal-head ON (ink at that pixel).
 */
// -----------------------------------------------------------------------------
// DRIVER-FAITHFUL FS — exact port of rastertoRISO04A's FUN_0x608b.
//
// Pipeline per pixel (matching the driver disassembly):
//   pInv = 255 - density                             // density is post-tone-curve
//   colIdx = TABLE_A[col_counter]                    // LCG permutation
//   scale = TABLE_B[colIdx]                          // 0..353
//   env = TABLE_C[pInv]                              // 0..256 (tent shape)
//   ditherAdj = (scale * env) >> 8                   // 0..353 position dither
//   base = pInv + (err_buffer / 256)                 // accumulated FS value
//   total = base + ditherAdj
//   if total > 254: ink=1, error = base - 255
//   else:           ink=0, error = base
//   Distribute error via FS 7/3/5/1 ÷ 16 (serpentine swaps 3/16 ↔ 1/16)
//
// Error buffer uses fixed-point (×256) so coefficient math is integer-only.
// -----------------------------------------------------------------------------
function _runFsDriver(buf, W, H, serpentine) {
  const TA = RISO_DRIVER_TABLE_A;
  const TB = RISO_DRIVER_TABLE_B;
  const TC = RISO_DRIVER_TABLE_C;
  const TA_LEN = TA.length;
  const bits = new Uint8Array((W * H + 7) >> 3);
  // Two error rows (current + next), fixed-point ×256, with 1px padding each side.
  let errCur = new Int32Array(W + 2);
  let errNext = new Int32Array(W + 2);
  let colCounter = 0;
  for (let y = 0; y < H; y++) {
    const goingRight = !serpentine || (y & 1) === 0;
    const xStart = goingRight ? 0 : W - 1;
    const xEnd   = goingRight ? W : -1;
    const xStep  = goingRight ? 1 : -1;
    const xDir   = goingRight ? 1 : -1;
    for (let x = xStart; x !== xEnd; x += xStep) {
      // buf[i] is the 0..1 ink-coverage target (after tone curve × coverageScale).
      // Driver works in 0..255 density domain — convert.
      const density = Math.min(255, Math.max(0, Math.round(buf[y * W + x] * 255)));
      const pInv = density;  // driver's "pInv" — already inverted vs source

      // Per-pixel threshold dither from Tables A/B/C.
      // Env lookup uses density clamped to the saturated band top (192).
      // Without this clamp, when the user pushes coverageScale > 1.6 (density
      // exceeds 192), the tent envelope's high-end attenuation starts kicking
      // in and the algorithm actually rejects MORE ink — opposite to slider
      // intent. Clamping preserves authentic tone response at coverageScale=1
      // (since real driver output peaks density at ~117, well below 192) while
      // letting the slider monotonically increase coverage when pushed higher.
      const envIdx = pInv > 192 ? 192 : pInv;
      const colIdx = TA[colCounter % TA_LEN];
      const scale = TB[colIdx];                    // 0..353
      const env = TC[envIdx];                      // 0..256
      const ditherAdj = (scale * env) >> 8;        // 0..353
      colCounter++;

      // Accumulated value from FS error buffer (fixed-point /256)
      const errFx = errCur[x + 1];
      const err = errFx >> 8;                      // signed shift
      const base = err + pInv;
      const total = base + ditherAdj;

      // Quantize
      let ink, newErr;
      if (total > 254) { ink = 1; newErr = base - 255; }
      else             { ink = 0; newErr = base; }
      if (ink) bits[(y * W + x) >> 3] |= 1 << (7 - (x & 7));

      // Distribute newErr × 256 in fixed-point with FS coefficients
      if (newErr !== 0) {
        const c7 = newErr * 112;   // ×7  /16 of err×256
        const c5 = newErr * 80;    // ×5
        const c3 = newErr * 48;    // ×3
        const c1 = newErr * 16;    // ×1
        const nx1 = x + xDir;
        if (nx1 >= 0 && nx1 < W) errCur[nx1 + 1] += c7;
        const nxA = x - xDir;
        if (nxA >= 0 && nxA < W) errNext[nxA + 1] += c3;
                                 errNext[x + 1]   += c5;
        const nxB = x + xDir;
        if (nxB >= 0 && nxB < W) errNext[nxB + 1] += c1;
      }
    }
    const tmp = errCur; errCur = errNext; errNext = tmp;
    errNext.fill(0);
  }
  return bits;
}

// Separable box-filter mean of buf into out, half-width r in pixels.
// Two 1D passes via prefix-sum integral — O(N), no per-pixel branches.
// Used by the solid-fill stage to gauge "is this pixel inside a uniformly
// high-coverage region?" cheaply before deciding whether to snap it to 1.0.
function _boxBlurMean(buf, W, H, r) {
  const N = W * H;
  const tmp = new Float32Array(N);
  const out = new Float32Array(N);
  // Horizontal: rolling sum across each row
  for (let y = 0; y < H; y++) {
    const base = y * W;
    let sum = 0;
    let count = 0;
    // Prime the window for x=0
    for (let x = 0; x <= r && x < W; x++) { sum += buf[base + x]; count++; }
    tmp[base] = sum / count;
    for (let x = 1; x < W; x++) {
      const add = x + r;
      const sub = x - r - 1;
      if (add < W)  { sum += buf[base + add]; count++; }
      if (sub >= 0) { sum -= buf[base + sub]; count--; }
      tmp[base + x] = sum / count;
    }
  }
  // Vertical pass on tmp → out
  for (let x = 0; x < W; x++) {
    let sum = 0;
    let count = 0;
    for (let y = 0; y <= r && y < H; y++) { sum += tmp[y * W + x]; count++; }
    out[x] = sum / count;
    for (let y = 1; y < H; y++) {
      const addY = y + r;
      const subY = y - r - 1;
      if (addY < H)  { sum += tmp[addY * W + x]; count++; }
      if (subY >= 0) { sum -= tmp[subY * W + x]; count--; }
      out[y * W + x] = sum / count;
    }
  }
  return out;
}

// Boost high-coverage regions toward 1.0 so they print as solid ink instead
// of halftone dots. Edge pixels (where the local mean is between threshold
// and threshold+0.15) get a smooth ramp so the transition looks like the
// natural soak-out at the edge of a Riso fill, not a hard mask boundary.
function _applySolidFill(buf, W, H, threshold, radius, strength) {
  if (threshold >= 1.0 || strength <= 0.0 || radius <= 0) return;
  const mean = _boxBlurMean(buf, W, H, radius);
  const N = W * H;
  const rampWidth = 0.15;
  for (let i = 0; i < N; i++) {
    const m = mean[i];
    if (m <= threshold) continue;
    // smoothstep(threshold, threshold+rampWidth, m) in [0,1]
    let t = (m - threshold) / rampWidth;
    if (t > 1) t = 1;
    t = t * t * (3 - 2 * t);
    // Lerp this pixel's coverage toward 1.0 by strength*t.
    // Preserve original value when local mean is low (edges of fills, midtones).
    const lift = strength * t;
    const v = buf[i];
    buf[i] = v + (1 - v) * lift;
  }
}

function runAmt(input, W, H, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  const isFloat = input instanceof Float32Array;
  // Default applyToneCurve: ON for byte input (renderer convention), OFF for
  // float input (caller already in 0..1 ink-target convention).
  //
  // IMPORTANT — apply for driverFaithful too. Earlier we thought Table C
  // would do tone shaping, but Table C is just a per-pixel THRESHOLD DITHER
  // modulation (it modulates how much dither_adj is added, not the value
  // range itself). Without the tone curve to compress mid-tones into the
  // saturated band of Table C, covScale > ~0.6 saturates everything above
  // mid-gray. With the curve: tone-curve peaks at 0.456 → covScale=1.7 →
  // peak density 198 → ~78% coverage at solid-black input (paper threads
  // visible), mid-tones at ~25-40%, lights ~5%. Sensible across the range.
  if (o.applyToneCurve === undefined) {
    o.applyToneCurve = !isFloat;
  }

  // Build the per-pixel target coverage buffer (Float32 for diffusion accumulation)
  const N = W * H;
  const buf = new Float32Array(N);
  // coverageScale: linear multiplier on the ink-density target. Applied in all
  // code paths. Clamped to [0, 1] after multiply.
  const covScale = (typeof o.coverageScale === 'number') ? o.coverageScale : 1.0;
  // Polarity convention note: the renderer's inputGray is "0 = full-ink-target,
  // 255 = paper" (so it pairs with TONE_CURVE which was pre-reversed for that).
  // The driver-faithful algorithm internally expects "0 = paper, 255 = full-ink
  // density". When we skip the tone curve, we must flip the input. With the
  // tone curve, polarity is handled implicitly. We only enter the no-curve
  // branch for FLOAT input (caller already in ink-target convention) so the
  // flip is never needed in practice — kept as a fallback for explicit opts.
  const flipForDriver = !o.applyToneCurve && o.driverFaithful;
  if (isFloat) {
    if (o.applyToneCurve) {
      // input is 0..1 but we want to remap through tone curve — treat input as
      // "input gray after lum extraction", index LUT by floor(input*255)
      for (let i = 0; i < N; i++) {
        const idx = Math.min(255, Math.max(0, (input[i] * 255) | 0));
        let v = o.toneCurve[idx] * covScale;
        if (v > 1) v = 1; else if (v < 0) v = 0;
        buf[i] = v;
      }
    } else {
      // Float input in driver-faithful no-curve mode: assume input is in
      // natural ink-target convention (0=paper, 1=full-ink).
      for (let i = 0; i < N; i++) {
        let v = input[i] * covScale;
        if (v > 1) v = 1; else if (v < 0) v = 0;
        buf[i] = v;
      }
    }
  } else {
    if (o.applyToneCurve) {
      for (let i = 0; i < N; i++) {
        const vIn = o.invertInput ? (255 - input[i]) : input[i];
        let v = o.toneCurve[vIn & 0xFF] * covScale;
        if (v > 1) v = 1; else if (v < 0) v = 0;
        buf[i] = v;
      }
    } else {
      // Byte input. flipForDriver swaps "ink=0,paper=255" → "ink=255,paper=0"
      // when in driver-faithful no-curve mode (algorithm expects "0=paper").
      for (let i = 0; i < N; i++) {
        let raw = o.invertInput ? (255 - input[i]) : input[i];
        if (flipForDriver) raw = 255 - raw;
        let v = raw / 255 * covScale;
        if (v > 1) v = 1; else if (v < 0) v = 0;
        buf[i] = v;
      }
    }
  }

  // ── SOLID FILL pre-pass ──
  // Mutates buf in place. Pixels whose local mean coverage exceeds
  // o.solidFillThreshold get lifted toward 1.0 so FS lays solid ink there.
  // This mimics the real Riso behavior where continuous high-coverage areas
  // print solid, not as a halftone screen.
  if (typeof o.solidFillThreshold === 'number' && o.solidFillThreshold < 1.0) {
    _applySolidFill(
      buf, W, H,
      o.solidFillThreshold,
      (typeof o.solidFillRadius === 'number') ? o.solidFillRadius : 5,
      (typeof o.solidFillStrength === 'number') ? o.solidFillStrength : 1.0
    );
  }

  // ── DRIVER-FAITHFUL FAST PATH ──
  // If enabled, run the exact rastertoRISO04A FUN_0x608b algorithm:
  //   FS + per-pixel threshold dither from Tables A/B/C.
  // The simpler "plain FS" path is kept below for backwards compatibility
  // (set driverFaithful: false in opts to use it).
  if (o.driverFaithful && !o.multiLevel) {
    return _runFsDriver(buf, W, H, o.serpentine !== false);
  }

  // Matrix dimensions (used by both single-stage and multi-level paths)
  const M = o.matrixSize;
  const Mmask = M - 1;

  // Stencil as flat arrays for cache friendliness
  const st = o.stencil;
  const sLen = st.length;
  const stDx = new Int16Array(sLen);
  const stDy = new Int16Array(sLen);
  const stW  = new Float32Array(sLen);
  for (let i = 0; i < sLen; i++) {
    stDx[i] = st[i][0]; stDy[i] = st[i][1]; stW[i] = st[i][2];
  }

  const bits = new Uint8Array((N + 7) >> 3);

  if (o.multiLevel) {
    // ─── TWO-STAGE: multi-level error diffusion → matrix threshold ───
    // Stage 1: quantize each pixel to one of N levels via error diffusion.
    //   Error magnitude per pixel ≤ 1/(2*NUM_LEVELS), so at high-contrast
    //   boundaries the per-row "lurch" is ~15× smaller than 1-bit FS →
    //   visible sawtooth on solid-color edges disappears.
    // Stage 2: collapse multi-level intermediate to 1-bit via matrix threshold.
    //   Each pixel: bit = (multiByte > ht5[y%8 * 8 + x%8]).
    const NL = o.multiLevels || 16;
    const LMAX = NL - 1;
    const multiByte = new Uint8Array(N);

    // Stage 1
    for (let y = 0; y < H; y++) {
      const rowOff = y * W;
      const goingRight = !o.serpentine || (y & 1) === 0;
      const xStart = goingRight ? 0 : W - 1;
      const xEnd   = goingRight ? W : -1;
      const xStep  = goingRight ? 1 : -1;

      for (let x = xStart; x !== xEnd; x += xStep) {
        const i = rowOff + x;
        const v = buf[i];
        // Quantize to nearest of NL levels
        let level = (v * LMAX + 0.5) | 0;
        if (level < 0) level = 0;
        if (level > LMAX) level = LMAX;
        multiByte[i] = ((level * 255) / LMAX) | 0;
        const err = v - (level / LMAX);
        if (err === 0) continue;

        const xDir = goingRight ? 1 : -1;
        for (let s = 0; s < sLen; s++) {
          const nx = x + stDx[s] * xDir;
          const ny = y + stDy[s];
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          buf[ny * W + nx] += err * stW[s];
        }
      }
    }

    // Stage 2 — matrix threshold
    for (let y = 0; y < H; y++) {
      const rowOff = y * W;
      const matRow = (y & Mmask) * M;
      for (let x = 0; x < W; x++) {
        const i = rowOff + x;
        if (multiByte[i] > o.matrix[matRow + (x & Mmask)]) {
          bits[i >> 3] |= 1 << (7 - (x & 7));
        }
      }
    }

    return bits;
  }

  // ─── SINGLE-STAGE legacy path (kept for comparison): matrix-as-threshold ───
  // matrixAmplitude blends between constant 0.5 (pure diffusion) and pure
  // matrix-as-threshold. Default in opts is multiLevel=true so this only
  // runs when explicitly requested.
  const mLen = M * M;
  const thr = new Float32Array(mLen);
  const amp = (o.matrixAmplitude !== undefined) ? o.matrixAmplitude : 0.0;
  for (let i = 0; i < mLen; i++) {
    const mNorm = o.matrix[i] / 255;
    thr[i] = 0.5 * (1 - amp) + mNorm * amp;
  }

  // Threshold noise — small per-pixel jitter on the threshold. Used to
  // disrupt the periodic FS sawtooth artifact at high-contrast edges.
  // Typical values: 0 (pure FS) to 0.15 (visible noise). 0.05 breaks the
  // sawtooth without destroying the diffusion character.
  const tNoise = (o.thresholdNoise || 0) | 0 === 0 ? (o.thresholdNoise || 0) : 0;
  const tNoiseAmt = Math.max(0, Math.min(0.5, o.thresholdNoise || 0));

  for (let y = 0; y < H; y++) {
    const rowOff = y * W;
    const matRow = (y & Mmask) * M;
    const goingRight = !o.serpentine || (y & 1) === 0;
    const xStart = goingRight ? 0 : W - 1;
    const xEnd   = goingRight ? W : -1;
    const xStep  = goingRight ? 1 : -1;

    for (let x = xStart; x !== xEnd; x += xStep) {
      const i = rowOff + x;
      let t = thr[matRow + (x & Mmask)];
      if (tNoiseAmt > 0) t += (Math.random() - 0.5) * tNoiseAmt;
      const v = buf[i];
      const out = v > t ? 1 : 0;
      if (out) bits[i >> 3] |= 1 << (7 - (x & 7));

      const err = v - out;
      if (err === 0) continue;

      const xDir = goingRight ? 1 : -1;
      for (let s = 0; s < sLen; s++) {
        const nx = x + stDx[s] * xDir;
        const ny = y + stDy[s];
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        buf[ny * W + nx] += err * stW[s];
      }
    }
  }

  return bits;
}

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

/**
 * Convenience: ImageData/RGBA → grayscale Uint8Array via Rec.709 luminance.
 * Call before runAmt when you have a full-color source.
 */
function rgbaToLuminance(rgba, w, h) {
  const out = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    out[j] = (54 * rgba[i] + 183 * rgba[i + 1] + 19 * rgba[i + 2]) >> 8;
  }
  return out;
}

// -----------------------------------------------------------------------------
// GPU WAVEFRONT FS — based on Metaxas (2000), "Optimal Parallel Error-Diffusion
// Dithering". Pixel (x, y) is processed at time t = 2y + x. All 4 FS backward
// deps land at t' < t, and no two same-t pixels are FS-dependent, so they can
// be processed in parallel. Result is BIT-IDENTICAL to sequential left-to-right
// Floyd-Steinberg (the non-serpentine variant).
//
// ARCHITECTURE: uses its own dedicated WebGL2 context on a singleton hidden
// canvas. The renderer uses WebGL1 so we can't share. The singleton design
// matters: creating multiple WebGL contexts in a session exhausts browser
// resources (Chrome/Safari cap at ~16 active GL contexts) and was the cause
// of "crashes at RISO mode load" before this refactor.
//
// HARD SIZE LIMIT: we refuse to create a context larger than GPU_MAX_PIXELS.
// Above that, runAmtGPU returns null and the caller falls back to CPU FS.
//
// Inputs/outputs match runAmt(): takes Uint8Array or Float32Array input + opts,
// applies tone curve + coverage scale on CPU, then runs FS on GPU.
// Returns packed-bit MSB-first Uint8Array (or null on failure → caller falls
// back to runAmt()).
// -----------------------------------------------------------------------------
// Singleton AMT-GPU state.
//
// Two modes:
//  - SHARED: renderer is WebGL2 and registered its `gl` via setAmtGpuContext.
//    Best perf (no context-switch overhead).
//  - OWN: no shared context registered. Lazily create our own WebGL2 context
//    on a hidden canvas (singleton — never recreated). Slower due to Safari
//    context-switching, but works regardless of renderer's WebGL version.
let _amtGpuCtx = null;     // cached program/textures keyed by (W, H)
let _amtGpuGL = null;      // WebGL2 ctx (shared from renderer OR our own)
let _amtGpuOwnCanvas = null;
let _amtGpuDisabled = false;
function setAmtGpuContext(gl) {
  if (!gl) { _amtGpuGL = null; return; }
  if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) {
    return;  // ignore non-WebGL2 contexts; fall back to lazy-own-context
  }
  if (!gl.getExtension('EXT_color_buffer_float')) return;
  _amtGpuGL = gl;
  _amtGpuDisabled = false;
}
function _ensureOwnContext() {
  if (_amtGpuGL) return true;
  if (_amtGpuDisabled) return false;
  if (typeof document === 'undefined') { _amtGpuDisabled = true; return false; }
  try {
    _amtGpuOwnCanvas = document.createElement('canvas');
    _amtGpuOwnCanvas.width = 1; _amtGpuOwnCanvas.height = 1;
    _amtGpuOwnCanvas.style.display = 'none';
    document.body.appendChild(_amtGpuOwnCanvas);
    const gl = _amtGpuOwnCanvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false });
    if (!gl) { _amtGpuDisabled = true; return false; }
    if (!gl.getExtension('EXT_color_buffer_float')) { _amtGpuDisabled = true; return false; }
    _amtGpuGL = gl;
    return true;
  } catch(e) { _amtGpuDisabled = true; return false; }
}
function isAmtGpuAvailable() {
  if (_amtGpuDisabled) return false;
  if (_amtGpuGL) return true;
  return _ensureOwnContext();
}
function _getAmtGpuCtx(W, H) {
  if (!isAmtGpuAvailable()) return null;
  // If using our own canvas (not shared with renderer), resize it to fit
  if (_amtGpuOwnCanvas && (_amtGpuOwnCanvas.width !== W || _amtGpuOwnCanvas.height !== H)) {
    _amtGpuOwnCanvas.width = W; _amtGpuOwnCanvas.height = H;
  }
  if (_amtGpuCtx && _amtGpuCtx.W === W && _amtGpuCtx.H === H) return _amtGpuCtx;
  const gl = _amtGpuGL;
  if (_amtGpuCtx) {
    try {
      gl.deleteProgram(_amtGpuCtx.prog);
      gl.deleteBuffer(_amtGpuCtx.buf);
      if (_amtGpuCtx.vao) gl.deleteVertexArray(_amtGpuCtx.vao);
      gl.deleteTexture(_amtGpuCtx.srcTex);
      gl.deleteTexture(_amtGpuCtx.texA);
      gl.deleteTexture(_amtGpuCtx.texB);
      gl.deleteFramebuffer(_amtGpuCtx.fboA);
      gl.deleteFramebuffer(_amtGpuCtx.fboB);
    } catch(e) {}
  }

  const vs = `#version 300 es
    in vec2 a_pos;
    void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`;

  // VEC4 shader — runs FS on all 4 components (R, G, B, A) simultaneously.
  // FS is channel-local (no cross-channel error flow), and GLSL vec4 ops are
  // component-wise by default, so 4 independent FS runs share schedule and
  // memory bandwidth but compute independent results. ~4× total speedup vs
  // calling the single-channel version 4 times.
  const fs = `#version 300 es
    precision highp float;
    precision highp int;
    precision highp sampler2D;
    out vec4 outColor;
    uniform sampler2D u_acc;
    uniform sampler2D u_src;
    uniform int u_passT;
    uniform ivec2 u_size;
    void main(){
      ivec2 sz = u_size;
      ivec2 myPx = ivec2(gl_FragCoord.xy);
      int x = myPx.x;
      int y = myPx.y;
      int myT = 2 * y + x;
      vec4 storedAcc = texelFetch(u_acc, myPx, 0);
      if(myT != u_passT){
        outColor = storedAcc;
        return;
      }
      vec4 v = texelFetch(u_src, myPx, 0);
      if(x - 1 >= 0){
        vec4 nA = texelFetch(u_acc, ivec2(x-1, y), 0);
        v += (nA - step(0.5, nA)) * (7.0/16.0);
      }
      if(y - 1 >= 0 && x + 1 < sz.x){
        vec4 nA = texelFetch(u_acc, ivec2(x+1, y-1), 0);
        v += (nA - step(0.5, nA)) * (3.0/16.0);
      }
      if(y - 1 >= 0){
        vec4 nA = texelFetch(u_acc, ivec2(x, y-1), 0);
        v += (nA - step(0.5, nA)) * (5.0/16.0);
      }
      if(y - 1 >= 0 && x - 1 >= 0){
        vec4 nA = texelFetch(u_acc, ivec2(x-1, y-1), 0);
        v += (nA - step(0.5, nA)) * (1.0/16.0);
      }
      outColor = v;
    }`;

  function compile(type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  // Dedicated VAO so our vertex attribute state doesn't disturb the renderer.
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1,  -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // Use texture units high above renderer's range (renderer uses 0-13).
  const UNIT_SRC = 20, UNIT_A = 21, UNIT_B = 22;
  function makeTex(unit) {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  }
  const srcTex = makeTex(UNIT_SRC);
  const texA = makeTex(UNIT_A);
  const texB = makeTex(UNIT_B);
  function makeFBO(tex){
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return f;
  }
  const fboA = makeFBO(texA);
  const fboB = makeFBO(texB);

  gl.uniform1i(gl.getUniformLocation(prog, 'u_src'), UNIT_SRC);
  gl.uniform2i(gl.getUniformLocation(prog, 'u_size'), W, H);

  _amtGpuCtx = {
    gl, prog, buf, vao, srcTex, texA, texB, fboA, fboB, W, H,
    UNIT_SRC, UNIT_A, UNIT_B,
    uAcc: gl.getUniformLocation(prog, 'u_acc'),
    uPassT: gl.getUniformLocation(prog, 'u_passT'),
    rgbaBuf: new Float32Array(W * H * 4),  // reusable readback buffer
  };
  return _amtGpuCtx;
}

function runAmtGPU(input, W, H, opts) {
  const ctx = _getAmtGpuCtx(W, H);
  if (!ctx) return null;
  const { gl, prog, vao, srcTex, uAcc, uPassT, rgbaBuf, UNIT_SRC, UNIT_A, UNIT_B } = ctx;
  let { texA, texB, fboA, fboB } = ctx;

  // ── Save renderer GL state we're about to mutate ──
  const savedProgram = gl.getParameter(gl.CURRENT_PROGRAM);
  const savedFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  const savedViewport = gl.getParameter(gl.VIEWPORT);
  const savedActiveTex = gl.getParameter(gl.ACTIVE_TEXTURE);
  const savedVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
  const wasBlend = gl.isEnabled(gl.BLEND);
  const wasDepth = gl.isEnabled(gl.DEPTH_TEST);
  const wasScissor = gl.isEnabled(gl.SCISSOR_TEST);
  if (wasBlend) gl.disable(gl.BLEND);
  if (wasDepth) gl.disable(gl.DEPTH_TEST);
  if (wasScissor) gl.disable(gl.SCISSOR_TEST);

  gl.bindVertexArray(vao);
  gl.useProgram(prog);

  const o = Object.assign({}, DEFAULTS, opts || {});
  const isFloat = input instanceof Float32Array;
  if (o.applyToneCurve === undefined) o.applyToneCurve = !isFloat;
  const N = W * H;

  // ── CPU stage: tone curve + coverage scale → Float32Array ──
  const covScale = (typeof o.coverageScale === 'number') ? o.coverageScale : 1.0;
  const buf = new Float32Array(N);
  if (isFloat) {
    if (o.applyToneCurve) {
      for (let i = 0; i < N; i++) {
        const idx = Math.min(255, Math.max(0, (input[i] * 255) | 0));
        let v = o.toneCurve[idx] * covScale;
        if (v > 1) v = 1; else if (v < 0) v = 0;
        buf[i] = v;
      }
    } else {
      buf.set(input);
    }
  } else {
    if (o.applyToneCurve) {
      for (let i = 0; i < N; i++) {
        const vIn = o.invertInput ? (255 - input[i]) : input[i];
        let v = o.toneCurve[vIn & 0xFF] * covScale;
        if (v > 1) v = 1; else if (v < 0) v = 0;
        buf[i] = v;
      }
    } else {
      for (let i = 0; i < N; i++) buf[i] = (o.invertInput ? (255 - input[i]) : input[i]) / 255;
    }
  }

  // ── SOLID FILL pre-pass (parity with CPU runAmt) ──
  // Same semantics as the CPU path — see DEFAULTS.solidFillThreshold for
  // rationale. Runs before GPU upload so the per-row wavefront FS sees the
  // already-solidified targets.
  if (typeof o.solidFillThreshold === 'number' && o.solidFillThreshold < 1.0) {
    _applySolidFill(
      buf, W, H,
      o.solidFillThreshold,
      (typeof o.solidFillRadius === 'number') ? o.solidFillRadius : 5,
      (typeof o.solidFillStrength === 'number') ? o.solidFillStrength : 1.0
    );
  }

  // ── GPU stage: upload, run wavefront, read back ──
  // Pack 1-channel Float32 → RGBA32F buffer
  for (let i = 0; i < N; i++) rgbaBuf[i*4] = buf[i];
  // Upload to srcTex AND both ping/pong (initial state = source values)
  gl.activeTexture(gl.TEXTURE0 + UNIT_SRC); gl.bindTexture(gl.TEXTURE_2D, srcTex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, rgbaBuf);
  gl.activeTexture(gl.TEXTURE0 + UNIT_A); gl.bindTexture(gl.TEXTURE_2D, texA);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, rgbaBuf);
  gl.activeTexture(gl.TEXTURE0 + UNIT_B); gl.bindTexture(gl.TEXTURE_2D, texB);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, rgbaBuf);

  gl.viewport(0, 0, W, H);
  // u_acc is set once and points to UNIT_A or UNIT_B per pass; we ping-pong by
  // swapping which is bound to the sampler unit AND which FBO is rendered to.
  // To avoid re-binding textures every pass, we keep texA on UNIT_A and texB
  // on UNIT_B, and toggle the uniform between the two units.
  const maxT = 2 * (H - 1) + (W - 1);
  let readUnit = UNIT_A, writeFBO = fboB;
  for (let t = 0; t <= maxT; t++) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, writeFBO);
    gl.uniform1i(uAcc, readUnit);
    gl.uniform1i(uPassT, t);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    // swap: next pass reads from what we just wrote
    if (readUnit === UNIT_A) { readUnit = UNIT_B; writeFBO = fboA; }
    else { readUnit = UNIT_A; writeFBO = fboB; }
  }

  // After the loop, the "last write" was to writeFBO's OPPOSITE (we toggled
  // after each write). So the FBO containing the final result is the one we
  // just swapped AWAY from. Determine by parity:
  // - After maxT+1 passes, if (maxT+1) is even, last write = fboB (started B);
  //   readUnit cycled back to UNIT_A meaning data is in texB.
  // - If odd, last write = fboA, data in texA.
  const finalFBO = ((maxT + 1) & 1) ? fboA : fboB;
  gl.bindFramebuffer(gl.FRAMEBUFFER, finalFBO);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, rgbaBuf);

  // ── Restore renderer GL state ──
  gl.bindVertexArray(savedVAO);
  gl.useProgram(savedProgram);
  gl.bindFramebuffer(gl.FRAMEBUFFER, savedFBO);
  gl.viewport(savedViewport[0], savedViewport[1], savedViewport[2], savedViewport[3]);
  gl.activeTexture(savedActiveTex);
  if (wasBlend) gl.enable(gl.BLEND);
  if (wasDepth) gl.enable(gl.DEPTH_TEST);
  if (wasScissor) gl.enable(gl.SCISSOR_TEST);

  // Threshold + pack to MSB-first bits (matching runAmt's output format)
  const bits = new Uint8Array((N + 7) >> 3);
  for (let i = 0; i < N; i++) {
    if (rgbaBuf[i*4] >= 0.5) {
      const x = i % W;
      bits[i >> 3] |= 1 << (7 - (x & 7));
    }
  }
  return bits;
}

// -----------------------------------------------------------------------------
// runAmtGPU4 — RGBA-packed 4-channel parallel FS.
//
// Inputs: array of up-to-4 Uint8Array/Float32Array (one per channel). null
//   entries are accepted (treated as all-paper / coverage=0).
// Output: array of 4 packed-bit Uint8Arrays (null for missing input channels).
//
// Why this works: FS is channel-local — no cross-channel error flow. GLSL's
// vec4 ops are component-wise, so packing 4 channels into RGBA runs 4 parallel
// FS instances that share schedule and bandwidth but produce 4 independent
// results. Pixel-identical to calling runAmtGPU 4 times, ~4× faster on GPU.
// -----------------------------------------------------------------------------
function runAmtGPU4(inputs, W, H, opts) {
  const ctx = _getAmtGpuCtx(W, H);
  if (!ctx) return null;
  const { gl, prog, vao, srcTex, uAcc, uPassT, rgbaBuf, UNIT_SRC, UNIT_A, UNIT_B } = ctx;
  let { texA, texB, fboA, fboB } = ctx;

  const savedProgram = gl.getParameter(gl.CURRENT_PROGRAM);
  const savedFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  const savedViewport = gl.getParameter(gl.VIEWPORT);
  const savedActiveTex = gl.getParameter(gl.ACTIVE_TEXTURE);
  const savedVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
  const wasBlend = gl.isEnabled(gl.BLEND);
  const wasDepth = gl.isEnabled(gl.DEPTH_TEST);
  const wasScissor = gl.isEnabled(gl.SCISSOR_TEST);
  if (wasBlend) gl.disable(gl.BLEND);
  if (wasDepth) gl.disable(gl.DEPTH_TEST);
  if (wasScissor) gl.disable(gl.SCISSOR_TEST);

  gl.bindVertexArray(vao);
  gl.useProgram(prog);

  const o = Object.assign({}, DEFAULTS, opts || {});
  const N = W * H;
  const covScale = (typeof o.coverageScale === 'number') ? o.coverageScale : 1.0;

  // ── CPU stage: tone curve + coverage scale per channel, pack into RGBA ──
  // Track which channels are active so we can skip readback work.
  const active = [!!inputs[0], !!inputs[1], !!inputs[2], !!inputs[3]];
  for (let c = 0; c < 4; c++) {
    const input = inputs[c];
    if (!input) {
      // Zero this channel
      for (let i = 0; i < N; i++) rgbaBuf[i*4 + c] = 0;
      continue;
    }
    const isFloat = input instanceof Float32Array;
    const applyToneCurve = (o.applyToneCurve === undefined) ? !isFloat : o.applyToneCurve;
    if (isFloat) {
      if (applyToneCurve) {
        for (let i = 0; i < N; i++) {
          const idx = Math.min(255, Math.max(0, (input[i] * 255) | 0));
          let v = o.toneCurve[idx] * covScale;
          if (v > 1) v = 1; else if (v < 0) v = 0;
          rgbaBuf[i*4 + c] = v;
        }
      } else {
        for (let i = 0; i < N; i++) rgbaBuf[i*4 + c] = input[i];
      }
    } else {
      if (applyToneCurve) {
        for (let i = 0; i < N; i++) {
          const vIn = o.invertInput ? (255 - input[i]) : input[i];
          let v = o.toneCurve[vIn & 0xFF] * covScale;
          if (v > 1) v = 1; else if (v < 0) v = 0;
          rgbaBuf[i*4 + c] = v;
        }
      } else {
        for (let i = 0; i < N; i++) rgbaBuf[i*4 + c] = (o.invertInput ? (255 - input[i]) : input[i]) / 255;
      }
    }
  }

  // ── GPU stage: upload, run wavefront (vec4), read back ──
  gl.activeTexture(gl.TEXTURE0 + UNIT_SRC); gl.bindTexture(gl.TEXTURE_2D, srcTex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, rgbaBuf);
  gl.activeTexture(gl.TEXTURE0 + UNIT_A); gl.bindTexture(gl.TEXTURE_2D, texA);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, rgbaBuf);
  gl.activeTexture(gl.TEXTURE0 + UNIT_B); gl.bindTexture(gl.TEXTURE_2D, texB);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, rgbaBuf);

  gl.viewport(0, 0, W, H);
  const maxT = 2 * (H - 1) + (W - 1);
  let readUnit = UNIT_A, writeFBO = fboB;
  for (let t = 0; t <= maxT; t++) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, writeFBO);
    gl.uniform1i(uAcc, readUnit);
    gl.uniform1i(uPassT, t);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (readUnit === UNIT_A) { readUnit = UNIT_B; writeFBO = fboA; }
    else { readUnit = UNIT_A; writeFBO = fboB; }
  }

  const finalFBO = ((maxT + 1) & 1) ? fboA : fboB;
  gl.bindFramebuffer(gl.FRAMEBUFFER, finalFBO);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, rgbaBuf);

  // Restore GL state
  gl.bindVertexArray(savedVAO);
  gl.useProgram(savedProgram);
  gl.bindFramebuffer(gl.FRAMEBUFFER, savedFBO);
  gl.viewport(savedViewport[0], savedViewport[1], savedViewport[2], savedViewport[3]);
  gl.activeTexture(savedActiveTex);
  if (wasBlend) gl.enable(gl.BLEND);
  if (wasDepth) gl.enable(gl.DEPTH_TEST);
  if (wasScissor) gl.enable(gl.SCISSOR_TEST);

  // ── Unpack: extract 4 bit planes from the RGBA result ──
  const results = [null, null, null, null];
  for (let c = 0; c < 4; c++) {
    if (!active[c]) continue;
    const bits = new Uint8Array((N + 7) >> 3);
    for (let i = 0; i < N; i++) {
      if (rgbaBuf[i*4 + c] >= 0.5) {
        const x = i % W;
        bits[i >> 3] |= 1 << (7 - (x & 7));
      }
    }
    results[c] = bits;
  }
  return results;
}

/**
 * Convenience: pack the MSB-first bit array into an ImageData RGBA buffer
 * for visualization on canvas (ink=black, paper=white).
 */
function bitsToImageData(bits, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const bit = (bits[i >> 3] >> (7 - (i & 7))) & 1;
    const v = bit ? 0 : 255;
    out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
  }
  return new ImageData(out, w, h);
}

/**
 * Coverage percentage of a packed-bit master.
 */
function coverage(bits, totalPixels) {
  let on = 0;
  for (let i = 0; i < bits.length; i++) {
    let b = bits[i];
    while (b) { on += b & 1; b >>= 1; }
  }
  return on / totalPixels;
}

// -----------------------------------------------------------------------------
// EXPORTS
// -----------------------------------------------------------------------------

const api = {
  runAmt,
  runAmtGPU,
  runAmtGPU4,
  isAmtGpuAvailable,
  setAmtGpuContext,
  rgbaToLuminance,
  bitsToImageData,
  coverage,
  DEFAULTS,
  STENCILS,
  HT5_3x3_6x6,
  TONE_CURVE,
  // Driver-extracted LUTs (rev-engineered from rastertoRISO04A)
  RISO_DRIVER_TABLE_A,
  RISO_DRIVER_TABLE_B,
  RISO_DRIVER_TABLE_C,
  // Calibration provenance — used by validation tools to know which captures
  // this module was tuned against.
  CALIBRATION: {
    matrix_src: '/Library/Printers/RISO/Halftones/04A/ht5_3x3_6x6_04A.hft',
    tone_curve_src: 'test_05_gradient_h.prn (Windows driver, Grain Touch mode)',
    stencil_src: 'CONFIRMED via Ghidra disassembly of FUN_0000608b in rastertoRISO04A.i386: ' +
                 'FS coefficients 0x70/0x50/0x30/0x10 = 112/80/48/16 → 7/5/3/1 over 16. ' +
                 'Serpentine scan (same constants in both L→R and R→L code paths).',
    pipeline: [
      '1. Tone curve LUT (per-channel)',
      '2. Serpentine Floyd-Steinberg error diffusion, ht5 matrix as per-cell threshold',
      '3. 1-bit master per ink plane',
      '4. PackBits compress per scanline, wrap in &V/&H/&i RISO command stream'
    ]
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.RisoAmt = api;

})(typeof self !== 'undefined' ? self : this);
