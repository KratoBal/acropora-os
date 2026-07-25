var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable, NotFoundException } from "@nestjs/common";
import { NavCredentialsService } from "../../integrations/nav/nav-credentials.service.js";
import { parseNavInvoiceData, suggestedVatRatePercent, } from "../../integrations/nav/nav-invoice-data.parser.js";
import { NavApiError, NavOnlineInvoiceClient, } from "../../integrations/nav/nav-online-invoice.client.js";
import { decodeInvoiceDataXml } from "../../integrations/nav/nav-xml.util.js";
import { NavIncomingInvoiceRepository } from "./nav-incoming-invoice.repository.js";
import { toNavIncomingInvoiceDetail, } from "./nav-incoming-invoice.types.js";
const OVERLAP_MS = 120_000;
const MAX_WINDOW_MS = 30 * 24 * 60 * 60_000;
const MAX_PAGES = 50;
let NavIncomingInvoiceService = class NavIncomingInvoiceService {
    client;
    credentials;
    repository;
    constructor(client, credentials, repository) {
        this.client = client;
        this.credentials = credentials;
        this.repository = repository;
    }
    list(query) {
        return this.repository.list(query);
    }
    async detail(id) {
        const row = await this.repository.findById(id);
        if (!row)
            throw new NotFoundException("A NAV számla nem található.");
        if (row.status === "NEW" || row.status === "ERROR") {
            try {
                const dataResult = await this.client.queryInvoiceData(row.navInvoiceNumber, "INBOUND", row.supplierTaxNumber, this.credentials.technicalUser(), this.credentials.software());
                if (!dataResult.invoiceDataBase64)
                    throw new NavApiError("RESPONSE_SHAPE_INVALID", "invoiceData hiányzik a NAV válaszból");
                const businessXml = decodeInvoiceDataXml(dataResult.invoiceDataBase64, dataResult.compressed);
                const parsed = parseNavInvoiceData(businessXml);
                const stored = {
                    ...parsed,
                    suggestedVatRatePercent: suggestedVatRatePercent(parsed.lines),
                };
                await this.repository.saveParsedData(id, stored);
            }
            catch (error) {
                const errorCode = error instanceof NavApiError
                    ? error.code
                    : "NAV_INVOICE_DATA_FETCH_FAILED";
                await this.repository.markError(id, errorCode);
                throw error;
            }
            const refreshed = await this.repository.findById(id);
            if (!refreshed)
                throw new NotFoundException("A NAV számla nem található.");
            return toNavIncomingInvoiceDetail(refreshed);
        }
        return toNavIncomingInvoiceDetail(row);
    }
    async sync(windowEnd = new Date()) {
        const cursor = await this.repository.getCursor();
        const rawWindowStart = cursor
            ? new Date(cursor.getTime() - OVERLAP_MS)
            : new Date(windowEnd.getTime() - MAX_WINDOW_MS);
        const windowStart = windowEnd.getTime() - rawWindowStart.getTime() > MAX_WINDOW_MS
            ? new Date(windowEnd.getTime() - MAX_WINDOW_MS)
            : rawWindowStart;
        const runId = await this.repository.createRun({ windowStart, windowEnd });
        try {
            const items = await this.downloadDigest(windowStart, windowEnd);
            return await this.repository.applyDigest(runId, items, windowStart, windowEnd);
        }
        catch (error) {
            const errorCode = error instanceof NavApiError
                ? error.code
                : error instanceof Error
                    ? error.message
                    : "NAV_INVOICE_SYNC_FAILED";
            await this.repository.markFailed(runId, errorCode);
            throw error;
        }
    }
    async downloadDigest(windowStart, windowEnd) {
        const user = this.credentials.technicalUser();
        const software = this.credentials.software();
        const items = [];
        for (let page = 1; page <= MAX_PAGES; page += 1) {
            const result = await this.client.queryInvoiceDigest(page, "INBOUND", windowStart, windowEnd, user, software);
            items.push(...result.items);
            if (page >= result.availablePage)
                break;
        }
        return items;
    }
};
NavIncomingInvoiceService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [NavOnlineInvoiceClient,
        NavCredentialsService,
        NavIncomingInvoiceRepository])
], NavIncomingInvoiceService);
export { NavIncomingInvoiceService };
//# sourceMappingURL=nav-incoming-invoice.service.js.map