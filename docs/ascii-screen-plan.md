# ASCII Screen v6 — Plan: Stochastic Letter Stamping (rev 2, post-review)

Status: proposed · Supersedes v1–v5 grid iterations · Adversarially reviewed
(math/GPU critic: "flawed" → fixes folded in; product critic: "sound-with-fixes"
→ fixes folded in). Sections marked ◆ changed in rev 2.

## 1. Diagnosis — why the grid keeps failing

| Version | Approach | Failure |
|---|---|---|
| v1–v2 | random glyph per grid cell + inverse video | letter soup; "weird inverted blocks" |
| v3 | FS-flavoured size/sparsity, random | slip jitter tore glyphs; plates correlated |
| v4 | fully deterministic ramp + dither blocks → holes | identical-letter fields; plate-interference mush; "just dots" |
| v5 | bounded jitter, bigger letters, later holes | grid still rigid, darks still noisy and dotted |

Root cause: a fixed AM grid of glyph cells is textmode. Every request — letters
that *move*, *clump*, *vary in size*, *stay letters in shadows*, *re-roll per
frame* — describes **stochastic stamping**: letters as ink stamps whose density,
size and overlap follow tone (FM screening with letterform dots; lineage:
Ostromoukhov–Hersch artistic screening).

## 2. Architecture

### 2.1 Placement — texture-bombed stamps ◆
- Anchor lattice at the ASCII pitch (rotated per the SHARED screen angle, §3.4),
  K candidate stamps per anchor; fragment evaluates the 3×3 anchor
  neighbourhood, compositing stamp alphas with `max()` (Boolean union).
- **Position jitter: exactly ±0.5 cell.** (Review: ±0.6 makes the stamp-centre
  density NON-stationary — a 4× lattice-periodic modulation, i.e. a worse grid
  artifact than the grid. Halfwidth 0.5 tiles the plane with multiplicity 1 →
  stationary, and stamps still cross cell borders.)
- **Reach invariant** (review: oversized stamps were reachable from outside the
  3×3 ring → letters truncating along invisible grid lines, popping each
  re-roll): `0.5 + 0.5·s_max·jsize_max·(cosθ+sinθ) ≤ 1.5` ⇒ with ±8° rotation
  and ±15% size jitter, **s_max = 1.5 cells**. Dark-regime coverage therefore
  comes from **K = 3 candidates**, not bigger stamps (§2.2).
- **Clumping is an explicit process, not a hope** ◆ (review: independent
  uniform jitter is the textbook recipe for EVEN spacing — it never clumps):
  presence is modulated by a low-frequency clump field,
  `presence *= 0.4 + 1.2 · valueNoise(uv · clumpFreq)` (Neyman–Scott-style
  clustering). Real clusters and gaps appear even at constant tone; the
  measured LUT (§2.2) renormalises the mean so tone is unchanged.

### 2.2 Tone — measured, with the analytic model demoted ◆
- The Boolean exponential law `E=1−exp(−λa)` is only an **initial guess**
  (review: the real process is binomial-on-a-lattice, which over-inks vs the
  law by ~6–7 pts in mid-darks, and the inversion has a hard ceiling ≈0.8).
- **Authoritative tone = build-time Monte-Carlo**: the atlas builder simulates
  the actual stamp process (lattice, jitter, K, clump field, per-glyph measured
  ink, size/rotation jitter) over hash space, and bakes corrective curves into
  the existing atlas LUT strip — **presence(v) in .g, size(v) in .b, floor
  residual in .r** (the strip is already RGBA; today only .r is used).
- Explicit p/s split: presence carries v ≲ 0.3, size carries 0.3–0.8, both
  saturate above (then K=3 union + floor).
- **Solid floor = measured residual**, not a hand-picked smoothstep ◆:
  `f(v) = clamp((v − E_letters(v)) / (1 − E_letters(v)), 0, 1)` — by
  construction no double-counting (review caught `E[max(B,f)] = E+ (1−E)f`
  over-inking +4 pts at v=0.9). Letters must carry tone to **≈0.93** before the
  floor engages (K=3 at s≈1.5 reaches ~0.95 union); floor ramps 0.93 → solid at
  ~0.995. Honest copy: letter texture necessarily attenuates above ~0.95.
- Glyph choice is **free across the whole charset** ◆ (review: tone-binned
  choice is vestigial once presence×size carry tone, and it's what kept
  producing "all As"); per-glyph ink variance is absorbed by the Monte-Carlo
  LUT. Per-stamp size spread: lognormal, visible ±30–40% at constant tone,
  mean compensated in the LUT.

### 2.3 Sampling & compositing ◆ (review: original cost estimate missed 20×)
- Coverage sampled **once per ANCHOR** (shared by its K candidates), giving 9
  coverage chains per fragment — not per stamp, not per supersample tap.
- All hash bundles (positions, glyphs, sizes, rotations) computed **once per
  fragment**; the 2 supersample taps only re-test glyph-alpha membership.
- The per-fragment print-physics multipliers are computed once and applied to
  all anchors; the src "smear" second fetch is dropped for stamps.
- `printMaskCell` / `applyTextRouting` are evaluated **at the stamp centre** as
  presence modulation (review: post-multiplying binary stamp output renders
  grey half-letters along mask edges).
- Budget: ~9 coverage chains + ≤54 atlas taps per plate ≈ **5× the current
  ASCII path** (vs ~1000 fetches in the naive layout). Loops stay ROLLED with
  constant bounds (ES 1.00-safe; manual unrolling is the real compile-time
  hazard on old Adreno/Mali). Lattice indices wrapped before hashing
  (mediump mantissa).

### 2.4 Per-frame life — cadence-aware ◆
- Stamp seed: dedicated `u_stampSeed` updated by JS **on animation ticks**
  (grain-static ticks for stills, video/camera frames for live) — review caught
  that raw `u_frameSeed` (a) freezes for stills regardless of the FPS control
  and (b) reshuffles on every slider drag (the v5 "instability" feel). Seed
  frozen during pointer-down re-renders; N ≥ 256 distinct layouts.
- **Turnover, not strobe** (review: full re-roll at 24 fps is letter-shaped TV
  static): full re-roll at ≤8 fps; at 12/24 fps only a hashed ~30% subset
  re-rolls per tick, survivors optionally drift a fraction of their jitter —
  reads as ink settling, not teleporting.

### 2.5 Noise elimination
- Slip jitter, paper-fibre, perfHole exclusions: keep (v3/v4 fixes).
- **Adaptive supersampling** ◆ (review: fixed 2-tap contradicts the SIZE
  control reintroducing small letters): ≥4 taps below ~14 px cells, 2 above;
  rotation jitter disabled below a glyph-size threshold; ASCII pitch range
  clamped so cap-height never drops below ~8 device px.
- High-density noise is closed by construction: K=3 union + measured floor
  (no AA-mush gap speckle), masks as presence (no grey edge letters).

## 3. Product decisions

1. **SIZE control**: when ASCII is active the LPI button relabels to **SIZE**
   with letterform icon, and ASCII keeps **its own remembered pitch value**
   (review: silently inheriting a 70-LPI dot setting = microscopic letters =
   the v1 complaint re-triggered by switching stamp shape). Range clamped per
   §2.5.
2. **Charset chip in P1, not buried** ◆: visible segmented control when ASCII
   active — `EN / ქართული / EN+ქ / SYM` (Georgian-only included; it was the
   original ask). Persisted; atlas rebuild is instant; tofu-guard already
   exists.
3. **Default plate behaviour: ONE shared lattice** ◆ (review: decorrelated
   rotated per-frame plate fields ARE the "noise" reported since v1): all
   plates stamp the SAME layout at the SAME angle, differentiated only by the
   existing per-plate misregistration — letters overprint on themselves with
   riso colour fringing ("typed page through a risograph"). "Decorrelated
   plates" becomes an opt-in variant toggle.
4. **Edge-aware letters (P4, optional)**: Sobel on the per-anchor coverage
   field; on strong edges bias glyph choice toward directional forms
   (| / — \ I l 7) quantized to 4 directions (Acerola recipe at anchor rate).
5. **SEPS/export parity**: stamping is shader state (seed uniform + atlas);
   the unit-8 bind mirroring in save.js carries over — verify both paths.
6. **Phone**: gate K=1 + 2×2 neighbourhood below a measured cell-px threshold;
   MEASURE on the 6× canvas before shipping (cost claim now structural, §2.3).

## 4. Phases & acceptance

- **P1 — Stamping core**: bombing loop (rolled), per-anchor coverage, hash
  bundles per fragment, ±0.5 jitter, K=3, s_max 1.5, clump field, masks-as-
  presence, u_stampSeed plumbing, shared-lattice default. Remove hole rows
  (atlas rows 10–14 → letter rows), cellSnapUV ASCII gating, letterRow
  row-range constants updated in shader + baker.
- **P2 — Calibration**: Monte-Carlo of the real process → LUT strip .r/.g/.b
  (floor/presence/size). Acceptance: ascii ramp within ±4 luma of the circle
  stamp at LPI-equivalent 10/40/70 on a 33-step wedge; no visible lattice
  periodicity in flat fields (FFT spot-check of a flat-tone render).
- **P3 — Controls**: SIZE relabel + per-mode pitch memory, charset chip,
  turnover cadence, seed-freeze on drag.
- **P4 — Edge-aware bias** (toggle, off by default).

Acceptance for the user's standing complaints: (a) flat fields show varied
letters at varied sizes with visible clusters/gaps; (b) darks remain
letter-textured to ≥0.9 coverage, no dot regime, no inversion; (c) re-roll
visible at animation cadence without strobing at 24 fps; (d) no truncated
letters, no lattice-period pattern, tone within ±4 luma of the dot screen.
