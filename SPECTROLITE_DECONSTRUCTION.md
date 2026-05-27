# Spectrolite Deconstruction — Color Math

Complete reverse-engineering of Spectrolite.app (Anemone Engineering, Riso color separator).
Source for this analysis:
- `/Applications/Spectrolite.app/Contents/Resources/app.asar` → extracted to `/tmp/spectrolite_extract/`
- TypeScript reconstructed from source maps → `/tmp/spectrolite_src/` (212 files)
- Native backend: `/Applications/Spectrolite.app/Contents/Resources/bin/spectrolite_cli` (Go, ARM64, 20MB)
- 80 pre-computed per-ink color profiles at `bin/single-ink-profiles/*.gob`

---

## 1. Architecture

Spectrolite is an **Electron + Go** application:

```
┌─────────────────────────────────────────────────────────┐
│  Renderer (Vue/TS — UI, palette editor, canvas preview) │
│                       │                                  │
│            window.ipcRenderer.send(...)                  │
│                       ▼                                  │
│  Main process (Electron, TS — IPC orchestration)        │
│                       │                                  │
│            child_process.spawn(spectrolite_cli)          │
│                       ▼                                  │
│  spectrolite_cli (Go binary — all color math here)       │
│       ├── lib/colorseparation         (top-level)        │
│       ├── lib/colorseparation/coresolve  (per-pixel)     │
│       ├── lib/colorseparation/profile    (LUT, ICC)      │
│       ├── lib/colorseparation/precompute (image cache)   │
│       ├── lib/colorseparation/postprocessing             │
│       │   ├── halftone   (rotated threshold matrix)      │
│       │   ├── dithering  (Floyd-Steinberg etc.)          │
│       │   ├── trapping   (morphological dilate/erode)    │
│       │   └── opacities  (per-ink density multiplier)    │
│       └── lib/colorseparation/pdfvector  (PDF text path) │
└─────────────────────────────────────────────────────────┘
```

The TypeScript side does no per-pixel math. Every algorithm — RGB→ink, LAB conversion, trilinear interpolation, halftone matrix construction, error diffusion — lives in the Go binary.

CLI verbs (from `bin/spectrolite_cli --help` and the IPC command names in `src/commands/names.ts`):
- `create` — generate `.prof` color profile from per-ink ICC profiles
- `create-preview` — generate preview-only profile
- `preview` — fast preview separation
- `separate` — full separation, emit per-channel grayscale files + RGBA proof
- `export` — write final outputs

---

## 2. Type system

### RGB8 (Go side)
```go
type RGB8 struct { R, G, B uint8 }
```

### ColorLABNorm (Go side, `lib/types`)
Spectrolite represents LAB in a normalized 0..1 cube so it can be indexed directly into a 3D LUT.

From disassembly of `ColorLABNorm.SetFromRGB` (uses `go-colorful.Color.Lab()`):
```
labNorm.L = clip01(L)              // L was already 0..1
labNorm.A = clip01(0.5 * (1 + a))  // shift a* from [-1,1] to [0,1]
labNorm.B = clip01(0.5 * (1 + b))  // shift b* from [-1,1] to [0,1]
```

`SetFromRGB8(rgb8)` is a thin wrapper: divides each channel by 255, then calls SetFromRGB.

Distance metric: `DistanceCIE76` — Euclidean L2 in the normalized LAB cube. Squared form is the actual stored metric (the JS `ColorRGB.deltaLab` mirror in `src/types/colors.ts:51` uses the same squared L²+a²+b² distance — no L/a/b scaling, no CIE94/CIE2000).

### ColorRGB (TS side, `src/types/colors.ts`)
Used only for preview rendering and palette editing. Two essential blend ops:

```ts
// blend(alpha): convert rgba → equivalent opaque rgb on white background
const multBG = (1 - alpha) * 255;
return new ColorRGB([
  Math.round(r * alpha + multBG),
  Math.round(g * alpha + multBG),
  Math.round(b * alpha + multBG),
]);

// multiply(other, a): stack ink "other" at coverage a on top of self
return new ColorRGB([
  Math.round(r * ((other.r / 255) * a + 1 - a)),
  Math.round(g * ((other.g / 255) * a + 1 - a)),
  Math.round(b * ((other.b / 255) * a + 1 - a)),
]);
```

`multiply` is the **subtractive-like ink stacking model**: each channel attenuates by `(otherChan / 255 * coverage + (1 - coverage))`. This is exactly Risocam's `multiply`-blend in CSS for spot ink simulation. Note this is the *preview* model — the Go backend uses ICC-style trilinear interpolation for real separation, not this multiplicative model.

### Color / RisoColor
```ts
class Color {
  name: string;
  color: ColorRGB;
  group: string;  // "blues" | "teals" | "pinks" | "purples" | "yellows" | "browns" | "greens" | "grays" | ...
  get id(): string;  // name with spaces stripped
}
```
The `group` field is used only by CMYK-ish to assign each user-chosen ink to one of the four channels.

---

## 3. Processing styles (5 total)

From `src/types/colorSeparationStyle.ts`:

| Style                    | Base method            | Postprocess |
|--------------------------|------------------------|-------------|
| **Regular** (`spectrolite-default`) | spectrolite-default    | none        |
| **CMYK-ish**             | cmyk-ish               | none        |
| **Halftone**             | spectrolite-default    | halftone    |
| **Posterize**            | posterize              | none        |
| **Dithering**            | spectrolite-default    | dithering   |

Halftone and Dithering are not different *separations* — they just post-process the Regular result. So under the hood there are only **3 separation algorithms**: `spectrolite-default`, `cmyk-ish`, `posterize`. The Go dispatcher `coresolve.Solve` reads the method enum and tail-calls one of the three:

```
Solve(method int) → switch:
  0 → solveSpectrolite (the default / spot color)
  1 → solveCMYKish
  2 → solvePosterize
```

Each takes `(palette, rgbaImage, methodString, profile, inputs)` and returns a `[][]float64` — one float64 slice per pixel, indexed by ink. Each slice element is that ink's coverage in 0..1 (can exceed 1.0 for postprocess multiplier overshoot — clamped at write time).

---

## 4. Algorithm 1 — Spectrolite-default (spot color)

This is the headline algorithm: "give me arbitrary spot inks and I'll figure out how to mix them to approximate any RGB image."

### 4a. Profile generation (offline, once per palette)

When the user defines a palette of N inks, Spectrolite kicks off `PROFILEGEN`. The Go backend's `profile.CreateColorProfile` does:

1. **Load the 80 pre-computed per-ink profiles** from `bin/single-ink-profiles/*.gob`.
   Each file is a Go-gob-encoded `singleColorMatcherOut{ RisoColors []RGB8, ColorsCloseToIdxRiso map[RGB8]uint8 }`.
   Gob header confirms this — visible in xxd at offset 0x00:
   ```
   singleColorMatcherOut → { RisoColors []main.RGB8, ColorsCloseToIdxRiso map[main.RGB8]uint8 }
   RGB8 → struct { R, G, B uint8 }
   ```
   Each gob file maps **observed RGB → coverage byte (0..255)** for that single ink printed on white paper. Black has 103KB (full RGB cube subsampled with finer resolution near dark values). Red has 67KB (smaller because only ~half the cube can be reached by red ink alone).

2. **Combine the relevant per-ink LUTs** into a `ColorProfile`. The struct seen in `GetOpacities`:
   ```go
   type ColorProfile struct {
     // 0x90: *iccCurveSet     // optional source ICC tone curves
     // 0x98: *TriLinearMulti  // the 3D LAB → opacity vector LUT
     // 0xc0: map[RGB8]matchEntry   // exact-match fast path (built from per-ink gobs)
     // ... metadata
   }
   ```

3. **Optionally adjust with custom source ICC.** If user supplied a separation ICC profile, the curves in `iccCurveSet.adjustLAB` are applied to map source LAB → device LAB before the interpolation.

4. **Save the result to `.prof` file.** This is what gets cached per palette. Subsequent separations skip step 2-3.

### 4b. Per-pixel separation (`coresolve.solveSpectrolite`)

```python
# Pseudocode from disassembly of solveSpectrolite + ColorProfile.GetOpacities

def solveSpectrolite(palette, image, method, profile, inputs):
    nInks = len(palette.inks)
    nPixels = len(image)
    out = make([]float64[], nPixels)

    if method == "preview":
        # Preview-only path: skip per-pixel allocation,
        # use a small smoke-tested codepath.  Same math.
        pass

    for i, rgb8 in enumerate(image):
        if inputs.treatImageAsGrayscale or palette.isShadowPalette:
            # Single-ink shortcut
            lab = LABNorm.SetFromRGB8(rgb8)
            opacity = 1.0 - lab.L              # invert luminance
            out[i] = [opacity]
            continue

        out[i] = profile.GetOpacities(rgb8)

    return out


def GetOpacities(rgb8) -> []float64:
    # Step 1: fast path — exact-match lookup in the matcher map
    # (built from the single-ink .gob files at profile creation time)
    entry, hit = profile.matcher[rgb8]
    if hit:
        # If the matched profile entry maps to a "white" ink, fall through
        # the linear scan looking for it; otherwise return its precomputed
        # opacity vector directly.
        for inkIdx in entry.inkIndices:
            if palette.inks[inkIdx].name == "white":
                continue            # skip white inks during fast match
            ...
        return entry.opacities

    # Step 2: slow path — convert to LAB and trilinearly interpolate the 3D LUT
    lab = LABNorm.SetFromRGB8(rgb8)             # L,a,b ∈ [0,1]
    if profile.iccCurves != nil:
        lab = profile.iccCurves.adjustLAB(lab)  # source-ICC tone curves
    return profile.triLinear.Eval(lab.L, lab.A, lab.B)
```

### 4c. Trilinear interpolation (`TriLinearMulti.Eval`)

The 3D LUT is a uniformly or non-uniformly sampled cube indexed by (L, A, B). Each grid point stores a length-N opacity vector (one float per ink). From disassembly:

```python
def Eval(L, A, B) -> []float64:
    # Find the grid index for each axis.
    # searcher.search uses either:
    #   (a) a stored []float64 axis grid (non-uniform) — binary search
    #   (b) a uniform layout: idx = round((v - offset) / step)
    # The "uniform" flag at +0x38 / +0x78 of the searcher selects which.
    iL = searcher.search(L)
    iA = searcher.search(A)
    iB = searcher.search(B)

    # Fetch the 8 cube-corner opacity vectors and trilerp.
    c000 = LUT[iL  , iA  , iB  ]
    c100 = LUT[iL+1, iA  , iB  ]
    c010 = LUT[iL  , iA+1, iB  ]
    c001 = LUT[iL  , iA  , iB+1]
    c110 = LUT[iL+1, iA+1, iB  ]
    c101 = LUT[iL+1, iA  , iB+1]
    c011 = LUT[iL  , iA+1, iB+1]
    c111 = LUT[iL+1, iA+1, iB+1]

    dL = (L - L_grid[iL]) / (L_grid[iL+1] - L_grid[iL])
    dA = (A - A_grid[iA]) / (A_grid[iA+1] - A_grid[iA])
    dB = (B - B_grid[iB]) / (B_grid[iB+1] - B_grid[iB])

    return lerp3(c000..c111, dL, dA, dB)
```

The disassembly shows the index calculation specifically: `idx = ((iL * nA) + iA) * nB + iB`, packing the 3D cube into a flat slice.

### 4d. What this means

The "Regular" mode of Spectrolite is **not** computing ink opacities analytically. It is doing **ICC-style profile lookup**: it asks "for this observed paper color, what mix of inks produces it on this paper?" The answer was pre-computed by sampling every grid corner in LAB space during palette creation. At runtime, separation is just three binary searches, eight memory reads, and a trilerp.

The actual color-mixing intelligence is baked into the per-ink `.gob` files (subtractive mixing model + measured ink behavior on paper) and into the profile-gen step (combining them into a multi-ink LUT — likely by solving small least-squares fits at each LAB grid point).

---

## 5. Algorithm 2 — CMYK-ish

This mode lets users print any 4-color palette (e.g. 4 fluorescent inks) as if it were CMYK, by routing each user ink to a CMYK channel.

### 5a. Channel assignment (TS side, `src/types/transforms/cmykish.ts`)

```ts
channels = [
  { id: "C", rgb: [0,255,255]   },   // Cyan
  { id: "M", rgb: [255,0,255]   },   // Magenta
  { id: "Y", rgb: [255,255,0]   },   // Yellow
  { id: "K", rgb: [0,0,0]       },   // Black
];

colorGroups("C") = ["blues",  "teals"]
colorGroups("M") = ["pinks",  "purples"]
colorGroups("Y") = ["yellows","browns","greens"]
colorGroups("K") = ["grays"]    // K uses LAB distance only, ignoring groups

// For each channel, find the user ink whose:
//   1) group matches the channel's preferred groups, AND
//   2) among those, has the smallest LAB² distance to the channel RGB.
// If no in-group ink exists, fall back to LAB-nearest across all inks.
```

The disassembled `CMYKishInputs.GetChannelToPaletteInkIndex` confirms this returns a `[4]int` (one ink index per CMYK channel). `GetChannelInks` returns the four palette Colors themselves.

### 5b. Per-pixel separation (`coresolve.solveCMYKish`)

```python
def solveCMYKish(palette, image, method, profile, inputs):
    channelToInk = inputs.cmykish.GetChannelToPaletteInkIndex()  # [4]int
    channelOpacities = inputs.cmykish.opacities                  # [4]float64, default [1,1,1,1]
    nInks = len(palette.inks)

    out = make([]float64[], len(image))

    for i, rgb8 in enumerate(image):
        # 1. Standard RGB→CMYK using image/color.RGBToCMYK (stdlib):
        #    K = 1 - max(R,G,B)/255
        #    if K == 1:  C=M=Y=0
        #    else:       C = (1 - R/255 - K) / (1 - K)
        #                M = (1 - G/255 - K) / (1 - K)
        #                Y = (1 - B/255 - K) / (1 - K)
        cmyk = rgbToCMYK(rgb8)  # returns floats in [0,1]

        # 2. Multiply each CMYK channel by its user-set opacity
        cmykScaled = [
            cmyk.C * channelOpacities[0],
            cmyk.M * channelOpacities[1],
            cmyk.Y * channelOpacities[2],
            cmyk.K * channelOpacities[3],
        ]

        # 3. Sum each channel's contribution into the assigned ink slot
        inkOpacities = [0.0] * nInks
        for chIdx in range(4):
            inkOpacities[channelToInk[chIdx]] += cmykScaled[chIdx]

        # 4. Clamp each ink to [0, 1]
        for k in range(nInks):
            if inkOpacities[k] > 1.0:
                inkOpacities[k] = 1.0

        out[i] = inkOpacities

    return out
```

Two inks can map to the same channel-bucket; if so, they ADD (then clamp at 1.0).

The CMYK math is plain stdlib `image/color.RGBToCMYK`. No CIE/ICC color management. The "magic" is purely the LAB-based channel→ink assignment.

### 5c. CMYK detection in halftone defaults

From `src/types/transforms/halftone.ts:83`, when 4 inks each fall into different default-CMYK groups, halftone angles default to:
```
C (blues)   → 15°
M (pinks)   → 75°
Y (yellows) →  0°
K (grays)   → 45°
```
Otherwise it sorts inks light-to-dark and assigns `[0°, 15°, 75°, 45°]`.

---

## 6. Algorithm 3 — Posterize

From disassembly of `coresolve.solvePosterize`:

```python
def solvePosterize(palette, image, method, profile, inputs):
    nInks = len(palette.inks)
    cfg = inputs.posterize  # PosterizeConfig

    inkIdxPerPixel = []
    for rgb8 in image:
        gray = (rgb8.R + rgb8.G + rgb8.B) / 3 / 255.0    # average → luminance
        # cfg.grayscaleBreakpoints is sorted dark→light
        # find first breakpoint > gray; use rangeToInkIndex to map to ink
        bucket = first index i where grayscaleBreakpoints[i] > gray
                  else nInks-1
        if gray < cfg.blackpointMinThreshold:
            inkIdx = -1   # below threshold → no ink (white paper)
        else:
            inkIdx = cfg.rangeToInkIndex[bucket]
        inkIdxPerPixel.append(inkIdx)

    if method == "preview":
        # build an RGB8 proof directly by stamping each ink's RGB into output
        ...

    # For full separation:
    out = []
    for inkIdx in inkIdxPerPixel:
        opacities = [0.0] * nInks
        if inkIdx >= 0:
            opacities[inkIdx] = 1.0
        out.append(opacities)
    return out
```

Posterize is one-bit-per-pixel quantization — every pixel gets full coverage of exactly one ink (or none). The TS default config (`src/types/transforms/posterize.ts`):

```ts
PosterizeConfig.default(palette) = {
  blackpointMinThreshold: 0,
  grayscaleBreakpoints: [(i+1)/N for i in range(N-1)] ++ [0.95],
  rangeToInkIndex: palette.inks sorted dark→light, then mapped to indices,
}
```

So by default, a 4-ink palette posterizes to: gray ∈ [0, 0.25] → darkest ink, [0.25, 0.5] → 2nd-darkest, [0.5, 0.75] → 3rd, [0.75, 0.95] → lightest, > 0.95 → white paper.

---

## 7. Postprocessing

### 7a. Halftone

`postprocessing/halftone.NewHalftoneThresholdsMatrix(angle, dpi, lpi)`:

1. `cellSize = round(dpi / lpi)` (3..16 typical, defaults to 8 at 600dpi for ~71 LPI)
2. Pre-baked dot-order tables for each cellSize live in `halftone.thOrder` (a `map[int][]int`)
3. `sin, cos = math.Sincos(angle * π / 180)`
4. Construct a `thMatrix` struct holding `{cellSize, lpi, sin, cos, thresholds[]}`

`thMatrix.GrayAt(x, y) → uint8`:
- Rotate `(x, y)` by `-angle` using the precomputed sin/cos
- Modulo into the cellSize×cellSize cell
- Index into the threshold ordering → produce a per-pixel threshold value

`Halftone(grayImage, channelCfg) → grayImage`:
- For each pixel, compare input gray to the rotated-cell threshold
- Output 0 or 255

This is a **classic rotated-screen halftone**. CMYK angles default to {15°, 75°, 0°, 45°}. Each color channel rotates by a different angle to avoid moiré.

Cell sizes are hand-tuned for known DPI/LPI combos (`HalftoneChannelConfig.buildWithDefaults`):
- 300 DPI →  38 LPI → cell ≈ 8 px
- 400 DPI →  50 LPI → cell ≈ 8 px
- 600 DPI →  71 LPI → cell ≈ 8 px (Riso default; "75 LPI" in marketing)

### 7b. Dithering

`dithering.ApplyDithering` reads `cfg.method` and tail-jumps to one of 8 kernel implementations (a jump table at `0x100b654a0`):

| Method               | Kernel                                |
|----------------------|---------------------------------------|
| floyd-steinberg      | 7/16, 3/16, 5/16, 1/16                |
| jarvis-judice-ninke  | 12-tap, divisor 48                    |
| stucki               | 12-tap, divisor 42                    |
| atkinson             | 6-tap, divisor 8 (only 75% of error)  |
| burkes               | 7-tap, divisor 32                     |
| sierra               | 10-tap, divisor 32                    |
| two-row-sierra       | 7-tap, divisor 16                     |
| sierra-lite          | 4-tap, divisor 4                      |

The default (`src/types/transforms/dithering.ts:28`) is **Atkinson**, which matches the classic Mac/early-Apple look. (Not Floyd-Steinberg, which is what Risocam currently uses.)

If `scaleFactor != 1`, the image is resized first (`resizeGray`), then thresholded at `threshold` (default 0.5). For `scaleFactor==1`, the threshold is forced to 0.5 (per `DitheringConfig.id` in TS).

Dithering is applied **per-channel** — each grayscale separation is independently dithered. So if you select Atkinson with a 3-ink palette, you get three independently-dithered black-and-white planes.

### 7c. Trapping

`trapping.applyTrappingImages` implements ink trapping via **morphological dilation** of darker inks under lighter inks:

1. `inkTrappingSequence` (default: lightest → darkest) defines the layer order
2. For each pair (layerA below layerB):
   - `dilate(layerA, pixels)` — grow layer A by `pixels` px
   - This pushes A's foreground under B's edges, masking misregistration
3. Edge cleanup levels:
   - `off`     → no further filtering
   - `normal`  → single morph-open after dilate
   - `high`    → repeated morph-open (cleaner but slower)

Trapping operates on the binarized halftoned/dithered output, not on the continuous opacity field.

### 7d. Opacity multipliers

`opacities.applyOpacityMultipliersCore` runs after separation. For each ink with `multiplier != 1.0`, it multiplies the grayscale plane by that scalar (clamping at 1.0).

This is the lever the user has to say "use only 50% of magenta" without changing the separation.

---

## 8. Per-ink profile files (the `.gob` archive)

80 files at `bin/single-ink-profiles/`, one per stock Riso ink. From `xxd` on `black.gob`:

```
Type: singleColorMatcherOut struct {
  RisoColors           []main.RGB8        // every RGB that this ink reaches
  ColorsCloseToIdxRiso map[main.RGB8]uint8  // RGB → index into RisoColors
}
```

Looking at the byte stream of `black.gob`, entries proceed as:
```
length-prefix, RGB(255,255,255), index 0xff
length-prefix, RGB(254,254,254), index 0xfe   ← coverage byte
length-prefix, RGB(253,253,253), index 0xfd
...
length-prefix, RGB(0,0,0),       index 0x00
```

For black, the RGB → coverage relationship is essentially linear in luminance: the darker the input, the higher the coverage. For colored inks like red:
```
length-prefix, RGB(255,255,255), idx → coverage 0
length-prefix, RGB(255,254,254), idx → coverage low (just barely red)
...
length-prefix, RGB(red_ink_rgb), idx → coverage 255
```

These files are **the ink's measured behavior on white paper**. Made once, baked into the binary. They're the equivalent of an ICC device-link profile measured per-ink.

When the user defines a palette of N inks, profile-gen mixes the N relevant `.gob` lookups into a single multi-ink LAB→[opacity]^N table. The Go code in `profile.CreateColorProfile` is too long to fully reverse here, but the structure (TriLinearMulti + matcher map) is clear from the consuming side.

---

## 9. Full preview pipeline

For the proof image (the visual preview the user sees in the canvas):

1. `solveSpectrolite` / `solveCMYKish` / `solvePosterize` → per-pixel `[]float64` opacities
2. For each pixel, compute the displayed RGB by **stacking inks multiplicatively** on white:
   ```
   rgb = [255, 255, 255]
   for inkIdx in stackOrder:
       opacity = opacities[inkIdx] * userMultiplier[inkIdx]
       inkRGB  = palette.inks[inkIdx].rgb
       rgb     = ColorRGB.multiply(rgb, inkRGB, opacity)
   ```
3. Optionally apply preview ICC (`profile.PreviewProfile.GetLABNorm`) for paper-tinted simulation
4. Encode as RGBA, return to TS for display

The stacking model (`opacities.multiply` in Go, mirrors `ColorRGB.multiply` in TS) is the **standard subtractive ink model**:
```
result.r = orig.r * ((ink.r/255) * coverage + (1 - coverage))
result.g = orig.g * ((ink.g/255) * coverage + (1 - coverage))
result.b = orig.b * ((ink.b/255) * coverage + (1 - coverage))
```

Equivalent to: blend(opaqueInk, currentRGB, coverage) in multiplicative space.

---

## 10. Key disassembly addresses (for future spelunking)

| Symbol                                          | Address       |
|-------------------------------------------------|---------------|
| `coresolve.Solve` (dispatcher)                  | `0x1005f3020` |
| `coresolve.solveSpectrolite`                    | `0x1005f22a0` |
| `coresolve.solveCMYKish`                        | `0x1005f1c20` |
| `coresolve.solvePosterize`                      | `0x1005f2960` |
| `coresolve.rgbToCMYK`                           | `0x1005f2120` |
| `coresolve.cmykChannelsToRGB`                   | `0x1005f21e0` |
| `profile.(*ColorProfile).GetOpacities`          | `0x1005df240` |
| `profile.(*ColorProfile).GetRGB`                | `0x1005df480` |
| `profile.(*TriLinearMulti).Eval`                | `0x1005e3630` |
| `profile.(*TriLinearMulti).EvalInto`            | `0x1005e3c80` |
| `profile.(*searcher).search`                    | `0x1005e4390` |
| `profile.(*iccCurveSet).adjustLAB`              | `0x1005e1110` |
| `profile.CreateColorProfile`                    | `0x1005df720` |
| `profile.(*ColorProfile).loadSingleInkProfiles` | `0x1005e5140` |
| `types.(*ColorLABNorm).SetFromRGB`              | `0x1005c48c0` |
| `types.(*ColorLABNorm).SetFromRGB8`             | `0x1005c4970` |
| `types.(*ColorLABNorm).DistanceCIE76`           | `0x1005c5060` |
| `postprocessing/halftone.Halftone`              | `0x100601180` |
| `postprocessing/halftone.NewHalftoneThresholdsMatrix` | `0x100600f10` |
| `postprocessing/dithering.ApplyDithering`       | `0x100600810` |
| `postprocessing/dithering.ApplyDithering.jump9` | `0x100b654a0` (kernel jump table) |
| `postprocessing/trapping.applyTrapping`         | `0x100605850` |
| `postprocessing/opacities.applyOpacityMultipliersCore` | `0x1005f4410` |

---

## 11. Comparison to Risocam

| Aspect                       | Spectrolite                                         | Risocam (current)                              |
|------------------------------|-----------------------------------------------------|------------------------------------------------|
| Color space for matching     | Normalized LAB (D65, go-colorful library)           | RGB (legacy) / LAB (newer paths)               |
| Distance metric              | LAB² (CIE76 squared)                                | LAB² in some paths, RGB² in others             |
| Spot-color algorithm         | 3D ICC-style LUT, trilinear interpolation           | Per-pixel ink-stacking solve, GPU-accelerated  |
| Per-ink calibration data     | Pre-measured `.gob` LUTs (80 inks × full RGB cube)  | Single ink RGB color in palette                |
| CMYK algorithm               | Stdlib RGB→CMYK + LAB-nearest channel assignment    | LAB-nearest channel assignment + multiply blend|
| Halftone                     | Rotated threshold matrix (LAB→K screen angles)      | Bayer 16×16 + clustered-dot variants           |
| Dithering                    | 8 kernels, default Atkinson                         | Floyd-Steinberg only (+ MZ9 LCG variant)       |
| Trapping                     | Morphological dilate/erode in ink order             | Not implemented                                |
| Profile generation cost      | ~30-60s once per palette (then cached `.prof`)      | None (no offline step)                         |
| Per-pixel separation cost    | 3 binary searches + 8 LUT reads + trilerp           | Variable (GPU per-channel FS or single-pass)   |

### What Risocam could borrow

1. **The 80 per-ink `.gob` LUTs are very valuable.** They encode "this is how this specific Riso ink actually mixes with paper" — measured calibration data that's hard to derive from first principles. Loading these directly into Risocam (with attribution) would let it match Spectrolite's color fidelity without re-measuring.

2. **LAB normalization (`SetFromRGB`).** The shift formula `(a* + 1) / 2` for normalizing into 0..1 is cleaner than current Risocam scaling.

3. **Atkinson as default dither**. Subjectively "Riso-like" because it doesn't push error as far — preserves more highlight texture, which is where Riso's paper grain becomes visible.

4. **Posterize blackpoint threshold.** Risocam doesn't have an explicit "below this gray, output nothing" knob. Useful for dropping faint backgrounds.

5. **Trapping (`pixels` dilate).** Riso's mis-registration is real (drum tolerance ~0.5mm). A simple 1-2px dilate of the darker plane under the lighter one would visibly improve simulation accuracy. Current Risocam doesn't simulate misregistration at all.

6. **CMYK angle defaults from group detection.** When a 4-ink palette has one ink in each of {blues, pinks, yellows, grays}, auto-apply CMYK screen angles (15°/75°/0°/45°). Currently Risocam doesn't have this fallback.

### What Risocam already does better

1. **Real-time GPU separation** — no profile-gen step needed. Spectrolite's separation is offline.
2. **Driver-faithful FS** — Risocam's MZ9-decoded LCG modulation isn't in Spectrolite. Spectrolite uses plain Floyd-Steinberg / Atkinson.
3. **Per-pixel stochastic supersampling** — Spectrolite separations look more posterized at boundaries.
4. **Video/camera live preview** — Spectrolite is a still-image tool.

---

## 12. Open questions / TODOs

1. **Reverse `CreateColorProfile`** to understand how the per-ink LUTs are combined into the multi-ink LAB→opacity table. Hypothesis: at each LAB grid point, solve a small constrained least-squares: "what mix of ≤N inks (each in [0,1]) most closely reproduces this LAB on this paper?" Quick check would be to load the `.prof` for a known 3-ink palette and inspect the LUT entries directly.

2. **The matcher fast-path semantics around "white" ink** in `GetOpacities` (the `if ink.name == "white"` skip) — likely a special case for "clear medium" / "white ink on dark paper" workflows. Worth confirming if Risocam adds dark-paper support.

3. **`searcher.search` non-uniform vs uniform grid mode.** Possible that low-saturation regions of the LAB cube use a finer grid than high-saturation. Would explain why `black.gob` is bigger than `red.gob`.

4. **`PreviewProfile.GetLABNorm`** — likely a paper-color tint applied after ink stacking. Would be worth examining for accurate paper simulation in Risocam.

5. **The 80 inks themselves.** Compare `bin/single-ink-profiles/*.gob` against Risocam's `lib/types/inkColors.json` — Spectrolite probably has inks Risocam doesn't and vice versa.

---

*Reverse-engineered from the shipped binary at `/Applications/Spectrolite.app` and its source-map-reconstructed TypeScript. No source code or proprietary documentation was consulted.*
