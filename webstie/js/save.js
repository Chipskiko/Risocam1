// SAVE module
(function(R) {
"use strict";

// ======================== SAVE ========================
function getSaveAspect(){
  // Determine output aspect ratio from cropAspect
  if(cropAspect==='fill') return $gl.width/$gl.height;
  if(cropAspect==='fit'){
    const sw=srcImg?srcImg.width:(gifCanvas?gifCanvas.width:$gl.width);
    const sh=srcImg?srcImg.height:(gifCanvas?gifCanvas.height:$gl.height);
    return sw/sh;
  }
  if(Array.isArray(cropAspect)) return cropAspect[0]/cropAspect[1];
  return 4/3; // fallback
}
async function saveHiRes(){
  _saving=true;
  try{
  const unique=[...new Set(channels.filter(c=>c))];
  const names=unique.join('-').replace(/[\s.]/g,'');
  const saveScale=Math.max(resScale,3);
  const ar=getSaveAspect();
  const baseSize=1200;
  let saveW,saveH;
  if(ar>=1){saveW=Math.round(baseSize*ar*saveScale/3);saveH=Math.round(baseSize*saveScale/3);}
  else{saveW=Math.round(baseSize*saveScale/3);saveH=Math.round(baseSize/ar*saveScale/3);}
  saveW=saveW&~1;saveH=saveH&~1;
  const origW=$gl.width,origH=$gl.height;
  // Lock CSS size so canvas doesn't flash during save
  const origCssW=$gl.style.width, origCssH=$gl.style.height;
  $gl.style.width=$gl.clientWidth+'px';
  $gl.style.height=$gl.clientHeight+'px';
  $gl.width=saveW;$gl.height=saveH;
  gl.viewport(0,0,saveW,saveH);
  R.setRenderUniforms(saveW,saveH,saveScale,false);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  const filename='risocam_'+(names||'empty')+'_'+saveW+'x'+saveH+'_'+Date.now()+'.png';
  const blob=await new Promise(r=>$gl.toBlob(b=>r(b),'image/png'));
  $gl.width=origW;$gl.height=origH;
  $gl.style.width=origCssW;$gl.style.height=origCssH;
  markDirty();needsAspectUpdate=true;
  _saving=false;
  await doSaveBlob(blob,filename,saveW,saveH);
  }catch(e){console.error('PNG save error:',e);R.toast('Save failed');}
  finally{_saving=false;}
}

// ─── Minimal GIF89a encoder (no external deps) ───
function GIFEncoder(w,h,delay){
  this.w=w;this.h=h;this.delay=delay;this.frames=[];this.out=[];
}
GIFEncoder.prototype.addFrame=function(ctx){
  const d=ctx.getImageData(0,0,this.w,this.h).data;
  const w=this.w,h=this.h,n=w*h;
  // Build palette from reduced color space
  const palette=[],pMap=new Map();
  for(let i=0;i<d.length;i+=4){
    const r=d[i]&0xF8,g=d[i+1]&0xFC,b=d[i+2]&0xF8;
    const k=(r<<8)|(g<<2)|((b>>3));
    if(!pMap.has(k)&&palette.length<256){pMap.set(k,palette.length);palette.push([r,g,b]);}
  }
  let palBits=1;while((1<<palBits)<palette.length)palBits++;
  while(palette.length<(1<<palBits))palette.push([0,0,0]);
  // Floyd-Steinberg dithering
  const err=new Float32Array(n*3);
  for(let i=0;i<n;i++){err[i*3]=d[i*4];err[i*3+1]=d[i*4+1];err[i*3+2]=d[i*4+2];}
  const idx=new Uint8Array(n);
  const clamp=(v)=>v<0?0:v>255?255:v;
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const i=y*w+x;
      const cr=clamp(Math.round(err[i*3])),cg=clamp(Math.round(err[i*3+1])),cb=clamp(Math.round(err[i*3+2]));
      // Find nearest palette color
      let best=0,bestD=Infinity;
      for(let j=0;j<palette.length;j++){
        const dr=cr-palette[j][0],dg=cg-palette[j][1],db=cb-palette[j][2];
        const dist=dr*dr+dg*dg+db*db;
        if(dist<bestD){bestD=dist;best=j;}
      }
      idx[i]=best;
      // Distribute error
      const er=cr-palette[best][0],eg=cg-palette[best][1],eb=cb-palette[best][2];
      if(x+1<w){const j=(i+1)*3;err[j]+=er*7/16;err[j+1]+=eg*7/16;err[j+2]+=eb*7/16;}
      if(y+1<h){
        if(x>0){const j=(i+w-1)*3;err[j]+=er*3/16;err[j+1]+=eg*3/16;err[j+2]+=eb*3/16;}
        {const j=(i+w)*3;err[j]+=er*5/16;err[j+1]+=eg*5/16;err[j+2]+=eb*5/16;}
        if(x+1<w){const j=(i+w+1)*3;err[j]+=er/16;err[j+1]+=eg/16;err[j+2]+=eb/16;}
      }
    }
  }
  this.frames.push({palette,palBits,idx});
};
GIFEncoder.prototype.finish=function(){
  const o=this.out;
  // Header
  _ws(o,'GIF89a');
  _wLE16(o,this.w);_wLE16(o,this.h);
  o.push(0x70,0,0); // no GCT, 8-bit color depth
  // Netscape extension for looping
  o.push(0x21,0xFF,0x0B);
  _ws(o,'NETSCAPE2.0');
  o.push(3,1);_wLE16(o,0);o.push(0);
  for(const f of this.frames){
    // GCE
    o.push(0x21,0xF9,4,0);
    _wLE16(o,Math.round(this.delay/10));
    o.push(0,0);
    // Image descriptor with local color table
    o.push(0x2C);
    _wLE16(o,0);_wLE16(o,0);
    _wLE16(o,this.w);_wLE16(o,this.h);
    o.push(0x80|(f.palBits-1)); // local color table flag + size
    // Local color table
    for(const c of f.palette){o.push(c[0],c[1],c[2]);}
    // LZW compress
    const minCode=Math.max(2,f.palBits);
    const lzw=_lzwCompress(f.idx,minCode);
    o.push(minCode);
    // Sub-blocks
    for(let i=0;i<lzw.length;){
      const chunk=Math.min(255,lzw.length-i);
      o.push(chunk);
      for(let j=0;j<chunk;j++)o.push(lzw[i++]);
    }
    o.push(0);
  }
  o.push(0x3B); // trailer
  return new Uint8Array(o);
};
function _ws(o,s){for(let i=0;i<s.length;i++)o.push(s.charCodeAt(i));}
function _wLE16(o,v){o.push(v&0xFF,(v>>8)&0xFF);}
function _lzwCompress(idx,minCode){
  const clearCode=1<<minCode;
  const eoiCode=clearCode+1;
  let codeSize=minCode+1;
  let nextCode=eoiCode+1;
  const table=new Map();
  const bits=[];
  const addBits=(val,n)=>{for(let i=0;i<n;i++)bits.push((val>>i)&1);};
  addBits(clearCode,codeSize);
  // Init table
  for(let i=0;i<clearCode;i++)table.set(String(i),i);
  let cur=String(idx[0]);
  for(let i=1;i<idx.length;i++){
    const s=cur+','+idx[i];
    if(table.has(s)){cur=s;}
    else{
      addBits(table.get(cur),codeSize);
      if(nextCode<4096){table.set(s,nextCode++);}
      if(nextCode>(1<<codeSize)&&codeSize<12)codeSize++;
      if(nextCode>=4095){
        addBits(clearCode,codeSize);
        table.clear();
        for(let j=0;j<clearCode;j++)table.set(String(j),j);
        codeSize=minCode+1;nextCode=eoiCode+1;
      }
      cur=String(idx[i]);
    }
  }
  addBits(table.get(cur),codeSize);
  addBits(eoiCode,codeSize);
  // Pack bits to bytes
  const bytes=[];
  for(let i=0;i<bits.length;i+=8){
    let b=0;
    for(let j=0;j<8&&i+j<bits.length;j++)b|=bits[i+j]<<j;
    bytes.push(b);
  }
  return bytes;
}

async function saveGif(){
  if(!hasSrc){R.toast('No image loaded');return;}
  _saving=true;
  try{
  const unique=[...new Set(channels.filter(c=>c))];
  const names=unique.join('-').replace(/[\s.]/g,'');
  const gifFps=risoFps||4;
  // Detect source type
  const hasAnimGif=gifFrames&&gifFrames.length>1;
  const hasVideo=videoOn&&!gifImg&&!gifFrames&&$vid.readyState>=2;
  // Frame count & timing — output at riso FPS, subsample source
  const delay=Math.round(1000/gifFps);
  let totalFrames, srcDuration=0;
  if(hasAnimGif){
    // Calculate source GIF total duration
    for(let k=0;k<gifFrames.length;k++) srcDuration+=gifFrames[k].duration||100;
    srcDuration=Math.min(srcDuration/1000, 5); // ms→s, cap 5s
    totalFrames=Math.max(Math.round(srcDuration*gifFps), 4);
  }else if(hasVideo){
    srcDuration=Math.min($vid.duration||2, 5); // cap at 5s
    totalFrames=Math.max(Math.round(srcDuration*gifFps), 4);
  }else{
    totalFrames=Math.max(gifFps*2, 4); // 2s riso grain loop
  }
  // Output size at crop aspect ratio, max 800px
  const maxGif=800;
  const ar=getSaveAspect();
  let gw,gh;
  if(ar>=1){gw=maxGif;gh=Math.round(maxGif/ar);}
  else{gh=maxGif;gw=Math.round(maxGif*ar);}
  gw=gw&~1;gh=gh&~1;
  R.toast('Rendering GIF ('+totalFrames+' frames)…');
  const tmpCanvas=document.createElement('canvas');
  tmpCanvas.width=gw;tmpCanvas.height=gh;
  const tmpCtx=tmpCanvas.getContext('2d');
  const enc=new GIFEncoder(gw,gh,delay);
  // Save state
  const origW=$gl.width,origH=$gl.height;
  const origSeed=frameSeed;
  const origMisreg=misreg.map(m=>[...m]);
  const origSkews=[...layerSkews];
  const origFrame=frame;
  const origVidTime=hasVideo?$vid.currentTime:0;
  const origVidPaused=hasVideo?$vid.paused:false;
  if(hasVideo)$vid.pause();
  // Lock CSS size so canvas doesn't visually shrink during render
  const origCssW=$gl.style.width, origCssH=$gl.style.height;
  $gl.style.width=$gl.clientWidth+'px';
  $gl.style.height=$gl.clientHeight+'px';
  // Resize GL buffer (hidden by CSS lock)
  $gl.width=gw;$gl.height=gh;
  for(let i=0;i<totalFrames;i++){
    // Upload animated source frame (time-based subsampling)
    if(hasAnimGif){
      // Find which source frame corresponds to this output time
      const outTimeMs=(i/gifFps)*1000;
      let accMs=0, srcIdx=0;
      for(let k=0;k<gifFrames.length;k++){
        accMs+=gifFrames[k].duration||100;
        if(accMs>outTimeMs){srcIdx=k;break;}
        srcIdx=k;
      }
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,window._srcTexA);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,gifFrames[srcIdx].canvas);
    }else if(hasVideo){
      // Seek video to this frame's timestamp and upload
      const t=(i/gifFps)%($vid.duration||1);
      $vid.currentTime=t;
      await new Promise(r=>{$vid.onseeked=r;setTimeout(r,200);});
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,window._srcTexA);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,$vid);
    }
    // Vary riso grain/misreg per frame
    frameSeed=Math.random();
    frame=origFrame+i;
    R.newMisreg();
    gl.viewport(0,0,gw,gh);
    R.setRenderUniforms(gw,gh,resScale,false);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    tmpCtx.drawImage($gl,0,0,gw,gh);
    enc.addFrame(tmpCtx);
    // Yield every frame so browser stays responsive
    R.toast('Rendering GIF ('+((i+1))+'/'+totalFrames+')…');
    await new Promise(r=>requestAnimationFrame(r));
  }
  // Restore buffer and unlock CSS
  $gl.width=origW;$gl.height=origH;
  $gl.style.width=origCssW;$gl.style.height=origCssH;
  gl.viewport(0,0,origW,origH);
  frameSeed=origSeed;
  misreg=origMisreg;
  layerSkews=origSkews;
  frame=origFrame;
  if(hasVideo){
    $vid.currentTime=origVidTime;
    if(!origVidPaused)$vid.play();
  }
  markDirty();needsAspectUpdate=true;
  _saving=false;
  const data=enc.finish();
  const blob=new Blob([data],{type:'image/gif'});
  const filename='risocam_'+(names||'empty')+'_'+gw+'x'+gh+'_'+Date.now()+'.gif';
  await doSaveBlob(blob,filename,gw,gh);
  R.toast('GIF saved');
  }catch(e){console.error('GIF save error:',e);R.toast('GIF save failed');}
  finally{_saving=false;}
}

async function doSaveBlob(blob,filename,w,h){
  // iOS: use Web Share API to offer "Save to Photos"
  if(navigator.share && /iPhone|iPad|iPod/.test(navigator.userAgent)){
    try{
      const file=new File([blob],filename,{type:blob.type});
      await navigator.share({files:[file]});
      return;
    }catch(e){/* user cancelled or share failed — fall through to download */}
  }
  const link=document.createElement('a');
  link.download=filename;
  link.href=URL.createObjectURL(blob);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}

async function exportSeparations(){
  const layers=activeLayers();
  if(!layers.length){R.toast('No channels to export');return;}
  if(!hasSrc){R.toast('No image loaded');return;}

  R.toast('Rendering separations…');

  const ts=Date.now();
  const dw=$gl.width, dh=$gl.height;
  gl.viewport(0,0,dw,dh);

  // Set separation mode
  gl.uniform1i(locs.u_sepMode,1);
  gl.uniform1i(locs.u_sepType,cached.sepType||0);
  gl.uniform1i(locs.u_layers,layers.length);
  gl.uniform2f(locs.u_res,dw,dh);
  gl.uniform1f(locs.u_grainSize,cached.grainSize);
  gl.uniform1f(locs.u_dotGain,cached.dotGain);
  gl.uniform1f(locs.u_inkNoise,cached.inkNoise);
  gl.uniform1f(locs.u_paperTex,cached.paperTex);
  gl.uniform1f(locs.u_static,cached.grainStatic);
  gl.uniform1f(locs.u_ghosting,cached.ghosting*0.01*(cached.ghostMul*0.01));
  gl.uniform1f(locs.u_bleed,0.0);
  gl.uniform1f(locs.u_resScale,resScale);
  gl.uniform1f(locs.u_frameSeed,frameSeed);
  gl.uniform1f(locs.u_bright,cached.imgBright);
  gl.uniform1f(locs.u_contrast,cached.imgContrast);
  gl.uniform1f(locs.u_sat,cached.imgSat);
  gl.uniform1f(locs.u_shadows,cached.imgShadows);
  gl.uniform1f(locs.u_screenCell,Math.max(1.5,Math.min(dw,dh)/(8.267*cached.lpi)));
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
  gl.uniform3fv(locs.u_paperColor,cached.paperColor);
  gl.uniform4f(locs.u_crop,cropRect[0],cropRect[1],cropRect[2],cropRect[3]);
  gl.uniform1i(locs.u_mode,mode==='grain'?0:1);
  gl.uniform4f(locs.u_printArea, 0.01, 0.01, 0.01, 0.01); // separations: minimal margins

  // In Approx mode, NNLS needs all ink colors uploaded simultaneously
  // so the shader can decompose each pixel against the full palette.
  if(cached.sepType===1){
    for(let j=0;j<layers.length;j++){
      const Lj=layers[j];
      const calJ=RISO_CAL[Lj.color];
      if(calJ){
        gl.uniform3f(inkLocs[j],calJ.lut[4][0],calJ.lut[4][1],calJ.lut[4][2]);
      } else {
        const rgb=cached.inkRGB[j];
        gl.uniform3f(inkLocs[j],rgb[0],rgb[1],rgb[2]);
      }
    }
  }

  // Render each separation and collect as blobs
  const files=[];
  for(let i=0;i<layers.length;i++){
    const L=layers[i];
    if(cached.sepType!==1){
      // CMYK mode: set u_ink0 to this layer's ink for getCoverage
      const cal=RISO_CAL[L.color];
      if(cal){
        const lt=cal.lut;
        gl.uniform3f(inkLocs[0],lt[4][0],lt[4][1],lt[4][2]);
        gl.uniform1f(locs.u_inkGamma0,cal.gamma);
        gl.uniform1f(locs.u_grainMul0,cal.grainMul);
        gl.uniform1f(locs.u_hasCal0,1.0);
      } else {
        const rgb=cached.inkRGB[i];
        gl.uniform3f(inkLocs[0],rgb[0],rgb[1],rgb[2]);
        gl.uniform1f(locs.u_inkGamma0,1.0);
        gl.uniform1f(locs.u_grainMul0,1.0);
        gl.uniform1f(locs.u_hasCal0,0.0);
      }
    } else {
      // Approx mode: ink colors already uploaded; just set grain/gamma per layer
      const cal=RISO_CAL[L.color];
      gl.uniform1f(locs.u_inkGamma0,cal?cal.gamma:1.0);
      gl.uniform1f(locs.u_grainMul0,cal?cal.grainMul:1.0);
    }
    gl.uniform2f(offLocs[0],misreg[L.ch][0],misreg[L.ch][1]);
    gl.uniform1f(skewLocs[0],layerSkews[L.ch]||0);
    gl.uniform1f(angLocs[0],(layerAngles[L.ch]||0)*0.01745329);
    // In Approx mode: u_chan0 = layer index (which NNLS weight to extract)
    // In CMYK mode: u_chan0 = CMYK channel index (C=0, M=1, Y=2, K=3)
    gl.uniform1i(chanLocs[0], cached.sepType===1 ? i : L.ch);
    gl.uniform1f(densLocs[0],cached.layerDens[L.ch]);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

    const colorName=L.color.replace(/[\s.]/g,'');
    const chName=CH_NAMES[L.ch];
    const filename='sep_'+chName+'_'+colorName+'_'+dw+'x'+dh+'.png';

    // Canvas toBlob as promise
    const blob=await new Promise(r=>{
      const tmpC=document.createElement('canvas');
      tmpC.width=dw;tmpC.height=dh;
      const ctx=tmpC.getContext('2d');
      ctx.drawImage($gl,0,0);
      tmpC.toBlob(b=>r(b),'image/png');
    });
    files.push({name:filename, blob});
  }

  // Restore normal mode
  gl.uniform1i(locs.u_sepMode,0);

  // Build zip
  const zip=new JSZip();
  files.forEach(f=>zip.file(f.name,f.blob));
  const zipBlob=await zip.generateAsync({type:'blob'});
  const names=layers.map(L=>L.color.replace(/[\s.]/g,'')).join('+');
  const zipName='riso_seps_'+names+'_'+dw+'x'+dh+'_'+ts+'.zip';

  // On mobile: share individual images (more useful than a zip for Photos)
  // Download as zip
  const link=document.createElement('a');
  link.download=zipName;
  link.href=URL.createObjectURL(zipBlob);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  R.toast(files.length+' separation'+(files.length>1?'s':'')+' saved!');
  markDirty();
}



// --- Namespace exports ---
R.getSaveAspect = getSaveAspect;
R.saveHiRes = saveHiRes;
R.saveGif = saveGif;
R.exportSeparations = exportSeparations;

})(window.R);
