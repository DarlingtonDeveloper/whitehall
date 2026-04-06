// ---------------------------------------------------------------------------
// Source verification — HEAD requests against item URLs before report
// generation. Broken links, redirects to error pages, and 404s are flagged
// or excluded so the final DOCX never contains dead links.
//
// The monitoring agent's source_verifier.py ran this check on every item.
// ---------------------------------------------------------------------------

const VERIFY_TIMEOUT = 5_000;
const DELAY_MS = 200;

export interface VerificationResult {
  id: string;
  url: string;
  status: number | null;
  ok: boolean;
  redirected: boolean;
  finalUrl?: string;
}

export async function verifySourceUrls(
  items: Array<{ id: string; url: string | null }>,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  const withUrls = items.filter((i): i is { id: string; url: string } => !!i.url);

  for (const item of withUrls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT);

      const response = await fetch(item.url, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'WhitehallBot/1.0 (WA Communications)' },
      });

      clearTimeout(timeout);

      results.push({
        id: item.id,
        url: item.url,
        status: response.status,
        ok: response.ok,
        redirected: response.redirected,
        finalUrl: response.redirected ? response.url : undefined,
      });
    } catch {
      results.push({
        id: item.id,
        url: item.url,
        status: null,
        ok: false,
        redirected: false,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  return results;
}

/**
 * Partition items into valid (URL ok or no URL) and broken (4xx/5xx/timeout).
 * Redirected URLs are considered valid — GOV.UK commonly redirects.
 */
export function filterVerifiedItems<T extends { id: string; url?: string | null }>(
  items: T[],
  verifications: VerificationResult[],
): { valid: T[]; broken: T[] } {
  const verificationMap = new Map(verifications.map((v) => [v.id, v]));

  const valid: T[] = [];
  const broken: T[] = [];

  for (const item of items) {
    if (!item.url) {
      valid.push(item);
      continue;
    }

    const v = verificationMap.get(item.id);
    if (!v || v.ok) {
      valid.push(item);
    } else {
      broken.push(item);
    }
  }

  return { valid, broken };
}
