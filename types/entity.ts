export interface Entity {
  id: string;
  name: string;
  category: "official" | "department" | "body" | "group";
  subtype: string;
  description: string;
  role?: string;
  currentHolder?: string;
  infoUrl?: string;
  parentIds: string[];
  secondaryParentIds?: string[];
  tags?: string[];
  jurisdictions?: string[];
}

export interface Tag {
  id: string;
  label: string;
  tagCategory: "type" | "sector";
  colour: string;
}

export interface PowerRecord {
  elementId: string;
  lastReviewed: string;
  powers: Power[];
}

export interface Power {
  id: string;
  title: string;
  description: string;
  powerType: "power" | "duty" | "function" | "responsibility";
  inForceFrom: string;
  sources: PowerSource[];
  notes?: string;
}

export interface PowerSource {
  type: "act" | "statutory-instrument" | "prerogative" | "case-law" | "convention";
  title: string;
  year?: number;
  section?: string;
  legislationUrl?: string;
  caseRef?: string;
  notes?: string;
}

export interface BudgetProfile {
  elementId: string;
  oscarDeptGroupCode: string;
  budgets: Budget[];
}

export interface Budget {
  financialYear: string;
  totalNetExpenditure: number;
  totalGrossExpenditure: number;
  totalIncome: number;
  unit: "thousands";
  delAdmin: number;
  delProg: number;
  deptAme: number;
  nonDeptAme: number;
  expenditureLines: { label: string; amount: number }[];
  incomeLines: { label: string; amount: number }[];
  programmeLines: { label: string; amount: number }[];
  programmeIncomeLines: { label: string; amount: number }[];
  bodyLines: { label: string; amount: number; elementId?: string }[];
  bodyIncomeLines: { label: string; amount: number; elementId?: string }[];
  annualReportUrl: string | null;
  sourceLabel: string;
}

export interface StaffProfile {
  elementId: string;
  year: string;
  grades: GradeBreakdown;
  coreGrades?: GradeBreakdown;
  orgs: OrgBreakdown[];
  professions: Record<string, number>;
  coreProfessions?: Record<string, number>;
}

export interface GradeBreakdown {
  scs: number;
  g67: number;
  sheo: number;
  eo: number;
  aaao: number;
  other: number;
  total: number;
}

export interface OrgBreakdown {
  orgId: string;
  label: string;
  grades: GradeBreakdown;
}

export interface Jurisdiction {
  label: string;
  shortLabel: string;
  description?: string;
}

export interface EntityColour {
  hex: string;
  label: string;
}

export type EntityColourMap = Record<string, Record<string, EntityColour>>;
