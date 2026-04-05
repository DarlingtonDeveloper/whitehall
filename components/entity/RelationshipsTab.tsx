'use client';

import type { Entity } from '@/types/entity';
import Link from 'next/link';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

interface RelationshipGroup {
  label: string;
  items: Entity[];
}

function isOfficial(e: Entity): boolean {
  return e.category === 'official';
}

function isDeptOrGroup(e: Entity): boolean {
  return e.category === 'department' || e.category === 'group';
}

/**
 * Organise raw relationship data into labelled display groups.
 */
function buildGroups(rels: {
  parents: Entity[];
  children: Entity[];
  secondaryParents: Entity[];
  secondaryChildren: Entity[];
}): RelationshipGroup[] {
  const groups: RelationshipGroup[] = [];

  const ledBy = rels.parents.filter(isOfficial);
  if (ledBy.length > 0) groups.push({ label: 'Led by', items: ledBy });

  const partOf = rels.parents.filter(isDeptOrGroup);
  if (partOf.length > 0) groups.push({ label: 'Part of', items: partOf });

  const sponsors = rels.children.filter(
    (e) => e.category === 'body' || e.category === 'department',
  );
  if (sponsors.length > 0)
    groups.push({ label: 'Sponsors / Oversees', items: sponsors });

  const ministers = rels.children.filter(isOfficial);
  if (ministers.length > 0)
    groups.push({ label: 'Ministers', items: ministers });

  if (rels.secondaryParents.length > 0)
    groups.push({ label: 'Also reports to', items: rels.secondaryParents });

  if (rels.secondaryChildren.length > 0)
    groups.push({ label: 'Advisory role for', items: rels.secondaryChildren });

  /* If any children fall through the cracks (groups, etc.) */
  const remainingChildren = rels.children.filter(
    (e) => !isOfficial(e) && e.category !== 'body' && e.category !== 'department',
  );
  if (remainingChildren.length > 0)
    groups.push({ label: 'Related entities', items: remainingChildren });

  return groups;
}

/* ------------------------------------------------------------------ */
/*  Colour dot                                                         */
/* ------------------------------------------------------------------ */

const CATEGORY_COLOURS: Record<string, string> = {
  official: '#c0392b',
  department: '#e74c3c',
  body: '#27ae60',
  group: '#8e44ad',
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface RelationshipsTabProps {
  relationships: {
    parents: Entity[];
    children: Entity[];
    secondaryParents: Entity[];
    secondaryChildren: Entity[];
  };
}

export default function RelationshipsTab({ relationships }: RelationshipsTabProps) {
  const groups = buildGroups(relationships);

  if (groups.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-xs text-wh-text-secondary/50">
          No relationships found for this entity.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1 p-4">
      {groups.map((group) => (
        <div key={group.label}>
          {/* Group heading */}
          <div className="flex items-center gap-2 px-1 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/60">
              {group.label}
            </span>
            <span className="text-[10px] text-wh-text-secondary/30">
              {group.items.length}
            </span>
          </div>

          {/* Entries */}
          <div className="space-y-px">
            {group.items.map((entity) => (
              <Link
                key={entity.id}
                href={`/entity/${entity.id}`}
                className="flex items-start gap-2.5 rounded-md px-2.5 py-2 transition-colors hover:bg-wh-border/30"
              >
                <span
                  className="mt-1 h-2 w-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      CATEGORY_COLOURS[entity.category] ?? '#95a5a6',
                  }}
                />
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-wh-text-primary">
                    {entity.name}
                  </span>
                  <div className="flex items-center gap-2">
                    {entity.currentHolder && (
                      <span className="truncate text-[10px] text-wh-text-secondary/70">
                        {entity.currentHolder}
                      </span>
                    )}
                    <span className="shrink-0 text-[10px] capitalize text-wh-text-secondary/40">
                      {entity.subtype.replace(/-/g, ' ')}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
