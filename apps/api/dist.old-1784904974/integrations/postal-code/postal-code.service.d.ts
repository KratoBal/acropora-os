import type { PostalCodeLookupResult } from "@acropora/types";
export declare class PostalCodeService {
    private readonly logger;
    lookupCity(rawZip: string): Promise<PostalCodeLookupResult>;
}
