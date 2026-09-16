"use client";

import {
  Alert,
  Button,
  Card,
  FormField,
  Input,
  Select,
  Textarea,
} from "@acropora/ui";
import {
  assetLabelCreateProblem,
  hasPermission,
  normalizeAssetLabelCode,
  normalizePerformanceValue,
  PERMISSIONS,
  type AssetCriticality,
  type AssetKind,
  type AssetListItem,
  type AssetOwnerOption,
  type AssetOwnerType,
  type AssetStatus,
  type UnitOfMeasure,
} from "@acropora/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ServiceBackLink } from "@/components/service/service-detail-chrome";
import { ServiceListHeader } from "@/components/service/service-list-chrome";
import { ServiceOfflineNotice } from "@/components/service/service-offline-notice";
import { useReturnTo } from "@/components/navigation-history";
import { assetsApi } from "@/lib/api/assets";
import { suppliersApi } from "@/lib/api/suppliers";
import { unitsOfMeasureApi } from "@/lib/api/units-of-measure";
import {
  PERFORMANCE_PROBLEM_MESSAGES,
  performancePairProblem,
  performanceUnitOptions,
} from "./asset-performance-field";
import { buildSiteOptions, type SiteOption } from "@/lib/partners/site-tree";
import {
  assetCriticalityLabel,
  assetKindLabel,
  assetStatusLabel,
} from "./asset-labels";

const toIsoDate = (value: string) =>
  value ? `${value}T00:00:00.000Z` : undefined;
const inputDate = (value?: string) => value?.slice(0, 10) ?? "";

const ownerKey = (type: AssetOwnerType, id: string) => `${type}:${id}`;

export function AssetEditorPage({ assetId }: { assetId?: string }) {
  const { session } = useAuth();
  const router = useRouter();
  const backToList = useReturnTo("/szerviz/eszkozok");
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );
  const [owners, setOwners] = useState<AssetOwnerOption[]>([]);
  const [units, setUnits] = useState<SiteOption[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [parentAssets, setParentAssets] = useState<AssetListItem[]>([]);
  const [selectedOwner, setSelectedOwner] = useState("");
  const [customerAddressId, setCustomerAddressId] = useState("");
  const [parentAssetId, setParentAssetId] = useState("");
  const [kind, setKind] = useState<AssetKind>("EQUIPMENT");
  const [status, setStatus] = useState<AssetStatus>("ACTIVE");
  const [criticality, setCriticality] = useState<AssetCriticality>("NORMAL");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [inventoryNumber, setInventoryNumber] = useState("");
  /**
   * AZ ELORE NYOMTATOTT MATRICA KODJA, CSAK FELVITELNEL.
   *
   * KET KULONBOZO AZONOSITO VAN, ES A LAP EDDIG CSAK AZ EGYIKET ISMERTE. Az
   * `Asset.qrToken` az ADATBAZIS alapertelmezese (`@default(uuid())`), tehat
   * minden eszkoz kap egyet, barhonnan is viszik fel -- abbol keszul az adatlap
   * letoltheto QR kepe, es az a beolvasas kulcsa. Az `AssetLabel` ettol
   * fuggetlen: az elore KINYOMTATOTT matricak keszlete (`V2196` alak).
   *
   * BALAZS EZT MERTE VISSZA 2026-09-16 10:32-kor (Discord, Acropora OS szal),
   * szo szerint: "automatikusan egy qr kodot is hzzarendel. de ez igy nem jo,
   * mert nem a qr kod torzsbol veszi". Igaza volt: a szerver oldal es a MOBIL
   * urlap ota kesz, a webes urlapon viszont EGYALTALAN nem volt mezo ra, tehat
   * webrol felvitt eszkozhoz nyomtatott matricat semmilyen uton nem lehetett
   * rendelni.
   *
   * BEIRHATO MEZO, NEM LEGORDULO A SZABAD KODOKBOL. Balazs dontese ugyanabban a
   * korben (10:35): "beirnám kézzel". A `labels/free` vegpont letezik, tehat a
   * legordulo megepitheto lenne -- nem azert nincs, mert nem megy.
   */
  const [labelCode, setLabelCode] = useState("");
  /**
   * A TELJESITMENY ES A MERTEKEGYSEGE -- KET MEZO, EGY ADAT.
   *
   * A ketto EGYUTT mozog: a tablan CHECK all rajta, tehat fel par nem
   * menthetó. Az urlap ezt a szabalyt MEGISMETLI (a mondat a mezo mellett
   * jelenik meg), nem helyettesiti.
   *
   * MIERT SZOVEG A SZAM: a tarolt alak `decimal(19,6)`. Szamma alakitva a
   * bongeszo lebegopontos tipusan menne at, es egy 0,1-es lepeskoz mar
   * `0.30000000000000004` alakban jonne vissza a kezelonek.
   */
  const [performance, setPerformance] = useState("");
  const [performanceUnitId, setPerformanceUnitId] = useState("");
  const [performanceUnits, setPerformanceUnits] = useState<UnitOfMeasure[]>([]);
  /**
   * AZ ESZKOZON MA ALLO EGYSEG, KULON -- MERT LEHET, HOGY MAR KIVEZETTEK.
   *
   * A valaszto az AKTIVAKAT kinalja. Ha az eszkozon egy azota kivezetett
   * egyseg all, es csak az aktivak lennenek a listaban, a legordulo az ELSO
   * elemre esne vissza: a kezelo megnyitja a lapot, egy szot sem ir, ment --
   * es a mertekegyseg megvaltozik. Nemán.
   */
  const [currentUnit, setCurrentUnit] = useState<UnitOfMeasure | undefined>();
  const [installedAt, setInstalledAt] = useState("");
  const [warrantyExpiresAt, setWarrantyExpiresAt] = useState("");
  const [serviceIntervalDays, setServiceIntervalDays] = useState("");
  const [nextServiceAt, setNextServiceAt] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState("");

  const owner = owners.find(
    (item) => ownerKey(item.type, item.id) === selectedOwner,
  );
  const addresses = owner?.addresses ?? [];

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    /**
     * A SORREND itt állítás, nem stílus: előbb az eszköz, utána a lista.
     *
     * A tulajdonos-lista mostantól a szerviz-jelölt partnereké, tehát egy
     * MEGLÉVŐ eszköz tulajdonosa hiányozhat belőle (webshopos vevő vagy nem
     * szerviz-jelölt partner). A szerkesztő ezért megmondja a szervernek, kit
     * kell mindenképp visszaadnia. Enélkül a kötelező mező üresen állna, és a
     * mentés vagy elakadna, vagy csendben más tulajdonost írna oda.
     */
    (assetId
      ? assetsApi.detail(token, assetId, controller.signal)
      : Promise.resolve(null)
    )
      .then(async (asset) => {
        const ownerResult = await assetsApi.owners(
          token,
          controller.signal,
          asset ? { type: asset.owner.type, id: asset.owner.id } : null,
        );
        return [ownerResult, asset] as const;
      })
      .then(([ownerResult, asset]) => {
        setOwners(ownerResult.items);
        if (!asset) return;
        setSelectedOwner(ownerKey(asset.owner.type, asset.owner.id));
        setCustomerAddressId(
          asset.owner.type === "CUSTOMER" ? (asset.address?.id ?? "") : "",
        );
        setDepartmentId(asset.unit?.id ?? "");
        setParentAssetId(asset.parent?.id ?? "");
        setKind(asset.kind);
        setStatus(asset.status);
        setCriticality(asset.criticality);
        setName(asset.name);
        setCategory(asset.category ?? "");
        setManufacturer(asset.manufacturer ?? "");
        setModel(asset.model ?? "");
        setSerialNumber(asset.serialNumber ?? "");
        setInventoryNumber(asset.inventoryNumber ?? "");
        setLabelCode(asset.labelCode ?? "");
        setPerformance(asset.performance ?? "");
        setPerformanceUnitId(asset.performanceUnit?.id ?? "");
        // A MOSTANI EGYSEG A VALASZBOL JON, nem a listabol: ha kozben
        // kivezettek, a lista nem tartalmazza, az eszkozon viszont ott all.
        setCurrentUnit(
          asset.performanceUnit
            ? {
                ...asset.performanceUnit,
                kind: "PERFORMANCE",
                isActive: true,
                sortOrder: 0,
              }
            : undefined,
        );
        setInstalledAt(inputDate(asset.installedAt));
        setWarrantyExpiresAt(inputDate(asset.warrantyExpiresAt));
        setServiceIntervalDays(asset.serviceIntervalDays?.toString() ?? "");
        setNextServiceAt(inputDate(asset.nextServiceAt));
        setDescription(asset.description ?? "");
        setNotes(asset.notes ?? "");
        setUpdatedAt(asset.updatedAt);
      })
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A partnerlista nem tölthető be.",
          );
      })
      .finally(() => setLoadingOptions(false));
    return () => controller.abort();
  }, [assetId, canManage, token]);

  // AZ ALEGYSEGEK a partner sajat kepernyojerol mar ismert vegponton jonnek: ez
  // ugyanaz a fa, amit ott „Alegysegek" neven szerkesztenek. Vevo tulajdonosnal
  // nincs mit betolteni -- ott a cim a pontositas.
  useEffect(() => {
    setUnits([]);
    if (!owner || owner.type !== "SUPPLIER") return;
    const controller = new AbortController();
    void suppliersApi
      .units(token, owner.id, controller.signal)
      .then((result) => setUnits(buildSiteOptions(result.items)))
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A partner alegységei nem tölthetők be.",
          );
      });
    return () => controller.abort();
  }, [owner, token]);

  /**
   * A TELJESITMENY-EGYSEGEK, EGYSZER.
   *
   * CSAK AZ AKTIVAK jonnek: a kivezetett egyseg a valasztobol esik ki. Az
   * eszkozon MAR allo egyseget ettol fuggetlenul mutatjuk (lasd
   * `performanceUnitOptions`) -- a kivezetes a valasztekot szukiti, nem a
   * multat irja at.
   *
   * A HIBA ITT NEM ALLITJA MEG A LAPOT. Ha a torzsadat nem tolthető be, a
   * tobbi mezo akkor is szerkeszthető marad; a teljesitmeny legordulojen ez
   * annyit jelent, hogy ures. Egy egesz urlapot elvenni egy MELLEKES lista
   * miatt nagyobb kar, mint a hianyzo valaszto.
   */
  useEffect(() => {
    const controller = new AbortController();
    void unitsOfMeasureApi
      .list(token, "PERFORMANCE", { signal: controller.signal })
      .then((result) => setPerformanceUnits(result.items))
      .catch(() => setPerformanceUnits([]));
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    setParentAssets([]);
    if (!owner) return;
    const controller = new AbortController();
    const assetQuery = new URLSearchParams({
      page: "1",
      pageSize: "100",
      status: "ACTIVE",
      ownerType: owner.type,
      ownerId: owner.id,
    });
    void assetsApi
      .list(token, assetQuery, controller.signal)
      .then((result) =>
        setParentAssets(result.items.filter((item) => item.id !== assetId)),
      )
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A partner eszközadatai nem tölthetők be.",
          );
      });
    return () => controller.abort();
  }, [assetId, owner, token]);

  useEffect(() => {
    if (assetId) return;
    const interval = Number.parseInt(serviceIntervalDays, 10);
    if (!Number.isInteger(interval) || interval < 1) return;
    const base = installedAt
      ? new Date(`${installedAt}T00:00:00.000Z`)
      : new Date();
    base.setUTCDate(base.getUTCDate() + interval);
    setNextServiceAt(base.toISOString().slice(0, 10));
  }, [assetId, installedAt, serviceIntervalDays]);

  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs jogosultságod eszköz rögzítéséhez"
        description="service.manage jogosultság szükséges."
      />
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!owner || !name.trim()) {
      setError("A partner és az eszköz neve kötelező.");
      return;
    }
    const interval = serviceIntervalDays
      ? Number.parseInt(serviceIntervalDays, 10)
      : undefined;
    if (
      interval !== undefined &&
      (!Number.isInteger(interval) || interval < 1)
    ) {
      setError("A karbantartási intervallum legalább 1 nap legyen.");
      return;
    }
    /**
     * A MATRICA-SZABALY UGYANABBOL A FUGGVENYBOL JON, MINT A SZERVERE ES A
     * TELEFONE. Egy harmadik minta itt pontosan ott csuszna el, ahol senki nem
     * nezi: az urlap atengedne, a mentes meg elutasitana.
     *
     * MOSTANTOL MIND A KET AGON FUT. Korabban csak felvitelnel, mert a szerver
     * `UpdateAssetDto`-ja nem ismert `labelCode` mezot -- Balazs 2026-09-16-i
     * kerese ezt megszuntette, tehat a feltetellel egyutt az INDOKA is elavult.
     *
     * ES UGYANEZ A FUGGVENY JO MIND A KETTORE, nem veletlenul: az URES szovegre
     * `null`-t ad (nincs mit ellenorizni), a rossz alakra `malformed`-ot. A
     * felvitelen az ures azt jelenti, hogy nincs matrica; a szerkeszton azt,
     * hogy nem nyultak hozza. A KERDES ugyanaz -- "jo-e, amit beirtak" --, a
     * ket valasz kulonbsege pedig a kuldesnel dol el, nem itt.
     */
    const labelProblem = assetLabelCreateProblem(labelCode);
    if (labelProblem === "missing") {
      setError("Írd be a matrica kódját.");
      return;
    }
    if (labelProblem === "malformed") {
      setError("A matrica kódja egy betű és négy szám, például V2196.");
      return;
    }
    /**
     * A TELJESITMENY-PAR UGYANAZT A SZABALYT MONDJA, MINT A SZERVER ES A TABLA.
     *
     * Harom rétegben all ugyanaz, es ez NEM duplikacio: itt a visszajelzes
     * gyorsasaga (a kezelo a mezo mellett latja), a szerveren a szabaly, a
     * tablan pedig az, amit semmilyen uj vegpont nem tud megkerulni.
     *
     * A SORREND SZAMIT: az alak-hiba elobb all a hianyzo egysegnel. Egy
     * "otszaz" beirasara a "valassz mertekegyseget" mondat felrevezeto lenne.
     */
    const performanceProblem = performancePairProblem(
      performance,
      performanceUnitId,
      normalizePerformanceValue(performance) === null,
    );
    if (performanceProblem) {
      setError(PERFORMANCE_PROBLEM_MESSAGES[performanceProblem]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = assetId
        ? await assetsApi.update(token, assetId, {
            ownerType: owner.type,
            ownerId: owner.id,
            customerAddressId: customerAddressId || null,
            departmentId: departmentId || null,
            parentAssetId: parentAssetId || null,
            kind,
            status,
            criticality,
            name: name.trim(),
            category: category.trim() || null,
            manufacturer: manufacturer.trim() || null,
            model: model.trim() || null,
            serialNumber: serialNumber.trim() || null,
            inventoryNumber: inventoryNumber.trim() || null,
            installedAt: toIsoDate(installedAt) ?? null,
            warrantyExpiresAt: toIsoDate(warrantyExpiresAt) ?? null,
            serviceIntervalDays: interval ?? null,
            nextServiceAt: toIsoDate(nextServiceAt) ?? null,
            description: description.trim() || null,
            notes: notes.trim() || null,
            // A NORMALIZALT ALAK MEGY EL, es URES MEZONEL EL SEM MEGY -- a
            // tobbi mezovel ellentetben, ahol az ures ertek `null`-kent
            // TORLEST jelent. A matricat ezen az uton nem lehet leszedni (a
            // szerver `string`-et var), es a mezo leirasa ki is mondja.
            labelCode: normalizeAssetLabelCode(labelCode) ?? undefined,
            // A `null` ITT TORLES, a matricaval ELLENTETBEN -- es a ketto
            // egyutt megy: a szerver a PART nezi, nem a mezot. Ket `null`
            // leszedi a teljesitmenyt, egy `null` elbukik.
            performance: normalizePerformanceValue(performance),
            performanceUnitId: performanceUnitId || null,
            expectedUpdatedAt: updatedAt,
          })
        : await assetsApi.create(token, {
            ownerType: owner.type,
            ownerId: owner.id,
            customerAddressId: customerAddressId || undefined,
            departmentId: departmentId || undefined,
            parentAssetId: parentAssetId || undefined,
            kind,
            status,
            criticality,
            name: name.trim(),
            category: category.trim() || undefined,
            manufacturer: manufacturer.trim() || undefined,
            model: model.trim() || undefined,
            serialNumber: serialNumber.trim() || undefined,
            inventoryNumber: inventoryNumber.trim() || undefined,
            // A NORMALIZALT ALAK MEGY EL, nem a begepelt: a tabla megkotese
            // (`AssetLabel_code_shape_check`) csak nagybetut enged, a bemenet
            // viszont szandekosan megengedobb. Ures mezonel a kulcs EL SEM
            // MEGY -- az ures szoveg nem "nincs matrica", hanem ervenytelen kod.
            labelCode: normalizeAssetLabelCode(labelCode) ?? undefined,
            // FELVITELNEL `undefined`, nem `null`: itt nincs mit torolni, es a
            // ket kulcs EGYUTT marad el, kulonben a szerver fel part latna.
            performance: normalizePerformanceValue(performance) ?? undefined,
            performanceUnitId: performanceUnitId || undefined,
            installedAt: toIsoDate(installedAt),
            warrantyExpiresAt: toIsoDate(warrantyExpiresAt),
            serviceIntervalDays: interval,
            nextServiceAt: toIsoDate(nextServiceAt),
            description: description.trim() || undefined,
            notes: notes.trim() || undefined,
          });
      router.push(`/szerviz/eszkozok/${saved.id}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Az eszköz nem menthető.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <ServiceOfflineNotice state={{ kind: "form" }} />
      <ServiceBackLink href={backToList.href}>
        {backToList.fromWithinApp ? "Vissza" : "Eszközök"}
      </ServiceBackLink>
      {/* URLAP-FEJLEC: a prototipus a 29 pixeles cimet MODOSITOKENT
          (`.detail-head`) csak az adatlapokra teszi, az urlapokra nem. Az
          eyebrow itt azt mondja meg, MI EZ A LAP, nem azt, hol allunk. */}
      <ServiceListHeader
        eyebrow={assetId ? "Eszközadatok" : "Új bejegyzés"}
        title={assetId ? "Eszköz módosítása" : "Új eszköz"}
        lead="Önálló berendezés vagy egy meglévő rendszer részegységének rögzítése."
      />
      {error ? (
        <Alert
          variant="danger"
          title="A művelet nem sikerült"
          description={error}
        />
      ) : null}
      <form className="space-y-6" onSubmit={submit}>
        <Card className="p-6">
          <h2 className="text-[16px] font-bold text-ink">Hozzárendelés</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <FormField label="Partner">
              <Select
                required
                aria-label="Partner"
                value={selectedOwner}
                disabled={loadingOptions}
                onChange={(event) => {
                  setSelectedOwner(event.target.value);
                  setCustomerAddressId("");
                  setParentAssetId("");
                }}
              >
                <option value="">Válassz partnert…</option>
                {owners.map((item) => (
                  <option
                    key={ownerKey(item.type, item.id)}
                    value={ownerKey(item.type, item.id)}
                  >
                    {item.type === "CUSTOMER" ? "Vevő" : "Partner"} ·{" "}
                    {item.displayName} ({item.code})
                    {item.outsideServiceScope
                      ? " · jelenlegi tulajdonos, nem szerviz partner"
                      : ""}
                  </option>
                ))}
              </Select>
            </FormField>
            {/* KET KULON MEZO, KET KULON FOGALOM, es a cimkek is ezt mondjak.
                2026-08-27-ig mindkettot „helyszin" nevre hallgatta valami, es
                pont ebbol lett az elso hiba: az eszkoz-felvitelen a mezo minden
                partnernel ures volt, mert a partner-oldalnak nem is volt
                forrasa. A vevo cimet valaszt, a partner ALEGYSEGET. */}
            <FormField label="Vevő címe">
              <Select
                aria-label="Vevő címe"
                value={customerAddressId}
                disabled={!owner || owner.type !== "CUSTOMER"}
                onChange={(event) => setCustomerAddressId(event.target.value)}
              >
                <option value="">Nincs pontosítva</option>
                {addresses.map((address) => (
                  <option key={address.id} value={address.id}>
                    {address.name ? `${address.name} – ` : ""}
                    {address.formatted}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label="Alegység"
              description="A partner alegysége, ahol az eszköz áll. Ugyanaz a lista, amit a partner adatlapján Alegységek néven szerkesztesz."
            >
              <Select
                aria-label="Alegység"
                value={departmentId}
                // Tulajdonos nelkul nincs mit felajanlani: az eszkoznek
                // PONTOSAN egy tulajdonosa van (adatbazis-megkotes), es az
                // alegysegek ahhoz a partnerhez tartoznak.
                disabled={!owner || owner.type !== "SUPPLIER"}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">Nincs pontosítva</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.label}
                    {unit.isActive ? "" : " · archivált"}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Szülőeszköz">
              <Select
                aria-label="Szülőeszköz"
                value={parentAssetId}
                disabled={!owner}
                onChange={(event) => setParentAssetId(event.target.value)}
              >
                <option value="">Önálló / főegység</option>
                {parentAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name} ({asset.assetNumber})
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Típus">
              <Select
                aria-label="Eszköztípus"
                value={kind}
                onChange={(event) => setKind(event.target.value as AssetKind)}
              >
                {Object.entries(assetKindLabel).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Státusz">
              <Select
                aria-label="Eszköz státusza"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as AssetStatus)
                }
              >
                {Object.entries(assetStatusLabel).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-[16px] font-bold text-ink">Azonosítás</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <FormField label="Eszköz neve">
              <Input
                required
                aria-label="Eszköz neve"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="pl. Fóka felnyomó szivattyú"
              />
            </FormField>
            <FormField label="Kategória">
              <Input
                aria-label="Kategória"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="pl. Vízmozgatás"
              />
            </FormField>
            <FormField label="Gyártó">
              <Input
                aria-label="Gyártó"
                value={manufacturer}
                onChange={(event) => setManufacturer(event.target.value)}
              />
            </FormField>
            <FormField label="Modell">
              <Input
                aria-label="Modell"
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
            </FormField>
            <FormField label="Sorozatszám">
              <Input
                aria-label="Sorozatszám"
                value={serialNumber}
                onChange={(event) => setSerialNumber(event.target.value)}
              />
            </FormField>
            {/*
              A TELJESITMENY ES A MERTEKEGYSEGE EGYMAS MELLETT ALL, es ez nem
              elrendezesi kerdes: a ketto EGY adat. Egy "500" mertekegyseg
              nelkul nem informacio, hanem talalgatasra hivas -- es a mentes
              is elutasitja. Ket kulon helyen allva a kezelo nem latna, hogy
              osszetartoznak.
            */}
            <FormField
              label="Teljesítmény"
              description="Tizedesvesszővel is írható (például 0,5)."
            >
              <Input
                aria-label="Teljesítmény"
                inputMode="decimal"
                value={performance}
                onChange={(event) => setPerformance(event.target.value)}
                placeholder="pl. 500"
              />
            </FormField>
            <FormField label="Mértékegység">
              <Select
                aria-label="Mértékegység"
                value={performanceUnitId}
                onChange={(event) => setPerformanceUnitId(event.target.value)}
              >
                <option value="">Nincs megadva</option>
                {performanceUnitOptions(performanceUnits, currentUnit).map(
                  (unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.code} -- {unit.name}
                    </option>
                  ),
                )}
              </Select>
            </FormField>
            <FormField label="Leltári szám">
              <Input
                aria-label="Leltári szám"
                value={inventoryNumber}
                onChange={(event) => setInventoryNumber(event.target.value)}
              />
            </FormField>
            {/*
              A MI MATRICANK, NEM A PARTNERE. A fenti mezo a partner sajat
              szama; ez az altalunk elore kinyomtatott kod.

              CSAK FELVITELNEL LATSZIK, es a mondat ki is mondja, miert: a
              szerver meglevo eszkozon nem fogad matricakodot. Egy mezo, ami
              szerkeszteskor is ott allna, de mentesnel csendben elveszne,
              rosszabb a hianyzo mezonel.
            */}
            <FormField
              label="Matrica kódja"
              description={
                assetId
                  ? "Az előre nyomtatott matricáról, egy betű és négy szám (például V2196). Ha már áll rajta kód, az itt látszik: másikat beírva a régi visszakerül a szabad készletbe. A mező kiürítése nem szedi le a matricát."
                  : "Az előre nyomtatott matricáról, egy betű és négy szám (például V2196). Elhagyható, és utólag ezen a lapon is pótolható."
              }
            >
              <Input
                aria-label="Matrica kódja"
                value={labelCode}
                onChange={(event) => setLabelCode(event.target.value)}
                placeholder="V2196"
              />
            </FormField>
            <FormField label="Kritikusság">
              <Select
                aria-label="Kritikusság"
                value={criticality}
                onChange={(event) =>
                  setCriticality(event.target.value as AssetCriticality)
                }
              >
                {Object.entries(assetCriticalityLabel).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <FormField label="Leírás" className="mt-4">
            <Textarea
              aria-label="Leírás"
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </FormField>
        </Card>

        <Card className="p-6">
          <h2 className="text-[16px] font-bold text-ink">Karbantartás</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <FormField label="Telepítés dátuma">
              <Input
                type="date"
                aria-label="Telepítés dátuma"
                value={installedAt}
                onChange={(event) => setInstalledAt(event.target.value)}
              />
            </FormField>
            <FormField label="Garancia lejárata">
              <Input
                type="date"
                aria-label="Garancia lejárata"
                value={warrantyExpiresAt}
                onChange={(event) => setWarrantyExpiresAt(event.target.value)}
              />
            </FormField>
            <FormField label="Intervallum (nap)">
              <Input
                type="number"
                min={1}
                max={3650}
                aria-label="Karbantartási intervallum"
                value={serviceIntervalDays}
                onChange={(event) => setServiceIntervalDays(event.target.value)}
              />
            </FormField>
            <FormField label="Következő karbantartás">
              <Input
                type="date"
                aria-label="Következő karbantartás"
                value={nextServiceAt}
                onChange={(event) => setNextServiceAt(event.target.value)}
              />
            </FormField>
          </div>
          <FormField label="Belső megjegyzés" className="mt-4">
            <Textarea
              aria-label="Belső megjegyzés"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </FormField>
        </Card>

        {/* A "MEGSEM" A MENTES MELLE KERULT: a kilepes a cim folott is ott
            all, de az urlap vegen, a kitoltes utan ott keresik. Ugyanaz az ut,
            a masodik helyen, ahol szukseg van ra. */}
        <div className="flex justify-end gap-2">
          <Link href={backToList.href}>
            <Button type="button" variant="secondary" disabled={busy}>
              Mégsem
            </Button>
          </Link>
          <Button type="submit" disabled={busy || loadingOptions}>
            {busy
              ? "Mentés…"
              : assetId
                ? "Módosítások mentése"
                : "Eszköz létrehozása"}
          </Button>
        </div>
      </form>
    </div>
  );
}
