-- The webhook / start-verification / confirm-phone upsert on (user_id, kind).
create unique index if not exists verifications_user_kind_ukey on verifications (user_id, kind);
