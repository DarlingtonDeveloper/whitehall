'use client';

import Shell from '@/components/layout/Shell';
import PulseContent from '@/components/pulse/PulseContent';
import { usePanels } from '@/components/layout/PanelContext';

export default function PulsePage() {
  return (
    <Shell>
      <PulsePageInner />
    </Shell>
  );
}

function PulsePageInner() {
  const panels = usePanels();

  return (
    <div className="flex h-full">
      <PulseContent sidebarOpen={panels.sidebar} feedOpen={panels.feed} toggleSidebar={panels.toggleSidebar} />
    </div>
  );
}
