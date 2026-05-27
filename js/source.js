// SOURCE module
(function(R) {
"use strict";

// ======================== SOURCE MANAGEMENT ========================
// Composite image onto white background — transparent PNGs become opaque
function flattenAlpha(img){
  const c=document.createElement('canvas');
  c.width=img.naturalWidth||img.width;
  c.height=img.naturalHeight||img.height;
  const ctx=c.getContext('2d');
  ctx.fillStyle='#fff';
  ctx.fillRect(0,0,c.width,c.height);
  ctx.drawImage(img,0,0);
  return c;
}
function pickFile(){el('fileInput').click();}
let gifCtx=null, gifRafId=0;
let gifFrameIdx=0, gifLastTime=0;
function stopVideo(){
  if(videoOn){
    $vid.pause();$vid.removeAttribute('src');$vid.load();
    videoOn=false;
  }
  if(window._vidFallback){clearInterval(window._vidFallback);window._vidFallback=null;}
  if(window._camFallback){clearInterval(window._camFallback);window._camFallback=null;}
  if(gifRafId){cancelAnimationFrame(gifRafId);gifRafId=0;}
  if(gifImg&&gifImg.parentNode)gifImg.parentNode.removeChild(gifImg);
  gifImg=null;
  if(gifFrames){gifFrames.forEach(f=>{f.canvas=null;});gifFrames=null;}
  gifFrameIdx=0;
}
function startGifLoop(now){
  if(!videoOn){gifRafId=0;return;}
  if(!now)now=performance.now();
  if(gifFrames&&gifFrames.length>0){
    // ImageDecoder path: advance based on per-frame timing
    const elapsed=now-gifLastTime;
    const dur=gifFrames[gifFrameIdx].duration||100;
    if(elapsed>=dur){
      gifFrameIdx=(gifFrameIdx+1)%gifFrames.length;
      gifLastTime=now;
      gifCtx.drawImage(gifFrames[gifFrameIdx].canvas,0,0);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,window._srcTexA);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,gifCanvas);
      videoFrameReady=true;
      markDirty();
    }
  }else if(gifImg){
    // Fallback: <img> DOM approach (simple GIFs only)
    gifCtx.drawImage(gifImg,0,0,gifCanvas.width,gifCanvas.height);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,window._srcTexA);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,gifCanvas);
    videoFrameReady=true;
    markDirty();
  }
  gifRafId=requestAnimationFrame(startGifLoop);
}
function loadGifFallback(f){
  // Fallback for browsers without ImageDecoder: use <img> DOM approach
  const url=URL.createObjectURL(f);
  const img=new Image();
  img.onload=()=>{
    URL.revokeObjectURL(url);
    gifImg=img;
    img.style.cssText='position:fixed;left:-9999px;top:-9999px;pointer-events:none;';
    document.body.appendChild(img);
    if(!gifCanvas)gifCanvas=document.createElement('canvas');
    gifCanvas.width=img.naturalWidth;gifCanvas.height=img.naturalHeight;
    gifCtx=gifCanvas.getContext('2d');
    srcImg=gifCanvas;
    videoOn=true;camOn=false;hasSrc=true;needsAspectUpdate=true;computeCrop();scheduleRender();
    $status.textContent='▶ GIF';
    $res.textContent=img.naturalWidth+'×'+img.naturalHeight;
    gifFrameIdx=0;gifLastTime=performance.now();
    startGifLoop();
  };
  img.src=url;
}
// Render first page of PDF to canvas via PDF.js
// ─── Multi-page PDF support ──────────────────────────────────────────────
// To save memory, we keep only thumbnails (~200px wide) for every page +
// the active page rendered at full resolution. Other pages render on demand
// when the user picks a thumbnail or exports.

// Upload a canvas (or other texSource) to a WebGL texture using ImageBitmap
// when available. ImageBitmap decoding happens off-thread, freeing the main
// thread. Falls back to direct upload on browsers without createImageBitmap.
// Called whenever a fresh source has been uploaded to the GL textures.
// In RISO mode, re-runs the AMT prepass so the halftone master matches the
// new source (otherwise the previous image's master still composites in =
// "ghost of previous image" bug). Also calls R.invalidateAmt so cache flags
// reset.
function notifySourceChanged(){
  if(window.R && window.R.invalidateAmt) window.R.invalidateAmt();
  if(window._mode === 'flat' && window.R && window.R.runAmtPrepass){
    setTimeout(window.R.runAmtPrepass, 0);
  }
}

async function uploadAsTexture(unit, tex, src){
  gl.activeTexture(unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if(typeof createImageBitmap==='function' && src instanceof HTMLCanvasElement){
    try{
      const bm=await createImageBitmap(src);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bm);
      bm.close && bm.close();
      // Cache the canvas-form source so the AMT pre-pass can read pixels back
      // without round-tripping through gl.readPixels. Only TEXTURE0 (the main
      // src tex) is interesting; ignore double-buffered B / ghost slots.
      if(unit === gl.TEXTURE0){
        window._lastSourceCanvas = src;
        notifySourceChanged();
      }
      return;
    }catch(_){/* fall through */}
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  if(unit === gl.TEXTURE0 && (src instanceof HTMLCanvasElement || src instanceof HTMLImageElement)){
    window._lastSourceCanvas = src;
    notifySourceChanged();
  }
}

// LRU cache for rasterized PDF pages — keyed by pdfDoc + pageIdx + targetW.
// Avoids re-rasterizing on every page switch / re-export. Capped to limit
// memory; oldest entry evicted when full. Cleared when a new PDF is loaded.
const PDF_CACHE_MAX=32; // ~32 pages worth of rasters in memory
const _pdfCache=new Map(); // composite key → {canvas, doc}
function pdfCacheKey(pdfDoc, pageIdx, targetW){
  return (pdfDoc._docId||0)+'_'+pageIdx+'_'+targetW;
}
function pdfCacheClear(){_pdfCache.clear();}
window._pdfCacheClear=pdfCacheClear;

// Render a single PDF page to a canvas at the requested width.
// Honors window._sourceRotation (0/90/180/270) so rotated PDFs persist
// across page switches. Cached by (doc, page, target width, rotation).
async function renderPdfPage(pdfDoc, pageIdx /*1-based*/, targetW){
  // Tag the doc so cache keys are unique per PDF instance
  if(!pdfDoc._docId) pdfDoc._docId=Math.random().toString(36).slice(2);
  const rotation=window._sourceRotation||0;
  const k=pdfCacheKey(pdfDoc, pageIdx, targetW)+'_r'+rotation;
  const hit=_pdfCache.get(k);
  if(hit){
    _pdfCache.delete(k); _pdfCache.set(k, hit);
    return hit.canvas;
  }
  const page=await pdfDoc.getPage(pageIdx);
  const baseVp=page.getViewport({scale:1, rotation});
  const scale=Math.max(0.1, targetW/baseVp.width);
  const vp=page.getViewport({scale, rotation});
  const c=document.createElement('canvas');
  c.width=Math.round(vp.width); c.height=Math.round(vp.height);
  const ctx=c.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
  await page.render({canvasContext:ctx, viewport:vp}).promise;
  // Build text mask + inpainted source. Mask = text alpha (where glyphs are);
  // inpainted = the source raster with glyph pixels replaced by rim-sampled
  // background color, so non-text plates can render the bg behind glyphs
  // (no white knockout) while the text plate renders glyphs from the
  // original raster via single-ink NNLS.
  const {mask, inpainted} = await buildTextMask(page, vp, c.width, c.height, c);
  _pdfCache.set(k, {canvas:c, mask, inpainted, doc:pdfDoc});
  while(_pdfCache.size>PDF_CACHE_MAX){
    const oldest=_pdfCache.keys().next().value;
    _pdfCache.delete(oldest);
  }
  return c;
}

// Cached lookup for the mask side-channel — returns the cached mask canvas
// (or null) for a given page+resolution combo. Used by the renderer when
// uploading a PDF page so it can also bind the text mask texture.
function pdfPageMask(pdfDoc, pageIdx, targetW){
  const rotation=window._sourceRotation||0;
  const k=pdfCacheKey(pdfDoc, pageIdx, targetW)+'_r'+rotation;
  const hit=_pdfCache.get(k);
  return hit ? (hit.mask||null) : null;
}
// Inpainted-source lookup — returns the cached source canvas with text
// glyphs replaced by their surrounding background color, for the
// "no white knockout behind text" rendering path.
function pdfPageInpainted(pdfDoc, pageIdx, targetW){
  const rotation=window._sourceRotation||0;
  const k=pdfCacheKey(pdfDoc, pageIdx, targetW)+'_r'+rotation;
  const hit=_pdfCache.get(k);
  return hit ? (hit.inpainted||null) : null;
}

// Re-upload u_src for the active PDF page based on current pdfModeOn.
// Called by togglePdfMode so flipping the toggle swaps the source
// between the original raster (PDF mode off) and the inpainted one
// (PDF mode on, text glyphs replaced by bg color).
function applyPdfSourceForMode(){
  if(!window._pdfDoc || !window._pdfMeta) return;
  const idx = window._pdfActiveIdx || 0;
  const meta = window._pdfMeta[idx];
  if(!meta) return;
  const targetW = Math.min(2400, meta.nativeW * 3);
  const original = R.renderPdfPage ? null : null; // we already cached
  // Look up cached entries
  const inpainted = pdfPageInpainted(window._pdfDoc, idx+1, targetW);
  // The original is the rendered canvas — same path as renderPdfPage,
  // which returns from cache without re-rendering. Easier: just use the
  // mask's cache entry parent (the canvas itself).
  // The cache stores {canvas, mask, inpainted, doc} so we get canvas via
  // a separate accessor. Build it inline:
  const useInpainted = (typeof pdfModeOn !== 'undefined') && pdfModeOn && inpainted;
  if(useInpainted){
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,window._srcTexA);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,inpainted);
    gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,window._srcTexB);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,inpainted);
  } else if(srcImg){
    // PDF mode off — restore the original-looking source. We stored it
    // in srcImg when the page was loaded.
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,window._srcTexA);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,srcImg);
    gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,window._srcTexB);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,srcImg);
  }
  markDirty();
}
R.applyPdfSourceForMode = applyPdfSourceForMode;

// Build a grayscale text mask for a PDF page. White (255) = text glyph,
// black (0) = non-text. Uses getTextContent() to find rect bounds, then
// refines within each rect by comparing source pixels against the rect's
// background color — only pixels that DIFFER from background get masked,
// so whitespace between letters stays unmasked.
async function buildTextMask(page, viewport, w, h, sourceCanvas){
  const mask = document.createElement('canvas');
  mask.width = w; mask.height = h;
  const mctx = mask.getContext('2d');
  mctx.fillStyle = '#000';
  mctx.fillRect(0, 0, w, h);
  // Inpainted = source canvas with text glyph pixels replaced by their
  // rim-sampled bg color. Used as u_src for non-text plates so they
  // render the background "behind" the text correctly (no knockout).
  const inpainted = document.createElement('canvas');
  inpainted.width = w; inpainted.height = h;
  const ipctx = inpainted.getContext('2d');
  ipctx.drawImage(sourceCanvas, 0, 0); // start as a copy of original
  let inpaintedDirty = false;
  try {
    const tc = await page.getTextContent();
    if(!tc || !tc.items || tc.items.length === 0) return {mask, inpainted};
    // Pull the source raster pixels for color refinement
    const srcCtx = sourceCanvas.getContext('2d');
    const srcData = srcCtx.getImageData(0, 0, w, h).data;
    const maskData = mctx.getImageData(0, 0, w, h);
    const md = maskData.data;
    const inpaintedData = ipctx.getImageData(0, 0, w, h);
    const ipd = inpaintedData.data;
    const vt = viewport.transform;
    for(const item of tc.items){
      if(!item.str || !item.str.length) continue;
      const t = item.transform;
      if(!t) continue;
      // pdf.js's item.transform contains the text matrix INCLUDING font
      // size; t[4],t[5] is the baseline-left of the text run. item.width
      // and item.height are in PDF user space — width is the rendered
      // text width, height is roughly the font size (ascender extent).
      // PDF coords have Y increasing UPWARD. Extents:
      //   - ascender extends UP by ~h_ above baseline
      //   - descender extends DOWN by ~0.3*h_ below baseline (standard
      //     typography proportion; covers p, q, y, g, j tails — without
      //     this padding NNLS smears descender pixels across all plates
      //     producing rainbow artifacts under each text line)
      //   - small horizontal slack on left/right for italics/kerning
      // Push the four corners through viewport.transform (which flips Y
      // for canvas-space) to get pixel-space coordinates.
      // NOTE: text-rotation/skew (where t[1] or t[2] != 0) breaks this
      // axis-aligned assumption — for the v1 text-routing feature we
      // assume horizontal text, which covers the vast majority of PDFs.
      const w_ = item.width || 1;
      const h_ = item.height || 1;
      const descender = h_ * 0.3;
      const x0p = t[4],          y0p = t[5] - descender;
      const x1p = t[4] + w_,     y1p = t[5] + h_;
      const xform = (x, y) => [vt[0]*x + vt[2]*y + vt[4], vt[1]*x + vt[3]*y + vt[5]];
      const p0 = xform(x0p, y0p), p1 = xform(x1p, y0p);
      const p2 = xform(x1p, y1p), p3 = xform(x0p, y1p);
      const cx = [p0[0], p1[0], p2[0], p3[0]];
      const cy = [p0[1], p1[1], p2[1], p3[1]];
      const minX = Math.max(0, Math.floor(Math.min(cx[0], cx[1], cx[2], cx[3])) - 1);
      const minY = Math.max(0, Math.floor(Math.min(cy[0], cy[1], cy[2], cy[3])) - 1);
      const maxX = Math.min(w - 1, Math.ceil(Math.max(cx[0], cx[1], cx[2], cx[3])) + 1);
      const maxY = Math.min(h - 1, Math.ceil(Math.max(cy[0], cy[1], cy[2], cy[3])) + 1);
      if(maxX <= minX || maxY <= minY) continue;
      // Estimate this rect's background by sampling its rim — pixels just
      // OUTSIDE the rect's polygon (1-2px ring around it) are typically
      // pure background. Average them to get bg color.
      const bg = sampleRingBg(srcData, w, h, cx, cy, minX, minY, maxX, maxY);
      if(!bg) continue;
      // For each pixel in the AABB inside the polygon, mask alpha is the
      // color distance from bg (saturating curve). Glyph pixels (which
      // differ from bg) light up; whitespace pixels (which match bg) stay
      // at 0 → bg shows through normally.
      for(let py = minY; py <= maxY; py++){
        for(let px = minX; px <= maxX; px++){
          if(!pointInQuad(px + 0.5, py + 0.5, cx, cy)) continue;
          const i = (py * w + px) * 4;
          const dr = srcData[i]   - bg[0];
          const dg = srcData[i+1] - bg[1];
          const db = srcData[i+2] - bg[2];
          const distSq = dr*dr + dg*dg + db*db;
          // Soft threshold: distSq=0 → alpha 0; distSq=2500+ → alpha 1.
          // Tuned so anti-aliased glyph rims (mid-distance) get partial
          // mask values for smooth handoff.
          const a01 = Math.min(1, distSq / 2500);
          const m255 = (a01 * 255) | 0;
          // Take MAX so overlapping rects don't reduce each other's mask
          if(m255 > md[i]){
            md[i] = md[i+1] = md[i+2] = m255;
            md[i+3] = 255;
          }
          // Inpaint: where mask is meaningfully high, replace the source
          // pixel with bg color so non-text plates can render the bg
          // behind glyphs cleanly. EXCEPT for reverse-out text (light
          // glyph on dark bg, e.g. white text on red block) — there the
          // glyph IS lighter than bg, so replacing with bg would force
          // ink onto a region that should be paper-color. Detect via
          // luminance and skip inpainting in that case; NNLS on the
          // original lighter value naturally yields ~0 ink coverage,
          // letting paper show through.
          if(m255 > 13){ // ~5% threshold (matches shader gate)
            const srcLum = 0.299*srcData[i] + 0.587*srcData[i+1] + 0.114*srcData[i+2];
            const bgLum  = 0.299*bg[0]      + 0.587*bg[1]        + 0.114*bg[2];
            if(bgLum > srcLum + 10){
              // Normal case: glyph darker than bg → inpaint to bg
              ipd[i]   = bg[0]|0;
              ipd[i+1] = bg[1]|0;
              ipd[i+2] = bg[2]|0;
              ipd[i+3] = 255;
              inpaintedDirty = true;
            }
            // Else (reverse-out): leave inpainted source as-is so the
            // glyph's actual lighter color flows into NNLS, producing
            // the correct "absence of ink" rendering.
          }
        }
      }
    }
    mctx.putImageData(maskData, 0, 0);
    if(inpaintedDirty) ipctx.putImageData(inpaintedData, 0, 0);
    // Soft-blur 1px so glyph rim mask values transition smoothly
    try {
      const blurred = document.createElement('canvas');
      blurred.width = w; blurred.height = h;
      const bctx = blurred.getContext('2d');
      bctx.filter = 'blur(0.7px)';
      bctx.drawImage(mask, 0, 0);
      mctx.clearRect(0, 0, w, h);
      mctx.drawImage(blurred, 0, 0);
    } catch(_){}
  } catch(err) {
    console.warn('text-mask: getTextContent failed', err);
  }
  return {mask, inpainted};
}

// Sample the 1-2px ring just outside a rotated rect for bg color
// estimation. Walks the AABB rim and accepts pixels that are NOT inside
// the polygon (so we get pure background, not text). Returns [r,g,b] or
// null if no rim pixels could be sampled.
function sampleRingBg(srcData, w, h, cx, cy, minX, minY, maxX, maxY){
  let r = 0, g = 0, b = 0, n = 0;
  // Walk the outer rim of the AABB; expand by 1-2px so the ring lies
  // outside the polygon.
  const ringX0 = Math.max(0, minX - 2);
  const ringY0 = Math.max(0, minY - 2);
  const ringX1 = Math.min(w - 1, maxX + 2);
  const ringY1 = Math.min(h - 1, maxY + 2);
  // Sample top and bottom rows, then left and right columns. Skip
  // pixels that happen to fall inside the polygon (rotated quads cross
  // their AABB corners).
  for(let px = ringX0; px <= ringX1; px += 2){
    if(!pointInQuad(px + 0.5, ringY0 + 0.5, cx, cy)){
      const i = (ringY0 * w + px) * 4;
      r += srcData[i]; g += srcData[i+1]; b += srcData[i+2]; n++;
    }
    if(!pointInQuad(px + 0.5, ringY1 + 0.5, cx, cy)){
      const i = (ringY1 * w + px) * 4;
      r += srcData[i]; g += srcData[i+1]; b += srcData[i+2]; n++;
    }
  }
  for(let py = ringY0; py <= ringY1; py += 2){
    if(!pointInQuad(ringX0 + 0.5, py + 0.5, cx, cy)){
      const i = (py * w + ringX0) * 4;
      r += srcData[i]; g += srcData[i+1]; b += srcData[i+2]; n++;
    }
    if(!pointInQuad(ringX1 + 0.5, py + 0.5, cx, cy)){
      const i = (py * w + ringX1) * 4;
      r += srcData[i]; g += srcData[i+1]; b += srcData[i+2]; n++;
    }
  }
  if(n < 4) return null;
  return [r / n, g / n, b / n];
}

// Point-in-quad test for a 4-vertex polygon (rotated rect). Uses the
// half-plane sign trick: a point is inside a convex quad iff it lies on
// the same side of all 4 edges.
function pointInQuad(px, py, cx, cy){
  let sign = 0;
  for(let i = 0; i < 4; i++){
    const j = (i + 1) & 3;
    const dx = cx[j] - cx[i], dy = cy[j] - cy[i];
    const ex = px - cx[i],     ey = py - cy[i];
    const cross = dx * ey - dy * ex;
    if(cross !== 0){
      const s = cross > 0 ? 1 : -1;
      if(sign === 0) sign = s;
      else if(sign !== s) return false;
    }
  }
  return true;
}

// Load all pages from a PDF — returns metadata + first page hi-res.
// Progress reported via pdfProgressUpdate() so the user sees what's happening
// instead of staring at a frozen toast for 30+ seconds on a long document.
async function loadPdfAllPages(file){
  if(!window.pdfjsLib){R.toast('PDF library not loaded');return null;}
  pdfProgressShow('Reading PDF…', 0, 1);
  const ab=await file.arrayBuffer();
  const pdf=await pdfjsLib.getDocument({data:ab}).promise;
  const n=pdf.numPages;
  // Each phase counts: meta-scan (n) + thumbnails (n) + first-page hi-res (1)
  const totalSteps=n*2+1;
  let stepsDone=0;
  const t0=performance.now();
  const tick=(label)=>{
    stepsDone++;
    pdfProgressUpdate(label, stepsDone, totalSteps, t0);
  };
  // Capture native dimensions per page for export sizing
  const meta=[];
  for(let i=1;i<=n;i++){
    const page=await pdf.getPage(i);
    const vp=page.getViewport({scale:1});
    meta.push({nativeW:vp.width, nativeH:vp.height});
    tick('Reading page '+i+'/'+n);
  }
  // Render thumbnails (small, fast)
  const thumbs=[];
  for(let i=1;i<=n;i++){
    thumbs.push(await renderPdfPage(pdf, i, 180));
    tick('Rendering thumbnail '+i+'/'+n);
  }
  // Render active (first) page at hi-res for the viewfinder
  pdfProgressUpdate('Rendering page 1…', stepsDone, totalSteps, t0);
  const hiRes=await renderPdfPage(pdf, 1, Math.min(2400, meta[0].nativeW*3));
  tick('Done');
  // Brief delay so the user sees "Done" before it disappears
  setTimeout(pdfProgressHide, 250);
  return {pdf, pageCount:n, meta, thumbs, hiRes};
}

// ─── PDF loading progress overlay ─────────────────────────────────────
// Lazily-built fixed-position overlay: status text + progress bar + ETA.
function pdfProgressShow(label, done, total){
  let el=document.getElementById('pdfProgressOverlay');
  if(!el){
    el=document.createElement('div');
    el.id='pdfProgressOverlay';
    el.className='pdf-progress-overlay';
    el.innerHTML='<div class="pdf-progress-box">'+
      '<div class="pdf-progress-label" id="pdfProgressLabel">'+label+'</div>'+
      '<div class="pdf-progress-bar"><div class="pdf-progress-fill" id="pdfProgressFill"></div></div>'+
      '<div class="pdf-progress-eta" id="pdfProgressEta"></div>'+
    '</div>';
    document.body.appendChild(el);
  }
  pdfProgressUpdate(label, done, total, performance.now());
  el.style.display='flex';
}
function pdfProgressUpdate(label, done, total, startMs){
  const lblEl=document.getElementById('pdfProgressLabel');
  const fillEl=document.getElementById('pdfProgressFill');
  const etaEl=document.getElementById('pdfProgressEta');
  if(!lblEl||!fillEl||!etaEl) return;
  lblEl.textContent=label;
  const pct=Math.max(0, Math.min(100, (done/total)*100));
  fillEl.style.width=pct.toFixed(1)+'%';
  // ETA — only meaningful after a few steps so the average stabilises
  if(startMs && done>=2 && done<total){
    const elapsed=(performance.now()-startMs)/1000;
    const total_s=elapsed*total/done;
    const remain=Math.max(0, total_s-elapsed);
    etaEl.textContent=remain<2?'<2s remaining':Math.round(remain)+'s remaining';
  } else if(done>=total){
    etaEl.textContent='';
  } else {
    etaEl.textContent='';
  }
}
function pdfProgressHide(){
  const el=document.getElementById('pdfProgressOverlay');
  if(el) el.style.display='none';
}

// Load only the first page (legacy alias used during initial load before
// the multi-page UI was added)
async function loadPdfFirstPage(file){
  const res=await loadPdfAllPages(file);
  return res ? res.hiRes : null;
}
// Accept either a change event (from <input type=file>) or a File directly (drag/drop)
function handleFile(e){
  let f, isInput=false;
  if(e instanceof File){f=e;}
  else if(e&&e.target&&e.target.files){f=e.target.files[0];isInput=true;}
  if(!f)return;
  // New source — reset rotation state
  window._sourceRotation=0;
  const isVideo=f.type.startsWith('video/');
  const isGif=f.type==='image/gif'||f.name.toLowerCase().endsWith('.gif');
  const isPdf=f.type==='application/pdf'||f.name.toLowerCase().endsWith('.pdf');
  if(isPdf){
    stopVideo();
    if(camOn){if(camStream)camStream.getTracks().forEach(t=>t.stop());camOn=false;}
    pdfCacheClear(); // new PDF — drop old cached page rasters
    R.toast('Loading PDF…');
    loadPdfAllPages(f).then(res=>{
      if(!res)return;
      // Save state for the multi-page UI
      window._pdfDoc=res.pdf;
      window._pdfMeta=res.meta;
      window._pdfThumbs=res.thumbs;
      window._pdfActiveIdx=0;
      // Upload first page as the active source
      const canvas=res.hiRes;
      srcImg=canvas;
      const firstPageW=Math.min(2400, res.meta[0].nativeW*3);
      // Default state on PDF load: PDF mode is OFF, so u_src holds the
      // ORIGINAL raster (preserves normal rendering). The inpainted
      // version is uploaded as u_srcOrig (held in reserve) and swapped
      // into u_src by togglePdfMode/setPdfPage when PDF mode turns on.
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,window._srcTexA);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
      gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,window._srcTexB);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
      window._lastSourceCanvas = canvas;
      notifySourceChanged();
      // u_srcOrig (TEXTURE7) gets the ORIGINAL — text plate's single-ink
      // NNLS reads glyph color from here even when u_src is inpainted.
      if(R.uploadOriginalSource) R.uploadOriginalSource(canvas);
      // Upload first page's text mask too (cached from renderPdfPage above)
      if(R.uploadTextMask) R.uploadTextMask(pdfPageMask(res.pdf, 1, firstPageW));
      camOn=false;hasSrc=true;needsAspectUpdate=true;computeCrop();scheduleRender();
      const lbl=res.pageCount>1?'◉ PDF '+(1)+'/'+res.pageCount:'◉ PDF';
      $status.textContent=lbl;
      $res.textContent=canvas.width+'×'+canvas.height;
      // Apply PDF-mode UI changes (FIT, margin=0, fps=0, etc.) before snapshotting
      applyPdfModeUI(true);
      // Show the PDF mode button (hidden by default for non-PDF sources)
      if(R.syncPdfUI) R.syncPdfUI();
      // Initialize per-page settings: page 0 is master, all others inherit
      pdfInitPageVars();
      // Build thumbnail strip + actions bar
      renderPdfThumbStrip();
      pdfRenderPageActions();
    }).catch(err=>{console.error('PDF load error:',err);R.toast('PDF load failed');});
    if(isInput) e.target.value='';
    hideOnboarding();
    return;
  }
  // Loading anything other than a PDF clears PDF state
  if(window._pdfDoc){
    window._pdfDoc=null;window._pdfMeta=null;window._pdfThumbs=null;window._pdfActiveIdx=0;
    window._pdfPageVars=null;window._pdfMasterIdx=0;window._pdfInheritFrom=null;
    pdfCacheClear();
    renderPdfThumbStrip();
    pdfRenderPageActions();
    applyPdfModeUI(false);
    // Clear text mask + original-source side-channel — non-PDF sources
    // have no vector text. u_src remains whatever the new source is.
    if(R.uploadTextMask) R.uploadTextMask(null);
    if(R.uploadOriginalSource) R.uploadOriginalSource(null);
    pdfModeOn=false; textChannelColor=null;
    if(R.syncPdfUI) R.syncPdfUI();
  }
  if(isVideo){
    // Video: load into <video> element and play looped
    stopVideo();
    if(camOn){if(camStream)camStream.getTracks().forEach(t=>t.stop());camOn=false;}
    const url=URL.createObjectURL(f);
    $vid.srcObject=null;
    $vid.src=url;$vid.loop=true;$vid.muted=true;$vid.playsInline=true;
    $vid.onloadeddata=()=>{
      URL.revokeObjectURL(url);
      $vid.play();
      videoOn=true;camOn=false;hasSrc=true;needsAspectUpdate=true;computeCrop();scheduleRender();
      $status.textContent='▶ VIDEO';
      $res.textContent=$vid.videoWidth+'×'+$vid.videoHeight;
      // Same as camera path — RISO mode's static master would overlay the
      // previous image's dither over the video. Invalidate and disable.
      if(window.R && window.R.invalidateAmt) window.R.invalidateAmt();
      if(window._mode === 'flat'){
        try { gl.uniform1f(locs.u_useAmt, 0.0); } catch(e) {}
        try { R.toast && R.toast('RISO mode: video shows preview only, mode is static-source.', 3000); } catch(e) {}
      }
      if($vid.requestVideoFrameCallback){
        $vid.requestVideoFrameCallback(R.onVideoFrame);
      }else{
        window._vidFallback=setInterval(()=>{if(videoOn&&$vid.readyState>=2){videoFrameReady=true;scheduleRender();}else if(!videoOn)clearInterval(window._vidFallback);},50);
      }
      markDirty();
    };
  }else if(isGif){
    // Animated GIF: use ImageDecoder API (reliable frame-by-frame) with <img> fallback
    stopVideo();
    if(camOn){if(camStream)camStream.getTracks().forEach(t=>t.stop());camOn=false;}

    function initGifPlayback(w,h){
      if(!gifCanvas)gifCanvas=document.createElement('canvas');
      gifCanvas.width=w;gifCanvas.height=h;
      gifCtx=gifCanvas.getContext('2d');
      srcImg=gifCanvas;
      videoOn=true;camOn=false;hasSrc=true;needsAspectUpdate=true;computeCrop();scheduleRender();
      $status.textContent='▶ GIF';
      $res.textContent=w+'×'+h;
      gifFrameIdx=0;gifLastTime=0; // force immediate first-frame draw
      // Draw first frame immediately into texture
      if(gifFrames&&gifFrames.length>0){
        gifCtx.drawImage(gifFrames[0].canvas,0,0);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,window._srcTexA);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,gifCanvas);
        // Also set texture B for static reference
        gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,window._srcTexB);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,gifCanvas);
        videoFrameReady=true;markDirty();
      }
      startGifLoop();
    }

    if(typeof ImageDecoder!=='undefined'){
      // ImageDecoder path: decode every frame with proper timing & disposal
      f.arrayBuffer().then(ab=>{
        const decoder=new ImageDecoder({data:ab,type:'image/gif'});
        // Wait for tracks to be ready, then for all frames to be parsed
        decoder.tracks.ready.then(()=>decoder.completed).then(()=>{
          const track=decoder.tracks.selectedTrack;
          if(!track){console.warn('No selected track');loadGifFallback(f);return;}
          const count=track.frameCount;
          if(!count){R.toast('GIF has no frames');return;}
          const frames=[];
          const compCanvas=document.createElement('canvas');
          let compCtx=null;
          function decodeNext(idx){
            if(idx>=count){
              gifFrames=frames;
              initGifPlayback(compCanvas.width,compCanvas.height);
              decoder.close();
              return;
            }
            decoder.decode({frameIndex:idx}).then(result=>{
              const vf=result.image;
              // Capture duration before closing (microseconds → milliseconds)
              const frameDur=Math.max((vf.duration||100000)/1000, 20);
              if(!compCtx){
                compCanvas.width=vf.displayWidth;compCanvas.height=vf.displayHeight;
                compCtx=compCanvas.getContext('2d');
              }
              // For disposal: clear if needed (simple approach: always composite)
              if(idx===0) compCtx.clearRect(0,0,compCanvas.width,compCanvas.height);
              // Draw decoded frame onto composite
              const tmpC=document.createElement('canvas');
              tmpC.width=vf.displayWidth;tmpC.height=vf.displayHeight;
              tmpC.getContext('2d').drawImage(vf,0,0);
              vf.close();
              compCtx.drawImage(tmpC,0,0);
              // Snapshot composited result
              const snapC=document.createElement('canvas');
              snapC.width=compCanvas.width;snapC.height=compCanvas.height;
              snapC.getContext('2d').drawImage(compCanvas,0,0);
              frames.push({canvas:snapC, duration:frameDur});
              decodeNext(idx+1);
            }).catch(()=>decodeNext(idx+1));
          }
          decodeNext(0);
        }).catch(err=>{
          console.warn('ImageDecoder failed, falling back to <img>',err);
          decoder.close();
          loadGifFallback(f);
        });
      }).catch(err=>{
        console.warn('GIF read failed, falling back to <img>',err);
        loadGifFallback(f);
      });
    }else{
      loadGifFallback(f);
    }
  }else{
    // Image: load as before
    stopVideo();
    const r=new FileReader();
    r.onload=ev=>{
      const img=new Image();
      img.onload=()=>{
        const flat=flattenAlpha(img);
        srcImg=flat;
        // Upload to both source textures (no previous frame for static images)
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,window._srcTexA);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,flat);
        gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,window._srcTexB);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,flat);
        window._lastSourceCanvas = flat;
        notifySourceChanged();
        camOn=false;hasSrc=true;needsAspectUpdate=true;computeCrop();scheduleRender();
        $status.textContent='◉ IMAGE';
        $res.textContent=img.width+'×'+img.height;
      };
      img.src=ev.target.result;
    };
    r.readAsDataURL(f);
  }
  e.target.value='';
  hideOnboarding();
}

function loadSampleImage(){
  // Generate a colorful test image procedurally — hue sweep + color blocks + gradients
  const w=640,h=480;
  const c=document.createElement('canvas');c.width=w;c.height=h;
  const ctx2=c.getContext('2d');
  // Sky-to-ground gradient background
  const bg=ctx2.createLinearGradient(0,0,0,h);
  bg.addColorStop(0,'#4a90d9');bg.addColorStop(0.45,'#87ceeb');bg.addColorStop(0.55,'#8fbc8f');bg.addColorStop(1,'#3a5f3a');
  ctx2.fillStyle=bg;ctx2.fillRect(0,0,w,h);
  // Sun
  const sun=ctx2.createRadialGradient(480,80,10,480,80,80);
  sun.addColorStop(0,'#fff8dc');sun.addColorStop(0.4,'#ffe066');sun.addColorStop(1,'rgba(255,224,102,0)');
  ctx2.fillStyle=sun;ctx2.fillRect(400,0,240,160);
  // Color blocks — arranged like paint swatches
  const colors=['#e63946','#f1a208','#f7e733','#2d6a4f','#457b9d','#1d3557','#6a4c93','#e76f51','#d4a373','#264653','#ef476f','#06d6a0'];
  colors.forEach((col,i)=>{
    const x=20+(i%6)*100, y=140+Math.floor(i/6)*80;
    ctx2.fillStyle=col;ctx2.fillRect(x,y,85,65);
    // Inner highlight
    ctx2.fillStyle='rgba(255,255,255,0.2)';ctx2.fillRect(x+2,y+2,81,20);
  });
  // Grayscale strip
  for(let i=0;i<10;i++){
    const v=Math.round(i*28.3);
    ctx2.fillStyle=`rgb(${v},${v},${v})`;
    ctx2.fillRect(20+i*60,320,55,40);
  }
  // Skin tone strip
  const skins=['#f5d0a9','#e8b88a','#c68c53','#8d5524','#3b1f0a','#f9c9a8','#dba270','#a0612e'];
  skins.forEach((col,i)=>{ctx2.fillStyle=col;ctx2.fillRect(20+i*75,375,68,40);});
  // Hue sweep bar at bottom
  for(let x=0;x<w;x++){
    ctx2.fillStyle=`hsl(${x/w*360},85%,50%)`;
    ctx2.fillRect(x,430,1,35);
  }
  // Load into WebGL
  const img=new Image();
  img.onload=()=>{
    srcImg=img;
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,window._srcTexA);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
    gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,window._srcTexB);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
    window._lastSourceCanvas = img;
    notifySourceChanged();
    hasSrc=true;needsAspectUpdate=true;computeCrop();scheduleRender();
    $status.textContent='● SAMPLE';
    $res.textContent=w+'×'+h;
  };
  // PNG (lossless) — JPEG at 0.92 produced visible 8×8 DCT block artifacts in
  // the smooth sky gradient. After halftoning at canvas resolution (~3.5×
  // upsample), each JPEG block became a ~28-px rectangular patch in the output,
  // looking like a "smaller copy" of the test pattern overlaid on the sky.
  img.src=c.toDataURL('image/png');
}

function showOnboarding(){
  const hint=document.createElement('div');
  hint.id='onboardHint';
  hint.className='onboard-hint';
  hint.innerHTML='<div class="onboard-inner"><div class="onboard-icon">◉</div><div class="onboard-title">RISO/CAM</div><div class="onboard-text">Upload an image or use your camera<br>to simulate risograph printing</div><div class="onboard-actions"><button class="onboard-btn" onclick="R.pickFile();R.hideOnboarding()">UPLOAD</button><button class="onboard-btn" onclick="R.toggleCam();R.hideOnboarding()">CAMERA</button></div></div>';
  el('viewfinder').appendChild(hint);
}
function hideOnboarding(){const h=document.getElementById('onboardHint');if(h)h.remove();}

async function toggleCam(){
  if(window._pdfDoc&&!camOn){R.toast('Camera disabled in PDF mode');return;}
  if(camOn){
    if(camStream)camStream.getTracks().forEach(t=>t.stop());
    camOn=false;
    $gl.classList.remove('mirrored');
    if(window._camFallback){clearInterval(window._camFallback);window._camFallback=null;}
    el('camBtn').textContent='CAMERA';
    if(srcImg){
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,window._srcTexA);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,srcImg);
      gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,window._srcTexB);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,srcImg);
      window._lastSourceCanvas = srcImg;
      notifySourceChanged();
    }
    needsAspectUpdate=true;scheduleRender();
    $status.textContent=srcImg?'◉ IMAGE':'● READY';
    return;
  }
  try{
    stopVideo(); // stop any uploaded video before starting camera
    camStream=await navigator.mediaDevices.getUserMedia({video:{facingMode,width:{ideal:R.isPhone()?640:1280}}});
    $vid.srcObject=camStream;
    // Wait for video to actually start playing
    await $vid.play();
    camOn=true;needsAspectUpdate=true;computeCrop();scheduleRender();
    // RISO mode bakes the dither pattern into per-channel master textures from
    // the STATIC source. With a live camera, the master would be stale (showing
    // the previous image's dot pattern over the new camera colors → "overlay"
    // bug). Invalidate the master and force u_useAmt=0 so the shader falls back
    // to per-fragment dither (the shader's mode-3 fallback path) for live frames.
    if(window.R && window.R.invalidateAmt) window.R.invalidateAmt();
    if(window._mode === 'flat'){
      try { gl.uniform1f(locs.u_useAmt, 0.0); } catch(e) {}
      try { R.toast && R.toast('RISO mode: camera shows preview only, mode is static-source.', 3000); } catch(e) {}
    }
    $gl.classList.toggle('mirrored',facingMode==='user');
    el('camBtn').textContent='STOP CAM';
    $status.textContent='● LIVE';
    hideOnboarding();
    // Use requestVideoFrameCallback if available (Chrome/Edge)
    if($vid.requestVideoFrameCallback){
      $vid.requestVideoFrameCallback(R.onVideoFrame);
    }else{
      // Fallback: check video readiness at 20fps instead of every RAF
      if(window._camFallback)clearInterval(window._camFallback);
      window._camFallback=setInterval(()=>{if(camOn&&$vid.readyState>=2){videoFrameReady=true;scheduleRender();}else if(!camOn)clearInterval(window._camFallback);},50);
    }
  }catch(e){
    R.toast('Camera not available');
    if(window._debugLog) window._debugLog('CAM: '+e.name+': '+e.message);
  }
}



// Extract a URL from a drag event when the user drops content from another
// website (the browser passes a URL string instead of file bytes).
function extractDroppedURL(dt){
  if(!dt) return null;
  // 1) text/uri-list (most reliable for cross-origin image/file drags)
  let s=dt.getData('text/uri-list');
  if(s){
    const line=s.split('\n').map(x=>x.trim()).filter(x=>x&&!x.startsWith('#'))[0];
    if(line) return line;
  }
  // 2) text/html — usually contains an <img src="..."> or <a href="...">
  s=dt.getData('text/html');
  if(s){
    const m=/<img[^>]+src=["']([^"']+)["']/i.exec(s) || /<a[^>]+href=["']([^"']+)["']/i.exec(s);
    if(m) return m[1];
  }
  // 3) text/plain fallback (some browsers only put plain text)
  s=dt.getData('text/plain');
  if(s && /^https?:\/\//i.test(s.trim())) return s.trim();
  return null;
}

// Cloudflare Worker proxy used as a last-resort CORS bypass.
// Server-side fetch + permissive CORS headers; cap 50 MB.
const CORS_PROXY = 'https://nplg-proxy.georgekikoria.workers.dev/fetch?url=';

// Resolve a URL to a File. Tries strategies in order:
//   A) direct fetch (fastest; works if origin sends permissive CORS)
//   B) <img crossOrigin> + canvas (works for image hosts with permissive CORS)
//   C) Cloudflare worker proxy (catches everything else; preserves original bytes)
async function urlToFile(url){
  // Strategy A: direct fetch
  try{
    const resp=await fetch(url, {mode:'cors', credentials:'omit'});
    if(resp.ok){
      const blob=await resp.blob();
      const name=(url.split('/').pop()||'dropped').split(/[?#]/)[0]||'dropped';
      return new File([blob], name, {type: blob.type||'application/octet-stream'});
    }
  }catch(_){/* fall through */}

  // Strategy B: <img crossOrigin> + canvas (images only)
  try{
    return await new Promise((resolve, reject) => {
      const img=new Image();
      img.crossOrigin='anonymous';
      img.onload=()=>{
        const c=document.createElement('canvas');
        c.width=img.naturalWidth; c.height=img.naturalHeight;
        c.getContext('2d').drawImage(img,0,0);
        try{
          c.toBlob(b=>{
            if(!b) return reject(new Error('toBlob failed'));
            const name=(url.split('/').pop()||'dropped.png').split(/[?#]/)[0];
            resolve(new File([b], name, {type: b.type||'image/png'}));
          },'image/png');
        }catch(e){ reject(e); }
      };
      img.onerror=()=>reject(new Error('img load failed'));
      img.src=url;
    });
  }catch(_){/* fall through */}

  // Strategy C: server-side proxy (preserves GIF animation, video, PDF bytes)
  const proxied=CORS_PROXY+encodeURIComponent(url);
  const resp=await fetch(proxied);
  if(!resp.ok) throw new Error('Proxy returned '+resp.status);
  const blob=await resp.blob();
  const name=(url.split('/').pop()||'dropped').split(/[?#]/)[0]||'dropped';
  return new File([blob], name, {type: blob.type||'application/octet-stream'});
}

// Drag-and-drop: accept image/video/gif/pdf dropped anywhere on the page.
// Works for local files AND for content dragged from other websites
// (using URL-extraction + fetch fallback).
//
// Uses a timer-based drag-over detector instead of a depth counter — the
// counter approach breaks when browsers fire asymmetric dragleave events
// after drop, leaving depth in a negative state and making subsequent
// drags appear "stuck" or fail to register feedback.
function initDragDrop(){
  const vf=el('viewfinder')||document.body;
  let dragTimer=0;
  function setOver(on){vf.classList.toggle('drag-over', on);}
  function onOver(e){
    // Required: preventDefault on dragover so drop fires
    e.preventDefault();
    if(e.dataTransfer) e.dataTransfer.dropEffect='copy';
    setOver(true);
    // Reset the leave timer — fires when dragover stops (cursor leaves window/drops)
    clearTimeout(dragTimer);
    dragTimer=setTimeout(()=>setOver(false), 120);
  }
  async function onDrop(e){
    e.preventDefault();
    clearTimeout(dragTimer);
    setOver(false);
    const dt=e.dataTransfer;
    if(!dt) return;
    // 1) Local files dropped from OS (or some browsers also expose dragged
    //    web images as files)
    const files=dt.files;
    if(files&&files.length){
      const f=files[0];
      const ok=f.type.startsWith('image/')||f.type.startsWith('video/')||f.type==='application/pdf'||/\.(pdf|gif)$/i.test(f.name);
      if(!ok){R.toast('Unsupported file type');return;}
      handleFile(f);
      return;
    }
    // 2) URL drag from another website
    const url=extractDroppedURL(dt);
    if(!url){R.toast('Nothing to drop');return;}
    R.toast('Loading from URL…');
    try{
      const file=await urlToFile(url);
      handleFile(file);
    }catch(err){
      console.error('Cross-site drop failed:',err);
      R.toast('Drop blocked by site CORS — save image and re-drop');
    }
  }
  // Listen on document (more reliable than window for cross-browser behavior)
  document.addEventListener('dragover', onOver);
  document.addEventListener('drop', onDrop);
  // Clear the indicator if the drag genuinely leaves the page
  document.addEventListener('dragleave', e=>{
    // relatedTarget is null when the cursor leaves the document entirely
    if(!e.relatedTarget){clearTimeout(dragTimer);setOver(false);}
  });
}

// ─── Per-page settings (master / variation system) ──────────────────────
// Capture the look settings the user typically wants to vary per page.
// (Intentionally narrower than full undo state — paper, regmark, advanced
// CMYK tuning stay global so the document feels coherent.)
function pdfSnapshotSettings(){
  return {
    channels:[...channels],
    angles:[...layerAngles],
    skews:[...layerSkews],
    dens:[...cached.layerDens],
    profile: activeProf?activeProf.name:null,
    mode,
    sepType: cached.sepType,
    grainSize: cached.grainSize,
    dotGain: cached.dotGain,
    inkNoise: cached.inkNoise,
    paperTex: cached.paperTex,
    lpi: cached.lpi,
    imgBright: cached.imgBright,
    imgContrast: cached.imgContrast,
    imgSat: cached.imgSat,
    imgShadows: cached.imgShadows,
    imgHighlights: cached.imgHighlights||0,
    postExposure: cached.postExposure||0,
    postContrast: cached.postContrast||0,
    postSat: cached.postSat||0,
  };
}
function pdfApplySettings(s){
  if(!s) return;
  channels=[...s.channels];
  layerAngles=[...s.angles];
  layerSkews=[...s.skews];
  cached.layerDens=[...s.dens];
  mode=s.mode;
  cached.sepType=s.sepType||0;
  cached.grainSize=s.grainSize;
  cached.dotGain=s.dotGain;
  cached.inkNoise=s.inkNoise;
  cached.paperTex=s.paperTex;
  cached.lpi=s.lpi;
  cached.imgBright=s.imgBright;
  cached.imgContrast=s.imgContrast;
  cached.imgSat=s.imgSat;
  cached.imgShadows=s.imgShadows;
  cached.imgHighlights=s.imgHighlights||0;
  cached.postExposure=s.postExposure||0;
  cached.postContrast=s.postContrast||0;
  cached.postSat=s.postSat||0;
  // Restore profile reference if the snapshot used one
  if(s.profile && typeof R.allProfiles==='function'){
    activeProf=R.allProfiles().find(p=>p.name===s.profile)||null;
  } else if(!s.profile){
    activeProf=null;
  }
  // Sync UI sliders that were updated
  ['imgBright','imgContrast','imgSat','imgShadows','imgHighlights','postExposure','postContrast','postSat','grainSize','dotGain','inkNoise','paperTex','lpi'].forEach(id=>{
    const v=cached[id]; const e=el(id); if(e) e.value=v;
    const ve=el(id+'Val'); if(ve) ve.textContent=v;
  });
  if(typeof cacheInkColors==='function') cacheInkColors();
  if(typeof R.updateUI==='function') R.updateUI();
  needsAspectUpdate=true;
  markDirty();
}

// Initialize per-page state: page 0 is master, all others inherit from master
function pdfInitPageVars(){
  window._pdfMasterIdx=0;
  window._pdfPageVars={};
  window._pdfPageVars[0]=pdfSnapshotSettings();
  // Each inheriting page can choose its source (master or any variation).
  // Defaults to master. Stored as the source page index.
  window._pdfInheritFrom={};
  // Stable variation IDs — each saved variation gets a unique number that
  // never renumbers when other variations are deleted. So "V2" always
  // refers to the same physical save, even if V1 is later removed.
  window._pdfPageVarIds={};
  window._pdfNextVarId=1;
}

// Save current settings into the active page's slot if it has one
// (master always has one; variations have one; inheriting pages don't)
function pdfPersistCurrent(){
  const idx=window._pdfActiveIdx;
  if(idx===window._pdfMasterIdx || (window._pdfPageVars && window._pdfPageVars[idx]!==undefined)){
    window._pdfPageVars[idx]=pdfSnapshotSettings();
  }
}

// Resolve the source page index that the given page inherits from
// (returns master idx by default; only meaningful for inheriting pages)
function pdfInheritSource(idx){
  const vars=window._pdfPageVars||{};
  const masterIdx=window._pdfMasterIdx||0;
  if(window._pdfInheritFrom&&window._pdfInheritFrom[idx]!==undefined){
    const src=window._pdfInheritFrom[idx];
    // Validate: source must still exist as master or variation
    if(src===masterIdx || vars[src]!==undefined) return src;
  }
  return masterIdx;
}
// Apply the right settings for the page about to become active
function pdfApplyForActive(){
  const idx=window._pdfActiveIdx;
  const vars=window._pdfPageVars||{};
  const own=vars[idx];
  if(own && idx!==window._pdfMasterIdx){pdfApplySettings(own);return;}
  // Inheriting page: apply settings from its chosen source
  const srcIdx=pdfInheritSource(idx);
  const srcSettings=vars[srcIdx];
  if(srcSettings) pdfApplySettings(srcSettings);
}
// Set which source an inheriting page follows; apply immediately + toast feedback
function pdfSetInheritSource(srcIdx){
  if(!window._pdfDoc) return;
  const idx=window._pdfActiveIdx;
  if(idx===window._pdfMasterIdx) return; // master doesn't inherit
  if(window._pdfPageVars[idx]!==undefined) return; // own variation, not inheriting
  window._pdfInheritFrom[idx]=srcIdx;
  pdfApplyForActive();
  pdfRenderPageActions();
  renderPdfThumbStrip(); // refresh "inherits from" badge on this page's thumb
  // Visual feedback: toast + brief highlight pulse on the action bar pill
  const lbl=srcIdx===window._pdfMasterIdx?'M':pdfVariationLabel(srcIdx);
  R.toast('Applied '+(lbl||'?')+' to page '+(idx+1));
  const pill=document.querySelector('.pdf-page-state');
  if(pill){
    pill.classList.remove('pdf-state-pulse');
    void pill.offsetWidth; // force reflow so the animation restarts
    pill.classList.add('pdf-state-pulse');
  }
}

// User-facing actions
function pdfSetVariation(){
  if(!window._pdfDoc)return;
  const idx=window._pdfActiveIdx;
  window._pdfPageVars[idx]=pdfSnapshotSettings();
  // Allocate a stable ID on first save. Persists through deletes; later
  // saves of OTHER pages won't reuse this ID even if this one is reset.
  if(!window._pdfPageVarIds) window._pdfPageVarIds={};
  if(!window._pdfPageVarIds[idx]){
    window._pdfPageVarIds[idx] = (window._pdfNextVarId || 1);
    window._pdfNextVarId = (window._pdfNextVarId || 1) + 1;
  }
  R.toast('Page '+(idx+1)+' saved as variation');
  renderPdfThumbStrip();
  pdfRenderPageActions();
}
function pdfResetToMaster(){
  if(!window._pdfDoc)return;
  const idx=window._pdfActiveIdx;
  if(idx===window._pdfMasterIdx){R.toast('This is the master page');return;}
  delete window._pdfPageVars[idx];
  // Drop the stable ID — if this page is saved again later, it'll get a
  // fresh ID (next available number).
  if(window._pdfPageVarIds) delete window._pdfPageVarIds[idx];
  pdfApplyForActive();
  R.toast('Page '+(idx+1)+' reset to master');
  renderPdfThumbStrip();
  pdfRenderPageActions();
}
function pdfSetMaster(){
  if(!window._pdfDoc)return;
  const idx=window._pdfActiveIdx;
  // Snapshot current settings as the new master
  window._pdfPageVars[idx]=pdfSnapshotSettings();
  window._pdfMasterIdx=idx;
  // The new master no longer needs a variation ID
  if(window._pdfPageVarIds) delete window._pdfPageVarIds[idx];
  R.toast('Page '+(idx+1)+' is now master');
  renderPdfThumbStrip();
  pdfRenderPageActions();
}

// Render the master/variation/reset action buttons — sits directly under the
// thumbnail strip in the right column so navigation + state controls stay
// grouped together.
function pdfRenderPageActions(){
  let bar=el('pdfPageActions');
  if(!bar){
    const host=document.querySelector('.controls-panel');
    const strip=el('pdfThumbStrip');
    if(!host)return;
    bar=document.createElement('div');
    bar.id='pdfPageActions';
    bar.className='pdf-page-actions';
    // Insert after the strip if it exists, otherwise at the top
    if(strip && strip.parentElement===host){
      host.insertBefore(bar, strip.nextSibling);
    } else {
      host.insertBefore(bar, host.firstChild);
    }
  }
  if(!window._pdfDoc){bar.style.display='none';bar.innerHTML='';return;}
  bar.style.display='flex';
  const idx=window._pdfActiveIdx;
  const isMaster=idx===window._pdfMasterIdx;
  const varLabel=pdfVariationLabel(idx); // 'V1', 'V2', ... or null
  const hasVar=!!varLabel;
  // Pill: 'M' (master) / 'V1', 'V2'... (variation) / 'INHERITS' (no override)
  const stateLabel=isMaster?'M':(hasVar?varLabel:'INHERITS');
  const stateClass=isMaster?'master':(hasVar?'variation':'inherits');

  // ── Row 1: state + source selector ────────────────────────────────
  let row1='<div class="pdf-state-row"><span class="pdf-page-state pdf-state-'+stateClass+'">'+stateLabel+'</span>';
  // On inheriting pages: show source selector. Inline buttons up to 3
  // options; collapse to a dropdown beyond that to keep the row tidy.
  if(!isMaster && !hasVar){
    const masterIdx=window._pdfMasterIdx||0;
    const vars=window._pdfPageVars||{};
    const currentSrc=pdfInheritSource(idx);
    const opts=[{idx: masterIdx, label:'M', page: masterIdx + 1}];
    for(let i=0;i<window._pdfMeta.length;i++){
      if(i!==masterIdx && vars[i]!==undefined){
        opts.push({idx:i, label: pdfVariationLabel(i) || 'V?', page: i + 1});
      }
    }
    if(opts.length>1){
      row1+='<span class="pdf-source-label">Source:</span>';
      if(opts.length<=3){
        // Few enough options — show inline pills
        row1+='<div class="pdf-source-selector">';
        opts.forEach(o=>{
          const sel=o.idx===currentSrc?' selected':'';
          row1+='<button class="pdf-source-opt'+sel+'" title="Page '+o.page+'" onclick="R.pdfSetInheritSource('+o.idx+')">'+o.label+'</button>';
        });
        row1+='</div>';
      } else {
        // Many options — compact dropdown
        const cur = opts.find(o => o.idx === currentSrc) || opts[0];
        row1+='<div class="pdf-source-dropdown" id="pdfSourceDropdown">';
        row1+='<button class="pdf-source-opt selected pdf-source-trigger" onclick="R.togglePdfSourceMenu()">'+cur.label+' <span class="pdf-source-trigger-arrow">▾</span></button>';
        row1+='<div class="pdf-source-menu" id="pdfSourceMenu">';
        opts.forEach(o=>{
          const sel=o.idx===currentSrc?' selected':'';
          row1+='<button class="pdf-source-menu-item'+sel+'" onclick="R.pdfSetInheritSource('+o.idx+');R.togglePdfSourceMenu(false)">'+
                '<span class="pdf-source-menu-label">'+o.label+'</span>'+
                '<span class="pdf-source-menu-page">page '+o.page+'</span>'+
                '</button>';
        });
        row1+='</div></div>';
      }
    }
  }
  row1+='</div>';

  // ── Row 2: actions (pinned, never grows) ──────────────────────────
  let row2='<div class="pdf-actions-row">';
  if(!isMaster){
    row2+='<button class="pdf-action-btn" onclick="R.pdfSetMaster()">Set as master</button>';
    row2+='<button class="pdf-action-btn" onclick="R.pdfSetVariation()">'+(hasVar?'Update variation':'Save as variation')+'</button>';
  }
  if(!isMaster && hasVar){
    row2+='<button class="pdf-action-btn" onclick="R.pdfResetToMaster()">Reset to master</button>';
  }
  row2+='</div>';

  bar.innerHTML = row1 + (isMaster ? '' : row2);
}

// Toggle the source-selector dropdown menu (for the popover variant).
function togglePdfSourceMenu(force){
  const m = el('pdfSourceMenu');
  if(!m) return;
  const isOpen = m.classList.contains('open');
  const next = (force === false) ? false : (force === true ? true : !isOpen);
  m.classList.toggle('open', next);
  // Click-outside to close
  if(next && !window._pdfSourceMenuOutsideHandler){
    const handler = (ev) => {
      const dd = el('pdfSourceDropdown');
      if(!dd || dd.contains(ev.target)) return;
      togglePdfSourceMenu(false);
    };
    setTimeout(() => document.addEventListener('mousedown', handler, true), 0);
    window._pdfSourceMenuOutsideHandler = handler;
  } else if(!next && window._pdfSourceMenuOutsideHandler){
    document.removeEventListener('mousedown', window._pdfSourceMenuOutsideHandler, true);
    window._pdfSourceMenuOutsideHandler = null;
  }
}
R.togglePdfSourceMenu = togglePdfSourceMenu;

// Build the thumbnail strip UI and toggle visibility based on PDF state.
// Strip lives at the top of the right control column (.controls-panel) so
// it aligns with the panel widths and doesn't push the viewfinder around.
function renderPdfThumbStrip(){
  let strip=el('pdfThumbStrip');
  const thumbs=window._pdfThumbs;
  if(!strip){
    const host=document.querySelector('.controls-panel');
    if(!host)return;
    strip=document.createElement('div');
    strip.id='pdfThumbStrip';
    strip.className='pdf-thumb-strip';
    host.insertBefore(strip, host.firstChild);
  }
  if(!thumbs||!thumbs.length){
    strip.style.display='none';
    strip.innerHTML='';
    return;
  }
  strip.style.display='flex';
  const masterIdx=window._pdfMasterIdx||0;
  const vars=window._pdfPageVars||{};
  // Build a map: pageIdx → variation number (V1, V2, …) ordered by page index.
  // Master is excluded; only pages that have an explicit variation count.
  const varNums={};
  let n=0;
  for(let i=0;i<thumbs.length;i++){
    if(i!==masterIdx && vars[i]!==undefined){varNums[i]=++n;}
  }
  // Helper: label for any source page (master or variation)
  const sourceLabel=(srcIdx)=>{
    if(srcIdx===masterIdx) return 'M';
    return varNums[srcIdx] ? 'V'+varNums[srcIdx] : null;
  };
  strip.innerHTML=thumbs.map((c,i)=>{
    const dataUrl=c.toDataURL('image/jpeg',0.8);
    const active=i===window._pdfActiveIdx;
    const isMaster=i===masterIdx;
    const varN=varNums[i];
    let badge='';
    if(isMaster) badge='<span class="pdf-thumb-tag pdf-tag-master" title="Master">M</span>';
    else if(varN) badge='<span class="pdf-thumb-tag pdf-tag-var" title="Variation '+varN+'">V'+varN+'</span>';
    else {
      // Inheriting page — show which source it's following (M / V1 / V2…)
      // in a muted style so it's distinguishable from "owns this variation".
      const srcIdx=pdfInheritSource(i);
      const srcLbl=sourceLabel(srcIdx);
      if(srcLbl){
        const srcCls=srcIdx===masterIdx?'pdf-tag-from-master':'pdf-tag-from-var';
        badge='<span class="pdf-thumb-tag pdf-tag-from '+srcCls+'" title="Inherits from '+srcLbl+'">'+srcLbl+'</span>';
      }
    }
    return `<button class="pdf-thumb${active?' active':''}" data-page="${i}" onclick="R.setPdfPage(${i})" title="Page ${i+1}"><img src="${dataUrl}" alt="Page ${i+1}"><span class="pdf-thumb-num">${i+1}</span>${badge}</button>`;
  }).join('');
}

// Compute the variation label for a given page index (e.g. "V1", "V2"...) — null if none
function pdfVariationLabel(idx){
  if(!window._pdfPageVars||!window._pdfMeta) return null;
  if(idx===window._pdfMasterIdx) return null;
  if(window._pdfPageVars[idx]===undefined) return null;
  // Stable ID assigned at save time. Falls back to order-based numbering
  // for any variations that pre-dated the stable-ID system (e.g. saved
  // states loaded from before this change).
  const ids = window._pdfPageVarIds || {};
  if(ids[idx] != null) return 'V' + ids[idx];
  // Legacy fallback: walk pages and assign by order.
  let n=0;
  for(let i=0;i<window._pdfMeta.length;i++){
    if(i!==window._pdfMasterIdx && window._pdfPageVars[i]!==undefined){
      n++;
      if(i===idx) return 'V'+n;
    }
  }
  return null;
}

// Switch the active page — render at full resolution and upload to the GPU
async function setPdfPage(idx){
  if(!window._pdfDoc||!window._pdfMeta||!window._pdfMeta[idx])return;
  if(idx===window._pdfActiveIdx&&srcImg)return;
  // Persist any saved-page changes (master or existing variation) before switching
  pdfPersistCurrent();
  R.toast('Loading page '+(idx+1)+'…');
  try{
    const m=window._pdfMeta[idx];
    const targetW=Math.min(2400, m.nativeW*3);
    const canvas=await renderPdfPage(window._pdfDoc, idx+1, targetW);
    window._pdfActiveIdx=idx;
    // Apply this page's settings (its own variation, or master's if inheriting)
    pdfApplyForActive();
    srcImg=canvas;
    // Pick u_src based on whether PDF mode is on: inpainted (text removed)
    // when on, original otherwise. u_srcOrig always holds the original so
    // the text plate's single-ink path can read the actual glyph color.
    const inpainted=pdfPageInpainted(window._pdfDoc, idx+1, targetW) || canvas;
    const useSrc = (typeof pdfModeOn !== 'undefined' && pdfModeOn) ? inpainted : canvas;
    await uploadAsTexture(gl.TEXTURE0, window._srcTexA, useSrc);
    await uploadAsTexture(gl.TEXTURE3, window._srcTexB, useSrc);
    if(R.uploadOriginalSource) R.uploadOriginalSource(canvas);
    if(R.uploadTextMask) R.uploadTextMask(pdfPageMask(window._pdfDoc, idx+1, targetW));
    hasSrc=true;needsAspectUpdate=true;computeCrop();
    applyPdfPageAspect(); // resize viewport to new page's native aspect
    scheduleRender();
    const total=window._pdfMeta.length;
    $status.textContent=total>1?'◉ PDF '+(idx+1)+'/'+total:'◉ PDF';
    $res.textContent=canvas.width+'×'+canvas.height;
    renderPdfThumbStrip(); // refresh active highlight
    pdfRenderPageActions(); // refresh action buttons for new page
    // Brief pulse on the state pill so user can see what got applied
    const pill=document.querySelector('.pdf-page-state');
    if(pill){pill.classList.remove('pdf-state-pulse');void pill.offsetWidth;pill.classList.add('pdf-state-pulse');}
  }catch(err){
    console.error('PDF page render error:',err);
    R.toast('Page load failed');
  }
}

// Match the canvas viewport to the active PDF page's native aspect — so
// the user only sees printable area (no wasted white space around it).
// In PDF mode we lock the canvas HEIGHT (so the viewport is always the same
// size regardless of page orientation) and let WIDTH adjust to the page aspect.
function applyPdfPageAspect(){
  if(!window._pdfMeta||!window._pdfMeta[window._pdfActiveIdx]) return;
  const m=window._pdfMeta[window._pdfActiveIdx];
  if($gl){
    $gl.style.aspectRatio=m.nativeW+'/'+m.nativeH;
    // Lock canvas height to a fixed viewport-height so portrait pages don't
    // stretch the layout. Width auto-derives from aspect-ratio.
    $gl.style.height='65vh';
    $gl.style.width='auto';
    $gl.style.maxWidth='100%';
    $gl.style.maxHeight='';
  }
  needsAspectUpdate=true;
  if(typeof scheduleRender==='function') scheduleRender();
}
// Restore default canvas sizing (called when leaving PDF mode)
function clearPdfPageAspect(){
  if(!$gl) return;
  $gl.style.aspectRatio='';
  $gl.style.height='';
  $gl.style.width='';
  $gl.style.maxWidth='';
  $gl.style.maxHeight='';
}

// Toggle PDF-mode UI (grey out controls that don't make sense for static PDFs)
function applyPdfModeUI(on){
  // GIF export and camera don't make sense in PDF mode.
  // Aspect cycle is locked to FIT so each page renders at its native aspect.
  document.querySelectorAll('[onclick*="saveGif"],[onclick*="toggleCam"],[onclick*="cycleAspect"]').forEach(b=>{
    b.classList.toggle('pdf-disabled', on);
    if(on){b.setAttribute('data-pdf-disabled','1');}else{b.removeAttribute('data-pdf-disabled');}
  });
  // Toggle a body class so PDF-specific CSS rules can scope to it
  document.body.classList.toggle('pdf-mode', on);
  if(on){
    // Save user state so we can restore when leaving PDF mode
    if(window._aspectBeforePdf===undefined){window._aspectBeforePdf=cropAspect;}
    if(window._marginBeforePdf===undefined){window._marginBeforePdf=cached.margin;}
    if(window._fpsBeforePdf===undefined){window._fpsBeforePdf=risoFps;}
    // Force FIT aspect (no cropping per-page) and zero margin (no fake stencil white border)
    if(typeof R.setAspect==='function'){R.setAspect('fit');}
    else{cropAspect='fit';computeCrop();needsAspectUpdate=true;scheduleRender();}
    cached.margin=0;
    const mEl=el('margin'); if(mEl) mEl.value=0;
    const mVal=el('marginVal'); if(mVal) mVal.textContent='0';
    // PDFs are static — default FPS to 0 (no temporal grain animation)
    if(typeof R.setRisoFps==='function') R.setRisoFps(0);
    // Match canvas aspect to the active PDF page so it fills the viewport
    applyPdfPageAspect();
    markDirty&&markDirty();
  } else {
    if(window._aspectBeforePdf!==undefined){
      if(typeof R.setAspect==='function'){R.setAspect(window._aspectBeforePdf);}
      else{cropAspect=window._aspectBeforePdf;computeCrop();needsAspectUpdate=true;scheduleRender();}
      window._aspectBeforePdf=undefined;
    }
    if(window._marginBeforePdf!==undefined){
      cached.margin=window._marginBeforePdf;
      const mEl=el('margin'); if(mEl) mEl.value=window._marginBeforePdf;
      const mVal=el('marginVal'); if(mVal) mVal.textContent=String(window._marginBeforePdf);
      window._marginBeforePdf=undefined;
    }
    if(window._fpsBeforePdf!==undefined){
      if(typeof R.setRisoFps==='function') R.setRisoFps(window._fpsBeforePdf);
      window._fpsBeforePdf=undefined;
    }
    // Restore default canvas sizing (clears all PDF-mode inline overrides)
    clearPdfPageAspect();
    needsAspectUpdate=true;
    markDirty&&markDirty();
  }
}

// ─── Rotate the active source (image or PDF) by 90° clockwise ─────────
// For PDFs: re-rasterizes all pages with cumulative rotation; updates
//   thumbnails + native dimensions so aspect ratios stay correct.
// For images: rotates the source canvas in-place, re-uploads the texture.
// Camera/video rotation isn't implemented (less common workflow).
window._sourceRotation = 0; // 0/90/180/270 — current accumulated rotation
function rotateCanvas90(srcCanvas){
  const w=srcCanvas.width, h=srcCanvas.height;
  const c=document.createElement('canvas');
  c.width=h; c.height=w; // dimensions swap on 90° rotate
  const ctx=c.getContext('2d');
  ctx.translate(h, 0);
  ctx.rotate(Math.PI/2);
  ctx.drawImage(srcCanvas, 0, 0);
  return c;
}
async function rotateSource(){
  if(!hasSrc){R.toast('No source to rotate');return;}
  if(camOn){R.toast('Rotation not supported for camera');return;}
  if(videoOn && !window._pdfDoc){R.toast('Rotation not supported for video');return;}
  window._sourceRotation=(window._sourceRotation+90)%360;
  R.toast('Rotating '+window._sourceRotation+'°…');
  if(window._pdfDoc){
    // renderPdfPage now picks up window._sourceRotation automatically.
    // Clear cache so all pages re-rasterize with the new rotation.
    const total=window._pdfMeta.length;
    // Update native dims since rotation may have swapped W/H per page
    for(let i=0;i<total;i++){
      const page=await window._pdfDoc.getPage(i+1);
      const vp=page.getViewport({scale:1, rotation:window._sourceRotation});
      window._pdfMeta[i].nativeW=vp.width;
      window._pdfMeta[i].nativeH=vp.height;
    }
    // Re-render thumbnails (renderPdfPage uses the new rotation)
    pdfProgressShow('Rotating thumbnails…', 0, total);
    const newThumbs=[];
    for(let i=0;i<total;i++){
      newThumbs.push(await renderPdfPage(window._pdfDoc, i+1, 180));
      pdfProgressUpdate('Rotating '+(i+1)+'/'+total, i+1, total, 0);
    }
    window._pdfThumbs=newThumbs;
    pdfProgressHide();
    // Re-render active page at full res with new rotation
    const m=window._pdfMeta[window._pdfActiveIdx];
    const canvas=await renderPdfPage(window._pdfDoc, window._pdfActiveIdx+1, Math.min(2400, m.nativeW*3));
    srcImg=canvas;
    await uploadAsTexture(gl.TEXTURE0, window._srcTexA, canvas);
    await uploadAsTexture(gl.TEXTURE3, window._srcTexB, canvas);
    needsAspectUpdate=true; computeCrop();
    applyPdfPageAspect();
    renderPdfThumbStrip();
    scheduleRender();
    $res.textContent=canvas.width+'×'+canvas.height;
  } else if(srcImg){
    // Image / GIF / sample: rotate canvas in-place
    const rotated=rotateCanvas90(srcImg);
    srcImg=rotated;
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,window._srcTexA);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,rotated);
    gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,window._srcTexB);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,rotated);
    needsAspectUpdate=true; computeCrop(); scheduleRender();
    $res.textContent=rotated.width+'×'+rotated.height;
  }
}
// Render a PDF page WITH rotation applied (used by rotateSource)
async function rotatedPdfPage(pdfDoc, pageIdx, targetW){
  const page=await pdfDoc.getPage(pageIdx);
  const baseVp=page.getViewport({scale:1, rotation:window._sourceRotation});
  const scale=Math.max(0.1, targetW/baseVp.width);
  const vp=page.getViewport({scale, rotation:window._sourceRotation});
  const c=document.createElement('canvas');
  c.width=Math.round(vp.width); c.height=Math.round(vp.height);
  const ctx=c.getContext('2d');
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,c.width,c.height);
  await page.render({canvasContext:ctx, viewport:vp}).promise;
  return c;
}
// Reset rotation when loading a new source
function resetSourceRotation(){window._sourceRotation=0;}

// ─── Viewport zoom ────────────────────────────────────────────────────
// Ctrl/Cmd + wheel (or trackpad pinch) zooms into the canvas, centered on
// the cursor. The browser's default page zoom is suppressed within the
// viewfinder. Plain wheel scrolling still works for the rest of the page.
window._viewZoom = 1;
window._viewPan = {x: 0, y: 0};
function applyViewTransform(){
  if(!$gl) return;
  const z = window._viewZoom;
  const p = window._viewPan;
  $gl.style.transform = 'translate('+p.x.toFixed(1)+'px,'+p.y.toFixed(1)+'px) scale('+z.toFixed(3)+')';
  $gl.style.transformOrigin = '0 0';
}
function resetViewZoom(){
  window._viewZoom = 1;
  window._viewPan = {x: 0, y: 0};
  applyViewTransform();
}
// Clamp pan so the canvas keeps covering the visible viewfinder area
// (no exposed whitespace beyond the canvas edges) at the current zoom.
function clampViewPan(){
  if(!$gl) return;
  const vf = el('viewfinder');
  if(!vf) return;
  const z = window._viewZoom;
  if(z <= 1.001){window._viewPan = {x:0, y:0}; return;}
  const vfW = vf.clientWidth, vfH = vf.clientHeight;
  const cw = $gl.offsetWidth, ch = $gl.offsetHeight; // CSS layout size (pre-transform)
  // Canvas's natural top-left in viewfinder coords (centered by flex)
  const cssX = (vfW - cw) / 2;
  const cssY = (vfH - ch) / 2;
  // Visual extents of canvas at current zoom: cssX..cssX+cw*z (pre-pan)
  // Pan shifts everything. Keep canvas covering viewfinder:
  //   visual_left ≤ 0:  cssX + p.x ≤ 0  →  p.x ≤ -cssX
  //   visual_right ≥ vfW:  cssX + p.x + cw*z ≥ vfW  →  p.x ≥ vfW - cssX - cw*z
  const minPx = vfW - cssX - cw * z;
  const maxPx = -cssX;
  const minPy = vfH - cssY - ch * z;
  const maxPy = -cssY;
  window._viewPan.x = Math.max(minPx, Math.min(maxPx, window._viewPan.x));
  window._viewPan.y = Math.max(minPy, Math.min(maxPy, window._viewPan.y));
}
function initViewZoom(){
  const vf = el('viewfinder');
  if(!vf) return;
  vf.addEventListener('wheel', (e)=>{
    // Trackpad pinch + Ctrl/Cmd+wheel come with ctrlKey=true → ZOOM
    // Plain two-finger swipe (no ctrlKey) when zoomed in → PAN
    if(!(e.ctrlKey || e.metaKey)){
      // Pan only meaningful when zoomed in; otherwise let page scroll
      if(window._viewZoom <= 1.001) return;
      e.preventDefault();
      e.stopPropagation();
      // deltaX/deltaY direction matches "where the content moved": natural scroll
      // means swiping left should reveal content on the right, so pan should
      // shift in the OPPOSITE direction of the swipe.
      window._viewPan.x -= e.deltaX;
      window._viewPan.y -= e.deltaY;
      clampViewPan();
      applyViewTransform();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if(!$gl) return;
    const vfRect = vf.getBoundingClientRect();
    const cw = $gl.offsetWidth;
    const ch = $gl.offsetHeight;
    const cssX = (vf.clientWidth - cw) / 2;
    const cssY = (vf.clientHeight - ch) / 2;
    // Cursor in viewfinder-relative coords, then offset to be relative to
    // the canvas's natural top-left (so the zoom math anchors on the
    // canvas point under the cursor).
    const A = (e.clientX - vfRect.left) - cssX;
    const B = (e.clientY - vfRect.top)  - cssY;
    const oldZoom = window._viewZoom;
    // Slower, smoother zoom: ~5% per wheel notch, capped lower for pinch.
    const step = Math.min(0.08, Math.max(0.01, Math.abs(e.deltaY) / 500));
    const factor = e.deltaY < 0 ? (1 + step) : (1 - step);
    const newZoom = Math.max(1, Math.min(8, oldZoom * factor));
    if(Math.abs(newZoom - oldZoom) < 0.001) return;
    const ratio = newZoom / oldZoom;
    window._viewPan.x = A - (A - window._viewPan.x) * ratio;
    window._viewPan.y = B - (B - window._viewPan.y) * ratio;
    window._viewZoom = newZoom;
    if(newZoom <= 1.001){window._viewZoom = 1; window._viewPan = {x:0, y:0};}
    clampViewPan();
    applyViewTransform();
  }, {passive: false});
  // Double-click to reset
  vf.addEventListener('dblclick', (e)=>{
    if(window._viewZoom !== 1){e.preventDefault(); resetViewZoom(); R.toast('Zoom reset');}
  });
}

// --- Namespace exports ---
R.flattenAlpha = flattenAlpha;
R.pickFile = pickFile;
R.handleFile = handleFile;
R.initDragDrop = initDragDrop;
R.setPdfPage = setPdfPage;
R.renderPdfThumbStrip = renderPdfThumbStrip;
R.renderPdfPage = renderPdfPage;
R.pdfPageMask = pdfPageMask;
R.pdfPageInpainted = pdfPageInpainted;
R.rotateSource = rotateSource;
R.resetSourceRotation = resetSourceRotation;
R.initViewZoom = initViewZoom;
R.resetViewZoom = resetViewZoom;
R.pdfSetMaster = pdfSetMaster;
R.pdfSetVariation = pdfSetVariation;
R.pdfResetToMaster = pdfResetToMaster;
R.pdfApplyForActive = pdfApplyForActive;
R.pdfPersistCurrent = pdfPersistCurrent;
R.pdfSetInheritSource = pdfSetInheritSource;
R.stopVideo = stopVideo;
R.toggleCam = toggleCam;
R.startGifLoop = startGifLoop;
R.loadSampleImage = loadSampleImage;
R.showOnboarding = showOnboarding;
R.hideOnboarding = hideOnboarding;

})(window.R);
