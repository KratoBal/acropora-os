import { MnbExchangeRateClient } from "./mnb-exchange-rate.client.js";
export interface ResolvedExchangeRate {
    quotedDate: string;
    rate: string;
}
export declare class MnbExchangeRateService {
    private readonly client;
    constructor(client: MnbExchangeRateClient);
    getRateForDate(currency: string, date: Date): Promise<ResolvedExchangeRate>;
}
