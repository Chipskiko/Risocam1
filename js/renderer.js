// RENDERER module
(function(R) {
"use strict";

// ======================== WEBGL INIT ========================
function initGL(){
  const c=el('gl');
  gl=c.getContext('webgl',{preserveDrawingBuffer:true,antialias:false});
  if(!gl){R.toast('WebGL not supported — cannot render');return;}

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
   'u_grainSize','u_dotGain','u_dens0','u_dens1','u_dens2','u_dens3','u_inkNoise','u_static','u_resScale','u_bright','u_contrast','u_sat','u_shadows','u_mode','u_sepMode','u_sepType',
   'u_paperColor','u_paperTex','u_paperScan','u_usePaperScan','u_paperShift','u_crop','u_paper',
   'u_lutA0','u_lutA1','u_lutA2','u_lutA3',
   'u_lutB0','u_lutB1','u_lutB2','u_lutB3',
   'u_lutC0','u_lutC1','u_lutC2','u_lutC3',
   'u_lutD0','u_lutD1','u_lutD2','u_lutD3',
   'u_inkGamma0','u_inkGamma1','u_inkGamma2','u_inkGamma3',
   'u_grainMul0','u_grainMul1','u_grainMul2','u_grainMul3',
   'u_hasCal0','u_hasCal1','u_hasCal2','u_hasCal3',
   'u_opaque0','u_opaque1','u_opaque2','u_opaque3',
   'u_prevSrc',
   'u_showCropMarks','u_printArea','u_ghosting','u_bleed',
   'u_skew0','u_skew1','u_skew2','u_skew3',
   'u_ucrStr','u_cmykBal','u_tac',
   'u_inkOpacity','u_layerDeplete','u_pressVar','u_densFlicker',
   'u_tonalGamma','u_dotMin','u_opacityCap'
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


// ======================== SHARED UNIFORM SETUP ========================
function setRenderUniforms(dw, dh, scale, isPhone){
  const layers=activeLayers();
  const nLayers=layers.length;
  gl.uniform2f(locs.u_res,dw,dh);
  gl.uniform1f(locs.u_time,frame);
  gl.uniform1f(locs.u_frameSeed,frameSeed);
  gl.uniform1f(locs.u_resScale,scale);
  gl.uniform1i(locs.u_layers,hasSrc?nLayers:0);
  gl.uniform1i(locs.u_mode,mode==='grain'?0:1);
  gl.uniform1i(locs.u_sepMode,0);
  gl.uniform1i(locs.u_sepType,cached.sepType||0);
  gl.uniform1f(locs.u_grainSize,cached.grainSize);
  gl.uniform1f(locs.u_dotGain,cached.dotGain);
  gl.uniform1f(locs.u_inkNoise,cached.inkNoise);
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
  gl.uniform1f(locs.u_pressVar, cached.pressVar * 0.01);
  gl.uniform1f(locs.u_densFlicker, cached.densFlicker * 0.01);
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
        gl.uniform3f(inkLocs[i],lt[4][0],lt[4][1],lt[4][2]);
        gl.uniform3f(lutALocs[i],lt[0][0],lt[0][1],lt[0][2]);
        gl.uniform3f(lutBLocs[i],lt[1][0],lt[1][1],lt[1][2]);
        gl.uniform3f(lutCLocs[i],lt[2][0],lt[2][1],lt[2][2]);
        gl.uniform3f(lutDLocs[i],lt[3][0],lt[3][1],lt[3][2]);
        gl.uniform1f(gammaLocs[i],cal.gamma);
        gl.uniform1f(grainMulLocs[i],cal.grainMul);
        gl.uniform1f(hasCalLocs[i],1.0);
      } else {
        const rgb=cached.inkRGB[i];
        gl.uniform3f(inkLocs[i],rgb[0],rgb[1],rgb[2]);
        gl.uniform3f(lutALocs[i],0,0,0);
        gl.uniform3f(lutBLocs[i],0,0,0);
        gl.uniform3f(lutCLocs[i],0,0,0);
        gl.uniform3f(lutDLocs[i],0,0,0);
        gl.uniform1f(gammaLocs[i],1.0);
        gl.uniform1f(grainMulLocs[i],1.0);
        gl.uniform1f(hasCalLocs[i],0.0);
        gl.uniform1f(opaqueLocs[i],0.0);
      }
      gl.uniform2f(offLocs[i],misreg[L.ch][0],misreg[L.ch][1]);
      gl.uniform1f(skewLocs[i],layerSkews[L.ch]||0);
      gl.uniform1f(angLocs[i],(layerAngles[L.ch]||0)*0.01745329);
      gl.uniform1i(chanLocs[i],L.ch);
      gl.uniform1f(densLocs[i],cached.layerDens[L.ch]);
    }else{
      gl.uniform3f(inkLocs[i],0,0,0);
      gl.uniform2f(offLocs[i],0,0);
      gl.uniform1f(skewLocs[i],0);
      gl.uniform1f(angLocs[i],0);
      gl.uniform1i(chanLocs[i],0);
      gl.uniform1f(densLocs[i],0);
      gl.uniform1f(hasCalLocs[i],0.0);
      gl.uniform1f(opaqueLocs[i],0.0);
      gl.uniform1f(gammaLocs[i],1.0);
      gl.uniform1f(grainMulLocs[i],1.0);
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
  try{ _renderInner(); }catch(e){
    if(_renderErrorCount++<3)console.error('Render error:',e);
    if(_renderErrorCount===3)R.toast('Render errors — see console');
    scheduleRender(); // keep loop alive
  }
}
function _renderInner(){
  const isPhoneNow=phoneActive;

  // Aspect ratio — canvas shape
  if(needsAspectUpdate){
    if(isPhoneNow && cropAspect && typeof cropAspect !== 'string'){
      $gl.style.aspectRatio = cropAspect[0]+'/'+cropAspect[1];
      $gl.style.width = '';
      $gl.style.height = '';
    } else if(isPhoneNow){
      $gl.style.aspectRatio = '';
      $gl.style.width = '100%';
      $gl.style.height = '100%';
    } else {
      $gl.style.width = '100%';
      $gl.style.height = '';
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

  // Canvas sizing — use cached dimensions (updated on resize/aspect change)
  let cssW=cachedVfW||$vf.clientWidth, cssH=cachedVfH||$vf.clientHeight;
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



// --- Namespace exports ---
R.initGL = initGL;
R.setRenderUniforms = setRenderUniforms;
R.render = render;
R.swapSrcTextures = swapSrcTextures;
R.onVideoFrame = onVideoFrame;

})(window.R);
