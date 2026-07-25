# MEASUREMENT & FITTING PIPELINE — 7-drum campaign
## Scanned sheets → shipped model data

Read: `docs/CHART-DESIGN.md` (621 lines), `docs/INK-PHYSICS-PLAN.md`, `docs/LITERATURE.md` (ink-optics, fluorescent, camera-cal, chart-design, riso-repro strands), `js/data.js`, `js/sep-lut-worker.js`, `js/cal-lut-worker.js`, `js/renderer.js:1338-1400 / 2000-2170`, `index.html:2366-2585`.

This document instantiates `CHART-DESIGN.md` §4–§5 for the seven owned drums and specifies everything downstream of "the ink is dry."

---

## 0. Four findings that reshape the pipeline before we start

These are verified against the tree and they change what the fit can and must do.

**0.1 The compositing chain runs in sRGB-encoded space.** `calBlend` (`index.html:2409`) receives `u_paper = (0.910, 0.912, 0.908)` (`js/renderer.js:1338`) and the `RISO_CAL` LUT values, and does `sqrt`/`pow` on them directly. Nothing linearises. The only `pow(x, 2.2)` in the shader is inside `toCMYK` behind `u_dbgLinearize` (`index.html:736`) and inside `rgbToXYZ` (`:790`). So today's "Beer–Lambert" is Beer–Lambert on gamma-encoded numbers. **Consequence for the fit: a Yule–Nielsen exponent fitted in encoded space is meaningless and will not transfer to another ink, paper or screen — it would be absorbing the display gamma.** The pipeline below produces *linear reflectance factor*, and §4 specifies the shader-side linearisation. This must be decided before a single sheet is scanned, because it determines what the stored numbers mean.

**0.2 The no-op is a *conflation* bug, not a missing exponent.** `calBlend` stage 4 is `result·ink^d` because `paperYN·inkYN^d` then squaring cancels. But the deeper problem is that `d` is simultaneously used as **fractional area covered** and **ink amount within a dot**. Yule–Nielsen is a statement about averaging *over an aperture containing both covered and uncovered area*. With only one variable there is no area mix, so no exponent can do anything. The fix requires splitting `d` into `aArea` and `dAmt` — see §4.2. `u_dbgYNArea` (`index.html:2436`) already has the correct structure (`transmit = ink/safeP`, mix in YN space) but hardcodes `aArea = grain > 0.01 ? 1 : 0` and `nf = 2.0`.

**0.3 The measurement can and should break the n-identifiability degeneracy directly.** If ink spreading `f(a)` is a free monotone curve and `u = 1/n` is free, the pair is unidentifiable from a single-ink ladder alone — any `u` can be absorbed by reshaping `f`. Hersch's escape is to fit `f` at fixed `n` and pick `n` on *other* patches. There is a better option here: **scan a dedicated strip at 2400 ppi and threshold it to measure printed dot area directly.** That pins the mechanical half, leaving `u` (and the PSF) to explain only what is left. This is ~70 extra patches and it converts the most fragile parameter in the model from "fitted by argument" to "measured." It is the highest-value single addition in this document.

**0.4 With k = 7 the combinatorics forbid the classical Neugebauer floor.** 2^7 = 128 solid primaries, 7·2^6 = 448 superposition curves. Both are off the table. The campaign is therefore structured as **all 21 unordered pairs, both orders (42 ordered solid overprints), plus a selected 10 triples**, and everything above |J| = 1 is *predicted and validated*, never fitted. This is stated as a hard scope boundary in §3.3.

---

# 1. SCANNER PROTOCOL

## 1.1 Instrument and why it must be the accuracy path

Ship the scanner path. Asman/Rippetoe/Cooper: consumer flatbed + ICC profile gives mean ΔE76 1.24–1.77, p95 < 4, max 5–10 over 4810 patches × 12 printers. The best fixed-rig *camera* result in the literature (Ashraf & Sapaico, raw, flat-fielded, polarised, 928-patch training set) is mean ΔE00 3.07 / max 17.8. The phone path stays in the product as the end-user refinement layer; it is not how the shipped dataset gets made.

**Required scanner class:** A3 flatbed, CCD (not CIS — CIS has a shallow DOF and a strongly structured cross-scan illumination), ≥ 4800 dpi optical, e.g. Epson Expression 12000XL / 10000XL / GT-15000. If only an A4 scanner is available, see §1.6 (guillotine plan) — do **not** tile-scan an A3 sheet.

## 1.2 Driver settings — every one of these is load-bearing

| Setting | Value | Why |
|---|---|---|
| Mode | Professional / "no colour correction" (device RGB out) | any ICC-on-the-fly conversion is a nonlinear per-pixel op applied *before* we average — see §2.5 |
| Resolution | **400 ppi** for patch sheets; **2400 ppi** for the MDG strip; **200 ppi** for verso show-through | §1.3 |
| Bit depth | 48-bit RGB TIFF, LZW or uncompressed. Never JPEG. | 8 bit is 1/255 ≈ 3 % relative at R = 0.03; the deep overprints live there |
| Gamma | **1.0 (linear)** if the driver offers it (VueScan: "Output › Curve = None", gamma 1.0; SilverFast: HDR RAW 48). Else §2.5 OECF inversion. | linearise *before* spatial averaging or the halftone gets a spurious YN bias |
| Auto exposure | **OFF**, exposure locked for the whole session | per-scan auto-exposure destroys cross-sheet comparability |
| Unsharp mask | OFF | edge ringing biases patch means near the gutter |
| **Descreen** | **OFF** | descreen is an adaptive notch filter *designed* to destroy exactly the halftone statistic being measured. This is the single most destructive default. |
| Colour restoration / backlight / dust removal (DIGITAL ICE) | OFF | ICE uses an IR channel and inpaints — it will erase riso grain as "dust" |
| Preview auto-crop | OFF; fixed absolute crop rectangle | keeps the sheet at a known platen position |
| Multi-pass / multi-sampling | ON, 2× if available | free read-noise reduction |

Record the exact driver + version + settings string into the campaign manifest. `CHART-DESIGN.md` §1.1 already makes machine/driver/paper a hard gate on the *print* side; the scan side needs the same and it is not currently specified there.

## 1.3 Resolution derivation (not chosen — derived)

- **Patch sheets, 400 ppi.** At 43 lpi AM the halftone cell is 25.4/43 = 0.591 mm = **9.3 px** (≥ 4 px/cell gate satisfied 2.3×). A 10 mm active window holds 16.9 cells/side = **286 cells**; at ~5 % per-cell area variance, se = 0.05/√286 = **0.30 % area** ≈ 0.25 ΔE00 — under the print noise floor, as `CHART-DESIGN.md` §3.1(a) requires. The window is 157 px across (gate: ≥ 60 px), 24 649 px per patch.
- **The driver's real screen is FM.** `docs/validation/stats.json` classifies the decoded `.prn` as *error-diffusion / "Grain-Touch", dispersed single-pixel dots at 600 dpi*. A 600-dpi dot is 42.3 µm; one 400-ppi scan pixel is 63.5 µm, so at 400 ppi the FM screen is **not resolved** — the scan is already a physical average. That is fine for the patch mean and it changes the per-patch statistics (§2.6): FM patches are unimodal, AM patches are bimodal.
- **MDG strip, 2400 ppi.** A 43-lpi cell becomes 56 px — cleanly thresholdable. A 600-dpi FM dot becomes 4 px — marginal, MTF-limited, and requires the threshold-sensitivity gate in §3.4.
- **Verso, 200 ppi.** Show-through is low-frequency by construction (its PSF is markedly wider than the recto ink PSF, Sharma 2001); more resolution is wasted bytes.

Data volume at 400 ppi, A3, 48-bit: 4677 × 6614 × 6 B = **186 MB/scan**.

## 1.4 What goes in the scan bed

Four items, all in a dedicated margin band **≥ 25 mm from the nearest chart patch** (flare / integrating-cavity, Lee/Bala/Sharma):

1. **IT8.7/2 (Kodak Q-60) reflective target** with its vendor measurement file. Trains the scanner RGB → XYZ_D50 transform. ~$40.
2. **Kodak Q-13 / Q-14 reflection grey scale**, 20 steps with published densities. Two jobs: OECF measurement when linear output is unavailable (§2.5), and per-session drift detection.
3. **A strip of the unprinted chart stock**, same batch. This is the absolute paper-white anchor, distinct from the in-sheet white lattice which also carries the flat-field.
4. **The riso anchor strip — strongly recommended.** A guillotined strip carrying the 7 solids + paper + the 21 first-order overprints (29 patches), measured **once** on a spectrophotometer (borrow, hire, or a print-shop favour; an i1Pro2 or ColorMunki is a 30-minute job for 29 patches).

Item 4 is what makes the campaign colorimetric rather than scanner-relative. Lee/Bala/Sharma is explicit: a generic 3-D scanner profile trained on an IT8 gives **~6–7 ΔE76 on unconstrained multi-colorant patches vs ~2–3 for a colorant-aware characterisation**. Riso spot inks are further outside the IT8 colorant space than CMYK is. Without item 4 you are fitting a scanner profile on dye-based photographic colorants and applying it to fluorescent emulsion ink — a Luther-condition violation with no correction path. If item 4 is genuinely impossible, ship the model as **paper-relative only**, label it as such in the UI, and do not report absolute ΔE00 (`CHART-DESIGN.md` §1.2 already draws this line; honour it).

Also in the bed but off to one side, for the fluorescent work (§3.6): a **Rosco #15 Deep Straw or #21 Golden Amber gel**, A3, for the platen-overlay UVX scan.

## 1.5 Session structure and scan count

```
Session start
  1  warm-up scan, discarded (lamp/CCD drift)
  2  blank-platen flat-field set: 5 blank sheets of chart stock, full platen  → §1.7
  3  drift anchor: sheet 1, copy 11, orientation 0°
  ... the session's sheets ...
  n  drift anchor repeat: sheet 1, copy 11, orientation 0°
Gate: ΔE00 between the two drift anchors < 1.0 else the session is void.
```

**Per printed sheet design:** 5 physical copies (nos. 11, 13, 15, 17, 19 of a 25-copy run — first 10 discarded per `CHART-DESIGN.md` §2.2).

**Orientations per copy:** Asman measured 0/90/180/270 averaging taking max error from 8.05–16.68 down to 7.88 ΔE76. On an A3 platen an A3 sheet only permits 0/180. Two options:

- **(A) A3 whole, 0/180 only** — 2 scans/copy.
- **(B) Recommended: print A3, guillotine into two A4 halves along a printed cut line.** Each half carries its own fiducial bands, Data Matrix, white lattice and control lattice (the design already mandates per-sheet furniture, `CHART-DESIGN.md` §2.1 pt 4, so this costs only layout discipline: keep all patches ≥ 8 mm from the cut line and put the sheet-half index in the Data Matrix). Then 0/90/180/270 **and** two different platen positions are available, which decorrelates the scanner's cross-scan nonuniformity from the sheet's own banding. 4 scans/half.
- The **uniformity sheet stays whole A3** (its whole point is the full-sheet flood) at 0/180.

Budget under (B), for the 8-design manifest in §1.9:

| | designs × runs | copies | halves | orientations | scans |
|---|---|---|---|---|---|
| Run A (normal order) | 8 | 5 | 2 | 4 | 320 |
| Run B (reversed order) | 4 | 5 | 2 | 2 | 80 |
| Run C (24 h delay) | 2 | 5 | 2 | 2 | 40 |
| Uniformity sheet (A3) | 3 | 5 | 1 | 2 | 30 |
| Verso (show-through), 200 ppi | 2 | 5 | 1 | 1 | 10 |
| MDG strip, 2400 ppi | 1 | 5 | 1 | 2 | 10 |
| **Total** | | | | | **≈ 490 scans** |

At ~70 s/scan for A4@400 ppi (and ~6 min for the 2400 ppi strip), that is **≈ 11 hours of scanning** spread over ~4 sessions, ~55 GB. This is the real cost of the campaign and it should be stated up front.

Reduce by dropping Run A to 2 orientations if 11 h is unacceptable — expect to give back ~0.15 ΔE00 of noise floor.

## 1.6 Spatial nonuniformity — three layers, in this order

The white lattice alone is the wrong primary tool: it has 10–18 observations per sheet and must fit 6 polynomial coefficients *plus* absorb paper batch variation *plus* absorb press banding. Separate the causes:

**(a) Scanner field, measured once per session, not per sheet.** Scan 5 blank sheets of the chart stock filling the platen. Register, average, median-filter with a 3 mm kernel, normalise to its own mean →

```
F_scanner[c](x, y)      c ∈ {R,G,B},  stored per (scanner, session)
```

Expect 3–8 % peak-to-peak, dominated by a smooth 1-D gradient along the CCD (cross-scan) axis plus lamp roll-off at the platen ends. Because it is measured from ~50 M pixels rather than 18 patch means, it is far better conditioned than an in-sheet fit. **Sanity gate:** if `F_scanner` peak-to-peak > 12 %, or if it changes by > 2 % between sessions, the scanner is unfit and must be replaced or serviced.

**(b) Residual per-sheet field**, from the in-sheet white lattice *after* dividing out `F_scanner`. Now the lattice is fitting only paper-batch tint and residual placement error, so a 2nd-order polynomial with 6 coefficients from 10–18 observations is well-conditioned. Gate: residual peak-to-peak after this fit < 3 % (`CHART-DESIGN.md` §4.4).

**(c) Press banding `S(x,y)`**, from the control lattice + the full-sheet 50 % flood, per `CHART-DESIGN.md` §3.5. This is a *print* property, not a scan property, and it must be fitted **after** (a) and (b), in the sheet's own coordinate frame (i.e. after de-skew), never in scanner coordinates. Conflating (a) and (c) is the classic failure: a scanner gradient along the same axis as the feed direction will be attributed to the drum and "corrected" into every ink's tone curve.

The order-of-operations rule: **(a) in scanner pixel coordinates → de-skew → (b) and (c) in sheet coordinates.** Getting this backwards silently corrupts every curve.

**(d) Veiling glare / flare** is not a field, it is an additive offset. From the two flare probes (`CHART-DESIGN.md` §3.4): φ = (reading of the 10 mm white well inside a 30 mm solid) − (reading of the distributed white lattice), per channel. Subtract φ as a constant before ratioing to paper. Expect φ ≈ 0.003–0.010 in reflectance on a flatbed (much smaller than a camera's).

## 1.7 Fluorescence: the second illuminant, for free

Blasinski's warning is structural: **with one illuminant the fluorescent and reflective components are mathematically unidentifiable.** A flatbed is one illuminant. The cheap second illuminant:

**Lay the amber gel (Rosco #15/#21, cut-on ~500 nm) flat on the platen glass, sheet on top, and re-scan.** The gel is in both the illumination and the collection path, so its transmittance enters squared — which is measurable and invertible:

1. Scan the gel over the unprinted stock strip → recover `T_gel[c]` per channel from `R_gel_white / R_white = T_gel²`.
2. In the emission band (R and G channels; Fl. Pink emits ~600–620 nm, Fl. Orange ~590–620 nm, both above the gel cut-on) the gel passes ~0.85–0.95 while blocking 400–500 nm excitation almost totally.
3. Therefore `R_gel[c] / T_gel[c]² ≈ R_reflective[c]` (fluorescence suppressed), and
   **`E[c] = R_normal[c] − R_gel[c] / T_gel[c]²`** is the additive fluorescent emission under the scanner's own lamp.

This is Calabria & Rich's UVI/UVX experiment done with a $12 gel and no spectrophotometer, and it satisfies Tominaga's two-illuminant-projection condition in the crude 3-channel sense. **Honest scope statement, which must appear in the UI and the model file:** this identifies a *rank-1, illuminant-specific, 3-channel* fluorescence term under the scanner lamp's SPD. It is not a Donaldson matrix, it will not survive an illuminant switch, and it says nothing about quantum yield. Declare it and stop.

Scan cost: +1 gel scan for every sheet carrying fluorescent patches (2 designs → +20 scans, already folded into §1.5 if you run the fluorescent sheets at 2 orientations normal + 1 gel).

**If the gel pass is skipped:** set `E = 0`, let the multiplicative model absorb everything, and mark every Fl. entry `fluo_split: null`. The model will then be right on measured configurations and structurally wrong on unmeasured ones and on print-order asymmetry. That is an acceptable v1 — but it must be labelled, not hidden.

## 1.8 Backing, handling, timing

- Back every sheet with **≥ 10 sheets of the same stock** (ISO 13655 white backing; critical on thin riso paper where the platen lid's colour shows through).
- Scan **≥ 24 h after the last pass** (oil-based emulsion dries by absorption; a wet scan reads darker and will smear the platen).
- Handle by the margins with cotton gloves; oil from fingers on uncoated stock is a measurable reflectance change.
- Never re-scan a sheet that has been on the platen with wet ink — check the platen for offset between every sheet.
- Room at 20 ± 3 °C, 45 ± 10 % RH, logged. Riso ink transfer is humidity-sensitive and this is one of the covariates that will explain cross-session drift if it appears.

## 1.9 The eight-design manifest (what actually gets printed)

Derived from `CHART-DESIGN.md` §2.5–2.7, instantiated for {Black, Blue, Yellow, Bright Red, Green, Fl. Pink, Fl. Orange}. A3 safe area 277 × 400 mm at 16 mm pitch = 17 × 25 = 425 slots; minus fiducial bands / Data Matrix / verniers ≈ **380 usable slots per A3**.

| # | Design | Content | Unique | Plates used |
|---|---|---|---|---|
| 1 | LADDER-A | 18-level ladders for Black, Blue, Yellow, Bright Red + white lattice + control lattice + flare probes + **MDG strip** | 72 + 70 + furniture | 4 |
| 2 | LADDER-B | 18-level ladders for Green, Fl. Pink, Fl. Orange; ladder replicates; 7 solids ×3 | 54 + 21 | 3 |
| 3 | PAIRS-1 | pairs {Black,Blue,Yellow,BrightRed}: 6 pairs × (16 interior + 1 solid OP) + f_{i/j} 3-pt for 12 ordered conditions | 102 + 36 | 4 |
| 4 | PAIRS-2 | pairs involving Green + Fl.Pink + Fl.Orange against the other four: 12 pairs × 17 + f_{i/j} for 24 conditions | 204 + 72 | ≤ 4/sheet, 2 sub-sheets |
| 5 | PAIRS-3 | remaining 3 pairs among {Green, Fl.Pink, Fl.Orange} + 10 selected triple solids + 6 triple halftones | 51 + 16 | 3 |
| 6 | SCOP | 7 inks × 5 tints × 3 backings (paper / Black-50 % / Black-100 %) + opacity wedges | 105 | 2 per patch |
| 7 | FLUO | Fl.Pink and Fl.Orange × 5 tints × under/over each of {Black, Blue, Yellow, BrightRed, Green} × both orders | 100 | 2 |
| 8 | UNIFORMITY | full-bleed 50 % flood per ink + 20×28 registration cross lattice; **verso = show-through** | image, not patches | 1 at a time |

Unique measured ≈ **1 040**; with ×2 replicates and lattices ≈ **2 300 slots ≈ 8 A3 sides**. Consistent with `CHART-DESIGN.md`'s T3 estimate scaled from k=3 to k=7.

**Print schedule (this is where the riso constraints bite).** Drum swaps dominate. Schedule **drum-major, not sheet-major**:

```
for drum d in [Black, Blue, Yellow, Bright Red, Green, Fl. Pink, Fl. Orange]:
    mount d
    for each design s that uses d:
        make master, print 25, discard 10, slip-sheet
    swap
```
7 swaps for Run A. Run B (reversed drum order, 4 designs) = 7 more. Run C (normal order, 24 h gap between every pass, 2 designs) = 7 more. **21 swaps total**, 98 masters (~½ roll), ~350 sheets of A3. Two working days plus a 24 h wait.

**Paper scope.** Run the full campaign on ONE declared stock. Then run a reduced 1-sheet campaign (ladders + 7 solids + 21 solid overprints ≈ 200 patches) on a contrasting stock (e.g. 80 gsm vs the primary's 100 gsm, or a heavily-OBA vs a natural white) to fit the paper-transfer term in §3.7. Without this, the shipped dataset is silently paper-specific.

---

# 2. PATCH EXTRACTION

Pipeline order, and it is not negotiable: **dark-subtract → OECF-linearise → scanner flat-field → fiducial detect → per-plate affine → window construction → robust patch statistic → sheet-frame flat-field + banding → flare → paper-relative.** (Ashraf's ordering, adapted.)

## 2.1 Per-plate ink-density projection — do this before anything else

A Yellow fiducial is nearly invisible in the red channel; a Black one is invisible nowhere. Detecting all seven plates' furniture on a naive grey image will fail on Yellow and Fl. Orange. Build a per-plate density image using the ink's own measured solid:

```
w_i = normalize( log(R_paper) − log(R_solid_i) )        # 3-vector, per ink
D_i(x) = w_i · ( −log( max(R(x), 1e-3) ) )              # scalar "how much ink i is here"
```

For Yellow, `w` is dominated by the blue channel; for Blue, by red. `D_i` gives near-unit contrast for plate i and near-zero for the others (except where inks genuinely overlap spectrally — Bright Red vs Fl. Orange are the worst pair; for those, orthogonalise `w_i` against the other ink's direction via Gram–Schmidt before use).

Bootstrapping: on the first sheet, `R_solid_i` is not yet known. Use the `RISO_CAL` `lut[4]` value linearised as a prior, extract the solids, then **re-run the whole extraction** with the measured solids. Two passes, converges immediately.

## 2.2 Fiducial location

`CHART-DESIGN.md` §3.4 puts 6 ArUco 4×4 markers, 12 mm, in a band per plate, at x = {8, 20, 30, 50, 70, 92} % of safe width, plus mirrored bands.

- At 400 ppi a 12 mm marker is **189 px** — far above any detector's threshold; even at 200 ppi it works.
- Detect on `D_i`, not on the RGB or grey image.
- Standard OpenCV `cv2.aruco.detectMarkers` with `DICT_4X4_50`, `cornerRefinementMethod = CORNER_REFINE_SUBPIX`, `cornerRefinementWinSize = 9`. Sub-pixel corner accuracy on a printed (i.e. halftone-edged) marker is ~0.3 px = **19 µm** — an order of magnitude below the registration effects we are measuring.
- 6 markers × 4 corners = **24 correspondences per plate**, per band; with the mirrored band, 48.
- Decode the marker IDs and check `(plate index, sheet index)` against the chart model. A plate whose markers decode to the wrong index means the plates were printed in the wrong order — a hard refusal, not a warning.
- Decode the Data Matrix (plate 0) and hard-match `chart_id`.

## 2.3 De-skew and per-plate affine

```
for each plate p:
    A_p = argmin Σ_j || A · c_j^chart − c_j^image ||²          # 6-dof affine, chart mm → image px
    resid_p = RMS residual, in mm
    gate: resid_p < 0.30 mm      (CHART-DESIGN §4.4)
```

Affine, not homography: a flatbed is orthographic, so there is no perspective term to estimate and adding one just fits noise. (For the *phone* path the homography is required; for the scanner it is a liability.)

- If `0.30 mm ≤ resid_p < 0.60 mm`, the residual is almost certainly **cockle** — non-affine local paper distortion. Refine with a thin-plate spline anchored on the 48 correspondences plus the control-lattice patch centroids, and re-gate at 0.15 mm on the TPS residual. Flag the sheet `cockle: true` and exclude it from the banding fit (cockle and banding are both low-frequency and will trade off).
- If `resid_p ≥ 0.60 mm`, reject the sheet.

**Multi-orientation merge.** Register the 90/180/270 scans to the 0° scan via the plate-0 affine, resample each with a **Lanczos-3** kernel (never nearest, never bilinear — bilinear low-passes the halftone differently at different sub-pixel phases, which introduces an orientation-dependent bias exactly where you are trying to remove one), then average in **linear reflectance**. Do not average patch means from separately-extracted orientations if you can avoid it — averaging images first lets the outlier rejection in §2.6 see all four.

## 2.4 Per-drum registration offsets — an output, not just a nuisance

```
M_p = A_p ∘ A_0^{-1}                    # plate p relative to plate 0, in chart mm
decompose M_p → (tx, ty, θ, sx, sy, shear)
```

Report, over ≥ 15 measured sheets per run, per ordered plate pair:

- μ and σ of `tx` (cross-feed) and `ty` (feed). **Expect σ_feed > σ_cross** — the feed axis has the grip/slip variability. This asymmetry is itself a shippable simulation parameter (`misreg` in the app is currently a scalar; it should become anisotropic).
- μ and σ of θ (rotation) and of `sy` (feed-axis stretch — real, caused by the paper being pulled).
- The p95 of `|Δ|`, which feeds back into the next chart generation's guard `g = ceil(p95 + 1 mm)` (`CHART-DESIGN.md` §3.1).

The verniers (`CHART-DESIGN.md` §3.4, 1.00 vs 1.10 mm combs, 0.1 mm resolution) are the human-readable cross-check on this: if the vernier reading and `M_p` disagree by more than 0.2 mm, the affine is wrong (usually a mis-decoded marker ID) and the sheet must be re-processed, not accepted.

## 2.5 Linearisation — before averaging, always

If the driver produced non-linear 48-bit output, invert the OECF first:

1. From the Q-13's 20 steps with published densities `D_k`, extract each step's mean scanner code `v_k`.
2. Fit a monotone cubic (reuse the Fritsch–Carlson implementation — three copies of it already exist and agree: `index.html:2366`, `js/sep-lut-worker.js:38`, `js/cal-lut-worker.js`) mapping `v → R = 10^(−D)`.
3. Apply **per pixel**, then average.

Why this is not optional: averaging a bimodal halftone through a nonlinear encoder gives `mean(g(R))` where you want `g⁻¹` of nothing at all — you want `mean(R)`. For an AM patch at a = 0.5 with `R_paper = 0.81`, `R_ink = 0.06`, a γ = 2.2 encoder gives `mean(g(R)) = 0.5(0.918 + 0.276) = 0.597` → decoded 0.305, versus the true 0.435. **That is a 0.13 reflectance error, ~14 ΔE00, and it has exactly the shape of optical dot gain** — it would be silently absorbed into the fitted Yule–Nielsen `n` and would make `n` a property of the scanner driver. This single step is the difference between a transferable model and a scanner fingerprint.

## 2.6 The sampling window

Straight from `CHART-DESIGN.md` §3.2, with numbers:

```
for patch P with participating plates {p_1..p_m}:
    foot_i = A_{p_i}(P.footprint_poly_mm)                 # 14 mm + 2g
    W      = erode( ∩_i foot_i , 1.0 mm )                 # 1.0 mm = 15.7 px @ 400 ppi
    if area(W) < 0.60 · area(P.active_poly):  reject, flag "registration"
```

Two additions the existing spec does not state:

- **Erode by a whole number of halftone cells, not by a fixed 1.0 mm.** At 43 lpi, 1.0 mm = 1.7 cells; eroding by a non-integer number of cells changes which phase of the screen sits at the window boundary and adds a systematic ±0.3 % area bias between patches. Use `erode_mm = max(1.0, ceil(1.0 / cell_mm) · cell_mm)` — at 43 lpi that is 1.18 mm (2 cells). For FM, 1.0 mm stands.
- **Never let the window touch the guard band.** The guard exists so that misregistration does not expose single-ink or paper edges; if the eroded intersection reaches into it, the patch is already compromised. Assert `W ⊂ active_poly` after erosion; if not, reject.

## 2.7 The per-patch statistic — mean, emphatically not median

This is the question most likely to be answered wrongly, so state the reasoning:

**A halftone patch's per-pixel distribution is bimodal (at AM 43 lpi / 400 ppi: 9.3 px per cell, dots resolved) or unimodal (at FM 600 dpi / 400 ppi: sub-pixel, already averaged).** For the bimodal case the **median is a step function of coverage** — it sits at `R_paper` for a < 0.5 and at `R_ink` for a > 0.5, with a discontinuity at 0.5. It is not merely noisy; it is the wrong estimator by construction. Likewise a naive trimmed mean on raw pixels trims the *dots*, which is a coverage-dependent bias that looks exactly like dot gain.

The estimator is:

```
1. Linearise (§2.5).
2. Defect mask, at a scale ABOVE the halftone:
     L = gaussian_blur(patch, σ = 1.5 · cell_mm)          # ≥ 2 halftone cells; for FM use σ = 0.30 mm
     m = median(L);  s = 1.4826 · MAD(L)
     mask = |L − m| > 4·s                                  # blobs, hickeys, fibre, platen dust
     dilate(mask, 0.5 mm)
3. If fraction(mask) > 0.08 → reject patch, flag "defect".
4. R̂ = arithmetic mean of the UNMASKED, LINEARISED pixels, per channel.
5. Also record:
     σ_cell = std of L over the unmasked window          # data-quality: bad master detection
     σ_pix  = std of the raw pixels                       # sanity; ≈ halftone contrast
     n_px, area_ratio = area(W)/area(active)
```

Rejecting at a scale above the halftone and averaging at the pixel scale is the whole trick. `σ_cell` is a genuinely useful shipped diagnostic: an anomalously high `σ_cell` means a bad thermal master (stochastic perforation failure, US 5,245,932) rather than a bad model, and `CHART-DESIGN.md` §6 already asks for it.

**Bootstrap the uncertainty**, don't assume it: resample 200 times over 2 mm blocks (block bootstrap, because the halftone and the paper texture are spatially correlated — an i.i.d. pixel bootstrap will understate σ by ~3×) to get `se(R̂)` per patch. This `se` becomes the per-observation weight in §3, which matters a lot: patches with a small `area_ratio` after erosion should not carry the same weight as clean ones.

## 2.8 Paper-relative conversion and the measurement record

```
R_ff       = R̂ / F_scanner / F_sheet              # §1.7 (a) then (b)
R_deband   = R_ff / S(x,y)                        # §1.7 (c), sheet frame
R_flare    = R_deband − φ                         # additive
R_rel      = R_flare / R_paper_lattice_local      # paper-relative, per channel
```

One record per (chart_id, sheet_index, print_run, sheet_serial, scan_id, patch_id), matching `CHART-DESIGN.md` §5.4's store, extended:

```jsonc
{ "patch_id":"P-0473", "role":"pair-interior", "plates":[0,3], "order":["Black","Bright Red"],
  "a_nom":[0.4981, 0.0, 0.0, 0.2473, 0,0,0],     // COUNTED from the raster (R4)
  "R_rel":[0.4412,0.2013,0.1877], "R_abs_xyz":[...], "lab":[...],
  "se":[0.0021,0.0018,0.0025], "sigma_cell":0.0140,
  "area_ratio":0.91, "n_px":22410, "flags":[], "run":"A", "sheet_serial":13 }
```

`a_nom` is the **counted** set-pixel fraction inside the active window at generation time (`CHART-DESIGN.md` §0, R4). Nothing in the fit ever uses the *requested* coverage. This is what makes the whole exercise immune to `getCoverage`'s unconditional gamma + 15 % S-curve + dot gain (`index.html:1917`) and to the `u_amtJitter` export drift.

---

# 3. THE FITTING MODEL

Everything is fitted in **linear reflectance factor**, relative to paper, per channel, in the OKLab metric (matching `js/sep-lut-worker.js`'s objective), and **reported** in CIEDE2000 in CIELAB D50.

Why OKLab for the objective and ΔE00 for the report: ΔE00 is non-smooth near the a*b* = 0 axis and has a hue-rotation term that makes it a poor optimiser objective; Khokhlova & Hardeberg found plain Euclidean beat CIEDE2000 for the *selection* step on all three of their datasets. Optimise in the space you can differentiate; report in the space the field understands. State both in the report.

## 3.0 Parameter budget and why regularisation is mandatory

| Block | Per ink | × 7 | Notes |
|---|---|---|---|
| `u_i = 1/n` | 1 | 7 | per screening mode → ×2 |
| solid reflectance | 3 | 21 | measured, not fitted |
| `f_{i/∅}` spreading on paper | 3 knots | 21 | |
| `f_{i/j}` for 6 others | 18 | 126 | Bugnon parabola → 6 if 1-dof |
| SCOP `j,k` | 12 | 84 | |
| opacity | 1 | 7 | |
| fluorescence | 5 | 10 | 2 inks only |
| **τ ordered pairs** | — | 84 | 42 pairs × wet/dry |
| global (λ_PSF, φ, paper terms) | — | ~10 | |
| **Total free** | | **≈ 370** | |

Observations: ~1 040 unique patches × 3 channels × (2–3 runs) ≈ **4 000–6 000**, with 5 replicate sheets each. Ratio ~11:1 — adequate globally but *thin per ink pair* (a single `f_{i/j}` curve rests on 3 patches × 5 sheets). Hence:

- **Ridge every per-pair parameter toward its global/pooled value.** `λ_ridge` chosen by the same leave-one-pair-out CV that validates the model (§5), so it is not a free knob.
- **Hard monotonicity constraints** on every `f` (Fritsch–Carlson already guarantees this if the knots are monotone; enforce knot monotonicity in the parameterisation, e.g. by fitting increments through a softplus).
- **Bugnon's noise-resilience rule:** keep the 1-parameter parabola for any `f_{i/j}` whose 3-point fit residual is not below the measured noise floor. With riso's per-patch σ, expect roughly half the 42 curves to stay parabolic. That is a feature.

## 3.1 (a) Fixing the Yule–Nielsen no-op — what to fit, and on what

**Parameterisation.** Fit `u = 1/n`, never `n` (Viggiano: `u` is continuous through the singularity, `n` is not; an optimiser cannot cross from +∞ to −∞). Bounds `u ∈ [−2.0, +1.0]`, i.e. `n ∈ (−∞, −0.5] ∪ [1, ∞)`. **Remove every `n ≥ 1` clamp.** Expect negative `n` on this stock: riso's oil/soy emulsion on uncoated paper is exactly Viggiano's ink-penetration regime, where he measured `n ≈ −3.8` on fibre inkjet paper; `n = −1` is algebraically ≈ Kubelka–Munk K/S, which is the physically right limit for a penetrating ink in a scattering sheet.

Numerically: guard `|u| < 0.02` (n → ±∞) with the log-space limit — `pow(a,u)` mixing degenerates to the geometric mean, so branch to `exp(mix(log a, log b, area))`. Also clamp bases to ≥ 1e-3 before `pow` with negative exponents, else Inf.

**The identifiability problem, stated plainly.** With `f` free and `u` free, the pair is not identifiable from a single-ink ladder. Three defences, applied together:

**Defence 1 — measure the mechanical half (the MDG strip).** Threshold the 2400 ppi strip to recover printed area `m_i(a_nom)` directly. Then:
```
mechanical dot gain  =  m_i(a) − a          # measured
optical dot gain     =  everything left in the reflectance
```
`f` is now pinned by measurement and `u` is the only free parameter explaining the reflectance residual. This is the clean solve and it should be the primary path.

Threshold procedure and its gate:
- Otsu on the patch histogram with hysteresis (dual threshold at Otsu ± 0.5σ, 8-connected).
- Anchor: force the 0 % patch to 0.000 and the 100 % patch to 1.000; if either is off by > 0.005 the strip is unusable.
- **Threshold-sensitivity gate:** perturb the threshold by ±10 % of the histogram's inter-mode distance and recompute area. If `|Δarea| > 0.03` at any level, the resolution is insufficient at that screening mode — this will happen for FM 600 dpi on most consumer flatbeds and will *not* happen for AM 43 lpi. Then: measure `m_i` in AM 43 lpi mode only, and for FM modes fall back to Defence 2.

**Defence 2 — fit `f` at fixed `u`, choose `u` on patches `f` did not see** (Hersch & Crété's own prescription: "sweep n and choose the value minimising mean ΔE94 between predicted and measured over the patch set — do not assume it"):
```
inner:  for fixed u,  invert YN per ladder patch, in closed form:
          R(a)^u = (1 − f(a))·R_paper^u + f(a)·R_solid^u
          ⇒ f(a) = ( R(a)^u − R_paper^u ) / ( R_solid^u − R_paper^u )
        this is EXACT — zero residual on the ladder by construction, which is
        precisely why the ladder cannot identify u.
outer:  choose u to minimise weighted OKLab error on the PAIR-INTERIOR patches
        ({25,50,75}² for all 21 pairs) and the SCOP wedges.
```
The outer objective works because the Demichel/YNSN algebra couples the inks: a wrong `u` cannot be absorbed by any single-ink curve once two inks share the aperture.

**Defence 3 — the coverage restriction.** Ruckdeschel & Hauser: empirical n-determination is valid only below ~50 % area coverage and becomes erratic in shadows. Concretely:

| Set | Definition | Use |
|---|---|---|
| **Fit-n set** | ladder + pair patches where **every** individual `a_nom ≤ 0.50` and **total** `Σa_nom ≤ 1.20` | fits `u` |
| **Validate-n set** | everything with any `a_nom > 0.50` | validates `u`; residual reported **separately** |
| **Never** | shadow patches | fitting `u`. Ever. |

Under the T2 18-level ladder (0, 3, 5, 7, 9, 12, 16, 20, 25, 30, 36, 42, 48, 56, 64, 72, 85, 100) that is **13 fit levels** and 5 validation levels per ink.

**Per-ink vs global `u`.** Fit a global `u` first. Then fit per-ink `u_i` and combine per patch as Rossier & Hersch's coverage-weighted parabolic average. **Gate the upgrade:** keep `u_i` only if it improves the *held-out* (§5, H1) mean ΔE00 by **≥ 0.5** and the improvement survives leave-one-pair-out. Rossier & Hersch's own honest caveat is that for classical, similar inks the gain is negligible — so the a-priori expectation is that per-ink `u` will earn its keep for **Fl. Pink, Fl. Orange and Black** and not for Blue/Yellow/Bright Red/Green. If that is what the data says, ship exactly that: three per-ink values and one shared value. Report the decision and the numbers; a null result here is a result.

**`u` is a function of screen frequency, and this must be shipped as a table.** Hébert & Hersch's Table 3: n = 2 @ 50 lpi → 3 @ 75 → 6 @ 100 → 9 @ 125 on identical paper/ink/printer. Riso's Grain-Touch FM at 600 dpi is effectively a very high-frequency screen → expect a **large n / small u**. So:
- Print the LADDER-A/B designs in **both** the app's 43 lpi AM mode and the driver's FM mode (this doubles designs 1–2; already in the manifest at 8 designs by folding replicates).
- Fit `u(mode)`. Store as a table keyed on `{engine, lpi}`; interpolate `log n = α + β·lpi` between measured points (Hébert's four points fit that form to within 8 %).
- **Falsifiable check:** `n_FM > n_AM43`. If the fit says otherwise, something upstream is wrong — most likely `a_nom` counting or the screening path — and the campaign must be debugged before the numbers are believed. See §5.4 F7.

**The PSF cross-check (and the reason the renderer needs it anyway).** The app resolves individual dots. **At dot-resolving scale, YN is the wrong tool and will double-count** — YN is a statement about the sub-aperture average, and if you also draw the dots you have modelled the same physics twice. The physically correct pixel-level form (Yang; Rogers; Inoue/Tsumura/Miyake, who measured paper's PSF as **exponential**) is a two-pass transport:

```
T(x)   = per-pixel ink transmittance from the plate raster
R(x)   = T(x) · [ P_λ ⊛ ( T · R_paper ) ](x)          P_λ(r) ∝ exp(−r/λ)
```

So: fit **both**. `u` for the analytic/patch-level model (used by `sep-lut-worker`'s `forwardYNSN`, the separation LUT, and the SCOP layer), and `λ` for the pixel-level renderer. Then require them to agree: the aperture-average of the PSF model at the chart's lpi must reproduce the fitted `u` to within the noise floor. If they disagree by more than ~1 ΔE00 equivalent, one of them is absorbing something it should not — almost always a residual scanner nonlinearity (§2.5).

`λ` is fitted from the ladder residuals jointly with `u` (one extra global parameter, per paper). Expect `λ ≈ 40–120 µm` for uncoated riso stock.

## 3.2 (b) Superposition-dependent ink spreading (Hersch & Crété)

Hersch & Crété is the paper that most directly answers the project's question: measured payoff on 729 CMY patches was **offset @100 lpi ΔE94 1.54 → 0.90 (1.7×), inkjet @75 lpi 3.03 → 0.90 (3.4×)**; Hébert & Hersch independently confirm > 50 % error reduction.

**Scope decision, forced by k = 7.** Full superposition-dependent spreading is `k·2^(k−1) = 448` curves. Fit only the `|J| ≤ 1` layer:

| Curve family | Count | Patches to fit | Status |
|---|---|---|---|
| `f_{i/∅}` — ink i on bare paper | 7 | 18-level ladder × 7 | **measured** |
| `f_{i/{j}}` — ink i over solid j | 42 | 3 pts (25/50/75) × 42 = 126 | **measured** |
| `f_{i/J}`, \|J\| ≥ 2 | 399 | — | **predicted** as the coverage-weighted blend of the `|J| = 1` curves |
| triples | — | 10 solids + 6 halftones | **validation only, never fitted** |

The `|J| ≥ 2` prediction is not an invention — it is exactly the weighting Hersch's fixed-point already performs; we are simply declaring the higher-order curves to *be* that blend rather than fitting them independently. The 16 triple patches are the held-out test of that declaration (§5, and if it fails, F-condition F4).

**Per-curve form.** For each `(i, J)`:
- Fit the 3-knot monotone cubic through `q'(0.25), q'(0.50), q'(0.75)` with `f(0)=0, f(1)=1`.
- Compute the fit residual. If it is **not** below the per-patch noise floor (§5.1), **discard the 3-point fit and keep Bugnon's 1-parameter parabola** from the 50 % point alone:
  ```
  f(q) = [2 − 4·q'(0.5)]·q² + [4·q'(0.5) − 1]·q
  ```
  Bugnon recommends this explicitly on noise-resilience grounds, which is riso's exact problem. Record per curve which form was used; it is a legitimate diagnostic of where the campaign was under-powered.

**Prediction-time solve** (Hersch & Crété, 4–5 fixed-point iterations):
```
a_i^(0) = f_{i/∅}(a_nom_i)
repeat 5×:
    for each ink i:
        w_J = Π_{j∈J} a_j  ·  Π_{j∉J, j≠i} (1 − a_j)      # Demichel weights of the underlying colorants
        a_i = Σ_J  w_J · f_{i/J}( a_nom_i )
```
Converges in 4–5 iterations at every coverage; verified stable in the Hersch literature and cheap enough to run in `js/sep-lut-worker.js`'s bake (which already does a projected coordinate descent per grid point — this is a fraction of that cost).

## 3.3 (c) SCOP — the generalisation path, and the campaign's most important product

`X = j_x·(X_bg·X_fg)^{k_x}` per channel, `j` and `k` depending on colorant opacity, ink sequence and dot area (Deshpande/Green/Pointer). Reported: mean CIEDE2000 **1.76–2.15** across three substrates vs **2.89–2.92** for the plain uncorrected product; 2.06 for full 7-colour separation on offset.

**Why this matters more here than in the source paper.** Only 3 of the 13 shipped `PROFILES` in `js/data.js` are printable with these seven drums (Classic = Blue + Bright Red; CMYK = Blue + Bright Red + Yellow + Black; Mono = Black). The other 10 use inks the author does not own, and users swap drums constantly. **SCOP is the mechanism by which a 7-drum campaign improves the other 40 inks.** Everything else in this document improves 7 inks; SCOP improves 47.

**Fit in two tiers:**

**Tier 1 — the 3-backing wedges (design 6), the Deshpande-faithful fit.** 7 inks × 5 tints {10,25,50,75,100} × 3 backings {paper, Black-50 %, Black-100 %} = 105 patches. Regress per channel:
```
j_x(a) = j0_x + j1_x·a_fg
k_x(a) = k0_x + k1_x·a_fg
```
4 params/channel/ink → 12/ink → 84. This gives the classical SCOP and, from the same wedges, the **per-ink opacity** (Deshpande's 3-backing method, mean CIEDE2000 < 3 with a very small measurement set) that blends the model between "multiply" and "replace" — needed for Metallic Gold, opaque white and, to a lesser degree, the fluorescents.

**Tier 2 — the transfer fit, which is what actually ships.** Because we hold 21 measured pairs in both orders (~378 pair patches), refit SCOP *globally* on all pair data as a function of `(a_fg, a_bg, X_bg, sequence)`, pooled across inks with per-ink deviations ridged toward the pool. Then apply it to unmeasured pairs using only their third-party single-ink `RISO_CAL` LUTs.

**This tier is validated by leave-one-pair-out (§5, H2), and that number is the campaign's headline.** It is the direct, honest estimate of what a user printing an ink pair the author never printed will get.

**Note the sign.** Deshpande's central empirical claim is that the naive reflectance product **systematically underestimates overprint reflectance — it predicts too dark.** RISO/CAM's current `result·ink^d` is exactly that naive product, in sRGB-encoded space, with no correction. Expect the fitted `j > 1` and `k < 1`, and expect the correction to be *largest* on the dark overprints — which is where riso's perceived "muddiness" in the current simulation comes from.

## 3.4 (d) Trapping scalars per ordered pair

Riso ink is oil-based and dries by absorption; a second pass lands on wet ink; less transfers. `layerOrder` is user-controlled and drag-reorderable, so this is user-visible.

**The identifiability trap, and its resolution.** `f_{B/A}` (B spreads differently *on* A) and `τ_{A→B}` (less of B *transfers* onto A) both make B-on-A different from B-on-paper. From reflectance alone they are partially confounded. They separate cleanly if you fit them on different patches:

| Parameter | Physical meaning | Fitted on | Why it separates |
|---|---|---|---|
| `f_{B/A}` | effective **area** of B's dots on A | halftone patches, `a_B ∈ {0.25,0.5,0.75}` | area drives the **Demichel mixture weights** — it changes how much paper/A/AB you see |
| `τ_{A→B}` | ink **amount** (thickness) of B on A | **solid** overprints, `a_B = 1` | at a = 1 the Demichel mixture is degenerate; all remaining signal is thickness |

So: fit `τ` from the 42 ordered solid overprints only, then fit `f` from the halftones with `τ` fixed. Iterate twice.

**Model.** `τ` scales B's effective ink amount before it enters YNSN/SCOP:
```
d_B^eff = τ_{A→B}(Δt) · d_B          applied to the ink amount, NOT the area
```
Expect `τ ∈ [0.70, 0.95]`, decreasing with the first ink's density (Black-first will be the worst).

**Calibrate colorimetrically, not densitometrically.** Nguyen (2022) reviews Preucil/Ritz/Brunner, shows they all assume density additivity and attribute every deviation to a thinner second film, and shows ΔEab is the more reliable indicator. **Use Preucil `T = (D_op − D_1)/D_2` only as a printed diagnostic readout, never as the model.** `docs/INK-PHYSICS-PLAN.md` §Phase 2 currently proposes Preucil as the mechanism — that recommendation should be superseded.

**Wet vs dry.** Run A (back-to-back, minutes) and Run C (24 h between passes) give two points. Two points cannot identify `τ(Δt) = τ_dry + (τ_wet − τ_dry)·exp(−Δt/T)` — three parameters. Two options:
- **Preferred:** add a **third delay of 2 h** to Run C for one design (costs 7 more drum swaps but no new masters). Then `T` is identified.
- **Fallback:** fix `T = 6 h` from the absorption-drying argument and ship it as an assumption, flagged `T_assumed: true`. Do not present an interpolated `τ` at intermediate delays as measured.

**Generalisation to unmeasured pairs.** Regress the 42 measured `τ` on the first ink's measured optical density and coverage:
```
τ_{A→B} ≈ 1 − c1·D_A − c2·D_A·D_B
```
2 global parameters from 42 observations — well-determined. Apply to unmeasured pairs using their third-party solids. Validate under H2/H3.

## 3.5 (e) The two fluorescent inks

**State the mathematics first, because it constrains everything else.** With a single illuminant, `R_measured = R_reflective + E_fluorescent` is one equation in two unknowns per channel. Blasinski et al.: without varying the illuminant the two components are **mathematically unidentifiable**. No amount of clever fitting escapes this. `CHART-DESIGN.md` §2.6 already says "one illuminant = no fluorescence model, full stop." That is correct and it must not be softened.

**Consequence, precisely scoped.** The split is only *needed* for configurations that were not measured, and for anything that changes the illuminant. Therefore:

**Tier F0 — always available, no split required.** Measure `R_total` directly for every fluorescent configuration that matters: design 7 gives Fl. Pink and Fl. Orange × 5 tints × under/over each of {Black, Blue, Yellow, Bright Red, Green} × both orders = **100 measured configurations**. For these, the shipped model stores measured values and needs no fluorescence physics at all. This is Turunen's own recommendation after finding that even *full bispectral ground truth* gave "considerably high" estimation errors for fluorescent mixing: for the fluorescent pairs, store data, reserve the analytic model for the rest.

**Tier F1 — the gel differential (§1.8), which is cheap and should be done.** `E[c] = R_normal[c] − R_gel[c]/T_gel[c]²`. Fit, per fluorescent ink:
```
E(a, above) = e_rgb · Q(a) · A_exc(above) · A_emi(above)

  e_rgb   unit emission colour, 3 params (normalised)     ← from the ink-on-paper tint series
  Q(a)    saturating quenching roll-off, 2 params:
            Q(a) = q_max · a / (a + a_half)
          NOTE THE SIGN: emission FALLS at high fluorophore concentration
          (Hersch/Donzé/Chosson) — the opposite sign to Beer–Lambert.
          A monotone-increasing emission term is a fitting bug, not physics.
  A_exc   excitation-band attenuation by inks ABOVE ≈ their blue-channel transmittance
  A_emi   emission-band attenuation by inks ABOVE ≈ their R/G transmittance
```
5 fitted parameters per fluorescent ink. `A_exc` and `A_emi` are **computed, not fitted** — from the overlying inks' own measured transmittances. They are what produce the print-order asymmetry that a Beer–Lambert product structurally cannot express (an order-symmetric product cannot know whether the fluorophore is above or below the absorber). Emmel & Hersch's headline: their fluorescence-aware model beat Beer's law by an average of **~ΔE 17** on real fluorescent-ink-on-paper samples. That is the size of the prize and the a-priori error budget on the current model for these two inks.

Validate F1 against F0: the fitted split, recombined, must reproduce the 100 directly-measured configurations. **If it cannot reproduce them to within 1.5× the noise floor, F1 is rejected and only F0 ships.** That is the correct, brutal test, and there is no reason to be gentle about it because F0 is a complete fallback.

**Tier F2 — the camera dual-illuminant pass.** If the gel result is ambiguous: a fixed camera rig, raw DNG, locked AE/AWB, capturing every fluorescent sheet under (a) a 395–405 nm violet LED in a dark room, and (b) a 2700 K phosphor LED behind a 435 nm long-pass filter, at identical geometry, with the unprinted stock in frame both times (for the paper's own OBA baseline). This is Tominaga's two-illuminant-projection reduced to buyable hardware. It is more work and a worse instrument than the flatbed; treat it as the escalation path, not the default.

**Do not attempt.** Donaldson matrices, illuminant-independent radiance factors, quantum yields, FRET, or any illuminant-switchable preview. Say so in the UI, as `CHART-DESIGN.md` §2.6 requires.

**Note on the paper itself.** Riso stock is frequently OBA-brightened, and the scanner lamp is a blue-pump white LED with a strong 450 nm peak. **The paper is fluorescing too.** The gel differential on the *unprinted* stock gives the paper's own `E_paper` and it must be subtracted before the inks' emission is attributed. Skipping this transfers the paper's fluorescence into every ink's emission term.

## 3.6 Show-through

Anchored on RISO's own patent US 6,011,083: measured front density **1.21–1.26** against show-through density **0.13–0.16**, i.e. **~10–13 %**, with no observable blurring or set-off (the comparative example gave density 0.97 with conspicuous blurring). Fit from the verso scans of design 8:

```
D_verso(x) = β · [ G_μ ⊛ D_recto ](x)          composited in OPTICAL DENSITY space (Sharma 2001)
    β  ≈ 0.10–0.13   (fitted; the patent value is the prior and the sanity check)
    μ  ≫ λ_ink       show-through PSF markedly wider than the recto ink PSF — fit it, don't assume it
```

Density-space compositing is what makes show-through correctly *invisible* under dark recto ink. Doing it in reflectance space produces the characteristic error of ghosting visible through solids.

## 3.7 The paper-transfer term

From the reduced second-stock campaign (§1.9): fit a per-paper `(R_paper, λ_PSF, u_offset, β_showthrough)` and check whether `f`, `τ` and SCOP `j,k` are stable across the two stocks. If they are (within the noise floor), ship them as paper-independent and ship only the four paper terms per stock. If they are not, **the shipped dataset is paper-specific and must be labelled with the exact stock**, and the UI must say so. Do not silently generalise.

## 3.8 Stage order

```
S0   scan → linearise → flat-field → merge orientations → patch statistics       §2
S1   scanner colorimetry: root-polynomial deg-2 RGB→XYZ_D50 (Finlayson: root-
     polynomial, never plain polynomial — plain PCC blows up under exposure
     drift, deg-4 went 1.6 → 57 ΔE). Trained on IT8 + the riso anchor strip,
     the latter weighted 3× because it is in the actual colorant space.
     Report its own leave-one-out residual.
S2   per-sheet drift (gain, offset) in log paper-relative space, control lattice §1.7
S3   banding S(x,y): poly2 + cos/sin at λ_drum from the flood FFT               §1.7c
S4   MECHANICAL dot gain m_i(a) from the 2400 ppi MDG strip                      §3.1 D1
S5   Neugebauer primaries: 7 solids, 42 ordered solid overprints, 10 triples —
     MEASURED, never predicted
S6   optical: fit u (per screening mode) + λ_PSF, given m_i(a).  Cross-check
     u ↔ λ. Fit set = every a ≤ 0.5, Σa ≤ 1.2.  Validate on a > 0.5 separately. §3.1
S7   superposition spreading f_{i/J}, |J| ≤ 1;  Bugnon parabola where noisy      §3.2
S8   trapping τ from ordered SOLIDS (runs A/B), wet/dry from run C               §3.4
S9   SCOP j,k — Tier 1 on the wedges, Tier 2 pooled on all pairs                 §3.3
S10  fluorescence: gel differential → e_rgb, Q(a); validate against F0           §3.5
S11  opacity per ink from the 3-backing wedges                                   §3.3
S12  joint polish: L-BFGS-B over all free params, init = S4–S11, objective =
     Σ w_p · ||OKLab_pred − OKLab_meas||²  with  w_p = area_ratio_p / se_p² ,
     plus ridge toward the pooled values and monotonicity constraints on f.
     Cap at 2 % relative improvement — if the joint polish moves anything by
     more than that, a stage is mis-specified. Investigate, don't accept.
S13  validation H1–H4                                                            §5
S14  emit js/ink-model.js + report.html                                          §4
```

Stage S12's cap is a real guard: sequential stage-wise fitting followed by a joint polish is only sound if the stages are nearly orthogonal. A large joint-polish gain means they are not, and the most likely cause is a leaked nonlinearity from §2.5.

---

# 4. HOW THE FIT LANDS IN THE CODEBASE

## 4.1 What replaces `RISO_CAL`, and what does not

**`RISO_CAL` is not deleted.** It remains (a) the legacy render path, guaranteeing bit-identity for saved projects, and (b) the fallback for the 40 inks the campaign never touched.

New file **`js/ink-model.js`**, loaded after `js/data.js`, exporting `R.INK_MODEL`:

```jsonc
{
  "schema": "risocam.inkmodel/1",
  "fit_id": "b71e0f4a",                       // sha256 of the fitted parameter blob
  "campaign": {
    "machine": "RISO SF5230EII", "driver": "…", "driver_settings_hash": "…",
    "paper": { "name": "…", "gsm": 100, "batch": "…" },
    "screening": [{ "engine":"amt-fs", "lpi":43 }, { "engine":"driver-fm", "dpi":600 }],
    "runs": ["A","B","C"], "sheets_measured": 70, "date": "2026-…",
    "colorimetry": "absolute-d50"             // or "paper-relative" if no spectro anchor
  },
  "paper": { "R_lin": [0.812,0.816,0.808], "xyz": [...], "oba_E": [...] },
  "global": {
    "u": { "am43": 0.31, "fm600": 0.12 },     // 1/n, may be NEGATIVE
    "u_model": { "alpha": …, "beta": … },     // log n = α + β·lpi, for unmeasured rulings
    "psf_lambda_mm": 0.086,
    "flare_phi": [0.0041,0.0039,0.0044],
    "showthrough": { "beta": 0.115, "psf_mm": 0.62 },
    "scop_pool": { "j": [[…]], "k": [[…]] },  // the transfer fit — applies to ALL 47 inks
    "trap_model": { "c1": 0.18, "c2": 0.07, "T_hours": 6.0, "T_assumed": false }
  },
  "inks": {
    "Blue": {
      "provenance": "measured",
      "solid_lin": [0.0157,0.1129,0.5106],
      "ladder": [[a, r,g,b], …],              // 18 measured levels, LINEAR reflectance
      "m_mech": [[a_nom, a_printed], …],      // from the MDG strip
      "u": 0.29,                              // null → use global
      "spread": { "paper": [q25,q50,q75],
                  "under": { "Black":[…], "Yellow":[…], "Bright Red":[…],
                             "Green":[…], "Fl. Pink":[…], "Fl. Orange":[…] },
                  "form":  { "Black":"parabola", "Yellow":"cubic3", … } },
      "scop": { "j":[…12…], "k":[…12…] },
      "opacity": 0.09,
      "fluo": null,
      "sigma_cell_typ": 0.013
    },
    "Fl. Pink": { …, "fluo": { "e_rgb":[…], "q_max":0.061, "a_half":0.34,
                               "identified_by":"gel-differential",
                               "illuminant":"scanner-led-2026-07" } },
    "Aqua": { "provenance": "thirdparty", "solid_lin": null }   // upgraded only by global{}
  },
  "overprint_solids": {                        // 42 ordered, MEASURED — never predicted
    "Black>Blue": { "rgb_lin":[…], "se":[…] }, "Blue>Black": { … }, …
  },
  "trap": { "Black>Blue": { "wet":0.84, "dry":0.93 }, … },     // 42 ordered
  "registration": { "sigma_feed_mm":0.71, "sigma_cross_mm":0.38,
                    "sigma_theta_deg":0.09, "sigma_stretch":0.0012, "p95_mm":1.6 },
  "validation": { "noise_floor_dE00":1.1, "H1":{…}, "H2":{…}, "H3":{…}, "H4":{…} }
}
```

Size: ~45 KB minified for 7 measured inks + 40 stubs. Ship as a JS file (no fetch, no CSP issue, no race) and add it to `sw.js`'s precache list.

**Resolver.** One function, `R.getInkData(name, ctx)`, returns:
1. `INK_MODEL.inks[name]` if present, measured, and `ctx.inkModelVersion >= 1`;
2. else a **synthesised** entry: the third-party `RISO_CAL[name].lut` linearised, plus `INK_MODEL.global` (u, PSF, SCOP pool, trap model) — this is how the 40 unmeasured inks get upgraded;
3. else legacy `RISO_CAL` verbatim.

The 12 inks whose first four LUT knots are a perfectly even ramp — **Black, Lagoon, Indigo, Wine, Burgundy, Bisque, Bubblegum, Kelly Green, Smoky Teal, Fl. Green, Fl. Red, Clear Medium** — must be tagged `provenance: "synthetic"` in the resolver's output. **Black is one of the seven drums and gets replaced by real measurement.** The remaining 11 stay synthetic, and the UI must not claim accuracy for them. A one-line badge in the ink picker ("measured / vendor scan / interpolated") costs nothing and is the difference between an honest tool and a confident one.

## 4.2 Shader changes

**Uniform budget is tight** (`js/renderer.js:264-306` already enumerates a large `locs` table, and units 0–10, 13–15 are in use). Minimise new uniforms by pushing everything expensive into the existing baked LUT texture.

**New uniforms — 3 vec4s + 2 floats:**

```glsl
uniform float u_inkModel;   // 0 = legacy (bit-identical), 1 = fitted model
uniform vec4  u_ynU;        // 1/n per layer slot; may be negative
uniform vec4  u_trapTau;    // τ for this layer against the union below (CPU-resolved from layerOrder)
uniform vec4  u_fluoAmt;    // per-layer fluorescent scale, 0 for non-fluorescent
uniform float u_calLutRows; // 12, for row addressing
```

**The cal-LUT texture does the heavy lifting.** `js/renderer.js:2044` currently uploads **256 × 4 RGBA UNSIGNED_BYTE** on `gl.TEXTURE14`. Extend to **256 × 12**, keeping the same unit:

| Rows | Content |
|---|---|
| 0–3 | ink-over-**paper** appearance vs coverage (existing) |
| 4–7 | ink-over-**the composite of layers below at solid** — computed CPU-side by the full SCOP + superposition-spreading + τ model |
| 8–11 | fluorescent emission `e_rgb · Q(a)` in RGB, `A_exc` prior in alpha |

The shader then lerps rows `i` and `i+4` by the accumulated coverage below. **Zero new texture units, zero new uniform vectors for the model's expensive parts, and the entire SCOP/Neugebauer/spreading solve lives in JS where it can be unit-tested against the measured patches.** `js/cal-lut-worker.js` already exists, is already async, already has the Fritsch–Carlson implementation, and already has a re-upload path (`_uploadCalLut`) — extend it, do not add a parallel mechanism.

**Precision fix, do this at the same time.** The texture is `UNSIGNED_BYTE`. At `R = 0.03` (a deep overprint), 1/255 is a **3 % relative** error. Either use `RGBA16F` via `OES_texture_half_float` (check support, fall back), or — cheaper and universally supported — **store density instead of reflectance**: `D = −log10(R) ∈ [0, 2]`, encode `D/2 × 255`. The quantisation step becomes 0.0078 D ≈ **1.8 % relative reflectance at every level**, uniformly. One `pow` on read. This is a strictly-better encoding for a physical model and costs nothing.

**The stage-4 rewrite** (`index.html:2484-2490`). The essential change is splitting the conflated `d`:

```glsl
// ── Stage 4 (u_inkModel > 0.5): YN area-mix in LINEAR reflectance ──
// aArea = fraction of the aperture covered by ink   (the dot mask / local mean)
// dAmt  = ink amount WITHIN a covered dot           (opacity × density × trapping)
float aArea = grain;
float dAmt  = clamp(u_inkOpacity * u_trapTau[iLayer]
                    * mix(u_dotMin, 1.0, coverage), 0.0, 1.0);

vec3  Rbg   = srgb2lin(result);                     // §0.1 — the physics is linear
vec3  Rink  = srgb2lin(ink);
vec3  Rpap  = srgb2lin(paper);

vec3  Tk    = clamp(Rink / max(Rpap, vec3(1e-3)), vec3(1e-3), vec3(1.0));
vec3  Rcov  = Rbg * pow(Tk, vec3(dAmt));            // Beer-Lambert INSIDE the dot

float uY = u_ynU[iLayer];
vec3  Rout;
if (abs(uY) < 0.02) {                               // n → ±∞ : geometric-mean limit
  Rout = exp(mix(log(max(Rbg,vec3(1e-4))), log(max(Rcov,vec3(1e-4))), aArea));
} else {
  vec3 mixYN = mix(pow(max(Rbg, vec3(1e-4)), vec3(uY)),
                   pow(max(Rcov,vec3(1e-4)), vec3(uY)), aArea);
  Rout = pow(max(mixYN, vec3(1e-6)), vec3(1.0/uY));
}
result = lin2srgb(Rout);
```

Notes:
- The `Tk = ink/paper` normalisation is the fix that stops paper being counted `n` times in the overprint — it is already present in the `u_dbgYNArea` branch (`index.html:2447`) and must survive into the default path.
- At `u = 1` this reduces to Murray–Davies area mixing, **not** to today's code. Today's code has no area term at all. So bit-identity for legacy is achieved only by keeping the old branch under `u_inkModel < 0.5`, not by any parameter setting of the new one.
- `iLayer` is `layerIdx` cast to an index; in WebGL1, `u_ynU[int]` with a non-constant index is not portable — use the existing `layerIdx < 0.5 ? … : …` chain pattern already used for `u_transparent0..3` (`index.html:2497`).

**Fluorescence needs one accumulator and it is the piece that produces order asymmetry.** Add a `vec3 emit` alongside `result` in the layer loop:

```glsl
// at the top of the composite:  vec3 emit = vec3(0.0);
// in each layer block, AFTER the multiplicative stage:
emit *= Tk;             // emission from BELOW is attenuated by this layer (emission band)
emit *= Tk.b;           // …and its excitation light was attenuated too (excitation ≈ blue)
emit += u_fluoAmt[i] * texture2D(u_calLutTex, vec2(cov, (8.0+float(i)+0.5)/u_calLutRows)).rgb;
// at the very end, in LINEAR space:
Rfinal = Rmultiplicative + emit;
```

Two multiplies and one add per layer. This is structurally correct — an ink printed above a fluorophore attenuates the incident excitation *and* the emerging emission, in two different bands — and it is precisely the asymmetry a Beer–Lambert product cannot represent (a product is order-symmetric). `emit` is additive and can push the total radiance factor above 1.0, which is exactly what a daylight-fluorescent ink does and what no product-of-transmittances model can produce.

**Also fix, while in there:**
- Stage 6's flat 2 % cross-ink contamination (`index.html:2511`) — it is a constant with no measurement behind it. Under `u_inkModel > 0.5`, set it to 0; the trapping and spreading terms now carry that physics with data behind them.
- The `mix(p100, lutInk, smoothstep(0.3,0.7,coverage))` blend at `:2479-2481` is a hand-tuned heuristic that the fitted `f_{i/J}` supersedes. Bypass it under `u_inkModel > 0.5`.

**CPU side.** `js/sep-lut-worker.js`'s `forwardYNSN` (`:90`) already has the right skeleton but hardcodes `opts.ynN ?? 2.0` and predicts primaries **subtractively** (`primary(mask)` multiplies solids' ratios, `:98-105`) — i.e. exactly the naive product SCOP exists to correct. Under `u_inkModel > 0.5`:
- `primary(mask)` returns the **measured** `overprint_solids` entry for masks of popcount ≤ 2 (all 21 pairs, both orders, are measured), and the **SCOP-corrected** product for popcount ≥ 3 or for unmeasured inks.
- `covOf` (`:63`) — the `dens·0.01 → gamma → S-curve → positional dot gain → depletion → sqrt softening` chain — is replaced by `f_{i/J}` from the model. That chain is six stacked heuristics; the campaign measures the thing they were approximating. Keep it under legacy.
- `opts.ynN` becomes the per-ink `u` table.

## 4.3 Keeping uncalibrated output bit-identical

Three separate guarantees, because "uncalibrated" means three different things here:

**(1) Saved projects.** Add `inkModelVersion` to the project/save schema. Absent or `0` → legacy `RISO_CAL` path, `u_inkModel = 0.0`, every new code path skipped. Any project saved before this change re-renders exactly as before, forever. New projects default to `1`.

**(2) The shipped default dataset legitimately changes output.** That is the point of the campaign — a measured default for every user, including the majority with two drums who will never calibrate. It goes out under a version bump with before/after renders in the release note, not silently. Users can pin `inkModelVersion: 0` per project.

**(3) The per-user calibration layer is a delta on top, default off.** Gated by `u_useUserCal`, stored in `localStorage` alongside the existing `risocam_custom_profiles` mechanism (`js/ui-controls.js:446`), keyed on `{ink_set_hash, paper_id, machine_id, driver_settings_hash}`, with a **hard refusal** (not a warning) on any mismatch — `CHART-DESIGN.md` §5.4 already specifies this and it should be honoured literally.

**Proving (1) and (3).** A golden-image harness (the WebGPU plan already budgets one — `docs/WEBGPU-PLAN.md`):
- Fixed seeds: `u_frameSeed = 0`, `_stampSeed = 0`, AMT prepass RNG, stipple sampler, blue-noise generation.
- ~30 reference renders across modes/profiles/papers.
- **On the CI GPU: assert SHA-256 equality** of the readback buffer with `u_inkModel = 0`.
- **On other GPUs: assert max per-channel |Δ| ≤ 1/255.** Be honest that exact bit-identity across drivers is not achievable — adding uniforms and uniform-flow branches can change register allocation and thus float rounding on some drivers. Claim hash-equality on the reference GPU and perceptual-equality elsewhere; do not claim more.
- Add `verifyChartDeterminism()` (`CHART-DESIGN.md` R9) to the same harness.

**Fix `js/ui-controls.js:823` first.** It reads `window._saving`, which does not exist — `_saving` is a `let` in `js/state.js:242`, so it is never on `window`. The stipple LIVE timer therefore keeps firing during a separations export and calls `R._stippleBindFrame(i)`, **rebinding texture units 9–12 mid-export**. If the chart plates are generated through any path that touches those units, they are corrupt in a way that will not be visible until the fit produces nonsense. One-character fix, and it must land before a single sheet is printed.

---

# 5. VALIDATION

`CHART-DESIGN.md` §4.5 already mandates Sharma's protocol: never a single mean ΔE. This section makes it specific and adds the three hold-outs the chart spec does not have.

## 5.1 The noise floor, measured first

Everything else is meaningless without it. From the within-sheet replicates (every unique patch appears ≥ 2×, ≥ 40 % of the sheet diagonal apart) and the 5 measured sheets per design:

| Quantity | Estimator | Expected (scanner) | Gate |
|---|---|---|---|
| σ_within-sheet | SD of replicate pairs, after flat-field + debanding | 0.6–1.2 ΔE00 | ≤ 2.0 |
| σ_cross-sheet | MAD across the 5 sheets of a run | 1.0–2.0 ΔE00 | ≤ 2.5 |
| σ_cross-run | A vs C at matched patches, both dry at capture | 1.5–3.0 ΔE00 | ≤ 3.0 |
| σ_scanner | drift anchors, start vs end of session | < 0.5 ΔE00 | ≤ 1.0 |

**Fit nothing whose effect is smaller than σ_within-sheet.** That rule decides the Bugnon-parabola-vs-3-knot question per curve (§3.2), decides whether per-ink `u` earns its keep (§3.1), and decides whether the fluorescent split survives (§3.5).

## 5.2 Four hold-outs, because "held-out" means four different things

| | Hold-out | What it estimates | Selection |
|---|---|---|---|
| **H1** | 25 % of patches, Kennard–Stone-selected from the *unused* candidate pool, never fitted | **interpolation** error — how good is the model where it was trained | KS in OKLab over the pool remaining after §2.7's anchors (`CHART-DESIGN.md` §2.7 STEP 3) |
| **H2** | **leave-one-pair-out**: hold out an entire ink pair, refit on the other 20, predict the held-out pair. 21 folds. | **generalisation to unmeasured ink pairs** — what a user gets when they combine inks the author never printed together | exhaustive |
| **H3** | **leave-one-ink-out**: remove ink *i*'s campaign data entirely, use only its third-party `RISO_CAL` LUT + `global{}`, predict all of ink *i*'s patches. 7 folds. | **what the other 40 inks get** | exhaustive |
| **H4** | **cross-run**: fit on run A, predict run C (dry). | **session-to-session transfer** — whether a shipped default dataset is defensible at all | — |

**H2 is the headline number.** It is the direct estimate of the SCOP transfer claim, and it is what justifies shipping this to users who own different drums. **H3 is the honest number** and it is the one that should appear in the UI next to any non-measured ink.

Additionally, always report `u`'s own validation: residual on `a > 0.5` patches, which were **never** in the `u` fit set (§3.1 Defence 3).

## 5.3 Metric and reporting

**Metric.** CIEDE2000 in CIELAB D50, computed via the S1 scanner transform. If no spectrophotometer anchor exists, ΔE00 in **paper-relative** space with paper mapped to L* = 100 — and the report must say so in the same sentence as the number. Never launder a paper-relative residual as a colorimetric one.

**Report** (per hold-out, generated as `report.html` alongside the model file):

- mean, median, **p95**, max
- cumulative ΔE00 frequency curve
- separate ΔL*, Δa*, Δb* (distinguishes a paper-tint cast from a tone-curve error — a large ΔL* with small Δa*b* means the tone curve; the reverse means the primaries)
- **a separate row for L\* < 25** (Vrhel & Trussell: goodness metrics break down below L* ≈ 15 once signal-dependent noise is modelled; riso's deep overprints live there)
- **a separate row for patches involving a fluorescent ink**
- a separate row for **triples** (the un-fitted |J| ≥ 2 prediction)
- the measured noise floor from §5.1, alongside every number
- **the current shipped model's numbers on the same hold-outs**, so the improvement is legible

## 5.4 Targets, and what failure looks like

**Targets** (scanner path; add ~2 ΔE00 for the phone refinement path):

| | mean | p95 | max | basis |
|---|---|---|---|---|
| **H1** interpolation | **≤ 2.5** | ≤ 5.0 | ≤ 10 | scanner floor 1.24–1.77 ΔE76 (Asman) + page-to-page 1.0–2.5 (Lee) |
| **H2** unmeasured pair | **≤ 3.5** | ≤ 7.0 | ≤ 14 | SCOP 1.76–2.15 on offset (Deshpande) × ~1.7 for riso |
| **H3** unmeasured ink | **≤ 5.0** | ≤ 10 | ≤ 18 | third-party LUT + global params only |
| **H4** cross-run | **≤ 3.0** | ≤ 6.0 | — | must be ≈ σ_cross-run or the model is fitting the session |
| Fluorescent subset | ≤ 3.5 with the split, ≤ 5.0 without | ≤ 9 | — | Emmel & Hersch's ΔE ~17 Beer-law penalty is the thing being removed |
| L* < 25 subset | ≤ 4.0 | ≤ 8.0 | — | reported separately, always |

**Two go/no-go gates**, both required (`CHART-DESIGN.md` §4.4's structure, tightened):

1. `H1 mean < 2.5` (scanner)
2. `H1 mean < 2 × σ_within-sheet`

If (2) fails while (1) passes, the result is **capture-limited**: the model is fitting the instrument. Say so and improve the capture, do not ship.

Plus one gate the chart spec does not have:

3. **`H1 mean ≤ 0.5 × (current shipped model's H1 mean)`.** If the campaign does not halve the error, it did not pay for itself and something is wrong upstream.

### What would mean the campaign FAILED and must be redone differently

**F1 — σ_within-sheet > 2.5 ΔE00.** The press or the scan is the limit; no model refinement will help and more patches will not help. Redo with: more copies discarded (20 not 10), a serviced/re-inked machine, humidity control, and re-check the scanner's `F_scanner` stability. If it persists, the honest conclusion is that this machine cannot support a 4 ΔE00 model and the project should ship a coarser one and say why.

**F2 — σ_cross-run > 3.0 ΔE00 or H4 > 4.5.** The machine is not reproducible session to session. **A shipped default dataset is then not defensible as "what a risograph does"** — it is one machine on one afternoon. Two responses, pick one and be explicit: (a) ship it labelled as one machine's fingerprint and lean harder on the per-user calibration layer, or (b) repeat the reduced campaign (ladders + solids + 21 solid overprints, 1 sheet) on ≥ 2 more machines and ship the pooled model with the between-machine variance reported. (b) is the right answer if any second machine is reachable.

**F3 — H2 > 6.0 while H1 < 2.5.** The model memorises and **SCOP does not transfer.** The entire "predict unmeasured pairs" premise — the mechanism by which 7 drums improve 47 inks — has failed. Response: ship measured pairs as data, mark every unmeasured pair in the UI as unvalidated, and do not present the SCOP prediction as measured. This is a design-level failure and must be published as such, not buried.

**F4 — the triples row is > 2× the pairs row.** The `|J| ≥ 2` weighted-blend assumption (§3.2) is wrong. Response: measure more triples (there are 35; measure 20) and fit `f_{i/J}` for the |J| = 2 conditions that actually occur in the shipped profiles, or restrict the model's claimed accuracy to ≤ 2 inks.

**F5 — H3 > 8.0 ΔE00.** The third-party `RISO_CAL` LUTs are incompatible with the fitted global parameters — almost certainly because the txtbooks 2019/2020 swatch scans were made on different paper with a different device under a different geometry, and were never verified against a print. **This has a cheap and specific remedy:** re-scan the txtbooks swatch books *on the campaign's own scanner under §1's protocol*. That puts all 47 inks in one measurement space and is a day's work. It should probably be done regardless of whether F5 triggers.

**F6 — the fluorescent split cannot reproduce the 100 directly-measured configurations to within 1.5× the noise floor.** Reject F1-tier, ship F0 (measured configurations only), set `E = 0` elsewhere, and state that print-order asymmetry for fluorescent inks is unmodelled. Do not ship an unidentified split.

**F7 — `n_FM ≤ n_AM43`.** The literature is unambiguous that n rises monotonically with screen frequency. The wrong sign means something upstream is broken — most likely `a_nom` pixel counting, the `exportSeparations` uniform drift (17 drifted uniforms, `js/save.js:925`), the inherited `u_amtJitter = 1.0`, or a residual scanner nonlinearity. **Stop and debug; do not ship a model whose most-cited parameter has the wrong sign of dependence.**

**F8 — < 90 % of overprint patches yield `area(W) ≥ 0.6 · active`.** Registration exceeded the guard. Regenerate the chart with `g = ceil(p95 + 1 mm)` from the measured distribution and reprint the affected designs. This is a cheap, expected iteration, not a campaign failure — but it must be caught by the gate rather than by a puzzling fit.

**F9 — the S12 joint polish moves any parameter by more than 2 %.** The stages are not orthogonal and one is mis-specified. Investigate rather than accepting the polished values, because a joint fit that has to work that hard is a joint fit that will not generalise (and H2/H3 will show it).

---

## 6. Build order

Strictly after `docs/CHART-DESIGN.md` §8 items 1–4 (chart rasteriser, furniture, T1 generator, analysis pipeline), and before its item 7:

1. **`tools/scan-linearize.py`** — OECF from the Q-13, `F_scanner` from the blank-platen set, per-session drift gate. Ship the linearisation *before* anything else touches a scan.
2. **`tools/extract.py`** — §2 end to end, emitting the measurement store. Validate it by round-tripping a *synthetic* scan: render a chart through the app's own model, add a known flat field + known affine per plate + known noise, and confirm the extractor recovers `a_nom`, the affines and the reflectances to within 0.2 %. **Do this before scanning a real sheet.** It is the only way to know the extractor is not the error source.
3. **`tools/fit.py`** — §3, stages S1–S14, with the noise floor computed first and printed at the top of every run.
4. **`tools/report.py`** — §5.3, HTML, with the current shipped model on the same axes.
5. **`js/ink-model.js` emitter** + the resolver + the golden-image harness.
6. **Shader landing** — §4.2, behind `u_inkModel`, with the `js/ui-controls.js:823` fix first.
7. **Publish the numbers.** There is no peer-reviewed literature on risograph reproduction and no published evaluation of any riso simulator's accuracy. A calibration study with H1/H2/H3 against measured prints from a seven-drum machine would be the first of its kind, and the H3 number in particular — "how wrong is a third-party swatch scan as a physical model" — is a result nobody has.

`docs/INK-PHYSICS-PLAN.md`'s own warning stands and applies harder here than there: *"This can absorb unlimited effort."* Stages 1–4 plus §3.1(a) and §3.2 — the linearised extractor, the measured mechanical dot gain, a real `u`, and superposition-dependent spreading — are a shippable unit that would already be the most physically grounded riso model in existence. SCOP, trapping and fluorescence are the second release.