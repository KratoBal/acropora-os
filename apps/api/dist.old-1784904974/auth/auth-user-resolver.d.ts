import type { AuthenticatedUser } from "@acropora/types";
export declare class AuthUserResolver {
    private readonly logger;
    resolveDevelopmentIdentity(identity: AuthenticatedUser): Promise<AuthenticatedUser>;
    resolveExistingIdentity(identity: AuthenticatedUser): Promise<AuthenticatedUser>;
    private toAuthenticatedUser;
    private emailHash;
}
