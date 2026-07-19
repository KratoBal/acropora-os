export const BRAND_RESOLUTION_VERSIONS = {
  resolver: "brand-resolution-engine-v2",
  config: "brand-resolution-config-v2",
  schema: "brand-resolution-report-v2",
} as const;

export const BRAND_RESOLUTION_SCORES = {
  explicit: 100,
  manufacturerPrefix: 82,
  skuPrefix: 78,
  primaryCategory: 58,
  alternativeCategory: 42,
  productNamePrefix: 68,
  productNameToken: 50,
} as const;

export const BRAND_RESOLUTION_THRESHOLDS = {
  resolved: 75,
  review: 40,
  minimumMargin: 20,
  highConfidence: 75,
  mediumConfidence: 50,
  lowConfidence: 1,
} as const;
