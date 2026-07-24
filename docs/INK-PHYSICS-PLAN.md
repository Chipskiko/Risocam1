# Ink physics — plan

Goal: move RISO/CAM from "predicts single-ink output well" to "predicts what
comes off *your* drum, on *your* paper, in the order *you* print it".

## Where we are today

Layers composite sequentially in `layerOrder`, and each one runs six stages in
`applyInkLayer` (index.html ~2470):

| Stage | What it does | Grounded in measurement? |
|---|---|---|
| 3 — ink colour | 5-point measured LUT (p10/p30/p50/p70/p100) blended by coverage | **yes** — `RISO_CAL` in js/data.js |
| 4 — Beer-Lambert | `paperYN * inkYN^d` with Yule-Nielsen n=2 | no — analytic |
| 5 — opaque crossfade | semi-opaque inks (metallic/white) replace rather than absorb | partly — `opaque` flags |
| 6 — contamination | flat 2% cross-ink tint | no — a constant |

The measured data (`RISO_CAL[ink].lut`) is **ink on paper only**. The moment a
second ink lands on the first, the result is *extrapolated* by stage 4, never
measured. That is the single biggest fidelity gap, and it is where riso is
least well-behaved: fluorescent pigments (`fluo: true` — 11 of the 28 inks)
have emission and non-Lambertian scatter that Beer-Lambert cannot express, so
Fl. Pink over Blue is exactly the case that comes out wrong.

Also unmodelled: **wet trapping** (the second drum transfers less ink onto an
already-inked area than onto bare paper, so print order changes the result
beyond what sequential compositing implies), **show-through**, and **cockle**.

## Ranked

| # | Work | Impact | Effort | Needs real prints |
|---|---|---|---|---|
| 1 | Overprint calibration | **high** — fixes the worst colour errors | medium | yes |
| 2 | Wet trapping / print-order asymmetry | medium | low* | falls out of #1's data |
| 3 | Show-through | low-medium | low | one constant per stock |
| 4 | Cockle | cosmetic | low | no |

\* once #1's chart exists, #2 is mostly a fit over data you already captured.

---

## Phase 1 — Overprint calibration

### The key decision: calibrate per user, not once for everybody

Shipping a universal overprint dataset is the obvious approach and the wrong
one. Riso output varies substantially by machine age, drum condition, paper
stock and ambient humidity — a table measured on one machine would be
confidently wrong on another. Instead: **RISO/CAM generates a chart, the user
prints it on their own machine, photographs it, and the tool fits a correction
to their setup.** Same infrastructure, better answer, and it turns calibration
into a feature rather than a data-entry project.

### 1a — Two inks (ship this first)

Most riso work is 2-colour, and the 2-ink case is a flat 2D problem.

**Chart.** Coverage grid for inks A and B at {0, 25, 50, 75, 100}% each = 25
patches, plus a control strip: paper white, A and B solids, and a 5-step
neutral ramp for capture correction. ~35 patches, trivially one A4 sheet at
2 cm squares. Generated through the existing separations path so the chart is
screened exactly like real output.

**Capture.** A phone photo under diffuse light is the realistic case; a
flatbed scan is better and should be offered. Correct the capture before
fitting: white-balance on the paper patch, then fit a 3×3 matrix from the
known solids and the neutral ramp. Reject the capture and ask for a retake if
residual error on the control patches exceeds a threshold — a bad photo
silently poisoning the profile is the main failure mode here.

**Fit.** For each patch, compute the model's predicted colour, convert both to
LAB (`rgbToLab` already exists in the shader), and store the residual
ΔLAB on the 5×5 grid. Bilinear interpolation between grid points is
sufficient — the surface is smooth.

**Apply.** After the two layers composite, look up ΔLAB by (coverage_A,
coverage_B) and add it. A 5×5×3 table is 75 floats — a uniform array, no
texture needed. Gate behind `u_useOverprintCal` so uncalibrated users are
bit-identical to today.

**Storage.** Same shape as the existing custom-profile localStorage, keyed by
ink pair + paper + a user-named machine. Exportable as JSON so a print shop
can hand a profile to its customers.

### 1b — Three and four inks

The correct generalisation is a device characterisation: coverage-tuple →
colour, i.e. what an ICC profile is. At 5 steps per ink that is 125 patches
for 3 inks and 625 for 4 — and 625 patches at 1.4 cm still fits on a single
A3 sheet, so even the full 4-ink case is one print.

Storage: pack the 4D table into a 2D atlas (a 25×25 texture where one axis
indexes (cA,cB) and the other (cC,cD)) and do the quadrilinear blend by hand.
625 RGB entries is negligible memory; the work is in the interpolation code
and the chart/registration handling, not the data.

Interim fallback: apply pairwise 1a corrections sequentially. It is an
approximation — it ignores genuine three-way interaction — but it is strictly
better than no correction, and it lets 3–4 ink jobs benefit before 1b lands.

### Risks

- **Registration.** The chart must be found and de-skewed in the photo. Print
  fiducials at the corners and detect them; do not rely on the user framing
  well.
- **Capture accuracy is the ceiling.** ΔE from a phone camera under mixed
  lighting can rival the error being corrected. The control-patch check is
  what keeps this honest; be willing to tell the user their photo is not good
  enough.
- **Scope discipline.** This can absorb unlimited effort. 1a with a clear
  accept/reject gate is a shippable unit — resist bundling 1b into it.

---

## Phase 2 — Wet trapping and print order

Riso ink is oil-based and dries by absorption, not evaporation, so on a
multi-pass job the second drum meets a surface that is still wet. Less ink
transfers there than onto bare paper. This makes A-then-B genuinely different
from B-then-A, which matters because `layerOrder` is user-controlled and
already drag-reorderable in the UI.

The overprint chart from Phase 1 already contains this: trapping is derivable
from the solid-overprint patch against the two solids (the Preucil relation
from litho, `T = (D_op − D_1) / D_2`, transfers directly). Printing the chart
in **both** ink orders doubles the patches and yields the asymmetry directly.

Implementation: a per-pair transfer-efficiency scalar that scales the second
layer's effective coverage `d` when it lands on already-inked area. One
uniform, one multiply in stage 4 — the cost is entirely in the measurement,
which Phase 1 is already paying for. Do this immediately after 1a.

---

## Phase 3 — Show-through and cockle

**Show-through.** At high total coverage, ink is visible from the reverse and
the sheet backscatters less, slightly darkening the front. Model as a
reduction in effective paper reflectance driven by total coverage across all
plates, folded into the existing `applyPaperPBR` path (index.html ~3280,
which already receives `inkCoverage`). One constant per paper weight; measure
from a single coverage ramp printed on each stock, or just expose it as a
slider and let people match by eye.

**Cockle.** Paper waves at high coverage. Purely cosmetic — a low-frequency
displacement in the paper PBR normal driven by local total coverage. No data
needed, cheap, and it is the kind of detail that reads as authentic. Good
candidate for a quiet afternoon rather than a planned phase.

Both should be gated so clean/separation output stays untouched — separations
already force paper texture off (js/save.js, seps path), and these must
respect that.

---

## Validation

Non-negotiable, given this changes colour everywhere:

1. **Held-out patches.** Fit on a subset, measure ΔE2000 on the rest. Target
   mean < 3 (roughly "a careful observer notices under comparison"), max < 6.
   Report it in the UI after calibration so the user knows what they got.
2. **Golden images.** The harness already planned for the WebGPU work covers
   this too: fixed seeds, reference renders, perceptual diff. Every phase here
   must leave uncalibrated output bit-identical, and that is exactly what a
   golden-image test proves cheaply.
3. **Uncalibrated path untouched.** Every feature gated behind its own uniform,
   defaulting off.

## Suggested order

1a (2-ink chart + fit + apply) → 2 (trapping, same data) → 3 (show-through and
cockle, cheap wins) → 1b (full N-ink device LUT, once 1a has proven the
capture pipeline works in real users' hands).
