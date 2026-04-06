// ---------------------------------------------------------------------------
// Diff computation between original and edited AnalysisJSON for the feedback
// loop. Compares items by fingerprint (source_items[0]) rather than ref, since
// refs are renumbered after mutations. Produces a ReportDiff that drives the
// learned signals update in feedback.ts.
// ---------------------------------------------------------------------------

import type { AnalysisJSON, AnalysedItem } from '@/lib/export/types';
import type { ReportDiff, ReportChatMessage } from '@/types/report';

export function computeReportDiff(
  original: AnalysisJSON,
  edited: AnalysisJSON,
): ReportDiff {
  const diff: ReportDiff = {
    items_removed: [],
    items_added: [],
    rag_changes: [],
    field_edits: [],
  };

  // Build lookup maps by fingerprint (source_items[0]) for matching
  const originalItems = new Map<string, { item: AnalysedItem; sectionId: string }>();
  const editedItems = new Map<string, { item: AnalysedItem; sectionId: string }>();

  for (const [sectionId, section] of Object.entries(original.sections)) {
    for (const item of section.items || []) {
      const fp = item.source_items?.[0] || item.ref;
      originalItems.set(fp, { item, sectionId });
    }
  }

  for (const [sectionId, section] of Object.entries(edited.sections)) {
    for (const item of section.items || []) {
      const fp = item.source_items?.[0] || item.ref;
      editedItems.set(fp, { item, sectionId });
    }
  }

  // Items removed (in original but not in edited)
  for (const [fp, { item, sectionId }] of originalItems) {
    if (!editedItems.has(fp)) {
      diff.items_removed.push({
        section_id: sectionId,
        item_ref: item.ref,
      });
    }
  }

  // Items added (in edited but not in original)
  for (const [fp, { item, sectionId }] of editedItems) {
    if (!originalItems.has(fp)) {
      diff.items_added.push({
        section_id: sectionId,
        item_ref: item.ref,
      });
    }
  }

  // Field edits on items that exist in both
  for (const [fp, original] of originalItems) {
    const edited = editedItems.get(fp);
    if (!edited) continue;

    const o = original.item;
    const e = edited.item;

    if (o.rag !== e.rag) {
      diff.rag_changes.push({
        item_ref: e.ref,
        old_rag: o.rag,
        new_rag: e.rag,
      });
    }

    for (const field of ['headline', 'summary', 'client_relevance', 'recommended_action'] as const) {
      if (o[field] !== e[field]) {
        diff.field_edits.push({
          item_ref: e.ref,
          field,
          old_value: o[field],
          new_value: e[field],
        });
      }
    }
  }

  return diff;
}
