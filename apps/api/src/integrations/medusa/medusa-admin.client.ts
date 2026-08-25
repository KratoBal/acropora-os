/**
 * A Medusa admin API vékony kliense, csak ahhoz a háromhoz, amit az első kör
 * használ: keresés külső azonosítóra, termék létrehozása, termék módosítása.
 *
 * A HITELESÍTÉS ALAKJA MÉRT, NEM TALÁLT: a titkos API kulcsot a Medusa
 * kifejezetten HTTP Basic fejlécben várja (`Authorization: Basic <kulcs>`), és
 * ha valaki Bearer-ként küldi, saját 401-es üzenetben mondja meg, hogy ez rossz
 * (`authenticate-middleware.js`). Ezért Basic megy, és ezért nem Bearer.
 *
 * A KULCSOT A HÍVÓ ADJA, a kliens sehonnan nem olvassa: se környezetből, se
 * alapértelmezésből. Egy alapértelmezett kulcs itt csendben rossz környezetbe
 * írna, egy környezeti olvasás pedig visszahozná azt, amit a hitelesítő adat
 * szolgáltatója épp kivált. A CÍM viszont a környezetből jön, mert az nem titok.
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
  /**
   * A LEGKEVESEBB, ami még bizonyít valamit: egyetlen olvasó kérés, `limit=1`,
   * írás nulla. Nem a tartalma számít, hanem hogy jön-e válasz és milyen: ha
   * jön, a hálózat áll és a hitelesítés eldőlt.
   */
  probe(): Promise<void>;
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

/**
 * A Medusa NEM kétszázas válasza, a státusszal EGYÜTT.
 *
 * Eddig sima `Error` volt, az üzenetbe írt kóddal. Azért lett saját típusa,
 * mert a hívó oldalnak a SZÁM kell, nem a szöveg: a `401` és a `403` két külön
 * dolgot jelent, és egy üzenet-illesztés pontosan akkor romlana el, amikor a
 * legfontosabb lenne. Az üzenet formátuma változatlan, mert az a parancssori
 * kimeneten már látszik.
 */
export class MedusaAdminHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`MEDUSA_ADMIN_HTTP_${status}: ${body}`);
    this.name = "MedusaAdminHttpError";
  }
}

/**
 * A CÍM, és CSAK a cím.
 *
 * A cím nem titok: nincs tárolva, nem is kell tárolni, és a környezetből jön.
 * A kulcs viszont a hitelesítő adat szolgáltatójától érkezik, tárolóból vagy
 * tartalékból.
 *
 * Ez a két dolog korábban EGY függvényben állt, és abból egy mért hiba lett: a
 * hívó felülírta ugyan az `apiKey` mezőt a tárolt kulccsal, de a függvény
 * MEGKÖVETELTE a környezeti kulcsot, tehát annak az ÉRTÉKE sosem használódott
 * fel, a MEGLÉTE viszont feltétel volt. Ép tárolt kulcs mellett, környezeti
 * kulcs nélkül a próba emiatt „nincs beállítva" állapotot adott: hamis
 * állapotot, nem hibát.
 */
export function medusaAdminBaseUrlFromEnv(
  env: Record<string, string | undefined>,
): string {
  const baseUrl = env.MEDUSA_ADMIN_URL;
  if (!baseUrl)
    throw new MedusaConfigurationError("MEDUSA_ADMIN_URL nincs beállítva.");
  return baseUrl.replace(/\/+$/, "");
}

/**
 * A KLIENS, ahogy futásidőben készül: a cím a környezetből, a kulcs a hívótól.
 *
 * Azért külön, exportált függvény, és nem egy névtelen alapértelmezés a
 * szolgáltatás konstruktorában, mert MÉRHETŐNEK kell lennie. Egy teszt, ami a
 * saját hamis gyárát adja át, pontosan ezt az utat NEM méri: zöld marad akkor
 * is, ha itt bárki visszacsempész egy környezeti kulcs-olvasást. Ez nem
 * feltevés, hanem mért tapasztalat: az első változatom így volt zöld két olyan
 * rontás mellett is, aminek pirosnak kellett volna lennie.
 */
export function medusaClientFromEnvironment(
  apiKey: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: typeof fetch,
): MedusaAdminClient {
  return new HttpMedusaAdminClient(
    { baseUrl: medusaAdminBaseUrlFromEnv(env), apiKey },
    fetchImpl,
  );
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
      throw new MedusaAdminHttpError(response.status, body.slice(0, 500));
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

  async probe(): Promise<void> {
    await this.request<{ products: MedusaProductRow[] }>(
      "/admin/products?limit=1",
    );
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
