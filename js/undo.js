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
    paper:curPaper, paperColor:curPaperColor
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
    mode=s.mode;
    cached.grainSize=s.grainSize; cached.dotGain=s.dotGain; cached.inkNoise=s.inkNoise;
    cached.paperTex=s.paperTex; cached.lpi=s.lpi||65; cached.grainStatic=s.grainStatic; if(s.ghosting!==undefined)cached.ghosting=s.ghosting; cached.sepType=s.sepType||0;
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

function newMisreg(){
  const m=cached.misreg/500;
  // When misreg is 0, skew should also be 0 (no plate rotation without misregistration)
  const skewMax= cached.misreg > 0 ? cached.skew * Math.PI / 180.0 : 0;
  if(R.isMono()){
    // Mono: single drum pass — all plates share same offset/skew
    const mx=(Math.random()-.5)*m*2, my=(Math.random()-.5)*m*2;
    const sk=(Math.random()-.5)*2*skewMax;
    for(let i=0;i<4;i++){ misreg[i]=[mx,my]; layerSkews[i]=sk; }
    markDirty();
    return;
  }
  for(let i=0;i<4;i++){
    misreg[i]=[(Math.random()-.5)*m*2,(Math.random()-.5)*m*2];
    layerSkews[i]=(Math.random()-.5)*2*skewMax;
  }
  // Same-color plates share one master = same misreg offset + skew
  syncSameColorPlates();
  markDirty();
}

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
R.syncSameColorPlates = syncSameColorPlates;

})(window.R);
