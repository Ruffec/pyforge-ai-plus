import type React from 'react';

export type EnvironmentStatus = 'active' | 'idle' | 'update-available';

export interface StatCardData {
  label: string;
  value: string;
  suffix?: string;
  icon: string;
  trend?: string;
}

export interface EnvironmentSummary {
  id: string;
  name: string;
  pythonVersion: string;
  status: EnvironmentStatus;
  packageCount: number;
  lastUsed: string;
}

export interface ActivityItem {
  id: string;
  title: React.ReactNode;
  timestamp: string;
  variant?: 'primary' | 'muted';
}

export interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: string;
  to: string;
}

export interface AiSuggestion {
  id: string;
  content: React.ReactNode;
  actions: {
    primary: string;
    secondary: string;
  };
}
