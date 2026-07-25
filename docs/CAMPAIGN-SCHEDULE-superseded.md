# RISO/CAM — Seven-Drum Print Campaign

**Design brief:** produce a shippable, first-party overprint dataset on the author's own machine, for exactly `{Black, Blue, Bright Red, Yellow, Green, Fl. Pink, Fl. Orange}`, instantiating `docs/CHART-DESIGN.md` rather than redesigning it.

**Headline:** the whole campaign is **22 drum mounts, 69 plate-runs, ~15 h of press time, 3 press sessions + 1 capture session**. Naively sequenced sheet-by-sheet the identical dataset costs ~60 mounts. The saving comes from one structural decision (§2) and nothing else.

---

## 0. The three decisions everything else follows from

### 0.1 Blocks of four inks, not pairs of two

C(7,2)=21 pairs, but a 4-ink sheet with 4 passes delivers **6 pairs + 4 triples + 1 quadruple = 11 Neugebauer overprints in one sheet**. Measuring 21 pairs as 21 two-ink sheets is 42 passes and yields zero triples. Measuring them as 4-ink blocks is 20 passes and yields 20 triples and 5 quads for free.

How many 4-subsets of a 7-set are needed to cover all 21 pairs? The Schönheim bound gives ⌈(7/4)·⌈6/3⌉⌉ = 4, but 4 is not achievable:

- Σ block sizes = 16, every element needs degree ≥ 2 (6 pairs per element, 3 covered per block).
- Any element `x` of degree exactly 2 has its two blocks meeting only in `x`, so they partition the other six into two triples `{p,q,r}`/`{s,t,u}`, leaving the 9 bipartite pairs between them uncovered.
- A 4-block covers at most 2·2 = 4 of those 9. Two remaining blocks cover ≤ 8 < 9. The degree-4 case fails similarly (4 blocks × 3 internal pairs = 12 < 15 pairs among the other six).

**C(7,4,2) = 5.** Five 4-ink blocks, 20 passes, all 21 pairs. The nine repeated pairs are not waste — they are the cross-sheet replicates that feed the Q7 noise floor and the §5.4 per-sheet drift term.

Independently: `js/state.js:4` is `layerOrder=[0,1,2,3]`. **Four is also the maximum the simulator can represent**, so a 4-ink block is exactly one full instance of the model under test. Blocks of 5+ would measure something the app cannot express.

### 0.2 The sweep word — how 52 passes become 7 drum mounts

A riso pass = one drum. A drum swap is the dominant cost. The scheduling problem is exact:

> Each sheet requires its passes in a given order. The session's drum sequence is a **word** over the ink alphabet. A sheet is printable in that session iff its pass order is a **subsequence** of the word. Minimising swaps = **shortest common supersequence** of all sheets' pass orders.

If every sheet's pass order is chosen consistent with **one global ink ordering**, the SCS is that ordering itself — **7 mounts for an unbounded number of sheets**.

Take the ordering by measured 100 % luminance from `RISO_CAL` (light → dark, which is also what riso printers actually do, so the primary dataset is measured under production-normal conditions):

```
SWEEP WORD:  Yellow → Fl. Orange → Fl. Pink → Bright Red → Green → Blue → Black
L(p100):       .87        .60          .60         .44        .38     .36     .03
```

All five blocks' forward pass orders are subsequences of this single word:

| Block | Inks | Forward pass order | Position in sweep |
|---|---|---|---|
| **C1** | K, B, R, Y | Y → R → B → K | 1, 4, 6, 7 |
| **F1** | B, K, P, O | O → P → B → K | 2, 3, 6, 7 |
| **F2** | Y, R, P, O | Y → O → P → R | 1, 2, 3, 4 |
| **G1** | G, K, B, R | R → G → B → K | 4, 5, 6, 7 |
| **G2** | G, Y, P, O | Y → O → P → G | 1, 2, 3, 5 |

**20 chart passes across 7 mounts.** Add the uniformity sheets and trapping wedges and it is 29 plate-runs across the same 7 mounts.

Corollary, and it is the rule to write on the wall: **you never print a sheet, you print a mount.** At each mount, every stack in the building that wants that ink next gets it. The unit of work is the drum, not the sheet.

### 0.3 Batching changes what "wet trapping" means — and that is correct

Batching by drum means every sheet sits for at least one drum-swap interval (~15 min) between passes. That is not a compromise: **a riso job never has an offset-style seconds-scale wet trap.** Every real 2-colour riso job has exactly this interval. So:

- The campaign's **base condition is τ(≈15 min)** — production-normal, and the condition the shipped default should encode.
- The delay axis is then **15 min → 16 h → cured (weeks)**, measured densely on two junctions only (§4).

This resolves the apparent conflict between swap-minimisation and trapping measurement in favour of swap-minimisation, on physical grounds.

---

## 1. Priority order of the 21 pairs, and why

| Rank | Pair group | Delivered by | Argument |
|---|---|---|---|
| **1** | **KB, KR, KY, BR, BY, RY** — the CMYK quartet | **C1** | The only inks in three of the 13 shipped profiles that the author can actually print: **Mono** (K), **Classic** (B+R), **CMYK** (B+R+Y+K). Blue+Bright Red is the most-printed ink pair in world risography, so this block improves the default for most users who will never calibrate. It is also the only block that exercises `toCMYK`/`nnlsDecompose`. And **Black is one of the 12 synthetic LUTs** (`js/data.js:16`, a near-perfectly-even ramp labelled "Spectrolite linear black") — measuring it replaces invented data with measured data. |
| **2** | **BP, BO, KP, KO, PO** — fluorescents under/over the two darkest inks | **F1** | The scientifically hardest and most-wrong case. Emmel & Hersch put Beer–Lambert's error on fluorescent ink at **~ΔE 17**. `docs/INK-PHYSICS-PLAN.md:23` names *Fl. Pink over Blue* as the known failure. Excitation-band and emission-band attenuation are both **maximal under dark ink** and are **order-asymmetric**, which a product of transmittances structurally cannot express. If you want the biggest single ΔE reduction per patch, it is here. |
| **3** | **RP, RO, YP, YO** — fluorescents over the warm chromatics | **F2** | Note `Yellow` carries `fluo:true` in `js/data.js:37` — the author effectively owns **three** fluorescing drums. Fl.×Fl. and Fl.-over-Yellow is where quenching (emission *falling* with coverage, opposite sign to Beer–Lambert) shows up. F2 also re-measures RY and PO, giving the cross-block replicates. |
| **4** | **GK, GB, GR, GY, GP, GO** — Green with everything | **G1, G2** | Green is the outlier and is deliberately demoted, **not** because it matters least but because it is worth more as a **held-out test than as training data**. Green's hue is unreachable from any combination of the other six (Blue⊗Yellow → dark olive, not `#2f7744`). Fit SCOP + superposition-dependent spreading on ranks 1–3, **freeze and hash the predicted Green overprints, then measure them.** That is a genuine test of the exact mechanism that has to serve the majority of users — people whose two drums are not the author's seven. It is also the only defensible way to claim the shipped data generalises beyond these 7 inks to the other 40 in `RISO_CAL`. |

**Print Green in Session 1 anyway** (it is free — Green is already mount 5 of the sweep) but **seal the sheets and do not scan them** until the predictions are frozen. Held-out validity comes from prediction-before-*measurement*, not prediction-before-*printing*. This saves an entire session.

15 of the 21 pairs (blocks C1/F1/F2) get **both** pass orders. Green's 6 get forward only and are predicted.

---

## 2. Session 0 — the 30-minute pre-flight (do this weeks before anything else)

Non-negotiable, and it is the highest-leverage 30 minutes in the campaign. Three numbers the chart geometry depends on are currently **guesses**:

| Unknown | Currently | Why it must be measured first |
|---|---|---|
| Registration guard `g` | `docs/CHART-DESIGN.md:255` defaults to 3.0 mm | `g` sets the overprint pitch (16 + 2g mm). At g = 4 mm the A3 overprint capacity is ~105 slots and the T1+ layout **does not fit**. At g = 2 mm it is ~150 and it does. You cannot generate the charts without it. |
| Ink-up ramp length | "discard first 10" | If the real number is 25, every sheet in Session 1 is measured on unstabilised ink flow and the whole campaign is void. |
| Registration σ sheet-to-sheet | unknown | Feeds the simulator's `misreg` parameter directly — a shipping feature, not just a calibration input. |

**Session 0 sheet — `P0`:** A4, 2 passes, **no patches**. Plate 0 (Blue): the four-corner vernier combs at 1.00 mm pitch + ArUco band + a 50 % flood strip. Plate 1 (Black): the interleaved 1.10 mm combs + a second 50 % flood strip.

| Mount | Ink | Plate-run | Copies |
|---|---|---|---|
| 1 | Blue | P0-p1 | 30 (+10 warm-up) |
| 2 | Black | P0-p2 | 30 |

Read the verniers **by eye** on all 30 sheets — 0.1 mm resolution, 10 minutes, no software, no scanner. Read the flood-strip density on a scan of sheets 1, 3, 5, 8, 12, 16, 20, 25, 30 to find where density plateaus.

**Outputs:** `g = ceil(p95|offset| + 1 mm)`, `discard_first`, `μ/σ/rotation` of inter-drum registration. All three go straight into the `geometry` and `print` blocks of the chart model file (`docs/CHART-DESIGN.md:565`).

**2 mounts, ~30 min, 40 sheets.**

---

## 3. The campaign table

Sheet sizes: **A3** (277 × 395 mm safe area, 17 × 24 = 408 slots at 16 mm pitch). A3 because the riso is an A3 machine and because the Session-1 sheet needs ~340 occupied slots. Scan as two overlapping A4 tiles — each plate's fiducial band runs across both halves, and the per-plate affine of `docs/CHART-DESIGN.md:266` registers the tiles for free. Trapping wedges are A4.

`p1..p4` = pass 1..4 of that sheet. Copies = keepers; add the Session-0 discard count **once per mount**, not per sheet type (the ink-up ramp is a property of the drum, not the stack — this alone saves ~200 sheets of scrap).

### SESSION 1 — FORWARD SWEEP
**Word `Y → O → P → R → G → B → K` · 7 mounts · 29 plate-runs · ~6 h**

| Mount | Ink | Sheet | Inks on sheet | Pass | Copies | What it determines |
|---|---|---|---|---|---|---|
| 1 | Yellow | **C1** | K,B,R,Y | p1 (Y→R→B→K) | 14 | Y ladder on paper; sheet identity plate |
| 1 | Yellow | **F2** | Y,R,P,O | p1 (Y→O→P→R) | 14 | Y ladder replicate |
| 1 | Yellow | **G2** | G,Y,P,O | p1 (Y→O→P→G) | 14 | Y ladder replicate |
| 1 | Yellow | **U_Y** | Y | single | 6 | Banding field `S(x,y)`, period λ; verso → show-through |
| 2 | Fl. Orange | **F1** | B,K,P,O | p1 (O→P→B→K) | 14 | O ladder on paper |
| 2 | Fl. Orange | **F2** | Y,R,P,O | p2 | 14 | O over Y: **YO** |
| 2 | Fl. Orange | **G2** | G,Y,P,O | p2 | 14 | O over Y replicate |
| 2 | Fl. Orange | **U_O** | O | single | 6 | Banding, show-through |
| 3 | Fl. Pink | **F1** | B,K,P,O | p2 | 14 | **PO** |
| 3 | Fl. Pink | **F2** | Y,R,P,O | p3 | 14 | **YP**, **PO**, Y+O+P triple |
| 3 | Fl. Pink | **G2** | G,Y,P,O | p3 | 14 | (sealed) |
| 3 | Fl. Pink | **U_P** | P | single | 6 | Banding, show-through |
| 3 | Fl. Pink | **TR-PB** | P,B | p1 | 3 × 12 | 3 delay stacks: wet / 16 h / cured |
| 4 | Bright Red | **C1** | K,B,R,Y | p2 | 14 | **RY** |
| 4 | Bright Red | **F2** | Y,R,P,O | p4 | 14 | **RY, RP, RO** + 3 triples + **YRPO** quad |
| 4 | Bright Red | **G1** | G,K,B,R | p1 (R→G→B→K) | 14 | R ladder replicate (sealed) |
| 4 | Bright Red | **U_R** | R | single | 6 | Banding, show-through |
| 5 | Green | **G1** | G,K,B,R | p2 | 14 | **GR** (sealed) |
| 5 | Green | **G2** | G,Y,P,O | p4 | 14 | **GY, GP, GO** + triples + quad (sealed) |
| 5 | Green | **U_G** | G | single | 6 | Banding, show-through, G ladder |
| 6 | Blue | **C1** | K,B,R,Y | p3 | 14 | **BY, BR** + Y+R+B triple |
| 6 | Blue | **F1** | B,K,P,O | p3 | 14 | **BO, BP** + O+P+B triple |
| 6 | Blue | **G1** | G,K,B,R | p3 | 14 | **GB, BR** (sealed) |
| 6 | Blue | **U_B** | B | single | 6 | Banding, show-through |
| 6 | Blue | **TR-BK** | B,K | p1 | 3 × 12 | 3 delay stacks |
| 6 | Blue | **TR-PB**-wet | P,B | p2 | 12 | **τ(P→B, 15 min)** |
| 7 | Black | **C1** | K,B,R,Y | p4 | 14 | **KY, KR, KB** + 3 triples + **YRBK quad** |
| 7 | Black | **F1** | B,K,P,O | p4 | 14 | **KO, KP, KB** + 3 triples + **OPBK quad** |
| 7 | Black | **G1** | G,K,B,R | p4 | 14 | **GK, KB, KR** + quad (sealed) |
| 7 | Black | **U_K** | K | single | 6 | Banding, show-through, flare probe anchor |
| 7 | Black | **TR-BK**-wet | B,K | p2 | 12 | **τ(B→K, 15 min)** |

### SESSION 2 — REVERSE SWEEP (next morning)
**Word `K → B → R → P → O → Y` · 6 mounts · 18 plate-runs · ~3.5 h**

Byte-identical plates, reversed order. Zero new chart generation.

| Mount | Ink | Sheet | Inks | Pass | Copies | What it determines |
|---|---|---|---|---|---|---|
| 1 | Black | **C1r** | K,B,R,Y | p1 (K→B→R→Y) | 14 | — |
| 1 | Black | **F1r** | B,K,P,O | p1 (K→B→P→O) | 14 | — |
| 1 | Black | **TR-BK**-16h | B,K | p2 | 12 | **τ(B→K, ~16 h)** — rides free on this mount |
| 1 | Black | **TR-BK**-rev | K,B | p1 | 12 | — |
| 2 | Blue | **C1r** | | p2 | 14 | **τ(K→B)** vs τ(B→K) |
| 2 | Blue | **F1r** | | p2 | 14 | **τ(K→B)** replicate |
| 2 | Blue | **TR-PB**-16h | P,B | p2 | 12 | **τ(P→B, ~17 h)** — rides free |
| 2 | Blue | **TR-BK**-rev | | p2 | 12 | **τ(K→B, 15 min)** |
| 2 | Blue | **TR-PB**-rev | B,P | p1 | 12 | — |
| 3 | Bright Red | **C1r** | | p3 | 14 | **τ(K→R), τ(B→R)** |
| 3 | Bright Red | **F2r** | Y,R,P,O | p1 (R→P→O→Y) | 14 | — |
| 4 | Fl. Pink | **F1r** | | p3 | 14 | **τ(K→P), τ(B→P)** — the order-asymmetry the model cannot express |
| 4 | Fl. Pink | **F2r** | | p2 | 14 | **τ(R→P)** |
| 4 | Fl. Pink | **TR-PB**-rev | | p2 | 12 | **τ(B→P, 15 min)** |
| 5 | Fl. Orange | **F1r** | | p4 | 14 | **τ(K→O), τ(B→O), τ(P→O)** |
| 5 | Fl. Orange | **F2r** | | p3 | 14 | **τ(R→O), τ(P→O)** replicate |
| 6 | Yellow | **C1r** | | p4 | 14 | **τ(·→Y)** for K, B, R |
| 6 | Yellow | **F2r** | | p4 | 14 | **τ(·→Y)** for R, P, O + reversed **YRPO** quad |

### SESSION 3 — CAPTURE ONLY (any evening, dark room)
**0 mounts · ~2 h**

The T3 fluorescent block needs **no new prints**. F1/F2 forward + F1r/F2r reverse already contain both fluorescents as tints and solids, under and over `{B, K, R, Y}`, in **both orders** — exactly the structure `docs/CHART-DESIGN.md:175` specifies.

| Capture | Subject | Illuminant | What it determines |
|---|---|---|---|
| 3a | F1, F2, F1r, F2r, G2, U_P, U_O, U_Y + bare stock | broadband, AE/AWB locked | reference reflectance |
| 3b | identical geometry, identical exposure lock | 395–405 nm violet LED, room dark | difference image = additive emission `E(λ)` |

Blasinski's warning is load-bearing: **one illuminant ⇒ the fluorescent and reflective components are mathematically unidentifiable.** No second illuminant, no fluorescence model, full stop. The second capture costs a €15 LED and two hours.

Gap to declare honestly: Green × fluorescent appears forward-only (G2), so `τ` for those two junctions is predicted, not measured.

### SESSION 4 — T2 DEPTH FORWARD SWEEP (2–6 weeks later)
**Word `Y → O → P → R → G → B → K` · 7 mounts · 22 plate-runs · ~5 h**

Sheet 2 of every block, strictly additive per `docs/CHART-DESIGN.md:471` — **nothing from Session 1 is reprinted**. Content: full 3-point superposition curves (25/50/75 for every `f_{i/J}`), SCOP 3-backing tint wedges, pairwise mid-tone overprint surfaces, show-through wedge.

| Mount | Ink | Sheet | Inks | Pass | Copies | What it determines |
|---|---|---|---|---|---|---|
| 1 | Yellow | **C2, F4, G4** | as C1/F2/G2 | p1 | 14 ea | 18-level ladders; SCOP wedge over grey & black |
| 2 | Fl. Orange | **F3, F4, G4** | as F1/F2/G2 | p1/p2/p2 | 14 ea | |
| 3 | Fl. Pink | **F3, F4, G4** | | p2/p3/p3 | 14 ea | |
| 3 | Fl. Pink | **TR-PB**-cured | P,B | p1 already done | — | (stack held from S1) |
| 4 | Bright Red | **C2, F4, G3** | | p2/p4/p1 | 14 ea | |
| 5 | Green | **G3, G4** | | p2/p4 | 14 ea | |
| 6 | Blue | **C2, F3, G3** | | p3/p3/p3 | 14 ea | |
| 6 | Blue | **TR-PB**-cured | P,B | p2 | 12 | **τ(P→B, cured)** — asymptote |
| 7 | Black | **C2, F3, G3** | | p4 | 14 ea | |
| 7 | Black | **TR-BK**-cured | B,K | p2 | 12 | **τ(B→K, cured)** — asymptote |

---

## 4. Reversal and delay — the fractional design that keeps this finite

The full factorial is **21 pairs × 2 orders × 3 delays = 126 conditions.** That campaign never finishes. The escape is a one-factor-at-a-time design around a base point, which is standard and defensible:

- **Base point:** forward order, τ(≈15 min), all 21 pairs — Session 1.
- **Order axis, sampled densely at the base delay:** 15 of 21 pairs reversed — Session 2, 6 mounts, one morning. Blocks C1/F1/F2 chosen because they carry every pair involving a fluorescent-plus-dark or fluorescent-plus-fluorescent junction, which is where the literature predicts the asymmetry is largest and where the current model is structurally incapable (a product of transmittances is order-symmetric by construction).
- **Delay axis, sampled densely on two junctions only:** `B→K` and `P→B`, at **15 min / 16 h / cured**, plus their reversals at 15 min. `B→K` is the highest-total-ink, most-used junction in the set (CMYK's shadow построение); `P→B` is the named failure case and the one where the vehicle's absorption might plausibly change the fluorophore's optical environment.
- **`τ` is then modelled as separable:** `τ_{A→B}(Δt) = τ_{A→B}(15min) · h(Δt)` with a single shared roll-off `h` fitted from the two delay-swept junctions. Users declaring an inter-pass delay get an interpolated value. If the two junctions disagree on `h` beyond the noise floor, the separability assumption is falsified and you say so in the UI rather than shipping a fiction.

**Cost of the entire delay axis: zero additional drum mounts.** Every delayed pass rides on a mount that already exists — Session 2's mount 1 is Black (≈16 h after Session 1's Blue), Session 2's mount 2 is Blue (≈17 h after Session 1's Fl. Pink), Session 4's mounts 6 and 7 are Blue and Black. The delay experiment costs **paper and bookkeeping only**. This is the single most important scheduling trick in the campaign and it falls straight out of the sweep-word structure.

---

## 5. What ships when

### After Session 1 (same evening — scan C1 only, ~1 h, 6 sheets)

Scan the **CMYK block first**. It alone yields:

1. **Four first-party single-ink ladders** (Y, R, B, K) replacing third-party 2019/2020 txtbooks scans — and Black is one of the 12 flagged synthetic LUTs, so this converts invented data into measured data.
2. **All 6 CMYK-quartet pair solids, 4 triples, 1 quad** — 11 Neugebauer colorants that currently do not exist anywhere in the project.
3. A fitted **`u = 1/n`**, parameterised as `u` not `n`, **unclamped, allowed negative** (Viggiano; expect negative `n` on absorbent riso stock — that is ink penetration, not a bug), fitted on `a ≤ 0.5` only and validated on `a > 0.5` per Ruckdeschel & Hauser.
4. The evidence to **delete the no-op at `index.html:2486`**. `paperYN=sqrt(result); inkYN=sqrt(ink); (paperYN·inkYN^d)^2 ≡ result·ink^d` is plain Beer–Lambert with a Yule–Nielsen label on it. The correct form with ink/paper normalisation is already 40 lines above behind `u_dbgYNArea` (`index.html:2443`). Session 1 supplies the measured ladders that make the fitted `u` meaningful, so the flag can be flipped and the dead branch deleted.

That covers **Mono, Classic, and CMYK** — all three profiles the author can print — and Blue+Bright Red is the most-printed ink pair in world risography, so this ships a real default improvement to users who own two drums and will never calibrate. **This is the afternoon's shippable unit. Resist bundling anything else into it.**

**Abort-safe prefix:** if only half a day is available, run mounts **Y, R, B, K** only (4 mounts, ~3 h) and print C1 + U_Y/U_R/U_B/U_K + TR-BK. Every sheet whose inks lie inside the retained mounts still completes. The Fl. and Green blocks simply do not start.

### After Session 2
Ordered trapping scalars `τ_{A→B}` for 15 pairs, **fitted colorimetrically (ΔE-based, per Nguyen 2022), not from the Preucil relation** — `T=(D_op−D_1)/D_2` assumes density additivity and is a densitometric QC readout, not a model. `docs/INK-PHYSICS-PLAN.md:125` currently proposes Preucil; that should be demoted to a diagnostic. One uniform, one multiply on the second layer's effective coverage — and `layerOrder` is already drag-reorderable in the UI, so this becomes visible immediately.

### After Session 3
`R_total = R_multiplicative + E_additive` for Fl. Pink, Fl. Orange and Yellow, with separate excitation-band and emission-band attenuation and a saturating quenching roll-off `Q(coverage)`. Rank-1 excitation×emission outer product per ink (Blasinski's single-fluorophore form — cheapest that is still physically correct).

### After Session 4
- **SCOP `X = j·(X_bg·X_fg)^k` per channel**, fitted from the 3-backing wedges. **This is the payoff that justifies owning seven drums.** SCOP predicts overprints for pairs never measured, from each ink's solid colour alone — and all 47 inks in `RISO_CAL` have a solid colour. So the seven measured drums generalise to the other forty. Expect ~1.8–2.2 ΔE00 on offset; budget 3–4 on riso.
- Full superposition-dependent spreading curves `f_{i/J}` (Hersch & Crété report 1.7–3.4× error reduction over one curve per ink).
- Show-through composited in **density space** (Sharma 2001), anchored to RISO's own patent US 6,011,083: front density 1.21–1.26 against show-through 0.13–0.16, i.e. **10–13 %**, with a show-through PSF markedly wider than the recto ink PSF.
- Optical dot gain as an explicit **exponential convolution `exp(−r/λ)`** (Inoue/Tsumura/Miyake measured paper's PSF as exponential), separated from mechanical spread.

### The Green held-out gate
**Before scanning G1/G2**, fit everything on C1/F1/F2 (+ reversals), predict Green's 6 pairs and 2 quads, write the predictions to a file, hash it, commit the hash. Then scan. Report held-out mean / median / **95th percentile** / max ΔE00, a cumulative frequency curve, separate ΔL*/Δa*/Δb*, and **a separate row for L\* < 25** (Vrhel & Trussell: systematically the worst region, and riso's deep overprints live there).

**Go/no-go:** ship the generalisation claim only if held-out mean ΔE00 < 4.0 **and** held-out mean < 2 × measured replicate σ. If the second fails the result is capture-limited — say so, and do not launder a training residual as accuracy. There is no peer-reviewed literature on riso reproduction and no published evaluation of any riso simulator; publishing this number honestly would be the first, and that is worth more than a flattering one.

---

## 6. Budget

| | Session 0 | Session 1 | Session 2 | Session 3 | Session 4 | **Total** |
|---|---|---|---|---|---|---|
| Drum mounts | 2 | 7 | 6 | 0 | 7 | **22** |
| Plate-runs (masters) | 2 | 29 | 18 | 0 | 22 | **71** |
| Chart passes | 60 | 20 | 12 | 0 | 20 | **52** |
| A3 sheets (incl. warm-up) | — | ~182 | ~102 | — | ~140 | **~424** |
| A4 sheets | 40 | 72 | 24 | — | 24 | **~160** |
| Press wall-clock | 0.5 h | **6 h** | **3.5 h** | 0 | **5 h** | **~15 h** |
| Capture wall-clock | 0.2 h | ~6 h | ~4 h | 2 h | ~6 h | **~18 h** |

Timing model: 15 min per mount (swap + ink-up + confidence copies), 3 min per plate-run (master ~30 s + feed/stack/slip-sheet/label ~2 min), printing itself negligible at 100+ ppm.

**Naive comparison:** 71 plate-runs sequenced sheet-by-sheet is ~60 mounts ≈ 15 h of pure swapping. The sweep-word schedule spends 5.5 h on swaps. **~9.5 h saved, and a campaign that actually gets finished.**

Consumables: ~1 ream A3 + change, ~71 masters (well inside one roll), roughly 5–8 % of each drum.

**Capture is the larger cost, not printing.** Scan at 400 ppi, 48-bit TIFF, **every auto-correction off** (descreen especially will destroy the halftone statistics), backed with ≥10 sheets of the same stock, warm-up scan discarded. Four-orientation averaging (0/90/180/270) on **2 anchor sheets per block only**; the remaining 4 get a single 0° scan, tied in through the shared control lattice's per-sheet gain/offset. That cuts scanning from ~8 h to ~4 h per session's output. Characterise the scanner ICC **on the riso overprint patches themselves**, never on a generic IT8/Q60 — Lee/Bala/Sharma measured ~6–7 ΔE76 for a generic 3-D scanner profile on multi-colorant overprints against ~2–3 for a colorant-aware one, and the chart already contains the right patches.

---

## 7. What must be built before a single sheet is printed

Printing before these land produces a dataset that is confidently wrong, and reprinting is the one thing this campaign is designed to never do.

1. **`js/chart-raster.js`** — dedicated deterministic 1-bit rasteriser sharing only the screening kernel with the render path (`js/riso-amt.js` FS core + `riso_halftones.json`). Charts must never touch `adjustRGB`, `toCMYK`, `nnlsDecompose`, `getCoverage` or `calBlend`. Strictly less work than making `exportSeparations()` safe — it is a hand-maintained fork of `setRenderUniforms` with 17 uniforms drifted, it inherits `u_amtJitter = 1.0` from the last live frame, it encodes plates as **JPEG q=0.85**, and it hardcodes `ptPerPx = 72/300`.
2. **R4 — `a_nom` counted from set pixels in the raster**, not requested. If you implement one thing, this. It makes the entire tone chain untrusted-by-construction and cancels any residual bias in it.
3. **`js/ui-controls.js:823`** reads `window._saving`, which does not exist (`_saving` is a `let` in `js/state.js:242`). The stipple LIVE timer therefore keeps firing during export and calls `R._stippleBindFrame(i)`, **rebinding texture units 9–12 mid-export-loop**. One-character fix, campaign-ending blast radius.
4. **Lossless, genuinely 1-bit plates** at 600 dpi with `exportSSAA` disabled; verify the output histogram is bimodal with < 0.1 % intermediate values or refuse to generate.
5. **Determinism self-test**: generate twice, compare SHA-256. Nesting is only physical if `chart_id → byte-identical plates`.
6. **Furniture composited after the shader pass** as pure geometry — ArUco bands per plate, 4-corner verniers, Data Matrix. Put the Data Matrix and the human-readable block on **the first-printed plate of that sheet**, which differs per block (Yellow for C1/F2/G2, Fl. Orange for F1, Bright Red for G1). With 15 stacks in flight across 7 mounts, mis-stacking a pass is the campaign's single largest operational risk, and the Data Matrix is what lets the analysis detect it instead of silently fitting garbage.
7. **Two rulings on every ladder** (default AM + FM/grain), ~32 extra slots. The fit is `plate raster → reflectance` and therefore folds in the screen's own dot gain; without a second ruling the calibration transfers only to the mode it was printed in. This is the cheap first-order screen-transfer term.
8. **Settings lock**, surfaced as a hard gate not a warning (`docs/CHART-DESIGN.md:41`): machine, driver version and settings string, print scale 100 %, master DPI, screening mode + lpi + driver-LUT index, paper name/gsm/batch, ink per drum + drum serial, print order, copies discarded, date. Change any one and the fit is void. **Refuse to generate below 25 lpi in AM mode** — the app's 5 lpi preset would demand 71 mm patches, which is a live trap in the current preset ladder.

---

## 8. Operational rules for the press sessions

- **Print the mount, not the sheet.** A physical pass-tracking board with one card per stack and seven columns. Every stack is either "waiting for ink X" or "done".
- **Warm-up is per mount, not per stack.** Session 0's discard count of scrap paper at the start of each mount, then all plate-runs back to back.
- **Ink density setting identical across every plate-run in the campaign.** Record it. It is part of the void-the-fit set.
- **Slip-sheet the flood sheets (U_x) and the first pass of any solid-heavy stack.** Set-off from a 100-ppm stack landing on wet oil ink is real; RISO's own patent discusses it as a failure mode.
- **Run chart stacks at the slowest speed available.**
- **Capture no earlier than 24 h after the last pass** — and for the cured stacks, that is the point.
- **Seal G1 and G2 in an envelope, labelled, and do not open them** until the Green predictions are hashed and committed.
- **Per-sheet accept/reject before fitting**, from the §4.4 gate battery: all 6 fiducials per plate detected with affine residual RMS < 0.3 mm; Data Matrix decodes and matches; residual flat-field peak-to-peak < 3 %; within-sheet replicate σ ≤ 2.0 ΔE00; cross-sheet MAD < 2.5 ΔE00; ≥ 90 % of overprint patches yielding `area(W) ≥ 0.6 · active`; flood peak-to-peak banding < 12 % (above that the machine needs servicing before calibration means anything). Run the correspondence-free 3-D-histogram cross-check as well — it is what catches a shifted patch grid, which would otherwise produce a confidently wrong correction.

---

## 9. Summary of the one recommended campaign

| | When | Mounts | Hours | Delivers |
|---|---|---|---|---|
| **S0** | now | 2 | 0.5 | `g`, discard count, registration σ — the three numbers the charts depend on |
| **S1** | one full day | 7 | 6 | 7 first-party ladders · 21 pair solids · 20 triples · 5 quads · banding · show-through · τ(15 min) base — **CMYK block alone ships the same evening** |
| **S2** | next morning | 6 | 3.5 | Print-order asymmetry on 15 pairs · τ at 16 h on 2 junctions |
| **S3** | any evening | 0 | 2 | Dual-illuminant fluorescent separation — **zero prints** |
| **S4** | 2–6 weeks later | 7 | 5 | SCOP generalisation to all 47 inks · full spreading curves · τ cured asymptote |
| | | **22** | **~17** | |

The five blocks are `{K,B,R,Y}`, `{B,K,P,O}`, `{Y,R,P,O}`, `{G,K,B,R}`, `{G,Y,P,O}` — the minimum 4-subset cover of all 21 pairs, proven minimal in §0.1. Every forward pass order is a subsequence of `Y→O→P→R→G→B→K`, which is why 52 passes cost 20 mounts instead of 52. Green is printed free in Session 1 and held out as the generalisation test. The entire delay axis rides on mounts that already exist. Nothing is ever reprinted.