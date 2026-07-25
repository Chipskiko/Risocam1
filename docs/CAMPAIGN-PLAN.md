# RISO/CAM — FINAL EXECUTABLE SPEC
## Seven-drum first-party ink dataset — "K₇ pair sweep"

**Status:** supersedes the campaign / layout / fitting / palette design documents where they conflict. `docs/CHART-DESIGN.md` remains the reference for *why* each measurement exists (its Q0–Q7 question list, its accuracy ceilings, its reporting discipline); this document is the instantiation and it overrides CHART-DESIGN on sheet size, furniture, layout randomisation, tier structure and scan count.

**Verified against the tree before writing.** Facts this spec is built on, all checked:

| Fact | Where | Consequence |
|---|---|---|
| `DrumCount=2`, `DefaultInkDrum=1001 , 1003` | `riso driver/MZ9_CD106F_64bit/…/English/MZ9SerU.RDF` | **Dual-drum MZ9. Two inks per paper feed.** The one-drum-per-pass premise of the campaign document is false. |
| `AmiLineRange=38, 200`, `AmiLineDefault=71`, `AmiAngleDefault=45`, `1=600 x 600 dpi` | same file | Driver default ruling is **71 lpi**, and `riso_trc.json` already carries a measured `lut71`. Chart prints at 71 lpi. |
| `test_03_gray50.prn → global_ink_fraction 0.15703`; screening classified as error diffusion | `docs/validation/stats.json` | The driver **rewrites coverage**. A 50 % input reached the master as 15.7 %. Any `a_nom` derived from our own PNG is fiction until proven otherwise. |
| `decode_prn(path)` exists and works | `docs/validation/decode_prn_reference.py` | We can read the exact bitmap the thermal head burns. This is the ground truth, and it is free. |
| `paperYN=sqrt(result); inkYN=sqrt(ink); (paperYN·inkYN^d)^2 ≡ result·ink^d` | `index.html:2484-2490` | The Yule–Nielsen label on stage 4 is an algebraic no-op. Correct structure with `transmit = ink/safeP` already exists at `index.html:2436-2452` behind `u_dbgYNArea`. |
| 47 inks have LUTs; exactly 12 have first-four knots that are an even ramp | `js/data.js`, checked numerically | Black, Lagoon, Indigo, Wine, Burgundy, Bisque, Bubblegum, Kelly Green, Smoky Teal, Fl. Green, Fl. Red, Clear Medium. Verified: these are the 12 smallest by ramp-deviation, all ≤ 0.008. |
| `RISO_CAL['Bright Red'].lut[4] = [0.978,0.263,0.086]` = `#f94315` vs `hex:'#f15060'` | `js/data.js:32` | 15.5 ΔE00 internal contradiction on the author's most-used ink. |
| `exportSeparations()` emits `toDataURL('image/jpeg',0.85)` into a PDF at `ptPerPx=72/300` | `js/save.js:1207, 1224` | Cannot be used to generate charts. (`u_amtJitter` *is* forced to 0 at `:1056` — that criticism is stale.) |
| `_saving` now reads the script global, with a comment explaining the old `window._saving` bug | `js/ui-controls.js:823-827` | **Already fixed.** Do not re-fix. |

---

# 1. STRATEGY

The project's plan until now assumed overprint data was unobtainable, so it was designed as a *feature*: the end user prints a chart, photographs it with a phone, and accepts a 6–9 ΔE00 ceiling. Seven drums plus a flatbed inverts that. The author can produce the measurement once, on their own machine, at scanner accuracy, and **ship it as default data** — including to the majority of riso owners who have two drums and will never calibrate anything.

Four things change, and only these four:

**1. The deliverable is data, not a workflow.** The artefact is `js/ink-model.js` — a static file loaded after `js/data.js`, precached by `sw.js`, keyed per ink and per ink-pair. No chart export UI, no phone capture path, no calibration wizard is on the critical path. The per-user calibration layer becomes an optional delta on top, default off, and is **out of scope for this document**.

**2. The measurement set is chosen for other people's drums, not for completeness.** The author's seven inks are the seven most-stocked inks in the medium (Fl. Pink 11/11 studios, Black 11/11, Bright Red family 11/11, Blue family 10/11, Yellow 9/11, Green family 9/11, Fl. Orange 5/11). Every ink pair at ≥ 8/11 joint availability except `Teal+Fl. Pink` is inside this set. So the ordering principle is: measure the pairs the most people print, first.

**3. Generalisation is a shipped claim and must be validated as one.** Seven measured drums must improve the other forty inks, or the campaign only helps the author. The mechanism is SCOP (`X = j·(X_bg·X_fg)^k` per channel) fitted on the measured pairs and applied to unmeasured pairs using their existing single-ink solids. The honest test of that is **leave-one-pair-out** and **leave-one-ink-out** cross-validation, and those numbers ship in the UI, not just in a report.

**4. Because it ships by default, honesty is a product requirement.** Colorimetry is **paper-relative** unless and until a spectrophotometer anchor exists — the scanner will be profiled on photographic dye colorants and applied to fluorescent emulsion ink, which is a Luther-condition violation with no correction path. Every profile in the picker carries an M/X/U validation tier. The 11 remaining synthetic LUTs stay labelled synthetic forever.

**One design property overrides everything else in this spec: the partial result must itself be the product.** The previous plans fail catastrophically at 60 % completion — they yield a box of charts and half a Python pipeline. Here, every single press feed is a complete, self-contained, shippable measurement of one ink pair, and the analysis for one feed is the analysis for all of them. You can stop after four feeds and have shipped something real.

---

# 2. SESSION 1 — one afternoon, the minimum that ships

## 2.1 What Session 1 is

**Feeds 1–10 of an Eulerian circuit of K₇, which happen to be exactly the complete K₅ on `{Black, Blue, Fl. Pink, Bright Red, Yellow}`.**

All 10 two-ink pairs of the five most-stocked inks in risography, each printed **in a single paper feed** using both cylinders, on **one chart design**, with **one cylinder swap between consecutive feeds**.

Why this set: it is the exact ink union of nine shipped or revised profiles — `Mono`(K), `Classic`(B+R), `Punch`(P+K), `Pink Blue`(P+B), `Ink & Blue`(K+B), `Warm`(R+Y), `CMYK`(B+R+Y+K), `Riso CMY`(B+P+Y), `Riso CMYK`(B+P+Y+K). Nine profiles from ten feeds.

## 2.2 The press schedule — copy this onto a card and take it to the machine

Circuit computed as an Eulerian circuit of K₇ whose first ten edges span K₅, minimising cylinder-position imbalance (the minimum achievable is 12 — the swapped cylinder alternates deterministically, so per-ink position counts are forced even; 4/2 or 2/4 per ink is optimal, and it means **every ink is measured in both cylinder positions**).

Inks: **K**=Black, **B**=Blue, **P**=Fl. Pink, **R**=Bright Red, **Y**=Yellow.

| Feed | cyl 1 | cyl 2 | Action before this feed | Pair delivered | Profile unlocked |
|---|---|---|---|---|---|
| 1 | **R** | **P** | mount both cylinders | R·P | — |
| 2 | K | P | swap cyl 1 → **K** | K·P | **Punch** |
| 3 | K | B | swap cyl 2 → **B** | K·B | **Ink & Blue** |
| **F-a** | K | B | *(no swap)* — **FLOOD sheet** | uniformity K, B | banding λ |
| 4 | P | B | swap cyl 1 → **P** | P·B | **Pink Blue** |
| 5 | P | Y | swap cyl 2 → **Y** | P·Y | — |
| **F-b** | P | Y | *(no swap)* — **FLOOD sheet** | uniformity P, Y | banding λ |
| 6 | B | Y | swap cyl 1 → **B** | B·Y | — |
| 7 | B | R | swap cyl 2 → **R** | B·R | **Classic** |
| **F-c** | B | R | *(no swap)* — **FLOOD sheet** | uniformity B, R | banding λ |
| 8 | Y | R | swap cyl 1 → **Y** | Y·R | **Warm** |
| 9 | Y | K | swap cyl 2 → **K** | Y·K | — |
| 10 | R | K | swap cyl 1 → **R** | R·K | **CMYK**, **Riso CMY/CMYK**, **Mono** complete |

**11 cylinder mounts, 13 feeds, 26 masters.** Not 22 mounts, not 60.

**Copies per feed: 20. Discard the first 8. Scan copies #10, #14, #18. Keep the rest.**

Discard 8, not 5, and not "once per mount": there are two independent transients and both are per-feed on this machine — the drum ink film (per mount, 15–30 copies) *and* the master soak (per master, 3–5 copies, and both masters are new every feed). Eight is the compromise; the flood sheets tell you afterwards whether it was enough (see §6 gate G4).

**Sheets: 13 × 20 = 260 × A4.** ~⅔ ream. Not 424 A3, not 1,790.

**Wall clock:** 11 mounts × 4 min + 13 feeds × (2 masters × ~40 s + print + tray/fan/label ~5 min) ≈ **2.5–3 h**. One afternoon with slack.

## 2.3 Rules for the session

- **Record `cyl1` / `cyl2`, never "first" / "second".** Which cylinder physically prints first is *not yet established* and is a Session 3 output (§3.3). Do not guess; the schedule and the chart label both say `cyl1`/`cyl2` and that is sufficient — the analysis only needs a consistent, recorded position.
- **One stock for the whole campaign.** Record name, gsm, batch/lot. ~100 gsm uncoated. Buy enough for Sessions 1–3 now, from one lot.
- **Ink density setting identical for every feed.** Record it. Record the **ink cartridge lot per drum**; if a drum takes a fresh cartridge mid-campaign the fit will absorb it as physics.
- **Record the driver settings string verbatim**, including screening mode, `AmiLine`, `AmiAngle`, scale (100 %), and every image-processing toggle (all off). Any change voids the fit.
- **Slowest speed available.** Slip-sheet the flood sheets and feeds 3, 9, 10 (Black in a cylinder).
- **Label every stack by hand** with feed number and copy range as it comes off. The printed sheet carries `cyl1=… cyl2=… feed n` on the cyl-1 plate; the handwriting is the copy number.
- **Storage: dark envelope, one per feed.** Riso Fl. Pink is fugitive — it visibly fades in weeks of room light. Every envelope gets a **fade-control strip**: a 20 mm off-cut of a Fl. Pink 100 % patch from copy #20, re-scanned at every later session. If the control strip drifts, all cross-session comparisons involving P are suspect and must be corrected or dropped.
- **Do not scan for 24 h.** Oil-based emulsion dries by absorption; a wet scan reads dark and contaminates the platen.

## 2.4 What gets scanned

30 chart sheets (3 copies × 10 feeds) + 6 flood sheets + 5 blank stock sheets + the Q-13 in the bed on every scan. **41 scans, one orientation, ~2 h.** Any A4 flatbed. Protocol in §5.1.

Not 490 scans. Not four orientations. Orientation averaging buys ~0.15 ΔE00 against a 2.5 ΔE00 target and costs 3× the evening; the 3 physical copies × 12 in-sheet paper reads do the same job better.

## 2.5 What gets fitted from Session 1 alone

| Output | From | Replaces |
|---|---|---|
| **5 first-party single-ink ladders**, 8 coverage levels, each level read 8× (2 in-sheet replicates × 4 sheets per ink) | lattice row 0 / col 0 + replicate rows | third-party txtbooks 2019/2020 swatch scans, and **Black — one of the 12 synthetic even-ramp LUTs** |
| **Measured mechanical dot area `m(a_req)` per ink** at 600 dpi, exact, no thresholding | popcount of the decoded `.prn` inside each active window | the proposed 2400 ppi scan strip (deleted — see §5.2) |
| **10 two-ink overprint solids, measured** | lattice slot (8,8) per sheet, ×3 copies | data that does not exist anywhere in the project |
| **640 unique overprint interior patches** (10 pairs × 64) | lattice interior | nothing — new |
| **`u = 1/n`**, one global value at 71 lpi, unclamped, allowed negative, fitted on `a ≤ 0.5` only, validated on `a > 0.5` separately | ladders + pair interiors | the hardcoded `nf = 2.0` and the stage-4 no-op |
| **`f_{i/j}` paper-side ink spreading**, 10 ordered pairs | pair interiors at 8 levels | `covOf`'s six stacked heuristics in `js/sep-lut-worker.js:63` |
| **SCOP `j, k` per channel, pooled**, + leave-one-pair-out over 10 folds | all 810 lattice patches | the naive reflectance product, which Deshpande shows predicts systematically too dark |
| **Flat field, flare φ, banding λ + amplitude for 5 inks** | white slots, flare probe, flood sheets | assumptions |
| **The measured noise floor** σ_within-sheet and σ_cross-sheet | replicates | every downstream claim depends on it |
| **Nine profiles promoted to `val:'M'`** | the above | 3 of 13 printable → 9 measured |

**The shippable unit is: `js/ink-model.js` with 5 measured inks, 10 measured overprints, a fitted `u`, spreading curves, a pooled SCOP, and the calBlend rewrite switched on.** That is the most physically grounded riso simulation that has ever existed, and it fits in one afternoon plus two evenings.

---

# 3. SESSIONS 2..N — strictly additive, in priority order

Nothing is ever reprinted. Every session adds new sheets or new *conditions*; no session re-measures a condition already measured.

## 3.1 Session 2 — complete the circuit (one afternoon)

Feeds 11–21 of the same Eulerian circuit. Adds Green and Fl. Orange to every other ink.

| Feed | cyl 1 | cyl 2 | Swap | Pair |
|---|---|---|---|---|
| 11 | R | **G** | cyl 2 → G | R·G |
| 12 | **P** | G | cyl 1 → P | P·G |
| **F-d** | P | G | — **FLOOD** | uniformity G |
| 13 | P | **O** | cyl 2 → O | P·O |
| 14 | **K** | O | cyl 1 → K | K·O |
| **F-e** | K | O | — **FLOOD** | uniformity O |
| 15 | K | **G** | cyl 2 → G | K·G |
| 16 | **B** | G | cyl 1 → B | B·G |
| 17 | B | **O** | cyl 2 → O | B·O |
| 18 | **G** | O | cyl 1 → G | G·O |
| 19 | G | **Y** | cyl 2 → Y | G·Y |
| 20 | **O** | Y | cyl 1 → O | O·Y |
| 21 | O | **R** | cyl 2 → R | O·R |

11 chart feeds + 2 flood, 11 mounts, 26 masters, 260 A4, ~3 h.

**Structural note, and it is forced, not a choice:** after the K₅ is complete, every one of `{K,B,P,R,Y}` has exactly two edges left (one to G, one to O). Any Eulerian continuation must therefore **alternate Green and Fl. Orange**. You cannot do "all the Green pairs, then all the Orange pairs". Feeds 11–21 are indivisible as a *set* but each feed is still individually complete, so the session is still abortable at any feed.

**Deliverable:** all 21 pairs measured. That unlocks the pooled SCOP fit over 1,701 patches, the full **leave-one-pair-out (21 folds)** and **leave-one-ink-out (7 folds)** cross-validation — the two numbers that justify shipping to users with different drums — and profiles `Meadow`, `Forest`, `Neon Pop`, `Sunset`, `Tropical`.

**Green is the held-out gate.** Before scanning feeds 11, 12, 15, 16, 18, 19, fit everything on the K₅ + Fl. Orange data, predict Green's 6 overprints, write the predictions to a file, `sha256` it, commit the hash. Then scan. Held-out validity comes from prediction-before-*measurement*, so printing Green in the same session costs nothing. Report mean / median / p95 / max ΔE00 and a separate row for `L* < 25`.

## 3.2 Session 3 — the trap condition, which decides what ships as default (2 half-days, 24 h apart)

**This is the highest-value session after S2, and it is not the one any of the design documents prioritised.**

On this dual-drum machine, cyl 1 and cyl 2 lay ink down **less than a second apart in one paper path**. That is the author's production-normal condition. But **most riso owners have single-drum machines**, where a two-colour job is two feeds with a drum swap in between — minutes to hours of drying, on a dry first ink, with 1–2 mm re-feed registration. The default dataset ships to *those* users.

So the dual-drum wet trap may be the wrong default, and nobody knows by how much. Measure it.

Four pairs, chosen as the highest-stock and highest-risk: **P·B, K·B, K·P, R·Y.**

- **Day 1:** mount each of `{P, B, K, R, Y}` once (5 mounts). At each mount, run every single-drum feed that needs that ink first. For pair (A,B) print stack `AB-fwd` with A only and stack `BA-rev` with B only. 8 stacks, 8 single-drum feeds.
- **Day 2:** same 5 mounts. Print the second plate onto each stack. 8 more feeds.

10 mounts, 16 feeds, 16 masters (all the *same plate files* as Session 1 — zero new chart generation), 320 A4, ~3 h + ~3 h.

**Deliverables, in order of importance:**
1. **τ_dry vs τ_wet** for 4 pairs. If the difference is below the noise floor, the entire order/delay axis collapses and one number ships — a result worth having.
2. **Print-order asymmetry** for 4 pairs, in a clean single-drum design where "first" and "second" are unambiguous. This is where fluorescent-over-dark asymmetry appears if it appears at all; a product of transmittances is order-symmetric by construction and cannot express it.
3. **Which cylinder prints first**, finally determined: compare the dual-drum feed-4 overprint colour to the known `P-then-B` and `B-then-P` single-drum overprints.
4. **Pass-to-pass registration σ**, anisotropic (feed axis worse), from the fiducial affines across 3 copies × 8 stacks. Ships as the app's `misreg` parameter, which is currently a scalar.

## 3.3 Session 4 — second paper stock (one afternoon)

Feeds 1–10 repeated on a contrasting stock (80 gsm vs 100 gsm, or a heavily-OBA white vs a natural white). Same plates. 11 mounts, ~2.5 h.

**Deliverable:** either `f`, `τ`, SCOP `j,k` are stable across the two stocks within the noise floor — in which case they ship as paper-independent with four per-paper terms (`R_paper, λ_PSF, u_offset, β_showthrough`) — or they are not, in which case **the shipped dataset is paper-specific, is labelled with the exact stock, and the UI says so.** Do not silently generalise.

## 3.4 Session 5+ — probably never, and that is fine

In descending value, each independently shippable:

- **Second screen ruling** (43 lpi and/or the FM Grain-Touch path) → `u(lpi)`. Currently `u` ships keyed to `{engine:'amt', lpi:71}` and nothing else. 10 feeds.
- **Show-through** → verso scans of the Session 1/2 flood sheets at 200 ppi. Zero new prints; ~30 min of scanning. Do this whenever. Fit `D_verso = β·(G_μ ⊛ D_recto)` in **density space** (Sharma 2001), sanity-anchored to RISO patent US 6,011,083 (front density 1.21–1.26, show-through 0.13–0.16 → β ≈ 0.10–0.13).
- **Triples.** 3-ink overprints are currently *predicted* as the coverage-weighted blend of the `|J|=1` spreading curves. Validate with 6 patches printed as a third feed onto retained Session-1 stacks. Cheap; do it only if the triples residual in H1 looks bad.
- **Re-scan the txtbooks swatch books on the campaign's own scanner under the §5.1 protocol.** One day's work, no press time, puts all 47 inks in one measurement space, and is the specific remedy if leave-one-ink-out fails (§6, F5). Arguably worth doing regardless.
- **Fluorescence separation.** See §7. Do not attempt.

---

# 4. THE CHART

Two designs total. Both A4. Both deterministic.

## 4.1 `PAIR-A4-v1` — the chart sheet (used for all 21 feeds)

Every feed prints the same design with different ink pairs and a different label. **21 feeds × 2 plates = 42 plate files, generated once, byte-reproducible.**

### 4.1.1 Physical envelope

```
Sheet              A4 portrait, 210.0 × 297.0 mm, feed along +Y, leading edge y=0
Raster             600 dpi, 1-bit, 4960 × 7016 px
Machine margins    3 mm left/right, 5 mm leading, 2 mm trailing (from RDF MarginSize)
Units              ALL geometry is integer 600-dpi device pixels; mm are derived.
                   Integral at 600/300/200/150/120/100/75/50 dpi — no half-texel edges.
```

### 4.1.2 Module

```
pitch        480 px = 0.800 in = 20.320 mm
footprint    384 px = 0.640 in = 16.256 mm      (what gets inked)
active       288 px = 0.480 in = 12.192 mm      (what gets read)
gutter        96 px = 0.160 in =  4.064 mm      (bare paper, constant everywhere)

grid         9 columns × 13 rows = 117 slots
grid extent  x ∈ [ 320, 4640] px = [ 13.55, 196.45] mm
             y ∈ [ 600, 6840] px = [ 25.40, 289.56] mm

SLOT CENTRE (c, r),  c ∈ [0,8],  r ∈ [0,12]
    x_px = 560 + 480·c        x_mm = 23.707 + 20.320·c
    y_px = 840 + 480·r        y_mm = 35.560 + 20.320·r
active window = centre ± 144 px (± 6.096 mm);  footprint = centre ± 192 px (± 8.128 mm)
```

**Why 12.19 mm and not the adversary's 30 mm** — I side with the designers on patch *count* and with the adversary on the *registration model*. Within one paper feed the two cylinders are mechanically registered: ~0.2–0.5 mm, largely systematic, and the per-plate affine removes the systematic part. Footprint-minus-active gives 2.03 mm of slack per side; erode 0.75 mm at read time and 1.28 mm of raw offset is still tolerated at full area. 30 mm patches would buy 36 slots per sheet where 12.19 mm buys 117 — and the whole point of a 9×9 lattice is that it fits.

**Halftone integration is satisfied with enormous margin.** At the driver default 71 lpi the cell is 0.358 mm; a 12.192 mm window holds 34 cells per side = 1,157 cells, so `se = 0.05/√1157 = 0.15 %` area ≈ 0.12 ΔE00, well under the print noise floor and under CHART-DESIGN §3.1(a)'s 0.4 % target. For the FM Grain-Touch path the correlation length is ~0.15 mm and the constraint is inert.

**The rosette constraint that killed A4 for the layout document does not exist here.** Two plates, not four. With any Δθ ≥ 30° the rosette period is ≤ 0.69 mm and the window spans ≥ 17 periods. Four plates cannot all be ≥ 30° apart mod 90°; two trivially can. This is one of three independent reasons 2-ink sheets beat 4-ink sheets (the others: §4.1.6, and the ill-conditioned 4-ink RGB unmixing the layout document itself diagnosed — with 2 inks the detection is trivially well-conditioned).

### 4.1.3 The 9-level ladder — and how the levels are chosen

```
r = level index of the cyl-1 ink        c = level index of the cyl-2 ink
level 0 = 0 % ;  level 8 = 100 % ;  levels 1..7 interior
```

**Target *achieved* coverage** (what actually lands on the master, after the app's tone chain *and* the driver's):

```
target a  =  0    4    8    14    22    32    45    65    100   %
              L0   L1   L2   L3    L4    L5    L6    L7    L8
```

Six non-zero levels at ≤ 50 % → the `u` fit set (Ruckdeschel & Hauser: `n` is only empirically determinable below ~50 % coverage). L7 and L8 are the validation set and their residual is reported separately, always.

**The *requested* levels are not these numbers.** They are solved for in the pre-flight (§8, task 4): print a calibration ramp through the real driver, decode the `.prn`, invert the measured transfer, and pick the 7 requested values whose decoded areas land nearest the targets. Those 7 numbers are then frozen into the chart model file and never change.

Note the ladder deliberately avoids `RISO_CAL`'s existing knots at 10/30/50/70/100 — only 32 % is near 30. The new data is substantially independent of the prior it replaces, which matters because 12 of the 47 LUTs are synthetic and the campaign must not launder them.

### 4.1.4 Slot allocation — 117 slots, exact

| Rows | Cols | Content | Slots |
|---|---|---|---|
| 0–8 | 0–8 | **The lattice.** `(r,c)` = cyl-1 level `r` × cyl-2 level `c`. Slot (0,0) is bare paper; row 0 is the cyl-2 ink's ladder on paper; col 0 is the cyl-1 ink's ladder on paper; the 64 interior slots are genuine two-ink overprints; (8,8) is the solid overprint. | 81 |
| 9 | 0–8 | Paper-white slots — no ink rasterised anywhere in the footprint | 9 |
| 10 | 0–7 | cyl-1 ink ladder replicate, levels 1–8 | 8 |
| 10 | 8 | paper white | 1 |
| 11 | 0–7 | cyl-2 ink ladder replicate, levels 1–8 | 8 |
| 11 | 8 | paper white | 1 |
| 12 | 0–3 | **Flare probe.** One contiguous 100 % solid of the *darker* ink on the sheet, spanning the union of these four footprints (x ∈ [368, 2432] px, y ∈ [6408, 6792] px), with a **288 px unprinted square well centred at (1400, 6600) px**. | 4 |
| 12 | 4–8 | paper white | 5 |
| | | **Total** | **117** |

Reads per sheet: **114** (81 lattice + 16 ladder replicates + 16 white + 1 flare well). Paper reads: 17 including slot (0,0). Unique per sheet: 81 (1 paper + 8 + 8 ladder + 64 overprints).

**No annealing. No randomised assignment.** The lattice *is* the design — a 9×9 grid whose two edges are the two ladders is the most legible layout possible, and it is the reason the extractor is fifty lines instead of a pipeline. The cost is that coverage correlates with position, which is exactly what the flood sheets (§4.2) and the 17 paper reads exist to decorrelate. I side with the adversary here: 500,000 Metropolis steps is months of tooling for a marginal gain over a rigid grid.

`φ = read(flare well) − mean(16 white slots)`, per channel, subtracted as an additive constant before ratioing to paper. Expect 0.003–0.010 on a flatbed.

### 4.1.5 Furniture

**Fiducials — 6 ring-cross targets per plate, in the side margins.**

Ring-cross: filled annulus outer Ø 6.0 mm (142 px) / inner Ø 3.0 mm (71 px), plus a 0.6 mm (14 px) cross through the centre spanning 8.0 mm (189 px). Rotationally symmetric, so no orientation ambiguity; the annulus gives an intensity-weighted centroid to ~0.03 mm at 400 ppi; the cross gives two independent axis estimates and survives partial occlusion.

```
left  lane   x = 200 px = 8.467 mm        right lane  x = 4760 px = 201.4 mm
cyl-1 plate  y =  55, 160, 265 mm  in BOTH lanes   → 6 targets
cyl-2 plate  y =  70, 175, 280 mm  in BOTH lanes   → 6 targets
```

15 mm y-separation between the two plates' targets against an 8 mm extent — they cannot merge even at 3 mm displacement. 6 targets × 2 coordinates = **12 equations for a 6-dof affine per plate**, spanning both the x and y extent of the sheet, so translation, rotation and per-axis scale are all well conditioned.

**No ArUco. No Data Matrix. No Gray-code rulers.** With 2 plates, 21 feeds and a rigid grid, sheet identity is the printed label plus the handwritten copy number, and grid-shift detection is the paper/solid structure of the lattice itself (row 9 must read as paper, slot (8,8) must be the darkest patch on the sheet — see gate G3 in §6). The layout document's identity machinery solves a problem created by 15 simultaneous stacks across 7 mounts; this campaign has one stack in flight at a time.

**Label** — cyl-1 plate only, top band, 4 mm text at y ≈ 15 mm:

```
RISOCAM PAIR-A4-v1  <chartid8>  feed 04  cyl1=Fl.Pink  cyl2=Blue
req=0/3/6/11/18/27/40/61/100  71lpi 45deg  600dpi 1bit  100% no auto-tone
discard 8, scan 10/14/18        copy ____   date ________
```

**Banding strips: none on this sheet.** The side margins are 10.5 mm of print area and the fiducials own them. Drum banding is along the feed axis and needs a long, continuous, single-ink signal — that is what the flood sheet is for, and the flood sheet costs one feed and no swap.

### 4.1.6 Rasterisation and ground truth

```
Screening    the app's RISO matrix engine, driver-default ruling: 71 lpi
             angles  cyl-1 plate 15°, cyl-2 plate 45°   (Δθ = 30°)
             driver LUT index: RECORD IT — the fit is void if it changes
Calibration  u_amtJitter = 0, misreg = 0, layerSkews = 0, all simulated noise 0,
             fixed seeds. Simulated misregistration in the chart would be
             indistinguishable from the real misregistration being measured.
Output       2 × 1-bit PNG (Flate), 4960 × 7016, + 1 chart model JSON
             Assert the histogram is bimodal with < 0.1 % intermediate values
             or refuse to emit.
Determinism  generate twice, compare SHA-256. chart_id → byte-identical plates.
```

**`a_nom` is counted from the decoded `.prn`, not from our PNG and never from the requested value.** This is the single most important decision in this document and it resolves a conflict the four design documents could not.

The design documents' rule R4 — count set pixels in *our* raster — protects against the app and leaves you fully exposed to the driver, which `docs/validation/stats.json` proves rewrites coverage by a factor of three. The adversary is right that R4 is insufficient. But the adversary's remedy (characterise and invert the driver transfer, or find a pass-through mode) is unnecessary:

```
for each feed:
    print the two plates to file through the real driver at production settings
    decode_prn()  →  the exact 600-dpi bitmap the thermal head burns
    locate our 6 ring-cross fiducials in the decoded raster
    fit the chart-mm → decoded-px affine (absorbs the driver's scale and centring)
    a_nom[plate][slot] = popcount(decoded[active_window]) / area(active_window)
```

**This makes the driver's transfer function irrelevant to correctness.** If it crushes 50 % to 16 %, you have not measured a wrong ladder — you have measured a correct ladder at different, exactly-known coverages. The only thing the transfer affects is *which* coverages you sampled, and that is precisely what the pre-flight uses it for (§4.1.3).

It also **deletes the 2400 ppi mechanical-dot-gain strip entirely.** The fitting document wanted printed dot area measured directly to break the `f`/`u` identifiability degeneracy; it proposed a 2400 ppi scan and threshold, and then wrote its own gate predicting that it fails on a 600-dpi FM screen — which is the screen the driver actually uses. The `.prn` decode gives the same quantity at exactly 600 dpi with no thresholding, no MTF limit, no sensitivity gate, and no scanning time. It is strictly better than either proposal. `f_{i/∅}` then means paper-side spreading only, which is what it should have meant all along.

## 4.2 `FLOOD-A4-v1` — the uniformity sheet

Full-bleed **40 %** flat tint of each ink, one plate per cylinder, no patches, no furniture except the 6 ring-crosses per plate and a label. Printed at 5 points in the campaign with no cylinder swap (Sessions 1 and 2, at the feeds marked F-a…F-e), covering all 7 inks. 10 copies each.

```
Deliverables per ink:
  drum banding period λ and amplitude, from a 1-D FFT of the column-mean
    (265 mm along the feed axis; at 400 ppi that is 4173 samples — resolves
     any period from 4 mm to 130 mm)
  whether the period is drum-specific or transport-common (two inks per sheet,
     phase directly comparable)
  peak-to-peak uniformity, which is also the ink-up-ramp gate (G4)
  the verso read for show-through, later, at 200 ppi, for free
```

`S(x,y) = exp(poly2(x,y) + a·cos(2πy/λ) + b·sin(2πy/λ))` is then fitted on the chart sheets with **λ measured rather than assumed**. This matters concretely: a 20.320 mm row pitch aliases catastrophically against any banding period near 20.3, 10.2 or 40.6 mm, and an aliased periodic term is not merely unfitted, it is invisible.

---

# 5. THE PIPELINE

Four scripts, in this order. Each is independently useful.

```
tools/chart_gen.py      generate plates + model file      (before Session 1)
tools/prn_anom.py       decode .prn → a_nom               (before Session 1)
tools/extract.py        scans → measurement store         (Session 1 evening)
tools/fit.py            store → ink-model.json            (Session 1 evening)
tools/report.py         → report.html                     (Session 1 evening)
tools/emit_inkmodel.py  → js/ink-model.js                 (Session 1 evening)
```

## 5.1 Scan protocol

Kept almost verbatim from the fitting document, which is correct here and is the part of those four documents most worth preserving.

| Setting | Value | Why |
|---|---|---|
| Instrument | any A4 flatbed, **CCD preferred over CIS** | CIS has shallow DOF and strongly structured cross-scan illumination |
| Mode | Professional / "no colour correction", device RGB out | any on-the-fly ICC conversion is a nonlinear per-pixel op applied *before* averaging |
| Resolution | **400 ppi** chart sheets, **200 ppi** flood/verso | 71 lpi cell = 0.358 mm = 5.6 px (gate ≥ 4 px/cell); active window 192 px (gate ≥ 60 px) |
| Bit depth | **48-bit RGB TIFF**, LZW or none. Never JPEG. | 8 bit is 1/255 ≈ 3 % relative at R = 0.03, and the deep overprints live there |
| Gamma | **1.0 / linear** if offered (VueScan: Output ▸ Curve = None; SilverFast: HDR RAW 48). Else invert the OECF from the Q-13. | see §5.2 |
| **Descreen** | **OFF** | an adaptive notch filter *designed* to destroy the exact statistic being measured. The single most destructive default. |
| Unsharp mask | OFF | edge ringing biases patch means near the gutter |
| Colour restoration / backlight / dust removal (Digital ICE) | OFF | ICE inpaints from an IR channel and will erase riso grain as "dust" |
| Auto exposure | OFF where possible | see the caveat below |
| Preview auto-crop | OFF, fixed absolute crop rectangle | keeps the sheet at a known platen position |
| Multi-sampling | ON, 2× if available | free read-noise reduction |

**In the bed, every scan, ≥ 25 mm from the nearest patch:** a **Kodak Q-13 / Q-14** reflection grey scale with published densities, and a strip of the unprinted chart stock from the same lot.

**"Exposure locked for the session" is not achievable** on most consumer flatbeds — the unit re-calibrates against its under-lid white strip on every pass. This is why the Q-13 is not a fallback, it is the mechanism: every scan carries its own OECF and its own drift correction.

**Session structure:**
```
1  warm-up scan, discarded
2  five blank stock sheets, full platen  → F_scanner
3  ... the session's sheets, Q-13 in every one ...
n  re-scan the first sheet of the session
Gate: ΔE00 between the two reads of that sheet < 1.0, else the session is void.
```

**Handling:** back every sheet with ≥ 10 sheets of the same stock (ISO 13655 white backing, critical on thin riso paper). Cotton gloves — finger oil on uncoated stock is a measurable reflectance change. Check the platen for offset between sheets. Room 20 ± 3 °C, 45 ± 10 % RH, logged.

## 5.2 Extraction — exact order, and the order is not negotiable

```
1  dark-subtract
2  OECF-linearise, PER PIXEL, from the Q-13's 20 steps
3  divide by F_scanner  (in SCANNER pixel coordinates)
4  detect the 12 ring-crosses; fit A_p per plate; de-skew
5  ---- everything below is in SHEET coordinates ----
6  window construction per slot
7  robust patch statistic
8  sheet flat field from the 16 white slots  →  banding S(x,y) at measured λ
9  subtract flare φ
10 divide by local paper
```

**Step 2 before step 7 is the difference between a transferable model and a scanner fingerprint.** Averaging a bimodal halftone through a nonlinear encoder gives `mean(g(R))` where you need `mean(R)`. For a 50 % patch with `R_paper = 0.81`, `R_ink = 0.06`, a γ = 2.2 encoder gives 0.597 → decodes to 0.305 against a true 0.435. **That is a 0.13 reflectance error, ~14 ΔE00, and it has exactly the shape of optical dot gain** — it would be silently absorbed into the fitted `u` and would make `u` a property of the scanner driver.

**Step 3 before step 5 before step 8.** Three causes of nonuniformity, three different frames, and conflating the scanner's cross-scan gradient with the drum's banding is the classic failure — a scanner gradient along the feed axis gets attributed to the drum and "corrected" into every ink's tone curve. `F_scanner` comes from ~50 M pixels of blank stock, not from 16 patch means, so it is vastly better conditioned than any in-sheet fit. Gate: if `F_scanner` peak-to-peak > 12 %, or it changes > 2 % between sessions, the scanner is unfit.

**Step 4:** affine, not homography. A flatbed is orthographic; a perspective term just fits noise. If residual RMS ∈ [0.30, 0.60] mm the cause is almost certainly cockle — refit as a thin-plate spline over the 6 targets plus the paper-slot centroids, flag `cockle:true`, and exclude the sheet from the banding fit (cockle and banding are both low-frequency and will trade off). Above 0.60 mm, reject the sheet.

**Step 6:**
```
foot_i = A_{p_i}(footprint_polygon)
W      = erode( ∩_i foot_i , erode_mm )
erode_mm = ceil(0.75 / cell_mm) · cell_mm      # a WHOLE number of halftone cells
                                               # at 71 lpi → 1.074 mm (3 cells)
assert W ⊂ active_window ;  usable = area(W)/area(active)
if usable < 0.60 → flag "registration", exclude from the fit, keep in the report
else weight the observation by usable²
```
Eroding by a non-integer number of cells changes which screen phase sits at the window boundary and adds a systematic ±0.3 % area bias between patches.

**Step 7 — arithmetic mean, emphatically not median.** At 71 lpi / 400 ppi the per-pixel distribution is bimodal (5.6 px per cell, dots resolved). For a bimodal patch the **median is a step function of coverage**: it sits at `R_paper` below 50 % and `R_ink` above, with a discontinuity at 0.5. It is not noisy, it is the wrong estimator by construction. A naive trimmed mean on raw pixels trims the *dots*, a coverage-dependent bias shaped exactly like dot gain.

```
L = gaussian_blur(patch, σ = 1.5 · cell_mm)        # ≥ 2 cells: mask ABOVE the halftone
m = median(L); s = 1.4826·MAD(L); mask = |L−m| > 4s ; dilate 0.5 mm
if fraction(mask) > 0.08 → reject patch, flag "defect"
R̂ = arithmetic mean of unmasked LINEARISED pixels, per channel
record σ_cell = std(L), n_px, usable
se(R̂) from a 200-sample BLOCK bootstrap over 2 mm blocks
    (an i.i.d. pixel bootstrap understates σ by ~3× — the halftone and the
     paper texture are spatially correlated)
```

Reject at a scale above the halftone; average at the pixel scale. `σ_cell` is a shipped diagnostic: an anomalously high value means a bad thermal master (stochastic perforation failure), not a bad model.

**Measurement record**, one per `(chart_id, feed, copy, scan_id, slot)`:

```jsonc
{ "feed": 4, "cyl1": "Fl. Pink", "cyl2": "Blue", "slot": [5,3],
  "a_nom": [0.3182, 0.1421],          // COUNTED from the decoded .prn
  "R_rel": [0.4412, 0.2013, 0.1877],  // paper-relative, linear
  "se":    [0.0021, 0.0018, 0.0025],
  "sigma_cell": 0.0140, "usable": 0.94, "n_px": 22410,
  "flags": [], "copy": 14, "stock": "…", "session": 1 }
```

## 5.3 Fitting stages

Fit in **linear reflectance factor, paper-relative, per channel**, objective in **OKLab** (matching `js/sep-lut-worker.js`), report in **CIEDE2000**. ΔE00 is non-smooth near the `a*b*` axis and has a hue-rotation term that makes it a poor optimiser objective; optimise in the space you can differentiate, report in the space the field understands, state both.

```
S0  extraction (§5.2)
S1  noise floor FIRST, printed at the top of every run:
      σ_within-sheet   SD of the 16 ladder-replicate pairs + 17 paper reads
      σ_cross-sheet    MAD across the 3 copies
      σ_cross-ink      SD across the 4–6 sheets in which each ink appears
    RULE: fit nothing whose effect is smaller than σ_within-sheet.
S2  Neugebauer primaries: 7 solids + 21 pair solids — MEASURED, never predicted
S3  u = 1/n, ONE global value per (engine, lpi)
      • parameterise u, never n. Viggiano: u is continuous through the
        singularity, n is not; an optimiser cannot cross +∞ to −∞.
      • bounds u ∈ [−2.0, +1.0]. REMOVE every n ≥ 1 clamp. Expect NEGATIVE n
        on this stock — riso's oil/soy emulsion on uncoated paper is Viggiano's
        ink-penetration regime (he measured n ≈ −3.8 on fibre inkjet paper);
        n = −1 is algebraically ≈ Kubelka–Munk K/S, the right physical limit
        for a penetrating ink in a scattering sheet.
      • guard |u| < 0.02 with the log-space geometric-mean limit; clamp bases
        ≥ 1e-3 before pow with negative exponents.
      • identifiability: with f free and u free the pair is unidentifiable from
        a ladder alone (inner solve is EXACT by construction). So:
          inner:  given u, invert YN per ladder point in closed form for f
          outer:  choose u minimising weighted OKLab error on the 64 PAIR
                  INTERIOR patches, where Demichel algebra couples the inks
                  and a wrong u cannot be absorbed by any single-ink curve
      • FIT SET: every patch with each a_nom ≤ 0.50 and Σa_nom ≤ 1.20
        VALIDATE SET: anything with a_nom > 0.50 — residual reported separately
        NEVER fit u on shadow patches.
      • Per-ink u_i only if it improves held-out H1 by ≥ 0.5 ΔE00 AND survives
        leave-one-pair-out. A-priori expectation (Rossier & Hersch): it earns
        its keep for Fl. Pink, Fl. Orange and Black, and not for the rest.
        If that is what the data says, ship exactly that. A null result is a result.
S4  λ_PSF, the paper point-spread length, one global per stock.
      Inoue/Tsumura/Miyake measured paper's PSF as EXPONENTIAL: P(r) ∝ exp(−r/λ).
      Expect 40–120 µm on uncoated stock. Fitted jointly with u from the
      ladder residuals. CROSS-CHECK: the aperture-average of the PSF model at
      71 lpi must reproduce the fitted u within the noise floor. If they
      disagree by > ~1 ΔE00 one of them is absorbing a residual scanner
      nonlinearity. λ is what the pixel-level renderer needs; u is what the
      patch-level LUT bake needs. Both ship.
S5  f_{i/∅} paper-side spreading per ink, 3-knot monotone cubic (reuse the
      Fritsch–Carlson implementation — three copies already exist and agree:
      index.html:2366, js/sep-lut-worker.js:38, js/cal-lut-worker.js)
S6  f_{i/j} superposition-dependent spreading, per ordered pair
      • fit the 3-knot form on the interior lattice
      • if the residual is NOT below σ_within-sheet, DISCARD it and keep
        Bugnon's 1-parameter parabola from the 50 %-equivalent point alone:
          f(q) = [2 − 4q'(½)]q² + [4q'(½) − 1]q
        Bugnon recommends this explicitly on noise-resilience grounds, which
        is riso's exact problem. Record per curve which form was used — it is
        a legitimate diagnostic of where the campaign was under-powered.
      • prediction-time solve: Hersch & Crété fixed point, 5 iterations
      • |J| ≥ 2 is DECLARED to be the Demichel-weighted blend of the |J| = 1
        curves, not fitted. That declaration is what the triples validate.
      Payoff, measured in the source: offset @100 lpi ΔE94 1.54 → 0.90 (1.7×),
      inkjet @75 lpi 3.03 → 0.90 (3.4×).
S7  SCOP j,k per channel, POOLED across all pairs with per-pair deviations
      ridged toward the pool. j_x(a) = j0 + j1·a_fg, same for k.
      λ_ridge chosen by the same leave-one-pair-out CV that validates the model,
      so it is not a free knob.
      EXPECT j > 1 and k < 1, largest on the dark overprints: Deshpande's
      central finding is that the naive reflectance product predicts SYSTEMATICALLY
      TOO DARK, and result·ink^d in sRGB-encoded space is exactly that product.
      This is where the current simulation's "muddiness" comes from.
S8  τ ordered trapping — SESSION 3 ONLY. Fit from SOLID overprints only
      (at a = 1 the Demichel mixture is degenerate, so all remaining signal is
      thickness), then refit f with τ fixed, iterate twice. This is what
      separates f_{B/A} from τ_{A→B}, which are otherwise confounded.
      Fit COLORIMETRICALLY. Preucil T = (D_op − D_1)/D_2 assumes density
      additivity and is a densitometric QC readout, not a model — demote
      INK-PHYSICS-PLAN.md §Phase 2's recommendation to a printed diagnostic.
      Generalise as τ_{A→B} ≈ 1 − c1·D_A − c2·D_A·D_B (2 globals from 8 obs).
S9  show-through β, μ — whenever the verso scans happen. DENSITY space.
S10 joint polish, L-BFGS-B, objective Σ (usable/se²)·||ΔOKLab||², ridge to pool,
      monotonicity via softplus increments.
      CAP AT 2 % relative improvement. If the polish moves any parameter more
      than that, the stages are not orthogonal and one is mis-specified —
      investigate, do not accept. A joint fit that has to work that hard will
      not generalise, and H2/H3 will show it.
S11 validation H1–H3 (§6)
S12 emit js/ink-model.js + report.html
```

## 5.4 How it lands in the codebase

### `js/ink-model.js` — new file, loaded after `js/data.js`, added to `sw.js` precache

Ships as a JS file, not a fetch: no CSP issue, no race, no async ordering. ~30 KB minified for 7 measured inks + 40 stubs.

```jsonc
{ "schema":"risocam.inkmodel/1", "fit_id":"<sha256 of the parameter blob>",
  "campaign": { "machine":"RISO MZ9 (dual drum)", "driver_settings_hash":"…",
                "paper":{"name":"…","gsm":100,"lot":"…"},
                "screening":[{"engine":"amt","lpi":71,"angles":[15,45]}],
                "trap_condition":"dual-drum-single-feed",   // ← honest, and see §6/F10
                "colorimetry":"paper-relative",             // "absolute-d50" only with a spectro anchor
                "sessions":[1,2], "feeds":21, "sheets_measured":63 },
  "paper": { "R_lin":[…], "flare_phi":[…] },
  "global": { "u":{"amt71":0.31}, "psf_lambda_mm":0.086,
              "scop_pool":{"j":[…],"k":[…]},          // applies to ALL 47 inks
              "trap_model":{"c1":null,"c2":null},     // null until Session 3
              "showthrough":{"beta":null,"psf_mm":null} },
  "inks": {
    "Blue": { "provenance":"measured", "solid_lin":[…],
              "ladder":[[a_nom, r,g,b, se…], …],      // 8 levels, LINEAR, paper-relative
              "m_mech":[[a_req, a_printed], …],       // from the decoded .prn
              "u":null, "spread":{"paper":[…],"under":{"Black":[…], …},
                                  "form":{"Black":"parabola","Yellow":"cubic3", …}},
              "scop":{"j":[…],"k":[…]}, "sigma_cell_typ":0.013 },
    "Aqua": { "provenance":"thirdparty", "solid_lin":null },
    "Lagoon": { "provenance":"synthetic", "solid_lin":null }
  },
  "overprint_solids": { "Fl. Pink|Blue": {"cyl":[1,2], "rgb_lin":[…], "se":[…]}, … },
  "registration": { "sigma_within_feed_mm":[0.21,0.33], "sigma_pass_to_pass_mm":null },
  "validation": { "noise_floor_dE00":1.1, "H1":{…}, "H2":{…}, "H3":{…},
                  "baseline_H1":{…} }   // the CURRENT shipped model on the same hold-out
}
```

### `R.getInkData(name, ctx)` — one resolver, three tiers

1. `INK_MODEL.inks[name]` if present and `provenance == "measured"` and `ctx.inkModelVersion >= 1`;
2. else a **synthesised** entry: the third-party `RISO_CAL[name].lut` linearised, plus `INK_MODEL.global` (u, λ_PSF, SCOP pool, trap model) — **this is how the 40 unmeasured inks get upgraded**, and it is the thing leave-one-ink-out measures;
3. else legacy `RISO_CAL` verbatim.

The resolver must return `provenance ∈ {measured, thirdparty, synthetic}` and the UI must show it. The 11 remaining even-ramp LUTs (Black is replaced by measurement) are tagged `synthetic` permanently.

### `calBlend` stage 4 — the Yule–Nielsen default flip

Two separate defects, and both must be fixed together or neither is fixed:

**(a) The algebra is a no-op.** `paperYN·inkYN^d` then squaring cancels: `result·ink^d`, plain Beer–Lambert with a YN label.

**(b) `d` is conflated.** It is simultaneously "fractional area covered" and "ink amount within a dot". Yule–Nielsen is a statement about averaging over an aperture containing *both* covered and uncovered area. With one variable there is no area mix, so **no exponent can do anything.** The fix is to split `d` into `aArea` and `dAmt`. The `u_dbgYNArea` branch at `index.html:2436` already has the right structure — the `transmit = ink/safeP` normalisation that stops paper being counted `n` times — but hardcodes `aArea = grain > 0.01 ? 1 : 0` and `nf = 2.0`.

**(c) The whole chain runs on sRGB-encoded numbers.** `u_paper = (0.910, 0.912, 0.908)` at `js/renderer.js:1338` and the `RISO_CAL` values go straight into `sqrt`/`pow`. Nothing linearises. A `u` fitted in encoded space is absorbing the display gamma and will not transfer to another ink, paper or screen.

```glsl
// ── Stage 4, u_inkModel > 0.5 : YN AREA mix in LINEAR reflectance ──
// aArea = fraction of the APERTURE covered by ink; dAmt = amount WITHIN a dot.
float grainRange = coverage * (1.0 - coverage) * 3.5;
float aArea = clamp(coverage + (grain - coverage) * min(grainRange, 0.85), 0.0, 1.0);
float dAmt  = clamp(u_inkOpacity * trapTau, 0.0, 1.0);

vec3 Rbg  = srgb2lin(result), Rink = srgb2lin(ink), Rpap = srgb2lin(paper);
vec3 Tk   = clamp(Rink / max(Rpap, vec3(1e-3)), vec3(1e-3), vec3(1.0));
vec3 Rcov = Rbg * pow(Tk, vec3(dAmt));                 // Beer-Lambert INSIDE the dot

vec3 Rout;
if (abs(uY) < 0.02) {                                   // n → ±∞ : geometric-mean limit
  Rout = exp(mix(log(max(Rbg,vec3(1e-4))), log(max(Rcov,vec3(1e-4))), aArea));
} else {
  vec3 mixYN = mix(pow(max(Rbg, vec3(1e-4)), vec3(uY)),
                   pow(max(Rcov,vec3(1e-4)), vec3(uY)), aArea);
  Rout = pow(max(mixYN, vec3(1e-6)), vec3(1.0/uY));
}
result = lin2srgb(Rout);
```

Notes that matter:
- **The existing grain modulation is retained but reinterpreted as AREA, not amount.** That is the whole conceptual fix in one line. `dotMin` (`index.html:2467`) disappears under `u_inkModel > 0.5` — it was thinning the dot interior to fake tone, which is what `aArea` now does correctly.
- At `u = 1` this reduces to Murray–Davies area mixing, **not** to today's code — today's code has no area term at all. So legacy bit-identity is achieved only by keeping the old branch under `u_inkModel < 0.5`, never by any parameter setting of the new one.
- WebGL1 cannot index `u_ynU[int]` with a non-constant index portably. Use the existing `layerIdx < 0.5 ? … : …` chain pattern from `u_transparent0..3` at `index.html:2497`.
- **Delete the `u_dbgYNArea` branch** — its structure moves into the default path, and leaving a second, differently-wrong YN implementation behind a flag is how this bug survived the first time.
- **Set stage 6's flat 2 % cross-ink contamination (`index.html:2511`) to 0** under `u_inkModel > 0.5`. It is a constant with no measurement behind it; the trapping and spreading terms now carry that physics with data.
- **Bypass the `mix(p100, lutInk, smoothstep(0.3,0.7,coverage))` blend at `:2479`** — a hand-tuned heuristic that the fitted `f_{i/J}` supersedes.

### The cal-LUT texture does the expensive work

`js/renderer.js:2044` uploads 256 × 4 RGBA `UNSIGNED_BYTE` on `TEXTURE14`. Extend to **256 × 12, same unit**:

| Rows | Content |
|---|---|
| 0–3 | ink over **paper** vs coverage (existing) |
| 4–7 | ink over **the composite below at solid** — computed CPU-side by the full SCOP + spreading + τ model |
| 8–11 | reserved (fluorescent emission slot, unused — see §7) |

The shader lerps rows `i` and `i+4` by accumulated coverage below. **Zero new texture units, and the entire SCOP/Neugebauer/spreading solve lives in JS where it can be unit-tested against the measured patches.** `js/cal-lut-worker.js` already exists, is async, already has Fritsch–Carlson and a re-upload path — extend it, do not add a parallel mechanism.

**Precision fix, same commit:** at `R = 0.03` one `UNSIGNED_BYTE` step is 3 % relative. Store **density** instead of reflectance: `D = −log10(R) ∈ [0,2]`, encode `D/2 × 255`. The step becomes 0.0078 D ≈ **1.8 % relative reflectance at every level, uniformly.** One `pow` on read. Strictly better for a physical model, costs nothing, universally supported.

### CPU side

`js/sep-lut-worker.js:90` `forwardYNSN` hardcodes `opts.ynN ?? 2.0` and builds primaries **subtractively** (`primary(mask)` multiplies solids' ratios, `:98-105`) — exactly the naive product SCOP exists to correct. Under `u_inkModel > 0.5`: `primary(mask)` returns the **measured** `overprint_solids` entry for popcount ≤ 2 (all 21 pairs are measured), the SCOP-corrected product otherwise; `covOf` (`:63`) — the `dens·0.01 → gamma → S-curve → positional dot gain → depletion → sqrt` chain, six stacked heuristics — is replaced by `f_{i/J}`; `opts.ynN` becomes the `u` table. All under the flag; legacy path untouched.

### Keeping uncalibrated output bit-identical

- **Saved projects:** add `inkModelVersion` to the save schema. Absent or `0` → legacy path, `u_inkModel = 0.0`, every new branch skipped. Any project saved before this change re-renders exactly as before, forever.
- **The shipped default legitimately changes output.** That is the point. It goes out under a version bump with before/after renders in the release note, not silently. Users can pin `inkModelVersion: 0` per project.
- **Golden-image harness** (`docs/WEBGPU-PLAN.md` already budgets one): fixed seeds (`u_frameSeed = 0`, `_stampSeed = 0`, AMT prepass RNG, stipple sampler, blue noise), ~30 reference renders. **On the CI GPU assert SHA-256 equality with `u_inkModel = 0`. On other GPUs assert max per-channel |Δ| ≤ 1/255.** Be honest: adding uniforms and uniform-flow branches can change register allocation and float rounding on some drivers. Claim hash-equality on the reference GPU and perceptual equality elsewhere; claim no more.

---

# 6. VALIDATION

## 6.1 Metric

**Paper-relative CIEDE2000**, paper mapped to `L* = 100`, computed from linear paper-relative RGB via a fixed sRGB-primaries assumption. Reported as paper-relative in the same sentence as every number.

**Absolute ΔE00 is not claimed and must not be printed anywhere** unless a spectrophotometer measures the 7 solids + paper + 21 pair solids (29 patches, a 30-minute favour from any print shop with an i1Pro2 or ColorMunki). Here I side entirely with the adversary against both the fitting and palette documents: Asman's 1.24–1.77 ΔE76 flatbed figure was measured on conventional CMYK colorants inside the IT8 gamut; riso spot inks and especially two fluorescents are a Luther-condition violation with no correction path, and a generic 3-D scanner profile gives ~6–7 ΔE76 on multi-colorant overprints against ~2–3 for a colorant-aware one. The app composites in RGB, `RISO_CAL` is RGB, and the deliverable is an RGB LUT — routing through XYZ/CIELAB adds a profile error term that exists only so the report can quote a prettier unit.

If the anchor strip materialises, add `"colorimetry":"absolute-d50"`, train a **root-polynomial degree-2** RGB→XYZ transform (Finlayson: root-polynomial, never plain PCC — plain polynomial blew up 1.6 → 57 ΔE under exposure drift), weight the riso anchor 3× over the IT8, and report its own leave-one-out residual.

## 6.2 The noise floor, measured before anything else and printed at the top of every fit run

| Quantity | Estimator | Expected | Gate |
|---|---|---|---|
| σ_within-sheet | SD of the 16 ladder-replicate pairs and 17 paper reads, after flat-field and debanding | 0.6–1.2 ΔE00 | ≤ 2.0 |
| σ_cross-sheet | MAD across copies #10/#14/#18 | 1.0–2.0 | ≤ 2.5 |
| σ_cross-feed | each ink's ladder across the 4–6 feeds it appears in | 1.5–3.0 | ≤ 3.0 |
| σ_scanner | the session's repeat scan of its first sheet | < 0.5 | ≤ 1.0 |

## 6.3 Three hold-outs, because "held-out" means three different things

| | Hold-out | Estimates | Selection | Target mean | p95 | max |
|---|---|---|---|---|---|---|
| **H1** | 25 % of patches, Kennard–Stone in OKLab, never fitted | **interpolation** — how good is the model where it was trained | exhaustive over 4 folds | **≤ 2.5** | ≤ 5.0 | ≤ 10 |
| **H2** | **leave-one-pair-out** — hold out an entire ink pair, refit on the other 20, predict it | **generalisation to unmeasured ink pairs** — what a user gets combining inks the author never printed together | 21 folds | **≤ 3.5** | ≤ 7.0 | ≤ 14 |
| **H3** | **leave-one-ink-out** — delete ink *i* entirely, use only its third-party `RISO_CAL` LUT + `global{}` | **what the other 40 inks get** | 7 folds | **≤ 5.0** | ≤ 10 | ≤ 18 |

**H2 is the headline. H3 is the honest number and it is the one that belongs in the UI next to any non-measured ink.** H1 is the least interesting of the three and is the only one the design documents emphasised.

Plus, always: the residual on `a > 0.5` patches, which were never in the `u` fit set.

## 6.4 Report

`report.html`, per hold-out: mean, median, **p95**, max; the cumulative ΔE00 frequency curve; separate ΔL*, Δa*, Δb* (a large ΔL* with small Δa*b* is a tone-curve error; the reverse is a primaries error); **a separate row for `L* < 25`** (Vrhel & Trussell: goodness metrics break down below `L* ≈ 15` once signal-dependent noise is modelled, and riso's deep overprints live there); a separate row for patches involving a fluorescent ink; a separate row for triples; the measured noise floor beside every number; and **the current shipped model's numbers on the same hold-outs**, so the improvement is legible.

## 6.5 Go / no-go — all three required

1. `H1 mean < 2.5` (paper-relative)
2. `H1 mean < 2 × σ_within-sheet` — if this fails while (1) passes the result is **capture-limited**: the model is fitting the instrument. Say so and improve the capture. Do not ship.
3. `H1 mean ≤ 0.5 × (current shipped model's H1 mean)` — if the campaign does not halve the error it did not pay for itself and something is wrong upstream.

## 6.6 Explicit failure criteria

**F1 — pre-flight: the decoded `.prn` does not contain both plates as separately-addressed drum data, or does not decode at all.** STOP. Everything in this spec assumes the `.prn` decode gives per-plate ground truth. Fall back: print each plate as a separate single-drum job (Session 1 becomes 20 feeds and ~5 h, and the trap condition becomes dry — which per F10 may be the *better* default anyway). This is a schedule failure, not a science failure.

**F2 — the driver's coverage transfer is non-monotone, or compresses the 0–50 % range into < 15 % of achieved area.** Then the ladder cannot be spread across the levels we need. Response: find a driver mode with less processing (Photo/Text/Line toggles, `Gyakkou`, `Akarusa`, `Contrast`, `Kaityo Smooth` — all in the RDF and all default-on-something), re-run the pre-flight, and record which combination you settled on. Do not print a chart whose achieved ladder is 0/1/2/3/4/5/8/12/100 %.

**F3 — σ_within-sheet > 2.5 ΔE00.** The press or the scan is the limit; no model refinement and no extra patches will help. Redo with 20 copies discarded not 8, a serviced machine, humidity control, and a re-checked `F_scanner`. If it persists, the honest conclusion is that this machine cannot support a sub-4 ΔE00 model — ship a coarser one and say why.

**F4 — H2 > 6.0 while H1 < 2.5.** The model memorises and **SCOP does not transfer.** The entire "7 drums improve 47 inks" premise has failed. Response: ship the 21 measured pairs as data, mark every unmeasured pair in the UI as unvalidated, do not present the SCOP prediction as measured. This is a design-level failure and must be published as such, not buried.

**F5 — H3 > 8.0 ΔE00.** The third-party `RISO_CAL` LUTs are incompatible with the fitted globals — almost certainly because the txtbooks 2019/2020 swatch scans were made on different paper, on a different device, at a different geometry, and were never verified against a print. Specific remedy: **re-scan the swatch books on the campaign's own scanner under the §5.1 protocol.** One day, no press. That puts all 47 inks in one measurement space.

**F6 — the triples row is > 2× the pairs row.** The `|J| ≥ 2` weighted-blend declaration (S6) is wrong. Response: print 6–10 triples as a third feed onto retained stacks and fit `f_{i/J}` for the `|J| = 2` conditions that actually occur in the shipped profiles — or restrict the model's claimed accuracy to ≤ 2 inks and say so.

**F7 — Fl. Pink's red channel clips.** A flatbed sets its white point from the under-lid calibration strip; Fl. Pink's emission plus reflection frequently pushes R **above the white reference and saturates**. If any Fl. Pink patch reads ≥ 0.995 in R, every ladder point near it is compressed and every overprint over it is wrong. **This is a hard gate in `extract.py`, checked before anything else, and nothing in any of the four design documents checked for it.** Response: reduce the scanner's exposure/gain if the driver exposes it, or scan Fl. Pink sheets with a known neutral-density step in the bed and correct. Do not fit clipped data.

**F8 — < 90 % of overprint patches yield `usable ≥ 0.60`.** Registration exceeded the design slack. Regenerate with a larger footprint and reprint the affected feeds. Expected, cheap, must be caught by the gate rather than by a puzzling fit.

**F9 — the S10 joint polish moves any parameter by more than 2 %.** The stages are not orthogonal and one is mis-specified. Most likely cause: a leaked nonlinearity from §5.2 step 2. Investigate; do not accept the polished values.

**F10 — Session 3 shows τ_dry differs from τ_wet by more than 2× σ_within-sheet.** Then the dual-drum wet trap is *not* a valid default for the single-drum majority. Ship **τ_dry** as the default, keep `trap_condition` in the model file, expose an inter-pass-delay control in the UI, and label the wet-trap numbers as the author's machine. This is not a failure of the campaign — it is the campaign's most consequential finding, and it is the reason Session 3 is Session 3 and not Session 5.

**Per-sheet accept/reject, run before any fitting** — all of these, in order: 6/6 fiducials per plate with affine residual RMS < 0.30 mm; residual flat-field peak-to-peak < 3 % after the 2nd-order fit; row 9 reads as paper within 1 ΔE00 of the unprinted stock strip; slot (8,8) is the darkest patch on the sheet; within-sheet replicate σ ≤ 2.0 ΔE00; cross-copy MAD < 2.5 ΔE00; ≥ 90 % of overprint slots at `usable ≥ 0.60`; flood peak-to-peak < 12 % (above that the machine needs servicing before calibration means anything); no channel clipped.

---

# 7. WHAT THIS WILL NOT FIX

Stated here so it can be quoted verbatim into the UI and the release notes.

**7.1 Fluorescence. This campaign does not model fluorescence and no amount of cleverness in it will.**

With a single illuminant, `R_measured = R_reflective + E_fluorescent` is one equation in two unknowns per channel. Blasinski et al. is not a challenge to engineer around — it is a proof that the split does not exist in this data. A flatbed is one illuminant.

Both proposed workarounds are rejected, and the second is rejected for a reason worse than "it doesn't work":

- **The amber-gel platen overlay does not work on Fl. Pink.** A Rosco #15 Deep Straw / #21 Golden Amber cuts on around 480–500 nm. Riso Fl. Pink is a rhodamine-type daylight fluorescent excited in the **green, ~500–560 nm**. The gel passes that band essentially untouched, so `R_gel/T_gel²` is not "fluorescence suppressed" — it is the same fluorescent reading with a colour cast, and `E = R_normal − R_gel/T_gel²` is a small difference of two large, correlated, contaminated numbers. A gel that actually blocks Fl. Pink's excitation must cut on above ~580 nm, at which point it has also blocked most of the emission band and the "R and G are the emission channels" argument collapses.
- **The 395–405 nm violet-LED difference image will come out with the wrong sign, and will look like confirmation of the hypothesis.** Riso stock is OBA-brightened and OBAs excite hard at 365–405 nm; Fl. Pink barely excites there. The difference image is therefore dominated by **paper** fluorescence, and the ink — which absorbs the violet and blocks the paper's emission — appears as a *reduction*. You would fit a negative emission term, and since the fitting model explicitly predicts quenching (emission *falling* with coverage, opposite in sign to Beer–Lambert), **you would read an artefact as confirmation of the physics you predicted.** That is the worst available failure mode.

**What ships instead:** the measured total reflectance of every fluorescent configuration actually printed. Feeds 1, 2, 4, 5, 12, 13, 18, 20, 21 give Fl. Pink and Fl. Orange as full 9-level ladders and 64-patch overprint surfaces against `{K, B, R, Y, G, and each other}` — 6 pairs each, measured. For those, the model stores data and needs no fluorescence physics at all. `E = 0` everywhere else. `"fluo_split": null` on both inks. This is exactly Turunen's own recommendation after finding that even full bispectral ground truth gave "considerably high" errors for fluorescent mixing.

**The consequence, stated plainly:** the model will be right on measured fluorescent configurations and **structurally wrong on unmeasured ones and on print-order asymmetry**, because a product of transmittances is order-symmetric by construction and cannot know whether the fluorophore is above or below the absorber. Emmel & Hersch put Beer's-law error on fluorescent ink at **~ΔE 17**; we are removing that only where we measured. Fl. Pink + Blue will be right because it is measured, not because it is understood.

**7.2 Illuminant switching.** No Donaldson matrices, no illuminant-independent radiance factors, no quantum yields, no "preview under tungsten". The model is valid under one illuminant, unspecified, and any UI affordance suggesting otherwise is a lie.

**7.3 Metallic Gold and any opaque ink.** `opaque:true` inks hide what is under them; Babaei & Hersch show they must be modelled as **juxtaposed** colorants, not overprints. SCOP is the wrong model class. The `Gilt` profile stays `U`, not `X`, until a metallic drum is actually measured.

**7.4 Any paper except the measured one(s).** Until Session 4 exists, the dataset is one stock and must be labelled with it.

**7.5 Any screen ruling except 71 lpi AM.** `u` is a strong function of screen frequency — Hébert & Hersch measured n = 2 @ 50 lpi → 3 @ 75 → 6 @ 100 → 9 @ 125 on identical paper and ink. The shipped `u` is keyed to `{engine:'amt', lpi:71}` and **nothing is extrapolated to other rulings.** No `log n = α + β·lpi` model ships from one measured point. The app's other rulings fall back to the legacy path.

**7.6 One machine, on two afternoons.** Every number is this machine, these drums, this ink lot, this room. Cross-machine variance is unmeasured and is not bounded by anything in this document. If a second riso is ever reachable, print the reduced 4-feed version on it and report the between-machine variance; until then the dataset is labelled as one machine's characterisation, however good its internal statistics look.

**7.7 Three-and-four-ink overprints beyond prediction.** All `|J| ≥ 2` spreading is the declared Demichel blend, unvalidated until triples are printed. A 4-ink 400 %-TAC overprint is beyond any sane riso ink limit and is not in the dataset at all.

**7.8 Registration realism.** Session 1 and 2 measure *within-feed* registration (~0.2–0.5 mm, largely systematic). The app's `misreg` parameter models *pass-to-pass* registration (~1–2 mm, and it varies sheet to sheet), which only Session 3 measures. Until then the shipped `misreg` distribution is unchanged.

**7.9 The 11 remaining synthetic LUTs.** Lagoon, Indigo, Wine, Burgundy, Bisque, Bubblegum, Kelly Green, Smoky Teal, Fl. Green, Fl. Red, Clear Medium keep first-four knots that are a perfectly even ramp — synthetic interpolation labelled as measured. Black is fixed by measurement in Session 1. The other eleven are tagged `provenance:"synthetic"` and the UI must not claim accuracy for them. Five of them are also stocked by 0 of 11 surveyed studios; the overlap is not accidental — they were added from a vendor list, never printed by anyone, and their LUTs were interpolated.

**7.10 Fl. Pink fade.** The ink is fugitive. Cross-session comparisons involving Fl. Pink are only as good as the fade-control strips, and if the strips drift those comparisons get dropped, not corrected by hand.

---

# 8. BUILD ORDER

Ordered. Nothing later starts before everything earlier is done. Effort is for one person who knows this codebase.

### Ship this week, no press time, no dependencies

**T1 — Fix `RISO_CAL['Bright Red'].lut[4]`. 15 min.** Currently `[0.978,0.263,0.086]` = `#f94315`, an orange, against `hex:'#f15060'`, a coral red — 15.5 ΔE00, and it breaks monotone hue continuity with its own p70 `#f67764`. Set it to the swatch-consistent `[0.945, 0.314, 0.376]` as an **interim**, with a comment saying Session 1 replaces it by measurement. Note against the palette document: this is *not* a campaign blocker — `a_nom` comes from the raster and the LUT is not an input to the chart. It is a blocker for shipping the palette re-spec.

**T2 — Determine the blue drum's S-number. 5 min, physical.** `S-4257 Blue` (`#0078bf`, PMS 3005 U) vs `S-4261 Medium Blue` (`#3255a4`, PMS 286 U). The app's `#215cbc` is 11.5 ΔE00 from the former and 4.0 from the latter, and the surveyed studios stock them as two distinct inks. `Classic` and `CMYK` both hinge on which cylinder is actually in the machine. Rename and re-hex accordingly. Read the label on the drum.

**T3 — Provenance tagging. 3 h.** Add `provenance` to every `RISO_CAL` entry (`measured` / `thirdparty` / `synthetic`), tag the 11 (12 minus Black), surface it as a one-line badge in the ink picker ("measured / vendor scan / interpolated"). Costs nothing and is the difference between an honest tool and a confident one.

**T4 — `PROFILES` re-spec + M/X/U badge + stock count. 4 h.** Take the palette document's revised array essentially as written: 13 → 21 profiles, median studio availability 1/11 → 8/11, author-printable 3/13 → 14/21. Add `Pink Blue`, `Punch`, `Ink & Blue`, `Riso CMY`, `Riso CMYK`, `Meadow`, `Warm`, `Citrus`, `Gilt` — `Fl. Pink + Blue`, `Fl. Pink + Black` and `Black + Blue` are among the most-printed setups in the medium and none of them ship today. Delete `Night` (Fl. Green: 0/11 studios and a synthetic LUT). Re-spec `Vintage`, `Tropical`, `Berry`, `Ocean`, `Sunset`, `Forest`, `Neon Pop` onto stocked inks. Move `Pure CMYK` to `PROFILES_DIAG` — process inks are not riso drums. Keep `Earthy` and tag it `U`: the earth-tone register genuinely lives in the long tail and honest labelling beats deletion. Add `Light Gray` (`#88898a`, S-4291) to `RISO_COLORS` and `RISO_CAL` first — 4–5/11 studios stock it and it is absent from both tables.

Two things break, both listed in the palette document and both real:
- `selftest.html:100` does `R.PROFILES.find(p => /cmyk/i.test(p.name))` and will silently start testing `Riso CMYK`. Tighten to `p.name === 'CMYK'`.
- `js/phone.js:604` does `R.applyProf(PROFILES[0])`. Keep `Classic` at index 0.

Escalation: dot only in camera/live mode. In the separations/export path, if `profile.val !== 'M'`, stamp one line into the export and show a single non-blocking notice — that is the prepress-credibility surface and it is where the claim actually matters.

**T5 — `docs/PALETTE-SURVEY.md`. 2 h.** The 11-studio inventory table, so the `stock` numbers are auditable and re-runnable.

### Before Session 1 can happen

**T6 — `tools/chart_gen.py`. 2–3 days.** A dedicated deterministic 1-bit rasteriser, sharing only the screening kernel with the render path (`js/riso-amt.js` FS core + `riso_halftones.json`). It must never touch `adjustRGB`, `toCMYK`, `nnlsDecompose`, `getCoverage` or `calBlend`. **Do not route this through `exportSeparations()`** (`js/save.js:925`) — it encodes plates as `toDataURL('image/jpeg', 0.85)` (`:1207`) and hardcodes `ptPerPx = 72/300` (`:1224`). A dedicated rasteriser is strictly less work than making that path safe.

Emits: 42 × 1-bit PNG (Flate) at 4960 × 7016, 21 chart model JSONs, 14 flood plates, one instruction sheet. Asserts bimodality < 0.1 % intermediate. Self-test: generate twice, compare SHA-256.

Furniture composited **after** the screening pass as pure geometry — the 6 ring-crosses per plate, the label on the cyl-1 plate, the flare well as an unprinted region.

**Refuse to generate below 25 lpi in AM mode.** Below that, `patch_active` would exceed 14 mm; the app's 5 lpi preset would demand 71 mm patches, which is a live trap in the current preset ladder.

**T7 — `tools/prn_anom.py`. 1 day.** Wraps `docs/validation/decode_prn_reference.py`'s `decode_prn()`. Locates our ring-crosses in the decoded 600-dpi raster, fits the chart-mm → decoded-px affine (absorbing the driver's scale and centring), popcounts each active window, emits `a_nom` per plate per slot. Also: a `--ramp` mode that takes a 0–100 % request ramp, decodes it, and solves for the 7 requested levels whose achieved areas land nearest the §4.1.3 targets.

**T8 — THE PRE-FLIGHT. One evening, zero sheets. This is the gate.** Generate the P·B chart plates. Print-to-file through the real driver at the exact settings you will use on the day. Decode. Verify, in this order:

1. The `.prn` contains **both plates**, separately drum-addressed, in one job.
2. Scale is 1:1 at 600 dpi, page is A4, and the fiducial affine is within 0.2 % of identity in scale.
3. Per-slot decoded coverage vs our PNG's coverage: if they match to within ±0.01 everywhere, the driver is a pass-through and you are done. If they do not, you have just measured the driver transfer function for free — feed it to `--ramp` and re-pick the request levels.
4. The dot structure in the decoded raster is *our* screen, not the driver's — compare against the `.prn`'s known error-diffusion signature in `docs/validation/stats.json`. If the driver re-screened a 1-bit input, hunt for the mode that doesn't (Photo/Text/Line, `Kaityo Smooth`, `Gyakkou`) and re-run.
5. `AmiAngleDefault=45` is a single value in the RDF while the app wants two angles. Confirm from the decoded raster that both plates carry their own angle.

**Nothing else in this document matters until T8 passes.** If it fails, the fallback is F1/F2 in §6.6 and the campaign still runs — it just costs more feeds.

**T9 — Shader landing behind `u_inkModel`. 1–1.5 days.** `srgb2lin`/`lin2srgb`, the `aArea`/`dAmt` split with `Tk = Rink/Rpap` normalisation, the `|u| < 0.02` log-space branch, the WebGL1 `layerIdx` chain, delete the `u_dbgYNArea` branch, zero the 2 % contamination and bypass the `smoothstep(0.3,0.7)` LUT blend under the flag. Cal-LUT texture to 256 × 12 in **density encoding**. `inkModelVersion` in the save schema. **Default stays `u_inkModel = 0` until T13.** Do this before Session 1 so it is testable against real data the same evening, not after.

**T10 — Golden-image harness. 1 day.** ~30 reference renders, fixed seeds, SHA-256 on the CI GPU, ≤ 1/255 elsewhere. Plus `verifyChartDeterminism()`.

### Session 1 evening

**T11 — `tools/extract.py`. 2 days, and validate it before it touches a real scan.** Round-trip a **synthetic** scan first: render a chart through the app's own model, apply a known flat field, a known per-plate affine, known noise, and confirm the extractor recovers the affines and reflectances to within 0.2 %. This is the only way to know the extractor is not the error source. Then: Q-13 OECF, `F_scanner` from the blank set, fiducial affine, TPS fallback, windowing with integer-cell erosion, the blur-mask-then-pixel-mean estimator, block bootstrap, the F7 clipping gate, and the per-sheet accept/reject battery.

**T12 — `tools/fit.py` + `tools/report.py` + `tools/emit_inkmodel.py`. 2–3 days.** Stages S1–S12. Noise floor first, printed at the top of every run. H1/H2/H3 with the current shipped model on the same axes.

**T13 — Flip the default.** Set `u` from the fit, `u_inkModel = 1` for new projects, `inkModelVersion: 1`, release note with before/after renders and the H1/H2/H3 table. Promote nine profiles to `val:'M'` — and only profiles whose **every** pairwise overprint is in the measured set, not profiles that merely contain a measured ink.

### Total before Session 1: T1–T10 ≈ **6–8 working days**, of which T6 is half.

---

## Where I sided with whom, explicitly

**With the adversary, on feasibility:** the machine is dual-drum, so the five-block sweep-word combinatorics are solving a problem that does not exist and the K₇ Eulerian circuit replaces them; 2-ink sheets not 4-ink; a rigid 9×9 lattice with 12 fiducials, no simulated annealing, no ArUco, no Data Matrix, no Gray-code rulers; 63 scans not 490; one orientation not four; discard per *master* not per mount, and the sheet count is ~520 A4 for Sessions 1+2 rather than 424 A3; the gel and violet-LED fluorescence splits are deleted, and the violet one is deleted because it would produce a wrong answer that matches the hypothesis; the 2400 ppi mechanical-dot-gain strip is deleted; paper-relative colorimetry is the default and absolute ΔE00 is not claimed; the ink cartridge lot joins the settings-lock set; Fl. Pink fade gets control strips; and the whole thing is restructured so that every single feed is a complete shippable product.

**With the designers, on science:** linearise per-pixel before spatially averaging (14 ΔE00 at stake, shaped exactly like optical dot gain); arithmetic mean, never median, on a bimodal halftone; the three-layer flat-field ordering, in scanner coordinates then sheet coordinates; `u = 1/n` unclamped and allowed negative, fitted only below 50 % coverage and validated above it separately; the `d → (aArea, dAmt)` split with the `ink/paper` normalisation, in linear space, as the real fix to `index.html:2486`; the exponential paper PSF as the pixel-level counterpart to `u`, cross-checked against it; SCOP as the mechanism by which 7 drums improve 47 inks; Bugnon's parabola wherever the 3-knot residual is above the noise floor; leave-one-pair-out and leave-one-ink-out as the headline metrics rather than a flattering interpolation residual; density encoding for the cal-LUT texture; the 2 % cap on the joint polish; the reporting discipline (never a bare mean, always a separate `L* < 25` row); and the palette re-spec, which needs no press time at all.

**Three resolutions that are neither document's:**

1. **`a_nom` comes from the decoded `.prn`, not from our raster and not from the request.** The designers' R4 protects against the app and leaves the driver — which `stats.json` proves rewrites 50 % into 15.7 % — completely unguarded. The adversary is right about the exposure but proposes characterising and inverting the driver. Neither is necessary: the `.prn` is the bitmap the thermal head burns, so counting it makes the driver transfer irrelevant to correctness, and it simultaneously delivers the measured mechanical dot area that the designers wanted a 2400 ppi scan strip for — at exactly 600 dpi, with no threshold, no MTF limit, and no scanning time. This is the best single thing in this spec and it fell out of a file already in the repo.

2. **Wet vs dry trapping is not a refinement, it is a question about who the default is for.** The author's dual-drum machine has a sub-second wet trap. Most riso owners have single-drum machines and a minutes-to-hours dry trap. The campaign document declared 15 minutes the "production-normal" base point and was wrong about this machine; the adversary correctly identified the wet trap as production-normal *for this machine* and did not follow through to the shipping decision. So the dry-trap experiment is promoted to Session 3, ahead of the second paper stock and everything else, because it decides which number ships as the default for everyone else.

3. **Order is not recorded until it is known.** Sessions 1 and 2 record `cyl1`/`cyl2`, never "first"/"second", because which cylinder physically prints first is an unverified assumption and Session 3 determines it. Writing "first" into 1,701 measurement records on an assumption is exactly the kind of confidently-wrong data this whole exercise exists to stop producing.