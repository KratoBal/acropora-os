"use client";

import { PilotBackLink } from "@/components/pilot/pilot-back-link";
import {
  Alert,
  PageHeader,
  PilotField,
  PilotFieldPair,
  PilotFormActions,
  PilotFormCard,
  PilotFormLayout,
  PILOT_FIELD_HINT_CLASS,
  Skeleton,
  PAGE_GUTTER_X,
} from "@acropora/ui";
import { hasPermission, PERMISSIONS } from "@acropora/types";
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
  PilotDataRow,
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
 *
 * === A KÖZÖS ŰRLAP-VÁZON, MINT AZ ÚJ MUNKALAP (picasso leltár 3.21, acrobot döntése 2026-11-26) ===
 *
 * Ugyanazok a kérdés-kártyák és ugyanaz a sorrend, mint a `pilot-worksheet-create-page.tsx`-ben (Kinek és hol? Mi a munka? Mikor?), a
 * kötelező és a nem kötelező mező ugyanúgy jelölve, a gombsor jobbra lent a hiány-összesítővel (eddig bal lent, "Mégsem" felirattal). A
 * mezők és a mentés logikája nem változott; a Tárgy hiányánál a mentés gomb halvány, kattintásra a mezőnél mondja meg a hibát.
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
  const [showErrors, setShowErrors] = useState(false);

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
      <PilotThemeRoot bleed className="min-h-screen bg-pilot-grey-50 p-8">
        <Alert
          variant="danger"
          title="Nincs jogosultságod munkalapot írni"
          description="service.manage jogosultság szükséges."
        />
      </PilotThemeRoot>
    );

  const missing = header.subject.trim() ? [] : ["Tárgy"];
  const backHref = `/szerviz/munkalapok/${worksheetId}`;
  // a halvány mentés gomb kattintható: hiányzó Tárgynál a mezőnél mondja meg a hibát és oda görget (nem ment), mint az Új munkalap
  const onSubmitClick = () => {
    if (missing.length === 0) {
      void submit();
      return;
    }
    setShowErrors(true);
    const box = document.getElementById("munkalap-targy-mezo");
    box?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    box?.querySelector<HTMLElement>("input")?.focus({ preventScroll: true });
  };

  return (
    <PilotThemeRoot bleed className="min-h-screen bg-pilot-grey-50">
      <div className={`${PAGE_GUTTER_X} pt-6`}>
        <PilotBackLink href={backHref}>Vissza a munkalapra</PilotBackLink>
        <PageHeader
          title="Munkalap szerkesztése"
          description="A piszkozat teljes tartalma cserélődik a mentéskor."
        />
      </div>

      <div className={`${PAGE_GUTTER_X} py-6`}>
        {loading ? (
          <div
            className="max-w-[760px] space-y-3"
            aria-label="Munkalap betöltése"
          >
            <Skeleton className="h-16" />
            <Skeleton className="h-64" />
          </div>
        ) : (
          <PilotFormLayout
            top={
              <>
                <ServiceOfflineNotice state={{ kind: "form" }} pilot />
                {error ? (
                  <Alert variant="danger" title="Hiba" description={error} />
                ) : null}
              </>
            }
            afterText="Mentés után visszakerülsz a munkalap adatlapjára. A piszkozat teljes tartalma cserélődik: a fejléc és a tételek is a most látható állapotra."
            actions={
              <PilotFormActions
                missing={missing}
                busy={saving}
                submitLabel="Mentés"
                busyLabel="Mentés…"
                onCancel={() => router.push(backHref)}
                onSubmit={onSubmitClick}
              />
            }
          >
            <PilotFormCard title="Kinek és hol?">
              <div>
                <PilotDataRow label="Partner" value={customerName} />
                <PilotDataRow label="Helyszín" value={departmentLabel} />
              </div>
              <p className={PILOT_FIELD_HINT_CLASS}>
                A partner és a helyszín a lap létrehozásakor dől el, itt nem
                változtatható.
              </p>
            </PilotFormCard>

            <PilotFormCard title="Mi a munka?">
              <PilotField
                id="munkalap-targy-mezo"
                label="Tárgy"
                requirement="required"
                error={
                  showErrors && missing.includes("Tárgy")
                    ? "Add meg a munkalap tárgyát."
                    : null
                }
              >
                <PilotInput
                  aria-label="Tárgy"
                  value={header.subject}
                  onChange={(value) =>
                    setHeader((current) => ({ ...current, subject: value }))
                  }
                />
              </PilotField>
              <PilotField label="Megjegyzés" requirement="optional">
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
              </PilotField>
              <WorksheetLineEditor
                pilot
                bare
                lines={lines}
                onChange={setLines}
                disabled={saving}
              />
              {/* nem mező: a lap eszközei az adatlapon szerkeszthetők, ezért nem kap "(nem kötelező)" jelet */}
              <div className="flex flex-col gap-1.5">
                <h3 className="text-sm font-semibold text-pilot-grey-800">
                  Érintett eszközök
                </h3>
                <p className={PILOT_FIELD_HINT_CLASS}>
                  A lap eszközei a munkalap adatlapján szerkeszthetők, saját
                  mentéssel: azok a laphoz tartoznak, nem a verzióhoz, tehát
                  lezárt lapon is javíthatók.
                </p>
              </div>
            </PilotFormCard>

            <PilotFormCard title="Mikor?">
              <PilotFieldPair>
                <PilotField label="Keltezés" requirement="optional">
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
                </PilotField>
                <PilotField label="Határidő" requirement="optional">
                  <PilotInput
                    aria-label="Határidő"
                    type="date"
                    value={header.dueDate}
                    onChange={(value) =>
                      setHeader((current) => ({ ...current, dueDate: value }))
                    }
                  />
                </PilotField>
              </PilotFieldPair>
              <PilotFieldPair>
                <PilotField label="Teljesítés" requirement="optional">
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
                </PilotField>
              </PilotFieldPair>
            </PilotFormCard>
          </PilotFormLayout>
        )}
      </div>
    </PilotThemeRoot>
  );
}
