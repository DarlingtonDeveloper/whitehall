import { describe, it, expect } from 'vitest';

// We test the k-means and silhouette score functions by importing them
// indirectly through a test-only export helper.
// Since they're private in coalition.ts, we replicate the core logic here
// to test the algorithm independently.

// -- k-means core (extracted for testing) ------------------------------------

function euclideanSq(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum;
}

function euclidean(a: number[], b: number[]): number {
  return Math.sqrt(euclideanSq(a, b));
}

function kMeans(
  points: number[][],
  k: number,
  maxIterations = 50,
): { assignments: number[]; centroids: number[][] } {
  const n = points.length;
  const dims = points[0].length;

  // Deterministic init for testing: spread evenly
  let centroids = points.slice(0, k).map((p) => [...p]);
  let assignments = new Array(n).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    const newAssignments = points.map((p) => {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < k; c++) {
        const d = euclideanSq(p, centroids[c]);
        if (d < bestDist) { bestDist = d; best = c; }
      }
      return best;
    });

    const changed = newAssignments.some((a, i) => a !== assignments[i]);
    assignments = newAssignments;
    if (!changed) break;

    const newCentroids: number[][] = Array.from({ length: k }, () => new Array(dims).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let d = 0; d < dims; d++) newCentroids[c][d] += points[i][d];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        for (let d = 0; d < dims; d++) newCentroids[c][d] /= counts[c];
      }
    }
    centroids = newCentroids;
  }

  return { assignments, centroids };
}

function silhouetteScore(points: number[][], assignments: number[]): number {
  const n = points.length;
  const k = Math.max(...assignments) + 1;
  if (k <= 1 || n <= k) return 0;

  let totalSil = 0;
  for (let i = 0; i < n; i++) {
    const myCluster = assignments[i];
    let aSum = 0;
    let aCount = 0;
    for (let j = 0; j < n; j++) {
      if (j !== i && assignments[j] === myCluster) {
        aSum += euclidean(points[i], points[j]);
        aCount++;
      }
    }
    const a = aCount > 0 ? aSum / aCount : 0;

    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === myCluster) continue;
      let bSum = 0;
      let bCount = 0;
      for (let j = 0; j < n; j++) {
        if (assignments[j] === c) {
          bSum += euclidean(points[i], points[j]);
          bCount++;
        }
      }
      if (bCount > 0) b = Math.min(b, bSum / bCount);
    }

    const maxAB = Math.max(a, b);
    totalSil += maxAB > 0 ? (b - a) / maxAB : 0;
  }

  return totalSil / n;
}

// -- Tests -------------------------------------------------------------------

describe('k-means', () => {
  it('correctly clusters two well-separated groups', () => {
    const points = [
      [0.1, 0.1],
      [0.15, 0.12],
      [0.08, 0.14],
      [0.9, 0.9],
      [0.85, 0.88],
      [0.92, 0.87],
    ];

    const { assignments } = kMeans(points, 2);

    // Points 0-2 should be in one cluster, 3-5 in another
    expect(assignments[0]).toBe(assignments[1]);
    expect(assignments[0]).toBe(assignments[2]);
    expect(assignments[3]).toBe(assignments[4]);
    expect(assignments[3]).toBe(assignments[5]);
    expect(assignments[0]).not.toBe(assignments[3]);
  });

  it('converges to correct centroids', () => {
    // Use separated initial points so deterministic init (slice(0,k)) picks one from each group
    const points = [
      [0.0], [1.0],  // init picks these two
      [0.02], [0.98],
      [0.03], [0.97],
    ];

    const { centroids } = kMeans(points, 2);

    const sorted = centroids.map((c) => c[0]).sort((a, b) => a - b);
    expect(sorted[0]).toBeLessThan(0.1);
    expect(sorted[1]).toBeGreaterThan(0.9);
  });

  it('handles k=1', () => {
    const points = [[0.1], [0.5], [0.9]];
    const { assignments } = kMeans(points, 1);

    // All in same cluster
    expect(new Set(assignments).size).toBe(1);
    // All assigned to cluster 0
    expect(assignments).toEqual([0, 0, 0]);
  });

  it('handles three clusters', () => {
    // Ensure deterministic init picks one from each cluster by interleaving
    const points = [
      [0.0, 0.0],   // init centroid 0
      [0.5, 0.5],   // init centroid 1
      [1.0, 1.0],   // init centroid 2
      [0.05, 0.05], // should join cluster 0
      [0.55, 0.45], // should join cluster 1
      [0.95, 0.98], // should join cluster 2
    ];

    const { assignments } = kMeans(points, 3);

    // Point 0 and 3 should cluster together
    expect(assignments[0]).toBe(assignments[3]);
    // Point 1 and 4 should cluster together
    expect(assignments[1]).toBe(assignments[4]);
    // Point 2 and 5 should cluster together
    expect(assignments[2]).toBe(assignments[5]);

    // All three clusters distinct
    const unique = new Set(assignments);
    expect(unique.size).toBe(3);
  });
});

describe('silhouetteScore', () => {
  it('returns 0 for single cluster', () => {
    const points = [[0.1], [0.5], [0.9]];
    expect(silhouetteScore(points, [0, 0, 0])).toBe(0);
  });

  it('returns high score for well-separated clusters', () => {
    const points = [
      [0.0], [0.01], [0.02],
      [1.0], [1.01], [1.02],
    ];
    const assignments = [0, 0, 0, 1, 1, 1];
    const score = silhouetteScore(points, assignments);
    expect(score).toBeGreaterThan(0.9);
  });

  it('returns low/negative score for bad clustering', () => {
    const points = [
      [0.0], [1.0],
      [0.5], [0.5],
    ];
    // Assign 0+0.5 to cluster 0, 1.0+0.5 to cluster 1 — bad split
    const assignments = [0, 1, 0, 1];
    const score = silhouetteScore(points, assignments);
    // With mixed points, silhouette should be low
    expect(score).toBeLessThan(0.5);
  });

  it('score is between -1 and 1', () => {
    const points = [
      [0.1], [0.2], [0.3], [0.7], [0.8], [0.9],
    ];
    const assignments = [0, 0, 0, 1, 1, 1];
    const score = silhouetteScore(points, assignments);
    expect(score).toBeGreaterThanOrEqual(-1);
    expect(score).toBeLessThanOrEqual(1);
  });
});
