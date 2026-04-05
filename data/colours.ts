import { TAGS } from './tags';
import type { EntityColourMap } from '@/types/entity';

/**
 * Entity colour is determined by tags, NOT by category/subtype.
 * Category/subtype determines shape (see lib/graph/shapes.ts).
 *
 * Priority: first "type" tag colour, then first "sector" tag colour,
 * then fallback grey.
 */

const FALLBACK_COLOUR = '#95a5a6';

/**
 * Look up the hex colour for an entity based on its tags.
 * Type tags take priority over sector tags.
 */
export function getEntityColour(tags?: string[]): string {
  if (!tags || tags.length === 0) return FALLBACK_COLOUR;

  // Try type tags first
  for (const tagId of tags) {
    const tag = TAGS[tagId];
    if (tag && tag.tagCategory === 'type') return tag.colour;
  }

  // Then sector tags
  for (const tagId of tags) {
    const tag = TAGS[tagId];
    if (tag && tag.tagCategory === 'sector') return tag.colour;
  }

  return FALLBACK_COLOUR;
}

/**
 * Subtype labels — kept for the legend component.
 * Colour here is irrelevant; shape comes from lib/graph/shapes.ts.
 */
export const ENTITY_COLOURS: EntityColourMap = {
  official: {
    "prime-minister": { hex: "#c0392b", label: "Prime Minister" },
    "cabinet-minister": { hex: "#c0392b", label: "Cabinet Minister" },
    "junior-minister": { hex: "#c0392b", label: "Junior Minister" },
    "civil-servant": { hex: "#c0392b", label: "Civil Servant" },
    independent: { hex: "#c0392b", label: "Independent Official" },
  },
  department: {
    ministerial: { hex: "#2980b9", label: "Ministerial Dept" },
    "non-ministerial": { hex: "#2980b9", label: "Non-Ministerial" },
    agency: { hex: "#2980b9", label: "Executive Agency" },
    "division-directorate": { hex: "#2980b9", label: "Division/Directorate" },
  },
  body: {
    "executive-ndpb": { hex: "#27ae60", label: "Executive NDPB" },
    "advisory-ndpb": { hex: "#27ae60", label: "Advisory NDPB" },
    "public-corporation": { hex: "#27ae60", label: "Public Corporation" },
    "royal-charter-body": { hex: "#27ae60", label: "Royal Charter Body" },
    tribunal: { hex: "#27ae60", label: "Tribunal" },
    other: { hex: "#27ae60", label: "Other Body" },
  },
  group: {
    cabinet: { hex: "#8e44ad", label: "Cabinet" },
    "other-group": { hex: "#8e44ad", label: "Other Group" },
  },
};
