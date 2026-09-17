#!/usr/bin/env bash
# test_runner.sh — standard interface; delegates to the Node runner. Usage: --smoke | --fast | (full)
cd "$(dirname "$0")/.."
exec node scripts/test-runner.mjs "$@"
