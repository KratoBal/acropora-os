var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var PostalCodeService_1;
import { Injectable, Logger } from "@nestjs/common";
const LOOKUP_BASE_URL = "https://hur.webmania.cc/zips";
let PostalCodeService = PostalCodeService_1 = class PostalCodeService {
    logger = new Logger(PostalCodeService_1.name);
    async lookupCity(rawZip) {
        const zip = rawZip.trim();
        if (!/^\d{4}$/.test(zip))
            return { city: null };
        try {
            const response = await fetch(`${LOOKUP_BASE_URL}/${zip}.json`, {
                signal: AbortSignal.timeout(5_000),
            });
            if (!response.ok)
                return { city: null };
            const payload = (await response.json());
            const match = payload.zips?.find((entry) => entry.zip === zip);
            return { city: match?.name ?? payload.zips?.[0]?.name ?? null };
        }
        catch (error) {
            this.logger.warn(`Postal code lookup failed for ${zip}: ${error instanceof Error ? error.message : "unknown error"}`);
            return { city: null };
        }
    }
};
PostalCodeService = PostalCodeService_1 = __decorate([
    Injectable()
], PostalCodeService);
export { PostalCodeService };
//# sourceMappingURL=postal-code.service.js.map