export interface PipMirror {
  id: string;
  name: string;
  url: string;
  latencyMs?: number;
  isActive: boolean;
}

export interface Package {
  id: string;
  name: string;
  version: string;
  latestVersion?: string;
  description?: string;
  size?: string;
}
