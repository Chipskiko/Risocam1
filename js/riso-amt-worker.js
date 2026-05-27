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

self.importScripts('./riso-amt.js?v=22');

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
  const { id, input, W, H, opts, sigma } = e.data;
  try {
    const inputArr = (input instanceof ArrayBuffer) ? new Uint8Array(input) : input;
    // FS
    const bits = self.RisoAmt.runAmt(inputArr, W, H, opts || {});
    // Unpack bits → plane (0/255 per pixel)
    const plane = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const bit = (bits[i >> 3] >> (7 - (i & 7))) & 1;
      plane[i] = bit ? 255 : 0;
    }
    // Optional ink-spread blur
    const blurred = (sigma > 0.01) ? gaussianBlurPlane(plane, W, H, sigma) : plane;
    // Transfer plane buffer to main thread (zero-copy)
    self.postMessage({ id, plane: blurred.buffer }, [blurred.buffer]);
  } catch (err) {
    self.postMessage({ id, error: err.message || String(err) });
  }
};
