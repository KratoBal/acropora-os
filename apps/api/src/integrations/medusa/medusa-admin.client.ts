/**
 * A Medusa admin API vékony kliense, csak ahhoz, amit a vetítés használ:
 * keresés külső azonosítóra, termék létrehozása és módosítása, illetve a
 * készlet-vetítés négy művelete (készlethely a csatorna felől, a termék
 * változatai a készlet-lánccal, készletszint létrehozása és beállítása, a
 * változat rendelhetősége).
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

/**
 * Egy termék-sor ABBAN AZ ALAKBAN, AHOGY A KERESÉS KÉRI - se többet, se
 * kevesebbet.
 *
 * A `findByExternalId` `fields` paramétere pontosan hármat kér:
 * `id,deleted_at,external_id`. A Medusa a nem kért mezőt nem hibával, hanem
 * `undefined` értékkel adja vissza, tehát egy tágabb típus itt CSENDES ígéret:
 * egy későbbi olvasó jogosan hinné, hogy hozzáfér a címhez, és `undefined`-ot
 * kapna - fordítási hiba nélkül, futás közben.
 *
 * Ezért a keresés eredménye ezt a szűk alakot viseli, a `MedusaProductRow`
 * pedig azoké a válaszoké marad, amelyek a TELJES terméket hozzák vissza
 * (`create`, `update`, `probe` - ott nincs `fields` szűkítés). Ha a keresés
 * egyszer több mezőt kér, ez a típus és a `fields` sor EGYÜTT változik.
 */
export interface MedusaProductLookupRow {
  id: string;
  /** `null`, ha a termék él; időbélyeg, ha puhán törölték. */
  deleted_at: string | null;
  external_id?: string | null;
}

/** A teljes termék-válasz, `fields` szűkítés nélküli hívásokból. */
export interface MedusaProductRow extends MedusaProductLookupRow {
  title?: string;
}

export interface MedusaProductInput {
  title: string;
  description?: string | null;
  external_id: string;
  handle?: string;
  /**
   * A publikációs állapot. A telepített 2.19.0 validátora szerint a
   * létrehozásnál `draft` az alapértelmezés, tehát a mező elhagyása NEM
   * semleges: draftot jelent.
   */
  status?: "draft" | "proposed" | "published" | "rejected";
  /**
   * A storefront csatorna-kapcsolatok, és a mező CSERE, nem hozzáadás.
   *
   * Mérve a telepített 2.19.0 termék-frissítő folyamatából: ha a mező
   * hiányzik a törzsből, a meglévő linkeket nem bántja; ha ott van, a
   * meglévőket TÖRLI és a kapott listát hozza létre. Ebből következik, hogy
   * ugyanannak a listának az újraküldése nem hoz létre duplikátumot, és hogy
   * az ÜRES lista a lekötés.
   */
  sales_channels?: { id: string }[];
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

export interface MedusaSalesChannelRow {
  id: string;
  name: string;
}

export interface MedusaLookupResult {
  rows: MedusaProductLookupRow[];
  /** Igaz, ha a válasz kimerítette a limitet, tehát lehet több is. */
  truncated: boolean;
}

/**
 * Tág, de véges. A helyes állapot nulla vagy egy találat; ennél több már
 * rendellenes, és ötven bőven elég ahhoz, hogy a rendellenesség ALAKJA is
 * látszódjon, mielőtt megállunk.
 */
export const EXTERNAL_ID_LOOKUP_LIMIT = 50;

/**
 * A csatornához tartozó készlethelyek lekérdezésének felső határa.
 *
 * A helyes állapot PONTOSAN EGY, és a hívó fail-closed. A limit mégis tág,
 * mert a „több" eset megállás, és a megálláshoz látni akarjuk, HÁNY hely van
 * és melyek - egy szűk limit itt azt sugallná, hogy kevesebb van, mint
 * amennyi valójában.
 */
export const STOCK_LOCATION_LOOKUP_LIMIT = 50;

/**
 * Egy termék változatainak felső határa.
 *
 * A vetített termékeknek ma egy változatuk van, tehát ötven bőven elég - DE a
 * kimerített limitet akkor is jelezzük, ugyanúgy, ahogy a termék-keresésnél. A
 * lista nem rendez alapértelmezésben, tehát egy csonkolt válasz nem „az első
 * ötvenet" adja vissza, hanem TETSZŐLEGES ötvenet: a „pontosan egy egyezés"
 * ellenőrzés ilyenkor egy részhalmazon futna, és a hiányzó egyezésből azt
 * olvasnánk ki, hogy nincs ilyen cikkszámú változat.
 */
export const VARIANT_LOOKUP_LIMIT = 50;

/**
 * A változat mezői, a készlet-lánccal EGYÜTT.
 *
 * A `inventory_items.inventory.location_levels` út a telepített 2.19.0
 * forrásában használt alak (a kosár és a rendelés folyamatai pontosan ezt
 * kérik le), tehát nem találgatás. AMIT VISZONT NEM TUDUNK INNEN MÉRNI: hogy
 * az admin HTTP réteg `fields` paramétere ugyanezt a kiterjesztést átengedi-e.
 * Ezért a hívó a HIÁNYZÓ mezőt NEM üres listaként olvassa, hanem megáll rajta:
 * az üres lista azt állítaná, hogy nincs kapcsolat, holott csak nem kérdeztünk
 * jól.
 */
export const VARIANT_INVENTORY_FIELDS = [
  "id",
  "sku",
  "deleted_at",
  "allow_backorder",
  "manage_inventory",
  "inventory_items.inventory.id",
  "inventory_items.inventory.location_levels.location_id",
  "inventory_items.inventory.location_levels.stocked_quantity",
  "inventory_items.inventory.location_levels.reserved_quantity",
].join(",");

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
  /**
   * Egy sales channel, azonosító szerint.
   *
   * A NEVET is visszaadja, és a hívó KIÍRJA, nem állítja: egy rossz, de
   * létező azonosító így a jelentésben látszik meg. Egy név-egyezés
   * ellenőrzése azért nincs, mert annak a bukása egy JOGOS átnevezés lenne,
   * és egy ellenőrzés, ami jogos változásra pirosodik, előbb-utóbb
   * kikapcsolódik - onnantól pedig a helye üresen marad, miközben mindenki
   * azt hiszi, hogy őrzi valami.
   */
  findSalesChannel(id: string): Promise<MedusaSalesChannelRow | null>;
  create(input: MedusaProductInput): Promise<MedusaProductRow>;
  update(
    id: string,
    input: Omit<MedusaProductInput, "options" | "variants">,
  ): Promise<MedusaProductRow>;
  /**
   * A csatornához tartozó készlethelyek - MINDEN FUTÁSKOR, azonosító
   * beégetése nélkül.
   *
   * A `sales_channel_id` NEVESÍTETT szűrő az admin stock-location
   * validátorában (mérve a telepített 2.19.0 forrásából), tehát ez nem
   * találgatás. A hívó fail-closed: ha nem PONTOSAN EGY hely jön vissza, a
   * futás megáll és nem ír semmit. A nulla azt jelenti, hogy rossz csatornát
   * néztünk; a több pedig üzleti döntés, amit nem a kód hoz meg.
   */
  listStockLocationsForSalesChannel(
    salesChannelId: string,
  ): Promise<MedusaStockLocationRow[]>;
  /**
   * Egy termék változatai, a készlet-lánccal együtt, EGY kérésben.
   *
   * A lánc (`inventory_items.inventory.location_levels`) azért utazik együtt a
   * változattal, mert az AZONOSSÁGOT a Medusa saját kapcsolata hordozza, nem
   * egy átnevezhető mező. A cikkszámra szűrő `GET /admin/inventory-items?sku=`
   * út létezik, de a cikkszám az inventory itemen MÁSOLAT: a brief 6. pontja
   * kifejezetten tiltja az átnevezhető mezőt azonosságként.
   */
  listProductVariants(productId: string): Promise<MedusaVariantLookupResult>;
  /** Új készletszint egy helyen. A szint hiánya nem hiba, hanem első futás. */
  createInventoryLevel(
    inventoryItemId: string,
    locationId: string,
    stockedQuantity: number,
  ): Promise<void>;
  /**
   * Meglévő készletszint ABSZOLÚT beállítása.
   *
   * Nem delta: a telepített 2.19.0 `updateInventoryLevels` a kapott értéket
   * BEÁLLÍTJA. Ebből következik az idempotencia - és ebből következik az is,
   * hogy az idempotencia nem a mi kódunk érdeme, hanem a cél oldal
   * tulajdonsága.
   *
   * A HIÁNYZÓ SZINTET NEM HOZZA LÉTRE: az `ensureInventoryLevels` ilyenkor
   * `Item ... is not stocked at location ...` hibát dob (mérve). Ezért van
   * külön létrehozó hívás, és ezért nézzük meg előbb, van-e szint.
   */
  updateInventoryLevel(
    inventoryItemId: string,
    locationId: string,
    stockedQuantity: number,
  ): Promise<void>;
  /** A változat rendelhetőségének beállítása. Lásd `PROJECTED_ALLOW_BACKORDER`. */
  updateVariantBackorder(
    productId: string,
    variantId: string,
    allowBackorder: boolean,
  ): Promise<void>;
}

/**
 * Egy készlethely, ahogy az admin lista visszaadja.
 *
 * A NEVET is kérjük, és a jelentés kiírja. A készlethely azonosítója sehol
 * nincs beégetve: minden futás az ÉRTÉKESÍTÉSI CSATORNA felől kérdezi vissza -
 * lásd `listStockLocationsForSalesChannel`.
 */
export interface MedusaStockLocationRow {
  id: string;
  name: string;
}

/** Egy készletszint, `(inventory_item_id, location_id)` páronként. */
export interface MedusaInventoryLevelRow {
  location_id: string;
  stocked_quantity: number;
  reserved_quantity?: number;
}

/**
 * Egy változat, a hozzá tartozó inventory item LÁNCÁVAL együtt.
 *
 * A `inventory_items` és a beágyazott `location_levels` mező **hiányozhat**, és
 * a hiány NEM ugyanaz, mint az üres lista. Ezért `?` és nem alapértelmezett
 * üres tömb: az üres lista azt ÁLLÍTANÁ, hogy nincs kapcsolat, holott csak nem
 * kérdeztünk jól. A hívó a kettőt külön kezeli, és a hiányra megáll.
 */
/** Változat-keresés eredménye, a csonkolás jelzésével EGYÜTT. */
export interface MedusaVariantLookupResult {
  rows: MedusaVariantRow[];
  /** Igaz, ha a válasz kimerítette a limitet, tehát lehet több változat is. */
  truncated: boolean;
}

export interface MedusaVariantRow {
  id: string;
  sku: string | null;
  /**
   * `null`, ha a változat él; időbélyeg, ha puhán törölték.
   *
   * A keresés `with_deleted` értékkel megy, tehát ez a mező MINDIG megérkezik,
   * és a hívónak SZÉT KELL VÁLASZTANIA az élőt az eltemetettől. A Medusa
   * cikkszám-indexe RÉSZLEGES (`deleted_at IS NULL`), tehát ugyanaz a cikkszám
   * egyszerre ülhet egy élő és egy eltemetett változaton - a kettőt egy
   * halmazban számolni téves „több egyezés" választ adna.
   */
  deleted_at: string | null;
  allow_backorder?: boolean;
  manage_inventory?: boolean;
  inventory_items?: {
    inventory?: {
      id: string;
      location_levels?: MedusaInventoryLevelRow[];
    };
  }[];
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
    const body = await this.request<{ products: MedusaProductLookupRow[] }>(
      `/admin/products?${params.toString()}`,
    );
    const rows = body.products ?? [];
    return { rows, truncated: rows.length >= EXTERNAL_ID_LOOKUP_LIMIT };
  }

  async findSalesChannel(id: string): Promise<MedusaSalesChannelRow | null> {
    try {
      const body = await this.request<{ sales_channel: MedusaSalesChannelRow }>(
        `/admin/sales-channels/${encodeURIComponent(id)}`,
      );
      return body.sales_channel ?? null;
    } catch (error) {
      /**
       * A NEM LÉTEZŐ azonosító nem kivétel, hanem válasz: `null`. Minden más
       * hiba tovább száll, mert az MÁS kérdés - egy hálózati hiba vagy egy
       * lejárt kulcs nem azt jelenti, hogy a csatorna nincs.
       */
      if (error instanceof MedusaAdminHttpError && error.status === 404)
        return null;
      throw error;
    }
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

  async listStockLocationsForSalesChannel(
    salesChannelId: string,
  ): Promise<MedusaStockLocationRow[]> {
    /**
     * A `fields` azért van kiírva, mert a `name` BENNE VAN ugyan az admin
     * stock-location alapmezőiben, de az alapértelmezés egy lista, ami
     * változhat - a szűkítés viszont egy hívásnyi adatot spórol, és
     * kimondja, mire van szükségünk.
     */
    const params = new URLSearchParams({
      sales_channel_id: salesChannelId,
      fields: "id,name",
      limit: String(STOCK_LOCATION_LOOKUP_LIMIT),
    });
    const body = await this.request<{
      stock_locations: MedusaStockLocationRow[];
    }>(`/admin/stock-locations?${params.toString()}`);
    return body.stock_locations ?? [];
  }

  async listProductVariants(
    productId: string,
  ): Promise<MedusaVariantLookupResult> {
    /**
     * A `with_deleted` NEM finomság, ugyanazzal az indokkal, mint a
     * termék-keresésnél: a törlés puha, és az alapértelmezett szűrő kizárja a
     * törölteket. Enélkül egy eltemetett változat cikkszáma láthatatlan, a
     * hívó pedig a „nincs ilyen" és az „el van temetve" esetet nem tudja
     * megkülönböztetni - holott a kettő MÁS teendő.
     */
    const params = new URLSearchParams({
      with_deleted: "true",
      fields: VARIANT_INVENTORY_FIELDS,
      limit: String(VARIANT_LOOKUP_LIMIT),
    });
    const body = await this.request<{ variants: MedusaVariantRow[] }>(
      `/admin/products/${encodeURIComponent(productId)}/variants?${params.toString()}`,
    );
    const rows = body.variants ?? [];
    return { rows, truncated: rows.length >= VARIANT_LOOKUP_LIMIT };
  }

  async createInventoryLevel(
    inventoryItemId: string,
    locationId: string,
    stockedQuantity: number,
  ): Promise<void> {
    await this.request<unknown>(
      `/admin/inventory-items/${encodeURIComponent(inventoryItemId)}/location-levels`,
      {
        method: "POST",
        body: JSON.stringify({
          location_id: locationId,
          stocked_quantity: stockedQuantity,
        }),
      },
    );
  }

  async updateInventoryLevel(
    inventoryItemId: string,
    locationId: string,
    stockedQuantity: number,
  ): Promise<void> {
    await this.request<unknown>(
      `/admin/inventory-items/${encodeURIComponent(inventoryItemId)}` +
        `/location-levels/${encodeURIComponent(locationId)}`,
      {
        method: "POST",
        body: JSON.stringify({ stocked_quantity: stockedQuantity }),
      },
    );
  }

  async updateVariantBackorder(
    productId: string,
    variantId: string,
    allowBackorder: boolean,
  ): Promise<void> {
    await this.request<unknown>(
      `/admin/products/${encodeURIComponent(productId)}` +
        `/variants/${encodeURIComponent(variantId)}`,
      {
        method: "POST",
        body: JSON.stringify({ allow_backorder: allowBackorder }),
      },
    );
  }
}
