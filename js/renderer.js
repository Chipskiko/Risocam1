// RENDERER module
(function(R) {
"use strict";

// ======================== WEBGL INIT ========================
function initGL(){
  const c=el('gl');
  // Try WebGL2 first — enables AMT-GPU to share the context (Metaxas wavefront
  // FS gets ~100× speedup when not running on a second context due to Safari's
  // context-switch overhead). WebGL1 fallback preserved for old browsers.
  gl=c.getContext('webgl2',{preserveDrawingBuffer:true,antialias:false});
  const isWebGL2 = !!gl;
  if(!gl){
    gl=c.getContext('webgl',{preserveDrawingBuffer:true,antialias:false});
  }
  if(!gl){R.toast('WebGL not supported — cannot render');return;}
  if (isWebGL2 && window.RisoAmt && window.RisoAmt.setAmtGpuContext) {
    window.RisoAmt.setAmtGpuContext(gl);
  }
  // Spin up the RISO FS Web Worker — runs off main thread so animations
  // (drum noise, video frames, paper drift) keep playing during prepass.
  try { _initAmtWorker(); } catch(e){}

  // Handle WebGL context loss/restore
  c.addEventListener('webglcontextlost',e=>{e.preventDefault();_rafId=0;R.toast('GPU context lost — will recover');});
  c.addEventListener('webglcontextrestored',()=>{R.toast('GPU restored');initGL();scheduleRender();});

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
   'u_grainSize','u_dotGain','u_dens0','u_dens1','u_dens2','u_dens3','u_inkNoise','u_static','u_resScale','u_bright','u_contrast','u_sat','u_shadows','u_highlights','u_postExposure','u_postContrast','u_postSat','u_mode','u_lineShape','u_lineAmount','u_lineWeight','u_lineRoughness','u_lineCenter0','u_lineCenter1','u_lineCenter2','u_lineCenter3','u_lineEdgeThickness','u_lineCount','u_sepMode','u_sepType','u_colorQuant','u_useLabResidual','u_useCalChord','u_warmCool','u_stampShape','u_ditherScale','u_screenClean','u_simNoise',
   'u_paperColor','u_paperTex','u_paperScan','u_usePaperScan','u_paperShift','u_crop','u_paper',
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
   'u_dbgP100','u_dbgLutDirect','u_dbgNoDotMin','u_dbgNoOpaque','u_dbgShowCov','u_dbgFixedCov','u_dbgBinaryGrain','u_dbgFMDots','u_dbgLinearize','u_dbgLumMono','u_dbgYNArea','u_dbgNeutralBypass','u_dbgTrcSCurve','u_ditherMode',
   'u_driverLUT','u_useDriverLUT',
   'u_ht5Matrix',
   'u_amtMaster0','u_amtMaster1','u_amtMaster2','u_amtMaster3','u_useAmt',
   'u_amtTexel','u_amtSuperSample',
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

  // AMT master textures — one per ink channel (tex units 9, 10, 11, 12).
  // Each holds the 1-bit RISO Grain Touch master for ONE ink, halftoned
  // independently by riso-amt.js from that channel's per-pixel coverage.
  // Result: different ink layers can deposit at different positions
  // (matching real driver), instead of all sharing the same pattern.
  window._amtMasterTex = [];
  for(var __ci = 0; __ci < 4; __ci++){
    var __tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE9 + __ci);
    gl.bindTexture(gl.TEXTURE_2D, __tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // NEAREST filtering — the FS output IS the dot pattern. Linear bilinear
    // interpolation destroys binary FS character (every dot edge becomes a
    // gray ramp → output looks like noise instead of FS). Intentional ink
    // spread is already pre-applied as a Gaussian blur to the bit plane
    // before upload (see gaussianBlurPlane in the prepass), so sampling
    // should be exact pixel-by-pixel.
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
  window._amtMasterValid = false;
  window._amtMasterKey = '';

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
  gl.uniform1f(locs.u_screenClean, (mode === 'screen' && window._screenClean) ? 1.0 : 0.0);
  gl.uniform1f(locs.u_paperTex,cached.paperTex);
  // Paper shifts per frame — only in animate mode (simulating different sheet feeds)
  var isAnimating = cached.grainStatic > 0 || camOn || videoOn;
  if(isAnimating){
    var psx = ((Math.sin(frameSeed * 127.1) * 43758.5453) % 1) * 400.0;
    var psy = ((Math.sin(frameSeed * 269.5) * 43758.5453) % 1) * 400.0;
    gl.uniform2f(locs.u_paperShift, psx, psy);
    cached._lastPaperShiftX = psx;
    cached._lastPaperShiftY = psy;
  } else {
    gl.uniform2f(locs.u_paperShift, 0.0, 0.0);
    cached._lastPaperShiftX = 0;
    cached._lastPaperShiftY = 0;
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
      frameSeed = Math.random();
      if(!R.isMono()){
        const m=cached.misreg/500;
        for(let i=0;i<4;i++){
          misreg[i]=[(Math.random()-.5)*m*2,(Math.random()-.5)*m*2];
        }
      }
    } else {
      frame++;
      frameSeed = Math.random();
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
      frameSeed = Math.random();
      R.newMisreg();
    } else {
      frame++;
      frameSeed = Math.random();
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
  if(isPhoneNow && cropAspect){
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
function onVideoFrame(){
  videoFrameReady=true;
  if((camOn||videoOn)&&$vid.requestVideoFrameCallback){
    $vid.requestVideoFrameCallback(onVideoFrame);
  }
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
// Labels for the UI
var DRIVER_LUT_NAMES = {0:'OFF', 1:'γ1.1 (Level1)', 2:'γ1.4 (Level2)', 3:'γ2.0 (Level3)', 4:'γ2.6 (Default)', 5:'γ0.6 (Backlight)'};

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
let _amtWorker = null;
let _amtWorkerPending = new Map();
let _amtWorkerNextId = 0;
function _initAmtWorker(){
  if (_amtWorker || typeof Worker === 'undefined') return;
  try {
    _amtWorker = new Worker('js/riso-amt-worker.js?v=2');
    _amtWorker.onmessage = function(e){
      const { id, plane, error } = e.data;
      const resolver = _amtWorkerPending.get(id);
      if (!resolver) return;
      _amtWorkerPending.delete(id);
      if (error) resolver.reject(new Error(error));
      else       resolver.resolve(new Uint8Array(plane));
    };
    _amtWorker.onerror = function(e){
      console.warn('[RisoAmt worker] error:', e.message);
      _amtWorker = null;  // disable further use, fall back to sync
    };
    console.log('[RisoAmt] Web Worker initialized — FS runs off-main-thread');
  } catch (e) {
    console.warn('[RisoAmt] Web Worker init failed, falling back to sync:', e);
    _amtWorker = null;
  }
}

// Async wrapper: runs runAmt() + ink-spread blur + bit unpack inside the worker
// so the main thread stays completely free for animations. Returns the BLURRED
// plane (W*H Uint8Array, 0..255 ink density) ready to pack into RGBA and upload.
// Falls back to synchronous main-thread path if worker is unavailable.
function runAmtAsync(input, W, H, opts, sigma){
  if (!_amtWorker) {
    const bits = window.RisoAmt.runAmt(input, W, H, opts);
    const plane = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const bit = (bits[i >> 3] >> (7 - (i & 7))) & 1;
      plane[i] = bit ? 255 : 0;
    }
    const blurred = (sigma > 0.01) ? gaussianBlurPlane(plane, W, H, sigma) : plane;
    return Promise.resolve(blurred);
  }
  return new Promise((resolve, reject) => {
    const id = _amtWorkerNextId++;
    _amtWorkerPending.set(id, { resolve, reject });
    const copy = new Uint8Array(input.length);
    copy.set(input);
    _amtWorker.postMessage(
      { id, input: copy.buffer, W, H, opts, sigma },
      [copy.buffer]
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
    window._amtMasterValid = false;
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

  // ── PASS 1: Project source RGB onto each channel's paper→ink direction ──
  // Produces 4 inputGray buffers (or null for inactive channels).
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
      // Ink ≈ paper — bind 1×1 dummy, skip dither
      const dummy = new Uint8Array([0,0,0,255]);
      gl.activeTexture(gl.TEXTURE9 + chIdx);
      gl.bindTexture(gl.TEXTURE_2D, window._amtMasterTex[chIdx]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, dummy);
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

  // ── PASS 2+3: Per-channel FS + ink-spread blur in worker → RGBA pack +
  //              texture upload on main thread.
  // The worker does all the CPU-heavy work (FS + bit unpack + Gaussian blur)
  // entirely off the main thread, so animations keep playing throughout. The
  // main thread only does the GL texture upload (fast, must be on GL thread).
  const sigma = window._inkSpread != null ? window._inkSpread : 0.5;
  for(let chIdx = 0; chIdx < 4; chIdx++){
    const meta = channelMeta[chIdx];
    if(!meta) continue;
    // Worker returns the BLURRED plane directly (Uint8Array W*H, 0..255).
    const blurred = await runAmtAsync(inputGrays[chIdx], W, H, _runOpts, sigma);
    // Pack to RGBA on main thread (~5ms at 1M pixels, negligible).
    const rgba = new Uint8Array(W * H * 4);
    for(let i = 0; i < W * H; i++){
      const v = blurred[i];
      rgba[i*4] = v; rgba[i*4+1] = v; rgba[i*4+2] = v; rgba[i*4+3] = 255;
    }
    gl.activeTexture(gl.TEXTURE9 + chIdx);
    gl.bindTexture(gl.TEXTURE_2D, window._amtMasterTex[chIdx]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    const ink = meta.ink;
    // Compute coverage by counting non-zero bytes in the plane (post-blur)
    let on = 0; for(let i = 0; i < W*H; i++) if(blurred[i] > 127) on++;
    const cov = (on / (W * H) * 100);
    console.log(`[RisoAmt]   ch${chIdx} ink RGB(${(ink[0]*255)|0},${(ink[1]*255)|0},${(ink[2]*255)|0}) → cov ${cov.toFixed(1)}%`);
    await _yield();
  }
  const totalMs = performance.now() - t0;
  console.log(`[RisoAmt] all channels done in ${totalMs.toFixed(0)} ms`);
  gl.uniform1f(locs.u_useAmt, 1.0);
  // Tell the shader the master's actual texel size so its supersampling
  // offsets land in the right scale (1 texel = 1 master cell).
  if(locs.u_amtTexel) gl.uniform2f(locs.u_amtTexel, 1.0 / W, 1.0 / H);
  window._amtMasterValid = true;
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
  window._amtMasterValid = false;
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
  if(typeof opts.dpi === 'number'){
    window._amtScanDpi = Math.max(50, Math.min(1200, opts.dpi|0));
  }
  if(typeof opts.inkSpread === 'number'){
    window._inkSpread = Math.max(0, Math.min(3, opts.inkSpread));
  }
  if(typeof opts.maxCoverage === 'number'){
    window._riso_maxCoverage = Math.max(0, Math.min(4, opts.maxCoverage));
  }
  if(typeof opts.thresholdNoise === 'number'){
    window._riso_thresholdNoise = Math.max(0, Math.min(0.5, opts.thresholdNoise));
  }
  R.invalidateAmt();
  if(window._mode === 'flat' && window.R && window.R.runAmtPrepass){
    setTimeout(window.R.runAmtPrepass, 0);
  }
  return {
    dpi: window._amtScanDpi || 600,
    inkSpread: window._inkSpread != null ? window._inkSpread : 0.5,
    maxCoverage: window._riso_maxCoverage != null ? window._riso_maxCoverage : 1.7,
    thresholdNoise: window._riso_thresholdNoise != null ? window._riso_thresholdNoise : 0.0
  };
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
