import type { AuthenticatedUser, Session } from "@acropora/types";
import { AuthUserResolver } from "./auth-user-resolver.js";
export declare class AuthService {
    private readonly users;
    private readonly sessions;
    constructor(users: AuthUserResolver);
    loginWithDevelopmentUser(email: string): Promise<Session>;
    resolveToken(token: string): Promise<AuthenticatedUser>;
    logout(token: string): void;
}
