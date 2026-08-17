import { haversineMiles, type LatLng } from "./workspace-store";

/** Anything closer than this is treated as "the same real-world area" for
 * day-grouping purposes — a threshold, not a precise definition. */
const CLUSTER_RADIUS_MILES = 9;

/**
 * Greedy union-find grouping of points by real distance: any two points
 * within `CLUSTER_RADIUS_MILES` of each other join a cluster, and clusters
 * chain transitively (A-B close, B-C close => A, B, C one cluster even if A-C
 * alone would exceed the threshold).
 *
 * Deliberately simple — this hands the AI planner a measured fact ("these are
 * confirmed close together") instead of asking it to infer proximity from
 * coordinates in a text prompt, which is what let real-world clusters (e.g.
 * four Merrillville, IN venues within 5 minutes of each other) land on
 * different days despite the model being shown their coordinates.
 */
export function clusterByDistance<T extends { id: string; coords: LatLng | null }>(
  points: T[],
): Map<string, number> {
  const located = points.filter((p) => p.coords);
  const parent = new Map<string, string>(located.map((p) => [p.id, p.id]));

  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = id;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (let i = 0; i < located.length; i++) {
    for (let j = i + 1; j < located.length; j++) {
      if (haversineMiles(located[i].coords!, located[j].coords!) <= CLUSTER_RADIUS_MILES) {
        union(located[i].id, located[j].id);
      }
    }
  }

  // Stable, human-readable cluster numbers rather than raw root ids, ordered
  // by first appearance so the same input always labels the same way.
  const clusterNumber = new Map<string, number>();
  const idToCluster = new Map<string, number>();
  for (const p of located) {
    const root = find(p.id);
    if (!clusterNumber.has(root)) clusterNumber.set(root, clusterNumber.size + 1);
    idToCluster.set(p.id, clusterNumber.get(root)!);
  }
  return idToCluster;
}
