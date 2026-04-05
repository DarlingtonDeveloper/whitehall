export interface ClientConfig {
  id: string;
  name: string;
  sector: string;
  description: string;
  stakeholders: Stakeholder[];
  projects: string[];
  competitors: string[];
  policyKeywords: string[];
  industryKeywords: string[];
  forwardScanQueries: string[];
  monitoringThemes: MonitoringTheme[];
  allKeywords: string[];
  scanSchedule?: string;
}

export interface Stakeholder {
  entityId: string;
  priority: 'primary' | 'secondary' | 'tertiary';
  role: string;
  notes?: string;
}

export interface MonitoringTheme {
  id: string;
  name: string;
  entityIds: string[];
  keywords: string[];
}
