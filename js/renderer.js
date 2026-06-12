// RENDERER module
(function(R) {
"use strict";

// ======================== WEBGL INIT ========================
// Context-loss listeners must be registered exactly once — the restored
// handler re-runs initGL, so registering inside initGL without a guard
// doubles the listeners on every restore (and each extra initGL run
// allocates a full duplicate texture set on the live context).
let _ctxLossHooked = false;
function initGL(){
  const c=el('gl');
  // Try WebGL2 first — enables AMT-GPU to share the context (Metaxas wavefront
  // FS gets ~100× speedup when not running on a second context due to Safari's
  // context-switch overhead). WebGL1 fallback preserved for old browsers.
  gl=c.getContext('webgl2',{preserveDrawingBuffer:true,antialias:false});
  const isWebGL2 = !!gl;
  // Persist for code outside initGL (e.g. AMT master textures use R8 single-
  // channel storage on WebGL2 — 4× less memory/upload than RGBA — and fall
  // back to RGBA on WebGL1).
  window._isWebGL2 = isWebGL2;
  if(!gl){
    gl=c.getContext('webgl',{preserveDrawingBuffer:true,antialias:false});
  }
  if(!gl){R.toast('WebGL not supported — cannot render');return;}
  // Spin up the RISO FS Web Worker — runs off main thread so animations
  // (drum noise, video frames, paper drift) keep playing during prepass.
  try { _initAmtWorker(); } catch(e){}

  // Handle WebGL context loss/restore (registered once — see _ctxLossHooked)
  if(!_ctxLossHooked){
    _ctxLossHooked = true;
    c.addEventListener('webglcontextlost',e=>{e.preventDefault();_rafId=0;R.toast('GPU context lost — will recover');});
    c.addEventListener('webglcontextrestored',()=>{R.toast('GPU restored');initGL();scheduleRender();});
  }

  function mkShader(type,src){
    const s=gl.createShader(type);
    gl.shaderSource(s,src);gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){
      console.error('Shader compile error:',gl.getShaderInfoLog(s));
      R.toast('Shader compile error — see console');
      return null;
    }
    return s;
  }
  const vs=mkShader(gl.VERTEX_SHADER,el('vs').textContent);
  const fs=mkShader(gl.FRAGMENT_SHADER,el('fs').textContent);
  if(!vs||!fs)return; // abort if shaders failed
  prog=gl.createProgram();
  gl.attachShader(prog,vs);gl.attachShader(prog,fs);gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog,gl.LINK_STATUS)){
    console.error('Program link error:',gl.getProgramInfoLog(prog));
    R.toast('Shader link error — see console');
    return;
  }
  gl.useProgram(prog);

  // Quad
  const buf=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const ap=gl.getAttribLocation(prog,'a_pos');
  gl.enableVertexAttribArray(ap);
  gl.vertexAttribPointer(ap,2,gl.FLOAT,false,0,0);

  // Cache uniform locations
  ['u_src','u_noise','u_res','u_time','u_frameSeed','u_layers',
   'u_ink0','u_ink1','u_ink2','u_ink3',
   'u_off0','u_off1','u_off2','u_off3',
   'u_angle0','u_angle1','u_angle2','u_angle3','u_screenCell',
   'u_chan0','u_chan1','u_chan2','u_chan3',
   'u_stampSeed','u_asciiTonePass','u_aMin','u_aDims','u_aPitch','u_edgeSoft','u_mtxTexel','u_grainSize','u_dotGain','u_dens0','u_dens1','u_dens2','u_dens3','u_inkNoise','u_static','u_resScale','u_bright','u_contrast','u_sat','u_shadows','u_highlights','u_postExposure','u_postContrast','u_postSat','u_mode','u_lineShape','u_lineAmount','u_lineWeight','u_lineRoughness','u_lineCenter0','u_lineCenter1','u_lineCenter2','u_lineCenter3','u_lineEdgeThickness','u_lineCount','u_sepMode','u_sepType','u_colorQuant','u_useLabResidual','u_useCalChord','u_warmCool','u_stampShape','u_screenType','u_ditherScale','u_simNoise',
   'u_paperColor','u_paperTex','u_paperScan','u_usePaperScan','u_paperShift','u_paperPbrShift','u_paperPbrMul','u_crop','u_paper',
   'u_paperPBR','u_usePaperPBR',
   'u_lutA0','u_lutA1','u_lutA2','u_lutA3',
   'u_lutB0','u_lutB1','u_lutB2','u_lutB3',
   'u_lutC0','u_lutC1','u_lutC2','u_lutC3',
   'u_lutD0','u_lutD1','u_lutD2','u_lutD3',
   'u_grainMul0','u_grainMul1','u_grainMul2','u_grainMul3',
   'u_inkGamma0','u_inkGamma1','u_inkGamma2','u_inkGamma3',
   'u_hasCal0','u_hasCal1','u_hasCal2','u_hasCal3',
   'u_opaque0','u_opaque1','u_opaque2','u_opaque3',
   'u_transparent0','u_transparent1','u_transparent2','u_transparent3',
   'u_knockout0','u_knockout1','u_knockout2','u_knockout3',
   'u_prevSrc',
   'u_showCropMarks','u_printArea','u_ghosting','u_bleed',
   'u_skew0','u_skew1','u_skew2','u_skew3',
   'u_ucrStr','u_cmykBal','u_tac',
   'u_inkOpacity','u_layerDeplete','u_pressVar','u_densFlicker',
   'u_tonalGamma','u_dotMin','u_opacityCap',
   'u_toneCurve','u_useToneCurve','u_textMask','u_textLayerIdx','u_srcOrig','u_textKnockout','u_trappingPx',
   'u_dbgP100','u_dbgLutDirect','u_dbgNoDotMin','u_dbgNoOpaque','u_dbgShowCov','u_dbgFixedCov','u_dbgBinaryGrain','u_dbgFMDots','u_dbgLinearize','u_dbgYNArea','u_dbgNeutralBypass','u_dbgTrcSCurve','u_ditherMode',
   'u_driverLUT','u_useDriverLUT',
   'u_ht5Matrix',
   'u_amtMaster0','u_amtMaster1','u_amtMaster2','u_amtMaster3','u_useAmt','u_liveSource',
   'u_amtTexel','u_amtSuperSample','u_amtInkSpread',
   'u_bnVC','u_risoGamma','u_risoGrainScale','u_risoDebugBaseline',
   // T3-F: pre-baked per-ink coverage→color LUT texture
   'u_calLutTex','u_useCalLutTex'
  ].forEach(n=>{locs[n]=gl.getUniformLocation(prog,n);});

  // Blue noise texture (tex unit 1)
  const nTex=gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,nTex);
  const nd=genBlueNoise(256);
  const rgba=new Uint8Array(256*256*4);
  for(let i=0;i<256*256;i++){rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=nd[i];rgba[i*4+3]=255;}
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,256,0,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.uniform1i(locs.u_noise,1);

  // Paper scan texture (tex unit 2)
  const pTex=gl.createTexture();
  gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,pTex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([128,128,128,255]));
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.uniform1i(locs.u_paperScan,2);
  gl.uniform1f(locs.u_usePaperScan,0.0);

  // Tone curve LUT texture (tex unit 4) — 256×1 identity
  var tcTex=gl.createTexture();
  gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,tcTex);
  var tcId=new Uint8Array(256*4);
  for(var ti=0;ti<256;ti++){tcId[ti*4]=ti;tcId[ti*4+1]=ti;tcId[ti*4+2]=ti;tcId[ti*4+3]=255;}
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,1,0,gl.RGBA,gl.UNSIGNED_BYTE,tcId);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.uniform1i(locs.u_toneCurve,4);
  gl.uniform1f(locs.u_useToneCurve,0.0);
  window._toneCurveTex=tcTex;

  // Driver LUT texture (tex unit 5) — 256×1 identity, holds RISO MZ9 transfer curves
  var dlTex=gl.createTexture();
  gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,dlTex);
  var dlId=new Uint8Array(256*4);
  for(var di=0;di<256;di++){dlId[di*4]=di;dlId[di*4+1]=di;dlId[di*4+2]=di;dlId[di*4+3]=255;}
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,1,0,gl.RGBA,gl.UNSIGNED_BYTE,dlId);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.uniform1i(locs.u_driverLUT,5);
  gl.uniform1f(locs.u_useDriverLUT,0.0);
  window._driverLUTTex=dlTex;

  // Text mask texture (tex unit 6) — 1×1 black default. Replaced with a
  // per-PDF-page mask canvas when a PDF is loaded and PDF mode is active,
  // so the shader can route text pixels to a single plate (avoids
  // misregistration smear on vector text).
  var tmTex=gl.createTexture();
  gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,tmTex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  if(locs.u_textMask) gl.uniform1i(locs.u_textMask,6);
  window._textMaskTex=tmTex;

  // Original source texture (tex unit 7) — preserves the un-inpainted PDF
  // raster so the text plate's single-ink NNLS can use the actual glyph
  // color. Non-text plates use u_src (which is inpainted to remove text)
  // so they render the bg behind glyphs cleanly. Defaults to a 1×1 white
  // texture; uploaded with the PDF page raster when a PDF is loaded.
  var soTex=gl.createTexture();
  gl.activeTexture(gl.TEXTURE7);gl.bindTexture(gl.TEXTURE_2D,soTex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  if(locs.u_srcOrig) gl.uniform1i(locs.u_srcOrig,7);
  window._srcOrigTex=soTex;

  // RISO Grain Touch threshold matrix (tex unit 8) — literal bytes from
  // /Library/Printers/RISO/Halftones/04A/ht5_3x3_6x6_04A.hft.
  // 8×8 byte matrix, NEAREST + REPEAT so it tiles cleanly across the canvas.
  // Used by risoMatrixDither() in shader when u_ditherMode === 7.
  var ht5Tex=gl.createTexture();
  gl.activeTexture(gl.TEXTURE8);gl.bindTexture(gl.TEXTURE_2D,ht5Tex);
  var ht5Bytes=new Uint8Array([
    101, 109, 117, 125, 188, 192, 200, 208,
     93,   5,  29,  37, 176, 248, 252, 216,
     85,  21,  13,  45, 168, 240, 232, 224,
     77,  69,  61,  53, 160, 152, 144, 136,
    132, 140, 148, 156, 105, 113, 121, 128,
    220, 252, 228, 164,  97,   9,  33,  41,
    212, 244, 236, 172,  89,  25,  17,  49,
    204, 196, 188, 180,  81,  73,  65,  57
  ]);
  // Expand to RGBA for maximum WebGL compatibility (LUMINANCE works but
  // is sometimes flaky on older drivers). Threshold byte goes in .r.
  var ht5RGBA=new Uint8Array(64*4);
  for(var hi=0;hi<64;hi++){ ht5RGBA[hi*4]=ht5Bytes[hi]; ht5RGBA[hi*4+3]=255; }
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,8,8,0,gl.RGBA,gl.UNSIGNED_BYTE,ht5RGBA);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  if(locs.u_ht5Matrix) gl.uniform1i(locs.u_ht5Matrix,8);
  window._ht5MatrixTex=ht5Tex;

  // ── RISO clustered-dot AM screen matrices (ht1_6x6 family, driver-exact) ──
  // SCREEN mode (when u_screenType=1) thresholds coverage against one of
  // these. Reuses texture unit 8 — the Grain-Touch ht5 matrix there is only
  // sampled in GRAIN/ditherMode-7, never SCREEN, so they share the slot
  // (bound per-mode). Threshold arrays upload as EXACT bytes at native dims
  // with NEAREST — resampling a threshold matrix blurs its cliffs and bends
  // the tone CDF (the old 20×20→64×64 LINEAR build did both). NPOT is fine:
  // the shader tiles via fract(), so the wrap mode never engages.
  // Every ht1_6x6 tile holds 2 dots in a 45° rosette (period = dotPitch·√2),
  // so the shader's tile = cellPx·√2 invariant holds for all three sizes and
  // one matrix texel maps to one 600 dpi device dot at print scale.
  function _buildThresholdTex(w, h, bytes){
    var rgba = new Uint8Array(w*h*4);
    for(var ti=0; ti<w*h; ti++){ rgba[ti*4]=bytes[ti]; rgba[ti*4+3]=255; }
    var t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    return t;
  }
  // The driver dump stores Screen-covered matrices at 43/71/106 lpi — the
  // matrix engine picks the nearest stored matrix + measured tone curve. The dot
  // PITCH is NOT snapped — it follows the LPI control freely, like the real
  // driver's arbitrary-frequency synthesis. Shared with save.js via window.
  window._snapScreenLpi = function(lpi){ return lpi < 57 ? 43 : (lpi < 88.5 ? 71 : 106); };
  var AM_W=20, AM_H=20;
  var AM_DATA=[254,250,243,227,208,96,60,35,15,4,2,6,16,36,62,97,210,229,244,252,152,248,238,222,203,110,69,44,23,11,7,12,25,45,71,111,205,224,239,155,154,159,233,215,192,120,85,54,31,26,17,27,32,55,86,121,193,216,164,157,156,163,169,198,184,135,99,77,57,46,37,48,58,78,100,136,185,173,168,161,160,166,171,175,179,145,128,101,87,72,63,73,88,102,128,146,177,174,170,165,90,106,116,131,141,151,147,137,123,113,104,114,124,138,149,150,140,129,115,105,59,65,81,92,127,143,180,187,194,206,211,207,196,188,178,142,125,91,79,64,34,40,50,76,95,133,183,199,217,225,230,226,219,197,182,132,93,74,49,39,13,20,30,53,83,119,191,213,234,240,245,241,231,212,189,118,82,51,29,18,3,9,22,43,68,109,202,221,236,249,253,247,235,220,201,107,67,41,21,8,2,6,16,36,62,97,210,229,244,252,254,250,243,227,208,96,60,35,15,4,7,12,25,45,71,111,205,224,239,155,152,248,238,222,203,110,69,44,23,11,17,27,32,55,86,121,193,216,164,157,154,159,233,215,192,120,85,54,31,26,37,48,58,78,100,136,185,173,168,161,156,163,169,198,184,135,99,77,57,46,63,73,88,102,128,146,177,174,170,165,160,166,171,175,179,145,128,101,87,72,104,114,124,138,149,150,140,129,115,105,90,106,116,131,141,151,147,137,123,113,211,207,196,188,178,142,125,91,79,64,59,65,81,92,127,143,180,187,194,206,230,226,219,197,182,132,93,74,49,39,34,40,50,76,95,133,183,199,217,225,245,241,231,212,189,118,82,51,29,18,13,20,30,53,83,119,191,213,234,240,253,247,235,220,201,107,67,41,21,8,3,9,22,43,68,109,202,221,236,249];
  // P3 — measured TRC baked INTO the thresholds. Comparing v >= D⁻¹(T) is
  // exactly equivalent to comparing D(v) >= T, so transforming the threshold
  // bytes once at build time applies the physical print response (dot loss /
  // gain measured from 600dpi scans, riso_trc.json) with ZERO per-fragment
  // cost and no extra sampler. Stored 16-bit (hi in .r, lo in .g) so the
  // remap never collapses the matrix's tone levels.
  function _bakeTrcThresholds(bytes, lut){
    var out = new Float32Array(bytes.length);
    for(var i = 0; i < bytes.length; i++){
      var t = bytes[i] / 255;
      var lo = 0, hi = 255;                     // invert monotone D by bisection
      while(hi - lo > 1){ var mid = (lo + hi) >> 1; if(lut[mid] < t) lo = mid; else hi = mid; }
      var d0 = lut[lo], d1 = lut[hi];
      var v = (lo + (d1 > d0 ? (t - d0) / (d1 - d0) : 0)) / 255;
      out[i] = Math.min(1, Math.max(0, v)) * 255;
    }
    return out;
  }
  function _buildThresholdTex16(w, h, vals){    // vals: float 0..255 → hi/lo in r/g
    var rgba = new Uint8Array(w*h*4);
    for(var ti = 0; ti < w*h; ti++){
      var hi = Math.floor(vals[ti]);
      rgba[ti*4] = hi;
      rgba[ti*4+1] = Math.round((vals[ti] - hi) * 255);
      rgba[ti*4+3] = 255;
    }
    var t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    return t;
  }
  // Bootstrap: AM_DATA above is byte-identical to riso_halftones.json's
  // ht1_6x6_43_45 entry 0 (verified), so the 43-lpi screen works even
  // before/without the fetches below. Entries carry dims for u_mtxTexel
  // (half-texel phase shift → dots land at cell centers for cellTone).
  window._screenMatrixTexs = { 43: { tex: _buildThresholdTex(AM_W, AM_H, AM_DATA), cal: null, w: AM_W, h: AM_H, bytes: AM_DATA } };
  window._amScreenTex = window._screenMatrixTexs[43].tex; // fallback ref (save.js)
  // P6 DEFAULT FLIP: circles render through the RISO matrix engine (real
  // driver thresholds + measured TRC) by default. R.setScreenType(0) =
  // "Classic dots" (the procedural engine, full 10-120 LPI range).
  if(window._screenType === undefined) window._screenType = 1;
  gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, ht5Tex); // restore default
  // 71 lpi (12×12, 72 levels) and 106 lpi (8×8, 32 levels) come from the
  // driver dump; riso_trc.json carries the measured tone-response curves
  // (lut43 = direct Screen-40 measurement; lut71 interpolated; lut106
  // extrapolated — see its meta). Until the fetch lands, presets fall back
  // to the raw 43-lpi matrix at the correct pitch.
  Promise.all([
    fetch('riso_halftones.json').then(function(r){ return r.json(); }),
    fetch('riso_trc.json?v=2').then(function(r){ return r.json(); }).catch(function(){ return null; }),
  ]).then(function(res){
    var j = res[0], trc = res[1];
    [[71,'ht1_6x6_71_45'],[106,'ht1_6x6_106_45']].forEach(function(p){
      var e = j[p[1]] && j[p[1]].entries && j[p[1]].entries[0];
      if(e && e.data && e.data.length === e.w*e.h){
        window._screenMatrixTexs[p[0]] = { tex: _buildThresholdTex(e.w, e.h, e.data), cal: null, w: e.w, h: e.h, bytes: e.data };
      }
    });
    if(trc){
      [[43,'lut43'],[71,'lut71'],[106,'lut106']].forEach(function(p){
        var m = window._screenMatrixTexs[p[0]], lut = trc[p[1]];
        if(m && lut && lut.length === 256){
          m.cal = _buildThresholdTex16(m.w, m.h, _bakeTrcThresholds(m.bytes, lut));
        }
      });
    } else {
      console.warn('[screenMatrix] riso_trc.json unavailable — matrix engine runs uncalibrated (geometry-linear) tone');
    }
    gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, window._ht5MatrixTex);
    gl.activeTexture(gl.TEXTURE0);
    if(window.R && window.R.markDirty) window.R.markDirty();
  }).catch(function(e){
    console.warn('[screenMatrix] riso_halftones.json unavailable — all LPI presets use the 43-lpi matrix', e);
  });

  // AMT master textures — one per ink channel (tex units 9, 10, 11, 12).
  // Each holds the 1-bit RISO Grain Touch master for ONE ink, halftoned
  // independently by riso-amt.js from that channel's per-pixel coverage.
  // Result: different ink layers can deposit at different positions
  // (matching real driver), instead of all sharing the same pattern.
  // (A) AMT masters are grayscale (the shader reads only .r). On WebGL2 store
  // them as single-channel R8 — 4× less GPU memory and 4× less upload bandwidth
  // than RGBA, with bit-identical output. At 600 dpi / 4-color this drops the
  // master working set from ~886 MB → ~222 MB, which stops the GPU-memory
  // thrashing that caused multi-second upload variance. WebGL1 falls back to
  // RGBA. _amtMasterFmt is read by the prepass upload to match this allocation.
  window._amtMasterFmt = window._isWebGL2
    ? { internal: gl.R8, format: gl.RED, channels: 1 }
    : { internal: gl.RGBA, format: gl.RGBA, channels: 4 };
  var _mf = window._amtMasterFmt;
  window._amtMasterTex = [];
  for(var __ci = 0; __ci < 4; __ci++){
    var __tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE9 + __ci);
    gl.bindTexture(gl.TEXTURE_2D, __tex);
    var __seed = (_mf.channels === 1) ? new Uint8Array([0]) : new Uint8Array([0,0,0,255]);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); // R8 rows aren't 4-byte aligned
    gl.texImage2D(gl.TEXTURE_2D, 0, _mf.internal, 1, 1, 0, _mf.format, gl.UNSIGNED_BYTE, __seed);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // NEAREST filtering — the FS output IS the dot pattern. Linear bilinear
    // interpolation destroys binary FS character (every dot edge becomes a
    // gray ramp → output looks like noise instead of FS). The intentional ink
    // spread / soft dot edge is applied in the shader's stochastic supersample
    // loop (see u_amtInkSpread), which averages neighbouring binary cells —
    // so the master itself stays an exact pixel-by-pixel binary plane.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    var locName = 'u_amtMaster' + __ci;
    if(locs[locName]) gl.uniform1i(locs[locName], 9 + __ci);
    window._amtMasterTex.push(__tex);
  }
  if(locs.u_useAmt) gl.uniform1f(locs.u_useAmt, 0.0);
  // RISO mode supersampling defaults — refresh on every prepass with the
  // actual master resolution. u_amtSuperSample 1.5 = 4 samples within ±1.5
  // master texels → averages the dot-stochastic noise into a smooth halftone.
  if(locs.u_amtTexel) gl.uniform2f(locs.u_amtTexel, 1/1241, 1/931);  // placeholder
  if(locs.u_amtSuperSample) gl.uniform1f(locs.u_amtSuperSample, 1.5);
  // (D) GPU ink-spread radius in master texels. 0 = no spread (CPU blur path).
  // Set per-prepass from the ink-spread slider; default seeded here.
  if(locs.u_amtInkSpread) gl.uniform1f(locs.u_amtInkSpread, 0.5);

  // V&C blue-noise threshold mask (tex unit 13) — used by GPU Grain Touch path.
  // Replaces the JS-side per-frame AMT pre-pass with a single-sample threshold
  // in the shader. Generated once at startup (~25ms for 64×64).
  var bnVCTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE13); gl.bindTexture(gl.TEXTURE_2D, bnVCTex);
  // 128 chosen over 64 to halve per-row variance — at 64 some rows had ~15% bias
  // (e.g. row 61 avg=147, row 62 avg=107 of 256), producing a visible 4-canvas-px
  // horizontal band wherever the biased mask rows landed.
  var BN_SIZE = 128;
  var bnVCBytes = genVoidClusterMask(BN_SIZE);
  var bnVCRGBA = new Uint8Array(BN_SIZE*BN_SIZE*4);
  for(var bi = 0; bi < BN_SIZE*BN_SIZE; bi++){
    bnVCRGBA[bi*4] = bnVCBytes[bi];
    bnVCRGBA[bi*4+1] = bnVCBytes[bi];
    bnVCRGBA[bi*4+2] = bnVCBytes[bi];
    bnVCRGBA[bi*4+3] = 255;
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, BN_SIZE, BN_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, bnVCRGBA);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  // NEAREST — true V&C threshold is a per-cell discrete value, not interpolated.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  if(locs.u_bnVC) gl.uniform1i(locs.u_bnVC, 13);
  window._bnVCTex = bnVCTex;
  if(locs.u_risoGamma) gl.uniform1f(locs.u_risoGamma, 1.5);
  // Default = 0.25: each dot covers ~4 canvas pixels, giving the visible
  // stochastic grain character of real RISO Grain Touch at typical viewport
  // zoom. 1.0 = native (1 dot/canvas-px, aliases away on screen);
  // < 0.2 = chunky / loupe view. Tunable via R.setRisoGrain({grainScale: ...}).
  if(locs.u_risoGrainScale) gl.uniform1f(locs.u_risoGrainScale, 0.25);
  // ── T3-F: pre-baked per-ink coverage→color LUT (texture unit 14) ──
  // 4 rows × 256 cols, RGBA8. Worker bakes the Fritsch-Carlson Hermite
  // once on palette change; per-pixel shader does a single texture2D()
  // instead of ~50 instructions × 8-12 invocations. Default ON.
  var calLutTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE14); gl.bindTexture(gl.TEXTURE_2D, calLutTex);
  // Seed with white so any sampling before the worker fires returns paper.
  var initLut = new Uint8Array(4 * 256 * 4);
  for (var ci = 0; ci < 4 * 256; ci++) {
    initLut[ci*4]=232; initLut[ci*4+1]=232; initLut[ci*4+2]=232; initLut[ci*4+3]=255;
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, initLut);
  // LINEAR filtering interpolates between adjacent coverage samples —
  // visually identical to Hermite eval at 256-sample density.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (locs.u_calLutTex) gl.uniform1i(locs.u_calLutTex, 14);
  if (locs.u_useCalLutTex) gl.uniform1f(locs.u_useCalLutTex, (window._useCalLutTex ?? true) ? 1.0 : 0.0);
  window._calLutTex = calLutTex;
  window._calLutLastKey = '';
  try { _initCalLutWorker(); } catch(e) { console.warn('calLut worker init failed', e); }

  // ── PBR paper substrate (ambientCG Paper002, CC0) — texture unit 15 ──
  // One tiling RGBA texture: R=height, G=normal.X, B=normal.Y. Sampled by the
  // shader's applyPaperPBR() to give the sheet real tooth + raking-light sheen
  // in every mode (incl. RISO) and in exports. Seeded 1×1 neutral until the
  // PNG loads. REPEAT wrap (it tiles); LINEAR (smooth fiber).
  var paperPbrTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_2D, paperPbrTex);
  // neutral seed: height=0.14 (map mean → no tone shift), normal flat (0.5,0.5)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([36,128,128,255]));
  // CLAMP (not REPEAT): the 2K sheet is mapped ONCE across the canvas (cover-fit
  // in applyPaperPBR), so it must not tile — and CLAMP+LINEAR with no mipmap is
  // NPOT-safe (1588×2048) on both WebGL1 and WebGL2.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (locs.u_paperPBR) gl.uniform1i(locs.u_paperPBR, 15);
  if (locs.u_usePaperPBR) gl.uniform1f(locs.u_usePaperPBR, (window._usePaperPBR ?? true) ? 1.0 : 0.0);
  window._paperPbrTex = paperPbrTex;
  // Load the packed texture asynchronously; enable once ready.
  (function(){
    var img = new Image();
    img.onload = function(){
      gl.activeTexture(gl.TEXTURE15);
      gl.bindTexture(gl.TEXTURE_2D, window._paperPbrTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      // NPOT 1588×2048 → no mipmap; keep LINEAR (set above). The sheet maps ~1:1
      // to the canvas so minification is mild and shimmer is negligible.
      gl.activeTexture(gl.TEXTURE0);
      window._paperPbrReady = true;
      try { markDirty(); } catch(e){}
    };
    img.onerror = function(){ console.warn('[paper] PBR texture failed to load'); };
    img.src = 'textures/paper002_pbr_2k.png?v=1';
  })();

  // CRITICAL: reset activeTexture to a safe unit so subsequent makeSrcTex()
  // calls (which bind without setting active) don't inherit unit 13 and
  // overwrite our V&C mask with the source texture — that produced the
  // literal "smaller copy of the image" artifact for ages.
  gl.activeTexture(gl.TEXTURE0);

  // Load default paper texture
  loadPaperTexture('procedural');

  // Double-buffered source textures: A = current frame (unit 0), B = previous frame (unit 3)
  // Swapped each video/camera frame for inter-frame ghosting
  function makeSrcTex(){
    const t=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([200,190,180,255]));
    return t;
  }
  window._srcTexA=makeSrcTex(); // current frame
  window._srcTexB=makeSrcTex(); // previous frame
  window._srcFlip=false;
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,window._srcTexA);
  gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,window._srcTexB);
  gl.uniform1i(locs.u_src,0);
  gl.uniform1i(locs.u_prevSrc,3);
}

function genBlueNoise(sz){
  // R2 quasi-random sequence with strong scrambling to prevent visible tiling
  const d=new Uint8Array(sz*sz);
  const g=1.32471795724; // plastic constant
  const a1=1/g, a2=1/(g*g);
  for(let y=0;y<sz;y++){
    for(let x=0;x<sz;x++){
      const i=y*sz+x;
      // R2 base
      const r2 = (0.5 + a1*x + a2*y) % 1;
      // Strong integer hash scramble
      let h = (x*374761393 + y*668265263) ^ (x*1274126177);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h = Math.imul(h ^ (h >>> 16), 2654435769);
      const hf = ((h >>> 0) & 0xFFFF) / 65536; // to [0,1)
      // Heavy hash blend to break R2 structure
      d[i]=Math.floor(((r2*0.45 + hf*0.55)%1)*255);
    }
  }
  return d;
}

// Separable gaussian blur on a Uint8 single-channel plane.
// Used as the "ink spread" pre-blur for the RISO-mode halftone master:
// each 1-bit dot becomes a soft round ink-spot instead of a hard square pixel.
// σ in master pixels — typical values 0.3 (crisp halo) to 0.8 (fat round dot).
function gaussianBlurPlane(src, W, H, sigma){
  if(sigma <= 0.01) return src;
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const klen = radius * 2 + 1;
  const k = new Float32Array(klen);
  let ksum = 0;
  const s2 = 2 * sigma * sigma;
  for(let i = -radius; i <= radius; i++){
    const v = Math.exp(-(i*i) / s2);
    k[i + radius] = v;
    ksum += v;
  }
  for(let i = 0; i < klen; i++) k[i] /= ksum;
  const tmp = new Float32Array(W * H);
  const out = new Uint8Array(W * H);
  // Horizontal pass: src → tmp
  for(let y = 0; y < H; y++){
    const row = y * W;
    for(let x = 0; x < W; x++){
      let s = 0;
      for(let i = -radius; i <= radius; i++){
        let xx = x + i;
        if(xx < 0) xx = 0; else if(xx >= W) xx = W - 1;
        s += src[row + xx] * k[i + radius];
      }
      tmp[row + x] = s;
    }
  }
  // Vertical pass: tmp → out
  for(let y = 0; y < H; y++){
    for(let x = 0; x < W; x++){
      let s = 0;
      for(let i = -radius; i <= radius; i++){
        let yy = y + i;
        if(yy < 0) yy = 0; else if(yy >= H) yy = H - 1;
        s += tmp[yy * W + x] * k[i + radius];
      }
      let v = s | 0; if(v < 0) v = 0; else if(v > 255) v = 255;
      out[y * W + x] = v;
    }
  }
  return out;
}

// True Void-and-Cluster blue-noise mask (Ulichney 1993). Used as the
// per-pixel threshold for the GPU Grain Touch halftone. Output is a
// size×size Uint8Array of threshold bytes (0..255). Cost: ~25ms for 64×64.
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
  // Phase 1: random initial pattern stabilized via swaps
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
  // Phase 2: rank
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
  // Convert rank to threshold byte
  const out = new Uint8Array(N);
  for(let i = 0; i < N; i++) out[i] = Math.min(255, Math.floor((rank[i] / N) * 256));
  return out;
}


// ======================== SHARED UNIFORM SETUP ========================
// ── ASCII-map stamp: glyph atlas builder ──────────────────────────────────
// 8 columns (random alternatives) × 16 rows (density levels), 64px cells.
// Row 0 = blank paper, rows 1-7 = positive glyphs (light→dark), rows 8-14 =
// INVERSE VIDEO (solid cell with the glyph knocked out — letters alone only
// reach ~40% ink, inversion covers 60-100%), row 15 = solid. The shader picks
// the row from cell coverage (tone-correct) and the column from a per-cell
// hash (random letters). Candidates: Latin + digits + symbols + Georgian
// Mkhedruli; glyphs that render as the font's .notdef tofu box are detected
// by pixel signature (vs U+0378, an unassigned codepoint) and dropped, so a
// platform without Georgian fonts silently falls back to the rest.
function _buildGlyphAtlas(){
  const COLS = 16, ROWS = 16, CELL = 64; // 16 random alternatives per density level
  // Custom uploaded font (FontFace API) leads the stack; system fonts fall
  // back PER GLYPH, so a font missing half the charset still renders fully.
  const fam = window._asciiFontFamily ? '"' + window._asciiFontFamily + '", ' : '';
  const FONT = 'bold ' + Math.round(CELL * 0.72) + 'px ' + fam + '"Helvetica Neue", Arial, sans-serif';
  // Measure each candidate's ink coverage on a scratch cell.
  const m = document.createElement('canvas'); m.width = m.height = CELL;
  const mc = m.getContext('2d', { willReadFrequently: true });
  function drawGlyph(ctx, ch, x, y){
    ctx.font = FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ch, x + CELL / 2, y + CELL / 2 + CELL * 0.04);
  }
  function sig(ch){
    mc.clearRect(0, 0, CELL, CELL); mc.fillStyle = '#fff'; drawGlyph(mc, ch, 0, 0);
    const d = mc.getImageData(0, 0, CELL, CELL).data;
    let cov = 0, h = 0;
    for (let i = 3; i < d.length; i += 4){ cov += d[i]; h = (h * 31 + d[i]) | 0; }
    return { cov: cov / (255 * CELL * CELL), h: h };
  }
  // Charset modes (settings chip / R.cycleAsciiCharset):
  //   0 = Latin, 1 = Georgian Mkhedruli only, 2 = mixed.
  // (window._asciiGeorgian kept as the legacy console toggle → mixed.)
  const charsetMode = (window._asciiCharset !== undefined) ? window._asciiCharset : (window._asciiGeorgian ? 2 : 0);
  const geoChars = 'აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ';
  const latChars = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefghkmnopqrstuvwxyz0123456789';
  const latin = charsetMode === 1 ? '' : latChars;
  const georgian = charsetMode >= 1 ? geoChars : '';
  const syms = '.,:;-~^"*+=!?/()%#&@$';
  const tofu = sig('͸'); // unassigned codepoint → .notdef box signature
  const glyphs = [];
  for (const ch of (syms + latin + georgian)){
    const g = sig(ch);
    if (g.cov > 0.004 && !(g.h === tofu.h && Math.abs(g.cov - tofu.cov) < 1e-4)) glyphs.push({ ch: ch, cov: g.cov });
  }
  glyphs.sort((a, b) => a.cov - b.cov);
  // Pick COLS glyphs whose coverage is nearest a target (with variety).
  function pick(target){
    // Random draw from the candidates nearest the target coverage — wider
    // window + true shuffle gives far more letter variety per level than
    // deterministic stepping did (M/W/N/O dominated).
    const ranked = glyphs.slice().sort((a, b) => Math.abs(a.cov - target) - Math.abs(b.cov - target)).slice(0, COLS + 12);
    for (let i = ranked.length - 1; i > 0; i--){ const j = (Math.random() * (i + 1)) | 0; const t = ranked[i]; ranked[i] = ranked[j]; ranked[j] = t; }
    const out = [];
    for (let i = 0; out.length < COLS; i++) out.push(ranked[i % ranked.length]);
    return out;
  }
  // ── ASCII v6 (docs/ascii-screen-plan.md): the atlas is a free GLYPH
  // LIBRARY, not a density ramp. Rows 1-14 = 224 slots filled with the whole
  // charset (shuffled, repeated); tone is carried by stamp PRESENCE × SIZE
  // (curves below), not by glyph choice — free choice is what structurally
  // kills the "all As" failure. Row 0 blank, row 15 solid (floor/reserved).
  // Row 16 = curve strip: .r floor residual, .g presence(v), .b size(v).
  const atlas = document.createElement('canvas'); atlas.width = COLS * CELL; atlas.height = (ROWS + 1) * CELL;
  const ac = atlas.getContext('2d', { willReadFrequently: true });
  ac.fillStyle = '#000'; ac.fillRect(0, 0, atlas.width, atlas.height); // paper = 0
  ac.fillStyle = '#fff';
  {
    const pool = glyphs.slice();
    for (let i = pool.length - 1; i > 0; i--){ const j = (Math.random() * (i + 1)) | 0; const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    let gi = 0;
    for (let row = 1; row < ROWS - 1; row++)
      for (let col = 0; col < COLS; col++)
        drawGlyph(ac, pool[(gi++) % pool.length].ch, col * CELL, row * CELL);
  }
  ac.fillRect(0, (ROWS - 1) * CELL, COLS * CELL, CELL); // row 15 solid

  // ── Curve strip (P1: analytic initial guess; P2 replaces with Monte-Carlo
  // of the real stamp process). Boolean-law-derived presence/size with the
  // review's corrections: presence carries v≲0.3, size carries 0.3-0.8, both
  // saturate above; the solid floor is the RESIDUAL (v − E_letters)/(1 −
  // E_letters), clamped to engage only in deep shadow, so letters carry tone
  // to ~0.9 and floor+letters never double-count.
  {
    const cMean = glyphs.reduce((a, g) => a + g.cov, 0) / glyphs.length; // mean glyph ink at scale 1
    const W = COLS * CELL;
    for (let x = 0; x < W; x++){
      const v = x / (W - 1);
      // size: 0.5 → 1.5 cells across v 0..0.65 (encoded (s-0.3)/1.2) —
      // saturates earlier since letters alone now carry the darks (no floor)
      const s = 0.5 + 1.0 * Math.min(1, v / 0.65);
      // per-candidate covered fraction (clip factor ~0.85 once s>1 overflows cell)
      const q = Math.min(0.95, s * s * cMean * (s > 1 ? 0.85 : 1.0));
      // Boolean target: lambda*a = -ln(1-v); NO floor (user request: darks are
      // pure bunched letters; deepest tone caps at the union ceiling ~0.9)
      const la = -Math.log(1 - Math.min(v, 0.95));
      const p = Math.max(0, Math.min(1, la / (3 * q)));
      const r = 0, g = Math.round(p * 255), b = Math.round(Math.max(0, Math.min(1, (s - 0.3) / 1.2)) * 255);
      ac.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
      ac.fillRect(x, ROWS * CELL, 1, CELL);
    }
  }

  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE8);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.activeTexture(gl.TEXTURE0);
  window._glyphAtlasTex = tex;
  console.log('[glyphAtlas] built:', glyphs.length, 'glyphs (georgian ' + (glyphs.some(g => georgian.indexOf(g.ch) >= 0) ? 'OK' : 'unavailable — latin/symbol fallback') + ')');
}

function setRenderUniforms(dw, dh, scale, isPhone){
  const layers=activeLayers();
  const nLayers=layers.length;
  gl.uniform2f(locs.u_res,dw,dh);
  gl.uniform1f(locs.u_time,frame);
  gl.uniform1f(locs.u_frameSeed,frameSeed);
  gl.uniform1f(locs.u_resScale,scale);
  gl.uniform1i(locs.u_layers,hasSrc?nLayers:0);
  // 0=grain, 1=screen, 2=lines, 3=flat (production-preview, no simulation)
  gl.uniform1i(locs.u_mode, ({grain:0, screen:1, lines:2, flat:3})[mode] ?? 0);
  gl.uniform1i(locs.u_lineShape, window._lineShape||0);
  gl.uniform1f(locs.u_lineAmount, window._lineAmount ?? 1.0);
  gl.uniform1f(locs.u_lineWeight, window._lineWeight ?? 1.0);
  gl.uniform1f(locs.u_lineRoughness, window._lineRoughness ?? 0.5);
  // Per-layer line center: each plate gets its own X/Y for CONCENTRIC/
  // RADIAL pivot. Sourced from layerLineCenterX/Y by the channel index
  // of each active layer (so plate ordering / spot-mode dedup works).
  for(let li=0; li<4; li++){
    const L = (li < nLayers) ? layers[li] : null;
    const ch = L ? L.ch : li;
    gl.uniform2f(locs['u_lineCenter'+li],
      (typeof layerLineCenterX !== 'undefined' && layerLineCenterX[ch] != null) ? layerLineCenterX[ch] : 0.5,
      (typeof layerLineCenterY !== 'undefined' && layerLineCenterY[ch] != null) ? layerLineCenterY[ch] : 0.5);
  }
  gl.uniform1f(locs.u_lineEdgeThickness, window._lineEdgeThickness ?? 0.0);
  gl.uniform1f(locs.u_lineCount, window._lineCount ?? 1.0);
  gl.uniform1f(locs.u_colorQuant, window._colorQuant ?? 0.0);
  // Lab-residual default ON (T1-A): in SPOT mode, comparing candidate ink
  // subsets in perceptual Lab space picks better hue matches than RGB delta.
  // Free win since the math was already there. Toggle off only if comparing
  // against legacy renders.
  gl.uniform1f(locs.u_useLabResidual, (window._useLabResidual ?? true) ? 1.0 : 0.0);
  // T1-B default ON: calibrated chord (2*(p50-paper)) corrects NNLS for real
  // Riso ink response concavity. Inks reach perceptually heavier color at 50%
  // than linear models predict, so naive ink100-paper deltas tell NNLS to use
  // ~30-40% extra ink than actually needed. With the chord, separation
  // matches the calibration LUT the preview pass already uses.
  gl.uniform1f(locs.u_useCalChord, (window._useCalChord ?? true) ? 1.0 : 0.0);
  // T3-F default ON: pre-baked per-ink coverage→color LUT replaces 8-12
  // Fritsch-Carlson Hermite evaluations per pixel with a single texture2D().
  // Worker re-bakes when the palette changes; otherwise zero per-frame cost.
  if (locs.u_useCalLutTex) gl.uniform1f(locs.u_useCalLutTex, (window._useCalLutTex ?? true) ? 1.0 : 0.0);
  bakeCalLutIfNeeded(layers);
  gl.uniform1f(locs.u_warmCool, (cached.warmCool ?? 0) * 0.02); // slider -50..50 → -1..1
  gl.uniform1i(locs.u_stampShape, window._stampShape || 0);
  // ASCII stamp layout seed: re-rolled by ANIMATION ticks only (grain-static
  // ticks / live frames / recording) — slider-drag re-renders keep the layout.
  if(locs.u_stampSeed) gl.uniform1f(locs.u_stampSeed, window._stampSeed || 17);
  gl.uniform1f(locs.u_ditherScale, window._ditherScale ?? 1.0);
  // Text layer index — which active layer (0..3) gets routed text pixels.
  // -1 disables the text path entirely (any non-PDF source, or PDF mode
  // off, or chosen text color isn't currently in any channel slot).
  gl.uniform1i(locs.u_textLayerIdx, (typeof getTextLayerIdx === 'function') ? getTextLayerIdx() : -1);
  gl.uniform1f(locs.u_textKnockout, (typeof textKnockout !== 'undefined' && textKnockout) ? 1.0 : 0.0);
  gl.uniform1f(locs.u_trappingPx, (typeof trappingPx !== 'undefined') ? trappingPx : 0.0);
  gl.uniform1i(locs.u_sepMode,0);
  gl.uniform1i(locs.u_sepType,cached.sepType||0);
  gl.uniform1f(locs.u_grainSize,cached.grainSize);
  // Master noise multiplier: 0 in FLAT and in SCREEN+Clean — every
  // hardcoded noise source in the shader scales by u_simNoise, so this
  // single uniform replaces all the previous per-effect overrides.
  // User-facing sliders (u_inkNoise, u_pressVar, etc) remain untouched;
  // they multiply with u_simNoise so their values are preserved when
  // toggling clean off again.
  // Grain Touch (ditherMode 7) used to bypass all sim noise to show the
  // raw thermal-head master — but the real RISO print has heavy physical
  // noise (paper texture, ink-density variation, drum jitter) on top of
  // the matrix. Keep sim noise ON so the output looks like printed paper,
  // not the digital master file.
  const _cleanRender = (mode === 'flat') || (mode === 'screen' && window._screenClean);
  gl.uniform1f(locs.u_simNoise, _cleanRender ? 0 : 1);
  gl.uniform1f(locs.u_dotGain,   cached.dotGain);
  gl.uniform1f(locs.u_inkNoise,  cached.inkNoise);
  // SCREEN engine: 1 = RISO authentic matrix (DEFAULT for circles; LPI snaps
  // to 43/71/106), 0 = "Classic dots" procedural (console: R.setScreenType(0)).
  // Non-circle stamp shapes always use the procedural/stylized paths.
  if(locs.u_screenType) gl.uniform1f(locs.u_screenType, (window._screenType ?? 0) ? 1.0 : 0.0);
  // Unit 8 (the u_ht5Matrix sampler) is time-shared by THREE mode-exclusive
  // consumers — adding a 17th sampler would exceed MAX_TEXTURE_IMAGE_UNITS(16):
  //   • grain mode: Grain-Touch ht5 threshold matrix
  //   • screen mode, matrix engine (screenType=1): the AM matrix
  //   • screen mode, procedural engine + ASCII stamp: the glyph atlas
  if(window._amScreenTex && window._ht5MatrixTex){
    let u8tex = (mode==='screen') ? window._amScreenTex : window._ht5MatrixTex;
    if(mode === 'screen' && (window._screenType ?? 0) && (window._stampShape|0) === 0){
      // Matrix engine (CIRCLES only — the faithful screen is confined to the
      // circle stamp): bind the driver matrix for the snapped LPI preset.
      // TRC-calibrated variant by default (R.setScreenTrc(0) for raw).
      const m = window._screenMatrixTexs && (window._screenMatrixTexs[window._snapScreenLpi(cached.lpi)] || window._screenMatrixTexs[43]);
      if(m){
        u8tex = ((window._screenTrc ?? 1) && m.cal) ? m.cal : m.tex;
        if(locs.u_mtxTexel) gl.uniform2f(locs.u_mtxTexel, 1.0/m.w, 1.0/m.h);
      }
    } else if(mode === 'screen' && (window._stampShape|0) === 5){
      if(!window._glyphAtlasTex) try { _buildGlyphAtlas(); } catch(e){ console.warn('[glyphAtlas]', e); }
      if(window._glyphAtlasTex) u8tex = window._glyphAtlasTex;
    }
    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, u8tex);
    gl.activeTexture(gl.TEXTURE0);
  }
  // Paper type: 'blank' forces zero texture (kills BOTH the PBR substrate and
  // the legacy procedural/scan path — both scale by u_paperTex). Other types
  // shape the PBR character via u_paperPbrMul (tooth strength, sheen).
  gl.uniform1f(locs.u_paperTex, window._paperBlank ? 0 : cached.paperTex);
  if(locs.u_paperPbrMul){
    const pm = window._paperPbrMul || [1, 1];
    gl.uniform2f(locs.u_paperPbrMul, pm[0], pm[1]);
  }
  // Set per-frame so a SEPS export (which forces it off) can't leave it stuck.
  if(locs.u_usePaperPBR) gl.uniform1f(locs.u_usePaperPBR, (window._usePaperPBR ?? true) ? 1.0 : 0.0);
  // Live source (camera/video): RISO mode uses the real-time GPU grain-touch
  // fallback. Static sources show smooth tone while the FS master builds.
  if(locs.u_liveSource) gl.uniform1f(locs.u_liveSource, (camOn || videoOn) ? 1.0 : 0.0);
  // Paper shifts per frame — only in animate mode (simulating different sheet feeds)
  var isAnimating = cached.grainStatic > 0 || camOn || videoOn;
  if(isAnimating){
    var psx = ((Math.sin(frameSeed * 127.1) * 43758.5453) % 1) * 400.0;
    var psy = ((Math.sin(frameSeed * 269.5) * 43758.5453) % 1) * 400.0;
    gl.uniform2f(locs.u_paperShift, psx, psy);
    cached._lastPaperShiftX = psx;
    cached._lastPaperShiftY = psy;
    // PBR single-sheet: per-frame UV reposition so each printed frame sits on a
    // clearly different patch of the sheet (each pass = a fresh sheet feed).
    // ±0.07 of the sheet per axis, within the ±8% margin left by PAPER_ZOOM so
    // it never reaches the clamped edge.
    if(locs.u_paperPbrShift){
      var ppx = (Math.abs((Math.sin(frameSeed * 311.7) * 43758.5453) % 1) - 0.5) * 0.14; // ±0.07
      var ppy = (Math.abs((Math.sin(frameSeed * 521.3) * 43758.5453) % 1) - 0.5) * 0.14;
      gl.uniform2f(locs.u_paperPbrShift, ppx, ppy);
    }
  } else {
    gl.uniform2f(locs.u_paperShift, 0.0, 0.0);
    cached._lastPaperShiftX = 0;
    cached._lastPaperShiftY = 0;
    if(locs.u_paperPbrShift) gl.uniform2f(locs.u_paperPbrShift, 0.0, 0.0);
  }
  gl.uniform1f(locs.u_static,cached.grainStatic);
  gl.uniform1f(locs.u_bright,cached.imgBright);
  gl.uniform1f(locs.u_contrast,cached.imgContrast);
  gl.uniform1f(locs.u_sat,cached.imgSat);
  gl.uniform1f(locs.u_shadows,cached.imgShadows);
  gl.uniform1f(locs.u_highlights,cached.imgHighlights||0);
  gl.uniform1f(locs.u_postExposure,cached.postExposure||0);
  gl.uniform1f(locs.u_postContrast,cached.postContrast||0);
  gl.uniform1f(locs.u_postSat,cached.postSat||0);
  // Dot PITCH follows the LPI control freely in BOTH engines — the real
  // driver synthesizes integer-diagonal lattices for arbitrary frequencies
  // (its "Screen 40" preset measures 38.6 lpi), so free pitch IS authentic.
  // Only the threshold-matrix family + measured tone curve snap to the
  // nearest stored frequency (43/71/106) in the unit-8 bind above.
  gl.uniform1f(locs.u_screenCell,Math.max(1.5,Math.min(dw,dh)/(8.267*cached.lpi)));
  gl.uniform3fv(locs.u_paperColor,cached.paperColor);
  gl.uniform3f(locs.u_paper, 0.910, 0.912, 0.908);
  gl.uniform1f(locs.u_showCropMarks, cached.showCropMarks ? 1.0 : 0.0);
  gl.uniform1f(locs.u_ghosting, cached.ghosting * 0.01 * (cached.ghostMul * 0.01));
  gl.uniform1f(locs.u_bleed, 0.0);
  gl.uniform1f(locs.u_ucrStr, cached.ucrStr * 0.01);
  gl.uniform4f(locs.u_cmykBal, cached.balC*0.01, cached.balM*0.01, cached.balY*0.01, cached.balK*0.01);
  gl.uniform1f(locs.u_tac, cached.tac * 0.01);
  gl.uniform1f(locs.u_inkOpacity, cached.inkOpacity * 0.01);
  gl.uniform1f(locs.u_layerDeplete, cached.layerDeplete * 0.01);
  gl.uniform1f(locs.u_pressVar,     cached.pressVar * 0.01);
  gl.uniform1f(locs.u_densFlicker,  cached.densFlicker * 0.01);
  gl.uniform1f(locs.u_tonalGamma, cached.tonalGamma * 0.01);
  gl.uniform1f(locs.u_dotMin, cached.dotMin * 0.01);
  gl.uniform1f(locs.u_opacityCap, cached.opacityCap * 0.01);
  // Per-layer ink data + misreg/skew
  for(let i=0;i<4;i++){
    if(i<nLayers){
      const L=layers[i];
      const cal=RISO_CAL[L.color];
      if(cal){
        const lt=cal.lut;
        gl.uniform1f(opaqueLocs[i], cal.opaque ? 1.0 : 0.0);
        gl.uniform1f(locs['u_transparent'+i], cal.transparent ? 1.0 : 0.0);
        gl.uniform3f(inkLocs[i],lt[4][0],lt[4][1],lt[4][2]);
        gl.uniform3f(lutALocs[i],lt[0][0],lt[0][1],lt[0][2]);
        gl.uniform3f(lutBLocs[i],lt[1][0],lt[1][1],lt[1][2]);
        gl.uniform3f(lutCLocs[i],lt[2][0],lt[2][1],lt[2][2]);
        gl.uniform3f(lutDLocs[i],lt[3][0],lt[3][1],lt[3][2]);
        gl.uniform1f(grainMulLocs[i],cal.grainMul);
        gl.uniform1f(locs['u_inkGamma'+i],cal.gamma||1.0);
        gl.uniform1f(hasCalLocs[i],1.0);
      } else {
        const rgb=cached.inkRGB[i];
        gl.uniform3f(inkLocs[i],rgb[0],rgb[1],rgb[2]);
        gl.uniform3f(lutALocs[i],0,0,0);
        gl.uniform3f(lutBLocs[i],0,0,0);
        gl.uniform3f(lutCLocs[i],0,0,0);
        gl.uniform3f(lutDLocs[i],0,0,0);
        gl.uniform1f(grainMulLocs[i],1.0);
        gl.uniform1f(locs['u_inkGamma'+i],1.0);
        gl.uniform1f(hasCalLocs[i],0.0);
        gl.uniform1f(opaqueLocs[i],0.0);
        gl.uniform1f(locs['u_transparent'+i],0.0);
      }
      gl.uniform2f(offLocs[i],misreg[L.ch][0],misreg[L.ch][1]);
      gl.uniform1f(skewLocs[i],layerSkews[L.ch]||0);
      gl.uniform1f(angLocs[i],(layerAngles[L.ch]||0)*0.01745329);
      gl.uniform1i(chanLocs[i],L.ch);
      // Multiply density by visibility flag so user can toggle plates
      // on/off via the channel badges. Hidden plates contribute 0 ink.
      gl.uniform1f(densLocs[i],cached.layerDens[L.ch] * ((typeof layerVisible !== 'undefined' && !layerVisible[L.ch]) ? 0 : 1));
      gl.uniform1f(locs['u_knockout'+i], (L.knockout ? 1.0 : 0.0));
    }else{
      gl.uniform3f(inkLocs[i],0,0,0);
      gl.uniform2f(offLocs[i],0,0);
      gl.uniform1f(skewLocs[i],0);
      gl.uniform1f(angLocs[i],0);
      gl.uniform1i(chanLocs[i],0);
      gl.uniform1f(densLocs[i],0);
      gl.uniform1f(hasCalLocs[i],0.0);
      gl.uniform1f(opaqueLocs[i],0.0);
      gl.uniform1f(locs['u_transparent'+i],0.0);
      gl.uniform1f(locs['u_knockout'+i],0.0);
      gl.uniform1f(grainMulLocs[i],1.0);
      gl.uniform1f(locs['u_inkGamma'+i],1.0);
    }
  }
  // Cover crop
  const isGif=videoOn&&(gifImg||gifFrames);
  let renderCrop=[0,0,1,1];
  if(hasSrc){
    const srcW=(camOn||(videoOn&&!isGif))?($vid.videoWidth||1):(isGif?(gifCanvas.width||1):(srcImg?srcImg.width:1));
    const srcH=(camOn||(videoOn&&!isGif))?($vid.videoHeight||1):(isGif?(gifCanvas.height||1):(srcImg?srcImg.height:1));
    let targetAR;
    if(cropAspect === 'fill') targetAR = dw/dh;
    else if(cropAspect === 'fit') targetAR = srcW/srcH;
    else if(cropAspect) targetAR = cropAspect[0]/cropAspect[1];
    else targetAR = dw/dh;
    const srcAR=srcW/srcH;
    if(targetAR>srcAR){
      const h=srcAR/targetAR;
      renderCrop=[0,(1-h)/2,1,h];
    } else {
      const w=targetAR/srcAR;
      renderCrop=[(1-w)/2,0,w,1];
    }
  }
  gl.uniform4f(locs.u_crop,renderCrop[0],renderCrop[1],renderCrop[2],renderCrop[3]);
  // Print area
  const paperAR = dw / dh;
  const minMargin = cached.margin * 0.01;
  if (isPhone) {
    const pm = Math.max(minMargin, 0.005);
    gl.uniform4f(locs.u_printArea, pm, pm, pm, pm);
  } else if (cropAspect === 'fill') {
    const m = Math.max(minMargin, 0.005);
    gl.uniform4f(locs.u_printArea, m, m, m, m);
  } else {
    let imgAR;
    if (cropAspect === 'fit') {
      const srcW2 = (camOn||(videoOn&&!isGif)) ? ($vid.videoWidth||1) : (isGif ? (gifCanvas.width||1) : (srcImg ? srcImg.width : 1));
      const srcH2 = (camOn||(videoOn&&!isGif)) ? ($vid.videoHeight||1) : (isGif ? (gifCanvas.height||1) : (srcImg ? srcImg.height : 1));
      imgAR = srcW2 / srcH2;
    } else {
      imgAR = cropAspect[0] / cropAspect[1];
    }
    const availW = 1.0 - 2.0 * minMargin;
    const availH = 1.0 - 2.0 * minMargin;
    let printW, printH;
    if (imgAR > (availW * paperAR) / availH) {
      printW = availW;
      printH = availW * paperAR / imgAR;
      if (printH > availH) { printH = availH; printW = availH * imgAR / paperAR; }
    } else {
      printH = availH;
      printW = availH * imgAR / paperAR;
      if (printW > availW) { printW = availW; printH = availW * paperAR / imgAR; }
    }
    gl.uniform4f(locs.u_printArea, (1-printW)/2, (1-printH)/2, (1-printW)/2, (1-printH)/2);
  }
}

// ======================== RENDER LOOP ========================
let _renderErrorCount=0;
function render(){
  _rafId=0;
  if(_saving){return;} // block render during save
  if(gl.isContextLost()){return;} // GPU lost — wait for restore
  // Pause: spacebar toggles. While paused, render() is a no-op so the canvas
  // freezes at the last drawn frame (camera frames keep arriving but don't
  // upload, FPS counter stops advancing). Press again to resume.
  if(window._paused){return;}
  // (Prepass no longer blocks render — FS runs in a Web Worker thread.)
  try{ _renderInner(); }catch(e){
    if(_renderErrorCount++<3)console.error('Render error:',e);
    if(_renderErrorCount===3)R.toast('Render errors — see console');
    scheduleRender(); // keep loop alive
  }
}
R.togglePause=function(){
  window._paused=!window._paused;
  if(!window._paused){
    needsRedraw=true;
    scheduleRender(); // wake the loop back up
  }
  R.toast(window._paused?'PAUSED (space)':'PLAY');
  return window._paused;
};
function _renderInner(){
  const isPhoneNow=phoneActive;

  // Aspect ratio — canvas shape
  if(needsAspectUpdate){
    // PDF mode: lock canvas to a fixed viewport-height so portrait pages
    // don't make the layout absurdly tall. Width auto-derives from the
    // active page's aspect-ratio (set inline by applyPdfPageAspect).
    if(window._pdfDoc && window._pdfMeta && window._pdfMeta[window._pdfActiveIdx]){
      const m=window._pdfMeta[window._pdfActiveIdx];
      $gl.style.aspectRatio=m.nativeW+'/'+m.nativeH;
      $gl.style.height='65vh';
      $gl.style.width='auto';
      $gl.style.maxWidth='100%';
      $gl.style.maxHeight='';
    } else if(isPhoneNow && cropAspect && typeof cropAspect !== 'string'){
      $gl.style.aspectRatio = cropAspect[0]+'/'+cropAspect[1];
      $gl.style.width = '';
      $gl.style.height = '';
    } else if(isPhoneNow){
      $gl.style.aspectRatio = '';
      $gl.style.width = '100%';
      $gl.style.height = '100%';
    } else {
      $gl.style.aspectRatio='';
      $gl.style.width = '100%';
      $gl.style.height = '';
      $gl.style.maxWidth='';
      $gl.style.maxHeight='';
    }
    cachedVfW=$vf.clientWidth;cachedVfH=$vf.clientHeight;
    needsAspectUpdate=false;
    needsRedraw=true;
    if(!isPhoneNow) setTimeout(()=>{R.updateCropGuide(0,0,0,0);},50);
  }

  // ─── Riso-FPS throttle: choppy print-animation feel ───
  const now=performance.now();
  let newCamFrame=false;
  const isGifPlaying=videoOn&&(gifImg||gifFrames);
  const hasCamData=(camOn||(videoOn&&!isGifPlaying))&&$vid.readyState>=2&&(videoFrameReady||!$vid.requestVideoFrameCallback);
  const hasGifData=isGifPlaying&&videoFrameReady;

  if((camOn||videoOn) && risoFps > 0){
    const interval=1000/risoFps;
    if(now - lastRisoFrame < interval && !needsRedraw){
      fpsFrames++;
      // Sleep until next frame is due instead of spinning RAF
      if(!_rafId) _rafId=setTimeout(()=>{_rafId=0;scheduleRender();}, Math.max(1, interval-(now-lastRisoFrame)));
      return;
    }
    lastRisoFrame=now;
    if(cached.grainStatic > 0){
      frame += Math.floor(Math.random()*40)+15;
      frameSeed = Math.random(); window._stampSeed = ((window._stampSeed || 17) + 1.0) % 1021.0;
      if(!R.isMono()){
        const m=cached.misreg/500;
        for(let i=0;i<4;i++){
          misreg[i]=[(Math.random()-.5)*m*2,(Math.random()-.5)*m*2];
        }
      }
    } else {
      frame++;
      frameSeed = Math.random(); window._stampSeed = ((window._stampSeed || 17) + 1.0) % 1021.0;
    }
  } else {
    const animating = cached.grainStatic > 0 || videoOn;
    if(!needsRedraw && !hasCamData && !hasGifData && !isRecording && !animating) {
      fpsFrames++;
      return; // truly idle — no scheduleRender(), engine sleeps
    }
    if(animating){
      const staticFps = Math.max(2, cached.grainStatic);
      const staticInterval = 1000 / staticFps;
      if(!window._lastStaticFrame) window._lastStaticFrame = 0;
      if(now - window._lastStaticFrame < staticInterval && !needsRedraw) {
        fpsFrames++;
        if(!_rafId) _rafId=setTimeout(()=>{_rafId=0;scheduleRender();}, Math.max(1, staticInterval-(now-window._lastStaticFrame)));
        return;
      }
      window._lastStaticFrame = now;
      frame++;
      frameSeed = Math.random(); window._stampSeed = ((window._stampSeed || 17) + 1.0) % 1021.0;
      R.newMisreg();
    } else {
      frame++;
      frameSeed = Math.random(); window._stampSeed = ((window._stampSeed || 17) + 1.0) % 1021.0;
      // STILL = every adjustment is a fresh print: any dirty re-render
      // (slider, button) also re-rolls plate misregistration/skew, so the
      // view visibly re-seeds like the dice button (user request). Quiet
      // variant — markDirty here would self-perpetuate the render loop.
      // Skipped for live sources at FPS=STILL (the frozen frame must not
      // shimmer per camera frame).
      if(!camOn && !videoOn && R.rollMisregQuiet) R.rollMisregQuiet();
    }
  }
  needsRedraw=false;

  // Upload video/GIF frame only when we'll actually draw
  if(hasCamData){
    swapSrcTextures();
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,$vid);
    gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,window._srcTexB);
    gl.uniform1i(locs.u_src,0);gl.uniform1i(locs.u_prevSrc,3);
    hasSrc=true;videoFrameReady=false;newCamFrame=true;
  }
  if(hasGifData){
    swapSrcTextures();
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,gifCanvas);
    gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,window._srcTexB);
    gl.uniform1i(locs.u_src,0);gl.uniform1i(locs.u_prevSrc,3);
    videoFrameReady=false;newCamFrame=true;
  }

  // Canvas sizing — use cached dimensions (updated on resize/aspect change).
  // In PDF mode the canvas has its own aspect-ratio (matching the active
  // page) so its display size differs from the parent panel — read from
  // $gl directly so the WebGL buffer matches what's actually on screen.
  let cssW, cssH;
  if(window._pdfDoc){
    cssW=$gl.clientWidth||cachedVfW||$vf.clientWidth;
    cssH=$gl.clientHeight||cachedVfH||$vf.clientHeight;
  } else {
    cssW=cachedVfW||$vf.clientWidth;
    cssH=cachedVfH||$vf.clientHeight;
  }
  // String aspects ('fill'/'fit') must NOT take this branch: indexing a string
  // gives 'f'/'i' → NaN → $gl.width=NaN→0 → permanently black canvas. (Hit by
  // entering phone mode with FILL/FIT set, or any PDF load which sets 'fit'.)
  // Strings fall through to full-viewfinder sizing, same as the style branch.
  if(isPhoneNow && cropAspect && typeof cropAspect !== 'string'){
    const ar=cropAspect[0]/cropAspect[1];
    const containerAR=cssW/cssH;
    if(ar>containerAR) cssH=Math.round(cssW/ar);
    else cssW=Math.round(cssH*ar);
  }
  const dpr=isPhoneNow?1:Math.min(window.devicePixelRatio||1, 2);
  const baseScale=Math.max(resScale, dpr);
  const dw=Math.round(cssW*baseScale), dh=Math.round(cssH*baseScale);
  if($gl.width!==dw||$gl.height!==dh){$gl.width=dw;$gl.height=dh;}
  gl.viewport(0,0,dw,dh);

  // ─── Uniforms — all from cached values, zero DOM access ───
  setRenderUniforms(dw, dh, resScale, isPhoneNow);

  // Anchor-tone prepasses (ASCII pass 1 / circles soft-edge pass 2) — shared
  // with the export paths in save.js via R._runTonePrepass.
  _runTonePrepass(dw, dh);

  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

  // Sync CSS paper overlay shift with shader paper shift
  if(cached._lastPaperShiftX !== undefined){
    var ov=el('paperOverlay');
    var phOv=el('phPaperOverlay');
    // Convert reference-pixel shift to percentage of overlay
    var pctX = (cached._lastPaperShiftX / 256.0 * 100) % 100;
    var pctY = (cached._lastPaperShiftY / 256.0 * 100) % 100;
    var pos = pctX+'% '+pctY+'%';
    if(ov) ov.style.backgroundPosition=pos;
    if(phOv) phOv.style.backgroundPosition=pos;
  }

  // FPS counter — DOM write once per second
  fpsFrames++;
  const fpsNow=performance.now();
  if(fpsNow-fpsLast>=1000){
    $fps.textContent=((camOn||videoOn)?risoFps+'fps':fpsFrames+' fps');
    $res.textContent=dw+'×'+dh+(resScale>1?' ('+resScale+'×)':'');
    fpsFrames=0;fpsLast=fpsNow;
  }

  // Schedule next frame only if continuous mode — throttled scheduling happens above
  const continuous = camOn || videoOn || isRecording || cached.grainStatic > 0;
  if(continuous && !_rafId) scheduleRender();
}

// Texture double-buffer swap helper
function swapSrcTextures(){
  const tmp=window._srcTexA; window._srcTexA=window._srcTexB; window._srcTexB=tmp;
  window._srcFlip=!window._srcFlip;
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,window._srcTexA);
}

// Video frame callback — marks when a new video frame is available
// Start (or restart) the requestVideoFrameCallback loop. Each call bumps a
// generation token; the in-flight tick bails as soon as a newer loop supersedes
// it, so camera↔video switches can't stack multiple rVFC chains (which used to
// double/triple per-frame texture uploads for the rest of the session).
// NOTE: call this ONCE to start the loop — do NOT pass it to
// requestVideoFrameCallback as the per-frame callback (that would spawn a new
// generation every frame). The internal `tick` is the per-frame callback.
function onVideoFrame(){
  const gen = (window._vidGen = (window._vidGen||0) + 1);
  function tick(){
    if((window._vidGen||0)!==gen) return; // a newer loop took over — stop
    videoFrameReady=true;
    if((camOn||videoOn)&&$vid.requestVideoFrameCallback){
      $vid.requestVideoFrameCallback(tick);
    }
  }
  videoFrameReady=true;
  if($vid.requestVideoFrameCallback) $vid.requestVideoFrameCallback(tick);
}



// ======================== TONE CURVE ========================
function uploadToneCurve(lut){
  // lut = Uint8Array(256)
  if(!gl||!window._toneCurveTex) return;
  var rgba=new Uint8Array(256*4);
  for(var i=0;i<256;i++){rgba[i*4]=lut[i];rgba[i*4+1]=lut[i];rgba[i*4+2]=lut[i];rgba[i*4+3]=255;}
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D,window._toneCurveTex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,1,0,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
  gl.uniform1f(locs.u_useToneCurve,1.0);
  // Also store for compare.js CPU-side usage
  window._toneCurveLUT=lut;
  markDirty();
}
function resetToneCurve(){
  var id=new Uint8Array(256);
  for(var i=0;i<256;i++) id[i]=i;
  uploadToneCurve(id);
  gl.uniform1f(locs.u_useToneCurve,0.0);
  window._toneCurveLUT=null;
  markDirty();
}

// ======================== RISO DRIVER LUT ========================
// Transfer function LUTs extracted from RISO MZ9 printer driver (R34V6FC.dll)
// These are 256-byte lookup tables the driver applies to sRGB values before halftoning
var DRIVER_LUTS = {
  // LUT A: γ≈1.12 — Tone Level 1 (lightest, near-linear)
  1: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,15,16,17,18,18,19,20,21,21,22,23,24,25,25,26,27,28,29,30,31,32,33,34,35,36,36,37,38,39,40,41,42,43,44,44,45,46,47,48,49,50,51,52,53,54,55,56,57,57,58,59,60,61,62,63,64,65,66,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,131,132,133,134,135,136,137,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,154,155,156,157,159,160,161,162,163,164,165,166,167,168,169,170,171,172,173,174,175,176,178,179,180,181,182,183,184,185,186,187,189,190,191,192,193,194,195,196,197,198,199,200,201,203,204,205,206,207,208,209,210,211,213,214,215,216,217,218,219,220,221,222,223,225,226,227,228,229,230,231,232,234,235,236,237,238,239,240,241,242,243,245,246,247,248,249,250,251,252,254,255],
  // LUT B: γ≈1.40 — Tone Level 2
  2: [0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,9,9,10,10,11,11,12,13,13,14,14,15,15,16,17,17,18,18,19,20,20,21,21,22,23,23,24,25,25,26,27,27,28,29,29,30,31,31,32,33,33,34,35,36,36,37,38,38,39,40,41,41,42,43,44,44,45,46,47,47,48,49,50,50,51,52,53,54,54,55,56,57,58,58,59,60,61,62,63,63,64,65,66,67,68,68,69,70,71,72,73,74,75,75,76,77,78,79,80,81,82,83,84,85,85,86,87,88,89,90,91,92,93,94,95,96,97,97,98,99,100,101,102,103,104,105,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,124,125,126,127,128,129,130,131,133,134,135,136,137,138,140,141,142,143,144,145,147,148,149,150,152,153,154,156,157,158,159,161,162,163,165,166,167,169,170,171,173,174,175,177,178,180,181,182,184,185,187,188,190,191,192,194,195,197,198,200,201,203,204,206,207,209,210,212,213,215,217,218,220,221,222,223,225,226,227,228,229,231,232,233,234,235,236,237,238,239,240,241,242,243,244,245,246,255],
  // LUT C: γ≈2.03 — Tone Level 3
  3: [0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,6,6,6,6,7,7,7,8,8,8,9,9,9,9,10,10,10,11,11,11,12,12,12,13,13,13,14,14,14,15,15,16,16,16,17,17,17,18,18,19,19,19,20,20,21,21,22,22,22,23,23,24,24,25,25,26,26,27,27,28,28,28,29,29,30,30,31,32,32,33,33,34,34,35,35,36,37,37,38,38,39,40,40,41,42,42,43,43,44,45,46,46,47,48,48,49,50,50,51,52,53,53,54,55,56,57,57,58,59,60,61,62,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,85,86,87,88,90,91,92,93,95,96,97,99,100,101,103,104,106,107,109,110,112,113,115,116,118,120,121,123,125,126,128,130,131,133,135,137,139,140,142,144,146,148,150,152,154,156,158,160,162,164,167,169,171,173,176,178,180,183,185,188,190,193,195,198,200,203,206,208,211,213,216,219,221,224,227,230,233,234,235,237,238,240,241,242,244,245,247,248,249,251,252,254,255,255,255,255,255,255,255,255,255],
  // LUT D: γ≈2.65 — Tone Level 4 (DEFAULT — the real riso driver default)
  4: [0,0,1,1,1,1,2,2,2,3,3,3,3,4,4,4,5,5,5,5,6,6,6,7,7,7,7,8,8,8,8,9,9,9,10,10,10,10,11,11,11,11,12,12,12,12,13,13,13,14,14,14,14,15,15,15,15,16,16,16,17,17,17,18,18,18,19,19,19,20,20,20,21,21,22,22,22,23,23,23,24,24,25,25,25,26,26,27,27,27,28,28,28,29,29,30,30,30,31,31,31,32,32,33,33,33,34,34,34,35,35,35,36,36,36,37,37,37,38,38,39,39,39,40,40,40,41,41,41,42,42,42,43,43,44,44,44,45,45,46,46,46,47,47,48,48,48,49,49,50,50,50,51,51,52,52,53,53,54,54,54,55,55,56,56,57,57,58,58,59,59,60,61,61,62,62,63,63,64,65,65,66,67,68,68,69,70,71,71,72,73,74,75,76,77,78,79,80,81,82,83,84,86,87,88,90,91,93,94,96,97,99,101,103,104,106,108,110,112,114,116,118,120,122,124,126,128,130,132,135,137,139,142,145,148,151,154,158,162,166,170,175,180,184,190,195,200,206,212,218,224,230,236,242,249,255],
  // LUT L: γ≈0.62 — Backlight correction / shadow lift (inverse curve)
  5: [0,1,2,3,5,6,7,9,10,11,13,14,15,16,18,19,20,22,23,24,26,27,28,29,31,32,33,35,36,37,39,40,41,42,44,45,46,48,49,50,52,53,54,55,57,58,59,61,62,63,65,66,67,68,70,71,72,74,75,76,78,79,80,81,83,84,85,87,88,89,91,92,93,94,96,97,98,100,101,102,104,105,106,107,109,110,111,113,114,115,117,118,119,120,122,123,124,126,127,128,130,131,132,133,135,136,137,139,140,141,143,144,145,146,148,149,150,152,153,154,156,157,158,159,161,162,163,165,166,167,167,168,169,169,170,171,171,172,173,173,174,175,176,176,177,178,178,179,180,180,181,182,182,183,184,185,185,186,187,187,188,189,189,190,191,191,192,193,194,194,195,196,196,197,198,198,199,200,200,201,202,202,203,204,205,205,206,207,207,208,209,209,210,211,211,212,213,214,214,215,216,216,217,218,218,219,220,220,221,222,222,223,224,225,225,226,227,227,228,229,229,230,231,231,232,233,234,234,235,236,236,237,238,238,239,240,240,241,242,242,243,244,245,245,246,247,247,248,249,249,250,251,251,252,253,255]
};
function setDriverLUT(level){
  if(!gl||!window._driverLUTTex) return;
  if(level === 0 || !DRIVER_LUTS[level]){
    // OFF — reset to identity
    var id=new Uint8Array(256*4);
    for(var i=0;i<256;i++){id[i*4]=i;id[i*4+1]=i;id[i*4+2]=i;id[i*4+3]=255;}
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D,window._driverLUTTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,1,0,gl.RGBA,gl.UNSIGNED_BYTE,id);
    gl.uniform1f(locs.u_useDriverLUT,0.0);
    window._driverLUTData=null;
  } else {
    var lut=DRIVER_LUTS[level];
    var rgba=new Uint8Array(256*4);
    for(var i=0;i<256;i++){rgba[i*4]=lut[i];rgba[i*4+1]=lut[i];rgba[i*4+2]=lut[i];rgba[i*4+3]=255;}
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D,window._driverLUTTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,1,0,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
    gl.uniform1f(locs.u_useDriverLUT,1.0);
    window._driverLUTData=new Uint8Array(lut);
  }
  // Highlight active button
  document.querySelectorAll('.dlBtn').forEach(function(b){
    var bv=parseInt(b.dataset.dl);
    b.style.background=(bv===level)?'var(--accent,#e44)':'';
    b.style.color=(bv===level)?'#fff':'';
  });
  markDirty();
}

// --- Namespace exports ---
R.initGL = initGL;
R.setRenderUniforms = setRenderUniforms;
R.render = render;
R.swapSrcTextures = swapSrcTextures;
R.onVideoFrame = onVideoFrame;
R.uploadToneCurve = uploadToneCurve;
R.resetToneCurveGPU = resetToneCurve;
R.setDriverLUT = setDriverLUT;

// ─── Pipeline debug toggles ───
function setDbgToggle(name, on){
  if(!gl||!locs[name]) return;
  gl.uniform1f(locs[name], on ? 1.0 : 0.0);
  markDirty();
}
R.setDbgToggle = setDbgToggle;

function setFixedCov(val){
  if(!gl||!locs['u_dbgFixedCov']) return;
  gl.uniform1f(locs['u_dbgFixedCov'], val);
  // highlight active button
  document.querySelectorAll('.fcBtn').forEach(b=>{
    const bv = parseFloat(b.dataset.cov);
    b.style.background = (Math.abs(bv - val) < 0.001) ? 'var(--accent,#e44)' : '';
    b.style.color = (Math.abs(bv - val) < 0.001) ? '#fff' : '';
  });
  markDirty();
}
R.setFixedCov = setFixedCov;

function setDitherMode(mode){
  if(!gl||!locs['u_ditherMode']) return;
  gl.uniform1i(locs['u_ditherMode'], mode);
  document.querySelectorAll('.dmBtn').forEach(b=>{
    const bm = parseInt(b.dataset.dm);
    b.style.background = (bm === mode) ? 'var(--accent,#e44)' : '';
    b.style.color = (bm === mode) ? '#fff' : '';
  });
  // Grain Touch (mode 7): GPU V&C blue-noise threshold path.
  // No JS pre-pass — the shader does projection × tone curve × threshold
  // entirely on the GPU each frame. u_useAmt is the gate for the V&C branch
  // inside risoMatrixDither().
  if(locs.u_useAmt) gl.uniform1f(locs.u_useAmt, mode === 7 ? 1.0 : 0.0);
  markDirty();
}
R.setDitherMode = setDitherMode;

// ─────────────────────────────────────────────────────────────────────────────
// AMT pre-pass — per-channel halftone, RISO Grain Touch algorithm.
// For each active ink, projects source RGB onto the paper→ink color axis
// to get that channel's coverage map, then runs FS error diffusion + tone
// curve to produce a 1-bit master. Each master uploaded to its own texture
// slot so inks can deposit at independent positions (matching real RISO).
// ─────────────────────────────────────────────────────────────────────────────
// Yield to the browser event loop so the UI can repaint. Using setTimeout
// (not rAF) because rAF callbacks only fire after a paint frame, which can't
// happen while we're CPU-bound — leading to deadlock on busy prepasses.
// setTimeout's 4ms clamp is enough for a paint to slot in.
function _yield(){ return new Promise(r => setTimeout(r, 0)); }

// ─── T3-F: cal-LUT worker — bakes per-ink coverage→color curve to texture ──
// Runs once per palette change (4 inks × 256 samples = 4 KB texture).
// Async bake is cheap enough that we could do it on the main thread, but
// using a worker keeps any future per-call expansion cost off main too.
let _calLutWorker = null;
let _calLutWorkerNextId = 0;
let _calLutWorkerPending = new Map();
function _initCalLutWorker(){
  if (_calLutWorker || typeof Worker === 'undefined') return;
  _calLutWorker = new Worker('js/cal-lut-worker.js?v=1');
  _calLutWorker.onmessage = function(e){
    const { id, lut } = e.data;
    const resolver = _calLutWorkerPending.get(id);
    if (!resolver) return;
    _calLutWorkerPending.delete(id);
    resolver(new Uint8Array(lut));
  };
  _calLutWorker.onerror = function(e){
    console.warn('[CalLut worker] error:', e.message);
    _calLutWorker = null;
    // Drop stranded in-flight bakes — their callbacks will never fire now —
    // and reset the cache key so the next bakeCalLutIfNeeded call re-bakes
    // (via the sync fallback, since the worker is gone) instead of leaving
    // the stale/seed LUT in place.
    _calLutWorkerPending.clear();
    window._calLutLastKey = '';
  };
}

// Build cache key from current active layer order + ink identity. Recomputes
// only when the key changes — cheap to call every frame from setRenderUniforms.
function _calLutKey(layers){
  let k = '';
  for (let i = 0; i < 4; i++) {
    k += (i < layers.length ? layers[i].color : '_') + '|';
  }
  return k;
}

// Bake the per-ink LUT texture when palette has changed.
// Falls back to a synchronous bake if the worker is unavailable.
function bakeCalLutIfNeeded(layers){
  if (!window._calLutTex || !locs.u_calLutTex) return;
  const key = _calLutKey(layers);
  if (key === window._calLutLastKey) return;
  window._calLutLastKey = key;

  // Build ink-data array — paper + 5 swatch points per active ink.
  // u_paper is 0.910,0.912,0.908 (matches setRenderUniforms uniform).
  const PAPER = [0.910, 0.912, 0.908];
  const inks = [];
  for (let i = 0; i < Math.min(4, layers.length); i++) {
    const cal = (typeof RISO_CAL !== 'undefined') ? RISO_CAL[layers[i].color] : null;
    if (cal && cal.lut) {
      const lt = cal.lut;
      inks.push({
        paper: PAPER,
        p10:  lt[0], p30: lt[1], p50: lt[2], p70: lt[3], p100: lt[4],
      });
    } else {
      // Unknown ink — treat as paper (no-op row)
      inks.push({ paper: PAPER, p10: PAPER, p30: PAPER, p50: PAPER, p70: PAPER, p100: PAPER });
    }
  }
  if (_calLutWorker) {
    const id = _calLutWorkerNextId++;
    _calLutWorkerPending.set(id, (data) => _uploadCalLut(data));
    _calLutWorker.postMessage({ id, inks });
  } else {
    // Sync fallback — inline the same Hermite logic the worker uses.
    _uploadCalLut(_bakeCalLutSync(inks));
  }
}

function _uploadCalLut(data){
  if (!window._calLutTex) return;
  gl.activeTexture(gl.TEXTURE14);
  gl.bindTexture(gl.TEXTURE_2D, window._calLutTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  // Restore TEXTURE0 binding so subsequent makeSrcTex calls don't pollute unit 14.
  gl.activeTexture(gl.TEXTURE0);
}

function _bakeCalLutSync(inks){
  // Mirrors cal-lut-worker.js — kept here as a fallback for environments
  // where Worker creation fails.
  function tan1(s0, s1, h0, h1){
    if (s0 * s1 <= 0) return 0;
    return 3 * (h0 + h1) / ((2*h1 + h0)/s0 + (h0 + 2*h1)/s1);
  }
  function mt(v0, v1, v2, h0, h1){
    const a = [(v1[0]-v0[0])/h0, (v1[1]-v0[1])/h0, (v1[2]-v0[2])/h0];
    const b = [(v2[0]-v1[0])/h1, (v2[1]-v1[1])/h1, (v2[2]-v1[2])/h1];
    return [tan1(a[0],b[0],h0,h1), tan1(a[1],b[1],h0,h1), tan1(a[2],b[2],h0,h1)];
  }
  function ch(p0,p1,m0,m1,t,h){
    const t2=t*t,t3=t2*t,h00=2*t3-3*t2+1,h10=(t3-2*t2+t)*h,h01=-2*t3+3*t2,h11=(t3-t2)*h;
    return [h00*p0[0]+h10*m0[0]+h01*p1[0]+h11*m1[0],
            h00*p0[1]+h10*m0[1]+h01*p1[1]+h11*m1[1],
            h00*p0[2]+h10*m0[2]+h01*p1[2]+h11*m1[2]];
  }
  function lb(d, paper, p10, p30, p50, p70, p100){
    if (d < 0) d = 0; else if (d > 1) d = 1;
    const m0=[(p10[0]-paper[0])/0.10,(p10[1]-paper[1])/0.10,(p10[2]-paper[2])/0.10];
    const m5=[(p100[0]-p70[0])/0.30,(p100[1]-p70[1])/0.30,(p100[2]-p70[2])/0.30];
    const m1=mt(paper,p10,p30,0.10,0.20);
    const m2=mt(p10,p30,p50,0.20,0.20);
    const m3=mt(p30,p50,p70,0.20,0.20);
    const m4=mt(p50,p70,p100,0.20,0.30);
    if(d<0.10) return ch(paper,p10,m0,m1,d/0.10,0.10);
    if(d<0.30) return ch(p10,p30,m1,m2,(d-0.10)/0.20,0.20);
    if(d<0.50) return ch(p30,p50,m2,m3,(d-0.30)/0.20,0.20);
    if(d<0.70) return ch(p50,p70,m3,m4,(d-0.50)/0.20,0.20);
    return ch(p70,p100,m4,m5,(d-0.70)/0.30,0.30);
  }
  const data = new Uint8Array(4*256*4);
  function c255(v){v=Math.round(v*255);return v<0?0:(v>255?255:v);}
  for (let li=0; li<4; li++){
    const ink = li<inks.length ? inks[li] : null;
    if (!ink) {
      for (let i=0; i<256; i++){
        const o=(li*256+i)*4; data[o]=232; data[o+1]=232; data[o+2]=232; data[o+3]=255;
      }
      continue;
    }
    for (let i=0; i<256; i++){
      const rgb = lb(i/255, ink.paper, ink.p10, ink.p30, ink.p50, ink.p70, ink.p100);
      const o=(li*256+i)*4;
      data[o]=c255(rgb[0]); data[o+1]=c255(rgb[1]); data[o+2]=c255(rgb[2]); data[o+3]=255;
    }
  }
  return data;
}

// ─── Web Worker for AMT FS — keeps main thread free for animations ─────────
// Falls back to synchronous runAmt on the main thread if Worker fails.
//
// (B) WORKER POOL: the 4 ink channels are fully independent FS passes, but
// they used to run one-at-a-time through a single worker (serial). A pool of
// N workers (N = cores, capped at 4 = max channels) lets all active channels'
// FS run concurrently → up to ~4× wall-clock on the prepass with bit-identical
// output. Jobs round-robin across the pool; a shared pending map keys results
// by a global job id, so any worker can satisfy any job.
let _amtWorkerPool = [];
let _amtWorkerPending = new Map();
let _amtWorkerNextId = 0;
let _amtWorkerRR = 0;
// Pool sized to physical parallelism (was capped at 4): with band-parallel FS
// every core gets a band, so the cap is the limiter. Leave 2 cores for the
// main thread + compositor, cap at 8 (diminishing returns past that).
const _AMT_POOL_SIZE = Math.max(2, Math.min(8, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4) - 2));
function _initAmtWorker(){
  if (_amtWorkerPool.length || typeof Worker === 'undefined') return;
  try {
    for (let i = 0; i < _AMT_POOL_SIZE; i++) {
      const w = new Worker('js/riso-amt-worker.js?v=4');
      w.onmessage = function(e){
        const { id, plane, error, on, outH } = e.data;
        const resolver = _amtWorkerPending.get(id);
        if (!resolver) return;
        _amtWorkerPending.delete(id);
        if (error) resolver.reject(new Error(error));
        else       resolver.resolve({ plane: new Uint8Array(plane), on: on || 0, outH: outH });
      };
      w.onerror = function(e){
        console.warn('[RisoAmt worker] error:', e.message);
        // Reject every in-flight job so Promise.all in the prepass can't hang
        // forever (which would wedge _amtPrepassRunning and block all future
        // prepasses). The next prepass re-dispatches cleanly.
        for (const [id, resolver] of _amtWorkerPending) {
          try { resolver.reject(new Error('worker error: ' + (e.message || 'unknown'))); } catch(_){}
          _amtWorkerPending.delete(id);
        }
      };
      _amtWorkerPool.push(w);
    }
    console.log(`[RisoAmt] worker pool initialized — ${_amtWorkerPool.length} workers (FS runs off-main-thread, channels in parallel)`);
  } catch (e) {
    console.warn('[RisoAmt] Worker pool init failed, falling back to sync:', e);
    _amtWorkerPool = [];
  }
}

// Async wrapper: runs runAmt() + bit unpack (+ optional ink-spread blur) inside
// a pool worker so the main thread stays free for animations. Returns the plane
// (W*H Uint8Array, 0..255 ink density) ready to pack into RGBA and upload.
// sigma <= 0 skips the CPU ink-spread blur (D: spread is applied on the GPU in
// the master-sampling loop instead — saves the per-channel blur entirely).
// Falls back to synchronous main-thread path if the pool is unavailable.
// Band-aware: `input` is a fresh slice copy (transferred zero-copy to the
// worker — the old extra defensive copy is gone). globalRowOffset/discardRows
// implement the warm-up-band protocol (see riso-amt-worker.js). Resolves
// { plane, on, outH } where plane excludes the warm-up rows.
function runAmtAsync(input, W, sliceH, opts, sigma, globalRowOffset, discardRows){
  if (!_amtWorkerPool.length) {
    const runOpts = Object.assign({}, opts, { globalRowOffset: globalRowOffset || 0 });
    const bits = window.RisoAmt.runAmt(input, W, sliceH, runOpts);
    const skip = Math.max(0, discardRows | 0);
    const outH = sliceH - skip;
    const plane = new Uint8Array(W * outH);
    let on = 0;
    for (let i = skip * W, j = 0; j < W * outH; i++, j++) {
      const bit = (bits[i >> 3] >> (7 - (i & 7))) & 1;
      if (bit) { plane[j] = 255; on++; }
    }
    const blurred = (sigma > 0.01) ? gaussianBlurPlane(plane, W, outH, sigma) : plane;
    return Promise.resolve({ plane: blurred, on: on, outH: outH });
  }
  return new Promise((resolve, reject) => {
    const id = _amtWorkerNextId++;
    _amtWorkerPending.set(id, { resolve, reject });
    const w = _amtWorkerPool[(_amtWorkerRR++) % _amtWorkerPool.length];
    w.postMessage(
      { id, input: input.buffer, W, H: sliceH, opts, sigma,
        globalRowOffset: globalRowOffset || 0, discardRows: discardRows | 0 },
      [input.buffer]
    );
  });
}

// AMT prepass is async — heavy CPU loops + GPU FS would otherwise block the
// UI thread for several seconds. We yield between channels so the browser can
// repaint (showing the user a "processing" indicator, accepting clicks, etc.)
// and so the active rAF loop can continue rendering the previous masters.
async function runAmtPrepass(){
  if(!gl || !window.RisoAmt || !window._amtMasterTex){
    console.warn('[RisoAmt] prerequisites missing');
    return;
  }
  // Re-entrant guard: if a prepass is already running, ignore this call.
  if (window._amtPrepassRunning) {
    console.log('[RisoAmt] prepass already running, skipping duplicate');
    return;
  }
  window._amtPrepassRunning = true;
  // Capture the staleness token at start. invalidateAmt() bumps _amtSeq on every
  // source/ink/mode change; if it advances while this prepass is in flight, the
  // master we're baking is for an OLD source — so requeue a fresh prepass in the
  // finally. Without this, a second upload arriving mid-prepass gets dropped by
  // the re-entry guard and the FIRST image's halftone composites over it.
  const startSeq = window._amtSeq || 0;
  try {
    await _runAmtPrepassImpl();
  } catch(e) {
    console.error('[RisoAmt] prepass failed:', e);
  } finally {
    window._amtPrepassRunning = false;
    // The render loop was bailing on _amtPrepassRunning=true; now that it's
    // false, schedule a fresh draw so the canvas updates with the new masters.
    try { markDirty(); } catch(e) {}
    try { scheduleRender(); } catch(e) {}
    // Source/ink/mode changed during the bake → this master is stale. Re-run —
    // but only if we're still in RISO mode; switching away mid-bake would
    // otherwise trigger one full wasted rebake.
    if ((window._amtSeq || 0) !== startSeq && window._mode === 'flat') {
      console.log('[RisoAmt] source changed during prepass — requeuing');
      setTimeout(runAmtPrepass, 0);
    }
  }
}

async function _runAmtPrepassImpl(){
  // Live source detection: RISO mode is static-only. With a live source (camera
  // or video element), running prepass once would give a snapshot dither pattern
  // that quickly goes stale, causing the "old pattern overlaid on new frame" bug.
  // Detect this and skip the prepass — the shader falls back to per-fragment
  // dither mode when u_useAmt = 0.
  const camActive = (typeof camOn !== 'undefined' && camOn);
  const videoActive = (typeof videoOn !== 'undefined' && videoOn);
  if (camActive || videoActive) {
    console.log('[RisoAmt] skipping prepass — live source (camera/video), using shader fallback');
    try { gl.uniform1f(locs.u_useAmt, 0.0); } catch(e) {}
    return;
  }
  // Show a small toast/indicator if available
  try { R.toast && R.toast('RISO: rendering halftone…', 99999); } catch(e){}
  // Locate source — srcImg is at script-global scope (let in state.js)
  const candidates = [
    ['srcImg',            (typeof srcImg !== 'undefined') ? srcImg : null],
    ['_lastSourceCanvas', window._lastSourceCanvas]
  ];
  let srcCanvas = null, srcLabel = '';
  for(const [name, c] of candidates){
    if(c && c.width && c.height){ srcCanvas = c; srcLabel = name; break; }
  }
  if(!srcCanvas){
    console.warn('[RisoAmt] no source — fallback to per-fragment matrix.');
    gl.uniform1f(locs.u_useAmt, 0.0);
    return;
  }

  // Pick AMT resolution based on a simulated "scan DPI" of an A3 print.
  // Decouples halftone resolution from source image resolution so the dot
  // size is physically meaningful regardless of how big/small the upload is.
  //   75 dpi  → 1240 px max edge   (fastest preview, ~1-2s prepass)
  //   150 dpi → 2481 px max edge   (medium quality, ~6s for 4-color)
  //   300 dpi → 4961 px max edge   (high-res scan; ~25s for 4-color)
  //   600 dpi → 9921 px max edge   (DEFAULT — matches real RISO native res; ~100s for 4-color)
  // Set via console:  R.setAmtScanDpi(300)
  // Default raised to 600 so the preview matches the real printed output
  // at the device's native resolution. Lower it for faster iteration.
  const scanDpi = window._amtScanDpi || 600;
  const A3_LONG_INCHES = 16.54;
  const targetMaxEdge = Math.round(scanDpi * A3_LONG_INCHES);
  const sourceAspect = srcCanvas.width / srcCanvas.height;
  let W, H;
  if(sourceAspect >= 1){ W = targetMaxEdge; H = Math.round(targetMaxEdge / sourceAspect); }
  else                 { H = targetMaxEdge; W = Math.round(targetMaxEdge * sourceAspect); }

  let tmp = window._amtScratch;
  if(!tmp){ tmp = document.createElement('canvas'); window._amtScratch = tmp; }
  tmp.width = W; tmp.height = H;
  const tctx = tmp.getContext('2d');
  tctx.imageSmoothingEnabled = true;
  tctx.imageSmoothingQuality = 'high';
  try { tctx.drawImage(srcCanvas, 0, 0, W, H); }
  catch(e){ gl.uniform1f(locs.u_useAmt, 0.0); return; }
  const src = tctx.getImageData(0, 0, W, H).data;
  console.log(`[RisoAmt] AMT@${scanDpi}dpi → ${W}×${H} (source was ${srcCanvas.width}×${srcCanvas.height})`);
  // Pixels now live in `src` — release the full-size scratch backing
  // (~278 MB at 600 dpi) instead of pinning it for the whole session.
  // The next prepass sets width/height again anyway.
  tmp.width = tmp.height = 1;

  // Get ink colors + paper color from risocam state. cached.inkRGB is [4][3]
  // floats in 0..1. cached.paperColor is [3] floats in 0..1.
  const inkRGB = (typeof cached !== 'undefined' && cached.inkRGB) ? cached.inkRGB : [[0,0,0],[0,0,0],[0,0,0],[0,0,0]];
  const paperRGB = (typeof cached !== 'undefined' && cached.paperColor) ? cached.paperColor : [0.96, 0.94, 0.91];
  const activeChans = (typeof channels !== 'undefined') ? channels.map((c,i)=>c?i:-1).filter(i=>i>=0) : [0];
  if(activeChans.length === 0){
    console.warn('[RisoAmt] no active channels');
    gl.uniform1f(locs.u_useAmt, 0.0);
    return;
  }
  console.log('[RisoAmt] source', W+'x'+H, 'active channels:', activeChans);

  const t0 = performance.now();
  // RISO params (live from sliders / R.setRisoParams):
  //   _riso_maxCoverage: coverage scale. 1.7 (default) is the realistic look —
  //     pushes mid-tones to proper RISO density while leaving enough gaps in
  //     solid blacks for the paper texture to show through (paper threads
  //     visible = THE thing that makes RISO blacks look alive). 1.0 caps
  //     tighter (~46% solid-black). 2.2 saturates (no paper threads).
  //   _riso_thresholdNoise: per-pixel jitter on FS threshold to break
  //     sawtooth artifact at high-contrast edges. 0..0.15 typical.
  const _runOpts = {
    coverageScale: (typeof window._riso_maxCoverage === 'number') ? window._riso_maxCoverage : 1.7,
    thresholdNoise: (typeof window._riso_thresholdNoise === 'number') ? window._riso_thresholdNoise : 0.0,
  };

  await _yield(); await _yield();

  // ── (#4) FULL-GPU PREPASS (experimental, window._amtWebGPU = true) ──
  // The ENTIRE chain — paper→ink projection, tone curve, solid fill, wavefront
  // FS — runs as WebGPU compute from one RGBA upload. The main thread does no
  // per-pixel math (the old serial projection pass is skipped entirely).
  // Raster scan order (a wavefront can't serpentine); Tables A/B/C mask most
  // of the directional difference — A/B before finals. WebGL2-only (the
  // strided upload needs UNPACK_ROW_LENGTH). Falls back to the CPU band path
  // on any failure.
  if (window._amtWebGPU && window.RisoAmtGPU && (window._amtMasterFmt || {}).channels === 1) {
    try {
      const okGpu = await window.RisoAmtGPU.ready();
      if (okGpu) {
        const _mfG = window._amtMasterFmt;
        const PRg = paperRGB[0]*255, PGg = paperRGB[1]*255, PBg = paperRGB[2]*255;
        const chans = [];
        for (let chIdx = 0; chIdx < 4; chIdx++) {
          if (!activeChans.includes(chIdx)) continue;
          const ink = inkRGB[chIdx];
          const IR = ink[0]*255, IG = ink[1]*255, IB = ink[2]*255;
          const dr = IR-PRg, dg = IG-PGg, db = IB-PBg;
          if (dr*dr + dg*dg + db*db < 0.5) {
            // Ink ≈ paper — bind 1×1 dummy, skip (same as the CPU path).
            gl.activeTexture(gl.TEXTURE9 + chIdx);
            gl.bindTexture(gl.TEXTURE_2D, window._amtMasterTex[chIdx]);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.texImage2D(gl.TEXTURE_2D, 0, _mfG.internal, 1, 1, 0, _mfG.format, gl.UNSIGNED_BYTE, new Uint8Array([0]));
            continue;
          }
          chans.push({ chIdx: chIdx, ink: [IR, IG, IB], paper: [PRg, PGg, PBg] });
        }
        if (chans.length) {
          // Shader sampling params (normally set just before the CPU dispatch).
          const inkSpreadG = window._inkSpread != null ? window._inkSpread : 0.5;
          if (locs.u_amtTexel) gl.uniform2f(locs.u_amtTexel, 1.0 / W, 1.0 / H);
          if (locs.u_amtInkSpread) gl.uniform1f(locs.u_amtInkSpread, (window._gpuInkSpread ?? true) ? inkSpreadG : 0.0);
          const D = window.RisoAmt.DEFAULTS;
          const res = await window.RisoAmtGPU.runChannelsFromRGBA(src, W, H, chans, {
            coverageScale: _runOpts.coverageScale,
            solidFillThreshold: D.solidFillThreshold,
            solidFillRadius: (typeof D.solidFillRadius === 'number') ? D.solidFillRadius : 5,
            solidFillStrength: (typeof D.solidFillStrength === 'number') ? D.solidFillStrength : 1.0,
          });
          for (const r of res) {
            gl.activeTexture(gl.TEXTURE9 + r.chIdx);
            gl.bindTexture(gl.TEXTURE_2D, window._amtMasterTex[r.chIdx]);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.pixelStorei(gl.UNPACK_ROW_LENGTH, r.strideW);
            gl.texImage2D(gl.TEXTURE_2D, 0, _mfG.internal, W, H, 0, _mfG.format, gl.UNSIGNED_BYTE, r.plane);
            gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
          }
        }
        const totalMsG = performance.now() - t0;
        console.log(`[RisoAmt] all channels done in ${totalMsG.toFixed(0)} ms (WebGPU full pipeline: projection+solidfill+FS on GPU)`);
        gl.uniform1f(locs.u_useAmt, 1.0);
        markDirty();
        try { R.toast && R.toast('RISO ready (GPU)', 1200); } catch(e){}
        return;
      }
    } catch (e) {
      console.warn('[RisoAmt] WebGPU path failed, falling back to CPU:', e.message || e);
    }
  }

  // ── PASS 1: Project source RGB onto each channel's paper→ink direction ──
  // Produces 4 inputGray buffers (or null for inactive channels).
  const tProj0 = performance.now();
  const PR = paperRGB[0]*255, PG = paperRGB[1]*255, PB = paperRGB[2]*255;
  const inputGrays = [null, null, null, null];
  const channelMeta = [];
  for(let chIdx = 0; chIdx < 4; chIdx++){
    if(!activeChans.includes(chIdx)){ channelMeta.push(null); continue; }
    const ink = inkRGB[chIdx];
    const IR = ink[0]*255, IG = ink[1]*255, IB = ink[2]*255;
    const dr = IR - PR, dg = IG - PG, db = IB - PB;
    const dLen2 = dr*dr + dg*dg + db*db;
    if(dLen2 < 0.5){
      // Ink ≈ paper — bind 1×1 dummy, skip dither. Match the master format (A).
      const _mf = window._amtMasterFmt || { internal: gl.RGBA, format: gl.RGBA, channels: 4 };
      const dummy = (_mf.channels === 1) ? new Uint8Array([0]) : new Uint8Array([0,0,0,255]);
      gl.activeTexture(gl.TEXTURE9 + chIdx);
      gl.bindTexture(gl.TEXTURE_2D, window._amtMasterTex[chIdx]);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, _mf.internal, 1, 1, 0, _mf.format, gl.UNSIGNED_BYTE, dummy);
      channelMeta.push(null);
      continue;
    }
    const inputGray = new Uint8Array(W * H);
    for(let i = 0, j = 0; i < src.length; i += 4, j++){
      const vr = src[i] - PR, vg = src[i+1] - PG, vb = src[i+2] - PB;
      let t = (vr*dr + vg*dg + vb*db) / dLen2;
      if(t < 0) t = 0; else if(t > 1) t = 1;
      inputGray[j] = Math.round(255 * (1 - t));
    }
    inputGrays[chIdx] = inputGray;
    channelMeta.push({ink: ink});
  }

  // ── PASS 2+3: Per-channel FS in worker pool (B: all channels concurrent) →
  //              RGBA pack + texture upload on the main thread.
  //
  // (B) All active channels are dispatched to the worker pool at once and
  //     awaited together, so their FS passes run in parallel (~4× wall-clock
  //     vs the old one-at-a-time loop). Bit-identical output.
  //
  // (D) GPU INK-SPREAD: the soft round-dot edge used to come from a per-channel
  //     CPU Gaussian blur of the bit-plane (~1.2s/channel at 600 dpi — the
  //     single biggest prepass cost). When _gpuInkSpread is on we pass sigma=0
  //     so the worker returns the RAW binary plane, and the spread is applied
  //     for free in the shader's master-sampling loop (wider sample radius +
  //     more taps → averages neighbouring binary cells into a soft edge). The
  //     master textures stay binary (NEAREST), preserving FS character.
  const tProj = performance.now() - tProj0;
  const gpuSpread = (window._gpuInkSpread ?? true);
  const inkSpread = window._inkSpread != null ? window._inkSpread : 0.5;
  const sigma = gpuSpread ? 0 : inkSpread;
  const tPar0 = performance.now();
  // Tell the shader the master texel size + ink-spread radius (in texels) so
  // its supersampling footprint reproduces the soft dot edge on the GPU.
  if(locs.u_amtTexel) gl.uniform2f(locs.u_amtTexel, 1.0 / W, 1.0 / H);
  if(locs.u_amtInkSpread) gl.uniform1f(locs.u_amtInkSpread, gpuSpread ? inkSpread : 0.0);

  // (#3) BAND-PARALLEL FS: each channel splits into K horizontal bands that
  // dither concurrently across the pool, so all cores work even on a 1-2 color
  // job. Each band re-runs WARMUP rows above its slice (dithered, discarded) to
  // build realistic FS error state — ED error memory decays in ~10-20 rows, so
  // seams are statistically invisible; serpentine parity + the Table-A column
  // counter are seeded per band (globalRowOffset) to match a full-image scan.
  // Set window._amtBands = 1 to force the old single-band (bit-exact) path.
  //
  // (#5) The master texture is allocated ONCE at full size (texImage2D null),
  // then each band lands via texSubImage2D as its worker resolves — uploads
  // overlap the still-running FS of other bands, and on WebGL2/R8 the worker
  // plane IS the texel data (no pack).
  const WARMUP = 32;
  const numActive = channelMeta.filter(Boolean).length;
  const poolN = Math.max(1, _amtWorkerPool.length || 1);
  let K = (window._amtBands | 0) > 0 ? (window._amtBands | 0)
        : Math.max(1, Math.round(poolN / Math.max(1, numActive)));
  K = Math.max(1, Math.min(K, Math.floor(H / 256) || 1)); // keep bands ≥ ~256 rows
  const _mf = window._amtMasterFmt || { internal: gl.RGBA, format: gl.RGBA, channels: 4 };
  const jobs = [];
  const chOn = [0, 0, 0, 0];
  for(let chIdx = 0; chIdx < 4; chIdx++){
    const meta = channelMeta[chIdx];
    if(!meta) continue;
    // Allocate the full-size master now; bands fill it in as they finish.
    gl.activeTexture(gl.TEXTURE9 + chIdx);
    gl.bindTexture(gl.TEXTURE_2D, window._amtMasterTex[chIdx]);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); // R8 rows aren't 4-byte aligned
    gl.texImage2D(gl.TEXTURE_2D, 0, _mf.internal, W, H, 0, _mf.format, gl.UNSIGNED_BYTE, null);
    const inputGray = inputGrays[chIdx];
    for(let b = 0; b < K; b++){
      const y0 = Math.floor(H * b / K), y1 = Math.floor(H * (b + 1) / K);
      const warm = Math.min(WARMUP, y0);
      // slice() = fresh copy → transferable to the worker zero-copy.
      const slice = inputGray.slice((y0 - warm) * W, y1 * W);
      const bandH = y1 - y0;
      const job = runAmtAsync(slice, W, y1 - (y0 - warm), _runOpts, sigma, y0 - warm, warm)
        .then(res => {
          chOn[chIdx] += res.on;
          let data = res.plane; // R8: one byte per pixel, exactly the plane
          if(_mf.channels !== 1){
            data = new Uint8Array(W * bandH * 4);
            for(let i = 0; i < W * bandH; i++){
              const v = res.plane[i];
              data[i*4] = v; data[i*4+1] = v; data[i*4+2] = v; data[i*4+3] = 255;
            }
          }
          gl.activeTexture(gl.TEXTURE9 + chIdx);
          gl.bindTexture(gl.TEXTURE_2D, window._amtMasterTex[chIdx]);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, W, bandH, _mf.format, gl.UNSIGNED_BYTE, data);
        });
      jobs.push(job);
    }
  }
  await Promise.all(jobs);
  for(let chIdx = 0; chIdx < 4; chIdx++){
    const meta = channelMeta[chIdx];
    if(!meta) continue;
    const ink = meta.ink;
    const cov = (chOn[chIdx] / (W * H) * 100);
    console.log(`[RisoAmt]   ch${chIdx} ink RGB(${(ink[0]*255)|0},${(ink[1]*255)|0},${(ink[2]*255)|0}) → cov ${cov.toFixed(1)}%`);
  }
  const tPar = performance.now() - tPar0;
  const totalMs = performance.now() - t0;
  console.log(`[RisoAmt] all channels done in ${totalMs.toFixed(0)} ms (pool=${_amtWorkerPool.length}, bands/ch=${K}, gpuSpread=${gpuSpread}) — projection(main,serial) ${tProj.toFixed(0)}ms, FS+pack+upload(parallel) ${tPar.toFixed(0)}ms`);
  gl.uniform1f(locs.u_useAmt, 1.0);
  markDirty();
  try { R.toast && R.toast('RISO ready', 1200); } catch(e){}
}
R.runAmtPrepass = runAmtPrepass;
// Drops the cached AMT halftone masters. Critical: also flips u_useAmt → 0
// so the shader stops sampling the now-stale per-channel master textures
// while the next prepass is in flight (and at 600 dpi the in-flight window
// can be ~100s). Without this the previous image's halftone composites on
// top of the new source = "ghost overlay" bug on every fresh upload.
R.invalidateAmt = function(){
  window._amtSeq = (window._amtSeq||0) + 1;
  try {
    if (gl && locs && locs.u_useAmt) {
      gl.uniform1f(locs.u_useAmt, 0.0);
    }
  } catch(e) {}
  try { markDirty(); } catch(e) {}
};
R.setAmtScanDpi = function(dpi){
  window._amtScanDpi = Math.max(50, Math.min(1200, dpi|0));
  console.log('[RisoAmt] scan DPI =', window._amtScanDpi, '(re-run dither mode to apply)');
  R.invalidateAmt();
};
// Experimental: run the FS master on the GPU (WebGPU wavefront ED). Raster
// scan order (not serpentine) — A/B visually before using for finals.
// ASCII stamp: include Georgian Mkhedruli in the glyph pool (English-only by
// default while testing). Drops the atlas so it rebuilds on the next frame.
// (Legacy console toggle — the settings chip uses cycleAsciiCharset below.)
R.setAsciiGeorgian = function(on){
  window._asciiGeorgian = !!on;
  window._asciiCharset = on ? 2 : 0;
  window._glyphAtlasTex = null;
  try { markDirty(); } catch(e) {}
};

// ASCII charset chip: Latin → Georgian → mixed. Atlas rebuilds next frame.
R.cycleAsciiCharset = function(){
  window._asciiCharset = ((window._asciiCharset || 0) + 1) % 3;
  window._glyphAtlasTex = null;
  try { markDirty(); } catch(e) {}
  const el = document.getElementById('asciiCharsetVal');
  if(el) el.textContent = ['ABC', 'აბგ', 'A+ა'][window._asciiCharset];
  return window._asciiCharset;
};

// ASCII custom font: load an uploaded TTF/OTF/WOFF via the FontFace API and
// rebuild the glyph atlas with it. Missing glyphs fall back per-character to
// the system stack (so a display font with no Georgian still renders GEO
// mode). Session-scoped — fonts are not persisted.
R.uploadAsciiFont = function(file){
  if(!file) return;
  file.arrayBuffer().then(function(buf){
    const face = new FontFace('RisocamAscii', buf);
    return face.load().then(function(loaded){
      if(window._asciiFontFace){ try { document.fonts.delete(window._asciiFontFace); } catch(e){} }
      document.fonts.add(loaded);
      window._asciiFontFace = loaded;
      window._asciiFontFamily = 'RisocamAscii';
      window._asciiFontName = (file.name || 'custom').replace(/\.[^.]+$/, '');
      window._glyphAtlasTex = null;
      try { markDirty(); } catch(e){}
      const el = document.getElementById('asciiFontVal');
      if(el) el.textContent = window._asciiFontName.slice(0, 9);
      R.toast && R.toast('ASCII font: ' + window._asciiFontName);
    });
  }).catch(function(e){
    console.warn('[asciiFont] load failed', e);
    R.toast && R.toast('Font load failed');
  });
};
R.resetAsciiFont = function(){
  if(window._asciiFontFace){ try { document.fonts.delete(window._asciiFontFace); } catch(e){} }
  window._asciiFontFace = null;
  window._asciiFontFamily = null;
  window._asciiFontName = null;
  window._glyphAtlasTex = null;
  try { markDirty(); } catch(e){}
  const el = document.getElementById('asciiFontVal');
  if(el) el.textContent = 'Aa';
};
// Font chip click: no custom font → open the picker; custom active → reset.
R.asciiFontClick = function(){
  if(window._asciiFontFamily){ R.resetAsciiFont(); R.toast && R.toast('ASCII font: default'); }
  else { const inp = document.getElementById('asciiFontFile'); if(inp){ inp.value = ''; inp.click(); } }
};
R.setAmtWebGPU = function(on){
  window._amtWebGPU = !!on;
  console.log('[RisoAmt] WebGPU wavefront ED', window._amtWebGPU ? 'ON (experimental)' : 'OFF');
  R.invalidateAmt();
  if(window._mode === 'flat' && R.runAmtPrepass) setTimeout(R.runAmtPrepass, 0);
};

// Toggle LCG threshold modulation in driver-faithful FS:
//   ON  (default): driver-faithful = LCG random sub-pixel offsets (Tables A/B/C)
//                  → stochastic dot placement, authentic "Grain Touch" character
//   OFF: plain serpentine 7/3/5/1 FS (still uses the empirical tone curve)
//        → clean orderly FS dot patterns, no LCG-induced noise, similar to
//        what you'd get from ImageMagick or Photoshop's FS dither.
R.setLcgModulation = function(on){
  if(!window.RisoAmt || !window.RisoAmt.DEFAULTS) return;
  window.RisoAmt.DEFAULTS.driverFaithful = !!on;
  console.log('[RisoAmt] LCG modulation:', on ? 'ON (driver-faithful)' : 'OFF (plain FS)');
  R.invalidateAmt();
  if(window._mode === 'flat' && window.R && window.R.runAmtPrepass){
    setTimeout(window.R.runAmtPrepass, 0);
  }
};

// RISO mode parameters. dpi = master resolution (150 / 300 / 450 / 600);
// inkSpread = gaussian σ in master pixels for soft round dot edges (0..2);
// maxCoverage = scale on tone-curve output (1.0 = empirical default, cap ~46%);
// thresholdNoise = per-pixel jitter on FS threshold (0..0.15) to mitigate
// sawtooth artifacts at high-contrast edges. All re-trigger the prepass.
R.setRisoParams = function(opts){
  opts = opts || {};
  // Track whether any FS-affecting parameter changed. (D) Under GPU ink-spread,
  // inkSpread is a pure shader uniform — it does NOT change the FS master — so
  // adjusting it can update live without re-running the (expensive) prepass.
  let fsAffected = false;
  const gpuSpread = (window._gpuInkSpread ?? true);
  if(typeof opts.dpi === 'number'){
    window._amtScanDpi = Math.max(50, Math.min(1200, opts.dpi|0));
    fsAffected = true;
  }
  if(typeof opts.inkSpread === 'number'){
    window._inkSpread = Math.max(0, Math.min(3, opts.inkSpread));
    if(gpuSpread){
      // Live update — just push the uniform and redraw, no prepass.
      try { if(locs.u_amtInkSpread) gl.uniform1f(locs.u_amtInkSpread, window._inkSpread); } catch(e){}
      try { markDirty(); } catch(e){}
    } else {
      fsAffected = true; // CPU blur path bakes spread into the master
    }
  }
  if(typeof opts.maxCoverage === 'number'){
    window._riso_maxCoverage = Math.max(0, Math.min(4, opts.maxCoverage));
    fsAffected = true;
  }
  if(typeof opts.thresholdNoise === 'number'){
    window._riso_thresholdNoise = Math.max(0, Math.min(0.5, opts.thresholdNoise));
    fsAffected = true;
  }
  if(fsAffected){
    R.invalidateAmt();
    if(window._mode === 'flat' && window.R && window.R.runAmtPrepass){
      setTimeout(window.R.runAmtPrepass, 0);
    }
  }
  return {
    dpi: window._amtScanDpi || 600,
    inkSpread: window._inkSpread != null ? window._inkSpread : 0.5,
    maxCoverage: window._riso_maxCoverage != null ? window._riso_maxCoverage : 1.7,
    thresholdNoise: window._riso_thresholdNoise != null ? window._riso_thresholdNoise : 0.0
  };
};

// Toggle the PBR paper substrate (ambientCG Paper002 — height tooth + normal
// sheen). Default ON. When ON it's the single paper-texture mechanism (the
// legacy procedural/scan pf is neutralised in-shader) and it shows in every
// mode incl. RISO and in exports. Strength follows the paper-texture slider
// (u_paperTex). No prepass needed — pure shader uniform, redraw only.
R.setPaperPBR = function(on){
  window._usePaperPBR = !!on;
  try { if(locs.u_usePaperPBR) gl.uniform1f(locs.u_usePaperPBR, on ? 1.0 : 0.0); } catch(e){}
  try { markDirty(); } catch(e){}
  console.log('[paper] PBR substrate:', on ? 'ON (Paper002)' : 'OFF (legacy pf)');
};

// SCREEN engine toggle: 0 = procedural round-dot (DEFAULT), 1 = RISO matrix
// cross-faded round-dot. Pure uniform — redraw only, no prepass.
// ── Anchor-tone prepasses (tiny lattice-resolution FBO, unit 9) ──
// Two consumers, mutually exclusive by stamp shape:
//  • ASCII (stamp 5, pass 1): per-anchor POINT tone, all plates packed RGBA,
//    shared angle-0 lattice at 2x pitch. Replaces per-fragment ink chains
//    (was ~200ms/frame). Letters keep full size up to content edges.
//  • CIRCLES soft edges (stamp 0, pass 2): per-plate CELL-MEAN tone (16-bit
//    hi/lo in R/G) in a 2x2 quadrant layout — each dot is sized by its
//    cell's average, so hard content edges shrink whole dots, never slice.
// The texture rides unit 9 (u_amtMaster0) — masters are RISO-only.
// Called by the live draw AND by save.js export paths (R._runTonePrepass)
// with the target render dims, so exports match the preview (P5 parity).
// Leaves u_asciiTonePass=0, u_edgeSoft set, viewport restored to (dw, dh).
function _runTonePrepass(dw, dh){
  const _stampNow = (window._stampShape|0);
  const _wantAsciiTone  = mode === 'screen' && _stampNow === 5;
  const _wantCircleTone = mode === 'screen' && _stampNow === 0 && (window._screenEdgeSoft ?? 1);
  if((_wantAsciiTone || _wantCircleTone) && locs.u_asciiTonePass){
    let aMinX, aMinY, aW, aH, texW, texH, passId;
    const corners = [[0,0],[dw,0],[0,dh],[dw,dh]];
    let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
    if(_wantAsciiTone){
      const cellPx = Math.max(1.5, Math.min(dw, dh) / (8.267 * cached.lpi)) * 2.0; // mirrors shader (2x pitch)
      const ang = (layerAngles[0] || 0) * 0.01745329;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      // lattice bounds of the screen quad corners (rotate, /cellPx)
      for(const p of corners){
        const rx = (p[0]*ca - p[1]*sa) / cellPx, ry = (p[0]*sa + p[1]*ca) / cellPx;
        mnx = Math.min(mnx, rx); mny = Math.min(mny, ry);
        mxx = Math.max(mxx, rx); mxy = Math.max(mxy, ry);
      }
      aMinX = Math.floor(mnx) - 3; aMinY = Math.floor(mny) - 3;
      // 3x3 quadrant bake layout (presence / size / 3x2 candidate texels) —
      // lattice capped so texW = 3*aW stays GL-safe at <= 2046.
      aW = Math.min(682, Math.ceil(mxx) - aMinX + 4); aH = Math.min(682, Math.ceil(mxy) - aMinY + 4);
      texW = aW * 3; texH = aH * 3; passId = 1.0;
    } else {
      // Shared lattice bounds over ALL plate angles (the four quadrants share
      // u_aMin/u_aDims). Pitch floors at the dot cell and rises if the lattice
      // would overflow 1018/side (texture = 2x2 quadrants, 2048 GL-safe) —
      // at that density cells are ~2px and per-cell tone is invisible anyway.
      const cellBase = Math.max(1.5, Math.min(dw, dh) / (8.267 * cached.lpi)); // free pitch (matches u_screenCell)
      for(let li = 0; li < 4; li++){
        const ang = (layerAngles[li] || 0) * 0.01745329;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        for(const p of corners){
          const rx = p[0]*ca - p[1]*sa, ry = p[0]*sa + p[1]*ca;
          mnx = Math.min(mnx, rx); mny = Math.min(mny, ry);
          mxx = Math.max(mxx, rx); mxy = Math.max(mxy, ry);
        }
      }
      const pitch = Math.max(cellBase, (mxx - mnx) / 1018, (mxy - mny) / 1018);
      aMinX = Math.floor(mnx / pitch) - 2; aMinY = Math.floor(mny / pitch) - 2;
      aW = Math.ceil(mxx / pitch) - aMinX + 3; aH = Math.ceil(mxy / pitch) - aMinY + 3;
      texW = aW * 2; texH = aH * 2; passId = 2.0;
      if(locs.u_aPitch) gl.uniform1f(locs.u_aPitch, pitch);
    }
    // lazy FBO + texture, realloc on dims change
    if(!window._asciiToneFbo){ window._asciiToneFbo = gl.createFramebuffer(); window._asciiToneTex = gl.createTexture(); window._asciiToneDims = [0,0]; }
    gl.activeTexture(gl.TEXTURE9);
    gl.bindTexture(gl.TEXTURE_2D, window._asciiToneTex);
    if(window._asciiToneDims[0] !== texW || window._asciiToneDims[1] !== texH){
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texW, texH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      window._asciiToneDims = [texW, texH];
    }
    // LINEAR: circles sample at dot centers (interpolates anchors when the
    // lattice pitch is capped above the cell); ASCII samples exact texel
    // centers, where LINEAR == NEAREST. Set per-frame (alloc is conditional).
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform2f(locs.u_aMin, aMinX, aMinY);
    gl.uniform2f(locs.u_aDims, aW, aH);
    // FEEDBACK GUARD: while the tone texture is the FBO attachment it must
    // NOT also be bound on unit 9 (u_amtMaster0) — GL flags sampling-while-
    // rendering as INVALID_OPERATION even if the branch never samples it.
    gl.bindTexture(gl.TEXTURE_2D, (window._amtMasterTex && window._amtMasterTex[0]) || null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, window._asciiToneFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, window._asciiToneTex, 0);
    gl.viewport(0, 0, texW, texH);
    gl.uniform1f(locs.u_asciiTonePass, passId);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, dw, dh);
    gl.uniform1f(locs.u_asciiTonePass, 0.0);
    // NOW the tone texture rides unit 9 for the main pass
    gl.bindTexture(gl.TEXTURE_2D, window._asciiToneTex);
    gl.activeTexture(gl.TEXTURE0);
    if(locs.u_edgeSoft) gl.uniform1f(locs.u_edgeSoft, _wantCircleTone ? 1.0 : 0.0);
  } else {
    if(locs.u_asciiTonePass) gl.uniform1f(locs.u_asciiTonePass, 0.0);
    if(locs.u_edgeSoft) gl.uniform1f(locs.u_edgeSoft, 0.0);
  }
}
R._runTonePrepass = _runTonePrepass;

R.setScreenType = function(t){
  window._screenType = t ? 1 : 0;
  try { if(locs.u_screenType) gl.uniform1f(locs.u_screenType, window._screenType ? 1.0 : 0.0); } catch(e){}
  try { markDirty(); } catch(e){}
  console.log('[screen] engine:', window._screenType ? 'RISO matrix' : 'procedural round-dot');
};

// Matrix-engine tone calibration (default ON): thresholds carry the measured
// physical print response (riso_trc.json baked in as T' = D⁻¹(T)). OFF = raw
// driver matrices (geometry-linear tone, no dot loss/gain).
R.setScreenTrc = function(on){
  window._screenTrc = on ? 1 : 0;
  try { markDirty(); } catch(e){}
  console.log('[screen] matrix TRC:', window._screenTrc ? 'measured print response' : 'raw (geometry-linear)');
};

// CIRCLES edge behavior (default ON = soft): cell-integrated coverage — dots
// shrink at hard content edges instead of being sliced (RIP prefiltering).
// OFF = authentic per-pixel compare, dots slice exactly like a 600dpi RIP.
R.setScreenEdge = function(soft){
  window._screenEdgeSoft = soft ? 1 : 0;
  try { markDirty(); } catch(e){}
  console.log('[screen] circle edges:', window._screenEdgeSoft ? 'soft (cell-integrated)' : 'authentic (sliced)');
};

// (D) Toggle GPU ink-spread (default ON). When ON the soft dot edge is applied
// in the shader's master-sampling loop and the per-channel CPU Gaussian blur is
// skipped (saves ~1.2s/channel at 600 dpi). OFF restores the old CPU blur path
// (bit-for-bit the legacy look) for A/B comparison. Re-runs the prepass.
R.setGpuInkSpread = function(on){
  window._gpuInkSpread = !!on;
  console.log('[RisoAmt] GPU ink-spread:', on ? 'ON (shader, no CPU blur)' : 'OFF (CPU blur)');
  R.invalidateAmt();
  if(window._mode === 'flat' && window.R && window.R.runAmtPrepass){
    setTimeout(window.R.runAmtPrepass, 0);
  }
};
R.amtInfo = function(){
  return {
    scanDpi: window._amtScanDpi || 600,
    rendererVersion: 40,
    module: window.RisoAmt && window.RisoAmt.CALIBRATION
  };
};

// GPU Grain Touch tunables. gamma > 1 boosts midtones for a "punchier"
// print look; grainScale = mask cells per canvas pixel (1.0 finest, 0.5 chunky).
// Defaults are set in initRenderer (gamma=1.5, scale=1.0).
R.setRisoGrain = function(opts){
  opts = opts || {};
  if(typeof opts.gamma === 'number' && locs.u_risoGamma){
    gl.uniform1f(locs.u_risoGamma, Math.max(0.5, Math.min(4.0, opts.gamma)));
  }
  if(typeof opts.grainScale === 'number' && locs.u_risoGrainScale){
    gl.uniform1f(locs.u_risoGrainScale, Math.max(0.1, Math.min(8.0, opts.grainScale)));
  }
  markDirty();
};

// Debug: bypass shear/gamma/smoothstep, render raw V&C step(threshold, val).
// Call R.risoDebugBaseline(true) to see the BASELINE V&C output without my
// processing — useful for isolating which step introduces visible artifacts.
R.risoDebugBaseline = function(on){
  if(locs.u_risoDebugBaseline) gl.uniform1f(locs.u_risoDebugBaseline, on ? 1.0 : 0.0);
  markDirty();
  return on ? 'BASELINE (raw V&C step)' : 'normal (shear+gamma+smoothstep)';
};

// Upload a text mask canvas (or null to clear) to TEXTURE6. Called by
// source.js whenever the active PDF page changes — the mask is stored in
// the per-page cache. A 1×1 black texture is used to disable masking when
// no mask is available.
function uploadTextMask(canvas){
  if(!gl || !window._textMaskTex) return;
  gl.activeTexture(gl.TEXTURE6);
  gl.bindTexture(gl.TEXTURE_2D, window._textMaskTex);
  if(canvas && canvas.width > 0){
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
  }
  markDirty();
}
R.uploadTextMask = uploadTextMask;

// Upload the un-inpainted source raster to TEXTURE7 (u_srcOrig). Used by
// the shader's text-plate path to read the actual glyph color for its
// single-ink NNLS fit, while the main u_src texture (TEXTURE0) holds the
// inpainted version (text replaced by bg) consumed by all other plates.
function uploadOriginalSource(canvas){
  if(!gl || !window._srcOrigTex) return;
  gl.activeTexture(gl.TEXTURE7);
  gl.bindTexture(gl.TEXTURE_2D, window._srcOrigTex);
  if(canvas && canvas.width > 0){
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255,255,255,255]));
  }
  markDirty();
}
R.uploadOriginalSource = uploadOriginalSource;

})(window.R);
