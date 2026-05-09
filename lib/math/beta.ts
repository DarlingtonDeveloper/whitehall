import type { Posterior, Radar } from '@/types/politician';

// -- Constants ---------------------------------------------------------------

export const CONFIDENCE_K = 5;

export const PROPAGATION_DAMPENING = 0.2;

export const RADAR_HALF_LIVES: Record<Radar, number> = {
  policy: 3.0,
  ideology: 7.0,
  faction: 1.5,
  behaviour: 5.0,
  career: 4.0,
  network: 2.0,
};

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// -- Core Beta distribution --------------------------------------------------

/**
 * Derive posterior summary from Beta(alpha, beta) state.
 * Spec §2: mean, variance, effective sample size, confidence (k=5), 95% CI.
 */
export function posterior(alpha: number, beta: number): Posterior {
  const n = alpha + beta;
  if (n === 0) {
    return { mean: 0.5, variance: 0, effective_sample_size: 0, confidence: 0, ci_95: [0, 1] };
  }
  const mean = alpha / n;
  const variance = (alpha * beta) / (n * n * (n + 1));
  const ess = Math.max(0, n - 2);
  const confidence = ess / (ess + CONFIDENCE_K);
  return {
    mean,
    variance,
    effective_sample_size: ess,
    confidence,
    ci_95: betaCI(alpha, beta, 0.95),
  };
}

/**
 * Confidence interval for Beta(alpha, beta) via normal approximation.
 * Uses inverse normal CDF (Beasley-Springer-Moro) to approximate quantiles.
 */
export function betaCI(
  alpha: number,
  beta: number,
  level: number,
): [number, number] {
  const n = alpha + beta;
  const mean = alpha / n;
  const std = Math.sqrt((alpha * beta) / (n * n * (n + 1)));

  if (std < 1e-12) return [mean, mean];

  const tail = (1 - level) / 2;
  const zLo = inverseNormalCDF(tail);
  const zHi = inverseNormalCDF(1 - tail);

  return [
    Math.max(0, Math.min(1, mean + zLo * std)),
    Math.max(0, Math.min(1, mean + zHi * std)),
  ];
}

// -- Bayesian update ---------------------------------------------------------

/**
 * Apply a single classification update to Beta state.
 * Spec §1: alpha += anchor * weight, beta += (1-anchor) * weight.
 */
export function applyUpdate(
  alpha: number,
  beta: number,
  anchor: number,
  effectiveWeight: number,
): { alpha: number; beta: number } {
  return {
    alpha: alpha + anchor * effectiveWeight,
    beta: beta + (1 - anchor) * effectiveWeight,
  };
}

// -- Time decay --------------------------------------------------------------

/**
 * Exponential decay factor for evidence age.
 * Spec §3: Math.exp(-ageYears / halfLife).
 */
export function decayFactor(
  occurredAt: Date,
  asOf: Date,
  halfLifeYears: number,
): number {
  const ageYears = (asOf.getTime() - occurredAt.getTime()) / YEAR_MS;
  if (ageYears <= 0) return 1.0;
  return Math.exp(-ageYears / halfLifeYears);
}

/**
 * Convert days to milliseconds (used in epoch dampening).
 */
export function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / DAY_MS;
}

// -- Inverse normal CDF (Beasley-Springer-Moro) -----------------------------

/**
 * Rational approximation to the inverse standard normal CDF.
 * Accurate to ~1e-8 for p in (0, 1).
 */
function inverseNormalCDF(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;

  // Coefficients for the rational approximation (central region)
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
    -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0,
    3.754408661907416e0,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  let q: number, r: number;

  if (p < pLow) {
    // Lower tail
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  } else if (p <= pHigh) {
    // Central region
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  } else {
    // Upper tail
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
}
