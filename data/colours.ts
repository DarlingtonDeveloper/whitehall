import type { EntityColourMap } from '@/types/entity';

export const ENTITY_COLOURS: EntityColourMap = {
  official: {
    "prime-minister": {
      hex: "#7b0000",
      label: "Prime Minister",
    },
    "cabinet-minister": {
      hex: "#c0392b",
      label: "Cabinet Minister",
    },
    "junior-minister": {
      hex: "#f1948a",
      label: "Junior Minister",
    },
    "civil-servant": {
      hex: "#3498db",
      label: "Civil Servant",
    },
    independent: {
      hex: "#27ae60",
      label: "Independent Official",
    },
  },
  department: {
    ministerial: {
      hex: "#e74c3c",
      label: "Ministerial Dept",
    },
    "non-ministerial": {
      hex: "#2980b9",
      label: "Non-Ministerial",
    },
    agency: {
      hex: "#8e44ad",
      label: "Executive Agency",
    },
    "division-directorate": {
      hex: "#e74c3c",
      label: "Division/Directorate",
    },
  },
  body: {
    "executive-ndpb": {
      hex: "#27ae60",
      label: "Executive NDPB",
    },
    "advisory-ndpb": {
      hex: "#f1c40f",
      label: "Advisory NDPB",
    },
    "public-corporation": {
      hex: "#e67e22",
      label: "Public Corporation",
    },
    "royal-charter-body": {
      hex: "#8e44ad",
      label: "Royal Charter Body",
    },
    tribunal: {
      hex: "#d35400",
      label: "Tribunal",
    },
    other: {
      hex: "#95a5a6",
      label: "Other Body",
    },
  },
  group: {
    cabinet: {
      hex: "#c0392b",
      label: "Cabinet",
    },
    "other-group": {
      hex: "#8e44ad",
      label: "Other Group",
    },
  },
};

/**
 * Look up the hex colour for a given entity category and subtype.
 * Falls back to a neutral grey if the combination is not found.
 */
export function getEntityColour(category: string, subtype: string): string {
  const subtypes = ENTITY_COLOURS[category];
  if (!subtypes) return '#95a5a6';
  const entry = subtypes[subtype];
  return entry ? entry.hex : '#95a5a6';
}
