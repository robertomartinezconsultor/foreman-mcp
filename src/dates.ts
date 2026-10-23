/**
 * Small date helpers. All "business day" logic uses local time and ISO
 * calendar dates (YYYY-MM-DD) so scheduled jobs compare cleanly as strings.
 */

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function today(now = new Date()): string {
  return isoDate(now);
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

export function tomorrow(now = new Date()): string {
  return addDays(isoDate(now), 1);
}

/** Whole hours between an ISO timestamp and now (min 0). */
export function hoursSince(isoTs: string, now = new Date()): number {
  const then = new Date(isoTs).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((now.getTime() - then) / 3_600_000));
}

/** ISO timestamp `hours` before `now` (used by the seed so the demo never rots). */
export function hoursAgo(hours: number, now = new Date()): string {
  return new Date(now.getTime() - hours * 3_600_000).toISOString();
}
