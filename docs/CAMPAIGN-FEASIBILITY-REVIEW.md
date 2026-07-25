# Attack: the seven-drum campaign, from someone who has run production on one of these

## 0. The finding that invalidates the structure of all four documents

`riso driver/MZ9_CD106F_64bit/.../MZ9SerU.RDF`:

```
[RISO MZ 9 Series]
DrumCount=2
DefaultInkDrum=1001 , 1003
AmiLineRange=38, 200
AmiLineDefault=71
```

**The machine is a dual-drum MZ.** It holds two cylinders simultaneously and prints two colours in **one paper feed**. The brief's "HARD RISO CONSTRAINT: one drum per pass" is false for this machine, and the campaign document is built entirely on it:

- **§0.1's five-block / 20-pass decomposition** and **§0.2's shortest-common-supersequence "sweep word"** are an elegant solution to a scheduling problem this printer does not have. A 4-ink sheet is **2 feeds, not 4**. Twenty chart passes are **ten feeds**.
- **§0.3 is factually wrong.** "A riso job never has an offset-style seconds-scale wet trap. Every real 2-colour riso job has exactly this [15 min] interval." On an MZ, drum 1 and drum 2 lay down ink **less than a second apart, in the same paper path**. The seconds-scale wet trap is not an edge case here — it is the *production-normal condition for every two-colour job this machine has ever printed*. The campaign declares the wrong base point for τ and then builds the entire §4 delay axis on top of it.
- **Registration.** Within a single feed the two drums are mechanically registered — no re-feed, no re-grip. Real-world MZ drum-to-drum registration is on the order of 0.2–0.5 mm and largely *systematic*, not the 0.5–2 mm sheet-to-sheet the brief assumes. Pass-to-pass (re-feeding a printed stack) is where 1–2 mm lives. The campaign spends its entire design budget defending against a number that applies to half its passes.

Rebuilding the schedule for the real machine: **K₇ has 21 edges and every vertex has even degree 6, so it has an Eulerian circuit.** Traverse it and every consecutive pair of ink-pairs shares a drum — you swap **one** cylinder between feeds. All 21 pairs, each printed in a single tightly-registered feed with a true wet trap, in 21 feeds and 21 single-drum swaps. Masters needed = Σ(deg/2) = **21**. This is strictly better than the sweep word on every axis and it fell out of reading the driver file.

---

## 1. Time and tedium — where it dies, and it isn't session two

The press-time estimate (~15 h) is roughly honest. Everything around it is not.

**Real per-plate-run cost.** Master-make ~30 s, printing 20 A3 ~20 s, and then 4–6 minutes of: load feed tray, align guides, unload receiving tray, fan, slip-sheet, label, carry to a shelf. 71 plate-runs × 6 min = **7 h of handling**, not the 3 min/run budgeted.

**Sheet count is understated by ~3×.** §3 says "add the discard count once per mount, not per sheet type — this alone saves ~200 sheets of scrap." That is the exact wrong optimisation, and it is a *bias*, not a saving. There are two independent transients on a riso:

1. **Drum ink film** — per mount, 15–30 copies.
2. **Master soak** — per master. The first 3–5 copies through a *fresh* master are light regardless of how warm the drum is.

Discarding per-mount only means plate-runs 2, 3, 4, 5 on the same mount each begin with an un-soaked master, and those copies land in the keeper range. Honest budget: 20/mount + 5/run + 14 keepers ⇒ **~1,790 A3 sheets ≈ 3.6 reams**, against the claimed ~424.

**Re-feeding printed stacks is the operational killer nobody costed.** Session 1 has **15 stacks in flight**, each re-fed up to four times, each carrying wet oil ink. Riso feed trays double-feed and skew on freshly-printed ink-heavy stock; expect 5–15 % misfeeds, each of which smudges a sheet, breaks the pass sequence and costs five minutes. Multiply by 29 plate-runs.

**Capture is where it actually dies.** The fitting doc's own manifest is **490 scans**. At a realistic 2.5 min each including placement, backing, renaming and orientation flips, that is **~20 hours at a scanner**, spread over 6–8 evenings, with *zero* feedback until the extractor works — and the extractor (`tools/extract.py`: ArUco constellation, per-plate windowed ring-cross search, TPS fallback, Gray-code rulers, block bootstrap) is a multi-week build that produces nothing visible until it is finished.

**Prediction:** Session 0 and Session 1 happen and are enjoyable. Session 2 happens or half-happens. Then the project stalls in the scan/extract phase and terminates as a box of A3 charts and a half-written Python pipeline. The campaign is designed so that partial completion yields **nothing**, because every number depends on the extractor.

The §5 "abort-safe prefix" doesn't fix this — it makes the *printing* abortable, not the *analysis*. The right design property is: **the partial result must itself be the product**, at every step.

---

## 2. Registration — the layout is defended against the wrong statistic

The A3 layout's arithmetic is competent. Its error model is not.

**Rotation is missing from the slack budget.** A3 half-diagonal is 257 mm. A 0.35° plate rotation displaces a corner slot by **1.57 mm** — it consumes the entire 1.54 mm single-slot slack on its own, before any translation. Constraint H3 helps (worst allowed 4-plate slot is 161 mm from centre → 0.84 mm at 0.3°) but the design never states a rotation σ and never adds it to σ_y = 1.06 mm. The `≥0.6 usable` eroded-intersection gate is what actually saves this design, and it works — but it means the yield table in §8.2 ("~95 % for 4-plate patches") is an artefact of the gate, not of the geometry.

**The fatal statistical error is §8.2 point 2:** *"At a 20 % per-sheet failure rate the probability a patch is lost on all five is 0.2⁵ = 0.03 %."* This assumes independence across the five measured copies. It is not independent — **registration is dominated by how the drum sat in that particular mount.** If a cylinder seats 1 mm off, every sheet in that run is 1 mm off, identically. The mount-to-mount term is the big one, and **each ink is mounted exactly once per session in this campaign.** You have n = 1 on the dominant variance component and n = 5 on a sub-dominant one, and the plan reports the sub-dominant one as the registration distribution to ship as `misreg`.

Consequence for the held-out Green gate: G1/G2 are printed on a Green mount that never repeats. If that mount happened to sit badly, the "generalisation test" measures a registration accident and reports it as model error.

**Fix that also exploits the machine:** put every 2-ink overprint on a *within-feed* drum pair. The dual-drum registration is tight and largely systematic, which is exactly what the affine can remove. Reserve pass-to-pass registration for the 3- and 4-plate patches, which already have the 2×2 block slack. This is not a compromise — it is what the hardware is for.

---

## 3. Ink and paper — defensible in money, indefensible in handling

- **Paper:** ~1,790 A3 ≈ £45–70. Trivial in money.
- **Masters:** ~80 with remakes ≈ £40–80. Trivial.
- **Ink:** the 5–8 %/drum estimate is plausible. Trivial.
- **The cost is 1,800 sheets of manual handling**, plus slip-sheeting every ink-heavy stack by hand — the campaign mandates slip-sheets for U_x floods and any solid-heavy first pass, which is several hundred hand operations that appear nowhere in the timing model.

One omission from the settings-lock list in §7.8: **the ink cartridge lot per drum**. If any of seven drums runs dry mid-campaign and takes a fresh cartridge, density steps. Record it or the fit absorbs a cartridge change as a physical effect.

And a real risk nobody costed: **Riso Fl. Pink is fugitive.** It visibly fades in weeks of room light. Session 4 is "2–6 weeks later" and its cured-delay stacks are compared against Session-1 measurements; the sealed Green sheets sit for weeks too. That drift is currently indistinguishable from τ(cured). Cheap fix: dark storage in envelopes plus a **fade-control strip** re-measured at every session.

---

## 4. Fluorescents — the proposed handling is not sound, and one part has the sign wrong

Both fluorescence proposals will produce confidently wrong numbers.

**The Rosco gel trick (fitting §1.7) does not work on Fl. Pink.** A Rosco #15 Deep Straw / #21 Golden Amber cuts on around 480–500 nm. Riso Fl. Pink is a rhodamine-type daylight fluorescent — **it is excited in the green, ~500–560 nm**, not the blue. A #15 passes that band essentially untouched. The gel therefore does not suppress the excitation and `R_gel/T_gel²` is not "fluorescence suppressed"; it is the same fluorescent reading with a colour cast. Everything downstream of `E = R_normal − R_gel/T_gel²` is then a small difference of two large, correlated, contaminated numbers. To actually block Fl. Pink's excitation you need a cut-on above ~580 nm — at which point you have also blocked most of its emission band, and the argument that "R and G are the emission channels" collapses.

**The 395–405 nm violet capture (campaign Session 3) will come out with the wrong sign.** Riso stock is OBA-brightened and OBAs excite hard at 365–405 nm. Fl. Pink barely excites there. So the violet-LED difference image is dominated by **paper fluorescence**, and the ink — which absorbs the violet and blocks the paper's emission — will appear as a *reduction*. You will fit a negative emission term and, given that the fitting doc explicitly expects quenching (emission falling with coverage), **you will read the artefact as confirmation of the physics you predicted.** That is the worst possible failure mode: a wrong result that matches the hypothesis.

**Also unaddressed, and it silently destroys the data:** a flatbed sets its white point from the calibration strip. Fl. Pink's emission plus reflection frequently pushes the R channel **above the white reference and clips**. If a Fl. Pink solid reads 255 in R, every ladder point near it is compressed and every overprint over it is wrong, and nothing in the protocol checks for it.

**What is actually defensible:** the fitting doc's own **Tier F0** — measure `R_total` directly for every fluorescent configuration under one documented illuminant, store the measured values, set `E = 0` everywhere else, and label the scope. Blasinski's unidentifiability result is not a challenge to be engineered around with a €15 gel; it is a statement that the split does not exist in this data. F0 is complete, honest, and free. Take it and stop.

---

## 5. Scanner reality — the protocol is good, the accuracy claim is not

The settings table (descreen off, ICE off, 48-bit, linear, multi-pass) is genuinely correct and the three-layer nonuniformity decomposition — scanner field from blank platen, then per-sheet, then press banding, **in that order** — is the right call and the part of these documents I would keep verbatim.

Three problems:

1. **"Exposure locked for the whole session" is not achievable** on most consumer flatbeds. The unit re-calibrates against its under-lid white strip on every pass; you cannot lock it. This is why the Q-13 in every scan is load-bearing, and the docs treat it as a fallback rather than the mechanism.
2. **The absolute-colorimetry claim is not supportable without the spectrophotometer anchor strip.** Both documents cite Asman's 1.24–1.77 ΔE76 — measured on conventional CMYK colorants inside the IT8 gamut. Riso spot inks, and especially two fluorescents, are a Luther-condition violation with no correction path. Without the 29-patch spectro anchor, the honest output is **paper-relative scanner RGB**, and the shipped "2.5–4 ΔE00" number in the palette doc is not earned.
3. **This is fine, and should be embraced.** The app composites in RGB. `RISO_CAL` is RGB. The deliverable is an RGB LUT. Routing through XYZ/CIELAB adds a scanner-profile error term that exists only so the *report* can quote ΔE00. Fit in scanner-linear RGB against a paper anchor; quote ΔE00 only if the spectro anchor materialises.

---

## 6. The single most likely way this produces data that looks fine and is subtly wrong

**The driver rewrites your coverage between your PNG and the thermal head, and `a_nom` counted from your own raster is therefore fiction.**

This is not speculation. It is already measured, in this repo, in `docs/validation/stats.json`:

```
test_03_gray50.prn   global_ink_fraction = 0.15703
```

A 50 % input came out of the driver as **15.7 % ink on the master**. And `screening_mode_finding` classifies the output as error diffusion — the driver applied its **own** screen and **own** tone curve. `AmiLineDefault=71` in the RDF, against a chart layout sized for the app's 38.6 lpi rosette.

Both documents elevate "R4 — `a_nom` counted from set pixels in the raster, not requested" to the one non-negotiable rule. **R4 protects you from the app and leaves you fully exposed to the driver.** If the driver re-screens or re-tones a pre-screened 1-bit chart plate, then:

- every ladder point is at an unknown coverage,
- the fitted `f(a)` absorbs the driver's LUT,
- the fitted `u = 1/n` absorbs the driver's screen,
- the F7 falsifiability check (`n_FM > n_AM43`) is testing the driver, not the paper,
- and none of it looks wrong. The curves will be smooth, monotone, plausible, and transfer to nothing.

**The check, and it costs one evening and zero sheets:** generate the chart plates, print-to-file through the actual driver at the exact settings you will use, and run `docs/validation/decode_prn_reference.py` over the `.prn`. Count set pixels per patch **in the decoded raster**. That bitmap is what the thermal head burns — it is the only true `a_nom`. Then either (a) they match, and you proceed, or (b) they don't, and you have just discovered the driver transfer function for free and can either find a pass-through mode or invert it.

Do this **before printing anything.** Also verify how the driver encodes a two-drum job, and whether both drums get the same screen angle — the app assumes four distinct angles and the RDF has a single `AmiAngleDefault=45`.

---

## What survives

Keep, unchanged:

- **The `calBlend` no-op diagnosis** and the `d → (aArea, dAmt)` split. This is a code fix requiring **zero printing** and it is the most important finding in all four documents.
- **The linearisation-before-averaging argument** (fitting §2.5) and the mean-not-median estimator (§2.7). Both correct, both non-obvious, both would silently ruin the dataset if got wrong.
- **The three-layer flat-field ordering** (scanner field → de-skew → sheet field → banding).
- **Fitting `u = 1/n` unclamped and allowed negative**, fitted only below 50 % coverage, validated above.
- **`js/ui-controls.js:823`** — already fixed in the tree (`_saving` now reads the script global); good.
- **The palette re-spec.** This needs no press time at all. The `PROFILES` array genuinely is mis-specified: `Night`, `Vintage`, `Berry`, `Tropical` use inks essentially nobody stocks. Ship the revised array and the M/X/U badge **this week**.
- **`RISO_CAL['Bright Red'].lut[4] = [0.978, 0.263, 0.086]`** against `hex:'#f15060'` — confirmed in `js/data.js:32`. That's an orange where the swatch is a coral red. Blocker, fix before any chart.
- Reporting discipline: mean/median/p95/max, separate row for L\* < 25, never a bare mean.
- The **Green hold-out** idea — cheap, honest, keep it.

Dies:

- The five-block / sweep-word combinatorics (wrong machine).
- τ base condition at 15 min (wrong machine).
- The 216-slot annealed A3 layout with ArUco + two Data Matrix + Gray-code rulers + 500k-step simulated annealing. Months of tooling for a marginal gain over a rigid grid with four crosses.
- The 490-scan, 8-design manifest.
- The gel and violet-LED fluorescence splits.
- The 2400 ppi MDG strip as the primary path (the fitting doc's own threshold-sensitivity gate predicts it fails on the 600 dpi FM screen — which is the screen the driver actually uses).
- Absolute ΔE00 claims without a spectrophotometer.

---

## The minimum viable version, for someone with a day job

**"K₇ Eulerian pair sweep." One chart design. One afternoon. Ships a real improvement.**

**Prerequisite — one evening, zero sheets:** print the chart design to file through the real driver, decode with `decode_prn_reference.py`, and confirm patch coverages match. If they don't, stop and characterise the driver first. Nothing else matters until this passes.

**The chart:** one A4, two plates, no annealing, no ArUco.
- A 6×6 grid of 30 mm patches at {0, 20, 40, 60, 80, 100} % for plate A × the same for plate B. 36 patches, 180×180 mm.
- Row 0 and column 0 **are** the two single-ink ladders, on bare paper. Free.
- 4 large registration crosses (one per plate per corner pair) + 6 bare-paper patches + a printed pair label.
- 30 mm patches on a machine whose two drums register within a single feed to ~0.3 mm means registration is a non-issue. No guard-band arithmetic, no eroded intersections, no yield model.

**The press session (one sitting, ~4 h):** walk an Eulerian circuit of K₇ — 21 edges, 21 feeds, 21 masters, one cylinder swapped between consecutive feeds. Print 20, discard the first 5, keep 3. **Order the circuit so the highest-value pairs come first**: Fl.Pink+Blue → Fl.Pink+Black → Blue+Black → Blue+BrightRed → BrightRed+Yellow → Blue+Yellow → Fl.Pink+Yellow → … Stop whenever you like; every completed edge is a finished, self-contained, shippable measurement. **The partial result is the product.** ~420 A4 sheets, under a ream.

**Capture (one evening, ~2 h):** 63 A4 scans at 400 ppi, one orientation, ten backing sheets, no auto-anything, Q-13 in the bed. Any A4 flatbed.

**Analysis (one evening):** four crosses → affine → 36 rigid patch means. Fifty lines of Python, not a pipeline.

**What it delivers:**
- **7 first-party single-ink ladders, each measured 6 times** (every ink appears in 6 edges) — replacing the third-party 2019/2020 txtbooks scans, including Black, one of the 12 synthetic LUTs.
- **All 21 two-ink overprint solids, measured** — data that does not exist anywhere in the project today.
- **All 21 two-ink overprint tone surfaces at 6×6** — enough to fit `f_{i/j}` and a first SCOP `j,k`.
- All of it under the machine's **true production condition**: single feed, wet trap, tight registration.
- A per-ink replicate σ from the 6 repeats — the noise floor, measured, which every claim downstream needs.

That is one afternoon, one evening of scanning, one evening of code, and it fixes `Classic`, `CMYK`, `Fl.Pink+Blue`, `Fl.Pink+Black` and `Mono` — the profiles that essentially every riso owner actually prints.

**Then, and only then**, decide whether print-order asymmetry, delay curves, triples, SCOP transfer and fluorescence separation are worth a second campaign. They probably are worth exactly one of them. They are certainly not worth all of them before the first one ships.