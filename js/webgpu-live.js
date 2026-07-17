// WebGPU (D3D12) live view — phase 2 of docs/WEBGPU-PLAN.md.
//
// On machines where the WebGL megashader can't compile whole (Windows ANGLE
// D3D11), the app boots on the WebGL slim-variant path exactly as before,
// while this module builds a WebGPU pipeline from the deploy-time-generated
// WGSL (js/gen/shaders-wgsl.js — derived from the SAME GLSL source) and
// silently swaps the LIVE VIEW over when ready. Exports, prepasses and all
// other GL work stay on WebGL. Any failure at any stage = permanent quiet
// fallback to the WebGL path.
//
// Capture strategy: WebGL*RenderingContext PROTOTYPE methods are wrapped at
// script-parse time (before any context exists), so every uniform write and
// texture upload in the app is observed from the very first boot call — no
// missed one-shots, no app-code changes. The live view frame then renders
// from the mirrored state.
//
// v1 scope: grain / screen / lines / letters (the solver-heavy modes).
// RISO(flat)/stipple keep WebGL — their masters upload band-wise via
// texSubImage2D which the mirror doesn't reassemble yet.
//
// Gate: ?webgpu flag (opt-in while proving), plus navigator.gpu. Windows
// default-on comes after golden verification.
(function(){
  'use strict';
  if(!(window._flags && window._flags.webgpu)) return;
  if(!navigator.gpu){ console.warn('[webgpu-live] no navigator.gpu'); return; }

  var diag = function(s){ try { window.R && R.diag && R.diag('wgpu:' + s); } catch(e){} };

  // ── static fallbacks / state ───────────────────────────────────────────
  // Sampler-name → texture unit. Captured live from uniform1i, but the boot
  // assignments are fixed by initGL design; this map covers any set before
  // a capture lands.
  var UNIT_DEFAULT = { u_src:0, u_noise:1, u_paperScan:2, u_prevSrc:3, u_toneCurve:4,
    u_driverLUT:5, u_textMask:6, u_srcOrig:7, u_ht5Matrix:8, u_amtMaster0:9,
    u_amtMaster1:10, u_amtMaster2:11, u_amtMaster3:12, u_bnVC:13, u_calLutTex:14, u_paperPBR:15 };
  var samplerUnit = Object.assign({}, UNIT_DEFAULT);

  var gen = null;                    // RC_WGSL_GEN once loaded
  var device = null, pipeline = null, quadBuf = null, gpuUbo = null;
  var ready = false, failed = false, building = false;
  var uboBytes = null, uboF32 = null, uboI32 = null, uboDirty = true;
  var overlay = null, overlayCtx = null, overlayFmt = null;
  var activeUnit = 0;
  var unitBinding = new Array(32);   // unit → WebGLTexture
  var texMirror = new WeakMap();     // WebGLTexture → mirror entry
  var samplerCache = {};             // "mag/min/wrapS/wrapT" → GPUSampler
  var bindGroup = null, bindKey = '';
  var locNames = new WeakMap(), locNamesProg = null;
  var framesDrawn = 0;

  function fail(why, e){
    if(failed) return;
    failed = true; ready = false;
    console.warn('[webgpu-live] DISABLED: ' + why, e || '');
    diag('FAIL ' + why);
    if(overlay) overlay.style.display = 'none';
    try { var c = document.getElementById('gl'); if(c) c.style.visibility = ''; } catch(err){}
  }

  // ── prototype capture (installed immediately, before any context) ──────
  function eachProto(fn){
    [window.WebGL2RenderingContext, window.WebGLRenderingContext].forEach(function(C){
      if(C && C.prototype) fn(C.prototype);
    });
  }
  function nameOfLoc(loc){
    if(!loc || typeof prog === 'undefined' || typeof locs === 'undefined') return null;
    if(locNamesProg !== prog){
      locNames = new WeakMap(); locNamesProg = prog;
      for(var k in locs){ if(locs[k]) locNames.set(locs[k], k); }
    }
    return locNames.get(loc);
  }
  var lastTonePass = 0;   // nonzero u_asciiTonePass seen this frame (the GL
                          // prepass raises it, draws its FBO, resets to 0 —
                          // we capture the raise and replay the pass on GPU)
  function uboWrite(name, a, b, c, d){
    if(!gen) return;
    if(name === 'u_asciiTonePass' && a > 0) lastTonePass = a;
    var slot = gen.layout.offsets[name];
    if(!slot) return;
    var o = slot.offset >> 2;
    if(slot.type === 'int'){ uboI32[o] = a | 0; }
    else { uboF32[o] = a; if(b !== undefined) uboF32[o+1] = b;
           if(c !== undefined) uboF32[o+2] = c; if(d !== undefined) uboF32[o+3] = d; }
    uboDirty = true;
  }
  eachProto(function(p){
    var u1f = p.uniform1f; p.uniform1f = function(l, x){ var n = nameOfLoc(l); if(n) uboWrite(n, x); return u1f.call(this, l, x); };
    var u2f = p.uniform2f; p.uniform2f = function(l, x, y){ var n = nameOfLoc(l); if(n) uboWrite(n, x, y); return u2f.call(this, l, x, y); };
    var u3f = p.uniform3f; p.uniform3f = function(l, x, y, z){ var n = nameOfLoc(l); if(n) uboWrite(n, x, y, z); return u3f.call(this, l, x, y, z); };
    var u4f = p.uniform4f; p.uniform4f = function(l, x, y, z, w){ var n = nameOfLoc(l); if(n) uboWrite(n, x, y, z, w); return u4f.call(this, l, x, y, z, w); };
    var u3fv = p.uniform3fv; p.uniform3fv = function(l, v){ var n = nameOfLoc(l); if(n && v && v.length >= 3) uboWrite(n, v[0], v[1], v[2]); return u3fv.call(this, l, v); };
    var u1i = p.uniform1i; p.uniform1i = function(l, x){
      var n = nameOfLoc(l);
      if(n){ if(gen && gen.samplers && gen.samplers.indexOf(n) >= 0) samplerUnit[n] = x; else uboWrite(n, x); }
      return u1i.call(this, l, x);
    };
    var act = p.activeTexture; p.activeTexture = function(u){ activeUnit = u - 0x84C0; return act.call(this, u); };
    var bind = p.bindTexture; p.bindTexture = function(t, tex){ if(t === 0x0DE1) unitBinding[activeUnit] = tex; return bind.call(this, t, tex); };
    var del = p.deleteTexture; p.deleteTexture = function(tex){
      var e = tex && texMirror.get(tex);
      if(e && e.gpu){ try { e.gpu.destroy(); } catch(err){} texMirror.delete(tex); }
      return del.call(this, tex);
    };
    var par = p.texParameteri; p.texParameteri = function(t, pname, v){
      if(t === 0x0DE1){ var tex = unitBinding[activeUnit]; if(tex){ var e = mEntry(tex);
        if(pname === 0x2800) e.mag = v; else if(pname === 0x2801) e.min = v;
        else if(pname === 0x2802) e.wrapS = v; else if(pname === 0x2803) e.wrapT = v; } }
      return par.call(this, t, pname, v);
    };
    var tex2d = p.texImage2D; p.texImage2D = function(){
      var r = tex2d.apply(this, arguments);
      try { capTexImage(arguments); } catch(err){}
      return r;
    };
    var sub2d = p.texSubImage2D; p.texSubImage2D = function(){
      var r = sub2d.apply(this, arguments);
      // Band uploads (AMT masters land row-band by row-band from workers):
      // accumulate into the CPU backing and note the dirty row range so the
      // mirror can upload just those rows.
      try {
        var a = arguments;
        if(a.length >= 9 && a[0] === 0x0DE1){
          var tex = unitBinding[activeUnit]; var e = tex && texMirror.get(tex);
          var rec = e && e.rec;
          if(rec && rec.kind === 'raw' && rec.data && a[8]){
            var x = a[2], y = a[3], w = a[4], h = a[5], src = a[8];
            var bpp = rec.r8 ? 1 : 4, stride = rec.w * bpp, rowB = w * bpp;
            for(var row = 0; row < h; row++)
              rec.data.set(src.subarray(row * rowB, row * rowB + rowB), (y + row) * stride + x * bpp);
            if(!e.rows) e.rows = [y, y + h];
            else { e.rows[0] = Math.min(e.rows[0], y); e.rows[1] = Math.max(e.rows[1], y + h); }
            e.dirty = true;
          }
        }
      } catch(err){}
      return r;
    };
  });
  function mEntry(tex){
    var e = texMirror.get(tex);
    if(!e){ e = {gpu: null, w: 0, h: 0, dirty: true, rec: null,
                 mag: 0x2601, min: 0x2601, wrapS: 0x812F, wrapT: 0x812F}; texMirror.set(tex, e); }
    return e;
  }
  function capTexImage(args){
    var tex = unitBinding[activeUnit];
    if(!tex) return;
    var e = mEntry(tex);
    if(args.length >= 9){          // (t, lvl, ifmt, w, h, border, fmt, type, data)
      var w = args[3], h = args[4], ifmt = args[2], data = args[8];
      var r8 = (ifmt === 0x8229 /*R8*/ || ifmt === 0x1909 /*LUMINANCE*/);
      e.rec = { kind: 'raw', w: w, h: h, r8: r8,
        // null-data allocation (AMT masters, tone FBO) gets a zeroed backing
        // so later texSubImage2D bands have somewhere to accumulate.
        data: (data && data.slice) ? data.slice() : new Uint8Array(w * h * (r8 ? 1 : 4)) };
    } else {                       // (t, lvl, ifmt, fmt, type, source)
      e.rec = { kind: 'elem', src: args[5], r8: false };
    }
    e.rows = null;
    e.dirty = true;
  }

  // ── gpu resources ──────────────────────────────────────────────────────
  function glFilterToGpu(v){ return (v === 0x2600 /*NEAREST*/ || v === 0x2700 || v === 0x2702) ? 'nearest' : 'linear'; }
  function glWrapToGpu(v){ return v === 0x2901 /*REPEAT*/ ? 'repeat' : (v === 0x8370 ? 'mirror-repeat' : 'clamp-to-edge'); }
  function samplerFor(e){
    var key = [e.mag, e.min, e.wrapS, e.wrapT].join('/');
    if(!samplerCache[key]) samplerCache[key] = device.createSampler({
      magFilter: glFilterToGpu(e.mag), minFilter: glFilterToGpu(e.min),
      addressModeU: glWrapToGpu(e.wrapS), addressModeV: glWrapToGpu(e.wrapT) });
    return samplerCache[key];
  }
  var dummyTex = null, dummySamp = null;
  function ensureMirror(tex){
    if(!tex) return null;
    var e = texMirror.get(tex);
    if(!e || !e.rec) return null;
    var rec = e.rec;
    var w = rec.kind === 'elem' ? (rec.src.videoWidth || rec.src.width) : rec.w;
    var h = rec.kind === 'elem' ? (rec.src.videoHeight || rec.src.height) : rec.h;
    if(!w || !h) return null;
    var fresh = false;
    if(!e.gpu || e.w !== w || e.h !== h){
      if(e.gpu) try { e.gpu.destroy(); } catch(err){}
      e.gpu = device.createTexture({ size: [w, h],
        format: rec.r8 ? 'r8unorm' : 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
      e.view = e.gpu.createView();
      e.w = w; e.h = h; e.dirty = true; fresh = true;
    }
    if(e.dirty){
      if(rec.kind === 'raw'){
        var bpp = rec.r8 ? 1 : 4;
        if(rec.data && !fresh && e.rows && e.rows[1] > e.rows[0]){
          // partial: just the accumulated dirty row band
          var y0 = Math.max(0, e.rows[0]), y1 = Math.min(h, e.rows[1]);
          device.queue.writeTexture({texture: e.gpu, origin: [0, y0]},
            rec.data, {offset: y0 * w * bpp, bytesPerRow: w * bpp}, [w, y1 - y0]);
        } else if(rec.data){
          device.queue.writeTexture({texture: e.gpu}, rec.data, {bytesPerRow: w * bpp}, [w, h]);
        }
      } else {
        device.queue.copyExternalImageToTexture({source: rec.src}, {texture: e.gpu}, [w, h]);
      }
      e.dirty = false; e.rows = null;
    }
    return e;
  }

  // ── boot: load generated WGSL, check staleness, build pipeline ─────────
  function sha1Hex(str){
    return crypto.subtle.digest('SHA-1', new TextEncoder().encode(str)).then(function(b){
      return Array.prototype.map.call(new Uint8Array(b), function(x){ return x.toString(16).padStart(2, '0'); }).join('');
    });
  }
  function boot(){
    if(building || failed || ready) return;
    building = true;
    var s = document.createElement('script');
    s.src = 'js/gen/shaders-wgsl.js?v=1';
    s.onerror = function(){ fail('gen WGSL asset missing'); };
    s.onload = function(){
      gen = window.RC_WGSL_GEN;
      if(!gen){ fail('RC_WGSL_GEN missing'); return; }
      var vsEl = document.getElementById('vs'), fsEl = document.getElementById('fs');
      sha1Hex(fsEl.textContent + ' ' + vsEl.textContent).then(function(liveSha){
        if(liveSha !== gen.srcSha1){
          fail('generated WGSL stale (src ' + liveSha.slice(0, 12) + ' vs gen ' + gen.srcSha1.slice(0, 12) + ') — run tools/build-wgsl.mjs');
          return;
        }
        uboBytes = new ArrayBuffer(gen.layout.size);
        uboF32 = new Float32Array(uboBytes); uboI32 = new Int32Array(uboBytes);
        // Boot-time one-shots that predate the gen load: sensible defaults.
        var d = { u_useCalLutTex: 1, u_usePaperPBR: (window._usePaperPBR === false ? 0 : 1) };
        for(var k in d) uboWrite(k, d[k]);
        diag('build start');
        navigator.gpu.requestAdapter({powerPreference: 'high-performance'}).then(function(ad){
          if(!ad) throw new Error('no adapter');
          // Note: Windows Chromium currently ignores powerPreference for
          // WebGPU (crbug 369219127) — the adapter follows the browser's GPU
          // process. Users pin a dGPU via Windows Graphics settings. Record
          // what we actually got so it's never a guess.
          try { var info = ad.info || {};
                diag('adapter ' + [info.vendor, info.architecture, info.description].filter(Boolean).join('/')); } catch(e){}
          return ad.requestDevice();
        }).then(function(dev){
          device = dev;
          device.lost.then(function(info){ fail('device lost: ' + (info && info.message)); });
          var t0 = performance.now();
          var modFS = device.createShaderModule({code: gen.fs});
          var modVS = device.createShaderModule({code: gen.vs});
          return device.createRenderPipelineAsync({
            layout: 'auto',
            vertex: { module: modVS, entryPoint: 'main',
              buffers: [{arrayStride: 8, attributes: [{shaderLocation: 0, offset: 0, format: 'float32x2'}]}] },
            fragment: { module: modFS, entryPoint: 'main',
              targets: [{format: navigator.gpu.getPreferredCanvasFormat()}] },
            primitive: { topology: 'triangle-strip' },
          }).then(function(p){
            pipeline = p;
            diag('pipeline +' + Math.round(performance.now() - t0) + 'ms');
            gpuUbo = device.createBuffer({size: gen.layout.size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
            quadBuf = device.createBuffer({size: 32, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST});
            device.queue.writeBuffer(quadBuf, 0, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
            dummyTex = device.createTexture({size: [1, 1], format: 'rgba8unorm',
              usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST});
            device.queue.writeTexture({texture: dummyTex}, new Uint8Array([0, 0, 0, 255]), {}, [1, 1]);
            dummyTex = dummyTex.createView();
            dummySamp = device.createSampler({});
            overlay = document.createElement('canvas');
            overlay.id = 'glgpu';
            overlay.style.cssText = 'position:absolute;pointer-events:none;display:none;';
            var glc = document.getElementById('gl');
            glc.parentNode.insertBefore(overlay, glc.nextSibling);
            overlayCtx = overlay.getContext('webgpu');
            overlayFmt = navigator.gpu.getPreferredCanvasFormat();
            ready = true;
            try { R.toast('WebGPU renderer active'); } catch(e){}
            try { markDirty(); scheduleRender(); } catch(e){}
          });
        }).catch(function(e){ fail('pipeline build', e); });
      }).catch(function(e){ fail('sha check', e); });
    };
    document.head.appendChild(s);
  }

  // ── frame ──────────────────────────────────────────────────────────────
  var toneGpu = null, toneView = null, toneW = 0, toneH = 0, toneUboBuf = null, toneSampler = null;
  function renderWebGPU(w, h){
    var glc = document.getElementById('gl');
    if(overlay.width !== w || overlay.height !== h){
      overlay.width = w; overlay.height = h;
      overlayCtx.configure({device: device, format: overlayFmt, alphaMode: 'premultiplied'});
    }
    // mirror the CSS box of the hidden WebGL canvas
    overlay.style.width = (glc.style.width || glc.clientWidth + 'px');
    overlay.style.height = (glc.style.height || glc.clientHeight + 'px');
    overlay.style.left = glc.offsetLeft + 'px';
    overlay.style.top = glc.offsetTop + 'px';
    overlay.style.display = '';
    glc.style.visibility = 'hidden';

    // Anchor-tone prepass replay (letters / circles soft edges): the GL side
    // rendered its tone FBO and reset u_asciiTonePass to 0; we captured the
    // raised value and rerun the SAME pipeline into an offscreen texture,
    // then feed that texture through u_amtMaster0's slot for the main pass —
    // exactly the unit-9 time-share the GL path uses.
    var wantTone = lastTonePass > 0 && window._asciiToneDims &&
                   window._asciiToneDims[0] > 0 && window._asciiToneDims[1] > 0;
    var m0 = gen.samplers.indexOf('u_amtMaster0');
    var tw = 0, th = 0;
    if(wantTone){
      tw = window._asciiToneDims[0]; th = window._asciiToneDims[1];
      if(!toneGpu || toneW !== tw || toneH !== th){
        if(toneGpu) try { toneGpu.destroy(); } catch(e){}
        toneGpu = device.createTexture({size: [tw, th], format: overlayFmt,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING});
        toneView = toneGpu.createView();
        toneW = tw; toneH = th;
        bindKey = '';   // main bind group must pick up the new tone view
      }
      if(!toneUboBuf) toneUboBuf = device.createBuffer({size: gen.layout.size,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
      if(!toneSampler) toneSampler = device.createSampler({magFilter: 'linear', minFilter: 'linear'});
      // tone UBO = main staging with the pass id raised and fb height swapped
      var oT = gen.layout.offsets['u_asciiTonePass'].offset >> 2;
      var oH = gen.layout.offsets['rc_fbH'].offset >> 2;
      var keepT = uboF32[oT], keepH = uboF32[oH];
      // rc_fbH = 0 → identity fragCoord (no flip): the tone texture must be
      // written in GL row order because the main pass SAMPLES it (row k =
      // lattice cell k), unlike the presented pass which flips.
      uboF32[oT] = lastTonePass; uboF32[oH] = 0;
      device.queue.writeBuffer(toneUboBuf, 0, uboBytes);
      uboF32[oT] = keepT; uboF32[oH] = keepH;
    }
    uboWrite('rc_fbH', h);
    if(uboDirty){ device.queue.writeBuffer(gpuUbo, 0, uboBytes); uboDirty = false; }

    function buildEntries(ubo, toneAtMaster0){
      var entries = [{binding: 0, resource: {buffer: ubo}}];
      var key = (toneAtMaster0 ? 'T' : 'N') + (ubo === gpuUbo ? 'm' : 't') + '|';
      for(var i = 0; i < gen.samplers.length; i++){
        var name = gen.samplers[i];
        if(toneAtMaster0 && i === m0){
          entries.push({binding: 1 + 2 * i, resource: toneView});
          entries.push({binding: 2 + 2 * i, resource: toneSampler});
          key += 'tone' + toneW + 'x' + toneH + '|';
          continue;
        }
        var e = ensureMirror(unitBinding[samplerUnit[name]]);
        entries.push({binding: 1 + 2 * i, resource: e ? e.view : dummyTex});
        entries.push({binding: 2 + 2 * i, resource: e ? samplerFor(e) : dummySamp});
        key += (e ? e.gpuId || (e.gpuId = Math.random()) : 'd') + '/' + (e ? [e.mag, e.min, e.wrapS, e.wrapT].join('.') : '') + '|';
      }
      return {entries: entries, key: key};
    }

    var enc = device.createCommandEncoder();
    if(wantTone){
      // pass 1 renders the tone lattice; master0 slot gets a dummy (the GL
      // path swaps the real master in for the same feedback-guard reason)
      var tb = buildEntries(toneUboBuf, false);
      var toneBG = device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: tb.entries});
      var p1 = enc.beginRenderPass({colorAttachments: [{view: toneView,
        loadOp: 'clear', storeOp: 'store', clearValue: {r: 0, g: 0, b: 0, a: 1}}]});
      p1.setPipeline(pipeline); p1.setBindGroup(0, toneBG);
      p1.setVertexBuffer(0, quadBuf); p1.draw(4); p1.end();
    }
    var mb = buildEntries(gpuUbo, wantTone);
    if(mb.key !== bindKey || !bindGroup){
      bindGroup = device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: mb.entries});
      bindKey = mb.key;
    }
    var pass = enc.beginRenderPass({colorAttachments: [{
      view: overlayCtx.getCurrentTexture().createView(),
      loadOp: 'clear', storeOp: 'store', clearValue: {r: 0, g: 0, b: 0, a: 0} }]});
    pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, quadBuf); pass.draw(4); pass.end();
    device.queue.submit([enc.finish()]);
    lastTonePass = 0;
    if(++framesDrawn === 1) diag('first frame ' + w + 'x' + h);
  }

  // ── hook the live draw (installs once R exists) ────────────────────────
  function hook(){
    if(!window.R || !R.drawFullscreenTiled){ setTimeout(hook, 100); return; }
    var orig = R.drawFullscreenTiled;
    R.drawFullscreenTiled = function(w, h){
      var saving = false;
      try { saving = (typeof _saving !== 'undefined' && _saving) || window._recordingNow; } catch(e){}
      if(ready && !failed && !saving &&
         typeof gl !== 'undefined' && gl && gl.getParameter(gl.FRAMEBUFFER_BINDING) === null){
        try { renderWebGPU(w, h); return; }
        catch(e){ fail('frame', e); }
      }
      // WebGL path: reveal the GL canvas, park the overlay
      try { var glc = document.getElementById('gl');
            if(glc) glc.style.visibility = '';
            if(overlay) overlay.style.display = 'none'; } catch(e){}
      return orig(w, h);
    };
    boot();
  }
  hook();
})();
