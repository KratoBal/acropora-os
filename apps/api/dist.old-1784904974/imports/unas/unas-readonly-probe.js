import { UnasApiError, } from "./unas-api.client.js";
export const DEFAULT_UNAS_PROBE_PAGE_SIZE = 10;
export const MAX_UNAS_PROBE_PAGE_SIZE = 100;
export const MAX_UNAS_PROBE_PAGES = 2;
export class UnasProbeError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
        this.name = "UnasProbeError";
    }
}
const countPresent = (rows, predicate) => rows.reduce((count, row) => count + Number(predicate(row)), 0);
async function fetchPages(pages, pageSize, fetchPage) {
    const rows = [];
    for (let page = 0; page < pages; page += 1) {
        const pageRows = await fetchPage(page * pageSize, pageSize);
        rows.push(...pageRows);
        if (pageRows.length < pageSize)
            break;
    }
    return rows;
}
async function protectedCall(stage, operation) {
    try {
        return await operation();
    }
    catch (error) {
        const reason = error instanceof UnasApiError ? error.code : "FAILED";
        throw new UnasProbeError(`UNAS_PROBE_${stage}_${reason}`);
    }
}
function assertPermission(login, permission, stage) {
    if (login.permissions == null)
        return;
    if (!login.permissions.includes(permission))
        throw new UnasProbeError(`UNAS_PROBE_${stage}_PERMISSION_MISSING`);
}
export function parseUnasProbeOptions(argv) {
    let pageSize = DEFAULT_UNAS_PROBE_PAGE_SIZE;
    let pages = 1;
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const [flag, inlineValue] = argument.split("=", 2);
        if (flag !== "--page-size" && flag !== "--pages")
            throw new UnasProbeError("UNAS_PROBE_INVALID_ARGUMENT");
        const rawValue = inlineValue ?? argv[++index];
        if (!rawValue || !/^\d+$/.test(rawValue))
            throw new UnasProbeError("UNAS_PROBE_INVALID_ARGUMENT");
        const parsed = Number(rawValue);
        if (!Number.isSafeInteger(parsed))
            throw new UnasProbeError("UNAS_PROBE_INVALID_ARGUMENT");
        if (flag === "--page-size")
            pageSize = parsed;
        else
            pages = parsed;
    }
    if (pageSize < 1 || pageSize > MAX_UNAS_PROBE_PAGE_SIZE)
        throw new UnasProbeError("UNAS_PROBE_INVALID_ARGUMENT");
    if (pages < 1 || pages > MAX_UNAS_PROBE_PAGES)
        throw new UnasProbeError("UNAS_PROBE_INVALID_ARGUMENT");
    return { pageSize, pages };
}
export function normalizeUnasProbeError(error) {
    return error instanceof UnasProbeError ? error.code : "UNAS_PROBE_FAILED";
}
export async function runUnasReadonlyProbe(client, options, now = Date.now) {
    const startedAt = now();
    const apiKey = process.env.UNAS_API_KEY?.trim();
    if (!apiKey)
        throw new UnasProbeError("UNAS_PROBE_API_KEY_MISSING");
    const token = await protectedCall("LOGIN", () => client.login(apiKey));
    assertPermission(token, "getCategory", "CATEGORY");
    const categories = await protectedCall("CATEGORY", () => fetchPages(options.pages, options.pageSize, (limitStart, limitNum) => client.getCategoryPage(token.token, {
        limitStart,
        limitNum,
        contentType: "normal",
    })));
    assertPermission(token, "getProduct", "LIVE");
    const liveProducts = await protectedCall("LIVE", () => fetchPages(options.pages, options.pageSize, (limitStart, limitNum) => client.getProductPage(token.token, {
        limitStart,
        limitNum,
        state: "live",
        contentType: "full",
    })));
    const deletedProducts = await protectedCall("DELETED", () => fetchPages(options.pages, options.pageSize, (limitStart, limitNum) => client.getProductPage(token.token, {
        limitStart,
        limitNum,
        state: "deleted",
        contentType: "full",
    })));
    const productPresence = (rows, predicate) => countPresent(rows, predicate);
    const sourceModifiedTimes = [
        ...categories,
        ...liveProducts,
        ...deletedProducts,
    ]
        .map((row) => row.sourceUpdatedAt)
        .filter((value) => value !== null)
        .sort();
    return {
        ok: true,
        counts: {
            category: categories.length,
            live: liveProducts.length,
            deleted: deletedProducts.length,
        },
        fieldPresence: {
            stableId: {
                category: countPresent(categories, (row) => row.externalId.length > 0),
                live: productPresence(liveProducts, (row) => row.externalId.length > 0),
                deleted: productPresence(deletedProducts, (row) => row.externalId.length > 0),
            },
            lastModTime: {
                category: countPresent(categories, (row) => row.sourceUpdatedAt !== null),
                live: productPresence(liveProducts, (row) => row.sourceUpdatedAt !== null),
                deleted: productPresence(deletedProducts, (row) => row.sourceUpdatedAt !== null),
            },
            price: {
                live: productPresence(liveProducts, hasPrice),
                deleted: productPresence(deletedProducts, hasPrice),
            },
            reportedStock: {
                live: productPresence(liveProducts, (row) => row.reportedStock !== null),
                deleted: productPresence(deletedProducts, (row) => row.reportedStock !== null),
            },
            secondaryUnit: {
                live: productPresence(liveProducts, hasSecondaryUnit),
                deleted: productPresence(deletedProducts, hasSecondaryUnit),
            },
            categoryFields: {
                live: productPresence(liveProducts, hasCategoryFields),
                deleted: productPresence(deletedProducts, hasCategoryFields),
            },
        },
        sourceModifiedAt: {
            minimum: sourceModifiedTimes[0] ?? null,
            maximum: sourceModifiedTimes.at(-1) ?? null,
        },
        durationMs: Math.max(0, now() - startedAt),
    };
}
function hasPrice(product) {
    return [
        product.netPrice,
        product.grossPrice,
        product.saleNetPrice,
        product.saleGrossPrice,
    ].some((value) => value !== null);
}
function hasSecondaryUnit(product) {
    return product.secondaryUnit !== null || product.secondaryUnitFactor !== null;
}
function hasCategoryFields(product) {
    return (product.primaryCategoryExternalId !== null ||
        product.alternativeCategoryExternalIds.length > 0);
}
//# sourceMappingURL=unas-readonly-probe.js.map