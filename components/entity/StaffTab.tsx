'use client';

import type { StaffProfile, GradeBreakdown } from '@/types/entity';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmt(n: number): string {
  return n.toLocaleString('en-GB');
}

function pct(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 100);
}

const GRADE_LABELS: Record<keyof Omit<GradeBreakdown, 'total'>, string> = {
  scs: 'Senior Civil Service',
  g67: 'Grade 6/7',
  sheo: 'SEO/HEO',
  eo: 'Executive Officer',
  aaao: 'AA/AO',
  other: 'Other',
};

const GRADE_COLOURS: Record<keyof Omit<GradeBreakdown, 'total'>, string> = {
  scs: 'bg-red-400',
  g67: 'bg-blue-400',
  sheo: 'bg-teal-400',
  eo: 'bg-amber-400',
  aaao: 'bg-purple-400',
  other: 'bg-gray-400',
};

const GRADE_KEYS: (keyof Omit<GradeBreakdown, 'total'>)[] = [
  'scs',
  'g67',
  'sheo',
  'eo',
  'aaao',
  'other',
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface StaffTabProps {
  staff: StaffProfile;
}

export default function StaffTab({ staff }: StaffTabProps) {
  return (
    <div className="p-4 space-y-4">
      {/* Headline */}
      <div className="flex items-end gap-3">
        <div>
          <p className="text-2xl font-semibold text-wh-text-primary">
            {fmt(staff.grades.total)}
          </p>
          <p className="text-[10px] text-wh-text-secondary/60">
            Total headcount &mdash; {staff.year}
          </p>
        </div>
        {staff.coreGrades && (
          <div className="ml-auto text-right">
            <p className="text-sm font-semibold text-wh-text-primary">
              {fmt(staff.coreGrades.total)}
            </p>
            <p className="text-[10px] text-wh-text-secondary/60">
              Core department
            </p>
          </div>
        )}
      </div>

      {/* Stacked bar */}
      <div className="h-3 flex w-full overflow-hidden rounded-full">
        {GRADE_KEYS.map((key) => {
          const val = staff.grades[key];
          const p = pct(val, staff.grades.total);
          if (p === 0) return null;
          return (
            <div
              key={key}
              className={`${GRADE_COLOURS[key]} transition-all`}
              style={{ width: `${p}%` }}
              title={`${GRADE_LABELS[key]}: ${fmt(val)} (${p}%)`}
            />
          );
        })}
      </div>

      {/* Grade breakdown */}
      <GradeTable grades={staff.grades} label="All staff" />
      {staff.coreGrades && (
        <GradeTable grades={staff.coreGrades} label="Core department" />
      )}

      {/* Org breakdown */}
      {staff.orgs.length > 1 && (
        <div className="rounded-md border border-wh-border/50 p-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/60 mb-2.5">
            Organisation Breakdown
          </h3>
          <div className="space-y-2">
            {staff.orgs.map((org) => (
              <div key={org.orgId}>
                <div className="flex items-center justify-between">
                  <span className="min-w-0 truncate text-[11px] text-wh-text-secondary pr-3">
                    {org.label}
                  </span>
                  <span className="shrink-0 text-[11px] font-medium text-wh-text-primary">
                    {fmt(org.grades.total)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 flex w-full overflow-hidden rounded-full bg-wh-border/30">
                  <div
                    className="h-1.5 rounded-full bg-wh-accent-teal/50"
                    style={{
                      width: `${pct(org.grades.total, staff.grades.total)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Professions */}
      {Object.keys(staff.professions).length > 0 && (
        <div className="rounded-md border border-wh-border/50 p-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/60 mb-2.5">
            Profession Breakdown
          </h3>
          <div className="space-y-1.5">
            {Object.entries(staff.professions)
              .sort(([, a], [, b]) => b - a)
              .map(([profession, count]) => (
                <div
                  key={profession}
                  className="flex items-center justify-between"
                >
                  <span className="min-w-0 truncate text-[11px] capitalize text-wh-text-secondary pr-3">
                    {profession.replace(/-/g, ' ')}
                  </span>
                  <span className="shrink-0 text-[11px] font-medium text-wh-text-primary">
                    {fmt(count)}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Grade table                                                        */
/* ------------------------------------------------------------------ */

function GradeTable({
  grades,
  label,
}: {
  grades: GradeBreakdown;
  label: string;
}) {
  return (
    <div className="rounded-md border border-wh-border/50 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/60 mb-2">
        {label}
      </h3>
      <div className="space-y-1.5">
        {GRADE_KEYS.map((key) => {
          const val = grades[key];
          if (val === 0) return null;
          return (
            <div key={key} className="flex items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${GRADE_COLOURS[key]}`}
              />
              <span className="flex-1 text-[11px] text-wh-text-secondary">
                {GRADE_LABELS[key]}
              </span>
              <span className="text-[11px] font-medium text-wh-text-primary">
                {fmt(val)}
              </span>
              <span className="w-8 text-right text-[10px] text-wh-text-secondary/40">
                {pct(val, grades.total)}%
              </span>
            </div>
          );
        })}
        <div className="flex items-center gap-2 border-t border-wh-border/30 pt-1.5">
          <span className="h-2 w-2 shrink-0" />
          <span className="flex-1 text-[11px] font-medium text-wh-text-secondary">
            Total
          </span>
          <span className="text-[11px] font-semibold text-wh-text-primary">
            {fmt(grades.total)}
          </span>
          <span className="w-8" />
        </div>
      </div>
    </div>
  );
}
