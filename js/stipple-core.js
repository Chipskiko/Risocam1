// STIPPLE CORE — fast brightness-driven variable-density blue-noise points.
// A performance-faithful reimplementation of the "Pointillist" algorithm:
//   • brightness = (R+G+B)/3, 16 bands, darkest band placed first
//   • exclusion radius r = rMin + (rMax−rMin)·t², t = brightness/255
//   • collision: distance ≤ r_a + r_b (note ≤ — equality rejects)
//   • pixels ≥ whiteZone get invisible collision circles (ghosts)
// What changed vs the original (same output statistics, ~100-1000× less work):
//   • darts stream over per-band pixel lists (no wrong-band rejections) in a
//     zero-allocation LCG-permuted order with sub-pixel jitter
//   • quadtree → two flat typed-array grids: a FINE occupancy grid whose cell
//     (rMin·√2·0.99) provably holds ≤1 point (min pair distance > 2·rMin), and
//     a COARSE 16px max-radius grid that bounds each candidate's search reach
//     so exact variable-radius collisions stay O(small window)
//   • luma/banding on a downscaled analysis map; GEOMETRY stays output-res
//   • per-band YIELD termination (stop when <minYield placements per 1024
//     darts) — the statistical mirror of the original's fails-vs-band-size
//     cap, tiered by opts.quality (0 fast / 1 balanced / 2 max packing)
// Runs in the stipple worker (blob-loaded, CSP-safe) or sync on the main
// thread as a fallback — classic-script global, same pattern as riso-amt.js.
(function(root){

function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smallest prime-ish stride coprime with n → visits 0..n-1 in a scrambled
// order with O(1) memory (no shuffle buffer for multi-million pixel bands).
function coprimeStride(n, rnd){
  if(n <= 2) return 1;
  for(let tries = 0; tries < 64; tries++){
    const s = 1 + ((rnd() * (n - 1)) | 0);
    let a = s, b = n;                       // gcd
    while(b){ const t = a % b; a = b; b = t; }
    if(a === 1) return s;
  }
  return 1;
}

// luma: Uint8Array analysis-res brightness ((R+G+B)/3, computed by caller)
// aw, ah: analysis dims; outW, outH: output (geometry) dims
// opts: rMin (1), rMax (10), whiteZone (250), seed, maxPoints
// returns { data: Float32Array [x,y,r,brightness]×count, count }
function generate(luma, aw, ah, outW, outH, opts){
  opts = opts || {};
  const rMin = Math.max(0.5, opts.rMin ?? 1);
  const rMax = Math.max(rMin, opts.rMax ?? 10);
  const whiteZone = opts.whiteZone ?? 250;   // ≥ this → ghost (collides, not drawn)
  const rnd = mulberry32((opts.seed ?? 1234567) || 1);
  const sx = outW / aw, sy = outH / ah;
  const pitchOut = Math.max(sx, sy);         // one analysis pixel in output px

  // ── per-band pixel lists (counting sort, two passes, all typed) ──
  const N = aw * ah;
  const counts = new Uint32Array(16);
  for(let i = 0; i < N; i++) counts[luma[i] >> 4]++;
  const starts = new Uint32Array(17);
  for(let b = 0; b < 16; b++) starts[b + 1] = starts[b] + counts[b];
  const bandPix = new Uint32Array(N);
  const cursor = starts.slice(0, 16);
  for(let i = 0; i < N; i++) bandPix[cursor[luma[i] >> 4]++] = i;

  // ── collision grids ──
  const cell = rMin * 1.41;                  // diagonal < 2·rMin ⇒ ≤1 pt/cell
  const gw = Math.max(1, Math.ceil(outW / cell));
  const gh = Math.max(1, Math.ceil(outH / cell));
  const grid = new Int32Array(gw * gh).fill(-1);
  const CC = 16;                             // coarse cell px
  const cgw = Math.max(1, Math.ceil(outW / CC));
  const cgh = Math.max(1, Math.ceil(outH / CC));
  const cmax = new Uint8Array(cgw * cgh);    // max ceil(r) of points in cell

  const maxPoints = opts.maxPoints ?? 400000;
  const px = new Float32Array(maxPoints);
  const py = new Float32Array(maxPoints);
  const pr = new Float32Array(maxPoints);
  const pb = new Float32Array(maxPoints);
  let np = 0;

  const rangeR = rMax - rMin;
  const inv255 = 1 / 255;
  // quality: 0 fast (phone live), 1 balanced (default), 2 max packing.
  // Random dart packing (RSA) fills the last percent of capacity with a very
  // slow tail — a fixed dart multiple either starves mid-bright bands or
  // burns time. Instead each band terminates on placement YIELD: every 1024
  // darts, stop if fewer than minYield points landed. Dark bands finish by
  // exhausting their (pixel-bounded) darts; bright bands stop the moment the
  // tail stops paying.
  const q = Math.min(2, Math.max(0, opts.quality ?? 1));
  const minYield = [10, 4, 1][q];            // per 1024 darts

  for(let b = 0; b < 16 && np < maxPoints; b++){
    const n = counts[b];
    if(!n) continue;
    // radius at the band's midpoint decides the dart oversampling: candidate
    // pitch (output px) should be ≲ the band's radius. Darkest band at
    // rMin=1 with a 2px analysis pitch needs (2/1)² = 4 darts per pixel.
    const tMid = ((b << 4) + 8) * inv255;
    const rBand = rMin + rangeR * tMid * tMid;
    const perPix = Math.min(8, Math.max(1, Math.ceil((pitchOut / rBand) * (pitchOut / rBand))));
    // Dart budget: bounded by the band's point CAPACITY, not its pixel count.
    // Exclusion spacing 2·rBand packs ≤ area/(4·rBand²) points; dart throwing
    // approaches its jamming density with a few-× oversample. Without this,
    // large BRIGHT regions (big radii, tiny capacity) burn hundreds of
    // thousands of doomed darts — this cap was the single biggest cost.
    // Dart ceiling: pixel-stream bound for dense bands, generous capacity
    // multiple as a hard safety for sparse ones — the yield check below is
    // the REAL terminator (mirrors the original's fails-vs-band-size rule,
    // which also measured 'is this band still paying?').
    const bandAreaOut = n * sx * sy;
    const capacity = bandAreaOut / (4 * rBand * rBand);
    const darts = Math.max(256, Math.min(n * perPix, Math.ceil(capacity * 192)));
    const stride = coprimeStride(darts, rnd);
    let k = (rnd() * darts) | 0;
    let windowPlaced = 0, windowMark = 1024;

    const base = starts[b];
    let lcg = (rnd() * 0x7fffffff) | 0;      // per-band inline jitter stream
    for(let d = 0; d < darts; d++){
      k += stride; if(k >= darts) k -= darts;
      const pi = bandPix[base + (k % n)];
      const ax = pi % aw, ay = (pi / aw) | 0;
      lcg = (Math.imul(lcg, 1664525) + 1013904223) | 0;
      const jx = ((lcg >>> 9) & 1023) * 0.0009765625;   // /1024 → [0,1)
      lcg = (Math.imul(lcg, 1664525) + 1013904223) | 0;
      const jy = ((lcg >>> 9) & 1023) * 0.0009765625;
      const x = (ax + jx) * sx;
      const y = (ay + jy) * sy;
      const bri = luma[pi];
      const t = bri * inv255;
      const r = rMin + rangeR * t * t;

      // coarse pass: max neighbor radius within reach (r + rMax ring)
      const reach0 = r + rMax;
      let c0x = ((x - reach0) / CC) | 0, c1x = ((x + reach0) / CC) | 0;
      let c0y = ((y - reach0) / CC) | 0, c1y = ((y + reach0) / CC) | 0;
      if(c0x < 0) c0x = 0; if(c0y < 0) c0y = 0;
      if(c1x >= cgw) c1x = cgw - 1; if(c1y >= cgh) c1y = cgh - 1;
      let wMax = 0;
      for(let cy = c0y; cy <= c1y; cy++){
        const row = cy * cgw;
        for(let cx = c0x; cx <= c1x; cx++){
          const m = cmax[row + cx];
          if(m > wMax) wMax = m;
        }
      }

      let hit = false;
      if(wMax > 0){
        // fine pass: exact collisions within (r + wMax)
        const reach = r + wMax;
        let f0x = ((x - reach) / cell) | 0, f1x = ((x + reach) / cell) | 0;
        let f0y = ((y - reach) / cell) | 0, f1y = ((y + reach) / cell) | 0;
        if(f0x < 0) f0x = 0; if(f0y < 0) f0y = 0;
        if(f1x >= gw) f1x = gw - 1; if(f1y >= gh) f1y = gh - 1;
        scan:
        for(let fy = f0y; fy <= f1y; fy++){
          const row = fy * gw;
          for(let fx = f0x; fx <= f1x; fx++){
            const q = grid[row + fx];
            if(q < 0) continue;
            const dx = px[q] - x, dy = py[q] - y;
            const rr = r + pr[q];
            if(dx * dx + dy * dy <= rr * rr){ hit = true; break scan; }
          }
        }
      }

      if(hit){
        if(d >= windowMark){
          if(windowPlaced < minYield) break;   // band's tail stopped paying
          windowPlaced = 0; windowMark = d + 1024;
        }
        continue;
      }
      windowPlaced++;
      px[np] = x; py[np] = y; pr[np] = r; pb[np] = bri;
      grid[((y / cell) | 0) * gw + ((x / cell) | 0)] = np;
      const ci = ((y / CC) | 0) * cgw + ((x / CC) | 0);
      const rc = Math.ceil(r);
      if(rc > cmax[ci]) cmax[ci] = rc;
      if(++np >= maxPoints) break;
    }
  }

  // pack [x,y,r,b] interleaved for a zero-copy transfer
  const data = new Float32Array(np * 4);
  for(let i = 0; i < np; i++){
    data[i * 4] = px[i]; data[i * 4 + 1] = py[i];
    data[i * 4 + 2] = pr[i]; data[i * 4 + 3] = pb[i];
  }
  return { data: data, count: np, whiteZone: whiteZone };
}

const api = { generate: generate };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.StippleCore = api;

})(typeof self !== 'undefined' ? self : this);
