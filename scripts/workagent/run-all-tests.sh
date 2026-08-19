#!/usr/bin/env bash
# Phase 0 Pi SDK Verification Test Suite

set -e

echo "========================================"
echo "Phase 0: Pi SDK Verification Test Suite"
echo "========================================"
echo ""

export OPENAI_API_KEY="${OPENAI_API_KEY}"

tests=(
  "00-check-import.mjs:Import Check"
  "01-basic-session.mjs:Basic Session + Event Stream"
  "02-extension-tool-intercept.mjs:Extension Tool Intercept"
  "03-custom-tool.mjs:Custom Tool Registration"
  "04-lifecycle-control.mjs:Lifecycle Control (steer/abort)"
  "05-session-resume.mjs:Session Resume/Persistence"
  "06-workspace-isolation.mjs:Workspace Isolation"
)

passed=0
failed=0

for test in "${tests[@]}"; do
  IFS=':' read -r file name <<< "$test"
  echo "----------------------------------------"
  echo "Test: $name"
  echo "File: $file"
  echo "----------------------------------------"
  
  if node "$file"; then
    echo "✅ PASSED: $name"
    ((passed++))
  else
    echo "❌ FAILED: $name"
    ((failed++))
  fi
  echo ""
done

echo "========================================"
echo "Test Summary"
echo "========================================"
echo "Passed: $passed / ${#tests[@]}"
echo "Failed: $failed / ${#tests[@]}"
echo ""

if [ $failed -eq 0 ]; then
  echo "✅ All tests passed!"
  exit 0
else
  echo "❌ Some tests failed"
  exit 1
fi
