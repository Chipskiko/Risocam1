// Web Worker for RISO AMT prepass — runs FS + post-process (bit unpack +
// Gaussian blur) off the main thread so animations stay smooth.
//
// Message protocol:
//   in:  { id, input: ArrayBuffer, W, H, opts, sigma }
//   out: { id, plane: ArrayBuffer (W*H bytes, 0..255 blurred plane) }
//        or { id, error }
//
// Returning the BLURRED plane (not raw bits) means the main thread only has
// to do bit-packing into RGBA + texImage2D upload, both of which are fast.

self.importScripts('./riso-amt.js?v=29');

// Same Gaussian blur as renderer.js gaussianBlurPlane — replicated here so
// the worker doesn't need a separate import. Two-pass separable filter.
function gaussianBlurPlane(src, W, H, sigma) {
  if (sigma <= 0.01) return src;
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const klen = radius * 2 + 1;
  const k = new Float32Array(klen);
  let ksum = 0;
  const s2 = 2 * sigma * sigma;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / s2);
    k[i + radius] = v;
    ksum += v;
  }
  for (let i = 0; i < klen; i++) k[i] /= ksum;
  const tmp = new Float32Array(W * H);
  const out = new Uint8Array(W * H);
  // Horizontal pass
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let i = -radius; i <= radius; i++) {
        let xx = x + i;
        if (xx < 0) xx = 0; else if (xx >= W) xx = W - 1;
        s += src[row + xx] * k[i + radius];
      }
      tmp[row + x] = s;
    }
  }
  // Vertical pass
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let i = -radius; i <= radius; i++) {
        let yy = y + i;
        if (yy < 0) yy = 0; else if (yy >= H) yy = H - 1;
        s += tmp[yy * W + x] * k[i + radius];
      }
      const v = s | 0;
      out[y * W + x] = v < 0 ? 0 : (v > 255 ? 255 : v);
    }
  }
  return out;
}

self.onmessage = function(e) {
  // Liveness handshake. The main thread will not dispatch real work until a
  // worker has answered this, because a worker can be constructed successfully
  // and then be silently dead (CSP refusing the script load fires onerror in
  // some browsers and nothing at all in others). Answering proves the script
  // actually ran.
  if (e.data && e.data.ping) { self.postMessage({ pong: e.data.ping }); return; }
  // Band protocol: the input may be a horizontal BAND of a larger image.
  //   globalRowOffset — index of this slice's first row in the full image
  //                     (drives serpentine parity + Table-A column counter so
  //                     the band dithers exactly as that region would in a
  //                     full scan).
  //   discardRows     — warm-up rows at the top of the slice: dithered (to
  //                     build up realistic FS error state) but excluded from
  //                     the returned plane. ED error memory decays in ~10-20
  //                     rows, so 32 warm-up rows make band seams invisible.
  const { id, input, W, H, opts, sigma, globalRowOffset, discardRows } = e.data;
  try {
    const inputArr = (input instanceof ArrayBuffer) ? new Uint8Array(input) : input;
    const runOpts = Object.assign({}, opts || {}, { globalRowOffset: globalRowOffset || 0 });
    // FS over the full slice (including warm-up rows)
    const bits = self.RisoAmt.runAmt(inputArr, W, H, runOpts);
    // Unpack bits → plane (0/255 per pixel), skipping warm-up rows.
    const skip = Math.max(0, discardRows | 0);
    const outH = H - skip;
    const plane = new Uint8Array(W * outH);
    let on = 0;
    const i0 = skip * W;
    for (let i = i0, j = 0; j < W * outH; i++, j++) {
      const bit = (bits[i >> 3] >> (7 - (i & 7))) & 1;
      if (bit) { plane[j] = 255; on++; }
    }
    // Optional ink-spread blur (CPU path only; GPU spread passes sigma=0)
    const blurred = (sigma > 0.01) ? gaussianBlurPlane(plane, W, outH, sigma) : plane;
    // Transfer plane buffer to main thread (zero-copy). `on` = ink-on count
    // for coverage stats (counted here so the main thread doesn't rescan).
    self.postMessage({ id, plane: blurred.buffer, on: on, outH: outH }, [blurred.buffer]);
  } catch (err) {
    self.postMessage({ id, error: err.message || String(err) });
  }
};
