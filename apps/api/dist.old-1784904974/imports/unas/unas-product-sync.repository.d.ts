import { Prisma, Repository } from "@acropora/database";
import type { UnasApiCategory, UnasProductIdentitySnapshot, UnasProductSyncDiff, UnasProductSyncSummary } from "@acropora/types";
export declare class UnasProductSyncRepository extends Repository {
    constructor();
    getCursor(): Promise<Date | null>;
    createRun(input: {
        kind: "FULL" | "INCREMENTAL";
        windowStart: Date | null;
        windowEnd: Date;
    }): Promise<string>;
    heartbeat(runId: string): Promise<void>;
    getRun(runId: string): Promise<{
        id: string;
        status: import("@prisma/client").$Enums.UnasProductSyncRunStatus;
        completedAt: Date | null;
        kind: import("@prisma/client").$Enums.UnasProductSyncKind;
        windowStart: Date | null;
        windowEnd: Date;
        startedAt: Date | null;
        productsSeen: number;
        createdCount: number;
        updatedCount: number;
        unchangedCount: number;
        conflictCount: number;
        missingCount: number;
        errorCode: string | null;
    }>;
    listRuns(limit: number): Prisma.PrismaPromise<{
        id: string;
        status: import("@prisma/client").$Enums.UnasProductSyncRunStatus;
        completedAt: Date | null;
        kind: import("@prisma/client").$Enums.UnasProductSyncKind;
        windowStart: Date | null;
        windowEnd: Date;
        startedAt: Date | null;
        productsSeen: number;
        createdCount: number;
        updatedCount: number;
        unchangedCount: number;
        conflictCount: number;
        missingCount: number;
        errorCode: string | null;
    }[]>;
    identitySnapshots(): Promise<UnasProductIdentitySnapshot[]>;
    markFailed(runId: string, errorCode: string): Promise<void>;
    apply(runId: string, diffs: readonly UnasProductSyncDiff[], windowStart: Date | null, windowEnd: Date, categories: readonly UnasApiCategory[], deletedExternalIds: readonly string[]): Promise<UnasProductSyncSummary>;
}
