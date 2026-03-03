// UI_CONTROLS module
(function(R) {
"use strict";

// ======================== UI ========================
// Click color in palette → assign to first empty slot, or toggle off
let openPicker=-1; // which channel's picker is open (-1=none)

function togglePicker(ch){
  openPicker = openPicker===ch ? -1 : ch;
  buildChannelUI();
  if(el('phChannelList')&&el('phChannelList').children.length) buildChannelUI('phChannelList');
}

// Mono detection: all channels set to the same ink
function isMono(){
  const active=channels.filter(c=>c!==null);
  return active.length===4 && new Set(active).size===1;
}

function pickColor(ch, name){
  if(isMono()||ch==='mono'){
    // In mono: change all 4 channels at once
    for(let i=0;i<4;i++) channels[i]=name;
  } else {
    channels[ch]=name;
  }
  openPicker=-1;
  onChannelsChanged();
}

function setMonoDens(val){
  const v=parseFloat(val);
  for(let i=0;i<4;i++) cached.layerDens[i]=v;
  markDirty();
}

function setMonoAngle(deg){
  for(let i=0;i<4;i++) layerAngles[i]=deg;
  buildChannelUI();
  if(el('phChannelList')&&el('phChannelList').children.length) buildChannelUI('phChannelList');
  markDirty();
}

// Map profile colors to 4 CMYK slots (always fill all 4)
function mapProfileToSlots(colors){
  if(colors.length===1) return [colors[0],colors[0],colors[0],colors[0]];
  if(colors.length===2) return [colors[0],colors[1],colors[1],colors[0]]; // dark on C+K, warm on M+Y
  if(colors.length===3) return [colors[0],colors[1],colors[2],colors[0]]; // first color doubles on K
  return [colors[0],colors[1],colors[2],colors[3]];
}

// Grouped ink list for dropdown
const INK_LIST=[
  {group:'Standard',inks:['Black','Blue','Bright Red','Yellow','White']},
  {group:'Warm',inks:['Orange','Cranberry','Brick','Brown','Flat Gold']},
  {group:'Cool',inks:['Teal','Cornflower','Turquoise','Federal Blue','Purple','Violet']},
  {group:'Fluorescent',inks:['Fl. Pink','Fl. Yellow','Fl. Orange','Fl. Green','Hunter Green']},
];

const CH_META=[
  {name:'Cyan', badge:'C', cls:'ch-badge-c', grad:'linear-gradient(90deg,#00bcd4,#e0f7fa)'},
  {name:'Magenta', badge:'M', cls:'ch-badge-m', grad:'linear-gradient(90deg,#e91e63,#fce4ec)'},
  {name:'Yellow', badge:'Y', cls:'ch-badge-y', grad:'linear-gradient(90deg,#fdd835,#fffde7)'},
  {name:'Black', badge:'K', cls:'ch-badge-k', grad:'linear-gradient(90deg,#333,#e0e0e0)'},
];

function buildChannelUI(targetId){
  const list=el(targetId||'channelList');
  if(!list)return;
  list.innerHTML='';
  const angles=[0,15,30,45,60,75,90];
  const isScreen=mode==='screen';

  // ─── Mono mode: single consolidated row ───
  if(isMono()){
    const name=channels[0];
    const rc=name?RISO_COLORS.find(r=>r.name===name):null;
    const hex=rc?rc.hex:'#ccc';
    const isOpen=openPicker===0;
    const isWhite=name==='White';
    const dens=Math.round(cached.layerDens[0]);
    const trackBg=rc?`linear-gradient(90deg,${hex}15,${hex})`:`linear-gradient(90deg,#eee,#aaa)`;
    const curAngle=layerAngles[0]||0;

    let html=`<div class="ch-slot">`;
    html+=`<div class="ch-mono-row">
      <span class="ch-mono-label">MONO</span>
      <div class="ch-color-btn${isWhite?' white-border':''}${isOpen?' open':''}" style="background:${hex}" onclick="R.togglePicker(0)"></div>
      <input type="range" class="ch-dens" min="0" max="100" value="${dens}" step="2"
        oninput="R.setMonoDens(this.value)"
        style="background:${trackBg}">`;
    if(isScreen){
      html+=`<div class="ch-angles">`;
      angles.forEach(a=>{
        html+=`<button class="ch-angle-btn${curAngle===a?' active':''}" onclick="event.stopPropagation();R.setMonoAngle(${a})">${a}°</button>`;
      });
      html+=`</div>`;
    }
    html+=`</div>`;
    // Color picker dropdown
    html+=`<div class="ch-dropdown${isOpen?' open':''}">`;
    INK_LIST.forEach((g,gi)=>{
      if(gi>0) html+=`<div class="ch-dropdown-sep"></div>`;
      g.inks.forEach(n=>{
        const irc=RISO_COLORS.find(r=>r.name===n);
        if(!irc) return;
        const esc=n.replace(/'/g,"\\'");
        const sel=name===n?' selected':'';
        const wc=n==='White'?' white-dot':'';
        html+=`<div class="ch-dropdown-item${sel}" onclick="event.stopPropagation();R.pickColor('mono','${esc}')">
          <span class="ch-dropdown-dot${wc}" style="background:${irc.hex}"></span>
          <span class="ch-dropdown-name">${n}</span>
        </div>`;
      });
    });
    html+=`</div></div>`;
    list.insertAdjacentHTML('beforeend',html);
    return; // No drag, no multi-row
  }

  // Build link groups: channels sharing same ink color
  const linkGroups={};
  for(let i=0;i<4;i++){
    const c=channels[i];
    if(!c) continue;
    if(!linkGroups[c]) linkGroups[c]=[];
    linkGroups[c].push(i);
  }
  // Only mark as linked if >1 channel shares the color
  const linkedColor={}; // ch index → ink hex (only if linked)
  for(const [color,chs] of Object.entries(linkGroups)){
    if(chs.length>1){
      const rc=RISO_COLORS.find(r=>r.name===color);
      const hex=rc?rc.hex:'#888';
      for(const ch of chs) linkedColor[ch]=hex;
    }
  }

  // ─── Multi-layer mode: individual rows with drag handles ───
  const isSpot=cached.sepType===1;
  const seenSpot=new Set();
  let spotNum=0;
  for(let pos=0;pos<4;pos++){
    const i=layerOrder[pos]; // actual CMYK channel index
    const name=channels[i];
    if(isSpot){
      if(name===null || seenSpot.has(name)) continue; // show only unique inks in spot mode
      seenSpot.add(name);
    }
    spotNum++;
    const rc=name?RISO_COLORS.find(r=>r.name===name):null;
    const hex=rc?rc.hex:'#ccc';
    const isOpen=openPicker===i;
    const m=CH_META[i];
    const badgeLabel=isSpot?spotNum:m.badge;
    const badgeCls=isSpot?'ch-badge-spot':m.cls;
    const isWhite=name==='White';
    const dens=Math.round(cached.layerDens[i]);
    const trackBg=rc?`linear-gradient(90deg,${hex}15,${hex})`:`linear-gradient(90deg,#eee,#aaa)`;
    const curAngle=layerAngles[i]||0;
    const isLinked=i in linkedColor;

    let html=`<div class="ch-slot" data-ch="${i}" data-pos="${pos}">`;
    // Compact row: [drag] [badge] [color-btn] [density slider] [angle buttons]
    html+=`<div class="ch-row">
      <span class="ch-drag" data-drag="${pos}">⡇</span>
      <span class="ch-badge ${badgeCls}">${badgeLabel}</span>
      <div class="ch-color-btn${isWhite?' white-border':''}${isOpen?' open':''}" style="background:${hex}" onclick="R.togglePicker(${i})"></div>
      <input type="range" class="ch-dens" min="0" max="100" value="${dens}" step="2"
        oninput="R.setChannelDens(${i},this.value)"
        style="background:${trackBg}">`;
    if(isScreen){
      const linkStyle=isLinked?` style="border-bottom:2px solid ${linkedColor[i]};padding-bottom:1px"`:' ';
      html+=`<div class="ch-angles"${linkStyle}>`;
      angles.forEach(a=>{
        html+=`<button class="ch-angle-btn${curAngle===a?' active':''}" onclick="event.stopPropagation();R.setAngle(${i},${a})">${a}°</button>`;
      });
      html+=`</div>`;
    }
    html+=`</div>`;
    html+=`<div class="ch-dropdown${isOpen?' open':''}">`;
    INK_LIST.forEach((g,gi)=>{
      if(gi>0) html+=`<div class="ch-dropdown-sep"></div>`;
      g.inks.forEach(n=>{
        const irc=RISO_COLORS.find(r=>r.name===n);
        if(!irc) return;
        const esc=n.replace(/'/g,"\\'");
        const sel=name===n?' selected':'';
        const wc=n==='White'?' white-dot':'';
        html+=`<div class="ch-dropdown-item${sel}" onclick="event.stopPropagation();R.pickColor(${i},'${esc}')">
          <span class="ch-dropdown-dot${wc}" style="background:${irc.hex}"></span>
          <span class="ch-dropdown-name">${n}</span>
        </div>`;
      });
    });
    html+=`</div></div>`;
    list.insertAdjacentHTML('beforeend',html);
  }
  initLayerDrag(list);
}


// ─── Layer drag-to-reorder ───
function initLayerDrag(container){
  const slots=container.querySelectorAll('.ch-slot');
  const handles=container.querySelectorAll('.ch-drag');
  let dragPos=-1, overPos=-1;

  handles.forEach(h=>{
    h.addEventListener('pointerdown',e=>{
      e.preventDefault();
      dragPos=parseInt(h.dataset.drag);
      h.setPointerCapture(e.pointerId);
      slots[dragPos].classList.add('dragging');
    });
    h.addEventListener('pointermove',e=>{
      if(dragPos<0)return;
      // Find which slot we're over based on Y position
      const newOver=findSlotAt(slots,e.clientY);
      if(newOver!==overPos){
        slots.forEach(s=>{s.classList.remove('drag-over-above','drag-over-below');});
        if(newOver>=0&&newOver!==dragPos){
          slots[newOver].classList.add(newOver<dragPos?'drag-over-above':'drag-over-below');
        }
        overPos=newOver;
      }
    });
    h.addEventListener('pointerup',e=>{
      if(dragPos<0)return;
      slots.forEach(s=>{s.classList.remove('dragging','drag-over-above','drag-over-below');});
      if(overPos>=0&&overPos!==dragPos){
        // Reorder: move dragPos to overPos
        const item=layerOrder.splice(dragPos,1)[0];
        layerOrder.splice(overPos,0,item);
        cacheInkColors();
        markDirty();
        buildChannelUI();
      }
      dragPos=-1;overPos=-1;
    });
    h.addEventListener('pointercancel',()=>{
      slots.forEach(s=>{s.classList.remove('dragging','drag-over-above','drag-over-below');});
      dragPos=-1;overPos=-1;
    });
  });
}

function findSlotAt(slots,clientY){
  for(let i=0;i<slots.length;i++){
    const r=slots[i].getBoundingClientRect();
    if(clientY>=r.top&&clientY<r.bottom) return i;
  }
  return -1;
}

function renderColors(){}

// Custom user profiles (saved to localStorage)
let customProfiles=JSON.parse(localStorage.getItem('risocam_custom_profiles')||'[]');
function allProfiles(){ return PROFILES.concat(customProfiles); }

function renderProfiles(targetId){
  const target=el(targetId||'profileList');
  if(!target)return;
  const all=allProfiles();
  let html=all.map((p,i)=>{
    const sw=p.colors.map(n=>{const c=RISO_COLORS.find(r=>r.name===n);return`<div class="profile-swatch" style="background:${c?c.hex:'#ccc'}"></div>`;}).join('');
    const isCustom=i>=PROFILES.length;
    const del=isCustom?`<span class="profile-del" onclick="event.stopPropagation();R.deleteCustomProfile(${i-PROFILES.length},'${targetId||'profileList'}')">&times;</span>`:'';
    return`<div class="profile-pill${isCustom?' custom':''}" data-ai="${i}" onclick="R.applyProf(R.allProfiles()[${i}])"><div class="profile-swatches">${sw}</div><span class="profile-label">${p.name}</span>${del}</div>`;
  }).join('');
  html+=`<div class="profile-pill profile-add" onclick="R.openProfileCreator()"><span class="profile-label">+</span></div>`;
  target.innerHTML=html;
}

function deleteCustomProfile(idx,targetId){
  customProfiles.splice(idx,1);
  localStorage.setItem('risocam_custom_profiles',JSON.stringify(customProfiles));
  renderProfiles(targetId);
  if(el('phProfileGrid')) renderProfiles('phProfileGrid');
}

function openProfileCreator(){
  // Build modal
  let overlay=document.getElementById('profCreatorOverlay');
  if(overlay) overlay.remove();
  overlay=document.createElement('div');
  overlay.id='profCreatorOverlay';
  overlay.className='prof-creator-overlay';
  const inkOpts=RISO_COLORS.map(c=>`<div class="prof-ink-chip" data-name="${c.name}" onclick="R.toggleProfInk(this)" style="background:${c.hex};color:${luminance(c.hex)>0.4?'#000':'#fff'}">${c.name}</div>`).join('');
  overlay.innerHTML=`<div class="prof-creator-modal">
    <div class="prof-creator-title">Create Profile</div>
    <input id="profNameInput" class="prof-name-input" placeholder="Profile name" maxlength="20" />
    <div class="prof-creator-subtitle">Select 1–4 inks (in print order)</div>
    <div class="prof-ink-grid">${inkOpts}</div>
    <div class="prof-creator-actions">
      <button class="prof-btn" onclick="R.closeProfCreator()">Cancel</button>
      <button class="prof-btn prof-btn-primary" onclick="R.saveProfCreator()">Create</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('pointerdown',e=>{if(!e.target.closest('.prof-creator-modal')) closeProfCreator();});
}
function closeProfCreator(){ const o=document.getElementById('profCreatorOverlay'); if(o) o.remove(); }
function luminance(hex){ const r=parseInt(hex.slice(1,3),16)/255,g=parseInt(hex.slice(3,5),16)/255,b=parseInt(hex.slice(5,7),16)/255; return 0.299*r+0.587*g+0.114*b; }
let profSelectedInks=[];
function toggleProfInk(chip){
  const name=chip.dataset.name;
  const idx=profSelectedInks.indexOf(name);
  if(idx>=0){ profSelectedInks.splice(idx,1); chip.classList.remove('selected'); chip.querySelector('.prof-ink-num')?.remove(); }
  else if(profSelectedInks.length<4){ profSelectedInks.push(name); chip.classList.add('selected'); const num=document.createElement('span'); num.className='prof-ink-num'; num.textContent=profSelectedInks.length; chip.appendChild(num); }
  // Re-number all
  document.querySelectorAll('.prof-ink-chip.selected').forEach(c=>{ const n=profSelectedInks.indexOf(c.dataset.name); const numEl=c.querySelector('.prof-ink-num'); if(numEl) numEl.textContent=n+1; });
}
function saveProfCreator(){
  const name=(document.getElementById('profNameInput')?.value||'').trim();
  if(!name){ document.getElementById('profNameInput').style.borderColor='#f55'; return; }
  if(profSelectedInks.length<1) return;
  customProfiles.push({name,colors:[...profSelectedInks]});
  localStorage.setItem('risocam_custom_profiles',JSON.stringify(customProfiles));
  profSelectedInks=[];
  closeProfCreator();
  renderProfiles();
  if(el('phProfileGrid')) renderProfiles('phProfileGrid');
  applyProf(customProfiles[customProfiles.length-1]);
}

function applyProf(p){
  activeProf=p;
  channels=mapProfileToSlots(p.colors);
  // Apply density presets if profile has them
  if(p.dens){
    for(let i=0;i<4;i++) cached.layerDens[i]=p.dens[i]||88;
  } else {
    for(let i=0;i<4;i++) cached.layerDens[i]=88;
  }
  // Assign classic halftone angles per unique ink, then sync same-color plates
  const defaultAngles=[15,75,0,45];
  layerAngles=[...defaultAngles];
  // R.syncSameColorPlates (in onChannelsChanged) locks same-ink channels together
  onChannelsChanged();
  R.pushUndo();
  if(isPhone()) R.phCloseOverlay();
}

function onChannelsChanged(){
  // Sync same-color plates: shared angles + misreg (one master per ink)
  R.syncSameColorPlates();
  R.newMisreg();cacheInkColors();updateUI();markDirty();
}

function updateUI(){
  // Profiles
  const all=allProfiles();
  document.querySelectorAll('.profile-pill').forEach(p=>{
    const idx=parseInt(p.dataset.ai);
    const pr=all[idx];
    if(pr) p.classList.toggle('active',activeProf&&pr.name===activeProf.name);
  });

  // Rebuild channel rows with dropdowns + density
  const unique=new Set(channels.filter(c=>c));
  el('layerCount').textContent=unique.size;
  buildChannelUI();
  // Also refresh phone overlays if built
  if(el('phChannelList')&&el('phChannelList').children.length) buildChannelUI('phChannelList');
  if(el('phProfileGrid')&&el('phProfileGrid').children.length) renderProfiles('phProfileGrid');

  // Caption
  const names=[...unique];
  const caption=names.length?'RISO/CAM — '+names.join(' + '):'RISO/CAM — GPU';
  el('captureInfo').textContent=caption;
  const phInfo=el('phInfo');
  if(phInfo) phInfo.textContent=caption;

  // Show CMYK tuning in CMYK mode (any layer count)
  const cmykDiv=el('cmykTuning');
  if(cmykDiv) cmykDiv.style.display=(cached.sepType===0)?'':'none';
  updateDebugInfo();
}

function setChannelDens(ch,val){
  cached.layerDens[ch]=parseFloat(val);markDirty();
}


function setMode(m){
  mode=m;
  // Desktop mode buttons (may not exist in phone-only scenarios)
  const mg=el('modeGrain'),ms=el('modeScreen');
  if(mg)mg.classList.toggle('active',m==='grain');
  if(ms)ms.classList.toggle('active',m==='screen');
  const scr=el('screenSettings'),grn=el('grainSettings');
  if(scr)scr.style.display=m==='screen'?'block':'none';
  if(grn)grn.style.display=m==='grain'?'block':'none';
  // Phone settings wrappers
  const phScr=el('phScreenSettings'),phGrn=el('phGrainSettings');
  if(phScr)phScr.style.display=m==='screen'?'block':'none';
  if(phGrn)phGrn.style.display=m==='grain'?'block':'none';
  // Phone overlay mode buttons
  document.querySelectorAll('.ph-overlay .mode-btn').forEach(b=>{
    b.classList.toggle('active',b.textContent.trim().toLowerCase()===m);
  });
  // Rebuild channels to show/hide angle buttons
  buildChannelUI();
  if(el('phChannelList')&&el('phChannelList').children.length) buildChannelUI('phChannelList');
  markDirty();
}
function setSepType(t){
  cached.sepType=t;
  const cBtn=el('sepCmyk'),aBtn=el('sepApprox');
  if(cBtn) cBtn.classList.toggle('active',t===0);
  if(aBtn) aBtn.classList.toggle('active',t===1);
  // Phone buttons
  const pc=el('phSepCmyk'),pa=el('phSepApprox');
  if(pc) pc.classList.toggle('active',t===0);
  if(pa) pa.classList.toggle('active',t===1);
  // Show/hide CMYK tuning (only relevant in CMYK mode)
  updateUI();
  markDirty();
}
function setScale(s){
  resScale=s;
  const btn=el('resBtn');
  if(btn) btn.textContent=s+'×';
  markDirty();
  // Defer debug info update so canvas size reflects the new scale (after render)
  setTimeout(()=>updateDebugInfo(),50);
}

const fpsSteps=[0,4,8,12,24];
const FPS_STATIC_MAP={0:0, 4:5, 8:5, 12:5, 24:5};
function setRisoFps(fps){
  risoFps=fps;
  // Auto-derive grain static from FPS
  cached.grainStatic = FPS_STATIC_MAP[fps] ?? 0;
  const s=el('grainStatic'); if(s) s.value=cached.grainStatic;
  const sv=el('grainStaticVal'); if(sv) sv.textContent=cached.grainStatic;
  const btn=el('fpsBtn');
  if(btn) btn.textContent=fps===0?'STILL':fps;
  const phBtn=el('phFpsBtn');
  if(phBtn) phBtn.textContent=fps===0?'STILL':fps+'FPS';
  markDirty();
}
function cycleFps(){
  const i=fpsSteps.indexOf(risoFps);
  setRisoFps(fpsSteps[(i+1)%fpsSteps.length]);
}
const resSteps=[6]; // always max
function cycleRes(){ /* disabled — always max res */ }
function setAngle(ch,deg){
  layerAngles[ch]=deg;
  // Sync same-color channels to the same angle
  const color=channels[ch];
  if(color){
    for(let i=0;i<4;i++){
      if(i!==ch && channels[i]===color) layerAngles[i]=deg;
    }
  }
  buildChannelUI();
  if(el('phChannelList')&&el('phChannelList').children.length) buildChannelUI('phChannelList');
  markDirty();
}
function bindSliders(){
  ['grainSize','dotGain','misreg','inkNoise','paperTex','lpi','grainStatic','ghosting','margin','skew','imgBright','imgContrast','imgSat','imgShadows','ucrStr','balC','balM','balY','balK','tac','inkOpacity','layerDeplete','pressVar','densFlicker','ghostMul'].forEach(id=>{
    const s=el(id),v=el(id+'Val');
    if(!s||!v)return;
    s.oninput=()=>{
      v.textContent=id==='skew'?s.value+'°':s.value;
      if(id==='misreg'||id==='skew'){ cacheSlider(id,s.value); R.newMisreg(); updateRegmarkUI(); }
      else if(id==='margin'){ cacheSlider(id,s.value); updateRegmarkUI(); }
      else cacheSlider(id,s.value);
    };
    cacheSlider(id,s.value);
  });
  // Tonal calibration sliders (special display formatting)
  ['tonalGamma','dotMin','opacityCap'].forEach(id=>{
    const s=el(id),v=el(id+'Val');
    if(!s||!v)return;
    s.oninput=()=>{
      const raw=parseFloat(s.value);
      v.textContent=id==='tonalGamma'?(raw*0.01).toFixed(2):raw;
      cacheSlider(id,raw);
    };
    cacheSlider(id,s.value);
    // Init display
    const raw=parseFloat(s.value);
    v.textContent=id==='tonalGamma'?(raw*0.01).toFixed(2):raw;
  });
}
// ─── Stepped pickers (replaces sliders with discrete buttons) ───
// STEP_PRESETS is declared in data.js (global scope)
function buildStepGroups(){
  Object.entries(STEP_PRESETS).forEach(([id,presets])=>{
    const wrap=el(id+'Steps');
    if(!wrap)return;
    const slider=el(id);
    if(!slider)return;
    wrap.innerHTML='';
    const curVal=parseFloat(slider.value);
    // Find closest preset
    let bestIdx=0,bestDist=Infinity;
    presets.forEach((p,i)=>{const d=Math.abs(p.v-curVal);if(d<bestDist){bestDist=d;bestIdx=i;}});
    presets.forEach((p,i)=>{
      const btn=document.createElement('button');
      btn.className='step-btn'+(i===bestIdx?' active':'');
      btn.textContent=p.l;
      btn.dataset.value=p.v;
      btn.onclick=()=>{
        wrap.querySelectorAll('.step-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        slider.value=p.v;
        if(slider.oninput)slider.oninput();
      };
      wrap.appendChild(btn);
    });
  });
}
function syncStepGroup(id){
  const wrap=el(id+'Steps');
  if(!wrap)return;
  const slider=el(id);
  if(!slider)return;
  const curVal=parseFloat(slider.value);
  const btns=wrap.querySelectorAll('.step-btn');
  let bestIdx=0,bestDist=Infinity;
  btns.forEach((b,i)=>{const d=Math.abs(parseFloat(b.dataset.value)-curVal);if(d<bestDist){bestDist=d;bestIdx=i;}});
  btns.forEach((b,i)=>b.classList.toggle('active',i===bestIdx));
}
function toast(msg){const t=el('toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),2200);}

// ─── Debug Menu ───
function toggleDebug(){
  const body=el('debugBody');
  if(!body)return;
  const header=body.previousElementSibling;
  if(body.classList.contains('collapsed')){
    body.classList.remove('collapsed');
    if(header)header.classList.add('open');
  } else {
    body.classList.add('collapsed');
    if(header)header.classList.remove('open');
  }
}
function copyDebugValues(){
  const layers=activeLayers();
  const vals={
    mode, resScale, lpi:cached.lpi, sepType:cached.sepType===1?'approx':'cmyk',
    profile:activeProf?activeProf.name:'custom',
    channels:channels.filter(c=>c),
    dens:cached.layerDens.slice(0,layers.length),
    grainSize:cached.grainSize, dotGain:cached.dotGain,
    inkNoise:cached.inkNoise, paperTex:cached.paperTex,
    ghosting:cached.ghosting,
    margin:cached.margin, bcs:[cached.imgBright,cached.imgContrast,cached.imgSat,cached.imgShadows],
    cmyk:{ucr:cached.ucrStr, balC:cached.balC, balM:cached.balM, balY:cached.balY, balK:cached.balK, tac:cached.tac},
    physics:{inkOpacity:cached.inkOpacity, layerDeplete:cached.layerDeplete, pressVar:cached.pressVar, densFlicker:cached.densFlicker, ghostMul:cached.ghostMul}
  };
  const txt=JSON.stringify(vals,null,2);
  navigator.clipboard.writeText(txt).then(()=>toast('Copied!')).catch(()=>{
    // Fallback
    const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);toast('Copied!');
  });
}
function resetCmykDefaults(){
  const defs={ucrStr:15,balC:150,balM:155,balY:105,balK:165,tac:280};
  Object.entries(defs).forEach(([k,v])=>{
    cached[k]=v;
    const s=el(k),sv=el(k+'Val');
    if(s){s.value=v;} if(sv){sv.textContent=v;}
  });
  markDirty();toast('CMYK reset');
}
function resetPhysicsDefaults(){
  const defs={inkOpacity:88,layerDeplete:3,pressVar:100,densFlicker:7,ghostMul:100,tonalGamma:140,dotMin:15,opacityCap:45};
  Object.entries(defs).forEach(([k,v])=>{
    cached[k]=v;
    const s=el(k),sv=el(k+'Val');
    if(s){s.value=v;} if(sv){sv.textContent=k==='tonalGamma'?(v*0.01).toFixed(2):v;}
  });
  markDirty();toast('Physics reset');
}
function updateDebugInfo(){
  const d=el('debugInfo');if(!d)return;const db=el('debugBody');if(db&&db.classList.contains('collapsed'))return;
  const layers=activeLayers();
  const $gl=el('gl');
  d.innerHTML=
    `canvas: ${$gl.width}×${$gl.height} (${resScale}×)<br>`+
    `layers: ${layers.length} | mode: ${mode}<br>`+
    `sep: ${cached.sepType===1?'approx':'cmyk'}<br>`+
    `profile: ${activeProf?activeProf.name:'custom'}<br>`+
    `crop: ${Array.isArray(cropAspect)?cropAspect.join(':'):cropAspect}<br>`+
    `grain: ${el('grainSize')?.value} | lpi: ${el('lpi')?.value} | dotGain: ${el('dotGain')?.value}<br>`+
    `paper: ${activePaperTex} | tex: ${el('paperTex')?.value}`;
}
function toggleSection(gridId,hdr){
  const grid=el(gridId);
  grid.classList.toggle('collapsed');
  hdr.classList.toggle('open');
}




// ─── Regmark icon button cycling ───
function cyclePreset(sliderId, presets) {
  const slider = el(sliderId);
  const cur = parseFloat(slider.value);
  let idx = 0, best = Infinity;
  presets.forEach((p,i) => { const d=Math.abs(p.v-cur); if(d<best){best=d;idx=i;} });
  idx = (idx + 1) % presets.length;
  slider.value = presets[idx].v;
  if (slider.oninput) slider.oninput();
  return presets[idx];
}

function cycleGrainSize() {
  cyclePreset('grainSize', STEP_PRESETS.grainSize);
  updateRegmarkUI();
}
function cycleLpi() {
  cyclePreset('lpi', STEP_PRESETS.lpi);
  updateRegmarkUI();
}
function cycleMisreg() {
  const p = cyclePreset('misreg', STEP_PRESETS.misreg);
  if (p.v === 0) {
    const sk = el('skew');
    if (sk) { sk.value = 0; if (sk.oninput) sk.oninput(); }
  }
  updateRegmarkUI();
}
function cycleSkew() {
  const misregVal = parseFloat(el('misreg').value);
  if (misregVal === 0) return;
  cyclePreset('skew', SKEW_PRESETS);
  updateRegmarkUI();
}
function cycleGhosting() {
  cyclePreset('ghosting', STEP_PRESETS.ghosting);
  updateRegmarkUI();
}
function cycleInkNoise() {
  cyclePreset('inkNoise', INK_NOISE_PRESETS);
  updateRegmarkUI();
}
function cycleInkSpread() {
  cyclePreset('dotGain', INK_SPREAD_PRESETS);
  updateRegmarkUI();
}
function toggleCropMarks() {
  const cb = el('cropMarksToggle');
  if (!cb) return;
  cb.checked = !cb.checked;
  cached.showCropMarks = cb.checked;
  markDirty();
  updateRegmarkUI();
}
function toggleMarginSlider() {
  const wrap = el('marginSliderWrap');
  if (!wrap) return;
  const showing = wrap.style.display !== 'none';
  wrap.style.display = showing ? 'none' : 'flex';
  // Also toggle phone version
  const phWrap = el('phMarginSliderWrap');
  if (phWrap) phWrap.style.display = showing ? 'none' : 'flex';
}

function updateRegmarkUI() {
  // Helper to update a button pair (desktop + phone)
  function syncBtn(btnId, val, active, disabled) {
    [btnId, 'ph' + btnId.charAt(0).toUpperCase() + btnId.slice(1)].forEach(id => {
      const b = el(id);
      if (!b) return;
      const v = b.querySelector('.regmark-val');
      if (v) v.textContent = val;
      b.classList.toggle('active', active);
      b.classList.toggle('disabled', !!disabled);
    });
  }

  // Grain Size — find closest preset label
  const gs = parseFloat(el('grainSize')?.value || 1.5);
  let gsLabel = gs;
  STEP_PRESETS.grainSize.forEach(p => { if (Math.abs(p.v - gs) < 0.01) gsLabel = p.l; });
  syncBtn('grainSizeBtn', gsLabel, true, false);

  // LPI
  const lpiVal = parseFloat(el('lpi')?.value || 35);
  let lpiLabel = lpiVal;
  STEP_PRESETS.lpi.forEach(p => { if (Math.abs(p.v - lpiVal) < 0.01) lpiLabel = p.l; });
  syncBtn('lpiBtn', lpiLabel, true, false);

  // Misreg
  const mr = parseFloat(el('misreg')?.value || 0);
  let mrLabel = mr;
  STEP_PRESETS.misreg.forEach(p => { if (Math.abs(p.v - mr) < 0.01) mrLabel = p.l; });
  syncBtn('misregBtn', mrLabel, mr > 0, false);

  // Skew
  const sk = parseFloat(el('skew')?.value || 0);
  let skLabel = sk;
  SKEW_PRESETS.forEach(p => { if (Math.abs(p.v - sk) < 0.01) skLabel = p.l; });
  syncBtn('skewBtn', skLabel, sk > 0, mr === 0);

  // Ghosting
  const gh = parseFloat(el('ghosting')?.value || 0);
  let ghLabel = gh;
  STEP_PRESETS.ghosting.forEach(p => { if (Math.abs(p.v - gh) < 0.01) ghLabel = p.l; });
  syncBtn('ghostingBtn', ghLabel, gh > 0, false);

  // Ink Noise
  const inVal = parseFloat(el('inkNoise')?.value || 0);
  let inLabel = inVal;
  INK_NOISE_PRESETS.forEach(p => { if (Math.abs(p.v - inVal) < 0.01) inLabel = p.l; });
  syncBtn('inkNoiseBtn', inLabel, inVal > 0, false);

  // ── Dynamic SVG: Misreg icon ──
  // 4 CMYK-colored registration marks that spread apart as misreg increases
  const cmykHex = ['#00bcd4','#e91e63','#fdd835','#333'];
  const cmykDir = [[-1,-0.7],[0.8,1.0],[0.9,-0.5],[-0.3,0.8]];
  const spread = Math.min(mr, 10) * 0.25; // 0→0px, 10→2.5px per axis
  let misregSvg = '';
  for (let i = 0; i < 4; i++) {
    const cx = 10 + cmykDir[i][0] * spread;
    const cy = 10 + cmykDir[i][1] * spread;
    misregSvg +=
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="none" stroke="${cmykHex[i]}" stroke-width="1.2" opacity="0.8"/>` +
      `<line x1="${cx.toFixed(1)}" y1="${(cy-7).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(cy+7).toFixed(1)}" stroke="${cmykHex[i]}" stroke-width="0.7" opacity="0.8"/>` +
      `<line x1="${(cx-7).toFixed(1)}" y1="${cy.toFixed(1)}" x2="${(cx+7).toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${cmykHex[i]}" stroke-width="0.7" opacity="0.8"/>`;
  }
  ['misregBtn','phMisregBtn'].forEach(id => {
    const icon = el(id)?.querySelector('.regmark-icon');
    if (icon) icon.innerHTML = misregSvg;
  });

  // ── Dynamic SVG: Skew icon ──
  // Vertical arm tilts right as skew increases; arc tracks the angle
  const skAbs = Math.abs(sk);
  const tilt = skAbs * 5;                 // top-of-arm shifts: 0→0, 1→5px right
  const topX = 4 + tilt;
  const armLen = Math.sqrt(tilt * tilt + 144); // hypotenuse of tilted arm
  const asx = (4 + 5 * tilt / armLen).toFixed(1);       // arc start x on tilted arm
  const asy = (16 - 5 * 12 / armLen).toFixed(1);        // arc start y on tilted arm
  const skewSvg =
    `<line x1="${topX.toFixed(1)}" y1="4" x2="4" y2="16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>` +
    `<line x1="4" y1="16" x2="16" y2="16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>` +
    `<path d="M${asx} ${asy} A5 5 0 0 1 9 16" fill="none" stroke="currentColor" stroke-width="1"/>`;
  ['skewBtn','phSkewBtn'].forEach(id => {
    const icon = el(id)?.querySelector('.regmark-icon');
    if (icon) icon.innerHTML = skewSvg;
  });

  // ── Dynamic SVG: Grain icon ──
  // Center dot + surrounding scatter; more & bigger dots as grain increases
  {
    const presets = STEP_PRESETS.grainSize;
    let idx = 0, best = Infinity;
    presets.forEach((p,i) => { const d = Math.abs(p.v - gs); if (d < best) { best = d; idx = i; } });
    const t = idx / (presets.length - 1); // 0→1 normalized
    const cr = 1.5 + t * 1.5;   // center dot: 1.5→3
    const nr = 0.6 + t * 0.6;   // surround dots: 0.6→1.2
    const nOp = 0.3 + t * 0.4;  // surround opacity: 0.3→0.7
    // fixed positions for 8 surrounding dots
    const pts = [[5,5],[15,5],[5,15],[15,15],[10,4],[4,10],[16,10],[10,16]];
    const count = Math.round(4 + t * 4); // 4→8 dots shown
    let grainSvg = `<circle cx="10" cy="10" r="${cr.toFixed(1)}" fill="currentColor"/>`;
    for (let i = 0; i < count; i++) {
      grainSvg += `<circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="${nr.toFixed(1)}" fill="currentColor" opacity="${nOp.toFixed(2)}"/>`;
    }
    ['grainSizeBtn','phGrainSizeBtn'].forEach(id => {
      const icon = el(id)?.querySelector('.regmark-icon');
      if (icon) icon.innerHTML = grainSvg;
    });
  }

  // ── Dynamic SVG: LPI icon ──
  // Grid of dots; more dots and tighter spacing as LPI increases
  {
    const presets = STEP_PRESETS.lpi;
    let idx = 0, best = Infinity;
    presets.forEach((p,i) => { const d = Math.abs(p.v - lpiVal); if (d < best) { best = d; idx = i; } });
    const t = idx / (presets.length - 1); // 0→1
    const cols = Math.round(2 + t * 2); // 2→4 columns
    const rows = cols;
    const r = 1.8 - t * 0.6; // dot size: 1.8→1.2
    let lpiSvg = '';
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cx = 4 + col * (12 / (cols - 1 || 1));
        const cy = 4 + row * (12 / (rows - 1 || 1));
        lpiSvg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="currentColor"/>`;
      }
    }
    ['lpiBtn','phLpiBtn'].forEach(id => {
      const icon = el(id)?.querySelector('.regmark-icon');
      if (icon) icon.innerHTML = lpiSvg;
    });
  }

  // ── Dynamic SVG: Ghosting icon ──
  // Ghost shape scaled to fit with trail echoes; more trails = higher intensity
  {
    const presets = STEP_PRESETS.ghosting;
    let idx = 0, best = Infinity;
    presets.forEach((p,i) => { const d = Math.abs(p.v - gh); if (d < best) { best = d; idx = i; } });
    // idx: 0=OFF, 1=Med, 2=High
    // Ghost path centered at ~x=10, spans x=4→16. Scale down for trail room.
    const gp = 'M10 2C6.5 2 4 5 4 8v7c0 0 1-1.5 2-1.5s1.5 1.5 2.5 1.5 1.5-1.5 2.5-1.5 1.5 1.5 2.5 1.5S15 14 16 15.5V8c0-3-2.5-6-6-6z';
    const eyes = '<circle cx="8" cy="8" r="1.5" fill="white"/><circle cx="12" cy="8" r="1.5" fill="white"/>';
    let ghostSvg = '';
    if (idx === 0) {
      // OFF: single ghost, centered, no trail
      ghostSvg = `<g opacity="0.7"><path d="${gp}" fill="currentColor"/>${eyes}</g>`;
    } else if (idx === 1) {
      // Med: scaled to 0.7, main ghost + 1 faded trail
      const s = 0.7;
      ghostSvg = `<g transform="translate(-1,2) scale(${s})" opacity="0.18"><path d="${gp}" fill="currentColor"/></g>`;
      ghostSvg += `<g transform="translate(4,2) scale(${s})" opacity="0.85"><path d="${gp}" fill="currentColor"/>${eyes}</g>`;
    } else {
      // High: scaled to 0.6, main ghost + 2 faded trails
      const s = 0.6;
      ghostSvg = `<g transform="translate(-2,3) scale(${s})" opacity="0.1"><path d="${gp}" fill="currentColor"/></g>`;
      ghostSvg += `<g transform="translate(2,3) scale(${s})" opacity="0.22"><path d="${gp}" fill="currentColor"/></g>`;
      ghostSvg += `<g transform="translate(6,3) scale(${s})" opacity="0.85"><path d="${gp}" fill="currentColor"/>${eyes}</g>`;
    }
    ['ghostingBtn','phGhostingBtn'].forEach(id => {
      const icon = el(id)?.querySelector('.regmark-icon');
      if (icon) icon.innerHTML = ghostSvg;
    });
  }

  // Drum Pressure — 3 icon states: Low / Med / Hi
  // Based on user-designed SVGs: drum circle + paper line + downward pressure arrow
  const dg = parseFloat(el('dotGain')?.value || 0);
  let dgLabel = dg;
  let dgIdx = 0;
  INK_SPREAD_PRESETS.forEach((p,i) => { if (Math.abs(p.v - dg) <= Math.abs(INK_SPREAD_PRESETS[dgIdx].v - dg)) { dgLabel = p.l; dgIdx = i; } });
  syncBtn('inkSpreadBtn', dgLabel, true, false);
  {
    const drum = '<circle cx="10" cy="9.5" r="6.6" stroke="currentColor" stroke-width="1.2" fill="none"/>';
    const paper = '<line x1="2" y1="16.6" x2="18" y2="16.6" stroke="currentColor" stroke-width="1"/>';
    let pressureSvg;
    if (dgIdx === 0) {
      // Low: thin arrow, thin center circle
      pressureSvg = drum + paper +
        '<circle cx="10" cy="10" r="1" stroke="currentColor" stroke-width="1.2" fill="none"/>' +
        '<line x1="10" y1="11.1" x2="10" y2="15" stroke="currentColor" stroke-width="0.7"/>' +
        '<path d="M8.9,14.2 L10,15.5 L11.1,14.2" fill="currentColor"/>';
    } else if (dgIdx === 1) {
      // Med: medium arrow, medium center circle
      pressureSvg = drum + paper +
        '<circle cx="10" cy="10" r="0.95" stroke="currentColor" stroke-width="1.8" fill="none"/>' +
        '<line x1="10" y1="11.1" x2="10" y2="15" stroke="currentColor" stroke-width="1.1"/>' +
        '<path d="M8.3,13.8 L10,15.8 L11.7,13.8" fill="currentColor"/>';
    } else {
      // Hi: thick arrow + stroke, heavy center circle
      pressureSvg = drum + paper +
        '<circle cx="10" cy="10" r="0.8" stroke="currentColor" stroke-width="2.5" fill="none"/>' +
        '<line x1="10" y1="11.1" x2="10" y2="15" stroke="currentColor" stroke-width="1.5"/>' +
        '<path d="M8.3,13.8 L10,15.8 L11.7,13.8" fill="currentColor" stroke="currentColor" stroke-width="0.5"/>';
    }
    ['inkSpreadBtn','phInkSpreadBtn'].forEach(id => {
      const icon = el(id)?.querySelector('.regmark-icon');
      if (icon) icon.innerHTML = pressureSvg;
    });
  }

  // Margin — text label, no value
  // (no update needed, static "Margin" text)

  // Crop Marks — toggle active state + dim text when off
  const cm = el('cropMarksToggle')?.checked !== false;
  syncBtn('cropMarksBtn', 'Crop Mark', cm, false);
}

// --- Namespace exports ---
R.togglePicker = togglePicker;
R.isMono = isMono;
R.pickColor = pickColor;
R.setMonoDens = setMonoDens;
R.setMonoAngle = setMonoAngle;
R.mapProfileToSlots = mapProfileToSlots;
R.buildChannelUI = buildChannelUI;
R.initLayerDrag = initLayerDrag;
R.renderColors = renderColors;
R.allProfiles = allProfiles;
R.renderProfiles = renderProfiles;
R.deleteCustomProfile = deleteCustomProfile;
R.openProfileCreator = openProfileCreator;
R.closeProfCreator = closeProfCreator;
R.toggleProfInk = toggleProfInk;
R.saveProfCreator = saveProfCreator;
R.applyProf = applyProf;
R.onChannelsChanged = onChannelsChanged;
R.updateUI = updateUI;
R.setChannelDens = setChannelDens;
R.setMode = setMode;
R.setSepType = setSepType;
R.setScale = setScale;
R.setRisoFps = setRisoFps;
R.cycleFps = cycleFps;
R.cycleRes = cycleRes;
R.setAngle = setAngle;
R.bindSliders = bindSliders;
R.buildStepGroups = buildStepGroups;
R.syncStepGroup = syncStepGroup;
R.toast = toast;
R.toggleDebug = toggleDebug;
R.copyDebugValues = copyDebugValues;
R.resetCmykDefaults = resetCmykDefaults;
R.resetPhysicsDefaults = resetPhysicsDefaults;
R.updateDebugInfo = updateDebugInfo;
R.toggleSection = toggleSection;
R.cycleGrainSize = cycleGrainSize;
R.cycleLpi = cycleLpi;
R.cycleMisreg = cycleMisreg;
R.cycleSkew = cycleSkew;
R.cycleGhosting = cycleGhosting;
R.cycleInkNoise = cycleInkNoise;
R.cycleInkSpread = cycleInkSpread;
R.toggleCropMarks = toggleCropMarks;
R.toggleMarginSlider = toggleMarginSlider;
R.updateRegmarkUI = updateRegmarkUI;

})(window.R);
