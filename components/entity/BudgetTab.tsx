'use client';

import { useState } from 'react';
import type { BudgetProfile, Budget } from '@/types/entity';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatMoney(thousands: number): string {
  const abs = Math.abs(thousands);
  if (abs >= 1_000_000) return `\u00a3${(thousands / 1_000_000).toFixed(1)}bn`;
  if (abs >= 1_000) return `\u00a3${(thousands / 1_000).toFixed(1)}m`;
  return `\u00a3${thousands}k`;
}

function pctOf(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 100);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface BudgetTabProps {
  budget: BudgetProfile;
}

export default function BudgetTab({ budget }: BudgetTabProps) {
  const [selectedYear, setSelectedYear] = useState(0);
  const yearData: Budget = budget.budgets[selectedYear];

  if (!yearData) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-xs text-wh-text-secondary/50">No budget data available.</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Year selector */}
      {budget.budgets.length > 1 && (
        <div className="flex items-center gap-1.5">
          {budget.budgets.map((b, i) => (
            <button
              key={b.financialYear}
              type="button"
              onClick={() => setSelectedYear(i)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                i === selectedYear
                  ? 'bg-wh-accent-teal/15 text-wh-accent-teal'
                  : 'text-wh-text-secondary hover:bg-wh-border/40 hover:text-wh-text-primary'
              }`}
            >
              {b.financialYear}
            </button>
          ))}
        </div>
      )}

      {/* Headline stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Net Expenditure"
          value={formatMoney(yearData.totalNetExpenditure)}
        />
        <StatCard
          label="Gross Expenditure"
          value={formatMoney(yearData.totalGrossExpenditure)}
        />
        <StatCard
          label="Total Income"
          value={formatMoney(yearData.totalIncome)}
        />
      </div>

      {/* DEL / AME breakdown */}
      <div className="rounded-md border border-wh-border/50 p-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/60 mb-2.5">
          Expenditure Breakdown
        </h3>
        <div className="space-y-2">
          <BarRow
            label="DEL Admin"
            value={yearData.delAdmin}
            total={yearData.totalGrossExpenditure}
          />
          <BarRow
            label="DEL Programme"
            value={yearData.delProg}
            total={yearData.totalGrossExpenditure}
          />
          <BarRow
            label="Dept AME"
            value={yearData.deptAme}
            total={yearData.totalGrossExpenditure}
          />
          <BarRow
            label="Non-Dept AME"
            value={yearData.nonDeptAme}
            total={yearData.totalGrossExpenditure}
          />
        </div>
      </div>

      {/* Programme lines */}
      {yearData.programmeLines.length > 0 && (
        <LinesSection
          title="Programme Spending"
          lines={yearData.programmeLines}
        />
      )}

      {/* Body lines */}
      {yearData.bodyLines.length > 0 && (
        <LinesSection
          title="Arms-Length Bodies"
          lines={yearData.bodyLines}
        />
      )}

      {/* Source info */}
      <div className="flex items-center justify-between pt-2">
        <span className="text-[10px] text-wh-text-secondary/40">
          {yearData.sourceLabel} &mdash; {yearData.financialYear}
        </span>
        {yearData.annualReportUrl && (
          <a
            href={yearData.annualReportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-wh-accent-teal/70 transition-colors hover:text-wh-accent-teal"
          >
            Annual Report &rarr;
          </a>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-wh-border/50 px-3 py-2.5">
      <p className="text-sm font-semibold text-wh-text-primary">{value}</p>
      <p className="mt-0.5 text-[10px] text-wh-text-secondary/60">{label}</p>
    </div>
  );
}

function BarRow({
  label,
  value,
  total,
}: {
  label: string;
  value: number;
  total: number;
}) {
  const pct = pctOf(Math.abs(value), Math.abs(total));
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-wh-text-secondary">{label}</span>
        <span className="text-[11px] font-medium text-wh-text-primary">
          {formatMoney(value)}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-wh-border/40">
        <div
          className="h-1.5 rounded-full bg-wh-accent-teal/50"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

function LinesSection({
  title,
  lines,
}: {
  title: string;
  lines: { label: string; amount: number }[];
}) {
  // Sort by absolute amount descending
  const sorted = [...lines].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  return (
    <div className="rounded-md border border-wh-border/50 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/60 mb-2">
        {title}
      </h3>
      <div className="space-y-1.5">
        {sorted.map((line) => (
          <div
            key={line.label}
            className="flex items-center justify-between"
          >
            <span className="min-w-0 truncate text-[11px] text-wh-text-secondary pr-3">
              {line.label}
            </span>
            <span className="shrink-0 text-[11px] font-medium text-wh-text-primary">
              {formatMoney(line.amount)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
