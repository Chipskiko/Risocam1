# RISO/CAM Rendering Pipeline — Detailed Flow

## Overview
Single-pass WebGL fragment shader. Each pixel processed independently.
Up to 4 ink layers composited sequentially onto a paper base color.

---

## Stage 0: Source Input
```
source_rgb = texture2D(u_src, uv)     // sRGB from camera/image (0-1)
```
- Input is **sRGB gamma-encoded** (not linear)
- For CMYK path: slight vertical blur (mix with 0.35 offset sample) for anti-aliasing

---

## Stage 1: Image Adjustments — `adjustRGB(rgb)`
Applied per-pixel before any color separation.
```
1. Brightness:   rgb += bright * 0.01
2. Contrast:     rgb = (rgb - 0.5) * (1 + contrast*0.02) + 0.5
3. Saturation:   lum = dot(rgb, [0.299, 0.587, 0.114])
                 rgb = mix(lum, rgb, 1 + sat*0.03)
4. Shadows:      mask = (1-rgb)²   → affects darks only
                 rgb += shadows * 0.01 * mask
5. Highlights:   mask = rgb²       → affects brights only
                 rgb += highlights * 0.01 * mask
6. Tone Curve:   rgb = LUT_256[rgb] (if active — user-drawn curve)
7. Anti-band:    rgb += triangular PDF dither (±3 LSB)
```
**All operations in sRGB space** — no linearization.

---

## Stage 2: Color Separation (two paths)

### Path A: CMYK Separation (`sepType == 0`)
```
⚠️ NO sRGB→linear conversion — values treated as linear but they're gamma-encoded

cmyk = toCMYK(rgb):
    k = 1 - max(r, g, b)
    c = (1-r-k) / (1-k)
    m = (1-g-k) / (1-k)
    y = (1-b-k) / (1-k)
    UCR: reduce CMY when K high → c *= (1 - smoothstep(0.25,0.85,k) * ucrStr)
```

### Path B: NNLS Spot Color Decomposition (`sepType == 1`)
```
Solves: minimize ||target - paper - Σ(w_i * (ink_i - paper))||²
    subject to w_i >= 0

Enumerates subsets of ≤3 inks (from 4 available)
Returns weights w0..w3 (0-1 each) = how much of each ink
```
**NNLS works directly on sRGB RGB distances** — no CMYK conversion.

---

## Stage 3: Channel Extraction — `getChannel(cmyk, ch)`

### Mono (1 layer):
```
raw = C*0.10 + M*0.25 + Y*0.05 + K*0.95
```

### Duotone (2 layers):
```
ch0: raw = C*0.25 + Y*0.05 + K*0.75
ch1: raw = M*0.25 + Y*0.05 + K*0.75
```
Plus gray detection: for neutral colors, uses `(1-luminance) * balance` instead.

### 3-4 layers:
Direct CMYK channel mapping + K distribution.

All channels: `raw *= balance_per_channel`, then TAC limiting.

---

## Stage 4: Coverage Computation — `getCoverage()`
Takes raw channel value (0-1) and applies physical print effects:
```
ink = raw_channel
ink *= density_slider * 0.01           // user density control
ink += dotGain * ink*(1-ink)*4 * 0.008 // per-pixel dot gain (NOT spatial blur)
ink *= (1 - layerDeplete * layerIndex) // later layers: less ink (paper already wet)
ink *= flicker                         // temporal random ±densFlicker
ink *= paperField                      // fiber absorption modulation
ink *= (1 + pressX + pressY + drumBand) // roller pressure variation
ink -= starvation                      // ink starvation in dense areas
ink += inkNoise                        // random noise
return clamp(ink, 0, 1)               // = "coverage" for this pixel
```
**Note**: `inkGamma` parameter exists but is NOT used inside getCoverage.

---

## Stage 5: Grain/Dither — `getGrainTexture(coverage)`
Converts continuous coverage (0-1) into binary-ish dot pattern.
```
val = pow(coverage, tonalGamma)        // gamma lift (default 1.40)
val += (paperField - 1) * 0.28        // fibers perturb threshold
val -= stencil_perforation_holes       // random tiny gaps
val = apply drum_transport_jitter      // horizontal slip

// Then one of:
grainDither(val, pix):                 // Mode 0: Grain Touch
    bn = blue_noise_texture(pix)       // 256x256 blue noise, tiled
    thr = fract(bn * 0.75 + hash * 0.25)
    return smoothstep(thr-edge, thr+edge, val)  // ⚠️ SOFT threshold (not binary)

screenDither(val, pix):                // Mode 1: Halftone Screen
    (rotated grid, dot size comparison)

stuckiDither(val, pix):                // Debug: Stucki approximation
    (multi-sample weighted noise threshold)

jjnDither(val, pix):                   // Debug: JJN approximation
    (wider kernel multi-sample noise threshold)
```
**Output**: 0-1 "grain" value. NOT strictly binary — smoothstep creates soft edges.

---

## Stage 6: Ink Blending — `calBlend(result, paper, coverage, grain, LUT, p100)`
This is where ink color meets paper. Called per-layer, `result` carries forward.

```
// Debug: fixed coverage override
if (fixedCov > 0) coverage = fixedCov;

// Stage 6a: Grain → per-dot ink density 'd'
d = grain                              // from Stage 5 (soft 0-1 value)
d = clamp(d * inkOpacity * 1.136, 0, 1) // ⚠️ inkOpacity=88 → multiplier ~100
                                        // effectively: any grain > 0.01 → d ≈ 1.0

// Stage 6b: dotMin — thin ink in light areas
d *= mix(dotMin, 1.0, coverage)        // ⚠️ makes light-area dots WEAKER
                                        // dotMin=0.15 → at cov=0, d *= 0.15

// Stage 6c: Ink color selection
lutMix = smoothstep(0.3, 0.7, coverage)
ink = mix(p100, lutBlend(coverage), lutMix)  // p100 at low cov, LUT at high

// Stage 6d: Beer-Lambert absorption (Yule-Nielsen n=2)
paperYN = sqrt(result)                 // half-tone correction
inkYN = sqrt(ink)
absorption = pow(inkYN, d)             // ink layer absorption
transparent = (paperYN * absorption)²  // back to normal space

// Stage 6e: Opaque crossfade
opaque = mix(result, ink, d)           // simple opaque blend
opacity = smoothstep(0.3, 0.85, d) * opacityCap
blended = mix(transparent, opaque, opacity)  // crossfade

// Stage 6f: Ink contamination (2%)
blended += blended * 0.02 * d * (ink - blended)

result = blended                       // → feeds into next layer
```

### Layer Compositing
Layers are composited **sequentially** — NOT multiply blend mode.
Each layer's `calBlend` takes the previous `result` and applies Beer-Lambert
absorption through it. This is physically-based: light passes through paper,
gets absorbed by ink layer 0, then absorbed by ink layer 1, etc.

### LUT System — `lutBlend(d, paper, p10, p30, p50, p70, p100)`
5-point piecewise linear interpolation from real scanned print swatches:
```
d < 0.10: mix(paper, p10, d/0.10)
d < 0.30: mix(p10, p30, (d-0.10)/0.20)
d < 0.50: mix(p30, p50, (d-0.30)/0.20)
d < 0.70: mix(p50, p70, (d-0.50)/0.20)
d >= 0.70: mix(p70, p100, (d-0.70)/0.30)
```
LUT values are **area averages** (dots + paper gaps mixed), NOT per-dot ink colors.

---

## Stage 7: Paper Overlay
```
// Fiber reflectance modulation
paperReflect = 1.0 + (paperField - 1.0) * 0.6
result *= paperReflect

// Paper overlay texture (0.5 opacity)
result = mix(result, result * paperOverlayTex, 0.5)
```

---

## Stage 8: Ghosting (optional)
Previous frame's ink bleeds through from the drum:
```
ghostRGB = texture2D(prevFrame, uv)
ghostCMYK = toCMYK(ghostRGB)
// Apply as faint layer using same calBlend pipeline
```

---

## Known Issues / Debug Toggles

| Toggle | What it does |
|--------|-------------|
| Force ink=p100 | Skip LUT, always use 100% ink color |
| LUT direct | Bypass Beer-Lambert, use lutBlend() directly |
| Bypass dotMin | Skip per-coverage dot thinning |
| Transparent only | No opaque crossfade |
| Show raw coverage | Visualize coverage as grayscale |
| Binary grain | Hard on/off dots, constant density |
| Linearize before CMYK | Apply pow(rgb, 2.2) before toCMYK() |
| Fixed coverage buttons | Force coverage to 10/25/30/50/70/75/100% |
| Dither mode | Switch between Grain Touch / Stucki / JJN |

### Suspected Root Cause of Tonal Compression (50-100% → same output)

1. **Gamma trap**: `toCMYK()` operates on sRGB (gamma-encoded) values.
   sRGB 0.70 = linear 0.45, sRGB 0.85 = linear 0.69, sRGB 1.00 = linear 1.00.
   The 50-100% sRGB range maps to only 25-100% linear → compressed coverage extraction.

2. **Mono channel weights**: `C*0.10 + M*0.25 + Y*0.05 + K*0.95` heavily favors K.
   For saturated blue (high C+M, low K), max coverage is ~0.35. Dynamic range is tiny.

3. **tonalGamma (1.40)**: Applied AFTER coverage extraction, pushes values darker,
   further compressing the high end.

4. **Soft dithering + dotMin**: smoothstep grain gives variable per-dot density,
   then dotMin scales it down in highlights — double-dimming the light end.

5. **Spot mode (NNLS) is better**: Bypasses toCMYK entirely, computes ink weights
   directly from RGB distance — not affected by gamma trap or channel weights.
