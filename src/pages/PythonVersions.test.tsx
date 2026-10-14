/**
 * PythonVersions 页派生状态单测：
 * findInstalledMatch —— 可安装版本卡片「已安装/可安装」双按钮状态切换的依据。
 */
import { describe, expect, it } from 'vitest';
import { findInstalledMatch } from './PythonVersions';
import type { PythonVersion } from '@/types/python-versions';

function mkVersion(version: string, path = `C:\\Python\\Python${version.replace(/\./g, '')}\\python.exe`): PythonVersion {
  return {
    id: path,
    version,
    path,
    isActive: false,
  };
}

describe('findInstalledMatch', () => {
  const installed = [mkVersion('3.14.8'), mkVersion('3.13.1')];

  it('精确版本号匹配已安装版本', () => {
    expect(findInstalledMatch('3.14.8', installed)).not.toBeNull();
    expect(findInstalledMatch('3.14.8', installed)?.version).toBe('3.14.8');
  });

  it('未安装版本返回 null（卡片显示单一「安装此版本」按钮）', () => {
    expect(findInstalledMatch('3.15.0', installed)).toBeNull();
  });

  it('忽略 patch 位差异：3.14 ≠ 3.14.8（不做前缀匹配）', () => {
    expect(findInstalledMatch('3.14', installed)).toBeNull();
  });

  it('空已安装列表时全部返回 null', () => {
    expect(findInstalledMatch('3.14.8', [])).toBeNull();
  });

  it('卸载后（列表移除条目）恢复为未安装态', () => {
    const afterUninstall = installed.filter((v) => v.version !== '3.14.8');
    expect(findInstalledMatch('3.14.8', afterUninstall)).toBeNull();
    expect(findInstalledMatch('3.13.1', afterUninstall)).not.toBeNull();
  });
});
