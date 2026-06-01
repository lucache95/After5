-- M1: 'auto' = machine-discovered, usable for solo planning + landing,
-- BUT blocked from dating meetups (enforced in post_night). Must be its own
-- migration: ADD VALUE commits before later migrations can reference it.
alter type place_approval_status add value if not exists 'auto';
