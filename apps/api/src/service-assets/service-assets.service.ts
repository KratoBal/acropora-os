import { createHash, randomUUID } from "node:crypto";

import type { PartnerScope } from "../auth/partner-scope.util.js";
import { assetDeletionRefusal } from "./asset-deletion.js";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { AssetQrCode } from "@acropora/types";
import {
  assetLabelCreateProblem,
  normalizeAssetLabelCode,
} from "@acropora/types";
import {
  AssetLabelPoolExhaustedError,
  AssetLabelUnavailableError,
} from "./service-assets.repository.js";

import {
  ASSET_DEPARTMENT_REFUSAL_MESSAGES,
  assetDepartmentRefusal,
} from "./asset-department.js";
import type {
  AssetListQueryDto,
  AssetOwnersQueryDto,
  CreateAssetDto,
  UpdateAssetDto,
} from "./dto/asset.dto.js";
import type { DocumentStore } from "./document-store/document-store.js";
import { DOCUMENT_STORE } from "./document-store/document-store.provider.js";
import { decideQuota } from "./document-store/document-quota.js";
import {
  canonicalMimetypeFor,
  detectUploadedFileKind,
} from "./uploaded-file-type.js";
import {
  assertStorageKeyMatches,
  storageKeyFor,
} from "./document-store/document-storage-key.js";
import { documentStoreEnabled } from "./document-store/document-store.provider.js";
import { createAssetQrSvg } from "./qr-svg.js";
import { ServiceAssetsRepository } from "./service-assets.repository.js";

/**
 * A KET UZENET, EGYMAS MELLETT, HOGY A KULONBSEG LATSZODJON.
 *
 * A belsos felhasznalo a KET esetet kulon latja; a partner az osszevontat. Ha
 * ezek szet lennenek szorva a kodban, egy kesobbi "egysegesites" csendben a
 * BOVEBBET adna a partnernek is -- es az a valtozas MUKODONEK latszana.
 */
const MATRICA_UZENET_BELSOS =
  "Ez a matricakód nincs kiadva, vagy már egy másik eszközön áll. Nézd meg a kiadott kódok listáját, vagy olvass be másik matricát.";
const MATRICA_UZENET_PARTNER =
  "Ez a matricakód nem köthető ehhez az eszközhöz. Olvass be másik matricát.";

@Injectable()
export class ServiceAssetsService {
  constructor(
    private readonly repository: ServiceAssetsRepository,
    @Inject(DOCUMENT_STORE) private readonly documentStore: DocumentStore,
  ) {}

  private readonly logger = new Logger(ServiceAssetsService.name);

  list(query: AssetListQueryDto, scope: PartnerScope) {
    return this.repository.list(query, scope);
  }

  /**
   * A tulajdonos-választó listája. A `ownerType`/`ownerId` páros egy MEGLÉVŐ
   * eszköz tulajdonosát nevezi meg, akit a lista akkor is tartalmazzon, ha ma
   * nem lenne választható. Fél páros értelmezhetetlen, ezért az hiba: csendben
   * elhagyva pont azt a sort ejtenénk ki, amiért a hívás történt.
   */
  owners(query: AssetOwnersQueryDto = {}, scope: PartnerScope) {
    if ((query.ownerType === undefined) !== (query.ownerId === undefined))
      throw new BadRequestException(
        "A megtartandó tulajdonos típusa és azonosítója csak együtt adható meg.",
      );
    return this.repository.owners(
      query.ownerType && query.ownerId
        ? { type: query.ownerType, id: query.ownerId }
        : null,
      scope,
    );
  }

  async detail(id: string, scope: PartnerScope) {
    const asset = await this.repository.detail(id, scope);
    if (!asset) throw new NotFoundException("Az eszköz nem található.");
    return asset;
  }

  /**
   * A TORLES BELSOS UT, ES A HATOKOR SZANDEKOSAN NEM SZUKIT ITT. A vegpont a
   * `SERVICE_ASSET_DELETE` jog alatt all, amit partner-oldali fiok nem kap meg;
   * a letezes-ellenorzes ezert a `detail` BELSOS agan megy, ugyanabbol az okbol,
   * mint a tobbi irasi uton: itt a kerdes az, hogy LETEZIK-e a sor, nem az, hogy
   * LATHATJA-e a kero. A ketto osszemosasa ot irasi utat szukitett volna
   * csendben (lasd a `partner-scope.util.ts` jegyzetet).
   */
  async remove(id: string) {
    await this.detail(id, { kind: "internal" });
    const blockers = await this.repository.deletionBlockers(id);
    const refusal = assetDeletionRefusal(blockers);
    if (refusal) throw new ConflictException(refusal);
    await this.repository.remove(id);
    return { ok: true as const };
  }

  async scan(qrToken: string, scope: PartnerScope) {
    const asset = await this.repository.detailByQrToken(qrToken, scope);
    if (!asset)
      throw new NotFoundException(
        "A QR-kódhoz nem tartozik érvényes eszközazonosító.",
      );
    return asset;
  }

  async create(
    input: CreateAssetDto,
    actorUserId: string,
    /**
     * A HATOKOR CSAK A HIBAUZENET MIATT KELL, es ezt ki kell mondani, mert
     * kulonben a kovetkezo olvaso azt hiszi, hogy a letrehozas szur ra.
     *
     * Balazs dontese (2026-09-02 20:2x): "a sajat embereinknek mondjuk meg
     * melyik eset all fenn". A BELSOS felhasznalo megtudja, hogy a kod nincs
     * kiadva VAGY mar mason all; a PARTNER a mai, osszevont uzenetet kapja --
     * mert a ket eset kulonvalasztasa nala felterkepezhetove tenne a kiadott
     * keszletet (ot karakteres kod).
     */
    scope: PartnerScope,
  ) {
    /**
     * A MATRICA-SZABALY EGY HELYEN ALL, ES ITT KERDEZZUK MEG.
     *
     * A `assetLabelCreateProblem` mondja meg, hogy KELL-E matrica es hogy JO-E
     * az alakja. Ugyanezt a fuggvenyt hasznalja a telefon urlapja is: ha a
     * ketto kulon dontene, a felhasznalo azt latna, hogy az urlap atengedi, a
     * mentes meg elutasitja.
     */
    const labelProblem = assetLabelCreateProblem(input.labelCode);
    if (labelProblem === "missing")
      throw new BadRequestException(
        "A matricakód megadása kötelező az eszköz felvitelekor.",
      );
    if (labelProblem === "malformed")
      throw new BadRequestException(
        "A matricakód alakja egy betű és négy szám (például V2196).",
      );

    await this.validateReferences({
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      customerAddressId: input.customerAddressId,
      aquariumId: input.aquariumId,
      parentAssetId: input.parentAssetId,
      productVariantId: input.productVariantId,
    });
    try {
      return await this.repository.create(input, actorUserId);
    } catch (error) {
      this.map(error, scope);
    }
  }

  /**
   * ESZKOZ KERESESE A BEOLVASOTT MATRICAKODROL.
   *
   * A HAROM VALASZ HATARA: rossz ALAK -> 400 (a keresen kell javitani),
   * nem talalhato -> 404. A "nincs ilyen kod" es a "mas partnere" KOZOTT NEM
   * teszunk kulonbseget: a tarolo mindkettore `null`-t ad, es a kettot
   * megkulonbozteto valasz maga lenne a szivargas.
   */
  async scanLabel(rawCode: string, scope: PartnerScope) {
    const code = normalizeAssetLabelCode(rawCode);
    if (code === null)
      throw new BadRequestException(
        "A matricakód alakja egy betű és négy szám (például V2196).",
      );
    const asset = await this.repository.detailByLabelCode(code, scope);
    if (!asset)
      throw new NotFoundException(
        "Ehhez a matricakódhoz nem tartozik elérhető eszköz.",
      );
    return asset;
  }

  /**
   * UJ TETEL GENERALASA. A valasz a kodokat IS visszaadja, hogy a felulet
   * azonnal letoltheto fajlt tudjon adni belole.
   */
  async issueBatch(count: number) {
    try {
      return await this.repository.issueBatch(count);
    } catch (error) {
      if (error instanceof AssetLabelPoolExhaustedError)
        throw new ConflictException(error.message);
      this.map(error);
    }
  }

  /**
   * MAR KINYOMTATOTT KODOK BETOLTESE. A valasz kulon mondja meg, mi jott letre
   * es mi allt mar ott -- egy megismetelt betoltes igy nem latszik ujnak.
   */
  async importBatch(codes: readonly string[]) {
    if (codes.length === 0)
      throw new BadRequestException("Legalább egy matricakódot meg kell adni.");
    try {
      return await this.repository.importBatch(codes);
    } catch (error) {
      this.map(error);
    }
  }

  /** A korabbi generalasok, legfrissebb elol. */
  async labelBatches(limit: number) {
    return this.repository.listLabelBatches(limit);
  }

  /**
   * EGY KOTEG KODJAI. A NEM LETEZO KOTEG NEM URES LISTA.
   *
   * Egy ures tomb azt mondana, hogy a koteg letezik es nincs benne kod -- egy
   * elgepelt azonositora pedig a felulet ures fajlt tolt le, hibauzenet nelkul.
   */
  async labelBatchCodes(batchId: string) {
    const codes = await this.repository.labelBatchCodes(batchId);
    if (codes === null)
      throw new NotFoundException("A matrica-köteg nem található.");
    return { codes };
  }

  /** A kiadott, de meg egyetlen eszkozhoz sem kotott matricak. */
  async freeLabels(limit: number) {
    return this.repository.listFreeLabels(limit);
  }

  async update(id: string, input: UpdateAssetDto, actorUserId: string) {
    const existing = await this.repository.basic(id);
    if (!existing) throw new NotFoundException("Az eszköz nem található.");
    if ((input.ownerType === undefined) !== (input.ownerId === undefined))
      throw new BadRequestException(
        "A tulajdonos típusa és azonosítója csak együtt módosítható.",
      );
    const ownerType =
      input.ownerType ?? (existing.customerId ? "CUSTOMER" : "SUPPLIER");
    const ownerId = input.ownerId ?? existing.customerId ?? existing.supplierId;
    if (!ownerId)
      throw new BadRequestException("Az eszköz tulajdonosa hiányzik.");
    const parentAssetId =
      input.parentAssetId === undefined
        ? existing.parentAssetId
        : input.parentAssetId;
    if (
      parentAssetId &&
      (await this.repository.wouldCreateCycle(id, parentAssetId))
    )
      throw new BadRequestException(
        "Az eszközhierarchia nem tartalmazhat önmagába visszatérő kapcsolatot.",
      );
    await this.validateReferences({
      ownerType,
      ownerId,
      customerAddressId:
        ownerType === "SUPPLIER"
          ? null
          : input.customerAddressId === undefined
            ? existing.customerAddressId
            : input.customerAddressId,
      aquariumId:
        ownerType === "SUPPLIER"
          ? null
          : input.aquariumId === undefined
            ? existing.aquariumId
            : input.aquariumId,
      parentAssetId,
      productVariantId:
        input.productVariantId === undefined
          ? existing.productVariantId
          : input.productVariantId,
    });
    try {
      return await this.repository.update(id, input, actorUserId);
    } catch (error) {
      this.map(error);
    }
  }

  async rotateQr(id: string, actorUserId: string) {
    await this.detail(id, {
      // BELSOS UT: a vegpont SERVICE_MANAGE jog alatt all (QR-forgatas,
      // dokumentum-feltoltes), amit partner-oldali felhasznalo nem kap meg.
      kind: "internal",
    });
    try {
      return await this.repository.rotateQr(id, actorUserId);
    } catch (error) {
      this.map(error);
    }
  }

  async qrCode(id: string, scope: PartnerScope): Promise<AssetQrCode> {
    const asset = await this.detail(id, scope);
    const base = (
      process.env.ASSET_QR_BASE_URL?.trim() || "acropora-os://assets/scan"
    ).replace(/\/+$/, "");
    const value = `${base}/${asset.qrToken}`;
    return {
      assetId: asset.id,
      assetNumber: asset.assetNumber,
      value,
      svg: createAssetQrSvg(value),
      labelSizeMm: 30,
    };
  }

  async addDocument(
    id: string,
    type: "INVOICE" | "WARRANTY" | "MANUAL" | "OTHER",
    file: Express.Multer.File,
    actorUserId: string,
  ) {
    await this.detail(id, {
      // BELSOS UT: a vegpont SERVICE_MANAGE jog alatt all (QR-forgatas,
      // dokumentum-feltoltes), amit partner-oldali felhasznalo nem kap meg.
      kind: "internal",
    });
    // A BEJELENTETT TÍPUS ÉS A TARTALOM EGYÜTT DÖNT, és ez a szabály nem
    // lazult azzal, hogy a kép is bekerült: mindkettőnek egyeznie kell.
    // A lista és a szándékosan kihagyott formátumok indoka a
    // `uploaded-file-type.ts` fejlécében áll.
    const kind = detectUploadedFileKind(file.mimetype, file.buffer);
    if (kind === null)
      throw new BadRequestException(
        "Csak érvényes PDF, JPEG vagy PNG fájl tölthető fel.",
      );
    const safeName = file.originalname
      .normalize("NFKC")
      .replace(/[\\/\u0000-\u001f\u007f]/g, "-")
      .slice(0, 180);

    const documentId = randomUUID();
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const common = {
      id: documentId,
      assetId: id,
      type,
      // A TARTALÉK NÉV NEM MONDHAT TÍPUST, amit nem tudunk. Korábban
      // "dokumentum.pdf" állt itt, ami PDF-en kívül hazudott volna a
      // letöltőnek - a böngésző a kiterjesztés szerint próbálná megnyitni.
      fileName: safeName || "dokumentum",
      // A TÁROLT TÍPUS A FELISMERT FAJTÁBÓL JÖN, nem a küldő bejelentéséből
      // és nem egy rögzített értékből. A letöltés ezt adja vissza, tehát egy
      // rossz érték itt a böngészőnél derülne ki, hetekkel később.
      contentType: canonicalMimetypeFor(kind),
      sizeBytes: file.buffer.length,
      sha256,
      actorUserId,
    };

    // A KERET A LEGELSO ELLENORZES, MEG AZ IRAS ELOTT. Egy elutasitas utan sem
    // a tarolon, sem a tablaban nem keletkezhet semmi: az orzot nem az
    // bizonyitja, hogy szol, hanem hogy nem tortent semmi.
    await this.refuseIfOverQuota(file.buffer.length);

    if (!documentStoreEnabled()) {
      // A MAI UT, VALTOZATLANUL. A tarolo nincs bekapcsolva, tehat a bajtok az
      // adatbazisba mennek, ugyanugy, mint eddig.
      return this.repository.addDocument({ ...common, content: file.buffer });
    }

    // A BEKAPCSOLAS MEG NEM JELENTI, HOGY HASZNALHATO, es ezt a feltoltesi
    // utnak MAGANAK kell megneznie.
    //
    // A LEGVESZELYESEBB TELEPITESI HIBA: a DOCUMENT_STORE_ROOT be van allitva,
    // de a kotet nincs csatolva vagy a jelolo fajl hianyzik. A konyvtar
    // ilyenkor IRHATO (a csatolasi pont ures konyvtara is az), tehat az iras
    // SIKERUL -- csak epp a konteneri retegre, es a kovetkezo ujratelepites
    // elviszi. Semmi nem hibazna, es a hiba hetekkel kesobb, letoltesnel
    // derulne ki.
    //
    // AMIT ILYENKOR TESZUNK: visszaesunk az adatbazisra, es NAPLOZUNK. Nem
    // elutasitas, mert a rendszernek mennie kell, es az adatbazis-ut ep; nem
    // is csendes, mert a naplo es az allapot-vegpont is kimondja. A ket rossz
    // valasz kozul (megall / csendben elveszit) egyik sem kell.
    const status = await this.documentStore.describe();
    if (status.state !== "ready") {
      this.logger.warn(
        `A dokumentum-tarolo be van kapcsolva, de nem hasznalhato (${status.state}: ${status.reason}). A feltoltes az adatbazisba megy.`,
      );
      return this.repository.addDocument({ ...common, content: file.buffer });
    }

    // A BAJTOK ELOSZOR A TAROLOBA MENNEK, ES CSAK AZUTAN A SOR.
    //
    // A ket lehetseges felig-kesz allapot NEM egyforma sulyu. Ha eloszor a sor
    // jonne letre es a tarolo bukna, egy ELVESZETT SOR maradna: a felhasznalo
    // LATJA a dokumentumot a listaban, es a letoltesnel kap hibat. Igy viszont
    // legfeljebb egy ELARVULT FAJL marad, amire senki nem hivatkozik -- szemet,
    // nem adatvesztes. A ket allapot kozul a kevesbe latszot valasztjuk.
    const key = { assetId: id, documentId };
    await this.documentStore.put(key, file.buffer);
    try {
      return await this.repository.addDocument({
        ...common,
        content: null,
        storageKey: storageKeyFor(key),
      });
    } catch (error) {
      // A SOR NEM JOTT LETRE, TEHAT A FAJL SEM MARADHAT. A takaritas hibajat
      // elnyeljuk: az eredeti hiba a fontosabb, azt nem szabad elfednie. Ha a
      // takaritas is bukik, a fajl elarvultan marad, es az osszevetes
      // megtalalja -- tehat nem veszik el, csak keson derul ki.
      await this.documentStore.delete(key).catch(() => undefined);
      throw error;
    }
  }

  /**
   * A KERET ELLENORZESE, MIELOTT BARMI KELETKEZNE.
   *
   * A felhasznalt helyet a TABLABOL osszegezzuk, nem konyvtar-bejarasbol: a ket
   * meres nem ugyanaz, es az elteresuk MAS kerdes (lasd a
   * `document-store-reconciliation.ts` jegyzetet).
   *
   * BEALLITAS NELKUL NINCS KERET, es ez szandekos: egy kitalalt alapertelmezett
   * hatar egy nap csendben elutasitana egy feltoltest, amirol senki nem dontott.
   *
   * A JELZES NEM ALLITJA MEG A FELTOLTEST, csak naploz. Az MINEKUNK szol, nem a
   * feltoltonek: egy sikeres feltoltes utan riasztast kapni olyasmirol, amin a
   * feltolto nem tud segiteni, csak zaj.
   */
  private async refuseIfOverQuota(incomingBytes: number): Promise<void> {
    const limitBytes = Number(process.env.DOCUMENT_STORE_LIMIT_BYTES ?? 0);
    if (!Number.isFinite(limitBytes) || limitBytes <= 0) return;

    const decision = decideQuota({
      usedBytes: await this.repository.documentBytesInUse(),
      incomingBytes,
      limitBytes,
    });
    if (decision.state === "reject") {
      throw new ConflictException(decision.reason);
    }
    if (decision.state === "warn" && decision.reason) {
      this.logger.warn(decision.reason);
    }
  }

  /**
   * A TAROLO ALLAPOTA, KIFELE IS OLVASHATOAN.
   *
   * MIERT KELL KULON, ES MIERT NEM ELEG, HOGY A KOD TUDJA: a telepitesnek
   * (kotet, jelolo fajl, jogosultsag) van egy pillanata, amikor el kell donteni,
   * SIKERULT-E. Enelkul a valasz csak egy feltoltessel derulne ki, es egy
   * sikertelen feltoltes mar a felhasznalo elott tortenik.
   *
   * A KET KERDES KULON ALL, ahogy a kodban is: `enabled` azt mondja meg,
   * HASZNALJUK-e (a DOCUMENT_STORE_ROOT be van-e allitva), a `status` pedig
   * azt, HASZNALHATO-e. A ketto kulonbozo hibat jelent, es mas ember oldja fel
   * oket: az elso beallitas, a masodik kotet vagy jogosultsag.
   */
  async documentStoreStatus() {
    // KIKAPCSOLT ALLAPOTBAN A VALASZ NEM A KOTETROL SZOL, ES EZT KI KELL MONDANI.
    //
    // MERVE 2026-09-01, egy eles telepites elott: a valasz ilyenkor
    // `{ enabled: false, status: { state: "ready" } }` volt, mert a valtozo
    // hianyaban a MEMORIABELI tarolo fut, annak pedig nincs mit beallitani, tehat
    // feltetel nelkul `ready`-t ad. A `ready` szo IGAZ volt -- csak nem arrol,
    // amirol az olvasoja hitte. A telepites ellenorzese majdnem ugy zarult, hogy
    // "a kotet a helyen van es hasznalhato", holott a kotetet SEMMI nem nezte meg.
    //
    // A KETTO NEM UGYANAZ A KERDES: a `describe()` a FUTO tarolorol beszel, ez a
    // vegpont viszont a TELEPITESROL. Amig nincs bekapcsolva, a kotetrol nincs
    // mondanivalonk, es ezt allitani kell, nem elhallgatni.
    if (!documentStoreEnabled()) {
      return {
        enabled: false,
        status: {
          state: "not-enabled" as const,
          reason:
            "A tárolót nem használjuk (a DOCUMENT_STORE_ROOT nincs beállítva), tehát a bájtok az adatbázisba mennek. A KÖTETRŐL ez a válasz semmit nem mond: a futó tároló a memóriabeli, amin nincs mit ellenőrizni. A kötet meglétét a hoszton kell megnézni.",
        },
      };
    }

    return {
      enabled: true,
      status: await this.documentStore.describe(),
    };
  }

  async document(id: string, documentId: string, scope: PartnerScope) {
    const document = await this.repository.document(id, documentId, scope);
    if (!document) throw new NotFoundException("A dokumentum nem található.");
    return document;
  }

  /**
   * A LETÖLTÉS BÁJTJAI, BÁRMELYIK FORRÁSBÓL.
   *
   * A `storageKey` dönt, nem a `content` hiánya: a tábla megkötése szerint
   * pontosan az egyik áll, tehát a `storageKey` megléte önmagában elég, és a
   * hívónak nem kell két mezőt összevetnie.
   *
   * A RÉGI SOROK VÁLTOZATLANUL MENNEK, migráció nélkül: nekik nincs
   * `storageKey`-ük, és a bájtok ott állnak, ahol eddig.
   *
   * A HIÁNYZÓ FÁJL ÉRTELMES HIBÁT AD, NEM ÜRES LETÖLTÉST. Egy nulla bájtos
   * válasz sikeresnek látszik: a böngésző elmenti, a felhasználó megnyitja, és
   * ő veszi észre a bajt, nem mi. Az 503 azt is kimondja, hogy a hiba a mi
   * oldalunkon van, nem az övén, tehát az újrapróbálás értelmes.
   */
  async documentBytes(id: string, documentId: string, scope: PartnerScope) {
    const document = await this.document(id, documentId, scope);

    if (document.storageKey === null) {
      if (document.content === null) {
        // A tábla CHECK megkötése ezt kizárja; a TÍPUS viszont nem, és egy
        // néma `null` üres letöltéssé válna. Ha ez az ág mégis lefut, az a
        // megkötés megkerülését jelenti, és azt jelenteni kell, nem elfedni.
        throw new ServiceUnavailableException(
          "A dokumentumnak nincs tartalma egyik forrásban sem.",
        );
      }
      return { ...document, bytes: document.content };
    }

    assertStorageKeyMatches(document.storageKey, {
      assetId: id,
      documentId,
    });

    const bytes = await this.documentStore.get({ assetId: id, documentId });
    if (bytes === null) {
      throw new ServiceUnavailableException(
        "A dokumentum tartalma a tárolóban nem érhető el.",
      );
    }
    return { ...document, bytes };
  }

  async deleteDocument(id: string, documentId: string, actorUserId: string) {
    if (!(await this.repository.deleteDocument(id, documentId, actorUserId)))
      throw new NotFoundException("A dokumentum nem található.");
  }

  private async validateReferences(input: {
    ownerType: "CUSTOMER" | "SUPPLIER";
    ownerId: string;
    customerAddressId?: string | null;
    departmentId?: string | null;
    aquariumId?: string | null;
    parentAssetId?: string | null;
    productVariantId?: string | null;
  }) {
    const context = await this.repository.validationContext(input);
    const owner = context.customer ?? context.supplier;
    if (!owner)
      throw new BadRequestException("A kiválasztott partner nem található.");
    if (!owner.isActive)
      throw new BadRequestException(
        "Archivált partnerhez nem rögzíthető új eszköz vagy elhelyezés.",
      );
    if (
      input.ownerType === "SUPPLIER" &&
      (input.customerAddressId || input.aquariumId)
    )
      throw new BadRequestException(
        "Beszállító partnerhez vevői cím vagy akvárium nem rendelhető.",
      );
    if (input.customerAddressId && !context.address)
      throw new BadRequestException("A kiválasztott partnercím nem található.");
    if (context.address && context.address.customerId !== input.ownerId)
      throw new BadRequestException(
        "A kiválasztott cím nem ehhez a partnerhez tartozik.",
      );
    // AZ ALEGYSÉG a partner „Alegységek" fájának egy csomópontja, és a döntés
    // külön függvényben áll, hogy egységteszt tudja mérni -- lásd
    // asset-department.ts. A `requested` az undefined és a null között tesz
    // különbséget: a mező elhagyása nem törlés.
    const departmentRefusal = assetDepartmentRefusal({
      ownerType: input.ownerType,
      mirrorCustomerId: context.supplier?.customerId ?? null,
      department: context.department,
      requested: Boolean(input.departmentId),
    });
    if (departmentRefusal)
      throw new BadRequestException(
        ASSET_DEPARTMENT_REFUSAL_MESSAGES[departmentRefusal],
      );
    if (input.aquariumId && !context.aquarium)
      throw new BadRequestException("A kiválasztott akvárium nem található.");
    if (
      context.aquarium &&
      (context.aquarium.customerId !== input.ownerId ||
        !context.aquarium.isActive)
    )
      throw new BadRequestException(
        "Az akvárium nem aktív, vagy nem ehhez a partnerhez tartozik.",
      );
    if (input.parentAssetId && !context.parent)
      throw new BadRequestException(
        "A kiválasztott szülőeszköz nem található.",
      );
    if (
      context.parent &&
      (context.parent.customerId !==
        (input.ownerType === "CUSTOMER" ? input.ownerId : null) ||
        context.parent.supplierId !==
          (input.ownerType === "SUPPLIER" ? input.ownerId : null))
    )
      throw new BadRequestException(
        "A szülő- és gyermekeszköznek ugyanahhoz a partnerhez kell tartoznia.",
      );
    if (context.parent?.status === "RETIRED")
      throw new BadRequestException(
        "Kivezetett eszközhöz nem rendelhető új gyermekeszköz.",
      );
    if (
      context.parent?.customerAddressId &&
      input.customerAddressId &&
      context.parent.customerAddressId !== input.customerAddressId
    )
      throw new BadRequestException(
        "A gyermekeszköz helyszíne nem térhet el a szülőeszköz helyszínétől.",
      );
    if (
      context.parent?.aquariumId &&
      input.aquariumId &&
      context.parent.aquariumId !== input.aquariumId
    )
      throw new BadRequestException(
        "A gyermekeszköz akváriuma nem térhet el a szülőeszköz akváriumától.",
      );
    if (input.productVariantId && !context.productVariant)
      throw new BadRequestException("A kiválasztott termék nem található.");
    if (context.productVariant && !context.productVariant.isActive)
      throw new BadRequestException(
        "Archivált termék nem kapcsolható új eszközhöz.",
      );
  }

  private map(error: unknown, scope?: PartnerScope): never {
    /**
     * A MATRICAKOD-UTKOZES 409, NEM 400.
     *
     * A keres alakja helyes volt: a kod egy betu es negy szam. Ami nem all,
     * az a VILAG allapota -- a kod nincs a keszletben, vagy mar mason ul.
     * Egy 400 azt mondana a hivonak, hogy javitsa ki, amit kuldott; itt nem
     * a keresen kell javitani, hanem masik matricat kell olvasni.
     *
     * KIVETEL: az ALAK-hiba is ezen az osztalyon jon vissza (a tarolo mar a
     * tranzakcio elott dob), es az VALOBAN a keres hibaja. Ezert valik ketfele
     * itt, es nem a taroloban: a tarolo dolga megnevezni, MI nem all, a
     * szolgaltatase eldonteni, KINEK szol a mondat.
     */
    if (error instanceof AssetLabelUnavailableError) {
      if (normalizeAssetLabelCode(error.code) === null)
        throw new BadRequestException(
          "A matricakód alakja egy betű és négy szám (például V2196).",
        );
      throw new ConflictException(
        scope?.kind === "internal"
          ? MATRICA_UZENET_BELSOS
          : MATRICA_UZENET_PARTNER,
      );
    }
    if (error instanceof Error && error.message === "ASSET_HIERARCHY_CYCLE")
      throw new BadRequestException(
        "Az eszközhierarchia nem tartalmazhat önmagába visszatérő kapcsolatot.",
      );
    if (error instanceof Error && error.message === "STALE_UPDATE")
      throw new ConflictException(
        "Az eszközt másik felhasználó módosította. Frissítsd az oldalt.",
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    )
      throw new NotFoundException("Az eszköz nem található.");
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new ConflictException(
        "Az eszközazonosító már használatban van. Próbáld újra.",
      );
    throw error;
  }
}
