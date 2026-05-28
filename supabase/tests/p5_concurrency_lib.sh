#!/usr/bin/env bash
# supabase/tests/p5_concurrency_lib.sh
# Two-session race-harness library for P5/A/B race tests. Sourced by per-test .sh files.
# See docs/superpowers/specs/2026-05-27-5b-A-happy-path-design.md §4 + overview spec §4.3.

# DO NOT execute this file directly. It exports helpers:
#   p5_psql_bg <sql_file> <out_file>  — launches psql in background; echoes the PID
#   p5_wait_all <pid1> [<pid2> ...]   — waits for each PID; collects exit codes
#   p5_seed_pair <label_a> <label_b>  — seeds two users + an itinerary + an instance,
#                                       stashes ids in temp_race and echoes them as KEY=VALUE
#   p5_tempr_get <key>                — reads temp_race.v for key
#
# Local-only (hard-coded to default Supabase DB URI). Override with DB_URI env var if needed.

DB_URI="${DB_URI:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
P5_PSQL=(psql --quiet --tuples-only --no-align -v ON_ERROR_STOP=0 "$DB_URI")

# Launch a psql session in background. Returns the PID via stdout.
# Usage: PID=$(p5_psql_bg session_a.sql /tmp/out_a.log)
p5_psql_bg() {
  local sql_file="$1"
  local out_file="$2"
  "${P5_PSQL[@]}" -f "$sql_file" > "$out_file" 2>&1 &
  echo $!
}

# Wait on N pids; collect exit statuses into the global P5_EXITS array (indexed by PID).
# Usage: p5_wait_all "$PID_A" "$PID_B"; echo "${P5_EXITS[$PID_A]}"
declare -gA P5_EXITS
p5_wait_all() {
  P5_EXITS=()
  local pid
  for pid in "$@"; do
    if wait "$pid"; then
      P5_EXITS[$pid]=0
    else
      P5_EXITS[$pid]=$?
    fi
  done
}

# Seed a pair of users + itinerary + instance + (optional) offer for race tests.
# Stashes ids in temp_race so race scripts can read them. Echoes KEY=VALUE pairs.
# Usage: eval $(p5_seed_pair label)  — sets vars CRE=, CAND=, ITIN=, INST=
p5_seed_pair() {
  local label="$1"
  "${P5_PSQL[@]}" <<EOF
\i supabase/tests/_fixtures.sql
DO \$\$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid;
BEGIN
  cre := mk_user('$label' || '_cre');
  cand := mk_user('$label' || '_cand');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into temp_race(k,v) values ('${label}_cre', cre::text) on conflict (k) do update set v=excluded.v;
  insert into temp_race(k,v) values ('${label}_cand', cand::text) on conflict (k) do update set v=excluded.v;
  insert into temp_race(k,v) values ('${label}_itin', itin::text) on conflict (k) do update set v=excluded.v;
  insert into temp_race(k,v) values ('${label}_inst', inst::text) on conflict (k) do update set v=excluded.v;
  RAISE NOTICE 'CRE=%', cre;
  RAISE NOTICE 'CAND=%', cand;
  RAISE NOTICE 'ITIN=%', itin;
  RAISE NOTICE 'INST=%', inst;
END \$\$;
EOF
}

p5_tempr_get() {
  local key="$1"
  "${P5_PSQL[@]}" -c "select v from temp_race where k='$key'"
}

# pass/fail helpers (consistent with z_chat_thread_races.sh)
p5_pass() { echo "PASS: $*"; }
p5_fail() { echo "FAIL: $*" >&2; exit 1; }
