// ======================== DATA ========================
window.R = window.R || {};
var R = window.R;

// ======================== DATA ========================

// Calibration data from txtbooks risograph color swatch scans (2019/2020)
// 5-point LUT: [10%, 30%, 50%, 70%, 100%] scanned RGB (0-1)
const RISO_CAL = {
  'Aqua': { hex:'#7ac7f4', gamma:0.847, grainMul:0.53, fluo:true, lut:[[0.832,0.911,0.944],[0.768,0.883,0.937],[0.593,0.816,0.930],[0.531,0.798,0.938],[0.479,0.782,0.955]] },
  // Black: replaced 2019 scan (charcoal-warm #474a44) with Spectrolite's
  // linear black profile — current scan capped at ~0.28 = #474747, which
  // is real RISO charcoal not real RISO black. The Spectrolite reference
  // goes to true black at 100%, producing proper K-channel in CMYK and
  // dark mono prints.
  'Black': { hex:'#1a1a1a', gamma:0.50, grainMul:1.40, fluo:false, lut:[[0.898,0.898,0.898],[0.702,0.702,0.702],[0.498,0.498,0.498],[0.302,0.302,0.302],[0.030,0.030,0.030]] },
  'Blue': { hex:'#215cbc', gamma:0.549, grainMul:1.40, fluo:false, lut:[[0.664,0.760,0.876],[0.588,0.707,0.855],[0.324,0.523,0.792],[0.213,0.445,0.772],[0.130,0.361,0.738]] },
  'Bright Olive': { hex:'#afa029', gamma:0.776, grainMul:0.62, fluo:false, lut:[[0.915,0.900,0.783],[0.883,0.860,0.695],[0.774,0.731,0.398],[0.720,0.671,0.217],[0.686,0.628,0.161]] },
  'Copper': { hex:'#9b5b3a', gamma:0.614, grainMul:0.98, fluo:false, lut:[[0.851,0.779,0.746],[0.820,0.711,0.667],[0.715,0.512,0.412],[0.669,0.432,0.310],[0.606,0.356,0.227]] },
  'Coral': { hex:'#fc9595', gamma:1.209, grainMul:0.57, fluo:true, lut:[[0.963,0.879,0.878],[0.961,0.844,0.848],[0.967,0.712,0.718],[0.974,0.648,0.653],[0.988,0.585,0.586]] },
  'Cornflower': { hex:'#578eda', gamma:0.625, grainMul:0.82, fluo:false, lut:[[0.745,0.832,0.917],[0.604,0.740,0.898],[0.506,0.689,0.904],[0.427,0.635,0.897],[0.341,0.555,0.855]] },
  'Federal Blue': { hex:'#3d4f78', gamma:0.614, grainMul:1.21, fluo:false, lut:[[0.758,0.795,0.839],[0.657,0.703,0.771],[0.400,0.472,0.606],[0.315,0.393,0.555],[0.241,0.308,0.471]] },
  'Fl. Orange': { hex:'#fe795f', gamma:0.647, grainMul:0.69, fluo:true, lut:[[0.981,0.780,0.786],[0.980,0.718,0.715],[0.983,0.561,0.514],[0.986,0.507,0.432],[0.996,0.476,0.371]] },
  'Fl. Pink': { hex:'#ff6bd0', gamma:1.071, grainMul:0.66, fluo:true, lut:[[0.992,0.827,0.945],[0.990,0.751,0.913],[0.998,0.562,0.859],[1.000,0.515,0.868],[1.000,0.419,0.817]] },
  'Green': { hex:'#2f7744', gamma:0.729, grainMul:1.31, fluo:false, lut:[[0.722,0.831,0.745],[0.644,0.794,0.680],[0.420,0.692,0.485],[0.305,0.628,0.392],[0.186,0.465,0.266]] },
  'Hunter Green': { hex:'#425d53', gamma:0.688, grainMul:1.18, fluo:false, lut:[[0.780,0.815,0.798],[0.712,0.758,0.736],[0.453,0.537,0.501],[0.358,0.456,0.416],[0.259,0.364,0.324]] },
  'Light Lime': { hex:'#d5ed3a', gamma:1.003, grainMul:0.27, fluo:true, lut:[[0.960,0.976,0.813],[0.947,0.975,0.717],[0.893,0.960,0.437],[0.866,0.934,0.324],[0.837,0.931,0.228]] },
  'Melon': { hex:'#fe9436', gamma:0.581, grainMul:0.73, fluo:true, lut:[[0.947,0.848,0.740],[0.945,0.803,0.653],[0.959,0.687,0.403],[0.981,0.635,0.271],[0.996,0.581,0.213]] },
  'Metallic Gold': { hex:'#a4916c', gamma:0.569, grainMul:0.77, fluo:false, opaque:true, lut:[[0.845,0.840,0.810],[0.803,0.789,0.747],[0.703,0.660,0.559],[0.666,0.606,0.482],[0.645,0.568,0.424]] },
  'Mint': { hex:'#7dccc8', gamma:1.075, grainMul:0.40, fluo:true, lut:[[0.806,0.930,0.915],[0.764,0.914,0.894],[0.655,0.889,0.860],[0.594,0.870,0.838],[0.490,0.801,0.784]] },
  'Mist': { hex:'#bec2b7', gamma:0.954, grainMul:0.35, fluo:false, lut:[[0.878,0.900,0.896],[0.854,0.876,0.863],[0.807,0.832,0.803],[0.786,0.810,0.779],[0.747,0.762,0.718]] },
  'Purple': { hex:'#4c4469', gamma:0.788, grainMul:1.13, fluo:false, lut:[[0.807,0.800,0.857],[0.748,0.739,0.818],[0.509,0.486,0.641],[0.383,0.358,0.508],[0.297,0.266,0.413]] },
  'Raspberry': { hex:'#ad5063', gamma:0.577, grainMul:0.90, fluo:false, lut:[[0.854,0.741,0.768],[0.842,0.678,0.719],[0.771,0.468,0.536],[0.731,0.378,0.452],[0.680,0.313,0.387]] },
  'Scarlet': { hex:'#ea4a40', gamma:0.497, grainMul:0.94, fluo:false, lut:[[0.908,0.728,0.732],[0.896,0.638,0.644],[0.900,0.427,0.428],[0.907,0.363,0.351],[0.919,0.292,0.251]] },
  'Sunflower': { hex:'#fcb423', gamma:0.904, grainMul:0.48, fluo:true, lut:[[0.968,0.918,0.765],[0.967,0.899,0.683],[0.971,0.812,0.395],[0.976,0.755,0.258],[0.990,0.705,0.139]] },
  'Violet': { hex:'#6b66b3', gamma:0.717, grainMul:1.04, fluo:false, lut:[[0.792,0.790,0.895],[0.736,0.729,0.870],[0.593,0.571,0.803],[0.510,0.480,0.763],[0.418,0.400,0.703]] },
  'Yellow': { hex:'#f7e83a', gamma:0.535, grainMul:0.19, fluo:true, lut:[[0.960,0.943,0.695],[0.970,0.943,0.474],[0.970,0.938,0.394],[0.972,0.929,0.286],[0.967,0.909,0.226]] },
  'Bright Red': { hex:'#f15060', gamma:0.52, grainMul:0.88, fluo:false, lut:[[0.958,0.792,0.768],[0.962,0.605,0.575],[0.958,0.489,0.446],[0.967,0.466,0.393],[0.978,0.263,0.086]] },
  'Orange': { hex:'#ff6c2f', gamma:0.55, grainMul:0.80, fluo:false, lut:[[0.974,0.678,0.605],[0.979,0.593,0.505],[0.989,0.386,0.265],[0.993,0.307,0.174],[0.998,0.221,0.075]] },
  'Teal': { hex:'#00838a', gamma:0.65, grainMul:1.10, fluo:false, lut:[[0.619,0.792,0.746],[0.507,0.744,0.693],[0.237,0.627,0.564],[0.135,0.582,0.515],[0.023,0.534,0.462]] },
  'Cranberry': { hex:'#d1517a', gamma:0.58, grainMul:0.85, fluo:false, lut:[[0.895,0.714,0.742],[0.873,0.640,0.687],[0.821,0.462,0.555],[0.801,0.394,0.505],[0.780,0.320,0.450]] },
  'Fl. Yellow': { hex:'#ffe916', gamma:0.55, grainMul:0.17, fluo:true, lut:[[0.965,0.936,0.732],[0.969,0.932,0.570],[0.973,0.928,0.408],[0.976,0.924,0.262],[0.980,0.920,0.100]] },
  'Fl. Green': { hex:'#44d62c', gamma:0.70, grainMul:0.55, fluo:true, lut:[[0.808,0.919,0.748],[0.670,0.898,0.600],[0.531,0.878,0.453],[0.406,0.859,0.320],[0.267,0.839,0.173]] },
  'Brown': { hex:'#925f52', gamma:0.58, grainMul:1.05, fluo:false, lut:[[0.819,0.734,0.695],[0.773,0.666,0.625],[0.661,0.503,0.456],[0.619,0.441,0.392],[0.573,0.373,0.322]] },
  'Flat Gold': { hex:'#bb8b41', gamma:0.56, grainMul:0.75, fluo:false, lut:[[0.846,0.780,0.687],[0.808,0.728,0.615],[0.717,0.601,0.439],[0.683,0.552,0.373],[0.645,0.500,0.300]] },
  'Turquoise': { hex:'#00aa93', gamma:0.72, grainMul:0.90, fluo:false, lut:[[0.610,0.809,0.764],[0.496,0.766,0.716],[0.219,0.662,0.601],[0.114,0.623,0.558],[0.000,0.580,0.510]] },
  'Brick': { hex:'#a75154', gamma:0.56, grainMul:0.95, fluo:false, lut:[[0.836,0.711,0.687],[0.796,0.636,0.615],[0.698,0.454,0.439],[0.660,0.385,0.372],[0.620,0.310,0.300]] },
  // ─── Additional inks (LUTs sourced from Spectrolite single-ink profiles
  // — measured per coverage step. Previously these were synthetic
  // interpolations from white to vendor hex; the Spectrolite data is
  // measured response.) ───
  'Bisque':       { hex:'#f4d6b8', gamma:0.92, grainMul:0.45, fluo:false, lut:[[0.996,0.980,0.980],[0.984,0.941,0.945],[0.973,0.902,0.906],[0.965,0.863,0.867],[0.949,0.804,0.812]] },
  'Bubblegum':    { hex:'#e89cae', gamma:0.95, grainMul:0.55, fluo:false, lut:[[0.996,0.949,0.980],[0.992,0.855,0.937],[0.988,0.757,0.894],[0.984,0.663,0.855],[0.976,0.518,0.792]] },
  'Lagoon':       { hex:'#79d2c8', gamma:1.00, grainMul:0.50, fluo:true,  lut:[[0.918,0.937,0.937],[0.757,0.816,0.820],[0.592,0.690,0.698],[0.431,0.569,0.580],[0.184,0.380,0.396]] },
  'Indigo':       { hex:'#41476b', gamma:0.62, grainMul:1.30, fluo:false, lut:[[0.925,0.929,0.945],[0.784,0.792,0.843],[0.639,0.651,0.737],[0.498,0.514,0.635],[0.282,0.302,0.478]] },
  'Kelly Green':  { hex:'#67b346', gamma:0.78, grainMul:0.85, fluo:false, lut:[[0.941,0.969,0.925],[0.824,0.910,0.784],[0.702,0.851,0.635],[0.584,0.792,0.494],[0.404,0.702,0.275]] },
  'Wine':         { hex:'#9b1e3a', gamma:0.55, grainMul:1.00, fluo:false, lut:[[0.957,0.929,0.945],[0.871,0.792,0.835],[0.784,0.651,0.722],[0.698,0.514,0.616],[0.569,0.306,0.447]] },
  'Smoky Teal':   { hex:'#65949d', gamma:0.78, grainMul:0.95, fluo:false, lut:[[0.937,0.949,0.953],[0.812,0.855,0.863],[0.686,0.753,0.769],[0.561,0.659,0.678],[0.373,0.510,0.537]] },
  'Fl. Red':      { hex:'#ff4040', gamma:0.65, grainMul:0.80, fluo:true,  lut:[[1.000,0.929,0.937],[1.000,0.792,0.820],[1.000,0.647,0.698],[1.000,0.510,0.580],[1.000,0.298,0.396]] },
  // Burgundy/Wine are aliased in Spectrolite — applied same LUT (visually equivalent).
  'Burgundy':     { hex:'#622233', gamma:0.55, grainMul:1.10, fluo:false, lut:[[0.957,0.929,0.945],[0.871,0.792,0.835],[0.784,0.651,0.722],[0.698,0.514,0.616],[0.569,0.306,0.447]] },
  // Clear Medium: transparent overprint — no real color, just extends/spreads
  // ink. Modeled as near-white with `transparent: true` (skips opaque crossfade).
  'Clear Medium': { hex:'#fafaf6', gamma:1.00, grainMul:0.30, fluo:false, transparent:true, lut:[[0.995,0.995,0.985],[0.992,0.992,0.978],[0.988,0.988,0.970],[0.984,0.984,0.960],[0.980,0.980,0.952]] },
  // Process CMYK primaries (synthetic LUT for accuracy testing).
  // `transparent: true` disables the opaque-crossfade in calBlend — process
  // inks are designed for subtractive overprinting; the opaque tint pulls
  // every layer toward its own RGB, which turns blue→purple, etc.
  'Process Cyan': { hex:'#00aeef', gamma:1.0, grainMul:1.0, fluo:false, transparent:true, lut:[[0.85,0.94,0.96],[0.62,0.87,0.94],[0.38,0.78,0.92],[0.20,0.70,0.90],[0.00,0.60,0.88]] },
  'Process Magenta': { hex:'#ec008c', gamma:1.0, grainMul:1.0, fluo:false, transparent:true, lut:[[0.96,0.84,0.92],[0.95,0.60,0.82],[0.94,0.40,0.72],[0.93,0.24,0.62],[0.92,0.00,0.50]] },
  'Process Yellow': { hex:'#fff200', gamma:1.0, grainMul:0.2, fluo:false, transparent:true, lut:[[0.97,0.96,0.74],[0.97,0.95,0.50],[0.97,0.95,0.30],[0.97,0.94,0.14],[0.97,0.94,0.00]] },
  'Process Black': { hex:'#231f20', gamma:0.5, grainMul:1.5, fluo:false, transparent:true, lut:[[0.72,0.72,0.71],[0.55,0.55,0.54],[0.38,0.38,0.37],[0.25,0.25,0.24],[0.14,0.14,0.13]] },
};
const RISO_COLORS=[
  {name:"Blue",hex:"#215cbc"},{name:"Bright Red",hex:"#f15060"},{name:"Yellow",hex:"#f7e83a"},
  {name:"Black",hex:"#1a1a1a"},{name:"White",hex:"#ffffff"},
  {name:"Orange",hex:"#ff6c2f"},{name:"Teal",hex:"#00838a"},
  {name:"Cornflower",hex:"#578eda"},{name:"Purple",hex:"#4c4469"},{name:"Cranberry",hex:"#d1517a"},
  {name:"Fl. Pink",hex:"#ff6bd0"},{name:"Fl. Yellow",hex:"#ffe916"},{name:"Fl. Orange",hex:"#fe795f"},
  {name:"Fl. Green",hex:"#44d62c"},{name:"Hunter Green",hex:"#425d53"},{name:"Brown",hex:"#925f52"},
  {name:"Flat Gold",hex:"#bb8b41"},{name:"Violet",hex:"#6b66b3"},
  {name:"Turquoise",hex:"#00aa93"},{name:"Brick",hex:"#a75154"},{name:"Federal Blue",hex:"#3d4f78"},
  {name:"Scarlet",hex:"#ea4a40"},{name:"Green",hex:"#2f7744"},
  {name:"Copper",hex:"#9b5b3a"},{name:"Coral",hex:"#fc9595"},{name:"Light Lime",hex:"#d5ed3a"},
  {name:"Melon",hex:"#fe9436"},{name:"Metallic Gold",hex:"#a4916c"},{name:"Mint",hex:"#7dccc8"},
  {name:"Mist",hex:"#bec2b7"},{name:"Raspberry",hex:"#ad5063"},{name:"Aqua",hex:"#7ac7f4"},
  {name:"Bright Olive",hex:"#afa029"},{name:"Sunflower",hex:"#fcb423"},
  // Additional Riso inks
  {name:"Bisque",hex:"#f4d6b8"},{name:"Bubblegum",hex:"#e89cae"},{name:"Lagoon",hex:"#79d2c8"},
  {name:"Indigo",hex:"#41476b"},{name:"Kelly Green",hex:"#67b346"},{name:"Wine",hex:"#9b1e3a"},
  {name:"Smoky Teal",hex:"#65949d"},{name:"Fl. Red",hex:"#ff4040"},{name:"Burgundy",hex:"#622233"},
  {name:"Clear Medium",hex:"#fafaf6"},
  {name:"Process Cyan",hex:"#00aeef"},{name:"Process Magenta",hex:"#ec008c"},
  {name:"Process Yellow",hex:"#fff200"},{name:"Process Black",hex:"#231f20"},
];
const PROFILES=[
  {name:"Classic",colors:["Blue","Bright Red"]},{name:"Neon Pop",colors:["Fl. Pink","Fl. Yellow"]},
  {name:"Forest",colors:["Hunter Green","Brown","Yellow"]},{name:"Sunset",colors:["Orange","Scarlet","Yellow"]},
  {name:"Ocean",colors:["Teal","Cornflower"]},{name:"Berry",colors:["Purple","Cranberry"]},
  {name:"Earthy",colors:["Brown","Flat Gold","Hunter Green"]},{name:"Night",colors:["Federal Blue","Violet","Fl. Green"]},
  {name:"CMYK",colors:["Blue","Bright Red","Yellow","Black"],dens:[88,85,70,75]},{name:"Tropical",colors:["Fl. Orange","Turquoise","Yellow"]},
  {name:"Mono",colors:["Black"]},{name:"Vintage",colors:["Brick","Flat Gold","Federal Blue"]},
  {name:"Pure CMYK",colors:["Process Cyan","Process Magenta","Process Yellow","Process Black"],dens:[88,85,70,75]},
];



const PAPER_COLORS=[
{name:"White",hex:"#f5f0e8"},
{name:"Yellow",hex:"#f5e642"},
{name:"Green",hex:"#5ec26a"},
{name:"Blue",hex:"#5b8fd4"},
{name:"Pink",hex:"#f0a0b8"},
{name:"Red",hex:"#e04050"},
{name:"Orange",hex:"#f58c3a"},
{name:"Black",hex:"#2a2a28"},
{name:"Pure White",hex:"#ffffff"},
];

const PAPER_TEXTURES={
  'riso_standard':{label:'Natural',src:'textures/riso_standard.jpg'},
  'smooth':{label:'Smooth',src:'textures/smooth.jpg'},
  'kraft':{label:'Kraft',src:'textures/kraft.jpg'},
  'textured':{label:'Textured',src:'textures/textured.jpg'}
};

let activePaperTex='procedural'; // current paper texture key, or 'procedural'
let paperScanGlTex=null; // WebGL texture object for paper scan (reused)

function loadPaperTexture(key){
  if(key==='procedural'){
    activePaperTex='procedural';
    if(locs.u_usePaperScan) gl.uniform1f(locs.u_usePaperScan,0.0);
    return;
  }
  const tex=PAPER_TEXTURES[key];
  if(!tex) return;
  activePaperTex=key;
  const img=new Image();
  img.onload=function(){
    gl.activeTexture(gl.TEXTURE2);
    if(!paperScanGlTex) paperScanGlTex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,paperScanGlTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,gl.LUMINANCE,gl.UNSIGNED_BYTE,img);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.uniform1i(locs.u_paperScan,2);
    gl.uniform1f(locs.u_usePaperScan,1.0);
    markDirty();
  };
  img.src=tex.src;
}



// --- Namespace exports ---
// Cross-file shared constants (moved from IIFE modules)
const CH_NAMES=['C','M','Y','K'];

const STEP_PRESETS={
  grainSize:[{v:1.5,l:'600dpi'},{v:3,l:'300dpi'},{v:9,l:'100dpi'}],
  lpi:[{v:10,l:'40'},{v:40,l:'70'},{v:60,l:'90'},{v:80,l:'110'}],
  misreg:[{v:0,l:'OFF'},{v:2,l:'Low'},{v:4,l:'Med'},{v:6,l:'Hi'}],
  margin:[{v:0,l:'0'},{v:2,l:'2'},{v:4,l:'4'},{v:6,l:'6'},{v:8,l:'8'},{v:12,l:'12'}],
  ghosting:[{v:0,l:'OFF'},{v:40,l:'Med'},{v:80,l:'High'}],
};

const SKEW_PRESETS=[{v:0,l:'0'},{v:0.3,l:'.3'},{v:0.6,l:'.6'},{v:1.0,l:'1'}];
const INK_NOISE_PRESETS=[{v:0,l:'OFF'},{v:8,l:'Lo'},{v:16,l:'Med'},{v:30,l:'Hi'}];
const INK_SPREAD_PRESETS=[{v:8,l:'Low'},{v:20,l:'Med'},{v:36,l:'Hi'}];

R.RISO_CAL = RISO_CAL;
R.RISO_COLORS = RISO_COLORS;
R.PROFILES = PROFILES;
R.PAPER_COLORS = PAPER_COLORS;
R.PAPER_TEXTURES = PAPER_TEXTURES;
R.loadPaperTexture = loadPaperTexture;
