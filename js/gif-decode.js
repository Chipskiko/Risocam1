// GIF frame decoder for engines without the ImageDecoder API (Safari).
// Exposes window.decodeGifFrames(ArrayBuffer) -> [{canvas, duration(ms)}],
// the same frame contract source.js builds on the ImageDecoder path, so the
// playback loop and the VID loop-length logic work unchanged. Without this,
// Safari fell back to a DOM <img>, which canvas drawImage() samples as the
// FIRST frame only (per spec) — GIFs rendered as stills.
//
// Scope: full GIF87a/89a — global/local palettes, transparency, interlace,
// disposal 0-3 (2 = restore to transparent like browsers do, not bg colour;
// 3 = restore previous composite). Frames are emitted as full-size
// composites, matching the ImageDecoder path's snapshots.
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

window.decodeGifFrames = function(buf){
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if(u8.length < 13 || u8[0] !== 0x47 || u8[1] !== 0x49 || u8[2] !== 0x46)
    throw new Error('not a GIF');
  let p = 6;
  const u16 = () => { const v = u8[p] | (u8[p+1] << 8); p += 2; return v; };
  const W = u16(), H = u16();
  const lsdPacked = u8[p++]; p += 2;              // bg index + aspect: unused
  let gct = null;
  if(lsdPacked & 0x80){ const n = 2 << (lsdPacked & 7); gct = u8.subarray(p, p + n*3); p += n*3; }
  const frames = [];
  // ── Memory budget ──────────────────────────────────────────────────────
  // Frames are DISPLAY sources and the riso pipeline grains/dithers
  // everything, so quality above ~1280px buys nothing — but the real
  // multiplier is FRAME COUNT: a 180-frame 720x1280 gif is ~633MB of raw
  // bitmaps, and Safari gets sluggish site-wide under decoded-image
  // pressure (measured; see field notes). Two levers, period-preserving:
  //  1. decimate gifs above ~20fps — a dropped frame folds its delay into
  //     the previous kept frame, so the total loop length (and the VID
  //     loop-length math) is EXACT;
  //  2. scale frame dimensions so kept-frames x W x H x 4 fits the budget
  //     (on top of the flat 1280px cap).
  // A cheap pre-pass walks the block structure (no LZW) to count frames
  // and read delays so both levers are known before decoding.
  // Keep in sync with the ImageDecoder path in source.js.
  const MAX_DIM = 1280, BUDGET_BYTES = 256 * 1048576, MIN_DELAY_MS = 50;
  const plan = (function(){
    const delays = [];
    let q = p;                                     // continue from after GCT
    let delay = 100;
    while(q < u8.length){
      const b = u8[q++];
      if(b === 0x3B) break;
      if(b === 0x21){
        const label = u8[q++];
        if(label === 0xF9 && u8[q] >= 4){
          let d = (u8[q+2] | (u8[q+3] << 8)) * 10;
          if(d <= 10) d = 100; delay = Math.max(d, 20);
          q += 1 + u8[q];
        }
        while(q < u8.length && u8[q] !== 0) q += u8[q] + 1; q++;
      } else if(b === 0x2C){
        q += 8;
        const idp = u8[q++];
        if(idp & 0x80) q += (2 << (idp & 7)) * 3;
        q++;                                       // LZW min code size
        while(q < u8.length && u8[q] !== 0) q += u8[q] + 1; q++;
        delays.push(delay); delay = 100;
      } else if(b !== 0) break;
    }
    // decimation: greedily merge runs shorter than MIN_DELAY_MS
    const emit = new Array(delays.length).fill(false);
    let kept = 0, acc = 0;
    for(let i = 0; i < delays.length; i++){
      acc += delays[i];
      if(kept === 0 || acc >= MIN_DELAY_MS){ emit[i] = true; kept++; acc = 0; }
    }
    if(!kept){ emit[0] = true; kept = 1; }
    const capScale = Math.min(1, MAX_DIM / Math.max(W, H));
    const budgetScale = Math.sqrt(BUDGET_BYTES / Math.max(1, kept * W * H * 4));
    return {emit, scale: Math.min(capScale, budgetScale, 1)};
  })();
  const outW = Math.max(1, Math.round(W * plan.scale));
  const outH = Math.max(1, Math.round(H * plan.scale));
  const outScale = plan.scale;
  let fullCanvas = null, fullCtx = null;                  // reused when scaling
  if(outScale < 1){
    fullCanvas = document.createElement('canvas');
    fullCanvas.width = W; fullCanvas.height = H;
    fullCtx = fullCanvas.getContext('2d');
  }
  let frameNo = 0, foldedMs = 0;
  const comp = new Uint8ClampedArray(W * H * 4);  // running full-size composite
  let gce = {delay: 100, transIdx: -1, disposal: 0};
  let prevSnapshot = null;
  const skipSubBlocks = () => { while(p < u8.length && u8[p] !== 0) p += u8[p] + 1; p++; };

  while(p < u8.length){
    const b = u8[p++];
    if(b === 0x3B) break;                         // trailer
    if(b === 0x21){                               // extension
      const label = u8[p++];
      if(label === 0xF9 && u8[p] >= 4){           // graphic control
        const pk = u8[p+1];
        gce = {
          disposal: (pk >> 2) & 7,
          delay: (u8[p+2] | (u8[p+3] << 8)) * 10, // centiseconds -> ms
          transIdx: (pk & 1) ? u8[p+4] : -1,
        };
        p += 1 + u8[p];
      }
      skipSubBlocks();                            // NETSCAPE/comment/leftovers
    } else if(b === 0x2C){                        // image descriptor
      const fx = u16(), fy = u16(), fw = u16(), fh = u16();
      const idPacked = u8[p++];
      let pal = gct;
      if(idPacked & 0x80){ const n = 2 << (idPacked & 7); pal = u8.subarray(p, p + n*3); p += n*3; }
      if(!pal) throw new Error('no palette');
      const interlaced = !!(idPacked & 0x40);
      const minCode = u8[p++];
      let total = 0, q = p;                       // concatenate LZW sub-blocks
      while(q < u8.length && u8[q] !== 0){ total += u8[q]; q += u8[q] + 1; }
      const data = new Uint8Array(total); let o = 0; q = p;
      while(q < u8.length && u8[q] !== 0){ data.set(u8.subarray(q+1, q+1+u8[q]), o); o += u8[q]; q += u8[q] + 1; }
      p = q + 1;
      const idx = lzwDecode(minCode, data, fw * fh);
      if(gce.disposal === 3) prevSnapshot = comp.slice();
      let rows = null;
      if(interlaced){                             // 4-pass row order
        rows = new Array(fh); let r = 0;
        for(let y = 0; y < fh; y += 8) rows[r++] = y;
        for(let y = 4; y < fh; y += 8) rows[r++] = y;
        for(let y = 2; y < fh; y += 4) rows[r++] = y;
        for(let y = 1; y < fh; y += 2) rows[r++] = y;
      }
      for(let ry = 0; ry < fh; ry++){
        const y = interlaced ? rows[ry] : ry;
        const cy = fy + y; if(cy >= H) continue;
        const rowBase = ry * fw;
        for(let x = 0; x < fw; x++){
          const cx = fx + x; if(cx >= W) continue;
          const ci = idx[rowBase + x];
          if(ci === gce.transIdx) continue;
          const co = (cy * W + cx) * 4, pi = ci * 3;
          comp[co] = pal[pi]; comp[co+1] = pal[pi+1]; comp[co+2] = pal[pi+2]; comp[co+3] = 255;
        }
      }
      // Delay conventions: browsers render <=10ms as 100ms; the app's
      // ImageDecoder path additionally floors at 20ms — match both.
      let d = gce.delay; if(d <= 10) d = 100; d = Math.max(d, 20);
      const keep = plan.emit[frameNo] !== false;   // frames past the pre-pass count: keep
      frameNo++;
      if(!keep){
        // decimated: COMPOSITED (later frames may depend on it) but not
        // emitted — its delay extends the frame currently on screen (the
        // previous kept one), so the loop period stays exact.
        if(frames.length) frames[frames.length - 1].duration += d;
        else foldedMs += d;
      } else {
        const c = document.createElement('canvas'); c.width = outW; c.height = outH;
        if(outScale < 1){
          // putImageData can't scale — bounce through the reused full canvas
          fullCtx.putImageData(new ImageData(comp.slice(), W, H), 0, 0);
          c.getContext('2d').drawImage(fullCanvas, 0, 0, outW, outH);
        } else {
          c.getContext('2d').putImageData(new ImageData(comp.slice(), W, H), 0, 0);
        }
        frames.push({canvas: c, duration: d + foldedMs});
        foldedMs = 0;
      }
      if(gce.disposal === 2){                     // restore to transparent
        for(let y = 0; y < fh; y++){ const cy = fy + y; if(cy >= H) continue;
          for(let x = 0; x < fw; x++){ const cx = fx + x; if(cx >= W) continue;
            const co = (cy * W + cx) * 4;
            comp[co] = comp[co+1] = comp[co+2] = comp[co+3] = 0; } }
      } else if(gce.disposal === 3 && prevSnapshot){ comp.set(prevSnapshot); }
      gce = {delay: 100, transIdx: -1, disposal: 0};   // GCE covers ONE image
    } else if(b !== 0){
      break;                                      // unknown block: keep what we have
    }
  }
  if(foldedMs > 0 && frames.length)               // trailing decimated frames:
    frames[frames.length - 1].duration += foldedMs; // period stays exact
  return frames;
};
})();
