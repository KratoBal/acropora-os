import { type StoredUnasVerificationStatus, type UnasConnectionErrorCode, type UnasConnectionSettingRecord, type UnasCredentialEnvelope } from "./unas-connection.types.js";
type CooldownOperation = "test" | "credential";
export interface ManualTestPersistenceResult {
    setting: UnasConnectionSettingRecord;
    stale: boolean;
}
export declare class UnasConnectionRepository {
    getSetting(): Promise<UnasConnectionSettingRecord | null>;
    claimCooldown(operation: CooldownOperation): Promise<UnasConnectionSettingRecord | null>;
    replaceCredential(input: {
        envelope: UnasCredentialEnvelope;
        revision: number;
        actorUserId: string;
        verifiedAt: Date;
        verificationStatus: "SUCCESS" | "INDETERMINATE";
        verificationCode: UnasConnectionErrorCode | null;
    }): Promise<UnasConnectionSettingRecord>;
    disable(actorUserId: string, now: Date): Promise<UnasConnectionSettingRecord>;
    recordManualTest(input: {
        actorUserId: string;
        checkedAt: Date;
        status: Exclude<StoredUnasVerificationStatus, "NEVER">;
        code: UnasConnectionErrorCode | null;
        expectedCredentialMode: UnasConnectionSettingRecord["credentialMode"];
        expectedCredentialRevision: number;
    }): Promise<ManualTestPersistenceResult>;
    auditCredentialValidationFailure(actorUserId: string, code: UnasConnectionErrorCode): Promise<void>;
}
export {};
