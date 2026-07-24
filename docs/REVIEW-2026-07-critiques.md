# RISO/CAM — Architecture Retrospective

**Lens: software architecture. Ranked by how much each decision actually cost.**

I re-verified the load-bearing claims below directly against the tree rather than taking the archaeology on faith: `js/state.js:242` (`let _saving=false`) vs `js/ui-controls.js:823` (`window._saving`); `js/webgpu-live.js:412` (`window._recordingNow`, assigned nowhere); 120 `gl.uniform*` calls in `js/renderer.js:1144-1458` vs 64 in `js/save.js:976-1105`; `8.267` hardcoded at seven sites (`renderer.js:1336,3374,3393`; `save.js:158,951,1010,1370`); 22 lines pairing `'flat'` with `'stipple'`; `?v=` pins spanning v1→v183 in `index.html`; no `package.json`, no test files anywhere.

---

## The framing that matters

Almost every architectural weakness in this codebase is a *correct optimization for the actual constraint* — one person, "the output is the specification," visual iteration measured in seconds — that was never renegotiated when the constraint changed. The constraint changed twice, at identifiable moments: **2026-03-03** (`d087406`, modularization: the project became something with structure worth protecting) and **2026-05-27** (`ce8ff6b`, the RE harvest: the project acquired numeric ground truth and stopped being an aesthetic argument). The architecture was not revisited at either point. That, not the megashader, is the thesis.

---

## 1. There was never an executable definition of "correct output" — and this cost more than everything else combined

**Verdict: wrong, and knowably wrong from 2026-05-27 at the latest.**

The commit record shows **82 of 211 commits carry an explicit `Verified:` block with real numbers** — patch means, luma deltas, ΔE, strong-pixel counts, frame timings. The author was already doing the measurement work, by hand, on nearly 40% of commits. He simply never wrote it down as a program.

What that cost, concretely:

- **≥11 documented self-inflicted regressions plus 3 explicit `Revert` commits.** The master-DPI constant alone was reversed four times (150 → 600 → 150 → 300/150 → export-time formula).
- **`d5b75b8`** is the canonical case: the previous "upright letters" fix was a 180° rotation, verified against rotation-symmetric glyphs (N/M/W/O) and therefore verified nothing. A golden image with an asymmetric glyph is a 10-line assertion.
- **`65b70c1`**: *"ASCII screen EXPORTS are already broken today"* — discovered by audit, not by a user, an unknown number of weeks after breaking. Nothing in the system could notice.
- **The single largest engineering investment in the project is stranded on this.** `docs/WEBGPU-PLAN.md:99-100` and `js/webgpu-live.js:22` both name a golden-image harness as *the gate* for flipping WebGPU on by default. It was never built. So 625 hand-written lines, 6.3 MB of shipped assets, a deploy-time transpiler, and a proven-working second rendering backend ship to **zero production users**, blocked not by a rendering problem but by a missing test file.

**The alternative, and its cost.** A deterministic render harness: pin `u_frameSeed`, `_stampSeed` and `misreg`; render six modes × {live, PNG export, separations} at a fixed small size; store 18 reference PNGs; diff with a perceptual threshold. The project already proves every prerequisite exists — the fragment shader depends only on `gl_FragCoord` and uniforms (which is exactly why `drawFullscreenTiled` at `renderer.js:845` is bit-identical), and `selftest.html` (179 lines, July) is 80% of this harness, built five months late for a different reason. **Cost: roughly one day in March, plus a 30-second pre-commit run.** Against ~11 regressions, 3 reverts, and a dormant WebGPU port, this is the highest return available anywhere in the project's history.

Nuance worth preserving: building this on **day one** would have been wrong. On 2026-02-26 the author shipped 37 commits and the spec genuinely was "does it look right to me." The trigger point was the arrival of *ground truth* — the moment commit bodies switched from "grain range increased to 3.5×" to "mean ΔE 21.6 → 14.75."

---

## 2. Two hand-maintained code paths write the same GPU state

**Verdict: wrong given what was known, at the moment the second path was written.**

`setRenderUniforms` (`renderer.js:1144-1458`) writes 120 uniforms. `exportSeparations` (`save.js:976-1105`) re-implements it with 64. It has drifted by 17 uniforms.

The concrete damage is not abstract debt — it is the **one export that physically reaches a drum**. `setRenderUniforms` forces `u_amtJitter = 0.0` when `_saving` (`renderer.js:1279`) precisely because per-pixel hash taps dissolve dot edges into speckle at export resolution. `exportSeparations` sets `_saving = true` (`save.js:938`) but never calls `setRenderUniforms`, so `u_amtJitter` stays at whatever the last live frame left on the GPU — `1.0`. The separations PDF is the only output with the stochastic taps enabled.

The same shape recurs three more times:
- Export sizing triplicated (`save.js:152`, `:944`, `:1361`), with the grain-mode 4000px short-side floor present in two of three and silently absent from separations.
- `8.267` — the A3-inch constant that ties LPI to pixel pitch — hardcoded at **seven** sites across three files, with no shared definition. Any change to the screen model must be made seven times consistently or the preview and the export disagree.
- `js/compare.js:44-79` re-implements the print-area math a third time in JS, and `:81+` re-implements `adjustRGB` on the CPU.

Bug family **G (preview/export parity)** is ~9 commits of pure tax on this one decision, and `save.js` is the path that "consistently gets forgotten."

**Alternative:** `setRenderUniforms(dw, dh, scale, opts)` where `opts = {sepMode, sepSlot, isPhone, forceEdgeSoft, forceNoPaper}`, and delete the fork. **Cost when the separations path was first written: under an hour.** Cost today: a day, plus the risk of changing separations output. This is not a hindsight critique — "don't fork a state-writing function, parameterize it" is a rule you apply *before* you know what will break, because the failure mode (silent divergence) is unobservable by construction.

---

## 3. State lives by convention rather than by construction

**Verdict: wrong at the March modularization, which already paid the cost of touching everything.**

Five overlapping stores: `let`s in `state.js`, the `cached{}` slider mirror, **140 distinct `window._*` globals**, 45 sticky GPU uniforms never re-asserted per frame, and 16 texture-unit bindings.

The failure this produces is not messiness, it's *silence*:

- **`_saving` is a `let` at `state.js:242`, so `window._saving` is permanently `undefined`.** `ui-controls.js:823` guards the stipple LIVE playback timer with it. During a separations export the timer keeps firing every ~125 ms, rebinding texture units 9–12 in the middle of the per-plate loop that has just bound `_amtMasterTex[L.ch]` to unit 9 (`save.js:1147-1156`). `webgpu-live.js:412` reads the same flag *correctly* (`typeof _saving !== 'undefined' && _saving`) — both idioms coexist in the same repo. One-line bug, arbitrary blast radius, invisible to every tool.
- **`window._recordingNow` (`webgpu-live.js:412`) is read but never assigned anywhere in the codebase.** The real flag is `isRecording` (`state.js:236`). A dead guard that looks live.
- **`mode` and `window._mode` are two variables.** `setRenderUniforms` reads `mode`; every prepass requeue reads only `window._mode` (`renderer.js:2499`, `:2862`, `:3143`); all of `save.js` reads only `mode`.
- **Domain concepts are string comparisons.** `letters` ≡ `screen` and `stipple` ≡ `flat` at the shader level, so every site meaning "RISO" must spell `mode==='flat' || mode==='stipple'` — 22 such lines. There is no `masterEngine` concept, which is why the two prepasses share one guard (`_amtPrepassRunning`) with *asymmetric* requeue conditions, giving a reachable state where STIPPLE renders RISO masters indefinitely (`renderer.js:2499` vs `:2862`).

Bug families **B (stale state, ~11 commits)** and **F (resource leaks, ~6)** are almost entirely downstream of this.

**Alternative:** at `d087406` — which already moved 7,357 lines — put every cross-module mutable through one object (`R.state.saving`, `R.state.mode`) and every GPU-sticky uniform through one `setUniform(name, v)` helper backed by a `gpuState{}` replayed wholesale by `_recoverGLState`. **Marginal cost on top of a refactor already in flight: perhaps half a day.** It would have eliminated the entire `window._*` idiom, made `_recoverGLState` total rather than best-effort (it currently hand-restores four things and misses eight), and made the `_saving` and `_recordingNow` bugs unrepresentable.

---

## 4. The shader lives inside `index.html`

**Verdict: wrong from day one — but this is *not* the same as "the megashader was wrong." See §7.**

`index.html` is touched by **187 of 211 commits (89%)**. The March modularization moved the UI out and left the shader in, so the file collapsed 4,176 → 1,451 and immediately re-grew to 3,512. Consequences:

- Git blame on markup, CSS hooks, and script tags is destroyed — every diff is shader noise.
- Nothing can lint, preprocess, `#include`, or dead-strip the GLSL without parsing HTML. This is precisely why `_slimFs` (`renderer.js:87-124`) resorts to **regex surgery on shader source at runtime**, with a silent no-op on miss (`:109`) whose failure mode is *the whole-browser freeze the mechanism exists to prevent*.
- The sha1 staleness gate is fragile in a way that has nothing to do with shaders: `tools/build-wgsl.mjs:33` hashes raw file bytes, `webgpu-live.js:229` hashes `element.textContent` — HTML-parser newline-normalized. A CRLF checkout silently and permanently disables the WebGPU path with a console warning.

**Alternative:** `shaders/riso.frag` + `shaders/riso.vert`, inlined at deploy time by a ~10-line script (or fetched at runtime, if not for Neocities' CSP). **Cost: an hour, on day one.** The file was already 1,684 lines at import — the signal was there from commit two.

---

## 5. Cache correctness by hand

**Verdict: wrong after the first missed bump.**

`index.html` hand-carries `?v=N` pins from v1 to v183. At least three bugs trace directly to a forgotten bump (`d70eec4`: fresh inline shader against stale cached JS; `03e7faf`; `7359ca2`: a stale cached *label*). Meanwhile `sw.js:63` uses `caches.match(e.request)` with default `ignoreSearch:false`, so `./js/renderer.js` in `ASSETS` **can never** satisfy `js/renderer.js?v=183` — the precache has never matched anything, across **21 tracked `CACHE` bumps**. Neither `webgpu-live.js` nor `gen/shaders-wgsl.js` is in `ASSETS` at all. And `webgpu-live.js:223` pins `shaders-wgsl.js?v=1` — a literal that has never moved, on the one asset regenerated every deploy.

**Alternative:** content-hash the asset list in the deploy script and rewrite the tags. `deploy-neocities.sh` already exists. **Cost: one hour, once.** Also note `deploy-neocities.sh:12-16` swallows every upload error and returns success — ~2.6 MB of `.wasm` fails on every single deploy to a host that rejects `.wasm`, silently.

---

## 6. Four-fold copy-paste in the shader `main()`

**Verdict: partly forced, mostly wrong.**

`index.html:3047-3254` is four ~52-line blocks differing only in index suffix; `:3358-3411` repeats it for trim marks. GLSL ES 1.0 forbids dynamic sampler indexing, so `u_amtMasterN` and `u_lut*N` genuinely cannot be looped — that constraint is real. But everything else could be hoisted into a function taking per-layer scalars, exactly as `getCoverage`, `printMask` and `getGrainTexture` already do.

The drift is visible and undocumented: vertical smear is hardcoded per layer (`0.0012/0.35`, `0.0008/0.25`, `0.0004/0.15`, layer 3 different again) with no comment explaining the ladder, and the CMYK path low-passes the source per-plate while the SPOT path does not (`:3061-3062` etc.). The identical 7-line comment about letters overhanging content edges appears verbatim four times.

**Alternative:** hoist the ~45 sampler-free lines into `vec3 renderLayer(...)`, keep the 7 lines that must be per-index unrolled. **Cost: half a day, and it would have been half a day *saved* on each of the ~28 FIDELITY commits that had to be applied four times.**

---

## 7. What was *not* wrong — the megashader

**Verdict: unlucky, not wrong. Defend this decision.**

It is the obvious villain — it caused the Windows catastrophe, ~20 commits, two new build tools, and a second rendering backend — and calling it a mistake would be hindsight bias.

What was knowable in February 2026: one developer, browser target, six modes sharing ink/paper/misregistration physics. What it bought: **STIPPLE shipped in two commits by riding the RISO prepass.** What was *not* knowable: that ANGLE→D3D11 FXC would never finish compiling a 157 KB fragment shader on Intel UHD gen-12lp. There is no specified shader-size limit. The same shader links in 64–341 ms on Metal and builds a WebGPU pipeline in 75 ms. The project's own audit (`docs/WEBGPU-PLAN.md:105-107`) found the shader *unusually* portable — zero derivatives, zero `discard`, zero `while`, zero dynamic indexing — and located the real porting mass in the JS: **1,569 `gl.*` call sites**. Splitting the shader into six programs would not have reduced that by one line, and would have multiplied the uniform/LUT/texture-unit/prepass surface by six.

Moreover, the counterfactual *is what the D3D path already does*: `_slimFs` gets per-mode programs for ~50 lines of transformation instead of a ground-up restructuring. The megashader was the right bet; it lost to one legacy compiler, five months late. The genuine mistake nested inside it is §4 (where the source file lives) and §6 (the copy-paste), not the size.

---

## What was done right and must be preserved

1. **Commit messages as engineering reports.** 2,607 body lines; 82 commits with measured `Verified:` blocks. This is the single most valuable artifact in the repository — it is why a five-month archaeology was possible at all. Most teams would kill for this and almost none have it.
2. **Plan-before-implement, with negative results kept in-tree and switched off.** `6aa8e37` measured YNSN at 20.33 vs the sequential model's 8.56 against real renders, wrote up *why* (the shader is not a Neugebauer device), and kept the losing implementation behind `opts.model`. `docs/SEP-LUT-PLAN.md` is a genuine lab notebook. 8 plans, 5 shipped — and the 5 that shipped are exactly the ones with a measurement protocol attached. That is a real selection mechanism, not luck.
3. **Debuggability of machines you do not own, as a first-class feature.** URL kill-switches (`renderer.js:62-73`), crash-surviving localStorage breadcrumbs, `navigator.sendBeacon` streaming, `lan-diag-server.py`, `probe.html`'s function-stubbing bisection. This is what actually solved the Windows problem, and the escalation ladder (`1d06553` → `0c4a502` → `054f947` → `7cf7af0` → `8581ca6` → `dd39bb5`) is textbook: each step justified by data from the previous, never by intuition.
4. **Never letting the experimental backend touch the artifact that reaches a drum.** Exports always run WebGL (`webgpu-live.js:413`, `save.js:130`). Correct default. (It does create the S2 divergence on Windows — preview uses real NNLS, export uses the stubbed LUT — which is exactly the kind of thing §1's harness would have caught.)
5. **One mechanism, two consumers, where it was done.** `drawFullscreenTiled` (`renderer.js:845`) is bit-identical banded rendering shared by the live view and every export path. This is the shape §2 should have had everywhere.
6. **The March modularization itself.** One commit, 7,357 lines, ten modules that still structure the project four months later, with the fallout (`02f2ffb`, cross-module `R.` prefix audit) fixed two commits after. The split lines were chosen correctly; the sin was leaving state and the shader behind.
7. **Deploy-time transpile over runtime transpile.** Measured, not assumed: tint costs 45.9 s of WASM on the target CPU. Moving it to `tools/build-wgsl.mjs` turns the transpile into a free per-deploy validity gate (`deploy-neocities.sh:36` aborts on failure) and preserves GLSL-in-one-place as the single source of truth. This is the best-reasoned decision in the project.

---

## The three-line version

A competent team would change **four** things from day one, and they are cheap: shader in its own file; one uniform-writing function; one state object; content-hashed assets. Total up-front cost, maybe two days. Everything else — the megashader, the globals-heavy prototype, the absence of a build — was a defensible trade for a solo project whose real constraint was iteration speed against a visual spec.

The expensive mistake is not any of those. It is that **a project which measured everything by hand, 82 times, never once made the machine do it** — and that omission is what left the Windows portability campaign, its single largest investment, finished but undeployable.# Retrospective — Colour/Print Science Methodology

*Lens: what a colour scientist would say RISO/CAM should have done differently, given the goal of a simulator that both looks right and predicts real print.*

---

## The one-sentence version

The project built a rigorous measurement culture and then pointed it at the wrong referent: it measured **the driver** (how dots are placed) and **the app** (self-consistency) to three significant figures, while the one thing a print predictor must be right about — **what ink does to paper and to other ink** — was never measured against a physical print, and is still governed by a 2019-era analytic blend whose stated physics is a mathematical no-op.

---

## 1. There was never a ground-truth loop against a real print — and the harness to build one already existed

**Rank: highest. This is the decision everything else follows from.**

The project owns a risograph, printed eight test targets (`test_prints/test_01..08`), captured them (`captures/`), wrote a `.prn` decoder (`docs/validation/decode_prn_reference.py`), built a Windows RE rig, and — at `1ed3dab` (2026-07-09) — built a **24-patch OKLab ΔE harness with held-out evaluation and honest A/B model comparison**. That harness is exactly the right instrument.

It was pointed at the app's own shader. `docs/SEP-LUT-PLAN.md` says so outright: *"the app's own shader is the ground truth here."* The sep-LUT campaign's headline result (mean ΔE 21.6 → 8.95, −59%) measures convergence toward RISO/CAM, not toward a Riso.

The cost of the alternative was small and the pieces were all on hand. Swap the objective's reference vector in `js/sep-lut-worker.js:164-178` from "shader render" to "photographed print patch." Everything else — OKLab, the sRGB EOTF at `:173`, projected coordinate descent, the parsimony prior — stays. **One print run, one photo session, roughly a day of plumbing.**

**Verdict: wrong given what was known.** Not hindsight. By 2026-07-09 the project had already (a) printed and scanned physical targets, (b) built a camera/scanner swatch workflow in 2019/2020, and (c) written the exact evaluation harness. The `SEP-LUT-PLAN.md` A/B is the tell: textbook YNSN wins in-model (3.27 vs 5.03) and loses catastrophically against renders (20.33 vs 8.56). The conclusion drawn — *"the shader composites sequentially… forward/inverse model mismatch"* — is correct and is **a statement about the shader, not about the printer**. A held-out set of real prints would have resolved which of the two models was actually closer to a Riso. It is entirely possible YNSN was winning and got rejected.

### The illustration that makes this concrete

RISO's own patent US 6,011,083 reports measured solid print density **1.21–1.26** (reflectance ≈ 0.055–0.062) for their emulsion ink. Compare:

| | reflectance | density |
|---|---|---|
| 2019 scan of Black (rejected as "charcoal") | 0.28 | 0.55 |
| Spectrolite Black `p100` currently in `js/data.js:16` | 0.030 | 1.52 |
| what `calBlend` actually renders at cov 1.0 | 0.102 | 0.99 |
| **RISO's own measured ink** | **0.055–0.062** | **1.21–1.26** |

(Caveat, and it is part of the point: the patent's number is a densitometric reading, the LUT is scanner sRGB. Nobody in the project ever asked what quantity their numbers were in — that question is downstream of having an external referent at all.)

The rejected 2019 scan was far too light. The replacement overshot far too dark. The render lands between them by accident. **All three numbers are wrong, in different directions, and no one could tell**, because the only external referent in the building — a patent RISO published — was never consulted. A single printed-and-measured solid black would have resolved it in an afternoon.

---

## 2. Fidelity was pursued geometry-first, photometry-never — and stayed that way after measurement arrived

**Rank: 2.**

The effort allocation is stark. Screen dot geometry: ~30 commits, 5 weeks, **7 distinct architectures** (`e066fd9` → `80bf9ff`). ASCII/letters: 6 versions plus 2 perf re-architectures. Windows portability: 20 commits, 2,130 lines. `calBlend` (`index.html:2409-2515`) — the function every pixel of every mode passes through, carrying the entire multi-plate error — has never been rewritten.

The colour-science ranking of error magnitude is the inverse. Per the audit's replication: a 50% Black patch renders 0.685 against a measured 0.498 (**ΔL\* ≈ 18** — visible across a room). With real GRAIN binarisation it's ≈0.735. Dot geometry errors, by contrast, are second-order once the halftone is band-limited: Yang (JIST 2004) shows physical dot gain is a **one-parameter parabolic correction** `Δσ = (a−1)σ₀(1−σ₀)`, and Inoue et al. (JIST 1997) show optical dot gain is a **convolution with a measured exponential PSF**. Neither requires seven architectures. Seven architectures were spent because the artefacts were *visible* and the tone error was *invisible* — there was nothing to compare it to. Which is point 1 again.

**The honest split:**

- **Not wrong (unlucky):** all geometry work before `ce8ff6b` (2026-05-27). With no instrument, "does it look right" is the only oracle, and square dots / star gaps / houndstooth were genuinely wrong and genuinely visible. Fixing what you can see is rational when you have no way to see anything else.
- **Wrong given what was known:** continuing after 2026-05-27. The instant measured per-ink LUTs landed, the pipeline had a *measured* ink-on-paper stage feeding an *unmeasured* ink-on-ink stage. Standard practice at that point is to look at where the error budget is unbounded. The information required existed; the audit was never run.

**Concrete alternative, June 2026:** before `d7b3279`'s corner-hole autoclamp, spend one week replicating `calBlend` in Python against the LUT knots — the exact exercise the colour audit did in an afternoon. It returns "your composite cannot reproduce your own calibration data" immediately. **Cost: one week of the five spent on dot geometry.**

---

## 3. Measuring single inks only was the right budget call made with the wrong chart design

**Rank: 3. This is the question the prompt asks most directly, and the answer is not "you should have measured overprints."**

Measuring all ink-on-ink solids for 28 inks is 378 pairs. Genuinely infeasible; not measuring them was correct. But there are two cheap options that were available and taken by neither:

**(a) Three backings instead of one (Deshpande, Green & Pointer, CIC 2010 / Optics Express 2014).** Print each ink's tint wedge over **white, mid-grey, and solid black** rather than over white alone. Three ladders per ink instead of one. That yields a per-ink **opacity** parameter and the SCOP correction `X = j·(X_bg·X_fg)^k` — which predicts *arbitrary* overprints at ~2.06 ΔE00 on 7-colour offset. The chart cost is **3×, not 378×**. The 2019/2020 swatch-scan workflow already existed; this is one extra afternoon on the same rig.

This would have directly replaced defects #1, #2, #3 and #9 of the colour audit — the Beer–Lambert reflectance product, the paper-counted-n-times error, the fake Yule–Nielsen, and the opaque crossfade tinting bare paper. And SCOP's central empirical finding — that the naive reflectance product **systematically underestimates** overprint reflectance — is precisely the failure `calBlend` exhibits.

**(b) Measure the palette, not the ink set.** 8 of the 13 shipped `PROFILES` (`js/data.js:96-104`) have ≤2 inks; nobody loads 28 drums. For any given profile the relevant overprint set is C(k,2) ≤ 6 patches. A ~20-patch chart per profile was always feasible.

**Verdict: wrong given what was known,** with the caveat that the *reasoning* ("we can't measure 378 pairs") was correct and only the *conclusion* ("so measure none") was wrong. The Deshpande work predates the project by a decade and the exact search terms ("spot colour overprint") sit one query away from work the project was already doing.

`docs/INK-PHYSICS-PLAN.md` (commit 211, the newest in the tree) finally proposes exactly this — user prints a chart, photographs it, ΔLab residual fitted per machine. **The plan is right.** It is five months late, and it should have been the *first* measurement campaign, not the fourth.

---

## 4. Data provenance was never tracked, so synthetic data acquired the authority of measurement

**Rank: 4.**

`js/data.js:48-51` states the nine "additional inks" are *"measured per coverage step… the Spectrolite data is measured response."* Verified against the file: every one is a **linear ramp**, `t = {0.10, 0.30, 0.50, 0.70, 1.00}` to 8-bit rounding in every channel. Lagoon's R channel: `(0.918−1)/(0.184−1) = 0.100`. Zero dot gain, zero hue drift with coverage. `Black` (`js/data.js:16`) is in the same class — the one ink that dominates neutrals is the one with no measured toe.

That matters physically, not just cosmetically. Riso is oil/soy emulsion ink on absorbent uncoated stock; RISO's own patent (US 6,011,083) describes the low-surface-tension oil phase wicking in ahead of the pigment. Viggiano (CIC18 2010) measured best-fit Yule–Nielsen n ≈ **−3.8** on fibre paper with penetrating inks. This is a maximum-dot-gain regime, and the measured 2019 Blue scan shows it (`[0.664,0.760,0.876] → [0.324,0.523,0.792]` between 30% and 50%). Black shows none. The linear Black is precisely the "gray goes blue" pathology `docs/SEP-LUT-PLAN.md` chased for two days — the solver recruits Blue for darkness Black cannot deliver.

**Verdict: wrong given what was known — but the failure is narrower than it looks.** The substitution was made for a defensible reason (the 2019 Black scan capped at D=0.55, which *is* implausible). The error was (i) not labelling the replacement synthetic, and (ii) not noticing that the fix removed the exact physical property the measurement existed to supply.

**Alternative, cost ~30 minutes:** a `provenance:` field per ink — `'scan2019' | 'spectrolite' | 'synthetic'` — plus a one-line startup assertion that any ink claiming measurement has non-zero second difference in its LUT. That single check makes this entire finding impossible.

---

## 5. The working space was never chosen; it was inherited

**Rank: 5.**

The whole chain composites and averages in **gamma-encoded sRGB**. The only linearizations anywhere are `rgbToXyz`'s `pow(c, 2.2)` (`index.html:790`, for the NNLS Lab residual) and `js/sep-lut-worker.js:173`. `docs/SEP-LUT-PLAN.md` states it plainly: *"calBlend never linearizes."*

Two consequences, and the second is the serious one:

- `r·i^d` on sRGB code values is not Beer–Lambert.
- **Every core tone mechanism in the app is an average in a nonlinear space.** `screenSampled`'s 4× rooks (`index.html:1592-1599`), `cellTone`'s box filter (`:1561-1579`), the AMT 8-tap master average (`:2172-2199`), the export supersample. Murray–Davies area mixing is *defined* as a linear average of reflectances. Averaging sRGB systematically biases every halftone tone in the app.

Fix cost: upload source textures as `SRGB8_ALPHA8` on WebGL2 (the sampler linearizes for free) and encode at output — a handful of lines, plus re-tuning the constants that were fitted to absorb the error.

**Verdict: wrong given what was known**, with an honest counterweight. The measured swatch LUTs *are* scanner sRGB, so the system is self-consistent **at the knots** — which is why it works as well as it does, and why nobody noticed. The real failure is that "what space are my measurements in?" and "what space does my model require?" were never separated into two questions.

---

## 6. Code was named after published models without a test distinguishing it from the model's degenerate case

**Rank: 6, but the most generalizable lesson here.**

`index.html:2486-2490`, labelled *"Beer-Lambert with Yule-Nielsen n=2"*:

```glsl
vec3 paperYN = sqrt(max(result, vec3(0.001)));
vec3 inkYN   = sqrt(safeInk);
vec3 transparent = (paperYN * pow(inkYN, vec3(d)))  * (paperYN * pow(inkYN, vec3(d)));
```

`(√r · √i^d)² = r · i^d` **exactly**. The sqrt/square pair cancels. This is n=1, i.e. no Yule–Nielsen at all. The identical dead code sits in `yuBlend` (`:2562-2567`). Yule–Nielsen only does work when reflectances are *combined* in the power domain; the two places that do it correctly — `u_dbgYNArea` (`:2436-2451`) and the worker's `forwardYNSN` — are both off by default.

This is not a hard-physics failure. It is an **arithmetic** failure that survived five months because no test asserted that the YN branch differs from its n=1 degenerate case on a non-uniform field. Three lines.

The literature adds a second layer: n=2 was never defensible for riso anyway. Hébert & Hersch's 2015 review reports fitted optimal n from **1.5 to 10**, rising with screen frequency and paper scattering; Viggiano measured **negative** n for penetrating inks on fibre stock. Riso — coarse screen, heavily scattering absorbent paper, oil-phase wicking — plausibly sits near the Kubelka–Munk limit (n = −1). So two errors partially cancel: a wrong constant, implemented as a no-op.

**Rule to adopt:** when a function is named after a published model, ship the assertion that separates it from the model's trivial case, and cite the paper in the comment with the value of the fitted parameter and where it came from.

---

## 7. The driver reverse-engineering was over-invested relative to ink optics — but half of it was the best work in the project

**Rank: 7. Split verdict; the prompt asks directly, so here is the precise line.**

**Right, and should be preserved:**
- The `.prn` decode + `DRIVER_LUTS[4]` cross-validation: driver LUT at index 32/128/223 = 9/41/118 → 0.0353/0.1608/0.463, against decoded wedge ink-area fractions 0.03526/0.1571/0.467. **This is the only genuine closed-loop verification in the codebase** and it is excellent.
- The screening-mode classification (spectral match-fraction 0.81 vs 0.735 random baseline ⇒ error diffusion, not ordered). A methodologically sound result that *refuted* an intuition. That is what measurement is for.
- `T' = D⁻¹(T)` threshold pre-baking (`js/renderer.js:459-470`) — algebraically exact, free at runtime.

**Wrong in emphasis:** the campaign answered *"how does the driver place dots"* to byte precision, and never asked *"what colour does ink make."* Those are the two halves of a print model. The driver **cannot** answer the second question — the ink optics happen in the paper, not in the DLL. The moment this became visible is recorded in the project's own notes: `riso-screen-engine-plan.md` — *"the 8 .prn captures are ALL Grain-mode error diffusion — no clustered-dot ground truth exists."* The response was to continue on geometry rather than to go print something.

**The sharpest framing: the RE campaign was a substitute for measurement, not a form of it.** It produced *authority* (byte-exact tables) rather than *ground truth* (what the print looks like). And the one part of it that touched colour — the Spectrolite `.gob` decode — delivered the linear ramps of §4, accepted without a curvature check *because* they arrived with the authority of a professional tool.

Two further provenance failures in the same class: `DRIVER_LUTS[2]` and `[3]` are documented as extracted from the driver and **are not in any shipped DLL** (`js/renderer.js:1850-1852`); `riso_halftones.json` stores **5 identical entries per key**, meaning whatever the driver varied across those variants was silently collapsed.

**Alternative:** two Ghidra weeks instead of six — enough for the FS kernel, Tables A/B/C, and the transfer LUTs, which is where the entire payoff landed. Redirect the other four weeks to the SCOP chart in §3. **Cost: neutral. Strictly a reallocation.**

---

## 8. Structural errors that follow from having no measurement referent

**Rank: 8, collectively.** Each of these is a specific pathology that a print/measure loop would have surfaced within one session:

- **RISO mode composites two disagreeing separations into one pixel** (`index.html:2156-2207` + `js/renderer.js:2680-2732`). Ink *colour* comes from the GLSL separation using measured `lut[4]`; ink *density* comes from a CPU axis projection onto the **vendor hex** (`js/state.js:225`). Max-channel divergence: Lagoon **0.444**. Two separations, two tone chains, multiplied. This exists because the master prepass was built as a *performance* optimisation, not as part of the colour model — the projection was never treated as a separation at all.
- **No total-ink limit in spot mode** (`index.html:1981-2026`). Four NNLS weights each clipped to 1 can demand 400% coverage. Riso has a hard physical TAC — paper cockle and set-off, discussed explicitly in RISO's own patent. TAC is a *device constraint enforced once after separation*, not a slider that a "balance" control (defaults all >1, i.e. a hidden ink boost, `js/state.js:51`) fights against.
- **The LUT paper knot is hardcoded** `(0.910, 0.912, 0.908)` (`js/renderer.js:1338`) and never matches the user's paper — not even the default `(0.96, 0.94, 0.91)`. The cal-LUT bake is keyed on ink names only (`_calLutKey`, `:2001-2007`), so **changing paper never rebakes it**. On any of the 9 coloured stocks the ink curves still interpolate from a neutral near-white. Kubelka–Munk (Pauler et al.) says paper scattering *sets* the achievable maximum density — it is not a background colour.
- **Duotone/tritone CMYK separation is blind to ink identity** (`index.html:1118-1128`). A Blue+Bright Red duotone and a Teal+Cornflower duotone produce bit-identical plates. 8 of 13 shipped profiles have ≤2 inks.

---

## What was done right, and must not be lost in the rewrite

A retrospective that is all criticism is miscalibrated, and several things here are better than professional practice:

1. **`docs/SEP-LUT-PLAN.md` is a model lab notebook.** Diagnosis with a named mechanism (*"the JENSEN GAP is real — grain speckle composites as ~AREA MIXING, NOT Beer-Lambert of the mean"*), fitted parameters with RMSE, a cross-check (predicted `(136,146,157)` vs measured `(137,146,157)`), a theory-grounding section added *after the fact* when the textbook arrived, and a **documented negative result with the losing code retained behind a flag**. Keep this format for the ink-physics campaign verbatim.
2. **`js/sep-lut-worker.js` is the correct model — it just isn't the one that runs.** True Murray–Davies area mixing with the opaque crossfade confined *inside* the dot (`:149-157`, the fix `calBlend` lacks); a correct Demichel/YNSN alternative (`:90-114`); an OKLab objective with a true sRGB EOTF (`:173`); slot-positional print-order terms treated as physics (`:63-79`); an ink-parsimony prior. **The rewrite of `calBlend` is largely a port of this worker into GLSL.** That is a much smaller job than it looks.
3. **The `.prn` closed-loop verification** and the screening-mode classification (§7).
4. **The Fritsch–Carlson monotone Hermite interpolant** — correct tool, implemented consistently in three places that agree.
5. **The procedural circle screen's area-correct radius `√(cov/π)` plus complementary-hole autoclamp past 0.785**, with documented over-inking measurements behind it. Proper halftone geometry.
6. **39% of commits carry a `Verified:` block with numbers.** And `d5b75b8` — *the previous fix was verified on rotation-symmetric glyphs and therefore verified nothing; re-verified with asymmetric glyphs at 4× zoom* — is a genuinely sophisticated piece of self-auditing that most professional teams never reach.
7. **`INK-PHYSICS-PLAN.md`'s core call is correct and anti-obvious:** *"Shipping a universal overprint dataset is the obvious approach and the wrong one."* Per-machine, per-paper, user-printed chart is right — and Rossier, Bugnon & Hersch (CIC18 2010) independently confirm that **RGB-camera calibration suffices** for ink-spreading characterisation. The plan's own scope warning (*"resist bundling 1b into it"*) is also correct.

---

## For the campaign about to start

Since `INK-PHYSICS-PLAN.md` is the newest commit, the most useful thing a retrospective can do is stop it repeating the pattern:

1. **Measure the noise floor first.** Print the same chart twice, photograph both, compute ΔE00 between them. Lee, Bala & Sharma measured page-to-page variation at 1.0–2.5 ΔE76 on a *stable* device; riso will be worse. **Stop engineering the capture below that number.** This is a half-day experiment that sets the accept/reject gate the plan already asks for.
2. **Expect ~3–5 ΔE00 from a phone, and quote the 95th percentile, not the mean.** Ashraf & Sapaico's rig — fixed camera, controlled tungsten, polarised, flat-fielded, dark-frame subtracted, **928 training patches** — reached mean ΔE00 3.07 with **max 17.8** and only 32% of patches under 2. Ship the scanner path as the accuracy option.
3. **Root-polynomial correction, never plain polynomial.** Phone auto-exposure destroys exposure-dependent models: Finlayson et al. measured degree-4 PCC going 1.6 → 7.5 → **57** ΔE as exposure varied, while RPCC held at ~1.8.
4. **Chart design, from the standards:** patch size set by screen ruling not by tidiness (ISO 13655 — riso screens are coarse, so patches must be large); randomised layout *specifically* to equalise ink loading across the sheet (ISO 12642-2's own stated rationale, and riso drum ink-feed makes this worse than offset); nest the quick chart inside the full chart as a strict subset (ECI2002); spend marginal patches on **neutrals** (IT8.7/5 deleted 29 duplicates and spent all 29 on greys); include deliberate repeat patches at several sheet positions purely as a drum-banding estimator.
5. **Three backings, not one** (§3). This is the change that retires most of the colour audit.
6. **Publish the result.** There is no peer-reviewed literature on risograph reproduction and zero published evaluations of any riso simulator's accuracy. A modest calibration study with held-out ΔE00 against real prints would be the first, and the project already has the harness, the printer, and the honesty to report a negative result.

---

## The single sentence to carry forward

**Measurement is not a property of the numbers; it is a property of the referent.** RISO/CAM got the numbers right — byte-exact tables, ΔE to two decimals, held-out sets, documented negative results — and spent five months measuring the distance between itself and itself.# RISO/CAM — Retrospective: Product Strategy & Effort Allocation

*Lens: where effort actually went vs. what serves the dual goal (live artistic camera + print-credible prepress predictor).*

---

## The single sentence

**The toy half of RISO/CAM has a closed feedback loop — the author's eye — and it works beautifully. The prepress half never got one, and five months of measurement culture was aimed at the printer's *driver* instead of the printer's *paper*.** Everything below ranks off that.

---

## 1. The validation loop never closed on paper (highest impact, and wrong given what was known)

The evidence is unambiguous and checkable. `test_prints/` holds eight PNG targets (`test_06_step_wedge.png`, `test_08_calibration.png`) built to be printed. There is **no scanned or photographed counterpart of any of them anywhere in the tree** — I searched; the only non-synthetic photographs in the repo are four paper-texture JPGs in `textures/`. `docs/validation/` decodes a `.prn` file, i.e. *the bits the driver sends to the drum*. `captures/` compares the simulator against itself.

So the ground truth hierarchy actually built was:

| Layer | Measured? | What it validates |
|---|---|---|
| Driver transfer LUTs (`renderer.js:1846`) | Yes, byte-exact for 3 of 5 | What the driver asks for |
| Threshold matrices, TRC (`riso_halftones.json`) | Yes, from `.hft` | What the driver asks for |
| Per-ink LUTs (`js/data.js`) | Third-party 2019 scans; **9 of them provably linear fakes**, including Black | Ink on paper, partially |
| SEP-LUT (`sep-lut-worker.js`) | Fitted against **the app's own renders** | Self-consistency |
| **Composite output vs. a printed sheet** | **Never** | The product claim |

The consequence is measurable and severe: replicating `calBlend` arithmetic, a 50% Black patch renders **0.685 mean-field / ~0.735 with real binarisation against a measured swatch of 0.498**; a solid renders 0.102 against 0.030. The renderer cannot reproduce its own calibration data. `docs/SEP-LUT-PLAN.md` independently observed the same thing (`gray-113 → renders (170,170,170)`) and worked *around* it.

**Why this is wrong given what was known, not hindsight:** by 2026-06-04 the author had a `.prn` decoder, a validation harness, `test_prints/` already authored, access to a real MZ970, and — this is the uncomfortable part — **an app that is a camera**. The capture pipeline for photographing a printed chart was 90% built and shipping. The distance from "live camera tool" to "print-credible predictor" was one afternoon of pointing the camera at a printed step wedge. It was never pointed there. `docs/INK-PHYSICS-PLAN.md` finally proposes exactly this loop — as the newest commit in the repo, `8b0cf1c`, 2026-07-25, five months in.

**Concrete alternative:** in early June, immediately after `ce8ff6b`, spend one week building print → photograph → fit before building SEP-LUT. Cost: ~1 week and a few sheets of paper. Payoff: defects #1 and #2 in the colour audit (composite can't reproduce calibration; reflectance used as transmittance, so paper is counted *n* times for *n* inks) surface on day one as a ~0.2 reflectance offset that no eye can miss on a wedge. Both are structural, not tuning — they would have been found in an hour and would have reshaped `calBlend` before four more months of work was layered on top of it.

---

## 2. Windows/WebGPU: three layers, two of them right, one continued past its own success

This deserves splitting, because the popular reading ("enormous investment for one test machine") is wrong about layers 1–2 and right about layer 3.

**Layer 1 — hardening (~440 lines in `renderer.js`): unambiguously correct.** The bug was not "slow on one laptop." A 3,000-line shader compiled synchronously in Chromium's *single shared GPU process* froze **the entire browser application**, every window. `054f947`'s diagnosis and the `KHR_parallel_shader_compile` fix, the TDR-safe banded draw (`renderer.js:845`), and the loop-breaker at `:773` ("a static print beats a frozen browser") are genuine product reasoning about blast radius. Preserve all of it.

**Layer 2 — D3D slim variants (~50 lines, `renderer.js:87-124`): the best ROI decision in the project.** Fifty lines of textual surgery turned "never links" into all six modes passing on the target hardware (`selftest.html` run, `lan-diag.log:672-725`, warm rebuilds 71–982 ms).

**Layer 3 — the WGSL pipeline: wrong given what was known, and the evidence was already in hand.** By the time `ce9a9ec` fixed the GL-object leak (the 8-minute compile → sub-second), the problem was *solved and verified on the target machine*. The WebGPU work starts after that. It cost 625 hand-written lines, a second GPU backend, a build stage, 6.27 MB of shipped assets (of which 3.5 MB is base64 WASM for `gputest.html`, a dev page linked from nowhere, re-uploaded on every deploy — and ~2.6 MB of `.wasm` that Neocities silently rejects every single time). It ships to **zero users**, gated behind `?webgpu` (`webgpu-live.js:25`), blocked on a golden-image harness that `docs/WEBGPU-PLAN.md:99` names as the gate and that does not exist. And it does not retire layer 2 — `?webgpu` on Windows is strictly *additive* cost, since nothing clears `_isD3D`, so mode switches still pay for a WebGL slim recompile the user never sees.

**Concrete alternative:** stop at `ce9a9ec`. Cost of stopping: zero, the problem was fixed. Redirect the 8 days to the print loop (point 1) or to the export-path drift (point 6). The honest counter-argument — WebGPU is real future-proofing and the deploy-time transpile decision (46 s of tint on the target CPU, `WEBGPU-PLAN.md:12-19`) is excellent engineering — is true. It was a good bet placed while the product's central claim was measurably false.

July's line-count allocation is the whole story in one row: **PLATFORM 2,130 > FEATURE 1,661 > FIDELITY 1,269 > BUGFIX 738.** In the most recent month of a print-credibility tool, portability outweighed fidelity.

---

## 3. Six modes: each one cheap, the set expensive

The megashader made a new mode nearly free — which is *why* there are six, and why STIPPLE landed in two commits. But mode count is a multiplier on every cross-cutting cost thereafter: 16 hand-written `mode === 'flat' || mode === 'stipple'` sites; one slim shader variant per mode (LETTERS cold-compiles in **62 s** on the target, `lan-diag.log:586`); two prepass engines sharing one re-entrancy flag with asymmetric requeue (S2 — a reachable state where **STIPPLE renders RISO masters indefinitely**); three export sizing implementations; three uniform-setting paths.

And of the six, exactly one (flat/RISO) carries prepress meaning. The bitter detail: **SCREEN mode, which has the least colour machinery, is the most accurate** — 50% Black computes to ~0.524 against a measured 0.498, because `index.html:2473` forces `ink = p100` and skips the `mix(p100, lutBlend(cov))` double-count that GRAIN, LINES and RISO all take. The modes with the most work in them are the least correct.

LETTERS is already `u_mode==1` plus a forced `u_stampShape=5` (`renderer.js:1153`); STIPPLE is `u_mode==3` plus `u_amtCrisp` and LINEAR filtering. **Concrete alternative:** ship three modes and expose letters/stipple as presets — which is what they physically are. Cost: roughly zero engineering, minus two mode chips. Savings: two slim variants, one prepass engine, the four-rewrite-plus-revert stipple day (`87a0653` → `2eed6d0` → `521502d` revert → `387c983`), and S2 never exists.

---

## 4. SEP-LUT: exemplary method, wrong objective function

This is the most painful item because the work is the best in the repo. `docs/SEP-LUT-PLAN.md` is a real lab notebook; the A/B that rejected the textbook YNSN model on measured evidence (in-model 3.27 vs 5.03, against renders 20.33 vs 8.56) and *kept the loser behind a flag* is methodologically better than most commercial colour teams manage.

But the doc states the objective outright: *"the app's own shader is the ground truth here."* The headline result — mean ΔE **21.6 → 8.95, −59%** — is 59% closer to a renderer that is itself ~0.19 reflectance wrong at 50% black. Rigour spent on self-consistency while absolute error went unmeasured. The moment to catch this was the moment the sentence was written.

**Alternative:** identical solver, identical OKLab objective, identical code — fitted against photographed printed patches. Marginal cost over what was actually spent: the one week from point 1.

---

## 5. Phone: right priority, wrong boundary — and the PWA tail is pure waste

Phone support is *not* optional for the live-camera identity, and the Feb 26 burst plus July's JPEG-capture fix (2.24 MB vs 71.28 MB, 32×) are correct spends.

What should have been bounded is the productization tail attached to it. `manifest.json` has `start_url:"/"` while the app deploys to `/risocam/`. `phone.js:717-723` registers a **blob-URL service worker** that browsers reject outright and that trips the exact CSP report `index.html:3506` was written to avoid. `sw.js:63` uses `caches.match` with default `ignoreSearch:false` against scripts requested with `?v=NN` — **the precache has never matched, ever**. And `sw.js` was bumped 21 times across the history for a cache that never hits.

**Concrete alternative:** delete `sw.js` and `manifest.json`; ship a responsive web page. Cost: *negative* — removes ~90 lines and 21 commits of ceremony. This is the clearest instance in the project of effort spent on the *form* of shipping rather than on shipping.

The other phone cost is subtler and does hit the prepress claim: `_renderInner` passes `isPhoneNow` (`renderer.js:1735`), all three export paths hardcode `false` (`save.js:187, 876, 1393`). On a phone, WYSIWYG holds only when export AR happens to equal crop AR.

---

## 6. The prepress exit is the least-exercised path in a prepress tool

`exportSeparations` (`save.js:925`) is a hand-maintained fork of `setRenderUniforms`: 81 `gl.uniform*` calls against 120, drifted by **17 uniforms**. The emblematic one: `setRenderUniforms` sets `u_amtJitter = 0.0` when saving (`renderer.js:1279`) precisely because stochastic taps dissolve dots into speckle at export resolution. Separations set `_saving = true` and never call it — so **the one export that actually reaches a drum is the one that keeps the speckle.** Add `window._saving` not existing (`_saving` is a `let`, so `ui-controls.js:823`'s guard is permanently `undefined`), meaning the stipple LIVE timer rebinds texture units 9–12 *in the middle of the per-plate export loop*.

The commit history says this is chronic, not incidental: `3e95082`, `65b70c1`, `1737b5a`, `cd56c0a` — seps is consistently the path that gets forgotten. That is the real signature of the dual identity failing, and it is not "the identities conflict." It is that **only one identity is exercised daily.**

---

## 7. The blackout: 84 days solving a distribution problem the web app didn't have

March 4 – May 27: zero commits, 78 uncommitted `renderer.js` revisions (pin v6 → v84), and seven untracked sibling directories — `risocam-apk`, `risocam-twa`, `risocam-native`, `risocam-webview`, `risocam-ios`, `risocam-figma`. Never reached an app store; the author's own notes say it "folded into the dithering problem."

The RE campaign that followed (May 11 – Jun 2) was right and paid off. The ~3-week native fan-out was not: the app was already distributable at a URL. There was no distribution problem to solve — and the actual distribution problem (an entire class of Windows GPUs on which the page froze the browser) went undiscovered for four more months.

---

## What was right and must not be sanded off

1. **The megashader.** Genuinely correct, and I'd take it again. It made six modes and STIPPLE-in-two-commits possible; the `WEBGPU-PLAN.md:105` audit found the shader unusually portable (zero derivatives, zero `discard`, zero `while`) and the porting mass was the 1,569 `gl.*` call sites, not the shader. Only one legacy compiler is pathological for it. The bill was real, but the alternative (six programs sharing 188 uniforms, 16 texture units and five prepasses) was worse.
2. **The measurement culture.** 82 of 211 commits carry a `Verified:` block with numbers. `d5b75b8` — the previous fix was verified on rotation-symmetric glyphs and therefore verified nothing — is a level of self-scepticism most engineering teams never reach. The failure in point 1 is *not* a failure of rigour; it is rigour aimed one layer short of the paper.
3. **Plan-before-implement, with a filter.** 8 plan docs, 5 shipped. The five that shipped are exactly the five with a measurement protocol attached. That correlation is strong enough to promote into a rule: no plan starts without a stated accept/reject gate. `INK-PHYSICS-PLAN.md` already applies this to itself ("resist bundling 1b into 1a").
4. **Killing things on evidence.** YNSN kept switched off; calibrated chord basis flipped OFF after an A/B; ~790 lines of dead WebGL2 code deleted (`016dc07`); stipple reverted on a look judgement (`521502d`, "user pick"). One commit in eight undoes prior work — in a project whose spec is "does it look right," a reversal *is* a measurement.
5. **Deploy-time transpile over runtime**, decided on 45.9 s of measured WASM cost. The right call, made the right way — the criticism in point 2 is about *whether to build the layer*, not about how it was built.

---

## The dual identity is coherent. Do not split it.

Against the framing: the toy and the prepress tool share the ink model, the separation engines, all five halftone engines, the paper substrate, and the export machinery. The parts that genuinely diverge are two thin ends — `exportSeparations` and the phone camera path — and they are *already* separate files. Splitting would have forked the megashader, the most expensive object in the project, and doubled the platform tax that point 2 shows was already the largest line item.

What was incoherent was never the identity. It was the **evidence standard**. The toy half is validated by the author's eye, which is the correct and fastest possible loop for it. The prepress half was validated by the author's eye *and a driver binary* — neither of which can see paper. One product, two loops. The second loop was the deliverable, and it is the one thing five months did not produce.

**If I could reallocate one week of the 151 days:** the first week of June, spent printing `test_prints/test_06_step_wedge.png` on the real machine, photographing it with the app's own camera, and plotting simulated vs. measured reflectance at eleven tone steps. Everything downstream — SEP-LUT's objective, `calBlend`'s structure, the nine fake ink LUTs, the `coverageScale = 1.7` fudge, whether STIPPLE and LETTERS deserve to exist — reorders around that one chart.