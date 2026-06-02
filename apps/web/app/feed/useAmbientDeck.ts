'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

// Web-Audio ambient deck for the swipe feed. One shared AudioContext (created
// lazily on the first unmute gesture — iOS/Safari only resume() inside a user
// gesture), two ping-pong GainNodes (A/B) through a master gain → destination,
// equal-power crossfade on index advance. Default muted; the choice persists.
//
// Behaviour contract (see plan Task 7):
//  - no AudioContext until the first toggleMute() (which IS the gesture);
//  - decode + cache one AudioBuffer per URL, preloading the next card's buffer;
//  - crossfade ~600ms with cos/sin equal-power curves; reduced-motion → hard cut;
//  - mute() suspends + ramps master to 0; unmute() resumes + ramps to 1;
//  - cleanup closes the context; visibilitychange suspends/resumes;
//  - a null/absent URL plays silence; a decode failure is swallowed (silence).

const STORAGE_KEY = 'after5:ambient-unmuted';
const FADE_SEC = 0.6;
const CURVE_STEPS = 32;

// Precomputed equal-power crossfade curves (cos out, sin in over [0,1]).
function fadeCurves(): { out: Float32Array; in: Float32Array } {
  const out = new Float32Array(CURVE_STEPS);
  const inc = new Float32Array(CURVE_STEPS);
  for (let n = 0; n < CURVE_STEPS; n++) {
    const t = n / (CURVE_STEPS - 1); // 0 → 1
    out[n] = Math.cos((t * Math.PI) / 2);
    inc[n] = Math.sin((t * Math.PI) / 2);
  }
  return { out, in: inc };
}

interface Lane {
  gain: GainNode;
  source: AudioBufferSourceNode | null;
}

export function useAmbientDeck(
  urls: (string | null)[],
  activeIndex: number,
  opts: { reduceMotion: boolean },
): { unmuted: boolean; toggleMute: () => void } {
  const { reduceMotion } = opts;
  const [unmuted, setUnmuted] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const lanesRef = useRef<[Lane, Lane] | null>(null);
  const activeLaneRef = useRef(0); // which lane currently plays the active card
  const bufferCache = useRef<Map<string, AudioBuffer | null>>(new Map());
  const playedIndexRef = useRef<number>(-1);
  const curvesRef = useRef(fadeCurves());
  // Keep latest urls/index/reduceMotion reachable from async callbacks.
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  const reduceRef = useRef(reduceMotion);
  reduceRef.current = reduceMotion;

  // Decode + cache a buffer for a URL (null → silence). Failures swallowed.
  const loadBuffer = useCallback(async (url: string | null): Promise<AudioBuffer | null> => {
    const ctx = ctxRef.current;
    if (!ctx || !url) return null;
    if (bufferCache.current.has(url)) return bufferCache.current.get(url) ?? null;
    try {
      const res = await fetch(url);
      const arr = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(arr);
      bufferCache.current.set(url, buf);
      return buf;
    } catch {
      bufferCache.current.set(url, null); // remember the failure as silence
      return null;
    }
  }, []);

  // Start a buffer (looped) on the given lane; replaces any current source there.
  const startLane = useCallback((laneIdx: number, buf: AudioBuffer | null) => {
    const ctx = ctxRef.current;
    const lanes = lanesRef.current;
    if (!ctx || !lanes) return;
    const lane = lanes[laneIdx];
    if (lane.source) {
      try { lane.source.stop(); } catch { /* already stopped */ }
      try { lane.source.disconnect(); } catch { /* noop */ }
      lane.source = null;
    }
    if (!buf) return; // silence
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(lane.gain);
    try { src.start(); } catch { /* noop */ }
    lane.source = src;
  }, []);

  // Crossfade the active card's sound into the idle lane (or hard-cut under RM).
  const crossfadeTo = useCallback(async (index: number) => {
    const ctx = ctxRef.current;
    const lanes = lanesRef.current;
    if (!ctx || !lanes) return;
    const buf = await loadBuffer(urlsRef.current[index] ?? null);
    if (ctxRef.current !== ctx) return; // unmounted mid-decode

    const fromIdx = activeLaneRef.current;
    const toIdx = fromIdx === 0 ? 1 : 0;
    startLane(toIdx, buf);
    const now = ctx.currentTime;
    const fromGain = lanes[fromIdx].gain.gain;
    const toGain = lanes[toIdx].gain.gain;

    if (reduceRef.current) {
      // Hard cut: incoming full immediately, stop the outgoing source.
      try { fromGain.cancelScheduledValues(now); } catch { /* noop */ }
      try { toGain.cancelScheduledValues(now); } catch { /* noop */ }
      fromGain.value = 0;
      toGain.value = 1;
      const fromSrc = lanes[fromIdx].source;
      if (fromSrc) { try { fromSrc.stop(); } catch { /* noop */ } lanes[fromIdx].source = null; }
    } else {
      try {
        fromGain.cancelScheduledValues(now);
        toGain.cancelScheduledValues(now);
        fromGain.setValueCurveAtTime(curvesRef.current.out, now, FADE_SEC);
        toGain.setValueCurveAtTime(curvesRef.current.in, now, FADE_SEC);
      } catch { /* test stubs may not implement curves */ }
      const fromSrc = lanes[fromIdx].source;
      if (fromSrc) {
        window.setTimeout(() => {
          if (lanes[fromIdx].source === fromSrc) {
            try { fromSrc.stop(); } catch { /* noop */ }
            lanes[fromIdx].source = null;
          }
        }, FADE_SEC * 1000 + 50);
      }
    }
    activeLaneRef.current = toIdx;

    // Preload the next card while this one plays.
    void loadBuffer(urlsRef.current[index + 1] ?? null);
  }, [loadBuffer, startLane]);

  // Create the context + graph (idempotent). Called only inside toggleMute → gesture.
  const ensureContext = useCallback(() => {
    if (ctxRef.current) return;
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return;
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    const a: Lane = { gain: ctx.createGain(), source: null };
    const b: Lane = { gain: ctx.createGain(), source: null };
    a.gain.gain.value = 1; // the first active lane is audible
    b.gain.gain.value = 0;
    a.gain.connect(master);
    b.gain.connect(master);
    ctxRef.current = ctx;
    masterRef.current = master;
    lanesRef.current = [a, b];
    activeLaneRef.current = 0;
  }, []);

  const toggleMute = useCallback(() => {
    if (!unmuted) {
      ensureContext();
      const ctx = ctxRef.current;
      const master = masterRef.current;
      if (ctx) {
        void ctx.resume();
        if (master) {
          try {
            master.gain.cancelScheduledValues(ctx.currentTime);
            master.gain.setValueAtTime(0, ctx.currentTime);
            master.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.2);
          } catch { master.gain.value = 1; }
        }
        // Kick off the current card now that the graph exists.
        const idx = activeIndex;
        playedIndexRef.current = idx;
        void (async () => {
          const buf = await loadBuffer(urlsRef.current[idx] ?? null);
          startLane(activeLaneRef.current, buf);
          if (lanesRef.current) lanesRef.current[activeLaneRef.current].gain.gain.value = 1;
          void loadBuffer(urlsRef.current[idx + 1] ?? null);
        })();
      }
      setUnmuted(true);
      try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* noop */ }
    } else {
      const ctx = ctxRef.current;
      const master = masterRef.current;
      if (ctx && master) {
        try {
          master.gain.cancelScheduledValues(ctx.currentTime);
          master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
        } catch { master.gain.value = 0; }
        window.setTimeout(() => { void ctx.suspend(); }, 250);
      }
      setUnmuted(false);
      try { localStorage.setItem(STORAGE_KEY, '0'); } catch { /* noop */ }
    }
  }, [unmuted, ensureContext, activeIndex, loadBuffer, startLane]);

  // Crossfade when the active card advances (only once the deck is live).
  useEffect(() => {
    if (!ctxRef.current || !unmuted) return;
    if (activeIndex === playedIndexRef.current) return;
    playedIndexRef.current = activeIndex;
    void crossfadeTo(activeIndex);
  }, [activeIndex, unmuted, crossfadeTo]);

  // Suspend/resume with tab visibility (only while unmuted).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    function onVisibility() {
      const ctx = ctxRef.current;
      if (!ctx) return;
      if (document.visibilityState === 'hidden') void ctx.suspend();
      else if (unmuted) void ctx.resume();
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [unmuted]);

  // Teardown on unmount: stop sources, close the context.
  useEffect(() => {
    return () => {
      const lanes = lanesRef.current;
      if (lanes) {
        for (const lane of lanes) {
          if (lane.source) { try { lane.source.stop(); } catch { /* noop */ } }
        }
      }
      const ctx = ctxRef.current;
      ctxRef.current = null;
      lanesRef.current = null;
      masterRef.current = null;
      if (ctx) void ctx.close();
    };
  }, []);

  return { unmuted, toggleMute };
}
