import { UnasSyncRunsQueryDto } from "./dto/unas-sync-runs-query.dto.js";
import { UnasAuthService } from "./unas-auth.service.js";
import { UnasProductSyncRepository } from "./unas-product-sync.repository.js";
import { UnasProductSyncService } from "./unas-product-sync.service.js";
export declare class UnasProductSyncController {
    private readonly auth;
    private readonly sync;
    private readonly repository;
    constructor(auth: UnasAuthService, sync: UnasProductSyncService, repository: UnasProductSyncRepository);
    run(): Promise<import("@acropora/types").UnasProductSyncSummary>;
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
    listRuns(query: UnasSyncRunsQueryDto): import("@prisma/client").Prisma.PrismaPromise<{
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
}
