'use client';

import type { AnalysisJSON, ThemeSection } from '@/lib/export/types';

interface ReportOutlineProps {
  content: AnalysisJSON;
  activeSection: string | null;
  onSectionClick: (sectionId: string) => void;
}

function sectionRag(section: ThemeSection): 'RED' | 'AMBER' | 'GREEN' | null {
  const items = section.items || [];
  if (items.some(i => i.rag === 'RED')) return 'RED';
  if (items.some(i => i.rag === 'AMBER')) return 'AMBER';
  if (items.length > 0) return 'GREEN';
  return null;
}

const RAG_DOT: Record<string, string> = {
  RED: 'bg-red-500',
  AMBER: 'bg-amber-500',
  GREEN: 'bg-green-500',
};

export default function ReportOutline({ content, activeSection, onSectionClick }: ReportOutlineProps) {
  const sections = Object.entries(content.sections);

  return (
    <div className="flex flex-col py-2">
      {/* Executive Summary */}
      <button
        onClick={() => onSectionClick('executive-summary')}
        className={`flex items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-wh-border/30 ${
          activeSection === 'executive-summary' ? 'bg-wh-accent-teal/10 border-r-2 border-wh-accent-teal' : ''
        }`}
      >
        <span className="text-[10px] font-medium text-wh-text-secondary">1</span>
        <span className="flex-1 text-xs font-medium text-wh-text-primary">Executive Summary</span>
        <span className="text-[10px] text-wh-text-secondary/50">
          {content.executive_summary?.key_developments?.length ?? 0}
        </span>
      </button>

      {/* Theme Sections */}
      {sections.map(([id, section], idx) => {
        const rag = sectionRag(section);
        const itemCount = (section.items || []).length;
        const isActive = activeSection === id;

        return (
          <button
            key={id}
            onClick={() => onSectionClick(id)}
            className={`flex items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-wh-border/30 ${
              isActive ? 'bg-wh-accent-teal/10 border-r-2 border-wh-accent-teal' : ''
            }`}
          >
            <span className="text-[10px] font-medium text-wh-text-secondary">{idx + 2}</span>
            {rag && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${RAG_DOT[rag]}`} />}
            <span className="flex-1 text-xs font-medium text-wh-text-primary truncate">
              {formatThemeName(id)}
            </span>
            <span className="text-[10px] text-wh-text-secondary/50">{itemCount}</span>
          </button>
        );
      })}

      <div className="my-1 border-t border-wh-border/30" />

      {/* Fixed sections */}
      {[
        { id: 'forward-look', label: 'Forward Look', count: content.forward_look?.length ?? 0 },
        { id: 'emerging-themes', label: 'Emerging Themes', count: content.emerging_themes?.length ?? 0 },
        { id: 'actions-tracker', label: 'Actions Tracker', count: content.actions_tracker?.length ?? 0 },
        { id: 'coverage-summary', label: 'Coverage Summary', count: content.coverage_summary?.length ?? 0 },
      ].map((item, i) => (
        <button
          key={item.id}
          onClick={() => onSectionClick(item.id)}
          className={`flex items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-wh-border/30 ${
            activeSection === item.id ? 'bg-wh-accent-teal/10 border-r-2 border-wh-accent-teal' : ''
          }`}
        >
          <span className="text-[10px] font-medium text-wh-text-secondary">
            {Object.keys(content.sections).length + 2 + i}
          </span>
          <span className="flex-1 text-xs font-medium text-wh-text-primary">{item.label}</span>
          <span className="text-[10px] text-wh-text-secondary/50">{item.count}</span>
        </button>
      ))}
    </div>
  );
}

function formatThemeName(id: string): string {
  return id
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
