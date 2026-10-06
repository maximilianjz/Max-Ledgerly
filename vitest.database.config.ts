import { defineConfig } from "vitest/config";
import base from "./vitest.config.ts";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["tests/postgres.integration.test.ts"],
    exclude: [],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
