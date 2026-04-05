import Shell from '@/components/layout/Shell';
import PulseView from '@/components/graph/PulseView';
import FeedPanel from '@/components/feed/FeedPanel';

export default function PulsePage() {
  return (
    <Shell>
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="border-b border-wh-border px-6 py-4">
          <h1 className="text-lg font-semibold text-wh-text-primary">
            Pulse View
          </h1>
          <p className="mt-1 text-sm text-wh-text-secondary">
            Government activity across all departments
          </p>
        </div>

        {/* Content area: graph + feed side by side */}
        <div className="flex flex-1 overflow-hidden">
          {/* Network graph */}
          <div className="flex-1 border-r border-wh-border">
            <PulseView />
          </div>

          {/* Feed panel */}
          <div className="flex w-96 shrink-0 flex-col bg-wh-panel">
            <FeedPanel title="Activity Feed" />
          </div>
        </div>
      </div>
    </Shell>
  );
}
