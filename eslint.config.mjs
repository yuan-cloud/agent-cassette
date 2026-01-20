import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // FlowFuse/Node-RED often prefer explicit types, but this is a good baseline
      "@typescript-eslint/no-explicit-any": "warn", // We are pragmatic
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
    ignores: ["dist/", "cassettes/", "node_modules/"],
  },
);
