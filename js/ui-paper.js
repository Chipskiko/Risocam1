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
  // Paper scan overlay on top of canvas.
  // When the in-shader PBR paper substrate is active it is the single paper-
  // texture mechanism (and, unlike this CSS overlay, it's captured on export),
  // so suppress the overlay to avoid doubling the paper texture.
  const ov=el('paperOverlay');
  const phOv=el('phPaperOverlay');
  const pbrOn = (window._usePaperPBR ?? true);
  if(!pbrOn && activePaperTex!=='procedural' && PAPER_TEXTURES[activePaperTex]){
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
    const border=c.hex==='#2a2a28'?'border-color:#888;':c.hex==='#ffffff'?'border-color:#ccc;':'';
    ch+=`<div class="paper-dot${i===0?' active':''}" onclick="R.setPaperColor(${i})" style="background:${c.hex};${border}" title="${c.name}"></div>`;
  });
  colorGrid.innerHTML=ch;
  // Paper texture selector (hidden grid kept for setPaperTex compatibility)
  const texGrid=el('paperTexGrid');
  if(texGrid){
    let th='';
    PAPER_TEX_KEYS.forEach(k=>{
      th+=`<button class="paper-tex-btn${k===activePaperTex?' active':''}" onclick="R.setPaperTex('${k}')">${PAPER_TEX_LABELS[k]}</button>`;
    });
    texGrid.innerHTML=th;
  }
  // Update cycling button labels
  const typeBtn=el('paperTypeBtn');
  if(typeBtn){
    typeBtn.textContent=PAPER_TEX_LABELS[activePaperTex]||activePaperTex;
  }
}
// Paper-type → PBR character preset: [tooth-strength mul, sheen mul] applied
// to the Paper002 substrate in applyPaperPBR. 'blank' = no texture at all
// (window._paperBlank forces u_paperTex → 0, killing PBR + legacy paths).
const PAPER_PBR_PRESETS={
  blank:         null,
  procedural:    [1.0, 1.0],   // Standard — Paper002 as-is
  smooth:        [0.35, 1.4],  // low tooth, coated sheen
  riso_standard: [1.4, 0.75],  // Natural — more fiber, matte
  kraft:         [2.0, 0.5],   // heavy tooth, matte
  textured:      [2.8, 1.2],   // strongest relief
};
function setPaperTex(key){
  window._paperBlank = (key==='blank');
  window._paperPbrMul = PAPER_PBR_PRESETS[key] || [1,1];
  // Keep the legacy scan path coherent (used when PBR is toggled off in
  // debug); 'blank' has no scan — treat as procedural there.
  loadPaperTexture(key==='blank' ? 'procedural' : key);
  if(key==='blank') activePaperTex='blank';
  document.querySelectorAll('#paperTexGrid .paper-tex-btn').forEach(b=>b.classList.remove('active'));
  const btns=document.querySelectorAll('#paperTexGrid .paper-tex-btn');
  const idx=PAPER_TEX_KEYS.indexOf(key);
  if(idx>=0&&btns[idx]) btns[idx].classList.add('active');
  // Also update phone UI
  document.querySelectorAll('.ph-paper-tex-btn').forEach(b=>b.classList.toggle('active',b.dataset.tex===key));
  // Update cycling button label
  const btn=el('paperTypeBtn');
  if(btn) btn.textContent=PAPER_TEX_LABELS[key]||key;
  // Update viewfinder background with new texture
  updatePaperBg();
  markDirty();
}
// Cycling controls for paper type and texture intensity
const PAPER_TEX_KEYS=['blank','procedural','smooth','riso_standard','kraft','textured'];
const PAPER_TEX_LABELS={blank:'Blank',procedural:'Standard',smooth:'Smooth',riso_standard:'Natural',kraft:'Kraft',textured:'Textured'};
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
