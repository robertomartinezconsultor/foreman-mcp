/**
 * Foreman MCP — a self-hosted MCP server for Alexa+ (MCP spec 2025-11-25,
 * Streamable HTTP transport).
 *
 * The owner of a field-service business (remodeling, plumbing, HVAC,
 * landscaping) talks to Alexa+; Alexa+ calls these tools; the business
 * answers and acts: briefings, job status, crew assignment, field updates,
 * dispatch outbox, unanswered leads, inventory and approval-gated shopping.
 *
 * State lives in a persistent on-disk store (src/store.ts) shared by every
 * request, so the business remembers across sessions and restarts. The
 * agentic centerpiece is run_morning_dispatch (src/dispatch.ts).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createComposer } from "./compose.js";
import { hoursSince, today, tomorrow } from "./dates.js";
import { LEAD_SLA_HOURS, runMorningDispatch } from "./dispatch.js";
import { Store } from "./store.js";

// One shared persistent store + composer for the whole process. Tool
// handlers below are thin: validate, mutate the store, write through.
const store = new Store();
const composer = createComposer();
console.log(`store: ${store.file} (${store.data.jobs.length} jobs, ${store.data.leads.length} leads)`);

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const ok = (text: string, structured?: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text }],
  ...(structured ? { structuredContent: structured } : {}),
});

const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

function jobLine(j: (typeof store.data.jobs)[number]): string {
  return (
    `${j.id} - ${j.customer} (${j.address})\n` +
    `  ${j.service}: ${j.stage}\n` +
    `  Crew: ${store.crewName(j.crewId)} | Visit: ${j.scheduledDate} ${j.scheduledTime} (~${j.estimatedHours}h) | Status: ${j.status}`
  );
}

function createForemanServer(): McpServer {
  const server = new McpServer({ name: "foreman-mcp", version: "0.2.0" });

  // ------------------------------------------------------------------ queries

  server.tool(
    "get_day_briefing",
    "Owner briefing for today: jobs on the schedule, tomorrow's unassigned work, leads past the response SLA, low stock and outbox status.",
    {},
    async () => {
      const t = today();
      const tm = tomorrow();
      const jobsToday = store.data.jobs.filter((j) => j.scheduledDate === t && j.status === "active");
      const unassignedTomorrow = store.data.jobs
        .filter((j) => j.scheduledDate === tm && j.status === "active" && !j.crewId)
        .map((j) => `${j.customer} (${j.service}, ${j.scheduledTime})`);
      const staleLeads = store.data.leads
        .filter((l) => l.status === "new" && hoursSince(l.receivedAt) >= LEAD_SLA_HOURS)
        .map((l) => `${l.name} (${l.topic}, waiting ${hoursSince(l.receivedAt)}h)`);
      const lowStock = store.data.inventory
        .filter((i) => i.onHand <= i.lowAt)
        .map((i) => `${i.item}: ${i.onHand} ${i.unit} left`);
      const text = await composer.composeBriefing({
        dateLabel: t,
        jobsToday: jobsToday.length,
        unassignedTomorrow,
        staleLeads,
        lowStock,
        outboxQueued: store.data.outbox.length,
      });
      return ok(text, {
        date: t,
        jobsToday: jobsToday.map((j) => j.id),
        unassignedTomorrow,
        staleLeads,
        lowStock,
        outboxQueued: store.data.outbox.length,
        composer: composer.name,
      });
    },
  );

  server.tool(
    "list_jobs",
    "List jobs with stage, crew and scheduled visit. Optional date filter (YYYY-MM-DD).",
    { date: z.string().optional().describe("Only jobs scheduled on this date (YYYY-MM-DD)") },
    async ({ date }) => {
      const jobs = store.data.jobs
        .filter((j) => !date || j.scheduledDate === date)
        .sort((a, b) => `${a.scheduledDate} ${a.scheduledTime}`.localeCompare(`${b.scheduledDate} ${b.scheduledTime}`));
      if (!jobs.length) return ok(date ? `No jobs scheduled on ${date}.` : "No jobs in the system.");
      return ok(jobs.map(jobLine).join("\n"), { jobs: jobs.map((j) => j.id) });
    },
  );

  server.tool(
    "get_job",
    "Full detail of one job, including its field-update thread (the business's memory of that job).",
    { jobId: z.string().describe("Job id, e.g. 'job-101'") },
    async ({ jobId }) => {
      const job = store.jobById(jobId);
      if (!job) return fail(`No job with id ${jobId}. Use list_jobs to see the ids.`);
      const materials = job.materialsNeeded.length
        ? job.materialsNeeded.map((m) => `${m.qty} x ${m.item}`).join(", ")
        : "none";
      const thread = job.notes.length
        ? job.notes.map((n) => `  [${n.at}] ${n.author}: ${n.text}`).join("\n")
        : "  (no updates yet)";
      return ok(
        `${jobLine(job)}\n  Materials needed: ${materials}\n  Thread:\n${thread}`,
        { job },
      );
    },
  );

  server.tool(
    "get_unanswered_leads",
    "Leads still waiting for a first reply, longest wait first, with hours waiting and contact info.",
    {
      minHours: z
        .number()
        .optional()
        .describe("Only leads waiting at least this many hours (default 0 = all unanswered)"),
    },
    async ({ minHours }) => {
      const min = minHours ?? 0;
      const leads = store.data.leads
        .filter((l) => l.status === "new" && hoursSince(l.receivedAt) >= min)
        .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
      if (!leads.length) return ok("No unanswered leads. Every lead has a first reply.");
      const text = leads
        .map(
          (l) =>
            `${l.id} - ${l.name} (${l.channel}, ${l.phone}): ${l.topic}. Waiting ${hoursSince(l.receivedAt)}h.`,
        )
        .join("\n");
      return ok(text, { leads: leads.map((l) => ({ ...l, hoursWaiting: hoursSince(l.receivedAt) })) });
    },
  );

  server.tool(
    "check_inventory",
    "Inventory levels; flags items at or below their low-stock threshold.",
    { onlyLow: z.boolean().optional().describe("Only return low-stock items") },
    async ({ onlyLow }) => {
      const items = store.data.inventory.filter((i) => !onlyLow || i.onHand <= i.lowAt);
      if (!items.length) return ok("Nothing is low. Stock is healthy across the board.");
      const text = items
        .map(
          (i) =>
            `${i.item}: ${i.onHand} ${i.unit} on hand (${i.location})${i.onHand <= i.lowAt ? ` [LOW: threshold ${i.lowAt}]` : ""}`,
        )
        .join("\n");
      return ok(text, { items });
    },
  );

  // ------------------------------------------------------------------ actions

  server.tool(
    "log_field_update",
    "Record a field update from a worker against a job (progress, problem, material note). This is how the business remembers what the field reported.",
    {
      jobId: z.string().describe("Job id, e.g. 'job-101'"),
      author: z.string().describe("Who reports, e.g. 'Juan Herrera (Crew A)'"),
      text: z.string().describe("The update, in the worker's words"),
      newStage: z.string().optional().describe("Optionally move the job to this stage"),
    },
    async ({ jobId, author, text, newStage }) => {
      const job = store.jobById(jobId);
      if (!job) return fail(`No job with id ${jobId}.`);
      job.notes.push({ at: new Date().toISOString(), author, text });
      if (newStage) job.stage = newStage;
      store.audit(author, "job.field_update", `${jobId}: ${text}${newStage ? ` (stage -> ${newStage})` : ""}`);
      store.save();
      return ok(
        `Logged on ${job.customer} (${jobId}) by ${author}: "${text}"${newStage ? ` Stage is now "${newStage}".` : ""} The update is saved and will survive restarts.`,
        { jobId, notesOnJob: job.notes.length },
      );
    },
  );

  server.tool(
    "assign_crew",
    "Assign a crew to a job (or reassign). Crew ids: crew-a, crew-b, crew-c; list with list_jobs output or get_day_briefing.",
    {
      jobId: z.string().describe("Job id, e.g. 'job-102'"),
      crewId: z.string().describe("Crew id: 'crew-a', 'crew-b' or 'crew-c'"),
    },
    async ({ jobId, crewId }) => {
      const job = store.jobById(jobId);
      if (!job) return fail(`No job with id ${jobId}.`);
      const crew = store.crewById(crewId);
      if (!crew) return fail(`No crew with id ${crewId}. Crews: ${store.data.crews.map((c) => `${c.id} (${c.name})`).join(", ")}.`);
      const before = store.crewName(job.crewId);
      job.crewId = crewId;
      store.audit("owner", "job.crew_assigned", `${jobId} (${job.customer}): ${before} -> ${crew.name} for ${job.scheduledDate} ${job.scheduledTime}.`);
      store.save();
      return ok(
        `${crew.name} (${crew.members.join(", ")}) is now assigned to ${job.customer} (${jobId}) on ${job.scheduledDate} at ${job.scheduledTime}. Was: ${before}.`,
        { jobId, crewId, crewName: crew.name },
      );
    },
  );

  server.tool(
    "queue_dispatch",
    "Queue a dispatch message to a crew or the owner in the outbox. The outbox is the delivery queue the ops console shows; messages persist.",
    {
      to: z.string().describe("Recipient: a crew name/id ('Crew A', 'crew-b') or 'Owner'"),
      message: z.string().describe("The dispatch message"),
    },
    async ({ to, message }) => {
      const crew =
        store.crewById(to) ?? store.data.crews.find((c) => c.name.toLowerCase() === to.toLowerCase());
      const entry = {
        id: store.nextId("out", store.data.outbox.map((o) => o.id)),
        to: crew ? `${crew.name} (${crew.members.join(", ")})` : to,
        channel: (crew ? "crew" : "owner") as "crew" | "owner",
        message,
        queuedAt: new Date().toISOString(),
        status: "queued" as const,
      };
      store.data.outbox.push(entry);
      store.audit("owner", "dispatch.queued", `To ${entry.to}: ${message}`);
      store.save();
      return ok(`Queued dispatch ${entry.id} for ${entry.to}. Outbox now holds ${store.data.outbox.length} message(s).`, {
        outboxId: entry.id,
        outboxSize: store.data.outbox.length,
      });
    },
  );

  server.tool(
    "record_lead_reply",
    "Record that a lead got a reply: saves the reply text on the lead's thread and closes the follow-up clock. State persists across sessions.",
    {
      leadId: z.string().describe("Lead id, e.g. 'lead-1'"),
      text: z.string().describe("What was sent to the lead"),
      author: z.string().optional().describe("Who replied (default 'Office')"),
    },
    async ({ leadId, text, author }) => {
      const lead = store.leadById(leadId);
      if (!lead) return fail(`No lead with id ${leadId}.`);
      const who = author ?? "Office";
      const waited = hoursSince(lead.receivedAt);
      lead.thread.push({ at: new Date().toISOString(), author: who, text });
      if (!lead.firstResponseAt) lead.firstResponseAt = new Date().toISOString();
      lead.status = "replied";
      store.audit(who, "lead.replied", `${leadId} (${lead.name}) after ${waited}h: ${text}`);
      store.save();
      return ok(
        `Reply recorded for ${lead.name} (${leadId}). First response landed after ${waited}h of waiting; the lead is off the unanswered list and the thread is saved.`,
        { leadId, status: lead.status, waitedHours: waited },
      );
    },
  );

  server.tool(
    "create_shopping_list",
    "Create an approval-gated shopping list draft. Without a job: restock every low item up to its threshold. With a job id: cover that job's material shortfall. Nothing is purchased; the draft waits for the owner's approval.",
    { jobId: z.string().optional().describe("Optional job id to cover that job's materials") },
    async ({ jobId }) => {
      const items: { item: string; unit: string; qty: number; reason: string }[] = [];
      if (jobId) {
        const job = store.jobById(jobId);
        if (!job) return fail(`No job with id ${jobId}.`);
        for (const m of job.materialsNeeded) {
          const inv = store.data.inventory.find((i) => i.item === m.item);
          const onHand = inv?.onHand ?? 0;
          if (onHand < m.qty) {
            items.push({
              item: m.item,
              unit: inv?.unit ?? "unit",
              qty: m.qty - onHand,
              reason: `${job.customer} needs ${m.qty}, only ${onHand} on hand`,
            });
          }
        }
        if (!items.length) return ok(`No shortfall for ${job.customer}: stock covers everything that job needs. No list created.`);
      } else {
        for (const inv of store.data.inventory) {
          if (inv.onHand < inv.lowAt) {
            items.push({
              item: inv.item,
              unit: inv.unit,
              qty: inv.lowAt - inv.onHand,
              reason: `Restock to threshold ${inv.lowAt} (on hand ${inv.onHand})`,
            });
          }
        }
        if (!items.length) return ok("Nothing is below its low-stock threshold. No list created.");
      }
      const list = {
        id: store.nextId("shop", store.data.shoppingLists.map((s) => s.id)),
        createdAt: new Date().toISOString(),
        createdBy: "owner (via create_shopping_list)",
        status: "pending_approval" as const,
        items,
      };
      store.data.shoppingLists.push(list);
      store.audit("owner", "shopping_list.created", `Draft ${list.id} pending approval: ${items.map((i) => `${i.qty} x ${i.item}`).join(", ")}.`);
      store.save();
      return ok(
        `Shopping list ${list.id} created and PENDING APPROVAL (nothing purchased): ${items.map((i) => `${i.qty} ${i.unit} of ${i.item} (${i.reason})`).join("; ")}.`,
        { shoppingList: list },
      );
    },
  );

  server.tool(
    "run_morning_dispatch",
    "THE agentic flow: prepare tomorrow end to end. Detects gaps (unassigned crews, double-bookings, material shortfalls, leads past the response SLA), composes and queues a dispatch per crew plus an owner summary with ready-to-send lead replies, and drafts an approval-gated shopping list for shortfalls.",
    { date: z.string().optional().describe("Date to prepare (YYYY-MM-DD), default tomorrow") },
    async ({ date }) => {
      const summary = await runMorningDispatch(store, composer, date ?? tomorrow());
      const gapText = summary.gaps.length
        ? summary.gaps.map((g) => `- [${g.type}] ${g.detail}`).join("\n")
        : "No gaps found.";
      return ok(
        `Morning dispatch for ${summary.date} done. ${summary.headline}\nGaps:\n${gapText}`,
        { ...summary },
      );
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// HTTP plumbing: Streamable HTTP on /mcp, health + state on /
// ---------------------------------------------------------------------------

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  try {
    if (url.pathname === "/mcp" && req.method === "POST") {
      const body = await readBody(req);
      const mcp = createForemanServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }
    if (url.pathname === "/mcp") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed in stateless mode" }, id: null }));
      return;
    }
    if (url.pathname === "/" || url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          name: "foreman-mcp",
          status: "ok",
          mcpEndpoint: "/mcp",
          console: "/console",
          spec: "2025-11-25",
          composer: composer.name,
          store: {
            jobs: store.data.jobs.length,
            leads: store.data.leads.length,
            outbox: store.data.outbox.length,
            shoppingListsPending: store.data.shoppingLists.filter((s) => s.status === "pending_approval").length,
          },
        }),
      );
      return;
    }
    if (url.pathname === "/console") {
      const here = dirname(fileURLToPath(import.meta.url));
      const html = readFileSync(resolve(here, "..", "public", "console.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
      return;
    }
    if (url.pathname === "/state") {
      // Read-only view of the whole business state (what the ops console renders).
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(store.data, null, 2));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  } catch (err) {
    console.error("request error:", err);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

const port = Number(process.env.PORT ?? 3000);
httpServer.listen(port, () => {
  console.log(`foreman-mcp listening on http://localhost:${port}/mcp`);
});
