#!/bin/bash
# Phase 0 Pi Runtime Spike - Run All Tests

set -e

echo "=================================================="
echo "Phase 0 - Pi Runtime Spike Test Suite"
echo "=================================================="
echo ""

# Check Node version
NODE_VERSION=$(node -v)
echo "Node version: $NODE_VERSION"
if [[ ! "$NODE_VERSION" =~ ^v22 ]]; then
  echo "❌ Error: Node.js >= 22.19.0 required"
  echo "Current: $NODE_VERSION"
  exit 1
fi
echo "✅ Node version OK"
echo ""

# Check OPENAI_API_KEY
if [ -z "$OPENAI_API_KEY" ]; then
  echo "❌ Error: OPENAI_API_KEY not set"
  exit 1
fi
echo "✅ OPENAI_API_KEY set"
echo ""

cd "$(dirname "$0")"

TESTS=(
  "01-basic-session.mjs"
  "02-extension-tool-intercept.mjs"
  "03-custom-tool.mjs"
  "04-lifecycle-control.mjs"
  "05-session-resume.mjs"
  "06-workspace-isolation.mjs"
)

for test in "${TESTS[@]}"; do
  echo ""
  echo "=================================================="
  echo "Running: $test"
  echo "=================================================="
  node "$test" || {
    echo "❌ Test failed: $test"
    exit 1
  }
  echo ""
  sleep 2
done

echo ""
echo "=================================================="
echo "✅ All Phase 0 tests passed!"
echo "=================================================="
