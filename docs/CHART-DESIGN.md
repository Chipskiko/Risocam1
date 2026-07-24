# RISO/CAM — INK-TEST CHART TEMPLATE SYSTEM
## Design specification v1.0 (implementable)

**Supersedes** the 5×5-coverage-grid + 625-patch-LUT proposal in `docs/INK-PHYSICS-PLAN.md`. That plan's two charts are (a) undersized in the dimension that matters (superposition-dependent dot gain), (b) oversized in the dimension that doesn't (uniform product grids), (c) silent on registration, banding, print order and capture, and (d) routed through an export path that cannot currently produce a valid chart. All four are addressed below.

**Scope symbol:** `k` = number of drums in the job (1–4). Everything is parameterised by `k` and by the actual ink set; there is no universal chart.

---

# 0. The one non-negotiable design axiom

> **The chart's ground-truth coverage is what was *rasterised*, not what was *requested*.**

Every patch's nominal ink-area fraction `a_nom` is obtained by **counting set pixels in the 1-bit plate raster inside the patch's active window**, at generation time, and writing that number into the chart model file. Nothing in the tone chain (`adjustRGB` → `toCMYK`/`nnlsDecompose` → `getCoverage` → screen) needs to be trusted, identity, or even understood. Any residual bias in that chain cancels because the fit never uses the requested value.

This axiom is what makes the chart robust against the entire class of defects the colour audit found (`calBlend` identity-YN, double-counted dot gain, driver-LUT stacking, the `u_amtJitter` export drift). Implement it first; everything else is refinement.

---

# 1. What must be measured, and why

Seven questions. They are separable, they need structurally different patches, and conflating them is what made the 5×5 grid useless.

| # | Question | Physical quantity | Structure that answers it | Why it cannot be folded into another question |
|---|---|---|---|---|
| **Q0** | **Capture chain** — what does the camera/scanner do to reflectance? | per-channel opto-electronic transfer + spatial nonuniformity + veiling glare | paper-white lattice distributed over the sheet; two flare probes; replicated anchors | Every other measurement is a *ratio to paper white measured in the same frame*. Without Q0 all of Q1–Q4 inherit the lens vignette and the lamp gradient. Ciaccheri: uncorrected phone colorimetry is mean ΔE\* ≈ 82. |
| **Q1** | **Single-ink tone response** — nominal plate area → printed reflectance | effective coverage `f_i(a)` (mechanical dot gain) + optical dot gain (paper PSF) | per-ink ladder **on bare paper** | Yang (JIST 2004): optical and physical dot gain are separable only if you have the pure-ink-on-paper curve; you cannot recover it from overprints. |
| **Q2** | **Overprint colour** — what does ink B on ink A actually look like | the 2^k Neugebauer solid colorants + the superposition-dependent ink-spreading curves `f_{i/J}` | all 2^k solid overprints (mandatory floor) + halftone-of-i-over-solid-J patches | **No Neugebauer-family model predicts this from ink-on-paper.** The 2^k solids are the calibration floor in every source in the literature. Hersch & Crété: superposition-dependent spreading cut mean ΔE94 by 1.7–3.4× vs one curve per ink. |
| **Q3** | **Trapping / print order** — does B-on-A ≠ A-on-B, and does drying change it? | a per-ordered-pair scalar `τ_{A→B}` scaling B's effective ink amount | the **same chart printed twice with the pass order reversed**, and once with a 24 h inter-pass delay | Irreducibly a *process* variable, not a patch variable: one region of one sheet can only receive one pass order. Costs print runs, not patches. Nguyen 2022: calibrate `τ` colorimetrically (ΔE-based), **not** with Preucil density trap. |
| **Q4** | **Show-through** | verso reflectance as a fraction of recto density, plus a show-through PSF markedly wider than the ink PSF | verso capture of a sheet carrying a full-area flood + a step wedge | RISO's own patent gives the anchor: front density 1.21–1.26 vs show-through 0.13–0.16, i.e. ~10–13%. Must be composited in *density* space (Sharma 2001), so it needs its own measurement, not a scaled recto number. |
| **Q5** | **Spatial uniformity / roller banding** | a slowly-varying multiplicative field `S(x,y)` = smooth 2-D surface × 1-D periodic term along the feed axis | a control lattice of identical mid-tone patches at ≥10 sheet positions (all tiers) + a **full-sheet 50 % flood** (T2+) | Aliases catastrophically with Q1 if the ladder is laid out in coverage order — a monotone density gradient down the sheet reads as a tone-curve change. This is the single strongest argument for randomised layout, and it is ISO 12642-2's own stated rationale ("uniform ink loading in each colour across the target area"). |
| **Q6** | **Registration error** | per-drum affine (Δx, Δy, rotation, scale) + its sheet-to-sheet distribution | per-plate fiducial band + inter-drum vernier pairs | Needed **twice**: as a simulation parameter (misreg is a feature of the medium) *and* as the input to the analysis step that computes where the overprint patches actually overlap. Without Q6 every overprint reading is contaminated by paper or single-ink edges. |
| **Q7** | **Repeatability / noise floor** | σ of a replicated patch (a) within a sheet, (b) across sheets, (c) across print runs | ≥2 replicates of every unique patch, ≥5 measured sheets | Sets the accept/reject thresholds and caps the number of resolvable tone levels (Wu & Dalal 2012). **Fit nothing whose effect is smaller than this.** Lee/Bala/Sharma put the floor at LUT interpolation ~1 ΔE76 + page-to-page 1.0–2.5 ΔE76 *on a laser printer*; riso will be worse. |

### 1.1 What we are actually calibrating

The fitted transfer is **plate raster → printed reflectance**, which includes the RISO driver's own transfer LUT and any rescreening it applies. That is correct for a simulator — it is the end-to-end thing the user sees. It means the chart model must record and the fit must be keyed on:

```
machine model · driver version · driver settings string (tone level, backlight correction,
  image processing mode) · print scale (must be 100 %) · master DPI · RISO/CAM screening
  mode + lpi + driver-LUT index · paper (name, gsm, batch) · ink per drum + drum serial ·
  print order · copies discarded · date
```

Change any of these and the fit is void. Surface that in the UI as a hard gate, not a warning.

### 1.2 Absolute vs paper-relative colorimetry — an explicit scope decision

The chart contains no colour of known reflectance. Therefore:

- **T1 and T2 are paper-relative.** Everything is expressed as reflectance factor relative to the unprinted stock measured in the same frame. This is sufficient for every model in §5 (YNSN, ink spreading, SCOP `j·(X_bg·X_fg)^k`, trapping scalars) because all of them are ratio models, and it is exactly the space the app's `calBlend` already works in.
- **Absolute CIELAB requires either** (a) the scanner path with a scanner ICC profile, or (b) a reference target (ColorChecker or equivalent) in frame. Offer both as optional; never claim absolute ΔE from a bare phone shot of a bare chart.
- Report ΔE00 **in the paper-relative space** and say so. Do not launder a paper-relative residual as a colorimetric one.

---

# 2. The tiered template family

## 2.1 Nesting is a construction rule, not a coincidence

Following ECI2002 (1485 patches a strict superset of IT8.7/3's 928, one print serving both) and Kennard–Stone's prefix property:

1. There is **one ordered master candidate list** per ink set, built once (§2.6).
2. `T1 = list[0 .. N1)`, `T2 = list[0 .. N2)`, `T3 = list[0 .. N3)`. Strictly nested.
3. **Physically nested too:** the T1 sheet is byte-identical in T1, T2 and T3. T2 adds sheets 2–3; T3 adds sheets 4–n. A user who printed T1 in March and T2 in July reprints nothing.
4. Every sheet independently carries: fiducial bands, Data Matrix sheet ID, paper-white lattice, control lattice, flare probes. This is what makes cross-sheet merging possible — the shared control lattice supplies a per-sheet scale/offset in paper-relative space that absorbs drift between print runs.
5. The tone ladder levels are themselves nested (§2.3).

## 2.2 Tier summary

| | **T1 — QUICK** | **T2 — STANDARD** | **T3 — FULL** |
|---|---|---|---|
| Sheets | 1 × A5 (k≤2) / 1 × A4 (k=3–4) | 2 × A4 (k=2), 3 × A4 (k=3), 4 × A4 (k=4) | 4–7 × A3 |
| Print runs | 1 (one pass per drum) | 3 (normal order, reversed order, delayed-dry) | 4 (+ juxtaposed-halftone run) |
| Copies to run | 20, keep 11–15 | 20 per run, keep 11–15 | 25 per run, keep 11–20 |
| Wall time | ~5 min print + 1 capture | ~25 min print + 24 h dry wait + 6 captures | ~2 h print + 2 days + 12–20 captures |
| Unique measured patches (k=2 / k=3) | 34 / 40 | 76 / 133 | ~290 / ~640 |
| Total slots incl. replicates + control (k=2 / k=3) | 60 / 100 | 264 / 430 | ~700 / ~1500 |
| Fit model | YNSN, global `u=1/n`, basic ink spreading + Bugnon single-point superposition | YNSN + full 3-point superposition-dependent spreading + SCOP fallback + trapping + banding + show-through | Cellular YNSN + per-ink `u` + fluorescent additive term + opacity + juxtaposed model + held-out CV |
| Held-out mean ΔE00, scanner | 4–6 | 2.5–4 | 2–3.5 |
| Held-out mean ΔE00, phone (raw) | 6–9 | 4–6 | 3–5 |

The T3 targets are the honest ceiling: Deshpande's SCOP reaches **2.06 ΔE00** on 7-colour *litho offset* with a spectrophotometer; Ashraf's fully-engineered fixed camera rig with a 928-patch training set reaches **3.07 mean / 17.8 max ΔE00**. Riso is a coarser, noisier, penetrating-ink process read by a worse instrument. Anyone quoting sub-2 ΔE00 from a phone photo of a riso print is quoting a training residual, not accuracy.

## 2.3 The nested tone ladder

Level placement follows Chang/Allebach's sequential-linear-interpolation principle — **density ∝ local nonlinearity** — not uniform steps. Riso's response is savagely concave in 0–30 % (the app's own scanned `RISO_CAL` LUTs put the knee between 10 % and 30 %).

```
T1 (10 levels):  0   3   7  12  20  30  42  56  72  100
T2 (18 levels):  + 5   9  16  25  36  48  64  85
T3 (36 levels):  + 1  2  4  6  8 10.5 14 18 22.5 27.5 33 39 45 52 60 68 78 92
```

**Why 10 and not 5 or 21.** Wu & Dalal: cap the level count at what the device noise can separate. Take the riso + capture noise floor at σ ≈ 2.0 ΔE00 (§4.4), demand 3σ separation between adjacent levels, and note the paper→solid axis spans ≈ 60–80 ΔE00 for a strong ink. That gives ⌊70 / 6⌋ ≈ **11 reliably separable levels**. Ten is that number, minus one for safety. Anything denser is fitting noise; anything sparser under-resolves the toe.

**Runtime placement rule (implement this, not the literal table):**

```
given prior model M (the app's current RISO_CAL curve for this ink),
  target ΔE00 spacing Δ = span(M) / (n_levels - 1)
  walk a in [0,1], emit a level whenever ΔE00(M(a), M(a_last)) >= Δ
  snap to a multiple of 1 % nominal; enforce min gap 2 %; force-include 0 and 100
  if no prior exists, fall back to the literal table above
```

Levels ≤ 50 % are the **fitting set for `n`**; levels > 50 % are the **validation set for `n`**. Ruckdeschel & Hauser: empirical n-determination is only valid below ~50 % coverage and becomes erratic in shadows. Do not fit n on shadow patches, ever.

## 2.4 T1 — QUICK: exact composition

Purpose: *"give me a correction today, from one sheet, in five minutes."*

| Group | Count (general) | k=2 | k=3 | Answers |
|---|---|---|---|---|
| Paper white, distributed lattice | 10 | 10 | 10 | Q0 flat field, Q5 |
| Solids (Neugebauer, ink-on-paper) | k | 2 | 3 | Q2 floor |
| Solid overprints (Neugebauer) | 2^k − k − 1 | 1 | 4 | **Q2 floor — mandatory** |
| Ladder interior steps, on paper | 8k | 16 | 24 | Q1 |
| Superposition anchors, `i` at 50 % over each non-empty solid subset `J` | k(2^(k−1) − 1) | 2 | 9 | Q2 (Bugnon single-point) |
| Mid-tone drift controls (50 % of ink 0 at fixed positions) | 8 | 8 | 8 | Q5, Q7 |
| Flare probes (black field/white well; white field/black ring) | 2 | 2 | 2 | Q0 |
| **Unique measured** | | **34** | **40** | |
| ×2 replicates of everything except the white lattice and controls | | +24 | +40 | Q7 |
| **Total occupied slots** | | **60** | **90** | |
| Furniture (fiducial bands, verniers, Data Matrix) | | outside the grid | | Q6 |

**Fits:** A5 safe area 128 × 190 mm at 16 mm pitch = 8 × 11 = 88 slots (k≤2). A4 safe area 190 × 270 mm at 16 mm pitch = 11 × 16 = 176 slots (k=3, k=4 at 170 slots).

**T1 determines:** per-ink `f_i(a)` on paper; paper white; all 2^k Neugebauer solid colorants; one superposition-dependent spreading parameter per (ink, backing) pair via the parabolic single-point form; a global `u = 1/n`; a 2nd-order flat field; mean per-drum registration offset for that sheet.

**T1 cannot determine:** print-order asymmetry (single pass order); wet/dry trapping; the *shape* of overprint tone curves away from 50 %; banding period (only a smooth surface); show-through; fluorescent emission; per-ink n; absolute colorimetry; anything about inks not in this set.

**Bugnon's parabolic single-point form** is what buys the small size — one measured patch per superposition curve instead of three:

```
f(q) = [2 − 4·q'(0.5)]·q² + [4·q'(0.5) − 1]·q      with f(0)=0, f(1)=1
```

where `q'(0.5)` is the effective coverage recovered from the single 50 % patch. Bugnon explicitly recommends this on noise-resilience grounds, which is exactly riso's problem.

## 2.5 T2 — STANDARD: what it adds

Sheet 1 = the T1 sheet, unchanged. Sheets 2–3 add:

| Group | Count | k=2 | k=3 | Answers |
|---|---|---|---|---|
| Ladder extended 10 → 18 levels | 8k | 16 | 24 | Q1 (fit `u` on 9 sub-50 % points, validate on 7) |
| Full 3-point superposition curves (25/50/75 for every `f_{i/J}`, J ≠ ∅) | 3k(2^(k−1) − 1) − (already have 50 %) | 4 | 18 | Q2 (Hersch & Crété) |
| SCOP 3-backing tint wedges: each ink at {10,25,50,75,100} over **grey** (50 % of the darkest ink) and over **solid black-equivalent** (the darkest ink at 100 %) | 10k | 20 | 30 | Q2 fallback: fits `j`, `k` per channel in `X = j·(X_bg·X_fg)^k` — **predicts unmeasured overprints**, incl. inks the user swaps in later |
| Pairwise mid-tone overprint surface, {0,25,50,75,100}² per unordered pair, minus edges | 16·C(k,2) | 16 | 48 | Q2 interior; validates the ink-spreading model |
| Show-through wedge (verso reading of recto steps 12/30/56/100 of the darkest ink) | 4 | 4 | 4 | Q4 |
| Registration statistics: verniers replicated at 4 sheet corners | furniture | | | Q6 (rotation + stretch, not just translation) |
| **New unique** | | **60** | **124** | |
| **T2 unique total (with T1)** | | **76** | **164** | |
| ×3 replicates + white lattice + controls | | ~264 | ~430 | |

**Plus three print runs of the same plates:**
- Run A: normal order (light → dark), passes back-to-back.
- Run B: **reversed pass order** → gives `τ_{B→A}` vs `τ_{A→B}`. Q3.
- Run C: normal order, **24 h between passes** → gives wet vs dry trapping. Q3.

**Plus a dedicated uniformity sheet** (part of sheet 3): a full-bleed 50 % flood of each ink in turn across the whole safe area, overprinted with a 20 × 28 lattice of 2 mm registration crosses from plate 0. Photographed/scanned as an *image*, not as patches. Q5, and the verso of this sheet is the Q4 flood measurement.

**T2 determines, in addition to T1:** full superposition-dependent ink-spreading curves; SCOP per-channel `j`,`k` (so overprints of pairs you didn't measure can be predicted at mean CIEDE2000 ~1.8–2.2 *on offset* — take ~3–4 on riso); the mid-tone overprint surface per pair; ordered trapping scalars and their wet/dry delta; the banding field including its feed-direction period; show-through amplitude and PSF width; registration distribution (μ, σ, rotation, stretch) from ≥15 sheets.

**T2 cannot determine:** interior cellular accuracy; per-ink n; fluorescent emission; opaque/metallic juxtaposition; triple-overprint tone surfaces beyond the solid.

## 2.6 T3 — FULL: what it adds

| Group | Count | k=3 | Answers |
|---|---|---|---|
| Cellular YNSN mid-level primaries: 3^k − 2^k | 19 | 19 | Cellular YNSN is the accuracy winner in every configuration of Hébert & Hersch's benchmark. 27 primaries for 3 inks. |
| Ladder extended 18 → 36 levels, **per backing** | 18k·2^(k−1) − prior | ~180 | Per-ink `u_i`; MPD-YN cross-check |
| Fluorescent block, per fluorescent ink `F`: 5 tints of `F` under and over each non-fluorescent solid, in **both** orders | 20 per (F, non-F) pair | varies | Emission attenuated separately in the excitation band and the emission band (Hersch 2008/2014) — order-asymmetric, which Beer–Lambert structurally cannot express |
| Juxtaposed-vs-superposed block for opaque/metallic/fluorescent inks: identical nominal coverage rendered dot-off-dot and dot-on-dot | 5 per ink pair × 2 | varies | Babaei & Hersch: opaque particles hide what is under them; model as juxtaposed colorants under barycentric subdivision, not as overprints |
| **Held-out validation set**, Kennard–Stone-selected from the *unused* candidate pool, never fitted | max(40, 25 % of fit set) | ~160 | The CV protocol. No paper in the chart-design literature formalises one for print targets — this is a genuine gap and RISO/CAM should close it explicitly. |

**Plus a second capture pass of every sheet under a UV/violet LED (395–405 nm)** in addition to the broadband capture. The difference image is the fluorescent contribution (Calabria & Rich's UVI/UVX experiment, done with a filter and a camera instead of a spectrophotometer). Blasinski's warning is load-bearing: **without varying the illuminant, the fluorescent and reflective components are mathematically unidentifiable.** One illuminant = no fluorescence model, full stop.

**T3 determines:** everything in T2, plus cellular-interpolated primaries; per-ink `u_i` combined as a coverage-weighted average; a rank-1 excitation×emission term per fluorescent ink; per-ink opacity from the 3-backing wedges; the juxtaposed/superposed blend coefficient per ink pair; and a defensible held-out accuracy number.

**T3 cannot determine:** illuminant-independent Donaldson matrices; absolute total radiance factor; quantum yields; anything requiring a bispectrometer. Say so in the UI.

## 2.7 The master candidate list and the selection algorithm

This is the piece that makes the counts above defensible rather than round.

```
STEP 1 — synthesise the pool  (Eckhard 2014: model the pool, print only survivors)
  For the user's ink set, evaluate the app's own forward model
  (js/sep-lut-worker.js `forward` / `forwardYNSN`) over a dense grid of ink duties:
  k=2 → 41^2 = 1681 candidates;  k=3 → 21^3 = 9261;  k=4 → 13^4 = 28561.
  Predict OKLab for each. Reject any candidate whose total ink exceeds the
  drum-count TAC limit for the paper.

STEP 2 — force the mandatory anchors to the front, in this order
  [paper] ++ [k solids] ++ [2^k − k − 1 solid overprints]
        ++ [k(2^(k−1) − 1) superposition 50 % anchors]
  These are the Neugebauer calibration floor plus the minimum superposition set.
  They are not negotiable and are not subject to selection.

STEP 3 — Kennard–Stone over the remainder, in OKLab, Euclidean distance
  (Khokhlova & Hardeberg: plain Euclidean beat CIEDE2000 for the *selection* step
   on all three of their datasets; select in the space you fit in.)
  repeat: pick the candidate maximising min-distance to the already-selected set.
  KS's boundary-inclusion property automatically pins gamut extremes.
  Emit the full ordering — this IS the nesting.

STEP 4 — D-optimal re-rank of the first N (model-aware, per Alsam & Finlayson)
  Let θ = free parameters of the tier's model
          (ink-spreading knots, u or u_i, per-primary reflectances, SCOP j/k, τ).
  Let J = ∂(predicted OKLab)/∂θ evaluated at the prior.
  Greedily swap candidates within the first N to maximise det(JᵀJ),
  subject to the STEP-2 anchors being immovable and to |ΔKS-rank| ≤ N/4
  (so nesting survives the re-rank).
  Alsam & Finlayson got 24 ColorChecker patches down to 13 this way;
  Bianco & Schettini report ~1/4 of a uniform grid at matched accuracy
  (vs ~1/3 for greedy) — that ratio is the size of the win and is why
  a one-sheet chart is viable at all.

STEP 5 — replicate and lay out (§3)
```

Run STEP 1–4 **offline per ink set** and cache the ordering; it is expensive and the user must never wait for it (Morovič 2010: do the search once at engineering time, ship a static ordering).

---

# 3. Patch layout

## 3.1 Patch size — derived, not chosen

Three independent constraints; take the max.

**(a) Halftone integration.** ISO 13655 requires the aperture to scale with screen ruling; riso's screen is coarse, so patches must be large. For an AM screen, per-cell area variance from stochastic master perforation is empirically ~5 % of cell area at midtone; averaging N cells gives se ≈ 0.05/√N. Demanding se ≤ 0.4 % area (≈ 0.3 ΔE00, comfortably under the print noise floor) needs N ≥ 156, i.e.

```
patch_active ≥ 14 × cell_size,  cell_size = 25.4 / lpi  mm
```

At 43 lpi → 8.3 mm. At 38.6 lpi → 9.2 mm. **For FM/grain (600 dpi error diffusion) the correlation length is ~0.15 mm and this constraint is inert.**

**(b) Camera sampling.** Require **≥ 4 sensor pixels per halftone cell** (else the periodic screen aliases against the Bayer grid and biases the mean) and **≥ 60 px across the active window**. A 12 MP phone filling A4's 190 mm gives ~21 px/mm → satisfied for any patch ≥ 3 mm at ≥ 25 lpi.

**(c) Registration guard (overprint patches only).** See §3.2 — reduced to ~1 mm by software, not by geometry.

**Result:**

| | active window | printed footprint | pitch |
|---|---|---|---|
| Single-ink patch | 10 mm | 14 mm | 16 mm |
| Overprint patch | 10 mm | 14 mm + 2·g | 16 mm + 2·g |
| White-lattice / control | 10 mm | 14 mm | 16 mm |

with `g` = registration guard, default **3.0 mm** on the first chart, and thereafter **`g = ceil(p95 of the measured |registration offset| + 1 mm)`** written into the chart model by the generator. A machine that measures out at ±0.8 mm gets a tighter chart on the next generation, which is a real patch-density win.

**Hard validity limit:** charts are only valid for **lpi ≥ 25** in AM mode (below that, `patch_active` would exceed 14 mm and the sheet budget collapses). Below 25 lpi, refuse to generate and tell the user the correction will be extrapolated from the nearest valid ruling. The app's 5 lpi preset would demand 71 mm patches — this is a real trap in the current preset ladder.

## 3.2 Registration robustness — the core algorithm

**The guard is not what makes overprints readable. Software is.**

Each plate prints its own fiducial band (§3.4). At analysis time:

```
for each plate p:
    detect plate p's 6 fiducials in the capture
    fit A_p : chart-coords → image-coords   (full affine: tx, ty, rotation, scale_x, scale_y, shear)
                                             (8-point homography if 8 fiducials are used)

for each patch P with participating plates {p1..pm}:
    foot_i  = A_{p_i} (P.printed_footprint_polygon)          # where ink i physically landed
    W       = erode( ∩_i foot_i , 1.0 mm )                    # sampling window
    if area(W) < 0.6 · area(P.active_window):  reject patch, flag "registration"
    sample W
```

Because the affine is recovered *per plate from that very sheet*, the guard only has to absorb the **residual after the affine** — local paper distortion, cockle, nonuniform feed — which is ~0.5–1 mm, not the 2–3 mm global misregistration. This is why the design tolerates bad registration rather than assuming good registration: **misregistration is measured, then divided out of the geometry.**

Corollary: **never assume a patch is where the layout says it is.** Every read goes through `A_p`.

## 3.3 Layout order: constrained randomisation

ISO 12642-2 supplies the rationale verbatim — randomise "with the goal of uniform ink loading in each colour across the target area to minimize interaction between patch areas". On riso this is more acute than on offset because drum ink feed and the master's ink-feed profile vary along the sheet.

But Lee/Bala/Sharma warn the opposite way: neighbouring patches cause integrating-cavity flare, and they recommend grouping similar colours. Resolve both:

1. **Every patch is surrounded by a 6 mm paper-white gutter** (16 mm pitch − 10 mm active). A constant white surround makes the flare contribution constant across the sheet, so it becomes a fitted offset rather than a per-patch bias. The two flare probes measure that offset directly.
2. **Positions are randomised under constraints**, by simulated annealing over slot assignments:

```
cost(assignment) =
    w1 · Σ_p [ var_rows(mean coverage of plate p) + var_cols(mean coverage of plate p) ]
  + w2 · Σ_p (max_row_mean_p − min_row_mean_p)²          # kills column/row ink starvation
  + w3 · Σ_{adjacent pairs} max(0, |Δa| − 0.5)²           # limits extreme dark/light adjacency
  + w4 · dispersion penalty on replicate pairs            # replicates must be far apart
  + w5 · penalty if any control-lattice slot moves        # controls are position-locked
  defaults: w1=1.0, w2=2.0, w3=0.3, w4=1.5, w5=∞
  anneal 200k swaps, T: 1.0 → 0.01 geometric
```

3. **Replicates of the same nominal patch must be ≥ 40 % of the sheet diagonal apart** — that is what turns them into a banding estimator (Q5) as well as a noise estimator (Q7).
4. **Ship both layouts** (ECI2002 precedent): `random` (default, for fitting) and `grouped` (ladders in order, for eyeballing). Same patch *set*, different placement. Separate the patch-set generator from the layout engine — this is ISO 12642-2's explicit architectural advice and it costs nothing to honour.
5. **The seed is part of the chart ID.** `layout_seed = sha1(ink_set_hash ‖ tier ‖ paper_id ‖ user_seed)[0:8]`, recorded in the model file. Same ID ⇒ byte-identical chart.

## 3.4 Furniture

Drawn **directly into the plate raster** as 100 %-coverage geometry — never through the shader, so no shader knob can corrupt them.

**Fiducial bands.** Plate `p` gets its own horizontal band at `y = y0 + p·14 mm` above the patch grid, and a mirrored band below. Each band carries **6 ArUco 4×4 markers, 12 mm**, at x = {8 %, 30 %, 50 %, 70 %, 92 %} of the safe width plus one deliberately asymmetric extra marker at 20 % so a 180° flip is unambiguous (Bala/Sharma/Venable: encode orientation into the target). Marker IDs encode `(plate index, sheet index)`. Because each plate's band is at a different `y`, no two plates' fiducials overprint and each is independently locatable at any registration error.

**Verniers.** For each ordered plate pair `(0, p)`, two comb pairs (one X, one Y) at each of the 4 corners of the safe area. Plate 0 draws a comb of 21 lines at pitch **1.00 mm**, 0.25 mm wide, 6 mm long; plate `p` draws 21 lines at pitch **1.10 mm** interleaved. The coincidence index resolves offset to **0.1 mm**, readable by camera *and* by eye — so the user gets a registration number even if the software path fails. Four corners → translation + rotation + scale.

**Sheet identity.** A **Data Matrix ECC200, 20 × 20 mm, plate 0 only**, top-left of the safe area, encoding `chart_id · tier · sheet_index · k · layout_seed · plate_count`. Doubles as a fourth pose anchor and lets the app auto-identify a photographed sheet with zero user input.

**Human-readable block.** Plate 0, 6 pt: chart ID, tier, ink names in pass order, paper, date field, "sheet __ of __", "discard first 10 copies", "print at 100 %, no auto-tone".

**Flare probes.** (i) a 30 × 30 mm 100 % solid of the darkest ink with a 10 mm unprinted well at its centre; (ii) a 30 × 30 mm unprinted field with a 10 mm 100 % solid at its centre. The difference between the well's reading and the distributed paper-white lattice reading is the veiling-glare coefficient; subtract it as a constant before fitting.

## 3.5 Handling roller banding

Three layers of defence, in order of cheapness:

1. **Randomised layout** (§3.3) — makes banding *noise* rather than *bias*. This alone prevents the catastrophic failure mode (a monotone feed-direction gradient read as a tone-curve change).
2. **Control lattice, all tiers.** 10 paper-white + 8 mid-tone control slots at fixed, known positions. Fit

   ```
   log r_measured(x,y) = log r_true + log S(x,y)
   S(x,y) = exp( poly2(x,y) )                                    # T1: 6 coefficients
   S(x,y) = exp( poly2(x,y) + a·cos(2π y/λ) + b·sin(2π y/λ) )    # T2+: λ = drum period
   ```

   T1 has 18 control observations and 6 unknowns — well-conditioned. Divide `S` out before fitting anything else.
3. **Uniformity sheet, T2+.** The full-area 50 % flood resolves `λ` (the drum circumference period, unknown a priori and unresolvable from 18 scattered points) via a 1-D FFT of the column-mean along the feed axis. Report peak-to-peak banding amplitude as a headline number and as a per-sheet quality gate.

> *Note:* ISO/TS 18621-21 (press-sheet macro uniformity, "M-Score") is the obvious standard metric for 1-D spatial nonuniformity and would be a natural fit here, **but it could not be verified** — it appeared only in search snippets and iso.org refused retrieval. Do not cite it until someone confirms it against the ISO catalogue.

---

# 4. Capture protocol and accept/reject

## 4.1 Two paths, and the honest recommendation

**Ship the scanner as the accuracy path.** A consumer flatbed with an ICC profile gives average ΔE76 **1.24–1.77**, 95th percentile under 4, max 5–10 (Asman/Rippetoe/Cooper, 12 printers, 4810 patches each). That is 2–3× better than the best camera result and far more repeatable, because illumination and geometry are fixed by construction. But heed Lee/Bala/Sharma: a generic 3-D RGB→Lab scanner profile does **not** generalise to multi-colorant overprints (~6–7 ΔE76 vs ~2–3 for a colorant-aware characterisation), so the scanner must be characterised **on riso-printed overprint patches**, not on a generic IT8/Q60 target — which the chart itself provides.

## 4.2 Scanner protocol

- 400 ppi (≥ 4 px per halftone cell at any valid lpi), 48-bit TIFF, **all auto-correction off** (unsharp mask, descreen, colour restoration, backlight correction — descreen especially will destroy the halftone statistics).
- Back the sheet with a stack of ≥ 10 sheets of the **same** paper (ISO 13655 white-backing requirement; critical on thin riso stock).
- Scan **4 times at 0/90/180/270°** and average after registration. Asman: this took max error from 8.05–16.68 down to 7.88 ΔE76.
- Warm-up scan discarded (some scanners drift for the first pass).
- Note the M-condition problem: brightened riso stock under a UV-rich scanner lamp will not match results under a warm one. Record the scanner model; the fit is keyed on it.

## 4.3 Phone protocol

- **Raw DNG, always.** JPEG's sRGB gamut clipping on saturated riso inks produces a "shouldering" artefact that no correction matrix can undo (Fyfe 2025). This is not a quality preference; it is a correctness requirement.
- AE and AWB **locked**, flash off, fixed focus, ISO ≤ 200.
- Two diffuse sources at ~45° from opposite sides, or open shade / overcast daylight. Never a single point source, never direct sun.
- **Near-normal capture, AR-enforced.** Fyfe: ΔE ≈ 11 at 15° off-normal, ≈ 18 at 75°, with blue patches degrading 240 %. Show a live tilt indicator from the fiducial quad; refuse capture above 8°.
- Fill the frame; the app computes required distance from the sheet size and the sensor.
- **Capture 3 frames and median them.**
- T3 fluorescent: repeat the whole capture under a 395–405 nm violet LED with the room dark, same exposure lock, plus one broadband capture at identical geometry. Include the unprinted stock in frame both times to get the paper's own OBA baseline.

## 4.4 Accept / reject criteria

Every one of these is computable from the capture alone. Fail any ⇒ "retake", with the specific reason named.

| Gate | Threshold | Source |
|---|---|---|
| Fiducials | all 6 per plate detected; affine residual RMS < 0.3 mm | Ernst 2013 (alignment cost as a retake trigger) |
| Data Matrix | decodes, and `chart_id` matches the expected chart | Bala 2003 (encode identity into the target) |
| Tilt | ≤ 8° off-normal from the fiducial quad | Fyfe 2025 |
| Sampling density | ≥ 4 sensor px per halftone cell **and** ≥ 60 px across each active window | anti-aliasing / SNR |
| Highlight clipping | 99.9th percentile of raw < 0.92 × full scale in every channel | Fyfe (near-white is where linear correction misbehaves) |
| Shadow headroom | darkest solid ≥ 12 counts above black level in every channel | Vrhel & Trussell (metrics break down at L\* < 15 once signal-dependent noise is modelled) |
| Illumination uniformity | after 2nd-order flat field from the white lattice, residual peak-to-peak < 3 % | Ashraf (flat-field is mandatory, not optional) |
| Within-sheet replicate agreement | σ of replicated patches ≤ **2.0 ΔE00** after flat-fielding | this *is* the noise floor; it sets everything else |
| Cross-sheet agreement | MAD across the 5 measured sheets < **2.5 ΔE00** | Lee: page-to-page 1.0–2.5 on a laser printer; riso worse |
| Registration usability | ≥ 90 % of overprint patches yield `area(W) ≥ 0.6 · active` | §3.2 |
| Correspondence-free cross-check | a 3×3 fit from Karaimer-style 3-D histogram alignment must agree with the patch-based fit within **3 ΔE00** | Karaimer & Nguyen 2020 — catches a shifted patch grid, which would otherwise produce a confidently wrong correction |
| Banding | flood peak-to-peak < 12 % (T2+); above that, warn that the machine needs servicing before calibration is meaningful | — |

## 4.5 Reporting the fit

Sharma's protocol, non-negotiable: **never a single mean ΔE.** Report on **held-out patches**:

- mean, median, **95th percentile**, max ΔE00
- a ΔE00 histogram / cumulative frequency curve
- separate ΔL\*, Δa\*, Δb\* (distinguishes a paper-tint cast from a tone-curve error)
- **a separate row for the dark end (L\* < 25)** — Vrhel & Trussell show this is systematically the worst region, and riso's deep overprints live there
- the measured noise floor from §4.4, alongside

**Go/no-go:** ship a correction only if `held-out mean ΔE00 < 4.0` (phone) / `< 2.5` (scanner) **and** `held-out mean < 2 × measured replicate σ`. If the second condition fails, the result is *capture-limited*: say so, and recommend the scanner path rather than shipping a correction that is fitting the camera.

---

# 5. Fitting models and tier upgrade

## 5.1 T1 model

```
1. Flat-field:   r ← r_measured / S(x,y)                          # §3.5
2. Flare:        r ← r − φ                                        # from the two probes
3. Paper-relative:  R = r / r_paper                               # per channel
4. Neugebauer primaries: the 2^k measured solid colorants, directly. No prediction.
5. Effective coverage per ink:
     invert Murray–Davies/YN on the ladder:
       R(a)^u  =  (1 − f(a))·R_paper^u  +  f(a)·R_solid^u          with u = 1/n
     fit f as a monotone cubic through the 8 interior ladder knots
     (reuse the existing Fritsch–Carlson implementation — three copies already agree)
6. Fit u GLOBALLY over all inks, on ladder points with a ≤ 0.5 ONLY.
     ** Parameterise by u = 1/n, not n (Viggiano). **
     ** Remove any n ≥ 1 clamp. Allow u to cross zero into negative n. **
     Expect negative n on absorbent riso stock — that is ink penetration, not a bug;
     n = −1 is algebraically ≈ Kubelka-Munk K/S.
     Validate on a > 0.5 points; report the shadow residual separately.
7. Superposition spreading: for each (i, J), one 50 % patch → q'(0.5) → Bugnon parabola.
8. Prediction: YNSN with Demichel area coverages, effective coverages solved by
   a 4–5 iteration fixed point that blends the f_{i/J} curves weighted by the
   surface coverages of the underlying colorants (Hersch & Crété).
```

Hébert & Hersch's calibration-cost table gives exactly this configuration for 3 inks — **8 solid primaries + 12 halftone patches at 50 %** — and reports superposition-dependent spreading beating basic spreading by **> 50 % error reduction**. T1 is that configuration, plus a properly-sampled per-ink ladder because riso's tone curve is far more nonlinear than offset's.

**Also implement MPD-YN (Mazauric 2018) as a selectable alternative**: same calibration inputs, closed-form spectral parameter per halftone, **no n sweep**. The win is not raw ΔE (it's on par) — it is removing a hand-tuned constant the project currently cannot justify. Given that the shipping shader's "Yule–Nielsen n=2" is algebraically an identity, this matters reputationally as much as numerically.

## 5.2 T2 model

Adds:
- **3-point ink-spreading curves** for every `f_{i/J}`, replacing the parabolic approximation where measured. Keep the parabola for any curve whose 3-point fit has residual above the noise floor (Bugnon's noise-resilience argument).
- **SCOP** `X = j_x·(X_bg·X_fg)^{k_x}` per channel, `j` and `k` regressed against dot area and ink sequence from the 3-backing wedges. This is the **generalisation path**: it predicts overprints for ink pairs never measured, at ~1.76–2.15 mean CIEDE2000 on offset (vs 2.89–2.92 for the plain uncorrected product). It roughly halves overprint error and is the highest-value single change if measuring all ink-on-ink solids for every possible drum swap is off the table.
- **Trapping** `τ_{A→B}`: a per-ordered-pair scalar that scales B's *effective ink amount* before it enters YNSN/SCOP, fitted colorimetrically from the reversed-order run. **Not** Preucil `(D_op − D_1)/D_2` — that is a densitometric QC metric that assumes density additivity, and Nguyen shows ΔEab is the more reliable indicator. Use Preucil trap only as a diagnostic readout, never as the model.
- **Wet/dry**: `τ` gets a second value; interpolate on the user's declared inter-pass delay.
- **Show-through**: verso density ≈ 10–13 % of recto density (RISO patent anchor), convolved with a show-through PSF **markedly wider** than the recto ink PSF, composited in optical density space (Sharma 2001) — which is what makes it correctly invisible under dark recto ink.
- **Optical dot gain as an explicit convolution**, separate from mechanical: exponential PSF `exp(−r/λ)` with λ per paper (Inoue/Tsumura/Miyake measured paper's PSF as exponential). This separates optical from mechanical dot gain — the separation the n-factor deliberately blurs — and is what stops simulated halftones looking like crisp digital dots.

## 5.3 T3 model

- **Cellular YNSN** with the 3^k node primaries; YNSN inside each cell, cellular subdivision outside.
- **Per-ink `u_i`**, combined per-patch as a coverage-weighted parabolic average (Rossier & Hersch). Their own honest caveat applies: for classical similar inks the gain is tiny — **only pay this cost for the genuinely odd inks** (11 of 28 are fluorescent, plus metallic gold and opaque white).
- **Fluorescent path replaces the multiplicative model entirely** for those inks:
  ```
  R_total(λ) = R_multiplicative(λ) + E_additive(λ)
  E = k · A_excitation(inks above, UV band) · A_emission(inks above, visible band)
        · F_ink(λ) · Q(coverage)
  ```
  with `Q` a saturating quenching roll-off (emission *falls* at high fluorophore concentration — the opposite sign to Beer–Lambert). `F_ink` is a rank-1 excitation×emission outer product per ink (Blasinski's single-fluorophore formulation — the cheapest form that is still physically correct), fitted from the dual-illuminant capture via Tominaga's three-function decomposition (reflection, excitation, emission) plus a scalar efficiency.
  Expect the largest errors on Fl.Pink-under-dark-ink and Fl.Yellow+Fl.Pink, and expect asymmetry between print orders — which the current model cannot represent at all.
- **Per-ink opacity** from the 3-backing wedges, blending the result between "multiply" and "replace" (Deshpande's 3-backing method, mean CIEDE2000 < 3 with a very small measurement set).
- **Juxtaposed model** for opaque/metallic/fluorescent inks under barycentric-subdivision cellular YNSN (Babaei & Hersch), calibration cost 2^N − 1 samples — sidesteps total-ink-limit and moiré entirely because inks are never superposed.
- **Held-out CV** on the reserved validation set.

## 5.4 Upgrade mechanics

```
measurement store: one record per (chart_id, sheet_index, print_run, sheet_serial, capture_id)
  { patch_id, a_nom[k], plate_ids, R_paper_relative[3], sigma, window_area_ratio, flags }

merge across runs:
  1. Sheets are joined by chart_id + ink_set_hash + paper_id + machine_id + driver_settings_hash.
     A mismatch on any is a HARD refusal, not a warning.
  2. Per-sheet drift term: from the shared control lattice, fit a per-sheet
     (gain, offset) in log paper-relative space. Every sheet carries the same
     control lattice precisely so this is always identifiable.
  3. Refit the tier's model over the union. Because the patch sets are nested,
     the T1 fit is a strict restriction of the T2 fit — a T2 refit can never
     invalidate the T1 data, only refine it.
  4. Report both: "T1 fit (34 patches, ΔE00 6.2)" and "T2 fit (76 patches, ΔE00 4.1)",
     and let the user keep the older one if they prefer it.

adding sheets later:
  the tool regenerates ONLY sheets 2..n. Sheet 1 is byte-identical to what was
  already printed (guaranteed by the deterministic chart_id → raster mapping, §7).
  A user who printed T1 in March prints 2 more sheets in July and gets T2.
```

**One asterisk, stated up front:** a T1 sheet printed months earlier reflects that day's machine state. The drift term absorbs a global scale/offset; it cannot absorb a changed drum, a re-inked drum, or a different paper batch. Give the user a one-sheet **"re-anchor"** option — reprint sheet 1 only, refit the drift term, keep sheets 2..n.

---

# 6. Riso practical constraints the design is built around

| Constraint | Consequence for the chart | Where it is handled |
|---|---|---|
| **Registration between drums is poor (and is a feature)** | No patch may depend on registration accuracy. Overprint sampling windows are computed per-sheet from measured per-plate affines and eroded intersections. The residual guard is ~1 mm, not 3 mm. | §3.2 — the single most important structural decision |
| **One drum per pass** | Every plate must be independently interpretable: its own fiducial band, its own ladder, its own control patches. No cross-plate dependency in the *geometry*. | §3.4 |
| **Pass order is fixed within a run** | Print-order asymmetry cannot be measured on one sheet. It costs a **second print run with reversed order**, not extra patches. | §2.5 run B |
| **Ink dries slowly; set-off is real** | Slip-sheet between passes. T2 includes a 24 h-delay run to separate wet from dry trapping. The verso is deliberately blank so it can serve as the show-through measurement rather than being contaminated by set-off. Capture ≥ 24 h after the last pass. | §2.5 runs A/C, Q4 |
| **First copies are light (ink-up ramp)** | Print 20, discard the first 10, measure sheets 11–15. Print the "discard 10" instruction *on the sheet*. | §2.2, §3.4 |
| **Paper feed varies: skew, stretch, cockle** | 6 fiducials per plate → full affine including rotation and per-axis scale. 4-corner verniers detect rotation and stretch independently. Cockle shows up as affine residual and trips the < 0.3 mm gate. | §3.2, §3.4, §4.4 |
| **Roller/drum banding along the feed axis** | Randomised layout so banding is noise not bias; control lattice divides out a smooth surface; T2 flood resolves the period. | §3.5 |
| **Master perforation is stochastic** (fibre-scale unperforated cells and merged cells) | Patch sizes are sized from the resulting per-cell variance (§3.1a). Per-patch spatial σ is stored and reported as a data-quality metric — an anomalously high σ means a bad master, not a bad model. | §3.1, §4.4 |
| **Riso can't print to the edge; leading-edge grip** | Safe area is inset 10 mm all round; 15 mm at the leading edge. Nothing measured lives outside it. | §3.1 |
| **Ink density varies with drum ink level** | The 8 mid-tone drift controls at fixed positions are a within-run drift readout; the cross-sheet MAD gate catches a drum running dry mid-run. | §4.4 |
| **Some inks are opaque / metallic / fluorescent** | These are not "an ink with a different colour" — they break the transparent-layer assumption. T3 routes them to juxtaposed halftoning and a per-ink opacity parameter. T1/T2 explicitly decline to model them and say so. | §2.6, §5.3 |

---

# 7. Generating the charts: requirements on the export path

## 7.1 Recommendation: a dedicated rasteriser, not the image pipeline

The archaeology is unambiguous: `exportSeparations()` (`js/save.js:925`) is a hand-maintained fork of `setRenderUniforms` with **17 uniforms drifted**, it inherits `u_amtJitter = 1.0` from the last live frame (so the one export that reaches a drum is the one that gets the stochastic taps), it never calls `bakeCalLutIfNeeded()`, it encodes plates as **JPEG q=0.85**, it hardcodes `ptPerPx = 72/300`, and it applies `misreg`, `layerSkews`, `layerAngles` and `u_simNoise` unless the mode happens to suppress them.

**Primary recommendation:** generate chart plates in a dedicated 1-bit rasteriser (`js/chart-raster.js`) that shares only the *screening kernel* with the render path — reusing `js/riso-amt.js`'s driver-faithful FS core and the `riso_halftones.json` threshold matrices directly. Charts never touch `adjustRGB`, `toCMYK`, `nnlsDecompose`, `getCoverage`, or `calBlend`. The separations export path is then used **only as PDF packaging**, or bypassed in favour of direct 1-bit PNG/TIFF plate files.

This is strictly less work than making the shader path safe, and it makes the axiom in §0 trivially true.

## 7.2 If it must go through the shader path: R1–R11

These are the conditions under which a chart rendered through `exportSeparations` is *valid*. Every one is currently violated.

**R1 — One uniform path.** Give `setRenderUniforms` a config parameter `{sepMode, sepSlot, isPhone, forceEdgeSoft, calibration}` and delete `js/save.js:976-1105`. Charts cannot be validated against a uniform set that drifts.

**R2 — Calibration render state.** `calibration: true` forces, for all four slots:
```
misreg = [0,0]         layerSkews = 0        layerAngles = 0 (or the chart's declared angle)
u_simNoise = 0         u_dotGain = 0         u_inkNoise = 0
u_pressVar = 0         u_densFlicker = 0     u_grainStatic = 1 (frozen)
u_ghosting = 0         u_bleed = 0           u_trappingPx = 0
u_amtJitter = 0        u_inkDissolve = 0     u_knockout* = 0
u_colorQuant = 0       u_paperTex = 0        u_usePaperPBR = 0
u_bright/contrast/sat/shadows/highlights = neutral
u_post{Exposure,Contrast,Sat} = 0
u_tonalGamma = 1.0     u_frameSeed = 0 (fixed)   u_stampSeed = 0 (fixed)
u_edgeSoft = 0
driver LUT = the index the user will actually print with (recorded in the model)
u_printArea = the chart's own safe-area rect
cropRect = identity
```

**R3 — Known coverage requires a shader branch.** The tone chain cannot be made identity: `getCoverage` (`index.html:1917`) applies a per-ink gamma, a 15 % S-curve and dot gain *unconditionally*. Add:
```glsl
// u_chartMode == 1: source texture channel c IS the coverage for plate c.
// Skip adjustRGB, separation and getCoverage entirely.
float cov = (u_chartMode > 0.5) ? texture2D(u_src, uv)[chan]
                                : /* existing path */ ;
```
Four lines per layer block (or one, if the layer blocks are ever hoisted into a function — see the pipeline audit's S5).

**R4 — Ground truth by counting.** After rasterising each plate at export resolution, for every patch: count set pixels inside the active window, divide by window area, write `a_nom` into the chart model. **This is the number the fit uses.** Do this even if R1–R3 are perfect — it costs nothing and makes the chart correct under a class of bugs nobody has found yet.

**R5 — Lossless plates.** PNG/Flate into the PDF, or 1-bit TIFF/PNG per plate alongside. **JPEG q=0.85 on a 1-bit halftone is disqualifying** — the ringing biases every area measurement.

**R6 — True 1-bit output.** Disable `exportSSAA` for charts (`js/save.js:82`) — a 2× box filter turns dots into greys. Render 1:1 at 600 dpi and threshold at 0.5. Verify the output histogram is bimodal with < 0.1 % intermediate values, else fail the generation.

**R7 — Exact physical geometry.** PDF page = the real sheet size in points (A5 = 419.53 × 595.28, A4 = 595.28 × 841.89, A3 = 841.89 × 1190.55). Image placed at exactly page size. Raster at an integer dpi. Kill the `ptPerPx = 72/300` assumption and the `8.267`/`A3_LONG_IN = 16.54` magic constants for this path.

**R8 — Master alignment (flat/stipple).** Master DPI ≥ export raster DPI, and the patch grid must be **pixel-aligned to the master texel grid** so patch edges land on texel boundaries. A half-texel edge on a 10 mm patch at 600 dpi is a 0.04 % area bias — negligible — but at 150 dpi in GPU-safe mode it is 0.17 %, and the guard band edges are worse. Force 600 dpi for chart generation and refuse to generate in `_gpuSlow`/`_gpuSoftware`.

**R9 — Determinism.** `chart_id → byte-identical plates`, verifiable by hash. Requires fixed seeds for: `frameSeed`, `_stampSeed`, the AMT prepass RNG, the stipple sampler seed, and the blue-noise/void-and-cluster generation. Add a `verifyChartDeterminism()` self-test that generates twice and compares SHA-256.

**R10 — Furniture bypasses the shader.** Fiducials, verniers, Data Matrix and text are composited into the 1-bit plate raster **after** the shader pass, as pure geometry. No shader knob can degrade them, and they remain readable even if the render is wrong.

**R11 — Fix the four defects that would silently corrupt a chart:**
1. `js/ui-controls.js:823` reads `window._saving`, which does not exist (`_saving` is a `let` in `js/state.js:242`). The stipple LIVE timer therefore keeps firing during a separations export and calls `R._stippleBindFrame(i)`, **rebinding texture units 9–12 in the middle of the per-plate export loop**. One-character fix, catastrophic blast radius for charts.
2. `u_amtJitter` inheritance (R1 covers it).
3. `raiseMasterForExport` (`js/save.js:53-67`) polls `window._amtPrepassRunning`, but `runAmtPrepass`'s `finally` clears the flag *before* scheduling the requeue with `setTimeout(…, 0)` — the poll can exit in that window and render against a stale-DPI or partially-uploaded master. Charts must use a completion token, not a boolean.
4. The shared `_amtPrepassRunning` guard with asymmetric requeue (`js/renderer.js:2499` vs `:2862`) can leave STIPPLE rendering RISO masters. Chart generation must assert the master engine matches the mode before rasterising.

## 7.3 The chart model file

Emitted alongside the printable PDF (Ernst 2013: ship the chart as a polygon-plus-reference-colour model, recover pose by homography, score with a colour-statistics cost).

```jsonc
{
  "schema": "risocam.chart/1",
  "chart_id": "a3f91c2e",              // sha1(ink_set ‖ tier ‖ paper ‖ seed ‖ generator_version)
  "tier": "T2", "k": 3, "sheet_index": 1, "sheet_count": 3,
  "paper": { "name": "…", "gsm": 100, "size_mm": [210, 297], "safe_mm": [10,15,10,10] },
  "print": {
    "order": ["Yellow", "Bright Red", "Black"],
    "screening": { "mode": "flat", "engine": "amt-fs", "lpi": null, "master_dpi": 600 },
    "driver_lut": 4, "raster_dpi": 600, "scale": "100%",
    "copies": 20, "discard_first": 10, "measure": [11, 15]
  },
  "geometry": {
    "pitch_mm": 16.0, "active_mm": 10.0, "footprint_mm": 14.0, "guard_mm": 3.0,
    "layout": "random", "layout_seed": "7c1a92be"
  },
  "fiducials": [ { "plate": 0, "id": 12, "type": "aruco4x4",
                   "poly_mm": [[8,20],[20,20],[20,32],[8,32]] }, … ],
  "verniers":  [ { "pair": [0,2], "axis": "x", "corner": "TL",
                   "pitch_a_mm": 1.00, "pitch_b_mm": 1.10, "origin_mm": [12, 262] }, … ],
  "patches": [
    { "id": "L1-030-r0", "role": "ladder", "ink": 1,
      "a_req": [0, 0.30, 0], "a_nom": [0.0000, 0.3078, 0.0000],   // <-- COUNTED, per R4
      "plates": [1],
      "active_poly_mm":    [[54,86],[64,86],[64,96],[54,96]],
      "footprint_poly_mm": [[52,84],[66,84],[66,98],[52,98]],
      "predicted_lab": [72.1, 41.3, 19.8],       // prior only; never used as truth
      "replicate_of": null, "control": false },
    …
  ],
  "flare_probes": [ … ], "control_lattice": [ … ], "white_lattice": [ … ],
  "validation_holdout": ["V-0001", …]            // T3 only; never fitted
}
```

## 7.4 What has to be true of the export path for the charts to be valid — the short list

1. `a_nom` is counted from the raster, not requested. **(R4 — if you implement only one thing, this)**
2. Plates are lossless and genuinely 1-bit. **(R5, R6)**
3. Zero misregistration, zero simulated noise, zero paper texture, fixed seeds in the *generated* chart. **(R2, R9)** — because simulated misregistration in the chart would be indistinguishable from the real misregistration we are trying to measure.
4. Physical geometry is exact and the raster dpi is declared. **(R7)**
5. The chart's screening mode, lpi and driver-LUT index are identical to what the user will use in production, and are recorded. Otherwise the fitted dot gain does not transfer.
6. Generation is deterministic and verifiable, so nested tiers are physically nested. **(R9)**
7. Unit 9–12 bindings are stable for the duration of the render. **(R11.1)**

---

# 8. Build order

1. **`js/chart-raster.js`** — deterministic 1-bit rasteriser reusing `RisoAmt`'s FS core + `riso_halftones.json`; emits plate PNGs + chart model JSON. Includes R4 pixel counting and the R9 determinism self-test. *No shader involvement.*
2. **Furniture library** — ArUco, verniers, Data Matrix, text. Pure geometry into the plate raster.
3. **T1 generator** (`k ≤ 2`, A5) end to end: candidate pool → forced anchors → Kennard–Stone → constrained-randomisation layout → plates + model file + a printed instruction sheet.
4. **Analysis pipeline** — Data Matrix decode → per-plate fiducial detect → per-plate affine → eroded-intersection sampling windows → flat field → flare → trimmed-mean extraction → the §4.4 gate battery.
5. **T1 fit** — YNSN, `u = 1/n` (unclamped, allowed negative), Bugnon single-point superposition, held-out reporting per Sharma.
6. **Ship, and measure a real riso.** Publish the numbers. There is no peer-reviewed literature on risograph reproduction and no published evaluation of any riso simulator's accuracy — a modest calibration study against measured prints would be the first.
7. Only then: T2 (SCOP, trapping, banding, show-through), then T3 (cellular, fluorescent, opacity, juxtaposed).

`docs/INK-PHYSICS-PLAN.md`'s own warning applies with full force: *"This can absorb unlimited effort."* T1 with the §4.4 accept/reject gate and the §4.5 go/no-go is a shippable unit. Resist bundling T2 into it.