import type { UnasApplySummary, UnasApprovalResult } from "@acropora/types";
import type { ApproveUnasImportDto } from "./dto/approve-unas-import.dto.js";
import { UnasApplyRepository } from "./unas-apply.repository.js";
export declare class UnasApplyService {
    private readonly repository;
    constructor(repository: UnasApplyRepository);
    approve(batchId: string, input: ApproveUnasImportDto, actorId: string): Promise<UnasApprovalResult>;
    apply(batchId: string, actorId: string): Promise<UnasApplySummary>;
}
