#!/usr/bin/env node
/**
 * 检查 PyForge AI 开发环境是否满足前置条件。
 *
 * 检查项：
 * - Node.js >= 20
 * - npm >= 10
 * - Rust / cargo
 * - Tauri CLI
 * - C 编译器（Windows: cl.exe 或 gcc；macOS/Linux: cc/clang/gcc）
 *
 * 用法：
 *   node scripts/check-env.js
 */

import { execSync } from 'node:child_process';
import process from 'node:process';

const MIN_NODE = 20;
const MIN_NPM = 10;

function check(name, command, versionRegex = /(\d+\.\d+(?:\.\d+)?)/) {
  try {
    const output = execSync(command, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const match = output.match(versionRegex);
    const version = match ? match[1] : output.split(/\r?\n/)[0];
    console.log(`  ✅ ${name}: ${version}`);
    return true;
  } catch {
    console.log(`  ❌ ${name}: 未找到或运行失败`);
    return false;
  }
}

function checkNode() {
  const version = process.versions.node;
  const major = parseInt(version.split('.')[0], 10);
  if (major >= MIN_NODE) {
    console.log(`  ✅ Node.js: ${version}`);
    return true;
  }
  console.log(`  ❌ Node.js: ${version}（需要 >= ${MIN_NODE}）`);
  return false;
}

function checkNpm() {
  try {
    const output = execSync('npm --version', { encoding: 'utf-8' }).trim();
    const major = parseInt(output.split('.')[0], 10);
    if (major >= MIN_NPM) {
      console.log(`  ✅ npm: ${output}`);
      return true;
    }
    console.log(`  ❌ npm: ${output}（需要 >= ${MIN_NPM}）`);
    return false;
  } catch {
    console.log('  ❌ npm: 未找到');
    return false;
  }
}

console.log('🔍 检查 PyForge AI 开发环境...\n');

const results = [];

results.push(checkNode());
results.push(checkNpm());
results.push(check('Rust', 'rustc --version'));
results.push(check('Cargo', 'cargo --version'));
results.push(check('Tauri CLI', 'cargo tauri --version', /tauri-cli (\d+\.\d+(?:\.\d+)?)/));

const platform = process.platform;
let cCompilerFound = false;
if (platform === 'win32') {
  cCompilerFound =
    check('C 编译器 (cl)', 'cl.exe', /版本\s+(\d+\.\d+(?:\.\d+)?)/) ||
    check('C 编译器 (gcc)', 'gcc --version');
} else if (platform === 'darwin') {
  cCompilerFound = check('C 编译器 (clang)', 'clang --version') || check('C 编译器 (gcc)', 'gcc --version');
} else {
  cCompilerFound =
    check('C 编译器 (gcc)', 'gcc --version') || check('C 编译器 (clang)', 'clang --version');
}
results.push(cCompilerFound);

console.log('');
if (results.every(Boolean)) {
  console.log('✅ 环境检查通过，可以运行 npm run tauri:dev 和 cargo tauri build。');
  process.exit(0);
} else {
  console.log('❌ 环境检查未通过。请参考 docs/DEVELOPMENT.md 安装缺失依赖。');
  console.log('   Windows 用户需安装 Microsoft C++ Build Tools 或 MinGW-w64。');
  console.log('   也可直接使用 VS Code Dev Container（.devcontainer/）获得完整环境。');
  process.exit(1);
}
