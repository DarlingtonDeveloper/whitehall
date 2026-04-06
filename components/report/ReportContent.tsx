'use client';

import { useCallback } from 'react';
import type { AnalysisJSON, AnalysedItem } from '@/lib/export/types';
import ReportItemCard from './ReportItemCard';

interface ReportContentProps {
  content: AnalysisJSON;
  onUpdate: (content: AnalysisJSON) => void;
  activeItemRef: string | null;
  onItemSelect: (ref: string | null) => void;
}

export default function ReportContent({
  content,
  onUpdate,
  activeItemRef,
  onItemSelect,
}: ReportContentProps) {
  const handleItemUpdate = useCallback(
    (sectionId: string, itemIdx: number, updated: AnalysedItem) => {
      const clone = structuredClone(content);
      const section = clone.sections[sectionId];
      if (section?.items?.[itemIdx]) {
        section.items[itemIdx] = updated;
        onUpdate(clone);
      }
    },
    [content, onUpdate],
  );

  const handleItemRemove = useCallback(
    (sectionId: string, itemIdx: number) => {
      const clone = structuredClone(content);
      const section = clone.sections[sectionId];
      if (section?.items) {
        section.items.splice(itemIdx, 1);
        // Renumber
        const sectionNum = Object.keys(clone.sections).indexOf(sectionId) + 1;
        section.items.forEach((item, i) => {
          item.ref = `${sectionNum}.${i + 1}`;
        });
        onUpdate(clone);
      }
    },
    [content, onUpdate],
  );

  return (
    <div className="mx-auto max-w-4xl px-8 py-6 space-y-8">
      {/* Executive Summary */}
      <section id="section-executive-summary">
        <h2 className="text-sm font-semibold text-wh-text-primary mb-3">Executive Summary</h2>
        <div className="rounded-lg border border-wh-border bg-wh-panel p-4">
          <p className="text-xs leading-relaxed text-wh-text-secondary">
            {content.executive_summary?.top_line || 'No executive summary yet.'}
          </p>
          {content.executive_summary?.key_developments?.length > 0 && (
            <div className="mt-4 space-y-2">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/70">
                Key Developments
              </h3>
              {content.executive_summary.key_developments.map((kd, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md border border-wh-border/50 bg-wh-bg p-2.5">
                  <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                    kd.rag === 'RED' ? 'bg-red-500' : kd.rag === 'AMBER' ? 'bg-amber-500' : 'bg-green-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-wh-text-primary">{kd.development}</p>
                    <p className="mt-0.5 text-[10px] text-wh-text-secondary">{kd.relevance}</p>
                  </div>
                  <span className="shrink-0 text-[9px] text-wh-text-secondary/40">{kd.section_ref}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Theme Sections */}
      {Object.entries(content.sections).map(([sectionId, section], sectionIdx) => (
        <section key={sectionId} id={`section-${sectionId}`}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-medium text-wh-text-secondary">{sectionIdx + 2}</span>
            <h2 className="text-sm font-semibold text-wh-text-primary">
              {formatThemeName(sectionId)}
            </h2>
            <span className="text-[10px] text-wh-text-secondary/50">
              {(section.items || []).length} items
            </span>
          </div>

          {section.no_developments && (!section.items || section.items.length === 0) ? (
            <div className="rounded-lg border border-wh-border/50 bg-wh-panel p-4 text-xs text-wh-text-secondary/60">
              No significant developments this week.
            </div>
          ) : (
            <div className="space-y-3">
              {(section.items || []).map((item, itemIdx) => (
                <ReportItemCard
                  key={item.ref}
                  item={item}
                  isActive={activeItemRef === item.ref}
                  onClick={() => onItemSelect(item.ref)}
                  onUpdate={(updated) => handleItemUpdate(sectionId, itemIdx, updated)}
                  onRemove={() => handleItemRemove(sectionId, itemIdx)}
                />
              ))}
            </div>
          )}
        </section>
      ))}

      {/* Forward Look */}
      <section id="section-forward-look">
        <h2 className="text-sm font-semibold text-wh-text-primary mb-3">Forward Look</h2>
        {content.forward_look?.length > 0 ? (
          <div className="rounded-lg border border-wh-border bg-wh-panel overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-wh-border bg-wh-bg">
                  <th className="px-3 py-2 text-left font-medium text-wh-text-secondary/70">Date</th>
                  <th className="px-3 py-2 text-left font-medium text-wh-text-secondary/70">Event</th>
                  <th className="px-3 py-2 text-left font-medium text-wh-text-secondary/70">Relevance</th>
                  <th className="px-3 py-2 text-left font-medium text-wh-text-secondary/70">Preparation</th>
                </tr>
              </thead>
              <tbody>
                {content.forward_look.map((item, i) => (
                  <tr key={i} className="border-b border-wh-border/30 last:border-0">
                    <td className="px-3 py-2 text-wh-text-secondary whitespace-nowrap">{item.date}</td>
                    <td className="px-3 py-2 text-wh-text-primary">{item.event}</td>
                    <td className="px-3 py-2 text-wh-text-secondary">{item.relevance}</td>
                    <td className="px-3 py-2 text-wh-text-secondary">{item.preparation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border border-wh-border/50 bg-wh-panel p-4 text-xs text-wh-text-secondary/60">
            No forward look items.
          </div>
        )}
      </section>

      {/* Emerging Themes */}
      <section id="section-emerging-themes">
        <h2 className="text-sm font-semibold text-wh-text-primary mb-3">Emerging Themes</h2>
        <div className="rounded-lg border border-wh-border bg-wh-panel p-4 space-y-3">
          {content.emerging_themes?.length > 0 ? (
            content.emerging_themes.map((theme, i) => (
              <p key={i} className="text-xs leading-relaxed text-wh-text-secondary">{theme}</p>
            ))
          ) : (
            <p className="text-xs text-wh-text-secondary/60">No emerging themes identified.</p>
          )}
        </div>
      </section>

      {/* Actions Tracker */}
      <section id="section-actions-tracker">
        <h2 className="text-sm font-semibold text-wh-text-primary mb-3">Actions Tracker</h2>
        {content.actions_tracker?.length > 0 ? (
          <div className="rounded-lg border border-wh-border bg-wh-panel overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-wh-border bg-wh-bg">
                  <th className="px-3 py-2 text-left font-medium text-wh-text-secondary/70">Ref</th>
                  <th className="px-3 py-2 text-left font-medium text-wh-text-secondary/70">Action</th>
                  <th className="px-3 py-2 text-left font-medium text-wh-text-secondary/70">Owner</th>
                  <th className="px-3 py-2 text-left font-medium text-wh-text-secondary/70">Deadline</th>
                  <th className="px-3 py-2 text-left font-medium text-wh-text-secondary/70">Status</th>
                </tr>
              </thead>
              <tbody>
                {content.actions_tracker.map((action, i) => (
                  <tr key={i} className="border-b border-wh-border/30 last:border-0">
                    <td className="px-3 py-2 text-wh-text-secondary font-medium">{action.ref}</td>
                    <td className="px-3 py-2 text-wh-text-primary">{action.action}</td>
                    <td className="px-3 py-2 text-wh-text-secondary">{action.owner}</td>
                    <td className="px-3 py-2 text-wh-text-secondary whitespace-nowrap">{action.deadline}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        action.status === 'DONE' ? 'bg-green-500/15 text-green-400' : 'bg-amber-500/15 text-amber-400'
                      }`}>
                        {action.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border border-wh-border/50 bg-wh-panel p-4 text-xs text-wh-text-secondary/60">
            No actions tracked.
          </div>
        )}
      </section>

      {/* Coverage Summary */}
      <section id="section-coverage-summary">
        <h2 className="text-sm font-semibold text-wh-text-primary mb-3">Coverage Summary</h2>
        {content.coverage_summary?.length > 0 ? (
          <div className="rounded-lg border border-wh-border bg-wh-panel overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-wh-border bg-wh-bg">
                  <th className="px-3 py-2 text-left font-medium text-wh-text-secondary/70">Metric</th>
                  <th className="px-3 py-2 text-left font-medium text-wh-text-secondary/70">This Week</th>
                  <th className="px-3 py-2 text-left font-medium text-wh-text-secondary/70">Previous Week</th>
                  <th className="px-3 py-2 text-left font-medium text-wh-text-secondary/70">Trend</th>
                </tr>
              </thead>
              <tbody>
                {content.coverage_summary.map((metric, i) => (
                  <tr key={i} className="border-b border-wh-border/30 last:border-0">
                    <td className="px-3 py-2 text-wh-text-primary font-medium">{metric.metric}</td>
                    <td className="px-3 py-2 text-wh-text-secondary">{metric.this_week}</td>
                    <td className="px-3 py-2 text-wh-text-secondary">{metric.previous_week}</td>
                    <td className="px-3 py-2 text-wh-text-secondary">{metric.trend}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border border-wh-border/50 bg-wh-panel p-4 text-xs text-wh-text-secondary/60">
            No coverage data.
          </div>
        )}
      </section>
    </div>
  );
}

function formatThemeName(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
