# Foreman MCP

**Ask your business. Your business answers.**

Foreman MCP is a self-hosted [Model Context Protocol](https://modelcontextprotocol.io)
server (spec **2025-11-25**, Streamable HTTP) that lets Alexa+ run a
field-service business by voice: daily briefings, job status, crew assignment,
field updates, a dispatch outbox, unanswered-lead follow-up, inventory checks
and approval-gated shopping lists.

Built for the **Alexa+ track** of the Amazon Developer Hackathon
("Build, Ship, Shape"). By ELTIGRELABS.

## What makes it more than a wrapper

- **State between sessions, on disk.** All business state (jobs, crews,
  leads, inventory, outbox, shopping drafts, audit log) lives in a
  persistent JSON store (`data/store.json`) written through atomically on
  every mutation. Kill the server, restart it: the business remembers.
- **An agentic flow, not a Q&A bot.** `run_morning_dispatch` prepares
  tomorrow end to end: it detects gaps (jobs with no crew, double-booked
  crews, material shortfalls against stock on hand, leads past the
  first-response SLA), composes a dispatch per crew, queues an owner
  summary with ready-to-send lead replies, and drafts an approval-gated
  shopping list for the shortfalls.
- **Purchase with a human gate.** Shopping lists are drafts in
  `pending_approval`. Nothing is ever purchased by the server.
- **AWS-ready, never AWS-dependent.** Briefing/dispatch text goes through
  a composer interface: deterministic templates by default; Amazon Bedrock
  polish when `FOREMAN_COMPOSER=bedrock` and AWS credentials are present,
  with automatic fallback. (Strands orchestration of the dispatch flow is
  the next milestone and slots into the same step functions.)

## Status (Oct 22, 2026)

Working and verified: persistent store + full remodeling demo dataset,
all 10 concept tools plus `run_morning_dispatch` (11 tools), the
dispatch flow with the deterministic composer, a live operations console
at `/console`, an automated end-to-end gate (**48 assertions across two
server boots**) and full evidence transcripts in
[`docs/evidence/`](docs/evidence/).

Submission materials: [`docs/devpost-submission.md`](docs/devpost-submission.md)
(project description, judging instructions and mini-challenge fields),
[`docs/product-feedback.md`](docs/product-feedback.md) (per-tool feedback,
including the exact Amazon Bedrock integration status) and
[`docs/friction-log.md`](docs/friction-log.md).

Run the gate yourself:

```bash
npm run build
node scripts/verify.mjs     # boots, calls every tool, restarts, re-verifies state
node scripts/evidence.mjs   # regenerates docs/evidence/
```

## Run it

```bash
npm install
npm run build
npm start            # http://localhost:3000/mcp  (PORT env to change)
```

Health check: `GET /` (store counts, composer in use). Full business state
(read-only, what the ops console renders): `GET /state`. Live operations
console (schedule, leads, outbox, audit trail, a voice-command simulator
that calls the same MCP tools, and the human gate itself: pending
shopping lists carry **Approve purchase / Reject** buttons whose decision
is saved, audited and visible in `/state` — smoke-tested click → state in
the gate): `http://localhost:3000/console`.

The demo dataset (a San Antonio remodeling company: 3 crews, 7 jobs,
5 leads, 11 inventory items) is seeded on first boot with dates relative
to that day, so the demo never goes stale: there is always a job tomorrow
with no crew, stale leads and low thinset for the dispatch flow to catch.
Reset it any time by deleting `data/store.json`. Point the store
elsewhere with `FOREMAN_DATA_DIR`.

## Try it

```bash
# initialize
curl -s -X POST localhost:3000/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'

# the agentic flow
curl -s -X POST localhost:3000/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"run_morning_dispatch","arguments":{}}}'
```

Point any MCP client (MCP Inspector, or Alexa+ via your hosted endpoint)
at `http://localhost:3000/mcp`.

## Tools (the 10 from the concept + the dispatch flow)

Queries:

- `get_day_briefing` — composite owner briefing for today
- `list_jobs` / `get_job` — schedule and job detail with its update thread
- `get_unanswered_leads` — leads waiting on a first reply, longest first
- `check_inventory` — stock levels with low-stock flags

Actions:

- `log_field_update` — a worker's report lands on the job's thread
- `assign_crew` — assign or reassign a crew, audited
- `queue_dispatch` — queue a message in the persistent outbox
- `record_lead_reply` — record a reply; closes the follow-up clock
- `create_shopping_list` — approval-gated restock or job-shortfall draft
- `run_morning_dispatch` — the agentic flow described above

Layout: `src/store.ts` (persistence + types), `src/seed.ts` (demo data),
`src/dispatch.ts` (the flow: plan, detect, compose, act, summarize),
`src/compose.ts` (text composition: deterministic + Bedrock behind a flag),
`src/index.ts` (HTTP + MCP wiring). Full design: `../CONCEPTO.md`.

## License

MIT — see [LICENSE](LICENSE).
