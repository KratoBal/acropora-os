import { type AuthenticatedUser } from "@acropora/types";
import { UnasConnectionService } from "./unas-connection.service.js";
export declare class UnasConnectionController {
    private readonly service;
    constructor(service: UnasConnectionService);
    get(): Promise<import("./unas-connection.types.js").UnasConnectionView>;
    replaceCredential(input: unknown, user: AuthenticatedUser): Promise<import("./unas-connection.types.js").UnasConnectionView>;
    testStoredCredential(user: AuthenticatedUser): Promise<import("./unas-connection.types.js").UnasConnectionView>;
    disable(user: AuthenticatedUser): Promise<import("./unas-connection.types.js").UnasConnectionView>;
}
