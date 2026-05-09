/**
 * Extract organisation names from register_of_interests evidence rows
 * and populate parsed.related_org. Then report top unmatched orgs.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── Extraction patterns ─────────────────────────────────────────────────

/** Structured donor format: "Name of donor: Org Name\r\n..." */
function extractDonorName(raw: string): string | null {
  const m = raw.match(/Name of donor:\s*(.+?)(?:\r?\n|$)/);
  if (!m) return null;
  return m[1].trim();
}

/** Employment/role format: "Role, Org Name (description)" or "Payer: Org Name ..." */
function extractEmploymentOrg(raw: string): string | null {
  // "Payer: Org Name (description), Address" — MP employment format
  const payerMatch = raw.match(/Payer:\s*(.+?)(?:\s*\(|,\s*\d)/);
  if (payerMatch) return payerMatch[1].trim();

  // "Role, Org Name (description)" — Lords/general format
  // Match: "Director, Company Ltd (desc)" or "Advisor on X to Company (desc)"
  const roleMatch = raw.match(/(?:Director|Chairman|Managing Director|Board member|Advisor|Consultant|Chair|Member|President|Vice President|Partner|Secretary|Trustee|Governor|Commissioner|Non-executive director)(?:\s+(?:of|on|to|for|at))?\s*[^,]*?,\s*(.+?)(?:\s*\(|$)/i);
  if (roleMatch) return roleMatch[1].trim();

  return null;
}

/** Shareholding format: "Company Name (description)" or just "Company Name" */
function extractShareholdingOrg(raw: string): string | null {
  // "Company Name (description)" or "Company Name plc (description)"
  const m = raw.match(/^(.+?)(?:\s*\(|$)/);
  if (m) {
    const name = m[1].trim();
    // Only return if it looks like an org name (has substance)
    if (name.length >= 2 && name.length <= 120) return name;
  }
  return null;
}

/** Sponsorship format: various — try to extract org from description */
function extractSponsorOrg(raw: string): string | null {
  // "... paid for by Org Name" or "funded by Org Name"
  const fundedBy = raw.match(/(?:paid for by|funded by|support from)\s+(.+?)(?:\s*\(|,|\.|$)/i);
  if (fundedBy) return fundedBy[1].trim();

  // "Donation received from Org Name"
  const donationFrom = raw.match(/(?:donation received from|support from)\s+(.+?)(?:\s*\(|,|\s+for\b|$)/i);
  if (donationFrom) return donationFrom[1].trim();

  return null;
}

// Category → extraction strategy
const DONOR_CATEGORIES = new Set([
  '2. (a) Support linked to an MP but received by a local party organisation or indirectly via a central party organisation',
  '2. (b) Any other support not included in Category 2(a)',
  '3. Gifts, benefits and hospitality from UK sources',
  '4. Visits outside the UK',
  '5. Gifts and benefits from sources outside the UK',
  'Category 5: Overseas visits',
  'Category 6: Gifts, benefits and hospitality',
]);

const EMPLOYMENT_CATEGORIES = new Set([
  'Category 1: Remunerated employment etc.',
  '1. Employment and earnings',
]);

const SHAREHOLDING_CATEGORIES = new Set([
  'Category 2: Shareholdings etc. (a)',
  'Category 2: Shareholdings etc. (b)',
  'Category 2: Shareholdings etc. (c)',
  'Category 2: Shareholdings etc. (d)',
  '7. (i) Shareholdings: over 15% of issued share capital',
  '7. (ii) Other shareholdings, valued at more than £70,000',
]);

const SPONSORSHIP_CATEGORIES = new Set([
  'Category 4: Sponsorship',
]);

function extractOrg(raw: string, category: string): string | null {
  if (DONOR_CATEGORIES.has(category)) return extractDonorName(raw);
  if (EMPLOYMENT_CATEGORIES.has(category)) return extractEmploymentOrg(raw);
  if (SHAREHOLDING_CATEGORIES.has(category)) return extractShareholdingOrg(raw);
  if (SPONSORSHIP_CATEGORIES.has(category)) return extractSponsorOrg(raw);

  // Miscellaneous / other — try donor first, then employment
  return extractDonorName(raw) ?? extractEmploymentOrg(raw) ?? null;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  // Fetch all register_of_interests rows
  let allRows: Array<{ id: number; parsed: any; raw_content: string }> = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await sb
      .from('politician_evidence')
      .select('id, parsed, raw_content')
      .eq('evidence_type', 'register_of_interests')
      .is('parsed->>related_org', null)
      .range(offset, offset + PAGE - 1);

    if (error) { console.error(error); break; }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  console.log(`Fetched ${allRows.length} rows with null related_org`);

  // Extract orgs
  let extracted = 0;
  let failed = 0;
  const updates: Array<{ id: number; org: string }> = [];

  for (const row of allRows) {
    const raw = row.raw_content || '';
    const category = row.parsed?.category || '';
    const org = extractOrg(raw, category);

    if (org) {
      updates.push({ id: row.id, org });
      extracted++;
    } else {
      failed++;
    }
  }

  console.log(`Extracted: ${extracted}, No org found: ${failed}`);

  // Update in batches
  const BATCH = 50;
  let updated = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    const promises = batch.map(({ id, org }) =>
      sb.rpc('jsonb_set_related_org', { row_id: id, org_name: org })
        .then(({ error }: any): any => {
          if (error) {
            return sb
              .from('politician_evidence')
              .update({ parsed: { ...allRows.find(r => r.id === id)!.parsed, related_org: org } })
              .eq('id', id);
          }
          return { error: null };
        })
    );

    // Just do direct updates since we may not have the RPC
    for (const { id, org } of batch) {
      const row = allRows.find(r => r.id === id)!;
      const newParsed = { ...row.parsed, related_org: org };
      const { error } = await sb
        .from('politician_evidence')
        .update({ parsed: newParsed })
        .eq('id', id);
      if (error) {
        console.error(`Failed to update ${id}:`, error.message);
      } else {
        updated++;
      }
    }

    if ((i + BATCH) % 500 === 0 || i + BATCH >= updates.length) {
      console.log(`Updated ${updated}/${updates.length} rows...`);
    }
  }

  console.log(`\nDone. Updated ${updated} rows with related_org.`);

  // Report top orgs and match rate against org_indicator_map
  const { data: mappings } = await sb.from('org_indicator_map').select('org_name, org_aliases');

  const allOrgNames = new Set<string>();
  const allAliases = new Set<string>();
  mappings?.forEach(m => {
    allOrgNames.add(m.org_name);
    m.org_aliases?.forEach((a: string) => allAliases.add(a));
  });

  const orgCounts: Record<string, number> = {};
  updates.forEach(({ org }) => {
    const norm = org.trim().toLowerCase();
    orgCounts[norm] = (orgCounts[norm] || 0) + 1;
  });

  const sorted = Object.entries(orgCounts).sort((a, b) => b[1] - a[1]);

  let matched = 0, unmatched = 0;
  const unmatchedOrgs: Array<[string, number]> = [];

  for (const [org, count] of sorted) {
    if (allOrgNames.has(org) || allAliases.has(org)) {
      matched += count;
    } else {
      unmatched += count;
      unmatchedOrgs.push([org, count]);
    }
  }

  console.log(`\nMatch rate: ${matched} matched, ${unmatched} unmatched`);
  console.log(`\nTop 50 unmatched orgs:`);
  unmatchedOrgs.slice(0, 50).forEach(([org, count]) => console.log(`  ${count}\t${org}`));
}

main().catch(console.error);
