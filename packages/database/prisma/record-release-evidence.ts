/// Standalone release-evidence recorder for the checkpoint-7
/// ReleaseEvidence model (see schema.prisma's own doc comment on that
/// model for the full rationale). Invoked ONLY from a CI/release process
/// via `tsx packages/database/prisma/record-release-evidence.ts`
/// (`pnpm --filter @acropora/database release-evidence:record`) - this
/// file is NOT imported by any NestJS module, has no HTTP route, and is
/// unreachable from the running API. That is the entire point: the
/// checkpoint's own "most important rule" is that no general admin API
/// may let a person manually flip a row to SUCCESS - the only way to
/// create a row at all is to run this script with a real DATABASE_URL,
/// which only CI/ops possesses.
///
/// Every field is read from an environment variable, not a CLI flag -
/// this mirrors how CI naturally passes values (e.g. GitHub Actions'
/// `${{ github.sha }}`/`${{ github.run_id }}` context) and avoids shell-
/// quoting pitfalls. Every field is REQUIRED (no dev-convenience default
/// the way prisma/seed.ts's DATABASE_URL fallback has) - a release-
/// evidence row with a silently-defaulted field would undermine exactly
/// the trust this table exists to provide.
import { PrismaClient, Prisma } from "@prisma/client";

// Local literal-union mirrors of the schema.prisma enums, kept in sync by
// hand (only two tiny enums, checked against KNOWN_EVIDENCE_TYPES/
// KNOWN_STATUSES below at runtime too) - lets TypeScript narrow the
// runtime-validated env-var strings down to Prisma's actual generated
// enum type without an `as never`/`as any` escape hatch.
type EvidenceTypeValue = "INVENTORY_POSTGRES_CONCURRENCY_TEST";
type EvidenceStatusValue = "SUCCESS" | "FAILURE";

function isKnownEvidenceType(value: string): value is EvidenceTypeValue {
  return KNOWN_EVIDENCE_TYPES.has(value);
}

function isKnownStatus(value: string): value is EvidenceStatusValue {
  return KNOWN_STATUSES.has(value);
}

const REQUIRED_ENV_VARS = [
  "RELEASE_EVIDENCE_TYPE",
  "RELEASE_EVIDENCE_STATUS",
  "RELEASE_EVIDENCE_COMMIT_SHA",
  "RELEASE_EVIDENCE_WORKFLOW_RUN_ID",
  // --- Checkpoint 8: bound to GitHub Actions' own trustworthy context
  // expressions (github.repository / github.workflow / github.job /
  // github.event_name) in the calling workflow step - never a
  // freeform/user-suppliable value. See docs/INVENTORY-CONSISTENCY.md's
  // "Checkpoint 8" section for the full authenticity-model rationale.
  "RELEASE_EVIDENCE_REPOSITORY",
  "RELEASE_EVIDENCE_WORKFLOW_NAME",
  "RELEASE_EVIDENCE_JOB_NAME",
  "RELEASE_EVIDENCE_TRIGGER_EVENT",
  "RELEASE_EVIDENCE_ENVIRONMENT",
  "RELEASE_EVIDENCE_DB_ENGINE",
  "RELEASE_EVIDENCE_DB_ENGINE_VERSION",
  "RELEASE_EVIDENCE_TEST_SUITE",
  "RELEASE_EVIDENCE_STARTED_AT",
  "RELEASE_EVIDENCE_COMPLETED_AT",
] as const;

// NOTE: this script deliberately does NOT decide here whether a given
// triggerEvent/repository/environment combination is "trustworthy enough
// to unblock production activation-readiness" - it only records what CI
// truthfully observed (including for ordinary same-repo pull_request runs,
// which are legitimate test executions in their own right). That trust
// decision belongs entirely to the READER side - see
// apps/api/src/health/stock-diagnostics.service.ts's activationReadiness(),
// which is the only place allowed to treat a row as sufficient to lift the
// concurrency-test block, and which checks repository/triggerEvent/
// databaseEngineVersion in addition to commitSha. Conflating "did this
// honestly happen" (this script) with "is this acceptable for production"
// (activation-readiness) would let a stricter future policy change silently
// break this script's CI callers.

const KNOWN_EVIDENCE_TYPES = new Set(["INVENTORY_POSTGRES_CONCURRENCY_TEST"]);
const KNOWN_STATUSES = new Set(["SUCCESS", "FAILURE"]);

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `record-release-evidence: missing required environment variable ${name}. ` +
        `Every field is mandatory - see this file's own doc comment.`,
    );
  }
  return value.trim();
}

function parseDate(name: string, value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`record-release-evidence: ${name}="${value}" is not a valid ISO date-time.`);
  }
  return parsed;
}

async function main() {
  for (const name of REQUIRED_ENV_VARS) readRequiredEnv(name);

  const evidenceTypeRaw = readRequiredEnv("RELEASE_EVIDENCE_TYPE");
  if (!isKnownEvidenceType(evidenceTypeRaw)) {
    throw new Error(
      `record-release-evidence: unknown RELEASE_EVIDENCE_TYPE "${evidenceTypeRaw}" - known: ${[...KNOWN_EVIDENCE_TYPES].join(", ")}`,
    );
  }
  const evidenceType = evidenceTypeRaw;

  const statusRaw = readRequiredEnv("RELEASE_EVIDENCE_STATUS");
  if (!isKnownStatus(statusRaw)) {
    throw new Error(
      `record-release-evidence: unknown RELEASE_EVIDENCE_STATUS "${statusRaw}" - known: ${[...KNOWN_STATUSES].join(", ")}`,
    );
  }
  const status = statusRaw;

  const startedAt = parseDate("RELEASE_EVIDENCE_STARTED_AT", readRequiredEnv("RELEASE_EVIDENCE_STARTED_AT"));
  const completedAt = parseDate(
    "RELEASE_EVIDENCE_COMPLETED_AT",
    readRequiredEnv("RELEASE_EVIDENCE_COMPLETED_AT"),
  );
  if (completedAt.getTime() < startedAt.getTime()) {
    throw new Error("record-release-evidence: RELEASE_EVIDENCE_COMPLETED_AT is before STARTED_AT.");
  }

  let resultDetail: Prisma.InputJsonValue | undefined;
  const rawResultDetail = process.env.RELEASE_EVIDENCE_RESULT_DETAIL_JSON;
  if (rawResultDetail && rawResultDetail.trim()) {
    try {
      resultDetail = JSON.parse(rawResultDetail) as Prisma.InputJsonValue;
    } catch {
      throw new Error(
        "record-release-evidence: RELEASE_EVIDENCE_RESULT_DETAIL_JSON is not valid JSON.",
      );
    }
  }

  const prisma = new PrismaClient();
  try {
    const row = await prisma.releaseEvidence.create({
      data: {
        evidenceType,
        status,
        commitSha: readRequiredEnv("RELEASE_EVIDENCE_COMMIT_SHA"),
        workflowRunId: readRequiredEnv("RELEASE_EVIDENCE_WORKFLOW_RUN_ID"),
        repository: readRequiredEnv("RELEASE_EVIDENCE_REPOSITORY"),
        workflowName: readRequiredEnv("RELEASE_EVIDENCE_WORKFLOW_NAME"),
        jobName: readRequiredEnv("RELEASE_EVIDENCE_JOB_NAME"),
        triggerEvent: readRequiredEnv("RELEASE_EVIDENCE_TRIGGER_EVENT"),
        environment: readRequiredEnv("RELEASE_EVIDENCE_ENVIRONMENT"),
        databaseEngine: readRequiredEnv("RELEASE_EVIDENCE_DB_ENGINE"),
        databaseEngineVersion: readRequiredEnv("RELEASE_EVIDENCE_DB_ENGINE_VERSION"),
        testSuite: readRequiredEnv("RELEASE_EVIDENCE_TEST_SUITE"),
        startedAt,
        completedAt,
        resultDetail,
      },
    });
    console.log(
      `Recorded ReleaseEvidence ${row.id}: ${row.evidenceType} ${row.status} for commit ${row.commitSha}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
