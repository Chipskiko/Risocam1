# RISO/CAM — CHART **C4-CMYK-A3-T1**
## Buildable sheet layout for the 4-ink Blue / Bright Red / Yellow / Black chart

Instantiates `docs/CHART-DESIGN.md` v1.0 for `k=4`, ink set `{Yellow, Bright Red, Blue, Black}` (the `CMYK` profile in `js/data.js:101`), on the author's own 7-drum machine. Everything below is coordinates, not intent.

**Files read:** `docs/CHART-DESIGN.md`, `docs/INK-PHYSICS-PLAN.md`, `docs/LITERATURE.md`, `js/data.js`, `js/renderer.js:440-535`, `js/state.js:9,49`, `riso_trc.json`, `riso_halftones.json`.

---

# 0. Executive summary of the design decisions

| Decision | Value | Driver |
|---|---|---|
| Sheet | **A3 portrait, 297 × 420 mm**, feed along +Y | A4 cannot hold `k=4` T1 once fiducial rails are counted (§1.2). Drum swaps, not paper, are the cost. |
| Grid | **12 cols × 18 rows = 216 slots**, pitch **20.32 mm** (= 0.8 in = 480 px @600 dpi) | Integer device pixels at 600/300/150/100/75/50 dpi (satisfies CHART-DESIGN R8) |
| Patch active window | **10.16 mm** (0.4 in, 240 px) | 238 halftone cells; **4.03 rosette periods** (§2.2) |
| Patch footprint | **15.24 mm** (0.6 in, 360 px) | 2.54 mm slack/side → 1.54 mm registration tolerance at full area |
| Gutter | **5.08 mm** bare paper, everywhere | constant flare surround → flare becomes one fitted scalar |
| Block patches | **35.56 mm** footprint / **25.40 mm** active (2×2 slots) | 4.08 mm registration tolerance — for the 3- and 4-ink solids |
| Pose master | **Black plate**, 16 × ArUco 9 mm DICT_4X4_50 | only ink with guaranteed contrast on any stock |
| Per-plate registration | **16 ring-cross targets per plate**, found by *windowed* search around the master homography | the RGB unmixing of these 4 inks is **ill-conditioned** (§3.3) — plate identity must come from geometry, not colour |
| Banding | **4 continuous 50 % strips in the sacrificial margin**, 402 mm long | resolves the drum period λ on the *T1* sheet — CHART-DESIGN defers this to T2's flood sheet; this costs zero slots |
| Slot allocation | **216 / 216, exact** | §4 |

---

# 1. Sheet size: A3, and why A4 fails

## 1.1 Why this chart is the highest-priority one

Only 3 of the 13 shipped `PROFILES` are printable on the author's seven drums. `CMYK = Blue + Bright Red + Yellow + Black` is the **superset**: it strictly contains `Classic` (Blue+Bright Red) and `Mono` (Black). One 4-pass print run therefore produces, in a single sheet, the calibration floor for *all three printable profiles*:

- `Mono` needs `{paper, K}` + the K ladder → present.
- `Classic` needs `{paper, B, R, BR}` + B/R ladders + the B/R superposition anchors → present as a sub-lattice.
- `CMYK` needs all 16 Neugebauer primaries → present.

No other chart in the campaign has that property. Every other ink the author owns (Green, Fl. Pink, Fl. Orange) is a *single-ink* addition that only needs a 2-ink chart against Black later.

## 1.2 The A4 arithmetic in CHART-DESIGN §2.4 does not survive `k=4`

`docs/CHART-DESIGN.md` §2.4 claims *"A4 safe area 190 × 270 mm at 16 mm pitch = 11 × 16 = 176 slots (k=3, k=4 at 170 slots)"*. That is wrong for two compounding reasons:

1. **It counts no fiducial area.** §3.4 specifies one 14 mm fiducial band per plate above the grid *and a mirrored band below*. At `k=4` that is 4 × 14 = 56 mm top **and** 56 mm bottom = **112 mm of a 270 mm safe height**, leaving 158 mm → 9 rows → 99 slots.
2. **It sizes every patch as if registration were free.** At `k=4`, 154 of the 180 measured slots are overprints. The 16 mm pitch it assumes is the *single-ink* pitch; §3.2's own overprint pitch is `16 + 2g` = 22 mm at the default `g = 3 mm`, which on A4 gives 8 × 12 = 96 slots.

Either correction alone kills A4. Together, A4 delivers ~90 usable slots against a requirement of 216.

**A3 is not a luxury, it is the minimum sheet on which a 4-ink T1 exists.**

## 1.3 The cost accounting that makes A3 obviously right

The expensive resources on a riso are, in order: **drum swaps** (minutes each, manual, 4 per run), **masters** (one per plate per run, consumable), **ink**, and only then paper. A3 doubles the patch budget for **identical** drum-swap and master counts. Paper cost per usable patch roughly halves.

The one thing A3 costs is capture convenience — handled in §7.

## 1.4 Physical envelope

```
Sheet                 A3 portrait, 297.0 × 420.0 mm
Feed direction        +Y (long axis). Leading edge = y = 0.
Chart coordinates     origin top-left as fed, x → right, y → down, millimetres.
Machine print area    x ∈ [4.0, 293.0], y ∈ [7.0, 415.0]        (289 × 408)
Sacrificial margin    x ∈ [4.0, 9.0]  and  x ∈ [288.0, 293.0]   (banding strips, §5.4)
Safe area             x ∈ [9.0, 288.0], y ∈ [13.0, 409.0]       (279.0 × 396.0)
                      — nothing MEASURED lives outside this
Fiducial rails        left   x ∈ [  9.00,  26.58]   (17.58 mm deep)
                      right  x ∈ [270.42, 288.00]
                      top    y ∈ [ 13.00,  28.12]   (15.12 mm deep)
                      bottom y ∈ [393.88, 409.00]
Patch field           x ∈ [26.58, 270.42]  (243.84 = 12 × 20.32)
                      y ∈ [28.12, 393.88]  (365.76 = 18 × 20.32)
Raster                600 dpi, 1-bit, 7016 × 9922 px  (PDF page 841.89 × 1190.55 pt)
```

Note the safe-area inset is 5 mm at the leading edge, not CHART-DESIGN's 15 mm. This is deliberate: 15 mm was chosen for an unknown machine. The author knows their own grip margin and can measure it once; if it exceeds 6 mm, drop row 0 and rebuild at 12 × 17 = 204 slots (the §4 inventory then loses the third replicate of the 2-ink overprints).

---

# 2. Patch geometry, derived

## 2.1 The screen this chart will actually be printed with

From `riso_trc.json` meta: the app's `lpi: 43` "Fine" preset is calibrated against a measured **Screen-40 print at 38.6 lpi**. That is the number to size against, not 43.

```
cell size      = 25.4 / 38.6 = 0.6580 mm  = 15.54 px @ 600 dpi
screen angles  Yellow 0°,  Blue 15°,  Black 45°,  Bright Red 75°   (js/state.js:9)
```

## 2.2 Three constraints, and a fourth that CHART-DESIGN missed

**(a) Halftone integration** — CHART-DESIGN §3.1a: `patch_active ≥ 14 × cell` → **9.21 mm**.
At 10.16 mm: `(10.16/0.658)² = 238 cells`, `se = 0.05/√238 = 0.324 %` area. ✓ (target ≤ 0.4 %)

**(a2) Rosette integration — NEW, and it is the binding constraint at `k=4`.**
CHART-DESIGN §3.1 sizes patches against a *single* screen's cell. With four plates the low-frequency term is not the cell, it is the **rosette beat between the closest-angled pair**. Yellow at 0° and Blue at 15° are 15° apart:

```
rosette period = cell / (2·sin(Δθ/2)) = 0.658 / (2·sin 7.5°) = 2.521 mm
```

A windowed mean of a periodic component of amplitude `A` over `n` periods carries a residual `≈ A/(πn)`. With riso's rosette contrast `A ≈ 5 %` area, demanding residual ≤ 0.4 % needs `n ≥ 4`.

```
10.16 mm / 2.521 mm = 4.03 rosette periods    ✓ (just)
25.40 mm / 2.521 mm = 10.08 periods           ✓ (block patches)
```

This cannot be engineered away: four plates cannot all be ≥30° apart modulo 90°, so the classic yellow moiré is structural. **10.16 mm is the floor, not a round number.** Any smaller patch at `k=4` reads the rosette phase, not the tone.

**(b) Camera / scanner sampling**

| path | px/mm | px per 0.658 mm cell | px across 10.16 mm active | gate ≥4 px/cell, ≥60 px |
|---|---|---|---|---|
| Flatbed 400 ppi | 15.75 | **10.4** | **160** | ✓ ✓ comfortable |
| 12 MP phone filling A3 (4000 px / 420 mm) | 9.52 | **6.27** | **97** | ✓ ✓ marginal |
| 8 MP phone | 7.8 | 5.1 | 79 | ✓ but no margin |

A3 pushes the phone path to its limit. This is a second reason (after CHART-DESIGN §4.1) to make the **scanner the primary capture path for this chart** and to treat phone capture as diagnostic only. Enforce the ≥4 px/cell gate on the decoded sensor resolution, not on a JPEG's nominal size.

**(c) Registration guard.** Per CHART-DESIGN §3.2 the guard absorbs only the *residual after* the per-plate affine, not the raw misregistration. But the **ink footprint** must absorb the raw offset, because ink lands where it lands. Design against `σ_y = 1.06 mm, σ_x = 0.86 mm` per plate relative to the pose master (0.8/0.5 mm random + 0.7 mm per-sheet systematic, feed axis worse).

```
slack_1slot = (15.24 − 10.16)/2 − 1.0 mm edge-exclusion = 1.54 mm
slack_block = (35.56 − 25.40)/2 − 1.0 mm                = 4.08 mm
```

## 2.3 The resulting module

```
UNITS: all chart geometry is defined in integer 600-dpi device pixels.
       mm are derived. This satisfies CHART-DESIGN R8 (master texel alignment)
       at 600 / 300 / 150 / 100 / 75 / 50 dpi with zero half-texel edges.

pitch      480 px = 0.80 in = 20.320 mm
footprint  360 px = 0.60 in = 15.240 mm
active     240 px = 0.40 in = 10.160 mm
gutter     120 px = 0.20 in =  5.080 mm

block footprint  840 px = 1.40 in = 35.560 mm
block active     600 px = 1.00 in = 25.400 mm

grid origin (centre of slot (0,0)):  x0 = 868 px = 36.7507 mm
                                     y0 = 904 px = 38.2733 mm

SLOT CENTRE (c, r)   c ∈ [0,11], r ∈ [0,17]
    x_px = 868 + 480·c        x_mm = 36.7507 + 20.320·c
    y_px = 904 + 480·r        y_mm = 38.2733 + 20.320·r
    slot (11,17) centre = (260.27, 383.71) mm

BLOCK at anchor (c, r) occupies slots (c,r),(c+1,r),(c,r+1),(c+1,r+1)
    centre = slot(c,r).centre + (10.160, 10.160) mm
```

Half-slot examples for implementation checking:

| slot | centre mm | active window mm | footprint mm |
|---|---|---|---|
| (0,0) | 36.751, 38.273 | x [31.671, 41.831] y [33.193, 43.353] | x [29.131, 44.371] y [30.653, 45.893] |
| (5,9) | 138.351, 221.153 | x [133.271, 143.431] y [216.073, 226.233] | x [130.731, 145.971] y [213.533, 228.773] |
| (11,17) | 260.271, 383.713 | x [255.191, 265.351] y [378.633, 388.793] | x [252.651, 267.891] y [376.093, 391.333] |

---

# 3. Fiducials, registration recovery, and sheet/patch identity

This is the section that makes every overprint reading defensible. **No patch is read at its nominal position; every read goes through a per-plate transform recovered from that very sheet.**

## 3.1 Rail architecture (replaces CHART-DESIGN §3.4's per-plate bands)

CHART-DESIGN gives each plate its own 14 mm horizontal band. At `k=4` that costs 112 mm of sheet height. Replace it with a **shared perimeter rail in which the four plates are spatially interleaved**. Cost: 17.58 mm on two sides and 15.12 mm on two sides, once, independent of `k`.

```
Lane centrelines
    top lane      y = 20.56       bottom lane   y = 401.44
    left lane     x = 17.79       right lane    x = 279.21
```

### 3.1.1 Plate K (Black) — pose master, 16 ArUco markers

**9.0 mm ArUco, DICT_4X4_50, 6×6 modules, module = 1.500 mm (35.4 px @600 dpi; 23.6 px on a 400 ppi scan; 14 px on a 12 MP phone).** Quiet zone 1 module → clear disc Ø 12.0 mm.

| id | x mm | y mm | station |
|---|---|---|---|
| 0 | 17.79 | 20.56 | corner TL |
| 1 | 279.21 | 20.56 | corner TR |
| 2 | 17.79 | 401.44 | corner BL |
| 3 | 279.21 | 401.44 | corner BR |
| 4 | 78.00 | 20.56 | top |
| 5 | 148.50 | 20.56 | top |
| 6 | 219.00 | 20.56 | top |
| 7 | 78.00 | 401.44 | bottom |
| 8 | 148.50 | 401.44 | bottom |
| 9 | 219.00 | 401.44 | bottom |
| 10 | 17.79 | 115.90 | left |
| 11 | 17.79 | 211.00 | left |
| 12 | 17.79 | 306.10 | left |
| 13 | 279.21 | 115.90 | right |
| 14 | 279.21 | 211.00 | right |
| 15 | 279.21 | 306.10 | right |

IDs are **unique per station**, so orientation and 180° flip are resolved by decoding alone. CHART-DESIGN §3.4's "deliberately asymmetric extra marker" is unnecessary and is dropped. On a multi-sheet campaign, `aruco_id = 16·sheet_index + station`, sheets 0–2 (DICT_4X4_50 holds 50).

The pose master gives **64 corner points** for a chart→image homography. Expected residual RMS on a flat scan: < 0.1 mm.

### 3.1.2 Plates Y, R, B — ring-cross targets, 16 each

**Ring-cross target:** filled annulus, outer Ø 7.0 mm / inner Ø 3.5 mm, plus a 0.8 mm-wide cross through the centre spanning 9.0 mm. Rotationally symmetric (no orientation ambiguity); the annulus gives an intensity-weighted centroid to ~0.03 mm at 400 ppi; the cross survives partial occlusion and gives two independent axis estimates.

16 **stations**, three targets each, staggered along the lane axis by `δ = {Yellow −15 mm, Bright Red 0, Blue +15 mm}`:

| lane | lane coord | station positions (lane axis) |
|---|---|---|
| top | y = 20.56 | x = 46, 113, 184, 250 |
| bottom | y = 401.44 | x = 46, 113, 184, 250 |
| left | x = 17.79 | y = 85, 160, 258, 345 |
| right | x = 279.21 | y = 85, 160, 258, 345 |

Example — top lane station x = 113: Yellow target at (98.0, 20.56), Bright Red at (113.0, 20.56), Blue at (128.0, 20.56).

Clearance audit (worst case in the whole rail): 4.7 mm nominal edge-to-edge between any two targets or between a target and an ArUco quiet zone. With ±3 mm plate displacement in the worst direction the minimum residual gap is 1.7 mm. No two plates' fiducials can merge.

Each plate's 16 targets span the entire perimeter → the per-plate affine (6 unknowns from 32 equations) is well conditioned in translation, rotation **and** per-axis scale.

### 3.1.3 Human-readable registration readout — free

At the four corner stations only, each non-master plate draws a **concentric open ring** around K's ArUco, 0.5 mm stroke:

```
Yellow      Ø 13.0 mm
Bright Red  Ø 14.0 mm
Blue        Ø 15.0 mm
```

Outside K's 12.0 mm quiet disc, inside the 15.12 mm top/bottom rail depth. A human reads concentricity to ~0.3 mm at arm's length and gets a registration number even if every software path fails. This replaces CHART-DESIGN §3.4's 24 vernier combs, which cannot fit an A3 rail and add nothing numerically over a 32:6 over-determined affine.

### 3.1.4 Sheet identity — two Data Matrix codes

**ECC200, 20 × 20 modules, module 0.700 mm → 14.0 mm symbol + 1.4 mm quiet = 15.4 mm.** Fits the 17.58 mm side rails (not the 15.12 mm top/bottom rails).

```
DM-1   left rail,  centred (17.79, 380.0)
DM-2   right rail, centred (279.21,  45.0)
```

Payload: a 10-character Crockford-base32 token = **50 bits**:

```
chart_id_short   24 bits   (top 24 of sha1(ink_set ‖ tier ‖ paper ‖ seed ‖ gen_version))
layout_seed16    16 bits
sheet_index       4 bits
tier              2 bits   (T1/T2/T3)
k                 3 bits
parity            1 bit
```

Printed by the pose master only. The same 10 characters are set in 8 pt human-readable text immediately inboard of each symbol, so a failed decode is a typing job, not a reprint.

Full metadata lives in the chart model JSON (CHART-DESIGN §7.3), keyed by `chart_id`.

### 3.1.5 Slot-index rulers — the "shifted grid" guard

Printed by the pose master on the inner 1.6 mm of two rails.

```
ROW RULER    left rail, x ∈ [24.98, 26.58]
             at each row r: 6 stacked bars, 1.60 mm (x) × 1.60 mm (y), 0.80 mm gaps
             total height 13.6 mm, centred on the row's y
             code = Gray(r) as 5 bits (LSB innermost) + 1 even-parity bit
             bar present = 1, absent = 0

COL RULER    top rail, y ∈ [26.52, 28.12]
             at each column c: 5 side-by-side bars, 1.60 × 1.60 mm, 0.80 mm gaps
             total width 11.2 mm, centred on the column's x
             code = Gray(c) as 4 bits + 1 parity
```

The ruler is 2.54 mm from the nearest patch footprint edge; a 1.6 mm bar at that distance contributes a negligible and *constant* flare term, absorbed by the same fitted offset as the gutters.

This is the independent check that catches a whole-slot grid shift — the failure mode CHART-DESIGN §4.4 flags as *"would otherwise produce a confidently wrong correction."*

## 3.2 Analysis chain — exact order

```
 1. Decode DM-1 or DM-2 → 50-bit token → chart_id, layout_seed16, sheet_index, tier, k
 2. Load chart model JSON for chart_id; verify its layout_hash == H(layout_seed, gen_version)
    MISMATCH ⇒ hard refusal (CHART-DESIGN §5.4)
 3. Detect K's ArUco constellation in LUMINANCE (K has max contrast on any stock).
    Fit homography H_K : chart_mm → image_px from ≥12 markers × 4 corners.
    Gate: ≥12 of 16 markers, residual RMS < 0.30 mm.
 4. BOOTSTRAP THE DETECTION CHANNELS.
    Read the 3 replicates of each single-ink solid through H_K, sampling only the
    central 6 mm (H_K alone locates them to ±3 mm, so 6 mm is always inside the ink).
    Δ_i = r_paper − r_solid_i   (from this sheet's own white lattice and solids —
                                 never from the RISO_CAL table; the stock may be tinted)
    channel(i) = argmax_ch |Δ_i[ch]|
 5. Read the row/column rulers at H_K-predicted positions.
    Any parity failure or non-monotone sequence ⇒ reject the capture ("grid shift").
 6. For each plate p ≠ K:
       for each of p's 16 ring-cross targets:
           search a 12 × 12 mm window centred on H_K(nominal_p) in channel(p)
           → intensity-weighted centroid + cross-arm axis fit
       fit A_p : chart_mm → image_px, full affine (tx, ty, θ, sx, sy, shear)
       record residual_RMS_p; if > 0.50 mm, quarantine plate p (§8)
    A_K := H_K.
 7. For each patch P with participating plates {p1..pm}:
       foot_i = A_{p_i}( P.footprint_polygon )
       I      = erode( ∩_i foot_i , 1.00 mm )
       W      = largest axis-aligned square of side ≤ P.active_side inscribed in I,
                centred on centroid(I)
       usable = area(W) / area(P.active_window)
       if usable < 0.60 ⇒ flag "registration", do not fit
       else sample 10 %-trimmed mean of W; store (value, usable, spatial σ)
 8. Flat field, flare, paper-relative — CHART-DESIGN §5.1 steps 1–3.
```

Step 6 is the load-bearing one and it is why the design tolerates 2 mm registration: **the misregistration is measured, then divided out of the geometry.**

## 3.3 Why the detection is windowed, not unmixed — a quantified finding

The obvious approach is to unmix the scan into four ink channels and detect each plate in its own channel. **For this specific ink set that fails.** Using `RISO_CAL` solids against the default `White` stock `#f5f0e8` = (0.961, 0.941, 0.910):

| ink | solid RGB | Δ from paper (R, G, B) | best channel | contrast |
|---|---|---|---|---|
| Yellow | 0.967, 0.909, 0.226 | −0.006, +0.032, **+0.684** | **B** | 0.684 |
| Bright Red | 0.978, 0.263, 0.086 | −0.017, +0.678, **+0.824** | **B** / G | 0.824 / 0.678 |
| Blue | 0.130, 0.361, 0.738 | **+0.831**, +0.580, +0.172 | **R** | 0.831 |
| Black | 0.030, 0.030, 0.030 | **+0.931**, +0.911, +0.880 | **R** | 0.931 |

Least-squares detection weights `W = (DDᵀ)⁻¹D` give a response matrix `DᵀW` that is *not* close to identity:

```
            → Y      R      B      K
    Y     0.876 -0.074 -0.241  0.213
    R    -0.074  0.956 -0.143  0.127
    B    -0.241 -0.143  0.533  0.413      ← Blue leaks 41 % into Black
    K     0.213  0.127  0.413  0.635      ← Black leaks 41 % into Blue
```

**Blue and Black are near-collinear in RGB.** Three sensor channels cannot separate four inks two of which are both "dark and desaturating", and no chart geometry fixes that.

Therefore: **plate identity comes from position (the ±15 mm lane stagger), not from colour.** The detection channel is used only to raise a single blob out of the background inside a 12 × 12 mm window that is *guaranteed by construction* to contain exactly one target of exactly one plate. This is a much easier problem than global detection, and it is the reason yellow fiducials — which a global ArUco detector on a greyscale image simply cannot find — work at all here.

---

# 4. Patch inventory — 216 slots, exactly allocated

Ink indices and print order (light → dark, one drum per pass):

```
pass 1  Yellow      (Y)   screen 0°
pass 2  Bright Red  (R)   screen 75°
pass 3  Blue        (B)   screen 15°
pass 4  Black       (K)   screen 45°   ← pose master
```

## 4.1 Allocation table

| # | Group | Unique | Reps | Slots | Answers (CHART-DESIGN §1) |
|---|---|---|---|---|---|
| G0 | Paper-white lattice (locked) | 16 | — | **16** | Q0 flat field, Q5 |
| G1 | Single-ink solids `{Y,R,B,K}` @100 % | 4 | ×3 | **12** | Q2 floor |
| G2 | 2-ink solid overprints (6) | 6 | ×3 | **18** | Q2 floor |
| G3 | 3-ink solid overprints (4) | 4 | 1 block + ×2 singles | **24** | Q2 floor, Q6 stress |
| G4 | 4-ink solid overprint (1) | 1 | 1 block + ×2 singles | **6** | Q2 floor, Q6 stress |
| G5 | Tone ladders, 8 interior levels × 4 inks, on bare paper | 32 | ×2 | **64** | Q1 |
| G6 | Superposition anchors, ink `i` @50 % over solid subset `J` | 28 | ×2 | **56** | Q2 (Bugnon single-point) |
| G7 | Mid-tone drift controls, 50 % × 4 inks (locked) | 8 | — | **8** | Q5, Q7 |
| G8 | Flare probes (2 blocks) | 2 | — | **8** | Q0 |
| G9 | Show-through / shadow-headroom target (1 block) | 1 | — | **4** | Q4, gate §4.4 |
| | **TOTAL** | **101** | | **216** | |

`16 + 12 + 18 + 24 + 6 + 64 + 56 + 8 + 8 + 4 = 216 = 12 × 18` ✓
Locked furniture = 36 slots; blocks = 20 slots; free single slots = **160**, and the single-slot inventory is `12 + 18 + 8 + 2 + 64 + 56 = 160`. Exact.

The grid is fully occupied by design. The annealer permutes assignments among the 160 free slots and needs no empty slots. If a group must grow later, **the white lattice is the elastic buffer** — it can fall to 12 (a 2nd-order flat field has 6 coefficients and is still over-determined at 12 white + 8 control = 20 observations).

## 4.2 The tone ladder

CHART-DESIGN §2.3, T1 (10 levels; 0 comes from the white lattice, 100 from the solids):

```
levels        0   3   7  12  20  30  42  56  72  100        (% nominal plate area)
interior      —   3   7  12  20  30  42  56  72   —         → 8 per ink × 4 inks = 32
fit set (u)       3   7  12  20  30  42                     ≤ 50 %, 6 points/ink
validation                            56  72  100           > 50 %, reported separately
```

Ruckdeschel & Hauser: `n` is only empirically determinable below ~50 % coverage. **Never fit `u = 1/n` on the shadow points.**

Note the ladder deliberately avoids the app's existing `RISO_CAL` knots at 10/30/50/70/100. Only 30 % coincides. The new data is therefore substantially independent of the prior it is meant to replace — this matters because 12 of the ~47 LUTs in `js/data.js` have synthetic even-ramp first knots and the campaign must not launder them.

## 4.3 The 15 Neugebauer primaries

| order | primaries | slot form | rationale |
|---|---|---|---|
| 1 ink | `Y R B K` | 3 × 1-slot | single-plate → registration-immune |
| 2 ink | `YR YB YK RB RK BK` | 3 × 1-slot | 2 plates; slack 1.54 mm |
| 3 ink | `YRB YRK YBK RBK` | 1 block + 2 × 1-slot | 3 plates must coincide; block gives 4.08 mm slack |
| 4 ink | `YRBK` | 1 block + 2 × 1-slot | 4 plates; darkest patch on the sheet |

**The 2×2 blocks are allocated by registration fragility, not by importance.** A 3- or 4-plate patch is the one whose intersection window collapses first; giving it 2.7× the slack is what keeps the Neugebauer *floor* — the one thing no model can predict and every model needs — intact on a badly-registered sheet.

`YRBK` at 400 % TAC will be wet, will set off, and is beyond any sane riso ink limit. It is printed anyway because it is a mandatory Neugebauer primary (CHART-DESIGN §2.7 STEP 2 anchors are exempt from the TAC rejection in STEP 1). Slip-sheet, and expect to inspect it.

## 4.4 The 28 superposition anchors

Ink `i` at **50 % nominal**, every ink in `J` at **100 %**, for every non-empty `J ⊆ {inks} \ {i}`. `k(2^(k−1) − 1) = 4 × 7 = 28`.

| ink `i` | backing subsets `J` | plate count |
|---|---|---|
| Y | R, B, K, RB, RK, BK, RBK | 2,2,2,3,3,3,4 |
| R | Y, B, K, YB, YK, BK, YBK | 2,2,2,3,3,3,4 |
| B | Y, R, K, YR, YK, RK, YRK | 2,2,2,3,3,3,4 |
| K | Y, R, B, YR, YB, RB, YRB | 2,2,2,3,3,3,4 |

12 two-plate, 12 three-plate, 4 four-plate. Each yields `q'(0.5)` → one Bugnon parabola `f(q) = [2 − 4q'(0.5)]q² + [4q'(0.5) − 1]q` per (ink, backing) pair.

**Optional variant `--tall-anchors` (recommended).** The four 4-plate anchors are the most registration-fragile 1-slot patches. Riso misregistration is anisotropic (feed axis worse: `σ_y ≈ 1.06` vs `σ_x ≈ 0.86`). Instead of ×2 replicates, give each a **vertical double** — 1 col × 2 rows, footprint 15.24 × 35.56 mm, active 10.16 × 25.40 mm — raising the y-slack from 1.54 to 4.08 mm while costing the same 2 slots. Trade: no within-sheet replicate for those four (their σ is inferred from the 12 three-plate anchors). Take the trade; a lost 4-plate anchor is worth more than its noise estimate.

## 4.5 Position-locked furniture — exact slot coordinates

Verified collision-free (script-checked; 36 locked slots, 20 block slots, 160 free).

**G0 — paper-white lattice, 16 slots.** `(c, r) ∈ {2, 5, 8, 11} × {2, 7, 12, 17}`
No ink is rasterised anywhere in these slots' footprints. Distributed as a 4×4 lattice so the 2nd-order flat field `S(x,y) = exp(poly2(x,y))` (6 coefficients) is over-determined 16:6, and so that **every A4 scan strip (§7) contains exactly 4 white points**.

**G7 — mid-tone drift controls, 8 slots, one 50 % flat patch each, single-plate.**

| slot | ink | slot | ink |
|---|---|---|---|
| (4, 0) | Y @50 % | (3, 10) | Y @50 % |
| (9, 3) | R @50 % | (8, 13) | R @50 % |
| (1, 5) | B @50 % | (6, 14) | B @50 % |
| (10, 8) | K @50 % | (2, 16) | K @50 % |

Two per ink, two per scan strip band. Single-plate → **always readable regardless of registration** → always available as the per-sheet gain/offset tie for cross-run merging (CHART-DESIGN §5.4 step 2).

**G8 — flare probes, 2 blocks.**

| probe | block anchor | slots | content |
|---|---|---|---|
| FLR-A | (0, 0) | (0,0)(1,0)(0,1)(1,1) | 25.40 mm 100 % **Black** field with a 10.16 mm **unprinted** well at centre |
| FLR-B | (9, 15) | (9,15)(10,15)(9,16)(10,16) | 25.40 mm **unprinted** field with a 10.16 mm 100 % **Black** square at centre |

Diagonally opposed, so any spatial variation in the veiling-glare coefficient is bounded by two samples.
`φ = reading(FLR-A well) − mean(white lattice)`, subtracted as a constant before fitting.

**G9 — show-through / shadow-headroom target, 1 block at (5, 9).** Slots (5,9)(6,9)(5,10)(6,10). 25.40 mm 100 % Black solid, sheet centre, inside the all-strip overlap region. Serves three jobs: a fourth K-solid replicate; the **verso** reading for Q4 (the verso is otherwise deliberately blank); and the shadow-headroom gate (`darkest solid ≥ 12 counts above black level`).

**Blocks (G3/G4), 5 anchors:**

| block | anchor slot | rows spanned | scan strip |
|---|---|---|---|
| `YRK` | (0, 3) | 3–4 | A / A∩B |
| `RBK` | (3, 5) | 5–6 | A∩B |
| `YRBK` | (6, 7) | 7–8 | **A∩B, and in all three strips** |
| `YBK` | (9, 10) | 10–11 | B∩C |
| `YRB` | (6, 15) | 15–16 | C |

`YRBK` — the single most load-bearing and most fragile patch — sits at the sheet centre where affine residual is smallest and where it appears in every scan strip.

---

# 5. Randomisation, banding, and identity recovery

## 5.1 What is randomised and what is not

Randomised: the assignment of the **160 measured single-slot patches** to the **160 free slots**.
Not randomised: everything in §4.5, the rails, the rulers, the ladder *values*.

`layout_seed = sha1(ink_set_hash ‖ "T1" ‖ paper_id ‖ user_seed ‖ generator_version)[0:8]`, recorded in the model file and in both Data Matrix symbols. **Same seed ⇒ byte-identical plates.**

## 5.2 Hard constraints (rejected outright by the annealer)

```
H1  Locked slots (§4.5) and block slots never move.
H2  Replicates of the same unique patch must satisfy
        |Δrow| ≥ 6  AND  |Δcol| ≥ 4
    ⇒ ≥ 122 mm apart in y, ≥ 81 mm in x, ≥ 146 mm Euclidean
      (33 % of the 439 mm grid diagonal; CHART-DESIGN §3.3 asks 40 % — H2's
       *directional* form is stronger, because it forces replicates into
       different A4 scan strips, which the Euclidean form does not.)
H3  Every 4-plate patch must lie in rows 2..15 and cols 1..10.
    (Affine residual grows toward the trailing corners as cockle; the
     interior is where 4 plates are most likely to actually coincide.)
H4  No two 4-neighbour slots may both have total nominal coverage ≥ 90 %.
    (Local ink starvation + mutual integrating-cavity flare.)
H5  For each ink i and each row r:   |rowload(i,r) − mean_r rowload(i,·)| ≤ 0.12 · mean
    For each ink i and each col c:   same, with 0.12
    where rowload(i,r) = Σ over the row's 12 slots of that slot's nominal a_i.
    (ISO 12642-2's "uniform ink loading in each colour across the target area",
     made numeric.)
H6  Each 5-row scan band {0-3}, {4-8}, {9-13}, {14-17} must contain ≥ 4 white-lattice
    slots and ≥ 2 control slots. (Satisfied by construction — verify, don't anneal.)
```

## 5.3 Soft cost and the annealing schedule

```
cost(assignment) =
    1.0 · Σ_i [ Var_r(rowload[i]) / mean_r²  +  Var_c(colload[i]) / mean_c² ]
  + 2.0 · Σ_i [ (max_r rowload[i] − min_r rowload[i]) / mean_r ]²
  + 0.3 · Σ_{4-neighbour pairs (s,t)} max(0, |Σa(s) − Σa(t)| − 0.5)²
  + 1.5 · Σ_{replicate pairs (s,t)} max(0, 173 − dist_mm(s,t))² / 173²
  + 0.8 · Σ_{4-plate patches p} (distance of p from grid centre / half-diagonal)²

anneal:  500 000 proposed transpositions of two FREE slots
         T: 1.0 → 0.005, geometric, ratio = (0.005)^(1/500000)
         Metropolis acceptance; reject any swap violating H1..H5
         RNG = xoshiro128** seeded from layout_seed  (deterministic, cross-platform)
report:  final cost, max |rowload deviation|, min replicate distance, H5 margin
```

Ship **both** layouts, per ECI2002 and CHART-DESIGN §3.3.4: `random` (default, for fitting) and `grouped` (ladders in coverage order, for eyeballing). Same patch *set*, different placement, different `chart_id`.

## 5.4 Roller banding — solved on the T1 sheet, for free

CHART-DESIGN §3.5 concedes that T1 can only fit a smooth 2nd-order surface, and defers the drum period `λ` to T2's full-sheet flood. That is a real loss, because **a 20.32 mm row pitch aliases catastrophically against any banding period near 20.32, 10.16 or 40.64 mm** — every slot in a column then samples the same phase, and the periodic term is not just unfitted but invisible.

Fix, at zero slot cost: **four continuous 50 % strips in the sacrificial margin**, outside the safe area but inside the machine print area.

```
LEFT   x ∈ [  4.60,   6.80]   50 % Black         y ∈ [10.0, 412.0]   (402 mm)
       x ∈ [  7.10,   8.90]   50 % Blue          y ∈ [10.0, 412.0]
RIGHT  x ∈ [288.10, 290.30]   50 % Bright Red    y ∈ [10.0, 412.0]
       x ∈ [290.60, 292.40]   50 % Yellow        y ∈ [10.0, 412.0]
```

Each strip is scanned as a 1-D signal: at 400 ppi, 402 mm = **6331 samples**, and a 2.2 mm strip averages 35 px per row. A 1-D FFT of the column-mean resolves any period from 4 mm (Nyquist-safe) to 200 mm. All four drums get a trace. Black and Blue — the two inks with `grainMul = 1.40`, i.e. the two most drum-sensitive — are on the *same* side so their phase relationship is directly comparable, which distinguishes a **drum-specific** period from a **paper-transport** period common to all four.

These strips are explicitly **sacrificial**: they live in the 5 mm margin the safe area excludes. If feed skew clips one, nothing else on the sheet is affected, and the remaining three still resolve λ.

Result: T1 can now fit the full CHART-DESIGN §3.5 model

```
S(x,y) = exp( poly2(x,y) + a·cos(2πy/λ) + b·sin(2πy/λ) )
```

with `λ` measured rather than assumed, from **sheet 1**, on **every** tier.

## 5.5 Recovering which patch is which

Three independent, redundant paths — any two agreeing is sufficient:

1. **Model file + pose.** `chart_id` (Data Matrix) → JSON → `slot → patch_id` map; the 16-marker homography locates slot centres to < 0.2 mm against a 20.32 mm pitch. This is the primary path.
2. **Slot-index rulers** (§3.1.5). Gray-coded row and column indices read directly off the rails, parity-checked. Catches a whole-slot grid shift, a wrong model file, and a 180° flip that survived ArUco decoding.
3. **Correspondence-free cross-check** (CHART-DESIGN §4.4, Karaimer & Nguyen). A 3×3 fit from 3-D histogram alignment must agree with the patch-based fit within 3 ΔE00.

Disagreement between (1) and (2) is a **hard reject**, not a warning.

---

# 6. Print protocol for this sheet

```
Plates          4 × 1-bit PNG (Flate), 600 dpi, 7016 × 9922 px, one per drum
                a_nom counted from the raster inside each active window
                (CHART-DESIGN §0 / R4) — 240×240 px for slots, 600×600 for blocks
Screening       RISO matrix engine (screenType = 1), "Fine" preset
                = ht1_6x6_43_45 (measured Screen-40, 38.6 lpi print)
                angles  Y 0°, R 75°, B 15°, K 45°
                driver LUT index: RECORD IT; the fit is void if it changes
Calibration     u_amtJitter = 0, misreg = 0, layerSkews = 0, all simulated noise 0,
                fixed seeds — CHART-DESIGN R2. Simulated misregistration in the
                chart would be indistinguishable from the real misregistration
                being measured.
Scale           100 %, no auto-tone, no backlight correction, no image-processing mode
Pass order      Yellow → Bright Red → Blue → Black   (light to dark; K last = pose master
                printed on top, maximising its detectability)
Copies          24 per run.  Discard the first 12 (ink-up ramp).  Measure sheets 13–17.
Between passes  slip-sheet; ≥ 20 min dwell; record the actual dwell
Capture         ≥ 24 h after the last pass
```

Print this on the sheet itself, plate K, 6 pt, in the residual strip below the grid:
`chart_id · T1 · CMYK · sheet 1 of 1 · pass order Y→R→B→K · print at 100 %, no auto-tone · discard first 12 copies · measure 13–17`

**Three runs make this T2-capable with no new plates** (CHART-DESIGN §2.5): Run A normal order; Run B reversed order (`τ_{A→B}` vs `τ_{B→A}`); Run C normal order with 24 h between passes (wet vs dry trapping). Same 4 masters, same geometry.

---

# 7. Capture: the A3 scanning plan

A3 exceeds every consumer flatbed. Three options, in order of preference:

**(a) A3 flatbed** (Epson Expression 12000XL class). One scan, one flat field. 400 ppi, 48-bit TIFF, all auto-correction **off** (descreen especially — it destroys the halftone statistics), backed with ≥10 sheets of the same stock, scanned at 0/90/180/270° and averaged after registration.

**(b) Three-strip A4 scan** — the realistic path. Lay the sheet with its 297 mm edge along the bed's 297 mm axis; the 420 mm axis then runs along the bed's 216 mm axis.

| strip | bed coverage (y, mm) | grid rows fully inside | slots |
|---|---|---|---|
| A | 0 – 216 | 0 – 8 | 108 |
| B | 102 – 318 | 4 – 13 | 120 |
| C | 204 – 420 | 9 – 17 | 108 |

Overlaps: A∩B = rows 4–8 (60 slots), B∩C = rows 9–13 (60 slots). Every strip contains **both side rails in full** (so per-plate affine is well conditioned in x, and 8 ArUco + 8 ring-crosses per plate are visible), **≥4 white-lattice slots**, **≥2 drift controls**, and at least one block. The 60-slot overlaps supply an over-determined per-strip gain/offset tie in log paper-relative space.

Constraint H6 (§5.2) exists purely to guarantee (b) works.

**(c) Phone, whole sheet.** 12 MP is the floor (6.27 px/cell, 97 px/active). Raw DNG only, AE/AWB locked, ≤8° off normal enforced from the fiducial quad, 3 frames medianed. Treat the result as diagnostic, not as the fit.

---

# 8. Graceful degradation — what survives a bad sheet

## 8.1 The registration-immune core

**100 of 216 slots depend on exactly one plate:**

| group | slots | plates needed |
|---|---|---|
| G0 white lattice | 16 | 0 |
| G1 single-ink solids | 12 | 1 |
| G5 ladders | 64 | 1 |
| G7 drift controls | 8 | 1 |
| G8 flare probes | 8 | 1 (K) |
| G9 show-through | 4 | 1 (K) |
| **immune total** | **112** | |

**Q0 (capture chain), Q1 (per-ink tone response), Q4 (show-through) and Q5 (uniformity) are fully recoverable from any sheet on which the pose master alone is readable.** A sheet with catastrophic 4 mm misregistration still yields all four `f_i(a)` curves, all four solid colorants, the flat field, the flare coefficient and the banding period. Add the four margin strips (§5.4), which are single-plate and outside the safe area, and Q5 survives even a clipped sheet.

That is the floor. Below it there is nothing to salvage; above it every loss is partial.

## 8.2 Expected yield by plate count

Model: per-plate offset relative to the pose master, `σ_y = 1.06 mm`, `σ_x = 0.86 mm` (0.8/0.5 random + 0.7 systematic per sheet).

| patch class | slots | full-area read | ≥ 0.6-area read | notes |
|---|---|---|---|---|
| 1-plate | 112 | ~100 % | ~100 % | immune |
| 2-plate, 1-slot | 18 + 24 = 42 | ~63–79 % | > 99 % | loses area, not validity |
| 3-plate, 1-slot | 8 + 24 = 32 | ~50–63 % | ~98 % | |
| 4-plate, 1-slot | 2 + 8 = 10 | ~40–50 % | ~95 % | `--tall-anchors` raises this to ~80 % |
| 3-/4-plate blocks | 20 | > 99 % | > 99 % | 4.08 mm slack |

Two things make this benign:

1. **Failures are area losses, not validity losses.** The `≥ 0.6 usable` gate is passed ~95–99 % of the time even at `k=4`, because the sampling window is the *eroded intersection*, not the nominal window. The fit weights each reading by `usable²`.
2. **Five sheets are measured.** Patch validity is per-(patch, sheet), and sheet-to-sheet registration is largely independent. At a 20 % per-sheet failure rate the probability a patch is lost on all five is `0.2⁵ = 0.03 %`. **Nothing is lost from the campaign; readings are lost from individual sheets.**

## 8.3 Quarantine ladder

Applied in order; each step discards the minimum.

```
L0  Sheet-level. Fewer than 12 of 16 ArUco detected, or H_K residual RMS ≥ 0.30 mm
    ⇒ retake the capture (not the print).

L1  Plate-level. residual_RMS_p ≥ 0.50 mm for plate p
    ⇒ mark p unreliable; drop only patches whose plate set contains p.
    Worst case (p = Yellow): 4 solids-with-Y + 12 anchors-over/of-Y + 16 Y-ladder
    slots lost; the R/B/K sub-chart — which IS the 3-ink Classic+Mono calibration —
    survives whole.

L2  Region-level. If per-plate residuals are spatially structured (cockle signature:
    residual correlates with distance from the grip edge), refit each plate as a
    thin-plate spline over its 16 targets instead of an affine. Report the TPS
    bending energy; if it exceeds 0.8 mm² the sheet is cockled — keep the strip
    with the lowest local energy, discard the others.

L3  Patch-level. usable < 0.60 ⇒ flag "registration", exclude from the fit,
    keep in the report. usable ∈ [0.60, 1.0) ⇒ include with weight usable².

L4  Strip-level (scan path b). If one A4 strip fails its own flat-field gate
    (residual peak-to-peak ≥ 3 % after 2nd-order correction from its 4 white points),
    discard that strip only. Rows 4–8 and 9–13 appear in two strips each,
    so 120 of 216 slots survive the loss of any single strip.
```

## 8.4 Sheet report — what the tool prints

```
CHART  a3f91c2e · T1 · CMYK · sheet 1 · run A · copy 14        2026-07-25
POSE   K: 16/16 ArUco, RMS 0.08 mm       Y: 16/16, RMS 0.14 mm
                                          R: 16/16, RMS 0.11 mm
                                          B: 15/16, RMS 0.19 mm
BANDING  λ = 31.4 mm (K, Blue in phase → drum, not transport), p-p 6.2 %   PASS
FLARE    φ = 0.021 (paper-relative)
YIELD    204 / 216 slots read at usable ≥ 0.60   (12 flagged: 9 registration, 3 σ)
         Q0 complete · Q1 complete (4/4 ladders) · Q2 floor 15/15 Neugebauer
         Q5 complete · Q4 complete · Q6 complete
         Q2 superposition 26/28 anchors  (missing: K@50/YRB, Y@50/RBK)
NOISE    within-sheet replicate σ = 1.6 ΔE00                                PASS
FIT      T1 (101 unique) held-out mean ΔE00 = 4.3, p95 = 8.1, max 12.7
         L* < 25 subset: mean 6.8   ← report separately, always
```

---

# 9. Generation algorithm

```
generate_chart_C4_CMYK_A3_T1(paper_id, user_seed, driver_lut, gen_version):

  # ---- 1. deterministic identity
  chart_id    = sha1("Y|R|B|K" ‖ "T1" ‖ paper_id ‖ user_seed ‖ gen_version)[0:8]
  layout_seed = sha1(chart_id ‖ "layout")[0:8]
  rng         = xoshiro128**(layout_seed)

  # ---- 2. patch set (NOT layout) — CHART-DESIGN §2.7 STEP 2 anchors are forced;
  #        no Kennard-Stone is needed at T1/k=4 because the mandatory anchor set
  #        (15 Neugebauer + 28 superposition + 32 ladder = 75) already exceeds
  #        the free budget. KS re-enters at T2.
  P = []
  P += [white(s)            for s in WHITE_SLOTS]                  # 16
  P += [solid(i)            for i in [Y,R,B,K]] × 3                # 12
  P += [solid(S)            for S in pairs]     × 3                # 18
  P += [solid(S) as block   for S in triples]                      # 4 blocks
  P += [solid(S)            for S in triples]   × 2                # 8
  P += [solid(YRBK) as block]                                      # 1 block
  P += [solid(YRBK)]                            × 2                # 2
  P += [ladder(i, L)  for i in inks for L in [3,7,12,20,30,42,56,72]] × 2   # 64
  P += [anchor(i, J)  for i in inks for J in nonempty_subsets(inks\{i})]  × 2  # 56
  P += [control(i,50) for i in inks]            × 2                # 8
  P += [flare_A, flare_B, showthrough]                             # 3 blocks

  # ---- 3. layout
  place_locked(P)                       # §4.5, fixed coordinates
  place_blocks(P)                       # §4.5, fixed anchors
  assign = anneal(P.free, FREE_SLOTS, cost=§5.3, hard=H1..H5, rng, 500_000)
  assert verify_H6(assign)

  # ---- 4. rasterise — dedicated 1-bit rasteriser, NOT the shader path
  #        (CHART-DESIGN §7.1; js/chart-raster.js)
  for plate p in [Y, R, B, K]:
      raster[p] = zeros(7016, 9922) as 1-bit
      for patch in P where p in patch.plates:
          screen_into(raster[p], patch.footprint_px, patch.a_req[p],
                      engine = RisoAmt matrix, matrix = ht1_6x6_43_45,
                      angle  = ANGLE[p], driver_lut = driver_lut,
                      seed   = 0)                       # fixed, R9
      draw_furniture(raster[p], plate=p)                # pure geometry, R10:
          # p == K:  16 ArUco, 2 Data Matrix, row+col rulers, text block
          # p != K:  16 ring-cross targets, 4 corner concentric rings
          # all p :  its 50 % margin banding strip
      assert bimodal(raster[p]) with < 0.1 % intermediate     # R6

  # ---- 5. ground truth by COUNTING (CHART-DESIGN §0 / R4) — the one
  #        non-negotiable step. Never write the requested value.
  for patch in P:
      for p in patch.plates:
          patch.a_nom[p] = popcount(raster[p][patch.active_px]) / area(patch.active_px)

  # ---- 6. emit
  write 4 × 1-bit PNG (Flate)          # R5: never JPEG
  write chart model JSON               # CHART-DESIGN §7.3 schema
  write instruction sheet
  assert sha256(regenerate()) == sha256(current)      # R9 determinism self-test
```

**Do not route this through `exportSeparations()` (`js/save.js:925`).** It inherits `u_amtJitter = 1.0` from the last live frame, encodes plates as JPEG q=0.85, applies `misreg` / `layerSkews` / `layerAngles` / `u_simNoise`, hardcodes `ptPerPx = 72/300`, and never calls `bakeCalLutIfNeeded()`. Every one of those silently corrupts the chart in a way the analysis cannot detect. A dedicated rasteriser sharing only the screening kernel is strictly less work than making that path safe.

---

# 10. Corrections this design makes to `docs/CHART-DESIGN.md`

| § | Claim | Correction |
|---|---|---|
| §2.4 | *"A4 safe area 190 × 270 mm at 16 mm pitch = 176 slots (… k=4 at 170)"* | Counts no fiducial area and uses the single-ink pitch for a chart that is 85 % overprints. Real A4 capacity at `k=4` is ~90 slots. **T1 for `k=4` requires A3.** |
| §3.1 | Patch size derived from single-screen cell integration | At `k≥3` the binding constraint is the **inter-plate rosette period** (2.52 mm at 38.6 lpi for the 0°/15° pair), not the 0.658 mm cell. Coincidentally both land near 10 mm — but the rosette term is what stops the patch shrinking, and a future 106 lpi chart must re-derive from it. |
| §3.4 | Per-plate 14 mm fiducial bands above and below the grid | Costs 112 mm of sheet at `k=4`. Replaced by a **shared perimeter rail with spatial interleaving** — constant 15–18 mm cost, independent of `k`. |
| §3.4 | 24 vernier combs at 4 corners × 2 axes × 3 pairs | Physically does not fit an A3 rail (needs 21 mm; rail is 15.12–17.58 mm), and adds nothing over a 32:6 over-determined affine. Replaced by **concentric corner rings** — same human-readable function, zero extra footprint. |
| §3.4 | Single 20 × 20 mm Data Matrix | Does not fit a rail. Replaced by **two 15.4 mm ECC200 symbols** carrying a 50-bit token, plus human-readable text. |
| §3.4 | ArUco with a deliberately asymmetric extra marker for flip disambiguation | Unnecessary when marker IDs are unique per station. Dropped. |
| §3.5 | Banding period `λ` is *"unresolvable from 18 scattered points"* and deferred to the T2 flood sheet | **False for a 20.32 mm grid, where it is worse than unresolvable — it aliases.** Four continuous 402 mm margin strips resolve λ on the T1 sheet at zero slot cost. |
| §3.3 | Fiducial detection assumed uniform across plates | The RGB unmixing of `{Y, R, B, K}` is ill-conditioned — Blue and Black are 41 % cross-coupled. Plate identity must come from **geometry (lane stagger + windowed search around the pose-master homography)**, never from colour separation. Yellow fiducials are undetectable by any global greyscale detector. |
| §4.1 | Scanner is the accuracy path | Still true, but **no consumer A4 flatbed can scan A3.** The layout must be, and now is, decomposable into three independently-analysable A4 strips (constraint H6). |

---

# 11. What this one sheet does and does not determine

**Determines:** `f_i(a)` for all four inks on bare paper (Q1); all 15 Neugebauer solid colorants + paper (Q2 floor); one Bugnon superposition-spreading parameter for each of the 28 (ink, backing) pairs; a global `u = 1/n` fitted on 24 sub-50 % ladder points and validated on 12 shadow points; a 2nd-order flat field plus the banding period and amplitude (Q5); the veiling-glare coefficient (Q0); show-through amplitude (Q4); per-plate affine registration and its sheet-to-sheet distribution over 5 sheets (Q6); the within-sheet noise floor from 65 replicate pairs (Q7).

Simultaneously and at no extra cost: the complete T1 calibration for the `Classic` (Blue+Bright Red) and `Mono` (Black) profiles, as sub-lattices.

**Does not determine:** print-order asymmetry or wet/dry trapping (needs runs B and C — same plates, no new geometry); the *shape* of overprint tone curves away from 50 % (needs T2's 3-point curves); SCOP `j,k` (needs T2's 3-backing wedges); per-ink `u_i`; anything about Green, Fl. Pink or Fl. Orange; anything fluorescent — and Yellow is flagged `fluo: true` in `js/data.js:37`, so **its ladder will not obey Beer–Lambert and the residual will show it.** Expect Yellow's shadow residual to be the worst of the four and report it separately rather than absorbing it into a global `u`.

**Honest ceiling for this sheet:** held-out mean ΔE00 of 4–6 on a scanner, 6–9 on a phone (CHART-DESIGN §2.2). Ship a correction only if held-out mean < 2.5 (scanner) / < 4.0 (phone) **and** held-out mean < 2 × measured replicate σ. If the second condition fails the result is capture-limited — say so, and do not ship it.