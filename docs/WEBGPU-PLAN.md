# WebGPU (D3D12) live path — project log

## Why

Windows ANGLE feeds WebGL shaders to Microsoft's legacy D3D11 compiler
(FXC-class), which NEVER finishes compiling the megashader on Intel iGPUs —
the original whole-Edge-freeze bug. The shipped mitigation (per-mode slim
shader variants, D3D only) works but costs a one-time compile per mode
(4–60 s, worst: letters 62 s) and stubs the NNLS solver. WebGPU on Windows
is Dawn → D3D12 → DXC, the modern LLVM-based compiler.

## Measured (probe pages, real hardware)

| stage | Apple M2 Pro (Metal) | Intel UHD gen-12lp (D3D12) |
|---|---|---|
| glslang GLSL→SPIR-V (wasm) | 84 ms | 3.9 s |
| tint SPIR-V→WGSL (wasm) | 1.3 s | **45.9 s** |
| createRenderPipelineAsync (FULL shader) | 1.8 s (26 ms warm) | **34.7 s** |
| frame drawn | yes | yes |

Verdict: the FULL untouched megashader (all modes + NNLS, no slimming)
compiles and runs on the exact machine where D3D11 never finished. DXC cost
is one-time (Dawn pipeline cache lives in the GPU-process profile — immune
to Edge Tracking Prevention; the same cache class already proven on this
machine by WebGL slim variants: 27 s cold → 6 s warm). The runtime
TRANSPILE (~50 s of wasm on that CPU) is the real first-visit cost → moved
to deploy time (below). Note: Chromium ignores WebGPU powerPreference on
Windows (crbug 369219127).

## Architecture (single source of truth — the user's hard requirement)

GLSL in index.html stays the only shader source, edited for the Mac/WebGL
path exactly as today.

- js/wgsl-transform.js — mechanical GLSL ES 1.00 → Vulkan GLSL ES 3.10
  transforms, shared verbatim by the browser test page and the build tool.
- tools/build-wgsl.mjs — deploy-time: extracts the script tags, transforms,
  runs glslang+tint (the vendored wasm under Node with browser shims;
  compile BEFORE twgsl eval — its globals break glslang), emits
  js/gen/shaders-wgsl.js = { srcSha1, fs, vs, uniforms, samplers, layout }.
  deploy-neocities.sh runs it first and aborts on failure (free shader
  validation per deploy). Byte-parity with the browser toolchain verified
  by sha1 (5c776a96… both sides).
- Runtime (phase 2): D3D machines load the pregenerated WGSL (srcSha1
  checked against the live script tags — stale ⇒ WebGL-slim fallback +
  warning), build the pipeline async, and the app SWAPS the live view from
  WebGL-slim to WebGPU when ready. No user-visible stall: slim boots as
  today, full-quality takes over silently. Mac path byte-identical, never
  touches any of this.

## Transform rules (each forced by a real error from the actual shader)

1. Rename identifiers GLSL 3.10 / WGSL reserve (active, ref, target, macro,
   …) — tint preserves names into WGSL where Dawn rejects its keywords.
2. Gather all 170 scalar/vector uniforms (incl. comma multi-declarations)
   into ONE anonymous std140 block at binding 0 (anonymous ⇒ member names
   stay valid unprefixed). std140Layout() computes JS-side offsets
   (1104 B total).
3. Split each sampler2D into texture2D+sampler at bindings 2i+1 / 2i+2
   (WGSL has no combined samplers); `#define name name_T, name_S` feeds the
   pair through call sites. Verified: no shader function takes a sampler
   param.
4. texture2D( → rcTex( → textureLod(sampler2D(t,s), uv, 0.0): WGSL forbids
   implicit-derivative sampling in non-uniform control flow; no texture has
   mips so explicit LOD is bit-identical. glslang requires the sampler2D
   constructor at point of use ⇒ pair rides as two params.
5. gl_FragCoord Y-flip via u_res (GL bottom-left vs WebGPU top-left).
6. varying/attribute → layout(location=N) in/out (SPIR-V requirement).
7. Prefix: #version 310 es, precision, located out color.

## Toolchain packaging

- Vendored: js/vendor/glslang.{js,wasm} (@webgpu/glslang 0.0.15; glue
  patched with a window.RC_GLSLANG_WASM_URL locateFile override) and
  js/vendor/twgsl.{js,wasm} (Babylon tint build). The Babylon glslang pair
  is glue/wasm-mismatched — do not use.
- Neocities rejects .wasm uploads AND sends a site-wide CSP header
  (connect-src 'self' data: blob:) killing cross-origin fetch. Browser
  pages therefore load the binaries from base64-in-js vendor files
  (js/vendor/*-wasm-b64.js) via blob: URLs (allowed). gputest.html is the
  end-to-end browser proof page + parity check.

## Phase 2 (next): app integration

webgpu-live.js, D3D-only, ?webgpu flag first:
- Overlay canvas over $gl for WebGPU output; WebGL keeps running everything
  else (prepasses, exports via slim variants) — exports stay WebGL.
- Resource shim: wrap gl.texImage2D/texSubImage2D/bindTexture/activeTexture
  /texParameteri to mirror the 16 texture slots into GPUTextures (uploads
  accept canvases/typed arrays; LUMINANCE → r8, R8 masters → r8unorm; wrap/
  filter from tracked texParameteri). Tone-prepass FBO content readPixels'd
  on (re)bake and mirrored.
- Uniforms: wrap gl.uniform* keyed by a locs-name reverse map → write into
  the std140 staging buffer at layout offsets; upload once per frame.
- Frame: on R.drawFullscreenTiled for the live view (not _saving), sync
  dirty textures + UBO, one render pass, skip the GL draw. u_amtMaster1/
  SEP-LUT unit-10 time-share maps to distinct WebGPU bindings (no share
  needed — 32 bindings available).
- Golden-image harness before the default flips on: deterministic seed
  override, reference PNGs from WebGL, perceptual diff, per-mode.

## Prereq audit notes (2026-07-15)

Shader is unusually portable: zero derivatives, zero discard, zero while,
zero dynamic indexing, 9 constant loops, 94 texture2D calls, 5 gl_FragCoord.
The JS surface is the mass: 1569 gl.* calls (renderer 987, save 284,
source 246), 186 uniforms, 21 preserveDrawingBuffer-dependent readbacks.
GLSL mod() vs WGSL % negative-operand semantics: mod() is translated by
tint, not rewritten — no action needed. WebGPU default limits: 16 sampled
textures + 16 samplers per stage — exactly our count; raiseable via
requiredLimits if ever needed.
