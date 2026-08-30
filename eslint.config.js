/**
 * ESLint 9 flat config (Phase 1B).
 * One root config covers all workspaces; runs via `npm run lint` (CI gating).
 */
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "coverage/**",
      "package-lock.json",
      "contracts/out/**",
      "contracts/cache/**",
      "contracts/broadcast/**",
      ".git/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
      globals: { ...globals.node },
    },
    rules: {
      // Callbacks with intentionally-unused params follow the `_name` convention.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["frontend/**/*.ts", "frontend/**/*.tsx"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["frontend/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
