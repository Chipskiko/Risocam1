// Ground-truth harness: run the app's ACTUAL driver-faithful FS on a
// synthetic hard edge and dump the raw master bits as PGM.
import { readFileSync, writeFileSync } from 'fs';
import vm from 'vm';

const src = readFileSync(process.argv[3] || '/Users/test/risocam/Risocam1/js/riso-amt.js', 'utf8');
const sandbox = { self: {}, window: {}, console, Math, Uint8Array, Int32Array, Float32Array, Uint8ClampedArray };
sandbox.self = sandbox; sandbox.window = sandbox;
vm.createContext(sandbox); vm.runInContext(src, sandbox);
const RisoAmt = sandbox.RisoAmt;

const W = 360, H = 240;
// Luminance byte input, renderer convention: 0 = full ink target, 255 = paper.
const lum = new Uint8Array(W * H).fill(255);
function rect(x0, y0, x1, y1, v) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) lum[y * W + x] = v;
}
rect(140, 20, 340, 120, 0);     // solid black block (hard edges all sides)
rect(140, 140, 340, 220, 115);  // mid grey block

const bits = RisoAmt.runAmt(lum, W, H, { driverFaithful: true, coverageScale: 1.7 });
const S = 3, OW = W * S, OH = H * S;
const out = Buffer.alloc(OW * OH, 255);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const on = (bits[(y * W + x) >> 3] >> (7 - ((y * W + x) & 7))) & 1;
  if (on) for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++)
    out[(y * S + dy) * OW + x * S + dx] = 0;
}
const name = process.argv[2] || 'fs-edge.pgm';
writeFileSync(name, Buffer.concat([Buffer.from(`P5\n${OW} ${OH}\n255\n`), out]));
console.log('wrote', name, 'bits len', bits.length, 'expected', (W*H+7>>3));
