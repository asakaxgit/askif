// Style rules for this library's own source. Users of askif can write their code any way they like.
import tseslint from "typescript-eslint";

const restricted = (selector, message) => ({ selector, message });

export default [
  { ignores: ["dist/", "node_modules/"] },
  ...tseslint.configs.strict,
  {
    rules: {
      // `type`, never `interface`.
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      // No `as` casts. `as const` is still allowed; use `satisfies` to check shapes.
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/no-non-null-assertion": "error",
      // Arrow functions only.
      "func-style": ["error", "expression"],
      "prefer-arrow-callback": "error",
      "no-restricted-syntax": [
        "error",
        restricted("TSEnumDeclaration", "Use a union of string literals instead of enum."),
        restricted("FunctionDeclaration", "Use an arrow function."),
        restricted("FunctionExpression", "Use an arrow function."),
        restricted("ClassDeclaration", "Use plain objects and closures instead of classes."),
        restricted("ClassExpression", "Use plain objects and closures instead of classes."),
      ],
    },
  },
];
