'use client';

import { useEffect, useState } from 'react';
import type { ClientConfig } from '@/types/client';
import { supabase } from '@/lib/db';
import {
  useFeedFilter,
  setFeedFilter,
  type FeedFilter,
} from '@/lib/feedFilterStore';

interface HealthMetrics {
  itemsThisWeek: number;
  openConsultations: number;
  billsInProgress: number;
  committeeInquiries: number;
  activePetitions: number;
  tradePressCoverage: number;
}

interface MetricCard {
  label: string;
  value: number;
  colour: string;
  zeroColour: string;
  feedFilter: FeedFilter;
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
      .eq('source_type', 'petition')
      .gte('published_at', oneWeekAgo),
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
  const activeFilter = useFeedFilter();

  useEffect(() => {
    setLoading(true);
    fetchHealthMetrics(client).then((m) => {
      setMetrics(m);
      setLoading(false);
    });
  }, [client.id]);

  if (loading || !metrics) {
    return (
      <div className="grid grid-cols-3 gap-2 px-3 py-2.5">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-14 rounded-lg bg-wh-bg animate-pulse" />
        ))}
      </div>
    );
  }

  const cards: MetricCard[] = [
    {
      label: 'This week',
      value: metrics.itemsThisWeek,
      colour: 'var(--color-wh-text-primary)',
      zeroColour: 'var(--color-wh-text-secondary)',
      feedFilter: { label: 'This week', queryDateDays: 7 },
    },
    {
      label: 'Consultations',
      value: metrics.openConsultations,
      colour: '#f59e0b',
      zeroColour: 'var(--color-wh-text-secondary)',
      feedFilter: { label: 'Consultations', sourceType: 'govuk', titleContains: 'consultation', queryDateDays: 90 },
    },
    {
      label: 'Bills',
      value: metrics.billsInProgress,
      colour: 'var(--color-wh-text-primary)',
      zeroColour: 'var(--color-wh-text-secondary)',
      feedFilter: { label: 'Bills', sourceType: 'legislation', titleContains: 'Bill' },
    },
    {
      label: 'Committees',
      value: metrics.committeeInquiries,
      colour: 'var(--color-wh-text-primary)',
      zeroColour: 'var(--color-wh-text-secondary)',
      feedFilter: { label: 'Committees', sourceType: 'committee', queryDateDays: 30 },
    },
    {
      label: 'Petitions',
      value: metrics.activePetitions,
      colour: metrics.activePetitions > 50 ? '#ef4444' : '#f59e0b',
      zeroColour: 'var(--color-wh-text-secondary)',
      feedFilter: { label: 'Petitions', sourceType: 'petition', queryDateDays: 7 },
    },
    {
      label: 'Trade press',
      value: metrics.tradePressCoverage,
      colour: '#f59e0b',
      zeroColour: 'var(--color-wh-text-secondary)',
      feedFilter: { label: 'Trade press', sourceType: 'trade_press', queryDateDays: 7 },
    },
  ];

  function handleMetricClick(card: MetricCard) {
    const isActive =
      activeFilter &&
      activeFilter.label === card.feedFilter.label;
    setFeedFilter(isActive ? null : card.feedFilter);
  }

  return (
    <div className="grid grid-cols-3 gap-2 px-3 py-2.5">
      {cards.map((card) => {
        const isActive =
          activeFilter !== null &&
          activeFilter.label === card.feedFilter.label;
        const displayColour = card.value > 0 ? card.colour : card.zeroColour;

        return (
          <button
            key={card.label}
            type="button"
            onClick={() => handleMetricClick(card)}
            className={`rounded-lg p-2.5 text-left transition-all ${
              isActive
                ? 'bg-wh-accent-teal/10 ring-1 ring-wh-accent-teal'
                : 'bg-wh-bg hover:bg-wh-panel'
            } ${card.value === 0 ? 'opacity-50' : ''}`}
          >
            <div className="text-[10px] text-wh-text-secondary/70 uppercase tracking-wide mb-1">
              {card.label}
            </div>
            <div className="text-xl font-medium" style={{ color: displayColour }}>
              {card.value}
            </div>
          </button>
        );
      })}
    </div>
  );
}
