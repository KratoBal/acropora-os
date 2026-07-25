import type { AuthenticatedUser, Session } from "@acropora/types";
import { AuthService } from "./auth.service.js";
import type { AuthenticatedRequest, DevelopmentLoginDto } from "./auth.types.js";
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    getCurrentUser(user: AuthenticatedUser): AuthenticatedUser;
    login(body: DevelopmentLoginDto): Promise<Session>;
    logout(request: AuthenticatedRequest): {
        success: boolean;
    };
}
