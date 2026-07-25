import { child, children, value } from "./nav-xml.util.js";
const UNIT_LABELS = {
    PIECE: "db",
    KILOGRAM: "kg",
    TON: "t",
    LITRE: "l",
    KWH: "kWh",
    DAY: "nap",
    HOUR: "óra",
    MONTH: "hónap",
    YEAR: "év",
    CARTON: "karton",
    PACK: "csomag",
    METER: "m",
    LINEAR_METER: "fm",
    CUBIC_METER: "m3",
    MILLIGRAM: "mg",
    TONNE: "t",
    MILLILITER: "ml",
    BOX: "doboz",
};
function unitLabel(node) {
    const ownUnit = value(node, "unitOfMeasureOwn");
    if (ownUnit)
        return ownUnit;
    const code = value(node, "unitOfMeasure");
    if (!code)
        return "db";
    return UNIT_LABELS[code] ?? code.toLowerCase();
}
function addressFromNode(node) {
    if (!node)
        return null;
    const wrapper = child(node, "detailedAddress") ?? child(node, "simpleAddress") ?? node;
    const postalCode = value(wrapper, "postalCode");
    const city = value(wrapper, "city");
    if (!postalCode || !city)
        return null;
    const streetName = value(wrapper, "streetName");
    const publicPlaceCategory = value(wrapper, "publicPlaceCategory");
    const houseNumber = value(wrapper, "number");
    const line1 = [streetName, publicPlaceCategory, houseNumber].filter(Boolean).join(" ") ||
        city;
    return {
        postalCode,
        city,
        line1,
        country: value(node, "countryCode") ?? "HU",
    };
}
function supplierTaxNumberFromNode(node) {
    const detail = child(node, "supplierTaxNumber");
    const taxpayerId = value(detail, "taxpayerId");
    if (!taxpayerId)
        return undefined;
    const vatCode = value(detail, "vatCode");
    const countyCode = value(detail, "countyCode");
    return vatCode && countyCode
        ? `${taxpayerId}-${vatCode}-${countyCode}`
        : taxpayerId;
}
function vatRatePercentFromNode(node) {
    const vatRate = child(node, "lineVatRate");
    const raw = value(vatRate, "vatPercentage");
    if (!raw)
        return undefined;
    const fraction = Number(raw);
    if (!Number.isFinite(fraction))
        return undefined;
    return (fraction * 100).toString();
}
function parseLine(node) {
    const lineNumber = Number(value(node, "lineNumber") ?? "");
    const description = value(node, "lineDescription");
    const quantity = value(node, "quantity");
    const netAmount = value(child(node, "lineAmountsNormal"), "lineNetAmount") ??
        value(node, "lineNetAmount");
    if (!Number.isFinite(lineNumber) || !description || !quantity || !netAmount)
        return null;
    const unitPrice = value(node, "unitPrice");
    return {
        lineNumber,
        description,
        quantity,
        unit: unitLabel(node),
        unitPrice,
        lineNetAmount: netAmount,
        vatRatePercent: vatRatePercentFromNode(child(node, "lineAmountsNormal") ?? node),
    };
}
export function suggestedVatRatePercent(lines) {
    const counts = new Map();
    for (const line of lines) {
        if (!line.vatRatePercent)
            continue;
        counts.set(line.vatRatePercent, (counts.get(line.vatRatePercent) ?? 0) + 1);
    }
    let best;
    let bestCount = 0;
    for (const [rate, count] of counts) {
        if (count > bestCount) {
            best = rate;
            bestCount = count;
        }
    }
    return best;
}
export function parseNavInvoiceData(root) {
    const invoiceMain = child(root, "invoiceMain");
    const invoice = child(invoiceMain ?? root, "invoice") ?? invoiceMain ?? root;
    const invoiceHead = child(invoice, "invoiceHead");
    const supplierInfo = child(invoiceHead, "supplierInfo");
    const invoiceDetail = child(invoiceHead, "invoiceDetail");
    const invoiceLines = child(invoice, "invoiceLines");
    const lines = children(invoiceLines, "line")
        .map(parseLine)
        .filter((line) => line !== null);
    return {
        supplierTaxNumber: supplierTaxNumberFromNode(supplierInfo),
        supplierName: value(supplierInfo, "supplierName") ?? "",
        supplierAddress: addressFromNode(child(supplierInfo, "supplierAddress")) ?? undefined,
        supplierBankAccountNumber: value(supplierInfo, "supplierBankAccountNumber"),
        currency: value(invoiceDetail, "currencyCode") ?? "HUF",
        exchangeRate: value(invoiceDetail, "exchangeRate"),
        invoiceIssueDate: value(invoiceHead, "invoiceIssueDate") ??
            value(invoiceDetail, "invoiceIssueDate"),
        invoiceDeliveryDate: value(invoiceDetail, "invoiceDeliveryDate"),
        paymentDate: value(invoiceDetail, "paymentDate"),
        lines,
    };
}
//# sourceMappingURL=nav-invoice-data.parser.js.map