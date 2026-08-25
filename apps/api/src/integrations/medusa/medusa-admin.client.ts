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
  variants: {
    title: string;
    sku: string;
    options: Record<string, string>;
    /**
     * A Medusa termék-létrehozó végpontja MEGKÖVETELI ezt a mezőt: nélküle
     * `Invalid request: Field 'variants, 0, prices' is required` jön, HTTP
     * 400-zal (mérve a stage-en, 2026-08-25).
     *
     * A típusa szándékosan az ÜRES TÖMB, nem egy ár-lista. Az Acropora
     * OS-ben nincs önálló eladási ár, csak a webshop árának tükre, és az
     * árazás ebből a körből KI VAN VÉVE. Az üres tömb kielégíti a cél oldali
     * követelményt anélkül, hogy olyat állítanánk, amink nincs.
     *
     * Ha az ár egyszer bekerül a hatókörbe, ez a típus pirosra vált, és ez a
     * szándék: az ár alakját akkor MÉRNI kell a Medusán, nem kitalálni.
     */
    prices: [];
  }[];
}

export interface MedusaLookupResult {
  rows: MedusaProductRow[];
  /** Igaz, ha a válasz kimerítette a limitet, tehát lehet több is. */
  truncated: boolean;
}

/**
 * Tág, de véges. A helyes állapot nulla vagy egy találat; ennél több már
 * rendellenes, és ötven bőven elég ahhoz, hogy a rendellenesség ALAKJA is
 * látszódjon, mielőtt megállunk.
 */
export const EXTERNAL_ID_LOOKUP_LIMIT = 50;

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
   * A hívó a VISSZAKAPOTT SOROKAT számolja, nem a válasz darabszám-mezőjét: az
   * admin lista két ága közül az egyik BECSLÉST tesz ugyanabba a mezőbe.
   *
   * A `truncated` azért van, mert a lista NEM RENDEZ alapértelmezésben. Egy
   * szűk limit tehát nem "az első kettőt" adná vissza, hanem TETSZŐLEGES
   * kettőt, és a döntés egy csonkolt halmazon születne: három találatból (két
   * élő, egy törölt) visszajöhetne egy élő és egy törölt, amiből a hívó azt
   * olvasná ki, hogy pontosan egy élő van. Ezért a limit tág, és ha a válasz
   * kimeríti, azt KÜLÖN jelezzük - a néma csonkolás ugyanaz a hiba másképp.
   */
  findByExternalId(externalId: string): Promise<MedusaLookupResult>;
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
  /** A `fetch` azért paraméter, hogy a kérés ALAKJA mérhető legyen. */
  constructor(
    private readonly config: MedusaAdminConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

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
    const response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
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

  async findByExternalId(externalId: string): Promise<MedusaLookupResult> {
    const params = new URLSearchParams({
      external_id: externalId,
      with_deleted: "true",
      fields: "id,deleted_at,external_id",
      limit: String(EXTERNAL_ID_LOOKUP_LIMIT),
    });
    const body = await this.request<{ products: MedusaProductRow[] }>(
      `/admin/products?${params.toString()}`,
    );
    const rows = body.products ?? [];
    return { rows, truncated: rows.length >= EXTERNAL_ID_LOOKUP_LIMIT };
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
