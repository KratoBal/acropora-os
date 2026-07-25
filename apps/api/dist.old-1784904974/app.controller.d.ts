import type { HealthResponse } from "@acropora/types";
import { AppService } from "./app.service.js";
export declare class AppController {
    private readonly appService;
    constructor(appService: AppService);
    getWelcome(): {
        name: string;
        message: string;
    };
    getHealth(): Promise<HealthResponse>;
}
