# RISO/CAM — working notes

## Measurement protocol (MANDATORY for any pixel measurement)

Before measuring anything about grain, dither, banding, anisotropy, coverage or
tone, set up the substrate first:

- **Blank paper texture** (no PBR substrate)
- **Pure White paper colour**
- `?pin=1` / `window._pinSeed` for a deterministic frame
- Flat synthetic source (solid fill), never the sample image, when isolating
  dither structure from image content

This is not cosmetic. `getCoverage()` multiplies ink by `pf` (paper fibre), and
`paperEffect()` adds spatial structure — so on textured paper you are partly
measuring the paper, not the thing you think you are measuring. Paper colour
also offsets every luminance reading and every Murray-Davies endpoint.

Same protocol the SEP-LUT baselines use ("Blank tex + Pure White paper").

### Things that have produced false findings in this repo

- **Sampling the wrong region.** Whole-image autocorrelation hid grain
  anisotropy (source structure dominated); a flat patch showed 4.19. Measure
  inside a flat field.
- **Coverage-confounded run lengths.** Mean ink run length at 77% coverage is
  ~4.3px for a *perfectly random* field. Always compare against the
  coverage-matched random baseline `1/(1-c)`, or measure at low coverage where
  dots are isolated.
- **Single-seed differences.** Grain is stochastic; several "findings" this
  repo has recorded were inside one standard deviation. Use multiple seeds and
  report a spread before believing an effect.
- **Directional terms that aren't the grain.** `pressX` in `getCoverage`
  depends only on `rpx.x`, so it is constant down each column and produces
  VERTICAL banding; `drumBand`/`pressY` depend only on `rpx.y` and produce
  horizontal banding. All are gated by `u_pressVar * u_simNoise`. Zero them
  before attributing directional structure to the dither.
- **Live state drift.** Test scripts that mutate `cached.layerDens` /
  `layerVisible` and restore imperfectly have produced wrong "defaults".
  Re-read state at measurement time rather than trusting a saved copy.

## Grain engine (since 2026-07-28)

V&C blue-noise is the DEFAULT grain engine: baked 256x256 void-and-cluster
mask (js/gen/bnvc256.js, regenerate with `node tools/build-vc-mask.mjs`),
`?grainwhite` reverts to legacy white-noise grain. Runtime falls back to
128x128 generation if the baked file is missing (u_bnSize tells the shader).

The mask texture is DUAL-CHANNEL and the bake is RAW ranks:
- R = white-CDF-remapped ranks — grain engine only (tone parity with the
  white path, measured max ramp delta 0.3/100). Remap applied at runtime.
- G = raw uniform ranks — the RISO/flat paths (risoMatrixDither,
  gpuGrainTouch, dissolveInk) threshold against these; their density-gamma
  calibration assumes uniform. Shipping remapped bytes in all channels once
  broke RISO grain-touch into nondeterministic-looking noise (regression,
  same day). Any new u_bnVC consumer must pick its channel deliberately and
  divide by u_bnSize, never a hardcoded 128.

## Deploy

Every JS change needs a forward-only `?v=N` bump in index.html AND a `sw.js`
CACHE bump. Deploy is per-file curl to the Neocities API; the key lives in
`../deploy-neocities.sh` and must never be echoed.

`node tools/build-wgsl.mjs` regenerates `js/gen/shaders-wgsl.js` and doubles as
a GLSL compile validator — run it after any shader edit. When the generated
file changes, ALSO bump its `?v=` pin inside `js/webgpu-live.js` (it fetches
the file itself; a stale cached copy fails the sha check and silently
disables the WebGPU path) and webgpu-live.js's own pin in index.html.

## Open: the coverage transfer defect

TAC normalisation in the duotone path cancels `ink`:

    duoCov = ink·bal · tac/(ink·totalBal) = bal·tac/totalBal   → CONSTANT

so every pixel above `tac/totalBal` (= 2.80/5.75 = 48.7%) gets identical
coverage. Confirmed twice: measured flatline starts at requested 50%, and its
value matches `1.65×2.80/5.75 = 0.803`. This is the shadow crush and the reason
"black can't get darker".

Fix must keep TAC's ink limit while staying monotonic in `ink` — a soft
limiter such as `totalOut = tac·(1 − exp(−total/tac))`, not exact
normalisation. Two naive attempts failed: inverting the downstream
gamma/S-curve made it worse (it boosts into the limiter), and replacing
`ink·bal` with `pow(ink, 1/bal)` broke the cancellation and inverted the curve
(coverage FELL from 74.7% to 44.5% as input darkened).

## Resolved: vertical banding in grain mode (2026-07-28)

Was lattice-stride aliasing: grain lives in rpx-space, and wherever the
rpx→screen-pixel stride lands near a simple ratio the interpolation phase
slips coherently down every column (11.5px stripes at stride 0.91, 3.25px at
1.04 — the period MOVING with u_resScale/canvas geometry is what identified
resampling as the cause). Fixed in grainDither by a per-cell-row hashed phase
offset (±half a cell, seed-free): decorrelates the beat between rows, column
peak collapsed 1.48 → 0.2-0.3 (noise floor), tone unchanged. Preview and
export render at different strides, so pre-fix they banded DIFFERENTLY.

## Performance profile (2026-07-31, Apple Silicon)

Measured: frame cost 4.0-5.4 ms across all four modes at 2400x1620 (median
of 7, gl.finish-timed); idle draws 0/s over 8 s (render loop is fully
event-driven); Neocities serves brotli (renderer.js 210 KB -> ~72 KB wire).
Already-optimal machinery: R8 single-channel AMT masters on WebGL2
(886->222 MB), pointer-swap video frames (ONE texImage2D per camera frame),
lazy WASM vendors, interaction/animation LODs, banded TDR-safe draws,
worker-pool FS, anchor-prepass LPI gating.

WebGPU shims (riso-amt-webgpu.js + webgpu-live.js, 41 KB) are LAZY: an
inline loader in index.html document.writes them for ?webgpu (parse-order
contract: webgpu-live must run before the GL context exists) and exposes
window._loadWebGPUShims for the debug toggle (R.setAmtWebGPU fetches on
first enable). Every call site is presence-guarded (window.RisoAmtGPU &&).

Measured but deliberately NOT changed (risk > win): still-image loads
upload the source to BOTH src textures (~10-40 ms + one texture of VRAM,
once per load) so ghosting has a previous frame — gating it on
cached.ghosting would touch ~10 upload sites.

## Coverage-split pipeline (2026-09-01)

The fragment pipeline factors at sepInkCMYK/sepInkSpot vs inkPhysics(): the
separation head is SEED-FREE and bakes to a half-res RGBA FBO (u_covPass=1,
unit 11); the physics tail re-runs live per shimmer tick (u_covPass=2 fetches
the head at each plate's misregistered UV — separation is pointwise, so the
shifted-field fetch is exact). u_covPass=0 is the untouched legacy path
(exports, prepasses, ?covlive). Auto-engaged by the adaptive-LOD ladder as
rung 1 — but NOT in screen mode: edgeSoft cellTone/asciiCov still compute
live ink per fragment, so the bake is pure overhead there (measured 44.5 ->
48.2ms; grain 155.6 -> 35, lines 196.9 -> 45.5). Redirecting those chains to
the baked head is the outstanding work that earns screen the split. Shimmer
ticks REUSE the bake (staleness stamp: dirty/source-frame/dims); pure-still
shimmer measured 0 rebakes across 15 draws.

Two WebGL rules paid for in blood here: a texture bound on a unit while
attached to the bound FBO trips the feedback rule and silently invalidates
the whole draw; and the fullscreen quad's negated Y means FBO passes store
the field bottom-up (covUV() flips fetches).

## SPOT dark rescue (2026-09-01)

nnlsDecompose (and the sep-lut-worker bake — keep them in sync!) apply a
deficit push after solving: least squares backs ink OFF for out-of-gamut dark
targets (black under a 2-ink duo solved at ~55% and printed as a mid-tone).
Prediction MUST be the multiplicative overprint model — additive deltas go
negative exactly for the targets the rescue exists for, and clamping reads
as "dark enough" (the push never fires). K=2.2 in both. Measured: black
pre-ink 0.71/0.52 -> 0.92/0.68, ramp monotone 96..253.

## Local iteration discipline (hard-won, twice)

Bump the ?v pin on EVERY local edit of a pinned file, not just at deploy —
same-URL scripts return from the HTTP cache mid-debugging and produce
impossible measurements. The measurement protocol rules at the top of this
file apply to the harness too: front the pane tab (hidden tabs suspend rAF
entirely), and only DRAMATIC probes (sledgehammer returns) count when a
result looks impossible.

## Live FX (camera / video feed, 2026-09-02)

Effects on the live feed live IN the fragment shader, not in a second WebGL
context (Seriously.js / vfx-js were the catalogue, not a dependency): every
source read goes through fetchSrc(uv) → srcUV() → fxUV() (frame: mirror,
flip, zoom+pan; effect: PIXEL/SYM/KALEIDO/WAVE/WARP/GLITCH) with the colour
stage at the top of adjustRGB (NEGATIVE/SOLARIZE toggles, hue) and the
neighbourhood effects (EDGE Sobel, RGB split) at the fetch. That is why
exports and VID loops carry the effect for free and why the split head bakes
it. u_fx ids: 0 off 1 EDGE 2 PIXEL 3 SYM 4 KALEIDO 5 WAVE 6 WARP 7 GLITCH
8 RGB; u_fxAmt (0..1, 0.5 = tuned default) means line weight / cell size /
seam / segments / depth / intensity / split per effect. Rules: a new source
fetch must call fetchSrc, never texture2D(u_src, …) (the PDF text plate
u_srcOrig and the ghosting u_prevSrc are the deliberate exceptions); FX
state (window._fx, _fxAmt, _fxSpeed, _fxNeg, _fxSolar, _fxHue, _fxMirror,
_fxFlipV, _fxZoom, _fxPanX/Y) is a property of the feed — stopVideo() and
camera-off reset it, and the LIVE FX right-column section (id liveFxSection,
R.updateCamFxUI) only shows while camOn||videoOn. The selfie mirror is now
u_fxMirror (preview == export); the old #gl.mirrored CSS flip is gone. The
effect clock u_fxTime is accumulated in setRenderUniforms at _fxSpeed with dt
clamped to 100 ms (speed changes don't jump, pauses don't fast-forward); a
saved loop still cuts visibly at the wrap for animated FX — known.

## RISO / STIPPLE with a live feed (2026-09-02)

Static-source modes: the master prepass is skipped for camera/video (a
snapshot master would go stale instantly). The live RISO path now runs the
MASTER's density stage per fragment — risoLiveDensity(): chord projection of
the adjusted source onto each ink (paper→ink, 2% burn floor), the MZ9 tone
curve (risoToneCurve, piecewise port of riso-amt.js TONE_CURVE) × coverage-
scale 1.7, a per-fragment solid-fill lift (v>0.55 → 1) — fed to the dither
INSTEAD of the separation coverage (cov still gates calBlend, as it does for
the static master). gpuGrainTouchLive() then binarises per would-be master
texel (JS uploads u_amtTexel for the current DPI every live frame, same
sizing rule as the prepass) and renders the static round-dot disc union
(≥1.8 px/texel) or the same 8-tap stochastic supersampling (finer). Measured
on one frame, static vs live: dot area 73.9 vs 73.6 (Chromium), 80.1 vs 80.8
(Safari); luminance within ~9 — the residual is FS worms vs blue-noise
placement through calBlend's nonlinearity, inherent. The old fallback
thresholded the separation coverage at a fixed 4-px NEAREST cell (user:
"dots are squares", "opaque video with dots on top"). The coverage split is
OFF in flat mode (the tail needs the source, not baked coverage). DENSITY
therefore applies live (dot pitch); STIPPLE dot size is still bake-only and
carries .live-disabled while camOn||videoOn. The live preview is capped at
8 fps in both modes (R.liveFps(); render loop, fps label and LOD target all
read it; setRisoFps toasts when the cap bites).

Harness trap met here: R._renderNow() BAILS while _amtPrepassRunning (and
while a variant compiles) and readPixels then returns the STALE buffer — the
"washed-out first render" was never a render. Read only after a
window._stDraws increment (see riso probes).

## Intel-Mac context-loss loop (2026-09-02)

An Intel Mac cycled "GPU restored — rebuilding" after the Live FX / live
RISO deploy: the megashader inlines every function at every call site, and
the FX geometry switch rode along on all ~25 srcUV() sites (plus the EDGE
Sobel on 19 fetchSrc sites) — enough extra shader for the iGPU's first 2x
frame to outrun the watchdog, and the recovery re-ran the same 2x probe, so
the loop never converged. Fixes: (1) FX is evaluated ONCE per fragment in
main() — g_fxDisp (effect displacement, reused by every srcUV; per-plate
deltas are sub-texel) and g_fxEdge; fetchSrc keeps only the tiny RGB-split
branch. (2) window._gpuSuspect (Intel renderer on a Mac) probes at 1x with
0.5 MP bands; ANY context loss this session drops the cap to 1x and bands to
0.5 MP. (3) The probe is normalised per megapixel: >50 ms/MP slow (2x cap),
17-50 mid (_gpuMid, 4x cap). (4) Live feeds never render the 6x dirty frame
(liveCap 3x); exports keep their own sizing. Cheap remote triage: ?diag
alerts the crash trail (gpu string, probe ms/MP, ctx:LOST count); ?safe
forces the slow-GPU caps; ?slim forces the per-mode slim variants.

