// build-vc-mask.mjs — deploy-time 256x256 void-and-cluster mask bake.
//
// The runtime genVoidClusterMask is O(N^2) (full-array scans per placement):
// ~0.4s at 128^2, ~30-60s at 256^2 — fine offline, unacceptable at startup.
// This script ports the EXACT runtime algorithm (same sigma, same LCG seeds,
// same rank->byte quantisation), applies the same white-CDF tone remap the
// runtime applies (see remapVCToWhiteCDF in renderer.js), and writes the
// finished bytes to js/gen/bnvc256.js as window._BNVC256 (base64).
// renderer.js uses the baked mask when present and falls back to the runtime
// 128^2 generator when not (u_bnSize carries the size to the shader).
//
// Determinism: genBlueNoise is a pure integer hash of position; both LCGs are
// fixed-seed. Re-running this script always produces identical bytes.
//
// Usage: node tools/build-vc-mask.mjs   (from the repo root; ~1-2 min)

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── exact port of renderer.js genBlueNoise ──
function genBlueNoise(sz){
  const d = new Uint8Array(sz*sz);
  for(let y=0;y<sz;y++){
    for(let x=0;x<sz;x++){
      let h = (x*374761393 + y*668265263) ^ (x*1274126177);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h = Math.imul(h ^ (h >>> 16), 2654435769);
      d[y*sz+x] = ((h >>> 0) & 0xFFFF) >> 8;
    }
  }
  return d;
}

// ── exact port of renderer.js genVoidClusterMask ──
function genVoidClusterMask(size){
  const N = size * size;
  const SIGMA = 1.5;
  const radius = Math.ceil(SIGMA * 4);
  const kernel = [];
  for(let dy = -radius; dy <= radius; dy++)
    for(let dx = -radius; dx <= radius; dx++){
      const w = Math.exp(-(dx*dx + dy*dy) / (2*SIGMA*SIGMA));
      if(w > 1e-6) kernel.push({ dx, dy, w });
    }
  function updateEnergy(energy, x, y, sign){
    for(const { dx, dy, w } of kernel){
      const nx = ((x + dx) % size + size) % size;
      const ny = ((y + dy) % size + size) % size;
      energy[ny * size + nx] += sign * w;
    }
  }
  function findTightest(p, e){ let m=-Infinity, i=-1; for(let k=0;k<N;k++) if(p[k] && e[k]>m){m=e[k];i=k;} return i; }
  function findVoid(p, e){ let m=Infinity, i=-1; for(let k=0;k<N;k++) if(!p[k] && e[k]<m){m=e[k];i=k;} return i; }
  let pattern = new Uint8Array(N), energy = new Float32Array(N);
  let seed = 12345;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF; return seed / 0x7FFFFFFF; };
  const initialCount = Math.floor(N * 0.1);
  for(let i = 0; i < initialCount; i++){
    let p = Math.floor(rand() * N);
    while(pattern[p]) p = (p + 1) % N;
    pattern[p] = 1;
    updateEnergy(energy, p % size, Math.floor(p / size), +1);
  }
  for(let iter = 0; iter < N; iter++){
    const maxI = findTightest(pattern, energy);
    pattern[maxI] = 0; updateEnergy(energy, maxI % size, Math.floor(maxI / size), -1);
    const minI = findVoid(pattern, energy);
    pattern[minI] = 1; updateEnergy(energy, minI % size, Math.floor(minI / size), +1);
    if(maxI === minI) break;
  }
  const rank = new Int32Array(N).fill(-1);
  let p2 = new Uint8Array(pattern), e2 = new Float32Array(energy);
  for(let i = 0; i < initialCount; i++){
    const idx = findTightest(p2, e2);
    rank[idx] = initialCount - 1 - i;
    p2[idx] = 0; updateEnergy(e2, idx % size, Math.floor(idx / size), -1);
  }
  p2 = new Uint8Array(pattern); e2 = new Float32Array(energy);
  let r = initialCount;
  while(r < N){
    const idx = findVoid(p2, e2);
    if(idx === -1) break;
    rank[idx] = r;
    p2[idx] = 1; updateEnergy(e2, idx % size, Math.floor(idx / size), +1);
    r++;
  }
  const out = new Uint8Array(N);
  for(let i = 0; i < N; i++) out[i] = Math.min(255, Math.floor((rank[i] / N) * 256));
  return out;
}

// ── exact port of renderer.js remapVCToWhiteCDF ──
function remapToWhiteCDF(bytes){
  const wn = genBlueNoise(256);
  const HB = 2048, hist = new Float64Array(HB);
  let seed = 987654321;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF; return seed / 0x7FFFFFFF; };
  const S = 200000;
  for(let si = 0; si < S; si++){
    const fx = rnd() * 256, fy = rnd() * 256;
    let x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const x1 = (x0 + 1) & 255, y1 = (y0 + 1) & 255;
    x0 &= 255; y0 &= 255;
    const v = wn[y0*256+x0]*(1-tx)*(1-ty) + wn[y0*256+x1]*tx*(1-ty)
            + wn[y1*256+x0]*(1-tx)*ty     + wn[y1*256+x1]*tx*ty;
    hist[Math.min(HB-1, Math.floor(v / 255 * HB))]++;
  }
  const cdf = new Float64Array(HB); let acc = 0;
  for(let hb = 0; hb < HB; hb++){ acc += hist[hb]; cdf[hb] = acc / S; }
  const lut = new Uint8Array(256); let hb2 = 0;
  for(let r = 0; r < 256; r++){
    const q = (r + 0.5) / 256;
    while(hb2 < HB-1 && cdf[hb2] < q) hb2++;
    lut[r] = Math.round((hb2 + 0.5) / HB * 255);
  }
  for(let mi = 0; mi < bytes.length; mi++) bytes[mi] = lut[bytes[mi]];
  return bytes;
}

const SIZE = 256;
console.log('building ' + SIZE + 'x' + SIZE + ' void-and-cluster mask (O(N^2), be patient)...');
const t0 = Date.now();
const mask = remapToWhiteCDF(genVoidClusterMask(SIZE));
const secs = ((Date.now() - t0) / 1000).toFixed(1);

// sanity: byte histogram should be near the white CDF quantiles, ranks near-uniform pre-remap
let lo = 0, hi = 0;
for(const b of mask){ if(b < 64) lo++; if(b >= 192) hi++; }
const b64 = Buffer.from(mask).toString('base64');
const out = `// GENERATED by tools/build-vc-mask.mjs — do not edit.
// ${SIZE}x${SIZE} void-and-cluster threshold mask, tone-remapped to the white
// path's bilinear-sampled threshold CDF (see remapVCToWhiteCDF, renderer.js).
// Deterministic: re-running the tool reproduces these bytes exactly.
window._BNVC256 = '${b64}';
`;
writeFileSync(join(ROOT, 'js', 'gen', 'bnvc256.js'), out);
console.log('bake ' + secs + 's, tail<64: ' + (lo/mask.length*100).toFixed(1) + '%, head>=192: ' + (hi/mask.length*100).toFixed(1) + '%, wrote js/gen/bnvc256.js (' + Math.round(out.length/1024) + ' KB)');
