import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

// Run from the repository root after tsc -p apps/api/tsconfig.test.json.
// Only disposable compiled files are mutated, and every mutation is restored.
const root = "apps/api/test-dist/auth/";
const run = () =>
  spawnSync(process.execPath, ["--test", `${root}assistant-readonly.spec.js`], {
    encoding: "utf8",
  });
const mutations = [
  {
    name: "POST protection",
    expected: "POST with an assistant is 403",
    patches: [
      [
        "assistant-audit.middleware.js",
        'if (request.method !== "GET")',
        'if (request.method !== "GET" && request.method !== "POST")',
      ],
      [
        "guards/assistant-readonly.guard.js",
        'if (request.method !== "GET" || denied)',
        'if ((request.method !== "GET" && request.method !== "POST") || denied)',
      ],
    ],
  },
  {
    name: "side-effect GET denial",
    expected: "a side-effect GET is 403",
    patches: [
      [
        "assistant-readonly.policy.js",
        "route.endpoint === normalized",
        'route.endpoint === normalized && normalized !== "integrations/nav/invoices/:id"',
      ],
    ],
  },
  {
    name: "partner issuance denial",
    expected: "partners requesting issuance get 403",
    patches: [
      ["auth.service.js", 'partnerScopeOf(user).kind !== "internal"', "false"],
    ],
  },
  {
    name: "expired token rejection",
    expected: "expired assistant gets 401",
    patches: [
      [
        "assistant-audit.middleware.js",
        "session.expiresAt.getTime() <= Date.now()",
        "false",
      ],
      ["session.repository.js", "session.expiresAt.getTime() <= now", "false"],
    ],
  },
  {
    name: "employee permission parity",
    expected:
      "restricted employee and assistant receive the same permission 403",
    patches: [
      [
        "guards/permission.guard.js",
        "canActivate(context) {",
        'canActivate(context) { if (context.switchToHttp().getRequest().sessionKind === "ASSISTANT_READONLY") return true;',
      ],
    ],
  },
];
assert.equal(run().status, 0, "baseline must pass before calibration");
for (const mutation of mutations) {
  const originals = new Map();
  try {
    for (const [file, from, to] of mutation.patches) {
      const path = root + file;
      const original = readFileSync(path, "utf8");
      assert.ok(original.includes(from), `mutation target missing: ${file}`);
      originals.set(path, original);
      writeFileSync(path, original.replace(from, to));
    }
    const result = run();
    assert.notEqual(result.status, 0, `${mutation.name} was not detected`);
    assert.ok(
      result.stdout
        .split("\n")
        .some(
          (line) => line.includes("not ok") && line.includes(mutation.expected),
        ),
      `${mutation.name}: the intended calibration did not fail\n${result.stdout}\n${result.stderr}`,
    );
    console.log(`RED: ${mutation.name} — intended assertion failed`);
  } finally {
    for (const [path, original] of originals) writeFileSync(path, original);
  }
  const restored = run();
  assert.equal(
    restored.status,
    0,
    `${mutation.name}: restoration must be green\n${restored.stdout}\n${restored.stderr}`,
  );
  console.log(`GREEN: ${mutation.name} — restored suite passed`);
}
