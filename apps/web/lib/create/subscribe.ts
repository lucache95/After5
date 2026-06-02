// Reusable subscriber-capture helpers shared by /api/subscribe and /api/email-plan.
// normalizeSubscribeInput does the abuse-validation (email shape, length clamps);
// upsertSubscriber does the idempotent subscribers upsert + itinerary attribution.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export interface SubscribeInput { email?: string; city?: string | null; first_name?: string | null; source?: string }
export interface NormalizedSubscribe { valid: boolean; email: string; city: string | null; first_name: string | null; source: string }

export function normalizeSubscribeInput(b: SubscribeInput): NormalizedSubscribe {
  const email = (b.email ?? '').trim().toLowerCase();
  return {
    valid: EMAIL_RE.test(email),
    email,
    city: b.city ? b.city.trim().slice(0, 80) : null,
    first_name: b.first_name ? b.first_name.trim().slice(0, 40) : null,
    source: b.source ?? 'plan_gate',
  };
}

// admin = service-role client. Idempotent upsert + itinerary attribution.
// Returns the upsert error (if any) so callers can log it exactly as before.
// location + itineraryId mirror the original /api/subscribe upsert columns.
// admin = the service-role client; loosely typed to the chainable query-builder
// surface we use (upsert/update). The loose return type is intentional — the repo's
// flat ESLint config does not enforce an explicit-return-type / no-any rule here.
type AdminLike = { from: (t: string) => any };

export async function upsertSubscriber(
  admin: AdminLike,
  n: NormalizedSubscribe,
  opts: {
    userAgent?: string | null;
    location?: string | null;
    itineraryId?: string | null;
    itineraryIds?: string[];
  } = {},
): Promise<{ error: unknown }> {
  const { error } = await admin.from('subscribers').upsert(
    {
      email: n.email,
      source: n.source,
      location: opts.location ?? null,
      itinerary_id: opts.itineraryId ?? null,
      city: n.city,
      first_name: n.first_name,
      user_agent: opts.userAgent ?? null,
    },
    { onConflict: 'email,source', ignoreDuplicates: false },
  );

  const ids = opts.itineraryIds ?? (opts.itineraryId ? [opts.itineraryId] : []);
  if (ids.length > 0) {
    const patch: Record<string, string> = { claim_email: n.email };
    if (n.first_name) patch.built_by_name = n.first_name;
    if (n.city) patch.built_by_neighborhood = n.city;
    const { error: attrErr } = await admin.from('itineraries').update(patch).in('id', ids).is('user_id', null);
    if (attrErr) console.error('attribution error', attrErr);
  }
  return { error };
}
