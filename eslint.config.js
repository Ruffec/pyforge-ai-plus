import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

const tsBaseConfig = {
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      ecmaFeatures: { jsx: true },
    },
  },
  plugins: {
    '@typescript-eslint': tsPlugin,
    'react-hooks': reactHooksPlugin,
  },
  settings: {
    react: { version: '18.3' },
    'import/resolver': {
      node: {},
    },
  },
  rules: {
    ...tsPlugin.configs.recommended.rules,
    ...reactHooksPlugin.configs['recommended-latest'].rules,

    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',

    // TypeScript already performs these checks.
    'no-undef': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

    // Allow placeholder interfaces while the UI kit is being built.
    '@typescript-eslint/no-empty-object-type': 'off',

    // TypeScript validates module resolution; keep import rules for style.
    'import/no-unresolved': 'off',
    'import/named': 'off',

    // 生产日志防线：前端禁止调试性 console 输出（log/debug/info/table/trace），
    // 异常上报统一走 tauri-api.ts 的 logToFrontend 埋点；console.warn/error 仅
    // 允许在 catch 降级路径使用（日志系统不可达时的最后兜底）。
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
};

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src-tauri/target/**',
      'src-tauri/gen/**',
      '.cargo-home/**',
      '.tauri-tools/**',
      '.local-appdata/**',
      '.trae/**',
      '.verify-shots/**',
    ],
  },

  {
    settings: {
      react: { version: '18.3' },
    },
  },

  js.configs.recommended,

  reactPlugin.configs.flat.recommended,
  reactPlugin.configs.flat['jsx-runtime'],

  importPlugin.flatConfigs.recommended,

  {
    rules: {
      'import/no-unresolved': 'off',
      'import/named': 'off',
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    ...tsBaseConfig,
    languageOptions: {
      ...tsBaseConfig.languageOptions,
      parserOptions: {
        ...tsBaseConfig.languageOptions.parserOptions,
        project: './tsconfig.app.json',
      },
    },
  },

  {
    files: ['*.ts'],
    ...tsBaseConfig,
    languageOptions: {
      ...tsBaseConfig.languageOptions,
      parserOptions: {
        ...tsBaseConfig.languageOptions.parserOptions,
        project: './tsconfig.node.json',
      },
    },
  },

  {
    files: ['e2e/**/*.ts'],
    ...tsBaseConfig,
    languageOptions: {
      ...tsBaseConfig.languageOptions,
      parserOptions: {
        ...tsBaseConfig.languageOptions.parserOptions,
        project: './e2e/tsconfig.json',
      },
    },
    rules: {
      ...tsBaseConfig.rules,
      // E2E fixtures use Playwright's `use` callback, not React hooks.
      'react-hooks/rules-of-hooks': 'off',
    },
  },

  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        console: 'readonly',
        Buffer: 'readonly',
        process: 'readonly',
      },
    },
  },

  prettier,
];
