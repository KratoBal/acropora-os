import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Run after API test compilation. Production source is only temporarily changed
// for the drag calibration; all mutations are restored even when a test fails.
const api = "apps/api/test-dist/";
const service = `${api}assistant/assistant.service.js`;
const controller = `${api}assistant/assistant.controller.js`;
const widget = "apps/web/src/components/assistant/sutyerak-widget.tsx";
const run = (web = false) =>
  spawnSync(
    web ? "pnpm" : process.execPath,
    web
      ? [
          "--filter",
          "@acropora/web",
          "exec",
          "vitest",
          "run",
          "src/components/assistant/sutyerak-widget.component.test.tsx",
        ]
      : ["--test", `${api}assistant/assistant.spec.js`],
    { encoding: "utf8", timeout: 30_000 },
  );
const mutations = [
  {
    name: "partner denial",
    expected: "partner requests are 403",
    patches: [[service, 'partnerScopeOf(user).kind === "internal"', "true"]],
  },
  {
    name: "assistant POST denial",
    expected: "assistant token cannot call POST",
    patches: [
      [service, 'kind === "USER"', "true"],
      [
        `${api}auth/assistant-audit.middleware.js`,
        'request.method !== "GET"',
        'request.method !== "GET" && request.method !== "POST"',
      ],
      [
        `${api}auth/guards/assistant-readonly.guard.js`,
        'request.method !== "GET" || denied',
        '(request.method !== "GET" && request.method !== "POST") || denied',
      ],
    ],
  },
  {
    name: "flag and pilot gate",
    expected: "disabled or non-pilot employee",
    patches: [
      [
        service,
        '["true", "1"].includes(process.env.SUTYERAK_ENABLED ?? "")',
        "true",
      ],
      [service, ".includes(user.id)", ".includes(user.id) || true"],
    ],
  },
  {
    name: "token reuse",
    expected: "five consecutive questions",
    patches: [[service, "if (cached &&", "if (false && cached &&"]],
  },
  {
    name: "offline error event",
    expected: "unreachable gateway and 5xx",
    patches: [
      [
        controller,
        'response.end(JSON.stringify({ type: "error", message: ASSISTANT_ERROR }) + "\\n");',
        "response.end();",
      ],
    ],
  },
  {
    name: "drag is not a click",
    expected: "drag release does not open the panel",
    web: true,
    patches: [[widget, "suppressClick.current && event.detail !== 0", "false"]],
  },
  {
    name: "token stays off browser response",
    expected: "browser stream never includes",
    patches: [
      [
        controller,
        "response.write(value)",
        'response.write(Buffer.concat([value, Buffer.from("server-only-assistant-token")]))',
      ],
    ],
  },
];
for (const web of [false, true]) {
  const result = run(web);
  assert.equal(
    result.status,
    0,
    `Baseline failed\n${result.stdout}\n${result.stderr}`,
  );
}
for (const mutation of mutations) {
  const originals = new Map();
  try {
    for (const [path, from, to] of mutation.patches) {
      const original = readFileSync(path, "utf8");
      assert.ok(
        original.includes(from),
        `Missing target for ${mutation.name}: ${path}`,
      );
      if (!originals.has(path)) originals.set(path, original);
      writeFileSync(path, original.replace(from, to));
    }
    const result = run(mutation.web);
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0, `${mutation.name} went undetected`);
    const output = result.stdout + result.stderr;
    assert.ok(
      output
        .split("\n")
        .some(
          (line) =>
            line.includes(mutation.expected) &&
            (mutation.web || line.includes("not ok")),
        ),
      `Wrong failure for ${mutation.name}\n${output}`,
    );
    console.log(`RED: ${mutation.name} — intended test failed`);
  } finally {
    for (const [path, original] of originals) writeFileSync(path, original);
  }
  const restored = run(mutation.web);
  assert.equal(
    restored.status,
    0,
    `${mutation.name} restoration failed\n${restored.stdout}\n${restored.stderr}`,
  );
  console.log(`GREEN: ${mutation.name} — restored suite passed`);
}
