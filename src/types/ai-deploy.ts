export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: Date;
}

export interface Dependency {
  name: string;
  version: string;
}

export type DeploymentStepStatus = 'pending' | 'in-progress' | 'completed' | 'failed';

export interface DeploymentStep {
  id: string;
  label: string;
  description: string;
  status: DeploymentStepStatus;
}

export interface DeploymentPlan {
  pythonVersion: string;
  dependencies: Dependency[];
  commands: string[];
  steps: DeploymentStep[];
}

export interface ProjectAnalysis {
  name: string;
  type: string;
  pythonVersion: string;
  dependencyFile: string;
  dependencyCount: number;
  size: string;
}

export interface Recommendation {
  id: string;
  icon: string;
  title: string;
  description: string;
  applied: boolean;
}
