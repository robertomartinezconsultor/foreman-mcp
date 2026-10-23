/**
 * Evidence capture: runs a scripted demo against a fresh store and writes
 * the full request/response transcripts to docs/evidence/. Two boots: the
 * second boot runs against the same on-disk store to prove, in writing,
 * that state survives restarts.
 *
 *   npm run build && node scripts/evidence.mjs
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpClient, bootServer, stopServer, toolText } from "./mcp-client.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(projectRoot, "docs", "evidence");
mkdirSync(outDir, { recursive: true });
const PORT = 3218;
const dataDir = mkdtempSync(join(tmpdir(), "foreman-evidence-"));

function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function save(name, title, request, result) {
  const body = [
    `# ${title}`,
    ``,
    `## Request (JSON-RPC over Streamable HTTP, POST /mcp)`,
    "```json",
    JSON.stringify(request, null, 2),
    "```",
    ``,
    `## Response: tool text`,
    toolText(result) || "(empty)",
    ``,
    `## Response: structuredContent`,
    "```json",
    JSON.stringify(result.structuredContent ?? null, null, 2),
    "```",
    result.isError ? `\nisError: true` : "",
  ].join("\n");
  writeFileSync(join(outDir, name), body, "utf8");
  console.log(`wrote docs/evidence/${name}`);
}

let server;
try {
  server = await bootServer({ port: PORT, dataDir, cwd: projectRoot });
  const c = new McpClient(server.base);

  const init = await c.initialize();
  const tools = await c.listTools();
  writeFileSync(
    join(outDir, "00-initialize-and-tools-list.txt"),
    [
      "# initialize + tools/list",
      "",
      "Negotiated result:",
      "```json",
      JSON.stringify(init, null, 2),
      "```",
      "",
      `Tools (${tools.length}):`,
      ...tools.map((t) => `- ${t.name}: ${t.description}`),
    ].join("\n"),
    "utf8",
  );
  console.log("wrote docs/evidence/00-initialize-and-tools-list.txt");

  const call = async (file, title, name, args) => {
    const result = await c.callTool(name, args);
    save(file, title, { method: "tools/call", params: { name, arguments: args } }, result);
    return result;
  };

  await call("01-get_day_briefing.txt", "get_day_briefing", "get_day_briefing", {});
  await call("02-list_jobs.txt", "list_jobs (tomorrow)", "list_jobs", { date: tomorrowStr() });
  await call("03-get_job.txt", "get_job job-102 (the unassigned one)", "get_job", { jobId: "job-102" });
  await call("04-get_unanswered_leads.txt", "get_unanswered_leads", "get_unanswered_leads", {});
  await call("05-check_inventory.txt", "check_inventory (onlyLow)", "check_inventory", { onlyLow: true });
  await call("06-run_morning_dispatch.txt", "run_morning_dispatch (the agentic flow)", "run_morning_dispatch", {});
  await call("07-assign_crew.txt", "assign_crew job-102 -> crew-b", "assign_crew", { jobId: "job-102", crewId: "crew-b" });
  await call("08-log_field_update.txt", "log_field_update on job-101", "log_field_update", {
    jobId: "job-101",
    author: "Juan Herrera (Crew A)",
    text: "Tile layout approved by the homeowner; starting cuts at 8am sharp.",
    newStage: "Tile in progress (layout approved)",
  });
  await call("09-record_lead_reply.txt", "record_lead_reply lead-3 (52h wait)", "record_lead_reply", {
    leadId: "lead-3",
    text: "Apologized for the wait and booked the on-site bathroom estimate for Friday 10am.",
  });
  await call("10-queue_dispatch.txt", "queue_dispatch to Crew B", "queue_dispatch", {
    to: "Crew B",
    message: "You are on the Chen Duplex rough-in tomorrow 09:30. Permit is approved; PEX and fittings are at the shop, rack 4.",
  });
  await call("11-create_shopping_list.txt", "create_shopping_list (restock low items)", "create_shopping_list", {});

  await stopServer(server.proc);
  server = undefined;

  // ---------------------------------------------------------- boot 2
  server = await bootServer({ port: PORT, dataDir, cwd: projectRoot });
  const c2 = new McpClient(server.base);
  await c2.initialize();
  const job102 = await c2.callTool("get_job", { jobId: "job-102" });
  const job101 = await c2.callTool("get_job", { jobId: "job-101" });
  const leads = await c2.callTool("get_unanswered_leads");
  const storeOnDisk = readFileSync(join(dataDir, "store.json"), "utf8");
  writeFileSync(
    join(outDir, "12-persistence-after-restart.txt"),
    [
      "# Persistence proof: server killed and rebooted on the same store",
      "",
      "After boot 2, with NO re-seeding:",
      "",
      "## get_job job-102: crew assignment from boot 1 is still there",
      toolText(job102),
      "",
      "## get_job job-101: field update + stage change from boot 1 are still there",
      toolText(job101),
      "",
      "## get_unanswered_leads: lead-3 (replied in boot 1) is gone from the list",
      toolText(leads),
      "",
      "## The store file itself (data/store.json in the store dir)",
      "```json",
      storeOnDisk,
      "```",
    ].join("\n"),
    "utf8",
  );
  console.log("wrote docs/evidence/12-persistence-after-restart.txt");

  await stopServer(server.proc);
  server = undefined;
} finally {
  if (server) await stopServer(server.proc);
  rmSync(dataDir, { recursive: true, force: true });
}
console.log("evidence capture complete");
