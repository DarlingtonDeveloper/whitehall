'use client';

import { useEffect, useState } from 'react';
import type { ClientConfig } from '@/types/client';
import { supabase } from '@/lib/db';

interface HealthMetrics {
  itemsThisWeek: number;
  openConsultations: number;
  billsInProgress: number;
  committeeInquiries: number;
  activePetitions: number;
  tradePressCoverage: number;
}

async function fetchHealthMetrics(client: ClientConfig): Promise<HealthMetrics> {
  const stakeholderIds = client.stakeholders.map((s) => s.entityId);
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [items, consultations, bills, committees, petitions, tradePress] = await Promise.all([
    supabase
      .from('feed_items')
      .select('id', { count: 'exact', head: true })
      .overlaps('entity_ids', stakeholderIds)
      .gte('published_at', oneWeekAgo),
    supabase
      .from('feed_items')
      .select('id', { count: 'exact', head: true })
      .overlaps('entity_ids', stakeholderIds)
      .gte('published_at', ninetyDaysAgo)
      .eq('source_type', 'govuk')
      .ilike('title', '%consultation%'),
    supabase
      .from('feed_items')
      .select('id', { count: 'exact', head: true })
      .overlaps('entity_ids', stakeholderIds)
      .eq('source_type', 'legislation')
      .ilike('title', '%Bill%'),
    supabase
      .from('feed_items')
      .select('id', { count: 'exact', head: true })
      .overlaps('entity_ids', stakeholderIds)
      .gte('published_at', thirtyDaysAgo)
      .eq('source_type', 'committee'),
    supabase
      .from('feed_items')
      .select('id', { count: 'exact', head: true })
      .overlaps('entity_ids', stakeholderIds)
      .eq('source_type', 'petition'),
    supabase
      .from('feed_items')
      .select('id', { count: 'exact', head: true })
      .overlaps('entity_ids', stakeholderIds)
      .gte('published_at', oneWeekAgo)
      .eq('source_type', 'trade_press'),
  ]);

  return {
    itemsThisWeek: items.count ?? 0,
    openConsultations: consultations.count ?? 0,
    billsInProgress: bills.count ?? 0,
    committeeInquiries: committees.count ?? 0,
    activePetitions: petitions.count ?? 0,
    tradePressCoverage: tradePress.count ?? 0,
  };
}

export default function ClientHealthDashboard({ client }: { client: ClientConfig }) {
  const [metrics, setMetrics] = useState<HealthMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchHealthMetrics(client).then((m) => {
      setMetrics(m);
      setLoading(false);
    });
  }, [client.id]);

  if (loading || !metrics) {
    return (
      <div className="grid grid-cols-6 gap-2 p-3 border-b border-wh-border">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-14 rounded-lg bg-wh-bg animate-pulse" />
        ))}
      </div>
    );
  }

  const cards = [
    {
      label: 'Items this week',
      value: metrics.itemsThisWeek,
      colour: 'var(--color-wh-text-primary)',
    },
    {
      label: 'Open consultations',
      value: metrics.openConsultations,
      colour: metrics.openConsultations > 0 ? '#f59e0b' : 'var(--color-wh-text-secondary)',
    },
    {
      label: 'Bills in progress',
      value: metrics.billsInProgress,
      colour: 'var(--color-wh-text-primary)',
    },
    {
      label: 'Committee inquiries',
      value: metrics.committeeInquiries,
      colour: 'var(--color-wh-text-primary)',
    },
    {
      label: 'Active petitions',
      value: metrics.activePetitions,
      colour: metrics.activePetitions > 0 ? '#ec4899' : 'var(--color-wh-text-secondary)',
    },
    {
      label: 'Trade press',
      value: metrics.tradePressCoverage,
      colour: metrics.tradePressCoverage > 0 ? '#f97316' : 'var(--color-wh-text-secondary)',
    },
  ];

  return (
    <div className="grid grid-cols-6 gap-2 p-3 border-b border-wh-border">
      {cards.map((card) => (
        <div key={card.label} className="rounded-lg bg-wh-bg p-2.5">
          <div className="text-[10px] text-wh-text-secondary/70 uppercase tracking-wide mb-1">
            {card.label}
          </div>
          <div className="text-xl font-medium" style={{ color: card.colour }}>
            {card.value}
          </div>
        </div>
      ))}
    </div>
  );
}
