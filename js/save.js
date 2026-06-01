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
// Format options:
//   'png'  → lossless PNG at full export resolution, preserves alpha (archival)
//   'jpg'  → JPEG q=0.95 capped at 2400px wide (sharing-optimized, small file)
async function saveHiRes(format){
  format = format || 'png';
  const isJpg = format === 'jpg' || format === 'jpeg';
  const mime = isJpg ? 'image/jpeg' : 'image/png';
  const ext  = isJpg ? 'jpg' : 'png';
  // JPG is for sharing — quality 0.95 is visually identical to lossless,
  // and capping at 2400px wide gives ~500KB–1MB files instead of multi-MB.
  const jpgQuality = 0.95;
  const jpgMaxW = 2400;
  _saving=true;
  try{
  const unique=[...new Set(channels.filter(c=>c))];
  const names=unique.join('-').replace(/[\s.]/g,'');
  const saveScale=Math.max(resScale,3);
  const ar=getSaveAspect();
  const baseSize=2400;
  let saveW,saveH;
  if(ar>=1){saveW=Math.round(baseSize*ar*saveScale/3);saveH=Math.round(baseSize*saveScale/3);}
  else{saveW=Math.round(baseSize*saveScale/3);saveH=Math.round(baseSize/ar*saveScale/3);}
  // Halftone mode: ensure enough pixels per cell for round dots (min 8px/cell)
  if(mode!=='grain'&&cached.lpi>0){
    const minShort=Math.ceil(12*8.267*cached.lpi);
    if(Math.min(saveW,saveH)<minShort){const s=minShort/Math.min(saveW,saveH);saveW=Math.round(saveW*s);saveH=Math.round(saveH*s);}
  }
  // Grain mode: ensure minimum 4000px short side for fine grain detail
  if(mode==='grain'&&Math.min(saveW,saveH)<4000){const s=4000/Math.min(saveW,saveH);saveW=Math.round(saveW*s);saveH=Math.round(saveH*s);}
  // Cap at GPU max texture size
  const maxTex=gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if(saveW>maxTex||saveH>maxTex){const s=maxTex/Math.max(saveW,saveH);saveW=Math.round(saveW*s);saveH=Math.round(saveH*s);}
  // JPG sharing-optimized cap
  if(isJpg && Math.max(saveW,saveH) > jpgMaxW){
    const s = jpgMaxW / Math.max(saveW,saveH);
    saveW = Math.round(saveW*s); saveH = Math.round(saveH*s);
  }
  saveW=saveW&~1;saveH=saveH&~1;
  const origW=$gl.width,origH=$gl.height;
  // Hide canvas during save to prevent visible stretch/flash
  const origCssW=$gl.style.width, origCssH=$gl.style.height;
  $gl.style.width=$gl.clientWidth+'px';
  $gl.style.height=$gl.clientHeight+'px';
  $gl.style.visibility='hidden';
  $gl.width=saveW;$gl.height=saveH;
  gl.viewport(0,0,saveW,saveH);
  const effectiveScale=Math.min(saveW,saveH)/(baseSize/3);
  R.setRenderUniforms(saveW,saveH,effectiveScale,false);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  const filename='risocam_'+(names||'empty')+'_'+saveW+'x'+saveH+'_'+Date.now()+'.'+ext;
  let blob;
  if(isJpg){
    // JPEG can't render the canvas alpha as transparency — flatten onto white
    // first so transparent areas show as paper-white instead of black.
    const flat = document.createElement('canvas');
    flat.width = saveW; flat.height = saveH;
    const fctx = flat.getContext('2d');
    fctx.fillStyle = '#ffffff';
    fctx.fillRect(0, 0, saveW, saveH);
    fctx.drawImage($gl, 0, 0);
    blob = await new Promise(r => flat.toBlob(b => r(b), 'image/jpeg', jpgQuality));
  } else {
    blob = await new Promise(r => $gl.toBlob(b => r(b), mime));
  }
  $gl.width=origW;$gl.height=origH;
  $gl.style.width=origCssW;$gl.style.height=origCssH;
  $gl.style.visibility='';
  markDirty();needsAspectUpdate=true;
  _saving=false;
  await doSaveBlob(blob,filename,saveW,saveH);
  }catch(e){console.error(ext.toUpperCase()+' save error:',e);R.toast('Save failed');}
  finally{_saving=false;}
}
// Convenience wrappers used by the toolbar buttons
function saveJpg(){ return saveHiRes('jpg'); }
function savePng(){ return saveHiRes('png'); }

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

// ─── Press-to-start/stop recording via MediaRecorder ──────────────────
// Hardware-accelerated capture of the live canvas. No per-frame encoding
// overhead, no palette quantization. Saves as .webm or .mp4 depending on
// browser support. Hard-capped at 30 seconds to bound memory.
const RECORD_MAX_SEC = 30;
window._recState = {recording:false, recorder:null, chunks:null, startMs:0, mime:'', timerId:0, autoStopId:0};

// Browser detection — Chrome's MediaRecorder claims H.264 support but the
// canvas-stream encoder fails. Safari's MediaRecorder works for MP4/HEVC.
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
const hasWebCodecsH264 = typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && !!window.Mp4Muxer;

// Pick the best MediaRecorder mime — Safari prefers HEVC for smaller files,
// other browsers fall back to WebM.
function pickRecordMime(){
  if(typeof MediaRecorder==='undefined' || !MediaRecorder.isTypeSupported) return null;
  const candidates = isSafari
    ? [
        'video/mp4;codecs=hvc1', // HEVC — Safari encodes natively, ~50% smaller
        'video/mp4;codecs=avc1.42E01E', // H.264 fallback
        'video/mp4',
        'video/webm;codecs=vp9', // shouldn't happen on Safari
        'video/webm',
      ]
    : [
        // Chrome/Firefox: WebM only (their MP4 encoders don't work on WebGL)
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4;codecs=avc1.42E01E', // last resort
        'video/mp4',
      ];
  for(const m of candidates) if(MediaRecorder.isTypeSupported(m)) return m;
  return null;
}


function updateRecordButton(label){
  const btn = document.querySelector('[onclick*="toggleRecording"]') || document.querySelector('[onclick*="saveGif"]');
  if(btn) btn.textContent = label;
}

const COUNTDOWN_SEC = 5;
window._countdownState = {active:false, intervalId:0, cancelled:false};

// Cancellable 5-second countdown shown only in the button text + a single
// initial toast. Clicking the button again during countdown cancels it.
function startCountdown(onComplete){
  let remaining = COUNTDOWN_SEC;
  window._countdownState = {active:true, intervalId:0, cancelled:false};
  updateRecordButton(remaining + '…');
  R.toast('Recording in ' + remaining + 's');
  window._countdownState.intervalId = setInterval(() => {
    if(window._countdownState.cancelled) return;
    remaining--;
    if(remaining > 0){
      updateRecordButton(remaining + '…');
    } else {
      clearInterval(window._countdownState.intervalId);
      window._countdownState.active = false;
      onComplete();
    }
  }, 1000);
}
function cancelCountdown(){
  clearInterval(window._countdownState.intervalId);
  window._countdownState.active = false;
  window._countdownState.cancelled = true;
  updateRecordButton('VID');
  R.toast('Cancelled');
}

// Pick an AVC level identifier for the given pixel count. Returns the
// hex byte (as a string) used as the third pair of the codec string
// (e.g. "28" for level 4.0, "3C" for 6.0).
function pickAvcLevel(pixels){
  if(pixels <= 2097152) return '28';   // 4.0 — up to 1920×1080
  if(pixels <= 2228224) return '2A';   // 4.2
  if(pixels <= 5242880) return '32';   // 5.0 — up to 2560×1920
  if(pixels <= 5652480) return '33';   // 5.1
  if(pixels <= 9437184) return '34';   // 5.2 — up to 4096×2160
  if(pixels <= 16777216) return '3C';  // 6.0 — up to 8192×4320
  if(pixels <= 33554432) return '3D';  // 6.1
  return '3E';                         // 6.2
}

// ─── WebCodecs + mp4-muxer path (Chrome/Edge) ─────────────────────────
// Bypasses MediaRecorder's broken H.264-from-WebGL pipeline by using
// VideoEncoder directly to encode H.264, then muxing to MP4 ourselves.
async function startWebCodecsRecording(){
  console.log('[REC] using WebCodecs+mp4-muxer (true MP4/H.264)');
  // Cap recording at 1920px wide to keep file sizes manageable and stay
  // inside hardware-encoder sweet-spot. The live canvas may be much larger
  // (4800px+ at high resScale) — that's wasted detail for a 30s clip.
  // Downscale via an intermediate canvas if needed.
  const RECORD_MAX_W = 1920;
  const cw = $gl.width, ch = $gl.height;
  const aspect = cw / ch;
  let w, h, useScratch;
  if(cw > RECORD_MAX_W){
    w = RECORD_MAX_W & ~1;
    h = Math.round(RECORD_MAX_W / aspect) & ~1;
    useScratch = true;
  } else {
    w = cw & ~1;
    h = ch & ~1;
    useScratch = false;
  }
  // Scratch canvas for downscaling each frame (only created if needed)
  let scratch = null, sctx = null;
  if(useScratch){
    scratch = document.createElement('canvas');
    scratch.width = w; scratch.height = h;
    sctx = scratch.getContext('2d');
    console.log('[REC] downscaling', cw+'×'+ch, '→', w+'×'+h);
  }
  // Set up the muxer (in-memory MP4 output)
  const Muxer = window.Mp4Muxer.Muxer;
  const ArrayBufferTarget = window.Mp4Muxer.ArrayBufferTarget;
  const target = new ArrayBufferTarget();
  let muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width: w,
      height: h,
      frameRate: 30,
    },
    fastStart: 'in-memory',
  });
  // Set up the encoder
  let encoder, encodeError = null;
  try {
    encoder = new VideoEncoder({
      output: (chunk, meta) => {
        try { muxer.addVideoChunk(chunk, meta); }
        catch(e){ console.error('[REC] mux err:', e); encodeError = e; }
      },
      error: (e) => { console.error('[REC] encoder err:', e); encodeError = e; },
    });
    // Pick AVC level appropriate for the actual recording resolution
    const lvl = pickAvcLevel(w * h);
    // Try H.264 profiles in priority order: high → main → baseline.
    // Profile codes: 0x64=high, 0x4D=main, 0x42=baseline
    const codecCandidates = [
      'avc1.6400' + lvl,   // High@<level>
      'avc1.4D00' + lvl,   // Main@<level>
      'avc1.4200' + lvl,   // Baseline@<level>
    ];
    let configured = false;
    for(const codec of codecCandidates){
      try {
        encoder.configure({
          codec,
          width: w,
          height: h,
          bitrate: 16_000_000,
          framerate: 30,
          avc: { format: 'avc' },
        });
        console.log('[REC] WebCodecs configured with', codec, 'at', w+'×'+h);
        configured = true;
        break;
      } catch(e){
        console.warn('[REC] codec', codec, 'failed:', e.message);
      }
    }
    if(!configured) throw new Error('No H.264 codec accepted for ' + w + '×' + h);
  } catch(e) {
    console.error('[REC] WebCodecs setup failed:', e);
    R.toast('MP4 setup failed — falling back to WebM');
    return startMediaRecorderRecording();
  }
  // Capture loop: every frame, grab canvas as VideoFrame, encode it
  const startMs = performance.now();
  isRecording = true;
  let frameCount = 0;
  let stopped = false;
  // Frame timestamp in microseconds (WebCodecs unit)
  const fps = 30;
  const frameDurationUs = Math.round(1_000_000 / fps);
  const captureLoop = async () => {
    if(stopped) return;
    const now = performance.now();
    const elapsed = (now - startMs) / 1000;
    if(elapsed >= RECORD_MAX_SEC){
      R.toast('Max recording length reached');
      window._recState.stopFn();
      return;
    }
    try {
      // Source for VideoFrame: either the live canvas direct, or downscaled
      // through a scratch 2D canvas if the live one's too big for H.264.
      let src;
      if(useScratch){
        sctx.drawImage($gl, 0, 0, w, h);
        src = scratch;
      } else {
        src = $gl;
      }
      const frame = new VideoFrame(src, {
        timestamp: frameCount * frameDurationUs,
        duration: frameDurationUs,
      });
      // Force a keyframe every ~1s so the file can be seeked
      const isKey = (frameCount % fps) === 0;
      encoder.encode(frame, { keyFrame: isKey });
      frame.close();
      frameCount++;
    } catch(e){
      console.error('[REC] frame encode err:', e);
    }
    if(encodeError){
      console.error('[REC] aborting due to encoder error');
      stopRecording();
      return;
    }
    // Schedule next frame at the FPS rate
    setTimeout(captureLoop, 1000 / fps);
  };
  // The "stop" function — captures everything, finalizes, downloads
  const stopFn = async () => {
    if(stopped) return;
    stopped = true;
    isRecording = false;
    if(encodeError){
      R.toast('Encoder error — recording aborted');
      try { encoder.close(); } catch(_){}
      return;
    }
    try {
      if(encoder.state !== 'closed') await encoder.flush();
      muxer.finalize();
      const blob = new Blob([target.buffer], { type: 'video/mp4' });
      if(blob.size === 0){
        R.toast('Recording produced empty file');
        return;
      }
      const filename = 'risocam_recording_' + Date.now() + '.mp4';
      doSaveBlob(blob, filename, w, h);
      R.toast('Saved ' + (blob.size/1024/1024).toFixed(2) + 'MB MP4');
    } catch(e) {
      console.error('[REC] finalize err:', e);
      R.toast('Finalize failed: ' + e.message);
    }
    try { if(encoder.state !== 'closed') encoder.close(); } catch(_){}
  };
  window._recState = {
    recording: true,
    stopFn,
    startMs,
    timerId: 0,
    autoStopId: 0,
    isWebCodecs: true,
  };
  window._recState.autoStopId = setTimeout(() => {
    if(window._recState.recording) stopFn();
  }, RECORD_MAX_SEC * 1000);
  window._recState.timerId = setInterval(() => {
    const elapsed = (performance.now() - window._recState.startMs) / 1000;
    updateRecordButton('● ' + elapsed.toFixed(1) + 's');
  }, 100);
  updateRecordButton('● 0.0s');
  R.toast('Recording MP4 — click VID to stop');
  // Start the capture loop on the next tick so UI updates first
  setTimeout(captureLoop, 0);
}

// ─── Entry point — choose path based on browser capabilities ─────────
function startRecording(){
  if(!hasSrc){R.toast('No source to record');return;}
  if(window._pdfDoc){R.toast('Recording disabled in PDF mode');return;}
  if(!$gl.captureStream && !hasWebCodecsH264){R.toast('Recording not supported in this browser');return;}
  // Chrome/Edge with WebCodecs + mp4-muxer → true MP4/H.264
  if(hasWebCodecsH264 && !isSafari){
    return startWebCodecsRecording();
  }
  // Safari (HEVC/H.264) or Firefox (WebM) → MediaRecorder
  startMediaRecorderRecording();
}

function startMediaRecorderRecording(){
  const mime = pickRecordMime();
  if(!mime){R.toast('Recording not supported in this browser');return;}
  if(!$gl.captureStream){R.toast('Canvas capture not supported');return;}
  console.log('[REC] starting, mime:', mime);
  // Use captureStream() with NO fps argument so frames are emitted on every
  // canvas commit (driven by the render loop). Passing an fps locks it to a
  // sampler that can miss frames on some browsers, especially when the
  // canvas isn't being actively redrawn at that exact rate.
  let stream;
  try { stream = $gl.captureStream(); }
  catch(e){ R.toast('Capture failed: '+e.message); return; }
  if(!stream || stream.getVideoTracks().length===0){
    R.toast('No video track from canvas');
    console.error('[REC] no video tracks. stream:', stream);
    return;
  }
  const track = stream.getVideoTracks()[0];
  console.log('[REC] track ready, state:', track.readyState, 'enabled:', track.enabled);
  const chunks = [];
  let recorder;
  try {
    recorder = new MediaRecorder(stream, {mimeType: mime, videoBitsPerSecond: 16_000_000});
  } catch(e) {
    R.toast('Recorder error: '+e.message);
    return;
  }
  recorder.ondataavailable = (e) => {
    console.log('[REC] dataavailable, size:', e.data ? e.data.size : 0);
    if(e.data && e.data.size>0) chunks.push(e.data);
  };
  recorder.onerror = (e) => {
    console.error('[REC] MediaRecorder error:', e);
    R.toast('Recorder error');
  };
  recorder.onstart = () => { console.log('[REC] recorder started, state:', recorder.state); };
  recorder.onstop = () => {
    console.log('[REC] recorder stopped. chunks:', chunks.length, 'total bytes:', chunks.reduce((a,c)=>a+c.size,0));
    // Stop the stream tracks so the camera "recording" indicator goes away
    try { stream.getTracks().forEach(t=>t.stop()); } catch(_){}
    // Also clear the keep-alive render pump
    if(window._recState.pumpId){clearInterval(window._recState.pumpId); window._recState.pumpId=0;}
    if(chunks.length===0){
      R.toast('No data recorded — try again');
      return;
    }
    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    const blob = new Blob(chunks, {type: mime.split(';')[0]});
    if(blob.size===0){
      R.toast('Recording was empty — try again');
      return;
    }
    const filename = 'risocam_recording_' + Date.now() + '.' + ext;
    doSaveBlob(blob, filename, $gl.width, $gl.height);
    R.toast('Saved '+(blob.size/1024/1024).toFixed(2)+'MB '+ext.toUpperCase());
  };
  // Tell the render loop to stay continuously active (avoids the idle-sleep
  // optimization that can leave the canvas un-redrawn during recording).
  isRecording = true;
  // Start with a 1-second timeslice so chunks accumulate during recording.
  recorder.start(1000);
  // Keep-alive render pump: forces a render every 33ms so captureStream
  // always has fresh frames even if the live render loop pauses for any
  // reason. Also pumps requestFrame() on the video track if available.
  const pumpId = setInterval(() => {
    markDirty();
    if(track && track.requestFrame){
      try { track.requestFrame(); } catch(_){}
    }
  }, 33);
  window._recState = {
    recording:true, recorder, chunks, stream, track, pumpId,
    startMs: performance.now(), mime,
    timerId: 0, autoStopId: 0
  };
  window._recState.autoStopId = setTimeout(() => {
    if(window._recState.recording){R.toast('Max recording length reached'); stopRecording();}
  }, RECORD_MAX_SEC * 1000);
  window._recState.timerId = setInterval(() => {
    const elapsed = (performance.now() - window._recState.startMs) / 1000;
    updateRecordButton('● ' + elapsed.toFixed(1) + 's');
  }, 100);
  updateRecordButton('● 0.0s');
  R.toast('Recording — click VID again to stop');
}

function stopRecording(){
  const s = window._recState;
  if(!s.recording) return;
  clearTimeout(s.autoStopId);
  clearInterval(s.timerId);
  isRecording = false;
  s.recording = false;
  updateRecordButton('VID');
  // WebCodecs path — different teardown
  if(s.isWebCodecs){
    if(s.stopFn) s.stopFn();
    return;
  }
  // MediaRecorder path
  if(s.pumpId){clearInterval(s.pumpId); s.pumpId=0;}
  try { if(s.recorder && s.recorder.state==='recording') s.recorder.requestData(); } catch(_){}
  setTimeout(() => {
    try { s.recorder.stop(); } catch(e){ console.error('[REC] stop err', e); }
  }, 100);
}

// Toggle entry-point used by the toolbar VID button:
//   - During countdown → cancel
//   - During recording → stop early
//   - Otherwise → start 5s countdown, then record
function toggleRecording(){
  if(window._countdownState.active){
    cancelCountdown();
    return;
  }
  if(window._recState.recording){
    stopRecording();
    return;
  }
  startCountdown(startRecording);
}

// Legacy duration cycle — kept for backward-compat but no-op now
function cycleGifDuration(){ R.toast('Recording is now press-to-start/stop'); }

async function saveGif(){
  if(window._pdfDoc){R.toast('GIF export disabled in PDF mode');return;}
  if(!hasSrc){R.toast('No image loaded');return;}
  _saving=true;
  try{
  const unique=[...new Set(channels.filter(c=>c))];
  const names=unique.join('-').replace(/[\s.]/g,'');
  const gifFps=risoFps||4;
  const targetDuration = window._gifDuration || 2;
  // Detect source type
  const hasAnimGif=gifFrames&&gifFrames.length>1;
  const hasVideoFile=videoOn&&!gifImg&&!gifFrames&&$vid.readyState>=2;
  const hasCamera=camOn&&$vid&&$vid.readyState>=2;
  const isLive=hasCamera||hasVideoFile; // sources that benefit from arm + live capture

  // 2-second arm countdown for live captures (camera or video file)
  // so the user can prepare what's in the frame
  if(isLive){
    for(let s=2; s>0; s--){
      R.toast('Recording in '+s+'…');
      await new Promise(r=>setTimeout(r, 1000));
    }
    R.toast('Recording!');
  }

  // Frame count & timing — output at riso FPS, subsample source
  const delay=Math.round(1000/gifFps);
  let totalFrames, srcDuration=0;
  if(hasAnimGif){
    for(let k=0;k<gifFrames.length;k++) srcDuration+=gifFrames[k].duration||100;
    srcDuration=Math.min(srcDuration/1000, targetDuration);
    totalFrames=Math.max(Math.round(srcDuration*gifFps), 4);
  }else if(hasVideoFile){
    srcDuration=Math.min($vid.duration||targetDuration, targetDuration);
    totalFrames=Math.max(Math.round(srcDuration*gifFps), 4);
  }else if(hasCamera){
    srcDuration=targetDuration; // user-selected camera capture length
    totalFrames=Math.max(Math.round(srcDuration*gifFps), 4);
  }else{
    totalFrames=Math.max(Math.round(gifFps*targetDuration), 4); // riso grain loop
  }
  // Output size at crop aspect ratio. Bumped from 800 → 1200 to better
  // match the visual look of the preview (smaller GIF = grain looks
  // proportionally tighter / less detail). 1200 is a reasonable balance
  // between visual fidelity and GIF file size.
  const maxGif=1200;
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
  const origVidTime=hasVideoFile?$vid.currentTime:0;
  const origVidPaused=hasVideoFile?$vid.paused:false;
  if(hasVideoFile)$vid.pause(); // pause uploaded video; CAMERA keeps streaming
  // Lock CSS size so the canvas display dimensions don't change while we
  // resize the GL buffer for output. Canvas STAYS VISIBLE so the user can
  // watch what's being captured (was hidden in previous version).
  const origCssW=$gl.style.width, origCssH=$gl.style.height;
  $gl.style.width=$gl.clientWidth+'px';
  $gl.style.height=$gl.clientHeight+'px';
  // Resize GL buffer to GIF output dimensions
  $gl.width=gw;$gl.height=gh;
  // Real-time pacing for live camera capture (so frames are temporally spaced)
  const captureStart=performance.now();
  for(let i=0;i<totalFrames;i++){
    // Upload source for this frame
    if(hasAnimGif){
      const outTimeMs=(i/gifFps)*1000;
      let accMs=0, srcIdx=0;
      for(let k=0;k<gifFrames.length;k++){
        accMs+=gifFrames[k].duration||100;
        if(accMs>outTimeMs){srcIdx=k;break;}
        srcIdx=k;
      }
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,window._srcTexA);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,gifFrames[srcIdx].canvas);
    }else if(hasVideoFile){
      // Seek video to this frame's timestamp
      const t=(i/gifFps)%($vid.duration||1);
      $vid.currentTime=t;
      await new Promise(r=>{$vid.onseeked=r;setTimeout(r,200);});
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,window._srcTexA);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,$vid);
    }else if(hasCamera){
      // Wait until the next "frame slot" so live camera frames are spaced
      // at the GIF FPS rate (real-time recording, not subsampled).
      const targetT=captureStart+(i*delay);
      const wait=targetT-performance.now();
      if(wait>0) await new Promise(r=>setTimeout(r, wait));
      // Upload current live camera frame
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,window._srcTexA);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,$vid);
    }
    // Vary riso grain/misreg per frame
    frameSeed=Math.random();
    frame=origFrame+i;
    R.newMisreg();
    gl.viewport(0,0,gw,gh);
    // Match grain density to the live preview by scaling resScale
    // proportionally to output-vs-preview width. Without this, smaller
    // GIF output renders grain that looks tighter/denser than preview.
    const previewW = parseFloat(origCssW)||$vf.clientWidth||1200;
    const matchScale = Math.max(1, (gw / previewW) * resScale);
    R.setRenderUniforms(gw,gh,matchScale,false);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    tmpCtx.drawImage($gl,0,0,gw,gh);
    enc.addFrame(tmpCtx);
    R.toast('Recording GIF ('+((i+1))+'/'+totalFrames+')…');
    await new Promise(r=>requestAnimationFrame(r));
  }
  // Restore buffer + CSS
  $gl.width=origW;$gl.height=origH;
  $gl.style.width=origCssW;$gl.style.height=origCssH;
  gl.viewport(0,0,origW,origH);
  frameSeed=origSeed;
  misreg=origMisreg;
  layerSkews=origSkews;
  frame=origFrame;
  if(hasVideoFile){
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
  if(!window.jspdf||!window.jspdf.jsPDF){R.toast('PDF library not loaded');return;}

  R.toast('Rendering separations…');
  _saving=true;
  try{

  const ts=Date.now();
  // High-res rendering at correct aspect ratio (matches saveHiRes logic)
  const ar=getSaveAspect();
  const baseSize=2400;
  const saveScale=Math.max(resScale,3);
  let dw,dh;
  if(ar>=1){dw=Math.round(baseSize*ar*saveScale/3);dh=Math.round(baseSize*saveScale/3);}
  else{dw=Math.round(baseSize*saveScale/3);dh=Math.round(baseSize/ar*saveScale/3);}
  // Halftone mode: ensure round dots
  if(mode!=='grain'&&cached.lpi>0){
    const minShort=Math.ceil(12*8.267*cached.lpi);
    if(Math.min(dw,dh)<minShort){const s=minShort/Math.min(dw,dh);dw=Math.round(dw*s);dh=Math.round(dh*s);}
  }
  // Cap at GPU max texture size
  const maxTex=gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if(dw>maxTex||dh>maxTex){const s=maxTex/Math.max(dw,dh);dw=Math.round(dw*s);dh=Math.round(dh*s);}
  dw=dw&~1;dh=dh&~1;
  // Hide canvas + lock CSS so the export resize isn't visible
  const origW=$gl.width, origH=$gl.height;
  const origCssW=$gl.style.width, origCssH=$gl.style.height;
  $gl.style.width=$gl.clientWidth+'px';
  $gl.style.height=$gl.clientHeight+'px';
  $gl.style.visibility='hidden';
  $gl.width=dw;$gl.height=dh;
  const effectiveScale=Math.min(dw,dh)/(baseSize/3);
  gl.viewport(0,0,dw,dh);

  // Set separation mode
  gl.uniform1i(locs.u_sepMode,1);
  gl.uniform1i(locs.u_sepType,cached.sepType||0);
  gl.uniform1i(locs.u_layers,layers.length);
  gl.uniform2f(locs.u_res,dw,dh);
  gl.uniform1f(locs.u_grainSize,cached.grainSize);
  // Master noise multiplier — every hardcoded noise effect in the
  // shader scales by u_simNoise; FLAT and SCREEN+Clean set it to 0.
  // Grain Touch no longer bypasses physical sim noise — paper texture +
  // ink jitter applies on top of the AMT-derived master.
  const _cleanRender = (mode === 'flat') || (mode === 'screen' && window._screenClean);
  gl.uniform1f(locs.u_simNoise, _cleanRender ? 0 : 1);
  gl.uniform1f(locs.u_dotGain,   cached.dotGain);
  gl.uniform1f(locs.u_inkNoise,  cached.inkNoise);
  gl.uniform1f(locs.u_screenClean, (mode === 'screen' && window._screenClean) ? 1.0 : 0.0);
  // Separations are per-ink halftone masters for actual printing — the paper is
  // the physical sheet, so the plates must be CLEAN of any paper texture
  // (both the legacy fiber field and the PBR substrate). Force both off.
  gl.uniform1f(locs.u_paperTex, 0.0);
  if(locs.u_usePaperPBR) gl.uniform1f(locs.u_usePaperPBR, 0.0);
  gl.uniform1f(locs.u_static,cached.grainStatic);
  gl.uniform1f(locs.u_ghosting,cached.ghosting*0.01*(cached.ghostMul*0.01));
  gl.uniform1f(locs.u_bleed,0.0);
  gl.uniform1f(locs.u_resScale,effectiveScale);
  gl.uniform1f(locs.u_frameSeed,frameSeed);
  gl.uniform1f(locs.u_bright,cached.imgBright);
  gl.uniform1f(locs.u_contrast,cached.imgContrast);
  gl.uniform1f(locs.u_sat,cached.imgSat);
  gl.uniform1f(locs.u_shadows,cached.imgShadows);
  gl.uniform1f(locs.u_highlights,cached.imgHighlights||0);
  // Post-processing — applied to source RGB before CMYK separation so seps reflect the preview
  gl.uniform1f(locs.u_postExposure,cached.postExposure||0);
  gl.uniform1f(locs.u_postContrast,cached.postContrast||0);
  gl.uniform1f(locs.u_postSat,cached.postSat||0);
  gl.uniform1f(locs.u_screenCell,Math.max(1.5,Math.min(dw,dh)/(8.267*cached.lpi)));
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
  gl.uniform3fv(locs.u_paperColor,cached.paperColor);
  gl.uniform4f(locs.u_crop,cropRect[0],cropRect[1],cropRect[2],cropRect[3]);
  gl.uniform1i(locs.u_mode, ({grain:0, screen:1, lines:2, flat:3})[mode] ?? 0);
  // SCREEN engine + per-mode unit-8 matrix bind (match live render path).
  if(locs.u_screenType) gl.uniform1f(locs.u_screenType, (window._screenType ?? 0) ? 1.0 : 0.0);
  if(window._amScreenTex && window._ht5MatrixTex){
    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, (mode==='screen') ? window._amScreenTex : window._ht5MatrixTex);
    gl.activeTexture(gl.TEXTURE0);
  }
  gl.uniform1i(locs.u_lineShape, window._lineShape||0);
  gl.uniform1f(locs.u_lineAmount, window._lineAmount ?? 1.0);
  gl.uniform1f(locs.u_lineWeight, window._lineWeight ?? 1.0);
  gl.uniform1f(locs.u_lineRoughness, window._lineRoughness ?? 0.5);
  // Per-layer line center (CONCENTRIC/RADIAL pivot per plate). Falls
  // back to 0.5/0.5 (image center) when arrays not initialized.
  for(let li=0; li<4; li++){
    const L = (li < layers.length) ? layers[li] : null;
    const ch = L ? L.ch : li;
    gl.uniform2f(locs['u_lineCenter'+li],
      (typeof layerLineCenterX !== 'undefined' && layerLineCenterX[ch] != null) ? layerLineCenterX[ch] : 0.5,
      (typeof layerLineCenterY !== 'undefined' && layerLineCenterY[ch] != null) ? layerLineCenterY[ch] : 0.5);
  }
  gl.uniform1f(locs.u_lineEdgeThickness, window._lineEdgeThickness ?? 0.0);
  gl.uniform1f(locs.u_lineCount, window._lineCount ?? 1.0);
  gl.uniform1f(locs.u_colorQuant, window._colorQuant ?? 0.0);
  gl.uniform1f(locs.u_useLabResidual, window._useLabResidual ? 1.0 : 0.0);
  gl.uniform1f(locs.u_warmCool, (cached.warmCool ?? 0) * 0.02);
  gl.uniform1i(locs.u_stampShape, window._stampShape || 0);
  gl.uniform1f(locs.u_ditherScale, window._ditherScale ?? 1.0);
  // Text routing — same as render path so separation exports respect the
  // PDF-mode text channel choice (text appears only on its routed plate).
  gl.uniform1i(locs.u_textLayerIdx, (typeof getTextLayerIdx === 'function') ? getTextLayerIdx() : -1);
  gl.uniform1f(locs.u_textKnockout, (typeof textKnockout !== 'undefined' && textKnockout) ? 1.0 : 0.0);
  gl.uniform1f(locs.u_trappingPx, (typeof trappingPx !== 'undefined') ? trappingPx : 0.0);
  // Knockout doesn't apply in separation output (one channel at a time) —
  // explicitly clear so the uniforms have a defined value.
  for(let i=0;i<4;i++) gl.uniform1f(locs['u_knockout'+i], 0.0);
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

  // Render each separation, then GROUP BY INK COLOR: a real Riso uses one drum
  // per ink, so two channel slots that share a color must export as ONE plate
  // (their halftones combined), not two. We render every layer's plate, then
  // darken-composite (per-pixel min = ink-present-in-either) all plates of the
  // same color into a single canvas → one PDF page per unique color.
  const colorOrder=[];                 // unique colors, first-seen order
  const colorGroups={};                // color -> {canvas, ctx, channels:[]}
  for(let i=0;i<layers.length;i++){
    const L=layers[i];
    if(cached.sepType!==1){
      // CMYK mode: set u_ink0 to this layer's ink for getCoverage
      const cal=RISO_CAL[L.color];
      if(cal){
        const lt=cal.lut;
        gl.uniform3f(inkLocs[0],lt[4][0],lt[4][1],lt[4][2]);
        gl.uniform1f(locs.u_grainMul0,cal.grainMul);
        gl.uniform1f(locs.u_inkGamma0,cal.gamma||1.0);
        gl.uniform1f(locs.u_hasCal0,1.0);
      } else {
        const rgb=cached.inkRGB[i];
        gl.uniform3f(inkLocs[0],rgb[0],rgb[1],rgb[2]);
        gl.uniform1f(locs.u_grainMul0,1.0);
        gl.uniform1f(locs.u_inkGamma0,1.0);
        gl.uniform1f(locs.u_hasCal0,0.0);
      }
    } else {
      // Approx mode: ink colors already uploaded; just set grain per layer
      const cal=RISO_CAL[L.color];
      gl.uniform1f(locs.u_grainMul0,cal?cal.grainMul:1.0);
      gl.uniform1f(locs.u_inkGamma0,cal?cal.gamma||1.0:1.0);
    }
    gl.uniform2f(offLocs[0],misreg[L.ch][0],misreg[L.ch][1]);
    gl.uniform1f(skewLocs[0],layerSkews[L.ch]||0);
    gl.uniform1f(angLocs[0],(layerAngles[L.ch]||0)*0.01745329);
    // In Approx mode: u_chan0 = layer index (which NNLS weight to extract)
    // In CMYK mode: u_chan0 = CMYK channel index (C=0, M=1, Y=2, K=3)
    gl.uniform1i(chanLocs[0], cached.sepType===1 ? i : L.ch);
    gl.uniform1f(densLocs[0],cached.layerDens[L.ch]);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

    // Snapshot this layer's plate to an opaque temp canvas (white bg, no alpha).
    const tmpC=document.createElement('canvas');
    tmpC.width=dw;tmpC.height=dh;
    const ctx=tmpC.getContext('2d');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,dw,dh);
    ctx.drawImage($gl,0,0);
    // Merge into this color's group canvas. 'darken' keeps the darker pixel
    // (more ink), i.e. the union of both channels' halftones on one drum.
    let grp=colorGroups[L.color];
    if(!grp){
      const gc=document.createElement('canvas'); gc.width=dw; gc.height=dh;
      const gx=gc.getContext('2d'); gx.fillStyle='#fff'; gx.fillRect(0,0,dw,dh);
      grp={canvas:gc, ctx:gx, channels:[]};
      colorGroups[L.color]=grp; colorOrder.push(L.color);
    }
    grp.ctx.globalCompositeOperation='darken';
    grp.ctx.drawImage(tmpC,0,0);
    grp.ctx.globalCompositeOperation='source-over';
    grp.channels.push(CH_NAMES[L.ch]);
    R.toast('Rendered '+(i+1)+'/'+layers.length+' ('+L.color+')');
    await new Promise(r=>requestAnimationFrame(r));
  }

  // One page per unique color (combined plate). Channel label lists the slots
  // that share this ink, e.g. "C+M".
  const pages=[];
  for(const color of colorOrder){
    const grp=colorGroups[color];
    pages.push({
      color,
      colorName: color.replace(/[\s.]/g,''),
      channel: grp.channels.join('+'),
      dataUrl: grp.canvas.toDataURL('image/jpeg',0.85)
    });
  }

  // Restore normal mode + canvas
  gl.uniform1i(locs.u_sepMode,0);
  $gl.width=origW;$gl.height=origH;
  $gl.style.width=origCssW;$gl.style.height=origCssH;
  $gl.style.visibility='';
  gl.viewport(0,0,origW,origH);
  markDirty();needsAspectUpdate=true;
  _saving=false;

  // Build single multi-page PDF — one page per color separation
  R.toast('Building PDF…');
  const {jsPDF}=window.jspdf;
  // Page size in points (PDF unit). Use 72 DPI baseline; pages match image aspect.
  const ptPerPx=72/300; // assume 300 DPI when calculating page size
  const pageW=dw*ptPerPx, pageH=dh*ptPerPx;
  const pdf=new jsPDF({orientation:pageW>=pageH?'landscape':'portrait', unit:'pt', format:[pageW,pageH], compress:true});
  pdf.setProperties({title:'RISO Separations', subject:'Color separations for risograph printing', creator:'RISO/CAM'});
  for(let i=0;i<pages.length;i++){
    const p=pages[i];
    if(i>0) pdf.addPage([pageW,pageH], pageW>=pageH?'landscape':'portrait');
    pdf.addImage(p.dataUrl, 'JPEG', 0, 0, pageW, pageH, undefined, 'FAST');
    // Add page label / metadata so PDF readers show the color name
    if(pdf.setPage) pdf.setPage(i+1);
    // Use outline (bookmark) so each page is named by color
    if(pdf.outline && pdf.outline.add){
      try{ pdf.outline.add(null, p.colorName+' ('+p.channel+')', {pageNumber:i+1}); }catch(e){}
    }
  }
  const colorNames=pages.map(p=>p.colorName).join('+');
  const filename='riso_seps_'+colorNames+'_'+dw+'x'+dh+'_'+ts+'.pdf';
  const pdfBlob=pdf.output('blob');
  // Free dataURL strings (each ~10 MB at hi-res) before saving
  for(const p of pages) p.dataUrl=null;
  pages.length=0;
  await doSaveBlob(pdfBlob, filename, dw, dh);
  R.toast(pages.length+' separation'+(pages.length>1?'s':'')+' saved as PDF');
  }catch(e){
    console.error('Separations export error:',e);
    R.toast('Export failed: '+(e.message||e));
    // Clean up canvas state on error
    try{
      gl.uniform1i(locs.u_sepMode,0);
      // Best-effort restore canvas dimensions if mid-loop crash occurred
      const cw=$gl.clientWidth, chh=$gl.clientHeight;
      if(cw>0&&chh>0){$gl.width=cw;$gl.height=chh;gl.viewport(0,0,cw,chh);}
      $gl.style.visibility='';
      $gl.style.width='';$gl.style.height='';
      markDirty();needsAspectUpdate=true;
    }catch(_){}
  }finally{
    _saving=false;
  }
}



// ─── Multi-page PDF export ──────────────────────────────────────────────
// Renders every page of the loaded PDF through the riso shader and bundles
// them into a single PDF. Output dimensions match the source PDF's native
// page sizes (in points), so reprinting matches the original page geometry.
//
// For non-PDF sources, falls back to a single-page PDF of the current view.
async function savePdf(){
  if(!hasSrc){R.toast('No image loaded');return;}
  if(!window.jspdf||!window.jspdf.jsPDF){R.toast('PDF library not loaded');return;}
  const isPdfMode=!!window._pdfDoc;
  _saving=true;
  try{
    const ts=Date.now();
    const {jsPDF}=window.jspdf;
    let pdf=null;
    const pages=isPdfMode ? window._pdfMeta.length : 1;
    const origActive=window._pdfActiveIdx||0;
    // Snapshot canvas state once (we'll restore at the end / on error)
    const origW=$gl.width, origH=$gl.height;
    const origCssW=$gl.style.width, origCssH=$gl.style.height;
    $gl.style.width=$gl.clientWidth+'px';
    $gl.style.height=$gl.clientHeight+'px';
    $gl.style.visibility='hidden';

    // Pipeline trick: pre-render PDF page i+1 while WebGL processes page i.
    // PDF rasterization is CPU-bound; WebGL render + JPEG encode is GPU+CPU.
    // Overlapping them gives a ~30-40% speedup on multi-page exports.
    let nextPdfRender=null;
    if(isPdfMode){
      const m0=window._pdfMeta[0];
      nextPdfRender=R.renderPdfPage(window._pdfDoc, 1, Math.min(2400, m0.nativeW*3));
    }
    // Persist current page's edits (if it's master/variation) so the export uses them
    if(isPdfMode && typeof R.pdfPersistCurrent==='function') R.pdfPersistCurrent();
    // Rasterize PDF pages at the actual export raster size for sharpness.
    // (Avoids the 2400px cap that thumbnails/preview use, which would force
    // the GPU to bilinear-upsample fine PDF text/lines.)
    const exportRasterW=(m)=>{
      const targetPx=Math.round(m.nativeW*(300/72));
      const cap=gl.getParameter(gl.MAX_TEXTURE_SIZE);
      return Math.min(targetPx, cap);
    };
    // Re-prime the pipelined render at full export resolution
    if(isPdfMode){
      const m0=window._pdfMeta[0];
      nextPdfRender=R.renderPdfPage(window._pdfDoc, 1, exportRasterW(m0));
    }
    for(let i=0;i<pages;i++){
      // Switch source to this page (PDF mode only)
      if(isPdfMode){
        const c=await nextPdfRender;
        // Kick off the next page's PDF render while we process this one
        if(i+1<pages){
          const mNext=window._pdfMeta[i+1];
          nextPdfRender=R.renderPdfPage(window._pdfDoc, i+2, exportRasterW(mNext));
        }
        // Apply this page's per-page settings (variation if exists, else master)
        window._pdfActiveIdx=i;
        if(typeof R.pdfApplyForActive==='function') R.pdfApplyForActive();
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,window._srcTexA);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);
        gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,window._srcTexB);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);
        srcImg=c; needsAspectUpdate=true; computeCrop();
        R.toast('Rendering page '+(i+1)+'/'+pages+'…');
      }
      // Determine raster size — match input PDF native dims @ 300dpi when in
      // PDF mode (so output prints at the original page size). For non-PDF
      // sources, fall through to the standard saveHiRes formula.
      let rasterW, rasterH, pageWpt, pageHpt;
      if(isPdfMode){
        const m=window._pdfMeta[i];
        pageWpt=m.nativeW; pageHpt=m.nativeH;
        // Native dims are in PDF points (1 pt = 1/72 inch). At 300dpi raster:
        const rasterScale=300/72;
        rasterW=Math.round(m.nativeW*rasterScale);
        rasterH=Math.round(m.nativeH*rasterScale);
      } else {
        const ar=getSaveAspect();
        const baseSize=2400, saveScale=Math.max(resScale,3);
        if(ar>=1){rasterW=Math.round(baseSize*ar*saveScale/3);rasterH=Math.round(baseSize*saveScale/3);}
        else{rasterW=Math.round(baseSize*saveScale/3);rasterH=Math.round(baseSize/ar*saveScale/3);}
        pageWpt=rasterW*72/300; pageHpt=rasterH*72/300;
      }
      // Cap at GPU max texture
      const maxTex=gl.getParameter(gl.MAX_TEXTURE_SIZE);
      if(rasterW>maxTex||rasterH>maxTex){
        const s=maxTex/Math.max(rasterW,rasterH);
        rasterW=Math.round(rasterW*s); rasterH=Math.round(rasterH*s);
      }
      rasterW=rasterW&~1; rasterH=rasterH&~1;
      // Render through the riso shader at the target raster size
      $gl.width=rasterW; $gl.height=rasterH;
      gl.viewport(0,0,rasterW,rasterH);
      const baseSize=2400;
      const effectiveScale=Math.min(rasterW,rasterH)/(baseSize/3);
      R.setRenderUniforms(rasterW,rasterH,effectiveScale,false);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      // Encode JPEG. Try OffscreenCanvas.convertToBlob (non-blocking, can
      // run on browser worker thread) first; fall back to toDataURL.
      let dataUrl;
      if(typeof OffscreenCanvas!=='undefined' && $gl.transferToImageBitmap){
        // Copy WebGL output to an OffscreenCanvas (which can encode off-thread)
        try{
          const bitmap=await createImageBitmap($gl);
          const oc=new OffscreenCanvas(rasterW, rasterH);
          oc.getContext('bitmaprenderer').transferFromImageBitmap(bitmap);
          const blob=await oc.convertToBlob({type:'image/jpeg', quality:0.92});
          dataUrl=await new Promise(res=>{
            const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(blob);
          });
        }catch(_){
          dataUrl=$gl.toDataURL('image/jpeg', 0.92);
        }
      } else {
        dataUrl=$gl.toDataURL('image/jpeg', 0.92);
      }
      // Add to PDF (first page initialises the document)
      if(!pdf){
        pdf=new jsPDF({orientation: pageWpt>=pageHpt?'landscape':'portrait', unit:'pt', format:[pageWpt, pageHpt], compress:true});
        pdf.setProperties({title:'RISO/CAM Output', creator:'RISO/CAM'});
      } else {
        pdf.addPage([pageWpt, pageHpt], pageWpt>=pageHpt?'landscape':'portrait');
      }
      pdf.addImage(dataUrl, 'JPEG', 0, 0, pageWpt, pageHpt, undefined, 'FAST');
    }
    // Restore canvas + active page
    $gl.width=origW; $gl.height=origH;
    $gl.style.width=origCssW; $gl.style.height=origCssH;
    $gl.style.visibility='';
    gl.viewport(0,0,origW,origH);
    if(isPdfMode){
      // Re-upload the originally-active page (preview-resolution) so the
      // viewfinder shows what the user saw before exporting, and restore
      // its settings.
      const m=window._pdfMeta[origActive];
      const c=await R.renderPdfPage(window._pdfDoc, origActive+1, Math.min(2400, m.nativeW*3));
      window._pdfActiveIdx=origActive;
      if(typeof R.pdfApplyForActive==='function') R.pdfApplyForActive();
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,window._srcTexA);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);
      gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,window._srcTexB);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);
      srcImg=c;
    }
    markDirty(); needsAspectUpdate=true;
    const filename='risocam_'+pages+'page'+(pages>1?'s':'')+'_'+ts+'.pdf';
    const blob=pdf.output('blob');
    await doSaveBlob(blob, filename, 0, 0);
    R.toast(pages+' page'+(pages>1?'s':'')+' saved as PDF');
  }catch(e){
    console.error('PDF export error:',e);
    R.toast('PDF export failed: '+(e.message||e));
    try{
      const cw=$gl.clientWidth, chh=$gl.clientHeight;
      if(cw>0&&chh>0){$gl.width=cw;$gl.height=chh;gl.viewport(0,0,cw,chh);}
      $gl.style.visibility=''; $gl.style.width=''; $gl.style.height='';
      markDirty();needsAspectUpdate=true;
    }catch(_){}
  }finally{
    _saving=false;
  }
}

// --- Namespace exports ---
R.getSaveAspect = getSaveAspect;
R.saveHiRes = saveHiRes;
R.saveJpg = saveJpg;
R.savePng = savePng;
R.saveGif = saveGif;
R.cycleGifDuration = cycleGifDuration;
R.toggleRecording = toggleRecording;
R.savePdf = savePdf;
R.exportSeparations = exportSeparations;

})(window.R);
