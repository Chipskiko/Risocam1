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

// Pre-composed Table B∘A: TB[TA[k]] collapsed into one lookup. The FS inner
// loop is strictly serial, so removing one dependent table load per pixel is
// a direct win on its critical path.
const RISO_DRIVER_TABLE_BA = (function() {
  const n = RISO_DRIVER_TABLE_A.length;
  const arr = new Int16Array(n);
  for (let k = 0; k < n; k++) arr[k] = RISO_DRIVER_TABLE_B[RISO_DRIVER_TABLE_A[k]];
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
// Driver-faithful FS, optimized for the serial critical path:
//  • dens is Uint8 (0..255 density) — built once in runAmt. The old Float32
//    coverage buffer was 4 bytes/px (~300 MB at 600 dpi) and forced a
//    round/clamp per pixel INSIDE the serial loop; both gone.
//  • Composed Table B∘A (one lookup), wrap-counter instead of `%`.
//  • No neighbor bounds checks: the error rows carry 1px padding each side, so
//    out-of-image writes land in padding (never read — only indices 1..W are
//    read; fill(0) clears padding on swap). Bit-identical to the checked loop.
//  • Serpentine specialized into two straight-line inner loops.
//  • globalRowOffset: when dithering a horizontal BAND of a larger image, pass
//    the band's first row index so serpentine parity and the Table-A column
//    counter match what a full-image scan would use at that row. With warm-up
//    rows (see worker) this makes band seams statistically invisible.
function _runFsDriver(dens, W, H, serpentine, globalRowOffset) {
  const TBA = RISO_DRIVER_TABLE_BA;
  const TC = RISO_DRIVER_TABLE_C;
  const TA_LEN = TBA.length;
  const gy0 = globalRowOffset | 0;
  const bits = new Uint8Array((W * H + 7) >> 3);
  // Two error rows (current + next), fixed-point ×256, with 1px padding each side.
  let errCur = new Int32Array(W + 2);
  let errNext = new Int32Array(W + 2);
  // Column counter continues as if rows 0..gy0-1 were already scanned.
  let cc = (gy0 * W) % TA_LEN;
  // EDGE-DAMPED carries: serpentine FS at a hard density edge oscillates —
  // error piles into the boundary column, flows down a row, and the reversed
  // row shoves it back, leaving a 2-row comb of dots hugging the edge. On a
  // real print (600 dpi) the comb is ±42 µm and ink bleed swallows it; at the
  // user-selected coarse dot sizes it scales up into a visible sawtooth that
  // real riso edges don't show.
  // DIRECTION-AWARE: only carries toward a much LIGHTER neighbour are
  // quartered — the pile-up direction (error trapped on the light side of
  // the wall is what resonates into the comb). Carries INTO darker regions
  // stay full: they are the diffusion warm-up that lets a solid region hit
  // its duty cycle immediately — symmetric damping starved it and left a
  // pinhole fringe inside solid blacks (measured on the Node harness,
  // tools/fs-edge-harness.mjs). Deltas compare RAW p0, not the ramped pInv,
  // which inflated deltas near the flood zone and quartered carries against
  // neighbours that are not real edges (review finding). Interior carries
  // (the texture the driver
  // tables were byte-matched against) are untouched.
  const EDGE_T = 96;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    const rowD = row + W;                 // next row base (may be past end)
    const hasDown = y + 1 < H;
    const goingRight = !serpentine || ((y + gy0) & 1) === 0;
    if (goingRight) {
      for (let x = 0; x < W; x++) {
        // SOLID FLOOD, ramped: a binary force-fire at dens>=192 drew visible
        // CONTOUR LINES wherever a smooth coverage field crossed the
        // threshold (one side floods to 100%, the other dithers at ~74% — a
        // 26-point density cliff; the user's 'weird blotches'). Instead the
        // top of the density range stretches so 192 maps to 255: FS floods
        // NATURALLY at 255 (base >= 255 always fires, error stays 0 — which
        // also gives solids clean edges with no warm-up fringe), and duty
        // ramps continuously across 180..192 instead of stepping.
        const p0 = dens[row + x];
        const pInv = p0 > 180 ? (p0 >= 192 ? 255 : 180 + (((p0 - 180) * 25) >> 2)) : p0;
        // Env clamp at 192: see original notes — keeps coverageScale > 1.6
        // monotonic (tent envelope would otherwise reject ink past the band).
        const ditherAdj = (TBA[cc] * TC[pInv > 192 ? 192 : pInv]) >> 8;
        if (++cc === TA_LEN) cc = 0;
        const base = (errCur[x + 1] >> 8) + pInv;
        let newErr;
        if (base + ditherAdj > 254) {
          bits[(row + x) >> 3] |= 1 << (7 - (x & 7));
          newErr = base - 255;
        } else {
          newErr = base;
        }
        if (newErr !== 0) {
          const eR  = (x + 1 < W  && (p0 - dens[row + x + 1]) > EDGE_T) ? 28 : 112;
          const eBL = (hasDown && x > 0     && (p0 - dens[rowD + x - 1]) > EDGE_T) ? 12 : 48;
          const eB  = (hasDown              && (p0 - dens[rowD + x])     > EDGE_T) ? 20 : 80;
          const eBR = (hasDown && x + 1 < W && (p0 - dens[rowD + x + 1]) > EDGE_T) ? 4  : 16;
          errCur[x + 2]  += newErr * eR;    // ×7/16 (right)
          errNext[x]     += newErr * eBL;   // ×3/16 (below-left)
          errNext[x + 1] += newErr * eB;    // ×5/16 (below)
          errNext[x + 2] += newErr * eBR;   // ×1/16 (below-right)
        }
      }
    } else {
      for (let x = W - 1; x >= 0; x--) {
        const p0 = dens[row + x];   // ramped solid flood — see L->R note
        const pInv = p0 > 180 ? (p0 >= 192 ? 255 : 180 + (((p0 - 180) * 25) >> 2)) : p0;
        const ditherAdj = (TBA[cc] * TC[pInv > 192 ? 192 : pInv]) >> 8;
        if (++cc === TA_LEN) cc = 0;
        const base = (errCur[x + 1] >> 8) + pInv;
        let newErr;
        if (base + ditherAdj > 254) {
          bits[(row + x) >> 3] |= 1 << (7 - (x & 7));
          newErr = base - 255;
        } else {
          newErr = base;
        }
        if (newErr !== 0) {
          const eL  = (x > 0     && (p0 - dens[row + x - 1]) > EDGE_T) ? 28 : 112;
          const eBR = (hasDown && x + 1 < W && (p0 - dens[rowD + x + 1]) > EDGE_T) ? 12 : 48;
          const eB  = (hasDown              && (p0 - dens[rowD + x])     > EDGE_T) ? 20 : 80;
          const eBL = (hasDown && x > 0     && (p0 - dens[rowD + x - 1]) > EDGE_T) ? 4  : 16;
          errCur[x]      += newErr * eL;    // ×7/16 (left — reversed row)
          errNext[x + 2] += newErr * eBR;   // ×3/16 (below-right)
          errNext[x + 1] += newErr * eB;    // ×5/16 (below)
          errNext[x]     += newErr * eBL;   // ×1/16 (below-left)
        }
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
// Uint8-density variant of _applySolidFill for the driver-faithful path.
// Same box-mean + smoothstep-ramp lift, but streaming: horizontal means are
// kept in a (2r+2)-row Float32 ring and the vertical window is a rolling
// per-column sum — O(rowBytes) extra memory instead of 3 full-image Float32
// planes (~900 MB at 600 dpi). Output differs from the float version by at
// most the ±0.5/255 density quantization — visually identical.
function _applySolidFillU8(dens, W, H, threshold, radius, strength) {
  if (threshold >= 1.0 || strength <= 0.0 || radius <= 0) return;
  const r = radius | 0;
  const thr = threshold * 255;
  const rampInv = 1 / (0.15 * 255);
  const slots = 2 * r + 2;                  // rows alive in [y-r-1 .. y+r]
  const ring = new Float32Array(slots * W); // horizontal box means
  const have = new Int32Array(slots).fill(-1);
  function hRow(y) {                        // → ring offset of row y's h-means
    const slot = y % slots, off = slot * W;
    if (have[slot] === y) return off;
    const base = y * W;
    let sum = 0, count = 0;
    for (let x = 0; x <= r && x < W; x++) { sum += dens[base + x]; count++; }
    ring[off] = sum / count;
    for (let x = 1; x < W; x++) {
      const a = x + r, s = x - r - 1;
      if (a < W)  { sum += dens[base + a]; count++; }
      if (s >= 0) { sum -= dens[base + s]; count--; }
      ring[off + x] = sum / count;
    }
    have[slot] = y;
    return off;
  }
  const colSum = new Float64Array(W);
  let cnt = 0;
  for (let y = 0; y <= r && y < H; y++) {
    const o = hRow(y);
    for (let x = 0; x < W; x++) colSum[x] += ring[o + x];
    cnt++;
  }
  for (let y = 0; y < H; y++) {
    if (y > 0) {
      const a = y + r, s = y - r - 1;
      if (a < H)  { const o = hRow(a); for (let x = 0; x < W; x++) colSum[x] += ring[o + x]; cnt++; }
      if (s >= 0) { const o = hRow(s); for (let x = 0; x < W; x++) colSum[x] -= ring[o + x]; cnt--; }
    }
    const base = y * W;
    for (let x = 0; x < W; x++) {
      const m = colSum[x] / cnt;
      if (m <= thr) continue;
      let t = (m - thr) * rampInv;
      if (t > 1) t = 1;
      t = t * t * (3 - 2 * t);
      const lift = strength * t;
      const v = dens[base + x];
      dens[base + x] = (v + (255 - v) * lift + 0.5) | 0;
    }
  }
}

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

// Build the 0..255 Uint8 density buffer (tone curve × coverageScale, then
// solid-fill lift) — the input to the driver-faithful FS. Shared by the CPU
// path (runAmt) and the WebGPU path (which runs only the FS stage on GPU).
// Math.fround before quantizing reproduces the legacy store-to-Float32, so the
// downstream FS output is bit-identical to the historical implementation.
function buildDensityU8(input, W, H, o) {
  const N = W * H;
  const isFloat = input instanceof Float32Array;
  const covScale = (typeof o.coverageScale === 'number') ? o.coverageScale : 1.0;
  const dens = new Uint8Array(N);
  const flipD = !o.applyToneCurve && o.driverFaithful;
  if (isFloat) {
    if (o.applyToneCurve) {
      for (let i = 0; i < N; i++) {
        const idx = Math.min(255, Math.max(0, (input[i] * 255) | 0));
        let v = o.toneCurve[idx] * covScale;
        if (v > 1) v = 1; else if (v < 0) v = 0;
        dens[i] = Math.round(Math.fround(v) * 255);
      }
    } else {
      for (let i = 0; i < N; i++) {
        let v = input[i] * covScale;
        if (v > 1) v = 1; else if (v < 0) v = 0;
        dens[i] = Math.round(Math.fround(v) * 255);
      }
    }
  } else {
    if (o.applyToneCurve) {
      for (let i = 0; i < N; i++) {
        const vIn = o.invertInput ? (255 - input[i]) : input[i];
        let v = o.toneCurve[vIn & 0xFF] * covScale;
        if (v > 1) v = 1; else if (v < 0) v = 0;
        dens[i] = Math.round(Math.fround(v) * 255);
      }
    } else {
      for (let i = 0; i < N; i++) {
        let raw = o.invertInput ? (255 - input[i]) : input[i];
        if (flipD) raw = 255 - raw;
        let v = raw / 255 * covScale;
        if (v > 1) v = 1; else if (v < 0) v = 0;
        dens[i] = Math.round(Math.fround(v) * 255);
      }
    }
  }
  if (typeof o.solidFillThreshold === 'number' && o.solidFillThreshold < 1.0) {
    _applySolidFillU8(
      dens, W, H,
      o.solidFillThreshold,
      (typeof o.solidFillRadius === 'number') ? o.solidFillRadius : 5,
      (typeof o.solidFillStrength === 'number') ? o.solidFillStrength : 1.0
    );
  }
  return dens;
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

  const N = W * H;
  const covScaleEarly = (typeof o.coverageScale === 'number') ? o.coverageScale : 1.0;

  // ── DRIVER-FAITHFUL FAST PATH (production) ──
  // Builds the 0..255 density buffer directly as Uint8 — no intermediate
  // Float32 coverage plane (was 4 bytes/px ≈ 300 MB at 600 dpi). Math.fround
  // before quantizing reproduces the old store-to-Float32 exactly, so the
  // FS output is bit-identical to the previous implementation.
  if (o.driverFaithful && !o.multiLevel) {
    return _runFsDriver(buildDensityU8(input, W, H, o), W, H,
                        o.serpentine !== false, o.globalRowOffset || 0);
  }

  // Build the per-pixel target coverage buffer (Float32 for diffusion accumulation)
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

  // (Driver-faithful path returned above — below is the legacy/multi-level
  // float-buffer pipeline, kept for driverFaithful:false and multiLevel.)

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
  // matrix-as-threshold. DEFAULTS.multiLevel is false, so this is the path
  // taken whenever the driver-faithful fast path didn't return above and
  // multiLevel wasn't explicitly enabled.
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
