// Web Worker shell for the stipple sampler — keeps multi-hundred-ms point
// generation off the main thread so preview animation stays smooth.
// Loaded through the blob-URL builder (renderer.js _buildWorkerBlobUrl),
// which INLINES the importScripts dep — CSP-safe on Neocities (worker-src
// blob:), same mechanism as riso-amt-worker.js.
//
// in:  { id, luma: ArrayBuffer (Uint8 analysis brightness), aw, ah,
//        outW, outH, opts }
// out: { id, data: ArrayBuffer (Float32 [x,y,r,brightness]×count),
//        count, whiteZone }  |  { id, error }

self.importScripts('./stipple-core.js?v=1');

self.onmessage = function(e){
  const { id, luma, aw, ah, outW, outH, opts } = e.data;
  try {
    const res = self.StippleCore.generate(new Uint8Array(luma), aw, ah, outW, outH, opts || {});
    self.postMessage({ id: id, data: res.data.buffer, count: res.count, whiteZone: res.whiteZone },
                     [res.data.buffer]);
  } catch (err) {
    self.postMessage({ id: id, error: err.message || String(err) });
  }
};
