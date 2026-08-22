// PHONE module
(function(R) {
"use strict";

// ======================== BOOT ========================
// ======================== PHONE UI ========================
let phoneMode='photo'; // 'photo' or 'video'
let recStart=0, recTimer=null;
let currentOverlay=null;
let lastLayoutPhone=null; // track layout switches
let phBcsOpen=false;

const ASPECT_CYCLE=['fit',[1,1],[4,3],[3,4],[5,4],[4,5],[16,9],[9,16]];
const ASPECT_LABELS=['FIT','1:1','4:3','3:4','5:4','4:5','16:9','9:16'];
let aspectIdx=0; // default FIT — matches the desktop default


// Crop guide: shows what area will be saved when aspect is set
function updateCropGuide(canvasW,canvasH,srcW,srcH){
  const guide=el('phCropGuide');
  if(!guide)return;
  // In phone mode, canvas shape IS the crop — no guide needed
  guide.classList.remove('visible');
}

// Desktop crop guide
function setPhoneMode(m){
  phoneMode=m;
  const toggle=el('phModeToggle');
  if(toggle) toggle.textContent=m==='photo'?'PHOTO':'VIDEO';
  if(isRecording) phStopRec();
  if(m==='video'){
    const sh=el('phShutter');if(sh)sh.classList.remove('recording');
    if(!camOn) R.toggleCam();
  }
}

function phReset(){
  // Full state reset without reloading
  if(camOn){
    if(camStream)camStream.getTracks().forEach(t=>t.stop());
    camOn=false;
  }
  if(isRecording) phStopRec();
  // Reset misregistration
  R.newMisreg();
  // Re-init GL state
  needsAspectUpdate=true;
  markDirty();
  // Restart camera
  setTimeout(()=>{if(!camOn) R.toggleCam();},200);
  R.toast('RESET');
}

function phCycleMode(){
  // Same order as the desktop header: GRAIN → RISO → SCREEN → LINES → LETTERS
  // LETTERS and STIPPLE withdrawn from the product (both broken). The code
  // paths remain so this is a one-line restore; they are simply not offered.
  const PH_MODES=['grain','flat','screen','lines'];
  const PH_LABELS={grain:'GRAIN', flat:'RISO', screen:'SCREEN', lines:'LINES', letters:'LETTERS', stipple:'STIPPLE'};
  const i=PH_MODES.indexOf(mode);
  mode=PH_MODES[(i+1) % PH_MODES.length];
  R.setMode(mode);
  const btn=el('phModeBtn');
  if(btn) btn.textContent=PH_LABELS[mode]||mode.toUpperCase();
}

function phCycleAspect(){
  aspectIdx=(aspectIdx+1)%ASPECT_CYCLE.length;
  setAspect(ASPECT_CYCLE[aspectIdx]);
  const btn=el('phAspectBtn');
  if(btn) btn.textContent=ASPECT_LABELS[aspectIdx];
}

const FPS_CYCLE=[0,4,8,12,24];
let fpsIdx=1; // default 4fps
function phCycleFps(){
  fpsIdx=(fpsIdx+1)%FPS_CYCLE.length;
  R.setRisoFps(FPS_CYCLE[fpsIdx]);
}

function phToggleBcs(){
  phBcsOpen=!phBcsOpen;
  const strip=el('phBcsStrip');
  const btn=el('phBcsBtn');
  const tools=el('phTools');
  const actions=document.querySelector('.ph-actions');
  if(strip) strip.classList.toggle('visible',phBcsOpen);
  if(btn) btn.classList.toggle('highlight',phBcsOpen);
  // Sync arc slider positions
  if(phBcsOpen){
    syncArcSliders();
  }
}

function syncArcSliders(){
  document.querySelectorAll('.ph-bcs-arc').forEach(svg=>{
    const path=svg.querySelector('.ph-bcs-track');
    const thumb=svg.querySelector('.ph-bcs-thumb');
    const key=svg.dataset.key;
    const val=cached[key]||0;
    const t=(val+30)/60;
    const len=path.getTotalLength();
    const pt=path.getPointAtLength(t*len);
    thumb.setAttribute('cx',pt.x);
    thumb.setAttribute('cy',pt.y);
    const valEl=svg.querySelector('.ph-bcs-svg-val');
    if(valEl) valEl.textContent=val;
  });
}

let _bcsBound=false;
function phBindBcs(){
  if(_bcsBound)return;
  _bcsBound=true;
  document.querySelectorAll('.ph-bcs-arc').forEach(svg=>{
    const path=svg.querySelector('.ph-bcs-track');
    const thumb=svg.querySelector('.ph-bcs-thumb');
    const key=svg.dataset.key;
    const valEl=svg.querySelector('.ph-bcs-svg-val');
    const len=path.getTotalLength();
    function setNorm(t){
      t=Math.max(0,Math.min(1,t));
      const pt=path.getPointAtLength(t*len);
      thumb.setAttribute('cx',pt.x);
      thumb.setAttribute('cy',pt.y);
      const v=Math.round((t*60-30)/2)*2;
      cached[key]=v;
      if(valEl) valEl.textContent=v;
      const desk=el(key);if(desk)desk.value=v;
      const dv=el(key+'Val');if(dv)dv.textContent=v;
      markDirty();
    }
    // Initial position
    const initT=((cached[key]||0)+30)/60;
    const initPt=path.getPointAtLength(initT*len);
    thumb.setAttribute('cx',initPt.x);
    thumb.setAttribute('cy',initPt.y);
    function ptrToNorm(e){
      // Under the landscape counter-rotation (ph-ls-cw/-ccw) the arc's local
      // x axis runs vertically on screen and getBoundingClientRect returns
      // the swapped AABB, so project the pointer through the active rotation.
      const r=svg.getBoundingClientRect();
      const b=document.body.classList;
      let t;
      if(b.contains('ph-ls-cw')) t=(e.clientY-r.top)/r.height;
      else if(b.contains('ph-ls-ccw')) t=(r.bottom-e.clientY)/r.height;
      else t=(e.clientX-r.left)/r.width;
      // Arc spans x=4..296 in viewBox 0..300, map pointer to arc range
      const svgX=t*300;
      return (svgX-4)/(296-4);
    }
    svg.addEventListener('pointerdown',e=>{
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      svg.classList.add('dragging');
      setNorm(ptrToNorm(e));
    });
    svg.addEventListener('pointermove',e=>{
      if(!svg.classList.contains('dragging'))return;
      setNorm(ptrToNorm(e));
    });
    svg.addEventListener('pointerup',()=>svg.classList.remove('dragging'));
    svg.addEventListener('pointercancel',()=>svg.classList.remove('dragging'));
  });
}

async function phFlipCam(){
  // Re-entrancy guard: a double-tap on the flip button would interleave two
  // async flips — tracks stopped twice, camStream overwritten, and the loser's
  // stream leaked as an orphaned live track.
  if(window._camBusy) return;
  if(!camOn){
    // Camera not active — start it
    R.stopVideo();
    R.toggleCam();
    return;
  }
  window._camBusy=true;
  try{
  const newFacing=facingMode==='environment'?'user':'environment';
  if(camStream){camStream.getTracks().forEach(t=>t.stop());camStream=null;}
  $vid.srcObject=null;
  camOn=false;
  // Try exact constraint first, then ideal as fallback
  const constraints=[
    {video:{facingMode:{exact:newFacing},width:{ideal:R.isPhone()?640:1280}}},
    {video:{facingMode:newFacing,width:{ideal:R.isPhone()?640:1280}}}
  ];
  for(const c of constraints){
    try{
      const s=await navigator.mediaDevices.getUserMedia(c);
      facingMode=newFacing;
      camStream=s;
      if(R.bindCamTrackEnd)R.bindCamTrackEnd(s);
      $vid.srcObject=s;
      await $vid.play();
      camOn=true;needsAspectUpdate=true;computeCrop();scheduleRender();
      $gl.classList.toggle('mirrored',facingMode==='user');
      if($vid.requestVideoFrameCallback) R.onVideoFrame(); // start the generation-guarded rVFC loop (once)
      else{if(window._camFallback)clearInterval(window._camFallback);window._camFallback=setInterval(()=>{if(camOn&&$vid.readyState>=2){videoFrameReady=true;scheduleRender();}else if(!camOn)clearInterval(window._camFallback);},50);}
      return;
    }catch(e){/* try next constraint */}
  }
  // All failed — try to restore previous camera
  try{
    const s=await navigator.mediaDevices.getUserMedia({video:{facingMode,width:{ideal:R.isPhone()?640:1280}}});
    camStream=s;if(R.bindCamTrackEnd)R.bindCamTrackEnd(s);$vid.srcObject=s;await $vid.play();
    camOn=true;needsAspectUpdate=true;computeCrop();scheduleRender();
    $gl.classList.toggle('mirrored',facingMode==='user');
    if($vid.requestVideoFrameCallback) R.onVideoFrame(); // start the generation-guarded rVFC loop (once)
    else{if(window._camFallback)clearInterval(window._camFallback);window._camFallback=setInterval(()=>{if(camOn&&$vid.readyState>=2){videoFrameReady=true;scheduleRender();}else if(!camOn)clearInterval(window._camFallback);},50);}
    R.toast('Only one camera available');
  }catch(e){R.toast('Camera error');}
  }finally{window._camBusy=false;}
}

// Shutter: tap = save photo, long-press (hold) = record video until release
let _shutterTimer=0, _shutterIsLong=false;
function initShutter(){
  const btn=el('phShutter');
  if(!btn)return;
  const haptic=(ms)=>{try{navigator.vibrate(ms);}catch(e){}};
  const startHold=(e)=>{
    e.preventDefault();
    haptic(10);
    _shutterIsLong=false;
    _shutterTimer=setTimeout(()=>{
      _shutterIsLong=true;
      haptic(30);
      phStartRec();
    },400);
  };
  const endHold=(e)=>{
    e.preventDefault();
    clearTimeout(_shutterTimer);
    if(_shutterIsLong){
      haptic(15);
      phStopRec();
    } else {
      // Phone captures save as JPEG: ~10× smaller than PNG, encodes in a
      // fraction of the time on A-series, and iOS Photos handles it
      // natively. (HEIC can't be encoded from a web canvas — Safari's
      // toBlob only does PNG/JPEG.) The header PNG button still gives
      // lossless on demand.
      R.saveHiRes('jpg');
    }
  };
  btn.addEventListener('touchstart',startHold,{passive:false});
  btn.addEventListener('touchend',endHold,{passive:false});
  btn.addEventListener('touchcancel',endHold,{passive:false});
  // Mouse fallback for desktop testing
  btn.addEventListener('mousedown',startHold);
  btn.addEventListener('mouseup',endHold);

  // Double-tap viewfinder to re-reg
  let _lastTap=0;
  const vf=el('phViewfinder');
  if(vf) vf.addEventListener('touchend',(e)=>{
    const now=Date.now();
    if(now-_lastTap<300){
      e.preventDefault();
      R.newMisreg();
      try{navigator.vibrate(8);}catch(e){}
    }
    _lastTap=now;
  },{passive:false});
}

function phStartRec(){
  const stream=$gl.captureStream(risoFps);
  if(typeof MediaRecorder==='undefined'){R.toast('Recording not supported');return;}
  let mimeType='video/mp4';
  let ext='mp4';
  if(!MediaRecorder.isTypeSupported(mimeType)){
    mimeType='video/webm;codecs=vp9';ext='webm';
    if(!MediaRecorder.isTypeSupported(mimeType)){
      mimeType='video/webm';
      if(!MediaRecorder.isTypeSupported(mimeType)){R.toast('No recording codec');return;}
    }
  }
  window._recMime=mimeType;window._recExt=ext;
  window._recChunks=[];
  window._recorder=new MediaRecorder(stream,{mimeType});
  window._recorder.ondataavailable=e=>{if(e.data.size>0)window._recChunks.push(e.data);};
  window._recorder.onstop=async()=>{
    const blob=new Blob(window._recChunks,{type:window._recMime});
    const filename='riso_'+Date.now()+'.'+window._recExt;
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=filename;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    // silent save
  };
  window._recorder.start(100);
  isRecording=true;recStart=Date.now();
  el('phShutter').classList.add('recording');
  const badge=el('phRecBadge');badge.classList.add('show');
  recTimer=setInterval(()=>{
    const s=Math.floor((Date.now()-recStart)/1000);
    badge.textContent='● REC '+String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
  },500);
}

function phStopRec(){
  if(window._recorder&&window._recorder.state!=='inactive') window._recorder.stop();
  isRecording=false;
  el('phShutter').classList.remove('recording');
  el('phRecBadge').classList.remove('show');
  if(recTimer){clearInterval(recTimer);recTimer=null;}
}

function phToggleOverlay(name){
  if(currentOverlay===name){phCloseOverlay();return;}
  phCloseOverlay();
  currentOverlay=name;
  const capName=name.charAt(0).toUpperCase()+name.slice(1);
  const ov=el('phOv'+capName);
  if(ov){
    ov.classList.add('open');
    el('phBackdrop').classList.add('show');
    // Highlight action circle
    const labelMap={channels:'ink',look:'look',settings:'fx'};
    document.querySelectorAll('.ph-action-circle').forEach(c=>{
      const n=c.querySelector('.ph-action-label');
      if(n&&n.textContent.toLowerCase()===(labelMap[name]||''))
        c.classList.add('open');
    });
    phPopulateOverlay(name);
  }
}

function phCloseOverlay(){
  document.querySelectorAll('.ph-overlay').forEach(o=>{o.classList.remove('open');o.style.transform='';});
  el('phBackdrop').classList.remove('show');
  document.querySelectorAll('.ph-action-circle').forEach(c=>c.classList.remove('open'));
  currentOverlay=null;
}

// Swipe down to dismiss overlays
// Screen→UI-local "down" proxy: under the landscape counter-rotation the
// UI's y axis runs along the screen x axis, so swipe deltas must be read
// off the matching screen axis (sign flips with rotation direction).
function phLocalY(t){
  const b=document.body.classList;
  if(b.contains('ph-ls-cw')) return -t.clientX;  // rotate(90): local +y = screen −x
  if(b.contains('ph-ls-ccw')) return t.clientX;  // rotate(−90): local +y = screen +x
  return t.clientY;
}

function initOverlaySwipe(){
  document.querySelectorAll('.ph-overlay').forEach(ov=>{
    let startY=0,curY=0,dragging=false;
    ov.addEventListener('touchstart',e=>{
      if(ov.scrollTop>0)return; // only swipe when at top
      startY=phLocalY(e.touches[0]);curY=startY;dragging=true;
    },{passive:true});
    ov.addEventListener('touchmove',e=>{
      if(!dragging)return;
      curY=phLocalY(e.touches[0]);
      const dy=curY-startY;
      if(dy>0){
        ov.style.transform='translateY('+dy+'px)';
        e.preventDefault();
      }
    },{passive:false});
    ov.addEventListener('touchend',()=>{
      if(!dragging)return;
      dragging=false;
      const dy=curY-startY;
      if(dy>60){phCloseOverlay();}
      else{ov.style.transform='';}
    },{passive:true});
  });
}

function phPopulateOverlay(name){
  if(name==='channels'){
    const body=el('phChannelsBody');
    if(!body.dataset.built){
      body.innerHTML='<div style="display:flex;gap:0;margin:4px 12px 6px"><button class="header-mode-btn '+(cached.sepType===0?'active':'')+'" id="phSepCmyk" onclick="R.setSepType(0)">CMYK</button><button class="header-mode-btn '+(cached.sepType===2?'active':'')+'" id="phSepRgb" onclick="R.setSepType(2)">RGB</button><button class="header-mode-btn '+(cached.sepType===1?'active':'')+'" id="phSepApprox" onclick="R.setSepType(1)">SPOT</button></div><div class="channel-list" id="phChannelList"></div>';
      body.dataset.built='1';
    }
    R.buildChannelUI('phChannelList');
  } else if(name==='look'){
    const body=el('phLookBody');
    // Profiles section
    let html='<div style="padding:0 12px"><div class="section-header" style="font-size:10px;letter-spacing:1px;padding:6px 4px;margin-bottom:4px;border-bottom:1px solid #333;color:#888;display:flex;align-items:center;gap:8px">PROFILES<span class="profile-custom-chip" style="display:none"></span></div>';
    html+='<div class="profiles-body" id="phProfileGrid"></div>';
    // Paper section
    html+='<div class="section-header" style="font-size:10px;letter-spacing:1px;padding:6px 4px;margin:12px 0 4px;border-bottom:1px solid #333;color:#888">PAPER</div>';
    html+='<div style="display:flex;gap:6px;flex-wrap:wrap;padding:4px 0">';
    PAPER_COLORS.forEach((c,i)=>{
      const border=c.hex==='#2a2a28'?'border-color:#888;':c.hex==='#ffffff'?'border-color:#ccc;':'';
      html+=`<div class="paper-dot${i===curPaperColor?' active':''}" onclick="R.setPaperColor(${i})" style="background:${c.hex};${border};width:28px;height:28px" title="${c.name}"></div>`;
    });
    html+='</div>';
    // Paper texture type
    html+='<div style="display:flex;gap:4px;flex-wrap:wrap;padding:4px 0">';
    const texKeys=['procedural','riso_standard','smooth','kraft','textured'];
    const texLabels={procedural:'Standard',riso_standard:'Natural',smooth:'Smooth',kraft:'Kraft',textured:'Textured'};
    texKeys.forEach(k=>{
      html+=`<button class="paper-tex-btn ph-paper-tex-btn${k===activePaperTex?' active':''}" data-tex="${k}" onclick="R.setPaperTex('${k}')">${texLabels[k]}</button>`;
    });
    html+=`<button class="paper-tex-btn" onclick="R.cyclePaperScale()" title="Paper texture scale"><span class="ph-paper-scale-val">${(cached.paperScale||1)}×</span></button>`;
    html+='</div>';
    // Margin
    html+='<div style="display:flex;align-items:center;gap:6px;padding:4px 0;flex-wrap:wrap">';
    html+='<div class="header-cycle" id="phMarginBtn" onclick="R.toggleMarginSlider()"><span class="header-cycle-val" id="phMarginBtnVal" style="min-width:18px">Margin</span></div>';
    html+='</div>';
    html+='<div id="phMarginSliderWrap" class="margin-slider-wrap" style="display:none"><input type="range" id="phMargin" min="0" max="12" value="'+parseFloat(el('margin').value)+'" step="1" class="regmark-slider"><span class="slider-value" id="phMarginVal">'+parseFloat(el('margin').value)+'</span></div>';
    html+='</div>';
    body.innerHTML=html;
    R.renderProfiles('phProfileGrid');
    // Sync the Custom chip into the freshly-built header — updateUI only
    // touches chips that exist at the moment it runs.
    const dChip=document.querySelector('.ctrl-group__title .profile-custom-chip');
    const pChip=document.querySelector('#phLookBody .profile-custom-chip');
    if(dChip&&pChip){pChip.innerHTML=dChip.innerHTML;pChip.style.display=dChip.style.display;}
    // Bind phone margin slider to desktop slider
    const phMg=el('phMargin');
    if(phMg){
      phMg.addEventListener('input',()=>{
        const v=parseFloat(phMg.value);
        const desk=el('margin');if(desk)desk.value=v;
        const phVal=el('phMarginVal');if(phVal)phVal.textContent=v;
        const deskVal=el('marginVal');if(deskVal)deskVal.textContent=v;
        cached.margin=v;markDirty();
        R.updateRegmarkUI();
      });
    }
    R.updateRegmarkUI();
  } else if(name==='settings'){
    const body=el('phSettingsBody');
    body.innerHTML=`
      <div class="settings-body" style="padding:10px 14px">
        <div class="regmark-row">
          <div id="phGrainSettings" style="display:${mode==='grain'?'block':'none'}"><button class="regmark-btn active" id="phGrainSizeBtn" onclick="R.cycleGrainSize()"><svg class="regmark-icon" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="2.5" fill="currentColor"/><circle cx="5" cy="5" r="1" fill="currentColor" opacity="0.5"/><circle cx="15" cy="5" r="1.2" fill="currentColor" opacity="0.5"/><circle cx="5" cy="15" r="1.1" fill="currentColor" opacity="0.5"/><circle cx="15" cy="15" r="0.9" fill="currentColor" opacity="0.5"/><circle cx="10" cy="4" r="0.8" fill="currentColor" opacity="0.4"/><circle cx="4" cy="10" r="0.9" fill="currentColor" opacity="0.4"/><circle cx="16" cy="10" r="1" fill="currentColor" opacity="0.4"/><circle cx="10" cy="16" r="0.8" fill="currentColor" opacity="0.4"/></svg><span class="regmark-val" id="phGrainSizeBtnVal">1.5</span></button></div>
          <div id="phFlatSettings" style="display:${mode==='flat'?'block':'none'}"><button class="regmark-btn active" id="phAmtDpiBtn" onclick="R.cycleAmtDpi()" title="Master density"><span class="regmark-val" id="phAmtDpiBtnVal">${(window._amtScanDpi||150)}dpi</span></button></div>
          <div id="phScreenSettings" style="display:${(mode==='screen'||mode==='lines'||mode==='letters')?'flex':'none'};gap:6px;flex-wrap:wrap"><button class="regmark-btn active" id="phLpiBtn" onclick="R.cycleLpi()"><svg class="regmark-icon" width="20" height="20" viewBox="0 0 20 20"><circle cx="5" cy="5" r="1.5" fill="currentColor"/><circle cx="13" cy="5" r="1.5" fill="currentColor"/><circle cx="5" cy="13" r="1.5" fill="currentColor"/><circle cx="13" cy="13" r="1.5" fill="currentColor"/><circle cx="9" cy="9" r="2" fill="currentColor"/></svg><span class="regmark-val" id="phLpiBtnVal">High</span></button><button class="regmark-btn" id="phStampShapeBtn" style="display:${mode==='screen'?'':'none'}" onclick="R.cycleStampShape()" title="Halftone stamp shape"><span class="regmark-icon" id="phStampShapeIcon" style="display:flex;align-items:center;justify-content:center;width:20px;height:20px"></span><span class="regmark-val" id="phStampShapeBtnVal">Circle</span></button><button class="regmark-btn" id="phAsciiCharsetBtn" style="display:none" onclick="R.cycleAsciiCharset()" title="ASCII charset — Latin / Georgian / mixed"><span class="regmark-val" id="phAsciiCharsetVal">ABC</span></button><button class="regmark-btn" id="phAsciiFontBtn" style="display:none" onclick="R.asciiFontClick()" title="ASCII font — upload TTF/OTF/WOFF; tap again to reset"><span class="regmark-val" id="phAsciiFontVal">Aa</span></button></div>
        </div>
        <div class="regmark-row" id="phLinesRow" style="display:${mode==='lines'?'flex':'none'};gap:6px;flex-wrap:wrap">
          <button class="regmark-btn active" onclick="R.cycleLineShape();R.phSyncLines()" title="Line shape"><span class="regmark-val" id="phLineShapeVal"></span></button>
          <button class="regmark-btn" onclick="R.cycleLineWave();R.phSyncLines()" title="Wave modulation"><span class="regmark-val" id="phLineWaveVal">None</span></button>
          <button class="regmark-btn" onclick="R.cycleLineWeight();R.phSyncLines()" title="Line weight"><span class="regmark-val" id="phLineWeightVal">1×</span></button>
          <button class="regmark-btn" onclick="R.cycleLineRoughness();R.phSyncLines()" title="Edge roughness"><span class="regmark-val" id="phLineRoughVal">Med</span></button>
          <button class="regmark-btn" onclick="R.cycleLineGrain();R.phSyncLines()" title="Line grain"><span class="regmark-val" id="phLineGrainVal">Med</span></button>
          <button class="regmark-btn" onclick="R.cycleLineAmount();R.phSyncLines()" title="Wave amount"><span class="regmark-val" id="phLineAmountVal">100%</span></button>
        </div>
        <div class="regmark-row">
          
          <button class="regmark-btn" id="phGhostingBtn" onclick="R.cycleGhosting()" title="Ghosting"><svg class="regmark-icon" width="20" height="20" viewBox="0 0 20 20"><path d="M10 2C6.5 2 4 5 4 8v7c0 0 1-1.5 2-1.5s1.5 1.5 2.5 1.5 1.5-1.5 2.5-1.5 1.5 1.5 2.5 1.5S15 14 16 15.5V8c0-3-2.5-6-6-6z" fill="currentColor" opacity="0.7"/><circle cx="8" cy="8" r="1.2" fill="white"/><circle cx="12" cy="8" r="1.2" fill="white"/></svg><span class="regmark-val" id="phGhostingBtnVal">OFF</span></button>
          <button class="regmark-btn active" id="phCropMarksBtn" onclick="R.toggleCropMarks()" title="Crop Marks"><svg class="regmark-icon" width="20" height="20" viewBox="0 0 20 20"><line x1="1" y1="5" x2="7" y2="5" stroke="currentColor" stroke-width="1.2"/><line x1="5" y1="1" x2="5" y2="7" stroke="currentColor" stroke-width="1.2"/><line x1="13" y1="5" x2="19" y2="5" stroke="currentColor" stroke-width="1.2"/><line x1="15" y1="1" x2="15" y2="7" stroke="currentColor" stroke-width="1.2"/><line x1="1" y1="15" x2="7" y2="15" stroke="currentColor" stroke-width="1.2"/><line x1="5" y1="13" x2="5" y2="19" stroke="currentColor" stroke-width="1.2"/><line x1="13" y1="15" x2="19" y2="15" stroke="currentColor" stroke-width="1.2"/><line x1="15" y1="13" x2="15" y2="19" stroke="currentColor" stroke-width="1.2"/></svg><span class="regmark-val" id="phCropMarksBtnVal">Crop Mark</span></button>
        </div>
        <div class="regmark-row">
          <button class="regmark-btn" id="phMisregBtn" onclick="R.cycleMisreg()"><svg class="regmark-icon" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="10" y1="2" x2="10" y2="18" stroke="currentColor" stroke-width="1"/><line x1="2" y1="10" x2="18" y2="10" stroke="currentColor" stroke-width="1"/></svg><span class="regmark-val" id="phMisregBtnVal">2</span></button>
          <span class="regmark-link">&ndash;</span>
          <button class="regmark-btn" id="phPosterizeBtn" onclick="R.cycleColorQuant()" title="Posterize"><span class="regmark-val" id="phPosterizeBtnVal">${(document.getElementById('posterizeBtnVal')||{}).textContent||'Off'}</span></button>
          <button class="regmark-btn" id="phSkewBtn" onclick="R.cycleSkew()"><svg class="regmark-icon" width="20" height="20" viewBox="0 0 20 20"><line x1="4" y1="16" x2="4" y2="4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="4" y1="16" x2="16" y2="16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M4 11 A5 5 0 0 0 9 16" fill="none" stroke="currentColor" stroke-width="1"/></svg><span class="regmark-val" id="phSkewBtnVal">0</span></button>
        </div>
      </div>`;
    phBindSliders();
    R.updateRegmarkUI();
    phSyncLines();
  }
}

// Mirror the LINES control labels from the (hidden) desktop panel spans —
// the cycle handlers update desktop ids, and reading those back beats
// duplicating the step tables here.
function phSyncLines(){
  [['lineShapeBtnPanelVal','phLineShapeVal'],['lineWaveBtnVal','phLineWaveVal'],
   ['lineWeightBtnVal','phLineWeightVal'],['lineRoughBtnVal','phLineRoughVal'],
   ['lineGrainBtnVal','phLineGrainVal'],['lineAmountBtnVal','phLineAmountVal']]
    .forEach(function(pair){
      var d=el(pair[0]), p=el(pair[1]);
      if(d&&p) p.textContent=d.textContent;
    });
  var spin=el('phLineSpinVal'), dSpin=el('lineSpinBtnVal');
  if(spin&&dSpin) spin.textContent='Anim '+dSpin.textContent;
}

function phBindSliders(){
  // Only bind controls that remain as sliders in phone mode
  const map=[
  ];
  map.forEach(([phId,deskId,cacheKey])=>{
    const phEl=el(phId);
    if(!phEl)return;
    phEl.addEventListener('input',()=>{
      const v=parseFloat(phEl.value);
      const desk=el(deskId);
      if(desk)desk.value=v;
      const phVal=el(phId+'Val');
      const vLabel=deskId==='skew'?v+'°':v;
      if(phVal)phVal.textContent=vLabel;
      const deskVal=el(deskId+'Val');
      if(deskVal)deskVal.textContent=vLabel;
      if(deskId==='misreg'||deskId==='skew'){cacheSlider(deskId,v);R.newMisreg();return;}
      if(cacheKey){cached[cacheKey]=v;markDirty();}
    });
  });
}
// Build step groups in phone settings overlay (mirrors desktop step groups)
// Move canvas between desktop/phone viewfinders
function layoutSwitch(){
  const phone=R.isPhone();
  if(phone===lastLayoutPhone)return;
  lastLayoutPhone=phone;
  if(phone){
    const phVf=el('phViewfinder');
    const recBadge=el('phRecBadge');
    phVf.insertBefore($gl,recBadge);
    phVf.insertBefore($vid,recBadge);
    $vf=phVf;
    // Auto-start camera on phone if no source
    if(!hasSrc&&!camOn) R.toggleCam();
    // Bind BCS sliders
    phBindBcs();
  } else {
    const vf=el('viewfinder');
    const sb=vf.querySelector('.status-bar');
    vf.insertBefore($gl,sb);
    vf.insertBefore($vid,sb);
    $vf=vf;
    phCloseOverlay();
  }
  phOrientLock();
  needsAspectUpdate=true;scheduleRender();
}

// ── Landscape lock ──────────────────────────────────────────────
// Keep the phone UI portrait-oriented when the device rotates, like the
// iOS camera app: the frame rotates, the app doesn't. Both landscape grips
// report orientation:landscape, so counter-rotate by the reported rotation
// angle instead (angle 90 → rotate −90 [ph-ls-ccw], angle 270 → rotate 90
// [ph-ls-cw]; CSS in main.css). Coarse-pointer gate keeps the desktop 📱
// preview unaffected.
function phOrientLock(){
  const b=document.body.classList;
  let ang=0;
  if(screen.orientation && typeof screen.orientation.angle==='number') ang=screen.orientation.angle;
  else if(typeof window.orientation==='number') ang=(window.orientation+360)%360;
  const touch=window.matchMedia('(pointer: coarse)').matches;
  const want=(phoneActive&&touch) ? (ang===90?'ph-ls-ccw':(ang===270?'ph-ls-cw':'')) : '';
  const had=b.contains('ph-ls-ccw')?'ph-ls-ccw':(b.contains('ph-ls-cw')?'ph-ls-cw':'');
  if(want===had) return;
  b.toggle('ph-ls',!!want);
  b.toggle('ph-ls-ccw',want==='ph-ls-ccw');
  b.toggle('ph-ls-cw',want==='ph-ls-cw');
  markDirty();needsAspectUpdate=true;scheduleRender();
}

// Update aspect buttons across both UIs
const origSetAspect=setAspect;
setAspect=function(ratio){
  cropAspect=ratio||[4,3];
  computeCrop();
  needsAspectUpdate=true;scheduleRender();
  const ar = (typeof cropAspect === 'string') ? cropAspect : cropAspect.join(':');
  // Sync desktop aspect button
  const abtn=el('aspectBtn');
  if(abtn) abtn.textContent=ar.toUpperCase();
  document.querySelectorAll('.aspect-btn').forEach(b=>{
    b.classList.toggle('active',b.dataset.ar===ar);
  });
  // Sync phone aspect button text
  const phBtn=el('phAspectBtn');
  if(phBtn){
    const idx=ASPECT_CYCLE.findIndex(a=>a&&cropAspect&&a[0]===cropAspect[0]&&a[1]===cropAspect[1]);
    if(idx>=0){aspectIdx=idx;phBtn.textContent=ASPECT_LABELS[idx];}
  }
  setTimeout(()=>R.updateDebugInfo(),50);
};

document.addEventListener('DOMContentLoaded',()=>{
  $gl=el('gl'); $vf=el('viewfinder'); $vid=el('vid');
  $fps=el('fps'); $res=el('resBadge'); $status=el('statusBadge');

  R.renderProfiles();R.renderPaperUI();R.bindSliders();R.buildStepGroups();R.initToneCurve();R.updateRegmarkUI();R.setRisoFps(risoFps);initShutter();initOverlaySwipe();
  // Sync settings-panel layout to current mode (correct primary sub-block
  // visible, initial shape icons painted, etc).
  if(R.setMode) R.setMode(mode);
  R.initDragDrop();
  R.initViewZoom();
  // Set initial paper background (color + texture scan)
  R.updatePaperBg();
  R.initGL();

  // Cache DOM refs used in render loop
  $phCropGuide=el('phCropGuide');
  cachedVfW=$vf.clientWidth;cachedVfH=$vf.clientHeight;

  // Pre-build uniform location arrays (avoids per-frame allocation)
  inkLocs[0]=locs.u_ink0;inkLocs[1]=locs.u_ink1;inkLocs[2]=locs.u_ink2;inkLocs[3]=locs.u_ink3;
  offLocs[0]=locs.u_off0;offLocs[1]=locs.u_off1;offLocs[2]=locs.u_off2;offLocs[3]=locs.u_off3;
  angLocs[0]=locs.u_angle0;angLocs[1]=locs.u_angle1;angLocs[2]=locs.u_angle2;angLocs[3]=locs.u_angle3;
  chanLocs[0]=locs.u_chan0;chanLocs[1]=locs.u_chan1;chanLocs[2]=locs.u_chan2;chanLocs[3]=locs.u_chan3;
  densLocs[0]=locs.u_dens0;densLocs[1]=locs.u_dens1;densLocs[2]=locs.u_dens2;densLocs[3]=locs.u_dens3;
  lutALocs=[locs.u_lutA0,locs.u_lutA1,locs.u_lutA2,locs.u_lutA3];
  lutBLocs=[locs.u_lutB0,locs.u_lutB1,locs.u_lutB2,locs.u_lutB3];
  lutCLocs=[locs.u_lutC0,locs.u_lutC1,locs.u_lutC2,locs.u_lutC3];
  lutDLocs=[locs.u_lutD0,locs.u_lutD1,locs.u_lutD2,locs.u_lutD3];
  grainMulLocs=[locs.u_grainMul0,locs.u_grainMul1,locs.u_grainMul2,locs.u_grainMul3];
  inkGammaLocs=[locs.u_inkGamma0,locs.u_inkGamma1,locs.u_inkGamma2,locs.u_inkGamma3];
  hasCalLocs=[locs.u_hasCal0,locs.u_hasCal1,locs.u_hasCal2,locs.u_hasCal3];
  opaqueLocs=[locs.u_opaque0,locs.u_opaque1,locs.u_opaque2,locs.u_opaque3];
  skewLocs=[locs.u_skew0,locs.u_skew1,locs.u_skew2,locs.u_skew3];

  R.applyProf(PROFILES[0]);
  R.setPaperColor(8); // Pure White default (boot overrides the state.js initial, so set it HERE)

  // Check for imported image from bark beetle tool
  const importData = localStorage.getItem('risocam_import');
  if (importData) {
    localStorage.removeItem('risocam_import');
    const img = new Image();
    img.onload = () => {
      const flat = R.flattenAlpha(img);
      srcImg = flat;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, window._srcTexA);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, flat);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, window._srcTexB);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, flat);
      camOn = false; hasSrc = true; needsAspectUpdate = true; computeCrop(); scheduleRender();
      $status.textContent = '◉ IMPORT';
      $res.textContent = img.width + '×' + img.height;
    };
    img.src = importData;
  } else {
    // Load test pattern immediately — no upload overlay needed
    R.loadSampleImage();
  }

  // Initial layout
  layoutSwitch();

  // Auto-enter phone mode if running as installed PWA or on mobile device
  const isStandalone = window.matchMedia('(display-mode:standalone)').matches
    || window.matchMedia('(display-mode:fullscreen)').matches
    || window.navigator.standalone === true;
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  if((isStandalone || isMobile) && !phoneActive){
    // layoutSwitch() (via togglePhoneMode) already auto-starts the camera when
    // there's no source. The old extra setTimeout(toggleCam, 300) raced it: if
    // the first getUserMedia resolved within 300ms the camera was toggled
    // straight back OFF; if not, two concurrent getUserMedia ran and the first
    // stream leaked as an orphaned live track (camera LED stuck on).
    togglePhoneMode();
  }

  // Redraw on resize/orientation change
  window.addEventListener('resize',()=>{markDirty();needsAspectUpdate=true;if(compareOn)setTimeout(R.sizeCompareOverlay,50);});

  // Landscape lock: rotation fires resize AND orientationchange, but iOS
  // updates the reported angle slightly after the event — re-check on a
  // short delay too.
  window.addEventListener('resize',phOrientLock);
  window.addEventListener('orientationchange',()=>{phOrientLock();setTimeout(phOrientLock,80);});
  if(screen.orientation&&screen.orientation.addEventListener)
    screen.orientation.addEventListener('change',()=>{phOrientLock();setTimeout(phOrientLock,80);});
  phOrientLock();

  // Undo/Redo keyboard shortcuts (Cmd+Z / Ctrl+Z, Cmd+Shift+Z / Ctrl+Shift+Z)
  document.addEventListener('keydown',e=>{
    const mod=e.metaKey||e.ctrlKey;
    if(mod && e.key==='z' && !e.shiftKey){e.preventDefault();R.undo();}
    if(mod && (e.key==='Z'||(e.key==='z'&&e.shiftKey))){e.preventDefault();R.redo();}
    if(mod && e.key==='y'){e.preventDefault();R.redo();}
    // Spacebar: pause/resume the render loop. Skip when typing in inputs.
    if(e.key===' '||e.code==='Space'){
      const t=e.target, tag=t&&t.tagName;
      if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||(t&&t.isContentEditable))return;
      e.preventDefault();
      if(R.togglePause) R.togglePause();
    }
    // Volume down = shutter (hold for video)
    if(R.isPhone() && (e.key==='VolumeDown'||e.key==='AudioVolumeDown')){
      e.preventDefault();
      if(!_volDown){
        _volDown=true;
        _shutterIsLong=false;
        _shutterTimer=setTimeout(()=>{_shutterIsLong=true;phStartRec();},400);
      }
    }
  });
  let _volDown=false;
  document.addEventListener('keyup',e=>{
    if(R.isPhone() && (e.key==='VolumeDown'||e.key==='AudioVolumeDown')){
      e.preventDefault();
      _volDown=false;
      clearTimeout(_shutterTimer);
      if(_shutterIsLong) phStopRec();
      else R.saveHiRes('jpg');   // volume shutter = camera capture → JPEG
    }
  });
  // Initial undo snapshot
  R.pushUndo();

  // ─── PWA: Install as standalone app on Android/iOS ───
  const manifest={
    name:'RISO/CAM',
    short_name:'RISO/CAM',
    description:'Real-time Risograph camera simulator',
    start_url:location.href,
    display:'fullscreen',
    orientation:'portrait',
    background_color:'#1a1a1a',
    theme_color:'#1a1a1a',
    icons:[{
      src:'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27512%27 height=%27512%27 viewBox=%270 0 512 512%27%3E%3Crect width=%27512%27 height=%27512%27 rx=%2780%27 fill=%27%231a1a1a%27/%3E%3Ccircle cx=%27256%27 cy=%27230%27 r=%2795%27 stroke=%27%23f5f0e8%27 stroke-width=%2714%27 fill=%27none%27/%3E%3Ccircle cx=%27256%27 cy=%27230%27 r=%2735%27 fill=%27%23d2515e%27/%3E%3Crect x=%27156%27 y=%27365%27 width=%27200%27 height=%276%27 rx=%273%27 fill=%27%230078bf%27/%3E%3Crect x=%27156%27 y=%27385%27 width=%27200%27 height=%276%27 rx=%273%27 fill=%27%23f15060%27/%3E%3Crect x=%27156%27 y=%27405%27 width=%27200%27 height=%276%27 rx=%273%27 fill=%27%23ffe800%27/%3E%3C/svg%3E',
      sizes:'512x512',
      type:'image/svg+xml',
      purpose:'any maskable'
    }]
  };
  const mBlob=new Blob([JSON.stringify(manifest)],{type:'application/manifest+json'});
  const mLink=document.createElement('link');
  mLink.rel='manifest';
  mLink.href=URL.createObjectURL(mBlob);
  document.head.appendChild(mLink);

  // Minimal service worker for PWA installability
  if('serviceWorker' in navigator){
    const swCode=`self.addEventListener('fetch',e=>e.respondWith(fetch(e.request)));`;
    const swBlob=new Blob([swCode],{type:'application/javascript'});
    const swUrl=URL.createObjectURL(swBlob);
    navigator.serviceWorker.register(swUrl).catch(()=>{});
  }

  scheduleRender();
});


// --- Namespace exports ---
R.ASPECT_CYCLE = ASPECT_CYCLE;
R.ASPECT_LABELS = ASPECT_LABELS;
R.FPS_CYCLE = FPS_CYCLE;
R.updateCropGuide = updateCropGuide;
R.setPhoneMode = setPhoneMode;
R.phReset = phReset;
R.phCycleMode = phCycleMode;
R.phCycleAspect = phCycleAspect;
R.phCycleFps = phCycleFps;
R.phToggleBcs = phToggleBcs;
R.syncArcSliders = syncArcSliders;
R.phBindBcs = phBindBcs;
R.phFlipCam = phFlipCam;
R.initShutter = initShutter;
R.phStartRec = phStartRec;
R.phStopRec = phStopRec;
R.phToggleOverlay = phToggleOverlay;
R.phCloseOverlay = phCloseOverlay;
R.initOverlaySwipe = initOverlaySwipe;
R.phPopulateOverlay = phPopulateOverlay;
R.phBindSliders = phBindSliders;
R.phSyncLines = phSyncLines;
R.layoutSwitch = layoutSwitch;

})(window.R);
