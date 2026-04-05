'use client';

import { useMemo } from 'react';
import type { ClientConfig } from '@/types/client';
import { getEntity } from '@/data/entities';
import { selectEntity, selectClient } from '@/lib/panelStore';

interface ClientPanelProps {
  client: ClientConfig;
}

export default function ClientPanel({ client }: ClientPanelProps) {
  const grouped = useMemo(() => {
    const primary = client.stakeholders.filter((s) => s.priority === 'primary');
    const secondary = client.stakeholders.filter((s) => s.priority === 'secondary');
    const tertiary = client.stakeholders.filter((s) => s.priority === 'tertiary');
    return { primary, secondary, tertiary };
  }, [client]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-wh-border px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="h-3 w-3 shrink-0 rounded-full bg-wh-accent-teal" />
          <h1 className="text-lg font-semibold text-wh-text-primary">
            {client.name}
          </h1>
          <span className="rounded-full bg-wh-accent-teal/10 px-2.5 py-0.5 text-[10px] font-medium capitalize text-wh-accent-teal">
            {client.sector}
          </span>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-wh-text-secondary">
          {client.description}
        </p>

        {/* Keywords */}
        {client.policyKeywords.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {client.policyKeywords.slice(0, 8).map((kw) => (
              <span
                key={kw}
                className="rounded bg-wh-border/60 px-2 py-0.5 text-[10px] text-wh-text-secondary/70"
              >
                {kw}
              </span>
            ))}
            {client.policyKeywords.length > 8 && (
              <span className="text-[10px] text-wh-text-secondary/40">
                +{client.policyKeywords.length - 8}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Stakeholder list */}
      <div className="flex-1 overflow-y-auto">
        <StakeholderGroup label="Primary" items={grouped.primary} />
        <StakeholderGroup label="Secondary" items={grouped.secondary} />
        <StakeholderGroup label="Tertiary" items={grouped.tertiary} />

        {/* Monitoring themes */}
        {client.monitoringThemes.length > 0 && (
          <div className="border-t border-wh-border/50">
            <div className="flex items-center gap-2 px-4 py-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/70">
                Monitoring Themes
              </span>
            </div>
            {client.monitoringThemes.map((theme) => (
              <div
                key={theme.id}
                className="px-4 py-2 border-b border-wh-border/30"
              >
                <span className="text-xs font-medium text-wh-text-primary">
                  {theme.name}
                </span>
                {theme.keywords.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {theme.keywords.slice(0, 5).map((kw) => (
                      <span
                        key={kw}
                        className="rounded bg-wh-border/40 px-1.5 py-0.5 text-[9px] text-wh-text-secondary/60"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer: deselect */}
      <div className="shrink-0 border-t border-wh-border px-4 py-2.5">
        <button
          type="button"
          onClick={() => selectClient(null)}
          className="w-full rounded-md border border-wh-border px-3 py-1.5 text-xs text-wh-text-secondary transition-colors hover:bg-wh-border/50 hover:text-wh-text-primary"
        >
          Clear Client
        </button>
      </div>
    </div>
  );
}

function StakeholderGroup({
  label,
  items,
}: {
  label: string;
  items: { entityId: string; priority: string; role: string }[];
}) {
  if (items.length === 0) return null;

  const dotColour: Record<string, string> = {
    Primary: 'bg-wh-accent-teal',
    Secondary: 'bg-wh-accent-amber',
    Tertiary: 'bg-wh-text-secondary/50',
  };

  return (
    <div className="border-b border-wh-border/50">
      <div className="flex items-center gap-2 px-4 py-2">
        <span className={`h-1.5 w-1.5 rounded-full ${dotColour[label] ?? 'bg-wh-text-secondary/50'}`} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/70">
          {label}
        </span>
        <span className="text-[10px] text-wh-text-secondary/40">{items.length}</span>
      </div>
      <ul className="pb-2">
        {items.map((s) => {
          const entity = getEntity(s.entityId);
          return (
            <li key={s.entityId}>
              <button
                type="button"
                onClick={() => selectEntity(s.entityId)}
                className="flex w-full flex-col gap-0.5 px-4 py-1.5 text-left transition-colors hover:bg-wh-border/30"
              >
                <span className="text-xs font-medium text-wh-text-primary">
                  {entity?.name ?? s.entityId}
                </span>
                <span className="text-[10px] text-wh-text-secondary/60">
                  {s.role}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
