'use client';

import { useState } from 'react';
import type {
  Entity,
  PowerRecord,
  BudgetProfile,
  StaffProfile,
} from '@/types/entity';
import RelationshipsTab from './RelationshipsTab';
import PowersTab from './PowersTab';
import BudgetTab from './BudgetTab';
import StaffTab from './StaffTab';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface EntityPanelProps {
  entity: Entity;
  colour: string;
  relationships: {
    parents: Entity[];
    children: Entity[];
    secondaryParents: Entity[];
    secondaryChildren: Entity[];
  };
  powers?: PowerRecord;
  budget?: BudgetProfile;
  staff?: StaffProfile;
}

type TabKey = 'relationships' | 'powers' | 'budget' | 'staff';

interface TabDef {
  key: TabKey;
  label: string;
  available: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function EntityPanel({
  entity,
  colour,
  relationships,
  powers,
  budget,
  staff,
}: EntityPanelProps) {
  const tabs: TabDef[] = [
    { key: 'relationships', label: 'Relationships', available: true },
    { key: 'powers', label: 'Powers', available: !!powers },
    { key: 'budget', label: 'Budget', available: !!budget },
    { key: 'staff', label: 'Staff', available: !!staff },
  ];

  const visibleTabs = tabs.filter((t) => t.available);
  const [activeTab, setActiveTab] = useState<TabKey>(visibleTabs[0]?.key ?? 'relationships');

  return (
    <div className="flex h-full flex-col">
      {/* ---- Header ---- */}
      <div className="shrink-0 border-b border-wh-border px-6 py-4">
        {/* Name row */}
        <div className="flex items-center gap-3">
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: colour }}
          />
          <h1 className="text-lg font-semibold text-wh-text-primary">
            {entity.name}
          </h1>
          <span className="rounded-full bg-wh-border px-2.5 py-0.5 text-[10px] font-medium capitalize text-wh-text-secondary">
            {entity.category} / {entity.subtype.replace(/-/g, ' ')}
          </span>
        </div>

        {/* Current holder */}
        {entity.currentHolder && (
          <p className="mt-1.5 text-xs text-wh-text-secondary">
            <span className="text-wh-text-secondary/50">Current holder </span>
            <span className="font-medium text-wh-text-primary">
              {entity.currentHolder}
            </span>
          </p>
        )}

        {/* Description */}
        <p className="mt-2 text-[13px] leading-relaxed text-wh-text-secondary">
          {entity.description}
        </p>

        {/* Tags + jurisdictions + link row */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {entity.tags?.map((tag) => (
            <span
              key={tag}
              className="rounded bg-wh-border/60 px-2 py-0.5 text-[10px] capitalize text-wh-text-secondary/70"
            >
              {tag.replace(/-/g, ' ').replace(/^sector /, '')}
            </span>
          ))}
          {entity.jurisdictions?.map((j) => (
            <span
              key={j}
              className="rounded bg-wh-accent-teal/10 px-2 py-0.5 text-[10px] capitalize text-wh-accent-teal/70"
            >
              {j.replace(/-/g, ' ')}
            </span>
          ))}
          {entity.infoUrl && (
            <a
              href={entity.infoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-[11px] text-wh-accent-teal/70 transition-colors hover:text-wh-accent-teal"
            >
              View on GOV.UK &rarr;
            </a>
          )}
        </div>
      </div>

      {/* ---- Tab bar ---- */}
      <div className="flex shrink-0 border-b border-wh-border bg-wh-panel">
        {visibleTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-xs font-medium transition-colors ${
              activeTab === tab.key
                ? 'border-b-2 border-wh-accent-teal text-wh-accent-teal'
                : 'text-wh-text-secondary hover:text-wh-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ---- Tab content ---- */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'relationships' && (
          <RelationshipsTab relationships={relationships} />
        )}
        {activeTab === 'powers' && powers && <PowersTab powers={powers} />}
        {activeTab === 'budget' && budget && <BudgetTab budget={budget} />}
        {activeTab === 'staff' && staff && <StaffTab staff={staff} />}
      </div>
    </div>
  );
}
