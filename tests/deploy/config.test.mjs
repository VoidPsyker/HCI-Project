import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("Docker excludes every local environment file but keeps the documented template", () => {
  const patterns = read(".dockerignore").split(/\r?\n/);
  assert.ok(patterns.includes(".env*"), "root production environment files enter the image");
  assert.ok(patterns.includes("**/.env*"), "workspace environment files enter the image");
  assert.ok(patterns.includes("!.env.example"));
});

test("CI checks the built server's deployment contract independently of Vite", () => {
  const workflow = read(".github/workflows/ci.yml");
  assert.match(workflow, /npm run test:deploy/);
  assert.match(workflow, /PW_BASE_URL: http:\/\/127\.0\.0\.1:8787/);
  assert.match(workflow, /deployment-assets\.spec\.ts/);
});

test("example configuration does not supply a shared admin password", () => {
  assert.match(read(".env.example"), /^ADMIN_PASSWORD=$/m);
});
