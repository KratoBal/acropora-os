"use client";

import { Alert, Icon, Skeleton } from "@acropora/ui";
import { hasPermission, PERMISSIONS } from "@acropora/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ServiceOfflineNotice } from "@/components/service/service-offline-notice";
import { worksheetsApi } from "@/lib/api/worksheets";
import {
  toLineInput,
  WorksheetLineEditor,
  type WorksheetLineDraft,
} from "../worksheet-line-editor";
import {
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotDataRow,
  PilotFormField,
  PilotInput,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";

/**
 * A FIGMA MAKE TERV ÁTÜLTETÉSE -- MUNKALAP SZERKESZTÉSE (PISZKOZAT).
 *
 * Balázs kérése (2026-09-25, acrobot msg 23783): "MUNKALAP SZERKESZTES
 * (/szerviz/munkalapok/[id]/szerkesztes) a terv szerint, a mai mezokkel."
 *
 * === ÚJ, KÜLÖN FÁJL -- NEM A RÉGI `worksheet-editor-page.tsx` ÁTALAKÍTÁSA ===
 *
 * A `worksheet-editor-page.tsx` MA KÉT MÓDBAN fut: `worksheetId` nélkül
 * FELVITEL, `worksheetId`-vel SZERKESZTÉS. A `/uj` útvonal viszont már MÁS
 * fájlra mutat (`pilot-worksheet-create-page.tsx`, a saját fejléce szerint a
 * felvitel-ág LOGIKÁJÁT szó szerint átvéve, csak pilot-stílusra) -- tehát a
 * régi fájl felvitel-ága útvonal nélkül maradt, csak SZERKESZTÉSRE hívja
 * bárki (ez a fájl a `/szerkesztes` útvonal mögött, lásd a route fájlt).
 *
 * ELSŐRE KÉZENFEKVŐNEK TŰNT a régi fájlból egyszerűen KIVENNI a felvitel-ágat
 * -- DE: `worksheet-editor-page.component.test.tsx` (1102 sor) tesztjeinek
 * TÖBBSÉGE (partner-választó, felelős-választó, helyszín-fa, archivált
 * egységek szabályai) éppen a FELVITEL-ágat mérte, `worksheetId` NÉLKÜL
 * hívva a komponenst -- és a `pilot-worksheet-create-page.tsx`-nek (ami ma
 * ÉLESBEN ezt a logikát futtatja) akkor még NEM VOLT SAJÁT tesztje. Ezért
 * ekkor a régi fájl és a teljes tesztsora ÉRINTETLEN maradt (holt kód, de
 * nem törölve), és ez a fájl egy ÚJ, KIZÁRÓLAG szerkesztésre szolgáló,
 * pilot-stílusú lapot adott -- a mezők és a mentési logika a régi fájl
 * `worksheetId`-s ágából, SZÓ SZERINT átvéve.
 *
 * FRISSÍTVE 2026-09-25 (acrobot msg 23809): a felvitel-ág CREATE-tesztjei
 * átköltöztek `pilot-worksheet-create-page.component.test.tsx`-be, a régi
 * fájl (és a teljes régi tesztsora) ETTŐL KEZDVE TÖRÖLVE -- nincs több
 * fedetlen logika, amit a régi fájl életben tartana.
 *
 * === A MEZŐK -- MIND A MAI KÓDBÓL, EGY SEM ÚJ ===
 *
 * Partner, Alegység: a régi lapon SZERKESZTÉSKOR letiltott (disabled)
 * választóként jelentek meg -- egy letiltott, egyetlen opciót mutató
 * legördülő ugyanazt az információt adja, mint egy sima adat-sor, csak
 * zavaróbban. Itt `PilotDataRow`-ként jelennek meg (ugyanaz a minta, mint a
 * hibajegy adatlap "Eszköz" kártyáján ma) -- ez PUSZTÁN vizuális csere, a
 * mező ma sem volt szerkeszthető szerkesztéskor.
 * Tárgy, Keltezés, Teljesítés, Határidő, Megjegyzés: szerkeszthetők, a régi
 * lap ugyanezen mezői.
 * Érintett eszközök: a régi lap SZERKESZTÉSKOR nem ad választót, csak egy
 * tájékoztató mondatot ("az adatlapon vehetők fel és le") -- ugyanaz itt is,
 * szó szerint.
 * Felelősök, az új alegység mini-űrlap: a régi lap ezeket KIZÁRÓLAG
 * felvitelkor mutatta (`!worksheetId`) -- szerkesztéskor sosem jelentek meg,
 * tehát ide nem kerülnek.
 *
 * === A TÉTEL-SZERKESZTŐ MÁR TUD PILOT MÓDOT ===
 *
 * A `WorksheetLineEditor` `pilot` propja NEM új -- a `pilot-worksheet-
 * create-page.tsx` már használja. A komponens saját fejléce szerint a régi,
 * nem-pilot hívó (ez a szerkesztő lap) a propot eddig nem adta át; mostantól
 * átadja, ugyanúgy, mint a felvitel lap.
 */

interface HeaderDraft {
  subject: string;
  description: string;
  issueDate: string;
  fulfillmentDate: string;
  dueDate: string;
}

/** Az üres dátummezőt nem küldjük tovább üres szövegként: az API dátumot
 * vár vagy semmit, és az üres szöveg érvénytelen dátum, nem hiányzó adat. */
function dateOrNull(value: string): string | null {
  return value.trim() ? value : null;
}

export interface PilotWorksheetEditorPageProps {
  worksheetId: string;
}

export function PilotWorksheetEditorPage({
  worksheetId,
}: PilotWorksheetEditorPageProps) {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );

  const [customerName, setCustomerName] = useState("");
  const [departmentLabel, setDepartmentLabel] = useState("");
  const [header, setHeader] = useState<HeaderDraft>({
    subject: "",
    description: "",
    issueDate: "",
    fulfillmentDate: "",
    dueDate: "",
  });
  const [lines, setLines] = useState<WorksheetLineDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    setLoading(true);
    worksheetsApi
      .detail(token, worksheetId, controller.signal)
      .then((detail) => {
        const current = detail.currentVersion;
        setCustomerName(detail.customer.displayName);
        setDepartmentLabel(
          detail.department.path?.length
            ? detail.department.path.join(" / ")
            : detail.department.name,
        );
        setHeader({
          subject: current.subject,
          description: current.description ?? "",
          issueDate: current.issueDate ?? "",
          fulfillmentDate: current.fulfillmentDate ?? "",
          dueDate: current.dueDate ?? "",
        });
        setLines(
          current.lines.map((line) => ({
            description: line.description,
            detail: line.detail ?? "",
            quantity: line.quantity,
            unit: line.unit,
            // A FAJTA ÉS A LÉTSZÁM A SZERVERRŐL JÖN, NEM AZ ŰRLAP
            // ALAPÉRTELMEZÉSÉBŐL -- lásd a régi lap azonos megjegyzését.
            kind: line.kind,
            workerCount: String(line.workerCount),
            unitNet: line.unitNet ?? "",
            vatRatePercent: line.vatRatePercent ?? "",
          })),
        );
      })
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A munkalap nem tölthető be.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canManage, token, worksheetId]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await worksheetsApi.updateDraft(token, worksheetId, {
        subject: header.subject.trim(),
        description: header.description.trim()
          ? header.description.trim()
          : null,
        issueDate: dateOrNull(header.issueDate),
        fulfillmentDate: dateOrNull(header.fulfillmentDate),
        dueDate: dateOrNull(header.dueDate),
        lines: lines.map(toLineInput),
      });
      router.push(`/szerviz/munkalapok/${worksheetId}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A mentés nem sikerült.",
      );
      setSaving(false);
    }
  };

  if (!canManage)
    return (
      <PilotThemeRoot className="-m-6 min-h-screen bg-pilot-grey-50 p-8">
        <Alert
          variant="danger"
          title="Nincs jogosultságod munkalapot írni"
          description="service.manage jogosultság szükséges."
        />
      </PilotThemeRoot>
    );

  const canSubmit = Boolean(header.subject.trim()) && !saving;

  return (
    <PilotThemeRoot className="-m-6 min-h-screen bg-pilot-grey-50">
      <div className="border-b border-pilot-grey-200 bg-white px-8 py-5">
        <Link
          href={`/szerviz/munkalapok/${worksheetId}`}
          className="mb-3 flex items-center gap-1.5 text-xs text-pilot-grey-400 transition-colors hover:text-pilot-grey-700"
        >
          <Icon name="chevron-left" size={12} />
          Vissza a munkalapra
        </Link>
        <h1 className="text-xl font-semibold text-pilot-grey-900">
          Munkalap szerkesztése
        </h1>
        <p className="mt-1 text-sm text-pilot-grey-400">
          A piszkozat teljes tartalma cserélődik a mentéskor.
        </p>
      </div>

      <div className="flex max-w-3xl flex-col gap-5 px-8 py-6">
        <ServiceOfflineNotice state={{ kind: "form" }} pilot />
        {error ? (
          <Alert variant="danger" title="Hiba" description={error} />
        ) : null}

        {loading ? (
          <div className="space-y-3" aria-label="Munkalap betöltése">
            <Skeleton className="h-16" />
            <Skeleton className="h-64" />
          </div>
        ) : (
          <>
            <PilotCard>
              <PilotCardHeader title="Hozzárendelés" />
              <div className="px-5 py-2">
                <PilotDataRow label="Partner" value={customerName} />
                <PilotDataRow label="Alegység" value={departmentLabel} />
              </div>
            </PilotCard>

            <PilotCard>
              <PilotCardHeader title="Munkalap adatai" />
              <div className="grid grid-cols-1 gap-x-6 gap-y-5 p-5 sm:grid-cols-2">
                <PilotFormField
                  label="Tárgy"
                  required
                  className="sm:col-span-2"
                >
                  <PilotInput
                    aria-label="Tárgy"
                    value={header.subject}
                    onChange={(value) =>
                      setHeader((current) => ({ ...current, subject: value }))
                    }
                  />
                </PilotFormField>
                <PilotFormField label="Keltezés">
                  <PilotInput
                    aria-label="Keltezés"
                    type="date"
                    value={header.issueDate}
                    onChange={(value) =>
                      setHeader((current) => ({
                        ...current,
                        issueDate: value,
                      }))
                    }
                  />
                </PilotFormField>
                <PilotFormField label="Teljesítés">
                  <PilotInput
                    aria-label="Teljesítés"
                    type="date"
                    value={header.fulfillmentDate}
                    onChange={(value) =>
                      setHeader((current) => ({
                        ...current,
                        fulfillmentDate: value,
                      }))
                    }
                  />
                </PilotFormField>
                <PilotFormField label="Határidő">
                  <PilotInput
                    aria-label="Határidő"
                    type="date"
                    value={header.dueDate}
                    onChange={(value) =>
                      setHeader((current) => ({ ...current, dueDate: value }))
                    }
                  />
                </PilotFormField>
                <PilotFormField label="Megjegyzés" className="sm:col-span-2">
                  <textarea
                    aria-label="Megjegyzés"
                    rows={3}
                    value={header.description}
                    onChange={(event) =>
                      setHeader((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    className="w-full resize-none rounded-md px-3 py-1.5 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                  />
                </PilotFormField>
              </div>
            </PilotCard>

            <WorksheetLineEditor
              pilot
              lines={lines}
              onChange={setLines}
              disabled={saving}
            />

            <PilotCard>
              <PilotCardHeader title="Érintett eszközök" />
              <div className="p-5">
                <p className="text-sm text-pilot-grey-400">
                  A lap eszközei a munkalap adatlapján szerkeszthetők, saját
                  mentéssel: azok a laphoz tartoznak, nem a verzióhoz, tehát
                  lezárt lapon is javíthatók. Mentés után az adatlapon vehetők
                  fel és le.
                </p>
              </div>
            </PilotCard>

            <div className="flex items-center gap-4 pb-8">
              <Link href={`/szerviz/munkalapok/${worksheetId}`}>
                <PilotButton variant="secondary" disabled={saving}>
                  Mégsem
                </PilotButton>
              </Link>
              <PilotButton
                variant="primary"
                disabled={!canSubmit}
                onClick={() => void submit()}
              >
                {saving ? "Mentés…" : "Mentés"}
              </PilotButton>
            </div>
          </>
        )}
      </div>
    </PilotThemeRoot>
  );
}
