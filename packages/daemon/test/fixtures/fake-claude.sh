#!/bin/sh
# Stands in for the real `claude` binary in tests. Emits whatever fixture the
# CCN_TEST_FIXTURE env var points at, or fails when CCN_TEST_FAIL is set.
if [ -n "$CCN_TEST_FAIL" ]; then
  echo "claude: not logged in" >&2
  exit 1
fi
cat "$CCN_TEST_FIXTURE"
