import { NavTaxpayerService } from "./nav-taxpayer.service.js";
export declare class NavTaxpayerController {
    private readonly service;
    constructor(service: NavTaxpayerService);
    lookup(taxNumber: string): Promise<import("@acropora/types").NavTaxpayerLookupResult>;
}
