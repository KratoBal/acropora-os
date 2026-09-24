"use client";

import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  FormField,
  Input,
  Skeleton,
  Textarea,
} from "@acropora/ui";
import {
  hasPermission,
  isFinishedServiceJob,
  PERMISSIONS,
  type ServiceJobDetail,
  type ServiceJobDocumentSummary,
  type ServiceJobHandoverMailPreview,
  type ServiceJobStatusValue,
  type ServiceJobTimelineEntry,
  type WorksheetAttachableItem,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { serviceJobsApi } from "@/lib/api/service-jobs";
import { worksheetsApi } from "@/lib/api/worksheets";
import { formatDateTime } from "@/components/worksheets/worksheet-labels";
import { megjegyzesKuldheto } from "./megjegyzes-celja";
import { CompletionCertificatePanel } from "./completion-certificate-panel";
import { MaintenancePackagePanel } from "./maintenance-package-panel";
import { HandoverMailDialog } from "./handover-mail-dialog";
import { KULDES_KIHAGYAS_OKA } from "./handover-mail-skip-reason";
import { PartnerPicker } from "./partner-picker";
import { ServiceStatusBadge } from "@/components/service/service-list-chrome";
import { ServiceDocumentGallery } from "@/components/service/service-document-gallery";
import { ServiceOfflineNotice } from "@/components/service/service-offline-notice";
import {
  ServiceBackLink,
  ServiceContextRow,
  ServiceDetailHeader,
  ServiceDetailSplit,
  ServiceNextAction,
  ServicePanel,
  ServicePanelHeading,
} from "@/components/service/service-detail-chrome";
import { ServiceJobAssigneeEditor } from "./service-job-assignee-editor";
import { ServiceJobPlacementEditor } from "./service-job-placement-editor";
import { ServiceJobFieldsEditor } from "./service-job-fields-editor";

import {
  serviceJobNoteDescription,
  serviceJobStatusLabel,
  serviceJobStatusTone,
  serviceJobStatusVariant,
  serviceJobWorksheetLabel,
} from "./service-job-labels";

/**
 * EGY NAPLÓSOR SZÖVEGE.
 *
 * Külön függvény, mert a naplónak HÁROM forrása van, és a három sor egy
 * mondatban olvasható. A szöveg nem a komponensben áll, hogy a mondat
 * felépítése tesztelhető legyen anélkül, hogy fel kellene rajzolni az oldalt.
 */
function timelineLine(entry: ServiceJobTimelineEntry): string {
  if (entry.kind === "status") {
    const to = serviceJobStatusLabel[entry.event.toStatus];
    if (entry.event.fromStatus === null) return `A hibajegy létrejött (${to}).`;
    const from = serviceJobStatusLabel[entry.event.fromStatus];
    return `${from} → ${to}`;
  }
  if (entry.kind === "worksheet")
    // UGYANAZ A CIMKE, MINT A LISTAN: nev, es zarojelben ami azonositja. Ha a
    // ket helyen ket kulonbozo alak allna, ugyanaz a lap ketfelekeppen nezne ki
    // EGY lapon belul.
    return `Munkalap a jegy alatt: ${serviceJobWorksheetLabel(entry.worksheet)}`;
  /*
    A TÖRÖLT CSATOLMÁNY SORA MEGNEVEZI, KI VETTE LE. Az állapotváltásnál a nevet
    a sor alatti másodperc-sor hozza; itt a MONDATBAN áll, mert ez az egyetlen
    naplósor, ami egy VISSZAFORDÍTHATATLAN törlésről szól, és ott a „ki" nem
    kísérőadat.

    Név nélkül is olvasható marad: egy azóta törölt felhasználó nem viszi
    magával a naplót, ugyanúgy, ahogy az állapotváltásoknál sem.
  */
  if (entry.kind === "document") {
    const mi =
      entry.removal.documentType === "PHOTO"
        ? `fényképet (${entry.removal.fileName})`
        : `csatolmányt (${entry.removal.fileName})`;
    return entry.removal.actorName
      ? `${entry.removal.actorName} törölt egy ${mi}`
      : `Törölt ${mi}`;
  }
  return `Eszköz a jegyen: ${entry.asset.assetNumber} (${entry.asset.assetName})`;
}

/**
 * A HIBAJEGY RÉSZLETLAPJA: A JEGY, ÉS AMI TÖRTÉNT VELE.
 *
 * EZ SZERKEZET, NEM TERV. A legegyszerűbb alak, ami a menetet végigviszi:
 * lista, részlet, lépés. Hogy a képernyő végül hogyan nézzen ki, az nem itt
 * dől el - de amíg nincs semmi, addig nincs miről beszélni.
 *
 * A NAPLÓ HÁROM FORRÁSBÓL ÁLL ÖSSZE (állapotváltás, munkalap, eszköz), de az
 * összefésülés NEM itt történik: a szerver adja vissza már egy időrendben. A
 * sorrend szabály, és a mobil nem is éri el a közös csomagot - ott a fésülés
 * újraíródna, két kliens, két sorrend, és a különbség néma. A kliens rajzol.
 */
export function ServiceJobDetailPage({ jobId }: { jobId: string }) {
  const { session } = useAuth();
  const [job, setJob] = useState<ServiceJobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [stepping, setStepping] = useState(false);
  const [note, setNote] = useState("");
  /**
   * MELYIK LEPESHEZ KESZULT A MEZOBEN ALLO SZOVEG.
   *
   * `null`, amig friss. Csak egy SIKERTELEN lepes allitja be: onnantol a
   * megtartott szoveg egy konkret atmenethez tartozik, es egy masik gomb
   * megnyomasa nem viheti el csendben. A szabaly a `megjegyzes-celja.ts`-ben
   * all, hogy felulet nelkul is merheto legyen.
   */
  const [noteCelja, setNoteCelja] = useState<ServiceJobStatusValue | null>(
    null,
  );
  const [attachable, setAttachable] = useState<WorksheetAttachableItem[]>([]);
  const [chosenSheet, setChosenSheet] = useState("");
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [sheetToDetach, setSheetToDetach] = useState<string | null>(null);
  const [partnerError, setPartnerError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<ServiceJobDocumentSummary[]>([]);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  /**
   * A FELTOLTESKORI FELIRAT, EGY KERESRE EGY (Balazs kerese, 2026-09-17:
   * "akar mar a feltoltesnel is").
   *
   * A vegpont tiz fajlt fogad, es ez az egy szoveg MINDEGYIKRE rakerul --
   * tipikusan egy helyszinen, egy percen belul keszult sorozatrol van szo.
   * Kepenkent mast a csempen lehet irni, a feltoltes utan.
   */
  const [documentCaption, setDocumentCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [documentToDelete, setDocumentToDelete] =
    useState<ServiceJobDocumentSummary | null>(null);
  const [downloadingPackage, setDownloadingPackage] = useState(false);
  const [packageError, setPackageError] = useState<string | null>(null);
  const [mailOpen, setMailOpen] = useState(false);
  const [mailPreview, setMailPreview] =
    useState<ServiceJobHandoverMailPreview | null>(null);
  const [mailPreviewError, setMailPreviewError] = useState<string | null>(null);
  const [mailSendError, setMailSendError] = useState<string | null>(null);
  const [mailSending, setMailSending] = useState(false);
  const [mailResult, setMailResult] = useState<string | null>(null);
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );
  /**
   * A REJTES SAJAT JOG, ES NEM A `canManage`.
   *
   * Balazs kerese, 2026-09-18 11:09 UTC, mar eles hasznalat kozben: "a gomb
   * ottmarad es megnyomhato barmelyik lapnal, jegynel. Azt szeretnem, hogy csak
   * admin jogos felhasznalonal jelenjen meg".
   *
   * A `SERVICE_MANAGE` a napi szerviz-munka jogkore: a sajat szerelo
   * kollegaink ES a partner-fiokok is viselik. A `SERVICE_HIDE` csak OWNER es
   * ADMIN.
   *
   * ES EZ CSAK A FELULET. A vegpont a felulet nelkul is hivhato, ezert a
   * szerver is kapuz (`RequirePermissions(SERVICE_HIDE)` plusz a szolgaltatas
   * sajat ellenorzese). Egy UI-only kapu nem kapu.
   */
  const canHide = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_HIDE),
  );
  const token = session?.token ?? "";

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setJob(await serviceJobsApi.detail(token, jobId, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A hibajegy nem tölthető be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canView, jobId, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  /**
   * A VALASZTO-LISTA KULON TOLTODIK, es a hibaja NEM allitja meg az oldalt: a
   * jegy elolvasasahoz nincs szukseg ra. Ha nem jon meg, a csatolo doboz marad
   * ures - a naplo, a lepesek es a lapok attol meg olvashatok.
   */
  /**
   * PARTNER NELKUL NEM KERJUK LE, es ez nem takarekossag: a lista a jegy
   * partnerere szukul, tehat partner nelkul nincs mire szukiteni. Egy ures
   * valaszto ott ugy nezne ki, mintha nem lenne mit csatolni -- holott a
   * csatolas amugy is elutasitana, sajat mondattal.
   */
  const jobCustomerId = job?.customerId ?? null;
  useEffect(() => {
    if (!canManage || jobCustomerId === null) return;
    const controller = new AbortController();
    worksheetsApi
      .attachable(token, jobCustomerId, controller.signal)
      .then((response) => setAttachable(response.items))
      .catch(() => undefined);
    return () => controller.abort();
  }, [canManage, jobCustomerId, token]);

  /**
   * A LÉPÉS UTÁN ÚJRATÖLTÜNK, nem a válaszból építünk.
   *
   * ÉS EZ MÁR NEM KÉNYSZER, HANEM VÁLASZTÁS: a `move` 2026-09-17 óta a friss
   * részletlapot adja (ugyanazt, amit a `load()` elhoz), tehát a képernyő
   * felépíthető lenne belőle, egy kör megspórolásával. Az a csere viszont a
   * WEBES viselkedést mozdítaná el, a mai javítás pedig a TELEFONOS kilépésről
   * szól -- ezért marad, ahogy van. Külön lépésnek való, nem ennek.
   */
  const step = async (to: ServiceJobStatusValue) => {
    /*
      A KAPU A HIVAS ELOTT ALL, ES MEGALL -- nem dont helyette.

      Egy megtartott szoveg egy MASIK atmenethez irodott; ha ezt csendben
      elkuldenenk, a jegynaplo egy olyan mondatot orizne, ami mashoz tartozik.
      Ha viszont csendben ELDOBNANK, a kezelo begepelt indoka tunne el nyom
      nelkul. Mind a ketto nema, ezert egyik sem jo: a mondat megnevezi MIND A
      KET lepest, a szoveg megmarad, es a dontes a kezeloe.
    */
    const ellenorzes = megjegyzesKuldheto({
      szoveg: note,
      celzott: noteCelja,
      most: to,
      cimke: (lepes) => serviceJobStatusLabel[lepes],
    });
    if (!ellenorzes.rendben) {
      setStepError(ellenorzes.uzenet);
      return;
    }

    setStepping(true);
    setStepError(null);
    try {
      await serviceJobsApi.move(token, jobId, {
        to,
        note: note.trim() || null,
      });
      /**
       * A MEZO CSAK SIKERES LEPES UTAN URUL. Ha a hivas elbukik (halozat,
       * utkozes, elutasitas), a felhasznalo begepelt szovege ottmarad -- egy
       * elveszett indokot ujra le kellene irni, es a masodik nekifutas
       * rovidebb lenne, mint az elso.
       */
      setNote("");
      // A SIKERES LEPES A CELT IS ELENGEDI: ures mezohoz nem tartozik lepes.
      setNoteCelja(null);
      await load();
    } catch (cause) {
      setStepError(
        cause instanceof Error ? cause.message : "A lépés nem sikerült.",
      );
      /*
        A BUKAS KOTI A SZOVEGET AHHOZ A LEPESHEZ, amihez keszult. Enelkul a
        megtartas (ami szandekos) csendben atvinne a kovetkezo gombra.
        URES mezonel nincs mit kotni -- kulonben egy ures mezo blokkolna a
        kovetkezo lepest.
      */
      setNoteCelja(note.trim() === "" ? null : to);
    } finally {
      setStepping(false);
    }
  };

  /**
   * A VALASZTO-LISTA UJRAKERESE, EGY HELYEN.
   *
   * A `?? ""` NEM JO ALAK IDE: ures azonositoval a vegpont elhasalna (a
   * parameter kotelezo), a hivo `catch` aga pedig elnyelne -- a lista csendben
   * regi maradna. Partner nelkul ezert NEM kerunk, es a lista sem valtozik: az
   * az allapot amugy sem all elo, mert csatolni sem lehet partner nelkul.
   */
  const refreshAttachable = async () => {
    if (jobCustomerId === null) return;
    const response = await worksheetsApi.attachable(token, jobCustomerId);
    setAttachable(response.items);
  };

  /**
   * A PARTNER POTLASA -- A FELVITEL VISSZAUTJA.
   *
   * A felvitel nem koveteli meg a partnert; a csatolas viszont igen. Enelkul a
   * gomb nelkul egy partner nelkul megnyitott jegy BENT RAGADNA: soha nem tudna
   * lapot fogadni, es a feluleten nem lenne kiut.
   */
  const setPartner = async (customerId: string) => {
    setPartnerError(null);
    try {
      await serviceJobsApi.setPartner(token, jobId, customerId);
      await load();
    } catch (cause) {
      setPartnerError(
        cause instanceof Error
          ? cause.message
          : "A partner beállítása nem sikerült.",
      );
    }
  };

  /**
   * A CSATOLMANYOK KULON TOLTODNEK, ES A HIBAJUK NEM ALLITJA MEG AZ OLDALT.
   *
   * Ugyanaz az indok, amiert a csatolhato lapok listaja is kulon jon: a jegy
   * ELOLVASASAHOZ nincs szukseg rajuk. Ha a hivas elbukik, a naplo, a lepesek
   * es a lapok attol meg olvashatok -- es a hiba OTT latszik, ahol keletkezett,
   * nem a lap tetejen.
   */
  const loadDocuments = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      try {
        const response = await serviceJobsApi.documents(token, jobId, signal);
        setDocuments(response.items);
        setDocumentsError(null);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setDocumentsError(
          cause instanceof Error
            ? cause.message
            : "A csatolmányok nem tölthetők be.",
        );
      }
    },
    [canView, jobId, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadDocuments(controller.signal);
    return () => controller.abort();
  }, [loadDocuments]);

  /**
   * FELTOLTES. A VALASZT NEM HASZNALJUK FEL A LISTA EPITESERE.
   *
   * A vegpont visszaadja a letrejott sorokat, es kesertes lenne hozzafuzni oket
   * a mai listahoz. Nem tesszuk: kozben MAS is tolthetett fel ugyanarra a
   * jegyre, es akkor a kepernyo egy olyan listat mutatna, ami sehol nem letezik.
   * Az ujratoltes egy korrel tobb, es a valoditat mutatja.
   */
  const uploadDocuments = async () => {
    if (documentFiles.length === 0 || uploading) return;
    setUploading(true);
    setDocumentsError(null);
    try {
      /**
       * A FAJTA A TARTALOMBOL KOVETKEZIK, NEM A FELHASZNALOTOL KERDEZZUK.
       *
       * Balazs kerese ket dolgot mond ("fotot illetve egyeb fajlokat is"), es a
       * ketto kozott a KEP a gyakori eset. Egy kotelezo legordulo itt minden
       * feltoltesnel egy kattintassal tobb lenne, es a valasz a fajl tipusabol
       * amugy is latszik. A szerver a TARTALMAT ismeri fel, tehat a `type` mezo
       * csak a besorolast mondja meg -- a kep `PHOTO`, minden mas `OTHER`.
       */
      const kepek = documentFiles.filter((file) =>
        file.type.startsWith("image/"),
      );
      const egyeb = documentFiles.filter(
        (file) => !file.type.startsWith("image/"),
      );
      // KET HIVAS, MERT A `type` MEZO KERESENKENT EGY. Sorban, nem
      // parhuzamosan: a keret-ellenorzes a mar felhasznalt helyet olvassa, es
      // parhuzamos irasoknal mindketto ugyanazt a regi osszeget latna.
      if (kepek.length)
        await serviceJobsApi.uploadDocument(
          token,
          jobId,
          "PHOTO",
          kepek,
          documentCaption,
        );
      if (egyeb.length)
        await serviceJobsApi.uploadDocument(
          token,
          jobId,
          "OTHER",
          egyeb,
          documentCaption,
        );
      setDocumentFiles([]);
      // A MEZOK CSAK SIKER UTAN URULNEK: egy elhasalt feltoltes utan a
      // begepelt felirat ottmarad, es a masodik nekifutas rovidebb.
      setDocumentCaption("");
      await loadDocuments();
    } catch (cause) {
      setDocumentsError(
        cause instanceof Error ? cause.message : "A feltöltés nem sikerült.",
      );
    } finally {
      setUploading(false);
    }
  };

  /**
   * LETOLTES. A BONGESZO SAJAT MENTESI UTJAN, ugyanugy, mint az eszkoz-lapon:
   * a valasz `Content-Disposition` fejlece csatolmanykent jeloli, es a fajlnev
   * is onnan jon -- de a horgony `download` attributuma az, ami a MI nevunket
   * teszi ra, ha a fejlec valaha elveszne.
   */
  const downloadDocument = async (item: ServiceJobDocumentSummary) => {
    setDocumentsError(null);
    try {
      const blob = await serviceJobsApi.downloadDocument(token, jobId, item.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setDocumentsError(
        cause instanceof Error ? cause.message : "A letöltés nem sikerült.",
      );
    }
  };

  const downloadPackage = async () => {
    setDownloadingPackage(true);
    setPackageError(null);
    try {
      const blob = await serviceJobsApi.downloadPackage(token, jobId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${job?.jobNumber ?? "hibajegy"}-dokumentumcsomag.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setPackageError(
        cause instanceof Error
          ? cause.message
          : "A dokumentumcsomag nem tölthető le.",
      );
    } finally {
      setDownloadingPackage(false);
    }
  };

  /**
   * A DIALOGUS MEGNYITASA ES A CIMZETTEK BETOLTESE.
   *
   * A lista a NYITASKOR jon le, nem a lap betoltesekor. Ket ok: a kezelok
   * tulnyomo tobbsege soha nem nyitja meg (a jegyek nagy resze nem megy ki
   * levelben), es egy lap-betoltessel egyutt lekert cimzett-lista addigra
   * elavulhatna, amig a gombig eljut.
   */
  const openHandoverMail = async () => {
    setMailOpen(true);
    setMailPreview(null);
    setMailPreviewError(null);
    setMailSendError(null);
    setMailResult(null);
    try {
      setMailPreview(await serviceJobsApi.handoverMailPreview(token, jobId));
    } catch (cause) {
      setMailPreviewError(
        cause instanceof Error
          ? cause.message
          : "A címzettek nem tölthetők be.",
      );
    }
  };

  /**
   * A KULDES -- ES A HAROM KIMENETEL HAROM KULON MONDATA.
   *
   * A `skipped` es a `refused` NEM hiba: a hivas sikerult, csak level nem ment
   * ki. Ha mindharom egy "elkuldve" uzenetet kapna, a kezelo azt hinne, hogy a
   * vevo megkapta a csomagot -- es a hibajegyet lezartnak tekintene.
   */
  const sendHandoverMail = async (input: {
    subject: string;
    message: string;
  }) => {
    setMailSending(true);
    setMailSendError(null);
    try {
      const eredmeny = await serviceJobsApi.sendHandoverMail(token, jobId, {
        subject: input.subject.trim() || undefined,
        message: input.message,
      });
      if (eredmeny.kind === "sent") {
        setMailOpen(false);
        setMailResult(`A hibajegy kiküldve ${eredmeny.recipients} címzettnek.`);
        await load();
        return;
      }
      /*
        A KET NEM-KULDO KIMENETEL AZ ABLAKBAN MARAD, es ez szandekos: a
        kezelo szovege ilyenkor MEGVAN, es egy bezarodo ablak elvenne tole.
      */
      /*
        A KIHAGYAS OKA A KEZELOHOZ IS ELJUT, NEM CSAK A NAPLOBA (2026-09-22).

        Eddig itt EGY mondat allt minden kihagyasra, es a `reason`-t el sem
        olvastuk. A nyolc okbol kettonel (`no-sender`, `no-job`) a cimzettek
        HELYESEK -- a regi mondat tehat epp oda kuldte a kezelot, ahol nincs
        mit javitani. A tablat a szerver oka indexeli, alapertelmezett ag
        NELKUL: egy ujabb ok igy forditasi hiba lesz, nem "ismeretlen ok" a
        kepernyon.
      */
      setMailSendError(
        eredmeny.kind === "refused"
          ? eredmeny.message
          : KULDES_KIHAGYAS_OKA[eredmeny.reason],
      );
    } catch (cause) {
      setMailSendError(
        cause instanceof Error ? cause.message : "A kiküldés nem sikerült.",
      );
    } finally {
      setMailSending(false);
    }
  };

  const deleteDocument = async (documentId: string) => {
    setDocumentToDelete(null);
    setDocumentsError(null);
    try {
      await serviceJobsApi.deleteDocument(token, jobId, documentId);
      await loadDocuments();
    } catch (cause) {
      setDocumentsError(
        cause instanceof Error ? cause.message : "A törlés nem sikerült.",
      );
    }
  };

  const detach = async (worksheetId: string) => {
    setSheetToDetach(null);
    setAttaching(true);
    setAttachError(null);
    try {
      await serviceJobsApi.detachWorksheet(token, jobId, worksheetId);
      // A LEVALASZTOTT LAP UJRA SZABAD, tehat a valaszto-listaba is
      // visszakerul -- mindkettot ujra kell kerni.
      await Promise.all([load(), refreshAttachable()]);
    } catch (cause) {
      setAttachError(
        cause instanceof Error ? cause.message : "A leválasztás nem sikerült.",
      );
    } finally {
      setAttaching(false);
    }
  };

  const attach = async () => {
    if (!chosenSheet) return;
    setAttaching(true);
    setAttachError(null);
    try {
      await serviceJobsApi.attachWorksheet(token, jobId, chosenSheet);
      setChosenSheet("");
      // UJRATOLTUNK MINDKETTOT: a jegy naploja es a valaszto-lista is
      // megvaltozott - a csatolt lap onnantol nem szabad.
      await Promise.all([load(), refreshAttachable()]);
    } catch (cause) {
      setAttachError(
        cause instanceof Error ? cause.message : "A csatolás nem sikerült.",
      );
    } finally {
      setAttaching(false);
    }
  };

  /**
   * A SAV A KORAI AGAKON IS KELL, ES EZ NEM DISZ.
   *
   * A lap NEGY kulonbozo dolgot adhat vissza (csontvaz, hibauzenet, ures, es a
   * kesz jegy). A HAROM ELSO epp az, amikor a magyarazat a legtobbet er: ures
   * kepernyo all ott. Ha a sav csak a lenti, "kesz jegy" agon allna, az
   * `{ kind: "empty" }` SOSEM allna elo -- oda mar csak `job`-bal jut el a
   * vezerles --, tehat egy olyan mondatot adnank at, amit senki nem olvashat.
   *
   * A `!canView` ag KIMARAD belole: ott nincs mit betolteni, a lap a
   * jogosultsagrol szol, es a sav csak zaj lenne mellette.
   */
  const offlineSav = (
    <ServiceOfflineNotice
      state={job ? { kind: "loaded" } : { kind: "empty" }}
    />
  );

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a hibajegyekhez"
        description="service.view jogosultság szükséges."
      />
    );

  if (loading && !job)
    return (
      <>
        {offlineSav}
        <div className="space-y-3" aria-label="Hibajegy betöltése">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      </>
    );

  // A már betöltött jegy újrakérése meghiúsulhat. Ilyenkor a képernyőn lévő
  // adat még olvasható; csak az új állapot ismeretlen. Nem dobjuk el, hanem a
  // hiba MELLETT tartjuk meg, különben egy átmeneti hálózati hiba elvenné a
  // szerelő elől azt is, amit már biztosan megkapott. Első betöltéskor viszont
  // nincs mit megtartani, ott az önálló hibaállapot és az Újrapróbálás kell.
  if (error && !job)
    return (
      <>
        {offlineSav}
        <Alert
          variant="danger"
          title="Betöltési hiba"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Újrapróbálás
            </Button>
          }
        />
      </>
    );

  if (!job) return offlineSav;

  // A MUNKALAP-SZAKASZ A NAPLÓBÓL SZŰR, nem külön listából: a végpont egy
  // időrendet ad, és ez a doboz csak MÁS NÉZETE ugyanannak. Egy második lista
  // a válaszban két helyen tartaná ugyanazt az adatot.
  const worksheets = job.timeline.flatMap((entry) =>
    entry.kind === "worksheet" ? [entry.worksheet] : [],
  );

  return (
    <div>
      {offlineSav}
      {/*
        A "VISSZA" NEM MUVELET, ES EZERT KERUL A LAP FOLE.

        Eddig a fejlec jobb oldalan allt, a muveletek helyen -- ott viszont
        ugyanolyan sulyu, mint az, ami a jegyen VALTOZTAT. A kozos adatlap-keret
        szandekosan valasztja szet a kettot.
      */}
      <ServiceBackLink href="/szerviz/hibajegyek">Hibajegyek</ServiceBackLink>

      {/*
        A SZAM A CIM FOLE KERUL, NEM ELE.

        Eddig egy sorban allt a ketto (`HJ-2026-001 - Cim`), es a cim -- amirol
        a lap SZOL -- egy azonosito mogul indult. A terv szetvalasztja oket: a
        szam kicsi es halvany a cim folott, a cim pedig akkora, hogy egy
        pillantasbol olvashato legyen. Ugyanaz az adat, mas sulyozassal.

        A JELVENY ES A HELYSZIN A CIM ALA KERUL, egy sorba. Az allapot az az
        egyetlen adat, amit a lap megnyitasakor MINDENKI keres; a helyszin pedig
        EZT a jegyet kulonbozteti meg ugyanannak a partnernek a tobbi jegyetol.
        A partner neve nem all itt: a jobb hasab nevesitett mezoben mondja meg,
        es ugyanaz a szo ket helyen csak zaj.
      */}
      <ServiceDetailHeader
        eyebrow={job.jobNumber}
        title={job.title}
        badge={
          <ServiceStatusBadge tone={serviceJobStatusTone(job.status)}>
            {serviceJobStatusLabel[job.status]}
          </ServiceStatusBadge>
        }
        sub={job.departmentName ?? undefined}
        actions={
          job.partnerStatus === "COMPLETED" ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={downloadingPackage}
                onClick={() => void downloadPackage()}
              >
                {downloadingPackage
                  ? "Dokumentumcsomag letöltése…"
                  : "Dokumentumcsomag letöltése"}
              </Button>
              {/*
                KET FELTETEL, ES A KETTO MAST MOND.

                Az ELKESZULT allapot ugyanaz, mint a letoltesnel, es nem
                veletlen: a kuldes a CSOMAGOT viszi, tehat pontosan akkor van
                ertelme, amikor a csomag eloallithato.

                A `canManage` viszont a LETOLTESNEL NEM all, es ez sem
                veletlen: a letoltes OLVASAS, a kikuldes IRAS -- egy olvaso
                jogkoru kollega letoltheti a csomagot, de levelet nem kuldhet
                a vevonek. A szerver ugyanezt koveteli
                (`@RequirePermissions(SERVICE_MANAGE)`); ez a feltetel azt
                akadalyozza meg, hogy egy gomb ott alljon, ami mindig hibara
                fut.
              */}
              {canManage ? (
                <Button onClick={() => void openHandoverMail()}>
                  Kiküldés e-mailben
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />

      {packageError ? (
        <div className="mb-5">
          <Alert
            variant="danger"
            title="Letöltési hiba"
            description={packageError}
          />
        </div>
      ) : null}

      {mailResult ? (
        <div className="mb-5">
          <Alert variant="info" title="Kiküldés" description={mailResult} />
        </div>
      ) : null}

      <HandoverMailDialog
        open={mailOpen}
        jobNumber={job.jobNumber}
        preview={mailPreview}
        previewError={mailPreviewError}
        sendError={mailSendError}
        busy={mailSending}
        onSend={(input) => void sendHandoverMail(input)}
        onCancel={() => setMailOpen(false)}
      />

      {error ? (
        <div className="mb-5">
          <Alert
            variant="danger"
            title="Betöltési hiba"
            description={error}
            action={
              <Button variant="secondary" onClick={() => void load()}>
                Újrapróbálás
              </Button>
            }
          />
        </div>
      ) : null}

      {/*
        KET HASAB: BALRA AZ UGY, JOBBRA A TEENDO.

        A lap eddig EGY oszlop volt, es a "Kovetkezo lepes" doboz a naplo es a
        munkalapok koze szorult -- vagyis az egyetlen dolog, amiert a kezelo
        megnyitja a lapot, gorgetes utan jott elo.

        A HASAB MAGA MOSTANTOL A KOZOS `ServiceDetailSplit`, ugyanaz, amin a
        munkalap-adatlap all: a torespont es a jobb oszlop szelessege egy helyen
        dol el, nem ket lapon kulon.
      */}
      <ServiceDetailSplit
        main={
          <>
            <ServicePanel className="space-y-3">
              <ServicePanelHeading title="A bejelentés" />
              {job.description ? (
                <p className="whitespace-pre-wrap text-sm leading-6 text-dusk-700">
                  {job.description}
                </p>
              ) : (
                /* AZ URES LEIRAS KIMONDVA. Egy hianyzo bekezdes ugyanugy nez ki, mint
             egy betoltesi hiba -- es a kulonbseget csak az mondja meg, aki a
             jegyet felvitte. */
                <p className="text-sm text-dusk-500">
                  A bejelentéshez nem írtak leírást.
                </p>
              )}
              {/*
                A SZERKESZTO A BEJELENTES MELLETT ALL, es nem a lap tetejen: a
                cim es a leiras UGYANANNAK a szovegnek a ket fele, es a kezelo
                ott keresi a javitast, ahol a hibat olvassa.

                LEZART JEGYEN NEM JELENIK MEG (`isFinishedServiceJob`, a KOZOS
                csomagbol -- ugyanabbol a listabol, amibol a szerver dolgozik,
                nem egy masodik felsorolasbol). A szerver akkor is elutasitana,
                de egy szerkeszto, ami biztosan elhasal, hamis igeret.
              */}
              {canManage && !isFinishedServiceJob(job.status) ? (
                <ServiceJobFieldsEditor
                  jobId={jobId}
                  token={token}
                  title={job.title}
                  description={job.description}
                  onSaved={() => load()}
                />
              ) : null}
            </ServicePanel>

            <ServicePanel className="space-y-3">
              <ServicePanelHeading title="Ami történt" />
              {job.timeline.length ? (
                <ol className="space-y-2" aria-label="A hibajegy naplója">
                  {job.timeline.map((entry) => (
                    <li
                      key={`${entry.kind}-${entry.sortKey}`}
                      className="border-b pb-2 text-sm last:border-0"
                    >
                      <div>{timelineLine(entry)}</div>
                      <div className="mt-0.5 text-xs text-dusk-500">
                        {formatDateTime(entry.at)}
                        {entry.kind === "status" && entry.event.actorName
                          ? ` · ${entry.event.actorName}`
                          : ""}
                      </div>
                      {/*
                        A TÖRÖLT CSATOLMÁNY SORA ALATT AZ ÁLL, AMIT A TÖRLÉS
                        ELVITT VOLNA: ki töltötte fel, és mikor. A fájl sora
                        addigra nincs meg, tehát ez az egyetlen hely, ahol ez
                        látszik - ha itt sem írnánk ki, a megőrzött adat
                        megvolna, csak nem tudna róla senki.

                        Régebbi bejegyzésnél `null`, és olyankor nem írunk
                        semmit: a „nem tudjuk" nem ugyanaz, mint a „nem volt".
                      */}
                      {entry.kind === "document" &&
                      entry.removal.uploadedAt !== null ? (
                        <div className="mt-0.5 text-xs text-dusk-500">
                          Feltöltve: {formatDateTime(entry.removal.uploadedAt)}
                          {entry.removal.uploadedByName
                            ? ` · ${entry.removal.uploadedByName}`
                            : ""}
                        </div>
                      ) : null}
                      {entry.kind === "status" && entry.event.note ? (
                        <div className="mt-1 whitespace-pre-wrap text-sm">
                          {entry.event.note}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState
                  title="Nincs bejegyzés"
                  description="Ezen a jegyen még nem történt semmi."
                />
              )}
            </ServicePanel>

            {/*
        A CSATOLMANYOK A NAPLO UTAN ES A MUNKALAPOK ELOTT ALLNAK.

        Nem izles: a fenykep a BEJELENTETT hibarol szol, a munkalap arrol, amit
        TETTUNK vele. A lap igy ugyanabban a sorrendben olvashato, ahogy a munka
        tortenik -- mi a baj, mi a bizonyiteka, mit csinaltunk.
      */}
            <ServicePanel className="space-y-3">
              <ServicePanelHeading title="Fényképek és fájlok" />
              <p className="text-xs text-dusk-500">
                A bejelentett hibáról. JPEG, PNG vagy PDF, fájlonként legfeljebb
                10 MB.
              </p>
              {documentsError ? (
                <Alert
                  variant="danger"
                  title="A csatolmányokkal baj van"
                  description={documentsError}
                />
              ) : null}
              {/*
                A KEPEK LATSZANAK, NEM LETOLTODNEK (Balazs kerese, 2026-09-17).
                A galeria a `components/service/` alol jon, ugyanonnan, ahonnan a
                lap tobbi szerviz-kulseje -- a munkalap es az eszkoz lapja
                ugyanezt a csatolmany-listat mutatja, es harom masolat harom
                kulon viselkedest jelentene ugyanarra a fogalomra.
              */}
              <ServiceDocumentGallery
                items={documents}
                loadBlob={(documentId) =>
                  serviceJobsApi.downloadDocumentThumbnail(
                    token,
                    jobId,
                    documentId,
                  )
                }
                onDownload={(item) => void downloadDocument(item)}
                /* A JOG HIANYA ITT A FUGGVENY HIANYA, nem egy `false` zaszlo: igy
                   a galeria nem tud "torol, de le van tiltva" allapotba kerulni. */
                onDelete={canManage ? setDocumentToDelete : undefined}
                /**
                 * A FELIRAT UTOLAG IS IRHATO, es a lista UJRATOLTODIK utana --
                 * nem a helyi allapotot irjuk at. A valasz csak nyugta, tehat a
                 * csempe a szerver szerinti allapotot mutassa, ne azt, amit mi
                 * hiszunk rola.
                 */
                onSaveCaption={
                  canManage
                    ? async (item, caption) => {
                        await serviceJobsApi.setDocumentCaption(
                          token,
                          jobId,
                          item.id,
                          caption,
                        );
                        await loadDocuments();
                      }
                    : undefined
                }
                emptyText="Ehhez a jegyhez még nincs fénykép vagy fájl csatolva."
              />
              {canManage ? (
                <div className="flex flex-wrap items-end gap-2 border-t pt-3">
                  <div className="space-y-1">
                    <label
                      className="block text-sm font-semibold"
                      htmlFor="hibajegy-csatolmany"
                    >
                      Új csatolmány
                    </label>
                    {/*
                TOBB FAJL EGYSZERRE. A helyszinen ritkan keszul egyetlen kep, es
                egy egyesevel valaszto urlap ugyanazt a kort futtatna otször.
                A szerver egy keresben legfeljebb tizet fogad.
              */}
                    <input
                      id="hibajegy-csatolmany"
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,application/pdf"
                      className="text-sm"
                      onChange={(event) =>
                        setDocumentFiles(Array.from(event.target.files ?? []))
                      }
                    />
                  </div>
                  {/*
                    A FELIRAT MEZO A VALASZTO MELLETT ALL, es ELHAGYHATO: egy
                    kep magaert is beszelhet. Aki nem ir bele, ugyanugy tolt
                    fel, mint eddig.
                  */}
                  <div className="space-y-1">
                    <label
                      className="block text-sm font-semibold"
                      htmlFor="hibajegy-csatolmany-felirat"
                    >
                      Felirat (elhagyható)
                    </label>
                    <Input
                      id="hibajegy-csatolmany-felirat"
                      value={documentCaption}
                      maxLength={500}
                      onChange={(event) =>
                        setDocumentCaption(event.target.value)
                      }
                      placeholder="Mit látunk a képeken?"
                    />
                  </div>
                  <Button
                    disabled={documentFiles.length === 0 || uploading}
                    onClick={() => void uploadDocuments()}
                  >
                    {documentFiles.length > 1
                      ? `Feltöltés (${documentFiles.length} fájl)`
                      : "Feltöltés"}
                  </Button>
                </div>
              ) : null}
            </ServicePanel>

            <ServicePanel className="space-y-3">
              <ServicePanelHeading title="Munkalapok a jegy mögött" />
              {worksheets.length ? (
                <ul className="space-y-1 text-sm">
                  {worksheets.map((worksheet) => (
                    <li key={worksheet.id}>
                      <Link
                        href={`/szerviz/munkalapok/${worksheet.id}`}
                        className="font-medium hover:text-brand-700"
                      >
                        {serviceJobWorksheetLabel(worksheet)}
                      </Link>
                      {/*
                  ÁTADÁS-ÁLLAPOTOT CSAK AKKOR ÁLLÍTUNK, HA VAN MIRE.

                  Itt korábban a hiányzó dátum ágán a "Még nálunk van" mondat
                  állt, és 2026-09-07-én kivettük. Az AKKORI indok: a
                  `handedOverAt` mezőnek nem volt írója, tehát az a mondat
                  MINDEN munkalapnál, MINDIG megjelent, és egy állapotot
                  állított, ami nem létezik. Nem hiányzó adat volt, hanem hamis
                  állítás: aki azt olvassa, hogy az eszköze még nálunk van, nem
                  kérdez utána -- egy üres mező után igen.

                  === A MÉRÉS RÉSZE 2026-09-21 ÓTA ELAVULT ===

                  A blokk korábban azt állította, hogy a mezőt SEMMI nem írja,
                  és hogy a mobil fában a `handedOver` szó nulla alkalommal
                  fordul elő. A #908 óta egyik sem áll. Visszamérve a fő ágon
                  2026-09-21-én: az írás a `worksheets.repository.ts` 335-336.
                  sorában áll (mind a két ágon, a visszavonáson is), a végpont
                  a `worksheets.controller.ts` 375. sorában (`POST
                  :id/handover`), és a mobil fában KILENC fájl említi.

                  A blokk utolsó mondata ("Ha egyszer lesz írója, az alábbi ág
                  magától megjelenik") pedig BETELJESÜLT: az "Átadva" sor ma
                  valódi adatot mutat.

                  AZ INDOK VISZONT ÉRVÉNYES MARAD, ezért maradt itt: állapotot
                  nem állítunk író nélkül. Ez a mondat nem a mezőről szól,
                  hanem arról, hogyan szabad hiányzó adatot megjeleníteni.

                  === AMI NYITOTT, ÉS SZÁNDÉKOSAN NEM ITT DŐL EL ===

                  A NEGATÍV ág (a "Még nálunk van" mondat) itt továbbra SINCS
                  visszatéve, holott ma már tudna igazat mondani. Nem felejtés:
                  a jegy alatt több lap is állhat, tehát ez a lista soronként
                  ismételné a mondatot. És a kérdés összefügg a készülő lezárási
                  kapuval (6515e700): ha a kapu visszatartja a jegyet, a kezelő
                  ITT fogja keresni az okot. A két szöveget EGYÜTT kell
                  eldönteni, különben a kapu mondata és a lista némasága két
                  külön meglepetés lesz.
                */}
                      {worksheet.handedOverAt ? (
                        <span className="ml-2 text-xs text-dusk-500">
                          Átadva: {formatDateTime(worksheet.handedOverAt)}
                        </span>
                      ) : null}
                      {/* A VISSZAUT OTT ALL, AHOL A HIBA LATSZIK: a lap mellett,
                    nem egy kulon felulet menujeben. Aki eszreveszi, hogy rossz
                    lapot csatolt, ugyanabban a sorban tudja levenni. */}
                      {canManage ? (
                        <button
                          type="button"
                          className="ml-2 text-xs text-dusk-500 underline hover:text-brand-700"
                          disabled={attaching}
                          onClick={() => setSheetToDetach(worksheet.id)}
                        >
                          Leválasztás
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-dusk-500">
                  Ehhez a jegyhez még nem tartozik munkalap.
                </p>
              )}

              {/*
          A CSATOLAS A JEGY OLDALAN VAN, mert a folyamat is innen nez ki igy: a
          szerelo helyben felveszi a lapot, atadja, es a jegy NALUNK szuletik meg
          utolag - a felelos akkor veszi hozza a mar meglevo lapot.

          A VALASZTO CSAK A SZABAD LAPOKAT KINALJA (amik alatt nincs jegy), es
          semmilyen allapot szerint nem szur: a lezart lap is csatolhato, mert a
          lezaras a DOKUMENTUMROL szol, a csatolas a BESOROLASROL.
        */}
              {/*
          AZ UJ LAP NYITASA A FELVITELI LAPRA VISZ, NEM SAJAT URLAPPAL.
          A felviteli lap mar tud mindent (partner, alegyseg, targy, sorok,
          felelosok); egy masodik urlap ITT duplikalna, es a ketto egyszer
          elcsuszna egymastol. A jegy azonositoja a cimben megy at, a PARTNERT
          viszont a felviteli lap a SZERVERTOL kerdezi -- egy cimben atadott
          partner-azonositot barki atirhatna.

          PARTNER NELKULI JEGYNEL NEM ALL OTT: a lap ugyis elutasitana, es egy
          gomb, ami biztosan hibara visz, rosszabb a hianyanal.
        */}
              {canManage && job.customerId !== null ? (
                <div className="border-t pt-3">
                  <Link
                    href={`/szerviz/munkalapok/uj?hibajegy=${encodeURIComponent(jobId)}`}
                  >
                    <Button variant="secondary">
                      Új munkalap nyitása a jegy alá
                    </Button>
                  </Link>
                </div>
              ) : null}
              {/* A REJTES ES A VISSZAALLITAS AZ ADATLAPON ALL, nem a lista
                  soraban: ott egy felrekattintas rejtene el egy valodi jegyet.

                  ES A JEGY REJTESE NEM VISZI MAGAVAL A MUNKALAPJAIT -- a
                  mondat ott all a gomb alatt, mert ezt a felhasznalo nem tudja
                  kitalalni, es a kovetkezmenye a lapokon latszana. */}
              {canHide ? (
                <div className="space-y-2 border-t pt-3">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void serviceJobsApi
                        .setHidden(token, jobId, !job.hidden)
                        .then(() => load())
                    }
                  >
                    {job.hidden ? "Visszaállítás" : "Elrejtés"}
                  </Button>
                  <p className="text-xs text-muted">
                    {job.hidden
                      ? "Ez a jegy nincs benne a listákban. A visszaállítás után újra megjelenik."
                      : "A jegy kikerül a listákból, de megmarad, és a munkalapjai változatlanul látszanak."}
                  </p>
                </div>
              ) : null}
              {canManage ? (
                <div className="space-y-2 border-t pt-3">
                  <label
                    className="block text-sm font-semibold"
                    htmlFor="csatolando-munkalap"
                  >
                    Meglévő munkalap csatolása
                  </label>
                  {attachError ? (
                    <Alert
                      variant="danger"
                      title="A csatolás nem ment"
                      description={attachError}
                    />
                  ) : null}
                  {attachable.length ? (
                    <div className="flex flex-wrap gap-2">
                      <select
                        id="csatolando-munkalap"
                        className="rounded border px-2 py-1 text-sm"
                        value={chosenSheet}
                        onChange={(event) => setChosenSheet(event.target.value)}
                      >
                        <option value="">Válassz munkalapot</option>
                        {attachable.map((sheet) => (
                          <option key={sheet.id} value={sheet.id}>
                            {sheet.number ?? "Piszkozat"} - {sheet.customerName}{" "}
                            - {sheet.subject}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="secondary"
                        disabled={!chosenSheet || attaching}
                        onClick={() => void attach()}
                      >
                        Csatolás
                      </Button>
                    </div>
                  ) : (
                    /* A HIANY IS ALLITAS: egy eltunt valaszto ugy nezne ki, mint egy
                 betoltesi hiba.

                 ES A MONDAT MINDKET FELTETELT MEGNEVEZI. A lista MA ket dologra
                 szur: a lap legyen szabad, ES a jegy partnereé. A regi mondat
                 csak az elsot mondta ki, tehat a szuro bevezetese utan hamis
                 lenne: lehet szabad lap boven, csak MAS partnere. Egy mondat,
                 ami ket kulonbozo allapotbol is elohivhato, a kettot osszemossa
                 -- es a felhasznalo azt hinne, egyaltalan nincs szabad lap. */
                    <p className="text-sm text-dusk-500">
                      Ehhez a partnerhez nincs olyan munkalap, ami még egyik
                      hibajegyhez sem tartozik.
                    </p>
                  )}
                </div>
              ) : null}
            </ServicePanel>
          </>
        }
        side={
          <>
            {/*
              A TEENDO KIEMELT PANELT KAP, ES A HASAB TETEJERE KERUL.

              A lapon tobb doboz all egymas alatt, es kozuluk EGY olyan, amiben
              teendo van. Ha ugyanugy nez ki, mint az adat-panelek, akkor
              egyenrangu velük -- holott epp ez az a kerdes, amiert valaki
              megnyitotta a lapot. A kozos `ServiceNextAction` ezt a
              megkulonboztetest viszi, ugyanugy, mint a munkalap-adatlapon.
            */}
            {canManage ? (
              <ServiceNextAction
                eyebrow="Következő lépés"
                title={
                  job.allowedSteps.length
                    ? "Hova lép a jegy?"
                    : "Nincs több lépés"
                }
                action={
                  <div className="mt-4 space-y-3">
                    {stepError ? (
                      <Alert
                        variant="danger"
                        title="A lépés nem ment"
                        description={stepError}
                      />
                    ) : null}
                    {job.allowedSteps.length ? (
                      <>
                        <FormField
                          label="Megjegyzés"
                          description={serviceJobNoteDescription(
                            job.allowedSteps,
                          )}
                        >
                          <Textarea
                            aria-label="Megjegyzés a lépéshez"
                            rows={3}
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                            maxLength={2000}
                          />
                        </FormField>
                        {/*
                  EGYETLEN GOMB SEM VAR SZOVEGRE. A megjegyzes minden atmenetnel
                  elhagyhato (Balazs dontese, 2026-09-03), tehat a `disabled`
                  egyedul a folyamatban levo hivasrol szol.
                */}
                        <div className="flex flex-wrap gap-2">
                          {job.allowedSteps.map((to) => (
                            <Button
                              key={to}
                              variant="secondary"
                              disabled={stepping}
                              onClick={() => void step(to)}
                            >
                              {serviceJobStatusLabel[to]}
                            </Button>
                          ))}
                        </div>
                      </>
                    ) : (
                      /* A LEZÁRT JEGYEN NEM ÜRES A DOBOZ, hanem meg van mondva, miért.
                 Egy eltűnt gombsor úgy néz ki, mint egy betöltési hiba. */
                      <p className="text-xs text-brand-muted">
                        Ez a hibajegy lezárult, nincs több lépése.
                      </p>
                    )}
                  </div>
                }
              />
            ) : null}

            {/*
              A DELEGALTAK A JOBB HASABBAN ALLNAK, A "KOVETKEZO LEPES" ALATT.

              Ket erv allt szemben, es a dontes EGYIKET SEM valasztotta, hanem
              feloldotta oket (acrobot, 2026-09-15):

                a fejlecbe        aki megnyitja a jegyet, elsore azt akarja
                                  tudni, KINEL VAN -- gorgetes nelkul
                a naplo utan      a bal hasab olvasasi rendje ne toorjon meg
                                  (mi a baj -> mi a bizonyiteka -> mit tettunk)

              A DONTO RESZLET, AMIT EGYIK JAVASLAT SEM VETT SZAMBA: ez nem
              kiirt adat, hanem SZERKESZTO, sajat mentes-gombbal. Egy
              szerkeszto a cim-savban azt igerne, hogy a lap teteje
              allapot-osszefoglalo, kozben egy MUVELETET tenne oda.

              Itt mind a harom feltetel teljesul: gorgetes nelkul latszik,
              kinel van; a bal hasab rendje erintetlen; es a gombja ott all,
              ahol a tobbi teendo.
            */}
            <ServiceJobAssigneeEditor
              jobId={jobId}
              token={token}
              assignees={job.assignees}
              canManage={canManage}
              /*
                A SZERVER VALASZAT TESSZUK BE, NEM TOLTUNK UJRA. A vegpont a
                TELJES reszletlapot adja vissza -- ez elter a tobbi
                jegy-muvelettol, amik nyugtat adnak, es ott a hivo ujratolt.
              */
              onSaved={setJob}
            />

            {/*
              A HELYSZIN ES AZ ESZKOZOK, KOZVETLENUL A DELEGALAS ALATT.

              A HELYE NEM IZLES: a jobb hasab "Az ugy adatai" doboza KIIRJA a
              helyszint, es ez a doboz azt SZERKESZTI. Ket egymastol tavol allo
              hely ugyanarrol az adatrol azt eri el, hogy a kezelo elolvassa az
              egyiket, es nem talalja meg a masikat.

              ES AMIT EZ A DOBOZ ELOSZOR MUTAT MEG: a jegy ESZKOZEIT egyben. Ma
              azok CSAK a naploban jelennek meg, esemenykent -- egy lista, amit
              nem lehet atnezni, csak visszaolvasni.
            */}
            <ServiceJobPlacementEditor
              jobId={jobId}
              token={token}
              customerId={job.customerId}
              departmentId={job.departmentId}
              departmentPath={job.departmentPath}
              assets={job.assets}
              /*
                A LAPOK A NAPLOBOL JONNEK, nem kulon mezobol: a `ServiceJobDetail`
                NEM hordoz `worksheets` listat (merve 2026-09-16) -- a vegpont
                egy idorendet ad, es a munkalap-doboz is abbol szur. Ugyanaz a
                `worksheets` valtozo all itt, amit az a doboz hasznal.
              */
              worksheets={worksheets}
              canManage={canManage}
              onSaved={setJob}
            />

            {/*
            AZ UGY ADATAI: AMI A JEGYET AZONOSITJA A HELYSZINEN.

            NEM ISMETLI A DELEGALTAKAT, holott a terv itt mutatja oket. Annak a
            doboznak sajat szerkesztoje van KOZVETLENUL EZ FOLOTT (2026-09-15-ig
            a bal hasabban allt), es ket helyen allo nev egyszer elcsuszik -- a
            masodik peldany pedig nem hibazna, csak
            mast mondana.
          */}
            <ServicePanel className="space-y-3">
              <ServicePanelHeading title="Az ügy adatai" />
              {/*
                IKONOS SOROK, NEM `dl` -- ES AZ IKON ITT NEM DEKORACIO.

                A jobb hasab negy sora NEGY KULONBOZO dologrol szol (partner,
                hely, ido, es amit a masik fel lat). Egy csupasz cimke-ertek
                lista mind a negyet egyformanak mutatja, es vegig kell olvasni
                ahhoz, hogy megtalald, amit keresel. A kozos `ServiceContextRow`
                a munkalap-adatlapon is ezt csinalja.
              */}
              <div>
                <ServiceContextRow icon="building" label="Partner">
                  {job.customerName ?? "Nincs megadva"}
                </ServiceContextRow>
                {job.departmentName ? (
                  <ServiceContextRow icon="location" label="Helyszín">
                    {/*
                      A TOMB AZ ELSODLEGES, a szoveg a visszaeses. A szerver
                      mind a kettot kuldi, es ugyanabbol az utbol -- de a tomb
                      MEGMONDJA, hany szint van, a szoveg csak mutatja. Ha egy
                      kesobbi kepernyo szintenkent akar valamit (rovidites,
                      tordeles), ott mar nem kell visszafejtenie.
                    */}
                    {job.departmentPath?.length
                      ? job.departmentPath.join(" / ")
                      : job.departmentName}
                  </ServiceContextRow>
                ) : null}
                <ServiceContextRow icon="clock" label="Létrehozva">
                  {formatDateTime(job.createdAt)}
                </ServiceContextRow>
                {/* A PARTNER MAST LAT, es ez a lapon is latszik: a belso allapot
                  a cim alatt all, a partnere itt. Enelkul a kezelo nem tudja,
                  mit olvas a masik fel. A SZEM ikon szandekos: ez az egyetlen
                  sor, ami nem rolunk szol, hanem arrol, amit a MASIK fel lat. */}
                <ServiceContextRow icon="eye" label="A partner ezt látja">
                  <Badge variant={serviceJobStatusVariant(job.partnerStatus)}>
                    {job.partnerStatusLabel}
                  </Badge>
                </ServiceContextRow>
              </div>
            </ServicePanel>
            {/*
              A "GOMB A KARBANTARTASI LAPON" -- 679d4c04 kanban-kartya. A
              felteteles renderelest ITT mondjuk ki, nem a panel belsejeben:
              a szerver ugyis elutasitana egy nem-MAINTENANCE lapon, de a
              gomb ne is kinaljon fel olyat, amit vissza fog dobni.
            */}
            {job.kind === "MAINTENANCE" ? (
              <CompletionCertificatePanel serviceJobId={job.id} />
            ) : null}
            {/*
              A CSOMAG-OSSZEALLITAS ES KIKULDES -- 679d4c04 utani "3.5" szelet.
              Ugyanaz a hatokor-dontes, mint a teljesitesi igazolas panelnel:
              a szerver PARTNERS_MANAGE-hez koti, a felteteles renderelest
              itt mondjuk ki, hogy a gomb ne kinaljon fel olyat egy REPAIR
              lapon, amit a szerver 404-gyel visszadobna.
            */}
            {job.kind === "MAINTENANCE" ? (
              <MaintenancePackagePanel
                serviceJobId={job.id}
                jobNumber={job.jobNumber}
              />
            ) : null}
            {/*
          A HIANY MELLE A KIUT. Egy partner nelkuli jegy ma nem tud lapot fogadni,
          es enelkul a doboz nelkul ezt csak a csatolasnal tudna meg a felhasznalo
          -- egy masik kepernyon, es kiut nelkul.
        */}
            {canManage && job.customerName === null ? (
              <ServicePanel className="space-y-2">
                <label
                  className="block text-sm font-semibold"
                  htmlFor="jegy-partner"
                >
                  Partner beállítása
                </label>
                <p className="text-xs text-dusk-500">
                  Ehhez a hibajegyhez még nincs partner, ezért munkalapot sem
                  lehet alá csatolni.
                </p>
                {partnerError ? (
                  <Alert
                    variant="danger"
                    title="Nem sikerült"
                    description={partnerError}
                  />
                ) : null}
                <PartnerPicker
                  id="jegy-partner"
                  onPick={(picked) => void setPartner(picked.customerId)}
                />
              </ServicePanel>
            ) : null}
          </>
        }
      />
      {/*
        A KERDES HAROM RESZE, ES A HARMADIK ITT NEM UDVARIASSAG: a levalasztas
        VISSZAFORDITHATO, es ezt ki kell mondani. Egy kerdes, ami nem mondja
        meg, van-e visszaut, ugyanugy megijeszt egy artalmatlan lepesnel, mint
        egy veglegesnel -- es akkor a kovetkezo kerdest mar nem olvassa el senki.
      */}
      <ConfirmDialog
        open={sheetToDetach !== null}
        title="Leválasztod ezt a munkalapot a hibajegyről?"
        consequence="A lap kikerül a jegy alól, és a jegy naplójából is eltűnik a sora."
        recovery="Visszatehető: a lap újra szabaddá válik, és ugyanitt bármikor visszacsatolható."
        confirmLabel="Leválasztás"
        busy={attaching}
        onConfirm={() => {
          if (sheetToDetach !== null) void detach(sheetToDetach);
        }}
        onCancel={() => setSheetToDetach(null)}
      />
      {/*
        A HARMADIK MEZO ITT NEM VIGASZ, HANEM A LENYEG: ez a torles
        VISSZAFORDITHATATLAN. A bajtok elmennek a tarolobol is, es a
        "visszatehato" helyen az all, hogy UJRA FEL KELL TOLTENI -- ha a fajl
        mar nincs meg a gepen, akkor sehogy.

        ES KULON KERDES, NEM A MUNKALAP-LEVALASZTASE. A ket muveletnek MAS a
        visszautja (az egyik visszacsatolhato, a masik nem), es egy kozos
        szoveg az egyiknel biztosan hazudna.

        AMIT A KOZOS HALO ERROL NEM MOND MEG: a `confirm-usage.component.test.ts`
        FAJL-szinten mer -- ha a fajlban BARHOL all `ConfirmDialog`, a torlo
        hivast rendben levonek latja. Ebben a fajlban mar allt egy (a
        levalasztase), tehat a halo AKKOR IS zold maradna, ha ez a kerdes
        hianyozna. Ezert all ra sajat allitas a komponens-tesztben.
      */}
      <ConfirmDialog
        open={documentToDelete !== null}
        title="Törlöd ezt a csatolmányt?"
        consequence={
          documentToDelete
            ? `A(z) ${documentToDelete.fileName} végleg törlődik a hibajegyről.`
            : ""
        }
        recovery="Nem állítható vissza: csak úgy kerül vissza, ha újra feltöltöd."
        confirmLabel="Törlés"
        onConfirm={() => {
          if (documentToDelete) void deleteDocument(documentToDelete.id);
        }}
        onCancel={() => setDocumentToDelete(null)}
      />
    </div>
  );
}
