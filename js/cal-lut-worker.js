// Web Worker — pre-bakes per-ink calibrated coverage→color curve.
//
// Each ink's `lutBlend` is a 5-point Fritsch-Carlson monotone cubic Hermite
// (smooth interpolation through measured swatch samples at 0/10/30/50/70/100%).
// In the fragment shader it costs ~50 instructions and is invoked 8-12 times
// per pixel (calBlend + calBlendOpaque + grain modulation). Replacing those
// inline evaluations with a single texture2D() lookup is a clear perf win
// — 4 inks × 256 coverage samples = 4 KB texture, fits cache trivially.
//
// Message protocol:
//   in:  { id, inks: [{paper:[r,g,b], p10:[r,g,b], p30, p50, p70, p100}, ...] }
//   out: { id, lut: ArrayBuffer(4 * 256 * 4 bytes RGBA8) }
//
// Layout: row-major. row=layerIdx (0..3), col=coverage*255. Empty slots
// are filled with paper color (no-op when shader samples them).

function monoTangent(v0, v1, v2, h0, h1) {
  const d0r = (v1[0] - v0[0]) / h0;
  const d0g = (v1[1] - v0[1]) / h0;
  const d0b = (v1[2] - v0[2]) / h0;
  const d1r = (v2[0] - v1[0]) / h1;
  const d1g = (v2[1] - v1[1]) / h1;
  const d1b = (v2[2] - v1[2]) / h1;
  // Fritsch-Carlson harmonic mean — zero on sign-change to prevent overshoot
  function tan1(s0, s1) {
    if (s0 * s1 <= 0) return 0;
    return 3 * (h0 + h1) / ((2 * h1 + h0) / s0 + (h0 + 2 * h1) / s1);
  }
  return [tan1(d0r, d1r), tan1(d0g, d1g), tan1(d0b, d1b)];
}

function cubicHermite(p0, p1, m0, m1, t, h) {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2*t3 - 3*t2 + 1;
  const h10 = (t3 - 2*t2 + t) * h;
  const h01 = -2*t3 + 3*t2;
  const h11 = (t3 - t2) * h;
  return [
    h00*p0[0] + h10*m0[0] + h01*p1[0] + h11*m1[0],
    h00*p0[1] + h10*m0[1] + h01*p1[1] + h11*m1[1],
    h00*p0[2] + h10*m0[2] + h01*p1[2] + h11*m1[2],
  ];
}

function lutBlend(d, paper, p10, p30, p50, p70, p100) {
  if (d < 0) d = 0; else if (d > 1) d = 1;
  // Endpoint tangents — one-sided difference
  const m0 = [(p10[0]-paper[0])/0.10, (p10[1]-paper[1])/0.10, (p10[2]-paper[2])/0.10];
  const m5 = [(p100[0]-p70[0])/0.30, (p100[1]-p70[1])/0.30, (p100[2]-p70[2])/0.30];
  // Interior tangents — Fritsch-Carlson
  const m1 = monoTangent(paper, p10, p30, 0.10, 0.20);
  const m2 = monoTangent(p10, p30, p50, 0.20, 0.20);
  const m3 = monoTangent(p30, p50, p70, 0.20, 0.20);
  const m4 = monoTangent(p50, p70, p100, 0.20, 0.30);
  if (d < 0.10) return cubicHermite(paper, p10, m0, m1, d / 0.10, 0.10);
  if (d < 0.30) return cubicHermite(p10, p30, m1, m2, (d - 0.10) / 0.20, 0.20);
  if (d < 0.50) return cubicHermite(p30, p50, m2, m3, (d - 0.30) / 0.20, 0.20);
  if (d < 0.70) return cubicHermite(p50, p70, m3, m4, (d - 0.50) / 0.20, 0.20);
  return cubicHermite(p70, p100, m4, m5, (d - 0.70) / 0.30, 0.30);
}

function clamp255(v) {
  v = Math.round(v * 255);
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v;
}

self.onmessage = function(e) {
  const { id, inks } = e.data;
  // 4 rows × 256 cols × RGBA = 4 KB
  const data = new Uint8Array(4 * 256 * 4);
  for (let li = 0; li < 4; li++) {
    const ink = (li < inks.length) ? inks[li] : null;
    if (!ink) {
      // No ink at this slot — fill row with paper color so any stray
      // sampling reads a no-op (returns paper).
      const paperR = 232, paperG = 232, paperB = 232; // fallback paper
      for (let i = 0; i < 256; i++) {
        const o = (li * 256 + i) * 4;
        data[o] = paperR;
        data[o+1] = paperG;
        data[o+2] = paperB;
        data[o+3] = 255;
      }
      continue;
    }
    for (let i = 0; i < 256; i++) {
      const d = i / 255;
      const rgb = lutBlend(d, ink.paper, ink.p10, ink.p30, ink.p50, ink.p70, ink.p100);
      const o = (li * 256 + i) * 4;
      data[o]   = clamp255(rgb[0]);
      data[o+1] = clamp255(rgb[1]);
      data[o+2] = clamp255(rgb[2]);
      data[o+3] = 255;
    }
  }
  const buf = data.buffer;
  self.postMessage({ id, lut: buf }, [buf]);
};
