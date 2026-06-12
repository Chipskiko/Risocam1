# Plan: RISO Driver-Derived Screen Engine (circles → real threshold matrices)

Status: ALL PHASES SHIPPED. P1+P2 (8bdeecb): real driver matrices, endpoint-
correct AA. P4 (cd56c0a + staircase fix ccb9fb9): cell-integrated soft edges,
default ON; R.setScreenEdge(0) = authentic slicing; 16-bit tone texture,
16-tap full-cell box, dot-center LINEAR sampling, per-dot dither. P5
(65b70c1): exports run R._runTonePrepass at export dims (SEPS intentionally
authentic/per-fragment). P3+P6: measured TRC baked INTO the threshold
textures as T' = D⁻¹(T) 16-bit (riso_trc.json; lut43 direct measurement
within 0.9pp of targets, lut71 interpolated, lut106 extrapolated LOW-MED
conf); half-texel sampling shift phase-aligns all three matrices' dots to
cell centers (measured); DEFAULT FLIPPED — circles render the matrix engine
(R.setScreenType(0) = Classic dots; R.setScreenTrc(0) = raw geometry-linear).
SCOPE (user decision): the faithful engine is confined to the CIRCLE stamp;
other shapes + ASCII stay stylized (ASCII = point-sampled anchor tone).
VALIDATION FINDINGS (4-agent analysis): the 8 .prn captures are ALL
Grain-mode error diffusion — no clustered-dot ground truth exists; statistical
references + corrected RISORINC3 decoder (escape 0x1E) in docs/validation/.
The real driver synthesizes integer-diagonal lattices for ARBITRARY lpi
(measured 38.57/84.85 from the scans) — parametric lattice synthesis is a
possible future upgrade beyond the 3 stored matrices. Procedural dot law
matches the driver's sqrt(v) growth within ~25%; perceived dot-size range
differences are preview-resolution artifacts (smallest dots sub-pixel below
cellPx~14). The old procedural cutback was resolution-DEPENDENT (1.5/cellPx)
— preview and export tones disagreed; the matrix+TRC engine is
resolution-stable.
· Evidence: 3-agent deep dive + 4-agent P3-P6 analysis workflow. Goal: screen mode's dot
engine uses RISO's actual threshold matrices while keeping all accumulated look
work, and the hard-edge behavior becomes a deliberate choice.

## 1. What we have (better than expected)

- **`Risocam1/riso_halftones.json`** — 21 unique threshold matrices extracted
  byte-exact from the macOS driver's `.hft` files (viewer:
  `riso-halftones.html`). The print dialog maps: **ht1 = "Screen-covered"
  (AM)**, **ht5 = "Grain Touch"**, **ht6 = "Solid-look"**; ht2 = 0° variants,
  ht3 = midtone-hybrid (entry-zone swaps).
- **The ht1 6×6 family is the engine core**: `ht1_6x6_43_45` (20×20, 199
  levels, true 42.4 lpi @600 dpi), `ht1_6x6_71_45` (12×12, 72 levels,
  70.7 lpi), `ht1_6x6_106_45` (8×8, 32 levels, 106 lpi) — exact 45° round-dot
  screens whose threshold CDFs are **tone-linear by construction (KS ≈
  0.009–0.05)**: no digital linearization needed. The driver's real UI presets
  (43/71/106) match exploriso/RISO docs.
- Bonus shapes for later: `ht1_3x6_*` = real **chain/elliptical** screens,
  `ht2_6x6_*` = 0° diamond dots, `ht5_*` = Grain Touch matrices (could
  upgrade grain mode's "RISO" dither).
- **Measured physical TRCs** (`risocam_project/tools/scan_analysis.json`):
  Screen 40: 50%→33.7 (strong dot LOSS — prints LIGHTER); Screen 90:
  50%→45.4; Grain: 50%→60.8 (gain). These are the per-mode calibration
  targets. (Verify which matrix the "90 lpi" scan used — FFT the dot pitch —
  before binding its TRC.)
- **Ground truth for validation**: real `.prn` captures
  (`Test images/test_08_calibration/*.prn`) + `tools/prn-decoder.py` → the
  engine can be verified **bit-exact** against actual driver output.

## 2. Why the existing matrix engine (screenType=1) looked wrong — ranked

1. **The LPI cutback curve double-corrects it** (index.html ~2010): calibrated
   for the procedural circle's AA over-ink, applied unconditionally to both
   engines. At default LPI it remaps 0.5→~0.31 and **1.0→~0.82** — the code
   comment "endpoints are preserved" is FALSE (`v·(1−1.3·ef·(1−0.7v))` at v=1
   = 1−0.39·ef). Midtones washed 15–20 pts, blacks never solid — in BOTH
   engines.
2. **No endpoint AA handling**: fixed `e = clamp(1.5/cellPx, .004, .25)` in
   tone units means solids keep a bright hole-lattice web (measured 0.961 ink
   at cov 1.0) and highlights get a tone floor of fat soft micro-dots — the
   exact problems the procedural autoclamp/`e2=min(edge,radius)` solved.
3. **The 20×20→64×64 LINEAR resample** (renderer.js ~212-243) blurs threshold
   cliffs and bends the CDF (−1.5 pts mid, +2.5 pts at 0.7) — real but the
   smallest effect. Threshold arrays must be NEAREST, exact bytes, re-TILED
   (never resampled); rule confirmed by RIP practice.

The supercell pitch math (tile = cellPx·√2, angle−45°) is **correct** — keep.

## 3. Architecture

### P1 — Data & textures
Load `riso_halftones.json` at init (it ships with the app already). Build one
NEAREST texture per matrix (exact bytes, raw dims; wrap via `fract()` in-shader
so NPOT needs no REPEAT). Selected set v1: ht1_6x6_43/71/106 (+ keep ht5 for
grain). LPI control snaps to the real driver presets **43 / 71 / 106**
(displayed as such), pitch tied to the existing physical-size model
(`min(dw,dh)/8.267in`), tile = cellPx · (matrixPeriod / dotPitch).

### P2 — Engine shader (screenMatrix v2)
- NEAREST + `fract` tiling; per-plate rotation of the **sampling coordinates**
  (pragmatic route; research: real RIPs bake angle into supercells —
  rotated-sampling can soften/moiré at some pitch/angle combos; our 4-tap
  `screenSampled` band-limiting mitigates; supercell generation documented as
  a future upgrade).
- **Endpoint-correct AA**: `e = min(baseE, v, 1−v) + ε`, plus hard `step()`
  when v ≥ 254/255 → true solids, clean highlights (the matrix-engine analog
  of the procedural autoclamp + e2 clamp; the matrix data itself already
  encodes hole-shrink).
- Mirror the clean-mode edge narrowing (`mix(0.5,1.5,u_simNoise)/cellPx`).
- **Gate the LPI cutback to the procedural engine only** — and fix its broken
  endpoint math for the procedural path (see §5).

### P3 — Tone calibration (the LUT that IS needed)
The matrices are geometry-linear; the required correction is the **physical
print response**: invert `scan_analysis.json dens_normalized` per mode into a
256-entry LUT applied to coverage before thresholding (the existing
`u_driverLUT` infrastructure is the natural home — this finally lands task #2
"driver-faithful tone" with measured data). Per-LPI: 43→Screen-40 curve,
106→Screen-90-ish curve (after the FFT check), 71 interpolated.

### P4 — Edge behavior: a real toggle, both options authentic
- **"Soft edges" (default)**: cell-integrated coverage via the ASCII
  anchor-tone prepass machinery (extend trigger to screenType=1; lattice pitch
  = u_screenCell on the dot lattice; per-plate lattices via quadrant-packing
  the tone texture — plate angles differ too much for the shared-lattice
  approximation). This is RIP "screen-resolution prefiltering" (US6943808).
  Bonus: per-anchor printMask gives whole-dot margins on the CORRECT lattice,
  retiring printMaskCell's procedural-lattice assumption; the cutback becomes
  structurally unnecessary here (cell means are exact).
- **"Authentic edges"**: raw per-fragment compare → dots slice at content
  edges, exactly like the real 600 dpi driver. (Both behaviors are "real" —
  digital threshold RIPs slice; prefiltered RIPs taper.)

### P5 — Export parity (MANDATORY, also fixes a live bug)
`save.js` never runs the tone prepass — **ASCII screen exports are already
broken today** (exports fall back to garbage anchor tone from whatever is on
unit 9). Replicate the prepass in `saveHiRes`/`exportSeparations` for both
ASCII and the new engine, sized to export dims.

### P6 — Validation & default flip
- Tone wedge: engine ramp within ±4 luma of the measured TRC targets at
  43/71/106.
- **Bit-exactness spot check**: render the calibration chart at 600 dpi,
  compare against `test_08_calibration/*.prn` via `prn-decoder.py` (threshold
  geometry should match exactly where coverage is flat).
- A/B vs procedural at the user's standard test images; then flip screen
  mode's default to the matrix engine (procedural stays as a "Classic dots"
  toggle). Default angles already match RISO convention (K45/M75/C15/Y0).

## 4. What carries over free vs retired

Free (engine-agnostic, verified by audit): 4-tap supersample, calBlend
mode-1 overrides (ink=p100, no dotMin), clean-mode gating, coverage chain
(TRC/driver LUT/misreg/skew/text routing), SEPS plumbing pattern.
Retired with the procedural engine (matrix data encodes them): area-correct
radius law, corner-hole autoclamp geometry, the cutback curve (soft-edge path).
Needs porting: endpoint AA clamps (P2), whole-dot margins (P4 does it better),
drum-asymmetry oval (optional: stretch rp.x pre-sample; accept ~5% tone shift
or pre-compensate).

## 5. Immediate fixes shipped with this plan (current engine, not waiting)
1. Cutback endpoint bug: `v·(1−1.3ef(1−0.7v))` does NOT preserve v=1 (blacks
   wash up to ~18% at default LPI). Replaced with `v − 1.3·ef·v·(1−v)` —
   true fixed points at 0 and 1, similar midtone strength.
2. Cutback gated to the procedural engine (`u_screenType < 0.5`).

## 6. Phases & effort
P1+P2 (engine v2, real matrices): M · P3 (TRC LUTs): S · P4 (edge toggle +
quadrant prepass): M · P5 (export parity): S–M · P6 (validation): S.
Suggested order: P1→P2→P6-tone-check → P3 → P4 → P5 → default flip.
