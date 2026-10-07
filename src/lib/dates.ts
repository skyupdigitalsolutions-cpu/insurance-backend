const IST_OFFSET_MS = 5.5 * 3_600_000;

export const todayInIndia = (plusDays = 0): string => {
  const d = new Date(Date.now() + IST_OFFSET_MS + plusDays * 86_400_000);
  return d.toISOString().slice(0, 10);
};

export const formatDate = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const indianDateOf = (d: Date): string => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

export const startOfIndianDay = (date: string): Date => new Date(`${date}T00:00:00+05:30`);
