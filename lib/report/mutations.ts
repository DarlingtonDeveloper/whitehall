// ---------------------------------------------------------------------------
// Report mutation engine — applies tool mutations to the AnalysisJSON.
//
// Each apply* function returns a new (cloned) AnalysisJSON plus a
// ReportMutation record for the audit trail. Mutations are pure transforms;
// persistence is handled separately by saveReportContent.
//
// Supported mutations:
//   - edit_field:   change a single text field on an item
//   - remove_item:  delete an item and renumber the section
//   - move_item:    relocate an item between sections
//   - add_item:     insert a new item into a section
// ---------------------------------------------------------------------------

import { supabase } from '@/lib/db';
import type { AnalysisJSON, AnalysedItem, ThemeSection } from '@/lib/export/types';
import type { ReportMutation } from '@/types/report';

/**
 * Find an AnalysedItem by ref across all sections.
 * Returns the item, its containing section key, and index within that section's items array.
 */
function findItemByRef(
  sections: Record<string, ThemeSection>,
  ref: string,
): { item: AnalysedItem; sectionId: string; index: number } | null {
  for (const [sectionId, section] of Object.entries(sections)) {
    const items = section.items || [];
    const idx = items.findIndex(item => item.ref === ref);
    if (idx !== -1) return { item: items[idx], sectionId, index: idx };

    const sigItems = section.significant_items || [];
    const sigIdx = sigItems.findIndex(item => item.ref === ref);
    if (sigIdx !== -1) return { item: sigItems[sigIdx], sectionId, index: sigIdx };
  }
  return null;
}

/**
 * Renumber items in a section sequentially (e.g. 2.1, 2.2, 2.3).
 */
function renumberSection(
  items: AnalysedItem[],
  sectionNumber: number,
): void {
  items.forEach((item, i) => {
    item.ref = `${sectionNumber}.${i + 1}`;
  });
}

/**
 * Get the section number from a ref string like "2.1" -> 2
 */
function getSectionNumber(sections: Record<string, ThemeSection>, sectionId: string): number {
  const keys = Object.keys(sections);
  return keys.indexOf(sectionId) + 1;
}

export function applyEditField(
  content: AnalysisJSON,
  ref: string,
  field: string,
  newValue: string,
): { content: AnalysisJSON; mutation: ReportMutation } {
  const clone = structuredClone(content);
  const found = findItemByRef(clone.sections, ref);
  if (!found) throw new Error(`Item "${ref}" not found`);

  const oldValue = String((found.item as unknown as Record<string, unknown>)[field] ?? '');
  (found.item as unknown as Record<string, unknown>)[field] = newValue;

  return {
    content: clone,
    mutation: {
      type: 'edit_field',
      section_id: found.sectionId,
      item_ref: ref,
      field,
      old_value: oldValue,
      new_value: newValue,
    },
  };
}

export function applyRemoveItem(
  content: AnalysisJSON,
  ref: string,
): { content: AnalysisJSON; mutation: ReportMutation } {
  const clone = structuredClone(content);
  const found = findItemByRef(clone.sections, ref);
  if (!found) throw new Error(`Item "${ref}" not found`);

  const section = clone.sections[found.sectionId];
  section.items = (section.items || []).filter(item => item.ref !== ref);
  const sectionNum = getSectionNumber(clone.sections, found.sectionId);
  renumberSection(section.items, sectionNum);

  return {
    content: clone,
    mutation: {
      type: 'remove_item',
      section_id: found.sectionId,
      item_ref: ref,
      old_value: JSON.stringify(found.item),
    },
  };
}

export function applyMoveItem(
  content: AnalysisJSON,
  ref: string,
  targetSectionId: string,
): { content: AnalysisJSON; mutation: ReportMutation } {
  const clone = structuredClone(content);
  const found = findItemByRef(clone.sections, ref);
  if (!found) throw new Error(`Item "${ref}" not found`);
  if (!clone.sections[targetSectionId]) throw new Error(`Section "${targetSectionId}" not found`);

  // Remove from source
  const sourceSection = clone.sections[found.sectionId];
  sourceSection.items = (sourceSection.items || []).filter(item => item.ref !== ref);
  const sourceSectionNum = getSectionNumber(clone.sections, found.sectionId);
  renumberSection(sourceSection.items, sourceSectionNum);

  // Add to target
  const targetSection = clone.sections[targetSectionId];
  if (!targetSection.items) targetSection.items = [];
  targetSection.items.push(found.item);
  const targetSectionNum = getSectionNumber(clone.sections, targetSectionId);
  renumberSection(targetSection.items, targetSectionNum);

  return {
    content: clone,
    mutation: {
      type: 'move_item',
      section_id: found.sectionId,
      item_ref: ref,
      new_value: targetSectionId,
    },
  };
}

export function applyAddItem(
  content: AnalysisJSON,
  sectionId: string,
  item: AnalysedItem,
): { content: AnalysisJSON; mutation: ReportMutation } {
  const clone = structuredClone(content);
  if (!clone.sections[sectionId]) throw new Error(`Section "${sectionId}" not found`);

  const section = clone.sections[sectionId];
  if (!section.items) section.items = [];
  section.items.push(item);
  const sectionNum = getSectionNumber(clone.sections, sectionId);
  renumberSection(section.items, sectionNum);

  return {
    content: clone,
    mutation: {
      type: 'add_item',
      section_id: sectionId,
      item_ref: item.ref,
      new_value: JSON.stringify(item),
    },
  };
}

/**
 * Persist updated content to Supabase, saving a revision snapshot first.
 */
export async function saveReportContent(
  reportId: string,
  content: AnalysisJSON,
  opts?: {
    editSource?: 'chat_mutation' | 'manual_patch';
    mutation?: ReportMutation;
    chatMessageId?: string;
  },
): Promise<void> {
  // Fetch current sections to snapshot before overwriting
  const { data: current } = await supabase
    .from('report_drafts')
    .select('sections')
    .eq('id', reportId)
    .single();

  if (current?.sections) {
    await supabase.from('report_revisions').insert({
      report_draft_id: reportId,
      sections_snapshot: current.sections,
      edit_source: opts?.editSource ?? 'chat_mutation',
      mutation_summary: opts?.mutation ? [opts.mutation] : null,
      chat_message_id: opts?.chatMessageId ?? null,
    });
  }

  const { error } = await supabase
    .from('report_drafts')
    .update({
      sections: content,
      updated_at: new Date().toISOString(),
    })
    .eq('id', reportId);

  if (error) throw new Error(`Failed to save report: ${error.message}`);
}
