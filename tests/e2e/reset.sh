#!/bin/sh
# Wipe test data between end-to-end runs (local test database only).
psql -h /var/tmp/pgtest -p 5544 -U postgres -d e2e -qc "truncate auth.users cascade; truncate auth.refresh_tokens, auth.sessions, auth.flow_state, auth.one_time_tokens cascade;" 2>&1 | grep -v NOTICE
rm -rf /var/tmp/e2e/mail/* /var/tmp/e2e/bucket/* /var/tmp/e2e/shots/*
echo reset
