export interface WarehouseLookupDatabase {
    warehouse: {
        findFirst(args: unknown): Promise<{
            id: string;
            name: string;
        } | null>;
        create(args: unknown): Promise<{
            id: string;
            name: string;
        }>;
    };
}
export declare function ensureMainWarehouse(database: WarehouseLookupDatabase): Promise<{
    id: string;
    name: string;
}>;
