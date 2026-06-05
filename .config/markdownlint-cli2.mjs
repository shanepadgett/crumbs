export default {
  config: {
    default: true,
    MD013: false,
    MD033: false,
    MD041: false,
    MD055: false,
    MD056: false,
    MD060: false,
  },
  globs: ["**/*.md"],
  ignores: ["**/node_modules/**", "external/**", ".working/**", ".pi/local/**", ".pi/git/**"],
};
