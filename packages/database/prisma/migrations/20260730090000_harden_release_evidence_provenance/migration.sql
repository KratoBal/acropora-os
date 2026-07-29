-- Checkpoint 8: harden ReleaseEvidence with GitHub Actions' own trustworthy
-- provenance context (repository / workflowName / jobName / triggerEvent),
-- so activation-readiness can additionally reject evidence that doesn't
-- actually originate from the expected repo/workflow/job, or that comes
-- from an untrusted trigger event (e.g. a fork pull_request) - even if
-- commitSha happened to match. See schema.prisma's doc comments on the
-- ReleaseEvidence model for the full rationale.
--
-- The table has never been deployed anywhere real (it only exists in this
-- feature branch, which has never reached production, and this sandbox
-- cannot populate it via any HTTP path), so there is no real data to
-- migrate. The ADD COLUMN ... NOT NULL DEFAULT '' / DROP DEFAULT pattern
-- below is nonetheless used deliberately (rather than editing the original
-- 20260729090000 migration in place) to: (a) keep the already-accepted
-- checkpoint-7 commit's migration content immutable, and (b) demonstrate
-- the safe, additive pattern this schema would need if the table ever did
-- contain rows in a real environment.
ALTER TABLE "ReleaseEvidence" ADD COLUMN "repository" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ReleaseEvidence" ADD COLUMN "workflowName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ReleaseEvidence" ADD COLUMN "jobName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ReleaseEvidence" ADD COLUMN "triggerEvent" TEXT NOT NULL DEFAULT '';

ALTER TABLE "ReleaseEvidence" ALTER COLUMN "repository" DROP DEFAULT;
ALTER TABLE "ReleaseEvidence" ALTER COLUMN "workflowName" DROP DEFAULT;
ALTER TABLE "ReleaseEvidence" ALTER COLUMN "jobName" DROP DEFAULT;
ALTER TABLE "ReleaseEvidence" ALTER COLUMN "triggerEvent" DROP DEFAULT;
