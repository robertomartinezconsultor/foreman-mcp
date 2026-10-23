# Devpost submission pack — Foreman MCP

Prepared for **Build, Ship, Shape: Amazon Developer Hackathon**.
Track: **Alexa+**. Mini challenges: **AWS Builder** and **Open Source**.
Entrant: Roberto Daniel Martínez López / ELTIGRELABS.
GitHub username: `robertomartinezconsultor`.

> Placeholders in `{{DOUBLE BRACES}}` are filled with the live URLs produced
> during the submission session (hosted endpoint, demo video). Known URLs:
> project repo https://github.com/robertomartinezconsultor/foreman-mcp ·
> open-source companion https://github.com/robertomartinezconsultor/alexa-mcp-check

## Project name

Foreman MCP

## Tagline

Ask your business. Your business answers.

## Description (submission text)

**Foreman MCP turns Alexa+ into the voice operations chief of a
field-service business.**

The owner of a remodeling, plumbing, HVAC or landscaping company does not
have an information problem — they have a *chasing* problem. Job status lives
in workers' heads, leads cool off while nobody answers, crews arrive without
materials, and the owner spends the day on the phone assembling facts that
the business already knows.

Foreman MCP connects that business to Alexa+ through a self-hosted
**Model Context Protocol server (spec 2025-11-25, Streamable HTTP)** with 11
tools. The owner asks and orders by voice — *"How is my business today?"*,
*"Prepare tomorrow"*, *"Which leads haven't I answered?"* — and the server
does the work against the business's real operating state:

- **A composite daily briefing**, not a one-turn answer: today's schedule,
  tomorrow's unassigned jobs, leads past the response SLA, low stock and the
  dispatch outbox in one spoken summary.
- **An agentic morning dispatch.** `run_morning_dispatch` prepares tomorrow
  end to end: it detects gaps a human would miss (jobs with no crew, a crew
  double-booked, material shortfalls aggregated across all of tomorrow's
  jobs, leads waiting past the first-response SLA), composes a dispatch per
  crew, queues an owner summary with ready-to-send lead replies, and drafts
  an approval-gated shopping list for the shortfalls.
- **State between sessions.** Jobs, crews, leads, inventory, the outbox,
  shopping drafts and a full audit log live in a persistent store with atomic
  write-through. A field update reported today is still on the job's thread
  tomorrow; a lead reply closes its follow-up clock permanently. Restart the
  server and the business remembers — our automated gate proves it across
  two boots.
- **Purchasing with a human gate.** Shopping lists are drafts in
  `pending_approval`. The server never buys anything; the owner approves in
  the operations console.
- **A live operations console** that makes voice visible: schedule, leads,
  inventory risk, dispatch outbox, pending approvals and audit trail, plus a
  voice-command simulator that calls the same MCP tools an Alexa+ client
  calls.

The demo business is a fictional San Antonio remodeling company (3 crews,
7 jobs, 5 leads, 11 inventory items, 555 phone numbers), seeded relative to
the current day so the demo never goes stale: there is always a job tomorrow
with no crew, stale leads and low thinset for the dispatch flow to catch.

Foreman MCP is the Alexa+ expression of the ELTIGRELABS thesis:
**the worker talks, the system understands, the company records, the owner
asks, and the company answers.**

## Built with

- Model Context Protocol TypeScript SDK (`@modelcontextprotocol/sdk`),
  MCP spec 2025-11-25, Streamable HTTP transport
- TypeScript / Node.js (built-in HTTP server), Zod input schemas
- Amazon Bedrock Runtime SDK (`@aws-sdk/client-bedrock-runtime`, Converse
  API) as an optional, flagged natural-language composition layer with a
  deterministic fallback — see `docs/product-feedback.md` for the exact
  integration status
- A persistent JSON store with atomic writes (no database dependency)
- An automated end-to-end gate (`scripts/verify.mjs`, 48 assertions) and
  evidence transcripts (`docs/evidence/`)

## Try it / testing instructions for judges

- **Hosted MCP endpoint:** `{{HOSTED_MCP_ENDPOINT}}`
- **Live operations console:** `{{HOSTED_CONSOLE_URL}}`
- **Public repository:** https://github.com/robertomartinezconsultor/foreman-mcp
- **Demo video (under 3 minutes, English):** `{{DEMO_VIDEO_URL}}`

No account, credentials or payment are needed. In the console, use the
voice-command simulator buttons — each one sends the same MCP `tools/call`
an Alexa+ client sends. Good first run: **"How is my business today?"**,
then **"Prepare tomorrow."**, then watch the outbox, shopping approvals and
audit trail change.

Run it locally:

```bash
npm install
npm run build
npm start            # MCP at http://localhost:3000/mcp, console at /console
npm run verify       # 48-assertion end-to-end gate across two server boots
```

Raw protocol smoke test:

```bash
curl -s -X POST {{HOSTED_MCP_ENDPOINT}} \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"judge-smoke","version":"1.0.0"}}}'
```

The hosted demo uses the shared fictional dataset; actions taken through the
tools (assigning crews, logging updates, replying to leads) mutate that demo
state, which is itself the demonstration of state between sessions.

## AWS Builder mini challenge — integration statement

Foreman MCP incorporates **Amazon Bedrock** through the official AWS SDK
for JavaScript v3 (`@aws-sdk/client-bedrock-runtime`). In `src/compose.ts`, a
`BedrockComposer` sits behind the `FOREMAN_COMPOSER=bedrock` flag: it takes
the deterministic draft of a briefing, crew dispatch or lead follow-up and
calls the Bedrock Converse API to polish it into natural spoken language
while keeping every fact unchanged; any failure falls back to the draft.
The full account of what was exercised live, what is implemented behind the
flag, onboarding friction and feature requests is in
`docs/product-feedback.md`, which is the text we submit as product feedback.
Stated plainly there and here: a go/no-go check on submission night found
**no AWS credentials available on the build machine at all**, so no live
Bedrock call was made; the integration is documented as implemented, and the
absence of a live run is declared, not disguised.

## Open Source mini challenge — fields

- **Contribution / new project URL:** https://github.com/robertomartinezconsultor/alexa-mcp-check
- **Project repository URL:** https://github.com/robertomartinezconsultor/foreman-mcp
- **GitHub username:** `robertomartinezconsultor`
- **What we built and why it matters:** `alexa-mcp-check` is a new,
  zero-dependency open-source CLI (MIT) created during the hackathon window
  that answers the question every Alexa+ MCP team asks: *is my server
  actually ready?* It negotiates MCP 2025-11-25, validates `tools/list`
  schemas, calls a read-only tool, checks RFC 9728 protected-resource
  metadata and error semantics, and prints a PASS/WARN/FAIL report with a
  suggested fix per check. It ships with 9 automated tests and a sample
  report generated against Foreman MCP itself (7 PASS, 1 WARN for the
  intentionally absent account-linking metadata, 0 FAIL).

## What was built during the hackathon window

Everything. Foreman MCP and `alexa-mcp-check` were designed and built from
scratch during the submission window (October 16–23, 2026): the MCP server,
the persistent store, the dispatch flow, the operations console, the
automated verification gate, the evidence transcripts and the companion CLI.

## Friction log

Submitted from `docs/friction-log.md` (3 entries: the stateless-transport
trap, the missing persistent-state pattern, and the missing official smoke
tester), each with task, steps, expected vs. actual, severity, workaround
and an actionable suggestion.
