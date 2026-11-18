import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * THE IMAGE PUBLICATION WORKFLOW AND THE DOCKERFILES IT BUILDS (task t-20261117-ghcr-kepek, card 0529e916). The workflow cannot run here, and a
 * mistake in it would show only on the first push to main, after the owner pushed it; what can be measured now is its shape against the files it
 * depends on.
 *
 * WHAT TURNS RED: a trigger other than the CI's success on main (an image for an unchecked commit); a `latest` tag; a secret other than the
 * built-in token, or a literal address in place of the repository variable; a web or partner image without the API_URL guard that stops on an
 * empty value; a matrix entry whose Dockerfile is missing; a build argument the Dockerfile does not declare (it would be silently ignored); the api
 * Dockerfile without the runtime RELEASE_COMMIT_SHA default.
 */
const root = (path: string) => new URL(`../../../../${path}`, import.meta.url);
const read = (path: string) => readFileSync(root(path), "utf8");
const WORKFLOW = read(".github/workflows/images.yml");
// comment lines are the file's explanation, not its behaviour
const CODE = WORKFLOW.replace(/^\s*#.*$/gm, "");

describe("images.yml", () => {
  it("publishes only after the CI succeeded for a push to main, with the built-in token and nothing else secret", () => {
    assert.match(
      CODE,
      /workflow_run:\s*\n\s*workflows: \["CI"\]\s*\n\s*types: \[completed\]\s*\n\s*branches: \[main\]/,
    );
    assert.match(CODE, /workflow_run\.conclusion == 'success'/);
    assert.match(CODE, /workflow_run\.event == 'push'/);
    assert.match(CODE, /packages: write/);
    assert.match(CODE, /contents: read/);
    const secrets = [...CODE.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map(
      (m) => m[1],
    );
    assert.deepEqual([...new Set(secrets)], ["GITHUB_TOKEN"]);
  });

  it("CONTROL: the tag is the full commit, never latest, and the build checks out that commit", () => {
    assert.match(
      CODE,
      /tags: .*:sha-\$\{\{ github\.event\.workflow_run\.head_sha \}\}/,
    );
    // `ubuntu-latest` (the runner) is fine; a `latest` IMAGE tag is not
    assert.doesNotMatch(CODE, /:latest\b/);
    assert.match(
      CODE,
      /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/,
    );
  });

  it("the five images: one api, web and partner per environment, the address from repository variables only, never typed in", () => {
    const images = [...CODE.matchAll(/image: (acropora-os-[a-z-]+)/g)].map(
      (m) => m[1],
    );
    assert.deepEqual(images, [
      "acropora-os-api",
      "acropora-os-web-stage",
      "acropora-os-web-prod",
      "acropora-os-partner-stage",
      "acropora-os-partner-prod",
    ]);
    const urls = [...CODE.matchAll(/api_url: (.*)$/gm)].map((m) =>
      m[1]!.trim(),
    );
    assert.deepEqual(urls, [
      '""',
      "${{ vars.STAGE_API_URL }}",
      "${{ vars.PROD_API_URL }}",
      "${{ vars.STAGE_API_URL }}",
      "${{ vars.PROD_API_URL }}",
    ]);
    assert.doesNotMatch(CODE, /API_URL=https?:\/\//);
  });

  it("CONTROL: an empty API_URL stops web and partner before the build, and api is exempt", () => {
    const guard =
      /- name: Require the API_URL[\s\S]*?if: matrix\.app != 'api'[\s\S]*?if \[ -z "\$API_URL" \]; then[\s\S]*?exit 1/;
    assert.match(CODE, guard);
    // the guard comes first, before the checkout and the build
    assert.ok(
      CODE.indexOf("Require the API_URL") < CODE.indexOf("actions/checkout"),
    );
    assert.ok(
      CODE.indexOf("actions/checkout") <
        CODE.indexOf("docker/build-push-action"),
    );
  });

  it("every Dockerfile it builds exists, and declares the build arguments the workflow passes", () => {
    const apps = [
      ...new Set([...CODE.matchAll(/- app: ([a-z]+)/g)].map((m) => m[1]!)),
    ];
    assert.deepEqual(apps.sort(), ["api", "partner", "web"]);
    for (const app of apps) {
      const dockerfile = read(`apps/${app}/Dockerfile`);
      for (const arg of ["RELEASE_COMMIT_SHA", "OS_PATCH_EPOCH"])
        assert.match(
          dockerfile,
          new RegExp(`^ARG ${arg}`, "m"),
          `${app}: ARG ${arg}`,
        );
      if (app !== "api")
        assert.match(dockerfile, /^ARG API_URL/m, `${app}: ARG API_URL`);
    }
    // api has no API_URL: passing it would be silently ignored, so the workflow passes it only when it is set (and it is empty for api)
    assert.doesNotMatch(read("apps/api/Dockerfile"), /^ARG API_URL/m);
    assert.match(CODE, /if \[ -n "\$API_URL" \]; then echo "API_URL=/);
  });
});

describe("the api Dockerfile", () => {
  it("also sets the runtime RELEASE_COMMIT_SHA from the build argument, next to the image commit", () => {
    const dockerfile = read("apps/api/Dockerfile");
    assert.match(
      dockerfile,
      /^ENV RELEASE_IMAGE_COMMIT_SHA=\$\{RELEASE_COMMIT_SHA\}$/m,
    );
    assert.match(
      dockerfile,
      /^ENV RELEASE_COMMIT_SHA=\$\{RELEASE_COMMIT_SHA\}$/m,
    );
  });
});
