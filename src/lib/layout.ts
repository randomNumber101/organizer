/** Überlappende Termine nebeneinander anordnen (klassischer Kalender-Algorithmus) */
export interface Placed<T> {
  item: T
  start: number // Minuten ab Tagesbeginn
  end: number
  col: number
  cols: number
}

export function layoutDay<T>(items: { item: T; start: number; end: number }[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  const out: Placed<T>[] = []
  let cluster: Placed<T>[] = []
  let clusterEnd = -1
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((p) => p.col + 1))
    for (const p of cluster) p.cols = cols
    out.push(...cluster)
    cluster = []
  }
  for (const it of sorted) {
    const end = Math.max(it.end, it.start + 15)
    if (cluster.length && it.start >= clusterEnd) flush()
    const used = new Set(cluster.filter((p) => p.end > it.start).map((p) => p.col))
    let col = 0
    while (used.has(col)) col++
    cluster.push({ item: it.item, start: it.start, end, col, cols: 1 })
    clusterEnd = Math.max(clusterEnd, end)
  }
  if (cluster.length) flush()
  return out
}
