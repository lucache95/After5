import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

class FakeParam {
  value = 1;
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  setValueCurveAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
}
class FakeGain { gain = new FakeParam(); connect = vi.fn(); disconnect = vi.fn(); }
class FakeSource {
  buffer: unknown = null; loop = false;
  connect = vi.fn(); start = vi.fn(); stop = vi.fn(); disconnect = vi.fn();
  onended: (() => void) | null = null;
}
const instances: FakeAudioContext[] = [];
class FakeAudioContext {
  state = 'suspended'; currentTime = 0; destination = {};
  createGain = vi.fn(() => new FakeGain());
  createBufferSource = vi.fn(() => new FakeSource());
  decodeAudioData = vi.fn(async () => ({}) as AudioBuffer);
  resume = vi.fn(async () => { this.state = 'running'; });
  suspend = vi.fn(async () => { this.state = 'suspended'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  constructor() { instances.push(this); }
}

const fetched: string[] = [];
beforeEach(() => {
  instances.length = 0;
  fetched.length = 0;
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  globalThis.fetch = vi.fn(async (url: string) => {
    fetched.push(url);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  }) as never;
  localStorage.clear();
});

import { useAmbientDeck } from './useAmbientDeck';

describe('useAmbientDeck', () => {
  it('starts muted and creates no AudioContext until first unmute', () => {
    const { result } = renderHook(() => useAmbientDeck(['a', 'b'], 0, { reduceMotion: false }));
    expect(result.current.unmuted).toBe(false);
    expect(instances.length).toBe(0);
  });

  it('toggleMute creates + resumes the context (gesture unlock) and persists the choice', async () => {
    const { result } = renderHook(() => useAmbientDeck(['a', 'b'], 0, { reduceMotion: false }));
    await act(async () => { result.current.toggleMute(); });
    expect(result.current.unmuted).toBe(true);
    expect(instances.length).toBe(1);
    expect(instances[0]!.resume).toHaveBeenCalled();
    expect(localStorage.getItem('after5:ambient-unmuted')).toBe('1');
  });

  it('toggleMute again mutes and persists the muted choice', async () => {
    const { result } = renderHook(() => useAmbientDeck(['a', 'b'], 0, { reduceMotion: false }));
    await act(async () => { result.current.toggleMute(); });
    await act(async () => { result.current.toggleMute(); });
    expect(result.current.unmuted).toBe(false);
    expect(localStorage.getItem('after5:ambient-unmuted')).toBe('0');
  });

  it('hard-cuts (no ramp curve) under reduced motion when the active index advances', async () => {
    const { result, rerender } = renderHook(
      ({ i }) => useAmbientDeck(['a', 'b', 'c'], i, { reduceMotion: true }),
      { initialProps: { i: 0 } },
    );
    await act(async () => { result.current.toggleMute(); });
    const ctx = instances[0]!;
    const gainsBefore = (ctx.createGain as unknown as { mock: { results: { value: FakeGain }[] } }).mock.results.length;
    await act(async () => { rerender({ i: 1 }); });
    // gather all gain nodes created so far; none should have used the fade curve.
    const gains = (ctx.createGain as unknown as { mock: { results: { value: FakeGain }[] } }).mock.results.map((r) => r.value);
    expect(gainsBefore).toBeGreaterThan(0);
    const usedCurve = gains.some((g) => g.gain.setValueCurveAtTime.mock.calls.length > 0);
    expect(usedCurve).toBe(false);
    expect(result.current.unmuted).toBe(true);
  });

  it('uses an equal-power crossfade curve (not a hard cut) on advance with motion enabled', async () => {
    const { result, rerender } = renderHook(
      ({ i }) => useAmbientDeck(['a', 'b', 'c'], i, { reduceMotion: false }),
      { initialProps: { i: 0 } },
    );
    await act(async () => { result.current.toggleMute(); });
    await act(async () => { rerender({ i: 1 }); });
    const ctx = instances[0]!;
    const gains = (ctx.createGain as unknown as { mock: { results: { value: FakeGain }[] } }).mock.results.map((r) => r.value);
    const usedCurve = gains.some((g) => g.gain.setValueCurveAtTime.mock.calls.length > 0);
    expect(usedCurve).toBe(true);
  });

  it('falls back to the shipped bed when the active card url is null (bug #78)', async () => {
    const { result } = renderHook(() => useAmbientDeck([null], 0, { reduceMotion: false }));
    await act(async () => { result.current.toggleMute(); });
    // A null card url must still fetch (and play) the committed fallback asset.
    expect(fetched.some((u) => u.includes('/ambient/after5-ambient-loop'))).toBe(true);
    const ctx = instances[0]!;
    // a real source was started for the fallback buffer (not silence).
    const sources = (ctx.createBufferSource as unknown as { mock: { results: { value: FakeSource }[] } }).mock.results;
    expect(sources.some((r) => r.value.start.mock.calls.length > 0)).toBe(true);
  });

  it('falls back to the shipped bed when the card url 404s', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      fetched.push(url);
      // the card url 404s (placeholder bucket path); the fallback asset is ok.
      const ok = url.includes('/ambient/after5-ambient-loop');
      return { ok, arrayBuffer: async () => new ArrayBuffer(8) };
    }) as never;
    const { result } = renderHook(() => useAmbientDeck(['cozy/PLACEHOLDER.m4a'], 0, { reduceMotion: false }));
    await act(async () => { result.current.toggleMute(); });
    expect(fetched).toContain('cozy/PLACEHOLDER.m4a');
    expect(fetched.some((u) => u.includes('/ambient/after5-ambient-loop'))).toBe(true);
    const ctx = instances[0]!;
    const sources = (ctx.createBufferSource as unknown as { mock: { results: { value: FakeSource }[] } }).mock.results;
    expect(sources.some((r) => r.value.start.mock.calls.length > 0)).toBe(true);
  });

  it('closes the context on unmount', async () => {
    const { result, unmount } = renderHook(() => useAmbientDeck(['a'], 0, { reduceMotion: false }));
    await act(async () => { result.current.toggleMute(); });
    const ctx = instances[0]!;
    unmount();
    expect(ctx.close).toHaveBeenCalled();
  });
});
