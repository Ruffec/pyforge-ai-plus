#!/usr/bin/env node
/**
 * 生成 Tauri 自动更新所需的 minisign 兼容 Ed25519 密钥对。
 *
 * 输出：
 * - src-tauri/updates/pyforge-ai.pub   公钥（base64，写入 tauri.conf.json 的 pubkey 字段）
 * - .env                               环境变量 TAURI_SIGNING_PRIVATE_KEY
 * - src-tauri/updates/private.key      私钥备份（**不要提交到 Git**）
 *
 * 通过官方 @tauri-apps/cli（devDependency，预编译二进制，无需 MSVC/GCC/cargo）
 * 生成，保证与 Tauri updater 完全兼容。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const updatesDir = path.join(rootDir, 'src-tauri', 'updates');
const privateKeyPath = path.join(updatesDir, 'private.key');
const generatedPubKeyPath = `${privateKeyPath}.pub`;
const publicKeyPath = path.join(updatesDir, 'pyforge-ai.pub');
const envPath = path.join(rootDir, '.env');

if (!fs.existsSync(updatesDir)) {
  fs.mkdirSync(updatesDir, { recursive: true });
}

console.log('Generating minisign-compatible Ed25519 key pair via tauri-cli...\n');

const quotedPath = `"${privateKeyPath}"`;
const args = ['tauri', 'signer', 'generate', '--ci', '--force', '-w', quotedPath];
const result = spawnSync('npx', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.status !== 0) {
  console.error('❌ Failed to generate keys via "tauri signer generate".');
  process.exit(result.status ?? 1);
}

// minisign 密钥文件格式：注释行 + base64 密钥行
const readKeyLine = (filePath) => {
  const content = fs.readFileSync(filePath, 'utf-8');
  const keyLine = content
    .split(/\r?\n/)
    .find((line) => line.trim() && !line.startsWith('untrusted comment'));
  if (!keyLine) {
    console.error(`❌ No key found in ${filePath}`);
    process.exit(1);
  }
  return keyLine.trim();
};

const publicKeyBase64 = readKeyLine(generatedPubKeyPath);
const secretKeyBase64 = readKeyLine(privateKeyPath);
fs.rmSync(generatedPubKeyPath); // 中间产物，公钥已写入 pyforge-ai.pub

fs.writeFileSync(publicKeyPath, publicKeyBase64 + '\n');

const envLines = [];
if (fs.existsSync(envPath)) {
  const existing = fs.readFileSync(envPath, 'utf-8');
  const filtered = existing
    .split('\n')
    .filter((line) => !line.startsWith('TAURI_SIGNING_PRIVATE_KEY='));
  envLines.push(...filtered);
}
envLines.push(`TAURI_SIGNING_PRIVATE_KEY=${secretKeyBase64}`);
fs.writeFileSync(envPath, envLines.join('\n') + '\n');

console.log(`✅ Public key:  ${publicKeyPath}`);
console.log(`✅ Private key: ${privateKeyPath}  (DO NOT COMMIT)`);
console.log(`✅ Environment: ${envPath}  (DO NOT COMMIT)\n`);
console.log(
  'Paste the following line into src-tauri/tauri.conf.json under plugins.updater.pubkey:'
);
console.log(publicKeyBase64);
console.log(
  '\nIn CI, set the GitHub secret TAURI_SIGNING_PRIVATE_KEY to the value in .env'
);
