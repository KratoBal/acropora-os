import type { ViesVatLookupResult } from "@acropora/types";
import { ViesVatClient } from "./vies-vat.client.js";
export declare class ViesVatService {
    private readonly client;
    constructor(client: ViesVatClient);
    check(rawTaxNumber: string): Promise<ViesVatLookupResult>;
    private mapError;
}
