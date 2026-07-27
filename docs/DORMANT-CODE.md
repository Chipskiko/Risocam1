# Dormant code — what is still in the tree but not offered

Everything listed here is **live code that still compiles and runs**; it is just
not reachable from the UI. Nothing was deleted, so each item is a small edit to
restore. This file exists so that a future session does not mistake any of it
for dead weight and rip it out, or re-implement something that already exists.

Last updated: 2026-07-27.

---

## Whole modes

### LETTERS (`mode === 'letters'`)
Hidden: `#modeLetters` has `display:none`; dropped from `PH_MODES` in phone.js.

Still present: the entire ASCII/stamp engine — glyph atlas builder with tofu
detection, charset cycling (Latin / Georgian / mixed), custom font upload, the
anchor-tone prepass (`u_asciiTonePass`, 3×3 quadrant sampling), and export
parity in save.js. ~112 references.

To restore: unhide the button and re-add `'letters'` to `PH_MODES`.

### STIPPLE (`mode === 'stipple'`)
Hidden the same way (`#modeStipple`).

Still present: `js/stipple-core.js` (Poisson variable-radius sampler),
`js/stipple-worker.js`, `runStipplePrepass()`, the LIVE frame-pool playback on
its own `setInterval`, and `u_amtCrisp` coverage-field thresholding. ~146
references across 10 files.

Note: stipple and RISO share texture units 9–12 and the `_amtPrepassRunning`
flag. If stipple is revived, see the known hazard below.

### RISO (`mode === 'flat'`)
NOT dormant — it moved. RISO is now a **sub-mode of GRAIN**, reached by the
engine button next to the dpi control. `#modeFlat` is hidden from the mode bar
because the mode is still `'flat'` internally; only its entry point changed.

---

## Sub-modes and controls

### Error-diffusion dithers — DELETED, not dormant
Atkinson, Floyd–Steinberg, Stucki and JJN were **removed from the shader**
(`ditherMode` 1–4) in commit `0e58582`, along with their four functions.

Do not re-add them in that form. All four were the same trick — a weighted
average of a few noise-texture samples, then a threshold — which is a mild
low-pass of one field and cannot express what distinguishes these algorithms
(sequential error propagation, impossible in a fragment shader). Measured
pairwise difference among them was 3.6–7.7, against ~34 between genuinely
distinct modes.

Real Floyd–Steinberg **does** exist: the RISO engine runs true serpentine FS on
the CPU worker with the measured MZ9 driver tables. That is the one to use.

### Bayer 4 / Bayer 8
Removed from `DITHER_MODE_STEPS`; `bayer4Dither` / `bayer8Dither` still exist in
the shader and are genuinely distinct looks (~34 apart from Grain). Restoring
them is two lines in the step table.

### Trapping (`u_trappingPx`, `trappingBtn`)
Parked — button hidden, state and shader intact.

It currently applies only to the PDF text-knockout path and is a symmetric
4-sample erosion of the text mask. It never consults `layerOrder`, so it cannot
decide which plate should spread and which should choke — which is what
trapping actually is. See the Wikipedia "Trap (printing)" definition: *the first
colour printed is spread under the next*. Doing it properly means per-plate
spread/choke driven by print order, with the last-printed plate as the key.

Not to be confused with **ink trapping** (how much ink transfers onto already
inked paper) — that is a colour effect, tracked separately in
`INK-PHYSICS-PLAN.md`.

### Ring density (`u_lineCount`, `lineCountBtn`)
Removed from the UI. The uniform still exists and defaults to 1.0.

Reason it went, which is worth not re-discovering: in CONCENTRIC the shader
computes `cellPxAdj = cellPx / u_lineCount`, and in RADIAL/SPIRAL
`spokes ∝ (1/cellPx) × u_lineCount`. Verified numerically — lpi 10 with count 1
and lpi 5 with count 2 both give `cellPxAdj = 16.874`, i.e. identical ring
geometry. So it was the same degree of freedom as DENSITY.

Worse than redundant, in fact: `u_screenCell` also feeds tone-compensation
terms (`edgeFrac = 1.5/u_screenCell`, `kk = 0.36·log(12.5/u_screenCell)`) which
use the RAW cell, not the adjusted one. Changing ring spacing via `u_lineCount`
therefore left the tone compensation calibrated for the wrong cell size.

If ring spacing ever needs a wider range, widen the `lpi` steps in `data.js`
rather than reviving this.

### LETTERS sentence sub-mode
Removed from the UI on request. `_lettersMode` is pinned to 0 and `u_wordLen`
to 0 in both the live and export paths, so the shader's word-strip path is
dormant rather than cut out of the megashader.

### Clean halftone (`_screenClean`)
Button removed from SCREEN. `window._screenClean` and its shader gating remain.

### Drum pressure (`inkSpreadBtn`, `cycleInkSpread`)
Buttons removed from mode settings on desktop and phone; the handler and
`u_amtInkSpread` remain. POST reaches the same result.

---

## Flags and escape hatches (not UI, but easy to lose)

- `?grainblue` — Void-and-Cluster blue-noise grain threshold. Off by default
  because it shifts tone by up to −26/255 in the highlights; see the commit for
  the measurements.
- `window._pinSeed` — pins `frameSeed` so repeated renders of an unchanged
  state are pixel-identical. `lab.html` sets it. Without it STILL mode re-rolls
  on every dirty render and puts ~20/255 of churn under any A/B comparison.
- `?slim`, `?webgpu`, `?safe`, `?noamt`, `?diag`, `?remote` — see renderer.js.
- The `u_dbg*` uniforms (12 of them) isolate individual stages of the ink
  model; `lab.html` sweeps them.

---

## Known hazard if STIPPLE is revived

`_amtPrepassRunning` is shared by the RISO and stipple prepasses, but the
requeue in each `finally` is mode-asymmetric (`renderer.js` requeues only if
`_mode === 'flat'`; the stipple one only if `_mode === 'stipple'`), while
`setMode` invalidates across the boundary. Switching modes mid-bake can
therefore drop a requeue. The fix is two flags rather than one.
