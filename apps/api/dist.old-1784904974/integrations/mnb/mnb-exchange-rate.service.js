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
import { MnbApiError, MnbExchangeRateClient, } from "./mnb-exchange-rate.client.js";
const LOOKBACK_DAYS = 10;
function toIsoDate(date) {
    return date.toISOString().slice(0, 10);
}
let MnbExchangeRateService = class MnbExchangeRateService {
    client;
    constructor(client) {
        this.client = client;
    }
    async getRateForDate(currency, date) {
        const normalizedCurrency = currency.trim().toUpperCase();
        if (normalizedCurrency === "HUF")
            return { quotedDate: toIsoDate(date), rate: "1" };
        const endDate = toIsoDate(date);
        const startDate = toIsoDate(new Date(date.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000));
        let rates;
        try {
            rates = await this.client.getExchangeRates(startDate, endDate, normalizedCurrency);
        }
        catch (error) {
            if (error instanceof MnbApiError)
                throw error;
            throw error;
        }
        const eligible = rates
            .filter((entry) => entry.date <= endDate)
            .sort((a, b) => (a.date < b.date ? 1 : -1));
        const latest = eligible[0];
        if (!latest)
            throw new NotFoundException(`Nincs MNB árfolyam a(z) ${normalizedCurrency} devizára ${startDate} és ${endDate} között.`);
        return { quotedDate: latest.date, rate: latest.rate };
    }
};
MnbExchangeRateService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [MnbExchangeRateClient])
], MnbExchangeRateService);
export { MnbExchangeRateService };
//# sourceMappingURL=mnb-exchange-rate.service.js.map