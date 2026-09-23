import { randomUUID } from "node:crypto";

import type {
  AssetDocumentTypeValue,
  PartnerScope,
} from "../auth/partner-scope.util.js";
import { partnerScopeOf } from "../auth/partner-scope.util.js";
import { assetDeletionRefusal } from "./asset-deletion.js";
import { normalizeDocumentCaption } from "../documents/document-caption.js";
import { describeFieldConflict } from "./asset-field-conflict.js";
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
import type {
  AssetDocumentSummary,
  AssetQrCode,
  AuthenticatedUser,
} from "@acropora/types";
import {
  ASSET_LABEL_CODE_SHAPE_MESSAGE,
  assetLabelCreateProblem,
  hasPermission,
  normalizeAssetLabelCode,
  PERMISSIONS,
} from "@acropora/types";
import { scanLabelOutcome } from "./scan-label-outcome.js";
import {
  AssetLabelPoolExhaustedError,
  AssetLabelUnavailableError,
  AssetPerformancePairError,
  AssetVolumeMalformedError,
  AssetPowerConsumptionMalformedError,
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
import { assertStorageKeyMatches } from "./document-store/document-storage-key.js";
import { documentStoreEnabled } from "./document-store/document-store.provider.js";
import {
  discardStoredDocument,
  DocumentOverQuota,
  DocumentRejected,
  prepareDocument,
} from "../documents/document-intake.js";
import { createAssetQrSvg } from "./qr-svg.js";
import { ServiceAssetsRepository } from "./service-assets.repository.js";
import {
  thumbnailResponse,
  wantsThumbnail,
} from "../documents/document-thumbnail.js";

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

  /**
   * A HIVO LATASI HATOKORE, EGY HELYEN FELOLDVA.
   *
   * Ket adatot ad vissza, mert a szabaly KETTOBOL all: kie a sor (ugyfel vagy
   * szallito), ES melyik helyszinen all. Balazs 2026-09-22 07:46:59: egy partner
   * csak a hozza RENDELT helyszinek dolgait lassa.
   *
   * === MIERT ITT, ES NEM A KONTROLLERBEN ===
   *
   * A repoban MAR VAN pontosan ilyen alak: `serviceJobVisibilityFor(user, ...)`.
   * A kontroller a USER-t adja at, a szolgaltatas oldja fel mindkettot. Ha a
   * kontroller oldana fel, a szabaly annyi helyen allna, ahany vegpont -- es a
   * tizennegy hivohely kozul eleg lenne EGYET kifelejteni ahhoz, hogy csendben
   * tagabb maradjon.
   *
   * === A BELSOS AGON A MASODIK LEKERDEZEST EL SEM INDITJUK ===
   *
   * `internal` hatokornel a szuro ures, tehat a hozzarendelt egysegek nem
   * szamitanak. Ez nem gyorsitas: egy belsos hivo nem is visel hozzarendelest,
   * es a lekerdezes ures listat adna -- amibol a HIVO oldalan mar nem latszana,
   * hogy szandekosan ures.
   */
  private async latasiHatokor(
    user: AuthenticatedUser,
  ): Promise<{ scope: PartnerScope; assignedUnitIds: string[] }> {
    const scope = partnerScopeOf(user);
    if (scope.kind === "internal") return { scope, assignedUnitIds: [] };
    return {
      scope,
      assignedUnitIds: await this.repository.assignedUnitIds(user.id),
    };
  }

  async list(query: AssetListQueryDto, user: AuthenticatedUser) {
    const { scope, assignedUnitIds } = await this.latasiHatokor(user);
    return this.repository.list(query, scope, assignedUnitIds);
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

  /**
   * A NÉV-ÜTKÖZÉS ELLENŐRZÉSE, A MENTÉS ELŐTT. Lásd a vezérlő jegyzetét: ez
   * a MENTÉS ELÉ kerülő, olvasó lépés, nem a létrehozás egy ága.
   */
  nameMatches(name: string) {
    return this.repository.matchesByName(name);
  }

  /**
   * AZ ESZKOZ LETEZIK-E, ES A KEROE-E -- A KET IRO UT KOZOS KAPUJA.
   *
   * === MIERT KELL, HOLOTT A VEGPONTON MAR ALL EGY JOG ===
   *
   * A `PATCH :id` es a `POST :id/qr/rotate` a `SERVICE_MANAGE` jog alatt all,
   * es ez a jog NEM belsos jelolo: a `PARTNER_SERVICE` szerep MEGKAPJA
   * (`ROLE_PERMISSIONS`, merve 2026-09-21). Balazs kifejezetten kerte, hogy a
   * partner tudjon dokumentumot feltolteni az eszkozre es a hibajegyre, es az
   * UGYANEZEN a jogon all -- tehat a jogot elvenni nem lehet, mert azzal a
   * feltoltes is elveszne.
   *
   * A HATAR EZERT A HATOKOR, NEM A JOG. Es a kerdes, amit ez a sor feltesz,
   * nem az, hogy a hivonak VAN-E JOGA szerkeszteni, hanem hogy EZT AZ
   * ESZKOZT kezeli-e. A ketto kulonbsege nem szohasznalat: a partner a SAJAT
   * eszkozet tovabbra is szerkesztheti, es epp ezert lenne felrevezeto egy
   * "nincs jogod" alaku elutasitas.
   *
   * === MIERT 404, ES NEM 403 ===
   *
   * Ugyanaz, mint a `detail` es a `scan` agan: egy idegen hatokorbol nezve az
   * a sor NEM LETEZIK. Egy 403 elarulna, hogy letezik -- es epp az eszkoz
   * azonositoja az, amibol egy vegigprobalas indulna.
   *
   * === AMIT EZ A KAPU SZANDEKOSAN NEM ERINT ===
   *
   * A `remove` tovabbra is BELSOS agon ellenorzi a letezest, es az helyes: az
   * a vegpont `SERVICE_ASSET_DELETE` jog alatt all, amit partner-fiok NEM kap
   * meg (merve ugyanakkor). Ott tehat a jog tenyleg kapu, itt nem volt az.
   */
  private async requireAssetInScope(id: string, user: AuthenticatedUser) {
    const asset = await this.detail(id, user);
    return asset;
  }

  async detail(id: string, user: AuthenticatedUser) {
    const { scope, assignedUnitIds } = await this.latasiHatokor(user);
    const asset = await this.repository.detail(id, scope, assignedUnitIds);
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
    // A TAROLOT KOZVETLENUL HIVJUK, mert a `detail` mostantol a HIVO
    // felhasznalojat veszi -- itt pedig szandekosan NINCS hivo-hatokor (a
    // vegpont a `SERVICE_ASSET_DELETE` jog alatt all, amit partner nem kap meg).
    // A kimondott `internal` plusz ures egyseg-lista ugyanazt jelenti, mint
    // eddig, csak most latszik is, hogy dontes.
    const letezik = await this.repository.detail(id, { kind: "internal" }, []);
    if (!letezik) throw new NotFoundException("Az eszköz nem található.");
    const blockers = await this.repository.deletionBlockers(id);
    const refusal = assetDeletionRefusal(blockers);
    if (refusal) throw new ConflictException(refusal);
    await this.repository.remove(id);
    return { ok: true as const };
  }

  async scan(qrToken: string, user: AuthenticatedUser) {
    const { scope, assignedUnitIds } = await this.latasiHatokor(user);
    const asset = await this.repository.detailByQrToken(
      qrToken,
      scope,
      assignedUnitIds,
    );
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
      departmentId: input.departmentId,
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
   * MIT TALALTUNK A BEOLVASOTT MATRICAKODON.
   *
   * A VALASZOK HATARA: rossz ALAK -> 400 (a keresen kell javitani); minden mas
   * esetben a valasz vagy egy UNIO-TAG, vagy 404.
   *
   * === EZ A FEJLEC 2026-09-22-EN ATIRODOTT, ES A REGI ALAKJA MA MAR KEVES ===
   *
   * Az allt itt, hogy „nem talalhato -> 404", es hogy a „nincs ilyen kod" meg a
   * „mas partnere" kozott nem teszunk kulonbseget. A MASODIK MONDAT VALTOZATLANUL
   * ALL -- az elso viszont ma mar nem fedi a valosagot: a SZABAD kod (kiadott,
   * de eszkozhoz nem rendelt) KULON valaszt kap, mert a FEL 2 belepesi pontja
   * ebbol indul.
   *
   * A HAROM ESET ES A KETTO VALASZ:
   *
   *     lathato eszkozon all   -> { kind: "ASSET", asset }
   *     SZABAD                 -> { kind: "FREE", code }, DE csak belso
   *                               hatokornek es irasi joggal
   *     minden mas             -> 404, EGYETLEN alakban
   *
   * A dontes es a MERES, ami eldontotte (a `PARTNER_SERVICE` szerepnek VAN
   * `service.manage` joga), a `scanLabelOutcome` fejleceben all.
   */
  async scanLabel(rawCode: string, user: AuthenticatedUser) {
    const code = normalizeAssetLabelCode(rawCode);
    if (code === null)
      throw new BadRequestException(ASSET_LABEL_CODE_SHAPE_MESSAGE);
    const { scope, assignedUnitIds } = await this.latasiHatokor(user);
    const asset = await this.repository.detailByLabelCode(
      code,
      scope,
      assignedUnitIds,
    );
    /**
     * A HAROM ESET SZETVALASZTASA -- A DONTES TISZTA FUGGVENYBEN ALL
     * (`scanLabelOutcome`), es ott all a MERES is, ami eldontotte.
     *
     * ITT CSAK A BEMENETEK ALLNAK ELO. A szabad keszletet CSAK AKKOR kerdezzuk
     * le, ha nincs lathato eszkoz: egy talalat eseten a kerdes fol sem merul,
     * es egy folosleges lekerdezes minden beolvasasra ratenne magat.
     */
    const canManage = hasPermission(user, PERMISSIONS.SERVICE_MANAGE);
    const freeLabel = asset
      ? false
      : await this.repository.freeLabelExists(code);
    const outcome = scanLabelOutcome({
      visibleAsset: asset !== null,
      freeLabel,
      scope,
      canManage,
    });

    if (outcome.kind === "ASSET")
      return { kind: "ASSET" as const, asset: asset! };
    if (outcome.kind === "FREE") return { kind: "FREE" as const, code };
    /*
      A 404 SZOVEGE VALTOZATLAN, ES EZ NEM VELETLEN: HAROM allapotot fed (nem
      letezik, nem lathato, illetve szabad ugy, hogy a hivo nem jogosult a
      szabad valaszra), es a harom kozott kivulrol nem szabad kulonbseget
      tenni. Egy bovebb uzenet („ez a kod szabad, de nincs jogod") pont azt a
      szivargast nyitna meg, amit a szetvalasztas elkerul.
    */
    throw new NotFoundException(
      "Ehhez a matricakódhoz nem tartozik elérhető eszköz.",
    );
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

  async update(
    id: string,
    input: UpdateAssetDto,
    actorUserId: string,
    user: AuthenticatedUser,
  ) {
    /*
      A HATOKOR AZ ELSO SOR, ES EZ A HELYE SZAMIT.

      2026-09-21-ig ez a metodus SEMMILYEN hatokort nem kapott: a
      `repository.basic(id)` a teljes tablat nezi. Egy partner-fioku hivo
      tehat barmelyik eszkozt atirhatta, a sajat helyszinen kivul is -- a
      felulet nem kinalta fel, de az API nyitva allt.

      A kapu a MODOSITAS ELOTT all, nem a valasz osszeallitasakor: egy
      hatokor-ellenorzes az iras UTAN nem hatokor-ellenorzes, hanem elfedes.
    */
    await this.requireAssetInScope(id, user);
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
      departmentId: input.departmentId,
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
      /**
       * A HATOKOR KIMONDVA `internal`, mert a vegpont `SERVICE_MANAGE` jog
       * alatt all (a kontroller 193. sora). Enelkul a `map` a PARTNER-nek
       * szant, OSSZEVONT mondatot adna vissza egy belsos kezelonek -- aki
       * viszont latja a kiadott kodok listajat, tehat neki a ket eset
       * kulonvalasztasa hasznos es nem szivargas.
       */
      this.map(error, { kind: "internal" });
    }
  }

  async rotateQr(id: string, actorUserId: string, user: AuthenticatedUser) {
    /*
      A KOMMENT, AMI ITT ALLT, HAMIS VOLT, ES EZ NEM ELIRAS.

      Szo szerint ezt mondta: "a vegpont SERVICE_MANAGE jog alatt all
      (QR-forgatas, dokumentum-feltoltes), amit partner-oldali felhasznalo nem
      kap meg". A masodik fele NEM IGAZ: a `PARTNER_SERVICE` szerep megkapja a
      `SERVICE_MANAGE` jogot (merve 2026-09-21).

      A kovetkezmenye nem elmeleti volt: a `{ kind: "internal" }` hatokorrel a
      letezes-ellenorzes a TELJES tablan ment, tehat egy partner-fiok BARMELYIK
      eszkoz QR-kodjat lecserelhette. Egy lecserelt kod a regi matricat
      ervenytelenne teszi -- a helyszinen allo eszkozt onnantol nem lehet
      beolvasni.
    */
    await this.requireAssetInScope(id, user);
    try {
      return await this.repository.rotateQr(id, actorUserId);
    } catch (error) {
      this.map(error);
    }
  }

  async qrCode(id: string, user: AuthenticatedUser): Promise<AssetQrCode> {
    const asset = await this.detail(id, user);
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

  /**
   * A HIVO HATOKOREVEL, ES EZ 2026-09-17 OTA IGY VAN.
   *
   * === AMI ITT ALLT, ES MIERT VOLT HAMIS ===
   *
   * "BELSOS UT: a vegpont SERVICE_MANAGE jog alatt all (QR-forgatas,
   * dokumentum-feltoltes), amit partner-oldali felhasznalo nem kap meg."
   *
   * A mondat masodik fele MA NEM IGAZ, es merheto: a `PARTNER_SERVICE` szerep
   * jogai `[SERVICE_VIEW, SERVICE_MANAGE]` (`packages/types/src/auth.ts`).
   * Amit a partner-fiok tenyleg NEM kap meg, az a `SERVICE_ASSET_DELETE` -- es
   * ott, ahol ugyanez a mondat az ESZKOZ torlese mellett all (`remove`), HELYES
   * is. Egy igaz mondat kerult at egy masik helyre, ahol az ellenkezojet
   * allitja.
   *
   * === MIERT EZ A ROSSZABBIK FELE ===
   *
   * A kod egy kor alatt javithato; egy hamis vedelem-leiras evekig all, es a
   * kovetkezo olvaso RA TAMASZKODIK. Ezert nem eleg atvezetni a hatokort: a
   * mondatot is ki kell cserelni arra, ami igaz.
   *
   * === MIERT CSAK A TULAJDONOS, ES NEM A FAJTA IS ===
   *
   * A feltoltes UJ sort hoz letre, tehat nem tud elarulni semmit egy letezo
   * sorrol. A fajta-szures (`scopeMaySeeDocumentType`) azokon az utakon all,
   * amelyek egy MAR LETEZO csatolmanyt erintenek (felirat, torles, olvasas) --
   * ott a szures a LETEZES elfedeserol is szol. Ha valaha kiderul, hogy egy
   * partner ne tolthessen fel szamlat, az EGY KERDES lesz, nem csendes
   * bovites.
   */
  async addDocument(
    id: string,
    /**
     * A FAJTA A KOZOS LISTABOL SZARMAZIK, NEM KEZZEL IRT UNIOBOL.
     *
     * Itt 2026-09-22-ig a negy ertek BEEGETVE allt, es a PHOTO felvetelekor a
     * fordito ezt MEGFOGTA (`TS2345` a hivo oldalan) -- de csak a MASODIK
     * korben: az elso futasban a webes hiba megolte az api typecheck feladatat
     * (turbo), tehat egy koron at ugy nezett ki, mintha nem lenne itt semmi.
     */
    type: AssetDocumentTypeValue,
    file: Express.Multer.File,
    actorUserId: string,
    user: AuthenticatedUser,
    caption?: string | null,
  ) {
    // A HIANY EGYFELE ALAKBAN ALL, es a szabaly KOZOS a harom gazdan.
    const felirat = normalizeDocumentCaption(caption);
    await this.detail(id, user);
    // A BEJELENTETT TÍPUS ÉS A TARTALOM EGYÜTT DÖNT, és ez a szabály nem
    // lazult azzal, hogy a kép is bekerült: mindkettőnek egyeznie kell.
    // A lista és a szándékosan kihagyott formátumok indoka a
    // `uploaded-file-type.ts` fejlécében áll.
    /**
     * A FELTOLTES SZABALYAI A KOZOS MAGBAN ALLNAK (`documents/document-intake.ts`).
     *
     * MI MARAD ITT: a jogosultsag (fentebb, a `detail` belsos hivasa), a SOR
     * irasa, es a hibak leforditasa HTTP valaszra. A tobbi -- tartalom-
     * felismeres, fajlnev, sha256, keret, a tarolo es a visszaeses, a sorrend --
     * gazdatol fuggetlen, es a munkalap ugyanazt hasznalja.
     */
    const documentId = randomUUID();
    let prepared;
    try {
      prepared = await prepareDocument(
        {
          owner: "asset",
          ownerId: id,
          documentId,
          file,
        },
        {
          store: this.documentStore,
          usedBytes: () => this.repository.documentBytesInUse(),
          logger: this.logger,
        },
      );
    } catch (error) {
      // A KET ELUTASITAS KET KULONBOZO HTTP VALASZ, es ezt a mag NEM tudhatja:
      // ott nincs Nest. A rossz fajl a KULDO hibaja (400), a betelt keret a
      // rendszere (409).
      if (error instanceof DocumentRejected)
        throw new BadRequestException(error.message);
      if (error instanceof DocumentOverQuota)
        throw new ConflictException(error.message);
      throw error;
    }

    if (prepared.placement === "database")
      return this.repository.addDocument({
        ...prepared.common,
        assetId: id,
        type,
        caption: felirat,
        actorUserId,
        content: prepared.content,
      });

    try {
      return await this.repository.addDocument({
        ...prepared.common,
        assetId: id,
        type,
        caption: felirat,
        actorUserId,
        content: null,
        storageKey: prepared.storageKey,
      });
    } catch (error) {
      // A SOR NEM JOTT LETRE, TEHAT A FAJL SEM MARADHAT. Ha a takaritas is
      // bukik, a fajl elarvultan marad, es az osszevetes megtalalja -- tehat
      // nem veszik el, csak keson derul ki.
      await discardStoredDocument(
        { owner: "asset", ownerId: id, documentId },
        { store: this.documentStore },
      );
      throw error;
    }
  }

  /**
   * A FELIRAT ATIRASA EGY MAR FELTOLTOTT CSATOLMANYON.
   *
   * MIERT KELL A FELTOLTESKORI MELLE: a bizonyitek gyakran elobb keszul el,
   * mint a magyarazata -- egy szamla vagy egy garancialevel kepe utolag kap
   * nevet attol, aki iktatja.
   *
   * A HIVO HATOKOREVEL MEGY, es ez 2026-09-17 ota igy van: addig `internal`
   * hatokorrel hivta a `detail`-t, arra hivatkozva, hogy a `SERVICE_MANAGE`
   * jogot partner-fiok nem kapja meg. Megkapja (`PARTNER_SERVICE`), tehat a
   * hivatkozas nem allt.
   *
   * KET SZURES ALL RAJTA, nem egy: az ESZKOZ a keroe (itt, a `detail`-ben), ES
   * a FAJTA lathato neki (a tarolo feltetelben). A masodik nelkul egy partner
   * atirhatna egy olyan csatolmany feliratat, amit meg sem lat.
   */
  async setDocumentCaption(
    id: string,
    documentId: string,
    caption: string | null | undefined,
    user: AuthenticatedUser,
  ): Promise<{ ok: true }> {
    const { scope, assignedUnitIds } = await this.latasiHatokor(user);
    await this.detail(id, user);
    const erintett = await this.repository.setDocumentCaption(
      id,
      documentId,
      normalizeDocumentCaption(caption),
      scope,
      assignedUnitIds,
    );
    // A NULLA ERINTETT SOR NEM SIKER: a felulet a sajat begepelt szoveget
    // mutatna tovabb, mintha mentve lenne.
    if (erintett === 0)
      throw new NotFoundException("A csatolmány nem található.");
    return { ok: true };
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

  /**
   * EGY ESZKÖZ CSATOLMÁNYAI, TARTALOM NÉLKÜL.
   *
   * === A VÁLASZ BURKA A JEGYÉÉ, ÉS EZ KIKÖTÉS VOLT ===
   *
   * `{ items: [...] }`, ugyanúgy, mint a hibajegynél
   * (`ServiceJobDocumentsService.documents`). Két képernyő ugyanazt a galériát
   * rajzolja, és ha a burkok eltérnének, a kliensnek két alakot kellene
   * kezelnie ugyanarra a dologra -- a következő javítás pedig megint kétszer
   * kellene.
   *
   * A TÉTELEK TÍPUSA VISZONT KÜLÖNBÖZIK, és ezt kimondom, mert mérhető: az
   * `AssetDocumentSummary` négy fajtát ismer (INVOICE/WARRANTY/MANUAL/OTHER)
   * és van `uploadedBy` mezője, a jegyé kettőt (PHOTO/OTHER) és nincs. A
   * burkok egyezése tehát NEM jelenti azt, hogy egy közös típus alá vonhatók.
   *
   * === MIÉRT A `detail` ÚTJÁN MEGY, ÉS MIÉRT NEM SAJÁT LEKÉRDEZÉSSEL ===
   *
   * A hatókör-szűrés itt NEM ismétlődik meg: ez a metódus ugyanazt a `detail`
   * utat használja, amit az adatlap. Kettő van belőle, és mindkettő ugyanabban
   * a hívásban áll:
   *
   *   1. LÁTHATÓ-E MAGA AZ ESZKÖZ    `rowBelongsToScope`, a `repository.detail`-ben
   *   2. LÁTHATÓ-E EZ A FAJTA IRAT   `scopeMaySeeDocumentType`, a `toDetail`-ben
   *
   * Egy saját lekérdezés mindkettőt megismételné, és az ismétlés NÉMÁN csúszik
   * el: egy ötödik dokumentum-fajta felvételénél az egyik ágat átvezetjük, a
   * másikat nem, és a lista TÁGABB lesz, mint az adatlap. A hibajegy oldalán
   * pontosan ezért áll a `requireVisibleJob` egyetlen helyen.
   *
   * AMIT EZ AZ ALAK CSERÉBE ELKÉR, ÉS AMIT KIMONDOK: a `detail` TÖBBET olvas,
   * mint amennyit ez visszaad (száz esemény, a gyerekek, az ősök, az
   * egység-utak). Ez a végpont a galéria FRISSÍTÉSE feltöltés vagy törlés után
   * -- az első betöltésnél az adatlap válasza már tartalmazza a listát --,
   * tehát a többlet egy felhasználói mozdulatra jut. Ha ez valaha mérhető
   * teherré nő, a szűkebb lekérdezés MELLÉ a két szűrésnek közös függvénybe
   * kell kerülnie, különben a fenti csúszás kinyílik.
   *
   * A NEM LÁTHATÓ ESZKÖZ 404, NEM ÜRES LISTA. A kettő a kliensen
   * megkülönböztethetetlen lenne, és az üres lista azt állítaná, hogy nincs
   * csatolmány -- holott az van, csak nem a kérőé.
   */
  async documents(
    id: string,
    user: AuthenticatedUser,
  ): Promise<{ items: AssetDocumentSummary[] }> {
    const asset = await this.detail(id, user);
    return { items: asset.documents };
  }

  async document(id: string, documentId: string, user: AuthenticatedUser) {
    const { scope, assignedUnitIds } = await this.latasiHatokor(user);
    const document = await this.repository.document(
      id,
      documentId,
      scope,
      assignedUnitIds,
    );
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
  async documentBytes(
    id: string,
    documentId: string,
    user: AuthenticatedUser,
    variant?: string,
  ) {
    /*
      A CSEMPE KEPE ELOSZOR, ES CSAK AKKOR, HA A HIVO AZT KERTE.

      A HATOKOR-ELLENORZES MAR MEGTORTENT FELETTE: ez az ag ugyanazon a kapun
      belul all, tehat egy belyegkep sem erheto el olyannak, aki a csatolmanyt
      magat nem lathatja.

      A VISSZAESES HALLGATOLAGOS, ES EZ MEGKOTES (acrobot, 2026-09-18): ha nincs
      belyegkep -- mert regi a sor, mert PDF, vagy mert az eloallitas elhasalt --,
      a valasz az EREDETI. Egy hibauzenet itt azt jelentene, hogy a csempe
      eltorik olyan sorokon, amik ma hibatlanul mukodnek.
    */
    if (wantsThumbnail(variant)) {
      const { scope, assignedUnitIds } = await this.latasiHatokor(user);
      const kicsi = await this.repository.documentThumbnail(
        id,
        documentId,
        scope,
        assignedUnitIds,
      );
      if (kicsi) return thumbnailResponse(kicsi);
    }

    const document = await this.document(id, documentId, user);

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
      owner: "asset",
      ownerId: id,
      documentId,
    });

    const bytes = await this.documentStore.get({
      owner: "asset",
      ownerId: id,
      documentId,
    });
    if (bytes === null) {
      throw new ServiceUnavailableException(
        "A dokumentum tartalma a tárolóban nem érhető el.",
      );
    }
    return { ...document, bytes };
  }

  /**
   * A CSATOLMANY TORLESE, A HIVO HATOKOREVEL.
   *
   * A KET SZURES A TAROLOBAN ALL, nem itt, es ennek oka van: a torles egyetlen
   * tranzakcioban keresi meg es viszi el a sort. Egy kulon `detail` hivas itt
   * masodik korkerdes lenne ugyanarrol, es a KETTO KOZOTT valtozhatna a vilag.
   *
   * A `SERVICE_ASSET_DELETE` jog, ami a vegpont mellett szokott allni
   * indokkent, EZ ALATT AZ UT ALATT NINCS: a csatolmany torlese
   * `SERVICE_MANAGE` alatt all, es azt a `PARTNER_SERVICE` szerep megkapja.
   */
  async deleteDocument(
    id: string,
    documentId: string,
    actorUserId: string,
    user: AuthenticatedUser,
  ) {
    const { scope } = await this.latasiHatokor(user);
    if (
      !(await this.repository.deleteDocument(
        id,
        documentId,
        actorUserId,
        scope,
      ))
    )
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
    /**
     * A FEL PAR 400: A KERES HIANYOS, NEM A VILAG ALLAPOTA.
     *
     * A hiba MAGA hordozza a mondatot, mert az a tarolo dolga: ott dol el,
     * MELYIK fele hianyzik. Itt csak a valaszkod dol el.
     */
    if (error instanceof AssetPerformancePairError)
      throw new BadRequestException(error.message);
    if (error instanceof AssetVolumeMalformedError)
      throw new BadRequestException(error.message);
    if (error instanceof AssetPowerConsumptionMalformedError)
      throw new BadRequestException(error.message);
    if (error instanceof Error && error.message === "ASSET_HIERARCHY_CYCLE")
      throw new BadRequestException(
        "Az eszközhierarchia nem tartalmazhat önmagába visszatérő kapcsolatot.",
      );
    /**
     * MEZO-SZINTU UTKOZES: A MEZOT MEG IS NEVEZZUK.
     *
     * A tarolo a mezoneveket a hibauzenetben adja at, mert ott nincs sajat
     * hibatipusa. A MONDAT viszont itt keszul, es az `asset-field-conflict.ts`
     * fuggvenyebol -- egy "valaki modositotta idokozben" szoveg nem mondja meg,
     * MIT kell megnezni.
     */
    if (error instanceof Error && error.message.startsWith("FIELD_CONFLICT:"))
      throw new ConflictException(
        describeFieldConflict(
          error.message.slice("FIELD_CONFLICT:".length).split(","),
        ),
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
