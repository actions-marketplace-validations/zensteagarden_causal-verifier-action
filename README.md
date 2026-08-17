# Causal Engine Verify

GitHub Action for the [Causal-Economic Code Verification Gate](https://causal-engine-gateway.fly.dev/agent-manifest). It POSTs Python source and a pytest contract to **`POST /v1/verify`** (metered, authenticated). It does **not** call unsigned `/cycle/execute-live`.

- Passes the job when the engine returns **SETTLED**
- Fails the job on **FAILED** telemetry
- Fails the job on **HTTP 402** and surfaces `checkout_url`

## Usage

```yaml
name: Causal Verification Gate
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  verify:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: zensteagarden/causal-verifier-action@v1
        with:
          api-key: ${{ secrets.CAUSAL_ENGINE_API_KEY }}
          gateway-url: ${{ secrets.CAUSAL_ENGINE_URL }}
          source-path: path/to/changed.py
```

`gateway-url` is optional and defaults to `https://causal-engine-gateway.fly.dev`.

If `source-path` is omitted on a pull request, the action verifies the first added or modified `.py` file vs `origin/<base_ref>`.

## Inputs

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `api-key` | yes | | `cek_` key from `POST /v1/accounts/register`. Store as `CAUSAL_ENGINE_API_KEY`. |
| `gateway-url` | no | `https://causal-engine-gateway.fly.dev` | Gateway base URL. |
| `source-path` | no | first changed `.py` on a PR | File to verify. |
| `test-path` | no | generated parse-only contract | Pytest file. Do not import `pathlib`/`os`; those are sandbox-banned. |

## Outputs

| Name | Description |
| --- | --- |
| `cycle-status` | `SETTLED`, `FAILED`, `PAYMENT_REQUIRED`, or `HTTP_ERROR` |
| `endpoint-id` | 64-hex endpoint id when present |
| `checkout-url` | Stripe Checkout URL on HTTP 402 |
| `http-status` | HTTP status from `/v1/verify` |
| `ast-valid` | `workload_telemetry.ast_valid` when present |

## Get an API key

```bash
curl -sS -X POST https://causal-engine-gateway.fly.dev/v1/accounts/register \
  -H "Content-Type: application/json" \
  -d '{"channel":"github_action"}'
```

Save `api_key` once. It is not shown again. The `github_action` channel includes 25 free PR checks per month; other channels such as `mcp` and `langchain` receive welcome credits.

## HTTP 402

When credits are exhausted the engine returns HTTP 402 with `checkout_url`. This action fails the job and writes that URL to the `checkout-url` output so a later step can comment it on the pull request.

## Drop-in workflow (no reusable action)

A self-contained workflow copy lives alongside this action as `causal-verify.yml` in the engine repo. Prefer `uses: zensteagarden/causal-verifier-action@v1` in new projects.
