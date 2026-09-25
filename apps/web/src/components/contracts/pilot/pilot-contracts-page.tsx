"use client";

import { Alert } from "@acropora/ui";
import { hasPermission, PERMISSIONS } from "@acropora/types";
import type { WorksheetDepartmentSummary } from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { JobAssetPicker } from "@/components/service-jobs/job-asset-picker";
import { buildSiteOptions } from "@/lib/partners/site-tree";
import { ApiError } from "@/lib/api/client";
import { contractsApi, type ContractSummary } from "@/lib/api/contracts";
import { worksheetsApi } from "@/lib/api/worksheets";
import {
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotFormField,
  PilotInput,
  PilotSelect,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";

export type DraftItem = {
  description: string;
  unitNet: string;
  quantity: string;
  occasionsPerYear: string;
  vatRatePercent: string;
  /**
   * A HELYSZÍN ÉS AZ ESZKÖZ MOSTANTÓL A FELVITELEN IS SZERKESZTHETŐ --
   * acrobot kérése (2026-09-24 20:36, élesben blokkoló): a szerver mindig
   * is elfogadta ezt a két mezőt (`ContractItemDto`), de a webes felvitelen
   * sehol nem volt hozzá mező.
   */
  departmentId: string;
  assetIds: string[];
};
export const emptyItem = (): DraftItem => ({
  description: "",
  unitNet: "",
  quantity: "1",
  occasionsPerYear: "1",
  vatRatePercent: "27",
  departmentId: "",
  assetIds: [],
});

function money(value: string) {
  return new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 2 }).format(
    Number(value),
  );
}

/**
 * UGYANAZ A MINTA, MINT AZ API `ContractItemDto`-JÁBAN
 * (`apps/api/src/contracts/dto.ts`) -- ha ott változik, itt is kell.
 */
const DECIMAL = /^\d+(?:\.\d+)?$/;

/**
 * A "validFrom must be a valid ISO 8601 date string" ANGOL API-HIBA OKA:
 * a mező láthatatlan felirat mögött (csak `aria-label`) üresen maradt, a
 * `Mentés` gomb pedig semmit nem akadályozott. A javítás nem az API-hibát
 * fordítja le, hanem MEGELŐZI: a gomb addig tiltva, amíg ezek a mezők
 * hiányoznak, és a hiányzó mezők neve magyarul, a gomb mellett látszik.
 *
 * A KÖTELEZŐ MEZŐK LISTÁJA A SZERVER `CreateContractDto`-JÁBÓL JÖN
 * (customerId, number, title, validFrom, legalább egy érvényes tétel) --
 * lásd ott a fejlécet arról, mi opcionális (validTo, notes).
 */
export function missingFields(draft: {
  customerId: string;
  number: string;
  title: string;
  validFrom: string;
  items: DraftItem[];
}): string[] {
  const missing: string[] = [];
  if (!draft.customerId) missing.push("Partner");
  if (!draft.number.trim()) missing.push("Szerződésszám");
  if (!draft.title.trim()) missing.push("Szerződés címe");
  if (!draft.validFrom) missing.push("Érvényesség kezdete");
  const hasValidItem = draft.items.some(
    (item) =>
      item.description.trim() !== "" &&
      DECIMAL.test(item.unitNet) &&
      DECIMAL.test(item.quantity) &&
      DECIMAL.test(item.vatRatePercent) &&
      Number.isInteger(Number(item.occasionsPerYear)) &&
      Number(item.occasionsPerYear) >= 1 &&
      Number(item.occasionsPerYear) <= 366,
  );
  if (!hasValidItem) missing.push("legalább egy kitöltött tétel");
  return missing;
}

/**
 * A FIGMA MAKE TERV ÁTÜLTETÉSE -- SZERZŐDÉSEK LISTA.
 *
 * Forrás: `exchange/figma-partnerek-make-13/src/PartnersScreen.tsx`
 * `ContractsListPage` (1212-1510. sor). A régi (nem pilot) `ContractsPage`
 * szerkezete (fejléc + fejezhető "Új szerződés" űrlap + lista) már eddig
 * is a terv szerint állt -- ez a port a `@acropora/ui`
 * `Card`/`Button`/`Input`/`Select`/`FormField`-et cseréli pilot
 * komponensekre, VÁLTOZATLAN adattal, hívással és validációval.
 *
 * A terv "Demo" gombjai (Betöltés/Hiba kapcsolók) NEM kerültek át: a
 * valódi betöltés/hiba állapot már megvan.
 *
 * Irodai szerződéslap. A műszaki munkalap-szerkesztőt szándékosan nem használja:
 * az itt megjelenő egységár nem kerülhet technikusi képernyőre.
 */
export function PilotContractsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PARTNERS_MANAGE),
  );
  const [contracts, setContracts] = useState<ContractSummary[]>([]);
  const [customers, setCustomers] = useState<
    Array<{ id: string; displayName: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [numberError, setNumberError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    customerId: "",
    number: "",
    title: "",
    validFrom: "",
    validTo: "",
    notes: "",
    items: [emptyItem()],
  });
  const [departments, setDepartments] = useState<WorksheetDepartmentSummary[]>(
    [],
  );
  const [departmentsLoaded, setDepartmentsLoaded] = useState(false);

  const load = async () => {
    if (!canManage) return;
    setLoading(true);
    setError(null);
    try {
      const [items, customerRows] = await Promise.all([
        contractsApi.list(token),
        contractsApi.customers(token),
      ]);
      setContracts(items);
      setCustomers(customerRows);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A szerződések nem tölthetők be.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [canManage, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadDepartments = useCallback(
    async (customerId: string, signal?: AbortSignal) => {
      if (!customerId) {
        setDepartments([]);
        setDepartmentsLoaded(false);
        return;
      }
      try {
        const response = await worksheetsApi.departments(
          token,
          customerId,
          signal,
        );
        setDepartments(response.items.filter((item) => item.isActive));
        setDepartmentsLoaded(true);
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError("A partner helyszínei nem tölthetők be.");
      }
    },
    [token],
  );
  useEffect(() => {
    const controller = new AbortController();
    void loadDepartments(draft.customerId, controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.customerId, loadDepartments]);
  const departmentOptions = useMemo(
    () => buildSiteOptions(departments),
    [departments],
  );

  const yearly = useMemo(
    () =>
      draft.items.reduce(
        (total, item) =>
          total +
          Number(item.unitNet || 0) *
            Number(item.quantity || 0) *
            Number(item.occasionsPerYear || 0),
        0,
      ),
    [draft.items],
  );
  const missing = useMemo(() => missingFields(draft), [draft]);
  if (!canManage)
    return (
      <PilotThemeRoot>
        <Alert
          variant="danger"
          title="Nincs hozzáférésed a szerződésekhez"
          description="partners.manage jogosultság szükséges."
        />
      </PilotThemeRoot>
    );

  const create = async () => {
    setSaving(true);
    setError(null);
    setNumberError(null);
    try {
      await contractsApi.create(token, {
        customerId: draft.customerId,
        number: draft.number,
        title: draft.title,
        validFrom: draft.validFrom,
        validTo: draft.validTo || null,
        notes: draft.notes || null,
        items: draft.items.map((item) => ({
          ...item,
          occasionsPerYear: Number(item.occasionsPerYear),
        })),
      });
      setDraft({
        customerId: "",
        number: "",
        title: "",
        validFrom: "",
        validTo: "",
        notes: "",
        items: [emptyItem()],
      });
      setCreating(false);
      await load();
    } catch (cause) {
      /*
        A DUPLIKÁLT SZERZŐDÉSSZÁM A MEZŐ ALATT JELENIK MEG, NEM EGY ÁLTALÁNOS
        DOBOZBAN -- Balázs éles hibája (2026-09-24 20:31): egy már létező
        számmal próbált menteni, és a felületen csak "A kérés feldolgozása
        nem sikerült" jelent meg, a mező mellett semmi. A `create()`-nek MA
        egyetlen `ConflictException` (409) forrása van (a szerződésszám
        egyedi megkötése), tehát a `409` egyértelműen ide tartozik.
      */
      if (cause instanceof ApiError && cause.status === 409) {
        setNumberError(cause.message);
        return;
      }
      setError(
        cause instanceof Error ? cause.message : "A szerződés nem menthető.",
      );
    } finally {
      setSaving(false);
    }
  };

  const upload = async (id: string, file: File | undefined) => {
    if (!file) return;
    setUploading(id);
    setError(null);
    try {
      await contractsApi.uploadPdf(token, id, file);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A PDF nem tölthető fel.",
      );
    } finally {
      setUploading(null);
    }
  };

  const download = async (
    contractId: string,
    documentId: string,
    fileName: string,
  ) => {
    try {
      const blob = await contractsApi.downloadPdf(
        token,
        contractId,
        documentId,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A PDF nem tölthető le.",
      );
    }
  };

  return (
    <PilotThemeRoot>
      <div className="flex min-h-full flex-col">
        <div className="flex items-center justify-between border-b border-pilot-grey-200 bg-white px-8 py-5">
          <div>
            <p className="mb-0.5 text-xs text-pilot-grey-400">Partnerek</p>
            <h1 className="text-xl font-semibold text-pilot-grey-900">
              Szerződések
            </h1>
            <p className="mt-0.5 text-sm text-pilot-grey-400">
              Az éves díj a tétel egységárából, darabszámából és alkalomszámából
              számolódik.
            </p>
          </div>
          <PilotButton
            type="button"
            variant={creating ? "secondary" : "primary"}
            onClick={() => setCreating((value) => !value)}
          >
            {creating ? "Űrlap bezárása" : "Új szerződés"}
          </PilotButton>
        </div>

        <div className="flex flex-1 flex-col gap-4 px-8 py-6">
          {error ? (
            <Alert variant="danger" title="Műveleti hiba" description={error} />
          ) : null}
          {creating ? (
            <PilotCard>
              {/*
                A CÍM "ÚJ SZERZŐDÉS RÖGZÍTÉSE", A TERV SZERINT (2026-09-25,
                barracuda előre-összevetése): a régi (nem pilot) kód "Új
                keretszerződés" címet viselt, ezt a portolás tévedésből
                változatlanul hozta át -- nincs mögötte döntés, a terv
                szava a mérvadó.
              */}
              <PilotCardHeader title="Új szerződés rögzítése" />
              <div className="flex flex-col gap-4 p-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <PilotFormField label="Partner" required>
                    <PilotSelect
                      aria-label="Partner"
                      value={draft.customerId}
                      onChange={(value) =>
                        setDraft({ ...draft, customerId: value })
                      }
                    >
                      <option value="">Partner kiválasztása</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.displayName}
                        </option>
                      ))}
                    </PilotSelect>
                  </PilotFormField>
                  <PilotFormField
                    label="Szerződésszám"
                    required
                    help={numberError ?? undefined}
                  >
                    <PilotInput
                      aria-label="Szerződésszám *"
                      placeholder="pl. SZ2026/0000019"
                      value={draft.number}
                      onChange={(value) => {
                        setDraft({ ...draft, number: value });
                        setNumberError(null);
                      }}
                    />
                  </PilotFormField>
                  <PilotFormField label="Szerződés címe" required>
                    <PilotInput
                      aria-label="Szerződés címe *"
                      value={draft.title}
                      onChange={(value) => setDraft({ ...draft, title: value })}
                    />
                  </PilotFormField>
                  <PilotFormField label="Érvényesség kezdete" required>
                    <PilotInput
                      aria-label="Érvényesség kezdete *"
                      type="date"
                      value={draft.validFrom}
                      onChange={(value) =>
                        setDraft({ ...draft, validFrom: value })
                      }
                    />
                  </PilotFormField>
                  <PilotFormField
                    label="Érvényesség vége"
                    help="Opcionális -- üresen hagyva határozatlan idejű."
                  >
                    <PilotInput
                      aria-label="Érvényesség vége"
                      type="date"
                      value={draft.validTo}
                      onChange={(value) =>
                        setDraft({ ...draft, validTo: value })
                      }
                    />
                  </PilotFormField>
                </div>
                <div className="flex flex-col gap-3">
                  <p className="text-xs font-medium text-pilot-grey-700">
                    Szerződéses tételek
                  </p>
                  {draft.items.map((item, index) => (
                    <div
                      className="flex flex-col gap-2 rounded-lg bg-pilot-grey-50 p-3 ring-1 ring-pilot-grey-100"
                      key={index}
                    >
                      <div className="grid gap-2 md:grid-cols-5">
                        <PilotFormField
                          label={index === 0 ? "Tétel leírása" : ""}
                        >
                          <PilotInput
                            aria-label="Tétel leírása"
                            placeholder="Tétel leírása"
                            value={item.description}
                            onChange={(value) =>
                              setDraft({
                                ...draft,
                                items: draft.items.map((row, rowIndex) =>
                                  rowIndex === index
                                    ? { ...row, description: value }
                                    : row,
                                ),
                              })
                            }
                          />
                        </PilotFormField>
                        <PilotFormField
                          label={index === 0 ? "Nettó egységár" : ""}
                        >
                          <PilotInput
                            aria-label="Nettó egységár"
                            inputMode="decimal"
                            placeholder="Nettó egységár"
                            value={item.unitNet}
                            onChange={(value) =>
                              setDraft({
                                ...draft,
                                items: draft.items.map((row, rowIndex) =>
                                  rowIndex === index
                                    ? { ...row, unitNet: value }
                                    : row,
                                ),
                              })
                            }
                          />
                        </PilotFormField>
                        <PilotFormField label={index === 0 ? "Darabszám" : ""}>
                          <PilotInput
                            aria-label="Darabszám"
                            inputMode="decimal"
                            placeholder="db"
                            value={item.quantity}
                            onChange={(value) =>
                              setDraft({
                                ...draft,
                                items: draft.items.map((row, rowIndex) =>
                                  rowIndex === index
                                    ? { ...row, quantity: value }
                                    : row,
                                ),
                              })
                            }
                          />
                        </PilotFormField>
                        <PilotFormField
                          label={index === 0 ? "Alkalom / év" : ""}
                        >
                          <PilotInput
                            aria-label="Alkalom / év"
                            inputMode="numeric"
                            placeholder="alkalom / év"
                            value={item.occasionsPerYear}
                            onChange={(value) =>
                              setDraft({
                                ...draft,
                                items: draft.items.map((row, rowIndex) =>
                                  rowIndex === index
                                    ? { ...row, occasionsPerYear: value }
                                    : row,
                                ),
                              })
                            }
                          />
                        </PilotFormField>
                        <PilotFormField label={index === 0 ? "ÁFA %" : ""}>
                          <PilotInput
                            aria-label="ÁFA %"
                            inputMode="decimal"
                            placeholder="ÁFA %"
                            value={item.vatRatePercent}
                            onChange={(value) =>
                              setDraft({
                                ...draft,
                                items: draft.items.map((row, rowIndex) =>
                                  rowIndex === index
                                    ? { ...row, vatRatePercent: value }
                                    : row,
                                ),
                              })
                            }
                          />
                        </PilotFormField>
                      </div>
                      {/*
                        A HELYSZÍN ÉS AZ ESZKÖZ ITT VÁLASZTHATÓ -- acrobot kérése
                        (2026-09-24 20:36, élesben blokkoló): a szerver mindig is
                        elfogadta ezt a két mezőt, a felvitelen sehol nem volt hozzá
                        mező. Csak akkor jelenik meg, ha van kiválasztott partner:
                        helyszín nélküle nincs.
                      */}
                      {draft.customerId ? (
                        !departmentsLoaded ? (
                          <p className="text-sm text-pilot-grey-400">
                            Helyszínek betöltése…
                          </p>
                        ) : departmentOptions.length === 0 ? (
                          <p className="text-sm text-pilot-grey-400">
                            Ehhez a partnerhez nincs felvéve helyszín.
                          </p>
                        ) : (
                          <div className="grid gap-2 md:grid-cols-2">
                            <PilotFormField
                              label={index === 0 ? "Helyszín" : ""}
                            >
                              <PilotSelect
                                aria-label="Helyszín"
                                value={item.departmentId}
                                onChange={(value) =>
                                  setDraft({
                                    ...draft,
                                    items: draft.items.map((row, rowIndex) =>
                                      rowIndex === index
                                        ? { ...row, departmentId: value }
                                        : row,
                                    ),
                                  })
                                }
                              >
                                <option value="">Nincs megadva</option>
                                {departmentOptions.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                ))}
                              </PilotSelect>
                            </PilotFormField>
                            <div className="flex flex-col gap-1">
                              {index === 0 ? (
                                <span className="text-sm font-semibold text-pilot-grey-900">
                                  Érintett eszközök
                                </span>
                              ) : null}
                              <JobAssetPicker
                                departmentId={item.departmentId}
                                selected={item.assetIds}
                                onChange={(assetIds) =>
                                  setDraft({
                                    ...draft,
                                    items: draft.items.map((row, rowIndex) =>
                                      rowIndex === index
                                        ? { ...row, assetIds }
                                        : row,
                                    ),
                                  })
                                }
                              />
                            </div>
                          </div>
                        )
                      ) : null}
                    </div>
                  ))}
                  <div className="flex items-center justify-between">
                    <PilotButton
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          items: [...draft.items, emptyItem()],
                        })
                      }
                    >
                      Tétel hozzáadása
                    </PilotButton>
                    <p className="text-xs text-pilot-grey-500">
                      Éves nettó összesen:{" "}
                      <span className="font-semibold text-pilot-grey-900">
                        {money(String(yearly))} Ft
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 border-t border-pilot-grey-100 pt-2">
                  <div className="flex items-center justify-end gap-2">
                    <PilotButton
                      type="button"
                      variant="secondary"
                      onClick={() => setCreating(false)}
                    >
                      Mégsem
                    </PilotButton>
                    <PilotButton
                      type="button"
                      variant="primary"
                      disabled={saving || missing.length > 0}
                      onClick={() => void create()}
                    >
                      {saving ? "Mentés…" : "Szerződés mentése"}
                    </PilotButton>
                  </div>
                  {missing.length > 0 ? (
                    <p className="text-right text-xs font-medium text-red-600">
                      Hiányzik: {missing.join(", ")}.
                    </p>
                  ) : null}
                </div>
              </div>
            </PilotCard>
          ) : null}
          {loading ? (
            <p className="text-sm text-pilot-grey-400">
              Szerződések betöltése…
            </p>
          ) : contracts.length === 0 ? (
            <PilotCard className="p-5 text-sm text-pilot-grey-400">
              Még nincs rögzített szerződés.
            </PilotCard>
          ) : (
            contracts.map((contract) => (
              <PilotCard className="flex flex-col gap-3 p-5" key={contract.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-pilot-grey-400">
                      {contract.number} · {contract.customer.displayName}
                    </p>
                    <h2 className="text-lg font-semibold text-pilot-grey-900">
                      {contract.title}
                    </h2>
                    <p className="text-sm text-pilot-grey-400">
                      Érvényes:{" "}
                      {new Date(contract.validFrom).toLocaleDateString("hu-HU")}
                      {contract.validTo
                        ? ` – ${new Date(contract.validTo).toLocaleDateString("hu-HU")}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Link href={`/partnerek/szerzodesek/${contract.id}`}>
                      <PilotButton type="button" variant="secondary">
                        Részletek és szerkesztés
                      </PilotButton>
                    </Link>
                    {/*
                      NATÍV `label` + rejtett `input[type=file]`, PilotButton
                      "primary" kinézetével -- egy nézhetőleg gomb, ami
                      valójában a fájl-választót nyitja meg. Ugyanaz a minta,
                      mint a régi kódban, csak a pilot stílussal: egy
                      beágyazott `<button>` a `<label>`-ben NEM váltaná ki a
                      natív fájl-választót ugyanolyan megbízhatóan.
                    */}
                    <label className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md bg-pilot-aqua-600 px-3.5 py-1.5 text-sm font-medium text-white transition-all duration-100 hover:bg-pilot-aqua-700 active:bg-pilot-aqua-800">
                      {uploading === contract.id
                        ? "Feltöltés…"
                        : "PDF feltöltése"}
                      <input
                        className="sr-only"
                        type="file"
                        accept="application/pdf"
                        disabled={uploading === contract.id}
                        onChange={(event) =>
                          void upload(contract.id, event.target.files?.[0])
                        }
                      />
                    </label>
                  </div>
                </div>
                <ul className="space-y-1 text-sm text-pilot-grey-900">
                  {contract.items.map((item) => (
                    <li key={item.id}>
                      {item.position}. {item.description} —{" "}
                      {money(
                        String(
                          Number(item.unitNet) *
                            Number(item.quantity) *
                            item.occasionsPerYear,
                        ),
                      )}{" "}
                      Ft nettó / év
                    </li>
                  ))}
                </ul>
                {contract.documents.length ? (
                  <div className="flex flex-wrap gap-2">
                    {contract.documents.map((document) => (
                      <PilotButton
                        key={document.id}
                        type="button"
                        variant="secondary"
                        onClick={() =>
                          void download(
                            contract.id,
                            document.id,
                            document.fileName,
                          )
                        }
                      >
                        {document.fileName}
                      </PilotButton>
                    ))}
                  </div>
                ) : null}
              </PilotCard>
            ))
          )}
        </div>
      </div>
    </PilotThemeRoot>
  );
}
