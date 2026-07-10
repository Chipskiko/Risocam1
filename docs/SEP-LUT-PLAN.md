# SEP-LUT: forward-model-inverting separation LUT

Goal: replace per-fragment NNLS (and the flat/RISO per-channel projection)
with a baked 3D LUT that inverts the app's ACTUAL compositing — optimal ink
weights per target color, one texture fetch per fragment.

## Status
- DONE `js/sep-lut-worker.js`: forward model (mean-field calBlend replica),
  OKLab objective, projected coordinate-descent solver (multistart), N³ bake
  + `solveOne` debug protocol. Smoke-tested in-page:
  navy → w=[0.75,0,0,0.71] predΔE 0.5 · midgray → predΔE 0 ·
  pink → red 0.7, ΔE 2.3 · purple → ΔE 14.7 = true 4-ink gamut limit.
- Baselines (24-patch harness, grain mode, SPOT, CMYK profile, Blank tex +
  Pure White paper, patch mapping m=0.072, OKLab ΔE·100 of 40px patch means):
  shipped NNLS (naive deltas, after 1ed3dab) = **14.75**. Beat this.

## Forward model (captured from calBlend, index.html ~line 2348)
Per plate in layer order, from paper; mean-field d = c (grain averages to
coverage; add dotMin factor `d *= mix(dotMin,1,c)` for grain/riso fidelity):
- ink = mix(p100, lutBlend(c, paper, p10..p100), smoothstep(.3,.7,c))
- transparent = (sqrt(prev) · sqrt(max(ink,.05))^d)²   (Beer-Lambert YN n=2)
- transparent ink flag on → blended = transparent; else crossfade to
  opaque mix(prev,ink,d) by smoothstep(.3,.85,d)·opacityCap
- contamination term is simNoise-scaled → 0 for the mean field
Working space = shader space (sRGB-encoded, calBlend never linearizes).
Metric linearizes forward output and target identically before OKLab.

## FINDING (gray-goes-blue, sample template, CMYK profile + SPOT)
Neutral grays render BLUE: source (113,113,113) -> rendered (105,149,192).
The grayscale strip becomes a blue ramp; only near-white escapes (the
user's "weird middle square" = the survivor flanked by wrongly-blue
neighbors). NOT a shader ink-mapping bug: the LUT oracle (measured
RISO_CAL curves through the forward model) ALSO solves gray-113 to
[Blue .49, Red .22, Yellow .10, Black .13] — Black barely participates.
Suspects, in order: (1) decompose-vs-render disconnect — asciiCov applies
per-ink GAMMA (pow(w, mix(inkGamma,1,.45)); Black gamma=0.5, Blue=1.0)
AFTER the solve, so printed coverage != solved weights, per ink; (2) the
measured 'Black' curve is weak/warm (see old task 'Black too grey') making
blue-stacks OKLab-closer in theory but not in the actual composite.
MEASURED (validation case A): Black-only plate (dens [0,0,0,100]),
solid gray-113 source, grain mode, Blank tex + Pure White paper, B=0:
renders (170,170,170) — NEUTRAL but 57 luma too LIGHT. So black alone
cannot reach mid-gray through the real chain; the 4-ink solve recruits
Blue for the missing darkness => blue-cast grays. Forward model predicted
~93-117 for the same weights: the JENSEN GAP is real — grain speckle
composites as ~AREA MIXING ((1-c)*paper + c*ink_dark, further thinned by
dotMin), NOT Beer-Lambert of the mean. Model fix: composite each ink as
area mix over the grain distribution (+ dotMin factor + per-ink gamma on
w), THEN the solver will naturally push single-ink coverage higher and
grays back to black-dominant. Remaining protocol: case B blue-only,
case C blue+black stack, same source/readback (patch mean at 0.5/0.35).
=> Phase 2 MUST start with FORWARD-MODEL VALIDATION: isolate one plate
(other densities 0), force coverage via u_dbgFixedCov, render a patch,
compare against forward() for that weight vector; repeat per ink + one
2-ink stack; fold the per-ink gamma into the worker's forward model (and
into how weights are interpreted) until predictions match renders. Only
then bake.

## v3 MODEL — CALIBRATED (this session)
forward() v3 in js/sep-lut-worker.js now replicates the real chain:
covOf(w) = soften(scurve(pow(w*dens/100, mix(gamma,1,.45)))) with positional
dot gain (inkAbsorb = mix(.9,1.2,slot/3)) and cross-layer depletion — LAYER
SLOT + ORDER + COUNT are inputs; plates composite in slot order; the opaque
crossfade lives INSIDE the covered fraction driven by d1; lutBlend is the
exact Fritsch-Carlson monotone cubic; bake opts carry the LIVE sliders
(dotMin .15 / inkOpacity .88 / opacityCap .45 defaults) and sit in the key.

MEASURED per-ink grain AREA windows (a = smoothstep(t0,t1,cov)); fitted on
Pure White + Blank, default sliders, 9 single/stacked plate renders:
  Blue [0.24, 1.11] rmse 0.4 | Black [0.50, 0.70] rmse 5.6
  Bright Red [0.49, 0.81] rmse 7.0 | Yellow [0.39, 0.92] rmse 0.7
  kD = 1.0; Blue+Black stack cross-check: predicted (136,146,157) vs
  measured (137,146,157). Dataset (cov -> render, Pure White):
  Black .637->165, .847->85 | Blue .583->(209,224,243)
  Red .459->paper, .516->paper, .819->(249,123,95)
  Yellow .494->paper, .939->(248,236,83) | stack (.583,.637)->(137,146,157)
  (cov read via u_dbgShowCov patch means; renders at 0.5/0.35 patch.)
Table lives in renderer.js SEP_LUT_AREA; unmeasured inks default [.35,1.0]
— measuring more inks = rerun the same protocol.

RESULT: gray-113 now solves BLACK-dominant [B .51, R .34, Y .47, K .71]
(was K .13 blue-veiled); navy -> Blue 1.0 + K .89; white -> 0; 9-cube mean
achievable-error map 9.6 dE (includes out-of-gamut corners). NEXT: the
shader consumes none of this yet — user-visible fix lands with step 2/3
below (LUT texture + u_useSepLut path), then CPU consumers (step 4).

## Wiring plan (next session)
1. **Bake orchestration** (renderer.js): `_sepLutBake()` — blob-load the
   worker (`_buildWorkerBlobUrl('js/sep-lut-worker.js?v=1')`, CSP), gather
   per-ink {P: [p10,p30,p50,p70,p100], transparent} + paper. The pXX come
   from the SAME source that fills u_lutC*/cal textures (grep `u_lutC0`
   upload site; cal-lut-worker owns measured data). N=17 first (4913 solves,
   ~1-2 s), N=33 later if interp error shows. Debounce + `_sepLutSeq`
   staleness (copy the AMT pattern); triggers: ink set/profile/paper change.
2. **Texture**: pack N³ RGBA float→8-bit weights as 2D atlas (N tiles of
   N×N, standard 3D-in-2D). Unit: NONE FREE (16 used) — reuse unit 8's
   time-share ladder (it already juggles ht5/AM matrix/glyph atlas by mode)
   or pack into the cal LUT texture's free rows. Decide there.
3. **Shader**: `uniform sampler2D u_sepLut; uniform float u_useSepLut;` in
   nnlsDecompose: when on, two slice fetches + manual trilinear mix →
   weights; keep NNLS as fallback (live sources during bake, and 1-2 ink
   cases where NNLS is exact-ish).
4. **CPU consumers**: flat/RISO `projJobs` fused loop + stipple luma
   projection — replace per-channel axis projection with JS trilinear reads
   of the SAME Float32Array weights (kept from the bake message). This is
   the piece NNLS never covered: true multi-ink separation for masters.
5. **Validate**: rerun the 24-patch harness (protocol above; colors list in
   the session transcript / reconstruct any 24 diverse patches) expecting
   mean ≤ ~8-10 (gamut-limited patches keep irreducible error: purple ≈15).
   Also eyeball: dark navy/brown photos in RISO mode (old failure class).
6. Pins: renderer, sw ASSETS ADD sep-lut-worker.js, deploy on request only.

## Notes / risks
- Mean-field d=c ignores grain-texture nonlinearity through Beer-Lambert
  (Jensen gap). If measured LUT accuracy stalls, sample forward() over the
  grain distribution (a 5-point Gauss quadrature over d) instead.
- calBlendOpaque (metallic inks) not modeled — LUT bake should fall back to
  NNLS when any active ink is opaque-metallic, or model it later.
- Screen mode uses d=c and p100 ink exactly (no dotMin/lutMix) — the LUT is
  still an upgrade (its forward ≈ that at mean field).
