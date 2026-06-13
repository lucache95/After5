-- supabase/migrations/20260613130000_acct02_salt_from_vault.sql
-- ACCT-02: source the reputation salt from Supabase Vault instead of a DB-level GUC.
--
-- The original acct01 design read the salt from a Postgres custom GUC
-- (`app.reputation_salt`), set via `alter database postgres set app.reputation_salt`.
-- That requires SUPERUSER — Supabase's API/`postgres` role is the database OWNER but
-- NOT a superuser, so setting the GUC is dashboard-only (ALTER DATABASE → 42501). To
-- keep account-deletion fully manageable via the API (and to store the secret more
-- securely), source the salt from Supabase Vault instead:
--   - Vault stores the secret ENCRYPTED at rest.
--   - `vault.decrypted_secrets` is readable only by postgres/service_role, so a
--     SECURITY DEFINER function (owned by postgres) reads it while clients never can.
--   - Seed the secret out-of-band (NOT a literal in git — generated server-side):
--       select vault.create_secret(encode(gen_random_bytes(32),'hex'), 'reputation_salt',
--                                  'ACCT-01 reputation identity-hash salt');
--     Idempotent guard: only create when `vault.secrets` has no 'reputation_salt' row.
--
-- Fail-loud preserved: a missing/blank secret still raises P5002 so a deletion can
-- never silently skip reputation preservation.
create or replace function acct_identity_hash(p_phone_e164 text)
returns text
language plpgsql security definer set search_path = public, extensions as $fn$
declare v_salt text;
begin
  if p_phone_e164 is null or btrim(p_phone_e164) = '' then
    return null;  -- no durable identifier
  end if;
  select decrypted_secret into v_salt
    from vault.decrypted_secrets
   where name = 'reputation_salt';
  if v_salt is null or btrim(v_salt) = '' then
    raise exception 'reputation_salt_unset'
      using errcode = 'P5002',
            detail = 'Vault secret "reputation_salt" must exist (vault.create_secret(...,''reputation_salt''))';
  end if;
  return encode(digest(v_salt || btrim(p_phone_e164), 'sha256'), 'hex');
end $fn$;
revoke all on function acct_identity_hash(text) from public, anon, authenticated;
