/**
 * A Medusa admin API vékony kliense, csak ahhoz a háromhoz, amit az első kör
 * használ: keresés külső azonosítóra, termék létrehozása, termék módosítása.
 *
 * A HITELESÍTÉS ALAKJA MÉRT, NEM TALÁLT: a titkos API kulcsot a Medusa
 * kifejezetten HTTP Basic fejlécben várja (`Authorization: Basic <kulcs>`), és
 * ha valaki Bearer-ként küldi, saját 401-es üzenetben mondja meg, hogy ez rossz
 * (`authenticate-middleware.js`). Ezért Basic megy, és ezért nem Bearer.
 *
 * A kulcs KIZÁRÓLAG környezeti változóból jön. Sem alapértelmezése, sem
 * tartaléka nincs: hiányzó kulcsnál a kliens el sem indul. Egy alapértelmezett
 * kulcs itt csendben rossz környezetbe írna.
 */

export interface MedusaProductRow {
  id: string;
  /** `null`, ha a termék él; időbélyeg, ha puhán törölték. */
  deleted_at: string | null;
  external_id?: string | null;
  title?: string;
}

export interface MedusaProductInput {
  title: string;
  description?: string | null;
  external_id: string;
  handle?: string;
  options: { title: string; values: string[] }[];
  variants: { title: string; sku: string; options: Record<string, string> }[];
}

export interface MedusaAdminClient {
  /**
   * Keresés külső azonosítóra, a TÖRÖLTEKKEL együtt.
   *
   * A `with_deleted` nem finomság: a törlés puha, a törölt soron rajta marad a
   * külső azonosító, és az alapértelmezett szűrő kizárja a törölteket. Enélkül
   * egy törölt termék azonosítója láthatatlan, a vetítés pedig létrehozna egy
   * másodikat ugyanazzal az azonosítóval - és ezt a Medusa nem akadályozza meg,
   * mert az `external_id` mezőn nincs egyedi index.
   *
   * A `limit` KETTŐ, és a hívó a VISSZAKAPOTT SOROKAT számolja, nem a válasz
   * darabszám-mezőjét: az admin lista két ága közül az egyik becslést tesz
   * ugyanabba a mezőbe.
   */
  findByExternalId(externalId: string): Promise<MedusaProductRow[]>;
  create(input: MedusaProductInput): Promise<MedusaProductRow>;
  update(
    id: string,
    input: Omit<MedusaProductInput, "options" | "variants">,
  ): Promise<MedusaProductRow>;
}

export interface MedusaAdminConfig {
  baseUrl: string;
  apiKey: string;
}

export class MedusaConfigurationError extends Error {}

export function medusaAdminConfigFromEnv(
  env: Record<string, string | undefined>,
): MedusaAdminConfig {
  const baseUrl = env.MEDUSA_ADMIN_URL;
  const apiKey = env.MEDUSA_ADMIN_API_KEY;
  if (!baseUrl)
    throw new MedusaConfigurationError("MEDUSA_ADMIN_URL nincs beállítva.");
  if (!apiKey)
    throw new MedusaConfigurationError("MEDUSA_ADMIN_API_KEY nincs beállítva.");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

export class HttpMedusaAdminClient implements MedusaAdminClient {
  constructor(private readonly config: MedusaAdminConfig) {}

  private headers(): Record<string, string> {
    // A kulcs a Basic séma FELHASZNÁLÓNEVE, jelszó nélkül, ezért a záró
    // kettőspont - így írja le a Medusa saját olvasása is.
    const encoded = Buffer.from(`${this.config.apiKey}:`).toString("base64");
    return {
      authorization: `Basic ${encoded}`,
      "content-type": "application/json",
    };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init?.headers ?? {}) },
    });
    if (!response.ok) {
      // A törzs hasznos: a Medusa a hibát magyarázza (például hiányzó opció).
      // A fejléceket NEM naplózzuk, mert azok viszik a kulcsot.
      const body = await response.text();
      throw new Error(
        `MEDUSA_ADMIN_HTTP_${response.status}: ${body.slice(0, 500)}`,
      );
    }
    return (await response.json()) as T;
  }

  async findByExternalId(externalId: string): Promise<MedusaProductRow[]> {
    const params = new URLSearchParams({
      external_id: externalId,
      with_deleted: "true",
      fields: "id,deleted_at,external_id",
      limit: "2",
    });
    const body = await this.request<{ products: MedusaProductRow[] }>(
      `/admin/products?${params.toString()}`,
    );
    return body.products ?? [];
  }

  async create(input: MedusaProductInput): Promise<MedusaProductRow> {
    const body = await this.request<{ product: MedusaProductRow }>(
      "/admin/products",
      { method: "POST", body: JSON.stringify(input) },
    );
    return body.product;
  }

  async update(
    id: string,
    input: Omit<MedusaProductInput, "options" | "variants">,
  ): Promise<MedusaProductRow> {
    const body = await this.request<{ product: MedusaProductRow }>(
      `/admin/products/${encodeURIComponent(id)}`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return body.product;
  }
}
