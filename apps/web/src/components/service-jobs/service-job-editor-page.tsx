"use client";

import {
  Alert,
  PageHeader,
  PAGE_GUTTER_X,
  PilotField,
  PilotFileInput,
  PilotFormActions,
  PilotFormCard,
  PilotFormLayout,
  PilotInput,
  PilotSelect,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type WorksheetSelectablePartner,
  uploadAccept,
} from "@acropora/types";
import type { WorksheetDepartmentSummary } from "@acropora/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ServiceOfflineNotice } from "@/components/service/service-offline-notice";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { maintenanceOrdersApi } from "@/lib/api/maintenance-orders";
import { serviceJobsApi } from "@/lib/api/service-jobs";
import { worksheetsApi } from "@/lib/api/worksheets";
import { buildSiteOptions } from "@/lib/partners/site-tree";
import {
  keepsContractJobOperationId,
  newContractJobOperationId,
} from "./contract-job-operation";
import {
  ContractJobPicker,
  type ContractJobChoice,
} from "./contract-job-picker";
import { JobAssetPicker } from "./job-asset-picker";
import { PartnerPicker } from "./partner-picker";
import {
  toggleAssignee,
  useAssignableUsers,
  WorksheetAssigneePicker,
} from "@/components/worksheets/worksheet-assignee-picker";

/**
 * ÚJ HIBAJEGY, BELSŐ FELVITEL.
 *
 * EZ A FOLYAMAT MÁSODIK FELE, névvel: „a lap eljut a felelőshöz (aki ilyenkor
 * MI vagyunk), a felelős létrehozza a hibajegyet, és a meglévő lap annak
 * részévé válik" (Balázs, 2026-09-02 08:02). Tehát a jegyet BELÜL nyitjuk, egy
 * bejelentkezett kollégaként - az ügyfél-oldali bejelentés külön munka, és az
 * ügyfélportál kérdése.
 *
 * A PARTNER ÉS A HELYSZÍN KÖTELEZŐ (Balázs döntése, 2026-09-23 06:53, Discord
 * fő csatorna, üzenet 1552181062837346325, szó szerint: „Kötelező"). A kérdés,
 * amire válaszolt: a helyszín kötelezővé tételéből következik, hogy a partner
 * is azzá válik a hibajegyen, mert helyszíne csak partnernek van.
 *
 * === AMI ITT ÁLLT, ÉS MIÉRT NEM ÁLL TÖBBÉ ===
 *
 * „A PARTNER NEM KÖTELEZŐ, és ez nem lazaság. A tipikus úton a jegy egy MÁR
 * MEGLÉVŐ lapból születik... A partner nélküli jegy ezért nem hiba, hanem
 * ÁTMENETI állapot." Ez a lapon ELEVE nem állt: ezt az egy útvonalat
 * (`/szerviz/hibajegyek/uj`) semmilyen munkalap nem tölti elő, a partner
 * mindig kézzel választandó volt. A döntés ezt az utat zárja le, nem
 * szűkíti: a partner nélküli belső jegy lehetősége megszűnt.
 *
 * A HELYSZÍN-VÁLASZTÓ NULLA OPCIÓS ÁLLAPOTA (a partnernek nincs felvéve
 * alegysége) ugyanúgy BLOKKOL, mint a munkalap-szerkesztőn -- lásd
 * `noSelectableUnits` ott, és `nincsValaszthatoHelyszin` itt.
 *
 * A VÁLASZTÓ KERES, NEM LISTÁZ. A vevő-lista lapozott, és egy oldal legfeljebb
 * százat ad: egy sima legördülő CSENDBEN levágná a többit, és a hiányzó partner
 * úgy nézne ki, mintha nem is létezne.
 */
export function ServiceJobEditorPage({
  kind = "REPAIR",
}: {
  kind?: "REPAIR" | "MAINTENANCE";
}) {
  const { session } = useAuth();
  const router = useRouter();
  // Where the way out leads: the list this form was opened from (the tickets, or the maintenance sheets).
  const listHref =
    kind === "MAINTENANCE" ? "/szerviz/karbantartas" : "/szerviz/hibajegyek";
  // A karbantartásnak semmi köze a hibajegyekhez (Balázs, 2026-11-18): a karbantartási űrlap a saját szavait használja.
  const maintenance = kind === "MAINTENANCE";
  const titleLabel = maintenance ? "Mi a feladat?" : "Mi a baj?";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [customer, setCustomer] = useState<WorksheetSelectablePartner | null>(
    null,
  );
  const [departments, setDepartments] = useState<WorksheetDepartmentSummary[]>(
    [],
  );
  /**
   * A BETOLTOTTSEG KULON ALL AZ URES LISTATOL. Egy ures lista jelentheti azt,
   * hogy a partnernek nincs helyszine, es azt is, hogy meg nem jott meg a
   * valasz. A ket allapot ket kulon mondatot erdemel -- a telefonos urlapon ma
   * pontosan ez a kulonbseg hianyzott, es egy ures valaszto ugy nezett ki,
   * mintha a partnernek nem lenne helyszine.
   */
  const [departmentsLoaded, setDepartmentsLoaded] = useState(false);
  const [departmentId, setDepartmentId] = useState("");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  // a mező-hibák az első mentési kísérlet UTÁN látszanak (előtte az összesítő és a halvány gomb jelez)
  const [showErrors, setShowErrors] = useState(false);
  /**
   * A MAR LETREJOTT JEGY, HA A CSATOLMANYOK FELTOLTESE BUKOTT EL.
   *
   * KET LEPES, KET KIMENET, ES A MASODIK BUKASA NEM TESZI SEMMISSE AZ ELSOT.
   * A jegy ilyenkor LETEZIK -- ha a kepernyo csak annyit mondana, hogy "nem
   * sikerult", a kezelo ujra megnyomna a gombot, es egy MASODIK jegy szuletne
   * ugyanarrol a hibarol. Ezert a gomb ettol a pillanattol nem felvitel, hanem
   * UJRAPROBALAS a csatolmanyokra.
   */
  const [created, setCreated] = useState<{
    id: string;
    jobNumber: string;
    /** Opened from a contract: the description and colleagues follow on it. */
    viaContract?: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );
  const token = session?.token ?? "";
  /**
   * A KARBANTARTÁSI LAP SZERZŐDÉSBŐL (karbantartási felmérés S7). Csak
   * karbantartásnál, és csak annak, aki a szerződést is látja: a szerződés-lista
   * és a lap-létrehozás végpontja is `partners.manage` jogot kér.
   */
  const canUseContract =
    kind === "MAINTENANCE" &&
    Boolean(
      session && hasPermission(session.user, PERMISSIONS.PARTNERS_MANAGE),
    );
  const [contractChoice, setContractChoice] =
    useState<ContractJobChoice | null>(null);
  const contractOperationId = useRef(newContractJobOperationId());
  /**
   * AN EARLIER REQUEST UNDER THE KEPT KEY HAS AN UNKNOWN OUTCOME (no answer or
   * 5xx): the job may exist with the current partner, contract, items and title.
   * Until the retry resolves, none of these may change (barracuda, #1711 review):
   * a changed request under the old key would be answered with the old job, and
   * the new choice would be lost without a word.
   */
  const [contractUnresolved, setContractUnresolved] = useState(false);

  /**
   * A VALASZTHATO KOLLEGAK LISTAJA. A `canManage` a kapcsolo: jogosultsag
   * nelkul a lap amugy is elutasitja a felvitelt, tehat a lekerdezes sem indul.
   */
  const { candidates, error: candidatesError } = useAssignableUsers(
    token,
    canManage,
  );

  /**
   * A PARTNER HELYSZINEI, UGYANARROL A VEGPONTROL, AMIT A MUNKALAP HASZNAL.
   *
   * Nem uj vegpont es nem uj fa: a `WorksheetDepartment` ugyanaz a torzsadat,
   * amit a munkalap-szerkeszto es az eszkoz-urlap is olvas. A jegy eddig CSAK a
   * partnert tudta, tehat a lancban a legelso lepes volt a legkevesbe pontos.
   *
   * CSAK AZ AKTIV SOROK, ugyanugy, mint a munkalapon: archivalt egysegre ne
   * lehessen uj jegyet nyitni. A ket helyen ugyanaz a szures all, tehat a
   * felajanlott halmaz sem tud elcsuszni egymastol.
   */
  const loadDepartments = useCallback(
    async (owner: string, signal?: AbortSignal) => {
      if (!owner) {
        setDepartments([]);
        setDepartmentsLoaded(false);
        return;
      }
      try {
        const response = await worksheetsApi.departments(token, owner, signal);
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
    void loadDepartments(customer?.customerId ?? "", controller.signal);
    return () => controller.abort();
  }, [customer?.customerId, loadDepartments]);

  /**
   * PARTNERVALTASKOR A HELYSZIN ELESIK. Enelkul az elozo partner egysege
   * maradna kivalasztva, a valasztoban viszont mar nem szerepelne -- a mezo
   * URESNEK latszana, kozben ertek allna benne, es a szerver utasitana el a
   * felvitelt egy olyan hibaval, amit a kepernyon semmi nem magyaraz.
   */
  useEffect(() => {
    setDepartmentId("");
    setContractChoice(null);
  }, [customer?.customerId]);

  /**
   * HELYSZINVALTASKOR AZ ESZKOZOK IS ELESNEK, ugyanabbol az okbol, amiert a
   * helyszin esik el partnervaltaskor: az elozo helyszin eszkoze a listaban
   * mar nem szerepel, tehat a valasztas LATHATATLANNA valna -- kozben elmenne
   * a szerverre, ami elutasitana, egy olyan hibaval, amit a kepernyon semmi
   * nem magyaraz.
   */
  useEffect(() => {
    setAssetIds([]);
  }, [departmentId]);

  /**
   * A VALASZTO A TELJES UTAT MUTATJA, NEM CSAK A LEVEL NEVET. A kod es a nev
   * csak TESTVEREK kozott egyedi (ADR-010), tehat ket kulonbozo ag alatt
   * ugyanaz a "Biodom" megengedett. Ugyanaz a `buildSiteOptions`, amit a
   * munkalap-szerkeszto, az eszkoz-szerkeszto es az eszkoz-lista hasznal.
   */
  const departmentOptions = useMemo(
    () => buildSiteOptions(departments),
    [departments],
  );

  /**
   * NULLA VALASZTHATO HELYSZIN -- UGYANAZ A MINTA, MINT A MUNKALAP-SZERKESZTON
   * (`noSelectableUnits`). Ha a partnernek egyaltalan nincs alegysege, a
   * felvitel nem folytathato: a helyszin KOTELEZO, es nincs mibol valasztani.
   */
  const nincsValaszthatoHelyszin =
    Boolean(customer) && departmentsLoaded && departmentOptions.length === 0;

  /**
   * A PARTNER ES A HELYSZIN KOTELEZO (Balazs dontese, 2026-09-23). A `created`
   * ag a csatolmany-ujraprobalkozast fedi: ha a jegy mar letrejott, a gomb mar
   * nem felvitel, tehat a mezok ervenyesseget nem kell ujra megkovetelni.
   */
  // a hiányzó kötelező mezők (a szabály a régi: partner, helyszín vagy szerződéses tétel, cím), a megjelenő név és a doboz azonosítója
  const missingFields: { label: string; fieldId: string }[] = [];
  if (!created) {
    if (!customer)
      missingFields.push({
        label: "Partner",
        fieldId: "hibajegy-partner-mezo",
      });
    if (contractChoice) {
      if (contractChoice.itemIds.length === 0)
        missingFields.push({
          label: "Szerződéses tétel",
          fieldId: "hibajegy-szerzodes-mezo",
        });
    } else if (!departmentId)
      missingFields.push({
        label: "Helyszín",
        fieldId: "hibajegy-helyszin-mezo",
      });
    if (!title.trim())
      missingFields.push({ label: titleLabel, fieldId: "hibajegy-cim-mezo" });
  }
  const missing = missingFields.map((field) => field.label);
  const canSubmit = missing.length === 0;
  const errorOf = (label: string, sentence: string) =>
    showErrors && missing.includes(label) ? sentence : null;
  // a halvány mentés gomb kattintható: hiányzó mezőnél megmutatja a hibákat és az első hibás mezőhöz görget (nem ment)
  const onSubmitClick = () => {
    if (canSubmit) {
      void submit();
      return;
    }
    setShowErrors(true);
    const first = missingFields[0];
    if (first) {
      const box = document.getElementById(first.fieldId);
      box?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      box
        ?.querySelector<HTMLElement>("input, select, textarea, button")
        ?.focus({ preventScroll: true });
    }
  };

  if (!canManage)
    return (
      <Alert
        variant="danger"
        title={`Nincs jogosultságod ${maintenance ? "karbantartási lapot" : "hibajegyet"} nyitni`}
        description="service.manage jogosultság szükséges."
      />
    );

  /**
   * A CSATOLMANYOK A JEGY LETREJOTTE UTAN MENNEK FEL.
   *
   * === MIERT NEM EGYUTT A FELVITELLEL ===
   *
   * Balazs kerese szo szerint "hibajegy rogzitesekor" csatolast mond -- a jegy
   * viszont a mentes pillanataban MEG NEM LETEZIK, tehat nincs mihez kotni a
   * fajlt. A fajlt ezert a mentes ELOTT valasztjuk ki, es a rekord letrejotte
   * UTAN toltjuk fel. Ugyanez a sorrend all a mobil eszkoz- es
   * munkalap-urlapjan (`planPhotosAfterRecord`), es ott mar bevalt.
   *
   * === A KEPEK ES AZ EGYEB FAJLOK KET KERESBEN MENNEK ===
   *
   * A `type` mezo keresenkent EGY ertek, a besorolas viszont a tartalombol
   * kovetkezik. Sorban, nem parhuzamosan: a szerver keret-ellenorzese a mar
   * felhasznalt helyet olvassa a tablabol, es parhuzamos irasoknal mindketto
   * ugyanazt a regi osszeget latna.
   */
  const uploadFiles = async (jobId: string) => {
    const kepek = files.filter((file) => file.type.startsWith("image/"));
    const egyeb = files.filter((file) => !file.type.startsWith("image/"));
    if (kepek.length)
      await serviceJobsApi.uploadDocument(token, jobId, "PHOTO", kepek);
    if (egyeb.length)
      await serviceJobsApi.uploadDocument(token, jobId, "OTHER", egyeb);
  };

  /**
   * A SZERZŐDÉSES ÚT A LAPOT A SZERZŐDÉS VÉGPONTJÁN NYITJA (S4): a helyszín és
   * az eszközök a tételekből jönnek. A leírást és a delegálást az a végpont nem
   * fogadja, ezért azok a már létező lapra mennek, a csatolmányokkal azonos
   * sorrendben: előbb a lap, utána ami rá kerül.
   */
  const createFromContract = async (choice: ContractJobChoice) => {
    const { serviceJobId } = await maintenanceOrdersApi.createContractJob(
      token,
      {
        contractId: choice.contract.id,
        itemIds: choice.itemIds,
        title: title.trim(),
        clientOperationId: contractOperationId.current,
      },
    );
    return { id: serviceJobId, jobNumber: "", viaContract: true };
  };

  /** Ismételhető: a leírás felülírás, a delegálás a teljes halmaz. */
  const completeContractJob = async (jobId: string) => {
    if (description.trim())
      await serviceJobsApi.updateFields(token, jobId, {
        description: description.trim(),
      });
    if (assigneeIds.length)
      await serviceJobsApi.setAssignees(token, jobId, {
        userIds: assigneeIds,
      });
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    /**
     * A MAR LETREJOTT JEGYRE NEM NYITUNK MASIKAT. Ha az elso kor a feltoltesen
     * bukott el, ez a gomb UJRAPROBALAS -- a felvitelt nem szabad megismetelni.
     */
    let job = created;
    if (!job) {
      try {
        job = contractChoice
          ? await createFromContract(contractChoice)
          : await serviceJobsApi.create(token, {
              title: title.trim(),
              description: description.trim() || null,
              customerId: customer?.customerId ?? null,
              departmentId: departmentId || null,
              assetIds,
              assigneeIds,
              ...(kind === "MAINTENANCE" ? { kind } : {}),
            });
      } catch (cause) {
        // a válasz nélküli és az 5xx hibánál a lap létezhet: ugyanaz a kulcs
        // találja meg; a 4xx elutasítás után új kulcs kell
        if (contractChoice) {
          const keep = keepsContractJobOperationId(cause);
          if (!keep) contractOperationId.current = newContractJobOperationId();
          setContractUnresolved(keep);
        }
        setError(
          cause instanceof Error
            ? cause.message
            : contractChoice
              ? "A karbantartási lap nem jött létre."
              : maintenance
                ? "A karbantartási lap nem jött létre."
                : "A hibajegy nem jött létre.",
        );
        setSaving(false);
        return;
      }
      setContractUnresolved(false);
      setCreated(job);
    }

    if (job.viaContract) {
      try {
        await completeContractJob(job.id);
      } catch (cause) {
        setError(
          "A karbantartási lap LÉTREJÖTT, de a leírás vagy a delegálás mentése nem sikerült: " +
            (cause instanceof Error ? cause.message : "ismeretlen hiba") +
            ". A gombbal újrapróbálhatod, vagy a lap oldalán pótolhatod.",
        );
        setSaving(false);
        return;
      }
    }

    if (files.length) {
      try {
        await uploadFiles(job.id);
      } catch (cause) {
        /**
         * A RESZLEGES SIKER KIMONDVA, ES A JEGY SZAMAVAL EGYUTT.
         *
         * Ha csak annyit mondanank, hogy "nem sikerult", a kezelo azt hinne, a
         * jegy sem jott letre -- es vagy ujra felvinne, vagy elmenne, es a
         * fenykepek CSENDBEN elvesznenek. A szam azert kell, mert enelkul a
         * jegyet meg kellene keresnie a listaban.
         */
        setError(
          (job.viaContract
            ? "A karbantartási lap LÉTREJÖTT"
            : `A(z) ${job.jobNumber} ${maintenance ? "karbantartási lap" : "hibajegy"} LÉTREJÖTT`) +
            ", de a csatolmányok feltöltése nem sikerült: " +
            (cause instanceof Error ? cause.message : "ismeretlen hiba") +
            `. A fájlok kiválasztva maradtak, a gombbal újrapróbálhatod, vagy a ${maintenance ? "lapon" : "jegy lapján"} is feltöltheted.`,
        );
        setSaving(false);
        return;
      }
    }

    // A FRISS JEGY LAPJÁRA VISZÜNK, nem a listára: aki most nyitotta, azt
    // akarja folytatni - munkalapot csatolni, léptetni.
    router.push(`${listHref}/${job.id}`);
  };

  const submitLabel = created
    ? created.viaContract
      ? "Befejezés újra"
      : "Csatolmányok feltöltése újra"
    : maintenance
      ? "Karbantartási lap megnyitása"
      : "Hibajegy megnyitása";

  return (
    <PilotThemeRoot
      bleed
      className="flex min-h-screen flex-col bg-pilot-grey-50"
    >
      <div className={`${PAGE_GUTTER_X} pt-6`}>
        {/*
          A KILÉPÉS A CÍM FÖLÖTT ÁLL, ÉS NEM HELYETTESÍTI A „MÉGSE"-T: a kettő MÁS HELYZETRE való (a gombsor Mégse-je akkor, ha végigolvastad az
          űrlapot és nem viszed végig; ez akkor, ha rossz lapra jöttél). FIX CÉL, NEM `useReturnTo`: erre a lapra egyetlen helyről lehet eljutni
          (a lista „Új ..." gombjáról), egy menekülő-útnak pedig kiszámíthatónak kell lennie.
        */}
        <nav className="mb-3 flex items-center gap-1.5 text-xs text-pilot-grey-400">
          <button
            type="button"
            onClick={() => router.push(listHref)}
            className="cursor-pointer transition-colors hover:text-pilot-aqua-600"
          >
            Szerviz
          </button>
          <span>/</span>
          <button
            type="button"
            onClick={() => router.push(listHref)}
            className="cursor-pointer transition-colors hover:text-pilot-aqua-600"
          >
            {maintenance ? "Karbantartás" : "Hibajegyek"}
          </button>
          <span>/</span>
          <span className="font-medium text-pilot-grey-700">
            {maintenance ? "Új karbantartási lap" : "Új hibajegy"}
          </span>
        </nav>
        <PageHeader
          title={maintenance ? "Új karbantartási lap" : "Új hibajegy"}
          description={
            maintenance
              ? "A karbantartási lap is a lánc első eleme. A munkalapokat utólag lehet alá csatolni - a munkalap keletkezhet előbb is, mint a karbantartási lap."
              : "A hibajegy a lánc első eleme. A munkalapokat utólag lehet alá csatolni - a lap keletkezhet előbb is, mint a jegy."
          }
        />
      </div>

      <div className={`flex-1 ${PAGE_GUTTER_X} py-6`}>
        {/*
          A SORREND BALAZS KERESE, 2026-09-14, es nem izles kerdese: eloszor a Partner, utana a partnerhez kotodo helyszin a szokasos fa
          strukturaban, alatta a Mi a baj, majd a reszletek. A felvitel sorrendje tartalmi kerdes: a helyszin a partnertol FUGG.
        */}
        <PilotFormLayout
          top={
            <>
              <ServiceOfflineNotice state={{ kind: "form" }} pilot />
              {error ? (
                <Alert
                  variant="danger"
                  title="Nem sikerült"
                  description={error}
                />
              ) : null}
            </>
          }
          afterText={
            maintenance
              ? "Mentés után megnyílik az új karbantartási lap adatlapja, ahol munkalapot csatolhatsz alá. A felelősnek kiosztott kollégák értesítést kapnak, a fájlok a megnyitás után töltődnek fel."
              : "Mentés után megnyílik az új hibajegy adatlapja. A felelősnek kiosztott kollégák értesítést kapnak, a fotók a megnyitás után töltődnek fel."
          }
          actions={
            <PilotFormActions
              missing={missing}
              busy={saving}
              submitLabel={submitLabel}
              busyLabel="Mentés…"
              onCancel={() => router.push(listHref)}
              onSubmit={onSubmitClick}
            />
          }
        >
          <PilotFormCard title="Kinek és hol?">
            <PilotField
              id="hibajegy-partner-mezo"
              label="Partner"
              requirement="required"
              htmlFor={customer ? undefined : "hibajegy-partner"}
              error={errorOf("Partner", "Válassz partnert.")}
              help={
                customer
                  ? undefined
                  : "Helyszín csak partnerhez rendelve létezik."
              }
            >
              {customer ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{customer.name}</span>
                  <button
                    type="button"
                    className="text-xs text-pilot-grey-400 underline disabled:no-underline disabled:opacity-50"
                    disabled={contractUnresolved}
                    onClick={() => setCustomer(null)}
                  >
                    Másik partner
                  </button>
                </div>
              ) : (
                <PartnerPicker
                  variant="pilot"
                  id="hibajegy-partner"
                  onPick={setCustomer}
                />
              )}
            </PilotField>

            {canUseContract && customer ? (
              <div id="hibajegy-szerzodes-mezo">
                <ContractJobPicker
                  key={customer.customerId}
                  token={token}
                  customerId={customer.customerId}
                  siteOptions={departmentOptions}
                  value={contractChoice}
                  onChange={setContractChoice}
                  locked={contractUnresolved}
                />
                {errorOf(
                  "Szerződéses tétel",
                  "Jelölj ki legalább egy tételt.",
                ) ? (
                  <p
                    role="alert"
                    className="mt-1 text-xs font-medium text-pilot-red-700"
                  >
                    Jelölj ki legalább egy tételt.
                  </p>
                ) : null}
              </div>
            ) : null}
            {contractUnresolved ? (
              <p className="text-sm font-medium text-rose-600">
                Az előző kérés eredménye ismeretlen, a lap létrejöhetett. Előbb
                próbáld újra, és ne frissítsd az oldalt: frissítés után egy új
                kérés második lapot nyithat. A partner, a szerződés, a tételek
                és a cím addig nem módosítható.
              </p>
            ) : null}

            {contractChoice ? null : (
              <PilotField
                id="hibajegy-helyszin-mezo"
                label="Helyszín"
                requirement="required"
                htmlFor="hibajegy-helyszin"
                error={errorOf("Helyszín", "Válassz helyszínt.")}
              >
                {/*
                  HAROM KULON ALLAPOT, HAROM KULON MONDAT: nincs partner / meg toltunk / a partnernek nincs helyszine -- egy ures valaszto ugy
                  nezne ki, mintha a partnernek nem lenne helyszine.
                */}
                {!customer ? (
                  <p className="text-sm text-pilot-grey-500">
                    Előbb válassz partnert. A helyszínek a partner saját fájából
                    jönnek.
                  </p>
                ) : !departmentsLoaded ? (
                  <p className="text-sm text-pilot-grey-500">
                    Helyszínek betöltése...
                  </p>
                ) : nincsValaszthatoHelyszin ? (
                  <p className="text-sm text-pilot-grey-500">
                    Ehhez a partnerhez nincs felvéve helyszín, ezért egyelőre
                    nem nyitható {maintenance ? "lap" : "jegy"} rá. Vegyél fel
                    egyet a partner lapján.
                  </p>
                ) : (
                  <PilotSelect
                    id="hibajegy-helyszin"
                    className="w-full"
                    value={departmentId}
                    onChange={(nextValue) => setDepartmentId(nextValue)}
                    chevron
                  >
                    <option value="">Válassz helyszínt</option>
                    {departmentOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </PilotSelect>
                )}
              </PilotField>
            )}
          </PilotFormCard>

          <PilotFormCard title="Mi a munka?">
            <PilotField
              id="hibajegy-cim-mezo"
              label={titleLabel}
              requirement="required"
              htmlFor="hibajegy-cim"
              error={errorOf(
                titleLabel,
                maintenance
                  ? "Írd le röviden, mi a feladat."
                  : "Írd le röviden, mi a baj.",
              )}
            >
              <PilotInput
                id="hibajegy-cim"
                value={title}
                disabled={contractUnresolved}
                onChange={setTitle}
                placeholder={
                  maintenance
                    ? "Például: a hármas medence havi szűrőtisztítása"
                    : "Például: a hármas medence szivattyúja nem indul"
                }
              />
            </PilotField>

            <PilotField
              label="Részletek"
              requirement="optional"
              htmlFor="hibajegy-leiras"
            >
              <textarea
                id="hibajegy-leiras"
                className="w-full resize-y rounded-md px-3 py-2 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                rows={4}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </PilotField>

            <PilotField label="Érintett eszközök" requirement="optional">
              {/* A CIMKE `label`, de egy JELOLONEGYZET-LISTA all alatta (nincs `htmlFor`): a csoportra vonatkozik, a sorok a sajat feliratukat viszik. */}
              {contractChoice ? (
                <p className="text-sm text-pilot-grey-500">
                  A kijelölt szerződéstételek eszközei kerülnek a lapra.
                </p>
              ) : (
                <JobAssetPicker
                  departmentId={departmentId}
                  selected={assetIds}
                  onChange={setAssetIds}
                />
              )}
            </PilotField>

            <PilotField
              label="Fényképek és fájlok"
              requirement="optional"
              htmlFor="hibajegy-fajlok"
              help={
                files.length
                  ? `${files.length} fájl feltöltésre vár. A ${maintenance ? "karbantartási lap" : "hibajegy"} megnyitása után töltjük fel.`
                  : "JPEG, PNG vagy PDF, fájlonként legfeljebb 10 MB."
              }
            >
              {/* A SZAGGATOTT KERET csak keret: a mezo maga valtozatlan (a bongeszo sajat fajlvalasztoja marad, a billentyuzetes utat is megorizve). */}
              <div className="rounded-xl border border-dashed border-pilot-grey-200 bg-pilot-grey-50 px-4 py-5">
                <PilotFileInput
                  id="hibajegy-fajlok"
                  multiple
                  accept={uploadAccept(["jpeg", "png", "pdf"])}
                  className="text-sm"
                  onChange={(event) =>
                    setFiles(Array.from(event.target.files ?? []))
                  }
                />
              </div>
            </PilotField>
          </PilotFormCard>

          <PilotFormCard title="Ki felel érte?">
            <PilotField
              label="Felelős"
              requirement="optional"
              help={`A kiosztott kollégák értesítést kapnak a ${maintenance ? "lapról" : "jegyről"}.`}
            >
              <WorksheetAssigneePicker
                pilot
                candidates={candidates}
                selected={assigneeIds}
                onToggle={(userId) =>
                  setAssigneeIds((current) => toggleAssignee(current, userId))
                }
              />
              {candidatesError ? (
                <p className="text-xs font-medium text-rose-600">
                  {candidatesError}
                </p>
              ) : null}
            </PilotField>
          </PilotFormCard>
        </PilotFormLayout>
      </div>
    </PilotThemeRoot>
  );
}
