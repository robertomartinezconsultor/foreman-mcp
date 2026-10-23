/**
 * run_morning_dispatch: the agentic centerpiece.
 *
 * Given the persisted state, the flow prepares tomorrow end to end:
 *   1. PLAN      collect tomorrow's scheduled jobs, crews, leads, inventory.
 *   2. DETECT    gaps: jobs with no crew, crews double-booked at the same
 *                time, material shortfalls against stock on hand, and leads
 *                waiting past the first-response SLA.
 *   3. COMPOSE   one dispatch message per crew (via the TextComposer:
 *                Bedrock when enabled, deterministic otherwise), plus a
 *                suggested follow-up reply for every stale lead.
 *   4. ACT       enqueue the dispatches in the outbox, draft an
 *                approval-gated shopping list when materials fall short,
 *                and write every step to the audit log.
 *   5. SUMMARIZE return a structured summary the owner (or Alexa+) can read.
 *
 * The steps are named, pure-ish functions sequenced by `runMorningDispatch`;
 * the Oct 19 milestone swaps this sequencer for a Strands Agents SDK loop
 * calling the same steps as agent tools, without changing their behavior.
 */
import type { TextComposer } from "./compose.js";
import { hoursSince, tomorrow } from "./dates.js";
import type { Job, Store } from "./store.js";

/** First-response SLA for new leads, in hours. Past this, a lead is a gap. */
export const LEAD_SLA_HOURS = 4;

export type Gap =
  | { type: "unassigned_crew"; jobId: string; detail: string }
  | { type: "crew_conflict"; jobId: string; detail: string }
  | { type: "material_shortfall"; jobId: string; detail: string; item: string; need: number; onHand: number }
  | { type: "unanswered_lead"; leadId: string; detail: string };

export interface DispatchSummary {
  date: string;
  jobsScheduled: number;
  crewsDispatched: string[];
  dispatchesQueued: number;
  leadNudges: number;
  gaps: Gap[];
  shoppingListId: string | null;
  headline: string;
}

// --- Step 1: PLAN -----------------------------------------------------------

export function planTomorrow(store: Store, date: string) {
  const jobs = store.data.jobs
    .filter((j) => j.scheduledDate === date && j.status === "active")
    .sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
  const staleLeads = store.data.leads.filter(
    (l) => l.status === "new" && hoursSince(l.receivedAt) >= LEAD_SLA_HOURS,
  );
  return { jobs, staleLeads };
}

// --- Step 2: DETECT ---------------------------------------------------------

export function detectGaps(store: Store, jobs: Job[], staleLeadCount: number): Gap[] {
  const gaps: Gap[] = [];

  for (const job of jobs) {
    if (!job.crewId) {
      gaps.push({
        type: "unassigned_crew",
        jobId: job.id,
        detail: `${job.customer} (${job.service}) at ${job.scheduledTime} has no crew assigned`,
      });
    }
  }

  // Same crew, same start time, two jobs: a conflict a human would miss.
  const byCrewTime = new Map<string, Job[]>();
  for (const job of jobs) {
    if (!job.crewId) continue;
    const key = `${job.crewId}@${job.scheduledTime}`;
    byCrewTime.set(key, [...(byCrewTime.get(key) ?? []), job]);
  }
  for (const [key, group] of byCrewTime) {
    if (group.length > 1) {
      for (const job of group) {
        gaps.push({
          type: "crew_conflict",
          jobId: job.id,
          detail: `${store.crewName(job.crewId)} is double-booked at ${key.split("@")[1]} (${group.map((g) => g.customer).join(" vs ")})`,
        });
      }
    }
  }

  // Material needs aggregated across ALL jobs that day vs stock on hand.
  const need = new Map<string, { qty: number; jobs: Job[] }>();
  for (const job of jobs) {
    for (const m of job.materialsNeeded) {
      const cur = need.get(m.item) ?? { qty: 0, jobs: [] };
      cur.qty += m.qty;
      cur.jobs.push(job);
      need.set(m.item, cur);
    }
  }
  for (const [item, { qty, jobs: needJobs }] of need) {
    const inv = store.data.inventory.find((i) => i.item === item);
    const onHand = inv?.onHand ?? 0;
    if (onHand < qty) {
      for (const job of needJobs) {
        gaps.push({
          type: "material_shortfall",
          jobId: job.id,
          detail: `${item}: need ${qty} across tomorrow's jobs, only ${onHand} on hand`,
          item,
          need: qty,
          onHand,
        });
      }
    }
  }

  if (staleLeadCount > 0) {
    for (const lead of store.data.leads) {
      if (lead.status === "new" && hoursSince(lead.receivedAt) >= LEAD_SLA_HOURS) {
        const h = hoursSince(lead.receivedAt);
        gaps.push({
          type: "unanswered_lead",
          leadId: lead.id,
          detail: `${lead.name} (${lead.topic}) has waited ${h}h with no first reply`,
        });
      }
    }
  }

  return gaps;
}

// --- Steps 3-5: COMPOSE + ACT + SUMMARIZE -----------------------------------

export async function runMorningDispatch(
  store: Store,
  composer: TextComposer,
  date: string = tomorrow(),
): Promise<DispatchSummary> {
  const { jobs, staleLeads } = planTomorrow(store, date);
  const gaps = detectGaps(store, jobs, staleLeads.length);

  const warningsByJob = new Map<string, string[]>();
  for (const g of gaps) {
    if ("jobId" in g) {
      warningsByJob.set(g.jobId, [...(warningsByJob.get(g.jobId) ?? []), g.detail]);
    }
  }

  // One dispatch per crew that has work tomorrow.
  const crewsDispatched: string[] = [];
  let queued = 0;
  const byCrew = new Map<string, Job[]>();
  for (const job of jobs) {
    if (job.crewId) byCrew.set(job.crewId, [...(byCrew.get(job.crewId) ?? []), job]);
  }
  for (const [crewId, crewJobs] of byCrew) {
    const crew = store.crewById(crewId);
    if (!crew) continue;
    const warnings = crewJobs.flatMap((j) => warningsByJob.get(j.id) ?? []);
    const message = await composer.composeCrewDispatch(crew, date, crewJobs, warnings);
    store.data.outbox.push({
      id: store.nextId("out", store.data.outbox.map((o) => o.id)),
      to: `${crew.name} (${crew.members.join(", ")})`,
      channel: "crew",
      message,
      queuedAt: new Date().toISOString(),
      status: "queued",
      relatedJobId: crewJobs[0]?.id,
    });
    crewsDispatched.push(crew.name);
    queued += 1;
    store.audit("run_morning_dispatch", "dispatch.queued", `Dispatch for ${crew.name} on ${date}: ${crewJobs.length} stop(s).`);
  }

  // Owner dispatch: the gap report + ready-to-send lead follow-ups.
  let leadNudges = 0;
  if (gaps.length || staleLeads.length) {
    const parts: string[] = [`Morning dispatch for ${date}: ${jobs.length} job(s) scheduled.`];
    const ownerGaps = gaps.filter((g) => g.type !== "unanswered_lead");
    if (ownerGaps.length) parts.push(`Gaps to fix: ${ownerGaps.map((g) => g.detail).join("; ")}.`);
    if (staleLeads.length) {
      parts.push(`${staleLeads.length} lead(s) past the ${LEAD_SLA_HOURS}h response SLA. Suggested replies:`);
      for (const lead of staleLeads) {
        const nudge = await composer.composeLeadNudge(lead, hoursSince(lead.receivedAt));
        parts.push(`- To ${lead.name} (${lead.topic}): "${nudge}"`);
        leadNudges += 1;
      }
    }
    store.data.outbox.push({
      id: store.nextId("out", store.data.outbox.map((o) => o.id)),
      to: "Owner",
      channel: "owner",
      message: parts.join("\n"),
      queuedAt: new Date().toISOString(),
      status: "queued",
    });
    queued += 1;
    store.audit("run_morning_dispatch", "dispatch.owner_summary", `Owner summary queued: ${gaps.length} gap(s), ${leadNudges} lead nudge(s).`);
  }

  // Approval-gated shopping draft for material shortfalls.
  let shoppingListId: string | null = null;
  const shortfalls = new Map<string, { need: number; onHand: number }>();
  for (const g of gaps) {
    if (g.type === "material_shortfall") shortfalls.set(g.item, { need: g.need, onHand: g.onHand });
  }
  if (shortfalls.size) {
    const items = [...shortfalls.entries()].map(([item, s]) => {
      const inv = store.data.inventory.find((i) => i.item === item);
      return {
        item,
        unit: inv?.unit ?? "unit",
        qty: s.need - s.onHand,
        reason: `Shortfall for ${date}: need ${s.need}, on hand ${s.onHand}`,
      };
    });
    shoppingListId = store.nextId("shop", store.data.shoppingLists.map((s) => s.id));
    store.data.shoppingLists.push({
      id: shoppingListId,
      createdAt: new Date().toISOString(),
      createdBy: "run_morning_dispatch",
      status: "pending_approval",
      items,
    });
    store.audit("run_morning_dispatch", "shopping_list.created", `Draft ${shoppingListId} pending approval: ${items.map((i) => `${i.qty} x ${i.item}`).join(", ")}.`);
  }

  store.save();

  const headline =
    `${jobs.length} job(s) tomorrow, ${crewsDispatched.length} crew dispatch(es) queued, ` +
    `${gaps.length} gap(s) found` +
    (shoppingListId ? `, shopping draft ${shoppingListId} awaiting approval` : "") +
    ".";

  return {
    date,
    jobsScheduled: jobs.length,
    crewsDispatched,
    dispatchesQueued: queued,
    leadNudges,
    gaps,
    shoppingListId,
    headline,
  };
}
