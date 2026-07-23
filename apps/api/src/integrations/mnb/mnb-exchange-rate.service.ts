import { Injectable, NotFoundException } from "@nestjs/common";

import {
  MnbApiError,
  MnbExchangeRateClient,
  type MnbDailyRate,
} from "./mnb-exchange-rate.client.js";

const LOOKBACK_DAYS = 10;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface ResolvedExchangeRate {
  /// A kért dátumhoz tartozó, ténylegesen jegyzett MNB árfolyam napja.
  quotedDate: string;
  /// HUF/deviza árfolyam egy devizaegységre vetítve, stringként.
  rate: string;
}

@Injectable()
export class MnbExchangeRateService {
  constructor(private readonly client: MnbExchangeRateClient) {}

  /// A megadott naphoz (jellemzően a számla kelte) tartozó legutolsó
  /// hivatalos MNB árfolyamot adja vissza. Hétvégén/ünnepnapon nincs
  /// jegyzés, ezért visszafelé néz legfeljebb LOOKBACK_DAYS napot, és a
  /// kért napnál nem későbbi jegyzések közül a legfrissebbet választja.
  async getRateForDate(
    currency: string,
    date: Date,
  ): Promise<ResolvedExchangeRate> {
    const normalizedCurrency = currency.trim().toUpperCase();
    if (normalizedCurrency === "HUF")
      return { quotedDate: toIsoDate(date), rate: "1" };

    const endDate = toIsoDate(date);
    const startDate = toIsoDate(
      new Date(date.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000),
    );

    let rates: MnbDailyRate[];
    try {
      rates = await this.client.getExchangeRates(
        startDate,
        endDate,
        normalizedCurrency,
      );
    } catch (error) {
      if (error instanceof MnbApiError) throw error;
      throw error;
    }

    const eligible = rates
      .filter((entry) => entry.date <= endDate)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const latest = eligible[0];
    if (!latest)
      throw new NotFoundException(
        `Nincs MNB árfolyam a(z) ${normalizedCurrency} devizára ${startDate} és ${endDate} között.`,
      );
    return { quotedDate: latest.date, rate: latest.rate };
  }
}
