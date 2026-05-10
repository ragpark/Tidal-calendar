export function parseDateRange(input?: string): { start: Date; end: Date } {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (!input || input === 'today') return { start: today, end: today };
  if (input === 'tomorrow') {
    const t = new Date(today); t.setUTCDate(t.getUTCDate() + 1); return { start: t, end: t };
  }
  if (input === 'this weekend') {
    const day = today.getUTCDay();
    const satOffset = (6 - day + 7) % 7;
    const sat = new Date(today); sat.setUTCDate(sat.getUTCDate() + satOffset);
    const sun = new Date(sat); sun.setUTCDate(sun.getUTCDate() + 1);
    return { start: sat, end: sun };
  }
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return { start: today, end: today };
  return { start: d, end: d };
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
