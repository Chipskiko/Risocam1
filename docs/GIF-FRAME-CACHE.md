# GIF/video loop frame cache — precompute instead of re-render

Problem: a looping GIF re-uploads its frame (renderer.js:1225) and re-runs
the ENTIRE pipeline every tick (~95-125 ms full-quality) — 12/24 fps loops
can't keep up. But a loop with fixed settings renders the SAME N frames
forever. (User proposal 2026-07-10; same insight as the stipple LIVE loop.)

## Design: self-warming GPU frame cache (no explicit bake step)
- cache[k] = {tex (GPU texture), stateKey, w, h} for gif frame index k.
- Capture: after normally rendering gif frame k, copyTexSubImage2D the
  drawing buffer into a preallocated texture (GPU->GPU, ~0 cost).
- Playback: on gif advance, if cache[gifFrameIdx].stateKey matches current
  state and dims match, draw the cached texture through a tiny blit program
  and SKIP the whole pipeline (upload, prepasses, main shader). Miss ->
  render normally + capture. First loop warms, every later loop is free.
- stateKey: undo.js getState() JSON + misreg/skew arrays + dims + mode —
  cheap to build per tick. DELIBERATELY EXCLUDES frameSeed: cached frames
  freeze their grain, so each gif frame keeps ITS OWN static grain repeating
  every loop — like a real printed flipbook (aesthetic choice, document in
  UI if anyone asks). Any slider/ink/paper change alters the key ->
  self-invalidates, next loop re-warms.
- Memory: frames at the CURRENT render size (LOD-scaled anim frames ~1266px
  -> ~4.5 MB each). Budget cap ~300 MB desktop / 8 frames phone; if the gif
  exceeds the cap, cache the first M frames only (partial cache still wins:
  those frames skip work). Free textures on source change (stopVideo).
- Blit program: second minimal GL program (passthrough vert + texture
  sample frag), compiled once at init; useProgram switch on cached ticks
  only. Careful: restore the main program + attribute state after blitting.
- VID export / stills: bypass the cache entirely (they render full-quality
  at export scale; _saving guard).
- Videos (<video> sources): same mechanism COULD apply keyed by
  currentTime-quantized frames, but decode timing is not frame-exact —
  out of scope v1; GIFs (gifFrames + gifFrameIdx already exact) only.

## Implementation order
1. Blit program + texture pool + capture/playback in _renderInner's gif
   branch (hot path — needs a fresh session, careful GL state review).
2. stateKey builder (reuse getState + extras) + invalidation on
   stopVideo/new source.
3. Memory budget + phone caps + telemetry line ([gifcache] hit/miss).
4. Verify: 24fps GIF loops at full fps from loop 2, slider changes
   re-warm, VID export unchanged, no GL state corruption (letters/screen
   prepasses still fine after blit frames).
