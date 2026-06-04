# Spec: Resolution-stable, calibratable SCREEN tone (Murray–Davies–Yule–Nielsen)

Status: proposed · Target: `index.html` fragment shader (screen path, `u_mode==1`)
+ `js/renderer.js` (uniforms). Author: bug-sweep follow-up.

## 1. Problem

Screen-mode tone reproduction is currently **emergent**, not closed-form. The
dot mask (`screenSampled`, index.html:1441) is a per-pixel binary-ish fill,
4×-supersampled; `calBlend` (index.html:2093) then applies Beer-Lambert + YN
**per pixel**, and the visible *tone* is whatever the eye + the browser's
downscale average out of that. Consequences:

- **Tone drifts with render resolution** (retina vs not, the `×` button, the
  reverted cell-floor bump). Brightness is a function of how many device pixels
  land per halftone cell — not a property of the ink.
- **Partial-coverage math is Beer-Lambert** (a *thickness* model: `paper·ink^d`)
  where clustered dots want an *area* model (`(1-a)·paper + a·ink` in YN space).
- **`n` is hardcoded at 2**; not fit to scan data.

Goal: make screen tone a closed-form function of **analytic dot area `a`** and a
**calibratable `n`**, identical at any resolution, while still showing the dot
texture.

## 2. Model

### 2.1 Single ink on a substrate — Murray–Davies–Yule–Nielsen (MD-YN)

For fractional dot area `a ∈ [0,1]`, substrate reflectance `Rin`, solid-ink
reflectance `Rsolid`, Yule-Nielsen factor `n ≥ 1`, per RGB channel:

```
R_cell = ( (1 - a) · Rin^(1/n) + a · Rsolid^(1/n) )^n
```

- `n = 1` → linear Murray–Davies (no optical gain).
- `n → ∞` → maximum optical dot gain.
- `n = 2` reproduces the current sqrt-space behavior as a *special case*, but now
  driven by analytic area instead of per-pixel density.

**Resolution-independent** because `a` is analytic (from coverage), not counted
from pixels.

### 2.2 Overprint — sequential substrate (keeps current architecture)

Plates already composite in sequence (`result` threaded through layers,
index.html:2434–2566). Keep that. For each plate:

1. `Rin` = substrate reflectance entering this plate (= previous `result`).
2. `Rsolid` = the plate's **solid** ink printed over `Rin`:
   - process/transparent ink (`u_transparentN > 0.5`): `Rsolid = Rin · T`, where
     `T = clamp(p100 / u_paper, 0.001, 1.0)` is the ink's transmittance
     (subtractive — C over M stays blue).
   - opaque spot ink: `Rsolid = mix(Rin · T, p100, opacity·u_opacityCap)`.
3. `R_out = MDYN(a, Rin, Rsolid, n)`.

This is the per-plate generalization of §2.1; no 16-primary Neugebauer table
needed. (Full Demichel/Neugebauer is a future option if we measure overprint
swatches — noted in §8.)

### 2.3 Showing the dots without re-introducing resolution dependence

We want the **average** over a cell to equal `R_cell` (the physics) but still
render visible dots (the look). Use **modulation around the analytic mean**:

```
display = R_cell + (dotMask - a) · u_dotTexContrast · (Rsolid - Rin)
```

- `dotMask ∈ [0,1]` = the existing supersampled dot fill (`screenSampled`).
- Mean of `(dotMask - a)` over a cell ≈ 0 (area-correct dot ⇒ mean(dotMask)=a),
  so **the cell average stays `R_cell` at any resolution**. Resolution only
  affects texture sharpness, never tone.
- Inside a dot: pulls toward `Rsolid`; outside: toward `Rin`. The YN optical-gain
  offset (`R_cell − linearMD`) is shared across ink *and* paper pixels — which is
  physically right: optical gain is light diffusing *under the paper around* the
  dot, so the paper near dots genuinely darkens.
- `u_dotTexContrast` (default 1.0): 1 = crisp dots, <1 = softer toward flat tone.

Clamp `display` to `[0,1]` per channel.

> Alternative considered: supersample the binary mask in YN space and average.
> Rejected as primary — it's only exact when the supersample fully resolves the
> cell, so it stays resolution-bound (today's bug) at high LPI. Keep as a debug
> fallback (`u_dbgScreenYNSuper`).

### 2.4 Analytic dot area `a(coverage)`

Baseline: **area-correct, no mechanical gain** ⇒ `a = coverage`. The rendered dot
is already sized so `mean(dotMask) ≈ coverage` (area-correct radius
`r = sqrt(cov/π)`), so `a = coverage` keeps §2.3's mean-cancellation valid.

Optional **mechanical dot gain** (ink physically spreads): remap
`a = coverage + g · sin(π·coverage)` (TVI bump, `g = u_mechGain`, default 0).
If used, the **dot rendering must use the same `a`** to size the mask (feed `a`,
not `coverage`, into `screenSampled`) so mean(dotMask) still equals `a`.

> Note on merging: at `coverage > π/4 ≈ 0.785` round dots touch and overlap. As
> long as the dot *renderer* remains area-correct through the merge regime (mask
> mean tracks `a`), §2.3 holds with no extra term. If the current renderer's
> merge regime is not area-true, fix it there (size the dot to hit area `a`),
> not in the tone model.

## 3. Shader changes (`index.html`)

### 3.1 New uniforms

| uniform | type | default | meaning |
|---|---|---|---|
| `u_screenMDYN` | float | 1.0 | 1 = MD-YN path, 0 = legacy calBlend (A/B toggle) |
| `u_screenN` | float | 2.0 | global Yule-Nielsen `n` |
| `u_inkN[4]` | float[4] | all 2.0 | per-ink `n` override (optional; falls back to `u_screenN`) |
| `u_dotTexContrast` | float | 1.0 | dot texture strength (§2.3) |
| `u_mechGain` | float | 0.0 | mechanical dot-gain `g` (§2.4) |
| `u_dbgScreenYNSuper` | float | 0.0 | debug: YN-space supersample instead of MD-YN |

### 3.2 New functions

```glsl
// Murray–Davies–Yule–Nielsen, per channel.
vec3 mdyn(float a, vec3 Rin, vec3 Rsolid, float n){
  float inv = 1.0 / max(n, 1.0);
  vec3 p = mix(pow(max(Rin,    vec3(1e-4)), vec3(inv)),
               pow(max(Rsolid, vec3(1e-4)), vec3(inv)), a);
  return pow(p, vec3(n));
}

// Solid ink printed over the running substrate (subtractive / opacity).
vec3 solidInkOver(vec3 Rin, vec3 inkP100, float transparent, float opacity){
  vec3 T = clamp(inkP100 / max(u_paper, vec3(0.01)), vec3(0.001), vec3(1.0));
  vec3 subtractive = Rin * T;
  return (transparent > 0.5)
       ? subtractive
       : mix(subtractive, inkP100, clamp(opacity * u_opacityCap, 0.0, 1.0));
}

// Analytic dot area from coverage (+ optional mechanical gain).
float dotArea(float coverage){
  return clamp(coverage + u_mechGain * sin(3.14159265 * coverage), 0.0, 1.0);
}
```

### 3.3 Per-plate integration (replace the screen branch of calBlend)

In each layer block (index.html ~2434, 2477, 2517, 2560) the call today is
`calBlend(result, paper, coverage, grain, …)`. For `u_mode==1 && u_screenMDYN>0.5`
substitute:

```glsl
float a       = dotArea(coverage);
float dotMask = grain;                       // screenSampled output (AA, supersampled)
float nF      = u_inkN[idx] > 0.0 ? u_inkN[idx] : u_screenN;
vec3  Rin     = result;
vec3  Rsolid  = solidInkOver(Rin, p100, layerTrans, layerOpacity);
vec3  Rcell   = mdyn(a, Rin, Rsolid, nF);
vec3  disp    = Rcell + (dotMask - a) * u_dotTexContrast * (Rsolid - Rin);
result        = clamp(disp, 0.0, 1.0);
```

- `coverage` from `getCoverage`/`getCoverageApprox` (unchanged; per-ink TRC + gamma
  stay upstream — they shape the coverage that feeds `dotArea`).
- `layerTrans` / `layerOpacity` = existing `u_transparentN` / opacity inputs.
- Grain/RISO/lines paths untouched (legacy `calBlend`).
- Feed `a` (not `coverage`) into `screenSampled` **iff** `u_mechGain > 0`, so the
  mask mean matches the area used for tone.

## 4. Calibration of `n`

Data: `risocam_project/tools/scan_analysis.json` (per-mode TRC; Screen 40/90
convex) + the measured swatch ladder in `js/data.js` (paper/p10/p30/p50/p70/p100).

Procedure (offline, Node, emit a constant or a small LUT):

1. For each ink, for each measured tint coverage `c_k` with measured reflectance
   `R_k` (RGB), and known `Rin=paper`, `Rsolid=p100`:
   solve `n` minimizing `Σ_k Σ_channel ( MDYN(c_k, paper, p100, n) − R_k )²`.
2. 1-D search on `n ∈ [1.0, 4.0]` (convex enough for golden-section or 0.05 grid).
3. Output per-ink `n` → `u_inkN[]`; sanity-check it reproduces the Screen TRC
   shape (convex 40/90) from the scan analysis.

If per-ink data is thin, fit one global `n` (`u_screenN`) and leave `u_inkN` = 0
(fallback). Expected range ~1.6–2.2 for uncoated RISO stock.

## 5. SPOT vs CMYK / clean mode / SEPS

- **CMYK & SPOT**: identical — both yield per-plate `coverage` + `p100`; MD-YN is
  agnostic. Process inks `transparent=1` (subtractive); spot inks use opacity.
  This also closes the prior CMYK↔SPOT divergence *for the tone stage*.
- **Clean screen** (`u_simNoise=0`): unaffected — MD-YN is already clean; dots
  still render via `dotMask`, contamination already gated.
- **SEPS export**: unchanged — it outputs coverage/`1−d` directly, never reaching
  the tone stage.

## 6. Anti-aliasing / moiré

Tone is now analytic, so supersampling only affects the **texture** term, never
tone — moiré in the dot pattern can no longer bias brightness. Keep the existing
4-tap `screenSampled`. (This is the property the reverted cell-floor bump was
groping for, achieved correctly here.)

## 7. Validation

1. **Resolution invariance**: render a 0→100% coverage ramp; read back per-cell
   mean reflectance at `resScale` 1/2/4 and dpr 1/2. Assert mean per coverage is
   invariant within ε (e.g. ΔL* < 0.5). This is the acceptance test the current
   path fails.
2. **TRC match**: compare the analytic ramp to `scan_analysis.json` Screen TRC;
   tune `n`.
3. **Overprint**: C+M solid dots → blue (no purple tint); C over M order
   commutes within tolerance.
4. **Visual**: dots visible and crisp at `u_dotTexContrast=1`; tone unchanged as
   the window resizes. A/B via `u_screenMDYN`.

## 8. Rollout

1. Land behind `u_screenMDYN` (default **0**) — legacy path stays default until
   validated. Wire a debug checkbox.
2. Calibrate `n`; verify §7.
3. Flip default to **1**; keep legacy reachable via debug for one release.
4. Bump `renderer.js` cache pin.

**Future (optional):** full Demichel/Neugebauer with measured 2-ink overprint
swatches for exact secondary colors (replaces §2.2 sequential approximation);
spatially-correlated dot placement for true rosette moiré.

## 9. Risk / cost

- Per-fragment cost: one `pow`-pair per plate (cheaper than the current
  multi-stage `calBlend`; the redundant 4× NNLS in SPOT is the real cost and is
  orthogonal).
- Behavior change: tone *will* shift vs today (today is wrong/resolution-bound).
  Gated + calibrated, so it's a deliberate, validated change — not a surprise.
