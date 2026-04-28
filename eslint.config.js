import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["dist/**", ".vext/**", "coverage/**", "node_modules/**"],
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
    },
  },
];



