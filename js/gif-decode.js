// Streaming GIF decoder — used for ALL animated GIF playback (and as the
// no-ImageDecoder path Safari depends on; the ImageDecoder route remains a
// fallback if this parser rejects a file).
//
// v5: streaming. The batch decoder materialised every frame as a full-size
// RGBA canvas — memory is frameCount x W x H x 4, so a 10MB file (LZW +
// palette + patch compression, ~60x) became 663MB of bitmaps and Safari
// got sluggish site-wide. This version keeps only the COMPRESSED bytes
// plus ONE composited frame (~15MB for the same gif) and re-runs LZW one
// frame at a time as playback advances (a few ms per step). Playback is
// sequential, so seek(cur+1) is the hot path; wrapping to 0 resets and
// decodes forward. Composition mechanics are byte-identical to the batch
// decoder that was verified pixel-exact against Chrome's ImageDecoder
// (palettes, transparency, interlace, disposal 0-3). With per-frame memory
// gone, the >20fps decimation and the 256MB budget scaling are gone too —
// full frame rate, full (display-capped) resolution.
//
// window.createGifStream(ArrayBuffer) -> {
//   frameCount, delays[], width, height, outW, outH,   // out* capped at 1280
//   drawFrame(idx, ctx2d),   // seeks + blits frame idx into ctx (outW x outH)
//   approxBytes, close()
// }
// window.decodeGifFrames(buf) remains as a batch wrapper over the stream
// (tests and stragglers) — playback must not use it.
(function(){
'use strict';

// LZW with the standard prefix/suffix/first tables. GIF quirks handled:
// LSB-first bit packing, clear codes resetting the table mid-stream, the
// KwKwK case (code == next unassigned entry), and "deferred clear" streams
// that keep emitting 12-bit codes after the table fills.
function lzwDecode(minCodeSize, data, npix){
  const out = new Uint8Array(npix);
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1, codeMask = (1 << codeSize) - 1;
  let avail = eoi + 1, oldCode = -1;
  const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), first = new Uint8Array(4096);
  for(let i = 0; i < clear; i++){ prefix[i] = -1; suffix[i] = i; first[i] = i; }
  const stack = new Uint8Array(4097); let sp = 0;
  let acc = 0, bits = 0, op = 0;
  for(let i = 0; i < data.length; i++){
    acc |= data[i] << bits; bits += 8;
    while(bits >= codeSize){
      const code = acc & codeMask; acc >>>= codeSize; bits -= codeSize;
      if(code === clear){
        codeSize = minCodeSize + 1; codeMask = (1 << codeSize) - 1;
        avail = eoi + 1; oldCode = -1; continue;
      }
      if(code === eoi) return out;
      if(oldCode === -1){
        if(code >= avail) return out;            // corrupt stream
        out[op++] = suffix[code]; oldCode = code;
        if(op >= npix) return out;
        continue;
      }
      let c = code;
      if(code >= avail){                          // KwKwK: string(old) + first(old)
        if(code > avail) return out;              // corrupt stream
        stack[sp++] = first[oldCode];
        c = oldCode;
      }
      while(c >= clear){ stack[sp++] = suffix[c]; c = prefix[c]; }
      stack[sp++] = suffix[c];
      const firstChar = suffix[c];                // first char of the emitted string
      if(avail < 4096){
        prefix[avail] = oldCode; suffix[avail] = firstChar; first[avail] = first[oldCode];
        avail++;
        if(avail >= (1 << codeSize) && codeSize < 12){ codeSize++; codeMask = (1 << codeSize) - 1; }
      }
      while(sp > 0){
        out[op++] = stack[--sp];
        if(op >= npix){ sp = 0; return out; }
      }
      oldCode = code;
    }
  }
  return out;
}

window.createGifStream = function(buf){
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if(u8.length < 13 || u8[0] !== 0x47 || u8[1] !== 0x49 || u8[2] !== 0x46)
    throw new Error('not a GIF');
  let p = 6;
  const rd16 = (q) => u8[q] | (u8[q+1] << 8);
  const W = rd16(p), H = rd16(p+2); p += 4;
  const lsdPacked = u8[p++]; p += 2;              // bg index + aspect: unused
  let gctOff = -1;
  if(lsdPacked & 0x80){ const n = 2 << (lsdPacked & 7); gctOff = p; p += n * 3; }

  // ── Structure pass: index every frame WITHOUT running LZW ──
  // {delay, disposal, transIdx, fx,fy,fw,fh, interlaced, palOff, minCode, dataOff, dataEnd}
  const F = [];
  let gce = {delay: 100, transIdx: -1, disposal: 0};
  const skipSub = () => { while(p < u8.length && u8[p] !== 0) p += u8[p] + 1; p++; };
  while(p < u8.length){
    const b = u8[p++];
    if(b === 0x3B) break;                         // trailer
    if(b === 0x21){                               // extension
      const label = u8[p++];
      if(label === 0xF9 && u8[p] >= 4){           // graphic control
        const pk = u8[p+1];
        // Delay conventions: browsers render <=10ms as 100ms; floor at 20ms
        // (matches the old batch decoder and the ImageDecoder path).
        let d = rd16(p+2) * 10; if(d <= 10) d = 100; d = Math.max(d, 20);
        gce = { disposal: (pk >> 2) & 7, delay: d, transIdx: (pk & 1) ? u8[p+4] : -1 };
        p += 1 + u8[p];
      }
      skipSub();                                  // NETSCAPE/comment/leftovers
    } else if(b === 0x2C){                        // image descriptor
      const fx = rd16(p), fy = rd16(p+2), fw = rd16(p+4), fh = rd16(p+6);
      const idPacked = u8[p+8]; p += 9;
      let palOff = gctOff;
      if(idPacked & 0x80){ const n = 2 << (idPacked & 7); palOff = p; p += n * 3; }
      if(palOff < 0) throw new Error('no palette');
      const minCode = u8[p++];
      const dataOff = p;
      while(p < u8.length && u8[p] !== 0) p += u8[p] + 1;
      const dataEnd = p; p++;
      F.push({delay: gce.delay, disposal: gce.disposal, transIdx: gce.transIdx,
              fx, fy, fw, fh, interlaced: !!(idPacked & 0x40), palOff, minCode, dataOff, dataEnd});
      gce = {delay: 100, transIdx: -1, disposal: 0};
    } else if(b !== 0){
      break;                                      // unknown block: keep what we have
    }
  }
  if(!F.length) throw new Error('no frames');

  // Display cap: 1280px max dimension — texture-upload cost per advance,
  // not memory, since only one frame exists at a time now.
  const outScale = Math.min(1, 1280 / Math.max(W, H));
  const outW = Math.max(1, Math.round(W * outScale));
  const outH = Math.max(1, Math.round(H * outScale));

  // ── Streaming state: ONE composite + optional disposal-3 snapshot ──
  const comp = new Uint8ClampedArray(W * H * 4);
  const compImg = new ImageData(comp, W, H);      // persistent wrapper: zero copies per blit
  const anyD3 = F.some(f => f.disposal === 3);
  let snapshot = anyD3 ? new Uint8ClampedArray(W * H * 4) : null;
  const fullCanvas = document.createElement('canvas'); // native-size staging for the scale blit
  fullCanvas.width = W; fullCanvas.height = H;
  const fullCtx = fullCanvas.getContext('2d');
  let cur = -1;                                   // index of the frame currently in `comp`
  let pending = null;                             // disposal owed by frame `cur` (applied before painting cur+1)

  function applyPending(){
    if(!pending) return;
    if(pending.disposal === 2){                   // restore to transparent
      for(let y = 0; y < pending.fh; y++){ const cy = pending.fy + y; if(cy >= H) continue;
        for(let x = 0; x < pending.fw; x++){ const cx = pending.fx + x; if(cx >= W) continue;
          const co = (cy * W + cx) * 4;
          comp[co] = comp[co+1] = comp[co+2] = comp[co+3] = 0; } }
    } else if(pending.disposal === 3 && snapshot){
      comp.set(snapshot);                         // restore previous composite
    }
    pending = null;
  }

  function decodeOne(i){
    const f = F[i];
    applyPending();
    if(f.disposal === 3 && snapshot) snapshot.set(comp);
    let total = 0, q = f.dataOff;                 // concatenate LZW sub-blocks
    while(q < f.dataEnd){ total += u8[q]; q += u8[q] + 1; }
    const data = new Uint8Array(total); let o = 0; q = f.dataOff;
    while(q < f.dataEnd){ data.set(u8.subarray(q+1, q+1+u8[q]), o); o += u8[q]; q += u8[q] + 1; }
    const idx = lzwDecode(f.minCode, data, f.fw * f.fh);
    let rows = null;
    if(f.interlaced){                             // 4-pass row order
      rows = new Array(f.fh); let r = 0;
      for(let y = 0; y < f.fh; y += 8) rows[r++] = y;
      for(let y = 4; y < f.fh; y += 8) rows[r++] = y;
      for(let y = 2; y < f.fh; y += 4) rows[r++] = y;
      for(let y = 1; y < f.fh; y += 2) rows[r++] = y;
    }
    for(let ry = 0; ry < f.fh; ry++){
      const y = f.interlaced ? rows[ry] : ry;
      const cy = f.fy + y; if(cy >= H) continue;
      const rowBase = ry * f.fw;
      for(let x = 0; x < f.fw; x++){
        const cx = f.fx + x; if(cx >= W) continue;
        const ci = idx[rowBase + x];
        if(ci === f.transIdx) continue;
        const co = (cy * W + cx) * 4, pi = f.palOff + ci * 3;
        comp[co] = u8[pi]; comp[co+1] = u8[pi+1]; comp[co+2] = u8[pi+2]; comp[co+3] = 255;
      }
    }
    pending = {disposal: f.disposal, fx: f.fx, fy: f.fy, fw: f.fw, fh: f.fh};
    cur = i;
  }

  function seek(t){
    t = ((t % F.length) + F.length) % F.length;
    if(t === cur) return;
    if(t < cur){                                  // wrap / backward: rebuild from 0
      comp.fill(0); pending = null; cur = -1;
    }
    for(let i = cur + 1; i <= t; i++) decodeOne(i);
  }

  return {
    frameCount: F.length,
    delays: F.map(f => f.delay),
    width: W, height: H, outW, outH,
    drawFrame(t, ctx){
      seek(t);
      fullCtx.putImageData(compImg, 0, 0);
      if(outScale < 1) ctx.drawImage(fullCanvas, 0, 0, outW, outH);
      else ctx.drawImage(fullCanvas, 0, 0);
    },
    approxBytes: u8.length + W * H * 4 * (anyD3 ? 2 : 1),
    close(){ snapshot = null; fullCanvas.width = 1; fullCanvas.height = 1; }
  };
};

// Batch compatibility wrapper (tests / stragglers): materialises every frame
// through the stream — carries the OLD memory cost, playback must not use it.
window.decodeGifFrames = function(buf){
  const st = window.createGifStream(buf);
  const frames = [];
  for(let i = 0; i < st.frameCount; i++){
    const c = document.createElement('canvas'); c.width = st.outW; c.height = st.outH;
    st.drawFrame(i, c.getContext('2d'));
    frames.push({canvas: c, duration: st.delays[i]});
  }
  st.close();
  return frames;
};
})();
