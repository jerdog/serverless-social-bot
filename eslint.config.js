// ESLint flat config (ESLint 9+). Replaces the legacy .eslintrc.yml.
import js from '@eslint/js';
import globals from 'globals';

export default [
    // Global ignores (node_modules is ignored by default).
    {
        ignores: ['.wrangler/**', 'coverage/**', 'dist/**', 'build/**']
    },
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node
            }
        },
        rules: {
            indent: ['error', 4, { SwitchCase: 1 }],
            'linebreak-style': ['error', 'unix'],
            quotes: ['error', 'single', { avoidEscape: true }],
            semi: ['error', 'always'],
            // caughtErrors: 'none' preserves the pre-flat-config behavior (ESLint 8
            // did not flag unused catch bindings; ESLint 9 changed the default).
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
            'no-constant-condition': ['error', { checkLoops: false }],
            'no-console': 'off'
        }
    }
];
