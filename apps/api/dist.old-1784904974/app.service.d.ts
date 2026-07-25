import type { HealthResponse } from "@acropora/types";
export declare class AppService {
    getWelcome(): {
        name: string;
        message: string;
    };
    getHealth(): Promise<HealthResponse>;
}
