export type BlogOrderIdentity = { order: number; id: string };

/** Saved position first, then stable record id; matches the database tie-break. */
export function compareBlogOrder(a: BlogOrderIdentity, b: BlogOrderIdentity): number {
  return a.order - b.order || a.id.localeCompare(b.id);
}

export function sortBlogItems<T>(
  items: readonly T[],
  identity: (item: T) => BlogOrderIdentity,
): T[] {
  return [...items].sort((a, b) => compareBlogOrder(identity(a), identity(b)));
}

/** Move an item by one slot and return a compact, one-based display order. */
export function moveBlogItem<T>(items: readonly T[], index: number, delta: -1 | 1): T[] {
  const next = [...items];
  const target = index + delta;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function compactBlogOrder<T>(items: readonly T[]): Array<T & { sort: number }> {
  return items.map((item, index) => ({ ...item, sort: index + 1 }));
}
