import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["app/vendor/**", "node_modules/**"] },
  js.configs.recommended,
  {
    files: ["app/**/*.js"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["app/sw.js"],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    files: ["scripts/**/*.js", "eslint.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
];
