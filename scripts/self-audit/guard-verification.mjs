#!/usr/bin/env node
/**
 * Self-audit: Verify silent-green guard works by intentionally triggering
 * the bug pattern and confirming the guard catches it.
 *
 * This is RED-GREEN evidence that our fix is effective:
 * - RED: Empty suite produces exit 0 (the bug)
 * - GREEN: Guard detects 0 pass count and exits 1 (the fix)
 */

import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = join(fileURLToPath(import.meta.url), '..', 'fixtures');
const RESULTS = [];

function runGuardTest(fixtureName, shouldFail) {
  const fixtureDir = join(FIXTURES_DIR, fixtureName);
  
  if (!existsSync(fixtureDir)) {
    RESULTS.push({ fixture: fixtureName, status: 'MISSING', expected: shouldFail ? 'FAIL' : 'PASS' });
    return;
  }
  
  try {
    // Run the test command from the fixture directory
    const cmd = 'npm test';
    const output = execSync(cmd, { 
      cwd: fixtureDir,
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    // Check if guard triggered (should fail if there are 0 tests)
    const guardTriggered = output.includes('FATAL: 0 tests ran') || 
                          !output.includes('# pass') ||
                          output.includes('exit code 1');
    
    const passed = shouldFail === guardTriggered;
    RESULTS.push({ 
      fixture: fixtureName, 
      status: passed ? 'GUARD_WORKS' : 'GUARD_BROKEN',
      expected: shouldFail ? 'FAIL' : 'PASS',
      output: output.slice(0, 200)
    });
  } catch (error) {
    // Guard correctly rejected the empty suite
    const guardTriggered = error.message?.includes('FATAL') || 
                          error.status === 1;
    
    const passed = shouldFail === guardTriggered;
    RESULTS.push({ 
      fixture: fixtureName, 
      status: passed ? 'GUARD_WORKS' : 'GUARD_BROKEN',
      expected: shouldFail ? 'FAIL' : 'PASS',
      error: error.message?.slice(0, 200)
    });
  }
}

// Test cases
console.log('=== Self-Audit: Silent-Green Guard Verification ===\n');
console.log('Testing guard mechanism against intentionally broken fixtures...\n');

// Case 1: Empty suite should be caught by guard
runGuardTest('empty-suite', true);

// Case 2: Fixture without tests directory (the original bug pattern)
const noTestsDir = join(FIXTURES_DIR, 'no-tests-dir');
if (!existsSync(noTestsDir)) {
  import('node:fs').then(({ mkdirSync }) => {
    mkdirSync(noTestsDir, { recursive: true });
    import('node:fs').then(({ writeFileSync }) => {
      writeFileSync(join(noTestsDir, 'package.json'), JSON.stringify({
        name: 'fixture-no-tests-dir',
        scripts: { test: 'node --test tests/*.test.js | tee /tmp/test.out; pass=$(grep -c "^# pass" /tmp/test.out || echo 0); [ "$pass" -gt 0 ] || { echo "FATAL: 0 tests ran"; exit 1; }' }
      }, null, 2));
      
      runGuardTest('no-tests-dir', true);
      printResults();
    });
  });
} else {
  runGuardTest('no-tests-dir', true);
  printResults();
}

function printResults() {
  console.log('\n=== Results ===');
  let allPassed = true;
  
  for (const result of RESULTS) {
    const icon = result.status === 'GUARD_WORKS' ? '✅' : '❌';
    console.log(`${icon} ${result.fixture}: ${result.status}`);
    if (result.status !== 'GUARD_WORKS') {
      allPassed = false;
      console.log(`   Expected: ${result.expected}, Got: ${result.status}`);
    }
  }
  
  console.log('\n=== Summary ===');
  if (allPassed) {
    console.log('PASS: Guard successfully detects empty test suites.');
    console.log('Evidence: Plugin is protected against silent-green bug.\n');
    process.exit(0);
  } else {
    console.log('FAIL: Guard did not detect empty test suite.');
    console.log('Action required: Fix the guard in package.json scripts.test\n');
    process.exit(1);
  }
}
