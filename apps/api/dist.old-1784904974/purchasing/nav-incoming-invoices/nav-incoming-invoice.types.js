function parsedDataOf(row) {
    return row.parsedData;
}
export function toNavIncomingInvoiceSummary(row) {
    return {
        id: row.id,
        navInvoiceNumber: row.navInvoiceNumber,
        supplierTaxNumber: row.supplierTaxNumber,
        supplierName: row.supplierName,
        invoiceIssueDate: row.invoiceIssueDate.toISOString(),
        invoiceDeliveryDate: row.invoiceDeliveryDate?.toISOString(),
        paymentDate: row.paymentDate?.toISOString(),
        currency: row.currency,
        invoiceNetAmount: row.invoiceNetAmount?.toString(),
        invoiceVatAmount: row.invoiceVatAmount?.toString(),
        insDate: row.insDate.toISOString(),
        status: row.status,
        purchaseInvoiceId: row.purchaseInvoiceId ?? undefined,
        errorCode: row.errorCode ?? undefined,
    };
}
export function toNavIncomingInvoiceDetail(row) {
    const parsed = parsedDataOf(row);
    return {
        ...toNavIncomingInvoiceSummary(row),
        supplierAddress: parsed?.supplierAddress,
        supplierBankAccountNumber: parsed?.supplierBankAccountNumber,
        suggestedVatRatePercent: parsed?.suggestedVatRatePercent,
        lines: (parsed?.lines ?? []).map((line) => ({
            lineNumber: line.lineNumber,
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
            unitPrice: line.unitPrice,
            lineNetAmount: line.lineNetAmount,
            vatRatePercent: line.vatRatePercent,
        })),
    };
}
//# sourceMappingURL=nav-incoming-invoice.types.js.map