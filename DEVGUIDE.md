# RISO/CAM Developer Guide

## Architecture Overview

RISO/CAM is a zero-build-tool browser app — no bundler, no transpiler. All JS loads via `<script src>` tags in `index.html`. Modules use the **IIFE namespace pattern**: each file wraps its code in `(function(R){ ... })(window.R)` and exports public functions onto `window.R`.

### File Map

```
index.html          (1411 lines) — HTML structure + GLSL shaders
css/main.css        (325 lines)  — All styles
js/data.js          (139 lines)  — Constants: RISO_CAL, PROFILES, PAPER_COLORS, etc.
js/state.js         (191 lines)  — Mutable state + utility functions (NOT IIFE-wrapped)
js/undo.js          (108 lines)  — Undo/redo stack
js/compare.js       (121 lines)  — Before/after compare overlay
js/renderer.js      (437 lines)  — WebGL init, uniforms, render loop
js/source.js        (312 lines)  — Image/video/GIF/camera input
js/save.js          (437 lines)  — PNG, GIF, separation ZIP export
js/ui-controls.js   (632 lines)  — Sliders, pickers, profiles, step groups
js/ui-paper.js      (95 lines)   — Paper color/texture UI
js/phone.js         (702 lines)  — Phone mode, boot sequence, PWA
```

### Script Load Order (matters!)

```
data.js → state.js → undo.js → compare.js → renderer.js →
source.js → save.js → ui-controls.js → ui-paper.js → phone.js
```

`data.js` initializes `window.R`. `state.js` declares shared globals. All subsequent files are IIFE-wrapped.

---

## Module Pattern

### IIFE files (undo.js, compare.js, renderer.js, source.js, save.js, ui-controls.js, ui-paper.js, phone.js)

```js
(function(R) {
"use strict";

// Private to this module
let localVar = 0;
function helperFn() { ... }

// Public — accessible as R.myFunction() from other files and onclick handlers
function myFunction() { ... }

// --- Namespace exports ---
R.myFunction = myFunction;
})(window.R);
```

### Non-IIFE files (data.js, state.js)

These run in global lexical scope. Variables declared here (`let channels`, `let gl`, etc.) are accessible by name from all files. This is intentional — they hold shared mutable state.

---

## Key Rules for Editing

### Adding a new function

1. Write it inside the IIFE of the appropriate file
2. If other files or HTML onclick handlers need it, add `R.myFunction = myFunction;` to the exports section
3. Call it as `R.myFunction()` from other files, or bare `myFunction()` within the same file

### Adding shared state

Put it in `state.js` (not IIFE-wrapped) so all files can access it by name:
```js
let myNewFlag = false;  // accessible everywhere
```

### Adding constants

Put them in `data.js`:
```js
const MY_LOOKUP = { ... };  // accessible everywhere
```

### HTML onclick handlers

All inline handlers must use the `R.` prefix:
```html
<button onclick="R.myFunction()">Click</button>
```

Dynamic handlers in JS template literals follow the same rule:
```js
html += `<button onclick="R.doThing(${i})">Go</button>`;
```

### Cross-file function calls

- From IIFE file A calling IIFE file B's function: **must use `R.funcName()`**
- From IIFE file calling state.js function (e.g. `markDirty`): **bare name OK** (state.js is global)
- Within the same IIFE: **bare name OK**

---

## Render Pipeline

### How a frame gets drawn

1. Something calls `markDirty()` or `scheduleRender()`
2. `scheduleRender()` queues `R.render` via `requestAnimationFrame`
3. `render()` checks dirty flag, does FPS throttling for riso-feel
4. If drawing: sizes canvas, calls `setRenderUniforms()` (56 uniforms), draws quad
5. Fragment shader does: RGB→CMYK separation → per-channel dithering → LUT color mapping → overprint blending → paper texture

### Key uniforms

The shader has 4 layer slots. Each gets: ink color (`u_ink0-3`), misregistration offset (`u_off0-3`), halftone angle (`u_angle0-3`), LUT data (`u_lutA/B/C/D 0-3`), density (`u_dens0-3`).

### Dirty flag system

- `needsRedraw = true` → next RAF will render
- `markDirty()` — coalesces multiple calls per frame, then schedules
- `needsAspectUpdate = true` → canvas resize on next frame
- Idle frames skip GPU work entirely (important for battery life)

---

## Error Handling

- **WebGL context loss**: Automatic recovery via `webglcontextrestored` event (renderer.js)
- **Shader errors**: `initGL()` aborts with toast on compile/link failure
- **Render loop**: Wrapped in try/catch — errors logged, loop stays alive
- **Camera**: try/catch with "Camera not available" toast
- **Save operations**: try/catch with "Save failed" / "GIF save failed" toasts
- **ImageDecoder**: Falls back to `<img>` DOM approach on failure

---

## Memory Management

- `URL.createObjectURL()` — always call `revokeObjectURL()` after media loads
- `ImageDecoder` — call `.close()` on success AND error paths
- Event listeners — `phBindBcs()` and `phBindSliders()` use guard flags to prevent re-binding
- GIF frames — `stopVideo()` nullifies `gifFrames` array and its canvas refs

---

## Phone Mode

Phone mode is state-based (`phoneActive` flag), not screen-size based. `togglePhoneMode()` flips the flag and `layoutSwitch()` moves the canvas between desktop/phone viewfinders.

Phone overlays (Inks, Paper, Look, Settings, Info) are populated dynamically by `phPopulateOverlay()`. They share constants with desktop (STEP_PRESETS, PAPER_TEX_INTENSITY from data.js).

---

## Common Tasks

### Add a new ink

1. Add calibration entry to `RISO_CAL` in `data.js` (hex, gamma, grainMul, fluo, 5-point LUT)
2. Add to `RISO_COLORS` array (auto-generated from `RISO_CAL`)
3. Optionally add to an `INK_LIST` group in `ui-controls.js`

### Add a new dither mode

1. Add mode constant and shader branch in the fragment shader (`index.html`)
2. Add button in HTML toolbar
3. Add `R.setMode('mymode')` handler (already generic in ui-controls.js)

### Add a new slider

1. Add HTML: `<input type="range" id="mySlider">` with `oninput="R.cacheSlider('myKey',this.value)"`
2. Add default value to `cached` object in `state.js`
3. Use `cached.myKey` in `setRenderUniforms()` (renderer.js) to pass to shader
4. Add corresponding `uniform float u_myKey;` in fragment shader

### Add a new profile

Add entry to `PROFILES` array in `data.js`:
```js
{name:'MyProfile', colors:['Blue','Bright Red'], settings:{grainSize:1.5, lpi:35}}
```
