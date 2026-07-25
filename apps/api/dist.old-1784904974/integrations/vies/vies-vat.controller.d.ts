import { ViesVatService } from "./vies-vat.service.js";
export declare class ViesVatController {
    private readonly service;
    constructor(service: ViesVatService);
    check(taxNumber: string): Promise<import("@acropora/types").ViesVatLookupResult>;
}
