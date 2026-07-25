import { PostalCodeService } from "./postal-code.service.js";
export declare class PostalCodeController {
    private readonly service;
    constructor(service: PostalCodeService);
    lookup(zip: string): Promise<import("@acropora/types").PostalCodeLookupResult>;
}
