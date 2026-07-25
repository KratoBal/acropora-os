var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (value && typeof value === "object")
        return Object.fromEntries(Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, canonical(item)]));
    return value;
}
let UnasProductCanonicalizer = class UnasProductCanonicalizer {
    canonicalize(product) {
        const canonicalPayload = canonical(product);
        return {
            ...product,
            canonicalHash: createHash("sha256")
                .update(JSON.stringify(canonicalPayload))
                .digest("hex"),
        };
    }
};
UnasProductCanonicalizer = __decorate([
    Injectable()
], UnasProductCanonicalizer);
export { UnasProductCanonicalizer };
//# sourceMappingURL=unas-product-canonicalizer.js.map