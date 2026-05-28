// Benchmark the AMT prepass CPU stages at 600 DPI scale.
// Mirrors the real operations in renderer.js _runAmtPrepassImpl + riso-amt.js.
// Run: node tools/bench_amt.js

const A3_LONG_INCHES = 16.54;

function bench(label, fn, reps = 3) {
  // warmup
  fn();
  let best = Infinity;
  for (let r = 0; r < reps; r++) {
    const t = process.hrtime.bigint();
    fn();
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    if (ms < best) best = ms;
  }
  console.log(`  ${label.padEnd(34)} ${best.toFixed(0).padStart(6)} ms`);
  return best;
}

function run(dpi) {
  const longEdge = Math.round(dpi * A3_LONG_INCHES);
  // 16:9 landscape
  const W = longEdge;
  const H = Math.round(longEdge * 9 / 16);
  const N = W * H;
  console.log(`\n=== ${dpi} DPI → ${W}×${H} = ${(N/1e6).toFixed(1)}M px/channel ===`);

  // Synthetic source RGBA (like getImageData output)
  const src = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < src.length; i++) src[i] = (i * 37) & 0xff;

  const results = {};

  // PASS 1: RGB → inputGray projection (per channel)
  const inputGray = new Uint8Array(N);
  results.proj = bench('PASS1 RGB→gray projection', () => {
    const PR=232, PG=230, PB=222, dr=-200, dg=-198, db=-190;
    const dLen2 = dr*dr+dg*dg+db*db;
    for (let i=0, j=0; i<src.length; i+=4, j++) {
      const vr=src[i]-PR, vg=src[i+1]-PG, vb=src[i+2]-PB;
      let t=(vr*dr+vg*dg+vb*db)/dLen2;
      if(t<0)t=0; else if(t>1)t=1;
      inputGray[j]=Math.round(255*(1-t));
    }
  });

  // tone curve build of buf (Float32)
  const buf = new Float32Array(N);
  const toneCurve = new Float32Array(256);
  for (let i=0;i<256;i++) toneCurve[i]=Math.min(0.456, i/255*0.6);
  results.tone = bench('tone curve → buf', () => {
    const covScale=1.7;
    for(let i=0;i<N;i++){ let v=toneCurve[inputGray[i]&0xff]*covScale; if(v>1)v=1; buf[i]=v; }
  });

  // FS driver (the serial bottleneck)
  const TA=new Int32Array(256), TB=new Int32Array(64), TC=new Int32Array(256);
  for(let i=0;i<256;i++){TA[i]=(i*7)&63; TC[i]=Math.min(256,Math.abs(128-i)*2);}
  for(let i=0;i<64;i++)TB[i]=(i*5)&353;
  const bits = new Uint8Array((N+7)>>3);
  results.fs = bench('FS driver (serial)', () => {
    let errCur=new Int32Array(W+2), errNext=new Int32Array(W+2), colCounter=0;
    for(let y=0;y<H;y++){
      const gr=(y&1)===0; const xs=gr?0:W-1, xe=gr?W:-1, xst=gr?1:-1, xd=gr?1:-1;
      for(let x=xs;x!==xe;x+=xst){
        const density=Math.min(255,Math.max(0,Math.round(buf[y*W+x]*255)));
        const pInv=density; const envIdx=pInv>192?192:pInv;
        const colIdx=TA[colCounter%256]; const scale=TB[colIdx]; const env=TC[envIdx];
        const ditherAdj=(scale*env)>>8; colCounter++;
        const err=errCur[x+1]>>8; const base=err+pInv; const total=base+ditherAdj;
        let ink,newErr;
        if(total>254){ink=1;newErr=base-255;}else{ink=0;newErr=base;}
        if(ink)bits[(y*W+x)>>3]|=1<<(7-(x&7));
        if(newErr!==0){
          const c7=newErr*112,c5=newErr*80,c3=newErr*48,c1=newErr*16;
          const nx1=x+xd; if(nx1>=0&&nx1<W)errCur[nx1+1]+=c7;
          const nxA=x-xd; if(nxA>=0&&nxA<W)errNext[nxA+1]+=c3;
          errNext[x+1]+=c5;
          const nxB=x+xd; if(nxB>=0&&nxB<W)errNext[nxB+1]+=c1;
        }
      }
      const tmp=errCur;errCur=errNext;errNext=tmp;errNext.fill(0);
    }
  });

  // bit unpack → plane
  const plane=new Uint8Array(N);
  results.unpack = bench('bit unpack → plane', () => {
    for(let i=0;i<N;i++){ plane[i]=((bits[i>>3]>>(7-(i&7)))&1)?255:0; }
  });

  // Gaussian blur separable, sigma=0.5 → radius 2
  const sigma=0.5, radius=Math.max(1,Math.ceil(sigma*3)), klen=radius*2+1;
  const k=new Float32Array(klen); let ks=0; const s2=2*sigma*sigma;
  for(let i=-radius;i<=radius;i++){const v=Math.exp(-(i*i)/s2);k[i+radius]=v;ks+=v;}
  for(let i=0;i<klen;i++)k[i]/=ks;
  const tmpB=new Float32Array(N), outB=new Uint8Array(N);
  results.blur = bench('ink-spread Gaussian blur', () => {
    for(let y=0;y<H;y++){const row=y*W;for(let x=0;x<W;x++){let s=0;for(let i=-radius;i<=radius;i++){let xx=x+i;if(xx<0)xx=0;else if(xx>=W)xx=W-1;s+=plane[row+xx]*k[i+radius];}tmpB[row+x]=s;}}
    for(let y=0;y<H;y++){for(let x=0;x<W;x++){let s=0;for(let i=-radius;i<=radius;i++){let yy=y+i;if(yy<0)yy=0;else if(yy>=H)yy=H-1;s+=tmpB[yy*W+x]*k[i+radius];}const v=s|0;outB[y*W+x]=v<0?0:(v>255?255:v);}}
  });

  // RGBA pack (the A-optimization removes this)
  const rgba=new Uint8Array(N*4);
  results.pack = bench('RGBA pack (removed by R8)', () => {
    for(let i=0;i<N;i++){const v=outB[i];rgba[i*4]=v;rgba[i*4+1]=v;rgba[i*4+2]=v;rgba[i*4+3]=255;}
  });

  // coverage count
  results.cov = bench('coverage count', () => {
    let on=0;for(let i=0;i<N;i++)if(outB[i]>127)on++;return on;
  });

  // getImageData simulation (memcpy of N*4 bytes)
  const gid=new Uint8ClampedArray(N*4);
  results.gid = bench('getImageData (memcpy N*4)', () => { gid.set(src); });

  // Per-channel CPU total (proj+tone+fs+unpack+blur+pack+cov)
  const perCh = results.proj+results.tone+results.fs+results.unpack+results.blur+results.pack+results.cov;
  console.log(`  ${'— per-channel CPU subtotal'.padEnd(34)} ${perCh.toFixed(0).padStart(6)} ms`);
  console.log(`  ${'— 4-channel CPU (serial)'.padEnd(34)} ${(perCh*4).toFixed(0).padStart(6)} ms  (+ 1× getImageData ${results.gid.toFixed(0)}ms)`);

  return { W, H, N, results, perCh };
}

console.log('AMT prepass CPU benchmark (16:9 landscape, 4-color CMYK worst case)');
const r600 = run(600);
const r300 = run(300);
const r150 = run(150);

// GPU upload estimate from bandwidth (unified memory ~ conservative 8 GB/s effective for texImage2D)
function uploadMs(bytes, gbps) { return bytes / (gbps*1e9) * 1000; }
console.log('\n=== GPU texImage2D upload estimate (8 GB/s effective) ===');
for (const [name, r] of [['600',r600],['300',r300]]) {
  const rgbaBytes = r.N*4, r8Bytes = r.N;
  console.log(`  ${name} DPI  RGBA: ${(rgbaBytes/1e6).toFixed(0)}MB/ch ×4 = ${(rgbaBytes*4/1e6).toFixed(0)}MB → ~${uploadMs(rgbaBytes*4,8).toFixed(0)}ms`);
  console.log(`           R8:   ${(r8Bytes/1e6).toFixed(0)}MB/ch ×4 = ${(r8Bytes*4/1e6).toFixed(0)}MB → ~${uploadMs(r8Bytes*4,8).toFixed(0)}ms`);
}

console.log('\nNote: FS is strictly serial (error diffusion). proj/tone/unpack/blur/pack/cov');
console.log('are embarrassingly parallel and divide by worker count. Channels are independent.');
