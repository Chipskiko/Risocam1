# Plan: DBS-optimized threshold mask (research item #6)

Status: planned · Effort: M (offline tool S, integration S, validation M)

## What #6 is — and is not

The research verdict: **dot diffusion and DBS are not runtime algorithms.**
Dot diffusion trades visible class-matrix texture for parallelism; Direct
Binary Search needs thousands of passes. Their correct role here is **offline**:
use DBS (the highest-quality halftoning method known) to bake a *better
threshold mask*, which is then applied at runtime for free (one texture fetch +
compare — the same mechanism `gpuGrainTouch` / `u_bnVC` already uses). This is
exactly how production RIPs ship FM screens (Harlequin HDS, Kodak Staccato):
quality is computed once at design time, runtime is a lookup.

## Where the baked mask plugs in (already-existing consumers)

1. **Live-cam RISO** — `gpuGrainTouch` thresholds against `u_bnVC` (128² or 256²
   void-and-cluster). A DBS-optimized mask upgrades live grain quality with
   zero code changes beyond swapping the texture.
2. **Grain mode, Grain Touch sub-mode (ditherMode 7)** — same texture.
3. **(Optional later) instant RISO preview** — if we ever revisit research
   item #1, the mask is the preview engine. Skipped for now per the
   "looks like grain mode" concern; the fast FS master made it moot.

The true FS master path stays untouched — this does NOT replace the
driver-faithful CPU/WebGPU dither.

## Offline tool: `tools/bake-dbs-mask.js` (Node)

1. **Seed**: generate a void-and-cluster mask M (256×256, wrap-around
   toroidal), σ=1.5 Gaussian — standard Ulichney.
2. **DBS refinement**: for each gray level g (sparse ladder, e.g. 16 levels),
   threshold M at g → binary pattern P_g; run DBS swap/toggle passes on P_g
   minimizing HVS-weighted error (Gaussian CSF, σ≈1.3 @300dpi viewing) with
   **toroidal wrap** (mask must tile seamlessly). Constrain swaps to preserve
   the *stacking property* (pixel on at level g stays on at g+1) — this is the
   standard "DBS-optimized dither array" construction (Allebach et al.): the
   result is a single threshold array whose every level is DBS-quality.
3. **Output**: 256×256 PNG (single channel, threshold = luminance) →
   `textures/bn_dbs_256.png` + a JSON sidecar with build params.
4. **Cost**: minutes of Node time, once. No runtime cost change (texture fetch
   is identical).

## Integration steps

1. Loader: replace the procedural V&C build for `u_bnVC` (renderer.js, unit
   bound near the other utility textures) with the PNG (keep procedural as
   fallback if fetch fails). NEAREST + REPEAT unchanged.
2. Per-channel decorrelation: sample with per-ink offset/90° rotation so C/M/Y/K
   grains don't correlate (cheap uniform; avoids channel "clumping").
3. `u_risoGrainScale` calibration: re-check live-cam grain pitch against the
   600 dpi FS master at reading distance (the mask period changes character
   slightly; one constant).

## Validation

- Tile a 0→100% ramp; compare radially-averaged power spectra (blue-noise:
  energy concentrated near principal frequency, no low-freq lump) before/after.
- A/B screenshots: live-cam RISO + Grain Touch, old V&C vs DBS mask.
- Check seam-free tiling (render 4× tiled region, look for grid).

## Decision points for later

- Mask size 256 vs 512 (512 = less visible repeat at very low grain scales,
  4× memory — still tiny).
- Whether to also ship a per-level "stacked" 3D LUT (overkill; flat threshold
  array is what RIPs use).
