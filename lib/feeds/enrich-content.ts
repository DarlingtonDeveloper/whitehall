// ---------------------------------------------------------------------------
// Content enrichment — fetches full page content for feed items with thin
// or missing body text. This was the single biggest quality fix in the
// monitoring agent: GOV.UK items arrive with ~200 char snippets, but keyword
// scoring and LLM enrichment need the full document text to work properly.
//
// Runs after collection and before scoring/report generation.
// ---------------------------------------------------------------------------

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const THIN_CONTENT_THRESHOLD = 500;
const MAX_BODY_LENGTH = 10_000;
const FETCH_TIMEOUT = 10_000;
const BATCH_SIZE = 50;
const DELAY_MS = 300; // Be respectful to GOV.UK

function getSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY');
  }
  return createClient(url, key);
}

export async function enrichThinItems(client?: SupabaseClient, offset = 0): Promise<{ enriched: number; failed: number }> {
  const supabase = client ?? getSupabase();
  // Find items with thin or missing content
  // We can't use `.lt` on text length in PostgREST, so fetch a page of items
  // and filter client-side.
  const PAGE_SIZE = 1000;
  const { data: candidates, error } = await supabase
    .from('feed_items')
    .select('id, url, body, source_type')
    .not('url', 'is', null)
    .order('published_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error || !candidates?.length) return { enriched: 0, failed: 0 };

  const thinItems = candidates.filter(
    (item) => !item.body || item.body.length < THIN_CONTENT_THRESHOLD,
  );

  if (thinItems.length === 0) return { enriched: 0, failed: 0 };

  let enriched = 0;
  let failed = 0;

  for (const item of thinItems.slice(0, BATCH_SIZE)) {
    try {
      const fullContent = await fetchPageContent(item.url, item.source_type);
      if (fullContent && fullContent.length > (item.body?.length || 0)) {
        const { error: updateErr } = await supabase
          .from('feed_items')
          .update({ body: fullContent.slice(0, MAX_BODY_LENGTH) })
          .eq('id', item.id);

        if (!updateErr) enriched++;
        else failed++;
      }
    } catch {
      failed++;
    }

    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  return { enriched, failed };
}

async function fetchPageContent(
  url: string,
  sourceType: string,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'WhitehallBot/1.0 (WA Communications)' },
    });
    if (!response.ok) return null;

    const html = await response.text();
    return extractTextContent(html, sourceType);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extractTextContent(html: string, sourceType: string): string {
  // GOV.UK pages: main content is in <div class="govspeak"> or <main>
  if (sourceType === 'govuk') {
    const govspeakMatch = html.match(
      /<div[^>]*class="[^"]*govspeak[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/,
    );
    if (govspeakMatch) return stripHtml(govspeakMatch[1]);

    const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
    if (mainMatch) return stripHtml(mainMatch[1]);
  }

  // Hansard: debate content
  if (sourceType === 'hansard') {
    const debateMatch = html.match(
      /<div[^>]*class="[^"]*debate-item[^"]*"[^>]*>([\s\S]*?)<\/div>/,
    );
    if (debateMatch) return stripHtml(debateMatch[1]);
  }

  // Legislation: body content
  if (sourceType === 'legislation') {
    const bodyMatch = html.match(
      /<div[^>]*class="[^"]*LegSnippet[^"]*"[^>]*>([\s\S]*?)<\/div>/,
    );
    if (bodyMatch) return stripHtml(bodyMatch[1]);
  }

  // Generic fallback
  return stripHtml(html);
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
