"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const preflight = path.join(root, "contract-preflight.py");
const fixtures = path.join(__dirname, "fixtures", "contract-preflight");
const python = process.env.NOTICER_PYTHON || (process.platform === "win32" ? "python" : "python3");

function runFixture(name) {
  const result = spawnSync(
    python,
    [preflight, "--test", path.join(fixtures, name)],
    { encoding: "utf8", cwd: root }
  );
  assert.equal(result.error, undefined);
  return { ...result, report: JSON.parse(result.stdout) };
}

test("discarded comparison is a blocking false-green finding", () => {
  const result = runFixture("dead_comparison.py");
  assert.equal(result.status, 3);
  assert.equal(result.report.status, "FAIL");
  assert.deepEqual(result.report.findings.map((item) => item.code), ["DISCARDED_COMPARISON"]);
});

test("discarded np.allclose result is a blocking false-green finding", () => {
  const result = runFixture("dead_allclose.py");
  assert.equal(result.status, 3);
  assert.equal(result.report.findings[0].code, "DISCARDED_BOOLEAN_CALL");
  assert.equal(result.report.findings[0].line, 7);
});

test("binding assertion passes preflight", () => {
  const result = runFixture("armed_assertion.py");
  assert.equal(result.status, 0);
  assert.equal(result.report.status, "PASS");
  assert.equal(result.report.finding_count, 0);
});

test("constant true assertion is rejected", () => {
  const result = runFixture("constant_true.py");
  assert.equal(result.status, 3);
  assert.equal(result.report.findings[0].code, "CONSTANT_TRUE_ASSERTION");
});

test("swallowed exception is rejected", () => {
  const result = runFixture("swallowed_exception.py");
  assert.equal(result.status, 3);
  assert.equal(result.report.findings[0].code, "SWALLOWED_EXCEPTION");
});

test("contract with no test functions is rejected", () => {
  const result = runFixture("no_tests.py");
  assert.equal(result.status, 3);
  assert.equal(result.report.findings[0].code, "NO_TEST_FUNCTIONS");
});
