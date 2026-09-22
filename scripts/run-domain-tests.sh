#!/usr/bin/env bash
#
# Run the domain unit tests with nothing installed.
#
# The suite is the only proof that the OIML R76 calculation rules are implemented
# correctly, so it must be runnable on a machine with no registry access. Node's built-in
# test runner executes the .ts files directly (type stripping, Node >= 22.18) and a local
# shim supplies the `vitest` API the test files import.
#
# For normal development `npm test` runs real vitest instead; both execute the same files.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node 22.18 or newer is required to run TypeScript directly (found $(node -v))." >&2
  exit 1
fi

shopt -s nullglob
TESTS=(packages/domain/tests/*.test.ts)
if [ ${#TESTS[@]} -eq 0 ]; then
  echo "No test files found under packages/domain/tests." >&2
  exit 1
fi

echo "Running ${#TESTS[@]} test file(s) on $(node -v)"
echo

OUTPUT="$(mktemp)"
trap 'rm -f "$OUTPUT"' EXIT

set +e
node \
  --disable-warning=ExperimentalWarning \
  --import "$ROOT/scripts/register-shim.mjs" \
  --test \
  "${TESTS[@]}" | tee "$OUTPUT"
STATUS=${PIPESTATUS[0]}
set -e

#
# Guard against a suite that fails before it registers anything.
#
# If a `describe` callback throws — a bad import, a missing helper, a matcher the shim does
# not implement — Node prints `not ok` for that suite but does not count it in `# fail`, and
# exits 0. Verified on Node v22: a file whose only real suite threw still reported
# "# pass 1 / # fail 0" and succeeded. That is the worst possible failure mode here, because
# a green run is the entire signal this suite exists to produce, and the tests that did not
# run are invisible rather than red.
#
# So the TAP output is checked directly. Any `not ok` line means something failed, whether or
# not Node agreed to count it.
#
if grep -qE '^[[:space:]]*not ok [0-9]' "$OUTPUT" && [ "$STATUS" -eq 0 ]; then
  echo
  echo "FAILED: the TAP output contains 'not ok' but Node exited 0." >&2
  echo "This normally means a suite threw while being collected, so its tests never ran:" >&2
  grep -E '^[[:space:]]*not ok [0-9]' "$OUTPUT" >&2
  STATUS=1
fi

exit "$STATUS"
