// COMPARE module
(function(R) {
"use strict";

// ======================== COMPARE MODE ========================
let _compareRAF=0,_compareLive=false;
function getCompareCrop(){
  // Compute the same crop the shader uses, returns {sx,sy,sw,sh} in source pixels
  let srcW,srcH;
  if(camOn||(videoOn&&!gifImg)){srcW=$vid.videoWidth||1;srcH=$vid.videoHeight||1;}
  else if(gifImg){srcW=gifCanvas.width||1;srcH=gifCanvas.height||1;}
  else if(srcImg){srcW=srcImg.width;srcH=srcImg.height;}
  else return null;
  const glc=el('gl');
  const dw=glc.width,dh=glc.height;
  let targetAR;
  if(cropAspect==='fill') targetAR=dw/dh;
  else if(cropAspect==='fit') targetAR=srcW/srcH;
  else if(cropAspect) targetAR=cropAspect[0]/cropAspect[1];
  else targetAR=dw/dh;
  const srcAR=srcW/srcH;
  let cx=0,cy=0,cw=srcW,ch=srcH;
  if(targetAR>srcAR){
    const h=srcAR/targetAR;
    cy=((1-h)/2)*srcH;ch=h*srcH;
  } else {
    const w=targetAR/srcAR;
    cx=((1-w)/2)*srcW;cw=w*srcW;
  }
  return {sx:cx,sy:cy,sw:cw,sh:ch};
}
function sizeCompareOverlay(){
  const glc=el('gl');
  const parent=glc.parentElement;
  const pr=parent.getBoundingClientRect();
  const gr=glc.getBoundingClientRect();
  const ov=el('compareOverlay');
  ov.style.left=(gr.left-pr.left)+'px';
  ov.style.top=(gr.top-pr.top)+'px';
  ov.style.width=gr.width+'px';
  ov.style.height=gr.height+'px';
}
function getComparePrintArea(){
  // Replicate the same print area logic from setRenderUniforms (renderer.js)
  const glc=el('gl');
  const dw=glc.width,dh=glc.height;
  const paperAR=dw/dh;
  const minMargin=cached.margin*0.01;
  const isLive=camOn||videoOn;
  const isGif=!!gifImg;

  if(phoneActive){
    const pm=Math.max(minMargin,0.005);
    return {l:pm,t:pm,r:pm,b:pm};
  } else if(cropAspect==='fill'){
    const m=Math.max(minMargin,0.005);
    return {l:m,t:m,r:m,b:m};
  } else {
    let imgAR;
    if(cropAspect==='fit'){
      const srcW2=(isLive&&!isGif)?($vid.videoWidth||1):(isGif?(gifCanvas.width||1):(srcImg?srcImg.width:1));
      const srcH2=(isLive&&!isGif)?($vid.videoHeight||1):(isGif?(gifCanvas.height||1):(srcImg?srcImg.height:1));
      imgAR=srcW2/srcH2;
    } else {
      imgAR=cropAspect[0]/cropAspect[1];
    }
    const availW=1.0-2.0*minMargin;
    const availH=1.0-2.0*minMargin;
    let printW,printH;
    if(imgAR>(availW*paperAR)/availH){
      printW=availW; printH=availW*paperAR/imgAR;
      if(printH>availH){printH=availH;printW=availH*imgAR/paperAR;}
    } else {
      printH=availH; printW=availH*imgAR/paperAR;
      if(printW>availW){printW=availW;printH=availW*paperAR/imgAR;}
    }
    return {l:(1-printW)/2,t:(1-printH)/2,r:(1-printW)/2,b:(1-printH)/2};
  }
}
// Replicate shader adjustRGB() on canvas pixel data
function applyImageAdjustments(ctx, x, y, w, h){
  if(w<=0||h<=0) return;
  const ix=Math.round(x), iy=Math.round(y), iw=Math.round(w), ih=Math.round(h);
  const imgData=ctx.getImageData(ix,iy,iw,ih);
  const d=imgData.data;
  const bright=cached.imgBright||0;
  const contrast=cached.imgContrast||0;
  const sat=cached.imgSat||0;
  const shadows=cached.imgShadows||0;
  const cMul=1.0+contrast*0.02;
  const sMul=1.0+sat*0.03;
  const shF=shadows*0.01;
  // Get tone curve LUT if available
  const lut=window._toneCurveLUT; // Uint8Array(256) or null
  for(let i=0;i<d.length;i+=4){
    let r=d[i]/255, g=d[i+1]/255, b=d[i+2]/255;
    // Brightness
    r+=bright*0.01; g+=bright*0.01; b+=bright*0.01;
    // Contrast
    r=(r-0.5)*cMul+0.5; g=(g-0.5)*cMul+0.5; b=(b-0.5)*cMul+0.5;
    // Saturation
    const lum=r*0.299+g*0.587+b*0.114;
    r=lum+(r-lum)*sMul; g=lum+(g-lum)*sMul; b=lum+(b-lum)*sMul;
    // Shadows
    if(Math.abs(shadows)>0.5){
      const mr=(1-r)*(1-r), mg=(1-g)*(1-g), mb=(1-b)*(1-b);
      r+=shF*mr; g+=shF*mg; b+=shF*mb;
    }
    // Tone curve LUT
    if(lut){
      r=lut[Math.round(Math.max(0,Math.min(1,r))*255)]/255;
      g=lut[Math.round(Math.max(0,Math.min(1,g))*255)]/255;
      b=lut[Math.round(Math.max(0,Math.min(1,b))*255)]/255;
    }
    d[i]=Math.max(0,Math.min(255,r*255));
    d[i+1]=Math.max(0,Math.min(255,g*255));
    d[i+2]=Math.max(0,Math.min(255,b*255));
  }
  ctx.putImageData(imgData,ix,iy);
}

function drawCompareFrame(source){
  // Draw source with B/C/S/Shadows applied — shows what's fed to ink pipeline
  const cv=el('compareCanvas');
  const ctx=cv.getContext('2d');
  const crop=getCompareCrop();
  if(!crop)return;
  const glc=el('gl');
  cv.width=glc.width;cv.height=glc.height;

  // Fill with paper color background
  const pc=PAPER_COLORS[curPaperColor];
  ctx.fillStyle=pc?pc.hex:'#f5f0e8';
  ctx.fillRect(0,0,cv.width,cv.height);

  // Apply print area margins (same as shader u_printArea)
  const pa=getComparePrintArea();
  const dx=pa.l*cv.width;
  const dy=pa.t*cv.height;
  const dw=cv.width-pa.l*cv.width-pa.r*cv.width;
  const dh=cv.height-pa.t*cv.height-pa.b*cv.height;
  ctx.drawImage(source,crop.sx,crop.sy,crop.sw,crop.sh,dx,dy,dw,dh);

  // Apply image adjustments to match shader's adjustRGB()
  applyImageAdjustments(ctx, dx, dy, dw, dh);
}
function toggleCompare(){
  compareOn=!compareOn;
  const overlay=el('compareOverlay');
  const btn=el('compareBtn');
  const img=el('compareImg');
  const cv=el('compareCanvas');
  if(compareOn){
    const isLive=camOn||videoOn;
    // Always use the canvas (handles crop correctly for both static and video)
    img.style.display='none';cv.style.display='';
    if(srcImg){
      drawCompareFrame(srcImg);
      _compareLive=false;
    } else if(isLive){
      drawCompareFrame($vid);
      _compareLive=true;
    } else {
      compareOn=false;return;
    }
    sizeCompareOverlay();
    overlay.classList.add('active');
    btn.classList.add('active');
    initCompareDrag();
    if(_compareLive) startCompareLoop();
  } else {
    compareOn=false;
    overlay.classList.remove('active');
    btn.classList.remove('active');
    stopCompareLoop();
    _compareLive=false;
  }
}
function startCompareLoop(){
  stopCompareLoop();
  function tick(){
    if(!compareOn||!_compareLive){stopCompareLoop();return;}
    sizeCompareOverlay();
    drawCompareFrame($vid);
    _compareRAF=requestAnimationFrame(tick);
  }
  _compareRAF=requestAnimationFrame(tick);
}
function stopCompareLoop(){if(_compareRAF){cancelAnimationFrame(_compareRAF);_compareRAF=0;}}
function setComparePos(x){
  const overlay=el('compareOverlay');
  const rect=overlay.getBoundingClientRect();
  const pct=Math.max(0.05,Math.min(0.95,(x-rect.left)/rect.width));
  const clip=`inset(0 ${(1-pct)*100}% 0 0)`;
  el('compareCanvas').style.clipPath=clip;
  el('compareHandle').style.left=pct*100+'%';
}
function initCompareDrag(){
  const handle=el('compareHandle');
  let dragging=false;
  const onMove=e=>{if(!dragging)return; const x=e.touches?e.touches[0].clientX:e.clientX; setComparePos(x);};
  const onUp=()=>{dragging=false;document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);document.removeEventListener('touchmove',onMove);document.removeEventListener('touchend',onUp);};
  handle.onmousedown=handle.ontouchstart=e=>{e.preventDefault();dragging=true;document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);document.addEventListener('touchmove',onMove,{passive:false});document.addEventListener('touchend',onUp);};
}



// --- Namespace exports ---
R.toggleCompare = toggleCompare;
R.sizeCompareOverlay = sizeCompareOverlay;
R.startCompareLoop = startCompareLoop;
R.stopCompareLoop = stopCompareLoop;
R.initCompareDrag = initCompareDrag;

})(window.R);
