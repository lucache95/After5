// Title → URL-safe slug + 6-char id suffix for uniqueness.
// e.g. ("Pastries, the Lake, and Slow Coffee", "cfa2906f-...") →
//      "pastries-the-lake-and-slow-coffee-cfa290"

export function slugify(title: string, id: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip accents
    .replace(/[^a-z0-9]+/g, '-')       // non-alphanumeric → hyphen
    .replace(/^-+|-+$/g, '')           // trim hyphens
    .slice(0, 60);                      // keep it readable
  const tail = id.replace(/-/g, '').slice(0, 6);
  return base ? `${base}-${tail}` : tail;
}
