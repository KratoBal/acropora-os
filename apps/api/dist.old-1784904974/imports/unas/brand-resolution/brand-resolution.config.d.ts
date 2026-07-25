export declare const BRAND_RESOLUTION_VERSIONS: {
    readonly resolver: "brand-resolution-engine-v2";
    readonly config: "brand-resolution-config-v2";
    readonly schema: "brand-resolution-report-v2";
};
export declare const BRAND_RESOLUTION_SCORES: {
    readonly explicit: 100;
    readonly manufacturerPrefix: 82;
    readonly skuPrefix: 78;
    readonly primaryCategory: 58;
    readonly alternativeCategory: 42;
    readonly productNamePrefix: 68;
    readonly productNameToken: 50;
};
export declare const BRAND_RESOLUTION_THRESHOLDS: {
    readonly resolved: 75;
    readonly review: 40;
    readonly minimumMargin: 20;
    readonly highConfidence: 75;
    readonly mediumConfidence: 50;
    readonly lowConfidence: 1;
};
