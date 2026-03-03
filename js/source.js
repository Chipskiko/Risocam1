// SOURCE module
(function(R) {
"use strict";

// ======================== SOURCE MANAGEMENT ========================
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
function handleFile(e){
  const f=e.target.files[0];if(!f)return;
  const isVideo=f.type.startsWith('video/');
  const isGif=f.type==='image/gif'||f.name.toLowerCase().endsWith('.gif');
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
      if($vid.requestVideoFrameCallback){
        $vid.requestVideoFrameCallback(onVideoFrame);
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
        srcImg=img;
        // Upload to both source textures (no previous frame for static images)
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,window._srcTexA);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
        gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,window._srcTexB);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
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
    hasSrc=true;needsAspectUpdate=true;computeCrop();scheduleRender();
    $status.textContent='● SAMPLE';
    $res.textContent=w+'×'+h;
  };
  img.src=c.toDataURL('image/jpeg',0.92);
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
    }
    needsAspectUpdate=true;scheduleRender();
    $status.textContent=srcImg?'◉ IMAGE':'● READY';
    return;
  }
  try{
    stopVideo(); // stop any uploaded video before starting camera
    camStream=await navigator.mediaDevices.getUserMedia({video:{facingMode,width:{ideal:isPhone()?640:1280}}});
    $vid.srcObject=camStream;
    // Wait for video to actually start playing
    await $vid.play();
    camOn=true;needsAspectUpdate=true;computeCrop();scheduleRender();
    $gl.classList.toggle('mirrored',facingMode==='user');
    el('camBtn').textContent='STOP CAM';
    $status.textContent='● LIVE';
    hideOnboarding();
    // Use requestVideoFrameCallback if available (Chrome/Edge)
    if($vid.requestVideoFrameCallback){
      $vid.requestVideoFrameCallback(onVideoFrame);
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



// --- Namespace exports ---
R.pickFile = pickFile;
R.handleFile = handleFile;
R.stopVideo = stopVideo;
R.toggleCam = toggleCam;
R.startGifLoop = startGifLoop;
R.loadSampleImage = loadSampleImage;
R.showOnboarding = showOnboarding;
R.hideOnboarding = hideOnboarding;

})(window.R);
