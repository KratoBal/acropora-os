"use client";

import { Alert, Icon } from "@acropora/ui";
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
  type AssetCategory,
  type AssetFunction,
  type AquariumSummary,
} from "@acropora/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useReturnTo } from "@/components/navigation-history";
import { ServiceOfflineNotice } from "@/components/service/service-offline-notice";
import { assetsApi } from "@/lib/api/assets";
import { assetCategoriesApi } from "@/lib/api/asset-categories";
import { assetFunctionsApi } from "@/lib/api/asset-functions";
import { aquariumsApi } from "@/lib/api/aquariums";
import { suppliersApi } from "@/lib/api/suppliers";
import { unitsOfMeasureApi } from "@/lib/api/units-of-measure";
import {
  PERFORMANCE_PROBLEM_MESSAGES,
  performancePairProblem,
  performanceUnitOptions,
} from "../asset-performance-field";
import { buildSiteOptions, type SiteOption } from "@/lib/partners/site-tree";
import {
  assetCriticalityLabel,
  assetKindLabel,
  assetStatusLabel,
} from "../asset-labels";
import {
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotFormField,
  PilotInput,
  PilotSelect,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";

/**
 * A FIGMA MAKE TERV ÁTÜLTETÉSE -- ÚJ ESZKÖZ ŰRLAP (7. kör, 3/3 rész).
 *
 * Brief: `exchange/figma-eszkozok-atultetes-brief-2026-09-25.md`, forrás:
 * `exchange/figma-eszkozok-make-7/src/EszközScreen.tsx` (`UjEszköz`,
 * 776-914. sor). Ez a HARMADIK a három oldalból (lista #1086, adatlap
 * #1088[jav.], új eszköz -- ez a PR).
 *
 * === A VALÓDI ŰRLAP LOGIKÁJA VÁLTOZATLAN, CSAK A STÍLUS FIGMA ===
 *
 * A validáció, a mentés (`assetsApi.create`), a mezők közötti függés
 * (Alegység csak szerviz partnernél, Vevő címe csak vevőnél, a
 * kategória/funkció/mértékegység törzsadatok, a névütközés figyelmeztetés,
 * a matricakód- és teljesítmény-pár ellenőrzés) SZÓ SZERINT a mai
 * `asset-editor-page.tsx` create-ágából jön -- ez háromszorosan tesztelt
 * (szerver, tábla, a régi űrlap saját teszt-sora), egy negyedik, saját
 * másolat csak elszakadási kockázatot vinne. A KIVEZETETT kategória/funkció
 * megőrzését ez a lap NEM viszi át: az az adatlap szerkesztés-ágának
 * problémája (egy MÁR létező eszközön állhat kivezetett érték), új
 * eszköznél a választó induláskor üres, és csak az aktív listából
 * választhat -- ez nem egyszerűsítés adatvesztéssel, hanem a helyzet, ami
 * create módban egyáltalán nem áll elő.
 *
 * === A NÉGY KÁRTYA A FIGMA SZERINT, A VALÓDI MEZŐK A LEHETŐ
 *     LEGKÖZELEBBI KÁRTYÁBA SOROLVA ===
 *
 * A Figma `UjEszköz` négy kártyát rajzol (Azonosítás, Eszköz adatai,
 * Hozzárendelés, Karbantartás), összesen 16 mezővel. A mai valódi
 * felvitel ennél TÖBB mezőt kér (Típus, Státusz, Kritikusság, Vevő címe,
 * Térfogat, Fogyasztás -- két alakban --, FP/Elektromos kód, Leírás,
 * Belső megjegyzés, Következő karbantartás). Egyik sem hagyható el (rule
 * 1: "ami mögött van adat/funkció, azt nem lehet kihagyni"), és a Figma
 * egyiket sem rajzolja -- ezért mind bekerül a TARTALMILAG legközelebbi
 * kártyába:
 *
 *   Eszköz adatai   +Kritikusság, Térfogat, Fogyasztás (mindkét mező),
 *                    FP/Elektromos kód, Leírás
 *   Hozzárendelés   +Vevő címe, Típus, Státusz
 *   Karbantartás    +Következő karbantartás, Belső megjegyzés
 *
 * === KÉT MEZŐ, AHOL A FIGMA SZABAD SZÖVEGET RAJZOL, A VALÓSÁG
 *     TÖRZSADATOT ===
 *
 * A Figma "Funkció" sima input, "Teljesítmény mértékegysége" pedig egy
 * rögzített `['W','kW','VA','l/h','l']` lista. A mai valóság mindkettőt
 * törzsadatból tölti (`assetFunctionsApi`, illetve
 * `unitsOfMeasureApi.list(..., 'PERFORMANCE')`) -- ez NEM a terv hibája,
 * hanem pont az a fajta eltérés, amit a brief 3. pontja mond: ha a terv
 * másképp mutat, mint a mai működés, az kérdés, nem döntés. A valódi
 * törzsadatot választottam (rule 1: valódi adat, mai működés), és itt
 * jelzem, nem csendben.
 *
 * === EGY MEZŐ, AMIT A FIGMA KÉTSZER NEVEZ, DE CSAK EGY VAN ===
 *
 * A Figma "Matrica kódja" ÉS "Partner belső kódja" két külön mezőt kér --
 * ez helyes, mindkettő valódi és külön (`labelCode`, illetve
 * `partnerInternalCode`). Ahol a Figma-leírás KORÁBBI, javítatlan
 * változata ("Leltári szám" címkével) egyszer már összemosta ezt a kettőt
 * (lásd a figma-kor skill buktatóját), ez a Make-export már a javított
 * leírásból készült, tehát itt a két mező helyesen külön áll -- nincs
 * mit javítani.
 */

const toIsoDate = (value: string) =>
  value ? `${value}T00:00:00.000Z` : undefined;

const ownerKey = (type: AssetOwnerType, id: string) => `${type}:${id}`;

export function PilotAssetCreatePage() {
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
  const [aquariumId, setAquariumId] = useState("");
  const [aquariums, setAquariums] = useState<AquariumSummary[]>([]);
  const [kind, setKind] = useState<AssetKind>("EQUIPMENT");
  const [status, setStatus] = useState<AssetStatus>("ACTIVE");
  const [criticality, setCriticality] = useState<AssetCriticality>("NORMAL");
  const [name, setName] = useState("");
  const [nameDuplicates, setNameDuplicates] = useState<AssetListItem[] | null>(
    null,
  );
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [functionId, setFunctionId] = useState("");
  const [functions, setFunctions] = useState<AssetFunction[]>([]);
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [partnerInternalCode, setPartnerInternalCode] = useState("");
  const [labelCode, setLabelCode] = useState("");
  const [performance, setPerformance] = useState("");
  const [performanceUnitId, setPerformanceUnitId] = useState("");
  const [performanceUnits, setPerformanceUnits] = useState<UnitOfMeasure[]>([]);
  const [performanceUnitsFailed, setPerformanceUnitsFailed] = useState(false);
  const [volume, setVolume] = useState("");
  const [powerConsumption, setPowerConsumption] = useState("");
  const [powerConsumptionRaw, setPowerConsumptionRaw] = useState("");
  const [electricalCode, setElectricalCode] = useState("");
  const [installedAt, setInstalledAt] = useState("");
  const [warrantyExpiresAt, setWarrantyExpiresAt] = useState("");
  const [serviceIntervalDays, setServiceIntervalDays] = useState("");
  const [nextServiceAt, setNextServiceAt] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const owner = owners.find(
    (item) => ownerKey(item.type, item.id) === selectedOwner,
  );
  const addresses = owner?.addresses ?? [];

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    void assetsApi
      .owners(token, controller.signal, null)
      .then((result) => setOwners(result.items))
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
  }, [canManage, token]);

  useEffect(() => {
    const controller = new AbortController();
    void assetCategoriesApi
      .list(token, false, controller.signal)
      .then((result) => setCategories(result.items))
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A kategóriák nem tölthetők be.",
          );
      });
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    const controller = new AbortController();
    void assetFunctionsApi
      .list(token, false, controller.signal)
      .then((result) => setFunctions(result.items))
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A funkciók nem tölthetők be.",
          );
      });
    return () => controller.abort();
  }, [token]);

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

  useEffect(() => {
    const controller = new AbortController();
    void unitsOfMeasureApi
      .list(token, "PERFORMANCE", { signal: controller.signal })
      .then((result) => setPerformanceUnits(result.items))
      .catch((cause) => {
        setPerformanceUnits([]);
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setPerformanceUnitsFailed(true);
      });
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
      .then((result) => setParentAssets(result.items))
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A partner eszközadatai nem tölthetők be.",
          );
      });
    return () => controller.abort();
  }, [owner, token]);

  /**
   * AZ AKVÁRIUM CSAK VEVŐ TULAJDONOSNÁL ÉRTELMEZETT (a szerver
   * `validateReferences`-e szerviz partnernél elutasítja) -- a lista ezért
   * csak akkor tölt, és csak AHHOZ a vevőhöz szűkítve, hogy a választó ne
   * ajánlhasson fel olyat, amit a mentés úgyis visszadobna.
   */
  useEffect(() => {
    setAquariums([]);
    if (!owner || owner.type !== "CUSTOMER") return;
    const controller = new AbortController();
    const aquariumQuery = new URLSearchParams({
      page: "1",
      pageSize: "100",
      customerId: owner.id,
    });
    void aquariumsApi
      .list(token, aquariumQuery, controller.signal)
      .then((result) => setAquariums(result.items))
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A vevő akváriumai nem tölthetők be.",
          );
      });
    return () => controller.abort();
  }, [owner, token]);

  useEffect(() => {
    const interval = Number.parseInt(serviceIntervalDays, 10);
    if (!Number.isInteger(interval) || interval < 1) return;
    const base = installedAt
      ? new Date(`${installedAt}T00:00:00.000Z`)
      : new Date();
    base.setUTCDate(base.getUTCDate() + interval);
    setNextServiceAt(base.toISOString().slice(0, 10));
  }, [installedAt, serviceIntervalDays]);

  /**
   * A NÉV-ÜTKÖZÉS FIGYELMEZTETÉSE A NÉV VÁLTOZÁSÁVAL ELÉVÜL -- lásd a
   * megjegyzést a `asset-editor-page.tsx`-ben, szó szerint ugyanaz az ok.
   */
  const [checkedName, setCheckedName] = useState(name);
  if (checkedName !== name) {
    setCheckedName(name);
    setNameDuplicates(null);
  }

  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs jogosultságod eszköz rögzítéséhez"
        description="service.manage jogosultság szükséges."
      />
    );

  const missing: string[] = [];
  if (!name.trim()) missing.push("Eszköz neve");
  if (!owner) missing.push("Partner");
  if (owner?.type === "SUPPLIER" && !departmentId) missing.push("Alegység");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!owner || !name.trim()) {
      setError("A partner és az eszköz neve kötelező.");
      return;
    }
    if (owner.type === "SUPPLIER" && !departmentId) {
      setError("Szerviz partner eszközéhez alegység megadása kötelező.");
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
    const labelProblem = assetLabelCreateProblem(labelCode);
    if (labelProblem === "missing") {
      setError("Írd be a matrica kódját.");
      return;
    }
    if (labelProblem === "malformed") {
      setError("A matrica kódja egy betű és négy szám, például V2196.");
      return;
    }
    const performanceProblem = performancePairProblem(
      performance,
      performanceUnitId,
      normalizePerformanceValue(performance) === null,
    );
    if (performanceProblem) {
      setError(PERFORMANCE_PROBLEM_MESSAGES[performanceProblem]);
      return;
    }
    if (nameDuplicates === null) {
      try {
        const matches = await assetsApi.nameCheck(token, name.trim());
        if (matches.length > 0) {
          setNameDuplicates(matches);
          return;
        }
      } catch {
        // lásd a fenti jegyzetet: a mentés enélkül is folytatódik
      }
    }
    await performSave();
  };

  const performSave = async () => {
    if (!owner) return;
    const interval = serviceIntervalDays
      ? Number.parseInt(serviceIntervalDays, 10)
      : undefined;
    setBusy(true);
    setError(null);
    try {
      const saved = await assetsApi.create(token, {
        ownerType: owner.type,
        ownerId: owner.id,
        customerAddressId: customerAddressId || undefined,
        departmentId: departmentId || undefined,
        parentAssetId: parentAssetId || undefined,
        aquariumId: aquariumId || undefined,
        kind,
        status,
        criticality,
        name: name.trim(),
        categoryId: categoryId || undefined,
        functionId: functionId || undefined,
        manufacturer: manufacturer.trim() || undefined,
        model: model.trim() || undefined,
        serialNumber: serialNumber.trim() || undefined,
        partnerInternalCode: partnerInternalCode.trim() || undefined,
        electricalCode: electricalCode.trim() || undefined,
        labelCode: normalizeAssetLabelCode(labelCode) ?? undefined,
        performance: normalizePerformanceValue(performance) ?? undefined,
        performanceUnitId: performanceUnitId || undefined,
        volume: normalizePerformanceValue(volume) ?? undefined,
        powerConsumption:
          normalizePerformanceValue(powerConsumption) ?? undefined,
        powerConsumptionRaw: powerConsumptionRaw.trim() || undefined,
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

  const confirmDespiteDuplicateName = () => {
    setNameDuplicates(null);
    void performSave();
  };

  return (
    <PilotThemeRoot className="-m-6 min-h-screen bg-pilot-grey-50">
      <div className="border-b border-pilot-grey-200 bg-white px-8 py-5">
        <Link
          href={backToList.href}
          className="mb-3 flex items-center gap-1.5 text-xs text-pilot-grey-400 transition-colors hover:text-pilot-grey-700"
        >
          <Icon name="chevron-left" size={12} />
          {backToList.fromWithinApp ? "Vissza" : "Eszköznyilvántartás"}
        </Link>
        <h1 className="text-xl font-semibold text-pilot-grey-900">Új eszköz</h1>
        <p className="mt-0.5 text-sm text-pilot-grey-500">
          Önálló berendezés vagy egy meglévő rendszer részegységének rögzítése.
        </p>
      </div>

      <div className="flex max-w-3xl flex-col gap-5 px-8 py-6">
        <ServiceOfflineNotice state={{ kind: "form" }} pilot />
        {error ? (
          <Alert
            variant="danger"
            title="A művelet nem sikerült"
            description={error}
          />
        ) : null}

        <form className="flex flex-col gap-5" onSubmit={submit}>
          <PilotCard>
            <PilotCardHeader title="Azonosítás" />
            <div className="grid grid-cols-1 gap-x-6 gap-y-5 p-5 md:grid-cols-2">
              <PilotFormField label="Eszköz neve" required>
                <PilotInput
                  value={name}
                  onChange={setName}
                  placeholder="pl. Fóka felnyomó szivattyú"
                  aria-label="Eszköz neve"
                />
              </PilotFormField>
              <PilotFormField
                label="Matrica kódja"
                help="Az előre nyomtatott matricáról, egy betű és négy szám (például V2196). Elhagyható, és utólag ezen a lapon is pótolható."
              >
                <PilotInput
                  value={labelCode}
                  onChange={setLabelCode}
                  placeholder="V2196"
                  aria-label="Matrica kódja"
                />
              </PilotFormField>
              <PilotFormField label="Partner belső kódja">
                <PilotInput
                  value={partnerInternalCode}
                  onChange={setPartnerInternalCode}
                  aria-label="Partner belső kódja"
                />
              </PilotFormField>
              <PilotFormField label="Sorozatszám">
                <PilotInput
                  value={serialNumber}
                  onChange={setSerialNumber}
                  aria-label="Sorozatszám"
                />
              </PilotFormField>
            </div>
          </PilotCard>

          <PilotCard>
            <PilotCardHeader title="Eszköz adatai" />
            <div className="grid grid-cols-1 gap-x-6 gap-y-5 p-5 md:grid-cols-2">
              <PilotFormField label="Kategória">
                <PilotSelect
                  value={categoryId}
                  onChange={setCategoryId}
                  aria-label="Kategória"
                >
                  <option value="">Nincs megadva</option>
                  {categories.map((kategoria) => (
                    <option key={kategoria.id} value={kategoria.id}>
                      {kategoria.name}
                    </option>
                  ))}
                </PilotSelect>
              </PilotFormField>
              <PilotFormField label="Funkció">
                <PilotSelect
                  value={functionId}
                  onChange={setFunctionId}
                  aria-label="Funkció"
                >
                  <option value="">Nincs megadva</option>
                  {functions.map((funkcio) => (
                    <option key={funkcio.id} value={funkcio.id}>
                      {funkcio.name}
                    </option>
                  ))}
                </PilotSelect>
              </PilotFormField>
              <PilotFormField label="Gyártó">
                <PilotInput
                  value={manufacturer}
                  onChange={setManufacturer}
                  aria-label="Gyártó"
                />
              </PilotFormField>
              <PilotFormField label="Modell">
                <PilotInput
                  value={model}
                  onChange={setModel}
                  aria-label="Modell"
                />
              </PilotFormField>
              <PilotFormField
                label="Teljesítmény"
                help="Tizedesvesszővel is írható (például 0,5)."
              >
                <div className="flex gap-2">
                  <PilotInput
                    value={performance}
                    onChange={setPerformance}
                    inputMode="decimal"
                    placeholder="pl. 500"
                    aria-label="Teljesítmény"
                  />
                  <div className="w-28">
                    <PilotSelect
                      value={performanceUnitId}
                      onChange={setPerformanceUnitId}
                      aria-label="Mértékegység"
                    >
                      <option value="">Nincs megadva</option>
                      {performanceUnitOptions(performanceUnits, undefined).map(
                        (unit) => (
                          <option key={unit.id} value={unit.id}>
                            {unit.code}
                          </option>
                        ),
                      )}
                    </PilotSelect>
                  </div>
                </div>
                {performanceUnitsFailed ? (
                  <p className="text-xs text-pilot-grey-400">
                    A mértékegységek most nem tölthetők be. Ez NEM azt jelenti,
                    hogy nincs mértékegység: a mező üresen hagyható, a többi
                    adat menthető.
                  </p>
                ) : null}
              </PilotFormField>
              <PilotFormField label="FP / Elektromos">
                <PilotInput
                  value={electricalCode}
                  onChange={setElectricalCode}
                  aria-label="FP / Elektromos"
                />
              </PilotFormField>
              <PilotFormField
                label="Térfogat"
                help="m³-ben. Tizedesvesszővel is írható (például 0,5)."
              >
                <PilotInput
                  value={volume}
                  onChange={setVolume}
                  inputMode="decimal"
                  placeholder="pl. 1.5"
                  aria-label="Térfogat"
                />
              </PilotFormField>
              <PilotFormField
                label="Fogyasztás"
                help="kW-ban. Tizedesvesszővel is írható (például 0,5)."
              >
                <PilotInput
                  value={powerConsumption}
                  onChange={setPowerConsumption}
                  inputMode="decimal"
                  placeholder="pl. 0,75"
                  aria-label="Fogyasztás"
                />
              </PilotFormField>
              <PilotFormField
                label="Fogyasztás (eredeti bejegyzés)"
                help="Ha a tábla cellája P1/P2 alakú volt (például 6,15/5,5), ide írd be változatlanul."
              >
                <PilotInput
                  value={powerConsumptionRaw}
                  onChange={setPowerConsumptionRaw}
                  placeholder="pl. 6,15/5,5"
                  aria-label="Fogyasztás (eredeti bejegyzés)"
                />
              </PilotFormField>
              <PilotFormField label="Kritikusság">
                <PilotSelect
                  value={criticality}
                  onChange={(value) =>
                    setCriticality(value as AssetCriticality)
                  }
                  aria-label="Kritikusság"
                >
                  {Object.entries(assetCriticalityLabel).map(
                    ([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ),
                  )}
                </PilotSelect>
              </PilotFormField>
            </div>
            <div className="px-5 pb-5">
              <PilotFormField label="Leírás">
                <textarea
                  rows={4}
                  aria-label="Leírás"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="w-full resize-none rounded-md px-3 py-2 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                />
              </PilotFormField>
            </div>
          </PilotCard>

          <PilotCard>
            <PilotCardHeader title="Hozzárendelés" />
            <div className="grid grid-cols-1 gap-x-6 gap-y-5 p-5 md:grid-cols-2">
              <PilotFormField label="Partner" required>
                <PilotSelect
                  value={selectedOwner}
                  disabled={loadingOptions}
                  onChange={(value) => {
                    setSelectedOwner(value);
                    setCustomerAddressId("");
                    setParentAssetId("");
                    setAquariumId("");
                  }}
                  aria-label="Partner"
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
                </PilotSelect>
              </PilotFormField>
              <PilotFormField label="Vevő címe">
                <PilotSelect
                  value={customerAddressId}
                  disabled={!owner || owner.type !== "CUSTOMER"}
                  onChange={setCustomerAddressId}
                  aria-label="Vevő címe"
                >
                  <option value="">Nincs pontosítva</option>
                  {addresses.map((address) => (
                    <option key={address.id} value={address.id}>
                      {address.name ? `${address.name} – ` : ""}
                      {address.formatted}
                    </option>
                  ))}
                </PilotSelect>
              </PilotFormField>
              {/*
                CSAK VEVŐ TULAJDONOSNÁL LÁTSZIK, NEM CSAK LETILTVA -- a
                szerver szerviz partnernél egyáltalán nem fogadja el az
                akváriumot (`validateReferences`), tehát egy letiltott, de
                látható mező itt félrevezetne.
              */}
              {owner?.type === "CUSTOMER" ? (
                <PilotFormField label="Akvárium (opcionális)">
                  <PilotSelect
                    value={aquariumId}
                    onChange={setAquariumId}
                    aria-label="Akvárium"
                  >
                    <option value="">Nincs akváriumhoz kötve</option>
                    {aquariums.map((aquarium) => (
                      <option key={aquarium.id} value={aquarium.id}>
                        {aquarium.name} ({aquarium.aquariumNumber})
                      </option>
                    ))}
                  </PilotSelect>
                </PilotFormField>
              ) : null}
              <PilotFormField
                label={
                  owner?.type === "SUPPLIER"
                    ? "Alegység (kötelező)"
                    : "Alegység"
                }
                required={owner?.type === "SUPPLIER"}
                help="A partner alegysége, ahol az eszköz áll. Ugyanaz a lista, amit a partner adatlapján Alegységek néven szerkesztesz."
              >
                <PilotSelect
                  value={departmentId}
                  disabled={!owner || owner.type !== "SUPPLIER"}
                  onChange={setDepartmentId}
                  aria-label="Alegység"
                >
                  <option value="">Nincs pontosítva</option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.label}
                      {unit.isActive ? "" : " · archivált"}
                    </option>
                  ))}
                </PilotSelect>
              </PilotFormField>
              <PilotFormField label="Típus">
                <PilotSelect
                  value={kind}
                  onChange={(value) => setKind(value as AssetKind)}
                  aria-label="Eszköztípus"
                >
                  {Object.entries(assetKindLabel).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </PilotSelect>
              </PilotFormField>
              <PilotFormField label="Státusz">
                <PilotSelect
                  value={status}
                  onChange={(value) => setStatus(value as AssetStatus)}
                  aria-label="Eszköz státusza"
                >
                  {Object.entries(assetStatusLabel).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </PilotSelect>
              </PilotFormField>
              <PilotFormField
                label="Szülőeszköz (opcionális)"
                className="md:col-span-2"
              >
                <PilotSelect
                  value={parentAssetId}
                  disabled={!owner}
                  onChange={setParentAssetId}
                  aria-label="Szülőeszköz"
                >
                  <option value="">Önálló / főegység</option>
                  {parentAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name} ({asset.assetNumber})
                    </option>
                  ))}
                </PilotSelect>
              </PilotFormField>
            </div>
          </PilotCard>

          <PilotCard>
            <PilotCardHeader title="Karbantartás" />
            <div className="grid grid-cols-1 gap-x-6 gap-y-5 p-5 md:grid-cols-2 xl:grid-cols-4">
              <PilotFormField label="Telepítés dátuma">
                <PilotInput
                  type="date"
                  value={installedAt}
                  onChange={setInstalledAt}
                  aria-label="Telepítés dátuma"
                />
              </PilotFormField>
              <PilotFormField label="Garancia lejárata">
                <PilotInput
                  type="date"
                  value={warrantyExpiresAt}
                  onChange={setWarrantyExpiresAt}
                  aria-label="Garancia lejárata"
                />
              </PilotFormField>
              <PilotFormField label="Intervallum (nap)">
                <PilotInput
                  type="number"
                  min={1}
                  max={3650}
                  value={serviceIntervalDays}
                  onChange={setServiceIntervalDays}
                  placeholder="pl. 30"
                  aria-label="Karbantartási intervallum"
                />
              </PilotFormField>
              <PilotFormField label="Következő karbantartás">
                <PilotInput
                  type="date"
                  value={nextServiceAt}
                  onChange={setNextServiceAt}
                  aria-label="Következő karbantartás"
                />
              </PilotFormField>
            </div>
            <div className="px-5 pb-5">
              <PilotFormField label="Belső megjegyzés">
                <textarea
                  rows={3}
                  aria-label="Belső megjegyzés"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  className="w-full resize-none rounded-md px-3 py-2 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                />
              </PilotFormField>
            </div>
          </PilotCard>

          {nameDuplicates && nameDuplicates.length > 0 ? (
            <Alert
              variant="info"
              title="Már létezik ilyen nevű eszköz"
              action={
                <div className="flex shrink-0 gap-2">
                  <PilotButton
                    variant="secondary"
                    onClick={() => setNameDuplicates(null)}
                    disabled={busy}
                  >
                    Mégsem
                  </PilotButton>
                  <PilotButton
                    variant="primary"
                    onClick={confirmDespiteDuplicateName}
                    disabled={busy}
                  >
                    Mentés mégis
                  </PilotButton>
                </div>
              }
            >
              <ul className="list-disc space-y-0.5 pl-4">
                {nameDuplicates.map((item) => (
                  <li key={item.id}>
                    {item.owner.displayName}
                    {item.unit ? ` — ${item.unit.path.join(" / ")}` : ""}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}

          <div className="flex items-center gap-4 pb-8">
            <Link href={backToList.href}>
              <PilotButton variant="secondary" disabled={busy}>
                Mégse
              </PilotButton>
            </Link>
            <PilotButton
              type="submit"
              variant="primary"
              disabled={busy || loadingOptions || missing.length > 0}
            >
              {busy ? "Mentés…" : "Eszköz létrehozása"}
            </PilotButton>
            {missing.length > 0 ? (
              <p className="text-xs text-pilot-grey-400">
                Kötelező: {missing.join(", ")}
              </p>
            ) : null}
          </div>
        </form>
      </div>
    </PilotThemeRoot>
  );
}
