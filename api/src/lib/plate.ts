// api/src/lib/plate.ts
// Normalizes standard-shaped plates (2 letters + 3-4 digits + 2 letters)
// to TOWNDIGITS-SUFFIX. Non-standard plates (diplomatic, foreign,
// custom/vanity) are legitimate and left untouched apart from trimming.
export function normalizePlate(raw: string): string {
  const stripped = raw.trim().toUpperCase().replace(/[\s-]/g, '');
  const match = stripped.match(/^([A-Z]{2})(\d{3,4})([A-Z]{2})$/);
  if (match) return `${match[1]}${match[2]}-${match[3]}`;
  return raw.trim();
}
