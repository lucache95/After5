// apps/web/lib/after5/__tests__/match.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({ functions: { invoke } }),
}));

import {
  shortlist, makeOffer, cancelLock, resolveReciprocal, demandHint,
  acceptOffer, passOffer,
  MatchError, messageForCode,
} from '../match';

beforeEach(() => invoke.mockReset());

describe('match wrapper', () => {
  it('shortlist invokes match-shortlist with instance/candidate/rank', async () => {
    invoke.mockResolvedValue({ data: { ok: true, data: null }, error: null });
    await shortlist('inst-1', 'cand-1', 3);
    expect(invoke).toHaveBeenCalledWith('match-shortlist', {
      body: { instance: 'inst-1', candidate: 'cand-1', rank: 3 },
    });
  });

  it('makeOffer mints an idem_key and returns the discriminated offer payload', async () => {
    invoke.mockResolvedValue({ data: { ok: true, data: { kind: 'offer', offer_id: 'off-9' } }, error: null });
    const res = await makeOffer('inst-1', 'cand-1');
    const [, opts] = invoke.mock.calls[0];
    expect(opts.body.instance).toBe('inst-1');
    expect(opts.body.candidate).toBe('cand-1');
    expect(typeof opts.body.idem_key).toBe('string');
    expect(opts.body.idem_key.length).toBeGreaterThan(10);
    expect(res).toEqual({ kind: 'offer', offer_id: 'off-9' });
  });

  it('makeOffer surfaces a reciprocal result as a normal success payload', async () => {
    invoke.mockResolvedValue({ data: { ok: true, data: { kind: 'reciprocal', pair_id: 'pair-7' } }, error: null });
    const res = await makeOffer('inst-1', 'cand-1');
    expect(res).toEqual({ kind: 'reciprocal', pair_id: 'pair-7' });
  });

  it('cancelLock invokes match-cancel-lock with lock/reason/idem_key', async () => {
    invoke.mockResolvedValue({ data: { ok: true, data: null }, error: null });
    await cancelLock('lock-1', 'no_show');
    const [name, opts] = invoke.mock.calls[0];
    expect(name).toBe('match-cancel-lock');
    expect(opts.body.lock).toBe('lock-1');
    expect(opts.body.reason).toBe('no_show');
    expect(typeof opts.body.idem_key).toBe('string');
  });

  it('resolveReciprocal invokes match-resolve-reciprocal with pair/chosen/idem_key', async () => {
    invoke.mockResolvedValue({ data: { ok: true, data: null }, error: null });
    await resolveReciprocal('pair-1', 'inst-2');
    const [name, opts] = invoke.mock.calls[0];
    expect(name).toBe('match-resolve-reciprocal');
    expect(opts.body.pair_id).toBe('pair-1');
    expect(opts.body.chosen_instance).toBe('inst-2');
    expect(typeof opts.body.idem_key).toBe('string');
  });

  it('demandHint returns the data bucket', async () => {
    invoke.mockResolvedValue({ data: { ok: true, data: 'filling_up' }, error: null });
    expect(await demandHint('inst-1')).toBe('filling_up');
  });

  it('throws MatchError carrying the error name, errcode + detail on an ok:false body', async () => {
    invoke.mockResolvedValue({
      data: { ok: false, code: 'offer_already_active', message: "Someone's already in the offer slot.", errcode: 'P5003' },
      error: null,
    });
    await expect(makeOffer('inst-1', 'cand-1')).rejects.toMatchObject({
      code: 'offer_already_active',
      errcode: 'P5003',
    });
  });

  it('throws MatchError on a FunctionsHttpError envelope too (body still on data)', async () => {
    invoke.mockResolvedValue({
      data: { ok: false, code: 'time_conflict', message: "You're already locked at that time.", errcode: 'P5004' },
      error: { name: 'FunctionsHttpError', message: 'non-2xx' },
    });
    await expect(makeOffer('inst-1', 'cand-1')).rejects.toMatchObject({ code: 'time_conflict' });
  });

  it('acceptOffer mints an idem_key and returns the bare lock uuid string', async () => {
    invoke.mockResolvedValue({ data: { ok: true, data: 'lock-uuid-1' }, error: null });
    const res = await acceptOffer('off-1');
    const [name, opts] = invoke.mock.calls[0];
    expect(name).toBe('match-accept-offer');
    expect(opts.body.offer).toBe('off-1');
    expect(typeof opts.body.idem_key).toBe('string');
    expect(opts.body.idem_key.length).toBeGreaterThan(10);
    expect(res).toBe('lock-uuid-1');
  });

  it('passOffer invokes match-pass-offer with offer only (no idem_key) and resolves undefined', async () => {
    invoke.mockResolvedValue({ data: { ok: true, data: null }, error: null });
    const res = await passOffer('off-1');
    const [name, opts] = invoke.mock.calls[0];
    expect(name).toBe('match-pass-offer');
    expect(opts.body).toEqual({ offer: 'off-1' });
    expect('idem_key' in opts.body).toBe(false);
    expect(res).toBeUndefined();
  });

  it('acceptOffer throws MatchError carrying code + errcode on an ok:false body', async () => {
    invoke.mockResolvedValue({
      data: { ok: false, code: 'offer_expired', errcode: 'P5007', message: 'that offer already expired.' },
      error: null,
    });
    await expect(acceptOffer('off-1')).rejects.toMatchObject({
      code: 'offer_expired',
      errcode: 'P5007',
    });
  });

  it('messageForCode maps known error names to dry lowercase copy', () => {
    expect(messageForCode('offer_already_active')).toMatch(/already have an offer out/i);
    expect(messageForCode('time_conflict')).toMatch(/overlaps/i);
    expect(messageForCode('account_gated')).toMatch(/can.t be offered/i);
  });
});
