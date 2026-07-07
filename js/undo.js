// UNDO module
(function(R) {
"use strict";

// ======================== UNDO / REDO ========================
const undoStack=[], redoStack=[];
const MAX_UNDO=40;
let undoLock=false; // prevent recursive snapshots during restore
function getState(){
  return JSON.stringify({
    channels:[...channels],
    angles:[...layerAngles],
    dens:[...cached.layerDens],
    prof:activeProf?activeProf.name:null,
    mode,
    grainSize:cached.grainSize, dotGain:cached.dotGain, inkNoise:cached.inkNoise,
    paperTex:cached.paperTex, lpi:cached.lpi, grainStatic:cached.grainStatic, ghosting:cached.ghosting, sepType:cached.sepType,
    imgBright:cached.imgBright, imgContrast:cached.imgContrast, imgSat:cached.imgSat,
    paperColor:curPaperColor,
    stamp:window._stampShape|0, lettersText:window._lettersText||'', lettersMode:window._lettersMode|0
  });
}
function pushUndo(){
  if(undoLock) return;
  const s=getState();
  if(undoStack.length && undoStack[undoStack.length-1]===s) return; // no change
  undoStack.push(s);
  if(undoStack.length>MAX_UNDO) undoStack.shift();
  redoStack.length=0; // clear redo on new action
}
function restoreState(json){
  undoLock=true;
  try{
    const s=JSON.parse(json);
    channels=s.channels;
    layerAngles=s.angles;
    cached.layerDens=s.dens;
    // Mode + AMT sync. Bare `mode=s.mode` left the mode buttons and the RISO
    // master out of sync with the restored state. Route a mode CHANGE through
    // setMode (syncs UI; flat re-triggers the prepass, non-flat normalizes
    // u_useAmt). If the mode is unchanged but we're in RISO, restored inks can
    // still alter the master — invalidate + rebake explicitly.
    if(s.mode!==mode && window.R && window.R.setMode){
      window.R.setMode(s.mode);
    } else {
      mode=s.mode;
      if(mode==='flat' && window.R && window.R.invalidateAmt){
        window.R.invalidateAmt();
        if(window.R.runAmtPrepass) setTimeout(window.R.runAmtPrepass, 0);
      }
    }
    cached.grainSize=s.grainSize; cached.dotGain=s.dotGain; cached.inkNoise=s.inkNoise;
    cached.paperTex=s.paperTex; cached.lpi=s.lpi||65; cached.grainStatic=s.grainStatic; if(s.ghosting!==undefined)cached.ghosting=s.ghosting; cached.sepType=s.sepType||0;
    // Letters/stamp state (added with the LETTERS mode branch-out)
    if(s.stamp!==undefined) window._stampShape=s.stamp|0;
    if(s.lettersText!==undefined && s.lettersText!==(window._lettersText||'')){
      window._lettersText=s.lettersText;
      window._glyphAtlasTex=null; // atlas embeds the word — rebuild
      const inp=document.getElementById('lettersTextInput'); if(inp) inp.value=s.lettersText;
    }
    if(s.lettersMode!==undefined){
      window._lettersMode=s.lettersMode|0;
      if(window.R && R.syncAsciiChips) R.syncAsciiChips();
    }
    cached.imgBright=s.imgBright; cached.imgContrast=s.imgContrast; cached.imgSat=s.imgSat;
    // Restore profile ref
    activeProf=s.prof?R.allProfiles().find(p=>p.name===s.prof)||null:null;
    // Sync UI sliders
    const sliders={imgBright:s.imgBright,imgContrast:s.imgContrast,imgSat:s.imgSat};
    for(const[id,v] of Object.entries(sliders)){const e=document.getElementById(id);if(e)e.value=v;const ve=document.getElementById(id+'Val');if(ve)ve.textContent=v;}
    cacheInkColors();R.updateUI();markDirty();
  }finally{ undoLock=false; }
}
function undo(){
  if(undoStack.length<2) return; // need at least 2: current + previous
  redoStack.push(undoStack.pop()); // move current to redo
  restoreState(undoStack[undoStack.length-1]);
}
function redo(){
  if(!redoStack.length) return;
  const s=redoStack.pop();
  undoStack.push(s);
  restoreState(s);
}

// Quiet variant: re-rolls plate offsets/skews WITHOUT markDirty — called from
// inside render() (a markDirty there would self-perpetuate the render loop).
function rollMisregQuiet(){
  const m=cached.misreg/500;
  // When misreg is 0, skew should also be 0 (no plate rotation without misregistration)
  const skewMax= cached.misreg > 0 ? cached.skew * Math.PI / 180.0 : 0;
  if(R.isMono()){
    // Mono: single drum pass — all plates share same offset/skew
    const mx=(Math.random()-.5)*m*2, my=(Math.random()-.5)*m*2;
    const sk=(Math.random()-.5)*2*skewMax;
    for(let i=0;i<4;i++){ misreg[i]=[mx,my]; layerSkews[i]=sk; }
    return;
  }
  for(let i=0;i<4;i++){
    misreg[i]=[(Math.random()-.5)*m*2,(Math.random()-.5)*m*2];
    layerSkews[i]=(Math.random()-.5)*2*skewMax;
  }
  // Same-color plates share one master = same misreg offset + skew
  syncSameColorPlates();
}
function newMisreg(){
  rollMisregQuiet();
  markDirty();
}
R.rollMisregQuiet = rollMisregQuiet;

// Lock same-color channels: shared misreg, screen angles, and skew
function syncSameColorPlates(){
  const seen={};
  for(let i=0;i<4;i++){
    const c=channels[i];
    if(!c) continue;
    if(c in seen){
      // Same ink as a previous channel — lock to its offset, angle & skew
      misreg[i]=[...misreg[seen[c]]];
      layerAngles[i]=layerAngles[seen[c]];
      layerSkews[i]=layerSkews[seen[c]];
    } else {
      seen[c]=i;
    }
  }
}



// --- Namespace exports ---
R.pushUndo = pushUndo;
R.undo = undo;
R.redo = redo;
R.newMisreg = newMisreg;

// Reseed everything: misreg, skew, grain pattern, paper-texture shift.
// Distinct from newMisreg() (which only re-rolls plate offsets) — this also
// bumps the noise seed used by the shader's grain hashes and the paper-fiber
// sample position (paperShift is derived from frameSeed in renderer.js).
function reseedAll(){
  newMisreg();
  frameSeed = Math.random();
  window._stampSeed = Math.floor(Math.random() * 1021); // ASCII letters re-roll on reseed
  R.toast && R.toast('Reseeded');
  markDirty();
}
R.reseedAll = reseedAll;
R.syncSameColorPlates = syncSameColorPlates;

})(window.R);
