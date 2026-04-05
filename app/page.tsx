import Shell from '@/components/layout/Shell';
import PulseContent from '@/components/pulse/PulseContent';
import FeedPanel from '@/components/feed/FeedPanel';

export default function PulsePage() {
  return (
    <Shell>
      <div className="flex h-full flex-col">
        {/* Content area: sidebar + graph + feed */}
        <div className="flex flex-1 overflow-hidden">
          <PulseContent />

          {/* Feed panel */}
          <div className="flex w-80 shrink-0 flex-col border-l border-wh-border bg-wh-panel">
            <FeedPanel title="Activity Feed" />
          </div>
        </div>
      </div>
    </Shell>
  );
}
