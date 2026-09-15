"use client";

import {
  Alert,
  Button,
  Card,
  FormField,
  Input,
  Select,
  Skeleton,
  Textarea,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type WorksheetContentInput,
  type WorksheetCustomerSummary,
  type WorksheetSelectablePartner,
  type WorksheetDepartmentSummary,
} from "@acropora/types";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ServiceBackLink } from "@/components/service/service-detail-chrome";
import { ServiceListHeader } from "@/components/service/service-list-chrome";
import { serviceJobsApi } from "@/lib/api/service-jobs";
import { worksheetsApi } from "@/lib/api/worksheets";
import { JobAssetPicker } from "@/components/service-jobs/job-asset-picker";
import { buildSiteOptions } from "@/lib/partners/site-tree";
import {
  toggleAssignee,
  useAssignableUsers,
  WorksheetAssigneePicker,
} from "./worksheet-assignee-picker";
import {
  emptyLine,
  toLineInput,
  WorksheetLineEditor,
  type WorksheetLineDraft,
} from "./worksheet-line-editor";

interface HeaderDraft {
  subject: string;
  description: string;
  issueDate: string;
  fulfillmentDate: string;
  dueDate: string;
}

function emptyHeader(): HeaderDraft {
  return {
    subject: "",
    description: "",
    issueDate: "",
    fulfillmentDate: "",
    dueDate: "",
  };
}

/** Az üres dátummezőt nem küldjük tovább üres szövegként: az API dátumot
 * vár vagy semmit, és az üres szöveg érvénytelen dátum, nem hiányzó adat. */
function dateOrNull(value: string): string | null {
  return value.trim() ? value : null;
}

function content(
  header: HeaderDraft,
  lines: WorksheetLineDraft[],
): WorksheetContentInput {
  return {
    subject: header.subject.trim(),
    description: header.description.trim() ? header.description.trim() : null,
    issueDate: dateOrNull(header.issueDate),
    fulfillmentDate: dateOrNull(header.fulfillmentDate),
    dueDate: dateOrNull(header.dueDate),
    lines: lines.map(toLineInput),
  };
}

export interface WorksheetEditorPageProps {
  /** Megadva a lap piszkozatát szerkeszti, enélkül újat vesz fel. */
  worksheetId?: string;
}

export function WorksheetEditorPage({ worksheetId }: WorksheetEditorPageProps) {
  const { session } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  /**
   * A HIBAJEGY, AMI ALA A LAP KERUL -- A CIMBOL, ES CSAK FELVITELNEL.
   *
   * A jegy reszletlapja hozza ide a felhasznalot, es a lap ebbol tudja meg,
   * melyik jegy ala keszul. MEGLEVO lapon nincs ertelme: a csatolas ott sajat
   * uton megy (a jegy reszletlapjarol), es egy cimben all6 azonosito
   * ELCSUSZHATNA attol, ami a lapon all.
   */
  const ticketId = worksheetId ? null : searchParams.get("hibajegy");
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );

  const [partners, setPartners] = useState<WorksheetSelectablePartner[]>([]);
  /** Whether the partner list has come back at all. An empty picker means two
   * different things before and after the answer arrives, and only one of them
   * is worth explaining: an empty list is a rule, a list that never arrived is
   * a broken connection, and that already has its own message. */
  const [partnersLoaded, setPartnersLoaded] = useState(false);
  /**
   * CSAK SIKERES BETOLTES UTAN BILLEN AT, ugyanaz a megfontolas, mint a
   * partnereknel: egy URES lista szabaly, egy MEG MEG NEM ERKEZETT lista
   * szakadt kapcsolat -- es a masodiknak sajat mondata van. Ha a jelzo a
   * hibanal is atbillenne, a lap azt allitana, hogy nincs alegyseg, holott
   * nem tudjuk lekerdezni.
   */
  const [departmentsLoaded, setDepartmentsLoaded] = useState(false);
  /** The partner of a worksheet that already exists. It comes from the
   * worksheet itself rather than from the customer list, because the list is
   * deliberately not loaded while editing: the field is read-only there, so
   * fetching every customer to display one name would be pages of requests for
   * nothing. Without this the disabled Select had no option matching the
   * assigned id and fell back to the placeholder, so an existing worksheet
   * looked like it had no partner at all. */
  const [assignedCustomer, setAssignedCustomer] =
    useState<WorksheetCustomerSummary | null>(null);
  const [departments, setDepartments] = useState<WorksheetDepartmentSummary[]>(
    [],
  );
  const [customerId, setCustomerId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [header, setHeader] = useState<HeaderDraft>(emptyHeader);
  const [lines, setLines] = useState<WorksheetLineDraft[]>([emptyLine()]);
  const [newDepartment, setNewDepartment] = useState({
    parentId: "",
    code: "",
    name: "",
  });
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  /**
   * A LAP ALTAL ERINTETT ESZKOZOK. A jegybol nyitott lap a jegy eszkozeivel
   * INDUL -- elotoltes, nem kotes: levehetok, es tovabbiak felvehetok.
   */
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(Boolean(worksheetId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * A JEGY PARTNERE, HA JEGY ALA KESZUL A LAP. `null`, amig nem tudjuk.
   *
   * Ha megvan, a partner-valaszto ZART: a szerver ugyis visszautasitana az
   * eltero partnert (`mayWorksheetJoinTicket`), es egy valaszto, ami olyat
   * kinal, amit a vegpont utana elutasit, epp az a nema alak, amit ma reggel a
   * csatolo listanal is megszuntettunk.
   */
  const [ticketCustomerId, setTicketCustomerId] = useState<string | null>(null);
  /**
   * A JEGY HELYSZINE, HA JEGY ALA KESZUL A LAP -- ELOTOLTESKENT, NEM KOTESKENT.
   *
   * Balazs kerese (2026-09-14 22:20, szo szerint): „Ha uj munkalapot nyitok a
   * hibajegybol akkor jo lenne ha a heyszin automatikusan az lenne ami a
   * hibajegybol jon".
   *
   * ELOTOLTES ES NEM ROGZITES, es a kulonbseg MERT, nem ovatossag: a
   * szerveroldali szabaly (`mayWorksheetJoinTicket`) KIZAROLAG a PARTNERT
   * vizsgalja -- a helyszinrol semmit nem mond. Vagyis a lapot ma is szabad egy
   * MASIK egysegre nyitni a jegy alatt, es egy zart valaszto TOBB lenne, mint
   * amit a keres mond. A mezo ezert nyitva marad; a jegy erteke csak az
   * alapertelmezes.
   *
   * KULON ALLAPOT, ES NEM ELEG A `departmentId`: ha a jegy helyszine idokozben
   * ARCHIVALT lett, a valaszto-lista (ami aktivra szur) nem tartalmazza, es a
   * beallitott ertek CSENDBEN visszaesne a helykitoltore. Ahhoz, hogy ezt ki
   * lehessen mondani, tudni kell, MI VOLT a jegy erteke.
   */
  const [ticketDepartmentId, setTicketDepartmentId] = useState<string | null>(
    null,
  );
  const [ticketDepartmentName, setTicketDepartmentName] = useState<
    string | null
  >(null);
  const [ticketError, setTicketError] = useState<string | null>(null);
  /*
   * A FELELŐSÖK CSAK A FELVITELNÉL kerülnek ide. Egy meglévő lapon a kiosztást a
   * részletek oldal szerkeszti: az a lap AZONOSSÁGÁHOZ tartozik, nem a
   * piszkozat tartalmához, amit ez az űrlap cserél.
   */
  const { candidates, error: candidatesError } = useAssignableUsers(
    token,
    canManage && !worksheetId,
  );

  useEffect(() => {
    if (!canManage || worksheetId) return;
    const controller = new AbortController();
    /** The picker reads the service partners, not the buyers: a worksheet is
     * written for a partner, and a webshop customer never gets one.
     *
     * The endpoint hands back the whole list rather than pages of it, and the
     * list it hands back is already narrowed to partners a sheet can actually
     * be finished for -- one that has no partner code could be picked, worked
     * on, and then refuse to close. What each entry carries is the id the
     * worksheet stores, so everything below this line is unchanged. */
    worksheetsApi
      .selectablePartners(token, controller.signal)
      .then((response) => {
        setPartners(response.items);
        setPartnersLoaded(true);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError("A partnerlista nem tölthető be.");
      });
    return () => controller.abort();
  }, [canManage, token, worksheetId]);

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
          setError("Az alegységek nem tölthetők be.");
      }
    },
    [token],
  );

  /*
   * A VALASZTO A TELJES UTAT MUTATJA, NEM CSAK A LEVEL NEVET.
   *
   * A kod es a nev csak TESTVEREK kozott egyedi (ADR-010): ket kulonbozo ag
   * alatt ugyanaz a `BIO` es ugyanaz a "Biodom" megengedett es termeszetes.
   * Ez a mezo adja a MUNKALAPSZAM ELSO TAGJAT, tehat ket megkulonboztethetetlen
   * sor kozul rosszat valasztani nem szepseghiba: rossz szamot ad a lapnak.
   * Ugyanaz a `buildSiteOptions`, amit az eszkoz-szerkeszto es az eszkoz-lista
   * szuroje hasznal -- a szabaly egy helyen all, es innen is oda mutat.
   *
   * AMI ITT SZUKEBB, MINT AZ ESZKOZ-SZERKESZTON: a `departments` csak az AKTIV
   * sorokat tartja (lasd `loadDepartments`), tehat egy archivalt szulo alatt
   * allo aktiv helyszin utja ROVIDEBB lesz eggyel. Ez a mai viselkedes, es
   * szandekosan nem nyulok hozza ebben a korben: a szures nem ma keletkezett,
   * es a megvaltoztatasa a felajanlott halmazt is atirna.
   */
  const departmentOptions = useMemo(
    () => buildSiteOptions(departments),
    [departments],
  );

  /**
   * A JEGY HELYSZINE ELOTOLTVE ALL, DE A VALASZTOBAN NINCS BENNE.
   *
   * EGY ALLAPOT, AMI KULONBEN NEMA LENNE. A valaszto-lista AKTIVRA szur, a jegy
   * helyszine viszont idokozben archivalhattak. Ilyenkor a beallitott ertekhez
   * nem tartozik `option`, es a `Select` a helykitoltore esik vissza -- a
   * kepernyon egy URES helyszin-mezo latszik, magyarazat nelkul, es a
   * felhasznalo azt hinne, az elotoltes nem mukodott.
   *
   * A MONDAT MEGNEVEZI, MI TORTENT ES MI A TEENDO. Nem hiba: egy archivalt
   * egysegre uj lapot nyitni amugy sem szabad (a jegy-felvitel is aktivra szur).
   */
  const ticketUnitArchived =
    !worksheetId &&
    ticketDepartmentId !== null &&
    departmentsLoaded &&
    /*
      URES LISTANAL NEM EZ A MONDAT JAR, ES EZT KET MEGLEVO ALLITAS MERTE VISSZA.

      Ha a partnernek EGYALTALAN nincs alegysege, akkor a jegy helyszine nem
      "archivalt" -- a ket meglevo mondat (nincs meg alegysege / a partnere nem
      szerviz partner) MAS teendot ad, es azok a helyesek. Az archivalas akkor
      all, ha VAN mibol valasztani, csak epp a jegy erteke nincs kozte.
    */
    departmentOptions.length > 0 &&
    !departmentOptions.some((option) => option.id === ticketDepartmentId);

  /**
   * AZ ARCHIVALT ELOTOLTES NEM MARADHAT AZ ALLAPOTBAN.
   *
   * A felirat kimondja, hogy nem toltheto elo -- de a `departmentId` addig meg
   * a jegy (archivalt) erteket hordozna, es a `Select` csak a helykitoltot
   * MUTATNA. Egy olyan mezo, ami masat mutat, mint amit KULD, a legrosszabb
   * alak: a felhasznalo egy lathatatlan erteket menne el.
   */
  useEffect(() => {
    if (ticketUnitArchived) setDepartmentId("");
  }, [ticketUnitArchived]);

  useEffect(() => {
    const controller = new AbortController();
    void loadDepartments(customerId, controller.signal);
    return () => controller.abort();
  }, [customerId, loadDepartments]);

  /**
   * A JEGY PARTNERE A SZERVERTOL JON, NEM A CIMBOL.
   *
   * A cim CSAK a jegy azonositojat hozza. A partnert lekerdezzuk, mert egy
   * cimben atadott partner-azonositot barki atirhatna -- es a lap ettol olyat
   * kinalna, amit a vegpont utana visszautasit.
   *
   * A HIBA ES A PARTNER NELKULI JEGY KET KULONBOZO ALLAPOT: az elso azt jelenti,
   * hogy nem tudjuk, mi a helyzet; a masodik azt, hogy a jegynek eloszb partnert
   * kell kapnia. Kulon mondatot kapnak.
   */
  useEffect(() => {
    if (!ticketId || !canManage) return;
    const controller = new AbortController();
    serviceJobsApi
      .detail(token, ticketId, controller.signal)
      .then((job) => {
        setTicketError(null);
        if (job.customerId === null) {
          setTicketError(
            "Ehhez a hibajegyhez még nincs partner. Először állítsd be a hibajegy partnerét, és utána nyiss alá munkalapot.",
          );
          return;
        }
        setTicketCustomerId(job.customerId);
        setCustomerId(job.customerId);
        /**
         * A HELYSZIN UGYANABBOL A VALASZBOL JON, nem kulon lekeresbol: a jegy
         * reszletlapja mar hordozza. Egy masodik hivas ugyanazert az egy
         * mezoert folosleges kor lenne.
         *
         * A JEGYNEK NEM KELL HELYSZIN (`departmentId` nullazhato), a LAPNAK
         * VISZONT IGEN (`Worksheet.departmentId` kotelezo). Ezert a hianyzo
         * ertek NEM kulon ag: a valaszto ures marad, es a felhasznalo valaszt
         * -- pontosan ugy, ahogy ma is teszi.
         */
        /*
          A `?? null` NEM FOLOSLEGES. A tipus `string | null`, de egy hianyos
          valasz (regi kliens, csonka dupla) `undefined`-ot ad -- es az
          `undefined !== null` IGAZ, tehat a lenti archivalas-ag TEVESEN
          elsulne egy olyan jegyen, aminek nincs is helyszine.
        */
        setTicketDepartmentId(job.departmentId ?? null);
        setTicketDepartmentName(job.departmentName ?? null);
        if (job.departmentId) setDepartmentId(job.departmentId);
        /**
         * AZ ESZKOZOK UGYANEBBOL A VALASZBOL JONNEK, masodik lekeres nelkul:
         * a jegy reszletlapja mar hordozza oket (`ServiceJobDetail.assets`).
         * Az urlapnak az `assetId` kell, nem a kapcsolat sajat azonositoja --
         * a ketto konnyen felcserelheto, es a csere NEM hibazna, csak
         * ismeretlen eszkozoket kuldene el.
         */
        setAssetIds(job.assets.map((link) => link.assetId));
      })
      .catch((cause: unknown) => {
        setTicketError(
          cause instanceof Error
            ? cause.message
            : "A hibajegy nem tölthető be, ezért a partnere sem állítható be automatikusan.",
        );
      });
    return () => controller.abort();
  }, [canManage, ticketId, token]);

  useEffect(() => {
    if (!worksheetId || !canManage) return;
    const controller = new AbortController();
    setLoading(true);
    worksheetsApi
      .detail(token, worksheetId, controller.signal)
      .then((detail) => {
        const current = detail.currentVersion;
        setCustomerId(detail.customer.id);
        setAssignedCustomer(detail.customer);
        setDepartmentId(detail.department.id);
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
            // A HIÁNYZÓ ÁR ÜRES MEZŐ AZ ŰRLAPON. A szerkesztőben az üres
            // mező a "még nincs kitöltve" alakja, és a mentés ugyanígy
            // küldi vissza - a nulla ott is értéknek látszana.
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

  const addDepartment = async () => {
    if (!customerId) return;
    setError(null);
    try {
      const created = await worksheetsApi.createDepartment(token, customerId, {
        // Ures ertek = a fa legfelso szintje. A mezot ilyenkor EL SEM kuldjuk:
        // az ures szoveg nem "nincs szulo", hanem ervenytelen azonosito.
        ...(newDepartment.parentId ? { parentId: newDepartment.parentId } : {}),
        code: newDepartment.code.trim().toUpperCase(),
        name: newDepartment.name.trim(),
      });
      setDepartments((current) => [...current, created]);
      setDepartmentId(created.id);
      // A szulo MARAD: egy ag ala tobbnyire tobb helyszin kerul egymas utan,
      // es a nullazasa minden masodik felvitelnel ujra kivalasztast kerne.
      setNewDepartment((current) => ({
        parentId: current.parentId,
        code: "",
        name: "",
      }));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az alegység felvitele nem sikerült.",
      );
    }
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = content(header, lines);
      const saved = worksheetId
        ? await worksheetsApi.updateDraft(token, worksheetId, body)
        : await worksheetsApi.create(token, {
            ...body,
            customerId,
            departmentId,
            assigneeIds,
            assetIds,
            // EGY TRANZAKCIOBAN a lappal: ket hivasban a masodik fele
            // elbukhatna, es epp az a jegy nelkuli lap keletkezne, amit senki
            // nem keresne a jegy alatt.
            ...(ticketId ? { serviceJobId: ticketId } : {}),
          });
      router.push(`/szerviz/munkalapok/${saved.id}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A mentés nem sikerült.",
      );
      setSaving(false);
    }
  };

  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs jogosultságod munkalapot írni"
        description="service.manage jogosultság szükséges."
      />
    );

  if (loading)
    return (
      <div className="space-y-3" aria-label="Munkalap betöltése">
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
      </div>
    );

  /** One partner on an existing worksheet, every selectable partner on a new
   * one. The two never mix: the field cannot be changed once the worksheet
   * exists, because the number was built from this partner. */
  const partnerOptions: { id: string; displayName: string }[] = assignedCustomer
    ? [assignedCustomer]
    : partners.map((partner) => ({
        id: partner.customerId,
        displayName: `${partner.partnerCode} - ${partner.name}`,
      }));

  /** The picker is narrowed on purpose: a partner with no abbreviation could be
   * picked and worked on, and would then refuse to close, in front of the
   * technician rather than the person who can fix it. That rule is invisible
   * from here, though - an empty dropdown looks like a broken screen, so it
   * says out loud why it is empty and where the missing field lives. */
  const noSelectablePartners =
    !worksheetId && partnersLoaded && partnerOptions.length === 0;

  /**
   * MIERT URES AZ ALEGYSEG-VALASZTO -- KET KULONBOZO OK, KET KULONBOZO TEENDO.
   *
   * A `selectable-partners` lista MAR ITT VAN, es ez adja a megkulonboztetest:
   * ha a jegy partnere BENNE all, akkor tukor-vevo soros szerviz partner, tehat
   * tenyleg nincs alatta alegyseg -- a kezelo letrehozhat egyet, itt helyben.
   * Ha NINCS benne, akkor a jegy egy REGI, nem-tukor vevo-soron all (a 430
   * elott a hibajegy-valaszto epp azokat kinalta), es ott alegyseg SOHA nem
   * lesz: ott a jegy partnerét kell rendbe tenni, nem alegyseget felvenni.
   *
   * A KETTOT AZERT KELL SZETVALASZTANI, mert az egyik esetben a kezelo TUD
   * tenni valamit ezen a lapon, a masikban NEM -- es egy kozos mondat a masodik
   * felhasznalot itt tartana, hiaba.
   */
  const noSelectableUnits =
    !worksheetId &&
    Boolean(customerId) &&
    departmentsLoaded &&
    departmentOptions.length === 0;
  const ticketPartnerIsMirror =
    ticketCustomerId === null ||
    partners.some((partner) => partner.customerId === ticketCustomerId);

  const canSubmit =
    Boolean(header.subject.trim()) &&
    (Boolean(worksheetId) || (Boolean(customerId) && Boolean(departmentId)));

  return (
    <div className="space-y-6">
      {/* A KILEPES A CIM FOLOTT ALL, NEM A MUVELETEK KOZOTT. Az urlapon a
          "Megsem" a mentes MELLETT allt, ugyanolyan sulyunak latszva -- pedig
          az egyik ir, a masik elhagyja a lapot. */}
      <ServiceBackLink
        href={
          worksheetId
            ? `/szerviz/munkalapok/${worksheetId}`
            : "/szerviz/munkalapok"
        }
      >
        {worksheetId ? "Vissza a munkalapra" : "Munkalapok"}
      </ServiceBackLink>
      {/* URLAP-FEJLEC, NEM ADATLAP-FEJLEC, es ezt a prototipus dontotte el, nem
          megitelés: a `styles.css`-ben a 29 pixel egy MODOSITO
          (`.detail-head h1`), amit az app.js kizarolag a harom ADATLAPRA tesz
          ra -- az urlap-rajzolo sima `page-head`-et ad ki, tehat 32 pixelt.
          Az EYEBROW is masra valo itt: a listakon morzsa ("Szerviz / munkater"),
          az urlapokon az, hogy MI EZ A LAP. */}
      <ServiceListHeader
        eyebrow={worksheetId ? "Munkalap adatai" : "Új bejegyzés"}
        title={worksheetId ? "Munkalap szerkesztése" : "Új munkalap"}
        lead={
          worksheetId
            ? "A piszkozat teljes tartalma cserélődik a mentéskor."
            : "A sorszám a lezáráskor keletkezik, a piszkozatnak nincs száma."
        }
      />
      {error ? (
        <Alert variant="danger" title="Hiba" description={error} />
      ) : null}
      {/*
        A JEGY OLDALAROL JOTT BAJ KULON MONDATOT KAP, mert MAS a teendo: a
        mentesi hiba a lapon mulik, ez a HIBAJEGYEN. Egy kozos "Hiba" fejlec
        mindkettot ugyanoda tenne, es a felhasznalo a rossz helyen keresne.
      */}
      {ticketError ? (
        <Alert
          variant="danger"
          title="A hibajegy oldaláról"
          description={ticketError}
        />
      ) : null}

      <Card className="grid gap-4 p-4 md:grid-cols-2">
        <FormField
          label="Partner"
          description={
            noSelectablePartners
              ? "Csak az a partner választható, akinél be van pipálva a Szerviz, és van munkalap-rövidítése. A rövidítést a partner adatlapján lehet felvinni."
              : undefined
          }
        >
          <Select
            aria-label="Partner"
            value={customerId}
            // A JEGY ALA KESZULO LAPON A PARTNER ZART: a jegy dönti el, es a
            // szerver ugyis visszautasitana az elterot.
            disabled={Boolean(worksheetId) || ticketCustomerId !== null}
            onChange={(event) => {
              setCustomerId(event.target.value);
              setDepartmentId("");
            }}
          >
            <option value="">
              {noSelectablePartners
                ? "Nincs választható szerviz partner"
                : "Válassz partnert"}
            </option>
            {partnerOptions.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.displayName}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          label="Alegység"
          description={
            ticketUnitArchived
              ? `A hibajegy helyszíne (${ticketDepartmentName ?? "ismeretlen"}) archivált, ezért nem tölthető elő. Válassz aktív alegységet.`
              : noSelectableUnits
                ? ticketPartnerIsMirror
                  ? "Ehhez a partnerhez még nincs alegység. Vegyél fel egyet lent -- a kódja lesz a munkalapszám első tagja."
                  : "Ehhez a hibajegyhez nem tartozhat alegység: a partnere nem szerviz partnerként van felvéve. A jegy partnerét kell rendbe tenni, alegységet felvenni itt nem segít."
                : "A munkalapszám első tagja is ebből lesz."
          }
        >
          <Select
            aria-label="Alegység"
            value={departmentId}
            disabled={Boolean(worksheetId) || !customerId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <option value="">Válassz alegységet</option>
            {departmentOptions.map((department) => (
              <option key={department.id} value={department.id}>
                {department.label}
              </option>
            ))}
          </Select>
        </FormField>
        {!worksheetId && customerId ? (
          <div className="grid gap-2 md:col-span-2 md:grid-cols-[14rem_120px_1fr_auto]">
            {/* A gyoker az ELSO es alapertelmezett valasztas: a mai helyszinek
                tobbsege ilyen, es egy uj partnernel is ez a gyakori eset. */}
            <Select
              aria-label="Szülő helyszín"
              value={newDepartment.parentId}
              onChange={(event) =>
                setNewDepartment((current) => ({
                  ...current,
                  parentId: event.target.value,
                }))
              }
            >
              <option value="">Legfelső szint</option>
              {departmentOptions.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.label}
                </option>
              ))}
            </Select>
            <Input
              aria-label="Új alegység kódja"
              value={newDepartment.code}
              placeholder="Kód (BIO)"
              onChange={(event) =>
                setNewDepartment((current) => ({
                  ...current,
                  code: event.target.value,
                }))
              }
            />
            <Input
              aria-label="Új alegység neve"
              value={newDepartment.name}
              placeholder="Név (Biodóm)"
              onChange={(event) =>
                setNewDepartment((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
            <Button
              type="button"
              variant="secondary"
              disabled={
                !newDepartment.code.trim() || !newDepartment.name.trim()
              }
              onClick={() => void addDepartment()}
            >
              Alegység felvitele
            </Button>
          </div>
        ) : null}
        {!worksheetId ? (
          <FormField
            label="Felelősök"
            className="md:col-span-2"
            description="Elhagyható: a kiosztás a lap adatlapján később is elvégezhető."
          >
            <div className="space-y-1">
              <WorksheetAssigneePicker
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
            </div>
          </FormField>
        ) : null}
        {!worksheetId ? (
          <FormField
            label="Érintett eszközök"
            className="md:col-span-2"
            description={
              departmentId
                ? "Elhagyható. A hibajegyből nyitott lap a jegy eszközeivel indul; itt levehetők és továbbiak felvehetők."
                : "Előbb válassz alegységet: az eszközök a helyszín részfájából jönnek."
            }
          >
            {/*
              UGYANAZ A VALASZTO, AMIT A JEGY-FELVITEL HASZNAL, es nem masolat:
              a `JobAssetPicker` harom bemenetet vesz (helyszin, kivalasztottak,
              visszahivas), es semmi jegy-specifikus nincs benne. A szurese a
              helyszin RESZFAJARA megy, ugyanugy, ahogy a szerver ellenoriz.
            */}
            <JobAssetPicker
              departmentId={departmentId}
              selected={assetIds}
              onChange={setAssetIds}
            />
          </FormField>
        ) : null}
        <FormField label="Tárgy" className="md:col-span-2">
          <Input
            aria-label="Tárgy"
            value={header.subject}
            onChange={(event) =>
              setHeader((current) => ({
                ...current,
                subject: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Keltezés">
          <Input
            aria-label="Keltezés"
            type="date"
            value={header.issueDate}
            onChange={(event) =>
              setHeader((current) => ({
                ...current,
                issueDate: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Teljesítés">
          <Input
            aria-label="Teljesítés"
            type="date"
            value={header.fulfillmentDate}
            onChange={(event) =>
              setHeader((current) => ({
                ...current,
                fulfillmentDate: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Határidő">
          <Input
            aria-label="Határidő"
            type="date"
            value={header.dueDate}
            onChange={(event) =>
              setHeader((current) => ({
                ...current,
                dueDate: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Megjegyzés" className="md:col-span-2">
          <Textarea
            aria-label="Megjegyzés"
            rows={3}
            value={header.description}
            onChange={(event) =>
              setHeader((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
          />
        </FormField>
      </Card>

      <WorksheetLineEditor
        lines={lines}
        onChange={setLines}
        disabled={saving}
      />

      {/*
        A "MEGSEM" A MENTES MELLE KERULT, ES NEM A LAP TETEJEN MARADT.

        A kilepes maga a cim folotti hivatkozas -- de az urlap VEGEN, a kitoltes
        utan az ember a mentes mellett keresi, amikor meggondolja magat. Eddig
        csak a lap tetejen allt, vagyis a leggorgetett allapotbol nem latszott.
        Ugyanoda visz, mint a felso hivatkozas; ez nem masodik ut, hanem
        ugyanaz az ut a masodik helyen, ahol keresik.
      */}
      <div className="flex justify-end gap-2">
        <Link
          href={
            worksheetId
              ? `/szerviz/munkalapok/${worksheetId}`
              : "/szerviz/munkalapok"
          }
        >
          <Button variant="secondary" disabled={saving}>
            Mégsem
          </Button>
        </Link>
        <Button disabled={!canSubmit || saving} onClick={() => void submit()}>
          {saving ? "Mentés..." : "Mentés"}
        </Button>
      </div>
    </div>
  );
}
