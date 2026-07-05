import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Config mínima e pragmática: pega erros reais sem brigar com o estilo
// existente do código. Endureça as regras gradualmente.
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'app/**', 'functions/**', '*.config.*'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // O código atual usa `any` e non-null assertions extensivamente;
      // tratar como erro agora geraria milhares de falsos bloqueios.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'prefer-const': 'warn',
      'no-deprecated-api': 'off',
    },
  },
);
