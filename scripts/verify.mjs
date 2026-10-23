/**
 * Automated end-to-end check for Foreman MCP. This is the gate: it must
 * pass before anything is reported as working.
 *
 *   npm run build && node scripts/verify.mjs
 *
 * Boots the built server against a throwaway store, negotiates the
 * protocol, lists the tools, calls EVERY tool with assertions, kills the
 * server, boots it again on the same store, and re-verifies that the
 * mutations persisted (state between sessions, proven, not claimed).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpClient, bootServer, stopServer, toolText } from "./mcp-client.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3217;
const EXPECTED_TOOLS = [
  "get_day_briefing",
  "list_jobs",
  "get_job",
  "get_unanswered_leads",
  "check_inventory",
  "log_field_update",
  "assign_crew",
  "queue_dispatch",
  "record_lead_reply",
  "create_shopping_list",
  "run_morning_dispatch",
];

let failures = 0;
function check(label, cond, extra = "") {
  if (cond) {
    console.log(`  PASS ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label} ${extra}`);
  }
}

const dataDir = mkdtempSync(join(tmpdir(), "foreman-verify-"));
console.log(`store dir: ${dataDir}`);

let server;
try {
  // ------------------------------------------------------------ boot 1
  console.log("== boot 1 ==");
  server = await bootServer({ port: PORT, dataDir, cwd: projectRoot });
  const c = new McpClient(server.base);

  const init = await c.initialize();
  check("initialize negotiates 2025-11-25", init.protocolVersion === "2025-11-25", JSON.stringify(init));
  check("server identifies as foreman-mcp", init.serverInfo?.name === "foreman-mcp");

  const tools = await c.listTools();
  const names = tools.map((t) => t.name);
  for (const name of EXPECTED_TOOLS) check(`tools/list includes ${name}`, names.includes(name));
  check("tools/list has exactly the 11 expected tools", names.length === EXPECTED_TOOLS.length, names.join(","));

  // ------------------------------------------------------------ read-only tools
  console.log("== read-only tools ==");
  const jobs = await c.callTool("list_jobs");
  check("list_jobs shows seeded jobs", toolText(jobs).includes("job-102") && toolText(jobs).includes("Chen Duplex"));

  const job102 = await c.callTool("get_job", { jobId: "job-102" });
  check("get_job returns the job thread", toolText(job102).includes("No crew assigned yet"));

  const badJob = await c.callTool("get_job", { jobId: "job-999" });
  check("get_job on unknown id returns isError", badJob.isError === true);

  const briefing = await c.callTool("get_day_briefing");
  check("get_day_briefing composes a briefing", toolText(briefing).includes("Briefing for"));
  check("briefing flags tomorrow's unassigned job", toolText(briefing).includes("Chen Duplex"));

  const leads = await c.callTool("get_unanswered_leads");
  check("get_unanswered_leads lists stale leads", toolText(leads).includes("Maria Torres") && toolText(leads).includes("Sandra Ruiz"));
  check("unanswered leads exclude the replied one", !toolText(leads).includes("Tom Becker"));

  const low = await c.callTool("check_inventory", { onlyLow: true });
  check("check_inventory flags low thinset", toolText(low).includes("Thinset") && toolText(low).includes("[LOW"));

  // ------------------------------------------------------------ the agentic flow
  console.log("== run_morning_dispatch (before fixes) ==");
  const dispatch = await c.callTool("run_morning_dispatch");
  const sc = dispatch.structuredContent ?? {};
  const dtext = toolText(dispatch);
  check("dispatch returns a headline", typeof sc.headline === "string" && sc.headline.length > 0, dtext);
  check("dispatch finds the unassigned-crew gap", sc.gaps?.some((g) => g.type === "unassigned_crew" && g.jobId === "job-102"), dtext);
  check(
    "dispatch finds the thinset material shortfall",
    sc.gaps?.some((g) => g.type === "material_shortfall" && g.item.includes("Thinset")),
    dtext,
  );
  check(
    "dispatch finds unanswered-lead gaps",
    sc.gaps?.filter((g) => g.type === "unanswered_lead").length >= 3,
    dtext,
  );
  check("dispatch queues crew + owner messages", (sc.dispatchesQueued ?? 0) >= 3, dtext);
  check("dispatch drafts an approval-gated shopping list", typeof sc.shoppingListId === "string", dtext);
  check("dispatch composes lead nudges", (sc.leadNudges ?? 0) >= 3, dtext);

  // ------------------------------------------------------------ action tools
  console.log("== action tools ==");
  const assign = await c.callTool("assign_crew", { jobId: "job-102", crewId: "crew-b" });
  check("assign_crew assigns Crew B (plumbing) to Chen", toolText(assign).includes("Crew B") && toolText(assign).includes("Chen Duplex"));

  const badAssign = await c.callTool("assign_crew", { jobId: "job-102", crewId: "crew-z" });
  check("assign_crew rejects an unknown crew", badAssign.isError === true);

  const update = await c.callTool("log_field_update", {
    jobId: "job-101",
    author: "Juan Herrera (Crew A)",
    text: "VERIFY-MARKER: tile layout approved by homeowner, starting cuts at 8am.",
    newStage: "Tile in progress (layout approved)",
  });
  check("log_field_update records the update", toolText(update).includes("VERIFY-MARKER"));

  const queued = await c.callTool("queue_dispatch", { to: "Crew A", message: "VERIFY-MARKER dispatch: bring the sample board." });
  check("queue_dispatch grows the outbox", (queued.structuredContent?.outboxSize ?? 0) >= 4, JSON.stringify(queued.structuredContent));

  const reply = await c.callTool("record_lead_reply", { leadId: "lead-1", text: "Sent the kitchen ballpark and offered Thursday for the on-site estimate." });
  check("record_lead_reply closes the follow-up clock", toolText(reply).includes("Maria Torres"));
  const leadsAfter = await c.callTool("get_unanswered_leads");
  check("replied lead leaves the unanswered list", !toolText(leadsAfter).includes("Maria Torres"));

  const shop = await c.callTool("create_shopping_list", {});
  check("create_shopping_list drafts a pending-approval restock", toolText(shop).includes("PENDING APPROVAL") && toolText(shop).includes("Thinset"));

  const health1 = await (await fetch(`${server.base}/health`)).json();
  check("health reports outbox + pending lists", health1.store.outbox >= 4 && health1.store.shoppingListsPending >= 2, JSON.stringify(health1));

  const consoleRes = await fetch(`${server.base}/console`);
  const consoleHtml = await consoleRes.text();
  check(
    "ops console serves the live business console",
    consoleRes.ok && consoleHtml.includes("Foreman MCP") && consoleHtml.includes("Voice command simulator") && consoleHtml.includes("Approve purchase"),
    `HTTP ${consoleRes.status}`,
  );

  // The human gate, exercised the way the console exercises it: approve the
  // restock draft created above and watch the state change.
  console.log("== console approval (click -> state) ==");
  const shopId = shop.structuredContent?.shoppingList?.id;
  const approveRes = await fetch(`${server.base}/console/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ listId: shopId, decision: "approved" }),
  });
  const approveJson = await approveRes.json();
  check("console approve accepts the owner decision", approveRes.ok && approveJson.shoppingList?.status === "approved", JSON.stringify(approveJson));
  const state1 = await (await fetch(`${server.base}/state`)).json();
  check(
    "approval is reflected in /state",
    state1.shoppingLists.find((s) => s.id === shopId)?.status === "approved",
    JSON.stringify(state1.shoppingLists?.map((s) => [s.id, s.status])),
  );

  await stopServer(server.proc);
  server = undefined;

  // ------------------------------------------------------------ boot 2: persistence
  console.log("== boot 2 (same store: state must have survived) ==");
  server = await bootServer({ port: PORT, dataDir, cwd: projectRoot });
  const c2 = new McpClient(server.base);
  await c2.initialize();

  const job102After = await c2.callTool("get_job", { jobId: "job-102" });
  check("crew assignment persisted across restart", toolText(job102After).includes("Crew: Crew B"), toolText(job102After));

  const job101After = await c2.callTool("get_job", { jobId: "job-101" });
  check("field update persisted across restart", toolText(job101After).includes("VERIFY-MARKER"), toolText(job101After));
  check("stage change persisted across restart", toolText(job101After).includes("layout approved"));

  const leadsBoot2 = await c2.callTool("get_unanswered_leads");
  check("lead reply persisted across restart", !toolText(leadsBoot2).includes("Maria Torres"));

  const health2 = await (await fetch(`${server.base}/health`)).json();
  check("outbox persisted across restart", health2.store.outbox >= 4, JSON.stringify(health2));
  check("shopping drafts persisted across restart", health2.store.shoppingListsPending >= 1, JSON.stringify(health2));
  const state2 = await (await fetch(`${server.base}/state`)).json();
  check(
    "owner approval persisted across restart",
    state2.shoppingLists.some((s) => s.status === "approved"),
    JSON.stringify(state2.shoppingLists?.map((s) => [s.id, s.status])),
  );

  const dispatch2 = await c2.callTool("run_morning_dispatch");
  const sc2 = dispatch2.structuredContent ?? {};
  check(
    "second dispatch no longer flags job-102 unassigned",
    !sc2.gaps?.some((g) => g.type === "unassigned_crew" && g.jobId === "job-102"),
    JSON.stringify(sc2.gaps),
  );

  await stopServer(server.proc);
  server = undefined;
} finally {
  if (server) await stopServer(server.proc);
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nVERIFY: ALL CHECKS PASSED" : `\nVERIFY: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
