'use client';

import { useState, useCallback, useRef } from 'react';
import type { ReportDraft, ReportMutation, ReportStatus } from '@/types/report';
import type { AnalysisJSON } from '@/lib/export/types';
import ReportOutline from './ReportOutline';
import ReportContent from './ReportContent';
import ReportChat from './ReportChat';

interface ReportBuilderProps {
  draft: ReportDraft;
  clientId: string;
  clientName: string;
}

export default function ReportBuilder({ draft, clientId, clientName }: ReportBuilderProps) {
  const [content, setContent] = useState<AnalysisJSON>(draft.sections);
  const [status, setStatus] = useState<ReportStatus>(draft.status);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [activeItemRef, setActiveItemRef] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleMutation = useCallback((mutation: ReportMutation) => {
    // Refresh content from server after mutation
    fetch(`/api/reports/${draft.id}`)
      .then(res => res.json())
      .then(data => {
        if (data.sections) setContent(data.sections);
      })
      .catch(() => {});
  }, [draft.id]);

  const handleContentUpdate = useCallback(async (updated: AnalysisJSON) => {
    setContent(updated);
    await fetch(`/api/reports/${draft.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sections: updated }),
    });
  }, [draft.id]);

  const handleStatusChange = useCallback(async (newStatus: ReportStatus) => {
    const res = await fetch(`/api/reports/${draft.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) setStatus(newStatus);
  }, [draft.id]);

  const handleExport = useCallback(async () => {
    const res = await fetch(`/api/reports/${draft.id}/export`, {
      method: 'POST',
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${clientName}_Report.docx`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('exported');
    }
  }, [draft.id, clientName]);

  const scrollToSection = useCallback((sectionId: string) => {
    setActiveSection(sectionId);
    const el = document.getElementById(`section-${sectionId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Status bar */}
      <div className="flex items-center justify-between shrink-0 border-b border-wh-border px-4 py-2.5">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-wh-text-primary">{clientName}</h1>
          <StatusBadge status={status} />
          <span className="text-[10px] text-wh-text-secondary">
            {new Date(draft.date_range_from).toLocaleDateString('en-GB')} – {new Date(draft.date_range_to).toLocaleDateString('en-GB')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {status === 'draft' && (
            <button
              onClick={() => handleStatusChange('in_review')}
              className="rounded-md bg-wh-accent-teal/15 px-3 py-1.5 text-xs font-medium text-wh-accent-teal transition-colors hover:bg-wh-accent-teal/25"
            >
              Submit for Review
            </button>
          )}
          {status === 'in_review' && (
            <button
              onClick={() => handleStatusChange('approved')}
              className="rounded-md bg-green-500/15 px-3 py-1.5 text-xs font-medium text-green-400 transition-colors hover:bg-green-500/25"
            >
              Approve
            </button>
          )}
          {(status === 'approved' || status === 'exported') && (
            <button
              onClick={handleExport}
              className="rounded-md bg-wh-accent-teal/15 px-3 py-1.5 text-xs font-medium text-wh-accent-teal transition-colors hover:bg-wh-accent-teal/25"
            >
              Export DOCX
            </button>
          )}
        </div>
      </div>

      {/* Three-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Outline */}
        <div className="w-[280px] shrink-0 overflow-y-auto border-r border-wh-border bg-wh-panel">
          <ReportOutline
            content={content}
            activeSection={activeSection}
            onSectionClick={scrollToSection}
          />
        </div>

        {/* Centre: Content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto bg-wh-bg">
          <ReportContent
            content={content}
            onUpdate={handleContentUpdate}
            activeItemRef={activeItemRef}
            onItemSelect={setActiveItemRef}
          />
        </div>

        {/* Right: Chat */}
        <div className="w-[360px] shrink-0 border-l border-wh-border bg-wh-panel">
          <ReportChat
            reportId={draft.id}
            clientId={clientId}
            activeSection={activeSection}
            activeItemRef={activeItemRef}
            onMutation={handleMutation}
          />
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ReportStatus }) {
  const styles: Record<ReportStatus, string> = {
    generating: 'bg-amber-500/15 text-amber-400',
    draft: 'bg-blue-500/15 text-blue-400',
    in_review: 'bg-purple-500/15 text-purple-400',
    approved: 'bg-green-500/15 text-green-400',
    exported: 'bg-wh-accent-teal/15 text-wh-accent-teal',
  };
  const labels: Record<ReportStatus, string> = {
    generating: 'Generating',
    draft: 'Draft',
    in_review: 'In Review',
    approved: 'Approved',
    exported: 'Exported',
  };

  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
