"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DEFAULT_GATEWAY = "https://causal-engine-gateway.fly.dev";

function getInput(name) {
  const upper = String(name).toUpperCase();
  const underscored = upper.replace(/-/g, "_");
  for (const key of [`INPUT_${underscored}`, `INPUT_${upper}`]) {
    if (process.env[key] != null && String(process.env[key]).length > 0) {
      return String(process.env[key]).trim();
    }
  }
  return "";
}

function maskSecrets(text, apiKey) {
  let out = String(text ?? "");
  if (apiKey) {
    out = out.split(apiKey).join("cek_…");
  }
  return out.replace(/cek_[A-Za-z0-9_-]+/g, (match) => `${match.slice(0, 8)}…`);
}

function setOutput(name, value) {
  const dest = process.env.GITHUB_OUTPUT;
  if (!dest) {
    return;
  }
  const token = `EOF_${name.replace(/[^A-Za-z0-9_]/g, "_")}_${process.pid}`;
  fs.appendFileSync(dest, `${name}<<${token}\n${value ?? ""}\n${token}\n`, "utf8");
}

function fail(message) {
  console.error(`::error::${maskSecrets(message, "")}`);
  process.exit(1);
}

function workspaceRoot() {
  return process.env.GITHUB_WORKSPACE || process.cwd();
}

function findChangedPython() {
  const baseRef = (process.env.GITHUB_BASE_REF || "").trim();
  if (!baseRef) {
    return null;
  }
  const result = spawnSync(
    "git",
    ["diff", "--name-only", "--diff-filter=AM", `origin/${baseRef}`],
    { encoding: "utf8", cwd: workspaceRoot() }
  );
  if (result.status !== 0) {
    return null;
  }
  const files = String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".py"));
  return files[0] || null;
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: String(text || "").slice(0, 2000) };
  }
}

function cycleStatusFrom(body) {
  if (!body || typeof body !== "object") {
    return null;
  }
  const cycle = body.cycle_result;
  if (cycle && typeof cycle === "object") {
    return cycle.status || null;
  }
  return null;
}

function endpointIdFrom(body) {
  if (!body || typeof body !== "object") {
    return "";
  }
  const cycle = body.cycle_result || {};
  const endpoint = cycle.endpoint || {};
  if (typeof endpoint.endpoint_id === "string") {
    return endpoint.endpoint_id;
  }
  const telemetry = cycle.telemetry || {};
  if (typeof telemetry.content_hash === "string") {
    return telemetry.content_hash;
  }
  return "";
}

async function main() {
  const apiKey = getInput("api-key");
  if (apiKey) {
    console.log(`::add-mask::${apiKey}`);
  }
  if (!apiKey) {
    fail("Missing input api-key. Register with POST /v1/accounts/register and store the cek_ key as a secret.");
  }

  const gateway = (getInput("gateway-url") || DEFAULT_GATEWAY).replace(/\/+$/, "");
  let sourcePath = getInput("source-path");
  const testPath = getInput("test-path");

  if (!sourcePath) {
    sourcePath = findChangedPython() || "";
  }
  if (!sourcePath) {
    fail("Missing source-path and no changed .py files were found vs origin/<base_ref>.");
  }

  const absSource = path.isAbsolute(sourcePath)
    ? sourcePath
    : path.join(workspaceRoot(), sourcePath);
  if (!fs.existsSync(absSource)) {
    fail(`source-path does not exist: ${sourcePath}`);
  }

  const sourceCode = fs.readFileSync(absSource, "utf8");
  const targetName = path.basename(absSource);
  let testCode;
  if (testPath) {
    const absTest = path.isAbsolute(testPath) ? testPath : path.join(workspaceRoot(), testPath);
    if (!fs.existsSync(absTest)) {
      fail(`test-path does not exist: ${testPath}`);
    }
    testCode = fs.readFileSync(absTest, "utf8");
  } else {
    testCode = [
      "import ast",
      "",
      "def test_source_parses():",
      `    with open(${JSON.stringify(targetName)}, encoding="utf-8") as handle:`,
      "        ast.parse(handle.read())",
      "",
    ].join("\n");
  }

  const url = `${gateway}/v1/verify`;
  console.log(`Causal Engine Verify: POST ${url} target=${targetName}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Causal-Engine-Key": apiKey,
      },
      body: JSON.stringify({
        target_path: targetName,
        source_code: sourceCode,
        test_code: testCode,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    fail(`Request to /v1/verify failed: ${err && err.message ? err.message : err}`);
  } finally {
    clearTimeout(timer);
  }

  const rawText = await response.text();
  const body = parseJsonSafe(maskSecrets(rawText, apiKey));
  const httpStatus = response.status;
  const checkoutUrl = body && typeof body === "object" ? body.checkout_url || "" : "";
  const status = httpStatus === 402 ? "PAYMENT_REQUIRED" : cycleStatusFrom(body);
  const endpointId = endpointIdFrom(body);
  const astValid =
    body && body.workload_telemetry && typeof body.workload_telemetry.ast_valid === "boolean"
      ? String(body.workload_telemetry.ast_valid)
      : "";

  setOutput("http-status", String(httpStatus));
  setOutput("cycle-status", status || (httpStatus === 200 ? "FAILED" : "HTTP_ERROR"));
  setOutput("endpoint-id", endpointId);
  setOutput("checkout-url", checkoutUrl);
  setOutput("ast-valid", astValid);

  if (httpStatus === 402) {
    console.log("HTTP 402 PAYMENT_REQUIRED — merge is blocked until this account is funded.");
    console.log(`checkout_url: ${checkoutUrl || "(missing from payload)"}`);
    if (body && body.reason) {
      console.log(`reason: ${body.reason}`);
    }
    process.exit(1);
  }

  if (httpStatus !== 200) {
    fail(`Engine returned HTTP ${httpStatus} for ${sourcePath}.`);
  }

  const settled = status === "SETTLED";
  console.log(`${settled ? "SETTLED" : status || "FAILED"} for ${sourcePath}`);
  if (endpointId) {
    console.log(`endpoint_id: ${endpointId}`);
  }
  if (body && body.workload_telemetry) {
    console.log(`telemetry: ${JSON.stringify(body.workload_telemetry)}`);
  }
  if (!settled) {
    process.exit(1);
  }
}

main().catch((err) => {
  fail(err && err.stack ? err.stack : String(err));
});
