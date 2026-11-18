export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/** Non-negative fractional days between an ISO timestamp and `asOf`. Null when unreadable. */
export function ageInDays(iso: string, asOf: Date): number | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, (asOf.getTime() - ms) / MS_PER_DAY);
}

export function hoursBefore(instant: Date, hours: number): string {
  return new Date(instant.getTime() - hours * MS_PER_HOUR).toISOString();
}

export function hoursAfter(instant: Date, hours: number): string {
  return new Date(instant.getTime() + hours * MS_PER_HOUR).toISOString();
}
