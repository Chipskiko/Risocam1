// RISO AMT — WebGPU wavefront error diffusion (research item #4).
//
// True Floyd-Steinberg with the driver's Table A/B/C threshold modulation,
// run as a compute shader using the Metaxas wavefront schedule (the same
// trick as mpv's error_diffusion.glsl): one workgroup, one thread per image
// row, thread t processing pixel x at step k = x + 2t. Each row trails the
// row above by 2 px, which satisfies every FS dependency, so all rows dither
// concurrently. Inter-row error hand-off lives in a tiny per-row ring buffer
// in workgroup memory (a written cell is consumed ≤3 steps later, so 8 slots
// per row suffice).
//
// DIFFERENCE vs the CPU path: scan order is RASTER (all rows L→R), not
// serpentine — a zigzag wavefront has no consistent dependency direction. The
// driver's per-pixel threshold dither (Tables A/B/C) is specifically there to
// decorrelate FS structure, which also masks most raster-vs-serpentine
// directional character; A/B with the flag before trusting it for finals.
//
// Bands: a workgroup is capped at 512 threads, so images taller than 512 rows
// run as sequential band dispatches (same warm-up-rows trick as the CPU
// band-parallel path — each band re-dithers 32 rows above it, discarded).
//
// API (window.RisoAmtGPU):
//   ready()                    → Promise<bool> (lazy device + pipeline init)
//   runChannel(dens, W, H)     → Promise<{plane: Uint8Array, strideW: number}>
//     plane is row-padded to strideW = ceil(W/4)*4 px; upload with
//     gl.pixelStorei(gl.UNPACK_ROW_LENGTH, strideW) — no repack needed.

(function (root) {
'use strict';

const WG = 512;       // threads per workgroup = rows in flight per band
const RINGW = 8;      // error ring slots per row (lifetime ≤ 3 steps)
const WARM = 32;      // discarded warm-up rows between bands

const WGSL = `
struct Params {
  W: u32,
  strideW: u32,
  Hb: u32,
  gy0: u32,
  warm: u32,
  taLen: u32,
  _p0: u32,
  _p1: u32,
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> dens: array<u32>;
@group(0) @binding(2) var<storage, read> tba: array<i32>;
@group(0) @binding(3) var<storage, read> tc: array<i32>;
@group(0) @binding(4) var<storage, read_write> outPlane: array<u32>;

var<workgroup> ring: array<i32, ${WG * RINGW}>;

@compute @workgroup_size(${WG})
fn main(@builtin(local_invocation_id) lid: vec3<u32>) {
  let t = lid.x;
  for (var s = 0u; s < ${RINGW}u; s = s + 1u) { ring[t * ${RINGW}u + s] = 0; }
  workgroupBarrier();

  let W = i32(P.W);
  let isRow = t < P.Hb;
  let gy = P.gy0 + t;
  var rowBase = 0u;
  if (isRow) { rowBase = (gy * P.W) % P.taLen; }
  let rowPix = gy * P.strideW;          // strided row start (dens AND out)
  let emit = isRow && (t >= P.warm);
  var errLeft = 0;
  var outWord = 0u;
  let steps = P.W + 2u * P.Hb;

  for (var k = 0u; k < steps; k = k + 1u) {
    if (isRow) {
      let x = i32(k) - 2 * i32(t);
      if (x >= 0 && x < W) {
        let pix = rowPix + u32(x);
        let pInv = i32((dens[pix >> 2u] >> ((pix & 3u) * 8u)) & 0xffu);
        var cc = rowBase + u32(x);
        if (cc >= P.taLen) { cc = cc - P.taLen; }
        var envI = pInv;
        if (envI > 192) { envI = 192; }
        let ditherAdj = (tba[cc] * tc[envI]) >> 8u;
        let slot = t * ${RINGW}u + (u32(x) & ${RINGW - 1}u);
        let errIn = errLeft + ring[slot];
        ring[slot] = 0;
        let base = (errIn >> 8u) + pInv;
        var newErr = base;
        var bit = false;
        if (base + ditherAdj > 254) { bit = true; newErr = base - 255; }
        if (emit) {
          if (bit) { outWord = outWord | (0xffu << ((u32(x) & 3u) * 8u)); }
          if ((u32(x) & 3u) == 3u || x == W - 1) {
            outPlane[pix >> 2u] = outWord;
            outWord = 0u;
          }
        }
        errLeft = 0;
        if (newErr != 0) {
          errLeft = newErr * 112;
          if (t + 1u < P.Hb) {
            let rb = (t + 1u) * ${RINGW}u;
            if (x > 0)     { ring[rb + (u32(x - 1) & ${RINGW - 1}u)] += newErr * 48; }
            ring[rb + (u32(x) & ${RINGW - 1}u)] += newErr * 80;
            if (x < W - 1) { ring[rb + (u32(x + 1) & ${RINGW - 1}u)] += newErr * 16; }
          }
        }
      }
    }
    workgroupBarrier();
  }
}
`;

// Density-stage kernels: projection + tone curve, then the solid-fill box
// mean (separable) + lift — the GPU equivalents of the renderer's PASS 1 and
// riso-amt.js buildDensityU8/_applySolidFillU8. All operate per dens-WORD
// (4 px) so no two threads read-modify-write the same u32.
const PIPE_WGSL = `
struct ProjParams {
  W: u32, strideW: u32, H: u32, words: u32,
  paper: vec4<f32>,          // rgb 0..255
  ink: vec4<f32>,            // rgb 0..255
  dlen2: f32, covScale: f32, sfThr: f32, sfRampInv: f32,
  sfStrength: f32, sfRadius: i32, _p0: u32, _p1: u32,
};
@group(0) @binding(0) var<uniform> P: ProjParams;
@group(0) @binding(1) var<storage, read> rgba: array<u32>;
@group(0) @binding(2) var<storage, read> toneCurve: array<f32>;
@group(0) @binding(3) var<storage, read_write> dens: array<u32>;
@group(0) @binding(4) var<storage, read_write> tmp: array<f32>;

fn densByte(pix: u32) -> f32 {
  return f32((dens[pix >> 2u] >> ((pix & 3u) * 8u)) & 0xffu);
}

@compute @workgroup_size(256)
fn project(@builtin(global_invocation_id) gid: vec3<u32>) {
  for (var w = 0u; w < 4u; w = w + 1u) {
    let wordIdx = gid.x * 4u + w;
    if (wordIdx >= P.words) { return; }
    var word = 0u;
    for (var b = 0u; b < 4u; b = b + 1u) {
      let pix = wordIdx * 4u + b;
      let y = pix / P.strideW;
      let x = pix % P.strideW;
      if (x < P.W && y < P.H) {
        let s = rgba[pix];
        let r = f32(s & 0xffu) - P.paper.x;
        let g = f32((s >> 8u) & 0xffu) - P.paper.y;
        let bl = f32((s >> 16u) & 0xffu) - P.paper.z;
        let dr = P.ink.x - P.paper.x;
        let dg = P.ink.y - P.paper.y;
        let db = P.ink.z - P.paper.z;
        let t = clamp((r * dr + g * dg + bl * db) / P.dlen2, 0.0, 1.0);
        let ig = u32(floor(255.0 * (1.0 - t) + 0.5));
        let v = clamp(toneCurve[ig] * P.covScale, 0.0, 1.0);
        let d8 = u32(floor(v * 255.0 + 0.5));
        word = word | (d8 << (b * 8u));
      }
    }
    dens[wordIdx] = word;
  }
}

@compute @workgroup_size(256)
fn hsum(@builtin(global_invocation_id) gid: vec3<u32>) {
  for (var w = 0u; w < 4u; w = w + 1u) {
    let wordIdx = gid.x * 4u + w;
    if (wordIdx >= P.words) { return; }
    for (var b = 0u; b < 4u; b = b + 1u) {
      let pix = wordIdx * 4u + b;
      let y = pix / P.strideW;
      let x = i32(pix % P.strideW);
      if (x < i32(P.W) && y < P.H) {
        var sum = 0.0;
        var cnt = 0.0;
        for (var dx = -P.sfRadius; dx <= P.sfRadius; dx = dx + 1) {
          let xx = x + dx;
          if (xx >= 0 && xx < i32(P.W)) { sum = sum + densByte(y * P.strideW + u32(xx)); cnt = cnt + 1.0; }
        }
        tmp[pix] = sum / cnt;
      }
    }
  }
}

@compute @workgroup_size(256)
fn vlift(@builtin(global_invocation_id) gid: vec3<u32>) {
  for (var w = 0u; w < 4u; w = w + 1u) {
    let wordIdx = gid.x * 4u + w;
    if (wordIdx >= P.words) { return; }
    var word = dens[wordIdx];
    var changed = false;
    for (var b = 0u; b < 4u; b = b + 1u) {
      let pix = wordIdx * 4u + b;
      let y = i32(pix / P.strideW);
      let x = pix % P.strideW;
      if (x < P.W && y < i32(P.H)) {
        var sum = 0.0;
        var cnt = 0.0;
        for (var dy = -P.sfRadius; dy <= P.sfRadius; dy = dy + 1) {
          let yy = y + dy;
          if (yy >= 0 && yy < i32(P.H)) { sum = sum + tmp[u32(yy) * P.strideW + x]; cnt = cnt + 1.0; }
        }
        let m = sum / cnt;
        if (m > P.sfThr) {
          var t = clamp((m - P.sfThr) * P.sfRampInv, 0.0, 1.0);
          t = t * t * (3.0 - 2.0 * t);
          let v = f32((word >> (b * 8u)) & 0xffu);
          let nv = u32(floor(v + (255.0 - v) * P.sfStrength * t + 0.5));
          word = (word & ~(0xffu << (b * 8u))) | (nv << (b * 8u));
          changed = true;
        }
      }
    }
    if (changed) { dens[wordIdx] = word; }
  }
}
`;

let _device = null;
let _pipeline = null;
let _pipeProject = null;
let _pipeHsum = null;
let _pipeVlift = null;
let _toneBuf = null;
let _tableBufs = null;
let _initPromise = null;
let _failed = false;

async function _init() {
  if (_device) return true;
  if (_failed) return false;
  if (!navigator.gpu) { _failed = true; return false; }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) { _failed = true; return false; }
    // Default device limits cap workgroup_size X at 256; our wavefront wants
    // WG=512 rows in flight. Request it when the adapter supports it (most
    // desktop GPUs allow 1024); bail to CPU path otherwise.
    if (adapter.limits.maxComputeWorkgroupSizeX < WG ||
        adapter.limits.maxComputeInvocationsPerWorkgroup < WG) {
      console.warn('[RisoAmtGPU] adapter workgroup limit < ' + WG + ' — using CPU path');
      _failed = true; return false;
    }
    // Default device limits also cap storage buffers at 128 MB (binding) /
    // 256 MB (buffer) — a 600 dpi A3 RGBA plane is ~300 MB, so creation would
    // fail (async + silent: empty masters). Request the adapter's real limits.
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxComputeWorkgroupSizeX: WG,
        maxComputeInvocationsPerWorkgroup: WG,
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    });
    device.lost.then(() => {
      _device = null; _pipeline = null; _tableBufs = null;
      _pipeProject = null; _pipeHsum = null; _pipeVlift = null; _toneBuf = null;
    });
    const module = device.createShaderModule({ code: WGSL });
    _pipeline = await device.createComputePipelineAsync({
      layout: 'auto',
      compute: { module: module, entryPoint: 'main' },
    });
    // Density-stage pipelines (projection + solid fill) share one module.
    const pmod = device.createShaderModule({ code: PIPE_WGSL });
    [_pipeProject, _pipeHsum, _pipeVlift] = await Promise.all([
      device.createComputePipelineAsync({ layout: 'auto', compute: { module: pmod, entryPoint: 'project' } }),
      device.createComputePipelineAsync({ layout: 'auto', compute: { module: pmod, entryPoint: 'hsum' } }),
      device.createComputePipelineAsync({ layout: 'auto', compute: { module: pmod, entryPoint: 'vlift' } }),
    ]);
    // Tone curve (256 × f32) — same LUT the CPU density build uses.
    {
      const tcArr = Float32Array.from(root.RisoAmt.TONE_CURVE);
      _toneBuf = device.createBuffer({ size: tcArr.byteLength, usage: GPUBufferUsage.STORAGE, mappedAtCreation: true });
      new Float32Array(_toneBuf.getMappedRange()).set(tcArr);
      _toneBuf.unmap();
    }
    // Tables — composed B∘A and the tent envelope C, from the CPU module.
    const TA = root.RisoAmt.RISO_DRIVER_TABLE_A, TB = root.RisoAmt.RISO_DRIVER_TABLE_B;
    const tba = new Int32Array(TA.length);
    for (let k = 0; k < TA.length; k++) tba[k] = TB[TA[k]];
    const tc = Int32Array.from(root.RisoAmt.RISO_DRIVER_TABLE_C);
    function makeBuf(arr) {
      const b = device.createBuffer({ size: arr.byteLength, usage: GPUBufferUsage.STORAGE, mappedAtCreation: true });
      new Int32Array(b.getMappedRange()).set(arr);
      b.unmap();
      return b;
    }
    _tableBufs = { tba: makeBuf(tba), tc: makeBuf(tc), taLen: TA.length };
    _device = device;
    console.log('[RisoAmtGPU] WebGPU wavefront ED ready (wg=' + WG + ', ringW=' + RINGW + ')');
    return true;
  } catch (e) {
    console.warn('[RisoAmtGPU] init failed:', e.message || e);
    _failed = true;
    return false;
  }
}

function ready() {
  if (!_initPromise) _initPromise = _init();
  return _initPromise;
}

// dens: tight Uint8Array (W*H). Returns { plane (strided), strideW }.
async function runChannel(dens, W, H) {
  const ok = await ready();
  if (!ok) throw new Error('WebGPU unavailable');
  const device = _device;
  const strideW = (W + 3) & ~3;
  const bytes = strideW * H;

  // Upload density with row padding (so 4-px output words never straddle rows).
  const densBuf = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE, mappedAtCreation: true });
  {
    const dst = new Uint8Array(densBuf.getMappedRange());
    if (strideW === W) dst.set(dens);
    else for (let y = 0; y < H; y++) dst.set(dens.subarray(y * W, (y + 1) * W), y * strideW);
    densBuf.unmap();
  }
  const outBuf = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readBuf = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

  // Sequential band dispatches in one submit (warm-up rows discarded).
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(_pipeline);
  let outY0 = 0;
  while (outY0 < H) {
    const warm = outY0 > 0 ? Math.min(WARM, outY0) : 0;
    const bandStart = outY0 - warm;
    const Hb = Math.min(WG, H - bandStart);
    const params = new Uint32Array([W, strideW, Hb, bandStart, warm, _tableBufs.taLen, 0, 0]);
    const pBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true });
    new Uint32Array(pBuf.getMappedRange()).set(params);
    pBuf.unmap();
    const bg = device.createBindGroup({
      layout: _pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: pBuf } },
        { binding: 1, resource: { buffer: densBuf } },
        { binding: 2, resource: { buffer: _tableBufs.tba } },
        { binding: 3, resource: { buffer: _tableBufs.tc } },
        { binding: 4, resource: { buffer: outBuf } },
      ],
    });
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(1);
    outY0 = bandStart + Hb;       // rows [bandStart+warm, bandStart+Hb) emitted
  }
  pass.end();
  enc.copyBufferToBuffer(outBuf, 0, readBuf, 0, bytes);
  device.queue.submit([enc.finish()]);
  await readBuf.mapAsync(GPUMapMode.READ);
  const plane = new Uint8Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();
  densBuf.destroy(); outBuf.destroy(); readBuf.destroy();
  return { plane: plane, strideW: strideW };
}

// Full-GPU prepass: ONE RGBA upload, then per channel project → solid-fill →
// wavefront FS → readback. The main thread does no per-pixel math at all —
// this replaces both the serial projection pass and the worker density jobs.
// chans: [{ chIdx, ink:[r,g,b] 0..255, paper:[r,g,b] 0..255 }]
// opts:  { coverageScale, solidFillThreshold, solidFillRadius, solidFillStrength }
// Returns [{ chIdx, plane (strided bytes), strideW }].
async function runChannelsFromRGBA(rgba, W, H, chans, opts) {
  const ok = await ready();
  if (!ok) throw new Error('WebGPU unavailable');
  const device = _device;
  const strideW = (W + 3) & ~3;
  const planeBytes = strideW * H;
  const words = planeBytes >> 2;
  // The RGBA + solid-fill temp buffers are 4 bytes/px — bail (→ CPU fallback)
  // if the device can't bind them.
  if (planeBytes * 4 > device.limits.maxStorageBufferBindingSize) {
    throw new Error('image exceeds device storage-buffer limit (' + (planeBytes * 4) + ' bytes)');
  }
  const o = opts || {};
  const covScale = (typeof o.coverageScale === 'number') ? o.coverageScale : 1.0;
  const sfThr = ((typeof o.solidFillThreshold === 'number') ? o.solidFillThreshold : 0.55) * 255;
  const sfRadius = (typeof o.solidFillRadius === 'number') ? o.solidFillRadius : 5;
  const sfStrength = (typeof o.solidFillStrength === 'number') ? o.solidFillStrength : 1.0;
  const solidFillOn = sfThr < 255;

  // Source RGBA, row-padded to strideW px (1 u32 per px).
  const rgbaBuf = device.createBuffer({ size: planeBytes * 4, usage: GPUBufferUsage.STORAGE, mappedAtCreation: true });
  {
    const dst = new Uint8Array(rgbaBuf.getMappedRange());
    if (strideW === W) dst.set(rgba.subarray(0, W * H * 4));
    else for (let y = 0; y < H; y++) dst.set(rgba.subarray(y * W * 4, (y + 1) * W * 4), y * strideW * 4);
    rgbaBuf.unmap();
  }
  // Reused per channel: density, solid-fill temp, FS output.
  const densBuf = device.createBuffer({ size: planeBytes, usage: GPUBufferUsage.STORAGE });
  const tmpBuf = device.createBuffer({ size: planeBytes * 4, usage: GPUBufferUsage.STORAGE });
  const outBuf = device.createBuffer({ size: planeBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });

  const results = [];
  for (const ch of chans) {
    const dr = ch.ink[0] - ch.paper[0], dg = ch.ink[1] - ch.paper[1], db = ch.ink[2] - ch.paper[2];
    const dlen2 = dr * dr + dg * dg + db * db;
    // ProjParams (uniform, 80 bytes; vec4 alignment per WGSL rules)
    const pData = new ArrayBuffer(80);
    const u = new Uint32Array(pData), f = new Float32Array(pData), i = new Int32Array(pData);
    u[0] = W; u[1] = strideW; u[2] = H; u[3] = words;
    f[4] = ch.paper[0]; f[5] = ch.paper[1]; f[6] = ch.paper[2]; f[7] = 0;
    f[8] = ch.ink[0]; f[9] = ch.ink[1]; f[10] = ch.ink[2]; f[11] = 0;
    f[12] = dlen2; f[13] = covScale; f[14] = sfThr; f[15] = 1 / (0.15 * 255);
    f[16] = sfStrength; i[17] = sfRadius;
    const pBuf = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true });
    new Uint8Array(pBuf.getMappedRange()).set(new Uint8Array(pData));
    pBuf.unmap();
    // layout:'auto' creates a layout with ONLY the bindings each entry point
    // statically uses — passing extra entries fails bind-group validation
    // (async, silently no-ops the dispatch). So: exact lists per pipeline.
    const allBufs = { 0: pBuf, 1: rgbaBuf, 2: _toneBuf, 3: densBuf, 4: tmpBuf };
    const mkBg = (pipe, bindings) => device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: bindings.map(b => ({ binding: b, resource: { buffer: allBufs[b] } })),
    });
    const groups = Math.ceil(words / (256 * 4));
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(_pipeProject); pass.setBindGroup(0, mkBg(_pipeProject, [0, 1, 2, 3])); pass.dispatchWorkgroups(groups);
    if (solidFillOn) {
      pass.setPipeline(_pipeHsum); pass.setBindGroup(0, mkBg(_pipeHsum, [0, 3, 4])); pass.dispatchWorkgroups(groups);
      pass.setPipeline(_pipeVlift); pass.setBindGroup(0, mkBg(_pipeVlift, [0, 3, 4])); pass.dispatchWorkgroups(groups);
    }
    // Wavefront FS bands over the on-GPU density buffer.
    pass.setPipeline(_pipeline);
    let outY0 = 0;
    while (outY0 < H) {
      const warm = outY0 > 0 ? Math.min(WARM, outY0) : 0;
      const bandStart = outY0 - warm;
      const Hb = Math.min(WG, H - bandStart);
      const fsParams = new Uint32Array([W, strideW, Hb, bandStart, warm, _tableBufs.taLen, 0, 0]);
      const fsBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true });
      new Uint32Array(fsBuf.getMappedRange()).set(fsParams);
      fsBuf.unmap();
      pass.setBindGroup(0, device.createBindGroup({
        layout: _pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: fsBuf } },
          { binding: 1, resource: { buffer: densBuf } },
          { binding: 2, resource: { buffer: _tableBufs.tba } },
          { binding: 3, resource: { buffer: _tableBufs.tc } },
          { binding: 4, resource: { buffer: outBuf } },
        ],
      }));
      pass.dispatchWorkgroups(1);
      outY0 = bandStart + Hb;
    }
    pass.end();
    const readBuf = device.createBuffer({ size: planeBytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc.copyBufferToBuffer(outBuf, 0, readBuf, 0, planeBytes);
    device.queue.submit([enc.finish()]);
    await readBuf.mapAsync(GPUMapMode.READ);
    const plane = new Uint8Array(readBuf.getMappedRange().slice(0));
    readBuf.unmap(); readBuf.destroy();
    results.push({ chIdx: ch.chIdx, plane: plane, strideW: strideW });
  }
  rgbaBuf.destroy(); densBuf.destroy(); tmpBuf.destroy(); outBuf.destroy();
  return results;
}

root.RisoAmtGPU = { ready: ready, runChannel: runChannel, runChannelsFromRGBA: runChannelsFromRGBA };

})(typeof window !== 'undefined' ? window : self);
