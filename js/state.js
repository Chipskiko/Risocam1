// ======================== STATE ========================
// 4 fixed CMYK channel slots — each holds a color name or null
let channels=[null,null,null,null]; // [C slot, M slot, Y slot, K slot]
let layerOrder=[0,1,2,3]; // Print/render order (first = printed first = bottom)
let activeProf=null, mode='grain';
let srcImg=null, camStream=null, camOn=false, videoOn=false, hasSrc=false;
let misreg=[[0,0],[0,0],[0,0],[0,0]], layerSkews=[0,0,0,0], gl, prog, locs={}, frame=0, frameSeed=Math.random();
let fpsFrames=0, fpsLast=performance.now();
let layerAngles=[15,75,0,45];
// Per-channel knockout flag — when true, this layer's ink cuts a hole back
// to paper, removing layers below where it prints (cutout effect).
let layerKnockout=[false,false,false,false];
// Per-channel visibility — toggled by clicking a plate's badge in the UI.
// When false, the layer's density is multiplied by 0 in the render path
// (effectively soloing/muting plates without losing their settings). Has
// no effect on SEPS export — separations always include all plates.
let layerVisible=[true,true,true,true];
// Per-channel CONCENTRIC/RADIAL center — independent X/Y per plate.
// Same-color channels are kept synced (same linkage logic as angles +
// knockout). Defaults to image center.
let layerLineCenterX=[0.5,0.5,0.5,0.5];
let layerLineCenterY=[0.5,0.5,0.5,0.5];

// PDF mode: enables vector-text routing. When on AND the source is a PDF,
// pdf.js's getTextContent() identifies text regions and the shader sends
// those pixels to a single chosen plate (avoids text-on-multiple-plates
// misregistration smear).
let pdfModeOn=false;
// Ink color name for the text channel (must match a name in RISO_COLORS).
// null = no text routing. The chosen color must already be active in one
// of the four channel slots — the text layer doesn't add a new slot, it
// piggybacks on whichever existing slot uses the same color.
let textChannelColor=null;
// Text knockout: when true, the text plate's glyphs cut a hole through
// every other plate back to paper. Useful when the rim-bg sampling is
// inaccurate (text on a complex/non-flat background) — instead of trying
// to reconstruct what's behind glyphs, just punch through to paper.
let textKnockout=false;
// Trapping: contracts knockout regions by N canvas pixels so the printed
// ink overlaps the underlying inks by N px. Hides white halos caused by
// plate misregistration. Same UX/labels as Spectrolite. 0 = no trap.
let trappingPx=0;
let resScale=6; // always max resolution
let curPaper=0, curPaperColor=0;
let cropAspect=[4,3]; // default 4:3
let cropRect=[0,0,1,1]; // UV crop: x,y,w,h

const cached={
  grainSize:1.5, dotGain:12, inkNoise:8, paperTex:12, lpi:40, grainStatic:0, imgBright:0, imgContrast:0, imgSat:0, imgShadows:0,
  sepType:0, // 0=CMYK, 1=Approx (NNLS spot color)
  ucrStr:15, balC:150, balM:155, balY:105, balK:165, tac:280,
  inkOpacity:88, layerDeplete:3, pressVar:100, densFlicker:7,
  tonalGamma:100, dotMin:15, opacityCap:45,
  inkRGB:[[0,0,0],[0,0,0],[0,0,0],[0,0,0]],
  paperColor:[0.96,0.94,0.91],
  layerDens:[88,88,88,88],
  showCropMarks:false,
  ghosting:0,
  ghostMul:100,
  margin:4,
  skew:0,
  postExposure:0, postContrast:0, postSat:0,
  warmCool:0, // -50..50 — channel mixer warm/cool bias
};
let needsAspectUpdate=true;
let videoFrameReady=false;
let needsRedraw=true; // dirty flag — skip GPU work when nothing changed
let _rafId=0;
let _pendingDirty=false; // coalesce multiple markDirty calls per frame

function scheduleRender(){if(!_rafId) _rafId=requestAnimationFrame(R.render);}
function markDirty(){
  needsRedraw=true;
  if(!_pendingDirty){_pendingDirty=true;requestAnimationFrame(()=>{_pendingDirty=false;scheduleRender();});}
}

const inkLocs=new Array(4), offLocs=new Array(4), angLocs=new Array(4), chanLocs=new Array(4), densLocs=new Array(4);
// Pre-built uniform location arrays (populated in init, avoids per-frame allocation)
let lutALocs,lutBLocs,lutCLocs,lutDLocs,grainMulLocs,inkGammaLocs,hasCalLocs,opaqueLocs,skewLocs;
let $gl,$vf,$vid,$fps,$res,$status,$phCropGuide,$deskCropGuide;
let cachedVfW=0,cachedVfH=0; // cached viewfinder dimensions, updated on resize

function hexRGB(h){return[parseInt(h.slice(1,3),16)/255,parseInt(h.slice(3,5),16)/255,parseInt(h.slice(5,7),16)/255];}
function el(id){return document.getElementById(id);}

// ─── Aspect ratio crop ───
function computeCrop(){
  // Get source dimensions
  let sw, sh;
  if((camOn||(videoOn&&!gifImg))&&$vid&&$vid.videoWidth){sw=$vid.videoWidth;sh=$vid.videoHeight;}
  else if(videoOn&&gifImg&&gifCanvas){sw=gifCanvas.width;sh=gifCanvas.height;}
  else if(srcImg){sw=srcImg.width;sh=srcImg.height;}
  else{cropRect=[0,0,1,1];return;}

  // 'fill' and 'fit' are special modes that use source native aspect
  if(!cropAspect || cropAspect==='fill' || cropAspect==='fit'){
    cropRect=[0,0,1,1];
    return;
  }

  const srcAR=sw/sh;
  const cropAR=cropAspect[0]/cropAspect[1];

  if(cropAR>srcAR){
    // Crop is wider than source: letterbox top/bottom
    const h=srcAR/cropAR;
    cropRect=[0,(1-h)/2,1,h];
  } else {
    // Crop is taller: pillarbox left/right
    const w=cropAR/srcAR;
    cropRect=[(1-w)/2,0,w,1];
  }
}

function setAspect(ratio){
  cropAspect=ratio||[4,3];
  computeCrop();
  needsAspectUpdate=true;scheduleRender();
  const ar = (typeof cropAspect === 'string') ? cropAspect : cropAspect.join(':');
  const abtn=el('aspectBtn');
  if(abtn) abtn.textContent=ar.toUpperCase();
  document.querySelectorAll('.aspect-btn').forEach(b=>{
    b.classList.toggle('active',b.dataset.ar===ar);
  });
  setTimeout(()=>R.updateDebugInfo(),50);
}
const aspectSteps=['fill','fit',[4,3],[1,1],[5,4],[16,9],[9,16]];
function cycleAspect(){
  if(window._pdfDoc){R.toast('Aspect locked to FIT in PDF mode');return;}
  const cur=(typeof cropAspect==='string')?cropAspect:cropAspect.join(':');
  const labels=['fill','fit','4:3','1:1','5:4','16:9','9:16'];
  const i=labels.indexOf(cur);
  setAspect(aspectSteps[(i+1)%aspectSteps.length]);
}

let paperOrient='landscape'; // 'landscape' or 'portrait'
function setPaperOrient(orient){
  paperOrient=orient;
  // Aspect ratio is now on the canvas, not the panel
  if($gl){
    if(orient==='portrait'){
      $gl.style.aspectRatio='1/1.414';
    } else {
      $gl.style.aspectRatio='1.414/1';
    }
  }
  needsAspectUpdate=true;
  markDirty();
}

// Phone mode detection — state-based, not screen-size
let phoneActive=false;
function isPhone(){return phoneActive;}

let _desktopMargin=4;
function togglePhoneMode(){
  phoneActive=!phoneActive;
  if(phoneActive){
    _desktopMargin=cached.margin;
    cached.margin=10;
    el('margin').value=10;el('marginVal').textContent=10;
  } else {
    cached.margin=_desktopMargin;
    el('margin').value=_desktopMargin;el('marginVal').textContent=_desktopMargin;
  }
  document.body.classList.toggle('phone-mode',phoneActive);
  markDirty();needsAspectUpdate=true;
  R.layoutSwitch();
}

// Derive active layer count from channels
function activeCount(){return channels.filter(c=>c!==null).length;}

// Get ordered active layers for shader (follows layerOrder for print sequence)
function activeLayers(){
  const out=[];
  if(cached.sepType===1){
    // Spot mode: only unique inks (NNLS decomposes into unique spot colors)
    const seen=new Set();
    for(const i of layerOrder){
      const c=channels[i];
      if(c!==null && !seen.has(c)){ seen.add(c); out.push({ch:i, color:c, knockout:!!layerKnockout[i]}); }
    }
  } else {
    for(const i of layerOrder) if(channels[i]!==null) out.push({ch:i, color:channels[i], knockout:!!layerKnockout[i]});
  }
  return out;
}

// Resolve the text channel's layer index in the rendered output.
// Returns 0..3 (the position in the activeLayers() list) or -1 if no
// text routing is active. Same-color channels share a layer slot, so this
// returns the FIRST activeLayers() entry matching textChannelColor.
function getTextLayerIdx(){
  if(!pdfModeOn || !textChannelColor) return -1;
  const ls = activeLayers();
  for(let i=0;i<ls.length;i++) if(ls[i].color === textChannelColor) return i;
  return -1; // chosen text color isn't currently in any channel
}

function cacheInkColors(){
  const layers=activeLayers();
  for(let i=0;i<4;i++){
    if(i<layers.length){
      const c=RISO_COLORS.find(r=>r.name===layers[i].color);
      cached.inkRGB[i]=c?hexRGB(c.hex):[0,0,0];
    }else{
      cached.inkRGB[i]=[0,0,0];
    }
  }
}
let _undoTimer=0;
function cacheSlider(id,val){cached[id]=parseFloat(val);markDirty();clearTimeout(_undoTimer);_undoTimer=setTimeout(R.pushUndo,300);}

// Cross-file shared state (moved from IIFE modules to keep globally accessible)
let risoFps=4; // choppy print-animation FPS (from phone.js)
let isRecording=false; // phone recording active (from phone.js)
let lastRisoFrame=0; // timestamp of last riso-frame draw (from phone.js)
let facingMode='environment'; // camera facing mode (from phone.js)
let gifImg=null, gifCanvas=null; // GIF source image/canvas (from source.js)
let gifFrames=null; // ImageDecoder GIF frames array (from source.js)
let compareOn=false; // compare mode active (from compare.js)
let _saving=false; // block render during save (from renderer.js/save.js)

// --- Namespace exports ---
R.scheduleRender = scheduleRender;
R.markDirty = markDirty;
R.hexRGB = hexRGB;
R.el = el;
R.computeCrop = computeCrop;
R.setAspect = setAspect;
R.cycleAspect = cycleAspect;
R.setPaperOrient = setPaperOrient;
R.isPhone = isPhone;
R.togglePhoneMode = togglePhoneMode;
R.activeCount = activeCount;
R.activeLayers = activeLayers;
R.cacheInkColors = cacheInkColors;
R.cacheSlider = cacheSlider;
