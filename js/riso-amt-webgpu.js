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

let _device = null;
let _pipeline = null;
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
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxComputeWorkgroupSizeX: WG,
        maxComputeInvocationsPerWorkgroup: WG,
      },
    });
    device.lost.then(() => { _device = null; _pipeline = null; _tableBufs = null; });
    const module = device.createShaderModule({ code: WGSL });
    _pipeline = await device.createComputePipelineAsync({
      layout: 'auto',
      compute: { module: module, entryPoint: 'main' },
    });
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

root.RisoAmtGPU = { ready: ready, runChannel: runChannel };

})(typeof window !== 'undefined' ? window : self);
