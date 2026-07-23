import { Injectable, Logger } from "@nestjs/common";
import type { PostalCodeLookupResult } from "@acropora/types";

// Nem hivatalos, közösségi forrás (github.com/rrd108/hur) - kizárólag
// kényelmi, legjobb-erőfeszítés város-javaslatra használjuk, nem hivatalos
// nyilvántartás. Hiba vagy találat hiánya esetén csendben null-t adunk
// vissza, a felhasználó a Várost ilyenkor is kézzel töltheti ki.
const LOOKUP_BASE_URL = "https://hur.webmania.cc/zips";

interface HurZipEntry {
  zip: string;
  name: string;
}

@Injectable()
export class PostalCodeService {
  private readonly logger = new Logger(PostalCodeService.name);

  async lookupCity(rawZip: string): Promise<PostalCodeLookupResult> {
    const zip = rawZip.trim();
    if (!/^\d{4}$/.test(zip)) return { city: null };
    try {
      const response = await fetch(`${LOOKUP_BASE_URL}/${zip}.json`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return { city: null };
      const payload = (await response.json()) as { zips?: HurZipEntry[] };
      const match = payload.zips?.find((entry) => entry.zip === zip);
      return { city: match?.name ?? payload.zips?.[0]?.name ?? null };
    } catch (error) {
      this.logger.warn(
        `Postal code lookup failed for ${zip}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      return { city: null };
    }
  }
}
