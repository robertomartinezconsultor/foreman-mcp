/**
 * Persistent store for Foreman MCP.
 *
 * State lives in a single JSON file on disk and survives restarts: this is
 * the "state between sessions" the Alexa+ guide calls creative. Every
 * mutation is written through atomically (temp file + rename), so a crash
 * mid-write can never corrupt the store. The store directory is
 * FOREMAN_DATA_DIR if set, otherwise <project>/data.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSeed } from "./seed.js";

export type Crew = {
  id: string;
  name: string;
  members: string[];
  skills: string[];
  phone: string;
};

export type JobNote = { at: string; author: string; text: string };

export type Job = {
  id: string;
  customer: string;
  address: string;
  service: string;
  stage: string;
  status: "active" | "done" | "on_hold";
  crewId: string | null;
  scheduledDate: string; // YYYY-MM-DD
  scheduledTime: string; // HH:MM
  estimatedHours: number;
  materialsNeeded: { item: string; qty: number }[];
  notes: JobNote[];
};

export type Lead = {
  id: string;
  name: string;
  channel: string;
  phone: string;
  topic: string;
  status: "new" | "replied" | "closed";
  receivedAt: string;
  firstResponseAt: string | null;
  thread: JobNote[];
};

export type InventoryItem = {
  id: string;
  item: string;
  unit: string;
  onHand: number;
  lowAt: number;
  location: string;
};

export type OutboxEntry = {
  id: string;
  to: string;
  channel: "crew" | "owner";
  message: string;
  queuedAt: string;
  status: "queued";
  relatedJobId?: string;
};

export type ShoppingList = {
  id: string;
  createdAt: string;
  createdBy: string;
  status: "pending_approval" | "approved" | "rejected";
  items: { item: string; unit: string; qty: number; reason: string }[];
};

export type AuditEntry = { at: string; actor: string; action: string; detail: string };

export type StoreData = {
  version: number;
  createdAt: string;
  crews: Crew[];
  jobs: Job[];
  leads: Lead[];
  inventory: InventoryItem[];
  outbox: OutboxEntry[];
  shoppingLists: ShoppingList[];
  audit: AuditEntry[];
};

export function dataDir(): string {
  if (process.env.FOREMAN_DATA_DIR) return resolve(process.env.FOREMAN_DATA_DIR);
  // dist/store.js -> ../data ; src/store.ts (tsx) -> ../data as well.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "data");
}

export class Store {
  readonly file: string;
  data: StoreData;

  constructor(dir = dataDir()) {
    mkdirSync(dir, { recursive: true });
    this.file = resolve(dir, "store.json");
    if (existsSync(this.file)) {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as StoreData;
      if (parsed.version !== 1) throw new Error(`unsupported store version ${parsed.version}`);
      this.data = parsed;
    } else {
      this.data = buildSeed();
      this.save();
    }
  }

  /** Atomic write-through: tmp file + rename. */
  save(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
    renameSync(tmp, this.file);
  }

  audit(actor: string, action: string, detail: string): void {
    this.data.audit.push({ at: new Date().toISOString(), actor, action, detail });
  }

  crewById(id: string | null): Crew | undefined {
    return this.data.crews.find((c) => c.id === id);
  }

  crewName(id: string | null): string {
    return id ? (this.crewById(id)?.name ?? id) : "UNASSIGNED";
  }

  jobById(id: string): Job | undefined {
    return this.data.jobs.find((j) => j.id === id);
  }

  leadById(id: string): Lead | undefined {
    return this.data.leads.find((l) => l.id === id);
  }

  nextId(prefix: string, existing: string[]): string {
    let n = existing.length + 1;
    while (existing.includes(`${prefix}-${n}`)) n += 1;
    return `${prefix}-${n}`;
  }
}
