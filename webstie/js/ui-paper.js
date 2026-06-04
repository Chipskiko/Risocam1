// UI_PAPER module
(function(R) {
"use strict";

// ======================== PAPER ========================

// Sync viewfinder bg (solid paper color) + overlay (actual paper scan on top of canvas)
function updatePaperBg(){
  const hex=PAPER_COLORS[curPaperColor].hex;
  // Solid paper color on viewfinder
  const vf=el('viewfinder');
  const phVf=el('phViewfinder');
  [vf,phVf].forEach(v=>{
    if(!v) return;
    v.style.backgroundColor=hex;
  });
  // Paper scan overlay on top of canvas
  const ov=el('paperOverlay');
  const phOv=el('phPaperOverlay');
  if(activePaperTex!=='procedural' && PAPER_TEXTURES[activePaperTex]){
    const bg=`url(${PAPER_TEXTURES[activePaperTex].src})`;
    [ov,phOv].forEach(o=>{
      if(!o) return;
      o.style.backgroundImage=bg;
      o.style.visibility='visible';
    });
  } else {
    [ov,phOv].forEach(o=>{
      if(!o) return;
      o.style.backgroundImage='none';
      o.style.visibility='hidden';
    });
  }
  document.documentElement.style.setProperty('--ph-paper-bg',hex);
}

function setPaperColor(idx){
  curPaperColor=idx;
  const hex=PAPER_COLORS[idx].hex;
  cached.paperColor=hexRGB(hex);
  document.querySelectorAll('#paperColorGrid .paper-dot').forEach((d,i)=>d.classList.toggle('active',i===idx));
  updatePaperBg();
  markDirty();
  R.pushUndo();
}
function renderPaperUI(){
  const colorGrid=el('paperColorGrid');
  let ch='';
  PAPER_COLORS.forEach((c,i)=>{
    const border=c.hex==='#2a2a28'?'border-color:#888;':'';
    ch+=`<div class="paper-dot${i===0?' active':''}" onclick="R.setPaperColor(${i})" style="background:${c.hex};${border}" title="${c.name}"></div>`;
  });
  colorGrid.innerHTML=ch;
  // Paper texture selector (hidden grid kept for setPaperTex compatibility)
  const texGrid=el('paperTexGrid');
  if(texGrid){
    let th='';
    const texKeys=['procedural','riso_standard','smooth','kraft','textured'];
    const texLabels={procedural:'Standard',riso_standard:'Natural',smooth:'Smooth',kraft:'Kraft',textured:'Textured'};
    texKeys.forEach(k=>{
      th+=`<button class="paper-tex-btn${k===activePaperTex?' active':''}" onclick="R.setPaperTex('${k}')">${texLabels[k]}</button>`;
    });
    texGrid.innerHTML=th;
  }
  // Update cycling button labels
  const typeBtn=el('paperTypeBtn');
  if(typeBtn){
    const labels={procedural:'Standard',riso_standard:'Natural',smooth:'Smooth',kraft:'Kraft',textured:'Textured'};
    typeBtn.textContent=labels[activePaperTex]||activePaperTex;
  }
}
function setPaperTex(key){
  loadPaperTexture(key);
  document.querySelectorAll('#paperTexGrid .paper-tex-btn').forEach(b=>b.classList.remove('active'));
  const btns=document.querySelectorAll('#paperTexGrid .paper-tex-btn');
  const keys=['procedural','riso_standard','smooth','kraft','textured'];
  const idx=keys.indexOf(key);
  if(idx>=0&&btns[idx]) btns[idx].classList.add('active');
  // Also update phone UI
  document.querySelectorAll('.ph-paper-tex-btn').forEach(b=>b.classList.toggle('active',b.dataset.tex===key));
  // Update cycling button label
  const TEX_LABELS={procedural:'Standard',riso_standard:'Natural',smooth:'Smooth',kraft:'Kraft',textured:'Textured'};
  const btn=el('paperTypeBtn');
  if(btn) btn.textContent=TEX_LABELS[key]||key;
  // Update viewfinder background with new texture
  updatePaperBg();
  markDirty();
}
// Cycling controls for paper type and texture intensity
const PAPER_TEX_KEYS=['procedural','riso_standard','smooth','kraft','textured'];
const PAPER_TEX_LABELS={procedural:'Standard',riso_standard:'Natural',smooth:'Smooth',kraft:'Kraft',textured:'Textured'};
function cyclePaperTex(){
  const i=PAPER_TEX_KEYS.indexOf(activePaperTex);
  const next=PAPER_TEX_KEYS[(i+1)%PAPER_TEX_KEYS.length];
  setPaperTex(next);
}
// --- Namespace exports ---
R.setPaperColor = setPaperColor;
R.renderPaperUI = renderPaperUI;
R.setPaperTex = setPaperTex;
R.cyclePaperTex = cyclePaperTex;
R.updatePaperBg = updatePaperBg;

})(window.R);
