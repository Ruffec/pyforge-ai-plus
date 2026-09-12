export interface InstalledPackage {
  name: string;
  version: string;
}

export interface EnvironmentVariable {
  key: string;
  value: string;
}

export interface PythonVersion {
  id: string;
  version: string;
  path: string;
  isActive: boolean;
  pipVersion?: string;
  packagesCount?: number;
  lastUsed?: string;
  releaseDate?: string;
  architecture?: string;
  size?: string;
  dependencies?: InstalledPackage[];
  envVars?: EnvironmentVariable[];
}
