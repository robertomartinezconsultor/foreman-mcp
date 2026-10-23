# Product feedback — Foreman MCP

This is the product-feedback text prepared for the Devpost submission. It is
deliberately factual: it distinguishes what was exercised live from what is
implemented behind a configuration flag.

## Model Context Protocol TypeScript SDK (`@modelcontextprotocol/sdk`)

**What we used it for.** The entire Alexa+ track runtime: a self-hosted MCP
server on spec **2025-11-25** over Streamable HTTP. We used `McpServer`,
`StreamableHTTPServerTransport`, the SDK's Zod-backed tool schemas and its
structured-content responses to expose 11 business tools to an MCP client.

**What worked well.**

- The high-level `McpServer.tool()` API is genuinely fast to build with: a
  typed tool with a description, input schema and handler is a few lines.
- Structured content plus a human-readable text result is the right shape for
  voice: Alexa+ can speak the text while a client or console can render the
  structured data.
- Protocol negotiation was clean once the server used the SDK's stateless
  per-request pattern.

**What needs work.**

- The stateless pattern is easy to get wrong. A single shared transport with
  `sessionIdGenerator: undefined` accepted `initialize` but returned HTTP 500
  for an independent `tools/list` POST. The fix (create `McpServer` + transport
  per request) is known inside the SDK examples but was not the obvious path
  from the high-level docs.
- There is no small official smoke-test client for "call my hosted MCP server
  the way Alexa+ would." We had to write our own JSON-RPC client that handles
  both JSON and `text/event-stream` responses before we could build a reliable
  end-to-end gate.

**Onboarding.** From zero to a responding `initialize` was quick. From there
to a trustworthy end-to-end test took longer than expected because the test
harness, content negotiation details and stateless lifecycle all had to be
discovered by experiment.

**Would we build with it again?** Yes. The SDK is the right foundation; the
missing piece is a canonical hosted-server starter that includes the
per-request stateless pattern, persistent external state and an automated
smoke gate.

## Amazon Bedrock Runtime SDK (`@aws-sdk/client-bedrock-runtime`)

**What we used it for.** An optional natural-language composition layer. The
server drafts every briefing, crew dispatch and lead follow-up with
deterministic templates. When `FOREMAN_COMPOSER=bedrock` is set **and** AWS
credentials are present, the Bedrock composer sends that draft to the
Converse API (`amazon.nova-lite-v1:0` by default) with an instruction to keep
every fact, name, time and number unchanged while making the text sound
natural spoken aloud. Any Bedrock error falls back to the deterministic draft.

**Integration status, stated plainly.** The Bedrock integration is implemented
in `src/compose.ts`, lazily imported, and shipped in the repository. During
this build we did **not** have an AWS account with Bedrock model access wired
to the server, so the live generation path was not exercised end to end; the
deterministic path was exercised by the full automated gate. We document the
integration for the AWS Builder mini challenge on that basis and do not claim
a live Bedrock run we did not make.

**What worked well in the integration design.** The Converse API shape is
simple, and the AWS SDK v3 modular import made it easy to keep Bedrock out of
the startup path. The draft-then-polish pattern is a good fit for voice
business tools because facts stay deterministic while phrasing can improve.

**What needs work.** For a hackathon team, the path from "I have an AWS
account" to "my server can call one Bedrock model" still has several
independent gates (account, region, model access, credentials in the hosting
environment). A single preflight command that verifies each gate and prints
the exact failing one would remove most of the guesswork.

**Would we build with it again?** Yes, with the same architecture: Bedrock as
an enhancement behind a flag, never as a hard dependency for the core tools.

## Node.js and Zod

**What we used them for.** Node's built-in HTTP server hosts the MCP
transport, the health/state endpoints and the operations console. Zod schemas
define and validate every tool's inputs at the boundary.

**What worked well.** Zero framework overhead, fast cold starts, and one
language across server, scripts and tests. Zod's inferred handler arguments
kept tool code small and safe.

**What needs work.** Nothing material for this project. The one sharp edge is
operational, not technical: a stateful demo server needs a host that keeps a
process and a disk; most free serverless defaults optimize for the opposite.

## Tools we evaluated but did not use

- **Strands Agents SDK:** evaluated for orchestrating
  `run_morning_dispatch`. We shipped an explicit, inspectable step sequencer
  (plan → detect → compose → act → summarize) instead, because every step's
  inputs and outputs needed to be auditable in the demo and reproducible in
  the automated gate. We do not claim Strands usage.
- **Kiro Crew:** not used in this build. We do not claim it.

## Feature requests

1. **Critical — an official Alexa+ MCP smoke tester.** Paste a hosted
   endpoint URL; it negotiates the protocol, lists tools, calls a selected
   read-only tool, checks RFC 9728 protected-resource metadata and 401
   semantics, and prints a pass/fail report. Every team currently rebuilds
   this harness privately. (Our open-source companion project,
   `alexa-mcp-check`, is our attempt at exactly this.)
2. **Important — a documented "state between sessions" pattern for
   self-hosted MCP servers.** The judging guidance rewards state that survives
   sessions, but the starter path keeps state inside a disposable server
   instance. A short guide showing an externalized persistent store with
   atomic writes would raise the quality of many submissions.
3. **Important — a Bedrock preflight for hackathon servers.** One command or
   console check that verifies account, region, model access and runtime
   credentials, and names the exact gate that fails.
4. **Nice to have — a voice-response lint.** A tool that flags MCP text
   results that are too long or too table-shaped to be spoken comfortably by
   a voice assistant.
