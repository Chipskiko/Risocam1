// HEIC DECODE — Chrome/Firefox fallback. Safari 17+ decodes HEIC natively in
// <img>, so this only runs when that path errors (source.js image branch).
// The vendored decoder (libheif-js 1.19.8 WASM single-file bundle, ~1.4 MB,
// js/vendor/libheif-bundle.js) is injected on FIRST use — a session that
// never sees a HEIC never pays for it. WASM compilation is permitted by the
// live Neocities CSP (script-src includes 'unsafe-eval').
(function(R){
"use strict";

let _load = null;
function loadLibheif(){
  if(window.libheif && window.libheif.HeifDecoder) return Promise.resolve(window.libheif);
  if(_load) return _load;
  _load = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'js/vendor/libheif-bundle.js?v=1';
    s.onload = res;
    s.onerror = () => { _load = null; rej(new Error('libheif bundle failed to load')); };
    document.head.appendChild(s);
  }).then(async () => {
    let lh = window.libheif;
    // libheif-js ≥1.19 exposes an emscripten-style FACTORY: calling it
    // (and awaiting) instantiates the WASM and resolves to the module.
    if(typeof lh === 'function' && !lh.HeifDecoder) lh = await lh();
    if(lh && lh.ready) await lh.ready;
    if(!lh || !lh.HeifDecoder) throw new Error('libheif global missing after load');
    return lh;
  });
  return _load;
}

// File/Blob → RGBA canvas of the primary image. Throws on any failure —
// the caller owns user-facing messaging.
R.decodeHeic = async function(f){
  const lh = await loadLibheif();
  const buf = new Uint8Array(await f.arrayBuffer());
  const decoder = new lh.HeifDecoder();
  const images = decoder.decode(buf);
  if(!images || !images.length) throw new Error('no decodable image in HEIC');
  const img = images[0];
  const w = img.get_width(), h = img.get_height();
  if(!(w > 0 && h > 0)) throw new Error('HEIC reported empty dimensions');
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(w, h);
  await new Promise((res, rej) => {
    img.display(id, ok => ok ? res() : rej(new Error('HEIC display() failed')));
  });
  ctx.putImageData(id, 0, 0);
  try { images.forEach(i => i.free && i.free()); } catch(e){}
  return c;
};

})(window.R);
