// GLSL ES 1.00 → Vulkan-flavoured GLSL ES 3.10 mechanical transforms — the
// single-source bridge to WebGPU. The app's shaders stay exactly as written
// (WebGL1 style, edited for the Mac/WebGL path); this module rewrites them so
// glslang → SPIR-V → tint → WGSL succeeds. Every rule below was forced by a
// real error from the actual megashader (see gputest.html iteration log in
// docs/WEBGPU-PLAN.md). Used by BOTH gputest.html (in-browser) and
// tools/build-wgsl.mjs (deploy-time generation) — same code, provable parity.
(function(root){
  'use strict';

  // Identifiers ES 1.00 allowed but GLSL 3.10 or WGSL reserve. tint carries
  // names into WGSL, where Dawn rejects its keywords ('ref', 'target', ...).
  var RESERVED = ['active', 'ref', 'target', 'type', 'override', 'enable',
    'macro', 'module', 'operator', 'private', 'public', 'static', 'filter',
    'common', 'handle', 'yield', 'unless', 'require', 'mutable', 'using',
    'where', 'snorm', 'unorm', 'regardless', 'premerge'];

  // Fragment shader. Returns {src, uniforms:[[type,name]...], samplers:[name...]}.
  // Binding layout contract: UBO at @binding(0); sampler i (declaration order)
  // becomes texture2D at @binding(1+2i) and sampler at @binding(2+2i).
  function transformFS(fs){
    for(var i = 0; i < RESERVED.length; i++)
      fs = fs.replace(new RegExp('\\b' + RESERVED[i] + '\\b', 'g'), 'rc_' + RESERVED[i]);

    // Gather every non-sampler uniform (incl. comma multi-declarations) into
    // ONE anonymous std140 block — member names stay valid unprefixed.
    var uniforms = [];
    fs = fs.replace(/^\s*uniform\s+(float|int|vec2|vec3|vec4)\s+([A-Za-z0-9_\s,]+);.*$/gm,
      function(m, ty, names){
        var list = names.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
        for(var j = 0; j < list.length; j++) uniforms.push([ty, list[j]]);
        return '// moved to UBO: ' + list.join(', ');
      });

    // WGSL has no combined image-samplers — split each sampler2D into
    // texture2D + sampler; '#define name name_T, name_S' feeds both through
    // the rcTex(...) call sites. (Verified: no shader function takes a
    // sampler parameter.)
    var samplers = [];
    fs = fs.replace(/^uniform\s+sampler2D\s+([A-Za-z0-9_]+)\s*;.*$/gm,
      function(m, name){
        var idx = samplers.length; samplers.push(name);
        return 'layout(set=0, binding=' + (1 + 2 * idx) + ') uniform highp texture2D ' + name + '_T;\n' +
               'layout(set=0, binding=' + (2 + 2 * idx) + ') uniform highp sampler ' + name + '_S;\n' +
               '#define ' + name + ' ' + name + '_T, ' + name + '_S';
      });

    var block = 'layout(std140, set=0, binding=0) uniform Uniforms {\n' +
      uniforms.map(function(u){ return '  ' + u[0] + ' ' + u[1] + ';'; }).join('\n') + '\n};\n';

    // GL's gl_FragCoord is bottom-left origin; WebGPU is top-left — flip via
    // u_res (the drawing-buffer size, already a uniform).
    fs = fs.replace(/gl_FragCoord/g, '(vec4(gl_FragCoord_.x, u_res.y - gl_FragCoord_.y, gl_FragCoord_.z, gl_FragCoord_.w))');
    fs = fs.replace(/gl_FragCoord_/g, 'gl_FragCoord');

    // WGSL forbids implicit-derivative sampling in non-uniform control flow
    // (this shader branches before sampling constantly). No texture has mips,
    // so explicit-LOD is bit-identical. glslang demands the sampler2D
    // constructor at point of use → the pair rides as two parameters.
    fs = fs.replace(/\btexture2D\s*\(/g, 'rcTex(');

    var vloc = 0;   // SPIR-V requires explicit locations on user in/out
    fs = fs.replace(/\bvarying\b/g, function(){ return 'layout(location=' + (vloc++) + ') in'; });
    fs = fs.replace(/\bgl_FragColor\b/g, 'rc_fragColor');

    fs = '#version 310 es\nprecision highp float;\nprecision highp int;\n' +
         'layout(location=0) out vec4 rc_fragColor;\n' +
         'vec4 rcTex(highp texture2D t, highp sampler s, vec2 uv){ return textureLod(sampler2D(t, s), uv, 0.0); }\n' +
         block + fs;
    return {src: fs, uniforms: uniforms, samplers: samplers};
  }

  function transformVS(vs){
    var aloc = 0, ovloc = 0;
    vs = vs.replace(/\battribute\b/g, function(){ return 'layout(location=' + (aloc++) + ') in'; })
           .replace(/\bvarying\b/g, function(){ return 'layout(location=' + (ovloc++) + ') out'; });
    return '#version 310 es\nprecision highp float;\n' + vs;
  }

  // std140 offsets for the UBO staging buffer (phase 2 writes uniform values
  // by name). Only the types the shader uses: float/int = 4-byte align+size,
  // vec2 = 8, vec3 = 16-align/12-size, vec4 = 16.
  function std140Layout(uniforms){
    var offsets = {}, off = 0;
    for(var i = 0; i < uniforms.length; i++){
      var ty = uniforms[i][0], name = uniforms[i][1];
      var align = (ty === 'float' || ty === 'int') ? 4 : (ty === 'vec2') ? 8 : 16;
      var size  = (ty === 'float' || ty === 'int') ? 4 : (ty === 'vec2') ? 8 : (ty === 'vec3') ? 12 : 16;
      off = Math.ceil(off / align) * align;
      offsets[name] = {offset: off, type: ty};
      off += size;
    }
    return {offsets: offsets, size: Math.ceil(off / 16) * 16};
  }

  var api = {transformFS: transformFS, transformVS: transformVS, std140Layout: std140Layout};
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RC_WGSL = api;
})(typeof self !== 'undefined' ? self : this);
