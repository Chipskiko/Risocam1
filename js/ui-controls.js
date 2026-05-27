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
  return active.length>=1 && new Set(active).size===1;
}

// Index of the surviving mono ink. Returns 0 if no active channel (default slot).
// This handles the case where a user deletes spot channels and leaves the
// remaining ink in slot 1, 2, or 3 — not necessarily slot 0.
function monoIdx(){
  for(let i=0;i<channels.length;i++) if(channels[i]!==null) return i;
  return 0;
}

function pickColor(ch, name){
  if(isMono()||ch==='mono'){
    // In mono: write to whatever slot the surviving ink is in (not always 0)
    const idx=monoIdx();
    channels[idx]=name;
  } else {
    channels[ch]=name;
  }
  openPicker=-1;
  onChannelsChanged();
}

function setMonoDens(val){
  const v=parseFloat(val);
  // MONO can mean "single channel" OR "multiple channels all carrying the
  // same ink" (CMYK profiles like Mono fill all 4 slots with one color).
  // The slider needs to sync ALL of them — otherwise sliding to 0 only
  // zeros one channel and the duplicates keep printing.
  for(let i=0;i<4;i++) if(channels[i]!==null) cached.layerDens[i]=v;
  markDirty();
}

function setMonoAngle(deg){
  // Same logic — sync angle across all duplicated MONO channels.
  for(let i=0;i<4;i++) if(channels[i]!==null) layerAngles[i]=deg;
  // Keep the explicit set in case channels are empty (defensive).
  layerAngles[monoIdx()]=deg;
  // Skip rebuild during slider drag (would tear down the slider DOM).
  if(!window._lineCtlOpen){
    buildChannelUI();
    if(el('phChannelList')&&el('phChannelList').children.length) buildChannelUI('phChannelList');
  }
  markDirty();
}

// Map profile colors to 4 CMYK slots (always fill all 4)
function mapProfileToSlots(colors){
  if(colors.length===1) return [colors[0],null,null,null];
  if(colors.length===2) return [colors[0],colors[1],colors[1],colors[0]]; // dark on C+K, warm on M+Y
  if(colors.length===3) return [colors[0],colors[1],colors[2],colors[0]]; // first color doubles on K
  return [colors[0],colors[1],colors[2],colors[3]];
}

// Grouped ink list for dropdown
const INK_LIST=[
  {group:'Standard',inks:['Black','Blue','Bright Red','Yellow','White']},
  {group:'Warm',inks:['Orange','Cranberry','Brick','Brown','Flat Gold','Bisque','Bubblegum','Wine','Burgundy']},
  {group:'Cool',inks:['Teal','Cornflower','Turquoise','Federal Blue','Purple','Violet','Indigo','Lagoon','Smoky Teal']},
  {group:'Greens',inks:['Green','Hunter Green','Kelly Green','Mint','Light Lime','Bright Olive']},
  {group:'Fluorescent',inks:['Fl. Pink','Fl. Yellow','Fl. Orange','Fl. Green','Fl. Red']},
  {group:'Specials',inks:['Metallic Gold','Copper','Coral','Mist','Aqua','Raspberry','Sunflower','Melon','Scarlet','Clear Medium']},
  {group:'Process CMYK',inks:['Process Cyan','Process Magenta','Process Yellow','Process Black']},
];
function buildInkDropdownItems(ch,selectedName){
  let html='';
  INK_LIST.forEach((g,gi)=>{
    html+=`<div class="ch-dropdown-group">${g.group}</div>`;
    g.inks.forEach(n=>{
      const irc=RISO_COLORS.find(r=>r.name===n);
      if(!irc) return;
      const esc=n.replace(/'/g,"\\'");
      const chArg=typeof ch==='number'?ch:`'${ch}'`;
      const sel=selectedName===n?' selected':'';
      const wc=n==='White'?' white-dot':'';
      html+=`<div class="ch-dropdown-item${sel}" onclick="event.stopPropagation();R.pickColor(${chArg},'${esc}')">
        <span class="ch-dropdown-dot${wc}" style="background:${irc.hex}"></span>
        <span class="ch-dropdown-name">${n}</span>
      </div>`;
    });
  });
  return html;
}

// ─── Spot channel add/remove ───
function addSpotChannel(){
  // Find first empty (null) channel slot and assign a default ink
  const used=new Set(channels.filter(c=>c!==null));
  // Pick first ink from RISO_COLORS not already in use
  let pick=null;
  for(const rc of RISO_COLORS){
    if(!used.has(rc.name)){ pick=rc.name; break; }
  }
  if(!pick) pick=RISO_COLORS[0].name; // fallback
  // Find empty slot
  for(let i=0;i<4;i++){
    if(channels[i]===null){
      channels[i]=pick;
      onChannelsChanged();
      // Open picker for this new channel so user can choose
      openPicker=i;
      buildChannelUI();
      if(el('phChannelList')&&el('phChannelList').children.length) buildChannelUI('phChannelList');
      return;
    }
  }
  // No empty slot — all 4 used. Check if any duplicates can be freed.
  // In spot mode, duplicates are hidden, so just assign to first duplicate slot
  const counts={};
  for(let i=0;i<4;i++){ const c=channels[i]; if(c) counts[c]=(counts[c]||0)+1; }
  for(let i=0;i<4;i++){
    const c=channels[i];
    if(c && counts[c]>1){
      channels[i]=pick;
      counts[c]--;
      onChannelsChanged();
      openPicker=i;
      buildChannelUI();
      if(el('phChannelList')&&el('phChannelList').children.length) buildChannelUI('phChannelList');
      return;
    }
  }
}

function removeSpotChannel(ch){
  channels[ch]=null;
  openPicker=-1;
  onChannelsChanged();
  buildChannelUI();
  if(el('phChannelList')&&el('phChannelList').children.length) buildChannelUI('phChannelList');
}

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
  // Show per-plate angle controls in both SCREEN and LINES modes — both
  // care about angle (dot-grid rotation for screen, line orientation for
  // lines). Grain mode is stochastic and ignores angle.
  const isScreen=mode==='screen'||mode==='lines';

  // ─── Mono mode: single consolidated row ───
  if(isMono()){
    const mIdx=monoIdx();
    const name=channels[mIdx];
    const rc=name?RISO_COLORS.find(r=>r.name===name):null;
    const hex=rc?rc.hex:'#ccc';
    const isOpen=openPicker===mIdx;
    const isWhite=name==='White';
    const dens=Math.round(cached.layerDens[mIdx]);
    const trackBg=rc?`linear-gradient(90deg,${hex}15,${hex})`:`linear-gradient(90deg,#eee,#aaa)`;
    const curAngle=layerAngles[mIdx]||0;

    let html=`<div class="ch-slot">`;
    html+=`<div class="ch-mono-row">
      <span class="ch-mono-label${layerVisible[mIdx]?'':' dimmed'}" onclick="event.stopPropagation();R.toggleLayerVisible(${mIdx})" style="cursor:pointer" title="Click to toggle plate visibility">MONO</span>
      <div class="ch-color-btn${isWhite?' white-border':''}${isOpen?' open':''}" style="background:${hex}" onclick="R.togglePicker(${mIdx})"></div>
      <input type="range" class="ch-dens" min="0" max="100" value="${dens}" step="2"
        oninput="R.setMonoDens(this.value)"
        style="background:${trackBg}">`;
    if(isScreen){
      if(mode==='lines'){
        // Same drawer-on-click pattern as multi-layer mode (see comments
        // there). Buttons stay buttons; the slider lives in a drawer
        // appended after the slot HTML below.
        const shapeIdx = window._lineShape | 0;
        const radialish = (shapeIdx === 3 || shapeIdx === 4 || shapeIdx === 5);
        const open = window._lineCtlOpen || '';
        const aDeg = Math.round(curAngle);
        const cx = Math.round((layerLineCenterX[mIdx] ?? 0.5) * 100);
        const cy = Math.round((layerLineCenterY[mIdx] ?? 0.5) * 100);
        const btn = (axis, label) => {
          const isOpen = open === (mIdx + '_' + axis);
          return `<button class="ch-angle-btn${isOpen?' active':''}" style="min-width:38px" onclick="event.stopPropagation();R.toggleLineCtl(${mIdx},'${axis}')">${label}</button>`;
        };
        html += `<div class="ch-angles" style="gap:3px">`;
        html += btn('angle', aDeg+'°');
        if(radialish){
          html += btn('x', 'X '+cx+'%');
          html += btn('y', 'Y '+cy+'%');
        }
        html += `</div>`;
      } else {
        html+=`<div class="ch-angles">`;
        angles.forEach(a=>{
          html+=`<button class="ch-angle-btn${curAngle===a?' active':''}" onclick="event.stopPropagation();R.setMonoAngle(${a})">${a}°</button>`;
        });
        html+=`</div>`;
      }
    }
    html+=`</div>`;
    // Color picker dropdown
    html+=`<div class="ch-dropdown${isOpen?' open':''}">`;
    html+=buildInkDropdownItems('mono',name);
    html+=`</div></div>`;
    // Drawer slider (same pattern as multi-layer mode) — appended below
    // the mono row when one of its metric buttons is open.
    if(mode==='lines'){
      const open = window._lineCtlOpen || '';
      if(open && open.startsWith(mIdx + '_')){
        const aDeg = Math.round(layerAngles[mIdx] || 0);
        const cx = Math.round((layerLineCenterX[mIdx] ?? 0.5) * 100);
        const cy = Math.round((layerLineCenterY[mIdx] ?? 0.5) * 100);
        const axis = open.substring((mIdx + '_').length);
        let lbl='', val=0, mn=0, mx=100, setter='', suf='';
        if(axis === 'angle'){ lbl='Angle';    val=aDeg; mn=0; mx=180; setter=`R.setMonoAngle(parseInt(this.value,10))`;                      suf='°'; }
        else if(axis === 'x'){ lbl='Center X'; val=cx;   mn=0; mx=100; setter=`R.setLineCenterX(${mIdx}, parseInt(this.value,10)/100)`;       suf='%'; }
        else if(axis === 'y'){ lbl='Center Y'; val=cy;   mn=0; mx=100; setter=`R.setLineCenterY(${mIdx}, parseInt(this.value,10)/100)`;       suf='%'; }
        if(setter){
          html += `<div class="ch-line-drawer" style="border-left:3px solid var(--text)">
            <span class="ch-line-drawer-label">${lbl}</span>
            <input type="range" class="ch-line-slider" min="${mn}" max="${mx}" step="1" value="${val}"
              oninput="event.stopPropagation();${setter};this.nextElementSibling.textContent=this.value+'${suf}'">
            <span class="ch-line-drawer-val">${val}${suf}</span>
          </div>`;
        }
      }
    }
    list.insertAdjacentHTML('beforeend',html);
    // In spot mode, allow adding more colors from mono
    if(cached.sepType===1){
      list.insertAdjacentHTML('beforeend',`<div class="ch-add-row" onclick="R.addSpotChannel()"><div class="ch-add-swatch">+</div><span class="ch-add-label">ADD COLOR</span></div>`);
    }
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

    const uniqueCount=new Set(channels.filter(c=>c!==null)).size;
    const canRemove=isSpot && uniqueCount>1;
    let html=`<div class="ch-slot${layerVisible[i]?'':' layer-hidden'}" data-ch="${i}" data-pos="${pos}">`;
    // Compact row: [drag] [badge] [color-btn] [density slider] [remove btn] [angle buttons]
    html+=`<div class="ch-row">
      <span class="ch-drag" data-drag="${pos}">⡇</span>
      <span class="ch-badge ${badgeCls}${layerVisible[i]?'':' dimmed'}" onclick="event.stopPropagation();R.toggleLayerVisible(${i})" style="cursor:pointer" title="Click to toggle plate visibility">${badgeLabel}</span>
      <div class="ch-color-btn${isWhite?' white-border':''}${isOpen?' open':''}" style="background:${hex}" onclick="R.togglePicker(${i})"></div>
      <input type="range" class="ch-dens" min="0" max="100" value="${dens}" step="2"
        oninput="R.setChannelDens(${i},this.value)"
        style="background:${trackBg}">`;
    if(canRemove){
      html+=`<span class="ch-remove-btn" onclick="event.stopPropagation();R.removeSpotChannel(${i})" title="Remove">&times;</span>`;
    }
    // Per-plate knockout button removed from the UI — the feature is
    // available via the global text-channel knockout in PDF mode and
    // wasn't pulling its weight as a per-plate toggle.
    if(isScreen){
      const linkStyle=isLinked?` style="border-bottom:2px solid ${linkedColor[i]};padding-bottom:1px"`:'';
      if(mode==='lines'){
        // LINES mode: per-plate metric buttons (Angle, X, Y). Clicking a
        // button doesn't replace it inline — it pops a wider drawer slider
        // appended below the plate row (rendered after the slot, see
        // drawerHtml below). Active button gets the .active class so you
        // can see which slider is open. The X/Y buttons only appear for
        // CONCENTRIC (3) / RADIAL (4) / SPIRAL (5) where the pivot matters.
        const shapeIdx = window._lineShape | 0;
        const radialish = (shapeIdx === 3 || shapeIdx === 4 || shapeIdx === 5);
        const open = window._lineCtlOpen || '';
        const aDeg = Math.round(curAngle);
        const cx = Math.round((layerLineCenterX[i] ?? 0.5) * 100);
        const cy = Math.round((layerLineCenterY[i] ?? 0.5) * 100);
        const accent = isLinked ? linkedColor[i] : 'var(--text)';
        const btn = (axis, label) => {
          const isOpen = open === (i + '_' + axis);
          return `<button class="ch-angle-btn${isOpen?' active':''}" style="border-bottom:2px solid ${accent};min-width:38px" onclick="event.stopPropagation();R.toggleLineCtl(${i},'${axis}')">${label}</button>`;
        };
        html += `<div class="ch-angles"${linkStyle ? linkStyle : ''} style="gap:3px">`;
        html += btn('angle', aDeg+'°');
        if(radialish){
          html += btn('x', 'X '+cx+'%');
          html += btn('y', 'Y '+cy+'%');
        }
        html += `</div>`;
      } else {
        html+=`<div class="ch-angles"${linkStyle}>`;
        angles.forEach(a=>{
          html+=`<button class="ch-angle-btn${curAngle===a?' active':''}" onclick="event.stopPropagation();R.setAngle(${i},${a})">${a}°</button>`;
        });
        html+=`</div>`;
      }
    }
    html+=`</div>`;
    html+=`<div class="ch-dropdown${isOpen?' open':''}">`;
    html+=buildInkDropdownItems(i,name);
    html+=`</div></div>`;
    // Append a "drawer" slider row immediately AFTER this plate's slot
    // when one of its metric buttons is open. The drawer is a sibling of
    // the slot, so it slots cleanly into the channel-list flex column
    // and visually anchors to the right plate.
    if(mode==='lines'){
      const open = window._lineCtlOpen || '';
      if(open && open.startsWith(i + '_')){
        const aDeg = Math.round(layerAngles[i] || 0);
        const cx = Math.round((layerLineCenterX[i] ?? 0.5) * 100);
        const cy = Math.round((layerLineCenterY[i] ?? 0.5) * 100);
        const accent = isLinked ? linkedColor[i] : 'var(--text)';
        const axis = open.substring((i + '_').length);
        let lbl='', val=0, mn=0, mx=100, setter='', suf='';
        if(axis === 'angle'){ lbl='Angle';    val=aDeg; mn=0; mx=180; setter=`R.setAngle(${i}, parseInt(this.value,10))`;                  suf='°'; }
        else if(axis === 'x'){ lbl='Center X'; val=cx;   mn=0; mx=100; setter=`R.setLineCenterX(${i}, parseInt(this.value,10)/100)`;        suf='%'; }
        else if(axis === 'y'){ lbl='Center Y'; val=cy;   mn=0; mx=100; setter=`R.setLineCenterY(${i}, parseInt(this.value,10)/100)`;        suf='%'; }
        if(setter){
          html += `<div class="ch-line-drawer" style="border-left:3px solid ${accent}">
            <span class="ch-line-drawer-label">${lbl}</span>
            <input type="range" class="ch-line-slider" min="${mn}" max="${mx}" step="1" value="${val}"
              oninput="event.stopPropagation();${setter};this.nextElementSibling.textContent=this.value+'${suf}'">
            <span class="ch-line-drawer-val">${val}${suf}</span>
          </div>`;
        }
      }
    }
    list.insertAdjacentHTML('beforeend',html);
  }
  // Add spot channel button (only in spot mode, max 4 unique)
  if(isSpot){
    const uniqueCount=new Set(channels.filter(c=>c!==null)).size;
    if(uniqueCount<4){
      list.insertAdjacentHTML('beforeend',`<div class="ch-add-row" onclick="R.addSpotChannel()"><div class="ch-add-swatch">+</div><span class="ch-add-label">ADD COLOR</span></div>`);
    }
  }
  initLayerDrag(list);
  // Refresh text channel label if PDF mode is on — channel changes can
  // make the chosen text color disappear or shift slot index.
  if(typeof pdfModeOn !== 'undefined' && pdfModeOn) refreshTextChannelRow();
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
  // T1-C: when the palette IS a CMYK rosette (4 inks, one per CMYK bucket),
  // auto-assign the matching rosette angle to each channel by detected bucket.
  // No-op otherwise — leaves the slot-order default in place.
  autoLockCmykAnglesIfPossible();
  // R.syncSameColorPlates (in onChannelsChanged) locks same-ink channels together
  onChannelsChanged();
  R.pushUndo();
  if(isPhone()) R.phCloseOverlay();
}

function onChannelsChanged(){
  // T1-C: also re-check the auto-rosette condition on any channel swap,
  // so building a CMYK palette by hand (one ink slot at a time) snaps to the
  // rosette as soon as the 4th distinct bucket is filled. Does nothing if the
  // palette isn't a clean CMYK-of-4-buckets.
  autoLockCmykAnglesIfPossible();
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

  // Update sep type label: MONO for 1 color, CMYK for multi
  const cBtn=el('sepCmyk');
  if(cBtn) cBtn.textContent = unique.size <= 1 ? 'MONO' : 'CMYK';
  // Show CMYK tuning only in CMYK mode with 4 layers (balance/TAC irrelevant for mono)
  const cmykDiv=el('cmykTuning');
  if(cmykDiv) cmykDiv.style.display=(cached.sepType===0 && unique.size >= 4)?'':'none';
  updateDebugInfo();
}

function setChannelDens(ch,val){
  cached.layerDens[ch]=parseFloat(val);markDirty();
}


function setMode(m){
  mode=m;
  window._mode=m; // expose for cross-file checks (source.js source-change hook)
  // Desktop mode buttons (may not exist in phone-only scenarios)
  const mg=el('modeGrain'),ms=el('modeScreen'),ml=el('modeLines'),mf=el('modeFlat');
  if(mg)mg.classList.toggle('active',m==='grain');
  if(ms)ms.classList.toggle('active',m==='screen');
  if(ml)ml.classList.toggle('active',m==='lines');
  if(mf)mf.classList.toggle('active',m==='flat');
  // RISO mode (button label says RISO, internal id still 'flat' for compat):
  // trigger the JS AMT prepass — vanilla FS + empirical Riso tone curve.
  // Static-source-only; the prepass takes ~200ms at 300dpi.
  if(m === 'flat' && window.R && window.R.runAmtPrepass){
    setTimeout(window.R.runAmtPrepass, 0);
  }
  // Three-row settings layout:
  //   Row 1 — primary mode controls (size knob + shape selector + pressure)
  //   Row 2 — mode-specific shared sub-settings (e.g. line weight/amount/rough)
  //   Row 3 — shape-specific sub-settings (e.g. radial center/density/edge)
  // Show the right primary block, hide the others.
  const screenLike = m==='screen' || m==='lines';
  const grnP=el('grainPrimary'), scrP=el('screenPrimary'), lnsP=el('linesPrimary');
  if(grnP) grnP.style.display = (m==='grain') ? 'flex' : 'none';
  if(scrP) scrP.style.display = (m==='screen') ? 'flex' : 'none';
  if(lnsP) lnsP.style.display = (m==='lines') ? 'flex' : 'none';
  // Row 2: dither scale (grain sub-mode), or line secondary (lines).
  const lnsSec = el('linesSecondary');
  if(lnsSec) lnsSec.style.display = (m==='lines') ? 'flex' : 'none';
  // The whole row hides when nothing inside is visible.
  const row2 = el('modeSecondaryRow');
  if(row2){
    const ditherScaleVisible = (m==='grain') && ((window._ditherMode|0) !== 0);
    const linesSecVisible = (m==='lines');
    row2.style.display = (ditherScaleVisible || linesSecVisible) ? 'flex' : 'none';
  }
  // Refresh radial-only controls (Row 3 is gated by both mode + shape).
  if(typeof refreshLineCenterUI === 'function') refreshLineCenterUI();
  if(typeof refreshDitherScaleVisibility === 'function') refreshDitherScaleVisibility();
  if(typeof refreshShapeIcons === 'function') refreshShapeIcons();
  // DEFAULT (lock-to-CMYK-rosette) angles only apply to SCREEN's halftone
  // dot orientation — that's where the standard 15°/75°/0°/45° rosette
  // convention exists. In LINES the per-plate angle is a freeform line
  // rotation; in GRAIN angles do nothing at all.
  const lockBtn=el('lockAnglesBtn');
  if(lockBtn) lockBtn.style.display = (m==='screen') ? '' : 'none';
  // Phone settings wrappers — 'lines' shares LPI controls with 'screen'
  const phScr=el('phScreenSettings'),phGrn=el('phGrainSettings');
  if(phScr)phScr.style.display=screenLike?'block':'none';
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

// LINES mode shape variants — names + index match shader's u_lineShape uniform
// Shape names — order MUST match the shader's u_lineShape branches.
// 0=STRAIGHT, 1=WAVY, 2=GUILLOCHÉ, 3=CONCENTRIC, 4=RADIAL, 5=SPIRAL, 6=CROSS
const LINE_SHAPES = ['STRAIGHT', 'WAVY', 'GUILLOCHÉ', 'CONCENTRIC', 'RADIAL', 'SPIRAL', 'CROSS'];
window._lineShape = window._lineShape ?? 0;
window._lineAmount = window._lineAmount ?? 1.0;
window._lineWeight = window._lineWeight ?? 1.0;
window._lineRoughness = window._lineRoughness ?? 0.5;
function cycleLineShape(){
  window._lineShape = (window._lineShape + 1) % LINE_SHAPES.length;
  const lbl = LINE_SHAPES[window._lineShape];
  const v = el('lineShapeBtnPanelVal'); if(v) v.textContent = lbl;
  const v2 = el('lineShapeBtnVal'); if(v2) v2.textContent = lbl; // legacy if present
  R.toast('Line shape: ' + lbl);
  refreshLineCenterUI();
  if(typeof refreshShapeIcons === 'function') refreshShapeIcons();
  markDirty();
}
// Line weight: 4 steps — Thin / 1× / Bold / Heavy
const LINE_WEIGHT_STEPS = [{v:0.6, l:'Thin'}, {v:1.0, l:'1×'}, {v:1.4, l:'Bold'}, {v:1.8, l:'Heavy'}];
function cycleLineWeight(){
  // Find current step by closest value, advance
  let i = LINE_WEIGHT_STEPS.findIndex(s => Math.abs(s.v - window._lineWeight) < 0.05);
  if(i < 0) i = 1;
  i = (i + 1) % LINE_WEIGHT_STEPS.length;
  window._lineWeight = LINE_WEIGHT_STEPS[i].v;
  const v = el('lineWeightBtnVal'); if(v) v.textContent = LINE_WEIGHT_STEPS[i].l;
  R.toast('Line weight: ' + LINE_WEIGHT_STEPS[i].l);
  markDirty();
}
// Shape amount: 0% / 25% / 50% / 75% / 100% / 150%
const LINE_AMOUNT_STEPS = [0.0, 0.25, 0.5, 0.75, 1.0, 1.5];
function cycleLineAmount(){
  let i = LINE_AMOUNT_STEPS.findIndex(v => Math.abs(v - window._lineAmount) < 0.05);
  if(i < 0) i = 4;
  i = (i + 1) % LINE_AMOUNT_STEPS.length;
  window._lineAmount = LINE_AMOUNT_STEPS[i];
  const lbl = Math.round(LINE_AMOUNT_STEPS[i] * 100) + '%';
  const v = el('lineAmountBtnVal'); if(v) v.textContent = lbl;
  R.toast('Shape amount: ' + lbl);
  markDirty();
}
// Edge roughness: Off / Low / Med / High / Inky
const LINE_ROUGH_STEPS = [{v:0.0, l:'Off'}, {v:0.25, l:'Low'}, {v:0.5, l:'Med'}, {v:0.75, l:'High'}, {v:1.0, l:'Inky'}];
function cycleLineRoughness(){
  let i = LINE_ROUGH_STEPS.findIndex(s => Math.abs(s.v - window._lineRoughness) < 0.05);
  if(i < 0) i = 2;
  i = (i + 1) % LINE_ROUGH_STEPS.length;
  window._lineRoughness = LINE_ROUGH_STEPS[i].v;
  const v = el('lineRoughBtnVal'); if(v) v.textContent = LINE_ROUGH_STEPS[i].l;
  R.toast('Edge roughness: ' + LINE_ROUGH_STEPS[i].l);
  markDirty();
}

// Center position for CONCENTRIC + RADIAL line shapes. Cycles through
// 0/25/50/75/100% along each axis. Visibility of these buttons is
// gated on shape — see refreshLineCenterUI().
const LINE_CENTER_STEPS = [0.0, 0.25, 0.5, 0.75, 1.0];
window._lineCenterX = window._lineCenterX ?? 0.5;
window._lineCenterY = window._lineCenterY ?? 0.5;
function cycleLineCenterX(){
  let i = LINE_CENTER_STEPS.findIndex(v => Math.abs(v - window._lineCenterX) < 0.05);
  if(i < 0) i = 2;
  i = (i + 1) % LINE_CENTER_STEPS.length;
  window._lineCenterX = LINE_CENTER_STEPS[i];
  const pct = Math.round(LINE_CENTER_STEPS[i] * 100) + '%';
  const v = el('lineCxBtnVal'); if(v) v.textContent = 'X ' + pct;
  R.toast('Center X: ' + pct);
  markDirty();
}
function cycleLineCenterY(){
  let i = LINE_CENTER_STEPS.findIndex(v => Math.abs(v - window._lineCenterY) < 0.05);
  if(i < 0) i = 2;
  i = (i + 1) % LINE_CENTER_STEPS.length;
  window._lineCenterY = LINE_CENTER_STEPS[i];
  const pct = Math.round(LINE_CENTER_STEPS[i] * 100) + '%';
  const v = el('lineCyBtnVal'); if(v) v.textContent = 'Y ' + pct;
  R.toast('Center Y: ' + pct);
  markDirty();
}
// Density multiplier for CONCENTRIC rings + RADIAL spokes. 1× preserves
// the default behavior (rings derived from cellPx, spokes from base
// formula). 0.25× = quarter density, 8× = eight times more.
const LINE_COUNT_STEPS = [
  {v:0.25, l:'¼×'}, {v:0.5, l:'½×'}, {v:1, l:'1×'},
  {v:2, l:'2×'},   {v:4, l:'4×'},   {v:8, l:'8×'},
];
window._lineCount = window._lineCount ?? 1;
function cycleLineCount(){
  let i = LINE_COUNT_STEPS.findIndex(s => Math.abs(s.v - window._lineCount) < 0.01);
  if(i < 0) i = 2;
  i = (i + 1) % LINE_COUNT_STEPS.length;
  window._lineCount = LINE_COUNT_STEPS[i].v;
  const v = el('lineCountBtnVal'); if(v) v.textContent = LINE_COUNT_STEPS[i].l;
  R.toast('Density: ' + LINE_COUNT_STEPS[i].l);
  markDirty();
}

// Edge thickness for CONCENTRIC/RADIAL: rings/spokes near the center
// stay at base weight; rings/spokes at the canvas edge get progressively
// heavier. 0 = uniform thickness; 1 = strong falloff toward edges.
const LINE_EDGE_STEPS = [{v:0.0, l:'Off'}, {v:0.3, l:'Light'}, {v:0.6, l:'Med'}, {v:1.0, l:'Heavy'}];
window._lineEdgeThickness = window._lineEdgeThickness ?? 0.0;
function cycleLineEdgeThickness(){
  let i = LINE_EDGE_STEPS.findIndex(s => Math.abs(s.v - window._lineEdgeThickness) < 0.05);
  if(i < 0) i = 0;
  i = (i + 1) % LINE_EDGE_STEPS.length;
  window._lineEdgeThickness = LINE_EDGE_STEPS[i].v;
  const v = el('lineEdgeBtnVal'); if(v) v.textContent = LINE_EDGE_STEPS[i].l;
  R.toast('Edge thickness: ' + LINE_EDGE_STEPS[i].l);
  markDirty();
}

// Show Row 3 (shape-specific) only for radial-ish line shapes:
// CONCENTRIC (3), RADIAL (4), SPIRAL (5).
function refreshLineCenterUI(){
  const shapeIdx = window._lineShape | 0;
  const radialish = (shapeIdx === 3 || shapeIdx === 4 || shapeIdx === 5);
  const inLines = mode === 'lines';
  const row = el('shapeSpecificRow');
  if(row) row.style.display = (inLines && radialish) ? 'flex' : 'none';
  // Per-plate line-center buttons (rendered inside the channel rows by
  // buildChannelUI) are tagged with .line-center-btn — toggle their
  // visibility based on shape.
  document.querySelectorAll('.line-center-btn').forEach(b => {
    if(b.id === 'shapeSpecificRow') return; // already handled above
    b.style.display = (inLines && radialish) ? '' : 'none';
  });
}

// Update shape-button SVG icons to match the current selection — gives
// the line-shape and stamp-shape buttons a recognizable visual at a glance.
const SHAPE_ICONS_LINE = [
  // STRAIGHT
  '<svg width="20" height="20" viewBox="0 0 20 20"><line x1="2" y1="6" x2="18" y2="6" stroke="currentColor" stroke-width="1.6"/><line x1="2" y1="10" x2="18" y2="10" stroke="currentColor" stroke-width="1.6"/><line x1="2" y1="14" x2="18" y2="14" stroke="currentColor" stroke-width="1.6"/></svg>',
  // WAVY
  '<svg width="20" height="20" viewBox="0 0 20 20"><path d="M2 6 Q5 3 8 6 T14 6 T20 6" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M2 10 Q5 7 8 10 T14 10 T20 10" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M2 14 Q5 11 8 14 T14 14 T20 14" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>',
  // GUILLOCHÉ
  '<svg width="20" height="20" viewBox="0 0 20 20"><path d="M2 10 Q5 4 10 10 T18 10" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M2 10 Q5 16 10 10 T18 10" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>',
  // CONCENTRIC
  '<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="3" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  // RADIAL
  '<svg width="20" height="20" viewBox="0 0 20 20"><line x1="10" y1="10" x2="10" y2="2" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="10" x2="17" y2="5" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="10" x2="17" y2="15" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="10" x2="10" y2="18" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="10" x2="3" y2="15" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="10" x2="3" y2="5" stroke="currentColor" stroke-width="1.2"/></svg>',
  // SPIRAL
  '<svg width="20" height="20" viewBox="0 0 20 20"><path d="M10 10 Q10 7 13 7 Q17 7 17 11 Q17 16 11 16 Q4 16 4 9 Q4 1 13 1" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>',
  // CROSS
  '<svg width="20" height="20" viewBox="0 0 20 20"><line x1="2" y1="6" x2="18" y2="6" stroke="currentColor" stroke-width="1.4"/><line x1="2" y1="14" x2="18" y2="14" stroke="currentColor" stroke-width="1.4"/><line x1="6" y1="2" x2="6" y2="18" stroke="currentColor" stroke-width="1.4"/><line x1="14" y1="2" x2="14" y2="18" stroke="currentColor" stroke-width="1.4"/></svg>',
];
const SHAPE_ICONS_STAMP = [
  // Circle
  '<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="6" fill="currentColor"/></svg>',
  // Square
  '<svg width="20" height="20" viewBox="0 0 20 20"><rect x="4" y="4" width="12" height="12" fill="currentColor"/></svg>',
  // Diamond
  '<svg width="20" height="20" viewBox="0 0 20 20"><polygon points="10,2 18,10 10,18 2,10" fill="currentColor"/></svg>',
  // Plus
  '<svg width="20" height="20" viewBox="0 0 20 20"><rect x="8" y="2" width="4" height="16" fill="currentColor"/><rect x="2" y="8" width="16" height="4" fill="currentColor"/></svg>',
  // Star
  '<svg width="20" height="20" viewBox="0 0 20 20"><polygon points="10,2 12.5,7.5 18,8.5 14,12.5 15,18 10,15 5,18 6,12.5 2,8.5 7.5,7.5" fill="currentColor"/></svg>',
  // Heart
  '<svg width="20" height="20" viewBox="0 0 20 20"><path d="M10 17 C10 17 2 12 2 7 C2 4 5 2 7 4 C8 5 10 7 10 7 C10 7 12 5 13 4 C15 2 18 4 18 7 C18 12 10 17 10 17 Z" fill="currentColor"/></svg>',
];
function refreshShapeIcons(){
  const lineIcon = el('lineShapeIcon');
  if(lineIcon) lineIcon.innerHTML = SHAPE_ICONS_LINE[(window._lineShape|0) % SHAPE_ICONS_LINE.length] || '';
  const stampIcon = el('stampShapeIcon');
  if(stampIcon) stampIcon.innerHTML = SHAPE_ICONS_STAMP[(window._stampShape|0) % SHAPE_ICONS_STAMP.length] || '';
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
// ─── Halftone stamp shape (SCREEN mode dot replacement) ───
const STAMP_SHAPES = ['Circle', 'Square', 'Diamond', 'Plus', 'Star', 'Heart'];
window._stampShape = window._stampShape ?? 0;
function cycleStampShape(){
  window._stampShape = (window._stampShape + 1) % STAMP_SHAPES.length;
  const v = el('stampShapeBtnVal'); if(v) v.textContent = STAMP_SHAPES[window._stampShape];
  R.toast('Stamp: ' + STAMP_SHAPES[window._stampShape]);
  if(typeof refreshShapeIcons === 'function') refreshShapeIcons();
  markDirty();
}
// Clean halftone toggle — Spectrolite-style preview where SCREEN renders
// just the halftone dots without paper texture, drum jitter, ink noise,
// dot gain, or any other simulation. The user's noise sliders aren't
// changed; we just bypass them at upload time when this is on.
window._screenClean = window._screenClean ?? false;
function toggleScreenClean(){
  window._screenClean = !window._screenClean;
  const v = el('screenCleanBtnVal'); if(v) v.textContent = window._screenClean ? 'On' : 'Off';
  const b = el('screenCleanBtn'); if(b) b.classList.toggle('active', window._screenClean);
  R.toast('Clean halftone: ' + (window._screenClean ? 'ON' : 'OFF'));
  markDirty();
}

// ─── Dither mode cycler ───
// Wraps the existing R.setDitherMode (which only fires from debug-panel
// buttons) so users can cycle through algorithms from the main settings panel.
const DITHER_MODE_STEPS = [
  {v:0, l:'Grain'},     // stochastic hash threshold
  {v:7, l:'Grain Touch'}, // JS AMT pre-pass: Floyd-Steinberg + ht5 matrix + measured tone curve (Ghidra-confirmed RISO MZ9 algorithm)
  {v:5, l:'Bayer 4'},   // ordered 4×4 matrix (visually distinct from grain)
  {v:6, l:'Bayer 8'},   // ordered 8×8 matrix (finer)
  {v:3, l:'Atkinson'},  // 6-neighbor diffuse (parallel approximation)
  {v:4, l:'F-S'},       // 4-neighbor Floyd-Steinberg (parallel approximation)
  {v:1, l:'Stucki'},    // 6-neighbor wide-kernel diffuse
  {v:2, l:'JJN'},       // 9-neighbor widest-kernel diffuse
];
// Dither cell scale — bigger = chunkier dots. Only affects error-diffusion +
// Bayer modes (grain has its own size knob via grainSize).
const DITHER_SCALE_STEPS = [{v:1, l:'1×'}, {v:2, l:'2×'}, {v:3, l:'3×'}, {v:4, l:'4×'}, {v:6, l:'6×'}, {v:8, l:'8×'}, {v:12, l:'12×'}];
window._ditherScale = window._ditherScale ?? 1;
function cycleDitherScale(){
  let i = DITHER_SCALE_STEPS.findIndex(s => s.v === window._ditherScale);
  if(i < 0) i = 0;
  i = (i + 1) % DITHER_SCALE_STEPS.length;
  window._ditherScale = DITHER_SCALE_STEPS[i].v;
  const v = el('ditherScaleBtnVal'); if(v) v.textContent = DITHER_SCALE_STEPS[i].l;
  R.toast('Dither scale: ' + DITHER_SCALE_STEPS[i].l);
  markDirty();
}

window._ditherMode = window._ditherMode ?? 0;
function cycleDitherMode(){
  let i = DITHER_MODE_STEPS.findIndex(s => s.v === window._ditherMode);
  if(i < 0) i = 0;
  i = (i + 1) % DITHER_MODE_STEPS.length;
  window._ditherMode = DITHER_MODE_STEPS[i].v;
  const v = el('ditherModeBtnVal'); if(v) v.textContent = DITHER_MODE_STEPS[i].l;
  R.setDitherMode(DITHER_MODE_STEPS[i].v);
  R.toast('Dither: ' + DITHER_MODE_STEPS[i].l);
  refreshDitherScaleVisibility();
}
// Dither scale only affects the sub-mode dithers (Bayer / Atkinson / FS /
// Stucki / JJN). Default Grain ignores it, so hide the button when
// ditherMode is 0 to remove a useless control.
function refreshDitherScaleVisibility(){
  const btn = el('ditherScaleBtn');
  if(!btn) return;
  btn.style.display = ((window._ditherMode|0) === 0) ? 'none' : '';
}

// ─── Color quantization (pre-NNLS posterize / coarse cache) ───
// Off = full range; 32/16/8 = N levels per channel. Lower = chunkier.
const COLOR_QUANT_STEPS = [{v:0, l:'Off'}, {v:32, l:'32'}, {v:16, l:'16'}, {v:8, l:'8'}];
window._colorQuant = window._colorQuant ?? 0;
function cycleColorQuant(){
  let i = COLOR_QUANT_STEPS.findIndex(s => s.v === window._colorQuant);
  if(i < 0) i = 0;
  i = (i + 1) % COLOR_QUANT_STEPS.length;
  window._colorQuant = COLOR_QUANT_STEPS[i].v;
  const v = el('colorQuantBtnVal'); if(v) v.textContent = COLOR_QUANT_STEPS[i].l;
  R.toast('Quantize: ' + COLOR_QUANT_STEPS[i].l);
  markDirty();
}
// ─── Perceptual Lab residual toggle ───
// When on, NNLS picks the best ink subset using Lab color distance instead
// of raw RGB. Better hue fidelity (e.g. yellow vs orange when both are close
// in raw RGB), slightly slower per pixel.
// Default ON — T1-A: Lab distance picks better hue matches in NNLS subset
// selection (e.g. yellow vs orange that look close in raw RGB). Matches the
// approach Spectrolite takes for ink matching.
window._useLabResidual = window._useLabResidual ?? true;
function toggleLabResidual(){
  window._useLabResidual = !window._useLabResidual;
  const v = el('labResidBtnVal'); if(v) v.textContent = window._useLabResidual ? 'Lab' : 'RGB';
  const b = el('labResidBtn'); if(b) b.classList.toggle('active', window._useLabResidual);
  R.toast('Distance: ' + (window._useLabResidual ? 'Lab (perceptual)' : 'RGB (linear)'));
  markDirty();
}

// Standard CMYK rosette angles — designed to minimize moiré when 4 screens
// overlap. C=15°, M=75°, Y=0°, K=45° is the universal halftone convention.
const CMYK_ANGLES_BY_BUCKET = { C: 15, M: 75, Y: 0, K: 45 };
const CMYK_ANGLES = [15, 75, 0, 45];
function lockCmykAngles(){
  for(let i=0;i<4;i++) layerAngles[i] = CMYK_ANGLES[i];
  buildChannelUI();
  if(el('phChannelList')&&el('phChannelList').children.length) buildChannelUI('phChannelList');
  R.toast('Angles: C=15° M=75° Y=0° K=45°');
  markDirty();
}

// ─── Auto-CMYK-angle detection (T1-C, borrowed from Spectrolite) ──────────
// Classify an ink hex into one of the four CMYK rosette buckets {C,M,Y,K}
// based on hue + lightness. Returns null if no clear match.
// This is what Spectrolite calls "color groups" in src/types/transforms/cmykish.ts —
// they use it to map arbitrary palette inks to CMYK channel slots; we use it
// here to decide whether a palette is "CMYK-ish enough" to warrant locking
// the standard rosette angles automatically on palette change.
function _inkBucket(hex){
  if(!hex) return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if(!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n>>16)&255)/255, g = ((n>>8)&255)/255, b = (n&255)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  const l = (max + min) / 2;
  const d = max - min;
  // Black/gray bucket: low saturation OR very dark
  if(d < 0.10 || l < 0.22) return 'K';
  // Hue in degrees (HSV-style)
  let h;
  if(max === r) h = ((g - b) / d) % 6;
  else if(max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  // Spectrolite's groups: blues/teals → C, pinks/purples → M, yellows/browns/greens → Y
  if(h >= 170 && h <= 260) return 'C';   // cyan, teal, blue
  if(h >= 280 && h <  360) return 'M';   // magenta, pink, purple
  if(h <  20  || h >  20 && h <= 95) return 'Y';  // yellow, orange (lower-half hues fall here)
  // Green is technically "Y group" in Spectrolite but really 95-170 is its own zone.
  // Treat as Y if no other Y in palette; else leave unclassified (caller skips auto-lock).
  if(h > 95 && h < 170) return 'Y';
  return null;
}

// Returns true if all four channels classify into distinct {C,M,Y,K} buckets.
// Mutates layerAngles to the rosette assignment when true. Otherwise no-op.
function autoLockCmykAnglesIfPossible(){
  // Build name→hex map once
  const hexOf = {};
  RISO_COLORS.forEach(rc => { hexOf[rc.name] = rc.hex; });
  // Map active channels to buckets
  const buckets = channels.map(name => name ? _inkBucket(hexOf[name]) : null);
  // Require all 4 slots filled with one ink each in {C,M,Y,K}
  const slotsFilled = buckets.filter(b => b !== null).length;
  if(slotsFilled !== 4) return false;
  const present = new Set(buckets.filter(b => b !== null));
  if(present.size !== 4) return false; // not 4 distinct buckets
  // Assign each channel its rosette angle by bucket
  for(let i = 0; i < 4; i++){
    layerAngles[i] = CMYK_ANGLES_BY_BUCKET[buckets[i]];
  }
  return true;
}
// ─── PDF mode + text channel ─────────────────────────────────────────
// Two pieces of state: pdfModeOn (master toggle) and textChannelColor
// (which active-channel ink the text routes to). The 4-color cap is
// enforced by only allowing text to pick from inks already in use —
// you can't add a 5th ink for text, you have to first put it in a
// regular channel slot.

// Show/hide the entire text-channel row + the PDF toggle button itself.
// Should be called whenever source type or pdfModeOn changes.
function syncPdfUI(){
  const isPdf = !!window._pdfDoc;
  const btn = el('pdfModeBtn');
  if(btn) btn.style.display = isPdf ? '' : 'none';
  if(btn) btn.classList.toggle('active', isPdf && pdfModeOn);
  // Reset state if source isn't a PDF anymore
  if(!isPdf && pdfModeOn){ pdfModeOn = false; textChannelColor = null; }
  const row = el('textChannelRow');
  if(row) row.style.display = (isPdf && pdfModeOn) ? '' : 'none';
  // Whenever the row is shown, refresh its contents
  if(isPdf && pdfModeOn) refreshTextChannelRow();
  markDirty();
}
function togglePdfMode(){
  if(!window._pdfDoc){
    R.toast('PDF mode requires a PDF source');
    return;
  }
  pdfModeOn = !pdfModeOn;
  if(!pdfModeOn) textChannelColor = null;
  // Swap u_src to the inpainted source (text removed) when ON, or back
  // to the original raster when OFF. This is what makes non-text plates
  // render the bg behind glyphs cleanly without affecting normal mode.
  if(R.applyPdfSourceForMode) R.applyPdfSourceForMode();
  R.toast('PDF mode ' + (pdfModeOn ? 'ON' : 'OFF'));
  syncPdfUI();
}
function refreshTextChannelRow(){
  const lbl = el('textChannelLabel');
  const swatch = el('textChannelColorBtn');
  if(!lbl || !swatch) return;
  // Sync knockout button visual state
  const koBtn = el('textKnockoutBtn');
  if(koBtn) koBtn.classList.toggle('active', !!textKnockout);
  if(!textChannelColor){
    lbl.textContent = 'Text → (pick a color)';
    swatch.style.background = '#888';
    return;
  }
  const rc = RISO_COLORS.find(r => r.name === textChannelColor);
  swatch.style.background = rc ? rc.hex : '#888';
  // Verify the chosen color is still active in some channel slot
  const layerIdx = (typeof getTextLayerIdx === 'function') ? getTextLayerIdx() : -1;
  if(layerIdx < 0){
    lbl.textContent = 'Text → ' + textChannelColor + ' (not in channels)';
  } else {
    lbl.textContent = 'Text → ' + textChannelColor;
  }
}
// Build the dropdown — only inks currently active in the channel slots,
// since the text channel piggybacks on those (max-4-colors cap).
function toggleTextChannelPicker(){
  const dd = el('textChannelDropdown');
  if(!dd) return;
  const isOpen = dd.classList.contains('open');
  if(isOpen){ dd.classList.remove('open'); return; }
  // Collect unique ink names currently in use
  const inUse = new Set();
  for(let i=0;i<4;i++) if(channels[i]) inUse.add(channels[i]);
  if(inUse.size === 0){
    R.toast('Add a color channel first');
    return;
  }
  let html = '<div class="ch-dropdown-group">Active channels</div>';
  for(const name of inUse){
    const rc = RISO_COLORS.find(r => r.name === name);
    if(!rc) continue;
    const sel = (textChannelColor === name) ? ' selected' : '';
    const wc = name === 'White' ? ' white-dot' : '';
    const esc = name.replace(/'/g, "\\'");
    html += `<div class="ch-dropdown-item${sel}" onclick="event.stopPropagation();R.pickTextChannelColor('${esc}')">
      <span class="ch-dropdown-dot${wc}" style="background:${rc.hex}"></span>
      <span class="ch-dropdown-name">${name}</span>
    </div>`;
  }
  dd.innerHTML = html;
  dd.classList.add('open');
}
function pickTextChannelColor(name){
  textChannelColor = name;
  const dd = el('textChannelDropdown'); if(dd) dd.classList.remove('open');
  refreshTextChannelRow();
  R.toast('Text → ' + name);
  markDirty();
}
function clearTextChannel(){
  textChannelColor = null;
  refreshTextChannelRow();
  R.toast('Text routing off');
  markDirty();
}
// Trapping: contracts knockout regions by N canvas pixels so the printed
// ink overlaps the underlying ink. Hides white halos from misregistration.
// Labels match Spectrolite (px shown with mm equivalent at 600dpi).
const TRAPPING_STEPS = [
  {v:0, l:'None'},
  {v:2, l:'2 px'},
  {v:4, l:'4 px'},
  {v:6, l:'6 px'},
  {v:8, l:'8 px'},
];
function cycleTrapping(){
  let i = TRAPPING_STEPS.findIndex(s => s.v === trappingPx);
  if(i < 0) i = 0;
  i = (i + 1) % TRAPPING_STEPS.length;
  trappingPx = TRAPPING_STEPS[i].v;
  const v = el('trappingBtnVal'); if(v) v.textContent = TRAPPING_STEPS[i].l;
  const mm = (trappingPx * 25.4 / 600).toFixed(2);
  R.toast('Trapping: ' + TRAPPING_STEPS[i].l + (trappingPx > 0 ? ' (' + mm + ' mm)' : ''));
  markDirty();
}

function toggleTextKnockout(){
  textKnockout = !textKnockout;
  const btn = el('textKnockoutBtn');
  if(btn) btn.classList.toggle('active', textKnockout);
  R.toast('Text knockout ' + (textKnockout ? 'ON' : 'OFF'));
  markDirty();
}

// Toggle a plate's visibility — useful for previewing each layer in
// isolation (solo/mute workflow). The density isn't actually changed,
// just gated by a per-channel flag in renderer.js, so the slider value
// is preserved when re-enabled.
// Per-plate CONCENTRIC/RADIAL center setters with same-color linkage.
// Same-color channels are kept in sync just like setAngle / knockout do.
function setLineCenterX(ch, val){
  val = Math.min(1, Math.max(0, val));
  layerLineCenterX[ch] = val;
  const color = channels[ch];
  if(color){
    for(let i=0;i<4;i++) if(channels[i]===color) layerLineCenterX[i] = val;
  }
  // Skip rebuild during slider drag (would tear down the slider DOM).
  if(!window._lineCtlOpen){
    buildChannelUI();
    if(el('phChannelList')&&el('phChannelList').children.length) buildChannelUI('phChannelList');
  }
  markDirty();
}
function setLineCenterY(ch, val){
  val = Math.min(1, Math.max(0, val));
  layerLineCenterY[ch] = val;
  const color = channels[ch];
  if(color){
    for(let i=0;i<4;i++) if(channels[i]===color) layerLineCenterY[i] = val;
  }
  if(!window._lineCtlOpen){
    buildChannelUI();
    if(el('phChannelList')&&el('phChannelList').children.length) buildChannelUI('phChannelList');
  }
  markDirty();
}
// Open-popup state — only one slider visible at a time across all plates.
// Format: `${ch}_${axis}` (e.g. `0_angle`, `2_x`, `1_y`). null = none open.
window._lineCtlOpen = null;
window._lineCtlOutsideHandler = null;
function toggleLineCtl(ch, axis){
  const key = ch + '_' + axis;
  const wasOpen = (window._lineCtlOpen === key);
  // Always tear down any prior outside-click listener
  if(window._lineCtlOutsideHandler){
    document.removeEventListener('mousedown', window._lineCtlOutsideHandler, true);
    window._lineCtlOutsideHandler = null;
  }
  window._lineCtlOpen = wasOpen ? null : key;
  buildChannelUI();
  if(el('phChannelList')&&el('phChannelList').children.length) buildChannelUI('phChannelList');
  // When opening, install a click-outside listener so any mousedown
  // outside the slider AND outside the row's other angle buttons closes
  // it. Captures on mousedown (rather than click) so we beat the slider's
  // own change event. setTimeout keeps the listener from catching the
  // mousedown that opened it.
  if(!wasOpen){
    setTimeout(() => {
      const handler = (ev) => {
        const t = ev.target;
        // Don't close on clicks inside the slider, the drawer, the metric
        // buttons, or anything inside the drawer (label/value).
        if(t && (
          t.classList?.contains('ch-line-slider') ||
          t.classList?.contains('ch-angle-btn') ||
          t.closest?.('.ch-line-slider') ||
          t.closest?.('.ch-line-drawer')
        )) return;
        window._lineCtlOpen = null;
        document.removeEventListener('mousedown', handler, true);
        window._lineCtlOutsideHandler = null;
        buildChannelUI();
      };
      window._lineCtlOutsideHandler = handler;
      document.addEventListener('mousedown', handler, true);
    }, 0);
  }
}

function toggleLayerVisible(ch){
  layerVisible[ch] = !layerVisible[ch];
  buildChannelUI();
  if(el('phChannelList')&&el('phChannelList').children.length) buildChannelUI('phChannelList');
  R.toast((channels[ch]||'Plate ' + ch) + ' ' + (layerVisible[ch] ? 'shown' : 'hidden'));
  markDirty();
}

function toggleLayerKnockout(ch){
  layerKnockout[ch] = !layerKnockout[ch];
  // Sync same-color channels — sharing a color means sharing the cutout flag
  const color = channels[ch];
  if(color){
    for(let i=0;i<4;i++){ if(channels[i]===color) layerKnockout[i] = layerKnockout[ch]; }
  }
  buildChannelUI();
  if(el('phChannelList')&&el('phChannelList').children.length) buildChannelUI('phChannelList');
  R.toast('Knockout ' + (layerKnockout[ch] ? 'ON' : 'OFF'));
  markDirty();
}
function setAngle(ch,deg){
  layerAngles[ch]=deg;
  // Sync same-color channels to the same angle
  const color=channels[ch];
  if(color){
    for(let i=0;i<4;i++){
      if(i!==ch && channels[i]===color) layerAngles[i]=deg;
    }
  }
  // Skip the channel-UI rebuild when a slider is open — rebuilding tears
  // down the slider DOM mid-drag, breaking the interaction. The rebuild
  // happens on slider release (toggleLineCtl), which catches up the
  // synced same-color plates' button labels.
  if(!window._lineCtlOpen){
    buildChannelUI();
    if(el('phChannelList')&&el('phChannelList').children.length) buildChannelUI('phChannelList');
  }
  markDirty();
}
function bindSliders(){
  ['grainSize','dotGain','misreg','inkNoise','paperTex','lpi','grainStatic','ghosting','margin','skew','imgBright','imgContrast','imgSat','imgShadows','imgHighlights','ucrStr','balC','balM','balY','balK','tac','inkOpacity','layerDeplete','pressVar','densFlicker','ghostMul','postExposure','postContrast','postSat','warmCool'].forEach(id=>{
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
  const defs={inkOpacity:88,layerDeplete:3,pressVar:100,densFlicker:7,ghostMul:100,tonalGamma:100,dotMin:15,opacityCap:45};
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

  // LPI — there are two LPI buttons in the layout, one in screenPrimary
  // (id='lpiBtnScreen' with val span 'lpiBtnVal') and one in linesPrimary
  // (id='lpiBtnLines' with val span 'lpiBtnLinesVal'). Both share the
  // same hidden range input ('lpi'). Sync both labels here.
  const lpiVal = parseFloat(el('lpi')?.value || 35);
  let lpiLabel = lpiVal;
  STEP_PRESETS.lpi.forEach(p => { if (Math.abs(p.v - lpiVal) < 0.01) lpiLabel = p.l; });
  const lpiSpanScreen = el('lpiBtnVal');      if(lpiSpanScreen) lpiSpanScreen.textContent = lpiLabel;
  const lpiSpanLines  = el('lpiBtnLinesVal'); if(lpiSpanLines)  lpiSpanLines.textContent  = lpiLabel;
  // Phone-mode LPI button uses the legacy id pattern
  const phLpi = el('phLpiBtn');
  if(phLpi){ const v = phLpi.querySelector('.regmark-val'); if(v) v.textContent = lpiLabel; }

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

// ======================== TONE CURVE ========================
// 5 control points: endpoints fixed at x=0 and x=1, middle 3 draggable
let tcPoints=[{x:0,y:0},{x:0.25,y:0.25},{x:0.5,y:0.5},{x:0.75,y:0.75},{x:1,y:1}];
let tcDragIdx=-1;

function drawToneCurve(){
  const cv=el('toneCurveCanvas');
  if(!cv) return;
  const ctx=cv.getContext('2d');
  const w=cv.width, h=cv.height;
  ctx.clearRect(0,0,w,h);

  // Background grid
  ctx.strokeStyle='#eee';
  ctx.lineWidth=1;
  for(let i=1;i<4;i++){
    const p=i*w/4;
    ctx.beginPath();ctx.moveTo(p,0);ctx.lineTo(p,h);ctx.stroke();
    ctx.beginPath();ctx.moveTo(0,p);ctx.lineTo(w,p);ctx.stroke();
  }

  // Diagonal reference line (identity)
  ctx.strokeStyle='#ccc';
  ctx.lineWidth=1;
  ctx.setLineDash([3,3]);
  ctx.beginPath();ctx.moveTo(0,h);ctx.lineTo(w,0);ctx.stroke();
  ctx.setLineDash([]);

  // Generate smooth curve using monotone cubic spline
  const lut=generateToneCurveLUT();
  ctx.strokeStyle='#333';
  ctx.lineWidth=2;
  ctx.beginPath();
  for(let i=0;i<256;i++){
    const px=i/(255)*w;
    const py=(1-lut[i]/255)*h;
    if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
  }
  ctx.stroke();

  // Control points
  tcPoints.forEach((pt,i)=>{
    const px=pt.x*w, py=(1-pt.y)*h;
    const isEnd=(i===0||i===tcPoints.length-1);
    ctx.fillStyle=isEnd?'#c44':'#333';
    ctx.strokeStyle='#fff';
    ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(px,py,isEnd?6:5,0,Math.PI*2);ctx.fill();ctx.stroke();
  });
}

// Monotone cubic (Fritsch-Carlson) interpolation for LUT generation
function generateToneCurveLUT(){
  const pts=tcPoints.slice().sort((a,b)=>a.x-b.x);
  const n=pts.length;
  const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y);

  // Compute slopes
  const delta=[];
  for(let i=0;i<n-1;i++) delta.push((ys[i+1]-ys[i])/(xs[i+1]-xs[i]||0.001));

  // Compute tangents (Fritsch-Carlson monotone)
  const m=new Array(n);
  m[0]=delta[0];
  m[n-1]=delta[n-2];
  for(let i=1;i<n-1;i++){
    if(delta[i-1]*delta[i]<=0) m[i]=0;
    else m[i]=(delta[i-1]+delta[i])/2;
  }
  // Enforce monotonicity
  for(let i=0;i<n-1;i++){
    if(Math.abs(delta[i])<1e-6){m[i]=0;m[i+1]=0;continue;}
    const a=m[i]/delta[i], b=m[i+1]/delta[i];
    const s=a*a+b*b;
    if(s>9){const t=3/Math.sqrt(s);m[i]=t*a*delta[i];m[i+1]=t*b*delta[i];}
  }

  // Evaluate LUT
  const lut=new Uint8Array(256);
  for(let i=0;i<256;i++){
    const t=i/255;
    // Find interval
    let seg=0;
    for(let j=0;j<n-1;j++){if(t>=xs[j]&&t<=xs[j+1])seg=j;}
    const x0=xs[seg],x1=xs[seg+1],y0=ys[seg],y1=ys[seg+1];
    const h2=x1-x0||0.001;
    const tt=(t-x0)/h2;
    const tt2=tt*tt, tt3=tt2*tt;
    // Hermite basis
    const h00=2*tt3-3*tt2+1;
    const h10=tt3-2*tt2+tt;
    const h01=-2*tt3+3*tt2;
    const h11=tt3-tt2;
    const val=h00*y0+h10*h2*m[seg]+h01*y1+h11*h2*m[seg+1];
    lut[i]=Math.max(0,Math.min(255,Math.round(val*255)));
  }
  return lut;
}

function initToneCurve(){
  const cv=el('toneCurveCanvas');
  if(!cv) return;
  drawToneCurve();

  cv.addEventListener('mousedown',tcDown);
  cv.addEventListener('touchstart',tcDown,{passive:false});

  function tcDown(e){
    e.preventDefault();
    const rect=cv.getBoundingClientRect();
    const ex=e.touches?e.touches[0].clientX:e.clientX;
    const ey=e.touches?e.touches[0].clientY:e.clientY;
    const mx=(ex-rect.left)/rect.width;
    const my=1-(ey-rect.top)/rect.height;

    // Find nearest point (all 5 are draggable; endpoints lock X)
    let bestD=Infinity, bestI=-1;
    for(let i=0;i<tcPoints.length;i++){
      const dx=tcPoints[i].x-mx, dy=tcPoints[i].y-my;
      const d=dx*dx+dy*dy;
      if(d<bestD){bestD=d;bestI=i;}
    }
    if(bestD>0.04) return; // too far from any point
    tcDragIdx=bestI;

    document.addEventListener('mousemove',tcMove);
    document.addEventListener('mouseup',tcUp);
    document.addEventListener('touchmove',tcMove,{passive:false});
    document.addEventListener('touchend',tcUp);
  }

  function tcMove(e){
    if(tcDragIdx<0) return;
    e.preventDefault();
    const rect=cv.getBoundingClientRect();
    const ex=e.touches?e.touches[0].clientX:e.clientX;
    const ey=e.touches?e.touches[0].clientY:e.clientY;
    // Endpoints: Y locked (0 for black point, 1 for white point), X draggable (levels control).
    // Middle points: both X and Y draggable, X constrained between neighbors.
    const mx=(ex-rect.left)/rect.width;
    const my=1-(ey-rect.top)/rect.height;
    const isFirst=tcDragIdx===0, isLast=tcDragIdx===tcPoints.length-1;
    if(isFirst){
      // Black point: Y stays 0, X moves right to clip shadows
      const hi=tcPoints[1].x-0.01;
      tcPoints[0].x=Math.max(0,Math.min(hi,mx));
      tcPoints[0].y=Math.max(0,Math.min(0.15,my)); // allow tiny lift for shadow floor
    } else if(isLast){
      // White point: Y stays 1, X moves left to clip highlights
      const lo=tcPoints[tcDragIdx-1].x+0.01;
      tcPoints[tcDragIdx].x=Math.max(lo,Math.min(1,mx));
      tcPoints[tcDragIdx].y=Math.max(0.85,Math.min(1,my)); // allow tiny drop for highlight ceiling
    } else {
      const lo=tcPoints[tcDragIdx-1].x+0.01;
      const hi=tcPoints[tcDragIdx+1].x-0.01;
      tcPoints[tcDragIdx].x=Math.max(lo,Math.min(hi,mx));
      tcPoints[tcDragIdx].y=Math.max(0,Math.min(1,my));
    }
    drawToneCurve();
    // Live update during drag for real-time preview
    const lut=generateToneCurveLUT();
    R.uploadToneCurve(lut);
  }

  function tcUp(){
    if(tcDragIdx<0) return;
    tcDragIdx=-1;
    document.removeEventListener('mousemove',tcMove);
    document.removeEventListener('mouseup',tcUp);
    document.removeEventListener('touchmove',tcMove);
    document.removeEventListener('touchend',tcUp);
  }
}

function resetToneCurveUI(){
  tcPoints=[{x:0,y:0},{x:0.25,y:0.25},{x:0.5,y:0.5},{x:0.75,y:0.75},{x:1,y:1}];
  drawToneCurve();
  R.resetToneCurveGPU();
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
R.lockCmykAngles = lockCmykAngles;
R.toggleLayerKnockout = toggleLayerKnockout;
R.toggleLayerVisible = toggleLayerVisible;
R.setLineCenterX = setLineCenterX;
R.setLineCenterY = setLineCenterY;
R.toggleLineCtl = toggleLineCtl;
R.togglePdfMode = togglePdfMode;
R.syncPdfUI = syncPdfUI;
R.toggleTextChannelPicker = toggleTextChannelPicker;
R.pickTextChannelColor = pickTextChannelColor;
R.clearTextChannel = clearTextChannel;
R.toggleTextKnockout = toggleTextKnockout;
R.cycleTrapping = cycleTrapping;
R.cycleColorQuant = cycleColorQuant;
R.toggleLabResidual = toggleLabResidual;
R.cycleDitherMode = cycleDitherMode;
R.cycleDitherScale = cycleDitherScale;
R.cycleStampShape = cycleStampShape;
R.toggleScreenClean = toggleScreenClean;
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
R.cycleLineShape = cycleLineShape;
R.cycleLineWeight = cycleLineWeight;
R.cycleLineAmount = cycleLineAmount;
R.cycleLineRoughness = cycleLineRoughness;
R.cycleLineCenterX = cycleLineCenterX;
R.cycleLineCenterY = cycleLineCenterY;
R.cycleLineEdgeThickness = cycleLineEdgeThickness;
R.cycleLineCount = cycleLineCount;
R.cycleMisreg = cycleMisreg;
R.cycleSkew = cycleSkew;
R.cycleGhosting = cycleGhosting;
R.cycleInkNoise = cycleInkNoise;
R.cycleInkSpread = cycleInkSpread;
R.toggleCropMarks = toggleCropMarks;
R.toggleMarginSlider = toggleMarginSlider;
R.updateRegmarkUI = updateRegmarkUI;
R.initToneCurve = initToneCurve;
R.resetToneCurve = resetToneCurveUI;
R.drawToneCurve = drawToneCurve;
R.addSpotChannel = addSpotChannel;
R.removeSpotChannel = removeSpotChannel;

})(window.R);
