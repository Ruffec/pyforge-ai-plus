import { afterEach, describe, expect, it } from 'vitest';
import {
  getCurrentMirror,
  getDependencies,
  getMirrors,
  getPlatformInfo,
  isTauri,
  listInstalledPackages,
  listVenvs,
  scanPythonVersions,
  searchPackage,
} from './tauri-api';
import { mockMirrors, mockPythonVersions, mockSearchPackages, mockVirtualEnvironments } from './mock-data';

describe('isTauri', () => {
  afterEach(() => {
    delete window.__TAURI__;
    delete window.__TAURI_INTERNALS__;
  });

  it('returns false when Tauri globals are absent', () => {
    expect(isTauri()).toBe(false);
  });

  it('returns true when __TAURI__ is present', () => {
    window.__TAURI__ = {};
    expect(isTauri()).toBe(true);
  });

  it('returns true when __TAURI_INTERNALS__ is present', () => {
    window.__TAURI_INTERNALS__ = {};
    expect(isTauri()).toBe(true);
  });
});

describe('mock data fallback', () => {
  it('getPlatformInfo falls back to navigator-based info', async () => {
    const info = await getPlatformInfo();
    expect(info.osType).toBeDefined();
    expect(info.osVersion).toBe('Unknown');
    expect(info.architecture).toBe(navigator.platform);
  });

  it('scanPythonVersions returns mock Python versions', async () => {
    const versions = await scanPythonVersions();
    expect(versions).toEqual(mockPythonVersions);
  });

  it('listVenvs returns mock virtual environments', async () => {
    const venvs = await listVenvs();
    expect(venvs).toEqual(mockVirtualEnvironments);
  });

  it('getMirrors returns mock mirrors', async () => {
    const mirrors = await getMirrors();
    expect(mirrors).toEqual(mockMirrors);
  });

  it('getCurrentMirror returns the active mock mirror', async () => {
    const mirror = await getCurrentMirror();
    expect(mirror).toEqual(mockMirrors.find((m) => m.isActive));
  });

  it('searchPackage filters mock packages by query', async () => {
    const results = await searchPackage('numpy');
    expect(results).toEqual(mockSearchPackages.filter((p) => p.name === 'numpy'));
  });

  it('listInstalledPackages returns mock installed packages', async () => {
    const packages = await listInstalledPackages('/usr/local/python3.12.4/bin/python');
    expect(packages.length).toBeGreaterThan(0);
  });

  it('getDependencies returns the dependency tree of the matching environment', async () => {
    const target = mockVirtualEnvironments[0];
    const deps = await getDependencies(target.path);
    expect(deps).toEqual(target.dependencyTree);
  });
});
