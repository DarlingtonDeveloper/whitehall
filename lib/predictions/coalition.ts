import { getServiceClient } from '@/lib/db';
import { posterior } from '@/lib/math/beta';
import type { CoalitionInput, CoalitionResult, Cluster, ClusterMember, DefiningIndicator } from './types';

/**
 * Map coalitions of politicians within a policy area using k-means clustering
 * on their indicator posteriors.
 */
export async function mapCoalitions(input: CoalitionInput): Promise<CoalitionResult> {
  const predictionId = crypto.randomUUID();
  const db = getServiceClient();

  // 1. Fetch indicators for this policy area
  const { data: indicators } = await db
    .from('indicator_definitions')
    .select('id, label_low, label_high')
    .eq('policy_area', input.policy_area);

  if (!indicators || indicators.length === 0) {
    return { prediction_id: predictionId, policy_area: input.policy_area, k: 0, silhouette_score: 0, clusters: [] };
  }

  // Use indicator IDs as-is — they already include .revealed/.public suffixes
  const allIndicatorIds = indicators.map((i) => i.id as string);

  // 2. Fetch politicians matching filter
  let polQuery = db
    .from('politicians')
    .select('id, display_name, party')
    .eq('status', input.politician_filter?.status ?? 'active');

  if (input.politician_filter?.party) {
    polQuery = polQuery.eq('party', input.politician_filter.party);
  }
  if (input.politician_filter?.house) {
    polQuery = polQuery.eq('house', input.politician_filter.house);
  }

  const { data: politicians } = await polQuery;
  if (!politicians || politicians.length < 2) {
    return { prediction_id: predictionId, policy_area: input.policy_area, k: 0, silhouette_score: 0, clusters: [] };
  }

  const polMap = new Map(politicians.map((p) => [p.id as string, p]));

  // 3. Bulk-read from materialized view
  // Filter by indicators only — politician filter applied in step 4 via polMap
  const { data: decayed } = await db
    .from('politician_indicators_decayed')
    .select('politician_id, indicator_id, alpha_decayed, beta_decayed, evidence_count')
    .in('indicator_id', allIndicatorIds);

  if (!decayed || decayed.length === 0) {
    return { prediction_id: predictionId, policy_area: input.policy_area, k: 0, silhouette_score: 0, clusters: [] };
  }

  // 4. Build feature vectors
  // Group: politician -> indicator -> posterior mean
  const vectors = new Map<string, Map<string, number>>();
  for (const row of decayed) {
    const pid = row.politician_id as string;
    const indId = row.indicator_id as string;
    if (!vectors.has(pid)) vectors.set(pid, new Map());
    const p = posterior(Number(row.alpha_decayed), Number(row.beta_decayed));
    vectors.get(pid)!.set(indId, p.mean);
  }

  // Use all indicator IDs that appear in the data as feature dimensions
  const featureDims = [...new Set(decayed.map((r) => r.indicator_id as string))];

  // Filter: politicians with at least 1 indicator with data
  const validPols: Array<{ id: string; vector: number[] }> = [];
  for (const [pid, indMap] of vectors) {
    if (indMap.size < 1) continue;
    if (!polMap.has(pid)) continue;
    const vec = featureDims.map((dim) => indMap.get(dim) ?? 0.5); // default to 0.5 (uninformative)
    validPols.push({ id: pid, vector: vec });
  }

  if (validPols.length < 2) {
    return { prediction_id: predictionId, policy_area: input.policy_area, k: 0, silhouette_score: 0, clusters: [] };
  }

  const points = validPols.map((p) => p.vector);

  // 5. Run k-means — auto-k if not specified
  let bestK = input.k ?? 0;
  let bestAssignments: number[] = [];
  let bestCentroids: number[][] = [];
  let bestSilhouette = -1;

  if (bestK > 0) {
    const result = kMeans(points, bestK);
    bestAssignments = result.assignments;
    bestCentroids = result.centroids;
    bestSilhouette = silhouetteScore(points, bestAssignments);
  } else {
    const maxK = Math.min(7, Math.floor(validPols.length / 2));
    for (let k = 2; k <= maxK; k++) {
      const result = kMeans(points, k);
      const score = silhouetteScore(points, result.assignments);
      if (score > bestSilhouette) {
        bestSilhouette = score;
        bestK = k;
        bestAssignments = result.assignments;
        bestCentroids = result.centroids;
      }
    }
  }

  if (bestK === 0) {
    return { prediction_id: predictionId, policy_area: input.policy_area, k: 0, silhouette_score: 0, clusters: [] };
  }

  // 6. Build indicator label map
  // IDs already include .revealed/.public suffixes — use as-is
  const labelMap = new Map<string, { label_low: string; label_high: string }>();
  for (const ind of indicators) {
    const id = ind.id as string;
    labelMap.set(id, { label_low: ind.label_low as string, label_high: ind.label_high as string });
  }

  // 7. Build clusters
  const clusters: Cluster[] = [];

  for (let c = 0; c < bestK; c++) {
    const memberIndices = bestAssignments
      .map((a, i) => (a === c ? i : -1))
      .filter((i) => i >= 0);

    const members: ClusterMember[] = memberIndices.map((idx) => {
      const pol = polMap.get(validPols[idx].id);
      return {
        politician_id: validPols[idx].id,
        politician_name: (pol?.display_name as string) ?? '',
        party: (pol?.party as string) ?? null,
        distance_to_centroid: round(euclidean(points[idx], bestCentroids[c])),
      };
    }).sort((a, b) => a.distance_to_centroid - b.distance_to_centroid);

    // Centroid as named map
    const centroid: Record<string, number> = {};
    for (let d = 0; d < featureDims.length; d++) {
      centroid[featureDims[d]] = round(bestCentroids[c][d]);
    }

    // Defining indicators: where this cluster's mean differs most from others
    const defining = findDefiningIndicators(c, bestCentroids, featureDims, labelMap);

    clusters.push({ id: c, centroid, members, defining_indicators: defining });
  }

  return {
    prediction_id: predictionId,
    policy_area: input.policy_area,
    k: bestK,
    silhouette_score: round(bestSilhouette),
    clusters,
  };
}

// -- k-means (Lloyd's algorithm with k-means++ init) -------------------------

function kMeans(
  points: number[][],
  k: number,
  maxIterations = 50,
): { assignments: number[]; centroids: number[][] } {
  const n = points.length;
  const dims = points[0].length;

  // k-means++ initialization
  let centroids = kMeansPlusPlus(points, k);
  let assignments = new Array(n).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    // Assign each point to nearest centroid
    const newAssignments = points.map((p) => {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < k; c++) {
        const d = euclideanSq(p, centroids[c]);
        if (d < bestDist) { bestDist = d; best = c; }
      }
      return best;
    });

    // Check convergence
    const changed = newAssignments.some((a, i) => a !== assignments[i]);
    assignments = newAssignments;
    if (!changed) break;

    // Recompute centroids
    const newCentroids: number[][] = Array.from({ length: k }, () => new Array(dims).fill(0));
    const counts = new Array(k).fill(0);

    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let d = 0; d < dims; d++) {
        newCentroids[c][d] += points[i][d];
      }
    }

    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        for (let d = 0; d < dims; d++) {
          newCentroids[c][d] /= counts[c];
        }
      } else {
        // Empty cluster: reinitialize to a random point
        newCentroids[c] = [...points[Math.floor(Math.random() * n)]];
      }
    }

    centroids = newCentroids;
  }

  return { assignments, centroids };
}

function kMeansPlusPlus(points: number[][], k: number): number[][] {
  const n = points.length;
  const centroids: number[][] = [];

  // First centroid: random
  centroids.push([...points[Math.floor(Math.random() * n)]]);

  for (let c = 1; c < k; c++) {
    // Compute D(x)^2 for each point
    const dists = points.map((p) => {
      let minDist = Infinity;
      for (const cent of centroids) {
        minDist = Math.min(minDist, euclideanSq(p, cent));
      }
      return minDist;
    });

    const totalDist = dists.reduce((a, b) => a + b, 0);
    if (totalDist === 0) {
      centroids.push([...points[Math.floor(Math.random() * n)]]);
      continue;
    }

    // Weighted random selection
    let r = Math.random() * totalDist;
    for (let i = 0; i < n; i++) {
      r -= dists[i];
      if (r <= 0) {
        centroids.push([...points[i]]);
        break;
      }
    }

    // Fallback if rounding issues
    if (centroids.length <= c) {
      centroids.push([...points[n - 1]]);
    }
  }

  return centroids;
}

// -- Silhouette score ---------------------------------------------------------

function silhouetteScore(points: number[][], assignments: number[]): number {
  const n = points.length;
  const k = Math.max(...assignments) + 1;
  if (k <= 1 || n <= k) return 0;

  let totalSil = 0;

  for (let i = 0; i < n; i++) {
    const myCluster = assignments[i];

    // a(i) = mean distance to same-cluster points
    let aSum = 0;
    let aCount = 0;
    for (let j = 0; j < n; j++) {
      if (j !== i && assignments[j] === myCluster) {
        aSum += euclidean(points[i], points[j]);
        aCount++;
      }
    }
    const a = aCount > 0 ? aSum / aCount : 0;

    // b(i) = min mean distance to any other cluster
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

// -- Cluster labelling --------------------------------------------------------

function findDefiningIndicators(
  clusterId: number,
  centroids: number[][],
  featureDims: string[],
  labelMap: Map<string, { label_low: string; label_high: string }>,
): DefiningIndicator[] {
  const k = centroids.length;
  const dims = featureDims.length;
  const defining: DefiningIndicator[] = [];

  for (let d = 0; d < dims; d++) {
    const myMean = centroids[clusterId][d];
    let otherSum = 0;
    let otherCount = 0;
    for (let c = 0; c < k; c++) {
      if (c === clusterId) continue;
      otherSum += centroids[c][d];
      otherCount++;
    }
    const otherMean = otherCount > 0 ? otherSum / otherCount : 0.5;
    const diff = Math.abs(myMean - otherMean);

    const labels = labelMap.get(featureDims[d]);
    defining.push({
      indicator_id: featureDims[d],
      label_low: labels?.label_low ?? '',
      label_high: labels?.label_high ?? '',
      cluster_mean: round(myMean),
      other_clusters_mean: round(otherMean),
    });
  }

  // Sort by largest difference
  defining.sort((a, b) =>
    Math.abs(b.cluster_mean - b.other_clusters_mean) -
    Math.abs(a.cluster_mean - a.other_clusters_mean),
  );

  return defining.slice(0, 5);
}

// -- Math helpers -------------------------------------------------------------

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

function round(v: number, decimals = 4): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}
