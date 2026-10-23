/**
 * Text composition for briefings and dispatch messages.
 *
 * Two implementations behind one interface:
 *  - DeterministicComposer: template-based, zero dependencies, always works.
 *    This is the fallback and the default.
 *  - BedrockComposer: Amazon Bedrock (Converse API) natural-language polish.
 *    Active only when FOREMAN_COMPOSER=bedrock AND AWS credentials are in the
 *    environment; any failure falls back to the deterministic text, so the
 *    server never depends on AWS to answer. This is the layer the
 *    AWS Builder mini documents; Strands orchestration (Oct 19) will call
 *    the same interface.
 */
import type { Crew, Job, Lead } from "./store.js";

export interface BriefingFacts {
  dateLabel: string;
  jobsToday: number;
  unassignedTomorrow: string[];
  staleLeads: string[];
  lowStock: string[];
  outboxQueued: number;
}

export interface TextComposer {
  readonly name: string;
  composeBriefing(facts: BriefingFacts): Promise<string>;
  composeCrewDispatch(crew: Crew, dateLabel: string, jobs: Job[], warnings: string[]): Promise<string>;
  composeLeadNudge(lead: Lead, hoursWaiting: number): Promise<string>;
}

export class DeterministicComposer implements TextComposer {
  readonly name = "deterministic";

  async composeBriefing(f: BriefingFacts): Promise<string> {
    const lines = [`Briefing for ${f.dateLabel}: ${f.jobsToday} job(s) on the schedule today.`];
    if (f.unassignedTomorrow.length) {
      lines.push(
        `Needs attention tomorrow: ${f.unassignedTomorrow.join("; ")} has no crew assigned.`,
      );
    } else {
      lines.push("Every job scheduled tomorrow has a crew.");
    }
    if (f.staleLeads.length) {
      lines.push(`Unanswered leads past the response SLA: ${f.staleLeads.join("; ")}.`);
    } else {
      lines.push("No leads past the response SLA.");
    }
    if (f.lowStock.length) {
      lines.push(`Low stock: ${f.lowStock.join("; ")}.`);
    }
    lines.push(
      f.outboxQueued ? `${f.outboxQueued} dispatch message(s) sitting in the outbox.` : "Outbox is empty.",
    );
    return lines.join("\n");
  }

  async composeCrewDispatch(
    crew: Crew,
    dateLabel: string,
    jobs: Job[],
    warnings: string[],
  ): Promise<string> {
    const stops = jobs
      .map(
        (j) =>
          `${j.scheduledTime} ${j.customer}, ${j.address} (${j.service}: ${j.stage}; ~${j.estimatedHours}h)`,
      )
      .join(" | ");
    const warn = warnings.length ? ` Heads-up: ${warnings.join("; ")}.` : "";
    return `${crew.name} dispatch for ${dateLabel}: ${stops}.${warn} Reply with field updates as you go.`;
  }

  async composeLeadNudge(lead: Lead, hoursWaiting: number): Promise<string> {
    return (
      `Hi ${lead.name.split(" ")[0]}, thanks for reaching out about ${lead.topic.toLowerCase()}. ` +
      `Sorry for the wait (${hoursWaiting}h). We can come out for a free on-site estimate this week; ` +
      `what day works for you? - First Class Remodeling`
    );
  }
}

/**
 * Bedrock-backed composer. Lazily imports the AWS SDK so the package is only
 * exercised when the flag is on. On ANY error it returns the deterministic
 * text: AWS is an enhancement, never a dependency.
 */
export class BedrockComposer implements TextComposer {
  readonly name = "bedrock";
  private fallback = new DeterministicComposer();
  private modelId = process.env.FOREMAN_BEDROCK_MODEL ?? "amazon.nova-lite-v1:0";

  private async polish(draft: string, instruction: string): Promise<string> {
    try {
      const { BedrockRuntimeClient, ConverseCommand } = await import(
        "@aws-sdk/client-bedrock-runtime"
      );
      const client = new BedrockRuntimeClient({});
      const out = await client.send(
        new ConverseCommand({
          modelId: this.modelId,
          messages: [
            {
              role: "user",
              content: [
                {
                  text:
                    `${instruction} Keep every fact, name, time and number exactly as given. ` +
                    `One or two short spoken-style sentences.\n\nDRAFT:\n${draft}`,
                },
              ],
            },
          ],
          inferenceConfig: { maxTokens: 300, temperature: 0.3 },
        }),
      );
      const text = out.output?.message?.content?.find((c) => "text" in c)?.text;
      return text?.trim() ? text.trim() : draft;
    } catch {
      return draft;
    }
  }

  async composeBriefing(f: BriefingFacts): Promise<string> {
    const draft = await this.fallback.composeBriefing(f);
    return this.polish(draft, "Rewrite this business owner's morning briefing so it sounds natural read aloud by a voice assistant.");
  }

  async composeCrewDispatch(
    crew: Crew,
    dateLabel: string,
    jobs: Job[],
    warnings: string[],
  ): Promise<string> {
    const draft = await this.fallback.composeCrewDispatch(crew, dateLabel, jobs, warnings);
    return this.polish(draft, "Rewrite this crew dispatch message so it is clear and friendly for a field worker reading it on a phone.");
  }

  async composeLeadNudge(lead: Lead, hoursWaiting: number): Promise<string> {
    const draft = await this.fallback.composeLeadNudge(lead, hoursWaiting);
    return this.polish(draft, "Rewrite this follow-up message to a sales lead so it sounds warm and professional.");
  }
}

export function createComposer(): TextComposer {
  const want = (process.env.FOREMAN_COMPOSER ?? "deterministic").toLowerCase();
  const hasCreds = Boolean(
    process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE || process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI,
  );
  if (want === "bedrock" && hasCreds) {
    console.log("composer: bedrock (flag on, credentials present; deterministic fallback armed)");
    return new BedrockComposer();
  }
  if (want === "bedrock" && !hasCreds) {
    console.log("composer: deterministic (bedrock requested but no AWS credentials in env)");
  } else {
    console.log("composer: deterministic");
  }
  return new DeterministicComposer();
}
