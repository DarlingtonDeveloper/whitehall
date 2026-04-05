import { notFound } from 'next/navigation';
import Shell from '@/components/layout/Shell';
import FeedPanel from '@/components/feed/FeedPanel';
import { getClientBySlug, ALL_CLIENTS } from '@/data/clients';
import { getEntity } from '@/data/entities';
import ConstellationView from '@/components/graph/ConstellationView';

export async function generateStaticParams() {
  return ALL_CLIENTS.map((c) => ({ slug: c.id }));
}

export default async function ClientPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const client = getClientBySlug(slug);

  if (!client) {
    notFound();
  }

  const primaryStakeholders = client.stakeholders.filter(
    (s) => s.priority === 'primary',
  );
  const secondaryStakeholders = client.stakeholders.filter(
    (s) => s.priority === 'secondary',
  );
  const tertiaryStakeholders = client.stakeholders.filter(
    (s) => s.priority === 'tertiary',
  );

  return (
    <Shell>
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="border-b border-wh-border px-6 py-4">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-wh-text-primary">
              {client.name}
            </h1>
            <span className="rounded-full bg-wh-accent-teal/10 px-2.5 py-0.5 text-[10px] font-medium capitalize text-wh-accent-teal">
              {client.sector}
            </span>
          </div>
          <p className="mt-1 text-sm text-wh-text-secondary">
            {client.description}
          </p>
        </div>

        {/* Three-panel layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Stakeholder list */}
          <div className="w-72 shrink-0 overflow-y-auto border-r border-wh-border bg-wh-panel">
            <div className="px-4 py-3 border-b border-wh-border">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-wh-text-secondary">
                Stakeholders
              </h2>
            </div>

            <StakeholderGroup label="Primary" items={primaryStakeholders} />
            <StakeholderGroup label="Secondary" items={secondaryStakeholders} />
            <StakeholderGroup label="Tertiary" items={tertiaryStakeholders} />
          </div>

          {/* Center: Constellation graph */}
          <div className="flex-1">
            <ConstellationView clientId={slug} />
          </div>

          {/* Right: Intelligence feed */}
          <div className="flex w-80 shrink-0 flex-col border-l border-wh-border bg-wh-panel">
            <FeedPanel
              clientId={slug}
            />
          </div>
        </div>
      </div>
    </Shell>
  );
}

function StakeholderGroup({
  label,
  items,
}: {
  label: string;
  items: { entityId: string; role: string }[];
}) {
  if (items.length === 0) return null;

  const priorityColour: Record<string, string> = {
    Primary: 'bg-wh-accent-teal',
    Secondary: 'bg-wh-accent-amber',
    Tertiary: 'bg-wh-text-secondary/50',
  };

  return (
    <div className="border-b border-wh-border/50">
      <div className="flex items-center gap-2 px-4 py-2">
        <span
          className={`h-1.5 w-1.5 rounded-full ${priorityColour[label] ?? 'bg-wh-text-secondary/50'}`}
        />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/70">
          {label}
        </span>
        <span className="text-[10px] text-wh-text-secondary/40">
          {items.length}
        </span>
      </div>
      <ul className="pb-2">
        {items.map((s) => (
          <li key={s.entityId}>
            <a
              href={`/entity/${s.entityId}`}
              className="flex flex-col gap-0.5 px-4 py-1.5 transition-colors hover:bg-wh-border/30"
            >
              <span className="text-xs font-medium text-wh-text-primary">
                {getEntity(s.entityId)?.name ?? s.entityId}
              </span>
              <span className="text-[10px] text-wh-text-secondary/60">
                {s.role}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
