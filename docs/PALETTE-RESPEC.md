# PALETTE / PROFILE GAP — analysis and recommendation

**Files read:** `/Users/test/risocam/Risocam1/js/data.js` (RISO_CAL, RISO_COLORS, PROFILES:96–108), `/Users/test/risocam/Risocam1/docs/CHART-DESIGN.md`, `/Users/test/risocam/Risocam1/docs/INK-PHYSICS-PLAN.md`, `/Users/test/risocam/Risocam1/js/ui-controls.js:447–460`, `/Users/test/risocam/Risocam1/js/phone.js:604`, `/Users/test/risocam/Risocam1/selftest.html:100`.

---

## 0. Headline finding

The constraint "what the author can validate" and the constraint "what riso owners can actually print" are **almost the same constraint**, and the current PROFILES array violates both in the same places.

I surveyed 11 riso studios/labs that publish an explicit drum inventory, and scored every shipped profile by how many of them could print it as specified:

| Profile | Author can print? | Studios that could print it (n=11) |
|---|---|---|
| **Mono** | ✅ | **11/11** |
| **Classic** | ✅ | **10/11** |
| **CMYK** | ✅ | **8/11** |
| Forest | ❌ | 2/11 |
| Ocean | ❌ | 2/11 |
| Neon Pop | ❌ | 1/11 |
| Sunset | ❌ | 1/11 |
| Earthy | ❌ | 1/11 |
| Berry | ❌ | **0/11** |
| Night | ❌ | **0/11** |
| Tropical | ❌ | **0/11** |
| Vintage | ❌ | **0/11** |
| Pure CMYK | ❌ | **0/11** (process inks are not riso drums at all) |

The three author-printable profiles are exactly the three community-printable profiles. That is not a coincidence — it is because **the author's seven drums are the modal riso ink set**, and the other ten profiles were built from the long tail of the ink catalogue.

So the recommendation is not "prune the profiles the author can't verify." It is: **the profile list is currently mis-specified for its own users, and fixing that for users simultaneously makes ~all of it measurable.**

---

## 1. Evidence: what riso owners actually stock

### 1.1 The catalogue vs. the reality

RISO's Z-type ink catalogue is **78 named colours** (verified against `mattdesl/riso-colors`, which is derived from stencil.wiki and includes Pantone + S-numbers for every entry). Studios stock **6–35** of them. The catalogue is a menu; the stocked set is heavily concentrated.

### 1.2 Surveyed studios (explicit published inventories)

| Studio | Machine / region | Inks |
|---|---|---|
| Footprint Workers Co-op | RZ1070, Leeds UK | 14 |
| COMD Studio, ECUAD | Vancouver | 18 |
| Moniker Press | Vancouver | 16 |
| Secret Riso Club | 2× MF9450, NYC | 16 |
| Purdue Knowledge Lab | US institutional | 9 |
| Outlet PDX | Portland | 20 |
| Issue Press | MZ790U, US | 27 |
| Riso Geist | US | 16 |
| Studio Rosi | Germany | 10 |
| Inkling Studio | — | 7 |
| Reprographix Print Room | — | 6 |
| *(Risolve 35, Dizzy Ink 21 — counts published, lists not enumerated)* | | |

### 1.3 Stocking frequency, all inks

```
11/11  Fluorescent Pink        4/11  Light Lime, Light Gray, Kelly Green,
11/11  Black                         Flat Gold, Cornflower, Brown, Bright Red
 9/11  Yellow                  3/11  Violet, Mint, Hunter Green, Coral, Burgundy
 7/11  Orange, Blue, Aqua      2/11  White, RisoFederal Blue, Orchid, Mahogany,
 6/11  Green                         Light Teal
 5/11  Teal, Sunflower, Red,   1/11  Turquoise, Sea Foam, Scarlet, Moss, Midnight,
       Purple, Metallic Gold,        Grass, Fluorescent Yellow, Fluorescent Red,
       Medium Blue,                  Crimson, Copper, Bubble Gum, Bright Olive
       Fluorescent Orange      0/11  Fluorescent Green, Cranberry, Brick, Wine,
                                     Bisque, Lagoon, Smoky Teal, Indigo, Mist
```

Collapsing near-synonyms into families (Blue≈Medium Blue; Bright Red≈Red≈Crimson≈Marine Red≈Scarlet; Green≈Kelly Green≈Emerald≈Grass; Teal≈Light Teal≈Turquoise):

| Author's drum | Family frequency | Exact-name frequency |
|---|---|---|
| **Fl. Pink** | **11/11** | 11/11 |
| **Black** | **11/11** | 11/11 |
| **Bright Red** | **11/11** | 4/11 |
| **Blue** | **10/11** | 7/11 |
| **Yellow** | **9/11** | 9/11 |
| **Green** | **9/11** | 6/11 |
| **Fl. Orange** | **5/11** | 5/11 |

**The author owns the six most-stocked inks in the medium, plus the seventh-ranked fluorescent.** This is the strongest single argument for shipping measured default data: a dataset measured on these seven drums covers the drums that essentially every riso owner has.

### 1.4 Which pairs are actually used

Direct evidence is thinner than stock lists (studios publish inventories, not pairing statistics), so I treat *joint stocking* as the best available proxy for "how many people could print this," and use qualitative sources for what's actually reached for.

Qualitative, sourced:
- **Fl. Pink is "hands down our most consistently popular colour"** (Hallagans). Its featured overprint work pairs it with **blue-family inks in 4 of 7 examples** and **yellow in 3 of 7**.
- The standing community recipe for photographic/CMYK work is **Cornflower or Blue → cyan, Fluorescent Pink → magenta, + Yellow (+ Black)**. Multiple institutional guides (SAIC Service Bureau, MICA gradlab, Purdue) state this; artist swatch products are literally sold as "Blue, Yellow and Fluorescent Pink."
- Fluorescents are called out as "especially popular for zine and poster work — cannot be reproduced by standard CMYK."
- ECUAD publishes an **18-ink, 9-pass overlap chart documenting every 2-ink overlap** — evidence that studios treat the full pairwise overprint matrix as the useful artefact, not a curated subset.

Joint stocking, computed (n=11):

```
11/11  Fl.Pink+Black    Fl.Pink+Bright Red   Black+Bright Red
10/11  Blue+Bright Red  Fl.Pink+Blue         Black+Blue
 9/11  Fl.Pink+Yellow   Fl.Pink+Green        Green+Black
       Bright Red+Yellow  Black+Yellow       Green+Bright Red
 8/11  Blue+Yellow  Green+Yellow  Green+Blue  Teal+Fl.Pink
 7/11  Aqua+Fl.Pink
 5/11  every Fl.Orange pair, Purple+Fl.Pink, Metallic Gold+Black
```

Every single pair at ≥8/11 is drawn **exclusively from the author's seven drums**, except `Teal+Fl. Pink`.

---

## 2. Gamut analysis of the owned set

Computed from the shipped `RISO_CAL` LUT 100 % endpoints, paper `#f5f0e8`, plain multiplicative overprint, CIELAB convex-hull volume of the 2ᵏ Neugebauer primaries (÷1000). **Caveat, load-bearing:** this uses precisely the Beer-Lambert model the campaign exists to replace, so it is indicative of *relative* reach, not authoritative — and its failures are themselves informative (see §2.3).

**2-ink (chromatic hull volume / max chroma / L\* span):**

| Pair | Hull | C\*max | L\* span |
|---|---|---|---|
| Blue + Bright Red | **70.1** | 91.7 | 85.1 |
| Bright Red + Green | 33.1 | 91.7 | 80.9 |
| Blue + Fl. Orange | 32.3 | 62.0 | 75.4 |
| Blue + Yellow | 24.1 | 80.7 | 61.7 |
| Green + Fl. Pink | 8.7 | 71.6 | 72.9 |
| Bright Red + Fl. Pink | 2.8 | **99.6** | 40.7 |
| Bright Red + Fl. Orange | 0.4 | **100.9** | 40.5 |
| **Blue + Fl. Pink** | **1.6** ⚠ | 80.6 | 68.8 |
| Black + anything | 0.0–0.4 | — | 93–94 |

**3-ink:** `Blue+Fl.Pink+Yellow` **256.8** > `Blue+Bright Red+Yellow` 218.3 > `Yellow+Green+Fl.Pink` 193.6 > `Blue+Bright Red+Green` 160.5.

**4-ink:** `Blue+Yellow+Bright Red+Fl.Pink` **368.5** > `Black+Blue+Yellow+Fl.Pink` **297.8** > current CMYK `Blue+Bright Red+Yellow+Black` **232.7**.

### 2.1 Consequence: the shipped CMYK profile is the wrong four inks

Substituting Fl. Pink for Bright Red in the magenta slot gives **+28 % gamut volume** (297.8 vs 232.7) at *identical* studio availability (8/11 either way), and matches what the community actually does. A three-ink `Blue+Fl.Pink+Yellow` (256.8) already **beats the shipped four-ink CMYK** (232.7) — one fewer drum swap, one fewer registration pass, more colour.

### 2.2 Black pairs are undervalued by hull volume

`Black+X` scores ~0 chromatic volume because the overprint collapses onto the neutral axis, but delivers L\* span 93–94 — the full tonal range. Black pairs must be ranked on tonality, not chroma. `Fl.Pink+Black` (11/11 joint, L\* span 93.7, C\*max 71.6) is the canonical one-colour-plus-black zine setup and is currently **absent from PROFILES entirely**.

### 2.3 ⚠ The model's own gamut estimate for the most famous riso pair is not credible

`Blue + Fl. Pink` scores **1.6** — a **44× smaller** chromatic gamut than `Blue + Bright Red`, despite Fl. Pink having C\*max 80.6 and the pair being the single most reproduced combination in the medium. `INK-PHYSICS-PLAN.md` already names this: *"Fl. Pink over Blue is exactly the case that comes out wrong."*

The cause is structural, and compounds three defects:
1. Fluorescent emission is additive; Beer-Lambert is purely multiplicative. `fluo:true` exists on the ink record but does nothing in the compositing stage.
2. The Yule-Nielsen stage at `index.html:~2486` is algebraically a no-op (`sqrt(r)·sqrt(i)^d` squared ≡ `r·i^d`), so there is no optical-dot-gain term to absorb any of it.
3. Every overprint is extrapolation — `RISO_CAL[ink].lut` is ink-on-paper only.

**11 of the 21 owned-ink pairs (52 %) contain a fluorescent.** That is the majority of the author's measurable pair space sitting exactly on the model's structural blind spot. It is also the highest-value measurement in the entire campaign.

---

## 3. Data-integrity problems found while doing this

These are not the assigned task but they directly determine which profiles can be trusted, so they belong in the answer.

### 3.1 Bright Red's swatch and its render disagree by 15.5 ΔE00

`RISO_COLORS` declares `Bright Red = #f15060` (correct — matches RISO S-4263 / Pantone 185 U exactly). But `RISO_CAL['Bright Red'].lut[4]` = `[0.978, 0.263, 0.086]` = **`#f94315`** — an orange. **ΔE00 = 15.5** between the UI swatch chip and the rendered 100 % solid, on the author's most-used ink, present in `Classic` and `CMYK`. The LUT p100 also breaks monotone hue continuity with its own p70 (`#f67764`). Fix before the campaign, or the chart will "measure" a discrepancy that is a data-entry error.

Every other owned ink is self-consistent (ΔE00(hex, lut₁₀₀) ≤ 0.2, except Black at 4.3 which is the deliberate Spectrolite substitution documented in the file).

### 3.2 The app's "Blue" is RISO **Medium Blue**, not RISO **Blue**

| | app hex | RISO official | ΔE00 |
|---|---|---|---|
| Blue | `#215cbc` | `#0078bf` (S-4257, PMS 3005 U) | **11.5** |
| Blue | `#215cbc` | `#3255a4` (S-4261, PMS 286 U — *Medium Blue*) | **4.0** |

The surveyed studios treat these as **two distinct stocked inks** (Blue 7/11, Medium Blue 5/11). `Classic` and `CMYK` both hinge on which drum is actually in the machine. **Resolve this from the drum's S-number before printing a single chart** — it is the difference between a cyan-leaning process blue and a navy-leaning spot blue, and it changes the CMYK profile's entire behaviour.

### 3.3 "Green" is 17.3 ΔE00 from RISO Green

App `#2f7744` (forest) vs RISO Green S-4259 `#00a95c` / PMS 354 U (emerald). Some of that is legitimate — a scanned uncoated riso solid *is* duller than a Pantone chip — but 17.3 ΔE00 with a hue shift suggests the txtbooks swatch may be Hunter Green or Spruce mislabelled. The author owns this drum: **one print settles it.** Make it a T1 headline check.

### 3.4 Other owned-ink hex deltas vs the RISO catalogue

`Fl. Orange` 8.2, `Fl. Pink` 6.7, `Black` 5.5, `Yellow` 2.9, `Bright Red` 0.0.

### 3.5 Inks in the app that essentially nobody stocks — and stocked inks the app lacks

Shipping but 0/11 stocked: **Fl. Green** (real ink, S-7763/PMS 802 U — just almost never bought), **Cranberry**, **Brick**, **Wine**, **Burgundy** (app hex `#622233`/`#9b1e3a` are both wrong — RISO Wine *and* Burgundy are the same PMS 235 U `#914e72`), **Bisque** (app `#f4d6b8` tan; RISO Bisque is PMS 503 U `#f2cdcf`, pink), **Lagoon** (app `#79d2c8` light aqua; RISO Lagoon is PMS 323 U `#2f6165`, dark slate teal — completely different colour), **Mist**, **Smoky Teal**, **Indigo**.

Not shipping but 4–5/11 stocked: **Light Gray** (S-4291) and **Gray** (S-4693). These are absent from both `RISO_COLORS` and `RISO_CAL`. Light Gray is a workhorse in duotone zine work and should be added.

Note also that 5 of the 10 zero-stock inks above are on the "synthetic first-four-knots" list flagged in the project brief. The overlap is not accidental: they were added from a vendor list, never printed by anyone in the survey, and their LUTs were interpolated. **They are the safest things in the file to demote.**

---

## 4. Recommendation

### 4.1 Decision

1. **Re-spec, don't just prune.** Every profile whose inks are stocked by ≤2/11 studios gets its ink list replaced with the nearest equivalent drawn from high-frequency inks, keeping the name where the name still describes the result. This *simultaneously* fixes the user problem and moves 13 → 18 profiles into the measurable/near-measurable band.
2. **Add the missing canon.** `Fl. Pink + Blue`, `Fl. Pink + Black`, `Black + Blue`, and `Blue + Fl. Pink + Yellow` are among the most-printed setups in riso and none of them ship today.
3. **Yes, mark validation status in the UI** — but as a quiet three-state badge, not a warning. RISO/CAM is both an art toy and a prepress predictor; a scary banner in camera mode is wrong, and no disclosure at all in the separations/export path is dishonest.
4. **Add a second, orthogonal signal: stock likelihood.** "Can I print this?" and "is the colour right?" are different questions and users need both. A profile can be measurement-backed and still be one almost nobody can print (`Fl. Orange` pairs), or widely printable and extrapolated (`Teal + Fl. Pink`).
5. **Demote `Pure CMYK`.** Process Cyan/Magenta/Yellow/Black are not riso drums; they exist in the file as an accuracy-testing fixture with explicitly synthetic LUTs. It should not sit in the user-facing profile list alongside printable presets. Move it behind the existing debug affordance, or gate it on a `diag:true` flag.

### 4.2 Validation taxonomy

| Tag | Meaning | Expected held-out accuracy |
|---|---|---|
| `M` — **Measured** | Every ink and every pairwise overprint in this profile is in the author's measured dataset (7 drums, T2 scanner path) | **2.5–4 ΔE00** (CHART-DESIGN §2.2, scanner, T2) |
| `X` — **Extrapolated** | Ink solids from third-party swatch scans; overprints *predicted* by the SCOP `X = j·(X_bg·X_fg)^k` model fitted on the measured set | **4–6 ΔE00**, higher for fluorescents and opaques |
| `U` — **Unverified** | The single-ink LUT itself is synthetic/interpolated, or the ink is stocked by ≤2/11 studios and has never been printed by anyone who fed data back | **unbounded; assume 8–15 ΔE00** |

Note SCOP's own ceiling is ~1.8–2.2 ΔE00 *on litho offset with a spectrophotometer*; CHART-DESIGN already discounts that to ~3–4 on riso. The `X` band above is that plus the third-party-solid uncertainty. Do not publish a tighter number than this.

### 4.3 The revised `PROFILES` array

Ordering rule: measurement-backed first, then descending studio availability, then extrapolated. `stock` = joint availability out of the 11 surveyed studios.

```js
// PROFILES — reordered 2026-07 against a survey of 11 published studio ink
// inventories (see docs/PALETTE-SURVEY.md). `val` = validation tier:
//   'M' measured  — every ink + every pairwise overprint in the 7-drum campaign set
//   'X' extrapolated — ink solid from third-party scans, overprint predicted (SCOP)
//   'U' unverified — synthetic single-ink LUT and/or ≤2/11 studios stock it
// `stock` = how many of the 11 surveyed studios could print this profile as specified.
const PROFILES=[
  // ── measured: the 7-drum set (Black, Blue, Yellow, Bright Red, Green, Fl. Pink, Fl. Orange)
  {name:"Classic",   colors:["Blue","Bright Red"],                     val:'M', stock:10},
  {name:"Pink Blue", colors:["Fl. Pink","Blue"],                       val:'M', stock:10},
  {name:"Punch",     colors:["Fl. Pink","Black"],                      val:'M', stock:11},
  {name:"Mono",      colors:["Black"],                                 val:'M', stock:11},
  {name:"Ink & Blue",colors:["Black","Blue"],                          val:'M', stock:10},
  {name:"Riso CMY",  colors:["Blue","Fl. Pink","Yellow"],              val:'M', stock:8,  dens:[88,82,70]},
  {name:"Riso CMYK", colors:["Blue","Fl. Pink","Yellow","Black"],      val:'M', stock:8,  dens:[88,82,70,75]},
  {name:"CMYK",      colors:["Blue","Bright Red","Yellow","Black"],    val:'M', stock:8,  dens:[88,85,70,75]},
  {name:"Meadow",    colors:["Green","Fl. Pink"],                      val:'M', stock:9},
  {name:"Forest",    colors:["Green","Yellow","Black"],                val:'M', stock:8},
  {name:"Warm",      colors:["Bright Red","Yellow"],                   val:'M', stock:9},
  {name:"Neon Pop",  colors:["Fl. Pink","Fl. Orange"],                 val:'M', stock:5},
  {name:"Sunset",    colors:["Fl. Orange","Bright Red","Yellow"],      val:'M', stock:5},
  {name:"Tropical",  colors:["Fl. Orange","Green","Yellow"],           val:'M', stock:5},
  // ── extrapolated: inks widely stocked but not owned; overprints predicted
  {name:"Ocean",     colors:["Teal","Fl. Pink"],                       val:'X', stock:8},
  {name:"Lagoon",    colors:["Aqua","Fl. Pink"],                       val:'X', stock:7},
  {name:"Citrus",    colors:["Aqua","Orange"],                         val:'X', stock:6},
  {name:"Berry",     colors:["Purple","Fl. Pink"],                     val:'X', stock:5},
  {name:"Gilt",      colors:["Metallic Gold","Black"],                 val:'X', stock:5},
  {name:"Vintage",   colors:["Light Gray","Black","Bright Red"],       val:'X', stock:5},
  // ── unverified: kept for expressive range, honestly labelled
  {name:"Earthy",    colors:["Brown","Flat Gold","Hunter Green"],      val:'U', stock:1},
];
// Diagnostic only — process inks are not riso drums. Not shown in the picker.
const PROFILES_DIAG=[
  {name:"Pure CMYK", colors:["Process Cyan","Process Magenta","Process Yellow","Process Black"],
   dens:[88,85,70,75], diag:true},
];
```

**Net change: 13 → 21 user-facing profiles; median studio availability 1/11 → 8/11; author-printable 3/13 (23 %) → 14/21 (67 %).**

Profiles removed or re-specified, and why:

| Old | Old stock | Action | New |
|---|---|---|---|
| Neon Pop `Fl.Pink+Fl.Yellow` | 1/11 | re-spec (Fl. Yellow 1/11; Hallagans notes only Fl. Pink + Fl. Orange are available in the US) | `Fl.Pink+Fl.Orange`, 5/11, **measurable** |
| Night `Federal Blue+Violet+Fl.Green` | 0/11 | **delete** — Fl. Green stocked by 0/11 and its LUT is synthetic | — |
| Vintage `Brick+Flat Gold+Federal Blue` | 0/11 | re-spec — Brick 0/11 | `Light Gray+Black+Bright Red`, 5/11 |
| Tropical `Fl.Orange+Turquoise+Yellow` | 0/11 | re-spec — Turquoise 1/11 | `Fl.Orange+Green+Yellow`, 5/11, **measurable** |
| Berry `Purple+Cranberry` | 0/11 | re-spec — Cranberry 0/11 | `Purple+Fl.Pink`, 5/11 |
| Ocean `Teal+Cornflower` | 2/11 | re-spec — Cornflower 4/11 | `Teal+Fl.Pink`, 8/11 |
| Sunset `Orange+Scarlet+Yellow` | 1/11 | re-spec — Scarlet 1/11 | `Fl.Orange+Bright Red+Yellow`, 5/11, **measurable** |
| Forest `Hunter Green+Brown+Yellow` | 2/11 | re-spec | `Green+Yellow+Black`, 8/11, **measurable** |
| Earthy | 1/11 | **keep as-is, tag `U`** — the earth-tone register genuinely lives in the long tail; there is no high-frequency substitute. Honest labelling is the right answer here, not deletion. | — |
| Pure CMYK | 0/11 | move to `PROFILES_DIAG` | — |

Prerequisite: add `Light Gray` (`#88898a`, S-4291) to `RISO_COLORS` and `RISO_CAL` before shipping the revised `Vintage`.

### 4.4 UI treatment — concrete

`js/ui-controls.js:449` `renderProfiles()` builds each pill. Minimal diff:

```js
const VAL_META={
  M:{dot:'#4caf50', label:'Measured',     tip:'Ink and overprint colour measured on a calibrated riso. Held-out accuracy 2.5–4 ΔE00.'},
  X:{dot:'#e0a030', label:'Extrapolated', tip:'Ink colour from third-party swatch scans; overprints predicted, not measured. Expect 4–6 ΔE00.'},
  U:{dot:'#808080', label:'Unverified',   tip:'Single-ink data is interpolated and has never been checked against a print. Treat as indicative only.'}
};
// inside the .map():
const v=VAL_META[p.val]||VAL_META.U;
const badge=`<span class="profile-val" data-val="${p.val||'U'}" title="${v.label} — ${v.tip}"
              style="background:${v.dot}"></span>`;
const stock=p.stock!=null
  ? `<span class="profile-stock" title="${p.stock} of 11 surveyed riso studios stock all of these inks">${p.stock}/11</span>`
  : '';
```

…appended inside the existing `.profile-pill` template alongside `${del}`. A 6 px dot plus a `n/11` micro-label. No layout change, no modal.

Escalation rules:
- **Camera / live mode:** dot only. No text, no interruption.
- **Separations / export path** (`js/save.js`, seps branch): if `profile.val !== 'M'`, stamp one line into the exported sidecar/README and show a single-line non-blocking notice: *"Colour prediction for this profile is extrapolated (est. 4–6 ΔE00). Overprint colour has not been verified against a print."* This is the prepress-credibility surface; it is where the claim actually matters.
- **Legend:** one line under the PROFILES section header, `● measured  ● extrapolated  ● unverified`, linking to a short doc.

### 4.5 Two things that will break

1. **`selftest.html:100`** does `R.PROFILES.find(p => /cmyk/i.test(p.name))`. With `Riso CMYK` added, `find` returns whichever `/cmyk/i` match comes first in the array. In the array above `Riso CMYK` precedes `CMYK`, so the selftest would silently start testing a different profile. **Either** move `CMYK` above `Riso CMYK`, **or** tighten the selftest to `p.name === 'CMYK'`. Prefer the latter.
2. **`js/phone.js:604`** does `R.applyProf(PROFILES[0])` as the mobile default. `Classic` stays at index 0 — deliberate, no change needed, but do not reorder past it without checking this line. Custom profiles are safe: `js/ui-controls.js:456` recomputes `i - PROFILES.length` at render time, so changing `PROFILES.length` does not corrupt stored custom profiles.

---

## 5. The measurement campaign, re-scoped

### 5.1 The economics are far better than the brief assumes

`CHART-DESIGN.md` is written per ink-set (`k` drums per job) and prices T2 at 2–3 A4 sheets × 3 print runs, per ink set. Naively that reads as 21 separate campaigns for 21 pairs.

**It isn't.** ECUAD's published overlap chart is the proof: **18 inks, 9 passes** on a two-drum machine, producing *every* 2-ink overlap — because each ink is laid down exactly once, and the layout arranges regions so that every pair of plates overlaps somewhere on the sheet.

Applied to seven drums on a single-drum machine:

> **7 drums → 7 passes → one sheet carrying all 7 single-ink ladders + all 7 solids + all 21 solid overprints + all 21 pairwise superposition surfaces.**

That is one drum-mount per drum for the whole campaign, not 21 mount/unmount cycles. Given the hard constraint that a drum swap is manual and takes minutes, this is the difference between a weekend and a month.

### 5.2 Sheet budget (T2-equivalent, seven inks, A3)

| Group | Patches |
|---|---|
| 7 single-ink ladders × 18 levels (T2, minus 0/100 shared) | 126 |
| 7 solids + 21 pairwise solid overprints | 28 |
| 21 pairs × 5×5 interior coverage surface (minus shared edges) | ~336 |
| Superposition anchors, ink `i` at {25,50,75} over each of 6 backings, both directions | ~252 |
| Paper-white lattice + mid-tone controls + flare probes (per sheet) | 20/sheet |
| **Unique** | **~742** |
| ×2 replicates (CHART-DESIGN §Q7 floor) | **~1484 slots** |

A3 safe area 277 × 400 mm at 16 mm pitch = 17 × 25 = **425 slots/sheet** → **4 A3 sheets**, each requiring 7 passes = **28 passes for run A**. Run B (reversed drum order, for trapping τ) doubles it to 56. Run C (24 h inter-pass delay, wet vs dry) is a third pass set over the same 4 sheets. Copies: 20/run, keep 11–15 per CHART-DESIGN §2.2.

That is a real but entirely tractable campaign — and it yields **the complete 21-pair overprint matrix for the seven most-stocked inks in the medium.**

### 5.3 Measurement priority order

If the campaign has to be staged, order the sheets so partial data is still shippable. Ranked by (studio joint availability) × (model-failure risk):

1. **`Fl. Pink + Blue`** — 10/11 joint, the most reproduced pair in riso, and the model's own gamut estimate for it is 44× too small. Highest value in the entire project.
2. **`Fl. Pink + Black`** / **`Fl. Pink + Bright Red`** — 11/11 joint, fluorescent-over-opaque, order-asymmetric.
3. **`Fl. Pink + Yellow`**, **`Blue + Yellow`** — the Riso CMY substitute; unlocks the highest-gamut 3-ink profile.
4. **`Blue + Bright Red`** — the shipped default; must be right.
5. **`Green + Fl. Pink`**, **`Green + Bright Red`**, **`Green + Black`** — 9/11 each, and the Green solid itself is under suspicion (§3.3).
6. All six `Fl. Orange` pairs — lower availability (5/11), but free once the drum is mounted.

Also: capture the T3 fluorescent block (five tints of each fluorescent under *and* over each non-fluorescent solid, both orders, plus a 395–405 nm UV capture) **for Fl. Pink and Fl. Orange only**. CHART-DESIGN §2.6 is explicit that without a second illuminant the fluorescent and reflective components are mathematically unidentifiable — one illuminant means no fluorescence model at all. Two fluorescent drums × 5 non-fluorescent backings × 5 tints × 2 orders = 100 patches plus a duplicate UV capture pass. That is cheap relative to what it fixes, and it is the *only* way `Fl. Pink + Blue` ever becomes correct.

### 5.4 What ends up measurement-backed vs extrapolated

**After the campaign — `M`, 14 of 21 profiles, ~2.5–4 ΔE00 held-out (scanner path):**
Classic, Pink Blue, Punch, Mono, Ink & Blue, Riso CMY, Riso CMYK, CMYK, Meadow, Forest, Warm, Neon Pop, Sunset, Tropical.
Covers all 21 pairwise overprints among Black / Blue / Yellow / Bright Red / Green / Fl. Pink / Fl. Orange, all ordered trapping scalars τ, wet-vs-dry delta, banding, show-through, registration distribution, and a fluorescent excitation×emission term for the two fluorescents.

**Remaining `X`, 6 profiles, est. 4–6 ΔE00:**
Ocean, Lagoon, Citrus, Berry, Gilt, Vintage. Their single-ink solids stay third-party (txtbooks/Spectrolite); their overprints are *predicted* by SCOP `X = j·(X_bg·X_fg)^k` with `j`,`k` fitted per channel on the measured 21-pair set. This is exactly the mechanism CHART-DESIGN §2.5 identifies as "predicts unmeasured overprints, incl. inks the user swaps in later" — the seven-drum campaign is what makes it possible to extrapolate to the other 71 catalogue inks *at all*. **Gilt is the weakest**: Metallic Gold is `opaque:true`, and Babaei & Hersch's result (opaque particles hide what is under them; model as juxtaposed colorants, not overprints) means SCOP is the wrong model class for it. Consider tagging Gilt `U` rather than `X` until a metallic is actually measured.

**Remaining `U`, 1 profile:** Earthy. Hunter Green / Brown / Flat Gold, 1/11 joint, no path to verification without buying drums.

### 5.5 The honest public claim

> "Colour prediction for the seven most common riso inks — Black, Blue, Yellow, Bright Red, Green, Fluorescent Pink, Fluorescent Orange — and all 21 of their two-ink overprints is measured on a calibrated Risograph and scanner: **held-out mean 2.5–4 ΔE00**. Other inks use published swatch data with model-predicted overprints: **est. 4–6 ΔE00**. Every profile in the picker is labelled with which of the two it is."

Per CHART-DESIGN §4.5, publish it as mean / median / 95th percentile / max plus a separate row for L\* < 25, never as a bare mean. Never claim absolute ΔE from a phone shot of a bare chart; the numbers above are the **scanner** path.

---

## 6. Build checklist

1. Fix `RISO_CAL['Bright Red'].lut[4]` — currently `#f94315`, 15.5 ΔE00 from the declared swatch (`/Users/test/risocam/Risocam1/js/data.js:32`). **Blocker: do before printing charts.**
2. Determine the blue drum's S-number (S-4257 Blue vs S-4261 Medium Blue) and rename/re-hex accordingly. **Blocker.**
3. Add `Light Gray` (`#88898a`, S-4291) to `RISO_COLORS` + `RISO_CAL`.
4. Replace the `PROFILES` array per §4.3; add `PROFILES_DIAG` for Pure CMYK; export both from `R`.
5. Tighten `selftest.html:100` to `p.name === 'CMYK'`.
6. Add `VAL_META` + badge markup to `renderProfiles()` (`js/ui-controls.js:449`); mirror in `js/phone.js:386` (same function, `phProfileGrid` target — no second implementation needed).
7. Add the `val !== 'M'` notice to the separations/export path in `js/save.js`.
8. Write `docs/PALETTE-SURVEY.md` with the 11-studio table so the `stock` numbers are auditable and re-runnable.
9. Generate the 7-drum / 7-pass / 4×A3 chart per CHART-DESIGN §2.5 + §3, with the measurement priority order of §5.3 driving sheet ordering.
10. After the campaign: flip `val` from `X` to `M` only for profiles whose *every* pairwise overprint is in the measured set — not for profiles that merely contain a measured ink.

---

**Sources:** [Purdue Knowledge Lab](https://guides.lib.purdue.edu/c.php?g=1478280&p=11039634) · [Moniker Press](https://www.monikerpress.ca/colours/) · [Issue Press](https://issue.press/printing/colors) · [Outlet PDX](https://www.outletpdx.com/inks) · [COMD Studio / ECUAD](https://palette.ecuad.ca/comdtech/risograph/colour-reference-charts/) · [Reprographix](https://reprographix.ink/risograph-printing/colors/) · [Studio Rosi](https://studiorosi.de/en/products/riso-colors) · [Riso Geist](https://risogeist.com/Print-With-Us) · [Secret Riso Club](https://secretrisoclub.com/Riso-Basics) · [Hallagans — Fluorescent Pink profile](https://www.hallagans.com/blog/riso-color-profile-fluorescent-pink) · [Dizzy Ink](https://www.dizzyink.co.uk/guide-to-risograph) · [Ink Chameleon — Riso Ink Explained](https://www.inkchameleon.com/riso-ink-explained-colors-types-differences-html) · [mattdesl/riso-colors (78 Z-type SKUs, from stencil.wiki)](https://github.com/mattdesl/riso-colors) · [SAIC Service Bureau riso guide](https://sites.saic.edu/servicebureau/wp-content/uploads/sites/20/2024/11/EverythingRiso_2024.pdf) · [MICA gradlab](https://gradlab.mica.edu/RisoPrinting) · [Risolve Studio](https://risolvestudio.com/products/color-wheel)