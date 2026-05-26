-- Extend S1's verification_state enum with the spec's appeal state (§8).
alter type verification_state add value if not exists 'appeal';
