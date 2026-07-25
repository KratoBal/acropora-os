import { type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthService } from "../auth.service.js";
export declare class AuthGuard implements CanActivate {
    private readonly reflector;
    private readonly authService;
    constructor(reflector: Reflector, authService: AuthService);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
