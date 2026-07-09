# SEP-LUT: forward-model-inverting separation LUT

Goal: replace per-fragment NNLS (and the flat/RISO per-channel projection)
with a baked 3D LUT that inverts the app's ACTUAL compositing — optimal ink
weights per target color, one texture fetch per fragment.

## Status
- DONE `js/sep-lut-worker.js`: forward model (mean-field calBlend replica),
  OKLab objective, projected coordinate-descent solver (multistart), N³ bake
  + `solveOne` debug protocol. Smoke-tested in-page:
  navy → w=[0.75,0,0,0.71] predΔE 0.5 · midgray → predΔE 0 ·
  pink → red 0.7, ΔE 2.3 · purple → ΔE 14.7 = true 4-ink gamut limit.
- Baselines (24-patch harness, grain mode, SPOT, CMYK profile, Blank tex +
  Pure White paper, patch mapping m=0.072, OKLab ΔE·100 of 40px patch means):
  shipped NNLS (naive deltas, after 1ed3dab) = **14.75**. Beat this.

## Forward model (captured from calBlend, index.html ~line 2348)
Per plate in layer order, from paper; mean-field d = c (grain averages to
coverage; add dotMin factor `d *= mix(dotMin,1,c)` for grain/riso fidelity):
- ink = mix(p100, lutBlend(c, paper, p10..p100), smoothstep(.3,.7,c))
- transparent = (sqrt(prev) · sqrt(max(ink,.05))^d)²   (Beer-Lambert YN n=2)
- transparent ink flag on → blended = transparent; else crossfade to
  opaque mix(prev,ink,d) by smoothstep(.3,.85,d)·opacityCap
- contamination term is simNoise-scaled → 0 for the mean field
Working space = shader space (sRGB-encoded, calBlend never linearizes).
Metric linearizes forward output and target identically before OKLab.

## Wiring plan (next session)
1. **Bake orchestration** (renderer.js): `_sepLutBake()` — blob-load the
   worker (`_buildWorkerBlobUrl('js/sep-lut-worker.js?v=1')`, CSP), gather
   per-ink {P: [p10,p30,p50,p70,p100], transparent} + paper. The pXX come
   from the SAME source that fills u_lutC*/cal textures (grep `u_lutC0`
   upload site; cal-lut-worker owns measured data). N=17 first (4913 solves,
   ~1-2 s), N=33 later if interp error shows. Debounce + `_sepLutSeq`
   staleness (copy the AMT pattern); triggers: ink set/profile/paper change.
2. **Texture**: pack N³ RGBA float→8-bit weights as 2D atlas (N tiles of
   N×N, standard 3D-in-2D). Unit: NONE FREE (16 used) — reuse unit 8's
   time-share ladder (it already juggles ht5/AM matrix/glyph atlas by mode)
   or pack into the cal LUT texture's free rows. Decide there.
3. **Shader**: `uniform sampler2D u_sepLut; uniform float u_useSepLut;` in
   nnlsDecompose: when on, two slice fetches + manual trilinear mix →
   weights; keep NNLS as fallback (live sources during bake, and 1-2 ink
   cases where NNLS is exact-ish).
4. **CPU consumers**: flat/RISO `projJobs` fused loop + stipple luma
   projection — replace per-channel axis projection with JS trilinear reads
   of the SAME Float32Array weights (kept from the bake message). This is
   the piece NNLS never covered: true multi-ink separation for masters.
5. **Validate**: rerun the 24-patch harness (protocol above; colors list in
   the session transcript / reconstruct any 24 diverse patches) expecting
   mean ≤ ~8-10 (gamut-limited patches keep irreducible error: purple ≈15).
   Also eyeball: dark navy/brown photos in RISO mode (old failure class).
6. Pins: renderer, sw ASSETS ADD sep-lut-worker.js, deploy on request only.

## Notes / risks
- Mean-field d=c ignores grain-texture nonlinearity through Beer-Lambert
  (Jensen gap). If measured LUT accuracy stalls, sample forward() over the
  grain distribution (a 5-point Gauss quadrature over d) instead.
- calBlendOpaque (metallic inks) not modeled — LUT bake should fall back to
  NNLS when any active ink is opaque-metallic, or model it later.
- Screen mode uses d=c and p100 ink exactly (no dotMin/lutMix) — the LUT is
  still an upgrade (its forward ≈ that at mean field).
