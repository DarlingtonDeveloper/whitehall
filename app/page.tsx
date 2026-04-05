import Shell from '@/components/layout/Shell';
import PulseContent from '@/components/pulse/PulseContent';

export default function PulsePage() {
  return (
    <Shell>
      <div className="flex h-full flex-col">
        <PulseContent />
      </div>
    </Shell>
  );
}
